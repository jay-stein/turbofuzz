/**
 * Time Series page, layer 1: rows to one value per period, gaps, partial periods and
 * the rolling smooth.
 */

import { bucketStart, GRAINS, slotBuckets, weekdayAt, type Grain, type GrainId, type TsTable } from "./base.js";

export type TsAgg = "sum" | "mean" | "median" | "min" | "max" | "first" | "last" | "count";
/** How periods with no rows are shown; the models always bridge them (see seasonalFill). */
export type TsGaps = "seasonal" | "interp" | "zero" | "leave";
export type TsMode = "explore" | "decompose" | "forecast" | "patterns";
export type TsSmoothStat = "mean" | "median" | "min" | "max";
export type DriverRule = "hold" | "lastyear" | "pct";

export interface TsDriver {
  col: string;
  rule: DriverRule;
  pct: number;
}

/** Every choice on the page that changes a number. */
export interface TsConfig {
  grain: GrainId;
  agg: TsAgg;
  /** Measure column name; ignored for "count". */
  measure: string | null;
  /** Index into the table's groups, or -1 for all rows. */
  group: number;
  gaps: TsGaps;
  partial: "exclude" | "include";
  smoothW: number;
  smoothStat: TsSmoothStat;
  smoothCentred: boolean;
  /** Seasonal period picked by the person; null lets the page choose. */
  period: number | null;
  /** Robust z beyond which a period is flagged as unusual. */
  sens: number;
  /** Forecast from this period (a backtest); null is the latest. */
  split: number | null;
  horizon: number | null;
  /** Trend flexibility for the regression, 1 to 10. */
  flex: number;
  drivers: TsDriver[];
}

export interface Aggregated {
  g: Grain;
  n: number;
  /** Period start, UTC ms. */
  t: Float64Array;
  y: Float64Array;
  /** Periods the page filled for display. */
  filled: Uint8Array;
  /** Values the page made up (any fill but zero): never learned from or scored against. */
  made: Uint8Array;
  partial: Uint8Array;
  partShare: Float64Array;
  /** p10 and p90 of values per period, when a sum swings with how many there were. */
  spread: [number, number] | null;
  coverage: Float64Array;
  expected: Float64Array;
  missing: Uint16Array;
  rows: Float64Array;
  /** Per-group sum of the measure, per period (to say which group drove a spike). */
  groupVal: Float64Array[];
  /** Other numeric columns as per-period means (drivers). */
  colMean: Record<string, Float64Array>;
  /** Periods the models use (the partial last one may be left out). */
  modelN: number;
  /** The series the models see: gaps bridged by the seasonal fill. */
  yModel: Float64Array;
  /** Season the models use (1 when none fits the history). */
  modelM: number;
  /** Runs of empty slots, as slot ranges. */
  gapRanges: [number, number][];
  allPositive: boolean;
  nonNeg: boolean;
  naRows: number;
}

