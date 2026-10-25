import { isLikelyIdentifierColumn } from "./identifier.js";
import type { ColumnData } from "./column.js";
import { computeRelationships } from "./relationships.js";
import type { ColumnType } from "../types.js";
import { tokenize } from "../search/normalize.js";
import { STOPWORDS } from "./text-profile.js";

export type ColumnNetworkRole = "text" | "category" | "numeric";

export type ColumnNetworkMethod =
  | "pearson"
  | "spearman"
  | "cramersV"
  | "eta2"
  | "tokenOverlap";

export interface ColumnNetworkNode {
  column: number;
  label: string;
  type: ColumnType;
  role: ColumnNetworkRole;
}

export interface ColumnNetworkEdge {
  aColumn: number;
  bColumn: number;
  aLabel: string;
  bLabel: string;
  method: ColumnNetworkMethod;
  /** Signed for correlations; 0..1 for the other methods. */
  effect: number;
  /** Pairwise observations, or rows with tokens on both sides. */
  n: number;
  /** Text-derived edges: how many value groups fed the test. */
  groups?: number;
  /** Token-derived edges: the strongest term used for the test. */
  basis?: string;
}

export interface ColumnNetworkOptions {
  maxText?: number;
  maxNumeric?: number;
  maxCategorical?: number;
  /** Top values kept before grouping the rest as Other (default 20). */
  topValues?: number;
  minAbs?: number;
  /** Minimum row-level token Jaccard for two text columns (default 0.08). */
  minTextOverlap?: number;
  /** Deterministic row cap for text tokenisation (default 20,000). */
  rowLimit?: number;
  limit?: number;
}

export interface ColumnNetworkResult {
  nodes: ColumnNetworkNode[];
  edges: ColumnNetworkEdge[];
  /** Rows used for pairwise calculations. */
  analyzedRows: number;
  /** Rows available in the current scope. */
  totalRows: number;
  /** True when text/categorical calculations used a row sample. */
  sampled: boolean;
}

const EMPTY_LABEL = "(empty)";
const MAX_ROW_TOKENS = 200;

interface TextGroups {
  labels: string[];
  codes: Map<number, number>;
  groups: number;
}

function sampleIds(ids: Uint32Array, limit: number): Uint32Array {
  if (ids.length <= limit) return ids;
  const out = new Uint32Array(limit);
  const stride = ids.length / limit;
  for (let i = 0; i < limit; i++) {
    out[i] = ids[Math.floor((i + 0.5) * stride)] ?? 0;
  }
  return out;
}

function tokenSet(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of tokenize(value)) {
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    tokens.add(token);
    if (tokens.size >= MAX_ROW_TOKENS) break;
  }
  return tokens;
}

function keyFor(column: ColumnData, value: string): string {
  return column.isNull(value) || value.trim() === "" ? EMPTY_LABEL : value.trim();
}

