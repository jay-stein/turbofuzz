/**
 * The classical seasonality test of the Theta method: a series is seasonal at period m
 * when its lag-m autocorrelation is larger than 1.645 standard errors, the standard error
 * coming from Bartlett's formula over the shorter lags (a 90% two-sided test). Used by
 * R's forecast::thetaf and by the M4 competition's benchmark methods to decide whether to
 * deseasonalise.
 *
 * Assimakopoulos, V. and Nikolopoulos, K. (2000). The theta model: a decomposition
 * approach to forecasting. International Journal of Forecasting, 16(4), 521-530.
 * Makridakis, S., Spiliotis, E. and Assimakopoulos, V. (2020). The M4 Competition: 100,000
 * time series and 61 forecasting methods. International Journal of Forecasting, 36(1), 54-74.
 * Bartlett, M. S. (1946). On the theoretical specification and sampling properties of
 * autocorrelated time-series. Supplement to the Journal of the Royal Statistical Society, 8(1).
 */

export interface SeasonalityTest {
  /** False when there is too little history to test (under three cycles) or no cycle. */
  tested: boolean;
  seasonal: boolean;
  /** Lag-m autocorrelation. */
  r: number;
  /** The bar it has to clear: 1.645 standard errors. */
  limit: number;
}

const Z90 = 1.6448536269514722;

/** Tests y[0..n) for a season of m periods. Needs at least three cycles. */
export function seasonalityTest(y: ArrayLike<number>, n: number, m: number): SeasonalityTest {
  if (m <= 1 || n < 3 * m) return { tested: false, seasonal: false, r: NaN, limit: NaN };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += y[i]!;
  mean /= n;
  let c0 = 0;
  for (let i = 0; i < n; i++) c0 += (y[i]! - mean) * (y[i]! - mean);
  if (!(c0 > 0)) return { tested: true, seasonal: false, r: 0, limit: Infinity };
  const acf = (k: number): number => { let s = 0; for (let i = k; i < n; i++) s += (y[i]! - mean) * (y[i - k]! - mean); return s / c0; };
  let sq = 0;
  for (let k = 1; k < m; k++) { const r = acf(k); sq += r * r; }
  const limit = Z90 * Math.sqrt((1 + 2 * sq) / n), r = acf(m);
  return { tested: true, seasonal: Math.abs(r) > limit, r, limit };
}
