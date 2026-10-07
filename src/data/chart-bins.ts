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
