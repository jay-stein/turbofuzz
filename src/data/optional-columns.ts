import type { ColumnMeta } from "../worker/protocol.js";
import { nameHas } from "./name-hints.js";

/** An optional column's emptiness counts this much towards Completeness. */
export const OPTIONAL_COMPLETENESS_FACTOR = 0.25;

/** A column this empty, in an otherwise complete table, is probably blank by design. */
const OPTIONAL_EMPTY_SHARE = 0.3;
/** "Otherwise complete": every other column is at most this empty. */
const OTHERS_NEARLY_COMPLETE = 0.05;

/**
 * Columns that are probably optional: the name says so (notes, middle_name,
 * lot_number) or the column is more than 30% empty while every other column is
 * nearly complete. Titanic's Cabin is not auto-marked (Age is 20% empty too);
 * the user can still mark it, and the decision is theirs either way.
 */
export function detectOptionalColumns(
  metas: readonly ColumnMeta[],
  rowCount: number,
): Set<number> {
  const optional = new Set<number>();
  if (rowCount === 0) return optional;
  const emptyShare = metas.map((meta) => meta.stats.nulls / rowCount);
  metas.forEach((meta, column) => {
    if (meta.role === "provenance") return;
    if (nameHas(meta.name, "optional")) optional.add(column);
  });
  metas.forEach((meta, column) => {
    if (meta.role === "provenance" || (emptyShare[column] ?? 0) <= OPTIONAL_EMPTY_SHARE) return;
    const othersComplete = metas.every(
      (other, index) =>
        index === column ||
        other.role === "provenance" ||
        (emptyShare[index] ?? 0) <= OTHERS_NEARLY_COMPLETE ||
        optional.has(index),
    );
    if (othersComplete) optional.add(column);
  });
  return optional;
}

/** Detection plus the user's per-name overrides (true = optional, false = required). */
export function effectiveOptional(
  metas: readonly ColumnMeta[],
  rowCount: number,
  overrides: Readonly<Record<string, boolean>> = {},
): Set<number> {
  const optional = detectOptionalColumns(metas, rowCount);
  metas.forEach((meta, column) => {
    const override = overrides[meta.name];
    if (override === true) optional.add(column);
    else if (override === false) optional.delete(column);
  });
  return optional;
}