export function aggregate(T: TsTable, cfg: TsConfig, gid: GrainId = cfg.grain): Aggregated {
  const g = GRAINS[gid];
  const bod = slotBuckets(T, g);
  const n = bod[T.nslots - 1] + 1;
  const allG = cfg.group < 0;
  const count = cfg.agg === "count";
  const src = count || cfg.measure === null ? null : T.cols[cfg.measure] ?? null;
  const nr = T.rowSlot.length;
  const sum = new Float64Array(n), cnt = new Float64Array(n), rowsIn = new Float64Array(n);
  const mn = new Float64Array(n).fill(Infinity), mx = new Float64Array(n).fill(-Infinity);
  const firstV = new Float64Array(n).fill(NaN), lastV = new Float64Array(n).fill(NaN);
  const firstD = new Int32Array(n).fill(2147483647), lastD = new Int32Array(n).fill(-1);
  const vals: number[][] | null = cfg.agg === "median" ? Array.from({ length: n }, () => []) : null;
  const groupVal = T.groups.map(() => new Float64Array(n));
  const seen = new Uint8Array(T.nslots);
  let naRows = 0;
  for (let i = 0; i < nr; i++) {
    const d = T.rowSlot[i], b = bod[d], gr = T.rowGroup[i];
    const v = count ? 1 : src ? src[i] : NaN;
    if (v === v) groupVal[gr][b] += v;
    if (!allG && gr !== cfg.group) continue;
    seen[d] = 1;
    rowsIn[b]++;
    if (!(v === v)) { naRows++; continue; }
    sum[b] += v; cnt[b]++;
    if (v < mn[b]) mn[b] = v;
    if (v > mx[b]) mx[b] = v;
    if (d < firstD[b]) { firstD[b] = d; firstV[b] = v; }
    if (d >= lastD[b]) { lastD[b] = d; lastV[b] = v; }
    if (vals) vals[b].push(v);
  }
  // Coverage from the data's own spacing: a monthly table has one row per month and is
  // complete; a daily table missing four days in a week is not.
  const cad = T.cadSlots, obsSlots = new Float64Array(n), allowed = new Float64Array(n);
  const lastObs = T.observed[T.observed.length - 1], spanEnd = lastObs + Math.max(1, Math.round(cad)) - 1;
  for (let d = 0; d < T.nslots; d++) {
    const b = bod[d];
    if (seen[d]) obsSlots[b]++;
    if (d <= spanEnd && !T.structural[T.swd[d]]) allowed[b]++;
  }
  const t = new Float64Array(n), y = new Float64Array(n), filled = new Uint8Array(n), partial = new Uint8Array(n);
  const expected = new Float64Array(n), coverage = new Float64Array(n), missing = new Uint16Array(n);
  for (let b = 0; b < n; b++) {
    t[b] = bucketStart(T, g, b);
    expected[b] = Math.max(1, allowed[b] / Math.max(1, cad));
    coverage[b] = Math.min(1, obsSlots[b] / expected[b]);
    missing[b] = Math.max(0, Math.round(expected[b] - obsSlots[b]));
    if (count) y[b] = rowsIn[b];
    else if (!cnt[b]) y[b] = NaN;
    else if (cfg.agg === "sum") y[b] = sum[b];
    else if (cfg.agg === "mean") y[b] = sum[b] / cnt[b];
    else if (cfg.agg === "min") y[b] = mn[b];
    else if (cfg.agg === "max") y[b] = mx[b];
    else if (cfg.agg === "first") y[b] = firstV[b];
    else if (cfg.agg === "last") y[b] = lastV[b];
    else if (vals) { const v = vals[b].sort((p, q) => p - q), h = v.length >> 1; y[b] = v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; }
  }
  // Only the first and last period can be partial: the data starts or stops inside them.
  const fullAllowed = (b: number): number => {
    let c = 0;
    for (let ms = t[b]; ms < bucketStart(T, g, b + 1); ms += T.slot) if (!T.structural[weekdayAt(T, ms)]) c++;
    return c;
  };
  const partShare = new Float64Array(n).fill(1);
  for (const b of [0, n - 1]) { const f = fullAllowed(b); partShare[b] = f ? Math.min(1, allowed[b] / f) : 1; if (partShare[b] < 0.95) partial[b] = 1; }
  // Events (quakes, orders) arrive when they happen: a quiet stretch is a real zero, not a gap.
  if (T.eventLike) { coverage.fill(1); missing.fill(0); }
  let first = 0, last = n - 1;
  while (first < n && !(y[first] === y[first])) first++;
  while (last >= 0 && !(y[last] === y[last])) last--;
  const modelN = partial[n - 1] && cfg.partial === "exclude" ? n - 1 : n;
  let modelM = 1;
  for (const p of g.periods) if (modelN >= 2 * p + 2) { modelM = p; break; }
  let knownNonNeg = true;
  for (let b = 0; b < n; b++) if (y[b] < 0) { knownNonNeg = false; break; }
  const made = new Uint8Array(n);
  for (let b = 0; b < n; b++) if (!(y[b] === y[b]) && cfg.gaps !== "zero") made[b] = 1;
  if (first <= last && cfg.gaps === "seasonal") {
    const z = y.slice(first, last + 1);
    seasonalFill(z, modelM, knownNonNeg);
    for (let b = first; b <= last; b++) if (!(y[b] === y[b])) { y[b] = z[b - first]; filled[b] = 1; }
  }
  for (let b = first; b <= last; b++) {
    if (y[b] === y[b]) continue;
    if (cfg.gaps === "zero") { y[b] = 0; filled[b] = 1; }
    else if (cfg.gaps === "interp") {
      const a = b - 1;
      let c = b + 1;
      while (c <= last && !(y[c] === y[c])) c++;
      for (let k = b; k < c; k++) { y[k] = y[a] + ((y[c] - y[a]) * (k - a)) / (c - a); filled[k] = 1; }
      b = c - 1;
    }
  }
  // Models need an unbroken series: whatever is still empty gets the seasonal fill.
  const yModel = y.slice(0, modelN);
  seasonalFill(yModel, modelM, knownNonNeg);
  // Shape, not meaning: decides whether changes read as percentages and whether
  // forecasts may go below zero.
  let allPositive = true, nonNeg = true;
  for (let i = 0; i < modelN; i++) { const v = y[i]; if (!(v === v) || made[i]) continue; if (!(v > 0)) allPositive = false; if (v < 0) nonNeg = false; }
  const colMean: Record<string, Float64Array> = {};
  for (const [c, arr] of Object.entries(T.cols)) {
    if (c === cfg.measure && !count) continue;
    const s = new Float64Array(n), k = new Float64Array(n), out = new Float64Array(n);
    for (let i = 0; i < nr; i++) { const v = arr[i]; if (v === v) { const b = bod[T.rowSlot[i]]; s[b] += v; k[b]++; } }
    let prev = NaN;
    for (let b = 0; b < n; b++) { if (k[b]) prev = s[b] / k[b]; out[b] = prev; }
    const j0 = k.findIndex((x) => x > 0);
    for (let b = 0; b < n && !(out[b] === out[b]) && j0 >= 0; b++) out[b] = s[j0] / k[j0];
    colMean[c] = out;
  }
  // Runs without rows (structural weekdays excluded), as slot ranges for the findings.
  const gapRanges: [number, number][] = [];
  const ob = T.eventLike ? [] : T.observed;
  for (let k = 1; k < ob.length; k++) {
    if (ob[k] - ob[k - 1] <= 1.5 * cad) continue;
    let real = false;
    for (let d = ob[k - 1] + 1; d < ob[k]; d++) if (!T.structural[T.swd[d]]) { real = true; break; }
    if (real) gapRanges.push([ob[k - 1] + 1, ob[k] - 1]);
  }
  // How many values each period holds. When that swings, a sum swings with it.
  let spread: [number, number] | null = null;
  if (!count && cfg.agg === "sum") {
    const nz = Array.from(cnt).filter((c) => c > 0).sort((p, q) => p - q);
    const p10 = nz[Math.floor(nz.length * 0.1)], p90 = nz[Math.floor(nz.length * 0.9)];
    if (nz.length >= 10 && p90 > 1.5 * p10) spread = [p10, p90];
  }
  return {
    g, n, t, y, filled, made, partial, partShare, spread, coverage, expected, missing, rows: rowsIn, groupVal, colMean,
    modelN, yModel, modelM, gapRanges, allPositive, nonNeg, naRows,
  };
}

