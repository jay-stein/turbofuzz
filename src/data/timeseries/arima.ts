/**
 * Seasonal ARIMA and the automatic search for it, after Hyndman and Khandakar (2008), the algorithm
 * of R's forecast::auto.arima, reimplemented from the published description (no GPL code copied).
 *
 *   phi(B) Phi(B^m) (1 - B)^d (1 - B^m)^D (y_t - mu t^k) = c + theta(B) Theta(B^m) e_t,   e_t ~ N(0, sigma^2)
 *
 * What is here:
 *   - the number of differences: a KPSS test for d, and the seasonal strength of an STL fit for D
 *     (Kwiatkowski et al. 1992; Wang, Smith and Hyndman 2006; as forecast::ndiffs and nsdiffs);
 *   - the exact Gaussian likelihood of the differenced series by the Kalman filter on the state-space form of
 *     an ARMA model (Gardner, Harvey and Phillips 1980), with the variance concentrated out and missing
 *     values skipped, as stats::arima does;
 *   - estimation as R's "CSS-ML": the conditional sum of squares first, then the exact likelihood from there,
 *     by BFGS on parameters mapped to the stationary and invertible region through partial autocorrelations
 *     (Jones 1980);
 *   - the stepwise search over (p, q, P, Q) and the constant by AICc, from the same four starting models and
 *     the same neighbours as auto.arima, plus an exhaustive search over every order;
 *   - forecasts and their analytic prediction intervals from the psi weights (fpp3 9.8), and the model's
 *     residual checks.
 *
 * No time limit applies: it runs until the search ends, so it belongs in a worker the person starts on purpose.
 */

import { stl } from "./stl.js";
import { chiSquareSf } from "./stats.js";

// ---------------------------------------------------------------- specification and helpers

export interface ArimaSpec {
  p: number; d: number; q: number;
  P: number; D: number; Q: number;
  /** The seasonal period (1 for no season). */
  m: number;
  /** A constant in the differenced series: the mean when d + D = 0, a drift when d + D = 1. */
  constant: boolean;
}

export const specLabel = (s: ArimaSpec): string =>
  `ARIMA(${s.p},${s.d},${s.q})` + (s.m > 1 || s.P + s.D + s.Q > 0 ? `(${s.P},${s.D},${s.Q})[${s.m}]` : "") +
  (s.constant ? (s.d + s.D === 0 ? " with non-zero mean" : " with drift") : s.d + s.D === 0 ? " with zero mean" : "");

/** (1 - B)^d (1 - B^m)^D applied to y; NaN where the window holds a missing value or runs off the start. */
export function difference(y: ArrayLike<number>, d: number, D: number, m: number): Float64Array {
  let cur = Float64Array.from(y as ArrayLike<number>);
  const apply = (lag: number): void => {
    const next = new Float64Array(cur.length).fill(NaN);
    for (let t = lag; t < cur.length; t++) next[t] = cur[t]! - cur[t - lag]!;
    cur = next;
  };
  for (let i = 0; i < D; i++) apply(m);
  for (let i = 0; i < d; i++) apply(1);
  return cur;
}

/** The coefficients c_1.. of the differencing polynomial 1 + c_1 B + ... = (1 - B)^d (1 - B^m)^D. */
export function diffPoly(d: number, D: number, m: number): number[] {
  let poly = [1];
  const mul = (b: number[]): void => {
    const out = new Array<number>(poly.length + b.length - 1).fill(0);
    for (let i = 0; i < poly.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = out[i + j]! + poly[i]! * b[j]!;
    poly = out;
  };
  for (let i = 0; i < d; i++) mul([1, -1]);
  for (let i = 0; i < D; i++) { const b = new Array<number>(m + 1).fill(0); b[0] = 1; b[m] = -1; mul(b); }
  return poly;
}

/** Expands phi(B) Phi(B^m): the AR coefficients a_1.. of y_t = a_1 y_{t-1} + ... */
export function expandAr(phi: ArrayLike<number>, Phi: ArrayLike<number>, m: number): number[] {
  const n = phi.length + m * Phi.length;
  const poly = new Array<number>(n + 1).fill(0);
  const reg = [1, ...Array.from(phi, (v) => -v)];
  const sea = new Array<number>(m * Phi.length + 1).fill(0);
  sea[0] = 1;
  for (let i = 0; i < Phi.length; i++) sea[m * (i + 1)] = -Phi[i]!;
  for (let i = 0; i < reg.length; i++) for (let j = 0; j < sea.length; j++) poly[i + j] = poly[i + j]! + reg[i]! * sea[j]!;
  return poly.slice(1).map((v) => -v);
}

/** Expands theta(B) Theta(B^m): the MA coefficients b_1.. of e_t + b_1 e_{t-1} + ... */
export function expandMa(theta: ArrayLike<number>, Theta: ArrayLike<number>, m: number): number[] {
  const n = theta.length + m * Theta.length;
  const poly = new Array<number>(n + 1).fill(0);
  const reg = [1, ...Array.from(theta)];
  const sea = new Array<number>(m * Theta.length + 1).fill(0);
  sea[0] = 1;
  for (let i = 0; i < Theta.length; i++) sea[m * (i + 1)] = Theta[i]!;
  for (let i = 0; i < reg.length; i++) for (let j = 0; j < sea.length; j++) poly[i + j] = poly[i + j]! + reg[i]! * sea[j]!;
  return poly.slice(1);
}

/** Unconstrained values to the coefficients of a stationary AR polynomial (Jones 1980): tanh, then Durbin-Levinson. */
export function partrans(raw: ArrayLike<number>): number[] {
  const p = raw.length;
  const out = Array.from(raw, (v) => Math.tanh(v));
  const work = out.slice();
  for (let j = 1; j < p; j++) {
    const a = out[j]!;
    for (let k = 0; k < j; k++) work[k] = work[k]! - a * out[j - k - 1]!;
    for (let k = 0; k < j; k++) out[k] = work[k]!;
  }
  return out;
}

/** The inverse of partrans, for starting values; null when the polynomial is not stationary. */
export function invPartrans(phi: ArrayLike<number>): number[] | null {
  const p = phi.length;
  const new_ = Array.from(phi);
  const work = new_.slice();
  for (let j = p - 1; j > 0; j--) {
    const a = new_[j]!;
    if (!(Math.abs(a) < 1)) return null;
    for (let k = 0; k < j; k++) work[k] = (new_[k]! + a * new_[j - k - 1]!) / (1 - a * a);
    for (let k = 0; k < j; k++) new_[k] = work[k]!;
  }
  if (p > 0 && !(Math.abs(new_[0]!) < 1)) return null;
  return new_.map((v) => Math.atanh(v));
}

// ---------------------------------------------------------------- polynomial roots

/** The complex roots of c_0 + c_1 z + ... + c_n z^n by Durand-Kerner iteration (degrees here are 5 or less). */
export function polyRoots(c: number[]): [number, number][] {
  let n = c.length - 1;
  while (n > 0 && Math.abs(c[n]!) < 1e-14) n--;
  if (n <= 0) return [];
  const a = c.slice(0, n + 1).map((v) => v / c[n]!);
  const roots: [number, number][] = Array.from({ length: n }, (_, k) => [Math.cos((2 * Math.PI * k) / n + 0.4) * 0.9, Math.sin((2 * Math.PI * k) / n + 0.4) * 0.9]);
  const mulC = (x: [number, number], y: [number, number]): [number, number] => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
  const divC = (x: [number, number], y: [number, number]): [number, number] => { const d = y[0] * y[0] + y[1] * y[1]; return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d]; };
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let pv: [number, number] = [1, 0];
      let val: [number, number] = [0, 0];
      let xp: [number, number] = [1, 0];
      for (let k = 0; k <= n; k++) { val = [val[0] + a[k]! * xp[0], val[1] + a[k]! * xp[1]]; xp = mulC(xp, roots[i]!); }
      for (let j = 0; j < n; j++) if (j !== i) pv = mulC(pv, [roots[i]![0] - roots[j]![0], roots[i]![1] - roots[j]![1]]);
      const step = divC(val, pv);
      roots[i] = [roots[i]![0] - step[0], roots[i]![1] - step[1]];
      moved = Math.max(moved, Math.abs(step[0]) + Math.abs(step[1]));
    }
    if (moved < 1e-13) break;
  }
  return roots;
}

