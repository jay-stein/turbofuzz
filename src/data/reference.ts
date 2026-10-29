import { jaroWinkler } from "../search/jaro-winkler.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ScoreCheck } from "./score.js";

/**
 * Bundled reference lists (countries, currencies, states, calendar words) so the
 * Accuracy dimension can apply offline. Each list is its own chunk, loaded by
 * dynamic import only when a column's name and values point at it. No network.
 */
export type ReferenceKind = "country" | "currency" | "auState" | "usState" | "weekday" | "month";

export interface ReferenceData {
  names: string[];
  aliases: Record<string, string>;
}

export const REFERENCE_LABEL: Record<ReferenceKind, string> = {
  country: "countries",
  currency: "currencies",
  auState: "Australian states",
  usState: "US states",
  weekday: "weekdays",
  month: "months",
};

/** Whole-word name hints per kind. */
const NAME_WORDS: Record<ReferenceKind, readonly string[]> = {
  country: ["country", "nation", "countries"],
  currency: ["currency", "ccy"],
  auState: ["state", "province", "region", "territory"],
  usState: ["state", "province", "region"],
  weekday: ["weekday", "dow", "day"],
  month: ["month"],
};

/** Share of a column's distinct values that must be on the list before the list applies. */
export const MIN_RECOGNISED = 0.6;
/** Columns with more distinct values than this are not checked (not a closed set). */
const MAX_DISTINCT = 400;

const words = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Lowercase, accent-free, letters and digits only separated by single spaces. */
export function normaliseReference(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function loadReference(kind: ReferenceKind): Promise<ReferenceData> {
  switch (kind) {
    case "country":
      return (await import("./reference/countries.js")).default;
    case "currency":
      return (await import("./reference/small-lists.js")).currencies;
    case "auState":
      return (await import("./reference/small-lists.js")).auStates;
    case "usState":
      return (await import("./reference/small-lists.js")).usStates;
    case "weekday":
      return (await import("./reference/small-lists.js")).weekdays;
    case "month":
      return (await import("./reference/small-lists.js")).months;
  }
}

/** Which lists a column's name points at (cheap, no data). */
export function candidateKinds(name: string): ReferenceKind[] {
  const tokens = words(name);
  return (Object.keys(NAME_WORDS) as ReferenceKind[]).filter((kind) => NAME_WORDS[kind].some((word) => tokens.includes(word)));
}

export interface ReferenceIndex {
  canonical: Map<string, string>;
  names: string[];
}

export function indexReference(data: ReferenceData): ReferenceIndex {
  const canonical = new Map<string, string>();
  for (const name of data.names) canonical.set(normaliseReference(name), name);
  for (const [alias, target] of Object.entries(data.aliases)) canonical.set(normaliseReference(alias), target);
  return { canonical, names: data.names };
}

export interface ReferenceMiss {
  value: string;
  count: number;
  suggestion: string | null;
}

export interface ReferenceResult {
  kind: ReferenceKind;
  /** Populated cells checked, and how many are not on the list. */
  checked: number;
  invalid: number;
  misses: ReferenceMiss[];
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/**
 * Closest list entry, if it is close enough to be a believable typo. Fewest edits
 * wins; a tie goes to an entry the column already uses (Australia over Austria for
 * "Austrlia" in a column full of Australia), then to the Jaro-Winkler score.
 */
export function suggestReference(value: string, index: ReferenceIndex, preferred: ReadonlySet<string> = new Set()): string | null {
  const wanted = normaliseReference(value);
  if (wanted === "") return null;
  let best: string | null = null;
  let bestKey: [number, number, number] | null = null;
  for (const name of index.names) {
    const candidate = normaliseReference(name);
    const similarity = jaroWinkler(wanted, candidate);
    if (similarity < 0.85) continue;
    const key: [number, number, number] = [editDistance(wanted, candidate), preferred.has(candidate) ? 0 : 1, -similarity];
    if (bestKey === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = name;
      bestKey = key;
    }
  }
  return bestKey !== null && bestKey[0] <= Math.max(2, Math.floor(wanted.length / 4)) ? best : null;
}

/**
 * Checks a column's distinct values against one list. Returns null when the column is
 * not a closed set the list describes (too many values, or too few recognised).
 */
export function checkReference(
  kind: ReferenceKind,
  labels: readonly string[],
  counts: readonly number[],
  index: ReferenceIndex,
): ReferenceResult | null {
  if (labels.length === 0 || labels.length > MAX_DISTINCT) return null;
  let recognised = 0;
  for (const label of labels) if (index.canonical.has(normaliseReference(label))) recognised++;
  if (recognised / labels.length < MIN_RECOGNISED) return null;
  let checked = 0;
  let invalid = 0;
  const misses: ReferenceMiss[] = [];
  const used = new Set(labels.filter((label) => index.canonical.has(normaliseReference(label))).map((label) => normaliseReference(index.canonical.get(normaliseReference(label)) ?? label)));
  labels.forEach((label, i) => {
    const count = counts[i] ?? 0;
    checked += count;
    if (index.canonical.has(normaliseReference(label))) return;
    invalid += count;
    misses.push({ value: label, count, suggestion: suggestReference(label, index, used) });
  });
  misses.sort((a, b) => b.count - a.count);
  return { kind, checked, invalid, misses };
}

/**
 * Accuracy checks for every column a list applies to. Loads each list chunk only if
 * some column's name points at it. For a name that fits two lists (state) the better
 * fitting list wins.
 */
export async function accuracyChecks(metas: readonly ColumnMeta[]): Promise<ScoreCheck[]> {
  const checks: ScoreCheck[] = [];
  const cache = new Map<ReferenceKind, ReferenceIndex>();
  const indexFor = async (kind: ReferenceKind): Promise<ReferenceIndex> => {
    let index = cache.get(kind);
    if (index === undefined) {
      index = indexReference(await loadReference(kind));
      cache.set(kind, index);
    }
    return index;
  };
  for (let column = 0; column < metas.length; column++) {
    const meta = metas[column];
    if (meta.role === "provenance" || meta.categories === null) continue;
    const kinds = candidateKinds(meta.name);
    if (kinds.length === 0) continue;
    let best: ReferenceResult | null = null;
    for (const kind of kinds) {
      const result = checkReference(kind, meta.categories.labels, meta.categories.counts, await indexFor(kind));
      if (result !== null && (best === null || result.invalid < best.invalid)) best = result;
    }
    if (best === null) continue;
    const shown = best.misses.slice(0, 3).map((miss) => (miss.suggestion === null ? `${miss.value}` : `${miss.value} (did you mean ${miss.suggestion}?)`));
    checks.push({
      id: `accuracy.${column}`,
      dimension: "accuracy",
      label: `“${meta.name}” values are valid ${REFERENCE_LABEL[best.kind]}`,
      detail:
        best.invalid === 0
          ? `All ${best.checked.toLocaleString()} values are on the bundled ${REFERENCE_LABEL[best.kind]} list`
          : `${best.misses.length.toLocaleString()} ${best.misses.length === 1 ? "value is" : "values are"} not on the bundled list: ${shown.join("; ")}`,
      pass: best.checked - best.invalid,
      fail: best.invalid,
      na: 0,
      column,
      filter: null,
      fixLabel: null,
    });
  }
  return checks;
}
