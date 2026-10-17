import type { DatasetStats } from "./stats.js";
import type { DependencyPair } from "./dependencies.js";
import type { GroupAnomalyPair } from "./group-anomalies.js";
import type { RelationshipData } from "./relationships.js";
import type { DistributionChange } from "./distribution.js";
import type { SimilarClusterEntry } from "./similar-clusters.js";
import type { TextProfile } from "./text-profile.js";
import type { ColumnSuggestion } from "./suggestions.js";
import type { ColumnMeta } from "../worker/protocol.js";

export type FindingSeverity = "fix" | "review" | "info";

/** What clicking a finding's action does (resolved by the app). */
export type FindingAction =
  | { kind: "suggestion"; column: number; suggestion: ColumnSuggestion }
  | {
      kind: "filterSpecial";
      column: number;
      special: "nulls" | "valueAnomalies" | "groupAnomalies" | "pattern";
    }
  | { kind: "filterDuplicates" }
  | { kind: "filterRange"; column: number; min: number | null; max: number | null }
  | { kind: "filterText"; column: number; query: string }
  | { kind: "cleanNulls"; column: number }
  | { kind: "merge"; column: number }
  | { kind: "flagAnomalies"; column: number }
  | { kind: "winsorize"; column: number; percent: number };

export interface Finding {
  id: string;
  report: string;
  /** Which rows the finding describes; defaults to the whole dataset. */
  scope?: "dataset" | "rows";
  severity: FindingSeverity;
  /** Plain-language sentence. */
  title: string;
  evidence: { metric: string; value: string; n: number }[];
  /** Rows and columns the finding touches. */
  impact: { rows: number; columns: number[] };
  /** Optional one-click remedy; every fix lands in the Recipe with Undo. */
  fixLabel?: string;
  action?: FindingAction;
  /** Secondary remedies shown beside the primary action. */
  extraActions?: { label: string; action: FindingAction }[];
}