/** The invertible MA polynomial with the same autocovariance: roots inside the unit circle are reflected to 1 / conj(root). */
export function maInvert(theta: number[]): number[] {
  const q = theta.length;
  if (q === 0) return theta;
  const roots = polyRoots([1, ...theta]);
  if (roots.every((r) => r[0] * r[0] + r[1] * r[1] >= 1 - 1e-9)) return theta;
  // 1 + sum theta_i z^i = prod (1 - z / r_i); a flipped root r' = 1 / conj(r) keeps the coefficients real in conjugate pairs.
  let poly: [number, number][] = [[1, 0]];
  for (const r of roots) {
    const mod2 = r[0] * r[0] + r[1] * r[1];
    const rr: [number, number] = mod2 < 1 ? [r[0] / mod2, r[1] / mod2] : r;
    const inv = [rr[0] / (rr[0] * rr[0] + rr[1] * rr[1]), -rr[1] / (rr[0] * rr[0] + rr[1] * rr[1])];
    const next: [number, number][] = Array.from({ length: poly.length + 1 }, () => [0, 0] as [number, number]);
    for (let i = 0; i < poly.length; i++) {
      next[i] = [next[i]![0] + poly[i]![0], next[i]![1] + poly[i]![1]];
      next[i + 1] = [next[i + 1]![0] - (poly[i]![0] * inv[0]! - poly[i]![1] * inv[1]!), next[i + 1]![1] - (poly[i]![0] * inv[1]! + poly[i]![1] * inv[0]!)];
    }
    poly = next;
  }
  return poly.slice(1, q + 1).map((c) => c[0]);
}

// ---------------------------------------------------------------- likelihood

interface Lik { ssq: number; sumLogF: number; n: number }

/**
 * The exact Gaussian likelihood of z (centred, differenced, NaN = missing) under an ARMA model with these expanded
 * coefficients, by the Kalman filter on Gardner's state-space form, with the innovation variance concentrated out.
 * Returns the sum of squared standardised innovations, the sum of log innovation variances and the count.
 */
export function armaLik(z: Float64Array, ar: number[], ma: number[]): Lik | null {
  const pe = ar.length, qe = ma.length;
  const r = Math.max(pe, qe + 1);
  const a = new Float64Array(r), P = new Float64Array(r * r), M = new Float64Array(r * r), Pp = new Float64Array(r * r), Pprev = new Float64Array(r * r);
  const Rv = new Float64Array(r);
  Rv[0] = 1;
  for (let i = 1; i < r; i++) Rv[i] = i - 1 < qe ? ma[i - 1]! : 0;
  const arAt = (i: number): number => (i < pe ? ar[i]! : 0); // T[i][0]
  // The stationary covariance of the state: P = T P T' + R R', by doubling.
  {
    const X = new Float64Array(r * r);
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) X[i * r + j] = Rv[i]! * Rv[j]!;
    let A: Float64Array = new Float64Array(r * r);
    for (let i = 0; i < r; i++) { A[i * r] = arAt(i); if (i < r - 1) A[i * r + i + 1] = 1; }
    // Three work matrices are reused across the doubling steps: this runs once per likelihood evaluation, hundreds of times a fit.
    const AX = new Float64Array(r * r), AXA = new Float64Array(r * r);
    let spare: Float64Array = new Float64Array(r * r);
    const mulAB = (U: Float64Array, V: Float64Array, tr: boolean, out: Float64Array): Float64Array => {
      out.fill(0);
      for (let i = 0; i < r; i++) for (let k = 0; k < r; k++) {
        const u = U[i * r + k]!;
        if (u === 0) continue;
        if (tr) for (let j = 0; j < r; j++) out[i * r + j] = out[i * r + j]! + u * V[j * r + k]!;
        else for (let j = 0; j < r; j++) out[i * r + j] = out[i * r + j]! + u * V[k * r + j]!;
      }
      return out;
    };
    for (let it = 0; it < 80; it++) {
      mulAB(A, X, false, AX);
      mulAB(AX, A, true, AXA);
      let delta = 0;
      for (let i = 0; i < r * r; i++) { delta = Math.max(delta, Math.abs(AXA[i]!)); X[i] = X[i]! + AXA[i]!; }
      const A2 = mulAB(A, A, false, spare);
      spare = A;
      A = A2;
      if (delta < 1e-13 * (1 + Math.abs(X[0]!))) break;
      if (!Number.isFinite(X[0]!)) return null;
    }
    P.set(X);
  }
  let ssq = 0, sumLogF = 0, n = 0, steady = false;
  const col0 = new Float64Array(r), row0 = new Float64Array(r);
  const N = z.length;
  for (let t = 0; t < N; t++) {
    // a is a_{t|t-1}, P is P_{t|t-1}
    if (!steady) Pprev.set(P);
    const v = z[t]!;
    if (v === v) {
      const F = P[0]!;
      if (!(F > 1e-12)) return null;
      const innov = v - a[0]!;
      ssq += (innov * innov) / F; sumLogF += Math.log(F); n++;
      // Update: a += P[:,0] innov / F; P -= P[:,0] P[0,:] / F
      const k0 = innov / F;
      for (let i = 0; i < r; i++) a[i] = a[i]! + P[i * r]! * k0;
      if (!steady) {
        for (let i = 0; i < r; i++) { col0[i] = P[i * r]!; row0[i] = P[i]!; }
        for (let i = 0; i < r; i++) { const ci = col0[i]!; if (ci !== 0) for (let j = 0; j < r; j++) P[i * r + j] = P[i * r + j]! - (ci * row0[j]!) / F; }
      }
    } else if (steady) steady = false; // a gap breaks the steady state; the covariance must be tracked again
    // Predict: a = T a; P = T P T' + R R'
    const a0 = a[0]!;
    for (let i = 0; i < r - 1; i++) a[i] = arAt(i) * a0 + a[i + 1]!;
    a[r - 1] = arAt(r - 1) * a0;
    if (steady) continue;
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) M[i * r + j] = arAt(i) * P[j]! + (i < r - 1 ? P[(i + 1) * r + j]! : 0);
    let change = 0;
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) {
      const val = M[i * r]! * arAt(j) + (j < r - 1 ? M[i * r + j + 1]! : 0) + Rv[i]! * Rv[j]!;
      change = Math.max(change, Math.abs(val - Pprev[i * r + j]!));
      Pp[i * r + j] = val;
    }
    P.set(Pp);
    if (change < 1e-12 && t > r && v === v) steady = true;
  }
  if (n < 2 || !Number.isFinite(ssq) || !Number.isFinite(sumLogF)) return null;
  return { ssq, sumLogF, n };
}

/** The objective R minimises for ML: 0.5 (log(sigma^2) + sum log F / n), sigma^2 = ssq / n. */
const mlValue = (l: Lik): number => 0.5 * (Math.log(l.ssq / l.n) + l.sumLogF / l.n);

