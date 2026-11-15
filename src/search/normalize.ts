const DIACRITICS = /([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu;
const WHITESPACE = /\s+/g;
/** Printable ASCII only: NFD and the accent strip cannot change it, so only case and spacing need work. */
const PLAIN_ASCII = /^[\x20-\x7e]*$/;
/** Apostrophes are dropped, not split on: "McDonald's" -> "mcdonalds", "O'Brien" -> "obrien". */
const APOSTROPHES = /['’ʼ]/g;
/** Letters that do not decompose under NFD, folded to their plain-Latin spelling ("Ørsted" -> "orsted"). */
const FOLD_LETTERS = /[øđðłæœßþ]/g;
const FOLD_MAP: Record<string, string> = { "ø": "o", "đ": "d", "ð": "d", "ł": "l", "æ": "ae", "œ": "oe", "ß": "ss", "þ": "th" };
const NON_WORD = /[^\p{L}\p{N}]+/gu;

/**
 * Match-only normalization. Raw values are never modified; this produces the
 * comparison view used by contains/exact scans and the token index.
 *
 * - NFD decomposes accents, which are then stripped for Latin, Greek and
 *   Cyrillic bases ("José" -> "jose"). Marks in other scripts (for example
 *   Devanagari vowel signs) are preserved because they carry meaning.
 * - Case folding is Unicode-aware; whitespace is collapsed.
 */
export function normalize(value: string): string {
  // Most cells are plain ASCII: skip the NFD and accent passes (they dominated a first contains on a large column).
  if (PLAIN_ASCII.test(value)) {
    const lower = (value.includes("'") ? value.replace(APOSTROPHES, "") : value).toLowerCase();
    if (!lower.startsWith(" ") && !lower.endsWith(" ") && !lower.includes("  ")) return lower;
    return lower.trim().replace(WHITESPACE, " ");
  }
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "$1")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(FOLD_LETTERS, (c) => FOLD_MAP[c])
    .trim()
    .replace(WHITESPACE, " ");
}

export function tokenize(value: string): string[] {
  return normalize(value).split(NON_WORD).filter(Boolean);
}
