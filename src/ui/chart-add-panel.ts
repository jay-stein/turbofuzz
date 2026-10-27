import type { ColumnMeta } from "../worker/protocol.js";
import { aggFor } from "./chart-names.js";
import {
  configForChart,
  kindForRecommended,
  type BuilderPick,
  type ValueAgg,
} from "./chart-builder.js";
import type { ChartCardConfig } from "./chart-card.js";
import { GALLERY_KINDS, fitChartKind, previewFor } from "./chart-gallery.js";
import { profile, recommend, type RecRole } from "./chart-recommender.js";
import { CHART_KIND_LABELS, suggestCharts, toRecColumn, type ChartCardKind } from "./chart-utils.js";
import { el } from "./dom.js";

export interface ChartAddSource {
  id: string;
  name: string;
  kind?: "pivot" | "view";
}

export interface ChartAddPanelOptions {
  /** Create the card; `label` names it in the status line. */
  onCreate(config: Partial<ChartCardConfig>, label: string): void;
  /** The shelf changed, so anything showing it (the Guide) can refresh. */
  onShelfChange?(): void;
}

const ROLE_GLYPH: Record<RecRole, string> = {
  id: "ID",
  time: "T",
  "cat-low": "C",
  "cat-mid": "C",
  "cat-high": "C",
  measure: "#",
  text: "Aa",
};

const ROLE_WORD: Record<RecRole, string> = {
  id: "identifier",
  time: "time",
  "cat-low": "category",
  "cat-mid": "category",
  "cat-high": "category",
  measure: "measure",
  text: "text",
};

/** Aggregation chip choices, in cycling order. */
const AGG_CYCLE: readonly [ValueAgg, string][] = [
  ["sum", "Total"],
  ["mean", "Average"],
  ["median", "Median"],
  ["min", "Min"],
  ["max", "Max"],
];

const aggLabel = (agg: ValueAgg): string => AGG_CYCLE.find(([value]) => value === agg)?.[1] ?? agg;

/**
 * The data-first "Add a chart" panel: pick a source, pick fields (or a quick
 * start), and the recommended charts appear. Choosing a chart type is a
 * shortcut that fills the same slots. Nothing opens between a click on a tile
 * and the chart on screen.
 */
export class ChartAddPanel {
  readonly root: HTMLElement;
  private columns: readonly ColumnMeta[] = [];
  private rowCount = 0;
  private sources: ChartAddSource[] = [];
  private source = "";
  private picks = new Map<number, ValueAgg | undefined>();
  private message = "";