/** The conditional sum of squares: residuals from the recursion with the first p values as given, earlier errors zero. */
export function cssValue(z: Float64Array, ar: number[], ma: number[]): number {
  const N = z.length, pe = ar.length, e = new Float64Array(N);
  let ss = 0, c = 0;
  for (let t = 0; t < N; t++) {
    if (t < pe || z[t]! !== z[t]!) { e[t] = 0; continue; }
    let pred = 0, bad = false;
    for (let i = 0; i < pe; i++) { const zz = z[t - 1 - i]!; if (zz !== zz) { bad = true; break; } pred += ar[i]! * zz; }
    if (bad) { e[t] = 0; continue; }
    for (let j = 0; j < ma.length && t - 1 - j >= 0; j++) pred += ma[j]! * e[t - 1 - j]!;
    e[t] = z[t]! - pred; ss += e[t]! * e[t]!; c++;
  }
  return c > 1 ? 0.5 * Math.log(ss / c) : NaN;
}

// ---------------------------------------------------------------- optimiser

export interface BfgsResult { x: number[]; value: number; iterations: number; converged: boolean }

/** BFGS with central-difference gradients and a backtracking line search (as optim's BFGS, which R's arima uses). */
export function bfgs(fn: (x: number[]) => number, x0: number[], opts: { maxIter?: number; tol?: number } = {}): BfgsResult {
  const n = x0.length, maxIter = opts.maxIter ?? 120, tol = opts.tol ?? 1e-8;
  const f = (x: number[]): number => { const v = fn(x); return Number.isFinite(v) ? v : 1e30; };
  const grad = (x: number[], fx: number): number[] => {
    void fx;
    return x.map((xi, i) => {
      const h = 1e-4 * Math.max(1, Math.abs(xi));
      const xp = x.slice(), xm = x.slice();
      xp[i] = xi + h; xm[i] = xi - h;
      return (f(xp) - f(xm)) / (2 * h);
    });
  };
  let x = x0.slice(), fx = f(x), g = grad(x, fx);
  if (n === 0) return { x, value: fx, iterations: 0, converged: true };
  let H: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let it = 0, converged = false;
  for (; it < maxIter; it++) {
    const gn = Math.sqrt(g.reduce((s, v) => s + v * v, 0));
    if (gn < 1e-7) { converged = true; break; }
    const dir = H.map((row) => -row.reduce((s, v, j) => s + v * g[j]!, 0));
    let slope = dir.reduce((s, v, i) => s + v * g[i]!, 0);
    if (!(slope < 0)) { H = H.map((row, i) => row.map((_, j) => (i === j ? 1 : 0))); for (let i = 0; i < n; i++) dir[i] = -g[i]!; slope = -gn * gn; }
    let step = it === 0 ? Math.min(1, 1 / gn) : 1, xn = x, fn2 = fx, ok = false;
    for (let ls = 0; ls < 40; ls++) {
      xn = x.map((xi, i) => xi + step * dir[i]!);
      fn2 = f(xn);
      if (fn2 <= fx + 1e-4 * step * slope) { ok = true; break; }
      step *= 0.5;
    }
    if (!ok) { if (it === 0) { converged = true; } else converged = true; break; }
    const gnew = grad(xn, fn2);
    const s = xn.map((v, i) => v - x[i]!), y = gnew.map((v, i) => v - g[i]!);
    const sy = s.reduce((acc, v, i) => acc + v * y[i]!, 0);
    const improvement = fx - fn2;
    x = xn; fx = fn2; g = gnew;
    if (sy > 1e-12) {
      const Hy = H.map((row) => row.reduce((acc, v, j) => acc + v * y[j]!, 0));
      const yHy = y.reduce((acc, v, i) => acc + v * Hy[i]!, 0);
      H = H.map((row, i) => row.map((v, j) => v + ((sy + yHy) * s[i]! * s[j]!) / (sy * sy) - (Hy[i]! * s[j]! + s[i]! * Hy[j]!) / sy));
    }
    if (improvement < tol * (Math.abs(fx) + tol)) { converged = true; it++; break; }
  }
  return { x, value: fx, iterations: it, converged };
}

// ---------------------------------------------------------------- fitting

export interface ArimaCoef { name: string; value: number; se: number | null }
export interface ArimaFit {
  spec: ArimaSpec;
  coefs: ArimaCoef[];
  phi: number[]; theta: number[]; Phi: number[]; Theta: number[];
  /** The constant of the differenced series (the mean or the per-difference drift), 0 when none. */
  mu: number;
  sigma2: number;
  loglik: number;
  aic: number; aicc: number; bic: number;
  /** Observations of the differenced series that were scored. */
  nUsed: number;
  /** Number of estimated parameters, the variance included. */
  k: number;
  /** One-step errors of the differenced series, in time order (NaN where undefined). */
  resid: Float64Array;
  /** The expanded AR and MA coefficients and the differencing polynomial. */
  ar: number[]; ma: number[]; dpoly: number[];
  /** The ML optimisation converged. */
  converged: boolean;
}

interface Layout { p: number; q: number; P: number; Q: number; mu: number }

function unpack(x: number[], spec: ArimaSpec, mu0 = 0, muScale = 1, freeMa = false): { phi: number[]; theta: number[]; Phi: number[]; Theta: number[]; mu: number } {
  let o = 0;
  const take = (n: number): number[] => { const v = x.slice(o, o + n); o += n; return v; };
  const phi = partrans(take(spec.p));
  const theta = freeMa ? take(spec.q) : partrans(take(spec.q)).map((v) => -v);
  const Phi = partrans(take(spec.P));
  const Theta = freeMa ? take(spec.Q) : partrans(take(spec.Q)).map((v) => -v);
  const mu = spec.constant ? mu0 + muScale * x[o]! : 0;
  return { phi, theta, Phi, Theta, mu };
}

/** The optimiser's coordinates for `spec` taken from another fit with the same differencing; null when they cannot be mapped. */
function warmStart(from: ArimaFit, spec: ArimaSpec, mu0: number, muScale: number): number[] | null {
  if (from.spec.d !== spec.d || from.spec.D !== spec.D || from.spec.m !== spec.m) return null;
  const raw = (c: ArrayLike<number>, n: number, sign: 1 | -1): number[] | null => {
    const r = invPartrans(Array.from(c, (v) => sign * v));
    if (r === null) return null;
    while (r.length < n) r.push(0);
    return r.slice(0, n);
  };
  const a = raw(from.phi, spec.p, 1), b = raw(from.theta, spec.q, -1), c = raw(from.Phi, spec.P, 1), d = raw(from.Theta, spec.Q, -1);
  if (!a || !b || !c || !d) return null;
  const x = [...a, ...b, ...c, ...d];
  if (spec.constant) x.push(from.spec.constant ? (from.mu - mu0) / muScale : 0);
  return x.every(Number.isFinite) ? x : null;
}

function centred(w: Float64Array, mu: number): Float64Array {
  if (mu === 0) return w;
  const z = new Float64Array(w.length);
  for (let t = 0; t < w.length; t++) z[t] = w[t]! - mu;
  return z;
}

/**
 * Fits one ARIMA specification to y (NaN = missing) by CSS then exact ML. Null when the model cannot be fitted
 * (too little data, a singular likelihood).
 */
