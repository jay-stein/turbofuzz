/**
 * STL and MSTL seasonal-trend decomposition by loess, written from the published
 * algorithms, without dependencies.
 *
 * STL: Cleveland, R. B., Cleveland, W. S., McRae, J. E. and Terpenning, I. (1990). STL: A
 * seasonal-trend decomposition procedure based on loess. Journal of Official Statistics,
 * 6(1), 3-73. The loops, the loess evaluation (tricube weights, local degree 0 or 1, the
 * widening of the span when it exceeds the series), the cycle-subseries extension, the
 * low-pass filter and the bisquare robustness weights follow that paper; the defaults
 * (window rules, jumps, inner and outer iterations) follow R's stl().
 *
 * MSTL: Bandara, K., Hyndman, R. J. and Bergmeir, C. (2021). MSTL: A seasonal-trend
 * decomposition algorithm for time series with multiple seasonal patterns. arXiv:2107.13462.
 * One STL per period, shortest first, iterated twice, each on the series with the other
 * seasonal components removed; seasonal windows 7 + 4i as in R's forecast::mstl().
 *
 * Reference implementations used to check this one (not copied): R stats::stl, Python
 * statsmodels STL and MSTL (BSD-3-Clause). See tools/ts-eval and test/timeseries-stl.test.ts.
 */

export interface StlOptions {
  /** Seasonal loess span, in cycles (odd, at least 3). */
  seasonal: number;
  /** Trend span in periods; default ceil(1.5 m / (1 - 1.5 / seasonal)), made odd. */
  trend?: number;
  /** Low-pass span; default the smallest odd number above m. */
  lowPass?: number;
  seasonalDeg?: 0 | 1;
  trendDeg?: 0 | 1;
  lowPassDeg?: 0 | 1;
  seasonalJump?: number;
  trendJump?: number;
  lowPassJump?: number;
  /** Robustness iterations: robust fitting uses 15 outer and 1 inner, otherwise 0 and 2. */
  robust?: boolean;
}
export interface Stl { seasonal: Float64Array; trend: Float64Array; remainder: Float64Array }

const odd = (v: number): number => { const k = Math.ceil(v); return k % 2 === 0 ? k + 1 : k; };

/**
 * One loess estimate at xs from points nleft..nright (1-based, as in the paper) of y, with
 * span len, local degree, and robustness weights rw when userw. NaN when the weights vanish.
 */
function estimate(y: Float64Array, n: number, len: number, deg: number, xs: number, nleft: number, nright: number, w: Float64Array, userw: boolean, rw: Float64Array): number {
  const range = n - 1;
  let h = Math.max(xs - nleft, nright - xs);
  if (len > n) h += Math.floor((len - n) / 2);
  const h9 = 0.999 * h, h1 = 0.001 * h;
  let a = 0;
  for (let j = nleft; j <= nright; j++) {
    w[j - 1] = 0;
    const r = Math.abs(j - xs);
    if (r <= h9) {
      if (r <= h1) w[j - 1] = 1;
      else { const t = r / h, u = 1 - t * t * t; w[j - 1] = u * u * u; }
      if (userw) w[j - 1] *= rw[j - 1]!;
      a += w[j - 1]!;
    }
  }
  if (a <= 0) return NaN;
  for (let j = nleft; j <= nright; j++) w[j - 1] /= a;
  if (h > 0 && deg > 0) {
    a = 0;
    for (let j = nleft; j <= nright; j++) a += w[j - 1]! * j;
    let b = xs - a, c = 0;
    for (let j = nleft; j <= nright; j++) c += w[j - 1]! * (j - a) * (j - a);
    if (Math.sqrt(c) > 0.001 * range) {
      b /= c;
      for (let j = nleft; j <= nright; j++) w[j - 1] *= b * (j - a) + 1;
    }
  }
  let ys = 0;
  for (let j = nleft; j <= nright; j++) ys += w[j - 1]! * y[j - 1]!;
  return ys;
}

