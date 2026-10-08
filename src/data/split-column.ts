import { ColumnData } from "./column.js";

export interface SplitColumnOp {
  kind: "splitColumn";
  column: number;
  pattern: string;
  regex: boolean;
  dropEmpty: boolean;
  dropOriginal: boolean;
  prefix: string;
}

export const MAX_SPLIT_COLUMNS = 50;

function captureGroupCount(source: string): number {
  let count = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === "(" && source[i + 1] !== "?") count++;
  }
  return count;
}

function compile(op: SplitColumnOp): (value: string) => string[] {
  if (!op.regex) {
    const delimiter = op.pattern;
    return (value) => value.split(delimiter);
  }
  let expression: RegExp;
  try {
    expression = new RegExp(op.pattern);
  } catch (error) {
    throw new Error(
      `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (captureGroupCount(expression.source) > 0) {
    return (value) => {
      const match = expression.exec(value);
      if (match === null || match.length <= 1) return [];
      return match.slice(1).map((part) => part ?? "");
    };
  }
  return (value) => value.split(expression);
}

function uniqueName(taken: Set<string>, base: string): string {
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base} (${suffix++})`;
  }
  return candidate;
}

/**
 * pandas str.split(expand=True) as a transform: splits one column into new
 * columns named prefix_1..prefix_n, where n is the largest part count across
 * rows (capped at MAX_SPLIT_COLUMNS). Parts are trimmed; empty parts are
 * dropped when requested (otherwise positions are preserved). In regex mode
 * the pattern's capture groups form the row's parts; without groups the value
 * is split on every match. Rows keep their order and other columns unchanged.
 */
export function applySplitColumn(columns: readonly ColumnData[], op: SplitColumnOp): ColumnData[] {
  const source = columns[op.column];
  if (source === undefined || op.pattern === "") return columns.slice();
  const split = compile(op);

  const rowCount = source.raw.length;
  const partsByRow: string[][] = new Array(rowCount);
  let maxParts = 0;
  for (let row = 0; row < rowCount; row++) {
    const value = source.raw[row];
    if (source.isNull(value)) {
      partsByRow[row] = [];
      continue;
    }
    let parts = split(value).map((part) => part.trim());
    if (op.dropEmpty) parts = parts.filter((part) => part !== "");
    partsByRow[row] = parts;
    if (parts.length > maxParts) maxParts = parts.length;
  }
  if (maxParts === 0) return columns.slice();
  if (maxParts > MAX_SPLIT_COLUMNS) {
    throw new Error(
      `Split would create ${maxParts} columns (limit ${MAX_SPLIT_COLUMNS}) — refine the delimiter or drop empty parts`,
    );
  }

  const prefix = op.prefix.trim() === "" ? source.name : op.prefix.trim();
  const taken = new Set(columns.map((column) => column.name));
  const names: string[] = [];
  for (let index = 0; index < maxParts; index++) {
    const name = uniqueName(taken, `${prefix}_${index + 1}`);
    taken.add(name);
    names.push(name);
  }

  const created = names.map((name, index) => {
    const raw = new Array<string>(rowCount);
    for (let row = 0; row < rowCount; row++) raw[row] = partsByRow[row][index] ?? "";
    return ColumnData.create(name, raw);
  });

  const before = op.dropOriginal ? columns.slice(0, op.column) : columns.slice(0, op.column + 1);
  const after = columns.slice(op.column + 1);
  return [...before, ...created, ...after];
}