const NON_NEGATIVE_NAME = /(qty|quantity|count|stock|units|amount|price|cost|age|duration|distance|weight)/i;
const MEASUREMENT_NAME = /(length|weight|height|width|distance|duration|size|amount|price|rate|ratio|share|percent)/i;

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Quality findings from column metadata: types, formats, missingness, usefulness. */
export function qualityFindings(
  columns: readonly ColumnMeta[],
  stats: DatasetStats,
  rowCount = 0,
): Finding[] {
  const findings: Finding[] = [];

  columns.forEach((meta, column) => {
    for (const suggestion of meta.suggestions) {
      if (suggestion.kind === "typeConflict") {
        findings.push({
          id: `schema.${column}`,
          report: "quality.schemaHealth",
          severity: "fix",
          title: `“${meta.name}” is typed ${meta.type} but ${suggestion.count.toLocaleString()} cells do not parse`,
          evidence: [
            { metric: "non-parsing cells", value: suggestion.count.toLocaleString(), n: suggestion.count },
            { metric: "sampled", value: suggestion.sampled.toLocaleString(), n: suggestion.sampled },
            { metric: "example", value: `“${suggestion.example}”`, n: 1 },
          ],
          impact: { rows: suggestion.count, columns: [column] },
          fixLabel: "Treat as text",
          action: { kind: "suggestion", column, suggestion },
        });
      } else if (suggestion.kind === "mixedNumber") {
        findings.push({
          id: `format.${column}`,
          report: "quality.schemaHealth",
          severity: "fix",
          title: `“${meta.name}” mixes decimal conventions (${suggestion.count.toLocaleString()} cells)`,
          evidence: [
            { metric: "other-convention cells", value: suggestion.count.toLocaleString(), n: suggestion.count },
            { metric: "detected locale", value: suggestion.locale === "comma" ? "1.234,56" : "1,234.56", n: 1 },
          ],
          impact: { rows: suggestion.count, columns: [column] },
          fixLabel: "Repair values",
          action: { kind: "suggestion", column, suggestion },
        });
      } else if (suggestion.kind === "formula") {
        findings.push({
          id: `formula.${column}`,
          report: "quality.schemaHealth",
          severity: "fix",
          title: `“${meta.name}” holds ${suggestion.count.toLocaleString()} formula-like cells that spreadsheets would execute`,
          evidence: [
            { metric: "formula-like cells", value: suggestion.count.toLocaleString(), n: suggestion.count },
          ],
          impact: { rows: suggestion.count, columns: [column] },
          fixLabel: "Escape cells",
          action: { kind: "suggestion", column, suggestion },
        });
      } else if (
        suggestion.kind === "number" ||
        suggestion.kind === "date" ||
        suggestion.kind === "time" ||
        suggestion.kind === "duration" ||
        suggestion.kind === "boolean"
      ) {
        const label =
          suggestion.kind === "boolean"
            ? "booleans"
            : suggestion.kind === "date"
              ? "dates"
              : suggestion.kind === "time"
                ? "clock times"
                : suggestion.kind === "duration"
                  ? "durations"
                  : "numbers";
        const ratio = "ratio" in suggestion ? suggestion.ratio : 0;
        findings.push({
          id: `convert.${column}`,
          report: "quality.schemaHealth",
          severity: "review",
          title: `“${meta.name}” looks like ${label} stored as text`,
          evidence: [
            { metric: "matching share", value: percent(ratio), n: 1 },
          ],
          impact: { rows: Math.round(ratio * stats.totalCells / Math.max(1, columns.length)), columns: [column] },
          fixLabel: "Convert",
          action: { kind: "suggestion", column, suggestion },
        });
      }
    }

    const tokens = meta.nullTokens.filter((token) => token.label !== "" && token.count > 0);
    const tokenTotal = tokens.reduce((sum, token) => sum + token.count, 0);
    if (tokenTotal > 0) {
      findings.push({
        id: `placeholders.${column}`,
        report: "quality.missingness",
        severity: "fix",
        title: `“${meta.name}” stores missing values as text (${tokenTotal.toLocaleString()} cells)`,
        evidence: [
          ...tokens
            .slice(0, 4)
            .map((token) => ({
              metric: `“${token.label}”`,
              value: token.count.toLocaleString(),
              n: token.count,
            })),
        ],
        impact: { rows: tokenTotal, columns: [column] },
        fixLabel: "Convert to nulls",
        action: {
          kind: "suggestion",
          column,
          suggestion: { kind: "sentinel", value: tokens[0]?.label ?? "", count: tokenTotal, ratio: 0, sampled: 0 },
        },
      });
    } else if (meta.stats.nulls > 0) {
      findings.push({
        id: `missing.${column}`,
        report: "quality.missingness",
        severity: meta.stats.nulls / Math.max(1, stats.totalCells / Math.max(1, columns.length)) > 0.1 ? "review" : "info",
        title: `“${meta.name}” has ${meta.stats.nulls.toLocaleString()} empty cells`,
        evidence: [
          { metric: "empty cells", value: meta.stats.nulls.toLocaleString(), n: meta.stats.nulls },
          { metric: "distinct values", value: meta.stats.distinct.toLocaleString(), n: meta.stats.distinct },
        ],
        impact: { rows: meta.stats.nulls, columns: [column] },
        fixLabel: "Review",
        action: { kind: "cleanNulls", column },
      });
    }

    if (meta.similarGroups > 0) {
      findings.push({
        id: `categories.${column}`,
        report: "quality.categoryConsistency",
        severity: "review",
        title: `“${meta.name}” has ${meta.similarGroups.toLocaleString()} pair${meta.similarGroups === 1 ? "" : "s"} of near-identical values`,
        evidence: [
          { metric: "similar pairs", value: meta.similarGroups.toLocaleString(), n: meta.similarGroups },
          { metric: "distinct values", value: meta.stats.distinct.toLocaleString(), n: meta.stats.distinct },
        ],
        impact: { rows: 0, columns: [column] },
        fixLabel: "Merge values",
        action: { kind: "merge", column },
      });
    }

    if (meta.stats.distinct === 1 && meta.stats.nulls === 0) {
      findings.push({
        id: `constant.${column}`,
        report: "quality.columnUsefulness",
        severity: "info",
        title: `“${meta.name}” carries no information (one value in every row)`,
        evidence: [{ metric: "distinct values", value: "1", n: 1 }],
        impact: { rows: 0, columns: [column] },
      });
    }
    if (meta.type === "identifier") {
      findings.push({
        id: `identifier.${column}`,
        report: "quality.columnUsefulness",
        severity: "info",
        title: `“${meta.name}” reads as an identifier — useful as a key, not as a measure`,
        evidence: [{ metric: "distinct values", value: meta.stats.distinct.toLocaleString(), n: meta.stats.distinct }],
        impact: { rows: 0, columns: [column] },
      });
    }

    // Inferred constraints: negative values where the name implies a count.
    if (
      NON_NEGATIVE_NAME.test(meta.name) &&
      meta.stats.min !== null &&
      meta.stats.min < 0
    ) {
      findings.push({
        id: `negative.${column}`,
        report: "quality.constraintViolations",
        severity: "review",
        title: `“${meta.name}” goes negative (min ${meta.stats.min.toLocaleString()}) — counts and quantities usually cannot`,
        evidence: [
          { metric: "minimum", value: meta.stats.min.toLocaleString(), n: 1 },
          { metric: "maximum", value: (meta.stats.max ?? 0).toLocaleString(), n: 1 },
        ],
        impact: { rows: 0, columns: [column] },
        fixLabel: "Filter negatives",
        action: { kind: "filterRange", column, min: null, max: -Number.EPSILON },
      });
    }

    // Unit inconsistency: mass both below and above 1.0 in a measurement-like
    // column (0.15 vs 15 style mixes).
    if (MEASUREMENT_NAME.test(meta.name)) {
      const split = unitSplit(meta);
      if (split !== null) {
        findings.push({
          id: `units.${column}`,
          report: "quality.unitInconsistency",
          severity: "review",
          title: `“${meta.name}” may mix units — ${percent(split.belowOne)} of values are ≤ 1 and ${percent(split.aboveOne)} are above`,
          evidence: [
            { metric: "values ≤ 1", value: percent(split.belowOne), n: split.belowCount },
            { metric: "values > 1", value: percent(split.aboveOne), n: split.aboveCount },
            { metric: "method", value: "histogram mass either side of 1.0", n: 1 },
          ],
          impact: { rows: split.belowCount, columns: [column] },
          fixLabel: "Show ≤ 1",
          action: { kind: "filterRange", column, min: null, max: 1 },
        });
      }
    }

    // Join readiness: a unique key candidate (and its hygiene).
    if (rowCount > 20 && meta.stats.distinct === rowCount) {
      const keyLike =
        meta.type === "identifier" || meta.type === "string" || meta.type === "integer";
      if (keyLike) {
        if (meta.stats.nulls > 0) {
          findings.push({
            id: `key.${column}`,
            report: "quality.joinReadiness",
            severity: "review",
            title: `“${meta.name}” looks like a key but ${meta.stats.nulls.toLocaleString()} cells are empty`,
            evidence: [
              { metric: "distinct", value: meta.stats.distinct.toLocaleString(), n: meta.stats.distinct },
              { metric: "empty cells", value: meta.stats.nulls.toLocaleString(), n: meta.stats.nulls },
            ],
            impact: { rows: meta.stats.nulls, columns: [column] },
            fixLabel: "Review",
            action: { kind: "cleanNulls", column },
          });
        } else {
          findings.push({
            id: `key.${column}`,
            report: "quality.joinReadiness",
            severity: "info",
            title: `“${meta.name}” is a usable key (unique across ${rowCount.toLocaleString()} rows)`,
            evidence: [
              { metric: "distinct", value: meta.stats.distinct.toLocaleString(), n: meta.stats.distinct },
              { metric: "empty cells", value: "0", n: 0 },
            ],
            impact: { rows: 0, columns: [column] },
          });
        }
      }
    }
    const pattern = meta.pattern ?? null;
    if (pattern !== null && pattern.offCount > 0) {
      findings.push({
        id: `pattern.${column}`,
        report: "quality.schemaHealth",
        severity: "review",
        title: `“${meta.name}” has ${pattern.offCount.toLocaleString()} values that don't match the ${pattern.mask} format`,
        evidence: [
          { metric: "off-format cells", value: pattern.offCount.toLocaleString(), n: pattern.offCount },
          { metric: "dominant format", value: pattern.mask, n: 1 },
          { metric: "match share", value: percent(pattern.share), n: 1 },
          ...(pattern.examples[0] === undefined
            ? []
            : [{ metric: "example", value: `“${pattern.examples[0]}”`, n: 1 }]),
        ],
        impact: { rows: pattern.offCount, columns: [column] },
        fixLabel: "Filter off-format",
        action: { kind: "filterSpecial", column, special: "pattern" },
      });
    }
  });

  if (stats.duplicateRows > 0) {
    findings.push({
      id: "duplicates",
      report: "quality.duplicateAnalysis",
      severity: "review",
      title: `${stats.duplicateRows.toLocaleString()} rows are exact duplicates`,
      evidence: [
        { metric: "duplicate rows", value: stats.duplicateRows.toLocaleString(), n: stats.duplicateRows },
        { metric: "duplicate groups", value: stats.duplicateGroups.toLocaleString(), n: stats.duplicateGroups },
      ],
      impact: { rows: stats.duplicateRows, columns: [] },
      fixLabel: "Show duplicates",
      action: { kind: "filterDuplicates" },
    });
  }

  return findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.impact.rows - a.impact.rows);
}