/** Loess smoothing of y (length n) at every point, evaluating every `jump` points and interpolating between. */
function smooth(y: Float64Array, n: number, len: number, deg: number, jump: number, userw: boolean, rw: Float64Array, ys: Float64Array, w: Float64Array, o = 0): void {
  if (n < 2) { ys[o] = y[0]!; return; }
  const newnj = Math.min(jump, n - 1);
  const put = (i: number, nleft: number, nright: number): void => {
    const v = estimate(y, n, len, deg, i, nleft, nright, w, userw, rw);
    ys[o + i - 1] = v === v ? v : y[i - 1]!;
  };
  if (len >= n) {
    for (let i = 1; i <= n; i += newnj) put(i, 1, n);
  } else if (newnj === 1) {
    const nsh = (len + 1) >> 1;
    let nleft = 1, nright = len;
    for (let i = 1; i <= n; i++) {
      if (i > nsh && nright !== n) { nleft++; nright++; }
      put(i, nleft, nright);
    }
  } else {
    const nsh = (len + 1) >> 1;
    for (let i = 1; i <= n; i += newnj) {
      let nleft: number, nright: number;
      if (i < nsh) { nleft = 1; nright = len; }
      else if (i >= n - nsh + 1) { nleft = n - len + 1; nright = n; }
      else { nleft = i - nsh + 1; nright = len + i - nsh; }
      put(i, nleft, nright);
    }
  }
  if (newnj !== 1) {
    for (let i = 1; i <= n - newnj; i += newnj) {
      const delta = (ys[o + i + newnj - 1]! - ys[o + i - 1]!) / newnj;
      for (let j = i + 1; j <= i + newnj - 1; j++) ys[o + j - 1] = ys[o + i - 1]! + delta * (j - i);
    }
    const k = Math.floor((n - 1) / newnj) * newnj + 1;
    if (k !== n) {
      const nleft = len >= n ? 1 : n - len + 1;
      const v = estimate(y, n, len, deg, n, nleft, n, w, userw, rw);
      ys[o + n - 1] = v === v ? v : y[n - 1]!;
      if (k !== n - 1) {
        const delta = (ys[o + n - 1]! - ys[o + k - 1]!) / (n - k);
        for (let j = k + 1; j <= n - 1; j++) ys[o + j - 1] = ys[o + k - 1]! + delta * (j - k);
      }
    }
  }
}

/** Moving average of window len over x (length n): n - len + 1 values. */
function movingAverage(x: Float64Array, n: number, len: number, out: Float64Array): void {
  const newn = n - len + 1;
  let flen = 0;
  for (let i = 0; i < len; i++) flen += x[i]!;
  const v = flen / len;
  out[0] = v;
  let acc = flen;
  for (let j = 1; j < newn; j++) { acc += x[len + j - 1]! - x[j - 1]!; out[j] = acc / len; }
}

