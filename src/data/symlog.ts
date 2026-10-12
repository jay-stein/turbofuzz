/**
 * Symmetric log transform for histogram axes on heavy-tailed columns. Positive
 * and negative values are compressed the same way, so a column spanning -50k
 * to 20B still spreads its bulk across the bins instead of one spike.
 */
export function symlog(value: number): number {
  return value < 0 ? -Math.log1p(-value) : Math.log1p(value);
}

export function symlogInverse(t: number): number {
  return t < 0 ? -Math.expm1(-t) : Math.expm1(t);
}