/**
 * Fills the empty periods of y in place. Each gap gets a straight line between the
 * levels either side of it, plus the usual shape for those periods: the median, phase
 * by phase over a cycle of m, of each known value around its moving average. A midday
 * gap in hourly data so keeps its midday peak instead of a flat line. With no cycle
 * (m = 1, or too little data) it is the straight line alone; gaps at either end take
 * the nearest level. Never below zero when the known values never are.
 */
export function seasonalFill(y: Float64Array, m: number, nonNeg: boolean): Float64Array {
  const n = y.length;
  let P: Float64Array | null = null;
  if (m > 1 && n >= 2 * m) {
    const pre = new Float64Array(n + 1), cnt = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { const ok = y[i] === y[i]; pre[i + 1] = pre[i] + (ok ? y[i] : 0); cnt[i + 1] = cnt[i] + (ok ? 1 : 0); }
    const h = m >> 1, per = Math.ceil(n / m) + 1, buf = new Float64Array(m * per), bn = new Int32Array(m);
    for (let i = 0; i < n; i++) {
      if (!(y[i] === y[i])) continue;
      const a = Math.max(0, i - h), b = Math.min(n, i + h + 1), c = cnt[b] - cnt[a];
      if (c >= m / 2) { const k = i % m; buf[k * per + bn[k]++] = y[i] - (pre[b] - pre[a]) / c; }
    }
    P = new Float64Array(m);
    let mean = 0;
    for (let k = 0; k < m; k++) {
      if (bn[k] < 2) { P = null; break; }
      const v = buf.subarray(k * per, k * per + bn[k]).sort(), q = v.length >> 1;
      P[k] = v.length % 2 ? v[q] : (v[q - 1] + v[q]) / 2;
      mean += P[k];
    }
    if (P) for (let k = 0; k < m; k++) P[k] -= mean / m;
  }
  const shape = (k: number): number => (P ? P[k % m] : 0);
  for (let i = 0; i < n; ) {
    if (y[i] === y[i]) { i++; continue; }
    let j = i;
    while (j < n && !(y[j] === y[j])) j++;
    const a = i - 1, c = j;
    if (a < 0 && c >= n) return y;
    const la = a >= 0 ? y[a] - shape(a) : y[c] - shape(c), lc = c < n ? y[c] - shape(c) : la;
    for (let k = i; k < j; k++) {
      const f = a >= 0 && c < n ? (k - a) / (c - a) : 0;
      const v = la + (lc - la) * f + shape(k);
      y[k] = nonNeg && v < 0 ? 0 : v;
    }
    i = j;
  }
  return y;
}

