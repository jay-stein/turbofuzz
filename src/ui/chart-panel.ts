import type { ChartBinOptions, ChartBins } from "../data/chart-bins.js";
import type { ChartSeriesMessage, ColumnMeta } from "../worker/protocol.js";
import { ChartCard, type ChartCardConfig, type SeriesRequestInput } from "./chart-card.js";
import {
  DEFAULT_EXPORT_SIZE,
  EXPORT_SIZES,
  defaultCardKind,
  isCategoryType,
  isNumericType,
} from "./chart-utils.js";
import { el } from "./dom.js";

export interface ChartsPanelOptions {
  datasetName(): string;
  requestBins(column: number, options: ChartBinOptions): Promise<ChartBins>;
  requestSeries(input: SeriesRequestInput): Promise<ChartSeriesMessage>;
}

const LAYOUT_KEY = "turbofuzz.charts.columns";
const DEFAULT_LAYOUT = 2;

function axisColumns(columns: ColumnMeta[], used: Set<number>): number[] {
  const out: number[] = [];
  columns.forEach((meta, index) => {
    if (isNumericType(meta.type) || meta.type === "date") out.push(index);
  });
  return out.filter((index) => !used.has(index));
}

/** Fresh card defaults, preferring columns no other card is using yet. */
function presetFor(columns: ColumnMeta[], used: Set<number>): Partial<ChartCardConfig> {
  const axisAll: number[] = [];
  columns.forEach((meta, index) => {
    if (isNumericType(meta.type) || meta.type === "date") axisAll.push(index);
  });
  if (used.size > 0 && axisAll.length >= 2) {
    const unused = axisColumns(columns, used);
    const x = unused[0] ?? axisAll[0];
    const y = axisAll.find((index) => index !== x) ?? x;
    return { kind: "scatter", x, y };
  }
  const kind = defaultCardKind(columns);
  const allow =
    kind === "histogram"
      ? (meta: ColumnMeta): boolean => isNumericType(meta.type)
      : kind === "line"
        ? (meta: ColumnMeta): boolean => meta.type === "date"
        : (meta: ColumnMeta): boolean => isCategoryType(meta.type);
  const allowed: number[] = [];
  columns.forEach((meta, index) => {
    if (allow(meta)) allowed.push(index);
  });
  const pool = allowed.filter((index) => !used.has(index));
  return { kind, column: pool[0] ?? allowed[0] ?? -1 };
}

function readLayout(): number {
  try {
    const saved = Number(localStorage.getItem(LAYOUT_KEY));
    if (Number.isFinite(saved) && saved >= 1 && saved <= 4) return saved;
  } catch {
    // localStorage can be unavailable (private mode, file://) — use the default.
  }
  return DEFAULT_LAYOUT;
}

/**
 * The Chart view: a toolbar (add chart, columns per row, PNG export size) and
 * a responsive grid of independent ChartCards. Every card keeps its own type,
 * columns, settings and canvas; the panel only owns layout and forwards the
 * facet/histogram payloads from the worker to each card.
 */
export class ChartsPanel {
  private readonly grid: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly layoutSelect: HTMLSelectElement;
  private readonly sizeSelect: HTMLSelectElement;
  private cards: ChartCard[] = [];
  private columns: ColumnMeta[] = [];
  private facets: Record<number, number[]> = {};
  private histograms: Record<number, number[]> = {};
  private rowCount = 0;
  private exportSizeIndex = DEFAULT_EXPORT_SIZE;
  private layoutCols = readLayout();

