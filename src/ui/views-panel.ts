import type { ColumnMeta, AggregateMessage } from "../worker/protocol.js";
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
  type PostOp,
  type TimeGrain,
  type ViewDef,
} from "../data/aggregate.js";
import { isNumericLikeType } from "../types.js";
import { downloadCsv } from "./chart-export.js";
import { safeFileName } from "./chart-utils.js";
import { openPrompt } from "./dialog.js";
import { clear, el } from "./dom.js";
import { openMenu, type MenuItem } from "./menu.js";

export interface ViewsPanelOptions {
  requestAggregate(view: ViewDef): Promise<AggregateMessage>;
  /** Detected table archetype, used to pick smarter starter views. */
  archetype?(): ArchetypeId;
  /** Clicking a group row: value dimensions pass the label, time dims the bucket. */
  onDrill(column: number, timeStart: number | null, timeEnd: number | null, label: string): void;
  onChart(view: ViewDef): void;
  onUseAsDataset(view: ViewDef): void;
  onCopyPandas(view: ViewDef): Promise<void>;
  /** Publication-style rendering of the current result (PNG/HTML export). */
  onSlickTable?(view: ViewDef, result: AggregateMessage): void;
  /** The view list changed (added/removed): refresh chart source selectors. */
  onViewsChanged?(): void;
}

interface ViewEntry {
  def: ViewDef;
  result: AggregateMessage | null;
  /** Pivot margins computed by the worker over raw rows. */
  margins: {
    rows: AggregateMessage | null;
    cols: AggregateMessage | null;
    total: AggregateMessage | null;
  } | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  /** Reads beyond the first VISIBLE_ROWS rows of the table. */
  expanded: boolean;
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

const GRAIN_LABELS: Record<TimeGrain, string> = {
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
    this.metas = metas;
    this.rowCount = rowCount;
    if (!this.started && metas.length > 0) {
      this.started = true;
      const starters = starterViews(metas, this.options.archetype?.() ?? "general");
      this.views = starters.map((def) => ({
        def,
        result: null,
        margins: null,
        loading: false,
        stale: true,
        error: null,
        expanded: false,
      }));
      if (this.views.length === 0) this.views = [this.blankView()];
      this.active = 0;
      this.refresh();
    } else if (!sameShape) {
      // Columns changed shape (transform): keep definitions, mark for refresh.
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
    entry.loading = true;
    entry.error = null;
    entry.margins = null;
    this.render();
    const generation = ++this.generation;
    const def = entry.def;
    const marginViews: ViewDef[] = [];
    const pivots = this.pivotIndexes(def);
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
      margins: null,
      loading: false,
      stale: true,
      error: null,
      expanded: false,
    };
  }

