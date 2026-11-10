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

type FieldSlot = ReturnType<ChartCard["fieldSlots"]>[number];

/** What one click on a field does. */
export type FieldClick =
  | { do: "add"; slot: FieldSlot }
  | { do: "remove"; slot: FieldSlot }
  | { do: "new"; kind: ChartCardKind }
  | { do: "ask" }
  | { do: "none" };

/** The click for a field with these places on the chart: the obvious one, or a question. */
export function chooseSlot(slots: readonly FieldSlot[]): FieldClick {
  const active = slots.filter((slot) => slot.active);
  if (active.length > 0) {
    if (active.length === 1 && active[0]!.clearable) return { do: "remove", slot: active[0]! };
    // A field that is where it must be, with nowhere else to go, has nothing to offer.
    return slots.length === 1 ? { do: "none" } : { do: "ask" };
  }
  if (slots.length === 0) return { do: "none" };
  if (slots.length === 1) return { do: "add", slot: slots[0]! };
  const empty = slots.filter((slot) => slot.empty);
  return empty.length === 1 ? { do: "add", slot: empty[0]! } : { do: "ask" };
}

/**
 * One click puts a field in the obvious place: the only place it fits, or the only one still
 * empty; a field already on the chart comes off. It asks only when there is a real choice
 * (two free places, or a field that could only replace another), and never leaves the open
 * chart for a new one without being asked.
 */
export function fieldClick(card: ChartCard | null, column: number, meta: ColumnMeta): FieldClick {
  if (card === null) {
    const kind = chartKindFor(meta.type);
    return kind === null ? { do: "ask" } : { do: "new", kind };
  }
  return chooseSlot(card.fieldSlots(column));
}

/**
 * The left of the chart workspace: every column, the ones the open chart uses marked with what
 * they are on it. A click puts a field on the chart or takes it off; the menu beside it has
 * every place the field can go.
 */
