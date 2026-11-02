import { timeBucket, timeLabel, type TimeGrain } from "./aggregate.js";
import type { GridMeasure } from "./chart-stats.js";
import { robustRange } from "./dot-size.js";

export interface AnimationFrame {
  time: number;
  label: string;
}

export interface BarAnimation {
  /** Category labels, top N by total plus "Other". */
  labels: string[];
  /** frames × labels counts, row-major per frame. */
  counts: Uint32Array;
}

export interface BubbleAnimation {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  bins: number;
  /**
   * Frames × groups × bins × bins counts (groups collapse to one when the
   * chart is not grouped), row-major per frame and group.
   */
  grids: Uint32Array;
  /** Same layout as `grids` for the per-cell measure (null for counts). */
  values: Float64Array | null;
  valueMax: number;
  /** Group metadata when overlaid bubble sets are drawn. */
  groups: { code: number; label: string }[] | null;
}

export interface HistogramAnimation {
  /** Global value range and bin counts per frame. */
  min: number;
  max: number;
  bins: number;
  counts: Uint32Array;
}

export interface PlaceAnimation {
  /** The places, the same for every frame so a dot stays where it is. */
  x: Float64Array;
  y: Float64Array;
  shown: number;
  /** How many places the rows hold; when above `shown`, the busiest are kept. */
  totalPlaces: number;
  /** A row at each place, to name it from, and the names when a label column was asked for. */
  firstRows: Uint32Array;
  labels?: string[];
  /** frames × places, row-major per frame. A place with no rows in a frame has no dot in it. */
  counts: Uint32Array;
  /** The size and colour values, same layout; size is the row count when no column sizes the dots. */
  size: Float64Array;
  color: Float64Array | null;
  /** One scale across every frame, so a colour or a size means the same thing all the way through. */
  sizeRange: { min: number; max: number } | null;
  colorRange: { min: number; max: number } | null;
}

export interface AnimationResult {
  frames: AnimationFrame[];
  maxCount: number;
  total: number;
  missing: number;
  bar?: BarAnimation;
  bubble?: BubbleAnimation;
  hist?: HistogramAnimation;
  places?: PlaceAnimation;
}

export type FrameAgg = "sum" | "mean" | "min" | "max";

/** The frame × place matrix of one measure, in a single pass over the rows that count. */
class PlaceMeasure {
  private readonly sum: Float64Array;
  private readonly seen: Uint32Array;
  private readonly lo: Float64Array;
  private readonly hi: Float64Array;

  constructor(private readonly values: Float64Array, private readonly agg: FrameAgg, cells: number) {
    this.sum = new Float64Array(cells);
    this.seen = new Uint32Array(cells);
    this.lo = new Float64Array(cells).fill(Number.POSITIVE_INFINITY);
    this.hi = new Float64Array(cells).fill(Number.NEGATIVE_INFINITY);
  }

  add(cell: number, row: number): void {
    const value = this.values[row]!;
    if (!Number.isFinite(value)) return;
    this.sum[cell]! += value;
    this.seen[cell]!++;
    if (value < this.lo[cell]!) this.lo[cell] = value;
    if (value > this.hi[cell]!) this.hi[cell] = value;
  }

  finish(): Float64Array {
    const out = new Float64Array(this.sum.length);
    for (let cell = 0; cell < out.length; cell++) {
      const seen = this.seen[cell]!;
      out[cell] = seen === 0 ? Number.NaN
        : this.agg === "sum" ? this.sum[cell]!
          : this.agg === "mean" ? this.sum[cell]! / seen
            : this.agg === "min" ? this.lo[cell]! : this.hi[cell]!;
    }
    return out;
  }
}

/** frames × places is held in memory several times over, so it has a ceiling: beyond it the busiest places are kept. */
const MAX_PLACE_CELLS = 2_000_000;

/**
 * Per-time-bucket values at each place, for the map: places as `groupPlaces` finds them (to about a metre), with a
 * size and a colour measure for every frame, and one scale for each across all frames.
 */
