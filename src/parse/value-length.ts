/** trim() allocation only when the value actually has edge whitespace. */
export function valueLength(value: string): number {
  const first = value.charCodeAt(0);
  const last = value.charCodeAt(value.length - 1);
  return first > 32 && last > 32 ? value.length : value.trim().length;
}