/** Histogram mass either side of 1.0, for the unit-inconsistency heuristic. */
function unitSplit(
  meta: ColumnMeta,
): { belowOne: number; aboveOne: number; belowCount: number; aboveCount: number } | null {
  const histogram = meta.histogram;
  if (histogram === null || histogram.bins.length === 0 || histogram.symlog) return null;
  const span = histogram.max - histogram.min;
  if (!(span > 0) || histogram.max <= 1) return null;
  const width = span / histogram.bins.length;
  let below = 0;
  let above = 0;
  histogram.bins.forEach((count, index) => {
    const upper = histogram.min + (index + 1) * width;
    if (upper <= 1.0000001) below += count;
    else above += count;
  });
  const total = below + above;
  if (total < 50) return null;
  const belowOne = below / total;
  const aboveOne = above / total;
  if (belowOne < 0.05 || aboveOne < 0.05) return null;
  return { belowOne, aboveOne, belowCount: below, aboveCount: above };
}

/**
 * "Missing together": column pairs whose nulls land on the same rows, from the
 * worker's pairwise co-missingness counts (the Citi Bike birth-year/gender case).
 */
export function coMissingnessFindings(
  columns: readonly number[],
  labels: readonly string[],
  nullCells: readonly number[],
  pairs: readonly number[],
  minCount = 50,
  minShare = 0.8,
  limit = 5,
): Finding[] {
  const k = labels.length;
  const findings: Finding[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const together = pairs[i * k + j] ?? 0;
      const base = Math.min(nullCells[i] ?? 0, nullCells[j] ?? 0);
      if (together < minCount || base === 0) continue;
      const share = together / base;
      if (share < minShare) continue;
      const title =
        share >= 0.99
          ? `“${labels[i]}” and “${labels[j]}” are missing on the same ${together.toLocaleString()} rows`
          : `“${labels[i]}” and “${labels[j]}” are usually missing together (${percent(share)} of the smaller gap)`;
      findings.push({
        id: `comissing.${i}.${j}`,
        report: "quality.missingness",
        severity: "review",
        title,
        evidence: [
          { metric: "rows missing both", value: together.toLocaleString(), n: together },
          { metric: `“${labels[i]}” empties`, value: (nullCells[i] ?? 0).toLocaleString(), n: nullCells[i] ?? 0 },
          { metric: `“${labels[j]}” empties`, value: (nullCells[j] ?? 0).toLocaleString(), n: nullCells[j] ?? 0 },
          { metric: "method", value: "pairwise co-missingness over filtered rows", n: 1 },
        ],
        impact: { rows: together, columns: [columns[i] ?? -1, columns[j] ?? -1] },
      });
    }
  }
  return findings.sort((a, b) => b.impact.rows - a.impact.rows).slice(0, limit);
}

