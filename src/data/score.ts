import type { ColumnMeta } from "../worker/protocol.js";
import type { DatasetStats } from "./stats.js";
import { TYPE_LABELS, type ColumnType } from "../types.js";
import { OPTIONAL_COMPLETENESS_FACTOR, effectiveOptional } from "./optional-columns.js";

export type ScoreDimension =
  | "completeness"
  | "validity"
  | "uniqueness"
  | "consistency"
  | "timeliness"
  | "accuracy";

/** A check the failing rows of which the drawer can filter to. */
export type ScoreCheckFilter =
  | "nulls"
  | "pattern"
  | "duplicates"
  | "valueAnomalies"
  | "keyDuplicates"
  | "pairCheck"
  | "merge";

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
  /** When set, the fix converts the column to this type instead of filtering. */
  convertTo?: ColumnType;
  /**
   * Why a conversion is not offered (too many values would be lost). Such a check
   * claims no points and ranks after fixable ones.
   */
  fixBlocked?: string;
  /** The column is optional: its emptiness counts for less and never caps the band. */
  optional?: boolean;
  /** Proposed from column names; the user can turn it off. */
  suggested?: boolean;
}

/** A conversion that would blank more than this share of values is not offered. */
export const CONVERT_MAX_LOSS_SHARE = 0.1;

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
  /** Columns with no values at all. Not scored: one "drop these" item beats a 100% failure. */
  emptyColumns: { column: number; name: string }[];
  /** Columns treated as optional (detected or marked), by position. */
  optionalColumns: number[];
  /** Why the band is lower than the number alone suggests; null when it is not capped. */
  bandCap: BandCap | null;
}

/** The band a column problem holds the dataset to, with a plain-English reason. */
export interface BandCap {
  band: "fair" | "poor";
  column: number;
  reason: string;
}

/** Band-cap thresholds (decision D7): share of a column that is empty or invalid. */
export const BAND_CAP = {
  fairEmpty: 0.5,
  poorEmpty: 0.75,
  fairInvalid: 0.2,
  poorInvalid: 0.5,
} as const;

