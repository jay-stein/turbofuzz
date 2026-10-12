import type { ColumnMeta, AggregateMessage } from "../worker/protocol.js";
import type { ArchetypeId } from "../data/archetype.js";
import {
  type Aggregate,
  type DatePart,
  type DimensionSpec,
  isCompleteView,
  type MeasureSpec,
  type PostOp,
  type TimeGrain,
  type ViewDef,
} from "../data/aggregate.js";
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
  /** The view list changed (added/removed): refresh chart source selectors. */
  onViewsChanged?(): void;
}

interface ViewEntry {
  def: ViewDef;
  result: AggregateMessage | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
}

const MAX_VIEWS = 5;
const DEFAULT_LIMIT = 500;

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

function measureSymbol(measure: MeasureSpec): string {
  if (measure.column === null) return "#";
  if (measure.agg === "count") return "#";
  return AGG_SYMBOLS[measure.agg] ?? measure.agg;
}

function formatMeasure(value: number, measure: MeasureSpec): string {
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
    (meta) => meta.type === "date" && meta.stats.distinct >= 2,
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
  private readonly tabsEl: HTMLElement;
  private readonly builderEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly tableEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private views: ViewEntry[] = [];
  private active = 0;
  private metas: ColumnMeta[] = [];
  private rowCount = 0;
  private started = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: ViewsPanelOptions,
  ) {
    this.root.classList.add("views-panel");
    this.tabsEl = el("div", { class: "views-tabs" });
    this.builderEl = el("div", { class: "views-builder" });
    this.noteEl = el("div", { class: "views-note" });
    this.tableEl = el("div", { class: "views-table-host" });
    this.actionsEl = el("div", { class: "views-actions" });
    this.root.append(this.tabsEl, this.builderEl, this.noteEl, this.tableEl, this.actionsEl);
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
        loading: false,
        stale: true,
        error: null,
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
    this.render();
    const generation = ++this.generation;
    void this.options
      .requestAggregate(entry.def)
      .then((message) => {
        if (generation !== this.generation) return;
        entry.result = message;
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
    const date = this.metas.findIndex((meta) => meta.type === "date");
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
    return { def, result: null, loading: false, stale: true, error: null };
  }

  private addView(): void {
    if (this.views.length >= MAX_VIEWS) return;
    const entry = this.blankView();
    entry.def.id = `view-${this.views.length + 1}-${Date.now().toString(36)}`;
    this.views.push(entry);
    this.active = this.views.length - 1;
    this.options.onViewsChanged?.();
    this.refresh();
  }

  private removeView(index: number): void {
    if (this.views.length <= 1) return;
    this.views.splice(index, 1);
    this.active = Math.max(0, Math.min(this.active >= index ? this.active - 1 : this.active, this.views.length - 1));
    this.options.onViewsChanged?.();
    this.refresh();
  }

  private update(mutate: (view: ViewDef) => void): void {
    const entry = this.views[this.active];
    if (entry === undefined) return;
    mutate(entry.def);
    entry.stale = true;
    this.refresh();
  }

  private render(): void {
    this.renderTabs();
    this.renderActions();
    const entry = this.views[this.active];
    if (entry === undefined) {
      clear(this.builderEl);
      clear(this.tableEl);
      this.noteEl.textContent = "";
      return;
    }
    this.renderBuilder(entry.def);
    this.renderNote(entry);
    this.renderTable(entry);
  }

  private renderTabs(): void {
    clear(this.tabsEl);
    this.views.forEach((entry, index) => {
      const tab = el(
        "button",
        {
          class: `views-tab${index === this.active ? " active" : ""}`,
          type: "button",
          title: entry.def.name,
        },
        [entry.def.name],
      ) as HTMLButtonElement;
      tab.addEventListener("click", () => {
        if (index === this.active) return;
        this.active = index;
        if (entry.stale || entry.result === null) this.refresh();
        else this.render();
      });
      if (this.views.length > 1) {
        const remove = el(
          "span",
          { class: "views-tab-remove", title: "Remove this view", role: "button" },
          ["×"],
        );
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          this.removeView(index);
        });
        tab.append(remove);
      }
      this.tabsEl.append(tab);
    });
    if (this.views.length < MAX_VIEWS) {
      const add = el(
        "button",
        { class: "views-tab views-tab-add", type: "button", title: "Add an aggregate view" },
        ["+ View"],
      ) as HTMLButtonElement;
      add.addEventListener("click", () => this.addView());
      this.tabsEl.append(add);
    }
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

    this.actionsEl.append(
      respect,
      el("span", { class: "grow" }),
      limitLabel,
      chart,
      pandas,
      dataset,
    );
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
    if (def.dimensions.length < 2) dimZone.append(addDim);

    const measureZone = el("div", { class: "views-zone" });
    measureZone.append(el("span", { class: "views-zone-label" }, ["Measures:"]));
    def.measures.forEach((measure, index) => {
      measureZone.append(this.measurePill(def, measure, index));
    });
    const addMeasure = el(
      "button",
      { class: "views-pill add", type: "button", title: "Add a measure" },
      ["+ Measure"],
    ) as HTMLButtonElement;
    addMeasure.addEventListener("click", () => this.openMeasureMenu(addMeasure, def));
    measureZone.append(addMeasure);

    this.builderEl.append(dimZone, measureZone);
  }

  private dimensionPill(def: ViewDef, spec: DimensionSpec, index: number): HTMLElement {
    const meta = this.metas[spec.column];
    const by = spec.by;
    const suffix =
      by === "value"
        ? ""
        : typeof by === "object" && "time" in by
          ? ` · ${GRAIN_LABELS[by.time]}`
          : typeof by === "object" && "datePart" in by
            ? ` · ${DATE_PARTS.find((part) => part.value === by.datePart)?.label ?? by.datePart}`
            : "";
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
      }),
    );
    pill.append(label, remove);
    return pill;
  }

  private measurePill(def: ViewDef, measure: MeasureSpec, index: number): HTMLElement {
    const meta = measure.column === null ? null : this.metas[measure.column];
    const name = measure.column === null ? "rows" : (meta?.name ?? "?");
    const post = measure.post ?? [];
    const postText = post.length > 0 ? ` ${post.map((op) => `→${op.op}`).join("")}` : "";
    const pill = el("span", { class: "views-pill" });
    const label = el(
      "button",
      {
        class: "views-pill-label",
        type: "button",
        title: "Change the aggregate or add a post step",
      },
      [`${measureSymbol(measure)} ${name}${postText}`],
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
        if (typeof by === "object" && "time" in by) {
          view.fill = "zero";
          if (view.sort.key === `dim${index}`) view.sort = { key: `dim${index}`, dir: "asc" };
        }
      });
    };
    items.push({ label: "Exact value", action: () => setBy("value") });
    if (meta.type === "date") {
      for (const grain of ["day", "week", "month", "quarter", "year", "hour", "minute"] as TimeGrain[]) {
        items.push({
          label: `Time · ${GRAIN_LABELS[grain]}`,
          action: () => setBy({ time: grain }),
        });
      }
      for (const part of DATE_PARTS) {
        items.push({ label: `Part · ${part.label}`, action: () => setBy({ datePart: part.value }) });
      }
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
          const next: DimensionSpec =
            meta.type === "date" ? { column: index, by: { time: "month" } } : { column: index, by: "value" };
          view.dimensions.push(next);
          if (meta.type === "date") {
            view.fill = "zero";
            if (view.dimensions.length === 1) view.sort = { key: "dim0", dir: "asc" };
          }
        }),
    }));
    openMenu(anchor, items);
  }

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
      const numeric = meta.type === "integer" || meta.type === "number" || meta.type === "date";
      items.push({
        label: `${numeric ? "Σ" : "#"} ${meta.name}`,
        title: numeric ? `Sum of ${meta.name} by group` : `Count of ${meta.name} values by group`,
        action: () =>
          this.update((view) => {
            view.measures.push(
              numeric
                ? { column: index, agg: "sum" }
                : { column: index, agg: "count" },
            );
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
    const numeric = meta === null || meta.type === "integer" || meta.type === "number" || meta.type === "date";
    const items: MenuItem[] = [];
    if (measure.column !== null) {
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
    const postOptions: readonly { op: PostOp["op"]; label: string; window?: number }[] = [
      { op: "rolling", label: "Rolling mean (7)", window: 7 },
      { op: "cumulative", label: "Cumulative sum" },
      { op: "diff", label: "Difference" },
      { op: "pctChange", label: "% change" },
      { op: "pctTotal", label: "% of total" },
      { op: "rank", label: "Rank" },
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
              ? { column: current.column, agg: current.agg }
              : { ...current, post };
          }),
      });
    }
    openMenu(anchor, items);
  }

  private renderNote(entry: ViewEntry): void {
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
    for (let row = 0; row < result.groupCount; row++) {
      const tr = el("tr", { class: "views-row", title: "Click to filter the table to this group" });
      const times = result.dimensionTimes[0];
      const timeStart = times !== undefined && Number.isFinite(times[row]) ? times[row] : null;
      tr.addEventListener("click", () => {
        const dim = entry.def.dimensions[0];
        if (dim === undefined) return;
        this.options.onDrill(dim.column, timeStart, null, result.dimensions[0][row]);
      });
      result.dimensionNames.forEach((_, d) => {
        tr.append(el("td", { class: "views-dim" }, [result.dimensions[d][row]]));
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
  }

  private prettyMeasure(result: AggregateMessage, index: number): string {
    const name = result.measureNames[index] ?? "measure";
    const measure = this.views[this.active]?.def.measures[index];
    if (measure === undefined) return name;
    const symbol = measureSymbol(measure);
    const column =
      measure.column === null ? "rows" : (this.metas[measure.column]?.name ?? "?");
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