export function computePlaceFrames(
  times: Float64Array,
  x: Float64Array,
  y: Float64Array,
  ids: Uint32Array,
  grain: TimeGrain,
  limit: number,
  size?: GridMeasure,
  color?: { values: Float64Array; agg: FrameAgg },
): AnimationResult {
  const { frames, index, missing } = frameTimes(times, ids, grain);
  const places = new Map<number, number>();
  const px: number[] = [];
  const py: number[] = [];
  const rows: number[] = [];
  const first: number[] = [];
  const placeOf = new Int32Array(ids.length).fill(-1);
  let total = 0;
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position]!;
    const xv = x[row]!;
    const yv = y[row]!;
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(times[row]!)) continue;
    const kx = Math.round(xv * 1e5);
    const ky = Math.round(yv * 1e5);
    if (Math.abs(kx) > 2e7 || Math.abs(ky) > 1e7) continue;
    const key = (kx + 2e7) * 4e7 + (ky + 1e7);
    let at = places.get(key);
    if (at === undefined) {
      at = px.length;
      places.set(key, at);
      px.push(xv);
      py.push(yv);
      rows.push(0);
      first.push(row);
    }
    rows[at]!++;
    placeOf[position] = at;
    total++;
  }
  const frameCount = Math.max(1, frames.length);
  const keep = Math.max(1, Math.min(limit, Math.floor(MAX_PLACE_CELLS / frameCount)));
  let order = px.map((_, place) => place);
  if (order.length > keep) order = order.sort((a, b) => rows[b]! - rows[a]!).slice(0, keep);
  const slot = new Int32Array(px.length).fill(-1);
  order.forEach((place, position) => {
    slot[place] = position;
  });
  const shown = order.length;
  const cells = frames.length * shown;
  const counts = new Uint32Array(cells);
  const sizeMeasure = size === undefined ? null : new PlaceMeasure(size.values, size.agg, cells);
  const colorMeasure = color === undefined ? null : new PlaceMeasure(color.values, color.agg, cells);
  for (let position = 0; position < ids.length; position++) {
    const place = placeOf[position]!;
    if (place < 0) continue;
    const at = slot[place]!;
    if (at < 0) continue;
    const row = ids[position]!;
    const cell = index.get(timeBucket(times[row]!, grain))! * shown + at;
    counts[cell]!++;
    sizeMeasure?.add(cell, row);
    colorMeasure?.add(cell, row);
  }
  const sizes = sizeMeasure?.finish() ?? Float64Array.from(counts, (count) => (count === 0 ? Number.NaN : count));
  const colors = colorMeasure?.finish() ?? null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const value of sizes) {
    if (!Number.isFinite(value)) continue;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  let maxCount = 0;
  for (const count of counts) if (count > maxCount) maxCount = count;
  return {
    frames,
    maxCount,
    total,
    missing,
    places: {
      x: Float64Array.from(order, (place) => px[place]!),
      y: Float64Array.from(order, (place) => py[place]!),
      shown,
      totalPlaces: px.length,
      firstRows: Uint32Array.from(order, (place) => first[place]!),
      counts,
      size: sizes,
      color: colors,
      sizeRange: lo === Number.POSITIVE_INFINITY ? null : { min: lo, max: hi },
      colorRange: colors === null ? null : robustRange(colors, colors.length),
    },
  };
}

function frameTimes(
  times: Float64Array,
  ids: Uint32Array,
  grain: TimeGrain,
): { frames: AnimationFrame[]; index: Map<number, number>; missing: number } {
  const seen = new Map<number, number>();
  let missing = 0;
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    const value = times[row];
    if (!Number.isFinite(value)) {
      missing++;
      continue;
    }
    const bucket = timeBucket(value, grain);
    if (!seen.has(bucket)) seen.set(bucket, 0);
  }
  const sorted = [...seen.keys()].sort((a, b) => a - b);
  const index = new Map<number, number>();
  const frames = sorted.map((time, frameIndex) => {
    index.set(time, frameIndex);
    return { time, label: timeLabel(time, grain) };
  });
  return { frames, index, missing };
}

/**
 * Per-time-bucket category counts for an animated bar chart. Categories are
 * ranked across the whole filtered set, so frames share stable colours.
 */
export function computeBarFrames(
  times: Float64Array,
  codes: Uint16Array,
  labels: readonly string[],
  ids: Uint32Array,
  grain: TimeGrain,
  topN: number,
): AnimationResult {
  const { frames, index, missing } = frameTimes(times, ids, grain);
  const totals = new Uint32Array(labels.length);
  for (let position = 0; position < ids.length; position++) {
    const code = codes[ids[position]];
    if (code < totals.length) totals[code]++;
  }
  const order: number[] = [];
  for (let code = 0; code < totals.length; code++) if (totals[code] > 0) order.push(code);
  order.sort((a, b) => totals[b] - totals[a]);
  const limit = Math.max(1, Math.floor(topN) || 8);
  const selected = order.slice(0, limit);
  const outLabels = selected.map((code) => labels[code] ?? "(empty)");
  const hasOther = order.length > selected.length;
  if (hasOther) outLabels.push("Other");
  const outIndex = new Map<number, number>();
  selected.forEach((code, i) => outIndex.set(code, i));
  if (hasOther) for (const code of order.slice(limit)) outIndex.set(code, selected.length);

  const width = Math.max(1, outLabels.length);
  const counts = new Uint32Array(Math.max(1, frames.length) * width);
  let maxCount = 0;
  let total = 0;
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    const time = times[row];
    if (!Number.isFinite(time)) continue;
    const frame = index.get(timeBucket(time, grain));
    const code = codes[row];
    const slot = outIndex.get(code);
    if (frame === undefined || slot === undefined) continue;
    const cell = ++counts[frame * width + slot];
    if (cell > maxCount) maxCount = cell;
    total++;
  }
  return { frames, maxCount, total, missing, bar: { labels: outLabels, counts } };
}

