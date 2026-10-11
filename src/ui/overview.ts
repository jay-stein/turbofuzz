import type { DatasetStats } from "../data/stats.js";
import { autoCombineParts, type CombineDateOp } from "../data/date-combine.js";
import type {
  ColumnMeta,
  LoadedMessage,
  MissingnessMessage,
  TransformedMessage,
} from "../worker/protocol.js";
import { isCategoryType, isNumericType } from "./chart-utils.js";
import { clear, el } from "./dom.js";
import { openMenu, type MenuItem } from "./menu.js";
import { MissingnessChart } from "./missingness.js";
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
  onDropColumn(column: number): void;
  onOpenStats(): void;
  /** Applies the detected Year/Month/Day combine in one click. */
  onCombineDate?(op: CombineDateOp): void;
  /** Blanks placeholder tokens ("NA", "TBD") that are read as missing. */
  onBlankTokens?(tokens: string[]): void;
}

export type NextStepAction =
  | { kind: "cleanNulls" }
  | { kind: "dedupe" }
  | { kind: "tableFixes" }
  | { kind: "merge"; column: number }
  | { kind: "review"; column: number }
  | { kind: "chart"; column: number | null }
  | { kind: "combineDate"; op: CombineDateOp }
  | { kind: "blankTokens"; tokens: string[] };