export function fitArima(y: ArrayLike<number>, spec: ArimaSpec, opts: { se?: boolean; css?: boolean; from?: ArimaFit } = {}): ArimaFit | null {
  const m = spec.m;
  const w = difference(y, spec.d, spec.D, m);
  let nUsed = 0, sum = 0;
  for (let t = 0; t < w.length; t++) if (w[t]! === w[t]!) { nUsed++; sum += w[t]!; }
  const npar = spec.p + spec.q + spec.P + spec.Q + (spec.constant ? 1 : 0);
  const peMax = spec.p + m * spec.P, qeMax = spec.q + m * spec.Q;
  if (nUsed < npar + 4 || nUsed <= Math.max(peMax, qeMax) + 2) return null;
  const meanW = sum / nUsed;
  let ss = 0;
  for (let t = 0; t < w.length; t++) if (w[t]! === w[t]!) ss += (w[t]! - meanW) * (w[t]! - meanW);
  const muScale = Math.max(Math.sqrt(ss / nUsed), 1e-8 * (1 + Math.abs(meanW))) / Math.sqrt(nUsed);
  const x0 = new Array<number>(npar).fill(0);
  const coefsOf = (x: number[], freeMa = false) => {
    const u = unpack(x, spec, meanW, muScale, freeMa);
    return { ...u, ar: expandAr(u.phi, u.Phi, m), ma: expandMa(u.theta, u.Theta, m) };
  };
  // The constant's scale: a step for the optimiser that suits the level of the series.
  const cssObj = (x: number[]): number => { const c = coefsOf(x); return cssValue(centred(w, c.mu), c.ar, c.ma); };
  // ML on the free MA coefficients (the likelihood is the same on both sides of a unit root; arima() inverts afterwards).
  const mlObj = (x: number[]): number => {
    const c = coefsOf(x, true);
    const l = armaLik(centred(w, c.mu), c.ar, c.ma);
    return l ? mlValue(l) : 1e30;
  };
  // A warm start: the coefficients of a neighbouring or earlier fit of (nearly) the same model, in this model's layout, with any
  // new coefficient at zero. The likelihood is smooth and close to its optimum there, so the optimiser needs a few steps, not
  // the whole climb from zero.
  const warm = opts.from ? warmStart(opts.from, spec, meanW, muScale) : null;
  let start = x0;
  if (warm && !opts.css) start = warm;
  else if (npar > 0 && npar > (spec.constant ? 1 : 0)) {
    const css = bfgs(cssObj, warm ?? x0, { maxIter: 60 });
    if (Number.isFinite(css.value) && css.value < 1e29) start = css.x;
  }
  // The CSS answer, with the MA coefficients as plain values for the likelihood stage.
  const toFree = (x: number[]): number[] => {
    const u = unpack(x, spec, meanW, muScale, false);
    const out: number[] = [];
    out.push(...x.slice(0, spec.p), ...u.theta);
    out.push(...x.slice(spec.p + spec.q, spec.p + spec.q + spec.P), ...u.Theta);
    if (spec.constant) out.push(x[npar - 1]!);
    return out;
  };
  let est = toFree(start), converged = true;
  if (!opts.css) {
    if (npar > 0) {
      const ml = bfgs(mlObj, est, { maxIter: 120 });
      const ml0 = mlObj(toFree(x0));
      if (ml.value < 1e29) { est = ml.x; converged = ml.converged; }
      else if (ml0 < 1e29) { est = toFree(x0); converged = false; }
      else return null;
    }
  }
  const c = coefsOf(est, true) as { phi: number[]; theta: number[]; Phi: number[]; Theta: number[]; mu: number; ar: number[]; ma: number[] };
  // Reflect any MA root inside the unit circle: the same likelihood, the invertible representation.
  const thetaInv = maInvert(c.theta), ThetaInv = maInvert(c.Theta);
  c.theta = thetaInv; c.Theta = ThetaInv;
  c.ma = expandMa(c.theta, c.Theta, m);
  const l = armaLik(centred(w, c.mu), c.ar, c.ma);
  if (!l) return null;
  const sigma2 = l.ssq / l.n;
  const nU = l.n;
  const value = mlValue(l);
  const loglik = -0.5 * (2 * nU * value + nU + nU * Math.log(2 * Math.PI));
  const k = npar + 1;
  const aic = -2 * loglik + 2 * k;
  const aicc = aic + (2 * k * (k + 1)) / Math.max(1, nU - k - 1);
  const bic = aic + k * (Math.log(nU) - 2);
  // One-step errors: the Kalman innovations, rescaled; a second pass of the filter records them.
  const resid = innovations(centred(w, c.mu), c.ar, c.ma);
  const names: string[] = [];
  c.phi.forEach((_, i) => names.push(`ar${i + 1}`));
  c.theta.forEach((_, i) => names.push(`ma${i + 1}`));
  c.Phi.forEach((_, i) => names.push(`sar${i + 1}`));
  c.Theta.forEach((_, i) => names.push(`sma${i + 1}`));
  const values = [...c.phi, ...c.theta, ...c.Phi, ...c.Theta];
  let muName = "";
  if (spec.constant) muName = spec.d + spec.D === 0 ? "mean" : "drift";
  // The drift of the original series per period: a constant in a seasonal difference is m times the drift.
  const muValue = spec.constant ? (spec.d === 0 && spec.D > 0 ? c.mu / m : c.mu) : 0;
  const coefs: ArimaCoef[] = values.map((v, i) => ({ name: names[i]!, value: v, se: null }));
  if (spec.constant) coefs.push({ name: muName, value: muValue, se: null });
  const fit: ArimaFit = {
    spec, coefs, phi: c.phi, theta: c.theta, Phi: c.Phi, Theta: c.Theta, mu: c.mu, sigma2, loglik, aic, aicc, bic, nUsed: nU, k,
    resid, ar: c.ar, ma: c.ma, dpoly: diffPoly(spec.d, spec.D, m), converged,
  };
  if (opts.se && npar > 0) attachStandardErrors(fit, w, spec);
  return fit;
}

/** Standardised one-step errors (innovations scaled by the innovation sd), NaN where missing. */
function innovations(z: Float64Array, ar: number[], ma: number[]): Float64Array {
  const pe = ar.length, qe = ma.length, r = Math.max(pe, qe + 1), N = z.length;
  const out = new Float64Array(N).fill(NaN);
  // A plain (slow) filter that records the innovations: used once per fit.
  const a = new Float64Array(r), P = new Float64Array(r * r);
  const Rv = new Float64Array(r);
  Rv[0] = 1;
  for (let i = 1; i < r; i++) Rv[i] = i - 1 < qe ? ma[i - 1]! : 0;
  const T = new Float64Array(r * r);
  for (let i = 0; i < r; i++) { T[i * r] = i < pe ? ar[i]! : 0; if (i < r - 1) T[i * r + i + 1] = 1; }
  const mul = (U: Float64Array, V: Float64Array, tr: boolean): Float64Array => {
    const o = new Float64Array(r * r);
    for (let i = 0; i < r; i++) for (let k = 0; k < r; k++) { const u = U[i * r + k]!; if (u === 0) continue; for (let j = 0; j < r; j++) o[i * r + j] = o[i * r + j]! + u * (tr ? V[j * r + k]! : V[k * r + j]!); }
    return o;
  };
  const X = new Float64Array(r * r); let A: Float64Array = T.slice();
  for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) X[i * r + j] = Rv[i]! * Rv[j]!;
  for (let it = 0; it < 80; it++) {
    const AXA = mul(mul(A, X, false), A, true);
    let delta = 0;
    for (let i = 0; i < r * r; i++) { delta = Math.max(delta, Math.abs(AXA[i]!)); X[i] = X[i]! + AXA[i]!; }
    A = mul(A, A, false);
    if (delta < 1e-13 * (1 + Math.abs(X[0]!))) break;
  }
  P.set(X);
  for (let t = 0; t < N; t++) {
    const v = z[t]!;
    if (v === v) {
      const F = P[0]!, innov = v - a[0]!;
      out[t] = innov / Math.sqrt(F);
      for (let i = 0; i < r; i++) a[i] = a[i]! + (P[i * r]! * innov) / F;
      const Pc = P.slice();
      for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) P[i * r + j] = Pc[i * r + j]! - (Pc[i * r]! * Pc[j]!) / F;
    }
    const na = new Float64Array(r);
    for (let i = 0; i < r; i++) { let s = 0; for (let j = 0; j < r; j++) s += T[i * r + j]! * a[j]!; na[i] = s; }
    a.set(na);
    const TP = mul(T, P, false), TPT = mul(TP, T, true);
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) P[i * r + j] = TPT[i * r + j]! + Rv[i]! * Rv[j]!;
  }
  return out;
}

