import { looksLikeIdName } from "../data/identifier.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { alignsAsNumber } from "./table.js";

/**
 * How much a command would do to a column, and why, from facts the header has already worked out. A positive
 * score means there is something to act on (the reason says what); 0 means nothing is known either way; a
 * negative score means the command would change nothing (the reason says so), and the column sinks.
 */
export interface ColumnFit {
  score: number;
  reason: string;
}

const NUMERIC_VERBS = new Set(["round", "number", "repair", "knn", "winsorize", "flag"]);
const TEXT_VERBS = new Set(["trim", "upper", "lower", "title"]);

const plural = (count: number, one: string, many: string): string => `${count.toLocaleString()} ${count === 1 ? one : many}`;

export function columnBenefit(verb: string, meta: ColumnMeta): ColumnFit {
  const numeric = meta.type === "integer" || meta.type === "number";
  // Maths on an ID, a code or a postcode is never what was meant.
  if (NUMERIC_VERBS.has(verb) && looksLikeIdName(meta.name)) return { score: -1, reason: "an ID" };
  switch (verb) {
    case "fill":
    case "knn":
    case "nulls":
      return meta.stats.nulls > 0
        ? { score: meta.stats.nulls, reason: `${meta.stats.nulls.toLocaleString()} missing` }
        : { score: -1, reason: "nothing missing" };
    case "winsorize":
    case "flag":
      return meta.anomalyCounts.values > 0
        ? { score: meta.anomalyCounts.values, reason: plural(meta.anomalyCounts.values, "outlier", "outliers") }
        : { score: -1, reason: "no outliers" };
    case "merge":
      return meta.similarGroups > 0
        ? { score: meta.similarGroups, reason: plural(meta.similarGroups, "group of similar values", "groups of similar values") }
        : { score: -1, reason: "no similar values" };
    case "date":
    case "datetime": {
      if (meta.type === "date" || meta.type === "datetime") return { score: -1, reason: "already dates" };
      const date = meta.suggestions.find((suggestion) => suggestion.kind === "date");
      return date !== undefined ? { score: 50, reason: "looks like dates" } : { score: 0, reason: "" };
    }
    case "number": {
      if (numeric) return { score: -1, reason: "already numbers" };
      const looks = meta.suggestions.some((suggestion) => suggestion.kind === "number" || suggestion.kind === "mixedNumber");
      return looks ? { score: 50, reason: "looks like numbers" } : { score: 0, reason: "" };
    }
    case "repair": {
      const mixed = meta.suggestions.find((suggestion) => suggestion.kind === "mixedNumber");
      return mixed !== undefined && mixed.kind === "mixedNumber"
        ? { score: mixed.count, reason: plural(mixed.count, "value with the other decimal mark", "values with the other decimal mark") }
        : { score: 0, reason: "" };
    }
    case "escape": {
      const formula = meta.suggestions.find((suggestion) => suggestion.kind === "formula");
      return formula !== undefined && formula.kind === "formula"
        ? { score: formula.count, reason: plural(formula.count, "formula-like cell", "formula-like cells") }
        : { score: 0, reason: "" };
    }
    case "round":
      return meta.type === "integer" ? { score: -1, reason: "whole numbers" } : { score: 0, reason: "" };
    default:
      break;
  }
  if (TEXT_VERBS.has(verb)) {
    if (alignsAsNumber(meta)) return { score: -1, reason: "numbers only" };
    const variants = meta.variants;
    if (variants !== null && variants !== undefined && variants.groups > 0) {
      return { score: variants.minorityRows, reason: plural(variants.groups, "value spelled more than one way", "values spelled more than one way") };
    }
  }
  return { score: 0, reason: "" };
}

export interface RankedColumn {
  meta: ColumnMeta;
  index: number;
  fit: ColumnFit;
  /** The column the table's cursor is in. */
  selected: boolean;
}

/**
 * The columns a command fits, best first: the selected column, then where the command would do most, then the
 * file's order. Columns where it would change nothing come last. Provenance columns are left out.
 */
export function rankColumns(
  verb: string,
  columns: readonly ColumnMeta[],
  fits: (verb: string, meta: ColumnMeta) => boolean,
  cursorColumn: number | null,
): RankedColumn[] {
  const ranked: RankedColumn[] = [];
  columns.forEach((meta, index) => {
    if (meta.role === "provenance" || !fits(verb, meta)) return;
    ranked.push({ meta, index, fit: columnBenefit(verb, meta), selected: index === cursorColumn });
  });
  const band = (entry: RankedColumn): number => (entry.fit.score < 0 ? 0 : entry.selected ? 3 : entry.fit.score > 0 ? 2 : 1);
  return ranked.sort((a, b) => band(b) - band(a) || b.fit.score - a.fit.score || a.index - b.index);
}

/** The words after a command's hint: why this column (selected, or what there is to act on). */
export function fitNote(entry: RankedColumn): string {
  const parts: string[] = [];
  if (entry.selected) parts.push("selected column");
  if (entry.fit.reason !== "") parts.push(entry.fit.reason);
  return parts.join(" · ");
}
