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
const CLIPBOARD_ROW_LIMIT = 100_000;
const EXPORT_CHUNK_ROWS = 20_000;

function exportFileName(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base === "" ? "turbofuzz" : base).toLowerCase();
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

export class App {
  private readonly client = new SearchWorkerClient();
  private metas: ColumnMeta[] = [];
  private rowCount = 0;
  private datasetName = "";
  private loading = false;
  private generation = 0;
  private inFlight = false;
  private pendingSend: { generation: number; send: () => Promise<void> } | null = null;
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
  private actionEl!: HTMLElement;
  private copyButton!: HTMLButtonElement;
  private exportButton!: HTMLButtonElement;
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
    const resultsRow = el("div", { class: "results-row" });
    this.countEl = el("span", { class: "count" });
    this.actionEl = el("span", { class: "action-status" });

    this.copyButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Copy filtered rows as CSV" },
      ["Copy"],
    ) as HTMLButtonElement;
    this.copyButton.addEventListener("click", () => void this.copyResults());

    this.exportButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Download filtered rows as CSV" },
      ["Export CSV"],
    ) as HTMLButtonElement;
    this.exportButton.addEventListener("click", () => void this.exportCsv());

    resultsRow.append(
      this.countEl,
      el("span", { class: "grow" }),
      this.actionEl,
      this.copyButton,
      this.exportButton,
    );

    this.bannerEl = el("div", { class: "banner hidden" });
    resultsBar.append(resultsRow, this.bannerEl);
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
    this.generation++;
    this.pendingSend = null;
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
    const encodingText = loaded.encoding === "windows-1252" ? " · windows-1252" : "";
    this.metaEl.textContent =
      `${loaded.rowCount.toLocaleString()} rows × ${loaded.columnCount} columns` +
      `${duplicateText} · ${emptyPct.toFixed(1)}% empty${encodingText} · ${Math.round(loaded.ingestMs)} ms`;

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

  /**
   * Keeps at most one query in flight; a newer interaction replaces the
   * pending one instead of queueing behind a slow index build or sort.
   */
  private queueSend(send: () => Promise<void>): void {
    if (this.inFlight) {
      this.pendingSend = { generation: this.generation, send };
      return;
    }
    this.runSend(send);
  }

  private runSend(send: () => Promise<void>): void {
    this.inFlight = true;
    void send().finally(() => {
      this.inFlight = false;
      const next = this.pendingSend;
      this.pendingSend = null;
      if (next !== null && next.generation === this.generation) this.runSend(next.send);
    });
  }

  private changeFilter(column: number, filter: ColumnFilter | null): void {
    if (filter === null) this.filters.delete(column);
    else this.filters.set(column, filter);

    this.table?.setHighlights(this.highlightRules());

    this.queueSend(() =>
      this.client
        .setFilter(column, filter)
        .then((message) => {
          this.updateCount(message.count, message.queryMs);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private changeType(column: number, type: ColumnType): void {
    this.queueSend(() =>
      this.client
        .setType(column, type)
        .then((message) => {
          this.metas[column] = message.meta;
          this.filters.delete(column);
          this.filterPanel?.updateMeta(column, message.meta);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private changeSort(column: number, dir: 1 | -1 | 0): void {
    const sortColumn = dir === 0 ? -1 : column;
    const sortDir: 1 | -1 = dir === 0 ? 1 : dir;
    this.queueSend(() =>
      this.client
        .sort(sortColumn, sortDir)
        .then((message) => {
          this.table?.setSort(message.column, message.dir);
          this.updateCount(message.count, 0);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private clearFilters(): void {
    if (this.filters.size === 0) return;
    this.filters.clear();
    this.filterPanel?.rebuild();
    this.table?.setHighlights([]);
    this.queueSend(() =>
      this.client
        .clearFilters()
        .then((message) => {
          this.updateCount(message.count, message.queryMs);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows);
        })
        .catch((error: unknown) => this.showError(error)),
    );
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

  private async copyResults(): Promise<void> {
    if (this.datasetName === "" || this.loading) return;
    try {
      const { total } = await this.client.startExport();
      if (total === 0) return;

      const take = Math.min(total, CLIPBOARD_ROW_LIMIT);
      const parts: string[] = [];
      for (let start = 0; start < take; start += EXPORT_CHUNK_ROWS) {
        const chunk = await this.client.getCsv(start, Math.min(start + EXPORT_CHUNK_ROWS, take));
        parts.push(chunk.text);
      }

      const copied = await copyText(parts.join(""));
      if (!copied) {
        this.setAction("Clipboard blocked — use Export CSV");
      } else if (take < total) {
        this.setAction(`Copied first ${take.toLocaleString()} of ${total.toLocaleString()} rows`);
      } else {
        this.setAction(`Copied ${total.toLocaleString()} rows`);
      }
    } catch (error) {
      this.showError(error);
    }
  }

  private async exportCsv(): Promise<void> {
    if (this.datasetName === "" || this.loading) return;
    try {
      const { total } = await this.client.startExport();
      if (total === 0) return;

      const parts: BlobPart[] = ["\uFEFF"];
      for (let start = 0; start < total; start += EXPORT_CHUNK_ROWS) {
        this.actionEl.textContent = `Exporting… ${Math.round((start / total) * 100)}%`;
        const end = Math.min(start + EXPORT_CHUNK_ROWS, total);
        const chunk = await this.client.getCsv(start, end);
        parts.push(chunk.text);
      }

      const blob = new Blob(parts, { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${exportFileName(this.datasetName)}-filtered.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      this.setAction(`Exported ${total.toLocaleString()} rows`);
    } catch (error) {
      this.showError(error);
    }
  }

  private setAction(text: string): void {
    this.actionEl.textContent = text;
    window.setTimeout(() => {
      if (this.actionEl.textContent === text) this.actionEl.textContent = "";
    }, 4000);
  }

  private updateCount(count: number, queryMs: number): void {
    const timeText = queryMs < 1 ? "<1" : String(Math.round(queryMs));
    this.countEl.textContent = `${count.toLocaleString()} of ${this.rowCount.toLocaleString()} rows · ${timeText} ms`;
    const total = this.metas.length;
    this.countEl.title = `${count.toLocaleString()} matching rows out of ${this.rowCount.toLocaleString()} (${total} columns)`;
    this.copyButton.disabled = count === 0;
    this.exportButton.disabled = count === 0;
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