  /** Insert a blank view at `at` (clamped); it opens with the name field focused. */
  private addView(at?: number): void {
    if (this.views.length >= MAX_VIEWS) return;
    const entry = this.blankView();
    entry.def.id = `view-${this.views.length + 1}-${Date.now().toString(36)}`;
    const taken = new Set(this.views.map((view) => view.def.name));
    let counter = this.views.length + 1;
    let name = `View_${counter}`;
    while (taken.has(name)) name = `View_${++counter}`;
    entry.def.name = name;
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
        entry.def.name = name.slice(0, 80);
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
      [expanded ? "▾" : "▸"],
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
      if (entry.stale && entry.result !== null) {
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
    if (entry !== undefined && (entry.stale || entry.result === null)) this.refresh();
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
    if (entry.result !== null) {
      parts.push(
        `${entry.result.groupCount.toLocaleString()} ${
          entry.result.groupCount === 1 ? "group" : "groups"
        }`,
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

    const dataset = el(
      "button",
      {
        class: "ghost small",
        type: "button",
        title: "Replace the working dataset with this aggregate (tracked in the Recipe)",
      },
      ["Use as dataset"],
    ) as HTMLButtonElement;
    dataset.disabled = entry === undefined || !isCompleteView(entry.def);
    dataset.addEventListener("click", () => {
      if (entry !== undefined) this.options.onUseAsDataset(entry.def);
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
    csv.disabled = entry === undefined || entry.result === null;
    csv.addEventListener("click", () => {
      if (entry !== undefined && entry.result !== null) this.exportCsv(entry);
    });

    const firstDim = entry?.def.dimensions[0];
    const isTimeDim =
      firstDim !== undefined && typeof firstDim.by === "object" && "time" in firstDim.by;

    this.actionsEl.append(respect, el("span", { class: "grow" }));
    if (isTimeDim && entry !== undefined) {
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
      marginsLabel.title = "Add All totals computed from the raw rows";
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
      marginsLabel.append(marginsInput, "Margins");

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
      const valueParts: HTMLElement[] = [];
      if (entry.def.measures.length > 1) {
        const valueLabel = el("label", { class: "views-limit" });
        valueLabel.title = "Choose which measure the pivot matrix shows";
        const valueSelect = el("select", {
          class: "chart-picker chart-picker-small",
          "aria-label": "Pivot measure",
        }) as HTMLSelectElement;
        entry.def.measures.forEach((measure, index) => {
          const option = el("option", { value: String(index) }, [
            measureDisplay(measure, this.metas),
          ]) as HTMLOptionElement;
          if ((entry.def.pivotMeasure ?? 0) === index) option.selected = true;
          valueSelect.append(option);
        });
        valueSelect.addEventListener("change", () =>
          this.update((view) => {
            view.pivotMeasure = Number(valueSelect.value);
          }),
        );
        valueLabel.append("Value", valueSelect);
        valueParts.push(valueLabel);
      }
      this.actionsEl.append(...valueParts, marginsLabel, fillLabel, dropLabel);
    }
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
    this.actionsEl.append(limitLabel, chart, slick, csv, pandas, dataset, below);
  }

  /** CSV of the current aggregate or pivot matrix. */
  private exportCsv(entry: ViewEntry): void {
    const result = entry.result;
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
    const dimZone = el("div", { class: "views-zone" });
    dimZone.append(el("span", { class: "views-zone-label" }, ["Group by:"]));
    def.dimensions.forEach((spec, index) => {
      dimZone.append(this.dimensionPill(def, spec, index));
    });
    const addDim = el(
      "button",
      { class: "views-pill add", type: "button", title: "Add a group-by column" },
      ["+ Column"],
    ) as HTMLButtonElement;
    addDim.addEventListener("click", () => this.openDimensionMenu(addDim, def));
    if (def.dimensions.length < 4) dimZone.append(addDim);

    const measureZone = el("div", { class: "views-zone views-measure-zone" });
    measureZone.append(el("span", { class: "views-zone-label" }, ["Measures:"]));
    def.measures.forEach((measure, index) => {
      measureZone.append(this.measurePill(def, measure, index));
    });
    const layoutZone = el("div", { class: "views-zone views-layout-zone" });
    layoutZone.append(el("span", { class: "views-zone-label" }, ["Pivot:"]));
    if (def.dimensions.length >= 2) {
      const pivots = new Set(this.pivotIndexes(def));
      def.dimensions.forEach((spec, index) => {
        const active = pivots.has(index);
        const button = el(
          "button",
          {
            class: `views-layout-pill${active ? " active" : ""}`,
            type: "button",
            "aria-pressed": active ? "true" : "false",
            title: active
              ? "Move this field back to the row index"
              : "Spread this field across the columns",
          },
          [
            el("span", { class: "views-layout-mark" }, [active ? "C" : "R"]),
            `${this.metas[spec.column]?.name ?? "?"}${this.dimensionSuffix(spec)}`,
          ],
        ) as HTMLButtonElement;
        button.addEventListener("click", () =>
          this.update((view) => {
            const next = new Set(this.pivotIndexes(view));
            if (next.has(index)) next.delete(index);
            else if (next.size < view.dimensions.length - 1) next.add(index);
            view.pivotColumns = [...next].sort((a, b) => a - b);
            view.pivot = view.pivotColumns[0];
            if (view.pivotColumns.length === 0) view.pivot = undefined;
            if (view.pivotColumns.length === 0) view.fillValue = undefined;
          }),
        );
        layoutZone.append(button);
      });
      layoutZone.append(
        el("span", { class: "views-layout-hint" }, [
          "R = row index, C = column field",
        ]),
      );
    } else {
      layoutZone.append(
        el("span", { class: "views-layout-hint" }, [
          "Add a second field to build a pivot",
        ]),
      );
    }

    const addMeasure = el(
      "button",
      { class: "views-pill add", type: "button", title: "Add a measure" },
      ["+ Measure"],
    ) as HTMLButtonElement;
    addMeasure.addEventListener("click", () => this.openMeasureMenu(addMeasure, def));
    measureZone.append(addMeasure);

    this.builderEl.append(dimZone, layoutZone, measureZone);
  }

  private dimensionPill(def: ViewDef, spec: DimensionSpec, index: number): HTMLElement {
    const meta = this.metas[spec.column];
    const suffix = this.dimensionSuffix(spec);
    const pill = el("span", { class: "views-pill" });
    const label = el(
      "button",
      { class: "views-pill-label", type: "button", title: "Change how this column is grouped" },
      [`${meta?.name ?? "?"}${suffix}`],
    ) as HTMLButtonElement;
    label.addEventListener("click", () => this.openGrainMenu(label, def, spec, index));
    const remove = el(
      "button",
      { class: "views-pill-remove", type: "button", title: "Remove this dimension" },
      ["×"],
    ) as HTMLButtonElement;
    remove.addEventListener("click", () =>
      this.update((view) => {
        view.dimensions.splice(index, 1);
        if (view.sort.key === `dim${index}`) view.sort = { key: "m0", dir: "desc" };
        if (view.pivot !== undefined) {
          if (view.pivot === index) view.pivot = undefined;
          else if (view.pivot > index) view.pivot -= 1;
          if (view.pivot !== undefined && view.pivot >= view.dimensions.length) {
            view.pivot = view.dimensions.length > 1 ? view.dimensions.length - 1 : undefined;
          }
        }
      }),
    );
    pill.append(label, remove);
    return pill;
  }

  private measurePill(def: ViewDef, measure: MeasureSpec, index: number): HTMLElement {
    const name = measureDisplay(measure, this.metas);
    const post = measure.post ?? [];
    const postText = post.length > 0 ? ` ${post.map((op) => `→${op.op}`).join("")}` : "";
    const pill = el("span", { class: "views-pill" });
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
    pill.append(label, remove);
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
      for (const grain of ["day", "week", "month", "quarter", "year", "hour", "minute"] as TimeGrain[]) {
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