export class ChartFieldRail {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly title: HTMLElement;
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
    this.title = el("div", { class: "chart-rail-title" }, ["Fields"]);
    this.root = el("aside", { class: "chart-rail", "aria-label": "Fields" }, [
      this.title,
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
    const items = card?.pivotRailItems() ?? null;
    this.title.textContent = items === null ? "Fields" : "Pivot fields";
    if (items !== null) {
      this.syncPivot(items);
      return;
    }
    const used = card?.usedFields() ?? new Set<number>();
    const roles = card?.fieldRoles() ?? new Map<number, string>();
    const key = `${this.columns.length}|${this.query}|${[...used].map((column) => `${column}:${roles.get(column) ?? ""}`).join(",")}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const rows: HTMLElement[] = [];
    this.columns.forEach((meta, column) => {
      if (this.query !== "" && !meta.name.toLowerCase().includes(this.query)) return;
      const role = roles.get(column) ?? "";
      const field = el(
        "button",
        {
          class: `chart-rail-field${used.has(column) ? " used" : ""}`,
          type: "button",
          title: `${meta.name} (${TYPE_LABELS[meta.type]})`,
          "aria-pressed": String(used.has(column)),
        },
        [
          el("span", { class: "chart-rail-glyph", "aria-hidden": "true" }, [GLYPHS[meta.type] ?? "?"]),
          el("span", { class: "chart-rail-name" }, [meta.name]),
          ...(role === "" ? [] : [el("span", { class: "chart-rail-role" }, [role])]),
        ],
      );
      // What the click will do, worked out when it is about to matter, not for every field on every paint.
      const describe = (): void => {
        field.title = `${meta.name} (${TYPE_LABELS[meta.type]}). ${this.describe(column, meta)}`;
      };
      field.addEventListener("pointerenter", describe);
      field.addEventListener("focus", describe);
      field.addEventListener("click", () => this.click(field, column));
      const more = el(
        "button",
        {
          class: "chart-rail-more",
          type: "button",
          title: `Every place ${meta.name} can go`,
          "aria-label": `Every place ${meta.name} can go`,
          "aria-haspopup": "menu",
        },
        ["\u22ef"],
      );
      more.addEventListener("click", () => this.openFor(more, column));
      rows.push(el("div", { class: "chart-rail-row" }, [field, more]));
    });
    this.list.replaceChildren(...rows);
  }

  /** A chart of a pivot: the pivot's own fields, with what each is on the chart. */
  private syncPivot(items: NonNullable<ReturnType<ChartCard["pivotRailItems"]>>): void {
    const key = `pivot|${this.query}|${items.map((item) => `${item.name}:${item.role}:${item.slots.map((slot) => `${slot.label}${slot.active ? "*" : ""}`).join("/")}`).join(",")}`;
    if (key === this.drawn) return;
    this.drawn = key;
    this.search.classList.toggle("hidden", items.length <= SEARCH_ABOVE);
    const rows: HTMLElement[] = [];
    for (const item of items) {
      if (this.query !== "" && !item.name.toLowerCase().includes(this.query)) continue;
      const used = item.role !== "";
      const field = el(
        "button",
        { class: `chart-rail-field${used ? " used" : ""}`, type: "button", "aria-pressed": String(used) },
        [
          el("span", { class: "chart-rail-glyph", "aria-hidden": "true" }, [item.glyph]),
          el("span", { class: "chart-rail-name" }, [item.name]),
          ...(item.role === "" ? [] : [el("span", { class: "chart-rail-role" }, [item.role])]),
        ],
      );
      const click = chooseSlot(item.slots);
      field.title =
        click.do === "add"
          ? `${item.name}. Click to use it as the ${click.slot.label} of this chart.`
          : click.do === "remove"
            ? `${item.name} is the ${click.slot.label} of this chart: click to take it off.`
            : click.do === "ask"
              ? `${item.name}. Click to choose where it goes.`
              : item.name;
      const menu = (anchor: HTMLElement): void => {
        if (item.slots.length === 0) return;
        openMenu(anchor, [
          { label: "Use on this chart as", heading: true, action: () => {} },
          ...item.slots.map(
            (slot): MenuItem => ({
              label: slot.label,
              checked: slot.active,
              disabled: slot.active && !slot.clearable,
              action: () => slot.toggle(),
            }),
          ),
        ]);
      };
      field.addEventListener("click", () => {
        const now = chooseSlot(item.slots);
        if (now.do === "add" || now.do === "remove") now.slot.toggle();
        else if (now.do === "ask") menu(field);
      });
      const more = el(
        "button",
        { class: "chart-rail-more", type: "button", title: `Every place ${item.name} can go`, "aria-label": `Every place ${item.name} can go`, "aria-haspopup": "menu" },
        ["\u22ef"],
      );
      more.addEventListener("click", () => menu(more));
      rows.push(el("div", { class: "chart-rail-row" }, item.slots.length === 0 ? [field] : [field, more]));
    }
    this.list.replaceChildren(...rows);
  }

  private describe(column: number, meta: ColumnMeta): string {
    const click = fieldClick(this.options.activeCard(), column, meta);
    if (click.do === "add") return `Click to use it as the ${click.slot.label} of this chart.`;
    if (click.do === "remove") return `It is the ${click.slot.label} of this chart: click to take it off.`;
    if (click.do === "new") return "Click to chart it.";
    if (click.do === "none") return "It is already where it can be on this chart.";
    return "Click to choose where it goes.";
  }

  private click(anchor: HTMLElement, column: number): void {
    const meta = this.columns[column];
    if (meta === undefined) return;
    const click = fieldClick(this.options.activeCard(), column, meta);
    if (click.do === "add" || click.do === "remove") click.slot.toggle();
    else if (click.do === "new") this.options.onNewChart(click.kind, column);
    else if (click.do === "ask") this.openFor(anchor, column);
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
