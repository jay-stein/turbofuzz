const NULL_TOKENS = new Set([
  "",
  "null",
  "nil",
  "none",
  "n/a",
  "na",
  "nan",
  "-",
  "--",
  "?",
]);

export function isNullToken(value: string): boolean {
  return NULL_TOKENS.has(value.trim().toLowerCase());
}
