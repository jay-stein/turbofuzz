import type { BitSet } from "../search/bitset.js";

export type SeriesMode = "auto" | "points" | "density";

export interface SeriesOptions {
  mode: SeriesMode;
  /** Maximum points in a scatter payload before auto-switching to density. */
  limit: number;
  gridCols: number;
  gridRows: number;
  /** Stride used to collect the quantile sample (tests shrink this). */
  sampleStride?: number;
  sampleMax?: number;
}

export interface SeriesPoints {
  mode: "points";
  x: Float64Array;
  y: Float64Array;
  colorValues: Float64Array | null;
  colorCodes: Uint16Array | null;
  size: Float64Array | null;
  shown: number;
  total: number;
  outside: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  sampled: boolean;
}

export interface SeriesGrid {
  mode: "density";
  counts: Uint32Array;
  cols: number;
  rows: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  total: number;
  outside: number;
  max: number;
}

export type SeriesResult = SeriesPoints | SeriesGrid;

const DEFAULT_SAMPLE_STRIDE = 64;
const DEFAULT_SAMPLE_MAX = 50_000;
const MIN_QUANTILE_SAMPLE = 100;

/** Row index -> category code, built from the column's bitsets. */
export function categoryCodes(bits: readonly BitSet[], rowCount: number): Uint16Array {
  const codes = new Uint16Array(rowCount).fill(0xffff);
  bits.forEach((set, index) => {
    set.forEachRow((row) => {
      codes[row] = index;
    });
  });
  return codes;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function padded(min: number, max: number): [number, number] {
  if (max > min) return [min, max];
  const pad = Math.max(1, Math.abs(min) * 0.05);
  return [min - pad, max + pad];
}

/**
 * Samples pair rows of two numeric columns for a scatter (<= limit points) or
 * builds an exact 2D histogram for density when the filtered set is larger.
 * Axes are clipped to p1-p99 when a representative sample is available, so a
 * few extreme values cannot flatten the view.
 */
export function computeSeries(
  x: Float64Array,
  y: Float64Array,
  ids: Uint32Array,
  colorValues: Float64Array | null,
  colorCodes: Uint16Array | null,
  size: Float64Array | null,
  options: SeriesOptions,
): SeriesResult {
  const limit = Math.max(1, Math.floor(options.limit) || 20_000);
  const stride = Math.max(1, Math.floor(options.sampleStride ?? DEFAULT_SAMPLE_STRIDE));
  const sampleMax = Math.max(MIN_QUANTILE_SAMPLE, Math.floor(options.sampleMax ?? DEFAULT_SAMPLE_MAX));
  const cols = Math.max(8, Math.min(256, Math.floor(options.gridCols) || 128));
  const rows = Math.max(8, Math.min(256, Math.floor(options.gridRows) || 72));

  const sampleX: number[] = [];
  const sampleY: number[] = [];
  let total = 0;
  let dataXMin = Infinity;
  let dataXMax = -Infinity;
  let dataYMin = Infinity;
  let dataYMax = -Infinity;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const xv = x[id];
    const yv = y[id];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    total++;
    if (xv < dataXMin) dataXMin = xv;
    if (xv > dataXMax) dataXMax = xv;
    if (yv < dataYMin) dataYMin = yv;
    if (yv > dataYMax) dataYMax = yv;
    if (i % stride === 0 && sampleX.length < sampleMax) {
      sampleX.push(xv);
      sampleY.push(yv);
    }
  }

  if (total === 0) {
    return {
      mode: "points",
      x: new Float64Array(0),
      y: new Float64Array(0),
      colorValues: null,
      colorCodes: null,
      size: null,
      shown: 0,
      total: 0,
      outside: 0,
      xMin: 0,
      xMax: 1,
      yMin: 0,
      yMax: 1,
      sampled: false,
    };
  }

  let xMin = dataXMin;
  let xMax = dataXMax;
  let yMin = dataYMin;
  let yMax = dataYMax;
  if (sampleX.length >= MIN_QUANTILE_SAMPLE) {
    const sortedX = sampleX.slice().sort((a, b) => a - b);
    const sortedY = sampleY.slice().sort((a, b) => a - b);
    xMin = quantile(sortedX, 0.01);
    xMax = quantile(sortedX, 0.99);
    yMin = quantile(sortedY, 0.01);
    yMax = quantile(sortedY, 0.99);
  }
  [xMin, xMax] = padded(xMin, xMax);
  [yMin, yMax] = padded(yMin, yMax);

  const density = options.mode === "density" || (options.mode === "auto" && total > limit);
  if (density) {
    const counts = new Uint32Array(cols * rows);
    const xScale = cols / (xMax - xMin);
    const yScale = rows / (yMax - yMin);
    let outside = 0;
    let max = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const xv = x[id];
      const yv = y[id];
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      if (xv < xMin || xv > xMax || yv < yMin || yv > yMax) {
        outside++;
        continue;
      }
      let cx = Math.floor((xv - xMin) * xScale);
      let cy = Math.floor((yv - yMin) * yScale);
      if (cx >= cols) cx = cols - 1;
      if (cy >= rows) cy = rows - 1;
      const count = ++counts[cy * cols + cx];
      if (count > max) max = count;
    }
    return {
      mode: "density",
      counts,
      cols,
      rows,
      xMin,
      xMax,
      yMin,
      yMax,
      total,
      outside,
      max,
    };
  }

  const thin = total > limit;
  const step = thin ? Math.ceil(total / limit) : 1;
  const cap = Math.min(total, limit);
  const px = new Float64Array(cap);
  const py = new Float64Array(cap);
  const pColor = colorValues !== null ? new Float64Array(cap) : null;
  const pCodes = colorCodes !== null ? new Uint16Array(cap) : null;
  const pSize = size !== null ? new Float64Array(cap) : null;
  let shown = 0;
  let outside = 0;
  let seen = 0;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const xv = x[id];
    const yv = y[id];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    if (xv < xMin || xv > xMax || yv < yMin || yv > yMax) {
      outside++;
      continue;
    }
    if (thin && seen++ % step !== 0) continue;
    if (shown >= cap) continue;
    px[shown] = xv;
    py[shown] = yv;
    if (pColor !== null) pColor[shown] = colorValues?.[id] ?? Number.NaN;
    if (pCodes !== null) pCodes[shown] = colorCodes?.[id] ?? 0xffff;
    if (pSize !== null) pSize[shown] = size?.[id] ?? Number.NaN;
    shown++;
  }

  return {
    mode: "points",
    x: px.subarray(0, shown),
    y: py.subarray(0, shown),
    colorValues: pColor === null ? null : pColor.subarray(0, shown),
    colorCodes: pCodes === null ? null : pCodes.subarray(0, shown),
    size: pSize === null ? null : pSize.subarray(0, shown),
    shown,
    total,
    outside,
    xMin,
    xMax,
    yMin,
    yMax,
    sampled: thin,
  };
}