/**
 * Functional dependencies: candidate keys and what they determine. A clean
 * mapping is useful join/integrity evidence; conflicts point at broken
 * relationships ("the same station id with two different names").
 */
export function dependencyFindings(pairs: readonly DependencyPair[]): Finding[] {
  return pairs
    .map((pair) => {
      const functional = pair.violations === 0;
      const share = pair.rows > 0 ? 1 - pair.violations / pair.rows : 1;
      const example = pair.examples[0];
      const finding: Finding = {
        id: `dependency.${pair.determinantColumn}.${pair.dependentColumn}`,
        report: "quality.dataIntegrity",
        severity: functional ? "info" : "review",
        title: functional
          ? `“${pair.determinantLabel}” determines “${pair.dependentLabel}” (consistent for ${pair.rows.toLocaleString()} rows)`
          : `“${pair.determinantLabel}” almost determines “${pair.dependentLabel}” — ${pair.violations.toLocaleString()} conflicting rows`,
        evidence: [
          { metric: "rows checked", value: pair.rows.toLocaleString(), n: pair.rows },
          { metric: "conflicts", value: pair.violations.toLocaleString(), n: pair.violations },
          { metric: "consistency", value: percent(share), n: 1 },
          ...(example === undefined
            ? []
            : [
                {
                  metric: "example",
                  value: `${example.determinant} → ${example.values.join(" / ")}`,
                  n: 1,
                },
              ]),
        ],
        impact: {
          rows: pair.violations,
          columns: [pair.determinantColumn, pair.dependentColumn],
        },
      };
      return finding;
    })
    .sort((a, b) => b.impact.rows - a.impact.rows);
}