/** Standard errors from the numerical Hessian of the exact objective in the coefficient space, as arima() does. */
function attachStandardErrors(fit: ArimaFit, w: Float64Array, spec: ArimaSpec): void {
  const raw = [...fit.phi, ...fit.theta, ...fit.Phi, ...fit.Theta, ...(spec.constant ? [fit.mu] : [])];
  const n = raw.length;
  const obj = (c: number[]): number => {
    let o = 0;
    const take = (len: number): number[] => { const v = c.slice(o, o + len); o += len; return v; };
    const phi = take(spec.p), theta = take(spec.q), Phi = take(spec.P), Theta = take(spec.Q), mu = spec.constant ? c[o]! : 0;
    if (!isStationary(expandAr(phi, Phi, spec.m)) || !isStationary(expandAr(theta.map((v) => -v), Theta.map((v) => -v), spec.m))) return NaN;
    const l = armaLik(centred(w, mu), expandAr(phi, Phi, spec.m), expandMa(theta, Theta, spec.m));
    return l ? mlValue(l) : NaN;
  };
  const f0 = obj(raw);
  if (!Number.isFinite(f0)) return;
  const h = raw.map((v, i) => (spec.constant && i === n - 1 ? 0.1 * muScaleOf(w) : 1e-3 * Math.max(0.1, Math.abs(v))));
  const H: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const xp = raw.slice(), xm = raw.slice();
    xp[i] = raw[i]! + h[i]!; xm[i] = raw[i]! - h[i]!;
    const fp = obj(xp), fm = obj(xm);
    if (!Number.isFinite(fp) || !Number.isFinite(fm)) return;
    H[i]![i] = (fp - 2 * f0 + fm) / (h[i]! * h[i]!);
    for (let j = i + 1; j < n; j++) {
      const pp = raw.slice(), pm = raw.slice(), mp = raw.slice(), mm = raw.slice();
      pp[i] = raw[i]! + h[i]!; pp[j] = raw[j]! + h[j]!;
      pm[i] = raw[i]! + h[i]!; pm[j] = raw[j]! - h[j]!;
      mp[i] = raw[i]! - h[i]!; mp[j] = raw[j]! + h[j]!;
      mm[i] = raw[i]! - h[i]!; mm[j] = raw[j]! - h[j]!;
      const v = (obj(pp) - obj(pm) - obj(mp) + obj(mm)) / (4 * h[i]! * h[j]!);
      if (!Number.isFinite(v)) return;
      H[i]![j] = H[j]![i] = v;
    }
  }
  const cov = invert(H.map((row) => row.map((v) => v * fit.nUsed)));
  if (!cov) return;
  const drift = spec.d === 0 && spec.D > 0 ? 1 / spec.m : 1;
  fit.coefs.forEach((c, i) => {
    const v = cov[i]![i]!;
    c.se = v > 0 ? Math.sqrt(v) * (spec.constant && i === n - 1 ? drift : 1) : null;
  });
}

/** The scale of the constant's standard error, used for its step. */
function muScaleOf(w: Float64Array): number {
  let n = 0, s = 0;
  for (let t = 0; t < w.length; t++) if (w[t]! === w[t]!) { n++; s += w[t]!; }
  const mu = s / Math.max(1, n);
  let ss = 0;
  for (let t = 0; t < w.length; t++) if (w[t]! === w[t]!) ss += (w[t]! - mu) * (w[t]! - mu);
  return Math.max(Math.sqrt(ss / Math.max(1, n)), 1e-8) / Math.sqrt(Math.max(1, n));
}

function invert(M: number[][]): number[][] | null {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    if (Math.abs(A[piv]![c]!) < 1e-14) return null;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    const d = A[c]![c]!;
    for (let j = 0; j < 2 * n; j++) A[c]![j] = A[c]![j]! / d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r]![c]!; if (f !== 0) for (let j = 0; j < 2 * n; j++) A[r]![j] = A[r]![j]! - f * A[c]![j]!; }
  }
  return A.map((row) => row.slice(n));
}

/** True when 1 - a_1 z - ... - a_p z^p has every root outside the unit circle (Schur-Cohn through the PACF recursion). */
export function isStationary(ar: ArrayLike<number>): boolean {
  const p = ar.length;
  if (p === 0) return true;
  const a = Array.from(ar);
  for (let j = p - 1; j >= 0; j--) {
    const k = a[j]!;
    if (!(Math.abs(k) < 1)) return false;
    if (j === 0) break;
    const b = new Array<number>(j).fill(0);
    for (let i = 0; i < j; i++) b[i] = (a[i]! + k * a[j - 1 - i]!) / (1 - k * k);
    for (let i = 0; i < j; i++) a[i] = b[i]!;
  }
  return true;
}

// ---------------------------------------------------------------- unit-root tests and the number of differences

/**
 * The KPSS statistic for a level-stationary null (Kwiatkowski et al. 1992) with a Bartlett window of floor(3 sqrt(n) / 13)
 * lags, the rule used by recent versions of R's forecast::ndiffs (and by statsforecast, which follows it).
 */
export function kpssLevel(x: ArrayLike<number>): number {
  const v: number[] = [];
  for (let i = 0; i < x.length; i++) if (x[i]! === x[i]!) v.push(x[i]!);
  const n = v.length;
  if (n < 6) return 0;
  const mu = v.reduce((s, a) => s + a, 0) / n;
  const e = v.map((a) => a - mu);
  const l = Math.floor((3 * Math.sqrt(n)) / 13);
  let s2 = e.reduce((s, a) => s + a * a, 0) / n;
  for (let s = 1; s <= l; s++) {
    let g = 0;
    for (let t = s; t < n; t++) g += e[t]! * e[t - s]!;
    s2 += (2 / n) * (1 - s / (l + 1)) * g;
  }
  let cum = 0, sum = 0;
  for (let t = 0; t < n; t++) { cum += e[t]!; sum += cum * cum; }
  return sum / (n * n) / s2;
}
export const KPSS_CRITICAL_5 = 0.463;

/** KPSS with a null of stationarity around a straight-line trend: the residuals of a fit on time (5% critical value 0.146). */
export function kpssTrend(x: ArrayLike<number>): number {
  const v: number[] = [];
  for (let i = 0; i < x.length; i++) if (x[i]! === x[i]!) v.push(x[i]!);
  const n = v.length;
  if (n < 6) return 0;
  const tm = (n - 1) / 2, ym = v.reduce((s, a) => s + a, 0) / n;
  let sxy = 0, sxx = 0;
  for (let t = 0; t < n; t++) { sxy += (t - tm) * (v[t]! - ym); sxx += (t - tm) * (t - tm); }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const e = v.map((a, t) => a - ym - slope * (t - tm));
  const l = Math.floor((3 * Math.sqrt(n)) / 13);
  let s2 = e.reduce((s, a) => s + a * a, 0) / n;
  for (let s = 1; s <= l; s++) {
    let g = 0;
    for (let t = s; t < n; t++) g += e[t]! * e[t - s]!;
    s2 += (2 / n) * (1 - s / (l + 1)) * g;
  }
  let cum = 0, sum = 0;
  for (let t = 0; t < n; t++) { cum += e[t]!; sum += cum * cum; }
  return sum / (n * n) / s2;
}
export const KPSS_TREND_CRITICAL_5 = 0.146;

