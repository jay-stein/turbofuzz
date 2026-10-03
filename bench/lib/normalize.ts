const MARKS = /\p{M}/gu;
const WHITESPACE = /\s+/g;
const NON_ALNUM = /[^a-z0-9]+/g;

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(MARKS, "")
    .toLowerCase()
    .trim()
    .replace(WHITESPACE, " ");
}

export function tokenize(value: string): string[] {
  return normalize(value).split(NON_ALNUM).filter(Boolean);
}