/** Seasonal decomposition of y (no missing values) with period m. */
export function stl(y: ArrayLike<number>, m: number, opts: StlOptions): Stl {
  const n = y.length;
  const ns = Math.max(3, odd(opts.seasonal));
  const nt = Math.max(3, odd(opts.trend ?? (1.5 * m) / (1 - 1.5 / ns)));
  // The low-pass span is the smallest odd number above the period unless given.
  const nlOdd = Math.max(3, opts.lowPass === undefined ? (m % 2 === 0 ? m + 1 : m + 2) : odd(opts.lowPass));
  const np = Math.max(2, m);
  const isdeg = opts.seasonalDeg ?? 0, itdeg = opts.trendDeg ?? 1, ildeg = opts.lowPassDeg ?? itdeg;
  const nsjump = opts.seasonalJump ?? Math.ceil(ns / 10), ntjump = opts.trendJump ?? Math.ceil(nt / 10), nljump = opts.lowPassJump ?? Math.ceil(nlOdd / 10);
  const inner = opts.robust ? 1 : 2, outer = opts.robust ? 15 : 0;
  const yy = Float64Array.from(y);
  const season = new Float64Array(n), trend = new Float64Array(n), rw = new Float64Array(n).fill(1);
  const c = new Float64Array(n + 2 * np), w = new Float64Array(Math.max(n, ns, nt, nlOdd) + 2 * np), work = new Float64Array(n + 2 * np), work2 = new Float64Array(n + 2 * np);
  const sub = new Float64Array(Math.ceil(n / np) + 2), subw = new Float64Array(Math.ceil(n / np) + 2), subs = new Float64Array(Math.ceil(n / np) + 2);
  const lp1 = new Float64Array(n + 2 * np), lp2 = new Float64Array(n + 2 * np), lp3 = new Float64Array(n + 2 * np), low = new Float64Array(n);
  let userw = false;
  for (let pass = 0; pass <= outer; pass++) {
    for (let it = 0; it < inner; it++) {
      for (let i = 0; i < n; i++) work[i] = yy[i]! - trend[i]!;
      // Cycle-subseries, each smoothed and extended one point either side.
      for (let j = 1; j <= np; j++) {
        const k = Math.floor((n - j) / np) + 1;
        for (let i = 1; i <= k; i++) { sub[i - 1] = work[(i - 1) * np + j - 1]!; if (userw) subw[i - 1] = rw[(i - 1) * np + j - 1]!; }
        smooth(sub, k, ns, isdeg, nsjump, userw, subw, subs, w, 1);
        let v = estimate(sub, k, ns, isdeg, 0, 1, Math.min(ns, k), w, userw, subw);
        subs[0] = v === v ? v : subs[1]!;
        v = estimate(sub, k, ns, isdeg, k + 1, Math.max(1, k - ns + 1), k, w, userw, subw);
        subs[k + 1] = v === v ? v : subs[k]!;
        for (let q = 1; q <= k + 2; q++) c[(q - 1) * np + j - 1] = subs[q - 1]!;
      }
      // Low-pass filter of the cycle-subseries: moving averages np, np, 3, then loess.
      movingAverage(c, n + 2 * np, np, lp1);
      movingAverage(lp1, n + 2 * np - np + 1, np, lp2);
      movingAverage(lp2, n + 2 * np - 2 * np + 2, 3, lp3);
      smooth(lp3, n, nlOdd, ildeg, nljump, false, rw, low, w);
      for (let i = 0; i < n; i++) season[i] = c[np + i]! - low[i]!;
      for (let i = 0; i < n; i++) work2[i] = yy[i]! - season[i]!;
      smooth(work2, n, nt, itdeg, ntjump, userw, rw, trend, w);
    }
    if (pass === outer) break;
    // Bisquare robustness weights from the residuals.
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = Math.abs(yy[i]! - trend[i]! - season[i]!);
    const sorted = Float64Array.from(r).sort();
    const m1 = Math.floor(n / 2), m2 = n - m1 - 1;
    const cmad = 3 * (sorted[m1]! + sorted[m2]!), c9 = 0.999 * cmad, c1 = 0.001 * cmad;
    for (let i = 0; i < n; i++) rw[i] = r[i]! <= c1 ? 1 : r[i]! <= c9 ? (1 - (r[i]! / cmad) ** 2) ** 2 : 0;
    userw = true;
  }
  const remainder = new Float64Array(n);
  for (let i = 0; i < n; i++) remainder[i] = yy[i]! - trend[i]! - season[i]!;
  return { seasonal: season, trend, remainder };
}

export interface Mstl { seasonal: Float64Array[]; trend: Float64Array; remainder: Float64Array; periods: number[] }

/**
 * Multiple seasonal decomposition: periods in ascending order, seasonal windows 7 + 4i,
 * two passes over the periods (forecast::mstl defaults).
 */
export function mstl(y: ArrayLike<number>, periods: readonly number[], iterate = 2): Mstl {
  const n = y.length, ps = [...periods].sort((a, b) => a - b);
  const seasonal = ps.map(() => new Float64Array(n));
  const deseas = Float64Array.from(y);
  let last = null as Stl | null;
  for (let it = 0; it < iterate; it++) {
    ps.forEach((p, i) => {
      for (let t = 0; t < n; t++) deseas[t] += seasonal[i]![t]!;
      last = stl(deseas, p, { seasonal: 7 + 4 * (i + 1) });
      seasonal[i]!.set(last.seasonal);
      for (let t = 0; t < n; t++) deseas[t] -= seasonal[i]![t]!;
    });
  }
  const trend = last ? last.trend : new Float64Array(n);
  const remainder = new Float64Array(n);
  for (let t = 0; t < n; t++) remainder[t] = deseas[t]! - trend[t]!;
  return { seasonal, trend, remainder, periods: ps };
}
