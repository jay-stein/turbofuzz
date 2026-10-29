/**
 * Masks the middle of a value, keeping `keepFirst` characters at the start and
 * `keepLast` at the end. Emails keep the first `keepFirst` (at least one)
 * characters of the name and the whole domain (j***@example.com). Empty values are
 * returned as they are.
 */
export function maskEdges(value: string, keepFirst: number, keepLast: number): string {
  const trimmed = value.trim();
  if (trimmed === "") return value;
  const first = Math.max(0, Math.floor(keepFirst));
  const last = Math.max(0, Math.floor(keepLast));
  const at = trimmed.lastIndexOf("@");
  if (at > 0) return `${trimmed.slice(0, Math.max(1, first))}***${trimmed.slice(at)}`;
  if (trimmed.length <= first + last) return "*".repeat(trimmed.length);
  const stars = "*".repeat(Math.min(8, Math.max(3, trimmed.length - first - last)));
  return `${trimmed.slice(0, first)}${stars}${last > 0 ? trimmed.slice(-last) : ""}`;
}

/** Display mask next to a "possibly sensitive" flag: first character and last two. */
export function maskValue(value: string): string {
  return maskEdges(value, 1, 2);
}
