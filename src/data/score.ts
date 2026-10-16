import type { ColumnMeta } from "../worker/protocol.js";
import type { DatasetStats } from "./stats.js";

export type ScoreDimension =
  | "completeness"
  | "validity"
  | "uniqueness"
  | "consistency"
  | "timeliness"
  | "accuracy";

/** A check the failing rows of which the drawer can filter to. */
export type ScoreCheckFilter = "nulls" | "pattern" | "duplicates" | "valueAnomalies";

export interface ScoreCheck {
  id: string;
  dimension: ScoreDimension;
  /** Plain-language sentence, e.g. “Email” is populated". */
  label: string;
  /** Method/evidence line under the label. */
  detail: string;
  pass: number;
  fail: number;
  /** Excluded from the pass rate (never counted as pass or fail). */
  na: number;
  column: number | null;
  filter: ScoreCheckFilter | null;
  fixLabel: string | null;
}

export interface DimensionScore {
  dimension: ScoreDimension;
  label: string;
  abbreviation: string;
  /** null when the dimension has no applicable checks (N.A.). */
  score: number | null;
  weight: number;
  checks: ScoreCheck[];
  /** Why the dimension is N.A. (shown in the drawer). */
  note: string | null;
}

export interface DQScore {
  /** Weighted mean of the applicable dimensions; null when none apply. */
  overall: number | null;
  band: "good" | "fair" | "poor" | null;
  dimensions: DimensionScore[];
}

export interface DQScoreConfig {
  weights?: Partial<Record<ScoreDimension, number>>;
  bandGood?: number;
  bandFair?: number;
}

export const DEFAULT_DQ_CONFIG: Required<{
  weights: Record<ScoreDimension, number>;
  bandGood: number;
  bandFair: number;
}> = {
  weights: {
    completeness: 30,
    validity: 30,
    uniqueness: 15,
    consistency: 15,
    timeliness: 10,
    accuracy: 0,
  },
  bandGood: 90,
  bandFair: 75,
};

const DIMENSION_LABELS: Record<ScoreDimension, { label: string; abbreviation: string }> = {
  completeness: { label: "Completeness", abbreviation: "Comp" },
  validity: { label: "Validity", abbreviation: "Valid" },
  uniqueness: { label: "Uniqueness", abbreviation: "Uniq" },
  consistency: { label: "Consistency", abbreviation: "Cons" },
  timeliness: { label: "Timeliness", abbreviation: "Time" },
  accuracy: { label: "Accuracy", abbreviation: "Acc" },
};

/** Counts are rendered with locale separators for readability. */
function formatCount(value: number): string {
  return value.toLocaleString();
}

/**
 * Weighted data-quality score over the applicable dimensions (plan §3). The
 * score is dataset-level: all rows after the current step pipeline, ignoring
 * filters. Not-applicable results are excluded from pass rates — never counted
 * as failures — and advisory findings (outliers, near-duplicates, drift) are
 * deliberately absent. Display only: nothing here changes the data.
 */
