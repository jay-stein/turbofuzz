import { parseDelimited } from "../parse/parse.js";
import { buildDataset } from "../data/build.js";
import { QueryEngine, type ColumnFilter } from "../search/query-engine.js";
import { DELIMITER_LABELS, type Delimiter } from "../parse/delimiter.js";
import { clear, el } from "./dom.js";
import { FilterPanel } from "./filters.js";
import { ResultTable, type HighlightRule } from "./table.js";
import { sampleCsv } from "./sample.js";
import type { Dataset } from "../data/dataset.js";

export class App {
  private dataset: Dataset | null = null;
  private engine: QueryEngine | null = null;
  private filterPanel: FilterPanel | null = null;
  private table: ResultTable | null = null;
  private readonly filters = new Map<number, ColumnFilter>();

  private pasteView!: HTMLElement;
  private workspace!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private delimiterSelect!: HTMLSelectElement;
  private headersCheckbox!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private metaEl!: HTMLElement;
  private countEl!: HTMLElement;
  private filterHost!: HTMLElement;
  private tableHost!: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.buildShell();
    this.bindEvents();
  }

  private buildShell(): void {
    clear(this.root);

    const topbar = el("header", { class: "topbar" });
    topbar.append(el("div", { class: "brand" }, ["FuzzyFind"]));
    this.metaEl = el("div", { class: "meta" });
    topbar.append(this.metaEl);
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
      void file.text().then((text) => this.loadText(text, file.name));
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
      void this.loadText(this.textarea.value, "Sample data");
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
    resultsBar.append(this.countEl);
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
    void this.loadText(text, "Pasted data");
  }

  private async loadText(text: string, name: string): Promise<void> {
    this.statusEl.textContent = "Parsing…";
    this.statusEl.classList.remove("error");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const started = performance.now();
    try {
      const parsed = parseDelimited(text, {
        delimiter: this.delimiterSelect.value as Delimiter | "auto",
        hasHeaders: this.headersCheckbox.checked,
      });

      if (parsed.rows.length === 0 || parsed.headers.length === 0) {
        this.statusEl.textContent = "No rows found. Try a different delimiter.";
        this.statusEl.classList.add("error");
        return;
      }

      const dataset = buildDataset(name, parsed.headers, parsed.rows);
      this.dataset = dataset;
      this.engine = new QueryEngine(dataset);
      this.filters.clear();

      const elapsed = Math.round(performance.now() - started);
      this.metaEl.textContent = `${dataset.rowCount.toLocaleString()} rows × ${dataset.columnCount} columns · ${DELIMITER_LABELS[parsed.delimiter]} · ${elapsed} ms`;
      this.statusEl.textContent = "";
      this.openWorkspace();
    } catch (error) {
      this.statusEl.textContent = error instanceof Error ? error.message : "Failed to parse data.";
      this.statusEl.classList.add("error");
    }
  }

  private openWorkspace(): void {
    if (this.dataset === null || this.engine === null) return;

    this.pasteView.classList.add("hidden");
    this.workspace.classList.remove("hidden");

    clear(this.filterHost);
    this.filterPanel = new FilterPanel(this.filterHost, this.dataset.columns, this.filters, {
      onChange: () => this.refresh(),
      onTypeChange: () => {
        this.engine?.invalidate();
        this.refresh();
      },
    });

    this.table?.dispose();
    clear(this.tableHost);
    this.table = new ResultTable(this.tableHost);
    this.refresh();
  }

  private refresh(): void {
    if (this.dataset === null || this.engine === null || this.table === null) return;
    const started = performance.now();
    const ids = this.engine.evaluate(this.filters);
    const elapsed = performance.now() - started;
    const timeText = elapsed < 1 ? "<1" : String(Math.round(elapsed));
    this.countEl.textContent = `${ids.length.toLocaleString()} of ${this.dataset.rowCount.toLocaleString()} rows · ${timeText} ms`;
    this.table.setData(this.dataset, ids, this.highlightRules());
  }

  private highlightRules(): HighlightRule[] {
    const rules: HighlightRule[] = [];
    for (const [column, filter] of this.filters) {
      if (filter.kind === "text" && filter.mode !== "fuzzy" && filter.query.trim() !== "") {
        rules.push({ column, query: filter.query, mode: filter.mode });
      }
    }
    return rules;
  }

  private clearFilters(): void {
    if (this.dataset === null) return;
    this.filters.clear();
    this.filterPanel?.rebuild();
    this.refresh();
  }

  private showPaste(): void {
    this.workspace.classList.add("hidden");
    this.pasteView.classList.remove("hidden");
    this.textarea.focus();
  }
}
