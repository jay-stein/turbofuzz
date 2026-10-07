import { DELIMITER_LABELS, type Delimiter } from "../parse/delimiter.js";
import { listArchiveEntries, readArchiveEntry, type ArchiveEntry } from "../parse/archive.js";
import { decompressBzip2 } from "../parse/bz2.js";
import { decodeText } from "../parse/encoding.js";
import { detectTable } from "../parse/header-detect.js";
import { listLegacySheets, readLegacySheet } from "../parse/xls.js";
import { listWorkbookSheets, readWorkbookSheet } from "../parse/xlsx.js";
import type { ColumnFilter } from "../search/query-engine.js";
import { describeCleanOp, type CleanOp } from "../data/clean-ops.js";
import { pandasRecipe } from "../data/recipe.js";
import type { ColumnSuggestion } from "../data/suggestions.js";
import {
  describeTransformOp,
  schemaAfter,
  type ColumnSchema,
  type TransformOp,
} from "../data/transform-ops.js";
import type { NumberLocale } from "../parse/numbers.js";
import type { WorkBook } from "xlsx";
import { TYPE_LABELS, type ColumnType } from "../types.js";
import type {
  CleanUpdate,
  ColumnMeta,
  LoadedMessage,
  ProgressMessage,
  SpecialKind,
  TransformedMessage,
} from "../worker/protocol.js";
import { clear, el, svgIcon } from "./dom.js";
import { FilterPanel } from "./filters.js";
import { findDataTables, type TableCandidate } from "./html-table.js";
import { sampleCsv } from "./sample.js";
import { SummaryBand } from "./summary-band.js";
import { openStatsModal } from "./stats.js";
import { ResultTable, type ColumnQaKind, type HighlightRule } from "./table.js";
import { SearchWorkerClient } from "./worker-client.js";
import { openCleanPanel } from "./clean-panel.js";
import { openConfirm } from "./dialog.js";
import { openExportPanel } from "./export-panel.js";
import { openMergePanel } from "./merge-panel.js";
import { openStepsPanel, type StepsPanelEntry } from "./steps-panel.js";
import { openTransformPanel } from "./transform-panel.js";
import { PipelineStepper, type StageId } from "./stepper.js";

const LARGE_PASTE_ROWS = 300_000;
const DATA_URL_EXTENSIONS = [
  ".csv",
  ".tsv",
  ".psv",
  ".txt",
  ".dat",
  ".json",
  ".jsonl",
  ".ndjson",
  ".parquet",
  ".xlsx",
  ".xls",
  ".zip",
  ".gz",
  ".bz2",
];
const FILE_ACCEPT =
  ".csv,.tsv,.psv,.txt,.dat,.json,.jsonl,.ndjson,.parquet,.xlsx,.xls,.zip,.gz,.bz2";
const WORKBOOK_EXTENSIONS = [".xlsx", ".xls"];
const UNSUPPORTED_COMPRESSION = [".xz", ".zst", ".7z", ".rar", ".tar", ".lz4"];
const UNSUPPORTED_FORMATS: { extensions: string[]; message: string }[] = [
  {
    extensions: [".h5", ".hdf5"],
    message: "HDF5 (.h5) isn't supported — export to CSV or Parquet first",
  },
];
const DEFAULT_SHUFFLE_SAMPLE = 100;

interface PickerItem {
  label: string;
  rows: number;
  columns: number;
  best?: boolean;
  detail?: string;
  onSelect: () => void;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot);
}

function isWorkbookUrl(raw: string): boolean {
  try {
    return WORKBOOK_EXTENSIONS.includes(extensionOf(new URL(raw).pathname));
  } catch {
    return false;
  }
}

function isDataUrl(raw: string): boolean {
  try {
    const pathname = new URL(raw).pathname.toLowerCase();
    return DATA_URL_EXTENSIONS.some((extension) => pathname.endsWith(extension));
  } catch {
    return false;
  }
}

function uploadIcon(): SVGElement {
  return svgIcon(
    '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    "dropzone-icon",
  );
}

function globeIcon(): SVGElement {
  return svgIcon(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z"/>',
    "field-icon",
  );
}

function lockIcon(): SVGElement {
  return svgIcon(
    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    "privacy-icon",
  );
}

function diceIcon(): SVGElement {
  return svgIcon(
    '<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.2"/>' +
      '<circle cx="8.4" cy="8.4" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.6" cy="8.4" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="8.4" cy="15.6" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.6" cy="15.6" r="1.2" fill="currentColor" stroke="none"/>',
    "shuffle-icon",
  );
}
const CLIPBOARD_ROW_LIMIT = 100_000;
const EXPORT_CHUNK_ROWS = 20_000;

function exportFileName(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base === "" ? "turbofuzz" : base).toLowerCase();
}

interface WritableLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<WritableLike>;
}

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandleLike>;

function nameFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last === undefined ? url.hostname : last;
  } catch {
    return "remote-data";
  }
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
  private readonly cleanedColumns = new Map<number, CleanOp[]>();
  private transformOps: TransformOp[] = [];
  private transformBaseSchema: ColumnSchema[] = [];
  private filterPanel: FilterPanel | null = null;
  private table: ResultTable | null = null;

  private pasteView!: HTMLElement;
  private workspace!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private urlInput!: HTMLInputElement;
  private urlButton!: HTMLButtonElement;
  private pendingWorkbook:
    | { kind: "xlsx"; buffer: ArrayBuffer }
    | { kind: "xls"; workbook: WorkBook }
    | null = null;
  private tablePickerEl!: HTMLElement;
  private tablePickerTitle!: HTMLElement;
  private tablePickerList!: HTMLElement;
  private delimiterSelect!: HTMLSelectElement;
  private headersCheckbox!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private metaEl!: HTMLElement;
  private countEl!: HTMLElement;
  private actionEl!: HTMLElement;
  private copyButton!: HTMLButtonElement;
  private exportButton!: HTMLButtonElement;
  private newButton!: HTMLButtonElement;
  private stepsButton!: HTMLButtonElement;
  private exportNullAsBlank = true;
  private bannerEl!: HTMLElement;
  private summaryHost!: HTMLElement;
  private summaryBand: SummaryBand | null = null;
  private readonly specials = new Set<SpecialKind>();
  private readonly columnSpecials = new Map<number, Set<ColumnQaKind>>();
  private readonly pendingRowDeletes = new Set<number>();
  private readonly pendingColumnDeletes = new Set<number>();
  private excludedRowCount = 0;
  private deleteBar!: HTMLElement;
  private deleteBarText!: HTMLElement;
  private shuffleButton!: HTMLButtonElement;
  private shuffleCount!: HTMLInputElement;
  private shuffleActive = false;
  private filterHost!: HTMLElement;
  private filterSearch!: HTMLInputElement;
  private tableHost!: HTMLElement;
  private stepperHost!: HTMLElement;
  private stepper: PipelineStepper | null = null;
  private workspaceTitle!: HTMLElement;

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

    this.newButton = el("button", { class: "ghost", type: "button" }, ["New data"]);
    this.newButton.addEventListener("click", () => this.showPaste());
    this.newButton.classList.add("hidden");
    topbar.append(this.newButton);

    this.pasteView = this.buildPasteView();
    this.workspace = this.buildWorkspace();
    const main = el("main", { class: "app-main" });
    main.append(this.pasteView, this.workspace);
    this.root.append(topbar, main);
  }

  private buildPasteView(): HTMLElement {
    const view = el("div", { class: "paste-view" });
    const card = el("div", { class: "paste-card" });

    card.append(el("h1", {}, ["Clean and reshape tables in your browser"]));
    card.append(
      el("p", { class: "sub" }, [
        "Drop a messy CSV or Excel file. Type-aware cleanup, transforms and search — nothing leaves this page.",
      ]),
    );

    const dropzone = el("div", {
      class: "dropzone",
      role: "button",
      tabindex: "0",
      title: "CSV, TSV, PSV, TXT, JSON, Excel, Parquet, ZIP, GZ or BZ2",
    });
    dropzone.append(
      uploadIcon(),
      el("span", { class: "dropzone-main" }, [
        "Drop a CSV, Excel, JSON or Parquet file here",
      ]),
      el("span", { class: "dropzone-sub" }, ["or click to browse"]),
    );
    const privacy = el("div", { class: "privacy-badge" }, [
      lockIcon(),
      el("span", {}, ["0 bytes uploaded — files are parsed in this browser"]),
    ]);
    card.append(dropzone, privacy);

    const fileInput = el("input", {
      type: "file",
      accept: FILE_ACCEPT,
      class: "hidden",
    }) as HTMLInputElement;
    const openPicker = (): void => fileInput.click();
    dropzone.addEventListener("click", openPicker);
    dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPicker();
      }
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file !== undefined) void this.loadFile(file);
    });

    card.addEventListener("dragover", (event) => {
      if (event.dataTransfer === null) return;
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
    card.addEventListener("dragleave", (event) => {
      if (event.relatedTarget !== null && card.contains(event.relatedTarget as Node)) return;
      dropzone.classList.remove("dragging");
    });
    card.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file === undefined) return;
      event.preventDefault();
      dropzone.classList.remove("dragging");
      void this.loadFile(file);
    });
    card.append(fileInput);

    const pasteDetails = el("details", { class: "paste-secondary" });
    pasteDetails.append(el("summary", {}, ["Paste rows instead"]));
    this.textarea = el("textarea", {
      placeholder: "Paste your data here (Ctrl+Enter to load)…",
      spellcheck: "false",
    }) as HTMLTextAreaElement;
    pasteDetails.append(this.textarea);

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
    const loadButton = el("button", { class: "primary", type: "button" }, ["Load pasted data"]);
    loadButton.addEventListener("click", () => this.loadFromTextarea());

    controls.append(delimiterLabel, headerLabel, el("span", { class: "grow" }), loadButton);
    pasteDetails.append(controls);
    card.append(pasteDetails);

    const urlDetails = el("details", { class: "paste-secondary" });
    urlDetails.append(el("summary", {}, ["Load from a URL or scrape a table"]));
    const urlSection = el("div", { class: "url-section" });
    const urlRow = el("div", { class: "url-controls" });
    const urlField = el("div", { class: "url-field" });
    urlField.append(globeIcon());
    this.urlInput = el("input", {
      class: "text-input url-input",
      type: "text",
      placeholder: "https://example.com/data.csv — or a web page with a table",
      spellcheck: "false",
      "aria-label": "Data file URL or web page to scrape",
    }) as HTMLInputElement;
    urlField.append(this.urlInput);

    this.urlButton = el(
      "button",
      { class: "primary", type: "button" },
      ["Load / scrape"],
    ) as HTMLButtonElement;
    this.urlButton.addEventListener("click", () => void this.loadFromUrl());
    this.urlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.loadFromUrl();
      }
    });
    this.urlInput.addEventListener("input", () => this.updateUrlButton());
    urlRow.append(urlField, this.urlButton);

    const legal = el("details", { class: "legal" });
    legal.append(
      el("summary", {}, ["Scraping guidelines"]),
      el("p", { class: "disclaimer" }, [
        "Always scrape responsibly by reviewing and adhering to the website's ",
        el("code", {}, ["robots.txt"]),
        " file, Terms of Service, and licensing restrictions. Ensure your request rates respect the server's load limits and comply with relevant data privacy laws.",
      ]),
    );

    urlSection.append(
      urlRow,
      el("p", { class: "url-hint" }, [
        "Links ending in .csv, .tsv, .psv, .txt, .json, .parquet, .zip, .gz or .bz2 load as data; anything else is scraped for its first table.",
      ]),
      legal,
    );
    urlDetails.append(urlSection);
    card.append(urlDetails);

    const pickerHead = el("div", { class: "table-picker-head" });
    this.tablePickerTitle = el("span", { class: "table-picker-title" });
    const pickerCancel = el("button", { class: "link", type: "button" }, ["Cancel"]);
    pickerCancel.addEventListener("click", () => this.hideTablePicker());
    pickerHead.append(this.tablePickerTitle, pickerCancel);
    this.tablePickerList = el("div", { class: "table-picker-list" });
    this.tablePickerEl = el("div", { class: "table-picker hidden" }, [pickerHead, this.tablePickerList]);
    card.append(this.tablePickerEl);

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
    this.workspaceTitle = el("h1", { class: "sr-only" }, ["TurboFuzz workspace"]);
    workspace.append(this.workspaceTitle);

    this.stepperHost = el("div", { class: "stepper-host" });
    this.stepper = new PipelineStepper(this.stepperHost, {
      onSelect: (id) => this.selectStage(id),
    });

    const sidebar = el("aside", { class: "sidebar" });
    const sidebarHead = el("div", { class: "sidebar-head" });
    sidebarHead.append(el("span", { class: "sidebar-title" }, ["Filters"]));
    const clearAll = el("button", { class: "ghost small", type: "button" }, ["Clear all"]);
    clearAll.addEventListener("click", () => this.clearFilters());
    sidebarHead.append(clearAll);
    this.filterSearch = el("input", {
      class: "text-input filter-search",
      type: "search",
      placeholder: "Find a column…",
      spellcheck: "false",
      "aria-label": "Find a column to filter",
    }) as HTMLInputElement;
    this.filterSearch.addEventListener("input", () =>
      this.filterPanel?.search(this.filterSearch.value),
    );
    this.filterHost = el("div", { class: "filter-host" });
    sidebar.append(sidebarHead, this.filterSearch, this.filterHost);

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

    this.stepsButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Review, undo or export the applied steps" },
      ["Steps"],
    ) as HTMLButtonElement;
    this.stepsButton.classList.add("hidden");
    this.stepsButton.addEventListener("click", () => this.openSteps());

    this.exportButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Choose a file name and format, then export" },
      ["Export…"],
    ) as HTMLButtonElement;
    this.exportButton.addEventListener("click", () => this.openExportDialog());

    const shuffleControl = el("span", { class: "shuffle-control" });
    this.shuffleCount = el("input", {
      class: "shuffle-count",
      type: "number",
      min: "1",
      step: "1",
      value: String(DEFAULT_SHUFFLE_SAMPLE),
      title: "Rows to sample at random — clear or 0 to shuffle all",
      "aria-label": "Number of rows to sample",
      spellcheck: "false",
    }) as HTMLInputElement;
    this.shuffleCount.addEventListener("input", () => this.updateShuffleLabel());

    this.shuffleButton = el(
      "button",
      {
        class: "shuffle-button",
        type: "button",
        title: "Show a random sample of rows",
      },
      [],
    ) as HTMLButtonElement;
    this.shuffleButton.append(diceIcon(), el("span", { class: "shuffle-label" }, []));
    this.shuffleButton.addEventListener("click", () => this.shuffleRows());
    this.updateShuffleLabel();

    shuffleControl.append(this.shuffleButton, this.shuffleCount);

    resultsRow.append(
      this.countEl,
      el("span", { class: "grow" }),
      this.actionEl,
      shuffleControl,
      this.stepsButton,
      this.copyButton,
      this.exportButton,
    );

    this.deleteBar = el("div", { class: "delete-bar hidden" });
    this.deleteBarText = el("span", { class: "delete-bar-text" });
    const deleteConfirm = el("button", { class: "ghost small danger", type: "button" }, [
      "Delete selected",
    ]);
    deleteConfirm.addEventListener("click", () => void this.confirmDeletes());
    const deleteCancel = el("button", { class: "link", type: "button" }, ["Cancel"]);
    deleteCancel.addEventListener("click", () => this.clearPendingDeletes());
    this.deleteBar.append(this.deleteBarText, el("span", { class: "grow" }), deleteCancel, deleteConfirm);

    this.bannerEl = el("div", { class: "banner hidden" });
    resultsBar.append(resultsRow, this.deleteBar, this.bannerEl);
    this.tableHost = el("div", { class: "table-host" });
    results.append(resultsBar, this.tableHost);

    this.summaryHost = el("div");
    const body = el("div", { class: "workspace-body" }, [sidebar, results]);
    workspace.append(this.stepperHost, this.summaryHost, body);
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
    this.hideTablePicker();
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

  /**
   * One URL field, two behaviours: data links (CSV/TSV/PSV by extension or
   * content type) load as a table, anything else is scraped for its first
   * table.
   */
  private async loadFromUrl(): Promise<void> {
    const url = this.urlInput.value.trim();
    if (url === "") {
      this.setStatusError("Enter a URL first.");
      return;
    }
    this.hideTablePicker();
    try {
      this.statusEl.textContent = "Downloading…";
      this.statusEl.classList.remove("error");
      const response = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const buffer = await response.arrayBuffer();

      const urlExtension = extensionOf(new URL(url).pathname);
      if (urlExtension === ".zip") {
        await this.openArchive(buffer, nameFromUrl(url));
        return;
      }
      if (urlExtension === ".gz") {
        await this.openGzip(buffer, nameFromUrl(url));
        return;
      }
      if (urlExtension === ".bz2") {
        await this.openBzip2(buffer, nameFromUrl(url));
        return;
      }

      if (isWorkbookUrl(url) || contentType.includes("spreadsheetml") || contentType.includes("ms-excel")) {
        await this.openWorkbook(buffer, nameFromUrl(url));
        return;
      }

      const looksHtml = contentType.includes("html");
      const looksData =
        contentType.includes("csv") ||
        contentType.includes("tab-separated") ||
        contentType.includes("comma-separated");

      if (looksData || (!looksHtml && isDataUrl(url))) {
        await this.load({ buffer, name: nameFromUrl(url), source: "file" });
        return;
      }

      const html = decodeText(buffer).text;
      const tables = findDataTables(html, 10);
      if (tables.length === 0) throw new Error("No data tables found on that page");
      if (tables.length === 1) {
        await this.loadGrid(tables[0].grid, this.tableNameFor(tables[0], url));
        return;
      }
      this.statusEl.textContent = "";
      this.showPicker(
        `${tables.length} tables found — pick one`,
        tables.map((table, index) => ({
          label: table.label,
          rows: table.rows,
          columns: table.columns,
          best: index === 0,
          onSelect: () => {
            this.hideTablePicker();
            void this.loadGrid(table.grid, this.tableNameFor(table, url));
          },
        })),
      );
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Download failed");
    }
  }

  private tableNameFor(table: TableCandidate, url: string): string {
    return table.label.startsWith("Table ") ? nameFromUrl(url) : table.label;
  }

  private hideTablePicker(): void {
    this.tablePickerEl.classList.add("hidden");
  }

  private showPicker(title: string, items: PickerItem[]): void {
    clear(this.tablePickerList);
    this.tablePickerTitle.textContent = title;

    items.forEach((item, index) => {
      const option = el("button", { class: "table-option", type: "button" });
      option.append(el("span", { class: "table-option-name" }, [item.label]));
      if (item.best === true) {
        option.append(el("span", { class: "table-option-best" }, ["best match"]));
      }
      option.append(
        el("span", { class: "table-option-size" }, [
          item.detail ??
            `${item.rows.toLocaleString()} rows × ${item.columns} column${item.columns === 1 ? "" : "s"}`,
        ]),
      );
      option.addEventListener("click", item.onSelect);
      this.tablePickerList.append(option);
    });

    this.tablePickerEl.classList.remove("hidden");
    this.tablePickerEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private updateUrlButton(): void {
    this.urlButton.textContent = isDataUrl(this.urlInput.value.trim())
      ? "Load file"
      : "Scrape table";
  }

  private async loadFile(file: File): Promise<void> {
    try {
      const extension = extensionOf(file.name);
      const unsupported = UNSUPPORTED_FORMATS.find((entry) =>
        entry.extensions.includes(extension),
      );
      if (unsupported !== undefined) {
        this.setStatusError(unsupported.message);
        return;
      }
      if (UNSUPPORTED_COMPRESSION.includes(extension)) {
        this.setStatusError(
          `${extension} archives aren't supported — try .zip, .gz or .bz2`,
        );
        return;
      }
      if (extension === ".zip") {
        await this.openArchive(await file.arrayBuffer(), file.name);
        return;
      }
      if (extension === ".gz") {
        await this.openGzip(await file.arrayBuffer(), file.name);
        return;
      }
      if (extension === ".bz2") {
        await this.openBzip2(await file.arrayBuffer(), file.name);
        return;
      }
      if (WORKBOOK_EXTENSIONS.includes(extension)) {
        const buffer = await file.arrayBuffer();
        await this.openWorkbook(buffer, file.name);
        return;
      }
      const buffer = await file.arrayBuffer();
      await this.load({ buffer, name: file.name, source: "file" });
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not read file");
    }
  }

  /** Lists data files inside a ZIP and loads the only one or shows a picker. */
  private async openArchive(buffer: ArrayBuffer, fileName: string): Promise<void> {
    this.hideTablePicker();
    this.statusEl.textContent = "Reading archive…";
    this.statusEl.classList.remove("error");
    try {
      const entries = await listArchiveEntries(buffer);
      if (entries.length === 0) {
        throw new Error("No CSV, TSV, PSV, TXT, XLSX or XLS files found in that archive");
      }
      if (entries.length === 1) {
        await this.openArchiveEntry(entries[0], fileName, buffer);
        return;
      }

      this.statusEl.textContent = "";
      this.showPicker(
        `${entries.length} files in ${fileName} — pick one`,
        entries.map((entry) => ({
          label: entry.path,
          rows: 0,
          columns: 0,
          detail: formatBytes(entry.size),
          onSelect: () => {
            this.hideTablePicker();
            void this.openArchiveEntry(entry, fileName, buffer);
          },
        })),
      );
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not read archive");
    }
  }

  private async openArchiveEntry(
    entry: ArchiveEntry,
    fileName: string,
    archive: ArrayBuffer,
  ): Promise<void> {
    this.statusEl.textContent = `Extracting “${entry.name}”…`;
    this.statusEl.classList.remove("error");
    try {
      const bytes = await readArchiveEntry(archive, entry.path);
      const data = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      if (WORKBOOK_EXTENSIONS.includes(extensionOf(entry.name))) {
        await this.openWorkbook(data, entry.name);
        return;
      }
      this.statusEl.textContent = "";
      await this.load({
        buffer: data,
        name: `${fileName.replace(/\.zip$/i, "")}/${entry.path}`,
        source: "file",
      });
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not extract file");
    }
  }

  /** Decompresses a .gz and routes the inner file (data, workbook or zip). */
  private async openGzip(buffer: ArrayBuffer, fileName: string): Promise<void> {
    this.hideTablePicker();
    this.statusEl.textContent = "Decompressing…";
    this.statusEl.classList.remove("error");
    try {
      const { gunzipSync } = await import("fflate");
      const inner = gunzipSync(new Uint8Array(buffer));
      await this.routeDecompressed(inner, fileName.replace(/\.gz$/i, ""));
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not decompress file");
    }
  }

  /** Decompresses a .bz2 and routes the inner file. */
  private async openBzip2(buffer: ArrayBuffer, fileName: string): Promise<void> {
    this.hideTablePicker();
    this.statusEl.textContent = "Decompressing bzip2…";
    this.statusEl.classList.remove("error");
    try {
      // Let the status paint before the synchronous decode blocks the thread.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const inner = await decompressBzip2(buffer);
      await this.routeDecompressed(inner, fileName.replace(/\.bz2$/i, ""));
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not decompress file");
    }
  }

  /** Routes a freshly decompressed buffer to the right loader. */
  private async routeDecompressed(inner: Uint8Array, innerName: string): Promise<void> {
    const data = inner.buffer.slice(
      inner.byteOffset,
      inner.byteOffset + inner.byteLength,
    ) as ArrayBuffer;
    const extension = extensionOf(innerName);
    if (extension === ".zip") {
      await this.openArchive(data, innerName);
      return;
    }
    if (extension === ".gz") {
      await this.openGzip(data, innerName);
      return;
    }
    if (extension === ".bz2") {
      await this.openBzip2(data, innerName);
      return;
    }
    if (WORKBOOK_EXTENSIONS.includes(extension)) {
      await this.openWorkbook(data, innerName);
      return;
    }
    this.statusEl.textContent = "";
    await this.load({ buffer: data, name: innerName, source: "file" });
  }

  /** Lists worksheets (biggest first) and either loads the only one or shows a picker. */
  private async openWorkbook(buffer: ArrayBuffer, fileName: string): Promise<void> {
    this.hideTablePicker();
    this.statusEl.textContent = "Reading workbook…";
    this.statusEl.classList.remove("error");
    try {
      let sheets;
      let total: number;
      if (extensionOf(fileName) === ".xls") {
        const legacy = await listLegacySheets(buffer, 50);
        this.pendingWorkbook = { kind: "xls", workbook: legacy.workbook };
        sheets = legacy.sheets;
        total = legacy.total;
      } else {
        const listing = await listWorkbookSheets(buffer, 50);
        this.pendingWorkbook = { kind: "xlsx", buffer };
        sheets = listing.sheets;
        total = listing.total;
      }

      if (sheets.length === 0) throw new Error("No worksheets with data found in that file");
      if (sheets.length === 1) {
        await this.loadSheet(sheets[0].name, fileName);
        return;
      }

      this.statusEl.textContent = "";
      this.showPicker(
        total > sheets.length
          ? `${total} worksheets — first ${sheets.length} shown, pick one`
          : `${sheets.length} worksheets found — pick one`,
        sheets.map((sheet) => ({
          label: sheet.name,
          rows: sheet.rows,
          columns: sheet.columns,
          onSelect: () => {
            this.hideTablePicker();
            void this.loadSheet(sheet.name, fileName);
          },
        })),
      );
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not read workbook");
    }
  }

  private async loadSheet(sheetName: string, fileName: string): Promise<void> {
    const pending = this.pendingWorkbook;
    if (pending === null) return;
    this.statusEl.textContent = `Reading “${sheetName}”…`;
    this.statusEl.classList.remove("error");
    try {
      const rows =
        pending.kind === "xlsx"
          ? await readWorkbookSheet(pending.buffer, sheetName)
          : await readLegacySheet(pending.workbook, sheetName);
      if (rows.length === 0) throw new Error("That worksheet has no data");
      this.statusEl.textContent = "";
      const base = fileName.replace(/\.[^.]+$/, "");
      await this.loadGrid(rows, `${base} — ${sheetName}`);
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not read worksheet");
    }
  }

  /**
   * Applies header detection to a raw grid (skipping title rows and merging
   * multi-level headers) when "first row is header" is enabled.
   */
  private async loadGrid(grid: string[][], name: string): Promise<void> {
    if (!this.headersCheckbox.checked) {
      await this.loadTable(grid, name, false);
      return;
    }

    const detected = detectTable(grid);
    const combined =
      detected.headerRows > 0 ? [detected.headers, ...detected.rows] : detected.rows;
    if (combined.length === 0) throw new Error("That table has no data");

    await this.loadTable(combined, name, detected.headerRows > 0);

    if (detected.skipRows > 0 || detected.headerRows > 1) {
      const skipped =
        detected.skipRows > 0
          ? `skipped ${detected.skipRows} row${detected.skipRows === 1 ? "" : "s"}`
          : "";
      const levels = detected.headerRows > 1 ? `${detected.headerRows} header rows` : "";
      this.setAction([skipped, levels].filter(Boolean).join(" · "));
    }
  }

  private async loadTable(
    rows: string[][],
    name: string,
    hasHeadersOverride?: boolean,
  ): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.generation++;
    this.pendingSend = null;
    this.statusEl.textContent = "Building table…";
    this.statusEl.classList.remove("error");

    try {
      const hasHeaders = hasHeadersOverride ?? this.headersCheckbox.checked;
      const loaded = await this.client.load({
        name,
        delimiter: "auto",
        hasHeaders,
        table: { rows, hasHeaders },
      });
      this.statusEl.textContent = "";
      this.openWorkspace(loaded);
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Failed to build table");
    } finally {
      this.loading = false;
    }
  }

  private setStatusError(message: string): void {
    this.statusEl.textContent = message;
    this.statusEl.classList.add("error");
  }

  private handleProgress(progress: ProgressMessage): void {
    if (progress.phase === "parse") {
      this.statusEl.textContent = progress.detail ?? "Parsing…";
    } else if (progress.phase === "build") {
      this.statusEl.textContent = progress.detail ?? "Building…";
    } else if (progress.phase === "index" && progress.column !== undefined) {
      this.filterPanel?.setStatus(progress.column, progress.active === true ? "Building index…" : "");
    } else if (progress.phase === "sort") {
      if (progress.active === true) this.countEl.textContent = "Sorting…";
    }
  }

  private openWorkspace(loaded: LoadedMessage | TransformedMessage): void {
    this.metas = loaded.columns;
    this.rowCount = loaded.rowCount;
    this.datasetName = loaded.name;
    this.workspaceTitle.textContent = `${loaded.name} — ${loaded.rowCount.toLocaleString()} rows`;
    this.stepper?.setDone("load", true);
    this.setStage("view");
    this.filters.clear();
    this.cleanedColumns.clear();
    if (loaded.type === "transformed") {
      this.transformOps = loaded.ops;
      this.transformBaseSchema = loaded.baseSchema;
    } else {
      this.transformOps = [];
      this.transformBaseSchema = [];
    }
    this.specials.clear();
    this.columnSpecials.clear();
    this.excludedRowCount = 0;
    this.clearPendingDeletes();
    this.shuffleActive = false;
    this.updateStepsButton();
    this.summaryBand = new SummaryBand(this.summaryHost, {
      onToggleSpecial: (kind) => this.toggleSpecial(kind),
      onOpenStats: () => this.openStats(),
      onColumnClick: (column) => this.filterPanel?.focusColumn(column),
    });
    this.summaryBand.render(loaded);

    this.pasteView.classList.add("hidden");
    this.workspace.classList.remove("hidden");
    this.newButton.classList.remove("hidden");

    const emptyPct =
      loaded.stats.totalCells > 0
        ? (loaded.stats.totalNullCells / loaded.stats.totalCells) * 100
        : 0;
    const duplicateText =
      loaded.stats.duplicateGroups > 0
        ? ` · ${loaded.stats.duplicateGroups.toLocaleString()} duplicate groups (${loaded.stats.duplicateRows.toLocaleString()} redundant rows)`
        : "";
    const encodingText = loaded.encoding === "windows-1252" ? " · windows-1252" : "";
    this.metaEl.textContent =
      `${loaded.rowCount.toLocaleString()} rows × ${loaded.columnCount} columns` +
      `${duplicateText} · ${emptyPct.toFixed(1)}% empty${encodingText} · ${Math.round(loaded.ingestMs)} ms`;

    this.table?.dispose();
    clear(this.tableHost);
    this.table = new ResultTable(this.tableHost, {
      onSort: (column, dir) => this.changeSort(column, dir),
      onTypeChange: (column, type) => this.changeType(column, type),
      onColumnSpecial: (column, kind) => this.toggleColumnSpecial(column, kind),
      onMergeSimilar: (column) => this.openMerge(column),
      onColumnContext: (column, x, y) => this.openColumnMenu(column, x, y),
      onToggleColumnDelete: (column) => this.toggleColumnDelete(column),
      onToggleRowDelete: (position) => this.toggleRowDelete(position),
      onRequestRows: (start, end, done) => {
        void this.client
          .getRows(start, end)
          .then((message) => done(message.start, message.rows, message.groups, message.flags))
          .catch(() => done(start, []));
      },
    });
    this.table.setColumns(loaded.columns);
    this.table.setSort(-1, 1);
    this.table.setCount(loaded.rowCount);

    clear(this.filterHost);
    this.filterSearch.value = "";
    this.filterPanel = new FilterPanel(this.filterHost, this.metas, this.filters, {
      onFilter: (column, filter, preview) => this.changeFilter(column, filter, preview ?? false),
      onTypeChange: (column, type) => this.changeType(column, type),
      onNumberLocale: (column, locale) => this.changeNumberLocale(column, locale),
      onSuggestion: (column, suggestion) => this.applySuggestion(column, suggestion),
    });

    this.updateCount(loaded.rowCount, 0);
    this.updateGuardrail(loaded, loaded.source === "file" || loaded.type === "transformed");
  }

  private toggleColumnSpecial(column: number, kind: ColumnQaKind): void {
    const active = !(this.columnSpecials.get(column)?.has(kind) ?? false);
    let kinds = this.columnSpecials.get(column);
    if (active) {
      if (kinds === undefined) {
        kinds = new Set();
        this.columnSpecials.set(column, kinds);
      }
      kinds.add(kind);
    } else if (kinds !== undefined) {
      kinds.delete(kind);
      if (kinds.size === 0) this.columnSpecials.delete(column);
    }
    this.syncColumnQa();

    this.queueSend(() =>
      this.client
        .setSpecial(kind, active, column)
        .then((message) => {
          this.updateCount(message.count, message.queryMs);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  /** Marks the active per-column QA chips in the header. */
  private syncColumnQa(): void {
    const active = new Set<string>();
    for (const [column, kinds] of this.columnSpecials) {
      for (const kind of kinds) active.add(`${column}:${kind}`);
    }
    this.table?.setColumnQa(active);
  }

  private toggleRowDelete(position: number): void {
    if (this.pendingRowDeletes.has(position)) this.pendingRowDeletes.delete(position);
    else this.pendingRowDeletes.add(position);
    this.syncPendingDeletes();
  }

  private toggleColumnDelete(column: number): void {
    if (this.pendingColumnDeletes.has(column)) this.pendingColumnDeletes.delete(column);
    else this.pendingColumnDeletes.add(column);
    this.syncPendingDeletes();
  }

  private clearPendingDeletes(): void {
    this.pendingRowDeletes.clear();
    this.pendingColumnDeletes.clear();
    this.syncPendingDeletes();
  }

  private syncPendingDeletes(): void {
    this.table?.setPendingDeletes(this.pendingRowDeletes, this.pendingColumnDeletes);
    const labels: string[] = [];
    const rows = this.pendingRowDeletes.size;
    const columns = this.pendingColumnDeletes.size;
    if (rows > 0) labels.push(`${rows.toLocaleString()} row${rows === 1 ? "" : "s"}`);
    if (columns > 0) labels.push(`${columns.toLocaleString()} column${columns === 1 ? "" : "s"}`);
    this.deleteBarText.textContent =
      labels.length === 0 ? "" : `${labels.join(" and ")} selected for deletion`;
    this.deleteBar.classList.toggle("hidden", labels.length === 0);
  }

  private async confirmDeletes(): Promise<void> {
    const positions = [...this.pendingRowDeletes];
    const columns = [...this.pendingColumnDeletes].sort((a, b) => b - a);
    if (positions.length === 0 && columns.length === 0) return;

    const labels: string[] = [];
    if (positions.length > 0) {
      labels.push(`${positions.length} row${positions.length === 1 ? "" : "s"}`);
    }
    if (columns.length > 0) {
      labels.push(`${columns.length} column${columns.length === 1 ? "" : "s"}`);
    }
    const confirmed = await openConfirm({
      title: `Delete ${labels.join(" and ")}?`,
      body:
        positions.length > 0
          ? "Rows are removed from the working set — counts and exports exclude them, and the deletion is undoable from the Steps list. Columns are removed as tracked transform steps."
          : "Columns are removed as tracked transform steps, undoable from the Steps list.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    this.clearPendingDeletes();

    if (positions.length > 0) {
      try {
        const message = await this.client.dropRows(positions);
        this.excludedRowCount += positions.length;
        this.updateCount(message.count, message.queryMs);
        this.filterPanel?.applyResults(message.facets, message.histograms);
        this.table?.setCount(message.count);
        this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
        this.updateStepsButton();
      } catch (error) {
        this.showError(error);
      }
    }
    if (columns.length > 0) {
      this.applyTransform([
        ...this.transformOps,
        ...columns.map((column) => ({ kind: "drop" as const, column })),
      ]);
    }
  }

  private async restoreExcludedRows(): Promise<void> {
    try {
      const message = await this.client.clearExcludedRows();
      this.excludedRowCount = 0;
      this.updateCount(message.count, message.queryMs);
      this.filterPanel?.applyResults(message.facets, message.histograms);
      this.table?.setCount(message.count);
      this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
      this.updateStepsButton();
    } catch (error) {
      this.showError(error);
    }
  }

  private toggleSpecial(kind: SpecialKind): void {
    this.shuffleActive = false;
    const active = !this.specials.has(kind);
    if (active) this.specials.add(kind);
    else this.specials.delete(kind);
    this.summaryBand?.setSpecials(this.specials);

    // Grouping takes over ordering in the worker, so clear the sort indicator.
    if (kind === "duplicates" && active) this.table?.setSort(-1, 1);

    this.queueSend(() =>
      this.client
        .setSpecial(kind, active)
        .then((message) => {
          this.updateCount(message.count, message.queryMs);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private shuffleLimit(): number | null {
    const raw = this.shuffleCount.value.trim();
    if (raw === "") return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private updateShuffleLabel(): void {
    const limit = this.shuffleLimit();
    const label = this.shuffleButton.querySelector(".shuffle-label");
    if (label !== null) {
      label.textContent = limit === null ? "Shuffle all" : `Shuffle ${limit.toLocaleString()}`;
    }
  }

  private shuffleRows(): void {
    if (this.datasetName === "" || this.loading) return;
    const limit = this.shuffleLimit();
    this.queueSend(() =>
      this.client
        .shuffle(limit ?? undefined)
        .then((message) => {
          this.table?.setSort(-1, 1);
          this.shuffleActive = message.count < this.rowCount;
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, undefined, message.firstFlags);
          this.table?.scrollToTop();
          this.updateCount(message.count, 0);
        })
        .catch((error: unknown) => this.showError(error)),
    );
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

  private changeFilter(column: number, filter: ColumnFilter | null, preview = false): void {
    this.shuffleActive = false;
    if (filter === null) this.filters.delete(column);
    else this.filters.set(column, filter);

    this.table?.setHighlights(this.highlightRules());

    this.queueSend(() =>
      this.client
        .setFilter(column, filter, preview)
        .then((message) => {
          this.updateCount(message.count, message.queryMs);
          if (!preview) this.filterPanel?.applyResults(message.facets, message.histograms);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private changeType(column: number, type: ColumnType): void {
    const hadFilter = this.filters.has(column);
    const name = this.metas[column]?.name ?? `Column ${column + 1}`;
    this.queueSend(() =>
      this.client
        .setType(column, type)
        .then((message) => {
          this.metas[column] = message.meta;
          this.filters.delete(column);
          if (hadFilter) {
            this.showWarning(
              `Type changed to ${TYPE_LABELS[type]} — the previous filter on “${name}” was cleared.`,
            );
          }
          this.summaryBand?.setCounts(message.stats);
          this.summaryBand?.updateColumn(column, message.meta);
          this.filterPanel?.updateMeta(column, message.meta);
          this.table?.updateColumn(column, message.meta);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private applySuggestion(column: number, suggestion: ColumnSuggestion): void {
    const meta = this.metas[column];
    switch (suggestion.kind) {
      case "sentinel": {
        const extra = [...new Set([...(meta?.nullPolicy.extra ?? []), suggestion.value])];
        this.applyNullPolicy(column, extra, meta?.nullPolicy.keep ?? []);
        break;
      }
      case "boolean": {
        const ops: CleanOp[] = [];
        for (const value of suggestion.truthy) {
          ops.push({ kind: "replace", find: value, replacement: "true", ignoreCase: false });
        }
        for (const value of suggestion.falsy) {
          ops.push({ kind: "replace", find: value, replacement: "false", ignoreCase: false });
        }
        const existing = this.cleanedColumns.get(column) ?? [];
        this.applyClean([{ column, ops: [...existing, ...ops] }]);
        break;
      }
      case "number": {
        const existing = this.cleanedColumns.get(column) ?? [];
        this.applyClean([
          { column, ops: [...existing, { kind: "toNumber", locale: suggestion.locale }] },
        ]);
        break;
      }
      case "date": {
        const existing = this.cleanedColumns.get(column) ?? [];
        this.applyClean([
          { column, ops: [...existing, { kind: "toDate", order: meta?.dateOrder ?? "dmy" }] },
        ]);
        break;
      }
    }
  }

  private changeNumberLocale(column: number, locale: NumberLocale): void {
    this.queueSend(() =>
      this.client
        .setNumberLocale(column, locale)
        .then((message) => {
          this.metas[column] = message.meta;
          this.filters.delete(column);
          this.summaryBand?.setCounts(message.stats);
          this.summaryBand?.updateColumn(column, message.meta);
          this.filterPanel?.updateMeta(column, message.meta);
          this.table?.updateColumn(column, message.meta);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private changeSort(column: number, dir: 1 | -1 | 0): void {
    this.shuffleActive = false;
    const sortColumn = dir === 0 ? -1 : column;
    const sortDir: 1 | -1 = dir === 0 ? 1 : dir;
    this.queueSend(() =>
      this.client
        .sort(sortColumn, sortDir)
        .then((message) => {
          this.table?.setSort(message.column, message.dir);
          this.updateCount(message.count, 0);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private clearFilters(): void {
    if (
      this.filters.size === 0 &&
      this.specials.size === 0 &&
      this.columnSpecials.size === 0 &&
      !this.shuffleActive
    ) {
      return;
    }
    const activeSpecials = [...this.specials];
    const activeColumnSpecials = [...this.columnSpecials.entries()].map(([column, kinds]) => [
      column,
      [...kinds],
    ] as const);
    this.shuffleActive = false;

    this.filters.clear();
    this.specials.clear();
    this.columnSpecials.clear();
    this.syncColumnQa();
    this.summaryBand?.setSpecials(this.specials);
    this.filterPanel?.rebuild();
    this.table?.setHighlights([]);

    this.queueSend(async () => {
      for (const kind of activeSpecials) await this.client.setSpecial(kind, false);
      for (const [column, kinds] of activeColumnSpecials) {
        for (const kind of kinds) await this.client.setSpecial(kind, false, column);
      }
      const message = await this.client.clearFilters();
      this.updateCount(message.count, message.queryMs);
      this.filterPanel?.applyResults(message.facets, message.histograms);
      this.table?.setCount(message.count);
      this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
    });
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
        const chunk = await this.client.getCsv(start, Math.min(start + EXPORT_CHUNK_ROWS, take), {
          nullAsBlank: this.exportNullAsBlank,
        });
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

  private openExportDialog(): void {
    if (this.datasetName === "" || this.loading) return;
    openExportPanel(
      this.defaultExportName(),
      { nullAsBlank: this.exportNullAsBlank },
      {
        onSave: (fileName, settings) => {
          this.exportNullAsBlank = settings.nullAsBlank;
          void this.runExport(fileName, settings.nullAsBlank);
        },
        onClose: () => {},
      },
    );
  }

  private defaultExportName(): string {
    const hasCleans = this.cleanedColumns.size > 0 || this.transformOps.length > 0;
    const hasFilters = this.filters.size > 0 || this.specials.size > 0 || this.shuffleActive;
    const suffix = hasCleans ? "-cleaned" : hasFilters ? "-filtered" : "";
    return `${exportFileName(this.datasetName)}${suffix}.csv`;
  }

  private async runExport(fileName: string, nullAsBlank: boolean): Promise<void> {
    if (this.datasetName === "" || this.loading) return;
    try {
      // Ask for the destination up front, while the click is still a user
      // gesture; the chunks are streamed into the chosen file afterwards.
      let handle: FileHandleLike | null = null;
      const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
      if (typeof picker === "function") {
        try {
          handle = await picker.call(window, {
            suggestedName: fileName,
            types: [{ description: "CSV file", accept: { "text/csv": [".csv"] } }],
          });
        } catch (error) {
          if ((error as { name?: string }).name === "AbortError") return;
          handle = null;
        }
      }

      const { total } = await this.client.startExport();
      if (total === 0) {
        this.setAction("Nothing to export");
        return;
      }

      const parts: string[] = ["\uFEFF"];
      for (let start = 0; start < total; start += EXPORT_CHUNK_ROWS) {
        this.actionEl.textContent = `Exporting… ${Math.round((start / total) * 100)}%`;
        const end = Math.min(start + EXPORT_CHUNK_ROWS, total);
        const chunk = await this.client.getCsv(start, end, { nullAsBlank });
        parts.push(chunk.text);
      }
      const text = parts.join("");

      if (handle !== null) {
        const writable = await handle.createWritable();
        await writable.write(new Blob([text], { type: "text/csv;charset=utf-8" }));
        await writable.close();
      } else {
        const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      }
      this.setAction(`Exported ${total.toLocaleString()} rows to ${fileName}`);
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
    const total = this.rowCount;
    const parts: string[] = [];
    if (this.shuffleActive && total > 0 && count < total) {
      parts.push(`${count.toLocaleString()} random rows`);
      parts.push(`sampled from ${total.toLocaleString()}`);
    } else if (total > 0 && count < total) {
      const shownPct = (count / total) * 100;
      const filtered = total - count;
      parts.push(`${count.toLocaleString()} of ${total.toLocaleString()} rows (${shownPct.toFixed(1)}%)`);
      parts.push(`${filtered.toLocaleString()} filtered out`);
    } else {
      parts.push(`${count.toLocaleString()} rows`);
    }
    parts.push(`${timeText} ms`);
    this.countEl.textContent = parts.join(" · ");
    const columnCount = this.metas.length;
    this.countEl.title = `${count.toLocaleString()} matching rows out of ${total.toLocaleString()} (${columnCount} columns)`;
    this.copyButton.disabled = count === 0;
    this.exportButton.disabled = count === 0;
  }

  private updateGuardrail(loaded: LoadedMessage | TransformedMessage, fromFile: boolean): void {
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

  private showWarning(text: string): void {
    this.bannerEl.replaceChildren(el("span", { class: "banner-text" }, [text]));
    const dismiss = el("button", { class: "icon-btn", type: "button", title: "Dismiss" }, ["×"]);
    dismiss.addEventListener("click", () => this.bannerEl.classList.add("hidden"));
    this.bannerEl.append(dismiss);
    this.bannerEl.classList.remove("hidden");
  }

  private showPaste(): void {
    this.workspace.classList.add("hidden");
    this.pasteView.classList.remove("hidden");
    this.newButton.classList.add("hidden");
  }

  private selectStage(id: StageId): void {
    switch (id) {
      case "load":
        this.showPaste();
        break;
      case "view":
        this.setStage("view");
        break;
      case "clean":
        this.openClean();
        break;
      case "transform":
        this.openTransform();
        break;
      case "export":
        this.openExportDialog();
        break;
    }
  }

  private setStage(id: StageId): void {
    this.stepper?.setActive(id);
  }

  private openClean(): void {
    if (this.datasetName === "" || this.loading) return;
    this.setStage("clean");
    openCleanPanel(this.metas, this.cleanedColumns, {
      onApplyHeaders: (headers) => this.applyHeaderRename(headers),
      onApplyClean: (updates) => this.applyClean(updates),
      onResetCleans: () =>
        this.applyClean([...this.cleanedColumns.keys()].map((column) => ({ column, ops: [] }))),
      onApplyNullPolicy: (column, extra, keep) => this.applyNullPolicy(column, extra, keep),
      onApplyNullPolicyAll: (extra, keep) => this.applyNullPolicyAll(extra, keep),
      onPreviewClean: (updates) =>
        this.client.previewClean(updates).then((message) => {
          let changed = 0;
          let total = 0;
          for (const entry of message.columns) {
            changed += entry.changed;
            total += entry.total;
          }
          return { changed, total };
        }),
      onOpenMerge: (column) => this.openMerge(column),
      onClose: () => this.setStage("view"),
    });
  }

  private openMerge(column: number): void {
    const meta = this.metas[column];
    if (meta === undefined) return;
    openMergePanel(meta, column, {
      onApply: (target, ops) => {
        const existing = this.cleanedColumns.get(target) ?? [];
        this.applyClean([{ column: target, ops: [...existing, ...ops] }]);
      },
      onClose: () => this.setStage("view"),
    });
  }

  /** Right-click column menu: quick actions without leaving the table. */
  private openColumnMenu(column: number, x: number, y: number): void {
    const meta = this.metas[column];
    if (meta === undefined) return;

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

    const addItem = (
      label: string,
      action: () => void,
      options: { danger?: boolean } = {},
    ): void => {
      const item = el(
        "button",
        {
          class: `context-item${options.danger === true ? " danger" : ""}`,
          type: "button",
          role: "menuitem",
        },
        [label],
      ) as HTMLButtonElement;
      item.addEventListener("click", () => {
        close();
        action();
      });
      menu.append(item);
    };

    addItem("Filter this column", () => this.filterPanel?.focusColumn(column));
    if (meta.type === "category") {
      addItem("Merge similar values…", () => this.openMerge(column));
    }
    addItem("Delete column…", () => void this.confirmDeleteColumn(column), { danger: true });

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    document.body.append(menu);
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
  }

  private async confirmDeleteColumn(column: number): Promise<void> {
    const meta = this.metas[column];
    if (meta === undefined) return;
    const confirmed = await openConfirm({
      title: `Delete column “${meta.name}”?`,
      body:
        "The column is removed from the dataset as a tracked transform step — you can undo it from the Steps list.",
      confirmLabel: "Delete column",
      danger: true,
    });
    if (!confirmed) return;
    this.applyTransform([...this.transformOps, { kind: "drop", column }]);
  }

  private updateStepsButton(): void {
    let count = this.transformOps.length;
    for (const ops of this.cleanedColumns.values()) count += ops.length;
    if (this.excludedRowCount > 0) count += 1;
    this.stepsButton.textContent = count === 0 ? "Steps" : `Steps (${count})`;
    this.stepsButton.disabled = count === 0;
    this.stepsButton.title =
      count === 0
        ? "No applied steps yet — clean or transform a column to build the list"
        : "Review, undo or export the applied steps";
    this.stepsButton.classList.remove("hidden");
  }

  private stepEntries(): StepsPanelEntry[] {
    const entries: StepsPanelEntry[] = [];
    for (const [column, ops] of this.cleanedColumns) {
      const name = this.metas[column]?.name ?? `Column ${column + 1}`;
      for (let index = 0; index < ops.length; index++) {
        entries.push({
          kind: "clean",
          label: `${name}: ${describeCleanOp(ops[index])}`,
          column,
          opIndex: index,
          groupSize: ops.length,
        });
      }
    }
    const schema =
      this.transformBaseSchema.length > 0
        ? this.transformBaseSchema
        : this.metas.map((meta) => ({
            name: meta.name,
            numeric: meta.type === "integer" || meta.type === "number",
          }));
    let running = schema;
    for (let index = 0; index < this.transformOps.length; index++) {
      const op = this.transformOps[index];
      entries.push({
        kind: "transform",
        label: describeTransformOp(
          op,
          running.map((entry) => entry.name),
        ),
        column: -1,
        opIndex: index,
        groupSize: this.transformOps.length,
      });
      running = schemaAfter(running, op);
    }
    if (this.excludedRowCount > 0) {
      entries.push({
        kind: "rows",
        label: `Removed ${this.excludedRowCount.toLocaleString()} row${
          this.excludedRowCount === 1 ? "" : "s"
        }`,
        column: -1,
        opIndex: 0,
        groupSize: 1,
      });
    }
    return entries;
  }

  private openSteps(): void {
    openStepsPanel(this.stepEntries(), {
      onRemoveClean: (column, opIndex) => {
        const ops = this.cleanedColumns.get(column) ?? [];
        this.applyClean([{ column, ops: ops.filter((_, index) => index !== opIndex) }]);
      },
      onMoveClean: (column, opIndex, direction) => {
        const ops = (this.cleanedColumns.get(column) ?? []).slice();
        const target = opIndex + direction;
        if (target < 0 || target >= ops.length) return;
        [ops[opIndex], ops[target]] = [ops[target], ops[opIndex]];
        this.applyClean([{ column, ops }]);
      },
      onRemoveLastTransform: () => this.applyTransform(this.transformOps.slice(0, -1)),
      onRestoreRows: () => void this.restoreExcludedRows(),
      onClearAll: () => {
        if (this.transformOps.length > 0) this.applyTransform([]);
        if (this.cleanedColumns.size > 0) {
          this.applyClean(
            [...this.cleanedColumns.keys()].map((column) => ({ column, ops: [] })),
          );
        }
      },
      onCopyRecipe: () => this.copyRecipe(),
      onClose: () => this.setStage("view"),
    });
  }

  private async copyRecipe(): Promise<boolean> {
    const schema =
      this.transformBaseSchema.length > 0
        ? this.transformBaseSchema
        : this.metas.map((meta) => ({
            name: meta.name,
            numeric: meta.type === "integer" || meta.type === "number",
          }));
    const recipe = pandasRecipe({
      cleans: [...this.cleanedColumns.entries()].map(([column, ops]) => ({
        name: this.metas[column]?.name ?? `Column ${column + 1}`,
        ops,
      })),
      transforms: this.transformOps,
      schema,
    });
    return copyText(recipe);
  }

  private applyHeaderRename(headers: string[]): void {
    this.queueSend(() =>
      this.client
        .renameHeaders(headers)
        .then((message) => {
          const count = Math.min(this.metas.length, message.headers.length);
          for (let i = 0; i < count; i++) this.metas[i].name = message.headers[i];
          this.filterPanel?.rebuild();
          this.table?.refreshHeader();
          this.summaryBand?.updateNames(message.headers);
          const plural = message.headers.length === 1 ? "" : "s";
          this.setAction(`Renamed ${message.headers.length} column${plural}`);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private applyClean(updates: CleanUpdate[]): void {
    if (updates.length === 0) return;
    this.queueSend(() =>
      this.client
        .cleanColumns(updates)
        .then((message) => {
          this.transformOps = [];
          this.transformBaseSchema = [];
          for (const update of updates) {
            this.filters.delete(update.column);
            if (update.ops.length === 0) this.cleanedColumns.delete(update.column);
            else this.cleanedColumns.set(update.column, update.ops);
          }
          for (const { column, meta } of message.columns) {
            this.metas[column] = meta;
            this.filterPanel?.updateMeta(column, meta);
            this.table?.updateColumn(column, meta);
            this.summaryBand?.updateColumn(column, meta);
          }
          this.summaryBand?.setCounts(message.stats);
          this.table?.setSort(-1, 1);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
          const reverted = updates.every((update) => update.ops.length === 0);
          const name = message.columns[0]?.meta.name ?? "";
          const label =
            updates.length === 1 ? name : `${updates.length} columns`;
          this.setAction(reverted ? `Reverted ${label}` : `Cleaned ${label}`);
          this.updateStepsButton();
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private applyNullPolicy(column: number, extra: string[], keep: string[]): void {
    this.queueSend(() =>
      this.client
        .setNullPolicy(column, extra, keep)
        .then((message) => {
          this.filters.delete(column);
          for (const { column: index, meta } of message.columns) {
            this.metas[index] = meta;
            this.filterPanel?.updateMeta(index, meta);
            this.table?.updateColumn(index, meta);
            this.summaryBand?.updateColumn(index, meta);
          }
          this.summaryBand?.setCounts(message.stats);
          this.table?.setSort(-1, 1);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
          this.setAction(
            `Nulls resolved — ${(message.columns[0]?.meta.stats.nulls ?? 0).toLocaleString()} blanks in ${message.columns[0]?.meta.name ?? "column"}`,
          );
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private applyNullPolicyAll(extra: string[], keep: string[]): void {
    this.queueSend(() =>
      this.client
        .resolveNullsAll(extra, keep)
        .then((message) => {
          this.filters.clear();
          for (const { column, meta } of message.columns) this.metas[column] = meta;
          this.table?.updateColumns(this.metas);
          for (const { column, meta } of message.columns) {
            this.summaryBand?.updateColumn(column, meta);
          }
          this.summaryBand?.setCounts(message.stats);
          this.filterPanel?.rebuild();
          this.table?.setSort(-1, 1);
          this.filterPanel?.applyResults(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, message.firstGroups, message.firstFlags);
          this.setAction(
            `Nulls resolved — ${message.stats.totalNullCells.toLocaleString()} blanks`,
          );
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private openTransform(): void {
    if (this.datasetName === "" || this.loading) return;
    this.setStage("transform");
    const baseSchema =
      this.transformBaseSchema.length > 0
        ? this.transformBaseSchema
        : this.metas.map((meta) => ({
            name: meta.name,
            numeric: meta.type === "integer" || meta.type === "number",
          }));
    openTransformPanel(this.transformOps, baseSchema, {
      onApply: (ops) => this.applyTransform(ops),
      onPreview: (ops) => this.client.previewTransform(ops),
      onClose: () => this.setStage("view"),
    });
  }

  private applyTransform(ops: TransformOp[]): void {
    this.queueSend(() =>
      this.client
        .transform(ops)
        .then((message) => {
          this.openWorkspace(message);
          const plural = ops.length === 1 ? "" : "s";
          this.setAction(
            ops.length === 0 ? "Transforms reset" : `Applied ${ops.length} transform step${plural}`,
          );
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }
}