export function computeDQScore(
  columns: readonly ColumnMeta[],
  stats: DatasetStats,
  rowCount: number,
  config: DQScoreConfig = {},
): DQScore {
  const weights = { ...DEFAULT_DQ_CONFIG.weights, ...(config.weights ?? {}) };
  const bandGood = config.bandGood ?? DEFAULT_DQ_CONFIG.bandGood;
  const bandFair = config.bandFair ?? DEFAULT_DQ_CONFIG.bandFair;

  const checks: ScoreCheck[] = [];

  // Completeness: every column's cells must be populated.
  columns.forEach((meta, column) => {
    checks.push({
      id: `completeness.${column}`,
      dimension: "completeness",
      label: `“${meta.name}” is populated`,
      detail: `${formatCount(meta.stats.nulls)} of ${formatCount(rowCount)} cells empty`,
      pass: Math.max(0, rowCount - meta.stats.nulls),
      fail: meta.stats.nulls,
      na: 0,
      column,
      filter: meta.stats.nulls > 0 ? "nulls" : null,
      fixLabel: meta.stats.nulls > 0 ? "Review empties" : null,
    });
  });

  // Validity: cells that parse under the inferred type and any dominant format.
  columns.forEach((meta, column) => {
    let invalid = 0;
    const reasons: string[] = [];
    for (const suggestion of meta.suggestions) {
      if (suggestion.kind === "typeConflict") {
        invalid += suggestion.count;
        reasons.push(`${formatCount(suggestion.count)} don't parse as ${suggestion.columnType}`);
      } else if (suggestion.kind === "mixedNumber") {
        invalid += suggestion.count;
        reasons.push(`${formatCount(suggestion.count)} mix decimal conventions`);
      } else if (suggestion.kind === "formula") {
        invalid += suggestion.count;
        reasons.push(`${formatCount(suggestion.count)} are formula-like`);
      }
    }
    const patternOff = meta.pattern?.offCount ?? 0;
    if (patternOff > 0) {
      invalid += patternOff;
      reasons.push(
        `${formatCount(patternOff)} don't match ${meta.pattern?.mask ?? "the dominant format"}`,
      );
    }
    const nonNull = Math.max(0, rowCount - meta.stats.nulls);
    const fail = Math.min(invalid, nonNull);
    checks.push({
      id: `validity.${column}`,
      dimension: "validity",
      label: `“${meta.name}” parses cleanly`,
      detail: reasons.length > 0 ? reasons.join(" · ") : "every value matches its type and format",
      pass: Math.max(0, nonNull - fail),
      fail,
      na: meta.stats.nulls,
      column,
      filter: patternOff > 0 ? "pattern" : null,
      fixLabel: patternOff > 0 ? "Show off-format" : null,
    });
  });

  // Uniqueness: exact duplicate rows (null-key hygiene comes with keydup).
  checks.push({
    id: "uniqueness.rows",
    dimension: "uniqueness",
    label: "Rows are unique",
    detail: `${formatCount(stats.duplicateRows)} duplicate rows in ${formatCount(
      stats.duplicateGroups,
    )} group${stats.duplicateGroups === 1 ? "" : "s"}`,
    pass: Math.max(0, rowCount - stats.duplicateRows),
    fail: stats.duplicateRows,
    na: 0,
    column: null,
    filter: stats.duplicateRows > 0 ? "duplicates" : null,
    fixLabel: stats.duplicateRows > 0 ? "Show duplicates" : null,
  });

  const byDimension = new Map<ScoreDimension, ScoreCheck[]>();
  for (const check of checks) {
    const list = byDimension.get(check.dimension);
    if (list === undefined) byDimension.set(check.dimension, [check]);
    else list.push(check);
  }

  const notApplicableNotes: Partial<Record<ScoreDimension, string>> = {
    consistency: "Run a “Compare with…” check or open Reports to score consistency.",
    timeliness: "Pick a freshness rule for a date column to score timeliness.",
    accuracy: "No reference data available (offline).",
  };

  const dimensions: DimensionScore[] = (
    ["completeness", "validity", "uniqueness", "consistency", "timeliness", "accuracy"] as const
  ).map((dimension) => {
    const dimensionChecks = byDimension.get(dimension) ?? [];
    let pass = 0;
    let fail = 0;
    let na = 0;
    for (const check of dimensionChecks) {
      pass += check.pass;
      fail += check.fail;
      na += check.na;
    }
    const applicable = pass + fail;
    return {
      dimension,
      label: DIMENSION_LABELS[dimension].label,
      abbreviation: DIMENSION_LABELS[dimension].abbreviation,
      score: applicable === 0 ? null : (pass / applicable) * 100,
      weight: weights[dimension] ?? 0,
      checks: dimensionChecks,
      note:
        applicable === 0
          ? (notApplicableNotes[dimension] ?? "Not applicable to this dataset.")
          : null,
    };
  });

  let weightSum = 0;
  let weighted = 0;
  for (const dimension of dimensions) {
    if (dimension.score === null || dimension.weight <= 0) continue;
    weightSum += dimension.weight;
    weighted += dimension.weight * dimension.score;
  }
  const overall = weightSum === 0 ? null : weighted / weightSum;
  const band =
    overall === null ? null : overall >= bandGood ? "good" : overall >= bandFair ? "fair" : "poor";

  return { overall, band, dimensions };
}