/** The seasonal strength of an STL fit with a periodic season (forecast's "seas" heuristic): 1 - Var(R) / Var(S + R). */
export function seasonalStrength(y: ArrayLike<number>, m: number): number {
  const n = y.length;
  if (m < 2 || n < 2 * m + 2) return 0;
  const fill = Float64Array.from(y as ArrayLike<number>);
  let last = NaN;
  for (let t = 0; t < n; t++) { if (fill[t]! === fill[t]!) last = fill[t]!; else if (last === last) fill[t] = last; }
  let first = NaN;
  for (let t = n - 1; t >= 0; t--) { if (fill[t]! === fill[t]!) first = fill[t]!; else fill[t] = first; }
  const cycles = Math.ceil(n / m);
  const f = stl(fill, m, { seasonal: 10 * cycles + 1, seasonalDeg: 0 });
  const v = (a: ArrayLike<number>): number => { let s = 0, s2 = 0; const k = a.length; for (let i = 0; i < k; i++) { s += a[i]!; s2 += a[i]! * a[i]!; } const mu = s / k; return s2 / k - mu * mu; };
  const rem = Array.from(f.remainder), both = rem.map((r, i) => r + f.seasonal[i]!);
  const vb = v(both);
  return vb > 0 ? Math.max(0, Math.min(1, 1 - v(rem) / vb)) : 0;
}
export const SEASONAL_STRENGTH_CUT = 0.64;

export function chooseDifferences(y: ArrayLike<number>, m: number, maxD = 2, maxSeasonalD = 1): { d: number; D: number; kpss: number[]; strength: number } {
  let D = 0;
  const strength = m > 1 ? seasonalStrength(y, m) : 0;
  if (m > 1 && strength > SEASONAL_STRENGTH_CUT) D = maxSeasonalD >= 1 ? 1 : 0;
  let x: Float64Array = D > 0 ? difference(y, 0, D, m) : Float64Array.from(y as ArrayLike<number>);
  const kpss: number[] = [];
  let d = 0;
  for (; d < maxD; d++) {
    const stat = kpssLevel(x);
    kpss.push(stat);
    if (!(stat > KPSS_CRITICAL_5)) break;
    x = difference(x, 1, 0, 1);
  }
  return { d, D, kpss, strength };
}

// ---------------------------------------------------------------- the search

export interface TriedModel { label: string; aicc: number; ok: boolean }
export interface SearchOptions {
  maxP?: number; maxQ?: number; maxPS?: number; maxQS?: number; maxOrder?: number;
  /** Search every order, not just the stepwise neighbourhood. */
  exhaustive?: boolean;
  /**
   * Fit each model during the search by the conditional sum of squares (scored with the exact likelihood at that estimate), then refit
   * the best few exactly. R does this for long series (over 150 points, or a season over 12), where the exact fit of every model is slow.
   */
  approximate?: boolean;
  /** Called after each model is fitted. */
  onProgress?: (info: { tried: number; best: string; bestAicc: number; current: string }) => void;
  /** Return true to stop early. */
  cancelled?: () => boolean;
}

export function autoArimaSearch(y: ArrayLike<number>, m: number, d: number, D: number, opts: SearchOptions = {}): { best: ArimaFit; tried: TriedModel[]; fits: ArimaFit[] } | null {
  const maxP = opts.maxP ?? 5, maxQ = opts.maxQ ?? 5, maxPS = m > 1 ? opts.maxPS ?? 2 : 0, maxQS = m > 1 ? opts.maxQS ?? 2 : 0, maxOrder = opts.maxOrder ?? 5;
  const allowMean = d + D === 0, allowDrift = d + D === 1;
  const constantOk = allowMean || allowDrift;
  const cache = new Map<string, { fit: ArimaFit | null }>();
  const tried: TriedModel[] = [];
  const fits: ArimaFit[] = [];
  let best: ArimaFit | null = null;
  const key = (s: ArimaSpec): string => `${s.p},${s.q},${s.P},${s.Q},${s.constant ? 1 : 0}`;
  const fit = (p: number, q: number, P: number, Q: number, constant: boolean, force = false): ArimaFit | null => {
    if (p < 0 || q < 0 || P < 0 || Q < 0 || p > maxP || q > maxQ || P > maxPS || Q > maxQS || (!force && p + q + P + Q > maxOrder)) return null;
    if (constant && !constantOk) return null;
    const spec: ArimaSpec = { p, d, q, P, D, Q, m, constant };
    const k = key(spec);
    const hit = cache.get(k);
    if (hit) return hit.fit;
    if (opts.cancelled?.()) return null;
    let f: ArimaFit | null = null;
    try { f = fitArima(y, spec, opts.approximate ? { css: true } : {}); } catch { f = null; }
    if (f && !Number.isFinite(f.aicc)) f = null;
    cache.set(k, { fit: f });
    tried.push({ label: specLabel(spec), aicc: f ? f.aicc : NaN, ok: !!f });
    if (f) fits.push(f);
    if (f && (!best || f.aicc < best.aicc)) best = f;
    opts.onProgress?.({ tried: tried.length, best: best ? specLabel(best.spec) : "", bestAicc: best ? best.aicc : NaN, current: specLabel(spec) });
    return f;
  };
  const betterThan = (f: ArimaFit | null, ref: ArimaFit | null): boolean => !!f && (!ref || f.aicc < ref.aicc);
  const c0 = constantOk;
  /** With an approximate search, the best few are refitted exactly and the winner is chosen among those. */
  const finish = (): { best: ArimaFit; tried: TriedModel[]; fits: ArimaFit[] } | null => {
    if (!best) return null;
    if (opts.approximate) {
      const leaders = [...fits].sort((a, b) => a.aicc - b.aicc).slice(0, 3);
      const exact: ArimaFit[] = [];
      for (const f of leaders) {
        if (opts.cancelled?.()) break;
        const e = fitArima(y, f.spec);
        if (e && Number.isFinite(e.aicc)) {
          exact.push(e);
          const at = tried.findIndex((t) => t.label === specLabel(f.spec));
          if (at >= 0) tried[at] = { label: tried[at]!.label, aicc: e.aicc, ok: true };
        }
      }
      if (exact.length) {
        best = exact.reduce((a, b) => (b.aicc < a.aicc ? b : a));
        const keep = new Set(exact.map((e) => specLabel(e.spec)));
        for (let i = 0; i < fits.length; i++) { const e = exact.find((x) => specLabel(x.spec) === specLabel(fits[i]!.spec)); if (e) fits[i] = e; }
        void keep;
      }
    }
    return { best, tried, fits };
  };
  if (opts.exhaustive) {
    for (let p = 0; p <= maxP; p++) for (let q = 0; q <= maxQ; q++) for (let P = 0; P <= maxPS; P++) for (let Q = 0; Q <= maxQS; Q++) {
      if (p + q + P + Q > maxOrder) continue;
      fit(p, q, P, Q, c0);
      if (constantOk) fit(p, q, P, Q, false);
    }
    return finish();
  }
  // The four starting models of auto.arima.
  fit(Math.min(2, maxP), Math.min(2, maxQ), Math.min(1, maxPS), Math.min(1, maxQS), c0, true);
  fit(0, 0, 0, 0, c0);
  if (maxP > 0 || maxPS > 0) fit(maxP > 0 ? 1 : 0, 0, m > 1 && maxPS > 0 ? 1 : 0, 0, c0);
  if (maxQ > 0 || maxQS > 0) fit(0, maxQ > 0 ? 1 : 0, 0, m > 1 && maxQS > 0 ? 1 : 0, c0);
  if (constantOk && best) { const b = (best as ArimaFit).spec; fit(b.p, b.q, b.P, b.Q, !b.constant); }
  // Stepwise: move to any neighbour that lowers the AICc, and start again from it.
  let guard = 0;
  while (best && guard++ < 200) {
    if (opts.cancelled?.()) break;
    const b = (best as ArimaFit).spec;
    const ref = best as ArimaFit;
    const moves: [number, number, number, number, boolean][] = [
      [b.p - 1, b.q, b.P, b.Q, b.constant], [b.p + 1, b.q, b.P, b.Q, b.constant],
      [b.p, b.q - 1, b.P, b.Q, b.constant], [b.p, b.q + 1, b.P, b.Q, b.constant],
      [b.p, b.q, b.P - 1, b.Q, b.constant], [b.p, b.q, b.P + 1, b.Q, b.constant],
      [b.p, b.q, b.P, b.Q - 1, b.constant], [b.p, b.q, b.P, b.Q + 1, b.constant],
      [b.p - 1, b.q - 1, b.P, b.Q, b.constant], [b.p + 1, b.q + 1, b.P, b.Q, b.constant],
      [b.p - 1, b.q + 1, b.P, b.Q, b.constant], [b.p + 1, b.q - 1, b.P, b.Q, b.constant],
      [b.p, b.q, b.P - 1, b.Q - 1, b.constant], [b.p, b.q, b.P + 1, b.Q + 1, b.constant],
      [b.p, b.q, b.P - 1, b.Q + 1, b.constant], [b.p, b.q, b.P + 1, b.Q - 1, b.constant],
      [b.p, b.q, b.P, b.Q, !b.constant],
    ];
    let moved = false;
    for (const [p, q, P, Q, c] of moves) {
      const f = fit(p, q, P, Q, c);
      if (betterThan(f, ref)) { moved = true; break; }
    }
    if (!moved) break;
  }
  return finish();
}

