export type HeaderCaseStyle = "keep" | "snake" | "camel" | "title" | "lower" | "upper";

export interface HeaderNormalizeOptions {
  caseStyle: HeaderCaseStyle;
  trim: boolean;
  stripBrackets: boolean;
  dedupe: boolean;
}

export const DEFAULT_HEADER_OPTIONS: HeaderNormalizeOptions = {
  caseStyle: "keep",
  trim: true,
  stripBrackets: true,
  dedupe: true,
};

const BRACKET_PAIRS: readonly [string, string][] = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
];

/** Removes wrapping bracket pairs, e.g. "[Annual Usage]" -> "Annual Usage". */
function stripWrappingBrackets(value: string): string {
  let out = value.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of BRACKET_PAIRS) {
      if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
        out = out.slice(1, -1).trim();
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Splits on punctuation/whitespace and camelCase/acronym boundaries, e.g.
 * "AnnualUsage" -> ["annual", "usage"], "HTTPResponse" -> ["http", "response"].
 */
function splitWords(value: string): string[] {
  const withBreaks = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return withBreaks
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word !== "");
}

function capitalize(word: string): string {
  return word === "" ? word : word[0].toUpperCase() + word.slice(1);
}

function applyCaseStyle(value: string, style: HeaderCaseStyle): string {
  switch (style) {
    case "keep":
      return value;
    case "lower":
      return value.toLowerCase();
    case "upper":
      return value.toUpperCase();
    case "snake":
      return splitWords(value).join("_");
    case "camel": {
      const words = splitWords(value);
      return words.length === 0 ? "" : words[0] + words.slice(1).map(capitalize).join("");
    }
    case "title":
      return splitWords(value).map(capitalize).join(" ");
  }
}

function normalizeHeaderName(
  raw: string,
  index: number,
  options: HeaderNormalizeOptions,
): string {
  let value = raw;
  if (options.trim) {
    value = value.trim();
    value = value.replace(/\s+/g, " ");
  }
  if (value === "") return `Column ${index + 1}`;
  if (options.stripBrackets) value = stripWrappingBrackets(value);
  const cased = applyCaseStyle(value, options.caseStyle).trim();
  return cased === "" ? `Column ${index + 1}` : cased;
}

function dedupeNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    let counter = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${name}_${counter}`;
      counter++;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function normalizeHeaders(
  headers: readonly string[],
  options: HeaderNormalizeOptions,
): string[] {
  const names = headers.map((header, index) => normalizeHeaderName(header, index, options));
  return options.dedupe ? dedupeNames(names) : names;
}
