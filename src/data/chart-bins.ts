export interface ChartBinOptions {
  min: number;
  max: number;
  binCount: number;
  /** When true, values above `max` are aggregated into one extra bar. */
  overflow: boolean;
}

export interface ChartBins {
  /** Regular bin counts over [min, max]; length = binCount. */
  bins: number[];
  /** Values above max, drawn as a "> max" bar (0 when overflow is off). */
  overflow: number;
  /** Values above max when overflow is off (reported, not drawn). */
  above: number;
  /** Values below min (reported, not drawn). */
  below: number;
  total: number;
}

export interface GroupedBinSeries {
  /** Category code the series belongs to (-1 only for the Other bucket). */
  code: number;
  bins: number[];
  /** Finite values in range for this group. */
  total: number;
}

export interface GroupedBinsResult {
  /** Up to topN groups, ordered by filtered volume (largest first). */
  groups: GroupedBinSeries[];
  /** Remaining groups folded together; null when every group fits. */
  other: GroupedBinSeries | null;
  /** Values above max when overflow is on, summed across groups. */
  overflow: number;
  /** Values above max when overflow is off, summed across groups. */
  above: number;
  /** Values below min, summed across groups. */
  below: number;
  total: number;
}

/**
 * Bins the given rows of a numeric column for the chart tab. Iterates the rows
 * in the current result order only, so chart bins always follow the active
 * filters. Degenerate ranges collapse into a single bin.
 */
export function binValues(
  values: Float64Array,
  ids: Uint32Array,
  options: ChartBinOptions,
): ChartBins {
  const binCount = Math.max(1, Math.min(512, Math.floor(options.binCount) || 1));
  const span = options.max - options.min;
  const bins = new Array<number>(binCount).fill(0);
  let overflow = 0;
  let above = 0;
  let below = 0;
  let total = 0;

  if (span <= 0) {
    for (let i = 0; i < ids.length; i++) {
      const value = values[ids[i]];
      if (!Number.isFinite(value)) continue;
      total++;
      if (value < options.min) below++;
      else bins[0]++;
    }
    return { bins, overflow, above, below, total };
  }

  const scale = binCount / span;
  for (let i = 0; i < ids.length; i++) {
    const value = values[ids[i]];
    if (!Number.isFinite(value)) continue;
    total++;
    if (value < options.min) {
      below++;
    } else if (value > options.max) {
      if (options.overflow) overflow++;
      else above++;
    } else {
      let bin = Math.floor((value - options.min) * scale);
      if (bin >= binCount) bin = binCount - 1;
      bins[bin]++;
    }
  }
  return { bins, overflow, above, below, total };
}

/**
 * Per-group histogram bins for grouped time series: the top N categories by
 * filtered volume get their own series, the rest fold into an Other bucket.
 * Uses the same range and bin count as the ungrouped chart, so the axes line
 * up when the grouping is switched on.
 */
export function groupedBinValues(
  values: Float64Array,
  codes: Uint16Array,
  groupCount: number,
  ids: Uint32Array,
  options: ChartBinOptions,
  topN: number,
): GroupedBinsResult {
  const binCount = Math.max(1, Math.min(512, Math.floor(options.binCount) || 1));
  const span = options.max - options.min;
  const scale = span > 0 ? binCount / span : 0;
  const limit = Math.max(1, Math.floor(topN) || 1);

  // Rank groups by their finite volume over the current result order.
  const totals = new Float64Array(groupCount);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!Number.isFinite(values[id])) continue;
    const code = codes[id];
    if (code < groupCount) totals[code]++;
  }
  const ranked: number[] = [];
  for (let code = 0; code < groupCount; code++) {
    if (totals[code] > 0) ranked.push(code);
  }
  ranked.sort((a, b) => totals[b] - totals[a]);
  const selected = ranked.slice(0, limit);
  const rest = ranked.slice(limit);

  const series: GroupedBinSeries[] = selected.map((code) => ({
    code,
    bins: new Array<number>(binCount).fill(0),
    total: 0,
  }));
  const other = rest.length > 0 ? { code: -1, bins: new Array<number>(binCount).fill(0), total: 0 } : null;
  const slotOf = new Map<number, GroupedBinSeries>();
  selected.forEach((code, index) => slotOf.set(code, series[index]));
  for (const code of rest) slotOf.set(code, other as GroupedBinSeries);

  let overflow = 0;
  let above = 0;
  let below = 0;
  let total = 0;

  const addTo = (group: GroupedBinSeries, bin: number): void => {
    group.bins[bin]++;
    group.total++;
  };

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const value = values[id];
    if (!Number.isFinite(value)) continue;
    total++;
    if (value < options.min) {
      below++;
      continue;
    }
    if (value > options.max) {
      if (options.overflow) overflow++;
      else above++;
      continue;
    }
    const code = codes[id];
    const group = code < groupCount ? slotOf.get(code) : undefined;
    if (group === undefined) continue;
    let bin = scale > 0 ? Math.floor((value - options.min) * scale) : 0;
    if (bin >= binCount) bin = binCount - 1;
    if (bin < 0) bin = 0;
    addTo(group, bin);
  }

  return { groups: series, other, overflow, above, below, total };
}