/** Typical value of a series over [i0, i1): the median, so one-off periods do not move it. */
export function regular(series: Float64Array, i0: number, i1: number): number {
  const a = Math.max(0, i0);
  const v = Float64Array.from(series.subarray(a, Math.max(a + 1, i1))).sort();
  return v[v.length >> 1];
}

/** Rolling mean, median, min or max over w periods; trailing unless centred. */
export function rolling(y: Float64Array, n: number, w: number, centred: boolean, stat: TsSmoothStat): Float64Array {
  const out = new Float64Array(n).fill(NaN);
  const buf: number[] = [];
  const lo = centred ? Math.floor((w - 1) / 2) : w - 1;
  const hi = centred ? w - 1 - lo : 0;
  const need = Math.ceil(w / 2);
  for (let i = 0; i < n; i++) {
    if (i + hi >= n) break;
    buf.length = 0;
    for (let k = i - lo; k <= i + hi; k++) if (k >= 0 && y[k] === y[k]) buf.push(y[k]);
    if (buf.length < need || (!centred && i < w - 1)) continue;
    if (stat === "median") { buf.sort((a, b) => a - b); const m = buf.length >> 1; out[i] = buf.length % 2 ? buf[m] : (buf[m - 1] + buf[m]) / 2; }
    else if (stat === "min") { let v = Infinity; for (const x of buf) if (x < v) v = x; out[i] = v; }
    else if (stat === "max") { let v = -Infinity; for (const x of buf) if (x > v) v = x; out[i] = v; }
    else { let s = 0; for (const v of buf) s += v; out[i] = s / buf.length; }
  }
  return out;
}
