import type { ArchetypeId } from "../data/archetype.js";
import { type DimensionSpec, isCompleteView, type MeasureSpec, type TimeGrain, type ViewDef } from "../data/aggregate.js";
import { nameHas } from "../data/name-hints.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { aggShort } from "./agg-words.js";
import { isAdditiveName, isBadCategoryName, isGoodCategoryName, isMoneyName, isRateName } from "./chart-names.js";
import { isIdLikeColumn } from "./chart-utils.js";

/** Groups a view keeps before the rest are folded away. */
export const DEFAULT_LIMIT = 500;

/** A name that says what the view shows ("Sum of revenue by state"), or null while it is incomplete. */
export function autoViewName(def: ViewDef, columns: readonly ColumnMeta[]): string | null {
  if (!isCompleteView(def)) return null;
  const measureName = (measure: MeasureSpec): string => {
    if (measure.agg === "expr") return measure.expr ?? "Expression";
    if (measure.column === null) return "Rows";
    const name = columns[measure.column]?.name ?? "?";
    if (measure.agg === "count") return `Count of ${name}`;
    if (measure.agg === "distinct") return `Distinct ${name}`;
    return `${aggShort(measure.agg)} of ${name}`;
  };
  const values = def.measures.slice(0, 2).map(measureName).join(", ");
  const more = def.measures.length > 2 ? ` and ${def.measures.length - 2} more` : "";
  const fieldName = (spec: DimensionSpec): string => {
    const name = columns[spec.column]?.name ?? "?";
    return typeof spec.by === "object" && "time" in spec.by ? `${name} ${spec.by.time}` : name;
  };
  const spread = new Set(def.pivotColumns ?? (def.pivot === undefined ? [] : [def.pivot]));
  const rows = def.dimensions.filter((_, index) => !spread.has(index)).map(fieldName);
  const across = def.dimensions.filter((_, index) => spread.has(index)).map(fieldName);
  return `${values}${more}${rows.length > 0 ? ` by ${rows.join(" and ")}` : ""}${across.length > 0 ? ` across ${across.join(" and ")}` : ""}`;
}

/**
 * The value a starter pivot opens with: an amount-like column, totalled when a total means
 * something and averaged otherwise. Coordinates, identifiers, codes and years are never values.
 */
export function starterMeasure(columns: readonly ColumnMeta[], rowCount = 0): MeasureSpec | null {
  let best: { column: number; score: number } | null = null;
  columns.forEach((meta, column) => {
    if ((meta.type !== "integer" && meta.type !== "number") || meta.stats.distinct < 2) return;
    const semantic = meta.semantic?.type;
    if (semantic === "identifier" || semantic === "geo" || semantic === "code") return;
    if (nameHas(meta.name, "coordinate") || nameHas(meta.name, "postcode") || nameHas(meta.name, "year")) return;
    if (isIdLikeColumn(meta, rowCount)) return;
    const { min, max } = meta.stats;
    if (meta.type === "integer" && typeof min === "number" && typeof max === "number" && min >= 1900 && max <= 2100) return;
    // The recommender's ranking: additive amounts first, money above other quantities.
    const score =
      (isAdditiveName(meta.name) && !isRateName(meta.name) ? 2 : 0) +
      (isMoneyName(meta.name) ? 1 : 0) +
      (isRateName(meta.name) ? 1 : 0) +
      Math.min(meta.stats.distinct, 100) / 100;
    if (best === null || score > best.score) best = { column, score };
  });
  if (best === null) return null;
  const { column } = best;
  const name = columns[column]!.name;
  const summable = isAdditiveName(name) && !isRateName(name) && !nameHas(name, "percent");
  return { column, agg: summable ? "sum" : "mean" };
}

/** Up to three one-click starter views derived from column types and names. */
export function starterViews(
  columns: readonly ColumnMeta[],
  archetype: ArchetypeId = "general",
  rowCount = 0,
): ViewDef[] {
  const date = columns.findIndex(
    (meta) => (meta.type === "date" || meta.type === "datetime") && meta.stats.distinct >= 2,
  );
  // A grouping column that reads as one (state, segment) ahead of names, emails and addresses.
  let category = -1;
  let categoryScore = Number.NEGATIVE_INFINITY;
  columns.forEach((meta, index) => {
    if ((meta.type !== "category" && meta.type !== "boolean") || meta.stats.distinct < 2 || meta.stats.distinct > 50) return;
    const score = (isGoodCategoryName(meta.name) ? 2 : 0) - (isBadCategoryName(meta.name) ? 2 : 0);
    if (score > categoryScore) {
      category = index;
      categoryScore = score;
    }
  });
  const measure = starterMeasure(columns, rowCount);

  const views: ViewDef[] = [];
  const base = (name: string): ViewDef => ({
    id: `view-${views.length + 1}`,
    name,
    autoName: true,
    dimensions: [],
    measures: [],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: DEFAULT_LIMIT,
    respectFilters: true,
  });

  // Event logs change too fast for months; day resolution is the useful grain.
  const grain: TimeGrain = archetype === "eventLog" ? "day" : "month";
  if (measure !== null && measure.column !== null && category >= 0) {
    const view = base(`${measure.agg === "sum" ? "Sum" : "Average"} of ${columns[measure.column]!.name} by ${columns[category]!.name}`);
    view.dimensions = [{ column: category, by: "value" }];
    view.measures = [measure];
    views.push(view);
  }
  if (date >= 0) {
    const view = base(`Rows by ${columns[date].name} ${grain}`);
    view.dimensions = [{ column: date, by: { time: grain } }];
    view.measures = [{ column: null, agg: "count" }];
    view.fill = "zero";
    view.sort = { key: "dim0", dir: "asc" };
    views.push(view);
  }
  if (category >= 0 && views.length < 3) {
    const view = base(`Count by ${columns[category].name}`);
    view.dimensions = [{ column: category, by: "value" }];
    view.measures = [{ column: null, agg: "count" }];
    views.push(view);
  }
  return views.slice(0, 3);
}
