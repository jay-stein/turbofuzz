import type { DatasetStats } from "../data/stats.js";
import type { ColumnMeta, LoadedMessage, TransformedMessage } from "../worker/protocol.js";
import { isCategoryType, isNumericType } from "./chart-utils.js";
import { clear, el } from "./dom.js";
import { buildColumnCard } from "./summary-band.js";

export interface OverviewCallbacks {
  onOpenTable(): void;
  onOpenChart(column: number | null): void;
  onFilterColumn(column: number): void;
  onCleanColumn(column: number): void;
  onOpenCleanNulls(): void;
  onDedupe(anchor: HTMLElement): void;
  onOpenMerge(column: number): void;
  onReviewColumn(column: number): void;
  onOpenStats(): void;
}

export type NextStepAction =
  | { kind: "cleanNulls" }
  | { kind: "dedupe" }
  | { kind: "tableFixes" }
  | { kind: "merge"; column: number }
  | { kind: "review"; column: number }
  | { kind: "chart"; column: number | null };

export interface NextStep {
  id: "empties" | "duplicates" | "fixes" | "nearDuplicates" | "constant" | "chart";
  text: string;
  button: string;
  /** Higher first. The chart slot is appended after ranking. */
  score: number;
  action: NextStepAction;
}

export interface HealthTile {
  id: "complete" | "duplicates" | "empties" | "outliers";
  label: string;
  value: string;
  warn: boolean;
}

const VIEW_DEFAULT_KEY = "turbofuzz.view.default";

export function readDefaultView(): "overview" | "table" {
  try {
    return localStorage.getItem(VIEW_DEFAULT_KEY) === "table" ? "table" : "overview";
  } catch {
    return "overview";
  }
}

function writeDefaultView(view: "overview" | "table"): void {
  try {
    if (view === "table") localStorage.setItem(VIEW_DEFAULT_KEY, "table");
    else localStorage.removeItem(VIEW_DEFAULT_KEY);
  } catch {
    // Persisting the preference is best-effort.
  }
}

