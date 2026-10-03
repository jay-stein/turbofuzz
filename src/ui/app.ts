import { DELIMITER_LABELS, type Delimiter } from "../parse/delimiter.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { ColumnType } from "../types.js";
import type { ColumnMeta, LoadedMessage, ProgressMessage } from "../worker/protocol.js";
import { clear, el } from "./dom.js";
import { FilterPanel } from "./filters.js";
import { sampleCsv } from "./sample.js";
import { openStatsModal } from "./stats.js";
import { ResultTable, type HighlightRule } from "./table.js";
import { SearchWorkerClient } from "./worker-client.js";

const LARGE_PASTE_ROWS = 300_000;

export class App {
  private readonly client = new SearchWorkerClient();
  private metas: ColumnMeta[] = [];
  private rowCount = 0;
  private datasetName = "";
  private loading = false;
  private filters = new Map<number, ColumnFilter>();
  private filterPanel: FilterPanel | null = null;
  private table: ResultTable | null = null;

  private pasteView!: HTMLElement;
  private workspace!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private delimiterSelect!: HTMLSelectElement;
  private headersCheckbox!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private metaEl!: HTMLElement;
  private countEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private filterHost!: HTMLElement;
  private tableHost!: HTMLElement;
  private statsButton!: HTMLButtonElement;

  constructor(private readonly root: HTMLElement) {
    this.buildShell();
    this.bindEvents();
    this.client.onProgress((progress) => this.handleProgress(progress));
  }

  private buildShell(): void {
    clear(this.root);

    const topbar = el("header", { class: "topbar" });
    topbar.append(el("div", { class: "brand" }, ["TurboFuzz"]));
    this.metaEl = el("div", { class: "meta" });
    topbar.append(this.metaEl);

    this.statsButton = el("button", { class: "ghost", type: "button" }, ["Stats"]) as HTMLButtonElement;
    this.statsButton.classList.add("hidden");
    this.statsButton.addEventListener("click", () => this.openStats());
    topbar.append(this.statsButton);

    const newButton = el("button", { class: "ghost", type: "button" }, ["New data"]);
    newButton.addEventListener("click", () => this.showPaste());
    topbar.append(newButton);

    this.pasteView = this.buildPasteView();
    this.workspace = this.buildWorkspace();
    this.root.append(topbar, this.pasteView, this.workspace);
  }

