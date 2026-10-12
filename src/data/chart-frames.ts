import { timeBucket, timeLabel, type TimeGrain } from "./aggregate.js";

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
  /** frames × bins × bins counts, row-major per frame. */
  grids: Uint32Array;
}

export interface AnimationResult {
  frames: AnimationFrame[];
  maxCount: number;
  total: number;
  missing: number;
  bar?: BarAnimation;
  bubble?: BubbleAnimation;
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

/** Per-time-bucket 2D grids for an animated bubble chart. */
export function computeBubbleFrames(
  times: Float64Array,
  xValues: Float64Array,
  yValues: Float64Array,
  ids: Uint32Array,
  grain: TimeGrain,
  bins: number,
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
  const grids = new Uint32Array(Math.max(1, frames.length) * cellCount);
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
      const bx = Math.min(size - 1, Math.floor(((x - xMin) / xSpan) * size));
      const by = Math.min(size - 1, Math.floor(((y - yMin) / ySpan) * size));
      grids[frame * cellCount + by * size + bx]++;
    }
  }
  let maxCount = 0;
  for (const value of grids) if (value > maxCount) maxCount = value;
  return {
    frames,
    maxCount,
    total,
    missing: skips,
    bubble: { xMin, xMax, yMin, yMax, bins: size, grids },
  };
}