// ---------------------------------------------------------------- forecasts and checks

export interface ArimaForecast { F: Float64Array; se: Float64Array; lo80: Float64Array; hi80: Float64Array; lo95: Float64Array; hi95: Float64Array }

/** The psi weights of the whole model, differencing included. */
export function psiWeights(fit: ArimaFit, H: number): Float64Array {
  const full = (() => {
    // AR side: (1 - sum ar_i B^i) * (1 + sum c_j B^j) as a polynomial; the coefficients a*_i of y_t = sum a*_i y_{t-i} + ...
    const arPoly = [1, ...fit.ar.map((v) => -v)];
    const out = new Array<number>(arPoly.length + fit.dpoly.length - 1).fill(0);
    for (let i = 0; i < arPoly.length; i++) for (let j = 0; j < fit.dpoly.length; j++) out[i + j] = out[i + j]! + arPoly[i]! * fit.dpoly[j]!;
    return out.slice(1).map((v) => -v);
  })();
  const psi = new Float64Array(H);
  psi[0] = 1;
  for (let j = 1; j < H; j++) {
    let s = j - 1 < fit.ma.length ? fit.ma[j - 1]! : 0;
    for (let i = 1; i <= Math.min(j, full.length); i++) s += full[i - 1]! * psi[j - i]!;
    psi[j] = s;
  }
  return psi;
}

/** H forecasts from the end of y (NaN = missing at the end is bridged by the filter), with analytic 80% and 95% intervals. */
export function forecastArima(y: ArrayLike<number>, fit: ArimaFit, H: number): ArimaForecast {
  const spec = fit.spec, m = spec.m, N = y.length;
  const w = difference(y, spec.d, spec.D, m);
  const z = centred(w, fit.mu);
  const ar = fit.ar, ma = fit.ma, pe = ar.length, qe = ma.length, r = Math.max(pe, qe + 1);
  // Filter to the end of the series to get the state, then project the ARMA part.
  const a = new Float64Array(r), P = new Float64Array(r * r);
  const Rv = new Float64Array(r);
  Rv[0] = 1;
  for (let i = 1; i < r; i++) Rv[i] = i - 1 < qe ? ma[i - 1]! : 0;
  const T = new Float64Array(r * r);
  for (let i = 0; i < r; i++) { T[i * r] = i < pe ? ar[i]! : 0; if (i < r - 1) T[i * r + i + 1] = 1; }
  const mul = (U: Float64Array, V: Float64Array, tr: boolean): Float64Array => {
    const o = new Float64Array(r * r);
    for (let i = 0; i < r; i++) for (let k = 0; k < r; k++) { const u = U[i * r + k]!; if (u === 0) continue; for (let j = 0; j < r; j++) o[i * r + j] = o[i * r + j]! + u * (tr ? V[j * r + k]! : V[k * r + j]!); }
    return o;
  };
  const X = new Float64Array(r * r); let A: Float64Array = T.slice();
  for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) X[i * r + j] = Rv[i]! * Rv[j]!;
  for (let it = 0; it < 80; it++) {
    const AXA = mul(mul(A, X, false), A, true);
    let delta = 0;
    for (let i = 0; i < r * r; i++) { delta = Math.max(delta, Math.abs(AXA[i]!)); X[i] = X[i]! + AXA[i]!; }
    A = mul(A, A, false);
    if (delta < 1e-13 * (1 + Math.abs(X[0]!))) break;
  }
  P.set(X);
  const step = (): void => {
    const na = new Float64Array(r);
    for (let i = 0; i < r; i++) { let s = 0; for (let j = 0; j < r; j++) s += T[i * r + j]! * a[j]!; na[i] = s; }
    a.set(na);
    const TPT = mul(mul(T, P, false), T, true);
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) P[i * r + j] = TPT[i * r + j]! + Rv[i]! * Rv[j]!;
  };
  for (let t = 0; t < N; t++) {
    const v = z[t]!;
    if (v === v) {
      const F = P[0]!, innov = v - a[0]!;
      for (let i = 0; i < r; i++) a[i] = a[i]! + (P[i * r]! * innov) / F;
      const Pc = P.slice();
      for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) P[i * r + j] = Pc[i * r + j]! - (Pc[i * r]! * Pc[j]!) / F;
    }
    step();
  }
  const wf = new Float64Array(H);
  for (let h = 0; h < H; h++) { wf[h] = a[0]! + fit.mu; step(); }
  // Integrate the differences back: y_t = w_t - sum_{j>=1} c_j y_{t-j}.
  let carry = NaN;
  const full = Array.from({ length: N + H }, (_, t) => {
    if (t >= N) return NaN;
    const v = y[t]! as number;
    if (v === v) carry = v;
    return carry;
  });
  // A missing value inside the history is carried forward from the last real one for the integration.
  const dp = fit.dpoly;
  const F = new Float64Array(H);
  for (let h = 0; h < H; h++) {
    const t = N + h;
    let val = wf[h]!;
    for (let j = 1; j < dp.length; j++) { const prev = full[t - j]; val -= dp[j]! * (prev === undefined || prev !== prev ? 0 : prev); }
    full[t] = val; F[h] = val;
  }
  const psi = psiWeights(fit, H);
  const se = new Float64Array(H);
  let acc = 0;
  for (let h = 0; h < H; h++) { acc += psi[h]! * psi[h]!; se[h] = Math.sqrt(fit.sigma2 * acc); }
  const z80 = 1.2815516, z95 = 1.959964;
  const mk = (zv: number, sign: number): Float64Array => Float64Array.from(F, (f, h) => f + sign * zv * se[h]!);
  return { F, se, lo80: mk(z80, -1), hi80: mk(z80, 1), lo95: mk(z95, -1), hi95: mk(z95, 1) };
}

/**
 * Akaike weights (Buckland, Burnham and Augustin 1997): each model's weight is exp(-delta AICc / 2), normalised, over the models that
 * share the differencing. Those under a thousandth of the total are dropped, and at most eight kept.
 */