  private buildPasteView(): HTMLElement {
    const view = el("div", { class: "paste-view" });
    const card = el("div", { class: "paste-card" });

    card.append(el("h1", {}, ["Search tabular data, fast"]));
    card.append(
      el("p", { class: "sub" }, [
        "Paste rows from Excel, Sheets or any delimited text. Everything runs in your browser — nothing is uploaded.",
      ]),
    );

    this.textarea = el("textarea", {
      placeholder: "Paste your data here (Ctrl+Enter to load)…",
      spellcheck: "false",
    }) as HTMLTextAreaElement;
    card.append(this.textarea);

    const controls = el("div", { class: "paste-controls" });

    const delimiterLabel = el("label", { class: "control" });
    delimiterLabel.append("Delimiter");
    this.delimiterSelect = el("select") as HTMLSelectElement;
    for (const key of ["auto", ",", "\t", ";", "|"]) {
      this.delimiterSelect.append(
        el("option", { value: key }, [DELIMITER_LABELS[key]]) as HTMLOptionElement,
      );
    }
    delimiterLabel.append(this.delimiterSelect);

    const headerLabel = el("label", { class: "control check" });
    this.headersCheckbox = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.headersCheckbox.checked = true;
    headerLabel.append(this.headersCheckbox, "First row is header");
    controls.append(delimiterLabel, headerLabel, el("span", { class: "grow" }));

    const fileInput = el("input", {
      type: "file",
      accept: ".csv,.tsv,.txt",
      class: "hidden",
    }) as HTMLInputElement;
    const fileButton = el("button", { class: "ghost", type: "button" }, ["Upload file"]);
    fileButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file === undefined) return;
      void file
        .arrayBuffer()
        .then((buffer) => this.load({ buffer, name: file.name, source: "file" }));
    });

    const loadButton = el("button", { class: "primary", type: "button" }, ["Load data"]);
    loadButton.addEventListener("click", () => this.loadFromTextarea());

    controls.append(fileButton, fileInput, loadButton);
    card.append(controls);

    this.statusEl = el("div", { class: "status" });
    card.append(this.statusEl);

    const sampleButton = el("button", { class: "link", type: "button" }, ["Try sample data"]);
    sampleButton.addEventListener("click", () => {
      this.textarea.value = sampleCsv();
      this.loadFromTextarea();
    });
    card.append(sampleButton);

    view.append(card);
    return view;
  }

  private buildWorkspace(): HTMLElement {
    const workspace = el("div", { class: "workspace hidden" });

    const sidebar = el("aside", { class: "sidebar" });
    const sidebarHead = el("div", { class: "sidebar-head" });
    sidebarHead.append(el("span", { class: "sidebar-title" }, ["Filters"]));
    const clearAll = el("button", { class: "ghost small", type: "button" }, ["Clear all"]);
    clearAll.addEventListener("click", () => this.clearFilters());
    sidebarHead.append(clearAll);
    this.filterHost = el("div", { class: "filter-host" });
    sidebar.append(sidebarHead, this.filterHost);

    const results = el("main", { class: "results" });
    const resultsBar = el("div", { class: "results-bar" });
    this.countEl = el("span", { class: "count" });
    this.bannerEl = el("div", { class: "banner hidden" });
    resultsBar.append(this.countEl, this.bannerEl);
    this.tableHost = el("div", { class: "table-host" });
    results.append(resultsBar, this.tableHost);

    workspace.append(sidebar, results);
    return workspace;
  }

  private bindEvents(): void {
    this.textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.loadFromTextarea();
      }
    });
  }

  private loadFromTextarea(): void {
    const text = this.textarea.value;
    if (text.trim() === "") {
      this.statusEl.textContent = "Paste some data first.";
      this.statusEl.classList.add("error");
      return;
    }
    void this.load({ text, name: "Pasted data", source: "paste" });
  }

  private async load(options: {
    text?: string;
    buffer?: ArrayBuffer;
    name: string;
    source: "paste" | "file";
  }): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.statusEl.textContent = "Parsing…";
    this.statusEl.classList.remove("error");

    try {
      const loaded = await this.client.load({
        name: options.name,
        delimiter: this.delimiterSelect.value as Delimiter | "auto",
        hasHeaders: this.headersCheckbox.checked,
        text: options.text,
        buffer: options.buffer,
      });
      this.statusEl.textContent = "";
      this.openWorkspace(loaded);
    } catch (error) {
      this.statusEl.textContent =
        error instanceof Error ? error.message : "Failed to parse data.";
      this.statusEl.classList.add("error");
    } finally {
      this.loading = false;
    }
  }

  private handleProgress(progress: ProgressMessage): void {
    if (progress.phase === "parse") {
      this.statusEl.textContent = "Parsing…";
    } else if (progress.phase === "build") {
      this.statusEl.textContent = progress.detail ?? "Building…";
    } else if (progress.phase === "index" && progress.column !== undefined) {
      this.filterPanel?.setStatus(progress.column, progress.active === true ? "Building index…" : "");
    } else if (progress.phase === "sort") {
      if (progress.active === true) this.countEl.textContent = "Sorting…";
    }
  }

  private openWorkspace(loaded: LoadedMessage): void {
    this.metas = loaded.columns;
    this.rowCount = loaded.rowCount;
    this.datasetName = loaded.name;
    this.filters.clear();

    this.pasteView.classList.add("hidden");
    this.workspace.classList.remove("hidden");
    this.statsButton.classList.remove("hidden");

    const emptyPct =
      loaded.stats.totalCells > 0
        ? (loaded.stats.totalNullCells / loaded.stats.totalCells) * 100
        : 0;
    const duplicateText =
      loaded.stats.duplicateRows > 0
        ? ` · ${loaded.stats.duplicateRows.toLocaleString()} duplicate rows`
        : "";
    this.metaEl.textContent =
      `${loaded.rowCount.toLocaleString()} rows × ${loaded.columnCount} columns` +
      `${duplicateText} · ${emptyPct.toFixed(1)}% empty · ${Math.round(loaded.ingestMs)} ms`;

    this.table?.dispose();
    clear(this.tableHost);
    this.table = new ResultTable(this.tableHost, {
      onSort: (column, dir) => this.changeSort(column, dir),
      onRequestRows: (start, end, done) => {
        void this.client
          .getRows(start, end)
          .then((message) => done(message.start, message.rows))
          .catch(() => done(start, []));
      },
    });
    this.table.setColumns(loaded.headers);
    this.table.setSort(-1, 1);
    this.table.setCount(loaded.rowCount);

    clear(this.filterHost);
    this.filterPanel = new FilterPanel(this.filterHost, this.metas, this.filters, {
      onFilter: (column, filter) => this.changeFilter(column, filter),
      onTypeChange: (column, type) => this.changeType(column, type),
    });

    this.updateCount(loaded.rowCount, 0);
    this.updateGuardrail(loaded, loaded.source === "file");
  }

  private changeFilter(column: number, filter: ColumnFilter | null): void {
    if (filter === null) this.filters.delete(column);
    else this.filters.set(column, filter);

    this.table?.setHighlights(this.highlightRules());

    void this.client
      .setFilter(column, filter)
      .then((message) => {
        this.updateCount(message.count, message.queryMs);
        this.filterPanel?.applyResults(message.facets, message.histograms);
        this.table?.setCount(message.count);
        this.table?.invalidateRows();
      })
      .catch((error: unknown) => this.showError(error));
  }

  private changeType(column: number, type: ColumnType): void {
    void this.client
      .setType(column, type)
      .then((message) => {
        this.metas[column] = message.meta;
        this.filters.delete(column);
        this.filterPanel?.updateMeta(column, message.meta);
        this.filterPanel?.applyResults(message.facets, message.histograms);
        this.updateCount(message.count, message.queryMs);
        this.table?.setCount(message.count);
        this.table?.invalidateRows();
      })
      .catch((error: unknown) => this.showError(error));
  }

  private changeSort(column: number, dir: 1 | -1 | 0): void {
    const sortColumn = dir === 0 ? -1 : column;
    const sortDir: 1 | -1 = dir === 0 ? 1 : dir;
    void this.client
      .sort(sortColumn, sortDir)
      .then((message) => {
        this.table?.setSort(message.column, message.dir);
        this.updateCount(message.count, 0);
        this.table?.invalidateRows();
      })
      .catch((error: unknown) => this.showError(error));
  }

  private clearFilters(): void {
    if (this.filters.size === 0) return;
    this.filters.clear();
    this.filterPanel?.rebuild();
    this.table?.setHighlights([]);
    void this.client
      .clearFilters()
      .then((message) => {
        this.updateCount(message.count, message.queryMs);
        this.filterPanel?.applyResults(message.facets, message.histograms);
        this.table?.setCount(message.count);
        this.table?.invalidateRows();
      })
      .catch((error: unknown) => this.showError(error));
  }

  private openStats(): void {
    if (this.datasetName === "" || this.loading) return;
    const modal = openStatsModal(this.datasetName);
    void this.client
      .getStats()
      .then((message) => modal.fill(message))
      .catch((error: unknown) => this.showError(error));
  }

  private highlightRules(): HighlightRule[] {
    const rules: HighlightRule[] = [];
    for (const [column, filter] of this.filters) {
      if (
        filter.kind === "text" &&
        filter.query.trim() !== "" &&
        (filter.mode === "contains" || filter.mode === "exact")
      ) {
        rules.push({ column, query: filter.query, mode: filter.mode });
      }
    }
    return rules;
  }

  private updateCount(count: number, queryMs: number): void {
    const timeText = queryMs < 1 ? "<1" : String(Math.round(queryMs));
    this.countEl.textContent = `${count.toLocaleString()} of ${this.rowCount.toLocaleString()} rows · ${timeText} ms`;
    const total = this.metas.length;
    this.countEl.title = `${count.toLocaleString()} matching rows out of ${this.rowCount.toLocaleString()} (${total} columns)`;
  }

  private updateGuardrail(loaded: LoadedMessage, fromFile: boolean): void {
    clear(this.bannerEl);
    const largePaste = !fromFile && loaded.rowCount > LARGE_PASTE_ROWS;
    if (!largePaste) {
      this.bannerEl.classList.add("hidden");
      return;
    }
    this.bannerEl.append(
      el("span", { class: "banner-text" }, [
        `Large paste (${loaded.rowCount.toLocaleString()} rows). For datasets this size, "Upload file" is faster and more stable.`,
      ]),
    );
    const dismiss = el("button", { class: "icon-btn", type: "button", title: "Dismiss" }, ["×"]);
    dismiss.addEventListener("click", () => this.bannerEl.classList.add("hidden"));
    this.bannerEl.append(dismiss);
    this.bannerEl.classList.remove("hidden");
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.countEl.textContent = `Error: ${message}`;
  }

  private showPaste(): void {
    this.workspace.classList.add("hidden");
    this.pasteView.classList.remove("hidden");
    this.statsButton.classList.add("hidden");
    this.textarea.focus();
  }
}
