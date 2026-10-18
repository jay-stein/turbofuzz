import type { PivotMessage } from "../worker/protocol.js";

export const PIVOT_CSV_CELL_CAP = 250_000;

export interface PivotCsvOptions {
  /** Flat one-row headers for Excel, or repeated pandas-style header rows. */
  headers: "flat" | "multi";
  /** Prefix = + - @ and leading tabs/CR with an apostrophe. */
  formulaSafe: boolean;
  /** Maximum cells (rows * columns) allowed in one export. */
  cellCap?: number;
  /** Export cells as a share of their row or column total. */
  marginPct?: "none" | "row" | "column";
}

const FORMULA_LIKE = /^[=+\-@\t\r]/;

export function pivotCsvCell(value: string, formulaSafe: boolean): string {
  return formulaSafe && FORMULA_LIKE.test(value) ? `'${value}` : value;
}

export function pivotCsvCellCount(pivot: PivotMessage): number {
  return (
    pivot.rowLabels.length *
    pivot.colLabels.length *
    Math.max(1, pivot.measures.length)
  );
}

/** Serialise a worker pivot into CSV rows without touching the DOM. */
export function pivotCsvRows(
  pivot: PivotMessage,
  options: PivotCsvOptions,
): { rows: string[][]; tooLarge: boolean } {
  const cap = options.cellCap ?? PIVOT_CSV_CELL_CAP;
  if (pivotCsvCellCount(pivot) > cap) return { rows: [], tooLarge: true };
  const rowNames = pivot.rowNames.length === 0 ? ["All"] : pivot.rowNames;
  const rowLabel = (row: number): string[] => {
    const parts = pivot.rowLabels[row] ?? [];
    return parts.length === 0 ? ["All"] : parts;
  };
  const colLabel = (col: number): string[] => {
    const parts = pivot.colLabels[col] ?? [];
    return parts.length === 0 ? ["All"] : parts;
  };
  const value = (measure: number, row: number, col: number): string => {
    const result = pivot.measures[measure];
    const raw = result?.values[row * pivot.colLabels.length + col];
    if (!Number.isFinite(raw)) return "";
    const total =
      options.marginPct === "row"
        ? result?.rowTotals[row]
        : options.marginPct === "column"
          ? result?.colTotals[col]
          : undefined;
    if (
      options.marginPct !== undefined &&
      options.marginPct !== "none" &&
      Number.isFinite(total) &&
      total !== 0
    ) {
      return `${((raw as number) / (total as number) * 100).toFixed(2)}%`;
    }
    return String(raw);
  };
  const rows: string[][] = [];
  if (options.headers === "flat") {
    rows.push([
      ...rowNames,
      ...pivot.measures.flatMap((measure) =>
        pivot.colLabels.map((_, col) => `${measure.name} / ${colLabel(col).join(" / ")}`),
      ),
    ]);
    for (let row = 0; row < pivot.rowLabels.length; row++) {
      rows.push([
        ...rowLabel(row),
        ...pivot.measures.flatMap((_, measure) =>
          pivot.colLabels.map((__, col) => value(measure, row, col)),
        ),
      ]);
    }
  } else {
    if (pivot.measures.length > 1) {
      rows.push([
        ...rowNames.map(() => ""),
        ...pivot.measures.flatMap((measure) =>
          pivot.colLabels.map(() => measure.name),
        ),
      ]);
    }
    const depths = Math.max(1, pivot.colNames.length);
    for (let depth = 0; depth < depths; depth++) {
      rows.push([
        ...rowNames.map(() => ""),
        ...pivot.measures.flatMap(() =>
          pivot.colLabels.map((_, col) => colLabel(col)[depth] ?? ""),
        ),
      ]);
    }
    for (let row = 0; row < pivot.rowLabels.length; row++) {
      rows.push([
        ...rowLabel(row),
        ...pivot.measures.flatMap((_, measure) =>
          pivot.colLabels.map((__, col) => value(measure, row, col)),
        ),
      ]);
    }
  }
  return {
    rows: rows.map((row) =>
      row.map((cell) => pivotCsvCell(cell, options.formulaSafe)),
    ),
    tooLarge: false,
  };
}
