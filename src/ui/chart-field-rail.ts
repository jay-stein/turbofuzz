import type { ColumnMeta } from "../worker/protocol.js";
import { TYPE_LABELS } from "../types.js";
import type { ChartCard } from "./chart-card.js";
import { chartKindFor, type ChartCardKind } from "./chart-utils.js";
import { el } from "./dom.js";
import { openMenu, type MenuItem } from "./menu.js";

export interface FieldRailOptions {
  /** The chart on the open tab, if any. */
  activeCard(): ChartCard | null;
  /** A new chart of this column in its own tab. */
  onNewChart(kind: ChartCardKind, column: number): void;
}

const GLYPHS: Partial<Record<ColumnMeta["type"], string>> = {
  integer: "#",
  number: "#",
  duration: "#",
  date: "T",
  datetime: "T",
  time: "T",
  category: "C",
  boolean: "C",
  string: "Aa",
  identifier: "ID",
};

/** Long enough that scanning stops working and a search earns its place. */
const SEARCH_ABOVE = 12;

/**
 * The left of the chart workspace: every column, the ones the open chart uses marked.
 * A click says where a field can go on this chart, so no setting has to be hunted for.
 */
export class ChartFieldRail {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly search: HTMLInputElement;
  private columns: readonly ColumnMeta[] = [];
  private query = "";
  private drawn = "";

  constructor(private readonly options: FieldRailOptions) {
    this.search = el("input", {
      class: "text-input chart-rail-search hidden",
      type: "search",
      placeholder: "Find a field…",
      "aria-label": "Find a field",
    }) as HTMLInputElement;
    this.search.addEventListener("input", () => {
      this.query = this.search.value.trim().toLowerCase();
      this.drawn = "";
      this.sync();
    });
    this.list = el("div", { class: "chart-rail-list" });
    this.root = el("aside", { class: "chart-rail", "aria-label": "Fields" }, [
      el("div", { class: "chart-rail-title" }, ["Fields"]),
      this.search,
      this.list,
    ]);
  }

  setColumns(columns: readonly ColumnMeta[]): void {
    this.columns = columns;
    this.search.classList.toggle("hidden", columns.length <= SEARCH_ABOVE);
    this.drawn = "";
    this.sync();
  }

  /** Redraws when the columns, the search or the fields in use changed; cheap otherwise, so a chart can call it on every paint. */
  sync(): void {
    const card = this.options.activeCard();
    const used = card?.usedFields() ?? new Set<number>();
    const key = `${this.columns.length}|${this.query}|${[...used].join(",")}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const rows: HTMLElement[] = [];
    this.columns.forEach((meta, column) => {
      if (this.query !== "" && !meta.name.toLowerCase().includes(this.query)) return;
      const row = el(
        "button",
        {
          class: `chart-rail-field${used.has(column) ? " used" : ""}`,
          type: "button",
          title: `${meta.name} (${TYPE_LABELS[meta.type]})`,
          "aria-pressed": String(used.has(column)),
          "aria-haspopup": "menu",
        },
        [
          el("span", { class: "chart-rail-glyph", "aria-hidden": "true" }, [GLYPHS[meta.type] ?? "?"]),
          el("span", { class: "chart-rail-name" }, [meta.name]),
        ],
      );
      row.addEventListener("click", () => this.openFor(row, column));
      rows.push(row);
    });
    this.list.replaceChildren(...rows);
  }

  private openFor(anchor: HTMLElement, column: number): void {
    const card = this.options.activeCard();
    const meta = this.columns[column];
    if (meta === undefined) return;
    const items: MenuItem[] = [];
    for (const slot of card?.fieldSlots(column) ?? []) {
      items.push({
        label: slot.label,
        title: slot.active ? `${meta.name} is the ${slot.label} of this chart` : `Use ${meta.name} as the ${slot.label} of this chart`,
        checked: slot.active,
        disabled: slot.active && !slot.clearable,
        action: () => slot.toggle(),
      });
    }
    if (items.length > 0) items.unshift({ label: "Use on this chart as", heading: true, action: () => {} });
    const kind = chartKindFor(meta.type);
    items.push({
      label: "New chart from this field",
      title: kind === null ? `${meta.name} has no chart of its own: pair it with another field` : `Chart ${meta.name} in a new tab`,
      disabled: kind === null,
      action: () => {
        if (kind !== null) this.options.onNewChart(kind, column);
      },
    });
    openMenu(anchor, items);
  }
}