function plural(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** Four tiles at most: complete %, duplicates, columns with empties, outliers. */
export function healthTiles(columns: readonly ColumnMeta[], stats: DatasetStats): HealthTile[] {
  const columnsWithNulls = columns.filter((column) => column.stats.nulls > 0).length;
  const complete =
    stats.totalCells > 0 ? 1 - stats.totalNullCells / stats.totalCells : 1;
  const completePct = complete >= 1 ? "100%" : `${(complete * 100).toFixed(1)}%`;
  return [
    {
      id: "complete",
      label: "Complete cells",
      value: completePct,
      warn: complete < 1,
    },
    {
      id: "duplicates",
      label: "Duplicate rows",
      value: stats.duplicateRows.toLocaleString(),
      warn: stats.duplicateRows > 0,
    },
    {
      id: "empties",
      label: "Columns with empty cells",
      value: `${columnsWithNulls.toLocaleString()} of ${columns.length.toLocaleString()}`,
      warn: columnsWithNulls > 0,
    },
    {
      id: "outliers",
      label: "Outlier rows",
      value: stats.valueAnomalyRows.toLocaleString(),
      warn: stats.valueAnomalyRows > 0,
    },
  ];
}

/**
 * Ranked next-step cards. Rules fire from column metadata and dataset stats;
 * the list always ends with one chart slot. When more than three rules fire,
 * only the top two are kept so the section stays short.
 */
export function pickNextSteps(
  columns: readonly ColumnMeta[],
  stats: DatasetStats,
  rowCount: number,
): NextStep[] {
  const rules: NextStep[] = [];

  const withNulls = columns.filter((column) => column.stats.nulls > 0);
  if (withNulls.length > 0) {
    const count = withNulls.length;
    rules.push({
      id: "empties",
      text: `${count} ${plural(count, "column")} ${
        count === 1 ? "has" : "have"
      } empty cells`,
      button: "Open Clean",
      score: stats.rowsWithNulls,
      action: { kind: "cleanNulls" },
    });
  }

  if (stats.duplicateRows > 0) {
    rules.push({
      id: "duplicates",
      text: `${stats.duplicateRows.toLocaleString()} duplicate rows`,
      button: "Review duplicates",
      score: stats.duplicateRows,
      action: { kind: "dedupe" },
    });
  }

  const withSuggestions = columns.filter((column) => column.suggestions.length > 0);
  if (withSuggestions.length > 0) {
    const count = withSuggestions.length;
    rules.push({
      id: "fixes",
      text: `${count} ${plural(count, "column")} ${
        count === 1 ? "has" : "have"
      } one-click fixes`,
      button: "Open Table",
      score: withSuggestions.reduce(
        (sum, column) => sum + Math.max(1, column.stats.nulls),
        0,
      ),
      action: { kind: "tableFixes" },
    });
  }

  const withSimilar = columns
    .map((column, index) => ({ column, index }))
    .filter((entry) => entry.column.similarGroups > 0);
  if (withSimilar.length > 0) {
    const count = withSimilar.length;
    rules.push({
      id: "nearDuplicates",
      text: `${count} ${plural(count, "column")} ${
        count === 1 ? "has" : "have"
      } near-identical values`,
      button: "Merge values",
      score: withSimilar.reduce((sum, entry) => sum + entry.column.similarGroups, 0),
      action: { kind: "merge", column: withSimilar[0].index },
    });
  }

  const constants = columns
    .map((column, index) => ({ column, index }))
    .filter((entry) => rowCount > 0 && entry.column.stats.distinct === 1);
  if (constants.length > 0) {
    const count = constants.length;
    rules.push({
      id: "constant",
      text: `${count} ${plural(count, "column")} ${
        count === 1 ? "holds" : "hold"
      } a single value`,
      button: "Review",
      score: count,
      action: { kind: "review", column: constants[0].index },
    });
  }

  rules.sort((a, b) => b.score - a.score);
  const shown = rules.length > 3 ? rules.slice(0, 2) : rules.slice(0, 3);

  return [...shown, chartStep(columns)];
}

/** The always-present chart slot, preferring dates, then categories, then numerics. */
export function chartStep(columns: readonly ColumnMeta[]): NextStep {
  const date = columns.findIndex((column) => column.type === "date");
  const category = columns.findIndex(
    (column) => isCategoryType(column.type) && column.stats.distinct >= 2,
  );
  const numeric = columns.findIndex((column) => isNumericType(column.type));
  if (date >= 0) {
    return {
      id: "chart",
      text: `Chart ${columns[date].name} over time`,
      button: "Open Chart",
      score: -1,
      action: { kind: "chart", column: date },
    };
  }
  if (category >= 0) {
    return {
      id: "chart",
      text: `Chart rows by ${columns[category].name}`,
      button: "Open Chart",
      score: -1,
      action: { kind: "chart", column: category },
    };
  }
  if (numeric >= 0) {
    return {
      id: "chart",
      text: `Distribution of ${columns[numeric].name}`,
      button: "Open Chart",
      score: -1,
      action: { kind: "chart", column: numeric },
    };
  }
  return {
    id: "chart",
    text: "Chart the data",
    button: "Open Chart",
    score: -1,
    action: { kind: "chart", column: null },
  };
}

/**
 * Landing view after a load: what the file is, its health, the top next steps
 * and every column at a glance. Everything is derived from the LoadedMessage,
 * so the Overview needs no worker round trip.
 */
export class Overview {
  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: OverviewCallbacks,
  ) {
    this.root.classList.add("overview");
  }

  render(loaded: LoadedMessage | TransformedMessage): void {
    clear(this.root);

    this.root.append(
      this.buildDatasetLine(loaded),
      this.buildHealthTiles(loaded),
      this.buildNextSteps(loaded),
      this.buildColumns(loaded),
      this.buildActions(),
    );
  }

  /** Refreshes one column card in place after its data changed. */
  updateColumn(index: number, meta: ColumnMeta): void {
    const existing = this.root.querySelector<HTMLElement>(
      `.overview-column-grid .stat-card[data-column="${index}"]`,
    );
    if (existing === null) return;
    let card: HTMLElement;
    card = buildColumnCard(meta, index, () => this.openColumnMenu(index, card));
    existing.replaceWith(card);
  }

  private buildDatasetLine(loaded: LoadedMessage | TransformedMessage): HTMLElement {
    const line = el("div", { class: "overview-dataset" });
    const facts = el("span", { class: "overview-facts" }, [
      `${loaded.name} · ${loaded.rowCount.toLocaleString()} rows × ${loaded.columnCount.toLocaleString()} columns · ${Math.round(loaded.ingestMs)} ms`,
    ]);
    line.append(facts);
    if (loaded.encoding === "windows-1252") {
      line.append(el("span", { class: "overview-badge" }, ["windows-1252"]));
    }
    return line;
  }

  private buildHealthTiles(loaded: LoadedMessage | TransformedMessage): HTMLElement {
    const wrap = el("div", { class: "health-tiles" });
    for (const tile of healthTiles(loaded.columns, loaded.stats)) {
      const node = el("div", {
        class: `health-tile${tile.warn ? " warn" : ""}`,
        "data-kind": tile.id,
      });
      node.append(
        el("span", { class: "health-value" }, [tile.value]),
        el("span", { class: "health-label" }, [tile.label]),
      );
      wrap.append(node);
    }
    return wrap;
  }

  private buildNextSteps(loaded: LoadedMessage | TransformedMessage): HTMLElement {
    const section = el("section", { class: "overview-section" });
    section.append(el("h2", { class: "overview-heading" }, ["Next steps"]));
    const list = el("div", { class: "next-step-list" });
    for (const step of pickNextSteps(loaded.columns, loaded.stats, loaded.rowCount)) {
      const card = el("div", { class: "next-step-card" });
      card.append(el("span", { class: "next-step-text" }, [step.text]));
      const button = el(
        "button",
        { class: "ghost small", type: "button" },
        [step.button],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => this.runStep(step, button));
      card.append(button);
      list.append(card);
    }
    section.append(list);
    return section;
  }

  private buildColumns(loaded: LoadedMessage | TransformedMessage): HTMLElement {
    const section = el("section", { class: "overview-section" });
    section.append(el("h2", { class: "overview-heading" }, ["All columns"]));
    const grid = el("div", { class: "overview-column-grid" });
    loaded.columns.forEach((meta, index) => {
      let card: HTMLElement;
      card = buildColumnCard(meta, index, () => this.openColumnMenu(index, card));
      grid.append(card);
    });
    section.append(grid);
    return section;
  }

  private buildActions(): HTMLElement {
    const row = el("div", { class: "overview-actions" });
    const explore = el(
      "button",
      { class: "primary", type: "button" },
      ["Explore the table →"],
    ) as HTMLButtonElement;
    explore.addEventListener("click", () => this.callbacks.onOpenTable());

    const remember = el("label", { class: "control check" });
    const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
    checkbox.checked = readDefaultView() === "table";
    checkbox.addEventListener("change", () =>
      writeDefaultView(checkbox.checked ? "table" : "overview"),
    );
    remember.append(checkbox, "Open in Table next time");

    const stats = el(
      "button",
      { class: "link stats-link", type: "button" },
      ["Stats Report"],
    ) as HTMLButtonElement;
    stats.addEventListener("click", () => this.callbacks.onOpenStats());

    row.append(explore, remember, el("span", { class: "grow" }), stats);
    return row;
  }

  private runStep(step: NextStep, anchor: HTMLElement): void {
    switch (step.action.kind) {
      case "cleanNulls":
        this.callbacks.onOpenCleanNulls();
        break;
      case "dedupe":
        this.callbacks.onDedupe(anchor);
        break;
      case "tableFixes":
        this.callbacks.onOpenTable();
        break;
      case "merge":
        this.callbacks.onOpenMerge(step.action.column);
        break;
      case "review":
        this.callbacks.onReviewColumn(step.action.column);
        break;
      case "chart":
        this.callbacks.onOpenChart(step.action.column);
        break;
    }
  }

  /** Small per-column menu: Filter · Chart · Clean. */
  private openColumnMenu(column: number, anchor: HTMLElement): void {
    const menu = el("div", { class: "context-menu", role: "menu" });
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      menu.remove();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!menu.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };

    const addItem = (label: string, action: () => void): void => {
      const item = el(
        "button",
        { class: "context-item", type: "button", role: "menuitem" },
        [label],
      ) as HTMLButtonElement;
      item.addEventListener("click", () => {
        close();
        action();
      });
      menu.append(item);
    };
    addItem("Filter", () => this.callbacks.onFilterColumn(column));
    addItem("Chart", () => this.callbacks.onOpenChart(column));
    addItem("Clean", () => this.callbacks.onCleanColumn(column));

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  }
}
