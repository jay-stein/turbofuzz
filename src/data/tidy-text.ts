import type { CleanOp } from "./clean-ops.js";
import type { ColumnType } from "../types.js";

/**
 * Tidy text: the big hammer for the commonest mess in text columns. Spaces at the
 * ends (and doubled inside) go, and values that differ only in capitals become the
 * form the column uses most ("nsw", "Nsw" and "NSW" all become NSW when NSW is the
 * most common). Nothing else is touched: no style is forced on a column, accents and
 * punctuation stay, and ID columns are left alone ("ab12" and "AB12" may be two ids).
 */

/** One change: every spelling in a group that becomes `to`. One tick each in the preview. */
export interface TidyGroup {
  /** What every spelling becomes. */
  to: string;
  /** The spellings that change, as written, with their row counts (most rows first). */
  from: { value: string; count: number }[];
  /** Rows that change. */
  rows: number;
  /** "spaces" when only spacing changes, "capitals" when capitals change too. */
  kind: "spaces" | "capitals";
}

export interface TidyColumn {
  column: number;
  name: string;
  groups: TidyGroup[];
  /** Rows that change in this column. */
  rows: number;
}

/** Columns tidied: words and labels, never ids, numbers, dates or flags. */
export function tidyableType(type: ColumnType): boolean {
  return type === "string" || type === "category";
}

const collapse = (value: string): string => value.trim().replace(/\s+/g, " ");
// The most common form wins; on a tie, Title Case or lower case over SHOUTING, except short codes (US, NSW), which are capitals.
const shout = (value: string): number => {
  if (value === value.toLowerCase() || value !== value.toUpperCase()) return 0;
  return value.replace(/[^A-Za-z]/g, "").length <= 3 ? -1 : 1;
};

/**
 * Plans the tidy for one column from its values and their row counts (missing
 * values already left out). Groups come most rows first, so the preview leads
 * with what matters.
 */
export function planTidyColumn(counts: ReadonlyMap<string, number>): TidyGroup[] {
  // Spellings that are the same once spaces are tidied and capitals ignored.
  const byKey = new Map<string, Map<string, number>>();
  for (const [value, count] of counts) {
    const tidy = collapse(value);
    if (tidy === "") continue;
    const key = tidy.toLowerCase();
    let forms = byKey.get(key);
    if (forms === undefined) byKey.set(key, (forms = new Map()));
    forms.set(value, (forms.get(value) ?? 0) + count);
  }
  const groups: TidyGroup[] = [];
  for (const forms of byKey.values()) {
    // The target: the tidied form with the most rows behind it.
    const tidied = new Map<string, number>();
    for (const [value, count] of forms) tidied.set(collapse(value), (tidied.get(collapse(value)) ?? 0) + count);
    const to = [...tidied.entries()].sort((a, b) => b[1] - a[1] || shout(a[0]) - shout(b[0]) || (a[0] < b[0] ? -1 : 1))[0]![0];
    const from = [...forms.entries()]
      .filter(([value]) => value !== to)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
    if (from.length === 0) continue;
    const kind = from.every((entry) => collapse(entry.value) === to) ? "spaces" : "capitals";
    groups.push({ to, from, rows: from.reduce((sum, entry) => sum + entry.count, 0), kind });
  }
  return groups.sort((a, b) => b.rows - a.rows || (a.to < b.to ? -1 : 1));
}

/**
 * The clean steps for the ticked groups of one column. Recode matches on the
 * trimmed value, so one pair both trims and fixes capitals. When every group that
 * only needs its ends trimmed is ticked, one Trim step covers them instead of a pair
 * each (a names column can have thousands), and runs first so the pairs see trimmed values.
 */
export function tidyOps(groups: readonly TidyGroup[], ticked: (group: TidyGroup) => boolean): CleanOp[] {
  const endsOnly = (group: TidyGroup): boolean => group.from.every((entry) => entry.value.trim() === group.to);
  const trimAll = groups.filter(endsOnly).every(ticked) && groups.some(endsOnly);
  const pairs = new Map<string, string>();
  for (const group of groups) {
    if (!ticked(group) || (trimAll && endsOnly(group))) continue;
    for (const entry of group.from) {
      const key = entry.value.trim();
      if (key !== group.to) pairs.set(key, group.to);
      // A form that only needs trimming, without a Trim step: map it to itself, which trims it.
      else if (!trimAll) pairs.set(key, group.to);
    }
  }
  const ops: CleanOp[] = [];
  if (trimAll) ops.push({ kind: "trim" });
  if (pairs.size > 0) ops.push({ kind: "recode", pairs: [...pairs.entries()] });
  return ops;
}