export interface NextStep {
  id:
    | "empties"
    | "nullTokens"
    | "duplicates"
    | "fixes"
    | "nearDuplicates"
    | "constant"
    | "combineDate"
    | "chart";
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

/** Facts the UI already knows from the load path (not part of the worker message). */
export interface DatasetSourceInfo {
  /** Preformatted input size, e.g. "529 KB". */
  sizeLabel: string | null;
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

/** Short format label from the file extension, for the dataset badges. */
export function formatLabelFor(name: string): string | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const extension = dot === -1 ? "" : lower.slice(dot);
  switch (extension) {
    case ".csv":
      return "CSV";
    case ".tsv":
      return "TSV";
    case ".psv":
      return "PSV";
    case ".txt":
    case ".dat":
      return "Text";
    case ".json":
    case ".jsonl":
    case ".ndjson":
      return "JSON";
    case ".parquet":
      return "Parquet";
    case ".xlsx":
      return "Excel";
    case ".xls":
      return "Excel 97–2003";
    default:
      return null;
  }
}

/** “4 numeric · 3 date · 5 text” — the column type mix at a glance. */
export function typeMix(columns: readonly ColumnMeta[]): string {
  const counts = new Map<string, number>();
  for (const column of columns) {
    const key =
      column.type === "integer" || column.type === "number"
        ? "numeric"
        : column.type === "string"
          ? "text"
          : column.type === "identifier"
            ? "ID"
            : column.type;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order = ["numeric", "date", "category", "text", "boolean", "ID"];
  return order
    .filter((key) => (counts.get(key) ?? 0) > 0)
    .map((key) => `${(counts.get(key) ?? 0).toLocaleString()} ${key}`)
    .join(" · ");
}

/** Short delimiter name for badges and tooltips. */
export function delimiterLabel(delimiter: string | null | undefined): string | null {
  switch (delimiter) {
    case ",":
      return "comma";
    case "\t":
      return "tab";
    case ";":
      return "semicolon";
    case "|":
      return "pipe";
    default:
      return null;
  }
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
    // Placeholder tokens ("NA", "TBD") get a one-click convert action; plain
    // empty cells keep the review-first rule.
    const placeholderTotals = new Map<string, number>();
    for (const column of withNulls) {
      for (const token of column.nullTokens) {
        if (token.label !== "" && token.count > 0) {
          placeholderTotals.set(
            token.label,
            (placeholderTotals.get(token.label) ?? 0) + token.count,
          );
        }
      }
    }
    const ranked = [...placeholderTotals.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length > 0) {
      const cells = ranked.reduce((sum, [, count]) => sum + count, 0);
      const examples = ranked
        .slice(0, 2)
        .map(([label]) => `“${label}”`)
        .join(", ");
      rules.push({
        id: "nullTokens",
        text: `${cells.toLocaleString()} cells hold placeholder text like ${examples}`,
        button: "Convert to nulls",
        score: stats.rowsWithNulls,
        action: { kind: "blankTokens", tokens: ranked.map(([label]) => label) },
      });
    } else {
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

  // Split date parts are a shape problem, so the fix ranks with the row count.
  const combine = autoCombineParts(columns);
  if (combine !== null) {
    const names = combine.parts
      .map((part) => columns[part.column]?.name)
      .filter((name): name is string => name !== undefined);
    rules.push({
      id: "combineDate",
      text: `Combine ${names.join(", ")} into a ${combine.outputName}`,
      button: "Combine",
      score: rowCount,
      action: {
        kind: "combineDate",
        op: {
          kind: "combineDate",
          parts: combine.parts,
          output: combine.output,
          outputName: combine.outputName,
          order: "auto",
          timeZone: "naive",
          dropParts: false,
        },
      },
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
  private columns: readonly ColumnMeta[] = [];
  private rowCount = 0;
  private missingnessChart: MissingnessChart | null = null;
  private missingnessData: MissingnessMessage | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: OverviewCallbacks,
  ) {
    this.root.classList.add("overview");
  }

  render(loaded: LoadedMessage | TransformedMessage, source?: DatasetSourceInfo): void {
    this.columns = loaded.columns;
    this.rowCount = loaded.rowCount;
    this.missingnessChart?.dispose();
    this.missingnessChart = null;
    clear(this.root);

    this.root.append(
      this.buildDatasetLine(loaded, source),
      this.buildHealthTiles(loaded.columns, loaded.stats),
      this.buildMissingness(),
      this.buildNextSteps(loaded),
      this.buildColumns(loaded),
      this.buildActions(),
    );
  }

  /** Fills in the Missing values map once the worker payload arrives. */
  setMissingness(message: MissingnessMessage): void {
    this.missingnessData = message;
    this.missingnessChart?.setData(message);
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

  /** Refreshes column names in place after a header rename. */
  updateNames(names: readonly string[]): void {
    const cards = this.root.querySelectorAll<HTMLElement>(".overview-column-grid .stat-card");
    cards.forEach((card, index) => {
      const name = names[index];
      if (name === undefined) return;
      const nameEl = card.querySelector<HTMLElement>(".stat-name");
      if (nameEl !== null) {
        nameEl.textContent = name;
        nameEl.title = name;
      }
    });
  }

  /** Refreshes the health tiles after a worker reported new dataset stats. */
  updateHealth(columns: readonly ColumnMeta[], stats: DatasetStats): void {
    const tiles = this.root.querySelector<HTMLElement>(".health-tiles");
    if (tiles === null) return;
    this.columns = columns;
    tiles.replaceWith(this.buildHealthTiles(columns, stats));
  }

  private buildDatasetLine(
    loaded: LoadedMessage | TransformedMessage,
    source?: DatasetSourceInfo,
  ): HTMLElement {
    const line = el("div", { class: "overview-dataset" });
    const facts = [
      loaded.name,
      `${loaded.rowCount.toLocaleString()} rows × ${loaded.columnCount.toLocaleString()} columns`,
    ];
    if (source !== undefined && source.sizeLabel !== null) facts.push(source.sizeLabel);
    facts.push(`${Math.round(loaded.ingestMs)} ms`);
    line.append(el("span", { class: "overview-facts" }, [facts.join(" · ")]));

    const format = formatLabelFor(loaded.name);
    if (format !== null) {
      line.append(el("span", { class: "overview-badge" }, [format]));
    }
    const delimiter = delimiterLabel(loaded.delimiter);
    if (delimiter !== null) {
      line.append(el("span", { class: "overview-badge" }, [delimiter]));
    }
    if (loaded.encoding === "utf-8") {
      line.append(el("span", { class: "overview-badge" }, ["UTF-8"]));
    } else if (loaded.encoding === "windows-1252") {
      line.append(el("span", { class: "overview-badge" }, ["windows-1252"]));
    }
    const types = typeMix(loaded.columns);
    if (types !== "") {
      line.append(el("div", { class: "overview-types" }, [types]));
    }
    return line;
  }

  /** Zoomed-out missingness map; populated by `setMissingness` after the fetch. */
  private buildMissingness(): HTMLElement {
    const section = el("section", { class: "overview-section" });
    this.missingnessChart = new MissingnessChart(section);
    if (this.missingnessData !== null) this.missingnessChart.setData(this.missingnessData);
    return section;
  }

  private buildHealthTiles(columns: readonly ColumnMeta[], stats: DatasetStats): HTMLElement {
    const tiles = healthTiles(columns, stats);
    if (tiles.every((tile) => !tile.warn)) {
      return el("div", { class: "overview-clear" }, [
        "✓ No duplicates, no empty cells, no outliers",
      ]);
    }
    const wrap = el("div", { class: "health-tiles" });
    for (const tile of tiles) {
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
      case "combineDate":
        this.callbacks.onCombineDate?.(step.action.op);
        break;
      case "blankTokens":
        this.callbacks.onBlankTokens?.(step.action.tokens);
        break;
    }
  }

  /** Small per-column menu: Filter · Chart · Clean (plus Drop for empty columns). */
  private openColumnMenu(column: number, anchor: HTMLElement): void {
    const meta = this.columns[column];
    const items: MenuItem[] = [
      { label: "Filter", action: () => this.callbacks.onFilterColumn(column) },
      { label: "Chart", action: () => this.callbacks.onOpenChart(column) },
      { label: "Clean", action: () => this.callbacks.onCleanColumn(column) },
    ];
    if (meta !== undefined && this.rowCount > 0 && meta.stats.nulls === this.rowCount) {
      items.push({
        label: "Drop empty column",
        title: "Remove this column — it is empty in every row, tracked as a transform step",
        action: () => this.callbacks.onDropColumn(column),
      });
    }
    openMenu(anchor, items);
  }
}
