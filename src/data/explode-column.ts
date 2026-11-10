import { ColumnData } from "./column.js";

/**
 * pandas `df.explode`: a cell holding several values ("soccer;tennis;golf") becomes one row per value. Every other column is
 * repeated beside each piece, so the row's other facts follow it.
 */
export interface ExplodeColumnOp {
  kind: "explodeColumn";
  column: number;
  /** The text between the values, or a regular expression when `regex` is on. */
  pattern: string;
  regex: boolean;
  /** Strip spaces around each piece, so "a; b" gives "a" and "b". */
  trim: boolean;
  /** Make no row for an empty piece (a doubled or trailing delimiter). */
  dropEmpty: boolean;
}

export const MAX_EXPLODE_ROWS = 2_000_000;

function splitter(op: ExplodeColumnOp): (value: string) => string[] {
  if (!op.regex) {
    const delimiter = op.pattern;
    return (value) => value.split(delimiter);
  }
  let expression: RegExp;
  try {
    expression = new RegExp(op.pattern, "g");
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
  }
  return (value) => {
    // Split on each match without letting capture groups leak into the pieces.
    const parts: string[] = [];
    let last = 0;
    expression.lastIndex = 0;
    for (let match = expression.exec(value); match !== null; match = expression.exec(value)) {
      if (match[0] === "") {
        expression.lastIndex++;
        continue;
      }
      parts.push(value.slice(last, match.index));
      last = match.index + match[0].length;
    }
    parts.push(value.slice(last));
    return parts;
  };
}

/** One output row per piece; a blank cell, or one with nothing left to split, keeps its single row, as pandas does. */
export function applyExplodeColumn(columns: readonly ColumnData[], op: ExplodeColumnOp): ColumnData[] {
  const source = columns[op.column];
  if (source === undefined || op.pattern === "") return columns.slice();
  const split = splitter(op);
  const rowCount = source.raw.length;

  const sourceRow: number[] = [];
  const pieces: string[] = [];
  for (let row = 0; row < rowCount; row++) {
    const value = source.raw[row];
    if (source.isNull(value)) {
      sourceRow.push(row);
      pieces.push(value);
    } else {
      let parts = split(value);
      if (op.trim) parts = parts.map((part) => part.trim());
      if (op.dropEmpty) parts = parts.filter((part) => part !== "");
      if (parts.length === 0) parts = [""];
      for (const part of parts) {
        sourceRow.push(row);
        pieces.push(part);
      }
    }
    if (sourceRow.length > MAX_EXPLODE_ROWS) {
      throw new Error(`Explode would create more than ${MAX_EXPLODE_ROWS.toLocaleString()} rows — check the delimiter`);
    }
  }

  return columns.map((column, index) => {
    if (index === op.column) return ColumnData.create(column.name, pieces);
    const raw = new Array<string>(sourceRow.length);
    for (let i = 0; i < sourceRow.length; i++) raw[i] = column.raw[sourceRow[i]];
    const rebuilt = ColumnData.create(column.name, raw);
    rebuilt.setType(column.type);
    return rebuilt;
  });
}
