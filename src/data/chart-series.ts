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
  /** false keeps the full data range (maps); default clips to p1–p99. */
  clip?: boolean;
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
  /** One dot per distinct place: `size` holds each place's value and `counts` the rows behind it. */
  places?: boolean;
  counts?: Float64Array | null;
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

export type PlaceAgg = "count" | "sum" | "mean" | "min" | "max";

/**
 * Groups rows that sit at the same place (to about a metre: five decimals of a degree) into one point each. The place's value is its
 * row count, or an aggregate of the size column when there is one; its position is the first row's. When there are more places than
 * `limit`, the busiest are kept and the result says it was sampled. The extent is the data's own (no clipping), as maps need.
 */
export function groupPlaces(
  x: Float64Array,
  y: Float64Array,
  ids: Uint32Array,
  size: Float64Array | null,
  agg: PlaceAgg,
  limit: number,
): SeriesPoints {
  const index = new Map<number, number>();
  const px: number[] = [], py: number[] = [], rows: number[] = [], sum: number[] = [], seen: number[] = [], lo: number[] = [], hi: number[] = [];
  let total = 0, outside = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const xv = x[id]!, yv = y[id]!;
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    const kx = Math.round(xv * 1e5), ky = Math.round(yv * 1e5);
    if (Math.abs(kx) > 2e7 || Math.abs(ky) > 1e7) { outside++; continue; }
    const key = (kx + 2e7) * 4e7 + (ky + 1e7);
    let at = index.get(key);
    if (at === undefined) {
      at = px.length;
      index.set(key, at);
      px.push(xv); py.push(yv); rows.push(0); sum.push(0); seen.push(0); lo.push(Infinity); hi.push(-Infinity);
    }
    rows[at]!++;
    total++;
    if (size !== null) {
      const sv = size[id]!;
      if (Number.isFinite(sv)) { sum[at]! += sv; seen[at]!++; if (sv < lo[at]!) lo[at] = sv; if (sv > hi[at]!) hi[at] = sv; }
    }
  }
  let order = px.map((_, k) => k);
  const sampled = order.length > limit;
  if (sampled) order = order.sort((a, b) => rows[b]! - rows[a]!).slice(0, Math.max(1, limit));
  const n = order.length;
  const ox = new Float64Array(n), oy = new Float64Array(n), osize = new Float64Array(n), ocount = new Float64Array(n);
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  order.forEach((k, j) => {
    ox[j] = px[k]!; oy[j] = py[k]!; ocount[j] = rows[k]!;
    osize[j] = size === null || agg === "count" ? rows[k]!
      : agg === "sum" ? sum[k]!
        : agg === "mean" ? (seen[k]! > 0 ? sum[k]! / seen[k]! : Number.NaN)
          : agg === "min" ? (seen[k]! > 0 ? lo[k]! : Number.NaN) : (seen[k]! > 0 ? hi[k]! : Number.NaN);
    if (ox[j]! < xMin) xMin = ox[j]!; if (ox[j]! > xMax) xMax = ox[j]!;
    if (oy[j]! < yMin) yMin = oy[j]!; if (oy[j]! > yMax) yMax = oy[j]!;
  });
  if (n === 0) { xMin = 0; xMax = 1; yMin = 0; yMax = 1; }
  [xMin, xMax] = padded(xMin, xMax);
  [yMin, yMax] = padded(yMin, yMax);
  return { mode: "points", x: ox, y: oy, colorValues: null, colorCodes: null, size: osize, counts: ocount, places: true, shown: n, total, outside, xMin, xMax, yMin, yMax, sampled };
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
  if (options.clip !== false && sampleX.length >= MIN_QUANTILE_SAMPLE) {
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
