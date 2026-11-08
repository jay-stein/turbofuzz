import type { ColumnPair, ColumnPairing, CompareSide, IgnoredColumns } from "./types.js";

/** Column names compare without case, spaces or punctuation: "Order ID" pairs with "order_id". */
export function columnNameKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Pairs the columns of A and B: hand-made pairs first (renames), then exact
 * names, then names that agree once case, spaces and punctuation are
 * dropped. Each column pairs at most once; the rest are added or removed.
 * Ignored columns are taken out afterwards, as if neither side had them: they
 * are not paired, key candidates, compared or reported as added or removed.
 */
export function pairColumns(
  a: CompareSide,
  b: CompareSide,
  manual: readonly { a: number; b: number }[] = [],
  ignore: IgnoredColumns = { a: [], b: [] },
): ColumnPairing {
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: ColumnPair[] = [];
  const take = (ai: number, bi: number, isManual: boolean): void => {
    usedA.add(ai);
    usedB.add(bi);
    pairs.push({ a: ai, b: bi, manual: isManual });
  };
  for (const pair of manual) {
    if (pair.a < 0 || pair.a >= a.columns.length || pair.b < 0 || pair.b >= b.columns.length) continue;
    if (usedA.has(pair.a) || usedB.has(pair.b)) continue;
    take(pair.a, pair.b, true);
  }
  const byExact = new Map<string, number>();
  const byKey = new Map<string, number>();
  b.columns.forEach((column, index) => {
    if (usedB.has(index)) return;
    if (!byExact.has(column.name)) byExact.set(column.name, index);
    const key = columnNameKey(column.name);
    if (!byKey.has(key)) byKey.set(key, index);
  });
  // Exact names win over loose ones, so do them in a first pass.
  a.columns.forEach((column, index) => {
    const match = byExact.get(column.name);
    if (match !== undefined && !usedB.has(match) && !usedA.has(index)) take(index, match, false);
  });
  a.columns.forEach((column, index) => {
    if (usedA.has(index)) return;
    const match = byKey.get(columnNameKey(column.name));
    if (match !== undefined && !usedB.has(match)) take(index, match, false);
  });
  pairs.sort((x, y) => x.a - y.a);
  const skipA = new Set(ignore.a);
  const skipB = new Set(ignore.b);
  const onlyA = a.columns.map((_, index) => index).filter((index) => !usedA.has(index));
  const onlyB = b.columns.map((_, index) => index).filter((index) => !usedB.has(index));
  const ignored: { a: number; b: number }[] = [
    ...pairs.filter((pair) => skipA.has(pair.a) || skipB.has(pair.b)).map((pair) => ({ a: pair.a, b: pair.b })),
    ...onlyA.filter((index) => skipA.has(index)).map((index) => ({ a: index, b: -1 })),
    ...onlyB.filter((index) => skipB.has(index)).map((index) => ({ a: -1, b: index })),
  ];
  return {
    pairs: pairs.filter((pair) => !skipA.has(pair.a) && !skipB.has(pair.b)),
    onlyA: onlyA.filter((index) => !skipA.has(index)),
    onlyB: onlyB.filter((index) => !skipB.has(index)),
    ignored,
  };
}