/** Per-time-bucket bin counts for an animated histogram. */
export function computeHistogramFrames(
  times: Float64Array,
  values: Float64Array,
  ids: Uint32Array,
  grain: TimeGrain,
  binCount: number,
): AnimationResult {
  const { frames, index, missing } = frameTimes(times, ids, grain);
  const bins = Math.max(4, Math.min(256, Math.floor(binCount) || 32));
  let min = Infinity;
  let max = -Infinity;
  let total = 0;
  let skips = missing;
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    const time = times[row];
    const value = values[row];
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      if (Number.isFinite(time)) skips++;
      continue;
    }
    total++;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const counts = new Uint32Array(Math.max(1, frames.length) * bins);
  if (total === 0) {
    return { frames, maxCount: 0, total, missing: skips, hist: { min: 0, max: 0, bins, counts } };
  }
  const span = max > min ? max - min : 1;
  let maxCount = 0;
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    const time = times[row];
    const value = values[row];
    if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
    const frame = index.get(timeBucket(time, grain));
    if (frame === undefined) continue;
    const bin = Math.min(bins - 1, Math.floor(((value - min) / span) * bins));
    const cell = ++counts[frame * bins + bin];
    if (cell > maxCount) maxCount = cell;
  }
  return { frames, maxCount, total, missing: skips, hist: { min, max, bins, counts } };
}

/** Per-time-bucket 2D grids for an animated bubble chart. */
export function computeBubbleFrames(
  times: Float64Array,
  xValues: Float64Array,
  yValues: Float64Array,
  ids: Uint32Array,
  grain: TimeGrain,
  bins: number,
  measure?: GridMeasure,
  groups?: { codes: Uint16Array; labels: string[] },
): AnimationResult {
  const { frames, index, missing } = frameTimes(times, ids, grain);
  const size = Math.max(4, Math.min(120, Math.floor(bins) || 40));
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let total = 0;
  let skips = missing;
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    const x = xValues[row];
    const y = yValues[row];
    const time = times[row];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(time)) {
      if (Number.isFinite(time)) skips++;
      continue;
    }
    total++;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const cellCount = size * size;
  const groupCount = groups === undefined ? 1 : Math.max(1, groups.labels.length);
  const grids = new Uint32Array(Math.max(1, frames.length) * groupCount * cellCount);
  const values = measure === undefined ? null : new Float64Array(grids.length).fill(Number.NaN);
  const sums = measure === undefined ? null : new Float64Array(grids.length);
  if (total > 0) {
    const xSpan = xMax > xMin ? xMax - xMin : 1;
    const ySpan = yMax > yMin ? yMax - yMin : 1;
    for (let position = 0; position < ids.length; position++) {
      const row = ids[position];
      const x = xValues[row];
      const y = yValues[row];
      const time = times[row];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(time)) continue;
      const frame = index.get(timeBucket(time, grain));
      if (frame === undefined) continue;
      const group = groups === undefined ? 0 : Math.min(groupCount - 1, groups.codes[row] ?? 0);
      const bx = Math.min(size - 1, Math.floor(((x - xMin) / xSpan) * size));
      const by = Math.min(size - 1, Math.floor(((y - yMin) / ySpan) * size));
      const cell = (frame * groupCount + group) * cellCount + by * size + bx;
      grids[cell]++;
      if (measure === undefined || values === null || sums === null) continue;
      const value = measure.values[row];
      if (!Number.isFinite(value)) continue;
      sums[cell] += value;
      if (Number.isNaN(values[cell])) values[cell] = value;
      else if (measure.agg === "min") values[cell] = Math.min(values[cell], value);
      else if (measure.agg === "max") values[cell] = Math.max(values[cell], value);
    }
  }
  let maxCount = 0;
  for (const value of grids) if (value > maxCount) maxCount = value;
  let valueMax = 0;
  if (measure !== undefined && values !== null && sums !== null) {
    for (let cell = 0; cell < values.length; cell++) {
      const count = grids[cell] ?? 0;
      if (count === 0) {
        values[cell] = Number.NaN;
        continue;
      }
      if (measure.agg === "sum") values[cell] = sums[cell] ?? 0;
      else if (measure.agg === "mean") values[cell] = (sums[cell] ?? 0) / count;
      if (Number.isFinite(values[cell]) && values[cell] > valueMax) valueMax = values[cell];
    }
  }
  return {
    frames,
    maxCount,
    total,
    missing: skips,
    bubble: {
      xMin,
      xMax,
      yMin,
      yMax,
      bins: size,
      grids,
      values,
      valueMax,
      groups:
        groups === undefined
          ? null
          : groups.labels.map((label, code) => ({ code, label })),
    },
  };
}
