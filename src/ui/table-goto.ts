/**
 * The Table's Go to box (Ctrl+G): a row by its place in the current order, the last
 * row, a share of the way down, a row by its number in the file, or a column by name.
 */

import { fuzzyRank } from "../search/fuzzy-match.js";

export type GoTo =
  /** 0-based position in the current order. */
  | { kind: "row"; position: number }
  /** 0-based dataset row (the file's own row number minus one). */
  | { kind: "file"; row: number }
  | { kind: "column"; index: number }
  | { kind: "error"; message: string };

const nf = new Intl.NumberFormat("en");

/** Reads what was typed; `count` is the rows in the current order. */
export function parseGoTo(text: string, count: number, columns: readonly string[]): GoTo {
  const t = text.trim();
  if (t === "") return { kind: "error", message: "Type a row number, -1 for the last row, 50% or a column name." };
  const lower = t.toLowerCase();
  if (count === 0 && /^[-\d]/.test(t)) return { kind: "error", message: "No rows to go to: the filters leave none." };

  if (["top", "first", "start", "head"].includes(lower)) return count ? { kind: "row", position: 0 } : { kind: "error", message: "No rows to go to." };
  if (["bottom", "last", "end", "tail"].includes(lower)) return count ? { kind: "row", position: count - 1 } : { kind: "error", message: "No rows to go to." };

  const file = /^(?:file|file row|f|id|row id)\s*#?\s*([\d,_ ]+)$/i.exec(t);
  if (file) {
    const n = Number(file[1]!.replace(/[,_ ]/g, ""));
    return n >= 1 ? { kind: "file", row: n - 1 } : { kind: "error", message: "File rows start at 1." };
  }

  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (pct) {
    const share = Number(pct[1]);
    if (share > 100) return { kind: "error", message: "A share of the way down goes from 0% to 100%." };
    return { kind: "row", position: Math.round((share / 100) * (count - 1)) };
  }

  if (/^[-+]?[\d,_ ]+$/.test(t)) {
    const n = Number(t.replace(/[,_ ]/g, ""));
    if (n === 0) return { kind: "error", message: "Rows start at 1; -1 is the last row." };
    if (Math.abs(n) > count) return { kind: "error", message: `There ${count === 1 ? "is 1 row" : `are ${nf.format(count)} rows`} in the current order.` };
    return { kind: "row", position: n > 0 ? n - 1 : count + n };
  }

  // A column: exact name first, then the closest by fuzzy match.
  const exact = columns.findIndex((name) => name.toLowerCase() === lower);
  if (exact >= 0) return { kind: "column", index: exact };
  const ranked = fuzzyRank(columns.map((name, index) => ({ name, index })), t, (c) => c.name);
  if (ranked.length) return { kind: "column", index: ranked[0]!.index };
  return { kind: "error", message: `No row or column matches “${t}”.` };
}
