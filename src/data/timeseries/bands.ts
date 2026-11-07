/**
 * Forecast bands at a level the person chooses. The models build two bands, 80% and 95%, from the spread of their own backtest
 * errors (forecast ± z × σ, fpp3 5.5). Any other level is the same shape rescaled: the distance from the forecast to the band
 * edge is multiplied by z(level) ÷ z(base), taking the nearer of the two built bands as the base. For a normal band that is the
 * band you would have got by asking for that level; where the model's band is not symmetric (a transformed series) it is a
 * close approximation. The "held-out" and "inside the band" checks stay at 80% and 95%, where they were measured.
 */

/** The standard normal quantile (Acklam's rational approximation, error below 1.2e-9). */
export function probit(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** The two-sided z for a central band holding `level` percent (80 gives 1.2816, 95 gives 1.96). */
export function zOfLevel(level: number): number {
  return probit(1 - (1 - level / 100) / 2);
}

export interface BandSource {
  F: ArrayLike<number>;
  lo80: ArrayLike<number>;
  hi80: ArrayLike<number>;
  lo95: ArrayLike<number>;
  hi95: ArrayLike<number>;
}

/** The band at `level` percent, as low and high edges. A series that cannot go below zero keeps its low edge at zero or above. */
export function bandAtLevel(f: BandSource, level: number, nonNeg: boolean): { lo: Float64Array; hi: Float64Array } {
  const base80 = level <= 87.5;
  const lo0 = base80 ? f.lo80 : f.lo95, hi0 = base80 ? f.hi80 : f.hi95;
  const k = Math.abs(level - (base80 ? 80 : 95)) < 1e-9 ? 1 : zOfLevel(level) / zOfLevel(base80 ? 80 : 95);
  const n = f.F.length;
  const lo = new Float64Array(n), hi = new Float64Array(n);
  for (let h = 0; h < n; h++) {
    const F = f.F[h]!;
    lo[h] = F - (F - lo0[h]!) * k;
    hi[h] = F + (hi0[h]! - F) * k;
    if (nonNeg && lo[h]! < 0) lo[h] = 0;
  }
  return { lo, hi };
}

/** Reads a typed level: a number from 50 up to 99.9, or null when it is empty or not usable. */
export function parseLevel(text: string): number | null {
  const v = Number(text.trim().replace("%", ""));
  if (text.trim() === "" || !Number.isFinite(v)) return null;
  return Math.round(Math.min(99.9, Math.max(50, v)) * 10) / 10;
}