/**
 * Group-relative anomalies: values that are normal alone but unusual next to
 * their peers in the same category, with the method and an example.
 */
export function groupAnomalyFindings(pairs: readonly GroupAnomalyPair[]): Finding[] {
  return pairs
    .map((pair) => {
      const example = pair.examples[0];
      const formatter = (value: number): string =>
        value.toLocaleString(undefined, { maximumFractionDigits: 2 });
      const findings: Finding = {
        id: `groupAnomaly.${pair.valueColumn}.${pair.groupColumn}`,
        report: "anomalies.groupRelative",
        severity: "review",
        title: `${pair.flagged.toLocaleString()} “${pair.valueLabel}” values are unusual within “${pair.groupLabel}”`,
        evidence: [
          { metric: "flagged rows", value: pair.flagged.toLocaleString(), n: pair.flagged },
          { metric: "groups analysed", value: pair.groupsAnalysed.toLocaleString(), n: pair.groupsAnalysed },
          { metric: "method", value: "robust z per group (median/MAD), |z| > 3.5, groups ≥ 30", n: 1 },
          ...(example === undefined
            ? []
            : [
                {
                  metric: "example",
                  value: `${example.group}: ${formatter(example.value)} vs median ${formatter(
                    example.median,
                  )} (z ${example.z.toFixed(1)})`,
                  n: 1,
                },
              ]),
        ],
        impact: { rows: pair.flagged, columns: [pair.valueColumn, pair.groupColumn] },
        fixLabel: "Show rows",
        action: {
          kind: "filterSpecial",
          column: pair.valueColumn,
          special: "groupAnomalies",
        },
      };
      return findings;
    })
    .sort((a, b) => b.impact.rows - a.impact.rows);
}

/**
 * Ranked relationship findings from the discovery engine: Pearson and
 * Spearman for numerics, Cramér's V for categories and η² for numeric ×
 * category — always effect-sized, never p-valued.
 */
export function relationshipDataFindings(
  relationships: readonly RelationshipData[],
): Finding[] {
  return relationships.map((entry) => {
    const strength = Math.abs(entry.effect);
    const paired = `“${entry.aLabel}” and “${entry.bLabel}”`;
    let title: string;
    let method: string;
    switch (entry.kind) {
      case "pearson":
        title = `“${entry.aLabel}” is associated with “${entry.bLabel}” (Pearson r = ${entry.effect.toFixed(2)})`;
        method = "Pearson correlation over pairwise-complete rows";
        break;
      case "spearman":
        title = `“${entry.aLabel}” is associated with “${entry.bLabel}” (Spearman ρ = ${entry.effect.toFixed(2)})`;
        method = "Spearman rank correlation";
        break;
      case "cramersV":
        title = `${paired} are associated (Cramér's V = ${entry.effect.toFixed(2)})`;
        method = "Cramér's V from the category contingency table";
        break;
      default:
        title = `“${entry.aLabel}” differs across “${entry.bLabel}” groups (η² = ${entry.effect.toFixed(2)})`;
        method = "correlation ratio η² (between-group variance share)";
        break;
    }
    return {
      id: `relationship.${entry.kind}.${entry.aColumn}.${entry.bColumn}`,
      report: "relationships.association",
      severity: strength >= 0.95 ? "review" : "info",
      title,
      evidence: [
        { metric: "effect size", value: entry.effect.toFixed(2), n: entry.n },
        { metric: "observations", value: entry.n.toLocaleString(), n: entry.n },
        { metric: "method", value: method, n: 1 },
      ],
      impact: { rows: entry.n, columns: [entry.aColumn, entry.bColumn] },
    } satisfies Finding;
  });
}

