/**
 * Hand-set row and column order for Pivot Views. An order is the list of label paths in the wanted sequence, so it
 * survives a recompute: a value not in the list (a filter brought it back) follows the listed ones, and a value no
 * longer present is ignored. Margin rows and columns ("All") always stay last.
 */
import type { PivotResult } from "./pivot.js";

const SEP = "\u001f";

export function orderKey(parts: readonly string[]): string {
  return parts.join(SEP);
}

/** Display position to source index. `pinned` trailing entries (margins) stay where they are. */
export function orderedIndexes(keys: readonly string[], saved: readonly string[] | undefined, pinned = 0): number[] {
  const n = keys.length;
  const free = Math.max(0, n - pinned);
  const indexes = Array.from({ length: n }, (_, index) => index);
  if (saved === undefined || saved.length === 0) return indexes;
  const rank = new Map(saved.map((key, index) => [key, index]));
  const placed = indexes.slice(0, free).sort((a, b) => {
    const ra = rank.get(keys[a]!) ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(keys[b]!) ?? Number.POSITIVE_INFINITY;
    return ra === rb ? a - b : ra - rb;
  });
  return [...placed, ...indexes.slice(free)];
}

/**
 * Moves the block of labels sharing `from`'s path down to `level` to just before or after `to`'s block, as the new order.
 * Null when nothing would change or the move is not allowed: a block stays inside its parent, and margins do not move.
 */
export function moveBlock(
  labels: readonly (readonly string[])[],
  level: number,
  from: number,
  to: number,
  after: boolean,
  pinned = 0,
): string[] | null {
  const free = labels.length - pinned;
  if (from < 0 || to < 0 || from >= free || to >= free) return null;
  const same = (a: number, b: number, depth: number): boolean => {
    for (let d = 0; d < depth; d++) if ((labels[a]?.[d] ?? "") !== (labels[b]?.[d] ?? "")) return false;
    return true;
  };
  if (!same(from, to, level)) return null;
  const block = (at: number): [number, number] => {
    let start = at;
    let end = at + 1;
    while (start > 0 && same(start - 1, at, level + 1)) start--;
    while (end < free && same(end, at, level + 1)) end++;
    return [start, end];
  };
  const [fromStart, fromEnd] = block(from);
  const [toStart, toEnd] = block(to);
  if (fromStart === toStart) return null;
  const insertAt = after ? toEnd : toStart;
  if (insertAt >= fromStart && insertAt <= fromEnd) return null;
  const all = labels.map((parts) => orderKey(parts));
  const moved = all.slice(fromStart, fromEnd);
  const before = all.slice(0, insertAt).filter((_, index) => index < fromStart || index >= fromEnd);
  const rest = all.slice(insertAt, free).filter((_, index) => index + insertAt < fromStart || index + insertAt >= fromEnd);
  return [...before, ...moved, ...rest];
}

const isIdentity = (order: readonly number[]): boolean => order.every((value, index) => value === index);

function permuted(values: Float64Array, order: readonly number[]): Float64Array {
  if (values.length !== order.length) return values;
  const out = new Float64Array(values.length);
  order.forEach((source, index) => {
    out[index] = values[source]!;
  });
  return out;
}

/** The pivot with its rows and columns in the given orders; the same object when they change nothing. */
export function reorderPivot<T extends PivotResult>(
  pivot: T,
  rowOrder: readonly string[] | undefined,
  colOrder: readonly string[] | undefined,
  pinnedRows = 0,
  pinnedCols = 0,
): T {
  const rows = orderedIndexes(pivot.rowLabels.map(orderKey), rowOrder, pinnedRows);
  const cols = orderedIndexes(pivot.colLabels.map(orderKey), colOrder, pinnedCols);
  if (isIdentity(rows) && isIdentity(cols)) return pivot;
  const colCount = cols.length;
  return {
    ...pivot,
    rowLabels: rows.map((index) => pivot.rowLabels[index]!),
    colLabels: cols.map((index) => pivot.colLabels[index]!),
    rowTimes: pivot.rowTimes.map((times) => permuted(times, rows)),
    colTimes: pivot.colTimes.map((times) => permuted(times, cols)),
    measures: pivot.measures.map((measure) => {
      const values = new Float64Array(measure.values.length);
      rows.forEach((sourceRow, row) => {
        cols.forEach((sourceCol, col) => {
          values[row * colCount + col] = measure.values[sourceRow * colCount + sourceCol]!;
        });
      });
      return {
        ...measure,
        values,
        rowTotals: permuted(measure.rowTotals, rows),
        colTotals: permuted(measure.colTotals, cols),
      };
    }),
  };
}

/** The shape of a grouped result this needs; rows here are groups, one array per dimension and measure. */
interface GroupedRows {
  labels: string[];
  dimensions: string[][];
  dimensionTimes: Float64Array[];
  measures: Float64Array[];
  partials: boolean[] | null;
  groupCount: number;
}

export function groupLabels(result: Pick<GroupedRows, "dimensions" | "groupCount">): string[][] {
  return Array.from({ length: result.groupCount }, (_, row) => result.dimensions.map((values) => values[row] ?? ""));
}

/** A rows-only result with its groups in the given order; the same object when that changes nothing. */
export function reorderGroups<T extends GroupedRows>(result: T, rowOrder: readonly string[] | undefined): T {
  const rows = orderedIndexes(groupLabels(result).map(orderKey), rowOrder);
  if (isIdentity(rows)) return result;
  return {
    ...result,
    labels: result.labels.length === rows.length ? rows.map((index) => result.labels[index]!) : result.labels,
    dimensions: result.dimensions.map((values) => rows.map((index) => values[index]!)),
    dimensionTimes: result.dimensionTimes.map((times) => permuted(times, rows)),
    measures: result.measures.map((values) => permuted(values, rows)),
    partials: result.partials === null ? null : rows.map((index) => result.partials![index]!),
  };
}
