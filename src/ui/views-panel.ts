import type { ColumnMeta, AggregateMessage, PivotMessage } from "../worker/protocol.js";
import type { PivotDef } from "../data/pivot.js";
import type { ArchetypeId } from "../data/archetype.js";
import {
  type Aggregate,
  type CohortSpec,
  compileExpression,
  type DatePart,
  type DimensionSpec,
  isCompleteView,
  type MeasureCondition,
  type MeasureSpec,
  type PivotFilter,
  type PivotLambdaSpec,
  type PostOp,
  type TimeGrain,
  type ViewDef,
} from "../data/aggregate.js";
import { isNumericLikeType, TYPE_LABELS } from "../types.js";
import { compilePivotLambda } from "../data/pivot-lambda.js";
import { downloadCsv } from "./chart-export.js";
import { pivotCsvRows } from "./pivot-export.js";
import { safeFileName } from "./chart-utils.js";
import { parseDate } from "../parse/dates.js";
import { openPrompt, setupDialog } from "./dialog.js";
import { clear, el, svgIcon } from "./dom.js";
import { openMenu, type MenuItem } from "./menu.js";

export interface ViewsPanelOptions {
  requestAggregate(view: ViewDef): Promise<AggregateMessage>;
  /** Worker-assembled pivot matrix (preferred for pivoted views). */
  requestPivot?(pivot: PivotDef): Promise<PivotMessage>;
  /** Detected table archetype, used to pick smarter starter views. */
  archetype?(): ArchetypeId;
  /** Clicking a group row: value dimensions pass the label, time dims the bucket. */
  onDrill(column: number, timeStart: number | null, timeEnd: number | null, label: string): void;
  onChart(view: ViewDef): void;
  onCopyPandas(view: ViewDef): Promise<void>;
  /** Publication-style rendering of the current result (PNG/HTML export). */
  onSlickTable?(view: ViewDef, result: AggregateMessage): void;
  /** The view list changed (added/removed): refresh chart source selectors. */
  onViewsChanged?(): void;
}

interface ViewEntry {
  def: ViewDef;
  result: AggregateMessage | null;
  /** Worker pivot payload when requestPivot is available. */
  pivotResult: PivotMessage | null;
  /** Pivot margins computed by the worker over raw rows. */
  margins: {
    rows: AggregateMessage | null;
    cols: AggregateMessage | null;
    total: AggregateMessage | null;
  } | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  /** Columns referenced by this definition that no longer exist. */
  missing: string[];
  /** Reads beyond the first VISIBLE_ROWS rows of the table. */
  expanded: boolean;
}

function hasResult(entry: { result: AggregateMessage | null; pivotResult: PivotMessage | null }): boolean {
  return entry.result !== null || entry.pivotResult !== null;
}

const MAX_VIEWS = 5;
const DEFAULT_LIMIT = 500;
const VISIBLE_ROWS = 20;

const AGG_OPTIONS: readonly { value: Aggregate; label: string }[] = [
  { value: "sum", label: "Sum" },
  { value: "mean", label: "Mean" },
  { value: "median", label: "Median" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "count", label: "Count of values" },
  { value: "distinct", label: "Distinct values" },
  { value: "stddev", label: "Std deviation" },
  { value: "first", label: "First (by row order)" },
  { value: "last", label: "Last (by row order)" },
  { value: "mode", label: "Mode" },
  { value: "p90", label: "90th percentile" },
];

const DATE_PARTS: readonly { value: DatePart; label: string }[] = [
  { value: "hour", label: "Hour of day" },
  { value: "dow", label: "Day of week" },
  { value: "month", label: "Month of year" },
  { value: "dom", label: "Day of month" },
  { value: "week", label: "Week of year" },
];