export interface TextProfileInput {
  column: number;
  label: string;
  profile: TextProfile;
}

/**
 * Text mining findings: what a free-text column is about (top terms, term
 * variety) and whether it mixes shaped values (email/URL/phone) with prose.
 */
export function textProfileFindings(profiles: readonly TextProfileInput[]): Finding[] {
  return profiles
    .filter((entry) => entry.profile.rows >= 20 && entry.profile.totalTokens >= 20)
    .map((entry) => {
      const profile = entry.profile;
      const shaped = profile.shapes.email + profile.shapes.url + profile.shapes.phone;
      const shapedShare = profile.rows > 0 ? shaped / profile.rows : 0;
      const mixed = shapedShare >= 0.1 && shapedShare < 0.9 && shaped >= 5;
      const top = profile.topTerms[0];
      const finding: Finding = {
        id: `text.${entry.column}`,
        report: "quality.textMining",
        severity: mixed ? "review" : "info",
        title: mixed
          ? `“${entry.label}” mixes ${Math.round(shapedShare * 100)}% shaped values (email/URL/phone) with free text`
          : `“${entry.label}” is free text — ${profile.distinctTerms.toLocaleString()} distinct terms in ${profile.rows.toLocaleString()} values`,
        evidence: [
          { metric: "values", value: profile.rows.toLocaleString(), n: profile.rows },
          { metric: "avg length", value: profile.avgLength.toFixed(1), n: 1 },
          {
            metric: "distinct terms",
            value: profile.distinctTerms.toLocaleString(),
            n: profile.distinctTerms,
          },
          ...(top === undefined
            ? []
            : [
                {
                  metric: "top term",
                  value: `“${top.term}” (${top.count.toLocaleString()})`,
                  n: top.count,
                },
              ]),
          ...(shaped > 0
            ? [
                {
                  metric: "shaped values",
                  value: `${profile.shapes.email.toLocaleString()} email · ${profile.shapes.url.toLocaleString()} URL · ${profile.shapes.phone.toLocaleString()} phone`,
                  n: shaped,
                },
              ]
            : []),
          { metric: "method", value: "token frequency with stopword filtering", n: 1 },
        ],
        impact: { rows: profile.rows, columns: [entry.column] },
      };
      return finding;
    });
}

/**
 * Near-duplicate clusters per column: the values worth merging, with the most
 * frequent spelling suggested as the survivor. Analysis is capped and says so.
 */
export function similarClusterFindings(entries: readonly SimilarClusterEntry[]): Finding[] {
  return entries.map((entry) => {
    const clusters = entry.clusters.length;
    const affectedRows = entry.clusters.reduce((sum, cluster) => sum + cluster.rows, 0);
    const example = entry.clusters[0];
    const preview =
      example === undefined
        ? ""
        : ` (e.g. ${example.values
            .slice(0, 3)
            .map((member) => `“${member.value}”`)
            .join(" vs ")})`;
    return {
      id: `similar.${entry.column}`,
      report: "quality.nearDuplicates",
      severity: "review",
      title: `“${entry.label}” has ${clusters.toLocaleString()} cluster${
        clusters === 1 ? "" : "s"
      } of near-duplicate values${preview}`,
      evidence: [
        { metric: "clusters", value: clusters.toLocaleString(), n: clusters },
        { metric: "rows affected", value: affectedRows.toLocaleString(), n: affectedRows },
        ...(example === undefined
          ? []
          : example.values.slice(0, 4).map((member) => ({
              metric: member.value === example.suggested ? "keep (most common)" : "merge into it",
              value: `“${member.value}” (${member.count.toLocaleString()})`,
              n: member.count,
            }))),
        {
          metric: "analysed",
          value: entry.truncated
            ? `top ${entry.analysedValues.toLocaleString()} of ${entry.totalDistinct.toLocaleString()} values — approximate`
            : `${entry.analysedValues.toLocaleString()} of ${entry.totalDistinct.toLocaleString()} values`,
          n: entry.analysedValues,
        },
        { metric: "method", value: "normalised phonetic blocking + Jaro-Winkler", n: 1 },
      ],
      impact: { rows: affectedRows, columns: [entry.column] },
      fixLabel: "Review and merge",
      action: { kind: "merge", column: entry.column },
    } satisfies Finding;
  });
}

