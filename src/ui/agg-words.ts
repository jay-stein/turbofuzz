/**
 * The words for an aggregate, the same on the Pivot page, in the chart builder and in every chart
 * setting. "Average (mean)" says it in both voices: the plain one and the one a statistics
 * textbook uses.
 */
const LABELS: Record<string, string> = {
  sum: "Sum",
  mean: "Average (mean)",
  median: "Median",
  min: "Min",
  max: "Max",
  count: "Count of values",
  distinct: "Distinct values",
  stddev: "Std deviation",
  variance: "Variance",
  first: "First (by row order)",
  last: "Last (by row order)",
  mode: "Mode",
  rows: "Rows",
  p25: "25th percentile",
  p75: "75th percentile",
  p90: "90th percentile",
  p95: "95th percentile",
};

/** A short form for a chip or a sentence: the plain word without the aside. */
const SHORT: Record<string, string> = { mean: "Average" };

/** The label for a menu or a select. */
export function aggLabel(agg: string): string {
  const known = LABELS[agg];
  if (known !== undefined) return known;
  const percentile = /^p(\d{1,2})$/.exec(agg);
  return percentile === null ? agg : `${percentile[1]}th percentile`;
}

/** The label where room is short. */
export function aggShort(agg: string): string {
  return SHORT[agg] ?? aggLabel(agg);
}
