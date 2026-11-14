import { diffValue } from "./diffs.js";
import { pairFamily } from "./values.js";
import { ROW_CHANGED, ROW_ONLY_A, ROW_ONLY_B, type ColumnPairing, type CompareSide, type MatchResult } from "./types.js";

export interface Table {
  headers: string[];
  rows: string[][];
}

export interface ChangeTables {
  /** One line per changed cell, and one per row only one side has. */
  changes: Table;
  /** The rows only in A, and only in B, with every column of that side. */
  onlyA: Table;
  onlyB: Table;
  /** Lines left out of `changes` beyond the cap. */
  truncated: number;
}

/** Changes lines at most: well inside a spreadsheet's 1,048,576 rows. */
export const CHANGES_CAP = 1_000_000;

const STATUS: Record<number, string> = {
  [ROW_CHANGED]: "changed",
  [ROW_ONLY_A]: "only in A",
  [ROW_ONLY_B]: "only in B",
};

/**
 * The differences as tables to save: the key (when rows matched on one), each
 * side's file row number, the status, and for a changed cell the column with
 * its value in A and in B. Rows only one side has get one line each here, and
 * all their cells in their own table.
 */
export function changeTables(
  a: CompareSide,
  b: CompareSide,
  pairing: ColumnPairing,
  match: MatchResult,
  keyPairs: readonly number[] | null,
  cap = CHANGES_CAP,
): ChangeTables {
  const keys = (keyPairs ?? []).map((index) => pairing.pairs[index]).filter((pair) => pair !== undefined);
  const headers = [...keys.map((pair) => a.columns[pair.a]!.name), "A row", "B row", "status", "column", "value in A", "value in B"];
  const rows: string[][] = [];
  let truncated = 0;
  const onlyA: string[][] = [];
  const onlyB: string[][] = [];
  for (let i = 0; i < match.status.length; i++) {
    const status = match.status[i]!;
    if (status !== ROW_CHANGED && status !== ROW_ONLY_A && status !== ROW_ONLY_B) continue;
    const ar = match.aRow[i]!;
    const br = match.bRow[i]!;
    const keyCells = keys.map((pair) => (ar >= 0 ? a.columns[pair.a]!.raw[ar] : b.columns[pair.b]!.raw[br]) ?? "");
    const lead = [...keyCells, ar < 0 ? "" : String(ar + 1), br < 0 ? "" : String(br + 1), STATUS[status]!];
    if (status === ROW_CHANGED) {
      pairing.pairs.forEach((pair, p) => {
        if (!match.changed[p]!.get(i)) return;
        if (rows.length >= cap) {
          truncated++;
          return;
        }
        rows.push([...lead, b.columns[pair.b]!.name, a.columns[pair.a]!.raw[ar] ?? "", b.columns[pair.b]!.raw[br] ?? ""]);
      });
      continue;
    }
    if (rows.length >= cap) truncated++;
    else rows.push([...lead, "", "", ""]);
    if (status === ROW_ONLY_A) onlyA.push(a.columns.map((column) => column.raw[ar] ?? ""));
    else onlyB.push(b.columns.map((column) => column.raw[br] ?? ""));
  }
  return {
    changes: { headers, rows },
    onlyA: { headers: a.columns.map((column) => column.name), rows: onlyA },
    onlyB: { headers: b.columns.map((column) => column.name), rows: onlyB },
    truncated,
  };
}

/** A number as a cell: float noise from subtracting (0.30000000000000004) is rounded off; blank when undefined. */
function numberCell(value: number): string {
  return value === value ? String(Number(value.toPrecision(12))) : "";
}

/**
 * The rows that differ as one table, to analyse in the workspace: `_change`
 * (changed, only in A, only in B), the key column(s), then each compared
 * column with a change as `<name> (A)`, `<name> (B)` and, for numbers,
 * `<name> (B − A)`; a column with no change appears once. The same rows and
 * statuses as the Changes exports, one line per row instead of per cell.
 */
export function differencesTable(
  a: CompareSide,
  b: CompareSide,
  pairing: ColumnPairing,
  match: MatchResult,
  keyPairs: readonly number[] | null,
): Table {
  const keySet = new Set(keyPairs ?? []);
  const keys = [...keySet].map((index) => pairing.pairs[index]).filter((pair) => pair !== undefined);
  const headers = ["_change", ...keys.map((pair) => a.columns[pair.a]!.name)];
  const parts: { a: CompareSide["columns"][number]; b: CompareSide["columns"][number]; changed: boolean; numeric: boolean }[] = [];
  const nums = new Map<number, { x: Float64Array; y: Float64Array }>();
  pairing.pairs.forEach((pair, index) => {
    if (keySet.has(index)) return;
    const ca = a.columns[pair.a]!;
    const cb = b.columns[pair.b]!;
    const changed = match.changed[index]!.count() > 0;
    const numeric = changed && pairFamily(ca, cb) === "number";
    if (numeric) nums.set(parts.length, { x: ca.numbers(), y: cb.numbers() });
    parts.push({ a: ca, b: cb, changed, numeric });
    if (changed) headers.push(`${cb.name} (A)`, `${cb.name} (B)`, ...(numeric ? [`${cb.name} (B − A)`] : []));
    else headers.push(cb.name);
  });
  const rows: string[][] = [];
  for (let i = 0; i < match.status.length; i++) {
    const status = match.status[i]!;
    if (status !== ROW_CHANGED && status !== ROW_ONLY_A && status !== ROW_ONLY_B) continue;
    const ar = match.aRow[i]!;
    const br = match.bRow[i]!;
    const row = [STATUS[status]!, ...keys.map((pair) => (ar >= 0 ? a.columns[pair.a]!.raw[ar] : b.columns[pair.b]!.raw[br]) ?? "")];
    parts.forEach((part, p) => {
      const av = ar >= 0 ? (part.a.raw[ar] ?? "") : "";
      const bv = br >= 0 ? (part.b.raw[br] ?? "") : "";
      if (!part.changed) {
        row.push(ar >= 0 ? av : bv);
        return;
      }
      row.push(av, bv);
      if (part.numeric) {
        const n = nums.get(p)!;
        row.push(ar >= 0 && br >= 0 ? numberCell(diffValue("sub", n.x[ar]!, n.y[br]!)) : "");
      }
    });
    rows.push(row);
  }
  return { headers, rows };
}
