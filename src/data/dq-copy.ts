/**
 * Plain-English wording for the Quality page. Every sentence is a template over
 * numbers the app computed; none claims anything about the user's downstream tools
 * or intent. Fuzzy and inferred items use hedged wording ("may be").
 */
export const n = (value: number): string => Math.round(value).toLocaleString();

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** “+9 pts”, “+1 pt”, “+0.4 pts”. */
export function pointsLabel(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `+${text} ${rounded === 1 ? "pt" : "pts"}`;
}

/** Percentage rounded to a whole number, “<1%” when above zero but under one percent. */
export function percentLabel(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const share = (part / whole) * 100;
  return share < 1 ? "<1%" : `${Math.round(share)}%`;
}

function quoted(values: readonly string[], limit = 3): string {
  const shown = values.slice(0, limit).map((value) => `“${value}”`);
  const more = values.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

export const IMPACT = {
  variants: (column: string, before: number, after: number): string =>
    `A pivot by “${column}” shows ${n(before)} groups instead of ${n(after)}.`,

  placeholders: (cells: number, tokens: readonly string[]): string =>
    `${n(cells)} ${plural(cells, "cell says", "cells say")} ${quoted(tokens)} instead of being empty.`,

  unreadable: (count: number): string =>
    `${n(count)} ${plural(count, "value is", "values are")} read as text, so sums and charts skip ${plural(count, "it", "them")}.`,

  offFormat: (count: number): string =>
    `${n(count)} ${plural(count, "value breaks", "values break")} the usual format of this column.`,

  empty: (count: number, rows: number): string =>
    `${n(count)} of ${n(rows)} ${plural(rows, "row has", "rows have")} no value here.`,

  duplicates: (rows: number): string =>
    `${n(rows)} ${plural(rows, "row repeats", "rows repeat")} another row exactly.`,

  placeholderCode: (count: number): string =>
    `${n(count)} ${plural(count, "cell", "cells")} may be a placeholder code rather than a real value.`,

  mixedDecimals: (count: number): string =>
    `${n(count)} ${plural(count, "value uses", "values use")} the other decimal mark, so ${plural(count, "it is", "they are")} read as a different number.`,

  negatives: (min: number): string =>
    `The smallest value is ${n(min)}, below zero.`,
} as const;

export const TITLES = {
  variants: (column: string, spellings: number, values: number): string =>
    `“${column}” has ${n(spellings)} spellings of ${n(values)} ${plural(values, "value", "values")}`,

  variantsAndPlaceholders: (column: string, spellings: number, values: number, cells: number): string =>
    `${TITLES.variants(column, spellings, values)}, plus ${n(cells)} ${plural(cells, "placeholder", "placeholders")}`,

  placeholders: (column: string, cells: number): string =>
    `“${column}” has ${n(cells)} ${plural(cells, "placeholder", "placeholders")} stored as text`,

  unreadable: (column: string, count: number, typeLabel: string): string =>
    `“${column}” has ${n(count)} ${plural(count, "value", "values")} that ${plural(count, "is", "are")} not ${typeLabel}`,

  offFormat: (column: string, count: number): string =>
    `“${column}” has ${n(count)} ${plural(count, "value", "values")} in an unusual format`,

  empty: (column: string, count: number): string =>
    `“${column}” has ${n(count)} empty ${plural(count, "cell", "cells")}`,

  duplicates: (rows: number): string =>
    `${n(rows)} ${plural(rows, "row is", "rows are")} exact duplicates`,
} as const;

const SEPARATOR_WORDS: Record<string, string> = {
  " ": "a space",
  "-": "a dash",
  "/": "a slash",
  ".": "a dot",
  ",": "a comma",
  ":": "a colon",
  "@": "an at sign",
  _: "an underscore",
  "(": "a bracket",
  ")": "a bracket",
  "+": "a plus",
  "#": "a hash",
};

/**
 * Describes a character mask in words so no raw mask ever reaches the page:
 * “A A” becomes “letters, a space, letters”, “9-9” becomes “digits, a dash, digits”.
 * (A = letters, 9 = digits; anything else is a separator.)
 */
export function maskToWords(mask: string): string {
  const parts: string[] = [];
  for (const char of mask) {
    if (char === "A") parts.push("letters");
    else if (char === "9") parts.push("digits");
    else parts.push(SEPARATOR_WORDS[char] ?? `“${char}”`);
  }
  return parts.join(", ");
}