function buildTextGroups(
  column: ColumnData,
  ids: Uint32Array,
  topValues: number,
): TextGroups {
  const counts = new Map<string, number>();
  for (const row of ids) {
    const key = keyFor(column, column.raw[row] ?? "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const labels = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, topValues)
    .map(([label]) => label);
  const index = new Map(labels.map((label, position) => [label, position]));
  const codes = new Map<number, number>();
  let other = 0;
  for (const row of ids) {
    const key = keyFor(column, column.raw[row] ?? "");
    const code = index.get(key);
    if (code === undefined) {
      codes.set(row, labels.length);
      other++;
    } else {
      codes.set(row, code);
    }
  }
  return { labels, codes, groups: labels.length + (other > 0 ? 1 : 0) };
}

function categoryCodes(
  column: ColumnData,
  ids: Uint32Array,
): { labels: string[]; codes: Map<number, number> } {
  const labels = column.categories().labels;
  const index = new Map(labels.map((label, position) => [label, position]));
  const codes = new Map<number, number>();
  for (const row of ids) {
    codes.set(row, index.get(keyFor(column, column.raw[row] ?? "")) ?? 0);
  }
  return { labels, codes };
}

function cramersV(
  text: TextGroups,
  category: { labels: string[]; codes: Map<number, number> },
  ids: Uint32Array,
): { effect: number; n: number } {
  const kText = text.groups;
  const kCategory = category.labels.length;
  if (kText < 2 || kCategory < 2) return { effect: Number.NaN, n: 0 };
  const table = new Uint32Array(kText * kCategory);
  const rowTotals = new Uint32Array(kText);
  const colTotals = new Uint32Array(kCategory);
  let n = 0;
  for (const row of ids) {
    const ca = text.codes.get(row);
    const cb = category.codes.get(row);
    if (ca === undefined || cb === undefined || ca >= kText || cb >= kCategory) continue;
    table[ca * kCategory + cb]++;
    rowTotals[ca]++;
    colTotals[cb]++;
    n++;
  }
  if (n < 20) return { effect: Number.NaN, n };
  let chiSquare = 0;
  for (let a = 0; a < kText; a++) {
    for (let b = 0; b < kCategory; b++) {
      const expected = (rowTotals[a] * colTotals[b]) / n;
      const observed = table[a * kCategory + b] ?? 0;
      if (expected > 0) {
        chiSquare += ((observed - expected) * (observed - expected)) / expected;
      }
    }
  }
  const denominator = n * Math.min(kText - 1, kCategory - 1);
  return {
    effect: denominator > 0 ? Math.sqrt(chiSquare / denominator) : Number.NaN,
    n,
  };
}

function etaSquared(
  text: TextGroups,
  values: Float64Array,
  ids: Uint32Array,
): { effect: number; n: number } {
  const k = text.groups;
  if (k < 2) return { effect: Number.NaN, n: 0 };
  const sums = new Float64Array(k);
  const counts = new Uint32Array(k);
  let n = 0;
  let total = 0;
  let totalSquares = 0;
  for (const row of ids) {
    const value = values[row] ?? Number.NaN;
    const code = text.codes.get(row);
    if (!Number.isFinite(value) || code === undefined || code >= k) continue;
    sums[code] += value;
    counts[code]++;
    total += value;
    totalSquares += value * value;
    n++;
  }
  if (n < 20) return { effect: Number.NaN, n };
  const grandMean = total / n;
  let between = 0;
  for (let code = 0; code < k; code++) {
    const count = counts[code] ?? 0;
    if (count === 0) continue;
    const mean = (sums[code] ?? 0) / count;
    between += count * (mean - grandMean) * (mean - grandMean);
  }
  const totalVariation = totalSquares - (total * total) / n;
  return {
    effect: totalVariation > 0 ? between / totalVariation : Number.NaN,
    n,
  };
}

function textOverlap(
  ids: Uint32Array,
  a: Map<number, Set<string>>,
  b: Map<number, Set<string>>,
): { effect: number; n: number } {
  let intersection = 0;
  let union = 0;
  let n = 0;
  for (const row of ids) {
    const left = a.get(row);
    const right = b.get(row);
    if (left === undefined || right === undefined || left.size === 0 || right.size === 0) {
      continue;
    }
    let shared = 0;
    for (const token of left) {
      if (right.has(token)) shared++;
    }
    intersection += shared;
    union += left.size + right.size - shared;
    n++;
  }
  return { effect: union > 0 ? intersection / union : Number.NaN, n };
}

function tokensFor(column: ColumnData, ids: Uint32Array): Map<number, Set<string>> {
  const tokens = new Map<number, Set<string>>();
  for (const row of ids) {
    const value = column.raw[row] ?? "";
    if (column.isNull(value)) continue;
    const set = tokenSet(value);
    if (set.size > 0) tokens.set(row, set);
  }
  return tokens;
}

/** Most widespread terms in a text column, used as binary association features. */
function topTokens(
  tokens: Map<number, Set<string>>,
  ids: Uint32Array,
  limit: number,
): { token: string; df: number }[] {
  const df = new Map<string, number>();
  for (const row of ids) {
    const set = tokens.get(row);
    if (set === undefined) continue;
    for (const token of set) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return [...df.entries()]
    .filter(([, count]) => count >= 2 && count <= ids.length - 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([token, count]) => ({ token, df: count }));
}

function presenceGroups(
  tokens: Map<number, Set<string>>,
  token: string,
  ids: Uint32Array,
): TextGroups {
  const codes = new Map<number, number>();
  for (const row of ids) {
    codes.set(row, tokens.get(row)?.has(token) === true ? 0 : 1);
  }
  return { labels: ["present", "absent"], codes, groups: 2 };
}

/**
 * Column-level relationship map. Numeric and categorical pairs use the
 * existing exploratory methods; text columns are compared with each other by
 * row-level token overlap. For text against numeric/categorical columns, short
 * repeating text groups its top values + Other, while free text uses the
 * strongest token presence as a binary feature.
 */
export function computeColumnNetwork(
  columns: readonly ColumnData[],
  ids: Uint32Array,
  rowCount: number,
  options: ColumnNetworkOptions = {},
): ColumnNetworkResult {
  const maxText = Math.max(0, Math.floor(options.maxText ?? 6));
  const maxNumeric = Math.max(1, Math.floor(options.maxNumeric ?? 8));
  const maxCategorical = Math.max(1, Math.floor(options.maxCategorical ?? 6));
  const topValues = Math.max(2, Math.floor(options.topValues ?? 20));
  const minAbs = options.minAbs ?? 0.3;
  const minTextOverlap = options.minTextOverlap ?? 0.08;
  const rowLimit = Math.max(100, Math.floor(options.rowLimit ?? 20_000));
  const limit = Math.max(1, Math.floor(options.limit ?? 80));

  const text: number[] = [];
  const numeric: number[] = [];
  const categorical: number[] = [];
  columns.forEach((column, index) => {
    if (column.role === "provenance") return;
    if (column.type === "string") {
      if (maxText > 0 && text.length < maxText && column.stats.distinct >= 2) {
        text.push(index);
      }
      return;
    }
    if (column.type === "category" || column.type === "boolean") {
      if (categorical.length >= maxCategorical) return;
      const labels = column.categories().labels;
      if (labels.length >= 2 && labels.length <= topValues) categorical.push(index);
      return;
    }
    if (
      (column.type === "integer" || column.type === "number") &&
      numeric.length < maxNumeric &&
      column.stats.distinct >= 2 &&
      !isLikelyIdentifierColumn(column, rowCount)
    ) {
      numeric.push(index);
    }
  });

  const nodes: ColumnNetworkNode[] = [
    ...text.map((index) => ({
      column: index,
      label: columns[index]?.name ?? "?",
      type: columns[index]?.type ?? "string",
      role: "text" as const,
    })),
    ...categorical.map((index) => ({
      column: index,
      label: columns[index]?.name ?? "?",
      type: columns[index]?.type ?? "category",
      role: "category" as const,
    })),
    ...numeric.map((index) => ({
      column: index,
      label: columns[index]?.name ?? "?",
      type: columns[index]?.type ?? "number",
      role: "numeric" as const,
    })),
  ];

  const sampledIds = sampleIds(ids, rowLimit);
  const sampled = sampledIds.length < ids.length;
  const edges: ColumnNetworkEdge[] = [];

  // Numeric/category pairs from the established discovery engine. Passing the
  // selected subset preserves the original column indexes after remapping.
  const establishedColumns = [...categorical, ...numeric];
  if (establishedColumns.length >= 2) {
    const subset = establishedColumns.map((index) => columns[index]).filter((column) => column !== undefined);
    const found = computeRelationships(subset, rowCount, sampledIds, {
      maxNumeric: numeric.length,
      maxCategorical: categorical.length,
      topCategories: topValues,
      minAbs,
      limit: Math.max(40, nodes.length * nodes.length),
    });
    for (const edge of found) {
      const a = establishedColumns[edge.aColumn];
      const b = establishedColumns[edge.bColumn];
      if (a === undefined || b === undefined) continue;
      edges.push({
        aColumn: a,
        bColumn: b,
        aLabel: columns[a]?.name ?? "?",
        bLabel: columns[b]?.name ?? "?",
        method: edge.kind,
        effect: edge.effect,
        n: edge.n,
      });
    }
  }

  const textGroups = new Map<number, TextGroups>();
  const groupsFor = (index: number): TextGroups => {
    let groups = textGroups.get(index);
    if (groups === undefined) {
      groups = buildTextGroups(columns[index] as ColumnData, sampledIds, topValues);
      textGroups.set(index, groups);
    }
    return groups;
  };

  const tokenCache = new Map<number, Map<number, Set<string>>>();
  const tokensForIndex = (index: number): Map<number, Set<string>> => {
    let tokens = tokenCache.get(index);
    if (tokens === undefined) {
      tokens = tokensFor(columns[index] as ColumnData, sampledIds);
      tokenCache.set(index, tokens);
    }
    return tokens;
  };

  // Text × text: token overlap within the same row.
  for (let a = 0; a < text.length; a++) {
    for (let b = a + 1; b < text.length; b++) {
      const indexA = text[a] as number;
      const indexB = text[b] as number;
      const result = textOverlap(sampledIds, tokensForIndex(indexA), tokensForIndex(indexB));
      if (Number.isFinite(result.effect) && result.effect >= minTextOverlap) {
        edges.push({
          aColumn: indexA,
          bColumn: indexB,
          aLabel: columns[indexA]?.name ?? "?",
          bLabel: columns[indexB]?.name ?? "?",
          method: "tokenOverlap",
          effect: result.effect,
          n: result.n,
        });
      }
    }
  }

  const textMode = new Map<number, "groups" | "tokens">();
  const modeFor = (index: number): "groups" | "tokens" => {
    let mode = textMode.get(index);
    if (mode === undefined) {
      const distinct = columns[index]?.stats.distinct ?? 0;
      mode = distinct <= topValues * 2 ? "groups" : "tokens";
      textMode.set(index, mode);
    }
    return mode;
  };

  // Text × category: top-value groups for short categories, strongest token
  // presence for free text where nearly every value is unique.
  for (const textIndex of text) {
    const mode = modeFor(textIndex);
    const groups = mode === "groups" ? groupsFor(textIndex) : null;
    for (const categoryIndex of categorical) {
      const category = categoryCodes(columns[categoryIndex] as ColumnData, sampledIds);
      let best: { effect: number; n: number; basis?: string; groups: number } | null = null;
      if (mode === "groups" && groups !== null) {
        const result = cramersV(groups, category, sampledIds);
        if (Number.isFinite(result.effect)) {
          best = { effect: result.effect, n: result.n, groups: groups.groups };
        }
      } else {
        const tokens = tokensForIndex(textIndex);
        for (const term of topTokens(tokens, sampledIds, 12)) {
          if (Math.min(term.df, sampledIds.length - term.df) < 10) continue;
          const presence = presenceGroups(tokens, term.token, sampledIds);
          const result = cramersV(presence, category, sampledIds);
          if (
            Number.isFinite(result.effect) &&
            (best === null || result.effect > best.effect)
          ) {
            best = {
              effect: result.effect,
              n: result.n,
              basis: term.token,
              groups: 2,
            };
          }
        }
      }
      if (best !== null && best.effect >= minAbs) {
        edges.push({
          aColumn: textIndex,
          bColumn: categoryIndex,
          aLabel: columns[textIndex]?.name ?? "?",
          bLabel: columns[categoryIndex]?.name ?? "?",
          method: "cramersV",
          effect: best.effect,
          n: best.n,
          groups: best.groups,
          ...(best.basis === undefined ? {} : { basis: best.basis }),
        });
      }
    }
  }

  // Text × numeric: top-value groups or the strongest token presence.
  for (const textIndex of text) {
    const mode = modeFor(textIndex);
    const groups = mode === "groups" ? groupsFor(textIndex) : null;
    for (const numericIndex of numeric) {
      const values = columns[numericIndex]?.numbers() ?? new Float64Array(0);
      let best: { effect: number; n: number; basis?: string; groups: number } | null = null;
      if (mode === "groups" && groups !== null) {
        const result = etaSquared(groups, values, sampledIds);
        if (Number.isFinite(result.effect)) {
          best = { effect: result.effect, n: result.n, groups: groups.groups };
        }
      } else {
        const tokens = tokensForIndex(textIndex);
        for (const term of topTokens(tokens, sampledIds, 12)) {
          if (Math.min(term.df, sampledIds.length - term.df) < 10) continue;
          const presence = presenceGroups(tokens, term.token, sampledIds);
          const result = etaSquared(presence, values, sampledIds);
          if (
            Number.isFinite(result.effect) &&
            (best === null || result.effect > best.effect)
          ) {
            best = {
              effect: result.effect,
              n: result.n,
              basis: term.token,
              groups: 2,
            };
          }
        }
      }
      if (best !== null && best.effect >= minAbs) {
        edges.push({
          aColumn: textIndex,
          bColumn: numericIndex,
          aLabel: columns[textIndex]?.name ?? "?",
          bLabel: columns[numericIndex]?.name ?? "?",
          method: "eta2",
          effect: best.effect,
          n: best.n,
          groups: best.groups,
          ...(best.basis === undefined ? {} : { basis: best.basis }),
        });
      }
    }
  }

  const unique: ColumnNetworkEdge[] = [];
  const seen = new Set<string>();
  for (const edge of edges.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))) {
    const key = edge.aColumn < edge.bColumn
      ? `${edge.aColumn}:${edge.bColumn}`
      : `${edge.bColumn}:${edge.aColumn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
    if (unique.length >= limit) break;
  }

  return {
    nodes,
    edges: unique,
    analyzedRows: sampledIds.length,
    totalRows: ids.length,
    sampled,
  };
}
