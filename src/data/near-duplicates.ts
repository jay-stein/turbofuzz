import type { ColumnMeta } from "../worker/protocol.js";
import type { Finding } from "./findings.js";

/**
 * Columns that are unique on every row (ids, row numbers, GUIDs). Two records that
 * differ only in such a column are usually the same record entered twice.
 */
export function idLikeColumns(metas: readonly ColumnMeta[], rowCount: number): number[] {
  if (rowCount <= 20) return [];
  const out: number[] = [];
  metas.forEach((meta, column) => {
    if (meta.role === "provenance") return;
    if (meta.type !== "identifier" && meta.type !== "integer" && meta.type !== "string") return;
    if (meta.stats.nulls === 0 && meta.stats.distinct === rowCount) out.push(column);
  });
  return out;
}

/** The columns to compare when ignoring the id columns; empty when there is nothing to compare. */
export function columnsIgnoring(metas: readonly ColumnMeta[], ids: readonly number[]): number[] {
  const skip = new Set(ids);
  const rest: number[] = [];
  metas.forEach((meta, column) => {
    if (skip.has(column) || meta.role === "provenance") return;
    rest.push(column);
  });
  return rest.length >= 2 ? rest : [];
}

/** A review item: rows equal on every column except the id. */
export function nearDuplicateFinding(
  metas: readonly ColumnMeta[],
  ids: readonly number[],
  compared: readonly number[],
  duplicateRows: number,
  duplicateGroups: number,
): Finding | null {
  if (duplicateRows <= 0) return null;
  const idNames = ids.map((column) => `“${metas[column]?.name ?? "?"}”`).join(", ");
  return {
    id: "dupkey.ignoring-id",
    report: "quality.duplicates",
    severity: "review",
    title: `${duplicateRows.toLocaleString()} ${duplicateRows === 1 ? "row repeats" : "rows repeat"} another row when ${idNames} is ignored`,
    evidence: [
      { metric: "repeated rows", value: duplicateRows.toLocaleString(), n: duplicateRows },
      { metric: "groups", value: duplicateGroups.toLocaleString(), n: duplicateGroups },
      { metric: "ignored id", value: idNames, n: ids.length },
    ],
    impact: { rows: duplicateRows, columns: [...ids] },
    fixLabel: "Show duplicates",
    action: { kind: "keyDuplicates", columns: [...compared], label: `Duplicates ignoring ${idNames}` },
  };
}