  constructor(private readonly options: ChartAddPanelOptions) {
    this.root = el("section", {
      class: "chart-add-panel hidden",
      "aria-label": "Add a chart",
    });
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  setColumns(columns: readonly ColumnMeta[], rowCount: number): void {
    this.columns = columns;
    this.rowCount = rowCount;
    for (const index of [...this.picks.keys()]) if (index >= columns.length) this.picks.delete(index);
    if (this.isOpen) this.render();
  }

  setSources(sources: ChartAddSource[]): void {
    this.sources = sources;
    if (this.source !== "" && !sources.some((s) => s.id === this.source)) this.source = "";
    if (this.isOpen) this.render();
  }

  /** `focus` moves keyboard focus in; leave it off when opening on the user's behalf. */
  open(focus = true): void {
    if (this.isOpen && !focus) return;
    this.message = "";
    this.root.classList.remove("hidden");
    this.render();
    if (focus) (this.root.querySelector(".chart-add-quick-btn, .chart-add-field") as HTMLElement | null)?.focus();
  }

  close(): void {
    this.root.classList.add("hidden");
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Forget the shelf after a chart is made, so the next one starts clean. */
  reset(): void {
    this.picks.clear();
    this.message = "";
  }

  private create(config: Partial<ChartCardConfig> | null, label: string, explain: string): void {
    if (config === null) {
      this.message = explain;
      this.render();
      return;
    }
    this.options.onCreate(config, label);
  }

  /** The fields currently on the shelf. */
  picked(): BuilderPick[] {
    return this.shelf();
  }

  private shelf(): BuilderPick[] {
    return [...this.picks].map(([index, agg]) => ({ index, agg }));
  }

  private toggleField(index: number): void {
    if (this.picks.has(index)) this.picks.delete(index);
    else this.picks.set(index, undefined);
    this.message = "";
    this.render(`.chart-add-field[data-index="${index}"]`);
  }

  private render(focus?: string): void {
    this.options.onShelfChange?.();
    const active = focus ?? (this.root.contains(document.activeElement)
      ? this.selectorFor(document.activeElement as HTMLElement)
      : undefined);
    this.root.replaceChildren(this.head());
    const view = this.sources.find((s) => s.id === this.source);
    if (view !== undefined) this.root.append(this.viewBody(view));
    else this.root.append(...this.tableBody());
    if (this.message !== "") {
      this.root.append(el("p", { class: "chart-add-message", role: "status" }, [this.message]));
    }
    if (active !== undefined) (this.root.querySelector(active) as HTMLElement | null)?.focus();
  }

  /** A stable selector for the control that has focus, so a re-render keeps it. */
  private selectorFor(node: HTMLElement): string | undefined {
    const id = node.getAttribute("data-key");
    return id === null ? undefined : `[data-key="${id}"]`;
  }

  private head(): HTMLElement {
    const select = el("select", { class: "chart-picker", "aria-label": "Chart source", "data-key": "source" }) as HTMLSelectElement;
    select.append(el("option", { value: "" }, ["Table (filtered)"]) as HTMLOptionElement);
    for (const source of this.sources) {
      select.append(el("option", { value: source.id }, [source.name]) as HTMLOptionElement);
    }
    select.value = this.source;
    select.addEventListener("change", () => {
      this.source = select.value;
      this.message = "";
      this.render("[data-key=\"source\"]");
    });
    const close = el("button", { class: "icon-btn", type: "button", title: "Close", "aria-label": "Close add chart" }, ["×"]);
    close.addEventListener("click", () => this.close());
    return el("div", { class: "chart-add-head" }, [
      el("h3", {}, ["Add a chart"]),
      el("label", { class: "chart-add-source" }, [el("span", {}, ["Source"]), select]),
      close,
    ]);
  }

  /** A pivot or saved view is already aggregated, so only compatible types are offered. */
  private viewBody(view: ChartAddSource): HTMLElement {
    const body = el("div", { class: "chart-add-body" });
    const tiles = el("div", { class: "chart-add-tiles" });
    const make = (kind: ChartCardKind, why: string): void => {
      tiles.append(
        this.tile(kind, CHART_KIND_LABELS[kind], why, false, {}, () =>
          this.create({ kind, source: view.id, title: view.name }, CHART_KIND_LABELS[kind], ""),
        ),
      );
    };
    make("bar", `Bars from the rows of ${view.name}. The view is already summarised, so nothing is re-aggregated.`);
    if (view.kind === "pivot") make("pivotHeatmap", "Colour each cell of the pivot to see where values are high or low.");
    body.append(el("h4", {}, [`Charts for the view "${view.name}"`]), tiles);
    return body;
  }

  private tableBody(): HTMLElement[] {
    const cols = this.columns;
    const rec = cols.map((meta, index) => ({ meta, index, p: profile(toRecColumn(meta, index, this.rowCount), this.rowCount) }));
    const out: HTMLElement[] = [];

    // 1. Quick starts: one click selects the fields and makes the chart.
    const ideas = suggestCharts(cols, this.rowCount);
    if (ideas.length > 0) {
      const row = el("div", { class: "chart-add-quick" });
      for (const idea of ideas) {
        const button = el("button", { class: "chart-add-quick-btn", type: "button", title: idea.label }, [idea.label]);
        button.addEventListener("click", () => this.create(idea.preset, idea.label, ""));
        row.append(button);
      }
      out.push(el("div", { class: "chart-add-block" }, [el("h4", {}, ["Quick starts"]), row]));
    }

    // 2. Fields, grouped by role, with the shelf's aggregation chips.
    const fields = el("div", { class: "chart-add-fields", role: "group", "aria-label": "Fields" });
    for (const entry of rec) {
      if (entry.meta.role === "provenance") continue;
      const picked = this.picks.has(entry.index);
      const button = el(
        "button",
        {
          class: "chart-add-field",
          type: "button",
          "aria-pressed": picked ? "true" : "false",
          "data-index": String(entry.index),
          "data-key": `field-${entry.index}`,
          title: `${entry.meta.name}: ${ROLE_WORD[entry.p.role]}, ${entry.p.distinct.toLocaleString("en-US")} distinct`,
        },
        [
          el("span", { class: `chart-add-role role-${entry.p.role.split("-")[0]}`, "aria-hidden": "true" }, [ROLE_GLYPH[entry.p.role]]),
          el("span", { class: "chart-add-field-name" }, [entry.meta.name]),
          el("span", { class: "chart-add-field-meta" }, [ROLE_WORD[entry.p.role]]),
        ],
      );
      button.addEventListener("click", () => this.toggleField(entry.index));
      fields.append(button);
    }
    const shelf = el("div", { class: "chart-add-shelf", "aria-label": "Selected fields" });
    for (const [index, agg] of this.picks) {
      const found = rec[index];
      if (found === undefined) continue;
      const chip = el("span", { class: "chart-add-chip" }, [found.meta.name]);
      if (found.p.role === "measure" || found.p.canMeasure === true) {
        const current = agg ?? aggFor(found.meta.name);
        const aggButton = el(
          "button",
          { class: "chart-add-agg", type: "button", "data-key": `agg-${index}`, title: "Change how this field is combined" },
          [aggLabel(current)],
        );
        aggButton.addEventListener("click", () => {
          const at = AGG_CYCLE.findIndex(([value]) => value === current);
          this.picks.set(index, AGG_CYCLE[(at + 1) % AGG_CYCLE.length][0]);
          this.render(`[data-key="agg-${index}"]`);
        });
        chip.append(aggButton);
      }
      shelf.append(chip);
    }
    if (this.picks.size > 0) {
      const clear = el("button", { class: "chart-add-clear", type: "button" }, ["Clear"]);
      clear.addEventListener("click", () => {
        this.picks.clear();
        this.render();
      });
      shelf.append(clear);
    }
    out.push(el("div", { class: "chart-add-block" }, [el("h4", {}, ["Fields"]), fields, shelf]));

    // 3. Recommended charts for the shelf.
    out.push(el("div", { class: "chart-add-block" }, [el("h4", {}, ["Recommended"]), this.recommended(rec.length)]));

    // 4. A chart type is a shortcut that fills the same slots.
    const types = el("div", { class: "chart-add-types", role: "group", "aria-label": "Or choose a chart type" });
    for (const kind of GALLERY_KINDS) {
      const fit = fitChartKind(kind, cols, this.rowCount);
      const chip = el(
        "button",
        {
          class: "chart-add-type",
          type: "button",
          "aria-disabled": fit.ok ? "false" : "true",
          title: fit.ok ? `Add a ${CHART_KIND_LABELS[kind].toLowerCase()} chart` : `${CHART_KIND_LABELS[kind]}: ${fit.reason}`,
        },
        [CHART_KIND_LABELS[kind]],
      );
      if (!fit.ok) {
        const reason = el("span", { class: "sr-only", id: `chart-add-reason-${kind}` }, [fit.reason]);
        chip.append(reason);
        chip.setAttribute("aria-describedby", reason.id);
      }
      chip.addEventListener("click", () => {
        if (!fit.ok) return;
        this.create(
          configForChart(kind, this.shelf(), cols, this.rowCount),
          CHART_KIND_LABELS[kind],
          `The selected fields do not fit a ${CHART_KIND_LABELS[kind].toLowerCase()} chart. Clear them to use the default columns.`,
        );
      });
      types.append(chip);
    }
    out.push(el("div", { class: "chart-add-block" }, [el("h4", {}, ["Or choose a chart type"]), types]));
    return out;
  }

  private recommended(columnCount: number): HTMLElement {
    const wrap = el("div", { class: "chart-add-recs" });
    if (columnCount === 0) {
      wrap.append(el("p", { class: "chart-add-hint" }, ["Load data to see recommendations."]));
      return wrap;
    }
    if (this.picks.size === 0) {
      wrap.append(el("p", { class: "chart-add-hint" }, ["Pick one or more fields to see the charts that fit them."]));
      return wrap;
    }
    const selection = [...this.picks.keys()].map((index) => toRecColumn(this.columns[index], index, this.rowCount));
    const { options, notes } = recommend(selection, { rows: this.rowCount, source: "table" });
    const tiles = el("div", { class: "chart-add-tiles" });
    let best = true;
    for (const option of options) {
      const kind = kindForRecommended(option.chart);
      if (kind === null || option.isNew) continue;
      const config = configForChart(kind, this.shelf(), this.columns, this.rowCount, { strict: true });
      if (config === null) continue;
      tiles.append(
        this.tile(kind, CHART_KIND_LABELS[kind], option.why, best, config, () =>
          this.create(config, CHART_KIND_LABELS[kind], ""),
        ),
      );
      best = false;
    }
    if (tiles.childElementCount > 0) wrap.append(tiles);
    for (const note of notes) wrap.append(el("p", { class: "chart-add-hint" }, [note]));
    if (tiles.childElementCount === 0 && notes.length === 0) {
      wrap.append(el("p", { class: "chart-add-hint" }, ["No chart fits this combination. Remove a field."]));
    }
    return wrap;
  }

  private tile(
    kind: ChartCardKind,
    label: string,
    why: string,
    best: boolean,
    preset: Partial<ChartCardConfig>,
    action: () => void,
  ): HTMLElement {
    const icon = el("span", { class: "chart-add-tile-icon" }, [previewFor(kind, preset, this.columns)]);
    const button = el("button", { class: "chart-add-tile", type: "button", title: `${label}: ${why}` }, [
      icon,
      el("span", { class: "chart-add-tile-text" }, [
        el("span", { class: "chart-add-tile-label" }, [label, ...(best ? [el("span", { class: "chart-add-best" }, ["Best"])] : [])]),
        el("span", { class: "chart-add-tile-why" }, [why]),
      ]),
    ]);
    button.addEventListener("click", action);
    return button;
  }
}
