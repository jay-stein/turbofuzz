/** Formats a numeric aggregate/imputed value without noisy float tails. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}
