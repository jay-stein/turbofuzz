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