/**
 * Distribution changes between the first and second half of the current row
 * order (PSI for numbers, Cramér's V for category mixes).
 */
export function distributionFindings(changes: readonly DistributionChange[]): Finding[] {
  return changes.map((change) => {
    const label = change.kind === "numeric" ? "PSI" : "V";
    const measure = change.kind === "numeric" ? "numeric distribution" : "category mix";
    return {
      id: `distribution.${change.column}`,
      report: "quality.distributionChanges",
      severity: change.effect >= 0.25 ? "review" : "info",
      title: `The ${measure} of “${change.label}” shifted between the first and second half of the rows (${label} ${change.effect.toFixed(2)}) — ${change.detail}`,
      evidence: [
        { metric: label, value: change.effect.toFixed(2), n: 1 },
        { metric: "detail", value: change.detail, n: 1 },
        {
          metric: "window",
          value: `first half vs second half (${change.firstRows.toLocaleString()} / ${change.secondRows.toLocaleString()} rows)`,
          n: change.firstRows + change.secondRows,
        },
        {
          metric: "method",
          value:
            change.kind === "numeric"
              ? "Population Stability Index over first-half deciles"
              : "Cramér's V between row half and category",
          n: 1,
        },
      ],
      impact: { rows: change.firstRows + change.secondRows, columns: [change.column] },
    };
  });
}

/**
 * "Explain [column]": associations involving one column, ranked, with a
 * plain-language sentence. Wording stays at "associated with".
 */
export function explainColumn(
  labels: readonly string[],
  columns: readonly number[],
  values: Float64Array,
  counts: Uint32Array,
  label: string,
  minStrength = 0.1,
): { sentence: string; findings: Finding[] } {
  const index = labels.indexOf(label);
  if (index < 0) return { sentence: `“${label}” is not part of the correlation set.`, findings: [] };
  const n = labels.length;
  const findings: Finding[] = [];
  for (let other = 0; other < n; other++) {
    if (other === index) continue;
    const pairIndex = Math.min(index, other) * n + Math.max(index, other);
    const r = values[pairIndex];
    const pairs = counts[pairIndex] ?? 0;
    if (!Number.isFinite(r) || Math.abs(r) < minStrength || pairs < 20) continue;
    const row = Math.min(index, other);
    const col = Math.max(index, other);
    findings.push({
      id: `explain.${row}.${col}`,
      report: "relationships.explain",
      severity: Math.abs(r) >= 0.95 ? "review" : "info",
      title: `“${labels[row]}” is associated with “${labels[col]}” (ρ = ${r.toFixed(2)})`,
      evidence: [
        { metric: "Pearson r", value: r.toFixed(2), n: pairs },
        { metric: "pairwise observations", value: pairs.toLocaleString(), n: pairs },
        { metric: "direction", value: r > 0 ? "same direction" : "opposite direction", n: 1 },
      ],
      impact: { rows: pairs, columns: [columns[row] ?? -1, columns[col] ?? -1] },
    });
  }
  findings.sort(
    (a, b) =>
      Math.abs(Number.parseFloat(b.evidence[0]?.value ?? "0")) -
      Math.abs(Number.parseFloat(a.evidence[0]?.value ?? "0")),
  );
  const top = findings[0];
  const second = findings[1];
  if (top === undefined) {
    return {
      sentence: `No associations above ρ = ${minStrength.toFixed(2)} involve “${label}”.`,
      findings,
    };
  }
  const other = (finding: Finding): string =>
    finding.title.split(" is associated with “")[1]?.split("”")[0] ?? "?";
  const sentence =
    second === undefined
      ? `“${label}” is most strongly associated with “${other(top)}” (ρ = ${top.evidence[0].value}).`
      : `“${label}” is more strongly associated with “${other(top)}” (ρ = ${top.evidence[0].value}) than with “${other(second)}” (ρ = ${second.evidence[0].value}).`;
  return { sentence, findings: findings.slice(0, 10) };
}