export function akaikeWeights(fits: ArimaFit[]): { fit: ArimaFit; weight: number }[] {
  const ok = fits.filter((f) => Number.isFinite(f.aicc)).sort((a, b) => a.aicc - b.aicc);
  if (!ok.length) return [];
  const top = ok[0]!.aicc;
  let rows = ok.map((f) => ({ fit: f, weight: Math.exp(-(f.aicc - top) / 2) }));
  const total = rows.reduce((a, b) => a + b.weight, 0);
  rows = rows.filter((r) => r.weight >= 1e-3 * total).slice(0, 8);
  const kept = rows.reduce((a, b) => a + b.weight, 0);
  return rows.map((r) => ({ fit: r.fit, weight: r.weight / kept }));
}

/**
 * The weighted average of the models' forecasts, with the 80% and 95% ranges from the mixture's variance: the weighted sum of each
 * model's squared standard error plus the squared distance of its forecast from the average.
 */
export function averageForecasts(y: ArrayLike<number>, team: { fit: ArimaFit; weight: number }[], H: number): ArimaForecast {
  const parts = team.map((t) => ({ f: forecastArima(y, t.fit, H), w: t.weight }));
  const F = new Float64Array(H), se = new Float64Array(H);
  for (let h = 0; h < H; h++) {
    let mu = 0;
    for (const p of parts) mu += p.w * p.f.F[h]!;
    let v = 0;
    for (const p of parts) v += p.w * (p.f.se[h]! ** 2 + (p.f.F[h]! - mu) ** 2);
    F[h] = mu; se[h] = Math.sqrt(v);
  }
  const mk = (zv: number, sign: number): Float64Array => Float64Array.from(F, (f, h) => f + sign * zv * se[h]!);
  return { F, se, lo80: mk(1.2815516, -1), hi80: mk(1.2815516, 1), lo95: mk(1.959964, -1), hi95: mk(1.959964, 1) };
}

export type WeightedFit = { fit: ArimaFit; weight: number };

/** One candidate differencing in the vote. */
export interface VoteGroup {
  d: number; D: number;
  /** Models of this differencing with their Akaike weights inside the group (summing to one). */
  team: WeightedFit[];
  /** Mean absolute h-step error on the modelled scale, from origins at the end of the history; NaN when it could not be scored. */
  err: number;
  /** The group's share of the vote, summing to one over the scored groups. */
  weight: number;
  /** The unit-root tests' choice. */
  unitRoot: boolean;
}

/**
 * DV-ARIMA: the differencing is chosen by a forecast vote, not only by the unit-root test. The search is run at the KPSS choice
 * and its neighbours (one more or fewer plain difference, the seasonal difference switched); each group's top three models, with
 * their orders held and coefficients refitted by the quick fit, forecast H steps from the last three origins (half a horizon
 * apart) of the history, and the groups are weighted by the inverse of their squared error. Inside a group, where the models
 * share a likelihood, Akaike weights decide. The forecast is the mixture over every model, each weighted by its group's share
 * times its own. Returns null when fewer than two groups can be scored (the plain AutoARIMA answer then stands).
 */
export function differencingVote(
  y: Float64Array, m: number, H: number, dd: { d: number; D: number }, base: WeightedFit[],
  opts: { approximate?: boolean; cancelled?: () => boolean; onGroup?: (d: number, D: number) => void } = {},
): { groups: VoteGroup[]; team: WeightedFit[] } | null {
  const keys: [number, number][] = [[dd.d, dd.D]];
  for (const d of [dd.d - 1, dd.d + 1]) if (d >= 0 && d <= 2 && d + dd.D <= 2) keys.push([d, dd.D]);
  if (m > 1 && dd.d + (1 - dd.D) <= 2) keys.push([dd.d, 1 - dd.D]);
  const n = y.length, step = Math.max(1, Math.round(H / 2)), floor = Math.max(3 * m, 20);
  const groups: VoteGroup[] = [];
  for (const [d, D] of keys) {
    if (opts.cancelled?.()) return null;
    const unitRoot = d === dd.d && D === dd.D;
    let team = base;
    if (!unitRoot) {
      opts.onGroup?.(d, D);
      const found = autoArimaSearch(y, m, d, D, { approximate: opts.approximate, cancelled: opts.cancelled });
      team = found ? akaikeWeights(found.fits) : [];
    }
    if (!team.length) continue;
    const top = team.slice(0, 3), tw = top.reduce((a, b) => a + b.weight, 0);
    let ae = 0, an = 0;
    for (let k = 0; k < 3; k++) {
      const o = n - H - k * step;
      if (o < floor) break;
      const seg = y.slice(0, o);
      const pred = new Float64Array(H);
      let ok = true;
      for (const tm of top) {
        const f = fitArima(seg, tm.fit.spec, { css: true });
        if (!f) { ok = false; break; }
        const F = forecastArima(seg, f, H).F;
        for (let h = 0; h < H; h++) pred[h] = pred[h]! + (tm.weight / tw) * F[h]!;
      }
      if (!ok) continue;
      for (let h = 0; h < H; h++) { const e = Math.abs(y[o + h]! - pred[h]!); if (e === e) { ae += e; an++; } }
    }
    groups.push({ d, D, team, err: an ? ae / an : NaN, weight: 0, unitRoot });
  }
  const scored = groups.filter((g) => Number.isFinite(g.err) && g.err > 0);
  if (scored.length < 2) return null;
  const inv = scored.map((g) => 1 / (g.err * g.err)), tot = inv.reduce((a, b) => a + b, 0);
  scored.forEach((g, i) => { g.weight = inv[i]! / tot; });
  const all: WeightedFit[] = [];
  for (const g of scored) for (const tm of g.team) all.push({ fit: tm.fit, weight: g.weight * tm.weight });
  all.sort((a, b) => b.weight - a.weight);
  const top = all.filter((x) => x.weight >= 1e-3).slice(0, 12), sum = top.reduce((a, b) => a + b.weight, 0);
  return { groups: scored, team: top.map((x) => ({ fit: x.fit, weight: x.weight / sum })) };
}

export interface ResidualCheck { n: number; lag: number; q: number; p: number; acf: number[]; crit: number }

/** Ljung-Box on the standardised one-step errors, with the degrees of freedom reduced by the ARMA parameters. */
export function residualCheck(fit: ArimaFit): ResidualCheck | null {
  const r = Array.from(fit.resid).filter((v) => v === v);
  const n = r.length;
  if (n < 20) return null;
  const mean = r.reduce((s, v) => s + v, 0) / n;
  let c0 = 0;
  for (const v of r) c0 += (v - mean) * (v - mean);
  const maxLag = Math.min(Math.max(fit.spec.m > 1 ? 2 * fit.spec.m : 20, 20), Math.floor(n / 4), 200);
  const acf: number[] = [];
  for (let k = 1; k <= maxLag; k++) { let s = 0; for (let i = k; i < n; i++) s += (r[i]! - mean) * (r[i - k]! - mean); acf.push(c0 > 0 ? s / c0 : 0); }
  const lag = Math.max(1, Math.min(fit.spec.m > 1 ? 2 * fit.spec.m : 10, Math.floor(n / 5), acf.length));
  let q = 0;
  for (let k = 1; k <= lag; k++) q += (acf[k - 1]! * acf[k - 1]!) / (n - k);
  q *= n * (n + 2);
  const fitdf = fit.spec.p + fit.spec.q + fit.spec.P + fit.spec.Q;
  const df = Math.max(1, lag - fitdf);
  return { n, lag, q, p: chiSquareSf(q, df), acf, crit: 1.96 / Math.sqrt(n) };
}
