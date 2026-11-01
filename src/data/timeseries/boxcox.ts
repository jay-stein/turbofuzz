/**
 * Box-Cox transformations (fpp3 3.1) and Guerrero's choice of the power (Guerrero 1993).
 *
 * A series whose swings grow with its level is easier to forecast after a power transformation:
 *   w = (y^lambda - 1) / lambda   (lambda != 0),   w = ln y   (lambda = 0).
 * Guerrero's method picks the lambda that makes the spread of each short stretch of the series, relative to its
 * level, as steady as possible: cut the series into stretches of one season (two periods when there is no
 * season), and minimise the coefficient of variation of sd_i / mean_i^(1 - lambda) over lambda in [-1, 2].
 * This follows R's forecast::BoxCox.lambda(method = "guerrero"), reimplemented from the published description.
 *
 * A forecast made on the transformed scale and mapped back is a median, not a mean (fpp3 3.1): the page's
 * accuracy measures are absolute errors, which the median minimises, so no bias adjustment is applied.
 */

export const LAMBDA_LOW = -1;
export const LAMBDA_HIGH = 2;

export function boxCox(y: ArrayLike<number>, lambda: number): Float64Array {
  const out = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) {
    const v = y[i]!;
    out[i] = v !== v ? NaN : lambda === 0 ? Math.log(v) : (Math.pow(v, lambda) - 1) / lambda;
  }
  return out;
}

/** The value on the original scale; a transformed value outside the range of the power maps to zero. */
export function invBoxCox(w: number, lambda: number): number {
  if (w !== w) return NaN;
  if (lambda === 0) return Math.exp(w);
  const base = lambda * w + 1;
  return base > 0 ? Math.pow(base, 1 / lambda) : 0;
}

/** True when every observed value in [from, to) is above zero: the only case a power transformation applies to. */
export function allPositive(y: ArrayLike<number>, from: number, to: number): boolean {
  let seen = 0;
  for (let t = from; t < to; t++) { const v = y[t]!; if (v === v) { if (!(v > 0)) return false; seen++; } }
  return seen > 0;
}

function mean(a: number[]): number { let s = 0; for (const v of a) s += v; return s / a.length; }
function sd(a: number[]): number {
  if (a.length < 2) return NaN;
  const mu = mean(a);
  let s = 0;
  for (const v of a) s += (v - mu) * (v - mu);
  return Math.sqrt(s / (a.length - 1));
}

/**
 * Guerrero's lambda over y[from, to), cut into stretches of m periods (2 when m is 1), the oldest incomplete stretch
 * dropped. Null when there are fewer than three stretches to compare or any stretch is constant.
 */
export function guerrero(y: ArrayLike<number>, from: number, to: number, m: number): number | null {
  const len = m > 1 ? m : 2;
  const n = to - from, k = Math.floor(n / len);
  if (k < 3) return null;
  const start = to - k * len;
  const means: number[] = [], sds: number[] = [];
  for (let i = 0; i < k; i++) {
    const seg: number[] = [];
    for (let t = start + i * len; t < start + (i + 1) * len; t++) { const v = y[t]!; if (v === v) seg.push(v); }
    if (seg.length < 2) return null;
    const s = sd(seg), mu = mean(seg);
    if (!(s > 0) || !(mu > 0)) return null;
    means.push(mu); sds.push(s);
  }
  const cv = (lambda: number): number => {
    const r = sds.map((s, i) => s / Math.pow(means[i]!, 1 - lambda));
    return sd(r) / mean(r);
  };
  // A grid finds the valley, golden-section search sharpens it (R uses Brent's optimize on the same interval).
  let best = LAMBDA_LOW, bestV = Infinity;
  for (let l = LAMBDA_LOW; l <= LAMBDA_HIGH + 1e-9; l += 0.05) { const v = cv(l); if (v < bestV) { bestV = v; best = l; } }
  let a = Math.max(LAMBDA_LOW, best - 0.05), b = Math.min(LAMBDA_HIGH, best + 0.05);
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a), d = a + phi * (b - a);
  for (let i = 0; i < 40 && b - a > 1e-6; i++) {
    if (cv(c) < cv(d)) b = d; else a = c;
    c = b - phi * (b - a); d = a + phi * (b - a);
  }
  const lambda = (a + b) / 2;
  return Number.isFinite(lambda) ? lambda : null;
}