export interface DQScoreConfig {
  weights?: Partial<Record<ScoreDimension, number>>;
  bandGood?: number;
  bandFair?: number;
  /** Per column name: true marks it optional, false marks it required. */
  optional?: Record<string, boolean>;
  /** false keeps the plain number-only band (the pre-cap behaviour). */
  capBand?: boolean;
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
  userChecks: readonly ScoreCheck[] = [],
): DQScore {
  const weights = { ...DEFAULT_DQ_CONFIG.weights, ...(config.weights ?? {}) };
  const bandGood = config.bandGood ?? DEFAULT_DQ_CONFIG.bandGood;
  const bandFair = config.bandFair ?? DEFAULT_DQ_CONFIG.bandFair;

  const checks: ScoreCheck[] = [];
  const contentColumns = columns
    .map((meta, column) => ({ meta, column }))
    .filter(({ meta }) => meta.role !== "provenance");
  // A column with nothing in it (Excel padding, unused fields) says nothing about
  // data quality; it is reported once instead of failing every check.
  const isEmpty = ({ meta }: { meta: ColumnMeta }): boolean =>
    rowCount > 0 && meta.stats.nulls >= rowCount;
  const emptyColumns = contentColumns
    .filter(isEmpty)
    .map(({ meta, column }) => ({ column, name: meta.name }));
  const scoredColumns = contentColumns.filter((entry) => !isEmpty(entry));
  const optionalSet = effectiveOptional(columns, rowCount, config.optional ?? {});

  // Completeness: every column's cells must be populated.
  scoredColumns.forEach(({ meta, column }) => {
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
      ...(optionalSet.has(column) ? { optional: true } : {}),
    });
  });

  // Validity: cells that conform to the column's intended type and any
  // dominant format. Each bad cell is counted once per column: the exact
  // non-conforming count (one pass over all rows) replaces the sampled
  // type-conflict count, and "stored as Text" is evidence on the same check
  // rather than a second failing check over the same cells.
  scoredColumns.forEach(({ meta, column }) => {
    const reasons: string[] = [];
    const conformance = meta.conformance ?? null;
    let nonConforming = 0;
    let convertTo: ColumnType | undefined;
    let fixBlocked: string | undefined;
    if (conformance !== null) {
      nonConforming = conformance.nonConforming;
      const intendedLabel = TYPE_LABELS[conformance.intended];
      if (nonConforming > 0) {
        reasons.push(`${formatCount(nonConforming)} don't parse as ${intendedLabel}`);
      }
      if (meta.type !== conformance.intended) {
        reasons.push(`stored as ${TYPE_LABELS[meta.type]}, but ${intendedLabel} fits`);
        convertTo = conformance.intended;
      }
    }
    let mixed = 0;
    for (const suggestion of meta.suggestions) {
      if (suggestion.kind === "typeConflict" && conformance === null) {
        nonConforming += suggestion.count;
        reasons.push(`${formatCount(suggestion.count)} don't parse as ${suggestion.columnType}`);
      } else if (suggestion.kind === "mixedNumber") {
        mixed += suggestion.count;
        reasons.push(`${formatCount(suggestion.count)} mix decimal conventions`);
      }
      // Formula-like cells are an export-safety matter, not a validity failure.
    }
    const patternOff = meta.pattern?.offCount ?? 0;
    if (patternOff > 0) {
      reasons.push(
        `${formatCount(patternOff)} don't match ${meta.pattern?.mask ?? "the dominant format"}`,
      );
    }
    const nonNull = Math.max(0, rowCount - meta.stats.nulls);
    if (convertTo !== undefined && nonNull > 0 && nonConforming / nonNull > CONVERT_MAX_LOSS_SHARE) {
      fixBlocked = `Converting would blank ${formatCount(nonConforming)} of ${formatCount(nonNull)} values (${Math.round((nonConforming / nonNull) * 100)}%), so it is not offered. Review the non-conforming values or keep the column as text.`;
      convertTo = undefined;
    }
    // Off-format and non-conforming cells overlap; take the larger, then add the
    // disjoint mixed-decimal cells.
    const fail = Math.min(Math.max(nonConforming, patternOff) + mixed, nonNull);
    checks.push({
      id: `validity.${column}`,
      dimension: "validity",
      label: `“${meta.name}” parses cleanly`,
      detail:
        reasons.length > 0
          ? reasons.join(" · ") + (fixBlocked !== undefined ? ` · ${fixBlocked}` : "")
          : "every value matches its type and format",
      pass: Math.max(0, nonNull - fail),
      fail,
      na: meta.stats.nulls,
      column,
      filter: patternOff > 0 ? "pattern" : null,
      fixLabel:
        convertTo !== undefined && fail > 0
          ? `Convert to ${TYPE_LABELS[convertTo]}`
          : patternOff > 0
            ? "Show off-format"
            : null,
      ...(convertTo !== undefined && fail > 0 ? { convertTo } : {}),
      ...(fixBlocked !== undefined ? { fixBlocked } : {}),
    });

    // Dates written several ways in one column all parse, but the column is not
    // consistent: rows outside the most common format fail this check.
    const formats = meta.dateFormats ?? null;
    if (formats !== null && formats.minority > 0) {
      const lead = formats.formats[0];
      checks.push({
        id: `validity.dateformat.${column}`,
        dimension: "validity",
        label: `“${meta.name}” uses one date format`,
        detail: `${formatCount(formats.minority)} of ${formatCount(formats.total)} dates are not ${lead?.label ?? "the main format"} · ${formats.formats
          .slice(0, 3)
          .map((f) => `${f.label} ×${formatCount(f.count)}`)
          .join(", ")}${formats.ambiguous ? " · day and month order cannot be told apart" : ""}`,
        pass: formats.total - formats.minority,
        fail: formats.minority,
        na: meta.stats.nulls,
        column,
        filter: null,
        fixLabel: formats.ambiguous ? null : "Standardise to yyyy-mm-dd",
      });
    }

    // Values outside the range the column name implies (an age of 240, 130%).
    const range = meta.rangeViolation ?? null;
    if (range !== null && range.count > 0) {
      checks.push({
        id: `validity.range.${column}`,
        dimension: "validity",
        label: `“${meta.name}” stays in a plausible range`,
        detail: `${range.sentence} · ${formatCount(range.count)} of ${formatCount(range.checked)} values are outside it (e.g. ${range.examples.join(", ")})`,
        pass: range.checked - range.count,
        fail: range.count,
        na: meta.stats.nulls,
        column,
        filter: null,
        fixLabel: "Review values",
      });
    }

    // Currency symbols or thousands separators on only some of the numbers.
    const symbols = meta.numberSymbols ?? null;
    if (symbols !== null && symbols.minority > 0) {
      checks.push({
        id: `validity.symbols.${column}`,
        dimension: "validity",
        label: `“${meta.name}” writes numbers one way`,
        detail: `${formatCount(symbols.withSymbol)} have a currency symbol or thousands separator (e.g. “${symbols.example}”), ${formatCount(symbols.plain)} do not`,
        pass: symbols.total - symbols.minority,
        fail: symbols.minority,
        na: meta.stats.nulls,
        column,
        filter: null,
        fixLabel: "Strip symbols",
      });
    }

    // Type downgrade without a measured conformance (e.g. a boolean near-miss):
    // keep the sampled advisory check.
    const downgrade = meta.typeDowngrade ?? null;
    if (meta.type === "string" && downgrade !== null && conformance === null) {
      const share = Math.min(1, Math.max(0, downgrade.share));
      const passValues = Math.round(share * nonNull);
      const candidateLabel = TYPE_LABELS[downgrade.candidate];
      const blocked = 1 - share > CONVERT_MAX_LOSS_SHARE;
      const blockers =
        downgrade.examples.length > 0
          ? downgrade.examples
              .slice(0, 3)
              .map((value) => `“${value}”`)
              .join(", ")
          : "a minority of values";
      checks.push({
        id: `validity.downgrade.${column}`,
        dimension: "validity",
        label: `“${meta.name}” is stored as Text — ${Math.round(share * 100)}% of values look like ${candidateLabel}`,
        detail: `${formatCount(passValues)} of ${formatCount(nonNull)} values fit ${candidateLabel} · blocked by ${blockers} · sampled`,
        pass: passValues,
        fail: Math.max(0, nonNull - passValues),
        na: meta.stats.nulls,
        column,
        filter: null,
        fixLabel: blocked ? null : `Convert to ${candidateLabel}`,
        ...(blocked
          ? {
              fixBlocked: `Only ${Math.round(share * 100)}% of values fit ${candidateLabel}, so converting would blank too many. Keep it as text.`,
            }
          : { convertTo: downgrade.candidate }),
      });
    }
  });

  // Consistency: one spelling per value. Case, spacing and accent variants are
  // deterministic, so rows in a minority spelling fail; fuzzy matches stay advisory.
  scoredColumns.forEach(({ meta, column }) => {
    const variants = meta.variants ?? null;
    if (variants === null || variants.minorityRows === 0) return;
    const nonNull = Math.max(0, rowCount - meta.stats.nulls);
    const fail = Math.min(variants.minorityRows, nonNull);
    const first = variants.examples[0]?.spellings.slice(0, 3).map((s) => `“${s.value}”`).join(", ");
    checks.push({
      id: `consistency.variants.${column}`,
      dimension: "consistency",
      label: `“${meta.name}” uses one spelling per value`,
      detail: `${formatCount(variants.groups)} value${variants.groups === 1 ? " is" : "s are"} spelled more than one way (${first ?? ""}) · ${formatCount(fail)} rows in a minority spelling`,
      pass: Math.max(0, nonNull - fail),
      fail,
      na: meta.stats.nulls,
      column,
      filter: "merge",
      fixLabel: "Merge spellings",
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
  // User-run checks (pair comparisons, key duplicates, freshness rules) score
  // Consistency/Timeliness/Uniqueness once they exist.
  for (const check of userChecks) {
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
      // An optional column's blanks count for a fraction; the cells still show.
      const factor = check.optional === true ? OPTIONAL_COMPLETENESS_FACTOR : 1;
      pass += check.pass;
      fail += check.fail * factor;
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
  const numberBand: DQScore["band"] =
    overall === null ? null : overall >= bandGood ? "good" : overall >= bandFair ? "fair" : "poor";
  const bandCap =
    config.capBand === false
      ? null
      : findBandCap(scoredColumns, optionalSet, rowCount, byDimension.get("validity") ?? []);
  const rank = { good: 2, fair: 1, poor: 0 } as const;
  const band =
    numberBand !== null && bandCap !== null && rank[bandCap.band] < rank[numberBand]
      ? bandCap.band
      : numberBand;

  return {
    overall,
    band,
    dimensions,
    emptyColumns,
    optionalColumns: [...optionalSet].sort((a, b) => a - b),
    bandCap: band !== numberBand ? bandCap : null,
  };
}

export interface ColumnScore {
  /** 0-100, or null when none of the column's checks apply. */
  score: number | null;
  /** The dimensions that went into it, with the weight each carried. */
  parts: { dimension: ScoreDimension; label: string; rate: number; weight: number }[];
}

/**
 * One column's score, by the same formula as the dataset score restricted to that
 * column's checks: a pass rate per dimension (optional blanks at their reduced
 * weight), averaged with the dimension weights over the dimensions that apply.
 * For a one-column dataset it equals the dataset score.
 */
export function columnScore(score: DQScore, column: number): ColumnScore {
  const parts: ColumnScore["parts"] = [];
  let weightSum = 0;
  let weighted = 0;
  for (const dimension of score.dimensions) {
    if (dimension.weight <= 0) continue;
    let pass = 0;
    let fail = 0;
    for (const check of dimension.checks) {
      if (check.column !== column) continue;
      pass += check.pass;
      fail += check.fail * (check.optional === true ? OPTIONAL_COMPLETENESS_FACTOR : 1);
    }
    if (pass + fail === 0) continue;
    const rate = (pass / (pass + fail)) * 100;
    parts.push({ dimension: dimension.dimension, label: dimension.label, rate, weight: dimension.weight });
    weightSum += dimension.weight;
    weighted += dimension.weight * rate;
  }
  return { score: weightSum === 0 ? null : weighted / weightSum, parts };
}

/**
 * The worst single-column problem that holds the band down (decision D7): a
 * required column more than half empty, or any column with more than a fifth of
 * its populated values failing a deterministic check, caps the band at fair;
 * three-quarters empty or half invalid caps it at poor. A good average can hide
 * a column that is mostly unusable, and the band should not.
 */
function findBandCap(
  scored: readonly { meta: ColumnMeta; column: number }[],
  optional: ReadonlySet<number>,
  rowCount: number,
  validity: readonly ScoreCheck[],
): BandCap | null {
  let worst: BandCap | null = null;
  const consider = (candidate: BandCap): void => {
    if (worst === null || (candidate.band === "poor" && worst.band === "fair")) worst = candidate;
  };
  for (const { meta, column } of scored) {
    if (optional.has(column) || rowCount === 0) continue;
    const empty = meta.stats.nulls / rowCount;
    if (empty > BAND_CAP.fairEmpty) {
      consider({
        band: empty > BAND_CAP.poorEmpty ? "poor" : "fair",
        column,
        reason: `“${meta.name}” is ${Math.round(empty * 100)}% empty`,
      });
    }
  }
  for (const check of validity) {
    // Only values that fail outright cap the band; a column written two ways still parses.
    if (check.column === null || !/^validity\.\d+$/.test(check.id)) continue;
    const populated = check.pass + check.fail;
    if (populated === 0) continue;
    const invalid = check.fail / populated;
    if (invalid > BAND_CAP.fairInvalid) {
      const name = scored.find((entry) => entry.column === check.column)?.meta.name ?? "A column";
      consider({
        band: invalid > BAND_CAP.poorInvalid ? "poor" : "fair",
        column: check.column,
        reason: `“${name}” has ${Math.round(invalid * 100)}% invalid values`,
      });
    }
  }
  return worst;
}