  constructor(
    private readonly root: HTMLElement,
    private readonly options: ChartsPanelOptions,
  ) {
    const toolbar = el("div", { class: "charts-toolbar" });
    const add = el(
      "button",
      { class: "primary small", type: "button", title: "Add another chart of the current result set" },
      ["+ Add chart"],
    );
    add.addEventListener("click", () => this.addCard());

    this.layoutSelect = el("select", {
      class: "chart-size",
      "aria-label": "Charts per row",
      title: "How many charts fit side by side",
    }) as HTMLSelectElement;
    [1, 2, 3, 4].forEach((count) => {
      this.layoutSelect.append(
        el("option", { value: String(count) }, [`${count} per row`]) as HTMLOptionElement,
      );
    });
    this.layoutSelect.value = String(this.layoutCols);
    this.layoutSelect.addEventListener("change", () => {
      this.layoutCols = Number(this.layoutSelect.value);
      this.syncLayout();
    });

    this.sizeSelect = el("select", {
      class: "chart-size",
      "aria-label": "PNG export size",
      title: "Pixel size used by every chart's PNG button",
    }) as HTMLSelectElement;
    EXPORT_SIZES.forEach((size, index) => {
      this.sizeSelect.append(
        el("option", { value: String(index) }, [size.label]) as HTMLOptionElement,
      );
    });
    this.sizeSelect.value = String(this.exportSizeIndex);
    this.sizeSelect.addEventListener("change", () => {
      this.exportSizeIndex = Number(this.sizeSelect.value);
    });

    toolbar.append(
      add,
      this.layoutSelect,
      el("span", { class: "grow" }),
      el("span", { class: "chart-toolbar-label" }, ["PNG size"]),
      this.sizeSelect,
    );

    this.grid = el("div", { class: "charts-grid" });
    this.empty = el("div", { class: "charts-empty" }, [
      "No charts yet — use “+ Add chart” to plot the current result set.",
    ]);
    this.root.append(toolbar, this.grid, this.empty);
    this.syncLayout();
    this.syncEmpty();
  }

  addCard(preset?: Partial<ChartCardConfig>): ChartCard {
    const used = new Set<number>();
    for (const existing of this.cards) {
      for (const index of existing.usedColumns()) used.add(index);
    }
    const section = el("section", { class: "chart-card" });
    const card = new ChartCard(
      section,
      {
        datasetName: this.options.datasetName,
        requestBins: this.options.requestBins,
        requestSeries: this.options.requestSeries,
        onRemove: (target) => this.removeCard(target),
        onDuplicate: (target) => this.duplicateCard(target),
        onExport: (target) => {
          const size = EXPORT_SIZES[this.exportSizeIndex] ?? EXPORT_SIZES[DEFAULT_EXPORT_SIZE];
          target.exportPng(size.width, size.height);
        },
      },
      preset ?? presetFor(this.columns, used),
    );
    this.cards.push(card);
    this.grid.append(section);
    card.setColumns(this.columns);
    card.setFiltered(this.facets, this.histograms);
    card.setRowCount(this.rowCount);
    this.syncEmpty();
    return card;
  }

  removeCard(card: ChartCard): void {
    const index = this.cards.indexOf(card);
    if (index < 0) return;
    this.cards.splice(index, 1);
    card.dispose();
    card.root.remove();
    this.syncEmpty();
  }

  duplicateCard(card: ChartCard): void {
    this.addCard(card.getConfig());
  }

  setColumns(columns: ColumnMeta[]): void {
    this.columns = columns;
    if (columns.length > 0 && this.cards.length === 0) {
      this.addCard();
      return;
    }
    for (const card of this.cards) card.setColumns(columns);
  }

  setFiltered(
    facets: Record<number, number[]>,
    histograms: Record<number, number[]>,
  ): void {
    this.facets = facets;
    this.histograms = histograms;
    for (const card of this.cards) card.setFiltered(facets, histograms);
  }

  setRowCount(count: number): void {
    this.rowCount = count;
    for (const card of this.cards) card.setRowCount(count);
  }

  refresh(): void {
    for (const card of this.cards) card.refresh();
  }

  dispose(): void {
    for (const card of this.cards) card.dispose();
    this.cards = [];
  }

  private syncLayout(): void {
    this.grid.dataset.cols = String(this.layoutCols);
    try {
      localStorage.setItem(LAYOUT_KEY, String(this.layoutCols));
    } catch {
      // Persisting the layout is best-effort.
    }
  }

  private syncEmpty(): void {
    const isEmpty = this.cards.length === 0;
    this.empty.classList.toggle("hidden", !isEmpty);
    this.grid.classList.toggle("hidden", isEmpty);
  }
}