/** Univariate anomaly findings with their detection method stated. */
export function anomalyFindings(columns: readonly ColumnMeta[]): Finding[] {
  const findings: Finding[] = [];
  columns.forEach((meta, column) => {
    if (meta.anomalyCounts.values > 0 && meta.valueFence !== null) {
      const method =
        meta.valueFence.method === "quantile"
          ? "p0.5–p99.5 quantile fence"
          : meta.valueFence.method === "log"
            ? "log-scale median fence (MAD)"
            : "robust median fence (MAD)";
      findings.push({
        id: `values.${column}`,
        report: "anomalies.univariate",
        severity: "review",
        title: `“${meta.name}” has ${meta.anomalyCounts.values.toLocaleString()} unusually large or small values`,
        evidence: [
          { metric: "flagged cells", value: meta.anomalyCounts.values.toLocaleString(), n: meta.anomalyCounts.values },
          { metric: "expected range", value: `${meta.valueFence.lo.toLocaleString()} – ${meta.valueFence.hi.toLocaleString()}`, n: 1 },
          { metric: "method", value: method, n: 1 },
        ],
        impact: { rows: meta.anomalyCounts.values, columns: [column] },
        fixLabel: "Show rows",
        action: { kind: "filterSpecial", column, special: "valueAnomalies" },
        extraActions: [
          {
            label: "Flag column",
            action: { kind: "flagAnomalies", column },
          },
          {
            label: "Winsorise 1%",
            action: { kind: "winsorize", column, percent: 1 },
          },
        ],
      });
    }
    if (meta.anomalyCounts.lengths > 0 && meta.lengthFence !== null) {
      findings.push({
        id: `lengths.${column}`,
        report: "anomalies.univariate",
        severity: "info",
        title: `“${meta.name}” has ${meta.anomalyCounts.lengths.toLocaleString()} values far longer than typical`,
        evidence: [
          { metric: "flagged cells", value: meta.anomalyCounts.lengths.toLocaleString(), n: meta.anomalyCounts.lengths },
          { metric: "expected max length", value: String(Math.round(meta.lengthFence.hi)), n: 1 },
        ],
        impact: { rows: meta.anomalyCounts.lengths, columns: [column] },
        fixLabel: "Show rows",
        action: { kind: "filterSpecial", column, special: "valueAnomalies" },
      });
    }
  });
  return findings.sort((a, b) => b.impact.rows - a.impact.rows);
}

/** Relationship findings from a Pearson matrix, capped and worded carefully. */
export function relationshipFindings(
  labels: readonly string[],
  columns: readonly number[],
  values: Float64Array,
  counts: Uint32Array,
  minStrength = 0.5,
  limit = 10,
): Finding[] {
  const n = labels.length;
  const findings: Finding[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = row + 1; col < n; col++) {
      const index = row * n + col;
      const r = values[index];
      const pairs = counts[index] ?? 0;
      if (!Number.isFinite(r) || Math.abs(r) < minStrength || pairs < 20) continue;
      const strength = Math.abs(r);
      findings.push({
        id: `pair.${row}.${col}`,
        report: "relationships.association",
        severity: strength >= 0.95 ? "review" : "info",
        title:
          strength >= 0.95
            ? `“${labels[row]}” and “${labels[col]}” carry near-duplicate information (r = ${r.toFixed(2)})`
            : `“${labels[row]}” is associated with “${labels[col]}” (ρ = ${r.toFixed(2)})`,
        evidence: [
          { metric: "Pearson r", value: r.toFixed(2), n: pairs },
          { metric: "pairwise observations", value: pairs.toLocaleString(), n: pairs },
          { metric: "direction", value: r > 0 ? "same direction" : "opposite direction", n: 1 },
        ],
        impact: { rows: pairs, columns: [columns[row] ?? -1, columns[col] ?? -1] },
      });
    }
  }
  return findings
    .sort((a, b) => {
      const ra = Math.abs(Number.parseFloat(a.evidence[0]?.value ?? "0"));
      const rb = Math.abs(Number.parseFloat(b.evidence[0]?.value ?? "0"));
      return rb - ra;
    })
    .slice(0, limit);
}

function severityRank(severity: FindingSeverity): number {
  return severity === "fix" ? 2 : severity === "review" ? 1 : 0;
}
