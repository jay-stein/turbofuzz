import type { ColumnType } from "../types.js";

/**
 * Charts can group by any column except floats and identifiers, as long as the
 * value list stays small enough to draw. Each group costs one bitset in the
 * worker, so the cap bounds both legend clutter and memory.
 */
export const MAX_GROUP_DISTINCT = 100;

export function isGroupableColumn(type: ColumnType, distinct: number): boolean {
  if (type === "category" || type === "boolean") return true;
  if (type === "number" || type === "identifier") return false;
  return distinct >= 1 && distinct <= MAX_GROUP_DISTINCT;
}