const DATE_GROUP_CHOICES: { value: TimeGrain; label: string }[] = [
  { value: "second", label: "Seconds" },
  { value: "minute", label: "Minutes" },
  { value: "hour", label: "Hours" },
  { value: "day", label: "Days" },
  { value: "month", label: "Months" },
  { value: "quarter", label: "Quarters" },
  { value: "year", label: "Years" },
];
const DATE_GROUP_ORDER: TimeGrain[] = [
  "year",
  "quarter",
  "month",
  "day",
  "hour",
  "minute",
  "second",
];
const GRAIN_LABELS: Record<TimeGrain, string> = {
  second: "Second",
  minute: "Minute",
  hour: "Hour",
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const AGG_SYMBOLS: Record<string, string> = {
  count: "#",
  distinct: "n",
  sum: "Σ",
  mean: "x̄",
  median: "med",
  min: "min",
  max: "max",
  stddev: "σ",
  first: "1st",
  last: "last",
  mode: "mode",
  p90: "p90",
};

export function measureSymbol(measure: MeasureSpec): string {
  if (measure.agg === "expr") return "ƒ";
  if (measure.column === null) return "#";
  if (measure.agg === "count") return "#";
  return AGG_SYMBOLS[measure.agg] ?? measure.agg;
}

/** Measures that can be totalled from other groups (no averaging involved). */
export function isSummable(measure: MeasureSpec): boolean {
  if ((measure.post ?? []).length > 0) return false;
  if (measure.agg === "count" && measure.column === null) return true;
  return measure.agg === "sum" && measure.column !== null;
}

/** Name shown on the measure pill (expressions abbreviated). */
function measureDisplay(measure: MeasureSpec, metas: readonly ColumnMeta[]): string {
  if (measure.agg === "expr") {
    const expr = measure.expr ?? "expr";
    return expr.length > 26 ? `${expr.slice(0, 25)}…` : expr;
  }
  if (measure.column === null) return "rows";
  return metas[measure.column]?.name ?? "?";
}

export function formatMeasure(value: number, measure: MeasureSpec): string {
  if (!Number.isFinite(value)) return "—";
  const last = measure.post?.[measure.post.length - 1];
  if (last !== undefined && (last.op === "pctChange" || last.op === "pctTotal")) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function transposeIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "transpose-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = `
    <path d="M2.5 5h13" stroke-width="3.2" />
    <path d="M9 5v16" stroke-width="3.2" />
    <path d="M16 8h5" />
    <path d="M18.5 5.5 21 8l-2.5 2.5" />
    <path d="M21 17h-5" />
    <path d="M18.5 14.5 16 17l2.5 2.5" />
  `;
  return svg;
}
const NUMBER_FILTER_OPS = [
  ["eq", "Equals"],
  ["ne", "Does not equal"],
  ["gt", "Greater than"],
  ["gte", "Greater than or equal"],
  ["lt", "Less than"],
  ["lte", "Less than or equal"],
  ["between", "Between"],
  ["aboveAvg", "Above average"],
  ["belowAvg", "Below average"],
  ["blank", "Is blank"],
  ["notBlank", "Is not blank"],
] as const;
const DATE_FILTER_OPS = [
  ["on", "On"],
  ["before", "Before"],
  ["after", "After"],
  ["onOrBefore", "On or before"],
  ["onOrAfter", "On or after"],
  ["between", "Between"],
  ["blank", "Is blank"],
  ["notBlank", "Is not blank"],
] as const;
const TEXT_FILTER_OPS = [
  ["eq", "Equals"],
  ["ne", "Does not equal"],
  ["contains", "Contains"],
  ["notContains", "Does not contain"],
  ["begins", "Begins with"],
  ["ends", "Ends with"],
  ["blank", "Is blank"],
  ["notBlank", "Is not blank"],
] as const;

function filterValueCount(filter: PivotFilter): number {
  if (filter.kind === undefined || filter.kind === "values") return filter.values.length;
  if (filter.kind === "blank") return 1;
  if (filter.kind === "text") return 1;
  return filter.op === "between" ? 2 : 1;
}

function filterDescription(filter: PivotFilter): string {
  if (filter.kind === undefined || filter.kind === "values") {
    const mode = filter.negate === true ? "Is not one of" : "Is one of";
    return `${mode}: ${filter.values.join(", ")}`;
  }
  if (filter.kind === "blank") return filter.negate === true ? "Is not blank" : "Is blank";
  if (filter.kind === "text") {
    const label = TEXT_FILTER_OPS.find(([op]) => op === filter.op)?.[1] ?? filter.op;
    return `${label}: ${filter.value}`;
  }
  if (filter.kind === "date") {
    const label = DATE_FILTER_OPS.find(([op]) => op === filter.op)?.[1] ?? filter.op;
    const date = (value: number | undefined): string =>
      value === undefined ? "" : new Date(value).toISOString().slice(0, 10);
    return filter.op === "between"
      ? `${label}: ${date(filter.value)} - ${date(filter.value2)}`
      : `${label}: ${date(filter.value)}`;
  }
  const label = NUMBER_FILTER_OPS.find(([op]) => op === filter.op)?.[1] ?? filter.op;
  return filter.value === undefined ? label : `${label}: ${filter.value}`;
}
function filterIcon(): SVGElement {
  return svgIcon(
    '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
    "views-filter-icon",
  );
}
function viewToggleIcon(expanded: boolean): SVGElement {
  return svgIcon(
    expanded ? '<path d="M5 12h14"/>' : '<path d="M12 5v14"/><path d="M5 12h14"/>',
    "views-card-toggle-icon",
  );
}
export type PivotWell = "index" | "columns" | "values";
export type PivotDragWell = PivotWell | "shelf";

export interface PivotDragSource {
  kind: "dimension" | "measure" | "column";
  index: number;
  well: PivotDragWell;
}

export interface PivotMoveResult {
  ok: boolean;
  reason?: string;
}

/** Preserve the selected measure by identity across a values reorder. */
function keepPivotMeasure(view: ViewDef, selected: MeasureSpec | undefined): void {
  view.pivotMeasure =
    selected === undefined || view.measures.length === 0
      ? undefined
      : Math.max(0, view.measures.indexOf(selected));
}

/**
 * Move or convert a pivot field between the Index, Columns and Values wells.
 * Position is the insertion slot in the target well's displayed order.
 */
export function movePivotField(
  view: ViewDef,
  source: PivotDragSource,
  target: PivotWell,
  position: number,
  numericSource: boolean,
  dateSource = false,
): PivotMoveResult {
  const selected =
    view.pivotMeasure === undefined ? undefined : view.measures[view.pivotMeasure];
  if (source.kind === "column") {
    const column = source.index;
    const existingDim = view.dimensions.findIndex((dimension) => dimension.column === column);
    if (target === "values") {
      if (existingDim >= 0) {
        if (view.dimensions[existingDim]?.by !== "value") {
          return {
            ok: false,
            reason: "Change the grouped field back to Exact value before moving it to Values.",
          };
        }
        const sourceWell = thisPivotIndexes(view).includes(existingDim) ? "columns" : "index";
        return movePivotField(
          view,
          { kind: "dimension", index: existingDim, well: sourceWell },
          target,
          position,
          numericSource,
          dateSource,
        );
      }
      const agg = numericSource ? "mean" : "count";
      const duplicate = view.measures.some(
        (measure) =>
          measure.column === column &&
          measure.agg === agg &&
          measure.weight === undefined &&
          measure.where === undefined &&
          (measure.post?.length ?? 0) === 0,
      );
      if (duplicate) return { ok: true };
      const measure: MeasureSpec = { column, agg };
      view.measures.splice(Math.max(0, Math.min(view.measures.length, position)), 0, measure);
      keepPivotMeasure(view, selected);
      return { ok: true };
    }
    if (existingDim >= 0) {
      const sourceWell = thisPivotIndexes(view).includes(existingDim) ? "columns" : "index";
      return movePivotField(
        view,
        { kind: "dimension", index: existingDim, well: sourceWell },
        target,
        position,
        numericSource,
        dateSource,
      );
    }
    const oldColumns = thisPivotIndexes(view);
    const columnSpecs = new Set(oldColumns.map((index) => view.dimensions[index]!));
    const targetOrder = view.dimensions
      .map((_, index) => index)
      .filter((index) =>
        target === "columns"
          ? columnSpecs.has(view.dimensions[index]!)
          : !columnSpecs.has(view.dimensions[index]!),
      );
    const before = targetOrder[Math.max(0, Math.min(targetOrder.length, position))];
    const beforeSpec = before === undefined ? undefined : view.dimensions[before];
    const spec: DimensionSpec = {
      column,
      by: dateSource ? { time: "month" } : "value",
    };
    if (beforeSpec === undefined) view.dimensions.push(spec);
    else view.dimensions.splice(view.dimensions.indexOf(beforeSpec), 0, spec);
    if (target === "columns") columnSpecs.add(spec);
    view.pivotColumns = view.dimensions
      .map((dimension, index) => (columnSpecs.has(dimension) ? index : -1))
      .filter((index) => index >= 0);
    view.pivot = view.pivotColumns[0];
    return { ok: true };
  }
  if (source.kind === "dimension") {
    const spec = view.dimensions[source.index];
    if (spec === undefined) return { ok: false, reason: "That field is no longer present." };
    if (target === "values") {
      if (spec.by !== "value") {
        return {
          ok: false,
          reason: "Change the field back to Exact value before moving it to Values.",
        };
      }
      const columnSpecs = new Set(
        thisPivotIndexes(view).map((index) => view.dimensions[index]!),
      );
      columnSpecs.delete(spec);
      view.dimensions.splice(source.index, 1);
      if (view.sort.key === `dim${source.index}`) view.sort = { key: "m0", dir: "desc" };
      const measure: MeasureSpec = {
        column: spec.column,
        agg: numericSource ? "mean" : "count",
      };
      view.measures.splice(Math.max(0, Math.min(view.measures.length, position)), 0, measure);
      keepPivotMeasure(view, selected);
      view.pivotColumns = view.dimensions
        .map((dimension, index) => (columnSpecs.has(dimension) ? index : -1))
        .filter((index) => index >= 0);
      view.pivot = view.pivotColumns[0];
      if (view.pivotColumns.length === 0) view.fillValue = undefined;
      return { ok: true };
    }

    const oldColumns = thisPivotIndexes(view);
    const wasColumn = oldColumns.includes(source.index);
    if (target === "columns" && !wasColumn) {
      const indexCount = view.dimensions.length - oldColumns.length;
      if (indexCount <= 1) {
        return { ok: false, reason: "Keep at least one Index field." };
      }
    }
    const columnSpecs = new Set(oldColumns.map((index) => view.dimensions[index]!));
    const targetOrder = view.dimensions
      .map((_, index) => index)
      .filter((index) => index !== source.index)
      .filter((index) =>
        target === "columns" ? columnSpecs.has(view.dimensions[index]!) : !columnSpecs.has(view.dimensions[index]!),
      );
    const before = targetOrder[Math.max(0, Math.min(targetOrder.length, position))];
    const beforeSpec = before === undefined ? undefined : view.dimensions[before];
    view.dimensions.splice(source.index, 1);
    const insertAt =
      beforeSpec === undefined
        ? view.dimensions.length
        : view.dimensions.indexOf(beforeSpec);
    view.dimensions.splice(Math.max(0, insertAt), 0, spec);
    if (target === "columns") columnSpecs.add(spec);
    else columnSpecs.delete(spec);
    view.pivotColumns = view.dimensions
      .map((dimension, index) => (columnSpecs.has(dimension) ? index : -1))
      .filter((index) => index >= 0);
    view.pivot = view.pivotColumns[0];
    if (view.pivotColumns.length === 0) view.fillValue = undefined;
    return { ok: true };
  }

  const measure = view.measures[source.index];
  if (measure === undefined) return { ok: false, reason: "That value is no longer present." };
  if (target === "values") {
    view.measures.splice(source.index, 1);
    view.measures.splice(
      Math.max(0, Math.min(view.measures.length, position)),
      0,
      measure,
    );
    keepPivotMeasure(view, selected);
    return { ok: true };
  }
  if (
    measure.column === null ||
    measure.agg === "expr" ||
    measure.weight !== undefined ||
    measure.where !== undefined ||
    (measure.post?.length ?? 0) > 0
  ) {
    return {
      ok: false,
      reason: "Only a simple value can become an Index or Columns field.",
    };
  }
  if (
    view.dimensions.some(
      (dimension) => dimension.column === measure.column && dimension.by === "value",
    )
  ) {
    return { ok: false, reason: "That column is already an Index or Columns field." };
  }
  const oldColumns = thisPivotIndexes(view);
  const columnSpecs = new Set(oldColumns.map((index) => view.dimensions[index]!));
  const targetOrder = view.dimensions
    .map((_, index) => index)
    .filter((index) =>
      target === "columns" ? columnSpecs.has(view.dimensions[index]!) : !columnSpecs.has(view.dimensions[index]!),
    );
  const before = targetOrder[Math.max(0, Math.min(targetOrder.length, position))];
  const beforeSpec = before === undefined ? undefined : view.dimensions[before];
  const spec: DimensionSpec = {
    column: measure.column,
    by: dateSource ? { time: "month" } : "value",
  };
  if (beforeSpec === undefined) view.dimensions.push(spec);
  else view.dimensions.splice(view.dimensions.indexOf(beforeSpec), 0, spec);
  if (target === "columns") columnSpecs.add(spec);
  view.measures.splice(source.index, 1);
  keepPivotMeasure(view, selected);
  view.pivotColumns = view.dimensions
    .map((dimension, index) => (columnSpecs.has(dimension) ? index : -1))
    .filter((index) => index >= 0);
  view.pivot = view.pivotColumns[0];
  return { ok: true };
}

/** The current column-field indexes; kept local to avoid class coupling. */
function thisPivotIndexes(view: ViewDef): number[] {
  const valid = (index: number): boolean =>
    Number.isInteger(index) && index >= 0 && index < view.dimensions.length;
  const columns = (view.pivotColumns ?? []).filter(valid);
  if (columns.length > 0) return columns;
  return view.pivot !== undefined && valid(view.pivot) ? [view.pivot] : [];
}
/** Compile the current ViewDef matrix layout into a worker PivotDef. */
export function pivotDefFromView(view: ViewDef, pivotIndexes: readonly number[]): PivotDef {
  const pivotSet = new Set(pivotIndexes);
  return {
    id: view.id,
    name: view.name,
    index: view.dimensions.filter((_, index) => !pivotSet.has(index)),
    columns: pivotIndexes
      .map((index) => view.dimensions[index])
      .filter((spec): spec is DimensionSpec => spec !== undefined),
    values: [...view.measures],
    respectFilters: view.respectFilters,
    margins: view.margins,
    marginsName: view.marginsName,
    fillValue: view.fillValue,
    dropna: view.dropna,
    sort: view.pivotSort,
    lambdas: view.pivotLambdas,
    marginPct: view.pivotMarginPct,
    valueFilters: view.pivotValueFilters,
  };
}

/** Remap a saved view onto a new schema by column name. */
export function remapViewDef(
  def: ViewDef,
  oldNames: readonly string[],
  newNames: readonly string[],
): { def: ViewDef; missing: string[] } {
  const missing = new Set<string>();
  const nameToNew = new Map(newNames.map((name, index) => [name, index]));
  const used = new Set<number>();
  const mapIndex = (oldIndex: number): number => {
    const name = oldNames[oldIndex];
    if (name === undefined) return -1;
    const found = nameToNew.get(name);
    if (found !== undefined) {
      used.add(found);
      return found;
    }
    if (
      oldNames.length === newNames.length &&
      newNames[oldIndex] !== undefined &&
      !oldNames.includes(newNames[oldIndex]!) &&
      !used.has(oldIndex)
    ) {
      used.add(oldIndex);
      return oldIndex;
    }
    missing.add(name);
    return -1;
  };

  const oldToNewDimension = new Map<number, number>();
  const dimensions: ViewDef["dimensions"] = [];
  def.dimensions.forEach((spec, oldIndex) => {
    const column = mapIndex(spec.column);
    if (column < 0) return;
    oldToNewDimension.set(oldIndex, dimensions.length);
    dimensions.push({ ...spec, column });
  });
  const oldPivots = def.pivotColumns ?? (def.pivot === undefined ? [] : [def.pivot]);
  const pivotColumns = oldPivots
    .map((index) => oldToNewDimension.get(index))
    .filter((index): index is number => index !== undefined)
    .sort((a, b) => a - b);
  const measures: MeasureSpec[] = [];
  def.measures.forEach((measure) => {
    const column = measure.column === null ? null : mapIndex(measure.column);
    if (column !== null && column < 0) return;
    let weight = measure.weight;
    if (weight !== undefined) {
      const mapped = mapIndex(weight);
      weight = mapped < 0 ? undefined : mapped;
    }
    let where = measure.where;
    if (where !== undefined) {
      const mapped = mapIndex(where.column);
      where = mapped < 0 ? undefined : { ...where, column: mapped };
    }
    measures.push({
      ...measure,
      column,
      ...(weight === undefined ? { weight: undefined } : { weight }),
      ...(where === undefined ? { where: undefined } : { where }),
    });
  });
  const lambdas = (def.pivotLambdas ?? []).flatMap((lambda) => {
    const column = mapIndex(lambda.column);
    return column < 0 ? [] : [{ ...lambda, column }];
  });
  let filterColumn = def.filterColumn;
  if (filterColumn !== undefined && filterColumn >= 0) {
    const mapped = mapIndex(filterColumn);
    filterColumn = mapped < 0 ? -1 : mapped;
  }
  const valueFilters = (def.pivotValueFilters ?? []).flatMap((filter) => {
    const column = mapIndex(filter.column);
    return column < 0 ? [] : [{ ...filter, column }];
  });
  const next: ViewDef = {
    ...def,
    dimensions,
    measures,
    pivotColumns,
    pivot: pivotColumns[0],
    pivotLambdas: lambdas,
    pivotValueFilters: valueFilters,
    pivotMeasure:
      def.pivotMeasure === undefined
        ? undefined
        : Math.max(0, Math.min(measures.length - 1, def.pivotMeasure)),
    fillValue: pivotColumns.length === 0 ? undefined : def.fillValue,
    filterColumn,
    filterCode: filterColumn !== undefined && filterColumn >= 0 ? def.filterCode : -1,
  };
  return { def: next, missing: [...missing] };
}
/** Up to three one-click starter views derived from column types. */
export function starterViews(
  columns: readonly ColumnMeta[],
  archetype: ArchetypeId = "general",
): ViewDef[] {
  const date = columns.findIndex(
    (meta) => (meta.type === "date" || meta.type === "datetime") && meta.stats.distinct >= 2,
  );
  const category = columns.findIndex(
    (meta) =>
      (meta.type === "category" || meta.type === "boolean") &&
      meta.stats.distinct >= 2 &&
      meta.stats.distinct <= 50,
  );
  const numeric = columns.findIndex(
    (meta) => (meta.type === "integer" || meta.type === "number") && meta.stats.distinct >= 2,
  );

  const views: ViewDef[] = [];
  const base = (name: string): ViewDef => ({
    id: `view-${views.length + 1}`,
    name,
    dimensions: [],
    measures: [],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: DEFAULT_LIMIT,
    respectFilters: true,
  });

  // Event logs change too fast for months; day resolution is the useful grain.
  const grain: TimeGrain = archetype === "eventLog" ? "day" : "month";
  if (numeric >= 0 && category >= 0) {
    const view = base(`Sum of ${columns[numeric].name} by ${columns[category].name}`);
    view.dimensions = [{ column: category, by: "value" }];
    view.measures = [{ column: numeric, agg: "sum" }];
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

/**
 * The Views lens: saved aggregate definitions over the filtered table. Each
 * view is a definition, never a copied dataset — the worker recomputes it from
 * the current rows and the Table and Recipe are untouched.
 */
export class ViewsPanel {
  private readonly stackEl: HTMLElement;
  private readonly builderEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly tableEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private views: ViewEntry[] = [];
  /** Index of the expanded card; -1 when every card is minimised. */
  private active = 0;
  private metas: ColumnMeta[] = [];
  private rowCount = 0;
  private started = false;
  private transientNote: string | null = null;
  private pivotDrag: PivotDragSource | null = null;
  private fieldSearch = "";
  /** Index of a just-added view whose name field should open for editing. */
  private pendingRename: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: ViewsPanelOptions,
  ) {
    this.root.classList.add("views-panel");
    this.stackEl = el("div", { class: "views-stack" });
    this.builderEl = el("div", { class: "views-builder" });
    this.noteEl = el("div", { class: "views-note" });
    this.tableEl = el("div", { class: "views-table-host" });
    this.actionsEl = el("div", { class: "views-actions" });
    this.root.append(this.stackEl);
  }

  setColumns(metas: ColumnMeta[], rowCount: number): void {
    const sameShape =
      this.metas.length === metas.length &&
      this.metas.every((meta, index) => meta.name === metas[index]?.name);
    const oldNames = this.metas.map((meta) => meta.name);
    this.metas = metas;
    this.rowCount = rowCount;
    if (!this.started && metas.length > 0) {
      this.started = true;
      const starters = starterViews(metas, this.options.archetype?.() ?? "general");
      this.views = starters.map((def) => ({
        def,
        result: null,
        pivotResult: null,
        margins: null,
        loading: false,
        stale: true,
        error: null,
        missing: [],
        expanded: false,
      }));
      if (this.views.length === 0) this.views = [this.blankView()];
      this.active = 0;
      this.refresh();
    } else if (!sameShape) {
      // Columns changed shape (transform): remap definitions by name, then refresh.
      const newNames = metas.map((meta) => meta.name);
      for (const entry of this.views) {
        const remapped = remapViewDef(entry.def, oldNames, newNames);
        entry.def = remapped.def;
        entry.missing = remapped.missing;
        if (remapped.missing.length > 0) {
          entry.error = `Missing column${remapped.missing.length === 1 ? "" : "s"}: ${remapped.missing.join(", ")}`;
          entry.result = null;
          entry.pivotResult = null;
          entry.loading = false;
        }
      }
      this.options.onViewsChanged?.();
      this.markStale();
    }
    this.render();
  }

  /** Complete views that charts can bind to as data sources. */
  sources(): { id: string; name: string }[] {
    return this.views
      .filter((entry) => isCompleteView(entry.def))
      .map((entry) => ({ id: entry.def.id, name: entry.def.name }));
  }

  viewDef(id: string): ViewDef | undefined {
    return this.views.find((entry) => entry.def.id === id)?.def;
  }

  /** Filter or data changes: only the active view recomputes immediately. */
  markStale(): void {
    for (const view of this.views) view.stale = true;
    if (this.views.length > 0) this.refresh();
    else this.render();
  }

  refresh(): void {
    const entry = this.views[this.active];
    if (entry === undefined || !isCompleteView(entry.def)) {
      this.render();
      return;
    }
    if (entry.missing.length > 0) {
      entry.loading = false;
      entry.error = `Missing column${entry.missing.length === 1 ? "" : "s"}: ${entry.missing.join(", ")}`;
      this.render();
      return;
    }
    entry.loading = true;
    entry.error = null;
    entry.margins = null;
    entry.pivotResult = null;
    this.render();
    const generation = ++this.generation;
    const def = entry.def;
    const marginViews: ViewDef[] = [];
    const pivots = this.pivotIndexes(def);
    if (pivots.length > 0 && this.options.requestPivot !== undefined) {
      entry.result = null;
      void this.options
        .requestPivot(pivotDefFromView(def, pivots))
        .then((message) => {
          if (generation !== this.generation) return;
          entry.pivotResult = message;
          entry.loading = false;
          entry.stale = false;
          this.render();
        })
        .catch((error: unknown) => {
          if (generation !== this.generation) return;
          entry.loading = false;
          entry.error = error instanceof Error ? error.message : String(error);
          this.render();
        });
      return;
    }
    const pivotSet = new Set(pivots);
    const rowDims = def.dimensions.filter((_, index) => !pivotSet.has(index));
    const colDims = pivots
      .map((index) => def.dimensions[index])
      .filter((spec): spec is DimensionSpec => spec !== undefined);
    if (def.margins === true && pivots.length > 0 && rowDims.length > 0) {
      const base = {
        fill: "none" as const,
        sort: { key: "dim0", dir: "asc" as const },
        limit: 100_000,
        respectFilters: def.respectFilters,
      };
      marginViews.push(
        {
          ...base,
          id: `${def.id}-margin-rows`,
          name: `${def.name} rows`,
          dimensions: rowDims,
          measures: def.measures,
        },
        {
          ...base,
          id: `${def.id}-margin-cols`,
          name: `${def.name} columns`,
          dimensions: colDims,
          measures: def.measures,
        },
        {
          ...base,
          id: `${def.id}-margin-total`,
          name: `${def.name} total`,
          dimensions: [],
          measures: def.measures,
        },
      );
    }
    void Promise.all([
      this.options.requestAggregate(def),
      ...marginViews.map((view) => this.options.requestAggregate(view)),
    ])
      .then(([message, rows, cols, total]) => {
        if (generation !== this.generation) return;
        entry.result = message;
        entry.margins =
          marginViews.length === 3
            ? { rows: rows ?? null, cols: cols ?? null, total: total ?? null }
            : null;
        entry.loading = false;
        entry.stale = false;
        this.render();
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        entry.loading = false;
        entry.error = error instanceof Error ? error.message : String(error);
        this.render();
      });
  }

  private generation = 0;

  private blankView(): ViewEntry {
    const category = this.metas.findIndex((meta) => meta.type === "category");
    const date = this.metas.findIndex(
      (meta) => meta.type === "date" || meta.type === "datetime",
    );
    const dimension = category >= 0 ? category : date >= 0 ? date : 0;
    const def: ViewDef = {
      id: `view-${Date.now().toString(36)}`,
      name: "New view",
      dimensions: this.metas.length > 0 ? [{ column: dimension, by: "value" }] : [],
      measures: [{ column: null, agg: "count" }],
      fill: "none",
      sort: { key: "m0", dir: "desc" },
      limit: DEFAULT_LIMIT,
      respectFilters: true,
    };
    return {
      def,
      result: null,
      pivotResult: null,
      margins: null,
      loading: false,
      stale: true,
      error: null,
      missing: [],
      expanded: false,
    };
  }

  /** Insert a blank view at `at` (clamped); it opens with the name field focused. */
  /** Unique display name; renaming appends a numeric suffix instead of colliding. */
  private uniqueViewName(base: string, excludeIndex = -1): string {
    const taken = new Set(
      this.views
        .filter((_, index) => index !== excludeIndex)
        .map((view) => view.def.name),
    );
    let name = base.trim().slice(0, 80) || "View";
    let counter = 2;
    while (taken.has(name)) name = `${base.trim().slice(0, 74)} (${counter++})`;
    return name;
  }
  private duplicateView(): void {
    const index = this.active;
    const source = this.views[index];
    if (source === undefined || this.views.length >= MAX_VIEWS) return;
    const copy = JSON.parse(JSON.stringify(source.def)) as ViewDef;
    copy.id = `view-${this.views.length + 1}-${Date.now().toString(36)}`;
    copy.name = this.uniqueViewName(`Copy of ${source.def.name}`);
    const entry: ViewEntry = {
      def: copy,
      result: null,
      pivotResult: null,
      margins: null,
      loading: false,
      stale: true,
      error: null,
      missing: [],
      expanded: false,
    };
    this.views.splice(index + 1, 0, entry);
    this.active = index + 1;
    this.options.onViewsChanged?.();
    this.refresh();
  }
  private addView(at?: number): void {
    if (this.views.length >= MAX_VIEWS) return;
    const entry = this.blankView();
    entry.def.id = `view-${this.views.length + 1}-${Date.now().toString(36)}`;
    entry.def.name = this.uniqueViewName(`View_${this.views.length + 1}`);
    const index = at === undefined ? this.views.length : Math.max(0, Math.min(at, this.views.length));
    this.views.splice(index, 0, entry);
    this.active = index;
    // A fresh view starts in rename mode so naming it is the obvious next step.
    this.pendingRename = index;
    this.options.onViewsChanged?.();
    this.refresh();
  }

  /** Turn the card's name into an input (click the name or the ✎ button). */
  private beginRename(index: number, host: HTMLElement): void {
    const entry = this.views[index];
    if (entry === undefined || host.querySelector("input") !== null) return;
    const input = el("input", {
      class: "views-card-name-input",
      "aria-label": "View name",
      placeholder: "Name your view…",
      type: "text",
    }) as HTMLInputElement;
    input.value = entry.def.name;
    clear(host);
    host.classList.add("renaming");
    host.append(input);
    input.focus();
    input.select();
    const commit = (): void => {
      const name = input.value.trim();
      if (name.length > 0 && name !== entry.def.name) {
        entry.def.name = this.uniqueViewName(name, index);
        this.options.onViewsChanged?.();
      }
      this.render();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.render();
      }
    });
    input.addEventListener("blur", commit);
  }

  private removeView(index: number): void {
    if (this.views.length <= 1) return;
    this.views.splice(index, 1);
    this.active =
      this.active < 0
        ? -1
        : Math.max(-1, Math.min(this.active >= index ? this.active - 1 : this.active, this.views.length - 1));
    this.options.onViewsChanged?.();
    this.refresh();
  }

  private update(mutate: (view: ViewDef) => void): void {
    const entry = this.views[this.active];
    if (entry === undefined) return;
    this.transientNote = null;
    mutate(entry.def);
    entry.stale = true;
    this.options.onViewsChanged?.();
    this.refresh();
  }

  private render(): void {
    clear(this.stackEl);
    this.views.forEach((entry, index) => {
      const { card, name } = this.renderCard(entry, index, index === this.active);
      this.stackEl.append(card);
      if (this.pendingRename === index) {
        this.pendingRename = null;
        this.beginRename(index, name);
      }
    });
    this.renderAddRow();
    const entry = this.views[this.active];
    if (entry === undefined) {
      // Every card is minimised: the shared panels stay detached.
      clear(this.builderEl);
      clear(this.noteEl);
      clear(this.tableEl);
      clear(this.actionsEl);
      return;
    }
    this.renderBuilder(entry.def);
    this.renderNote(entry);
    this.renderTable(entry);
    this.renderActions();
  }

  /** One card: header (always visible) + editor/table/actions when expanded. */
  private renderCard(
    entry: ViewEntry,
    index: number,
    expanded: boolean,
  ): { card: HTMLElement; name: HTMLElement } {
    const card = el("div", { class: `views-card${expanded ? " expanded" : ""}` });
    const head = el("div", { class: "views-card-head" });
    const toggle = el(
      "button",
      {
        class: "views-card-toggle",
        type: "button",
        title: expanded ? "Minimise this view" : "Expand this view",
        "aria-expanded": expanded ? "true" : "false",
        "aria-label": `${expanded ? "Minimise" : "Expand"} ${entry.def.name}`,
      },
      [viewToggleIcon(expanded)],
    ) as HTMLButtonElement;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleCard(index);
    });

    const name = el(
      "span",
      { class: "views-card-name", title: "Click to rename this view" },
      [entry.def.name],
    );
    name.addEventListener("click", (event) => {
      event.stopPropagation();
      this.beginRename(index, name);
    });

    const rename = el(
      "button",
      {
        class: "views-card-rename",
        type: "button",
        title: "Rename this view",
        "aria-label": `Rename ${entry.def.name}`,
      },
      ["✎"],
    ) as HTMLButtonElement;
    rename.addEventListener("click", (event) => {
      event.stopPropagation();
      this.beginRename(index, name);
    });

    head.append(toggle, name, rename);
    if (!expanded) {
      head.append(el("span", { class: "views-card-summary" }, [this.summarise(entry)]));
      if (entry.stale && hasResult(entry)) {
        head.append(
          el(
            "span",
            {
              class: "views-card-stale",
              title: "Filters or columns changed — expand to recompute this view",
            },
            ["stale"],
          ),
        );
      }
    }
    head.append(el("span", { class: "grow" }));
    if (this.views.length > 1) {
      const remove = el(
        "button",
        {
          class: "views-card-remove",
          type: "button",
          title: "Remove this view",
          "aria-label": `Remove ${entry.def.name}`,
        },
        ["×"],
      ) as HTMLButtonElement;
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        this.removeView(index);
      });
      head.append(remove);
    }
    head.addEventListener("click", () => this.toggleCard(index));
    card.append(head);

    if (expanded) {
      const body = el("div", { class: "views-card-body", id: `views-body-${entry.def.id}` });
      body.append(this.builderEl, this.noteEl, this.tableEl, this.actionsEl);
      card.append(body);
    }
    return { card, name };
  }

  /** Expand a card (collapsing any other) or minimise the expanded one. */
  private toggleCard(index: number): void {
    if (this.active === index) {
      this.active = -1;
      this.render();
      return;
    }
    this.active = index;
    const entry = this.views[index];
    if (entry !== undefined && (entry.stale || !hasResult(entry))) this.refresh();
    else this.render();
  }

  /** One-line description for a minimised card: group-bys × measures · groups. */
  private summarise(entry: ViewEntry): string {
    const parts: string[] = [];
    const dims = entry.def.dimensions
      .map((spec) => `${this.metas[spec.column]?.name ?? "?"}${this.dimensionSuffix(spec)}`)
      .join(" + ");
    if (dims !== "") parts.push(dims);
    const measures = entry.def.measures.map((measure) => measureSymbol(measure)).join(", ");
    if (measures !== "") parts.push(measures);
    const groupCount = entry.result?.groupCount ?? entry.pivotResult?.groupCount;
    if (groupCount !== undefined) {
      parts.push(
        `${groupCount.toLocaleString()} ${groupCount === 1 ? "group" : "groups"}`,
      );
    } else if (entry.loading) {
      parts.push("aggregating…");
    } else if (!isCompleteView(entry.def)) {
      parts.push("incomplete — add a group-by and a measure");
    }
    return parts.join(" · ");
  }

  /** " · Month" / " · Day of week" / " · bins of 10" suffix for a dimension. */
  /** Spread dimensions, preferring the multi-column list over the legacy single index. */
  private pivotIndexes(def: ViewDef): number[] {
    const valid = (index: number): boolean =>
      Number.isInteger(index) && index >= 0 && index < def.dimensions.length;
    const columns = (def.pivotColumns ?? []).filter(valid);
    const unique = [...new Set(columns)].sort((a, b) => a - b);
    if (unique.length > 0) return unique;
    return def.pivot !== undefined && valid(def.pivot) ? [def.pivot] : [];
  }

  private pivotMeasureIndex(def: ViewDef, result: AggregateMessage): number {
    const index = def.pivotMeasure ?? 0;
    return index >= 0 && index < result.measures.length ? index : 0;
  }

  private dimensionSuffix(spec: DimensionSpec): string {
    const by = spec.by;
    if (by === "value") return "";
    if (typeof by === "object" && "time" in by) return ` · ${GRAIN_LABELS[by.time]}`;
    if (typeof by === "object" && "datePart" in by) {
      return ` · ${DATE_PARTS.find((part) => part.value === by.datePart)?.label ?? by.datePart}`;
    }
    if (typeof by === "object" && "bin" in by) {
      return "width" in by.bin
        ? ` · bins of ${by.bin.width}`
        : "n" in by.bin
          ? ` · ${by.bin.n} bins`
          : ` · ${by.bin.edges.length - 1} bins`;
    }
    return "";
  }

  /** The add controls at the end of the stack. */
  private renderAddRow(): void {
    const row = el("div", { class: "views-add-row" });
    if (this.views.length >= MAX_VIEWS) {
      row.append(
        el("span", { class: "views-add-limit" }, [
          `${MAX_VIEWS} views maximum — remove one to add another`,
        ]),
      );
      this.stackEl.append(row);
      return;
    }
    const add = el(
      "button",
      { class: "ghost small", type: "button", title: "Add an aggregate view at the end" },
      ["+ New view"],
    ) as HTMLButtonElement;
    add.addEventListener("click", () => this.addView());
    row.append(add);
    if (this.cohortColumns() !== null) {
      const cohort = el(
        "button",
        {
          class: "ghost small",
          type: "button",
          title: "Retention matrix: group entities by their first period, then count them per period since",
        },
        ["+ Cohort view"],
      ) as HTMLButtonElement;
      cohort.addEventListener("click", () => this.addCohortView());
      row.append(cohort);
    }
    this.stackEl.append(row);
  }

  /** Entity + date columns for a retention cohort view, when available. */
  private cohortColumns(): { entity: number; date: number } | null {
    const date = this.metas.findIndex(
      (meta) => (meta.type === "date" || meta.type === "datetime") && meta.stats.distinct >= 2,
    );
    if (date < 0) return null;
    const entity = this.metas.findIndex(
      (meta, index) =>
        index !== date &&
        (meta.type === "category" || meta.type === "string") &&
        meta.stats.distinct >= 2 &&
        meta.stats.distinct <= 100_000 &&
        meta.stats.nulls < this.rowCount,
    );
    if (entity < 0) return null;
    return { entity, date };
  }

  private addCohortView(): void {
    if (this.views.length >= MAX_VIEWS) return;
    const columns = this.cohortColumns();
    if (columns === null) return;
    const grain: TimeGrain = "month";
    const entry = this.blankView();
    entry.def.id = `view-${this.views.length + 1}-${Date.now().toString(36)}`;
    entry.def.name = `Retention: ${this.metas[columns.entity]?.name ?? "entity"} by first ${grain}`;
    entry.def.dimensions = [
      { column: columns.date, by: { cohort: { entity: columns.entity, grain } } },
      { column: columns.date, by: { since: { entity: columns.entity, grain } } },
    ];
    entry.def.measures = [{ column: columns.entity, agg: "distinct" }];
    entry.def.sort = { key: "dim1", dir: "asc" };
    entry.def.pivot = 1;
    this.views.push(entry);
    this.active = this.views.length - 1;
    this.options.onViewsChanged?.();
    this.refresh();
  }

  private renderActions(): void {
    clear(this.actionsEl);
    const entry = this.views[this.active];
    const respect = el("label", { class: "control check clean-check" });
    respect.title = "Aggregate only rows that match the current filters";
    const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
    checkbox.checked = entry?.def.respectFilters ?? true;
    checkbox.addEventListener("change", () =>
      this.update((view) => {
        view.respectFilters = checkbox.checked;
      }),
    );
    respect.append(checkbox, "Respects filters");

    const limitLabel = el("label", { class: "views-limit" });
    limitLabel.title = "Maximum groups shown; the rest are summarised in the note";
    const limitInput = el("input", {
      class: "chart-number",
      type: "number",
      min: "1",
      max: "100000",
      step: "1",
      "aria-label": "Group limit",
    }) as HTMLInputElement;
    limitInput.value = String(entry?.def.limit ?? DEFAULT_LIMIT);
    limitInput.addEventListener("change", () => {
      const value = Math.floor(Number(limitInput.value));
      this.update((view) => {
        view.limit = Number.isFinite(value) && value >= 1 ? Math.min(100_000, value) : DEFAULT_LIMIT;
      });
    });
    limitLabel.append("Groups", limitInput);

    const chart = el(
      "button",
      { class: "ghost small", type: "button", title: "Create a chart of this aggregate view" },
      ["Chart this"],
    ) as HTMLButtonElement;
    chart.disabled = entry === undefined || !isCompleteView(entry.def);
    chart.addEventListener("click", () => {
      if (entry !== undefined) this.options.onChart(entry.def);
    });

    const pandas = el(
      "button",
      { class: "ghost small", type: "button", title: "Copy the pandas groupby recipe" },
      ["Copy as pandas"],
    ) as HTMLButtonElement;
    pandas.disabled = entry === undefined || !isCompleteView(entry.def);
    pandas.addEventListener("click", () => {
      if (entry !== undefined) void this.options.onCopyPandas(entry.def);
    });

    const slick = el(
      "button",
      {
        class: "ghost small",
        type: "button",
        title: "Render this view as a publication-style table (PNG or HTML)",
      },
      ["Slick table"],
    ) as HTMLButtonElement;
    slick.disabled = entry === undefined || entry.result === null;
    slick.addEventListener("click", () => {
      if (entry !== undefined && entry.result !== null) {
        this.options.onSlickTable?.(entry.def, entry.result);
      }
    });

    const csv = el(
      "button",
      {
        class: "ghost small",
        type: "button",
        title: "Download the current pivot or aggregate result as CSV",
      },
      ["Export CSV"],
    ) as HTMLButtonElement;
    csv.disabled = entry === undefined || !hasResult(entry);
    csv.addEventListener("click", () => {
      if (entry !== undefined && hasResult(entry)) this.exportCsv(entry);
    });

    const firstDim = entry?.def.dimensions[0];
    const isTimeDim =
      firstDim !== undefined && typeof firstDim.by === "object" && "time" in firstDim.by;

    this.actionsEl.append(respect, el("span", { class: "grow" }));
    if (isTimeDim && entry !== undefined) {
      const grainLabel = el("label", { class: "views-limit" });
      grainLabel.title = "Resample the first time dimension to a regular grain";
      const grainSelect = el("select", {
        class: "chart-picker chart-picker-small",
        "aria-label": "Resample time grain",
      }) as HTMLSelectElement;
      const currentGrain =
        typeof firstDim.by === "object" && "time" in firstDim.by ? firstDim.by.time : "month";
      for (const grain of ["hour", "day", "week", "month", "quarter", "year"] as const) {
        const option = el("option", { value: grain }, [
          grain.charAt(0).toUpperCase() + grain.slice(1),
        ]) as HTMLOptionElement;
        if (currentGrain === grain) option.selected = true;
        grainSelect.append(option);
      }
      grainSelect.addEventListener("change", () =>
        this.update((view) => {
          const first = view.dimensions[0];
          if (first === undefined || typeof first.by !== "object" || !("time" in first.by)) {
            return;
          }
          view.dimensions[0] = {
            ...first,
            by: { ...first.by, time: grainSelect.value as TimeGrain },
          };
          if (view.fill === "none") view.fill = "zero";
          if (view.sort.key === "dim0") view.sort = { key: "dim0", dir: "asc" };
        }),
      );
      grainLabel.append("Resample", grainSelect);
      this.actionsEl.append(grainLabel);

      const fillLabel = el("label", { class: "views-limit" });
      fillLabel.title = "How periods with no rows appear in the result";
      const fillSelect = el("select", {
        class: "chart-picker chart-picker-small",
        "aria-label": "Empty periods",
      }) as HTMLSelectElement;
      const fillOptions: readonly (readonly [ViewDef["fill"], string])[] = [
        ["none", "Drop"],
        ["zero", "Zero"],
        ["carry", "Carry forward"],
      ];
      for (const [value, label] of fillOptions) {
        const option = el("option", { value }, [label]) as HTMLOptionElement;
        if (entry.def.fill === value) option.selected = true;
        fillSelect.append(option);
      }
      fillSelect.addEventListener("change", () =>
        this.update((view) => {
          view.fill = fillSelect.value as ViewDef["fill"];
        }),
      );
      fillLabel.append("Empty periods", fillSelect);
      this.actionsEl.append(fillLabel);

      const partialLabel = el("label", { class: "views-limit" });
      partialLabel.title = "First/last periods do not span the whole period; exclude them or keep them flagged";
      const partialSelect = el("select", {
        class: "chart-picker chart-picker-small",
        "aria-label": "Incomplete periods",
      }) as HTMLSelectElement;
      for (const [value, label] of [
        ["show", "Keep (flagged)"],
        ["exclude", "Exclude"],
      ] as const) {
        const option = el("option", { value }, [label]) as HTMLOptionElement;
        if ((entry.def.partial ?? "show") === value) option.selected = true;
        partialSelect.append(option);
      }
      partialSelect.addEventListener("change", () =>
        this.update((view) => {
          view.partial = partialSelect.value === "exclude" ? "exclude" : "show";
        }),
      );
      partialLabel.append("Partial periods", partialSelect);
      this.actionsEl.append(partialLabel);
    }
    if (entry !== undefined && this.pivotIndexes(entry.def).length > 0) {
      const marginsLabel = el("label", {
        class: "control check clean-check",
      });
      marginsLabel.title = "Add an All row and All column of totals computed from the raw rows";
      const marginsInput = el("input", {
        type: "checkbox",
        "aria-label": "Pivot margins",
      }) as HTMLInputElement;
      marginsInput.checked = entry.def.margins === true;
      marginsInput.addEventListener("change", () =>
        this.update((view) => {
          view.margins = marginsInput.checked;
        }),
      );
      marginsLabel.append(marginsInput, "All totals");

      const fillLabel = el("label", { class: "views-limit views-fill" });
      fillLabel.title = "Value shown where a row and column combination has no rows";
      const fillInput = el("input", {
        class: "views-fill-input",
        type: "number",
        placeholder: "blank",
        "aria-label": "Pivot fill value",
        value:
          typeof entry.def.fillValue === "number" ? String(entry.def.fillValue) : "",
      }) as HTMLInputElement;
      fillInput.addEventListener("change", () =>
        this.update((view) => {
          const value = fillInput.value.trim();
          view.fillValue = value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
        }),
      );
      fillLabel.append("Fill empty", fillInput);

      const dropLabel = el("label", { class: "control check clean-check" });
      dropLabel.title = "Hide pivot rows and columns that contain no values";
      const dropInput = el("input", {
        type: "checkbox",
        "aria-label": "Drop empty pivot rows and columns",
      }) as HTMLInputElement;
      dropInput.checked = entry.def.dropna === true;
      dropInput.addEventListener("change", () =>
        this.update((view) => {
          view.dropna = dropInput.checked;
        }),
      );
      dropLabel.append(dropInput, "Drop empty");

      const orderLabel = el("label", { class: "views-limit" });
      orderLabel.title = "Sort index and column keys by label or by first appearance";
      const orderSelect = el("select", {
        class: "chart-picker chart-picker-small",
        "aria-label": "Pivot key order",
      }) as HTMLSelectElement;
      for (const [value, label] of [
        ["label", "Label"],
        ["source", "Source order"],
      ] as const) {
        const option = el("option", { value }, [label]) as HTMLOptionElement;
        if ((entry.def.pivotSort ?? "label") === value) option.selected = true;
        orderSelect.append(option);
      }
      orderSelect.addEventListener("change", () =>
        this.update((view) => {
          view.pivotSort = orderSelect.value === "source" ? "source" : "label";
        }),
      );
      orderLabel.append("Order", orderSelect);

      const marginsNameLabel = el("label", { class: "views-limit views-fill" });
      marginsNameLabel.title = "Label used for the All margin row and column";
      const marginsNameInput = el("input", {
        class: "views-fill-input",
        type: "text",
        maxlength: "24",
        "aria-label": "Pivot margins name",
        value: entry.def.marginsName ?? "All",
      }) as HTMLInputElement;
      marginsNameInput.addEventListener("change", () =>
        this.update((view) => {
          const name = marginsNameInput.value.trim();
          view.marginsName = name === "" ? undefined : name;
        }),
      );
      marginsNameLabel.append("All label", marginsNameInput);

      const csvHeadersLabel = el("label", { class: "views-limit" });
      csvHeadersLabel.title = "CSV header style for this pivot";
      const csvHeadersSelect = el("select", {
        class: "chart-picker chart-picker-small",
        "aria-label": "Pivot CSV headers",
      }) as HTMLSelectElement;
      for (const [value, label] of [
        ["flat", "Flat CSV"],
        ["multi", "Multi-row CSV"],
      ] as const) {
        const option = el("option", { value }, [label]) as HTMLOptionElement;
        if ((entry.def.pivotCsvHeaders ?? "flat") === value) option.selected = true;
        csvHeadersSelect.append(option);
      }
      csvHeadersSelect.addEventListener("change", () =>
        this.update((view) => {
          view.pivotCsvHeaders = csvHeadersSelect.value === "multi" ? "multi" : "flat";
        }),
      );
      csvHeadersLabel.append("CSV", csvHeadersSelect);

      const marginPctLabel = el("label", { class: "views-limit" });
      marginPctLabel.title =
        "Convert displayed values to a percentage of their row, column or grand total";
      const marginPctSelect = el("select", {
        class: "chart-picker chart-picker-small",
        "aria-label": "Pivot value display",
      }) as HTMLSelectElement;
      for (const [value, label] of [
        ["none", "Absolute"],
        ["row", "% of row total"],
        ["column", "% of column total"],
        ["grand", "% of grand total"],
      ] as const) {
        const option = el("option", { value }, [label]) as HTMLOptionElement;
        if ((entry.def.pivotMarginPct ?? "none") === value) option.selected = true;
        marginPctSelect.append(option);
      }
      marginPctSelect.addEventListener("change", () =>
        this.update((view) => {
          view.pivotMarginPct =
            marginPctSelect.value === "row"
              ? "row"
              : marginPctSelect.value === "column"
                ? "column"
                : marginPctSelect.value === "grand"
                  ? "grand"
                  : "none";
        }),
      );
      marginPctLabel.append("Show as", marginPctSelect);

      const heatmapLabel = el("label", { class: "views-limit" });
      heatmapLabel.title = "Shade pivot cells with the coolwarm ramp";
      const heatmapSelect = el("select", {
        class: "chart-picker chart-picker-small",
        "aria-label": "Pivot heatmap palette",
      }) as HTMLSelectElement;
      for (const [value, label] of [
        ["none", "Accent"],
        ["coolwarm", "Coolwarm"],
        ["coolwarm-reversed", "Coolwarm reversed"],
      ] as const) {
        const option = el("option", { value }, [label]) as HTMLOptionElement;
        if ((entry.def.pivotHeatmap ?? "none") === value) option.selected = true;
        heatmapSelect.append(option);
      }
      heatmapSelect.addEventListener("change", () =>
        this.update((view) => {
          view.pivotHeatmap = heatmapSelect.value === "coolwarm" ? "coolwarm" : heatmapSelect.value === "coolwarm-reversed" ? "coolwarm-reversed" : "none";
        }),
      );
      heatmapLabel.append("Heatmap", heatmapSelect);

      this.actionsEl.append(
        marginsLabel,
        fillLabel,
        dropLabel,
        orderLabel,
        marginsNameLabel,
        csvHeadersLabel,
        marginPctLabel,
        heatmapLabel,
      );
    }
    const duplicate = el(
      "button",
      {
        class: "ghost small views-duplicate",
        type: "button",
        title: "Duplicate this view as a new named pivot",
      },
      ["Duplicate view"],
    ) as HTMLButtonElement;
    duplicate.disabled = this.views.length >= MAX_VIEWS || entry === undefined;
    duplicate.addEventListener("click", () => this.duplicateView());
    const below = el(
      "button",
      {
        class: "ghost small views-new-below",
        type: "button",
        title: "Create a new view directly below this one",
      },
      ["+ New view below"],
    ) as HTMLButtonElement;
    below.disabled = this.views.length >= MAX_VIEWS;
    below.addEventListener("click", () => this.addView(this.active + 1));
    this.actionsEl.append(limitLabel, chart, slick, csv, pandas, duplicate, below);
  }

  /** CSV of the current aggregate or pivot matrix. */
  private exportCsv(entry: ViewEntry): void {
    const pivot = entry.pivotResult;
    if (pivot !== null) {
      if (pivot.measures.length === 0) return;
      const exported = pivotCsvRows(pivot, {
        headers: entry.def.pivotCsvHeaders === "multi" ? "multi" : "flat",
        marginPct: entry.def.pivotMarginPct ?? "none",
        formulaSafe: true,
      });
      if (exported.tooLarge) {
        this.transientNote = "Pivot CSV is too large to export at once. Filter the data or reduce the fields.";
        this.render();
        return;
      }
      if (exported.rows.length < 2) return;
      downloadCsv(
        `${safeFileName(entry.def.name) || "pivot-view"}.csv`,
        exported.rows,
      );
      return;
    }    const result = entry.result;
    if (result === null) return;
    const rows: string[][] = [];
    const pivots = this.pivotIndexes(entry.def);
    if (
      pivots.length > 0 &&
      result.dimensions.length > pivots.length &&
      result.measures.length > 0
    ) {
      const pivotSet = new Set(pivots);
      const rowDims = result.dimensions.filter((_, index) => !pivotSet.has(index));
      const rowNames = result.dimensionNames.filter((_, index) => !pivotSet.has(index));
      const colDims = pivots.map((index) => result.dimensions[index] ?? []);
      let rowKeys: string[] = [];
      let rowParts: string[][] = [];
      let colKeys: string[] = [];
      let colParts: string[][] = [];
      const rowIndex = new Map<string, number>();
      const colIndex = new Map<string, number>();
      for (let group = 0; group < result.groupCount; group++) {
        const parts = rowDims.map((dimension) => dimension[group] ?? "");
        const row = parts.join("\u001f");
        const cparts = colDims.map((dimension) => dimension[group] ?? "");
        const col = cparts.join("\u001f");
        if (!rowIndex.has(row)) {
          rowIndex.set(row, rowKeys.length);
          rowKeys.push(row);
          rowParts.push(parts);
        }
        if (!colIndex.has(col)) {
          colIndex.set(col, colKeys.length);
          colKeys.push(col);
          colParts.push(cparts);
        }
      }
      const ordered = colKeys
        .map((_, index) => index)
        .sort((a, b) => (colParts[a] ?? []).join("\u001f").localeCompare((colParts[b] ?? []).join("\u001f")));
      colKeys = ordered.map((index) => colKeys[index]!);
      colParts = ordered.map((index) => colParts[index]!);
      colIndex.clear();
      colKeys.forEach((key, index) => colIndex.set(key, index));
      const measureIndex = this.pivotMeasureIndex(entry.def, result);
      const measure = result.measures[measureIndex];
      let cells = new Float64Array(rowKeys.length * colKeys.length).fill(Number.NaN);
      if (measure !== undefined) {
        for (let group = 0; group < result.groupCount; group++) {
          const row = rowDims.map((dimension) => dimension[group] ?? "").join("\u001f");
          const col = colDims.map((dimension) => dimension[group] ?? "").join("\u001f");
          const r = rowIndex.get(row) ?? 0;
          const c = colIndex.get(col) ?? 0;
          cells[r * colKeys.length + c] = measure[group] ?? Number.NaN;
        }
      }
      if (entry.def.dropna === true) {
        const keepRows = rowKeys
          .map((_, row) => (colKeys.some((_, col) => Number.isFinite(cells[row * colKeys.length + col])) ? row : -1))
          .filter((row) => row >= 0);
        const keepCols = colKeys
          .map((_, col) => (rowKeys.some((_, row) => Number.isFinite(cells[row * colKeys.length + col])) ? col : -1))
          .filter((col) => col >= 0);
        if (keepRows.length !== rowKeys.length || keepCols.length !== colKeys.length) {
          const oldCells = cells;
          const oldCols = colKeys.length;
          cells = new Float64Array(keepRows.length * keepCols.length).fill(Number.NaN);
          keepRows.forEach((row, r) => {
            keepCols.forEach((col, c) => {
              cells[r * keepCols.length + c] = oldCells[row * oldCols + col] ?? Number.NaN;
            });
          });
          rowKeys = keepRows.map((row) => rowKeys[row]!);
          rowParts = keepRows.map((row) => rowParts[row]!);
          colKeys = keepCols.map((col) => colKeys[col]!);
          colParts = keepCols.map((col) => colParts[col]!);
        }
      }
      const margins = entry.def.margins === true ? entry.margins : null;
      const marginsName = entry.def.marginsName ?? "All";
      const fillValue =
        entry.def.fillValue === undefined || entry.def.fillValue === null
          ? null
          : entry.def.fillValue;
      const format = (value: number): string =>
        Number.isFinite(value) ? String(value) : fillValue === null ? "" : String(fillValue);
      const rowTotals = new Map<string, number>();
      const colTotals = new Map<string, number>();
      let grandTotal = Number.NaN;
      if (margins?.rows !== null && margins?.rows !== undefined) {
        const dims = margins.rows.dimensions;
        const values = margins.rows.measures[measureIndex];
        for (let group = 0; group < margins.rows.groupCount; group++) {
          const key = dims.map((dimension) => dimension[group] ?? "").join("\u001f");
          rowTotals.set(key, values?.[group] ?? Number.NaN);
        }
      }
      if (margins?.cols !== null && margins?.cols !== undefined) {
        const dims = margins.cols.dimensions;
        const values = margins.cols.measures[measureIndex];
        for (let group = 0; group < margins.cols.groupCount; group++) {
          const key = dims.map((dimension) => dimension[group] ?? "").join("\u001f");
          colTotals.set(key, values?.[group] ?? Number.NaN);
        }
      }
      grandTotal = margins?.total?.measures[measureIndex]?.[0] ?? Number.NaN;
      rows.push([
        ...(rowNames.length === 0 ? ["group"] : rowNames),
        ...colParts.map((parts) => parts.join(" / ")),
        ...(margins === null ? [] : [marginsName]),
      ]);
      rowKeys.forEach((rowKey, r) => {
        rows.push([
          ...(rowParts[r] ?? []),
          ...colKeys.map((_, c) => format(cells[r * colKeys.length + c] ?? Number.NaN)),
          ...(margins === null ? [] : [format(rowTotals.get(rowKey) ?? Number.NaN)]),
        ]);
      });
      if (margins !== null) {
        rows.push([
          marginsName,
          ...rowNames.slice(1).map(() => ""),
          ...colKeys.map((colKey) => format(colTotals.get(colKey) ?? Number.NaN)),
          format(grandTotal),
        ]);
      }
    } else {
      rows.push([...result.dimensionNames, ...result.measureNames]);
      for (let group = 0; group < result.groupCount; group++) {
        rows.push([
          ...result.dimensions.map((dimension) => dimension[group] ?? ""),
          ...result.measures.map((measure) => {
            const value = measure[group] ?? Number.NaN;
            return Number.isFinite(value) ? String(value) : "";
          }),
        ]);
      }
    }
    if (rows.length < 2) return;
    downloadCsv(`${safeFileName(entry.def.name) || "pivot-view"}.csv`, rows);
  }

  private renderBuilder(def: ViewDef): void {
    clear(this.builderEl);
    const pivotSet = new Set(this.pivotIndexes(def));
    const indexFields = def.dimensions
      .map((_, index) => index)
      .filter((index) => !pivotSet.has(index));
    const columnFields = def.dimensions
      .map((_, index) => index)
      .filter((index) => pivotSet.has(index));

    const indexZone = el("div", { class: "views-zone views-index-zone" });
    indexZone.append(el("span", { class: "views-zone-label" }, ["Index:"]));
    indexFields.forEach((index, position) => {
      indexZone.append(
        this.dimensionPill(def, def.dimensions[index]!, index, "index", position, indexFields.length),
      );
    });
    if (indexFields.length === 0) {
      indexZone.append(
        el("span", { class: "views-layout-hint" }, ["Add a field for the row index."]),
      );
    }
    const addDim = el(
      "button",
      { class: "views-pill add", type: "button", title: "Add a row index field" },
      ["+ Field"],
    ) as HTMLButtonElement;
    addDim.addEventListener("click", () => this.openDimensionMenu(addDim, def));
    if (def.dimensions.length < 6) indexZone.append(addDim);

    const columnZone = el("div", { class: "views-zone views-column-zone" });
    columnZone.append(el("span", { class: "views-zone-label" }, ["Columns:"]));
    columnFields.forEach((index, position) => {
      columnZone.append(
        this.dimensionPill(def, def.dimensions[index]!, index, "columns", position, columnFields.length),
      );
    });
    if (columnFields.length === 0) {
      columnZone.append(
        el("span", { class: "views-layout-hint" }, [
          "Optional: move a field here to spread it across columns.",
        ]),
      );
    }

    const measureZone = el("div", { class: "views-zone views-measure-zone" });
    measureZone.append(el("span", { class: "views-zone-label" }, ["Values:"]));
    def.measures.forEach((measure, index) => {
      measureZone.append(this.measurePill(def, measure, index));
    });
    (def.pivotLambdas ?? []).forEach((lambda, index) => {
      measureZone.append(this.lambdaPill(def, lambda, index));
    });
    const addMeasure = el(
      "button",
      { class: "views-pill add", type: "button", title: "Add a value" },
      ["+ Value"],
    ) as HTMLButtonElement;
    addMeasure.addEventListener("click", () => this.openMeasureMenu(addMeasure, def));
    measureZone.append(addMeasure);
    const addAllNumeric = el(
      "button",
      { class: "views-pill add", type: "button", title: "Add every numeric column as a mean value" },
      ["+ All numeric"],
    ) as HTMLButtonElement;
    addAllNumeric.disabled = !this.metas.some((meta) => isNumericLikeType(meta.type));
    addAllNumeric.addEventListener("click", () =>
      this.update((view) => {
        const used = new Set(
          view.measures
            .map((measure) => measure.column)
            .filter((column): column is number => column !== null),
        );
        this.metas.forEach((meta, index) => {
          if (!isNumericLikeType(meta.type) || used.has(index)) return;
          view.measures.push({ column: index, agg: "mean" });
        });
      }),
    );
    measureZone.append(addAllNumeric);
    const addLambda = el(
      "button",
      { class: "views-pill add", type: "button", title: "Add a safe custom lambda value" },
      ["+ Lambda"],
    ) as HTMLButtonElement;
    addLambda.disabled = !this.metas.some((meta) => isNumericLikeType(meta.type));
    addLambda.addEventListener("click", () => this.openLambdaMenu(addLambda));
    measureZone.append(addLambda);

    this.wireDropZone(indexZone, "index");
    this.wireDropZone(columnZone, "columns");
    this.wireDropZone(measureZone, "values");
    const filterZone =
      this.pivotIndexes(def).length > 0 ? this.filterZone(def) : null;
    this.builderEl.append(
      this.pivotTools(),
      indexZone,
      columnZone,
      measureZone,
      ...(filterZone === null ? [] : [filterZone]),
      this.fieldShelf(def),
      this.transposeControl(def),
    );
  }

  /** Top-of-pivot heading and drag hint. */
  private pivotTools(): HTMLElement {
    return el("div", { class: "views-pivot-top" }, [
      el("div", { class: "views-pivot-top-copy" }, [
        el("span", { class: "views-pivot-top-title" }, ["Pivot layout"]),
        el("span", { class: "views-pivot-top-hint" }, [
          "Drag fields into Index, Columns or Values",
        ]),
      ]),
    ]);
  }

  /** Large transpose action below the field shelf. */
  private transposeControl(def: ViewDef): HTMLElement {
    const row = el("div", { class: "views-transpose-row" });
    const pivots = this.pivotIndexes(def);
    const transpose = el(
      "button",
      {
        class: "views-transpose",
        type: "button",
        title: "Transpose - swap the Index and Columns fields",
        "aria-label": "Transpose Index and Columns fields",
      },
      [transposeIcon(), el("span", { class: "views-transpose-label" }, ["Transpose"])],
    ) as HTMLButtonElement;
    transpose.disabled =
      pivots.length === 0 || pivots.length >= def.dimensions.length;
    transpose.addEventListener("click", () => this.transposePivot());
    row.append(transpose);
    return row;
  }

  /** Filters over any dataset column, whether or not it is in the layout. */
  private filterZone(def: ViewDef): HTMLElement {
    const zone = el("div", { class: "views-zone views-filter-zone" });
    zone.append(el("span", { class: "views-zone-label" }, ["Filters:"]));
    const filters = (def.pivotValueFilters ?? []).filter(
      (filter) => this.metas[filter.column] !== undefined,
    );
    for (const filter of filters) {
      const meta = this.metas[filter.column]!;
      const pill = el("span", { class: "views-pill views-report-filter-pill" });
      const edit = el(
        "button",
        {
          class: "views-pill-label",
          type: "button",
          title: filterDescription(filter),
        },
        [
          filterIcon(),
          el("span", {}, [meta.name]),
          el("span", { class: "views-filter-chip-count" }, [
            String(filterValueCount(filter)),
          ]),
        ],
      ) as HTMLButtonElement;
      edit.addEventListener("click", () =>
        this.openFilterForColumn(edit, filter.column, "Report filter"),
      );
      const remove = el(
        "button",
        { class: "views-pill-remove", type: "button", title: "Clear this filter" },
        ["×"],
      ) as HTMLButtonElement;
      remove.addEventListener("click", () =>
        this.update((view) => {
          view.pivotValueFilters = (view.pivotValueFilters ?? []).filter(
            (entry) => entry.column !== filter.column,
          );
        }),
      );
      pill.append(edit, remove);
      zone.append(pill);
    }
    if (filters.length === 0) {
      zone.append(
        el("span", { class: "views-layout-hint" }, [
          "Filter rows by any column - it does not need to be in the layout.",
        ]),
      );
    }
    const add = el(
      "button",
      { class: "views-pill add", type: "button", title: "Filter any column" },
      ["+ Filter"],
    ) as HTMLButtonElement;
    add.addEventListener("click", () => this.openFilterColumnMenu(add, def));
    zone.append(add);
    if (filters.length > 0) {
      const clear = el(
        "button",
        { class: "ghost small views-filter-clear-all", type: "button" },
        ["Clear all"],
      ) as HTMLButtonElement;
      clear.addEventListener("click", () =>
        this.update((view) => {
          view.pivotValueFilters = [];
        }),
      );
      zone.append(clear);
    }
    return zone;
  }

  private openFilterColumnMenu(anchor: HTMLElement, def: ViewDef): void {
    const active = new Set((def.pivotValueFilters ?? []).map((filter) => filter.column));
    const items: MenuItem[] = this.metas.map((meta, column) => ({
      label: `${meta.name}${active.has(column) ? " (filtered)" : ""}`,
      title: `Filter pivot rows by ${meta.name}`,
      action: () => this.openFilterForColumn(anchor, column, "Report filter"),
    }));
    openMenu(anchor, items);
  }
  /** Persistent draggable shelf showing every dataset column. */
  private fieldShelf(def: ViewDef): HTMLElement {
    const shelf = el("div", { class: "views-field-shelf" });
    const head = el("div", { class: "views-shelf-head" });
    const heading = el("div", { class: "views-shelf-heading" }, [
      el("span", { class: "views-shelf-title" }, [
        `All fields (${this.metas.length})`,
      ]),
      el("span", { class: "views-shelf-hint" }, [
        "↑ Drag a field up into Index, Columns or Values",
      ]),
    ]);
    const search = el("input", {
      class: "views-shelf-search",
      type: "search",
      placeholder: "Find a field…",
      "aria-label": "Find a pivot field",
      value: this.fieldSearch,
    }) as HTMLInputElement;
    head.append(heading, search);
    const list = el("div", { class: "views-shelf-list" });
    const pivotSet = new Set(this.pivotIndexes(def));
    const dimensionColumns = new Set(def.dimensions.map((dimension) => dimension.column));
    const measureColumns = new Set(
      def.measures
        .map((measure) => measure.column)
        .filter((column): column is number => column !== null),
    );
    const chips: HTMLElement[] = [];
    this.metas.forEach((meta, column) => {
      const usedDimension = dimensionColumns.has(column);
      const asColumn = def.dimensions.some(
        (dimension, index) => dimension.column === column && pivotSet.has(index),
      );
      const usedMeasure = measureColumns.has(column);
      const chip = el(
        "button",
        {
          class: `views-shelf-chip${usedDimension ? " used-index" : ""}${
            asColumn ? " used-column" : ""
          }${usedMeasure ? " used-value" : ""}`,
          type: "button",
          title: `Drag "${meta.name}" into Index, Columns or Values`,
        },
        [
          el("span", { class: "views-shelf-name" }, [meta.name]),
          el("span", { class: "views-shelf-type" }, [TYPE_LABELS[meta.type]]),
        ],
      ) as HTMLButtonElement;
      chip.dataset.search = meta.name.toLocaleLowerCase();
      chip.draggable = true;
      this.makePillDraggable(chip, { kind: "column", index: column, well: "shelf" });
      chip.addEventListener("click", () =>
        this.openShelfMenu(chip, column, meta.name, def),
      );
      chips.push(chip);
      list.append(chip);
    });
    search.addEventListener("input", () => {
      this.fieldSearch = search.value.trim().toLocaleLowerCase();
      for (const chip of chips) {
        chip.hidden = !(chip.dataset.search ?? "").includes(this.fieldSearch);
      }
    });
    for (const chip of chips) {
      chip.hidden = !(chip.dataset.search ?? "").includes(this.fieldSearch);
    }
    shelf.append(head, list);
    return shelf;
  }

  private openShelfMenu(
    anchor: HTMLElement,
    column: number,
    name: string,
    def: ViewDef,
  ): void {
    const pivots = this.pivotIndexes(def);
    const source: PivotDragSource = { kind: "column", index: column, well: "shelf" };
    const items: MenuItem[] = [
      {
        label: "Add to Index",
        title: `Group rows by ${name}`,
        action: () =>
          this.applyPivotFieldMove(source, "index", def.dimensions.length - pivots.length),
      },
      {
        label: "Add to Columns",
        title: `Spread ${name} across columns`,
        action: () => this.applyPivotFieldMove(source, "columns", pivots.length),
      },
      {
        label: "Add to Values",
        title: `Aggregate ${name} as a value`,
        action: () => this.applyPivotFieldMove(source, "values", def.measures.length),
      },
    ];
    const meta = this.metas[column];
    if (meta?.type === "date" || meta?.type === "datetime") {
      const dateSpec: DimensionSpec = { column, by: { time: "month" } };
      items.unshift(
        {
          label: "Date groups in Index…",
          title: `Choose Years, Quarters, Months and more as nested ${name} fields`,
          action: () => this.openDateGroups(dateSpec, "index"),
        },
        {
          label: "Date groups in Columns…",
          title: `Spread nested ${name} date groups across columns`,
          action: () => this.openDateGroups(dateSpec, "columns"),
        },
      );
    }
    if (this.pivotIndexes(def).length > 0) {
      items.push({
        label: "Filter values...",
        title: `Filter pivot rows by ${name}`,
        action: () => this.openFilterForColumn(anchor, column, "Report filter"),
      });
    }
    openMenu(anchor, items);
  }
  /** Wire one builder well as a drag/drop target for pivot fields. */
  private wireDropZone(zone: HTMLElement, well: PivotWell): void {
    zone.dataset.pivotWell = well;
    zone.addEventListener("dragover", (event) => {
      if (this.pivotDrag === null) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
      zone.classList.add("pivot-drop-target");
    });
    zone.addEventListener("dragleave", (event) => {
      if (event.relatedTarget === null || !zone.contains(event.relatedTarget as Node)) {
        zone.classList.remove("pivot-drop-target");
      }
    });
    zone.addEventListener("drop", (event) => {
      const source = this.pivotDrag;
      if (source === null) return;
      event.preventDefault();
      this.clearPivotDrag();
      const position = this.pivotDropPosition(zone, well, source, event);
      this.applyPivotFieldMove(source, well, position);
    });
  }

  /** Apply a field move on a trial copy, then commit it to the active view. */
  private applyPivotFieldMove(
    source: PivotDragSource,
    target: PivotWell,
    position: number,
  ): void {
    const entry = this.views[this.active];
    if (entry === undefined) return;
    const trial: ViewDef = {
      ...entry.def,
      dimensions: [...entry.def.dimensions],
      measures: [...entry.def.measures],
      pivotColumns: [...(entry.def.pivotColumns ?? [])],
    };
    const column =
      source.kind === "column"
        ? source.index
        : source.kind === "dimension"
          ? entry.def.dimensions[source.index]?.column
          : undefined;
    const meta = column === undefined ? undefined : this.metas[column];
    const result = movePivotField(
      trial,
      source,
      target,
      position,
      meta !== undefined && isNumericLikeType(meta.type),
      meta?.type === "date" || meta?.type === "datetime",
    );
    if (!result.ok) {
      this.transientNote = result.reason ?? "That field cannot move there.";
      this.render();
      return;
    }
    this.update((view) => Object.assign(view, trial));
  }

  /** Insertion slot from the pointer position among the well's field pills. */
  private pivotDropPosition(
    zone: HTMLElement,
    well: PivotWell,
    source: PivotDragSource,
    event: DragEvent,
  ): number {
    const selector = well === "values" ? "[data-measure-index]" : "[data-dimension-index]";
    const items = [...zone.querySelectorAll<HTMLElement>(selector)].filter((item) => {
      if (source.well !== well) return true;
      return well === "values"
        ? item.dataset.measureIndex !== String(source.index)
        : item.dataset.dimensionIndex !== String(source.index);
    });
    for (let index = 0; index < items.length; index++) {
      const rect = items[index]!.getBoundingClientRect();
      if (event.clientY < rect.top) return index;
      if (event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2) {
        return index;
      }
    }
    return items.length;
  }

  private makePillDraggable(pill: HTMLElement, source: PivotDragSource): void {
    pill.draggable = true;
    pill.title = `${pill.title ? `${pill.title} - ` : ""}Drag to move between Index, Columns and Values`;
    pill.addEventListener("dragstart", (event) => {
      this.pivotDrag = source;
      pill.classList.add("dragging");
      if (event.dataTransfer !== null) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "pivot-field");
      }
    });
    pill.addEventListener("dragend", () => {
      pill.classList.remove("dragging");
      this.clearPivotDrag();
    });
  }

  private clearPivotDrag(): void {
    this.pivotDrag = null;
    this.builderEl
      .querySelectorAll(".pivot-drop-target")
      .forEach((zone) => zone.classList.remove("pivot-drop-target"));
  }
  /** Swap the current index and column wells and recompute the pivot. */
  private transposePivot(): void {
    this.update((view) => {
      const pivots = new Set(this.pivotIndexes(view));
      const oldColumns = view.dimensions
        .map((_, index) => index)
        .filter((index) => pivots.has(index));
      if (oldColumns.length === 0) return;
      const nextColumns = view.dimensions
        .map((_, index) => index)
        .filter((index) => !pivots.has(index));
      if (nextColumns.length === 0) return;
      view.pivotColumns = nextColumns;
      view.pivot = nextColumns[0];
      view.fillValue = undefined;
    });
  }
  /** Swap a field with its neighbour inside the same well. */
  private moveDimension(
    view: ViewDef,
    group: "index" | "columns",
    position: number,
    delta: -1 | 1,
  ): void {
    const pivots = new Set(this.pivotIndexes(view));
    const positions = view.dimensions
      .map((_, index) => index)
      .filter((index) => (group === "index" ? !pivots.has(index) : pivots.has(index)));
    const from = positions[position];
    const to = positions[position + delta];
    if (from === undefined || to === undefined) return;
    const left = view.dimensions[from];
    const right = view.dimensions[to];
    if (left === undefined || right === undefined) return;
    view.dimensions[from] = right;
    view.dimensions[to] = left;
    view.pivotColumns = (view.pivotColumns ?? [])
      .map((index) => (index === from ? to : index === to ? from : index))
      .sort((a, b) => a - b);
    view.pivot = view.pivotColumns[0];
  }

  private dimensionPill(
    def: ViewDef,
    spec: DimensionSpec,
    index: number,
    group: "index" | "columns",
    position: number,
    count: number,
  ): HTMLElement {
    const meta = this.metas[spec.column];
    const suffix = this.dimensionSuffix(spec);
    const pill = el(
      "span",
      { class: `views-pill ${group === "index" ? "views-index-pill" : "views-column-pill"}` },
    );
    pill.dataset.dimensionIndex = String(index);
    this.makePillDraggable(pill, { kind: "dimension", index, well: group });
    const grip = el("span", { class: "views-pill-grip", "aria-hidden": "true" }, ["\u2807"]);
    const label = el(
      "button",
      { class: "views-pill-label", type: "button", title: "Change how this column is grouped" },
      [`${meta?.name ?? "?"}${suffix}`],
    ) as HTMLButtonElement;
    label.addEventListener("click", () => this.openGrainMenu(label, def, spec, index));

    const up = el(
      "button",
      {
        class: "views-pill-move",
        type: "button",
        title: "Move earlier in this well",
        "aria-label": "Move earlier",
      },
      ["▲"],
    ) as HTMLButtonElement;
    up.disabled = position === 0;
    up.addEventListener("click", () =>
      this.update((view) => this.moveDimension(view, group, position, -1)),
    );
    const down = el(
      "button",
      {
        class: "views-pill-move",
        type: "button",
        title: "Move later in this well",
        "aria-label": "Move later",
      },
      ["▼"],
    ) as HTMLButtonElement;
    down.disabled = position === count - 1;
    down.addEventListener("click", () =>
      this.update((view) => this.moveDimension(view, group, position, 1)),
    );
    const activeFilter = def.pivotValueFilters?.find(
      (filter) => filter.column === spec.column,
    );
    const filter =
      spec.by === "value" && this.pivotIndexes(def).length > 0
        ? (el(
            "button",
            {
              class: `views-pill-filter${activeFilter === undefined ? "" : " active"}`,
              type: "button",
              title:
                activeFilter === undefined
                  ? "Filter this field"
                  : `${filterDescription(activeFilter)} - click to edit`,
              "aria-label": "Filter field values",
            },
            [filterIcon()],
          ) as HTMLButtonElement)
        : null;
    if (filter !== null && activeFilter !== undefined) {
      filter.append(
        el("span", { class: "views-pill-filter-count" }, [
          String(filterValueCount(activeFilter)),
        ]),
      );
    }
    filter?.addEventListener("click", () =>
      this.openFilterForColumn(
        filter,
        spec.column,
        group === "index" ? "Index filter" : "Column filter",
      ),
    );
    const toggle = el(
      "button",
      {
        class: "views-pill-group-toggle",
        type: "button",
        title: group === "index" ? "Move to Columns" : "Move to Index",
        "aria-label": group === "index" ? "Move to Columns" : "Move to Index",
      },
      [group === "index" ? "→" : "←"],
    ) as HTMLButtonElement;
    toggle.disabled = group === "index" && count === 1;
    toggle.addEventListener("click", () =>
      this.update((view) => {
        const next = new Set(this.pivotIndexes(view));
        if (group === "index") next.add(index);
        else next.delete(index);
        view.pivotColumns = [...next].sort((a, b) => a - b);
        view.pivot = view.pivotColumns[0];
        if (view.pivotColumns.length === 0) view.fillValue = undefined;
      }),
    );
    const remove = el(
      "button",
      { class: "views-pill-remove", type: "button", title: "Remove this field" },
      ["×"],
    ) as HTMLButtonElement;
    remove.addEventListener("click", () =>
      this.update((view) => {
        view.dimensions.splice(index, 1);
        if (view.sort.key === `dim${index}`) view.sort = { key: "m0", dir: "desc" };
        view.pivotColumns = (view.pivotColumns ?? [])
          .filter((column) => column !== index)
          .map((column) => (column > index ? column - 1 : column));
        view.pivot = view.pivotColumns[0];
        if (view.pivotColumns.length === 0) view.fillValue = undefined;
      }),
    );
    pill.append(grip, label, up, down, ...(filter === null ? [] : [filter]), toggle, remove);
    return pill;
  }
  /** Typed filter editors selected by the column's data type. */
  private openFilterForColumn(
    anchor: HTMLElement,
    column: number,
    subtitle: string,
  ): void {
    const meta = this.metas[column];
    if (meta === undefined) return;
    const distinct = meta.categories?.labels.length ?? meta.stats.distinct;
    if ((meta.type === "category" || meta.type === "boolean") && distinct <= 20) {
      this.openCategoryFilter(anchor, column, subtitle);
      return;
    }
    if (meta.type === "date" || meta.type === "datetime") {
      this.openTypedFilter(anchor, column, subtitle, "date");
      return;
    }
    if (meta.type === "string" || meta.type === "category") {
      this.openTypedFilter(anchor, column, subtitle, "text");
      return;
    }
    this.openTypedFilter(anchor, column, subtitle, "number");
  }

  /** Up to 20 category values as include/exclude checkboxes. */
  private openCategoryFilter(
    anchor: HTMLElement,
    column: number,
    subtitle: string,
  ): void {
    const entry = this.views[this.active];
    if (entry === undefined) return;
    const meta = this.metas[column];
    const existing = entry.def.pivotValueFilters?.find((filter) => filter.column === column);
    const current = existing?.kind === "values" ? existing.values : [];
    const labels = new Map<string, number>();
    if (meta?.categories !== null && meta?.categories !== undefined) {
      meta.categories.labels.forEach((label, index) => {
        labels.set(label, meta.categories?.counts[index] ?? 0);
      });
    } else {
      for (const value of meta?.stats.topValues ?? []) labels.set(value.label, value.count);
    }
    for (const value of current) {
      if (!labels.has(value)) labels.set(value, 0);
    }
    const selected = new Set(current);
    const initialMode =
      existing?.kind === "blank"
        ? existing.negate === true
          ? "notBlank"
          : "blank"
        : existing?.kind === "values" && existing.negate === true
          ? "notIn"
          : "in";

    const popover = el("div", {
      class: "views-filter-popover",
      role: "dialog",
      "aria-label": `Filter ${meta?.name ?? "field"} values`,
    });
    const head = el("div", { class: "views-filter-head" }, [
      el("span", { class: "views-filter-title" }, [`Filter ${meta?.name ?? "field"}`]),
      el("span", { class: "views-filter-subtitle" }, [subtitle]),
    ]);
    const mode = el("select", {
      class: "views-filter-mode",
      "aria-label": "Filter mode",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["in", "Is one of"],
      ["notIn", "Is not one of"],
      ["blank", "Is blank"],
      ["notBlank", "Is not blank"],
    ] as const) {
      const option = el("option", { value }, [label]) as HTMLOptionElement;
      if (initialMode === value) option.selected = true;
      mode.append(option);
    }
    const search = el("input", {
      class: "views-filter-search",
      type: "search",
      placeholder: "Search values.",
      "aria-label": "Search filter values",
    }) as HTMLInputElement;
    const list = el("div", { class: "views-filter-list" });
    const footer = el("div", { class: "views-filter-footer" });
    const status = el("span", { class: "views-filter-status" });
    const clearButton = el(
      "button",
      { class: "ghost small views-filter-clear", type: "button" },
      ["Clear filter"],
    ) as HTMLButtonElement;
    const apply = el(
      "button",
      { class: "primary small views-filter-apply", type: "button" },
      ["Apply"],
    ) as HTMLButtonElement;

    const close = (): void => {
      popover.remove();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!popover.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        anchor.focus();
      }
    };
    const currentFilter = (): PivotFilter | null => {
      if (mode.value === "blank" || mode.value === "notBlank") {
        return { column, kind: "blank", negate: mode.value === "notBlank" };
      }
      if (selected.size === 0) return null;
      return {
        column,
        kind: "values",
        values: [...selected],
        ...(mode.value === "notIn" ? { negate: true } : {}),
      };
    };
    const commit = (filter: PivotFilter | null): void => {
      close();
      this.applyPivotFilter(column, filter);
    };
    const updateFooter = (): void => {
      const blank = mode.value === "blank" || mode.value === "notBlank";
      search.hidden = blank;
      list.hidden = blank;
      status.textContent = blank
        ? "Blankness filter"
        : selected.size === 0
          ? "All values"
          : `${selected.size.toLocaleString()} selected`;
      apply.textContent = selected.size === 0 ? "Apply" : `Apply (${selected.size})`;
      clearButton.disabled = existing === undefined;
    };
    const addOption = (label: string, count: number): void => {
      const checkbox = el("input", {
        type: "checkbox",
        ...(selected.has(label) ? { checked: "checked" } : {}),
      }) as HTMLInputElement;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(label);
        else selected.delete(label);
        updateFooter();
      });
      list.append(
        el("label", { class: "views-filter-option" }, [
          checkbox,
          el("span", { class: "views-filter-option-label" }, [label]),
          el("span", { class: "views-filter-option-count" }, [count.toLocaleString()]),
        ]),
      );
    };
    const renderOptions = (): void => {
      clear(list);
      const needle = search.value.trim().toLocaleLowerCase();
      let shown = 0;
      for (const [label, count] of labels) {
        if (needle !== "" && !label.toLocaleLowerCase().includes(needle)) continue;
        addOption(label, count);
        shown++;
      }
      if (shown === 0) {
        list.append(
          el("div", { class: "views-filter-empty" }, [
            needle === "" ? "No suggested values." : "No matching values.",
          ]),
        );
      }
      const custom = search.value.trim();
      if (custom !== "" && !labels.has(custom)) {
        const add = el(
          "button",
          { class: "views-filter-add", type: "button" },
          [`Add exact value "${custom}"`],
        ) as HTMLButtonElement;
        add.addEventListener("click", () => {
          labels.set(custom, 0);
          selected.add(custom);
          search.value = "";
          renderOptions();
          updateFooter();
        });
        list.prepend(add);
      }
      updateFooter();
    };

    mode.addEventListener("change", updateFooter);
    search.addEventListener("input", renderOptions);
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const custom = search.value.trim();
      if (custom !== "" && !labels.has(custom)) {
        labels.set(custom, 0);
        selected.add(custom);
        search.value = "";
        renderOptions();
      }
    });
    clearButton.addEventListener("click", () => commit(null));
    apply.addEventListener("click", () => commit(currentFilter()));
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    popover.append(head, mode, search, list, footer);
    footer.append(status, el("span", { class: "grow" }), clearButton, apply);
    document.body.append(popover);
    renderOptions();
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8));
    popover.style.left = `${left}px`;
    const below = rect.bottom + 6;
    popover.style.top =
      below + popover.offsetHeight > window.innerHeight - 8
        ? `${Math.max(8, rect.top - popover.offsetHeight - 6)}px`
        : `${below}px`;
    search.focus();
  }

  /** Number, date and free-text operator filters. */
  private openTypedFilter(
    anchor: HTMLElement,
    column: number,
    subtitle: string,
    kind: "number" | "date" | "text",
  ): void {
    const entry = this.views[this.active];
    if (entry === undefined) return;
    const meta = this.metas[column];
    const existing = entry.def.pivotValueFilters?.find((filter) => filter.column === column);
    const ops = kind === "number" ? NUMBER_FILTER_OPS : kind === "date" ? DATE_FILTER_OPS : TEXT_FILTER_OPS;
    const popover = el("div", {
      class: "views-filter-popover",
      role: "dialog",
      "aria-label": `Filter ${meta?.name ?? "field"}`,
    });
    const head = el("div", { class: "views-filter-head" }, [
      el("span", { class: "views-filter-title" }, [`Filter ${meta?.name ?? "field"}`]),
      el("span", { class: "views-filter-subtitle" }, [subtitle]),
    ]);
    const opSelect = el("select", {
      class: "views-filter-mode",
      "aria-label": "Filter operator",
    }) as HTMLSelectElement;
    for (const [value, label] of ops) {
      opSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    const first = el("input", {
      class: "views-filter-input",
      type: kind === "number" ? "number" : kind === "date" ? "date" : "text",
      ...(kind === "number" ? { step: "any" } : {}),
      "aria-label": "Filter value",
    }) as HTMLInputElement;
    const second = el("input", {
      class: "views-filter-input",
      type: kind === "number" ? "number" : kind === "date" ? "date" : "text",
      ...(kind === "number" ? { step: "any" } : {}),
      "aria-label": "Second filter value",
    }) as HTMLInputElement;
    const firstField = el("label", { class: "views-filter-field" }, [
      el("span", {}, [kind === "date" ? "Date" : "Value"]),
      first,
    ]);
    const secondField = el("label", { class: "views-filter-field" }, [
      el("span", {}, ["And"]),
      second,
    ]);
    const footer = el("div", { class: "views-filter-footer" });
    const status = el("span", { class: "views-filter-status" });
    const clearButton = el(
      "button",
      { class: "ghost small views-filter-clear", type: "button" },
      ["Clear filter"],
    ) as HTMLButtonElement;
    const apply = el(
      "button",
      { class: "primary small views-filter-apply", type: "button" },
      ["Apply"],
    ) as HTMLButtonElement;

    let initialOp: string =
      kind === "number" ? "eq" : kind === "date" ? "on" : "contains";
    if (existing?.kind === kind) initialOp = existing.op;
    else if (existing?.kind === "blank") {
      initialOp = existing.negate === true ? "notBlank" : "blank";
    }
    opSelect.value = initialOp;
    if (existing?.kind === "number" || existing?.kind === "date") {
      first.value =
        existing.value === undefined
          ? ""
          : kind === "date"
            ? new Date(existing.value).toISOString().slice(0, 10)
            : String(existing.value);
      second.value =
        existing.value2 === undefined
          ? ""
          : kind === "date"
            ? new Date(existing.value2).toISOString().slice(0, 10)
            : String(existing.value2);
    } else if (existing?.kind === "text") {
      first.value = existing.value;
    }

    const close = (): void => {
      popover.remove();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!popover.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        anchor.focus();
      }
    };
    const needsFirst = (): boolean =>
      !["aboveAvg", "belowAvg", "blank", "notBlank"].includes(opSelect.value);
    const needsSecond = (): boolean => opSelect.value === "between";
    const numberValue = (input: HTMLInputElement): number =>
      kind === "date" ? parseDate(input.value, meta?.dateOrder ?? "dmy") : Number(input.value);
    const valid = (): boolean => {
      if (!needsFirst()) return true;
      if (kind === "text") return first.value.trim() !== "";
      if (!Number.isFinite(numberValue(first))) return false;
      return !needsSecond() || Number.isFinite(numberValue(second));
    };
    const updateFields = (): void => {
      firstField.hidden = !needsFirst();
      secondField.hidden = !needsSecond();
      apply.disabled = !valid();
      status.textContent = needsFirst() ? "" : "No value needed";
    };
    const currentFilter = (): PivotFilter | null => {
      const op = opSelect.value;
      if (op === "blank" || op === "notBlank") {
        return { column, kind: "blank", negate: op === "notBlank" };
      }
      if (!valid()) return null;
      if (kind === "text") {
        return {
          column,
          kind: "text",
          op: op as Extract<PivotFilter, { kind: "text" }>["op"],
          value: first.value.trim(),
        };
      }
      const value = numberValue(first);
      const value2 = needsSecond() ? numberValue(second) : undefined;
      if (kind === "date") {
        return {
          column,
          kind: "date",
          op: op as Extract<PivotFilter, { kind: "date" }>["op"],
          value,
          ...(value2 === undefined ? {} : { value2 }),
        };
      }
      return {
        column,
        kind: "number",
        op: op as Extract<PivotFilter, { kind: "number" }>["op"],
        ...(op === "aboveAvg" || op === "belowAvg" ? {} : { value }),
        ...(value2 === undefined ? {} : { value2 }),
      };
    };
    const commit = (filter: PivotFilter | null): void => {
      close();
      this.applyPivotFilter(column, filter);
    };
    opSelect.addEventListener("change", updateFields);
    first.addEventListener("input", updateFields);
    second.addEventListener("input", updateFields);
    clearButton.addEventListener("click", () => commit(null));
    apply.addEventListener("click", () => commit(currentFilter()));
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    popover.append(
      head,
      opSelect,
      el("div", { class: "views-filter-values" }, [firstField, secondField]),
      footer,
    );
    footer.append(status, el("span", { class: "grow" }), clearButton, apply);
    document.body.append(popover);
    updateFields();
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8));
    popover.style.left = `${left}px`;
    const below = rect.bottom + 6;
    popover.style.top =
      below + popover.offsetHeight > window.innerHeight - 8
        ? `${Math.max(8, rect.top - popover.offsetHeight - 6)}px`
        : `${below}px`;
    (needsFirst() ? first : apply).focus();
  }

  private applyPivotFilter(column: number, filter: PivotFilter | null): void {
    this.update((view) => {
      const others = (view.pivotValueFilters ?? []).filter(
        (entry) => entry.column !== column,
      );
      view.pivotValueFilters = filter === null ? others : [...others, filter];
    });
  }
  private lambdaPill(
    def: ViewDef,
    lambda: PivotLambdaSpec,
    index: number,
  ): HTMLElement {
    const meta = this.metas[lambda.column];
    const labelText = lambda.label?.trim() || lambda.source;
    const pill = el("span", { class: "views-pill views-lambda-pill" });
    const label = el(
      "button",
      {
        class: "views-pill-label",
        type: "button",
        title: `${labelText}\nClick to edit this lambda`,
      },
      [`λ ${this.fitText(labelText, 30)}`],
    ) as HTMLButtonElement;
    label.addEventListener(
      "click",
      () => void this.promptLambda(lambda.column, meta?.name ?? "value", index),
    );
    const remove = el(
      "button",
      { class: "views-pill-remove", type: "button", title: "Remove this lambda" },
      ["×"],
    ) as HTMLButtonElement;
    remove.addEventListener("click", () =>
      this.update((view) => {
        view.pivotLambdas = (view.pivotLambdas ?? []).filter((_, at) => at !== index);
      }),
    );
    pill.append(label, remove);
    return pill;
  }

  private openLambdaMenu(anchor: HTMLElement): void {
    const items: MenuItem[] = [];
    this.metas.forEach((meta, column) => {
      if (!isNumericLikeType(meta.type)) return;
      items.push({
        label: meta.name,
        title: `Use ${meta.name} as x in a safe lambda`,
        action: () => void this.promptLambda(column, meta.name),
      });
    });
    if (items.length === 0) {
      this.transientNote = "Custom lambdas need a numeric column.";
      this.render();
      return;
    }
    openMenu(anchor, items);
  }

  private async promptLambda(
    column: number,
    columnName: string,
    replaceIndex?: number,
  ): Promise<void> {
    const current =
      replaceIndex === undefined
        ? ""
        : (this.views[this.active]?.def.pivotLambdas?.[replaceIndex]?.source ?? "");
    const value = await openPrompt({
      title: "Safe lambda value",
      label: `lambda x: ... over ${columnName.trim()} - mean, median, sum, min, max, count, size, nunique, std, var, first, last, quantile(p)`,
      value: current === "" ? "lambda x: mean(x)" : current,
      placeholder: "lambda x: sum(x) / size(x)",
      confirmLabel: replaceIndex === undefined ? "Add lambda" : "Save",
    });
    if (value === null || value.trim() === "") return;
    const source = value.trim();
    const compiled = compilePivotLambda(source, columnName);
    if (!compiled.ok) {
      this.transientNote = compiled.error;
      this.render();
      return;
    }
    this.update((view) => {
      const entry: PivotLambdaSpec = { column, source, label: source };
      const lambdas = [...(view.pivotLambdas ?? [])];
      if (replaceIndex === undefined) lambdas.push(entry);
      else lambdas[replaceIndex] = entry;
      view.pivotLambdas = lambdas;
    });
  }

  private fitText(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
  }
  private measurePill(def: ViewDef, measure: MeasureSpec, index: number): HTMLElement {
    const name = measureDisplay(measure, this.metas);
    const post = measure.post ?? [];
    const postText = post.length > 0 ? ` ${post.map((op) => `→${op.op}`).join("")}` : "";
    const pill = el("span", { class: "views-pill" });
    pill.dataset.measureIndex = String(index);
    this.makePillDraggable(pill, { kind: "measure", index, well: "values" });
    const grip = el("span", { class: "views-pill-grip", "aria-hidden": "true" }, ["\u2807"]);
    const label = el(
      "button",
      {
        class: "views-pill-label",
        type: "button",
        title: "Change the aggregate, edit the expression or add a post step",
      },
      [`${measureSymbol(measure)} ${name}${measure.weight !== undefined ? " ⚖" : ""}${measure.where !== undefined ? " ⧙" : ""}${postText} ▾`],
    ) as HTMLButtonElement;
    label.addEventListener("click", () => this.openMeasureEditor(label, def, measure, index));
    const remove = el(
      "button",
      { class: "views-pill-remove", type: "button", title: "Remove this measure" },
      ["×"],
    ) as HTMLButtonElement;
    remove.addEventListener("click", () =>
      this.update((view) => {
        view.measures.splice(index, 1);
      }),
    );
    pill.append(grip, label, remove);
    return pill;
  }

  private openGrainMenu(anchor: HTMLElement, def: ViewDef, spec: DimensionSpec, index: number): void {
    const meta = this.metas[spec.column];
    if (meta === undefined) return;
    const items: MenuItem[] = [];
    const setBy = (by: DimensionSpec["by"]): void => {
      this.update((view) => {
        view.dimensions[index] = { column: spec.column, by };
        const ordered =
          typeof by === "object" && ("time" in by || "bin" in by);
        if (typeof by === "object" && "time" in by) view.fill = "zero";
        if (ordered && view.sort.key === `dim${index}`) {
          view.sort = { key: `dim${index}`, dir: "asc" };
        }
      });
    };
    items.push({ label: "Exact value", action: () => setBy("value") });
    if (meta.type === "date" || meta.type === "datetime") {
      const group = this.pivotIndexes(def).includes(index) ? "columns" : "index";
      items.push({
        label: "Group by several date parts…",
        title: "Add nested date fields such as Year then Month",
        action: () => this.openDateGroups(spec, group),
      });
    }
    if (meta.type === "date" || meta.type === "datetime") {
      for (const grain of [
        "day",
        "week",
        "month",
        "quarter",
        "year",
        "hour",
        "minute",
        "second",
      ] as TimeGrain[]) {
        items.push({
          label: `Time · ${GRAIN_LABELS[grain]}`,
          action: () => setBy({ time: grain }),
        });
      }
      for (const part of DATE_PARTS) {
        items.push({ label: `Part · ${part.label}`, action: () => setBy({ datePart: part.value }) });
      }
      if (typeof spec.by === "object" && "time" in spec.by) {
        const time = spec.by;
        items.push({
          label: `Week starts ${time.weekStart === 0 ? "Sunday" : "Monday"} — switch`,
          title: "Change which day starts a week",
          action: () =>
            setBy({ ...time, weekStart: (time.weekStart ?? 1) === 1 ? 0 : 1 }),
        });
        items.push({
          label:
            time.fiscalStartMonth !== undefined && time.fiscalStartMonth !== 1
              ? `Fiscal year starts ${MONTH_OPTIONS[time.fiscalStartMonth - 1] ?? "?"}…`
              : "Fiscal year starts…",
          title: "Label year/quarter buckets from a fiscal year start month",
          action: () => {
            void (async () => {
              const value = await openPrompt({
                title: "Fiscal year start month",
                label: "1–12 (blank for January)",
                value: time.fiscalStartMonth === undefined ? "" : String(time.fiscalStartMonth),
                confirmLabel: "Apply",
              });
              if (value === null) return;
              const month = Math.round(Number(value.trim()));
              setBy(
                value.trim() === "" || !Number.isFinite(month) || month < 1 || month > 12
                  ? { ...time, fiscalStartMonth: undefined }
                  : { ...time, fiscalStartMonth: month },
              );
            })();
          },
        });
        items.push({
          label: time.tz !== undefined && time.tz !== "" ? `Time zone: ${time.tz}…` : "Time zone…",
          title: "Bucket in a fixed offset, local time or an IANA zone (e.g. +10:00, Australia/Sydney)",
          action: () => {
            void (async () => {
              const value = await openPrompt({
                title: "Time zone for this dimension",
                label: "±HH:MM, \"local\", or an IANA name (blank to keep as written)",
                value: time.tz ?? "",
                placeholder: "Australia/Sydney",
                confirmLabel: "Apply",
              });
              if (value === null) return;
              const tz = value.trim();
              setBy(tz === "" ? { ...time, tz: undefined } : { ...time, tz });
            })();
          },
        });
      }
    } else if (meta.type === "integer" || meta.type === "number") {
      items.push({
        label: "Bin width…",
        title: "Group numeric ranges into equal-width bins",
        action: () => {
          void (async () => {
            const value = await openPrompt({
              title: `Bin “${meta.name}” by width`,
              label: "Bin width (e.g. 10, 0.5, 100)",
              placeholder: "10",
              confirmLabel: "Group",
            });
            if (value === null) return;
            const width = Number(value.trim());
            if (Number.isFinite(width) && width > 0) setBy({ bin: { width } });
          })();
        },
      });
      items.push({
        label: "N equal groups…",
        action: () => {
          void (async () => {
            const value = await openPrompt({
              title: `Group “${meta.name}” into N equal-sized groups`,
              label: "Number of groups (quantiles, 2–100)",
              value: "10",
              confirmLabel: "Group",
            });
            if (value === null) return;
            const n = Math.floor(Number(value.trim()));
            if (Number.isFinite(n) && n >= 2 && n <= 100) setBy({ bin: { n } });
          })();
        },
      });
      items.push({ label: "Deciles (10 groups)", action: () => setBy({ bin: { n: 10 } }) });
    }
    openMenu(anchor, items);
  }

  private openDimensionMenu(anchor: HTMLElement, def: ViewDef): void {
    const items: MenuItem[] = this.metas.map((meta, index) => ({
      label: meta.name,
      title: `${meta.name} — group rows by this column`,
      disabled: def.dimensions.some((spec) => spec.column === index),
      action: () =>
        this.update((view) => {
          const dateLike = meta.type === "date" || meta.type === "datetime";
          const next: DimensionSpec =
            dateLike ? { column: index, by: { time: "month" } } : { column: index, by: "value" };
          view.dimensions.push(next);
          if (dateLike) {
            view.fill = "zero";
            if (view.dimensions.length === 1) view.sort = { key: "dim0", dir: "asc" };
          }
        }),
    }));
    openMenu(anchor, items);
  }

  /** Excel-style date hierarchy picker for an existing date field. */
  private openDateGroups(spec: DimensionSpec, group: "index" | "columns"): void {
    const entry = this.views[this.active];
    if (entry === undefined) return;
    const meta = this.metas[spec.column];
    const pivots = new Set(this.pivotIndexes(entry.def));
    const existing = new Set<TimeGrain>();
    entry.def.dimensions.forEach((dimension, index) => {
      if (dimension.column !== spec.column) return;
      const inTarget = group === "columns" ? pivots.has(index) : !pivots.has(index);
      if (inTarget && typeof dimension.by === "object" && "time" in dimension.by) {
        existing.add(dimension.by.time);
      }
    });
    const selected = new Set<TimeGrain>(existing.size === 0 ? ["month"] : existing);

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal confirm-modal date-group-modal" });
    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, [`Group ${meta?.name ?? "date"} by`]));
    const closeButton = el(
      "button",
      { class: "icon-btn", type: "button", title: "Close" },
      ["×"],
    ) as HTMLButtonElement;
    head.append(closeButton);
    modal.append(head);

    const body = el("div", { class: "date-group-body" });
    body.append(
      el("p", { class: "date-group-note" }, [
        `Choose one or more parts to nest in ${group === "index" ? "Index" : "Columns"}.`,
      ]),
    );
    const list = el("div", { class: "date-group-list" });
    for (const choice of DATE_GROUP_CHOICES) {
      const checkbox = el("input", {
        type: "checkbox",
        ...(selected.has(choice.value) ? { checked: "checked" } : {}),
      }) as HTMLInputElement;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(choice.value);
        else selected.delete(choice.value);
        apply.disabled = selected.size === 0;
      });
      list.append(
        el("label", { class: "date-group-option" }, [
          checkbox,
          el("span", {}, [choice.label]),
        ]),
      );
    }
    body.append(list);
    if (group === "columns") {
      body.append(
        el("p", { class: "date-group-note" }, [
          "Column hierarchies are capped at 500 displayed column groups.",
        ]),
      );
    }
    modal.append(body);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const apply = el(
      "button",
      { class: "primary", type: "button" },
      ["Apply"],
    ) as HTMLButtonElement;
    apply.disabled = selected.size === 0;
    footer.append(cancel, el("span", { class: "grow" }), apply);
    modal.append(footer);

    const close = (): void => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    closeButton.addEventListener("click", close);
    cancel.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    apply.addEventListener("click", () => {
      const grains = DATE_GROUP_ORDER.filter((grain) => selected.has(grain));
      close();
      this.applyDateGroups(spec, group, grains);
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, `Group ${meta?.name ?? "date"} by`);
  }

  /** Replace a field's date grains in one well with the selected hierarchy. */
  private applyDateGroups(
    spec: DimensionSpec,
    group: "index" | "columns",
    grains: TimeGrain[],
  ): void {
    if (grains.length === 0) return;
    this.update((view) => {
      const pivots = new Set(this.pivotIndexes(view));
      const inTarget = (index: number): boolean =>
        group === "columns" ? pivots.has(index) : !pivots.has(index);
      const isTime = (dimension: DimensionSpec): boolean =>
        typeof dimension.by === "object" && "time" in dimension.by;
      const targetOrder = view.dimensions
        .map((_, index) => index)
        .filter((index) => inTarget(index));
      const first = targetOrder.find((index) => {
        const dimension = view.dimensions[index]!;
        return dimension.column === spec.column && isTime(dimension);
      });
      const position = first === undefined ? targetOrder.length : targetOrder.indexOf(first);
      const columnSpecs = new Set(
        this.pivotIndexes(view).map((index) => view.dimensions[index]!),
      );
      const removed = new Set<DimensionSpec>();
      view.dimensions = view.dimensions.filter((dimension, index) => {
        if (!inTarget(index)) return true;
        if (dimension.column === spec.column && isTime(dimension)) {
          removed.add(dimension);
          return false;
        }
        return true;
      });
      const targetAfter = view.dimensions
        .map((_, index) => index)
        .filter((index) =>
          group === "columns"
            ? columnSpecs.has(view.dimensions[index]!)
            : !columnSpecs.has(view.dimensions[index]!),
        );
      const before = targetAfter[Math.min(position, targetAfter.length)];
      const beforeSpec = before === undefined ? undefined : view.dimensions[before];
      const specs = grains.map(
        (grain): DimensionSpec => ({ column: spec.column, by: { time: grain } }),
      );
      const insertAt =
        beforeSpec === undefined
          ? view.dimensions.length
          : view.dimensions.indexOf(beforeSpec);
      view.dimensions.splice(insertAt, 0, ...specs);
      for (const dimension of removed) columnSpecs.delete(dimension);
      if (group === "columns") {
        for (const dimension of specs) columnSpecs.add(dimension);
      }
      view.pivotColumns = view.dimensions
        .map((dimension, index) => (columnSpecs.has(dimension) ? index : -1))
        .filter((index) => index >= 0);
      view.pivot = view.pivotColumns[0];
      if (view.pivotColumns.length === 0) view.fillValue = undefined;
      if (view.fill === "none") view.fill = "zero";
    });
  }
  /** Step one of adding a measure: pick the column (or rows/expression). */
  private openMeasureMenu(anchor: HTMLElement, def: ViewDef): void {
    const items: MenuItem[] = [
      {
        label: "Count of rows",
        title: "How many rows are in each group",
        action: () =>
          this.update((view) => {
            view.measures.push({ column: null, agg: "count" });
          }),
      },
    ];
    this.metas.forEach((meta, index) => {
      items.push({
        label: `${meta.name} …`,
        title: `${meta.name} — choose an aggregate`,
        action: () => this.openAggregateMenu(anchor, index),
      });
    });
    items.push({
      label: "Custom expression…",
      title: "Arithmetic over aggregates, e.g. sum(revenue) / count(*)",
      action: () => void this.promptExpression(anchor),
    });
    openMenu(anchor, items);
  }

  /** Step two: every aggregate for the chosen column. */
  private openAggregateMenu(anchor: HTMLElement, column: number): void {
    const meta = this.metas[column];
    if (meta === undefined) return;
    const numeric = isNumericLikeType(meta.type);
    const items: MenuItem[] = AGG_OPTIONS.filter(
      (option) =>
        numeric || option.value === "count" || option.value === "distinct" || option.value === "mode",
    ).map((option) => ({
      label: option.label,
      title: `${option.label} of ${meta.name} per group`,
      action: () =>
        this.update((view) => {
          view.measures.push({ column, agg: option.value });
        }),
    }));
    items.push({
      label: "Custom expression…",
      title: `Arithmetic over aggregates of ${meta.name} and other columns`,
      action: () => void this.promptExpression(anchor),
    });
    openMenu(anchor, items);
  }

  /** Custom expression dialog; validates before adding or replacing a measure. */
  private async promptExpression(anchor: HTMLElement, replaceIndex?: number): Promise<void> {
    const current =
      replaceIndex === undefined ? "" : (this.views[this.active]?.def.measures[replaceIndex]?.expr ?? "");
    const value = await openPrompt({
      title: replaceIndex === undefined ? "Custom expression" : "Edit expression",
      label: "Expression — + − × ÷ over count(*) / sum(col) / mean(col) / p90(col) …",
      value: current,
      placeholder: "sum(revenue) / count(*)",
      confirmLabel: replaceIndex === undefined ? "Add measure" : "Save",
    });
    if (value === null || value.trim() === "") return;
    const expr = value.trim();
    const compiled = compileExpression(expr, this.metas.map((meta) => meta.name));
    if (!compiled.ok) {
      this.transientNote = compiled.error;
      this.render();
      return;
    }
    this.update((view) => {
      const measure: MeasureSpec = { column: null, agg: "expr", expr };
      if (replaceIndex === undefined) view.measures.push(measure);
      else view.measures[replaceIndex] = { ...measure, post: view.measures[replaceIndex]?.post };
    });
    void anchor;
  }

  /** Weight column picker for weighted mean/sum measures. */
  private openWeightMenu(anchor: HTMLElement, measure: MeasureSpec, index: number): void {
    const items: MenuItem[] = [
      {
        label: `${measure.weight === undefined ? "● " : ""}None (unweighted)`,
        action: () =>
          this.update((view) => {
            const { weight: _omit, ...rest } = measure;
            view.measures[index] = rest;
          }),
      },
    ];
    this.metas.forEach((meta, column) => {
      if (meta.type !== "integer" && meta.type !== "number") return;
      items.push({
        label: `${measure.weight === column ? "● " : ""}${meta.name}`,
        title: `Weight by ${meta.name}`,
        action: () =>
          this.update((view) => {
            view.measures[index] = { ...measure, weight: column };
          }),
      });
    });
    openMenu(anchor, items);
  }

  private openMeasureEditor(
    anchor: HTMLElement,
    def: ViewDef,
    measure: MeasureSpec,
    index: number,
  ): void {
    const meta = measure.column === null ? null : this.metas[measure.column];
    const numeric = meta === null || isNumericLikeType(meta.type);
    const items: MenuItem[] = [];
    if (measure.agg === "expr") {
      items.push({
        label: `fx  ${measure.expr ?? "expr"} — edit…`,
        title: "Edit the custom expression",
        action: () => void this.promptExpression(anchor, index),
      });
    } else if (measure.column !== null) {
      for (const option of AGG_OPTIONS) {
        if (!numeric && option.value !== "count" && option.value !== "distinct" && option.value !== "mode") {
          continue;
        }
        items.push({
          label: `${option.value === measure.agg ? "● " : ""}${option.label}`,
          action: () =>
            this.update((view) => {
              view.measures[index] = { ...measure, agg: option.value };
            }),
        });
      }
    } else {
      items.push({ label: "● Count of rows", action: () => {} });
    }
    if (measure.column !== null && (measure.agg === "sum" || measure.agg === "mean")) {
      items.push({
        label: measure.weight === undefined ? "Weight by…" : "Weight by… (change)",
        title: "Weighted mean/sum: Σ(value × weight) / Σweight",
        action: () => this.openWeightMenu(anchor, measure, index),
      });
    }
    items.push({
      label: "Custom expression…",
      title: "Replace this measure with arithmetic over aggregates",
      action: () => void this.promptExpression(anchor, index),
    });
    items.push({
      label: measure.where === undefined ? "Only where…" : "Only where… (change)",
      title: "Restrict this measure to rows matching a condition, e.g. Count where Status = Closed",
      action: () => this.openConditionMenu(anchor, measure, index),
    });
    if (measure.where !== undefined) {
      items.push({
        label: "Clear “only where”",
        action: () =>
          this.update((view) => {
            const { where: _omit, ...rest } = measure;
            view.measures[index] = rest;
          }),
      });
    }
    const postOptions: readonly { op: PostOp["op"]; label: string; window?: number }[] = [
      { op: "rolling", label: "Rolling mean (7)", window: 7 },
      { op: "cumulative", label: "Cumulative sum" },
      { op: "diff", label: "Difference" },
      { op: "pctChange", label: "% change" },
      { op: "pctTotal", label: "% of total" },
      { op: "rank", label: "Rank" },
      { op: "yoy", label: "Year-over-year % (time dimensions)" },
    ];
    for (const option of postOptions) {
      const active = (measure.post ?? []).some((post) => post.op === option.op);
      items.push({
        label: `${active ? "● " : ""}Then: ${option.label}`,
        action: () =>
          this.update((view) => {
            const current = view.measures[index];
            const post = (current.post ?? []).filter((entry) => entry.op !== option.op);
            const wasActive = (current.post ?? []).some((entry) => entry.op === option.op);
            if (!wasActive) {
              post.push(
                option.op === "rolling"
                  ? { op: "rolling", window: option.window ?? 7 }
                  : ({ op: option.op } as PostOp),
              );
            }
            view.measures[index] = post.length === 0
              ? { column: current.column, agg: current.agg, expr: current.expr }
              : { ...current, post };
          }),
      });
    }
    openMenu(anchor, items);
  }

  /** Condition step one: which column restricts the measure. */
  private openConditionMenu(anchor: HTMLElement, measure: MeasureSpec, index: number): void {
    const items: MenuItem[] = this.metas.map((meta, column) => ({
      label: meta.name,
      title: `Restrict the measure to rows where ${meta.name} matches`,
      action: () => this.openConditionEditor(anchor, measure, index, column),
    }));
    openMenu(anchor, items);
  }

  /** Condition step two: value list, numeric bounds or is-empty. */
  private openConditionEditor(
    anchor: HTMLElement,
    measure: MeasureSpec,
    index: number,
    column: number,
  ): void {
    const meta = this.metas[column];
    if (meta === undefined) return;
    const apply = (where: MeasureCondition): void =>
      this.update((view) => {
        view.measures[index] = { ...measure, where };
      });
    const items: MenuItem[] = [];
    if (isNumericLikeType(meta.type)) {
      items.push({
        label: "Between min and max…",
        action: () => {
          void (async () => {
            const value = await openPrompt({
              title: `Keep rows where ${meta.name} is between…`,
              label: "Min, max (leave either blank for open-ended)",
              placeholder: "10, 100",
              confirmLabel: "Apply",
            });
            if (value === null) return;
            const [minText, maxText] = value.split(",").map((part) => part.trim());
            const min = minText === "" || minText === undefined ? undefined : Number(minText);
            const max = maxText === "" || maxText === undefined ? undefined : Number(maxText);
            const where: MeasureCondition = { column };
            if (min !== undefined && Number.isFinite(min)) where.min = min;
            if (max !== undefined && Number.isFinite(max)) where.max = max;
            apply(where);
          })();
        },
      });
      items.push({
        label: "At least…",
        action: () => {
          void (async () => {
            const value = await openPrompt({
              title: `Keep rows where ${meta.name} is at least…`,
              label: "Minimum value",
              confirmLabel: "Apply",
            });
            if (value === null || value.trim() === "") return;
            const min = Number(value.trim());
            if (Number.isFinite(min)) apply({ column, min });
          })();
        },
      });
      items.push({
        label: "At most…",
        action: () => {
          void (async () => {
            const value = await openPrompt({
              title: `Keep rows where ${meta.name} is at most…`,
              label: "Maximum value",
              confirmLabel: "Apply",
            });
            if (value === null || value.trim() === "") return;
            const max = Number(value.trim());
            if (Number.isFinite(max)) apply({ column, max });
          })();
        },
      });
    }
    if (meta.type !== "integer" && meta.type !== "number" && meta.type !== "date") {
      items.push({
        label: "Value is one of…",
        title: "Comma-separated values; exact match after trimming",
        action: () => {
          void (async () => {
            const values = await openPrompt({
              title: `Keep rows where ${meta.name} is one of…`,
              label: "Values separated by commas",
              placeholder: "Closed, Cancelled",
              confirmLabel: "Apply",
            });
            if (values === null) return;
            const list = values
              .split(",")
              .map((part) => part.trim())
              .filter((part) => part !== "");
            if (list.length > 0) apply({ column, values: list });
          })();
        },
      });
    }
    items.push({
      label: "Is empty",
      title: `Count only rows where ${meta.name} is blank`,
      action: () => apply({ column, isNull: true }),
    });
    openMenu(anchor, items);
  }

  private renderNote(entry: ViewEntry): void {
    if (this.transientNote !== null) {
      this.noteEl.textContent = this.transientNote;
      return;
    }
    if (entry.error !== null) {
      this.noteEl.textContent = entry.error;
      return;
    }
    if (entry.result === null) {
      this.noteEl.textContent = entry.loading
        ? "Aggregating…"
        : isCompleteView(entry.def)
          ? "Waiting for the first result…"
          : "Add at least one group-by column and one measure.";
      return;
    }
    const result = entry.result;
    const parts = [
      `${result.groupCount.toLocaleString()} ${
        result.groupCount === 1 ? "group" : "groups"
      }`,
    ];
    if (result.truncated) {
      parts.push(
        `top ${result.groupCount.toLocaleString()} of ${result.totalGroups.toLocaleString()} groups`,
      );
    }
    const partialCount = result.partials?.filter(Boolean).length ?? 0;
    if (partialCount > 0) {
      parts.push(`${partialCount} incomplete ${partialCount === 1 ? "period" : "periods"} ◔`);
    }
    parts.push(result.ms < 1 ? "<1 ms" : `${Math.round(result.ms)} ms`);
    if (entry.stale) parts.push("updating…");
    this.noteEl.textContent = parts.join(" · ");
  }

  private renderTable(entry: ViewEntry): void {
    clear(this.tableEl);
    const pivot = entry.pivotResult;
    if (pivot !== null) {
      if (pivot.groupCount === 0) {
        if (isCompleteView(entry.def) && !entry.loading) {
          this.tableEl.append(el("div", { class: "views-empty" }, ["No groups match."]));
        }
        return;
      }
      this.renderWorkerPivot(entry, pivot);
      return;
    }
    const result = entry.result;
    if (result === null || result.groupCount === 0) {
      if (isCompleteView(entry.def) && !entry.loading) {
        this.tableEl.append(el("div", { class: "views-empty" }, ["No groups match."]));
      }
      return;
    }
    const pivots = this.pivotIndexes(entry.def);
    if (
      pivots.length > 0 &&
      pivots.every((index) => result.dimensions[index] !== undefined) &&
      result.dimensionNames.length > pivots.length
    ) {
      this.renderPivot(entry, pivots);
      return;
    }
    const table = el("table", { class: "views-table" });
    const head = el("thead");
    const headRow = el("tr");
    result.dimensionNames.forEach((name, d) => {
      headRow.append(this.sortableHeader(entry.def, `dim${d}`, name, "views-dim-head"));
    });
    result.measureNames.forEach((name, m) => {
      headRow.append(this.sortableHeader(entry.def, `m${m}`, this.prettyMeasure(result, m), "views-num-head"));
    });
    head.append(headRow);
    table.append(head);

    const body = el("tbody");
    const maxima = result.measures.map((values) => {
      let max = 0;
      for (const value of values) {
        if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
      }
      return max;
    });
    // Long results squish to VISIBLE_ROWS until the user asks for all rows.
    const total = result.groupCount;
    const collapsed = !entry.expanded && total > VISIBLE_ROWS;
    const rowLimit = collapsed ? VISIBLE_ROWS : total;
    for (let row = 0; row < rowLimit; row++) {
      const tr = el("tr", { class: "views-row" });
      const firstDim = entry.def.dimensions[0];
      const drillable =
        firstDim !== undefined &&
        !(typeof firstDim.by === "object" && "bin" in firstDim.by);
      if (drillable) {
        tr.title = "Click to filter the table to this group";
        const times = result.dimensionTimes[0];
        const timeStart = times !== undefined && Number.isFinite(times[row]) ? times[row] : null;
        tr.addEventListener("click", () => {
          if (firstDim === undefined) return;
          this.options.onDrill(firstDim.column, timeStart, null, result.dimensions[0][row]);
        });
      }
      result.dimensionNames.forEach((_, d) => {
        const cell = el("td", { class: "views-dim" }, [result.dimensions[d][row]]);
        if (result.partials?.[row] === true && result.dimensionIsTime[d] === true) {
          const marker = el("span", { class: "views-partial", title: "Incomplete period — the data starts or ends inside it" }, [" ◔"]);
          cell.append(marker);
        }
        tr.append(cell);
      });
      result.measures.forEach((values, m) => {
        const value = values[row];
        const td = el("td", { class: "views-num" });
        const max = maxima[m];
        if (Number.isFinite(value) && max > 0) {
          const bar = el("span", { class: "views-bar" });
          const fill = el("span", { class: "views-bar-fill" });
          fill.style.width = `${Math.max(1, (Math.abs(value) / max) * 100)}%`;
          bar.append(fill);
          td.append(bar);
        }
        td.append(el("span", { class: "views-value" }, [formatMeasure(value, entry.def.measures[m])]));
        tr.append(td);
      });
      body.append(tr);
    }

    // Summable measures can fold the hidden groups into an Other row.
    if (result.truncated && !collapsed) {
      const summable = entry.def.measures.map(isSummable);
      if (summable.some(Boolean)) {
        const otherRow = el("tr", { class: "views-other" });
        const hidden = Math.max(0, result.totalGroups - result.groupCount);
        result.dimensionNames.forEach((_, d) => {
          otherRow.append(
            el("td", { class: "views-dim" }, [
              d === 0 ? `Other (${hidden.toLocaleString()} groups)` : "",
            ]),
          );
        });
        result.measures.forEach((values, m) => {
          const td = el("td", { class: "views-num" });
          if (summable[m] === true) {
            let shown = 0;
            for (const value of values) {
              if (Number.isFinite(value)) shown += value;
            }
            const value = result.totals[m];
            td.append(
              el(
                "span",
                { class: "views-value" },
                [
                  formatMeasure(
                    Number.isFinite(value) ? value - shown : Number.NaN,
                    entry.def.measures[m] ?? { column: null, agg: "count" },
                  ),
                ],
              ),
            );
          } else {
            td.append(el("span", { class: "views-value" }, ["—"]));
          }
          otherRow.append(td);
        });
        body.append(otherRow);
      }
    }

    const totalRow = el("tr", { class: "views-total" });
    result.dimensionNames.forEach((_, d) => {
      totalRow.append(
        el("td", { class: "views-dim" }, [d === 0 ? "Total" : ""]),
      );
    });
    result.totals.forEach((value, m) => {
      totalRow.append(
        el("td", { class: "views-num" }, [formatMeasure(value, entry.def.measures[m])]),
      );
    });
    body.append(totalRow);
    table.append(body);
    this.tableEl.append(table);
    if (total > VISIBLE_ROWS) {
      const wrap = el("div", { class: "views-show-all" });
      const toggle = el(
        "button",
        { class: "ghost small", type: "button" },
        [entry.expanded ? `Show first ${VISIBLE_ROWS}` : `Show all ${total.toLocaleString()} rows`],
      ) as HTMLButtonElement;
      toggle.addEventListener("click", () => {
        entry.expanded = !entry.expanded;
        this.render();
      });
      wrap.append(toggle);
      if (!entry.expanded) {
        wrap.append(
          el("span", { class: "views-show-all-count" }, [
            `${VISIBLE_ROWS} of ${total.toLocaleString()} shown`,
          ]),
        );
      }
      this.tableEl.append(wrap);
    }
  }

  /** Worker-assembled pivot matrix, including margins and nested column levels. */
  private renderWorkerPivot(entry: ViewEntry, pivot: PivotMessage): void {
    if (pivot.measures.length === 0) {
      this.tableEl.append(el("div", { class: "views-empty" }, ["The pivot has no values."]));
      return;
    }
    if (pivot.truncatedColumns === true) {
      this.tableEl.append(
        el("div", { class: "views-pivot-warning", role: "status" }, [
          `Too many column values. Showing the first ${pivot.columnLimit ?? 500} of ${(
            pivot.totalColumnCount ?? 0
          ).toLocaleString()} columns. Move a field to Index or filter the data to see the rest.`,
        ]),
      );
    }    const rowHeaderCount = Math.max(1, pivot.rowNames.length);
    const colHeaderDepth = Math.max(1, pivot.colNames.length);
    const multipleMeasures = pivot.measures.length > 1;
    const measureLevels = multipleMeasures ? 2 : 0;
    const headerDepth = measureLevels + colHeaderDepth;
    const rowCount = pivot.rowLabels.length;
    const colCount = pivot.colLabels.length;
    const fillValue =
      entry.def.fillValue === undefined || entry.def.fillValue === null
        ? null
        : entry.def.fillValue;
    const displayValue = (value: number): number =>
      Number.isFinite(value) || fillValue === null ? value : fillValue;
    const marginPct = entry.def.pivotMarginPct ?? "none";
    const heatmap = entry.def.pivotHeatmap ?? "none";
    let max = 0;
    for (const measure of pivot.measures) {
      for (const value of measure.values) {
        if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
      }
    }
    const baseRowCount = Math.max(
      0,
      rowCount - (entry.def.margins === true && pivot.rowNames.length > 0 ? 1 : 0),
    );
    const baseColCount = Math.max(
      0,
      colCount - (entry.def.margins === true && pivot.colNames.length > 0 ? 1 : 0),
    );
    const percentageBases = pivot.measures.map((measure) => {
      const rows = new Float64Array(rowCount);
      const cols = new Float64Array(colCount);
      let grand = 0;
      for (let row = 0; row < baseRowCount; row++) {
        for (let col = 0; col < baseColCount; col++) {
          const value = measure.values[row * colCount + col];
          if (!Number.isFinite(value)) continue;
          rows[row] += value;
          cols[col] += value;
          grand += value;
        }
      }
      return { rows, cols, grand };
    });
    const valueLabel = (index: number): string => {
      const spec = entry.def.measures[index];
      if (spec === undefined) return pivot.measures[index]?.name ?? `Value ${index + 1}`;
      if (spec.column === null) return "Rows";
      return this.metas[spec.column]?.name ?? `Value ${index + 1}`;
    };
    const aggLabel = (index: number): string =>
      entry.def.measures[index]?.agg ?? pivot.measures[index]?.name ?? "value";
    const table = el("table", { class: "views-table views-pivot" });
    const head = el("thead");
    for (let depth = 0; depth < headerDepth; depth++) {
      const headRow = el("tr", { class: "views-pivot-head-row" });
      if (depth === 0) {
        for (let level = 0; level < rowHeaderCount; level++) {
          headRow.append(
            el("th", { class: "views-dim-head", rowspan: String(headerDepth) }, [
              pivot.rowNames[level] ?? "All",
            ]),
          );
        }
      }
      if (multipleMeasures && depth < 2) {
        pivot.measures.forEach((_, index) => {
          headRow.append(
            el(
              "th",
              {
                class: depth === 0 ? "views-value-head" : "views-col-head",
                colspan: String(colCount),
              },
              [depth === 0 ? valueLabel(index) : aggLabel(index)],
            ),
          );
        });
        head.append(headRow);
        continue;
      }
      const colDepth = depth - measureLevels;
      let start = 0;
      while (start < colCount) {
        const prefix = (pivot.colLabels[start] ?? []).slice(0, colDepth + 1);
        let end = start + 1;
        while (
          end < colCount &&
          prefix.every((part, index) => (pivot.colLabels[end]?.[index] ?? "") === part)
        ) {
          end++;
        }
        headRow.append(
          el(
            "th",
            {
              class: colDepth === colHeaderDepth - 1 ? "views-num-head" : "views-col-head",
              colspan: String(end - start),
              title: prefix.join(" / "),
            },
            [prefix[colDepth] || "All"],
          ),
        );
        start = end;
      }
      head.append(headRow);
    }
    table.append(head);
    const body = el("tbody");
    for (let row = 0; row < rowCount; row++) {
      const tr = el("tr", { class: "views-row" });
      const parts = pivot.rowLabels[row] ?? [];
      for (let level = 0; level < rowHeaderCount; level++) {
        tr.append(el("td", { class: "views-dim" }, [parts[level] || "All"]));
      }
      for (let measureIndex = 0; measureIndex < pivot.measures.length; measureIndex++) {
        const measure = pivot.measures[measureIndex]!;
        const measureSpec = entry.def.measures[measureIndex] ?? {
          column: null,
          agg: "count" as const,
        };
        for (let col = 0; col < colCount; col++) {
          const raw = displayValue(measure.values[row * colCount + col] ?? Number.NaN);
          const base =
            marginPct === "row"
              ? (measure.rowTotals[row] ?? Number.NaN)
              : marginPct === "column"
                ? (measure.colTotals[col] ?? Number.NaN)
                : marginPct === "grand"
                  ? measure.grandTotal
                  : Number.NaN;
          const value =
            marginPct !== "none" && Number.isFinite(raw) && Number.isFinite(base) && base !== 0
              ? raw / base
              : raw;
          const td = el("td", { class: "views-num" });
          if (Number.isFinite(raw) && max > 0) {
            const strength = Math.max(0.05, Math.min(1, Math.abs(raw) / max));
            const positive = raw >= 0;
            const reversed = heatmap === "coolwarm-reversed";
            const color =
              heatmap === "none"
                ? "var(--accent)"
                : positive
                  ? reversed
                    ? "#3b4cc0"
                    : "#b40426"
                  : reversed
                    ? "#b40426"
                    : "#3b4cc0";
            td.style.background = `color-mix(in srgb, ${color} ${Math.round(
              heatmap === "none" ? strength * 48 : 10 + strength * 62,
            )}%, transparent)`;
          }
          const text =
            marginPct !== "none" && Number.isFinite(value)
              ? `${(value * 100).toFixed(1)}%`
              : formatMeasure(value, measureSpec);
          td.append(el("span", { class: "views-value" }, [text]));
          if (Number.isFinite(raw) && marginPct !== "none") {
            td.title = formatMeasure(raw, measureSpec);
          }
          tr.append(td);
        }
      }
      body.append(tr);
    }
    table.append(body);
    this.tableEl.append(table);
    const spread = pivot.colNames.length > 0 ? pivot.colNames.join(" + ") : "All";
    const emptyNote =
      fillValue === null ? "empty cells stay blank" : `empty cells show ${fillValue}`;
    this.tableEl.append(
      el("div", { class: "views-pivot-note" }, [
        `Spreading "${spread}" across columns - ${pivot.measures.map((measure) => measure.name).join(", ")} - ${emptyNote}${
          entry.def.dropna === true ? " - empty rows and columns hidden" : ""
        }${entry.def.margins === true ? ` - ${entry.def.marginsName ?? "All"} margins computed from raw rows` : ""}${
          marginPct === "row"
            ? " - cells are % of row total"
            : marginPct === "column"
              ? " - cells are % of column total"
              : marginPct === "grand"
                ? " - cells are % of grand total"
                : ""
        }${heatmap === "none" ? "" : " - coolwarm shading"}.`,
      ]),
    );
  }
  /** Matrix with every non-pivot dimension forming the row index. */
  private renderPivot(entry: ViewEntry, pivots: number[]): void {
    const result = entry.result;
    if (result === null) return;
    const measureIndex = this.pivotMeasureIndex(entry.def, result);
    const measure = result.measures[measureIndex];
    const pivotSet = new Set(pivots);
    const rowDims = result.dimensions.filter((_, index) => !pivotSet.has(index));
    const rowNames = result.dimensionNames.filter((_, index) => !pivotSet.has(index));
    const colDims = pivots.map((index) => result.dimensions[index] ?? []);
    const colNames = pivots.map((index) => result.dimensionNames[index] ?? "?");
    if (measure === undefined || rowDims.length === 0 || colDims.length === 0) return;
    let rowKeys: string[] = [];
    let rowParts: string[][] = [];
    let colKeys: string[] = [];
    let colParts: string[][] = [];
    const rowIndex = new Map<string, number>();
    const colIndex = new Map<string, number>();
    for (let group = 0; group < result.groupCount; group++) {
      const parts = rowDims.map((dimension) => dimension[group] ?? "");
      const rowKey = parts.join("\u001f");
      const cparts = colDims.map((dimension) => dimension[group] ?? "");
      const colKey = cparts.join("\u001f");
      if (!rowIndex.has(rowKey)) {
        rowIndex.set(rowKey, rowKeys.length);
        rowKeys.push(rowKey);
        rowParts.push(parts);
      }
      if (!colIndex.has(colKey)) {
        colIndex.set(colKey, colKeys.length);
        colKeys.push(colKey);
        colParts.push(cparts);
      }
    }
    const ordered = colKeys
      .map((_, index) => index)
      .sort((a, b) => (colParts[a] ?? []).join("\u001f").localeCompare((colParts[b] ?? []).join("\u001f")));
    colKeys = ordered.map((index) => colKeys[index]!);
    colParts = ordered.map((index) => colParts[index]!);
    colIndex.clear();
    colKeys.forEach((key, index) => colIndex.set(key, index));
    let cells = new Float64Array(rowKeys.length * colKeys.length).fill(Number.NaN);
    for (let group = 0; group < result.groupCount; group++) {
      const rowKey = rowDims.map((dimension) => dimension[group] ?? "").join("\u001f");
      const colKey = colDims.map((dimension) => dimension[group] ?? "").join("\u001f");
      const r = rowIndex.get(rowKey) ?? 0;
      const c = colIndex.get(colKey) ?? 0;
      cells[r * colKeys.length + c] = measure[group] ?? Number.NaN;
    }
    if (entry.def.dropna === true) {
      const keepRows = rowKeys
        .map((_, row) => (colKeys.some((_, col) => Number.isFinite(cells[row * colKeys.length + col])) ? row : -1))
        .filter((row) => row >= 0);
      const keepCols = colKeys
        .map((_, col) => (rowKeys.some((_, row) => Number.isFinite(cells[row * colKeys.length + col])) ? col : -1))
        .filter((col) => col >= 0);
      if (keepRows.length !== rowKeys.length || keepCols.length !== colKeys.length) {
        const oldCells = cells;
        const oldCols = colKeys.length;
        cells = new Float64Array(keepRows.length * keepCols.length).fill(Number.NaN);
        keepRows.forEach((row, r) => {
          keepCols.forEach((col, c) => {
            cells[r * keepCols.length + c] = oldCells[row * oldCols + col] ?? Number.NaN;
          });
        });
        rowKeys = keepRows.map((row) => rowKeys[row]!);
        rowParts = keepRows.map((row) => rowParts[row]!);
        colKeys = keepCols.map((col) => colKeys[col]!);
        colParts = keepCols.map((col) => colParts[col]!);
      }
    }
    const fillValue =
      entry.def.fillValue === undefined || entry.def.fillValue === null
        ? null
        : entry.def.fillValue;
    const displayValue = (value: number): number =>
      Number.isFinite(value) || fillValue === null ? value : fillValue;
    const margins = entry.def.margins === true ? entry.margins : null;
    const marginsName = entry.def.marginsName ?? "All";
    const rowTotals = new Map<string, number>();
    const colTotals = new Map<string, number>();
    let grandTotal = Number.NaN;
    if (margins?.rows !== null && margins?.rows !== undefined) {
      const dims = margins.rows.dimensions;
      const values = margins.rows.measures[measureIndex];
      for (let group = 0; group < margins.rows.groupCount; group++) {
        const key = dims.map((dimension) => dimension[group] ?? "").join("\u001f");
        rowTotals.set(key, values?.[group] ?? Number.NaN);
      }
    }
    if (margins?.cols !== null && margins?.cols !== undefined) {
      const dims = margins.cols.dimensions;
      const values = margins.cols.measures[measureIndex];
      for (let group = 0; group < margins.cols.groupCount; group++) {
        const key = dims.map((dimension) => dimension[group] ?? "").join("\u001f");
        colTotals.set(key, values?.[group] ?? Number.NaN);
      }
    }
    grandTotal = margins?.total?.measures[measureIndex]?.[0] ?? Number.NaN;
    let max = 0;
    for (const value of cells) {
      if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    }
    for (const value of rowTotals.values()) {
      if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    }
    for (const value of colTotals.values()) {
      if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    }
    if (Number.isFinite(grandTotal)) max = Math.max(max, Math.abs(grandTotal));
    const measureSpec = entry.def.measures[measureIndex] ?? { column: null, agg: "count" as const };
    const table = el("table", { class: "views-table views-pivot" });
    const head = el("thead");
    for (let depth = 0; depth < colNames.length; depth++) {
      const headRow = el("tr", { class: "views-pivot-head-row" });
      if (depth === 0) {
        for (const name of rowNames) {
          headRow.append(
            el("th", { class: "views-dim-head", rowspan: String(colNames.length) }, [name]),
          );
        }
      }
      let start = 0;
      while (start < colKeys.length) {
        const prefix = (colParts[start] ?? []).slice(0, depth + 1);
        let end = start + 1;
        while (
          end < colKeys.length &&
          prefix.every((part, index) => (colParts[end]?.[index] ?? "") === part)
        ) {
          end++;
        }
        const label = prefix[depth] ?? "";
        const isLeaf = depth === colNames.length - 1;
        const header = el(
          "th",
          {
            class: isLeaf ? "views-num-head" : "views-col-head",
            colspan: String(end - start),
            title: prefix.join(" / "),
          },
          [label],
        );
        headRow.append(header);
        start = end;
      }
      if (depth === 0 && margins !== null) {
        headRow.append(
          el("th", { class: "views-num-head", rowspan: String(colNames.length) }, [marginsName]),
        );
      }
      head.append(headRow);
    }
    table.append(head);
    const body = el("tbody");
    rowKeys.forEach((rowKey, r) => {
      const tr = el("tr", { class: "views-row" });
      for (const part of rowParts[r] ?? []) {
        tr.append(el("td", { class: "views-dim" }, [part]));
      }
      colKeys.forEach((_, c) => {
        const value = displayValue(cells[r * colKeys.length + c] ?? Number.NaN);
        const td = el("td", { class: "views-num" });
        if (Number.isFinite(value) && max > 0) {
          const strength = Math.max(0.05, Math.min(1, Math.abs(value) / max));
          td.style.background = `color-mix(in srgb, var(--accent) ${Math.round(
            strength * 48,
          )}%, transparent)`;
        }
        td.append(el("span", { class: "views-value" }, [formatMeasure(value, measureSpec)]));
        tr.append(td);
      });
      if (margins !== null) {
        tr.append(
          el("td", { class: "views-num" }, [
            formatMeasure(rowTotals.get(rowKey) ?? Number.NaN, measureSpec),
          ]),
        );
      }
      body.append(tr);
    });
    if (margins !== null) {
      const totalRow = el("tr", { class: "views-total" });
      totalRow.append(
        el("td", { class: "views-dim", colspan: String(rowNames.length) }, [marginsName]),
      );
      for (const colKey of colKeys) {
        totalRow.append(
          el("td", { class: "views-num" }, [
            formatMeasure(colTotals.get(colKey) ?? Number.NaN, measureSpec),
          ]),
        );
      }
      totalRow.append(
        el("td", { class: "views-num" }, [formatMeasure(grandTotal, measureSpec)]),
      );
      body.append(totalRow);
    }
    table.append(body);
    this.tableEl.append(table);
    this.tableEl.append(
      el("div", { class: "views-pivot-note" }, [
        `Spreading “${pivots.map((index) => result.dimensionNames[index] ?? "?").join(" + ")}” across columns · ${result.measureNames[measureIndex] ?? "measure 1"} · blank cells have no rows${margins === null ? "" : ` - ${marginsName} margins computed from raw rows`}.`,
      ]),
    );
  }

  private prettyMeasure(result: AggregateMessage, index: number): string {
    const measure = this.views[this.active]?.def.measures[index];
    if (measure === undefined) return result.measureNames[index] ?? "measure";
    const symbol = measureSymbol(measure);
    const column = measureDisplay(measure, this.metas);
    const post = (measure.post ?? []).map((op) => op.op).join(" → ");
    return post === ""
      ? `${symbol} ${column}`
      : `${symbol} ${column} → ${post}`;
  }

  private sortableHeader(
    def: ViewDef,
    key: string,
    label: string,
    className: string,
  ): HTMLElement {
    const active = def.sort.key === key;
    const arrow = active ? (def.sort.dir === "asc" ? " ▲" : " ▼") : "";
    const th = el("th", { class: className });
    const button = el(
      "button",
      { class: "views-sort", type: "button", title: "Sort by this column" },
      [`${label}${arrow}`],
    ) as HTMLButtonElement;
    button.addEventListener("click", () =>
      this.update((view) => {
        view.sort = {
          key,
          dir: active && view.sort.dir === "desc" ? "asc" : "desc",
        };
      }),
    );
    th.append(button);
    return th;
  }
}
