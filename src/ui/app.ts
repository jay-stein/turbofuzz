import { DELIMITER_LABELS, type Delimiter } from "../parse/delimiter.js";
import {
  listArchiveEntries,
  readArchiveEntry,
  readArchivePrefixes,
  type ArchiveEntry,
} from "../parse/archive.js";
import { decompressBzip2 } from "../parse/bz2.js";
import { decodeText } from "../parse/encoding.js";
import { parseDelimited, sameHeaderRow } from "../parse/parse.js";
import { detectTable } from "../parse/header-detect.js";
import { listLegacySheets, readLegacySheet } from "../parse/xls.js";
import { listWorkbookSheets, readWorkbookSheet } from "../parse/xlsx.js";
import type { ColumnFilter } from "../search/query-engine.js";
import {
  detectArchetypes,
  type ArchetypeId,
} from "../data/archetype.js";
import type { ViewDef } from "../data/aggregate.js";
import { describeCleanOp, describeCleanOpDetail, type CleanOp } from "../data/clean-ops.js";
import { pandasRecipeScript, type RecipeInput, viewToPandas } from "../data/recipe.js";
import { polarsRecipeScript } from "../data/recipe-polars.js";
import { supportHint, type RecipeScript, type RecipeTarget } from "../data/recipe-support.js";
import {
  matchColumns,
  parseRecipeFile,
  planReplay,
  type RecipeFile,
  type RecipeFileType,
  type ReplayPlan,
} from "../data/recipe-file.js";
import type { ColumnSuggestion } from "../data/suggestions.js";
import {
  describeTransformOp,
  describeTransformOpDetail,
  schemaAfter,
  type ColumnSchema,
  type DedupeKeep,
  type TransformOp,
} from "../data/transform-ops.js";
import type { NumberLocale } from "../parse/numbers.js";
import type { WorkBook } from "xlsx";
import { TYPE_LABELS, type ColumnType } from "../types.js";
import type {
  AggregateMessage,
  CleanUpdate,
  ColumnMeta,
  CorrelationMessage,
  ExportScope,
  LoadedMessage,
  ProgressMessage,
  SpecialKind,
  TransformedMessage,
} from "../worker/protocol.js";
import { clear, el, svgIcon } from "./dom.js";
import { openDedupeMenu } from "./dedupe-menu.js";
import { openMenu } from "./menu.js";
import { buildColumnCard } from "./summary-band.js";
import { Overview, delimiterLabel, readDefaultView } from "./overview.js";
import type { DatasetStats } from "../data/stats.js";
import { FilterPanel } from "./filters.js";
import { ChartsPanel, remapChartConfigs, type NamedChartCardConfig } from "./chart-panel.js";
import { openHelpDrawer } from "./help-drawer.js";
import { Hints } from "./hints.js";
import { sampleCsv } from "./sample.js";
import {
  applyThemePreference,
  nextThemePreference,
  readThemePreference,
  themeLabel,
  type ThemePreference,
} from "./theme.js";
import { ResultTable, type ColumnQaKind, type HighlightRule } from "./table.js";
import { openStatsModal } from "./stats.js";
import { LoadCancelledError, SearchWorkerClient } from "./worker-client.js";
import { openCleanPanel } from "./clean-panel.js";
import { openConfirm, openPrompt } from "./dialog.js";
import {
  estimateFromBuffer,
  estimateFromText,
  LARGE_LOAD_CELLS,
  openLargeLoadDialog,
  SAMPLE_ROWS,
} from "./load-guard.js";
import { isParquetName } from "../parse/parquet.js";
import { openRecipeMapping } from "./recipe-mapping.js";
import { openExportPanel } from "./export-panel.js";
import { openMergePanel } from "./merge-panel.js";
import { groupSteps, openStepsPanel, type StepsPanelEntry } from "./steps-panel.js";
import { openTransformPanel } from "./transform-panel.js";
import { ViewTabs, type ViewId } from "./view-tabs.js";
import { ViewsPanel } from "./views-panel.js";
import { openCommandBar, type ParsedCommand } from "./command-bar.js";
import { openTriagePanel, type TriagePanelHandle } from "./triage-panel.js";
import { openColumnInspector } from "./column-inspector.js";
import { openSlickTable } from "./slick-table.js";
import { chartKindFor } from "./chart-utils.js";
import { ReportsPanel } from "./reports-panel.js";
import type { Finding } from "../data/findings.js";
import { suggestCharts } from "./chart-utils.js";

const LARGE_PASTE_ROWS = 300_000;
/** Bytes read from each archive entry for the Import-all header check. */
const HEADER_PREFIX_BYTES = 131_072;
/** Estimated cells (rows x columns) above which Import all is refused. */
const MAX_APPEND_CELLS = 20_000_000;
const SIDEBAR_COLLAPSED_KEY = "turbofuzz.filters.collapsed";
const COLUMN_TILES_KEY = "turbofuzz.table.tiles";

function readColumnTilesPreference(): boolean {
  try {
    return sessionStorage.getItem(COLUMN_TILES_KEY) === "true";
  } catch {
    return false;
  }
}
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

interface PickerItem {
  label: string;
  rows: number;
  columns: number;
  detail?: string;
  onSelect: () => void;
}

/** Optional bulk action shown above the picker list (e.g. ZIP Import all). */
interface PickerBulk {
  label: string;
  title: string;
  note?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** Reversible missing-value policy change, logged in the Recipe. */
interface NullEdit {
  column: number;
  label: string;
  detail: string;
  previousExtra: string[];
  previousKeep: string[];
  /** True for the "apply to all columns" action, where column is -1. */
  all?: boolean;
}

/** Reversible column type (interpretation) change, logged in the Recipe. */
interface TypeEdit {
  column: number;
  label: string;
  detail: string;
  previous: ColumnType;
}

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

/** Compact row estimate for the Import-all label: 3.7M, 480k, 950. */
function formatApproxRows(rows: number): string {
  if (rows >= 1_000_000) return `${(rows / 1_000_000).toFixed(1)}M`;
  if (rows >= 1_000) return `${Math.round(rows / 1_000)}k`;
  return String(Math.max(0, Math.round(rows)));
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

function uploadIcon(): SVGElement {
  return svgIcon(
    '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    "dropzone-icon",
  );
}

function lockIcon(): SVGElement {
  return svgIcon(
    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    "privacy-icon",
  );
}

/** Dice icon for the shuffle control: a die with pips. */
function diceIcon(): SVGElement {
  return svgIcon(
    '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/>' +
      '<circle cx="8.4" cy="8.4" r="1.25" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.6" cy="15.6" r="1.25" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
    "shuffle-icon",
  );
}

/** 2×2 grid icon for the column-tiles toggle. */
function tilesIcon(): SVGElement {
  return svgIcon(
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    "tiles-icon",
  );
}

/** Check mark shown in place of the grid while the tiles strip is on. */
function checkIcon(): SVGElement {
  return svgIcon('<path d="m5 12.5 4.5 4.5L19 7"/>', "tiles-check");
}

/** Mini bar chart shown while hovering the Info Tiles toggle. */
function tilesChartIcon(): SVGElement {
  return svgIcon(
    '<path d="M4 19.5h16"/>' +
      '<rect x="5" y="11" width="3.4" height="8.5" rx="1"/>' +
      '<rect x="10.3" y="6.5" width="3.4" height="13" rx="1"/>' +
      '<rect x="15.6" y="13.5" width="3.4" height="6" rx="1"/>',
    "tiles-chart",
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
  private readonly nullEdits: NullEdit[] = [];
  private readonly typeEdits: TypeEdit[] = [];
  private transformOps: TransformOp[] = [];
  private transformBaseSchema: ColumnSchema[] = [];
  /** Sizes of the transform commits, in op order, for Recipe batches. */
  private transformCommitSizes: number[] = [];
  private filterPanel: FilterPanel | null = null;
  private table: ResultTable | null = null;

  private pasteView!: HTMLElement;
  private pasteCancel!: HTMLButtonElement;
  private workspace!: HTMLElement;
  private textarea!: HTMLTextAreaElement;
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
  private loadPanel!: HTMLElement;
  private loadTitle!: HTMLElement;
  private loadDetail!: HTMLElement;
  private loadBar!: HTMLElement;
  private loadCancel!: HTMLButtonElement;
  /** Banner note recorded when a large load is taken as a sample. */
  private sampleNote: string | null = null;
  private metaEl!: HTMLElement;
  private countEl!: HTMLElement;
  private actionEl!: HTMLElement;
  private copyButton!: HTMLButtonElement;
  private exportButton!: HTMLButtonElement;
  private newButton!: HTMLButtonElement;
  private stepsButton!: HTMLButtonElement;
  private exportNullAsBlank = true;
  private exportEscapeFormulas = true;
  private exportLimit: number | null = null;
  private bannerEl!: HTMLElement;
  private healthHost!: HTMLElement;
  private healthChipCount = 0;
  private moreButton!: HTMLButtonElement;
  private readonly specials = new Set<SpecialKind>();
  private readonly columnSpecials = new Map<number, Set<ColumnQaKind>>();
  private readonly pendingRowDeletes = new Set<number>();
  private readonly pendingColumnDeletes = new Set<number>();
  private excludedRowCount = 0;
  private resultCount = 0;
  private deleteBar!: HTMLElement;
  private deleteBarText!: HTMLElement;
  private shuffleButton!: HTMLButtonElement;
  private shuffleActive = false;
  private tilesButton!: HTMLButtonElement;
  private changesButton!: HTMLButtonElement;
  private changesTotal = 0;
  private showChanges = false;
  /** Display-only fixed decimals per column (not part of the data/Recipe). */
  private displayFormats = new Map<number, number>();
  private columnsStrip!: HTMLElement;
  private tilesOn = readColumnTilesPreference();
  private filterHost!: HTMLElement;
  private filterSearch!: HTMLInputElement;
  private tableHost!: HTMLElement;
  private chartHost!: HTMLElement;
  private chartsPanel: ChartsPanel | null = null;
  private chartActive = false;
  private chartRestore: NamedChartCardConfig[] | null = null;
  private chartRemoved = 0;
  private chartOpened = false;
  private view: ViewId = "overview";
  private lastLens: ViewId = "table";
  private tabs: ViewTabs | null = null;
  private overviewHost!: HTMLElement;
  private overview: Overview | null = null;
  private latestStats: DatasetStats | null = null;
  /** Input size in bytes for the dataset line (file or pasted text). */
  private sourceBytes: number | null = null;
  private sidebarEl!: HTMLElement;
  private sidebarToggle!: HTMLButtonElement;
  private sidebarCollapsed = false;
  private filterChipsEl!: HTMLElement;
  private addFilterButton!: HTMLButtonElement;
  private latestFacets: Record<number, number[]> = {};
  private latestHistograms: Record<number, number[]> = {};
  private themeButton!: HTMLButtonElement;
  private themePreference: ThemePreference = readThemePreference();
  private viewsHost!: HTMLElement;
  private viewsPanel: ViewsPanel | null = null;
  private reportsHost!: HTMLElement;
  private reportsPanel: ReportsPanel | null = null;
  private triage: TriagePanelHandle | null = null;
  private archetypeOverride: ArchetypeId | null = null;
  private lastLoaded: LoadedMessage | TransformedMessage | null = null;
  private workspaceTitle!: HTMLElement;
  private tabHost!: HTMLElement;
  private hints: Hints | null = null;

  constructor(private readonly root: HTMLElement) {
    this.buildShell();
    this.bindEvents();
    this.client.onProgress((progress) => this.handleProgress(progress));
    this.hints = new Hints([
      {
        id: "tabs",
        text: "Overview, Table, Views, Chart and Reports are lenses — switch anytime with 1–5.",
        target: () => (this.workspace.classList.contains("hidden") ? null : this.tabHost),
      },
      {
        id: "command-bar",
        text: "“Do something…” in the toolbar (or Ctrl/⌘ + K) opens the command bar — “upper amount”, “convert date_time to datetime”, “group region sum sales”.",
        target: () => (this.workspace.classList.contains("hidden") ? null : this.tabHost),
      },
      {
        id: "column-menu",
        text: "Click a column name to inspect it — profile, issues and one-click fixes. Right-click for the full menu.",
        target: () =>
          this.tableHost.classList.contains("hidden")
            ? null
            : this.tableHost.querySelector<HTMLElement>(".th"),
      },
      {
        id: "process-log",
        text: "Every clean and transform lands in the Recipe, where you can undo it.",
        target: () =>
          this.workspace.classList.contains("hidden") ? null : this.stepsButton,
      },
      {
        id: "column-tiles",
        text: "Miss the column summary? “Info Tiles” shows it above the table while you work.",
        target: () =>
          this.view === "table" && !this.tilesButton.classList.contains("hidden")
            ? this.tilesButton
            : null,
      },
      {
        id: "placeholder-action",
        text: "Placeholder text like “N/A” is counted as missing — “Convert to nulls” blanks those cells for real.",
        target: () =>
          this.healthHost.querySelector<HTMLElement>(".placeholder-action"),
      },
    ]);
  }

  private buildShell(): void {
    clear(this.root);

    const topbar = el("header", { class: "topbar" });
    topbar.append(el("div", { class: "brand" }, ["TurboFuzz"]));
    this.metaEl = el("div", { class: "meta" });
    topbar.append(this.metaEl);

    const helpButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Open the user guide" },
      ["Help"],
    );
    helpButton.addEventListener("click", () => openHelpDrawer());

    this.themeButton = el(
      "button",
      {
        class: "ghost small",
        type: "button",
        title: "Cycle Auto → Light → Dark. Auto follows your operating system.",
      },
      [`Theme: ${themeLabel(this.themePreference)}`],
    ) as HTMLButtonElement;
    this.themeButton.addEventListener("click", () => {
      this.themePreference = nextThemePreference(this.themePreference);
      applyThemePreference(this.themePreference);
      this.themeButton.textContent = `Theme: ${themeLabel(this.themePreference)}`;
    });
    if (typeof window.matchMedia === "function") {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          if (this.themePreference === "auto") applyThemePreference("auto");
        });
    }
    const paletteButton = el(
      "button",
      {
        class: "ghost small palette-button",
        type: "button",
        title: "Type a command — e.g. “convert date_time to datetime”, “upper amount”, “group region sum sales”",
      },
      ["Do something…", el("span", { class: "kbd" }, ["Ctrl/⌘ K"])],
    ) as HTMLButtonElement;
    paletteButton.addEventListener("click", () => this.openPalette());
    topbar.append(paletteButton, this.themeButton, helpButton);

    this.newButton = el("button", { class: "ghost", type: "button" }, ["New data"]);
    this.newButton.title = "Load a CSV, Excel, JSON or Parquet file";
    this.newButton.addEventListener("click", () => this.onNewDataClick());
    topbar.append(this.newButton);

    this.pasteView = this.buildPasteView();
    this.workspace = this.buildWorkspace();
    const main = el("main", { class: "app-main" });
    main.append(this.pasteView, this.workspace);
    this.root.append(topbar, main);
    // A browser OOM kills the worker with its dataset: restart cleanly and
    // tell the user what happened instead of leaving the app stuck.
    this.client.onCrash(() => this.handleWorkerCrash());
  }

  private buildPasteView(): HTMLElement {
    const view = el("div", { class: "paste-view" });
    const card = el("div", { class: "paste-card" });

    this.pasteCancel = el(
      "button",
      { class: "icon-btn", type: "button", title: "Back to the table" },
      ["×"],
    );
    this.pasteCancel.classList.add("hidden");
    this.pasteCancel.addEventListener("click", () => this.hidePaste());
    card.append(
      el("div", { class: "paste-head" }, [
        el("h1", {}, ["Clean and reshape tables in your browser"]),
        this.pasteCancel,
      ]),
    );
    card.append(
      el("p", { class: "sub" }, [
        "Drop a messy CSV or Excel file. Type-aware cleanup, transforms and search — all offline, nothing leaves this tab.",
      ]),
    );
    card.append(
      el("p", { class: "sub sub-formats" }, [
        "CSV · TSV · PSV · JSON · Excel (.xlsx/.xls) · Parquet · ZIP/GZ/BZ2 — limited only by your browser's memory.",
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
      el("span", {}, [
        "0 bytes uploaded · 0 network requests — files are parsed in this browser",
      ]),
    ]);
    card.append(dropzone, privacy);

    this.loadPanel = el("div", {
      class: "load-progress hidden",
      role: "status",
      "aria-live": "polite",
    });
    this.loadTitle = el("span", { class: "load-progress-title" });
    this.loadDetail = el("span", { class: "load-progress-detail" });
    const loadHead = el("div", { class: "load-progress-head" });
    loadHead.append(
      el("span", { class: "load-spinner", "aria-hidden": "true" }),
      this.loadTitle,
      this.loadDetail,
    );
    const loadTrack = el("div", { class: "load-progress-track" });
    this.loadBar = el("div", { class: "load-progress-bar indeterminate" });
    loadTrack.append(this.loadBar);
    this.loadCancel = el(
      "button",
      { class: "ghost load-cancel", type: "button" },
      ["Cancel"],
    ) as HTMLButtonElement;
    this.loadCancel.title = "Stop this import — the current data stays loaded";
    this.loadCancel.addEventListener("click", () => this.cancelLoad());
    this.loadPanel.append(loadHead, loadTrack, this.loadCancel);
    card.append(this.loadPanel);

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

    const sampleButton = el("button", { class: "ghost small", type: "button" }, [
      "Try sample data",
    ]);
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

    const tabHost = el("div");
    this.tabHost = tabHost;
    this.tabs = new ViewTabs(tabHost, { onChange: (view) => this.setView(view) });

    this.stepsButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Review, undo or export the applied changes" },
      ["Recipe"],
    ) as HTMLButtonElement;
    this.stepsButton.addEventListener("click", () => this.openSteps());

    this.exportButton = el(
      "button",
      {
        class: "primary small",
        type: "button",
        title: "Choose a file name and format, then export",
      },
      ["Export…"],
    ) as HTMLButtonElement;
    this.exportButton.addEventListener("click", () => this.openExportDialog());

    const navRow = el("div", { class: "nav-row" }, [
      tabHost,
      el("span", { class: "grow" }),
      this.stepsButton,
      this.exportButton,
    ]);

    const sidebar = el("aside", { class: "sidebar hidden" });
    this.sidebarEl = sidebar;
    const sidebarHead = el("div", { class: "sidebar-head" });
    this.sidebarToggle = el(
      "button",
      { class: "icon-btn sidebar-toggle", type: "button", title: "Collapse filters" },
      ["«"],
    ) as HTMLButtonElement;
    this.sidebarToggle.addEventListener("click", () =>
      this.setSidebarCollapsed(!this.sidebarCollapsed),
    );
    sidebarHead.append(
      this.sidebarToggle,
      el("span", { class: "sidebar-title" }, ["Filters"]),
    );
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

    this.shuffleButton = el(
      "button",
      {
        class: "ghost small shuffle-button",
        type: "button",
        title: "Show every row in a random order",
        "aria-label": "Shuffle data",
      },
      [],
    ) as HTMLButtonElement;
    this.shuffleButton.append(
      diceIcon(),
      el("span", { class: "shuffle-label" }, ["Shuffle data"]),
    );
    this.shuffleButton.addEventListener("click", () => this.shuffleRows());

    this.healthHost = el("span", { class: "health-host hidden" });
    this.tilesButton = el(
      "button",
      {
        class: "ghost small tiles-toggle",
        type: "button",
        title: "Show a column summary strip above the table while you work (T)",
        "aria-pressed": "false",
      },
      [],
    ) as HTMLButtonElement;
    this.tilesButton.classList.add("hidden");
    this.tilesButton.append(
      tilesIcon(),
      tilesChartIcon(),
      checkIcon(),
      el("span", { class: "tiles-label" }, ["Info Tiles"]),
    );
    this.tilesButton.addEventListener("click", () => this.toggleColumnTiles());
    this.changesButton = el(
      "button",
      {
        class: "ghost small changes-toggle hidden",
        type: "button",
        title: "Highlight cells whose value changed since load",
        "aria-pressed": "false",
      },
      ["Show changes"],
    ) as HTMLButtonElement;
    this.changesButton.addEventListener("click", () => {
      this.showChanges = !this.showChanges;
      this.table?.setShowChanges(this.showChanges);
      this.syncChangesButton();
    });
    this.filterChipsEl = el("span", { class: "filter-chips hidden" });
    this.addFilterButton = el(
      "button",
      {
        class: "ghost small add-filter",
        type: "button",
        title: "Search for a column to filter",
      },
      ["+ Add filter"],
    ) as HTMLButtonElement;
    this.addFilterButton.addEventListener("click", () => this.openAddFilter(this.addFilterButton));
    this.moreButton = el(
      "button",
      {
        class: "icon-btn",
        type: "button",
        title: "More actions",
        "aria-label": "More actions",
      },
      ["⋯"],
    ) as HTMLButtonElement;
    this.moreButton.addEventListener("click", () => this.openMoreMenu(this.moreButton));

    resultsRow.append(
      this.countEl,
      this.filterChipsEl,
      this.addFilterButton,
      this.healthHost,
      this.tilesButton,
      this.changesButton,
      el("span", { class: "grow" }),
      this.actionEl,
      this.shuffleButton,
      this.copyButton,
      this.moreButton,
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
    this.chartHost = el("div", { class: "chart-host hidden" });
    this.viewsHost = el("div", { class: "views-host hidden" });
    this.reportsHost = el("div", { class: "reports-host hidden" });
    this.columnsStrip = el("div", { class: "column-strip hidden" });
    results.append(
      resultsBar,
      this.columnsStrip,
      this.tableHost,
      this.chartHost,
      this.viewsHost,
      this.reportsHost,
    );

    this.overviewHost = el("div", { class: "overview-host hidden" });
    this.overview = new Overview(this.overviewHost, {
      onOpenTable: () => this.setView("table"),
      onOpenChart: () => this.setView("chart"),
      onFilterColumn: (column) => this.focusFilterColumn(column),
      onCleanColumn: (column) => this.openClean(column, "values"),
      onOpenCleanNulls: () => this.openClean(undefined, "nulls"),
      onDedupe: (anchor) => {
        const stats = this.latestStats;
        if (stats !== null) openDedupeMenu(anchor, stats, (keep) => this.dropDuplicates(keep));
      },
      onOpenMerge: (column) => this.openMerge(column),
      onReviewColumn: (column) => this.focusFilterColumn(column),
      onDropColumn: (column) => this.dropEmptyColumns([column]),
      onOpenStats: () => this.openStats(),
      onCombineDate: (op) =>
        this.applyTransform([...this.transformOps, op], "Combined the date columns"),
      onBlankTokens: (tokens) => this.applyNullPolicyAll(tokens, []),
      onArchetypeChange: (id) => {
        this.archetypeOverride = id;
        this.rerenderOverview();
      },
      onOpenTriage: () => this.openTriage(),
    });
    const body = el("div", { class: "workspace-body" }, [sidebar, results]);
    workspace.append(navRow, this.overviewHost, body);
    return workspace;
  }

  /** Opens the fuzzy command palette (Ctrl/⌘+K or the "Do something…" button). */
  private openPalette(): void {
    if (this.workspace.classList.contains("hidden")) return;
    openCommandBar({
      columns: () => this.metas,
      onRun: (command) => this.runCommand(command),
    });
  }

  private bindEvents(): void {
    this.textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.loadFromTextarea();
      }
    });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (this.workspace.classList.contains("hidden")) return;
        event.preventDefault();
        this.openPalette();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (this.workspace.classList.contains("hidden")) return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "1") this.setView("overview");
      else if (event.key === "2") this.setView("table");
      else if (event.key === "3") this.setView("views");
      else if (event.key === "4") this.setView("chart");
      else if (event.key === "5") this.setView("reports");
      else if (
        (event.key === "t" || event.key === "T") &&
        this.view === "table"
      ) {
        this.toggleColumnTiles();
      }
    });
  }

  private async loadFromTextarea(): Promise<void> {
    const text = this.textarea.value;
    if (text.trim() === "") {
      this.statusEl.textContent = "Paste some data first.";
      this.statusEl.classList.add("error");
      return;
    }
    const bytes = new TextEncoder().encode(text).byteLength;
    this.showLoadProgress("Pasted data", bytes);
    this.sampleNote = null;
    let maxRows: number | undefined;
    const estimate = estimateFromText(bytes, text);
    if (estimate !== null && estimate.cells > LARGE_LOAD_CELLS) {
      const choice = await openLargeLoadDialog(estimate, "Pasted data");
      if (choice === null) {
        this.hideLoadProgress();
        this.statusEl.classList.remove("error");
        this.statusEl.textContent = "Import cancelled — nothing was loaded.";
        return;
      }
      if (choice === "sample") {
        maxRows = SAMPLE_ROWS;
        this.sampleNote = `sample: first ${SAMPLE_ROWS.toLocaleString()} rows of ≈${estimate.rows.toLocaleString()}`;
      }
    }
    void this.load({ text, name: "Pasted data", source: "paste", maxRows });
  }

  private async load(options: {
    text?: string;
    buffer?: ArrayBuffer;
    name: string;
    source: "paste" | "file";
    maxRows?: number;
  }): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.generation++;
    this.pendingSend = null;
    this.hideTablePicker();
    this.setLoadingText("Parsing…");
    this.sourceBytes =
      options.text !== undefined
        ? new TextEncoder().encode(options.text).byteLength
        : (options.buffer?.byteLength ?? null);

    try {
      const loaded = await this.client.load({
        name: options.name,
        delimiter: this.delimiterSelect.value as Delimiter | "auto",
        hasHeaders: this.headersCheckbox.checked,
        text: options.text,
        buffer: options.buffer,
        maxRows: options.maxRows,
      });
      this.statusEl.textContent = "";
      this.hideLoadProgress();
      this.openWorkspace(loaded);
    } catch (error) {
      if (error instanceof LoadCancelledError) {
        this.hideLoadProgress();
        this.statusEl.classList.remove("error");
        this.statusEl.textContent = this.lastLoaded
          ? "Import cancelled — the loaded data is unchanged."
          : "Import cancelled — nothing was loaded.";
      } else {
        const reason = error instanceof Error ? error.message : "unknown error";
        this.setStatusError(
          `Could not read ${options.name}: ${reason}. ${
            this.lastLoaded
              ? "The previous dataset is unchanged — fix the file or choose another."
              : "Try another file or check the format."
          }`,
        );
      }
    } finally {
      this.loading = false;
    }
  }

  private hideTablePicker(): void {
    this.tablePickerEl.classList.add("hidden");
  }

  private showPicker(title: string, items: PickerItem[], bulk?: PickerBulk): void {
    this.hideLoadProgress();
    clear(this.tablePickerList);
    this.tablePickerTitle.textContent = title;

    if (bulk !== undefined) {
      const option = el("button", {
        class: "table-option table-option-bulk",
        type: "button",
        title: bulk.title,
      }) as HTMLButtonElement;
      option.disabled = bulk.disabled === true;
      option.append(el("span", { class: "table-option-name" }, [bulk.label]));
      if (bulk.note !== undefined) {
        option.append(el("span", { class: "table-option-size" }, [bulk.note]));
      }
      option.addEventListener("click", () => {
        if (!option.disabled) bulk.onSelect();
      });
      this.tablePickerList.append(option);
    }

    items.forEach((item) => {
      const option = el("button", { class: "table-option", type: "button" });
      option.append(el("span", { class: "table-option-name" }, [item.label]));
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

  private async loadFile(file: File): Promise<void> {
    try {
      this.showLoadProgress(file.name, file.size);
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
      const maxRows = await this.confirmLargeBuffer(buffer, file.name);
      if (maxRows === "cancel") return;
      await this.load({
        buffer,
        name: file.name,
        source: "file",
        maxRows: maxRows === "sample" ? SAMPLE_ROWS : undefined,
      });
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not read file");
    }
  }

  /**
   * Pre-flight guard for very large files: estimates rows × columns from the
   * first 256 KB and asks how to proceed. Returns "all", "sample" or
   * "cancel" (also updating the sample banner note).
   */
  private async confirmLargeBuffer(
    buffer: ArrayBuffer,
    fileName: string,
  ): Promise<"all" | "sample" | "cancel"> {
    this.sampleNote = null;
    if (isParquetName(fileName)) return "all";
    const estimate = estimateFromBuffer(buffer.byteLength, buffer);
    if (estimate === null || estimate.cells <= LARGE_LOAD_CELLS) return "all";
    const choice = await openLargeLoadDialog(estimate, fileName);
    if (choice === null) {
      this.hideLoadProgress();
      this.statusEl.classList.remove("error");
      this.statusEl.textContent = "Import cancelled — nothing was loaded.";
      return "cancel";
    }
    if (choice === "sample") {
      this.sampleNote = `sample: first ${SAMPLE_ROWS.toLocaleString()} rows of ≈${estimate.rows.toLocaleString()}`;
    }
    return choice;
  }

  /** Lists data files inside a ZIP and loads the only one or shows a picker. */
  private async openArchive(buffer: ArrayBuffer, fileName: string): Promise<void> {
    this.hideTablePicker();
    this.setLoadingText("Reading archive…");
    try {
      const entries = await listArchiveEntries(buffer);
      if (entries.length === 0) {
        throw new Error("No CSV, TSV, PSV, TXT, XLSX or XLS files found in that archive");
      }
      if (entries.length === 1) {
        await this.openArchiveEntry(entries[0], fileName, buffer);
        return;
      }

      this.setLoadingText("");
      const pickItems = entries.map((entry) => ({
        label: entry.path,
        rows: 0,
        columns: 0,
        detail: formatBytes(entry.size),
        onSelect: () => {
          this.hideTablePicker();
          void this.openArchiveEntry(entry, fileName, buffer);
        },
      }));
      // Delimited files can be appended into one table when every file's
      // first row matches; workbooks still need a single pick.
      const allDelimited = entries.every(
        (entry) => !WORKBOOK_EXTENSIONS.includes(extensionOf(entry.name)),
      );
      if (allDelimited) {
        const check = await this.checkArchiveHeaders(entries, buffer);
        this.setLoadingText("");
        if (check.ok) {
          const estimatedCells = check.estimatedRows * check.headers.length;
          const tooBig = estimatedCells > MAX_APPEND_CELLS;
          const sizeNote = `~${formatApproxRows(check.estimatedRows)} rows × ${check.headers.length.toLocaleString()} columns`;
          this.showPicker(
            `${entries.length} files in ${fileName} — pick one, or append them all`,
            pickItems,
            {
              label: `Import all ${entries.length} files (append rows)`,
              title: tooBig
                ? `${sizeNote} — over the in-browser append limit; load one file at a time instead`
                : "The first row matches in every file — concatenate them into one table",
              note: tooBig
                ? `${sizeNote} — too large to append in the browser; pick one file instead`
                : `${sizeNote} · first row identical in all ${entries.length} files`,
              disabled: tooBig,
              onSelect: () => {
                this.hideTablePicker();
                void this.importArchiveTables(entries, buffer, fileName, check.headers);
              },
            },
          );
          return;
        }
        this.showPicker(
          `${entries.length} files in ${fileName} — pick one, or append them all`,
          pickItems,
          {
            label: `Import all ${entries.length} files (append rows)`,
            title: check.reason,
            note: check.reason,
            disabled: true,
            onSelect: () => undefined,
          },
        );
        return;
      }
      this.showPicker(`${entries.length} files in ${fileName} — pick one`, pickItems);
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not read archive");
    }
  }

  private async openArchiveEntry(
    entry: ArchiveEntry,
    fileName: string,
    archive: ArrayBuffer,
  ): Promise<void> {
    this.setLoadingText(`Extracting “${entry.name}”…`);
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
      this.setLoadingText("");
      await this.load({
        buffer: data,
        name: `${fileName.replace(/\.zip$/i, "")}/${entry.path}`,
        source: "file",
      });
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not extract file");
    }
  }

  /**
   * Tests whether every delimited archive entry's first row matches, reading
   * only a prefix of each entry so huge ZIPs stay fast and memory-bounded.
   * The estimated row count guards Import all against the browser's limits.
   */
  private async checkArchiveHeaders(
    entries: readonly ArchiveEntry[],
    archive: ArrayBuffer,
  ): Promise<
    { ok: true; headers: string[]; estimatedRows: number } | { ok: false; reason: string }
  > {
    try {
      this.setLoadingText(`Checking headers… 0/${entries.length}`);
      const prefixes = await readArchivePrefixes(
        archive,
        entries.map((entry) => entry.path),
        HEADER_PREFIX_BYTES,
        {
          onProgress: (done, total) => this.setLoadingText(`Checking headers… ${done}/${total}`),
        },
      );
      let headers: string[] | null = null;
      let bytesPerRow = 0;
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry === undefined) continue;
        const prefix = prefixes.get(entry.path);
        if (prefix === undefined) {
          return { ok: false, reason: `“${entry.name}” could not be read` };
        }
        const data = prefix.buffer.slice(
          prefix.byteOffset,
          prefix.byteOffset + prefix.byteLength,
        ) as ArrayBuffer;
        const parsed = parseDelimited(decodeText(data).text, {
          hasHeaders: true,
          normalizeRows: false,
        });
        if (parsed.headers.length === 0) {
          return { ok: false, reason: `“${entry.name}” has no first row to compare` };
        }
        if (headers === null) {
          headers = parsed.headers;
          const lines = parsed.rows.length + 1;
          bytesPerRow = Math.max(1, prefix.byteLength / Math.max(1, lines));
        } else if (!sameHeaderRow(headers, parsed.headers)) {
          return {
            ok: false,
            reason: `“${entry.name}” has different columns — pick a single file instead`,
          };
        }
        this.setLoadingText(`Checking headers… ${index + 1}/${entries.length}`);
      }
      if (headers === null) return { ok: false, reason: "No readable files found" };
      const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
      return { ok: true, headers, estimatedRows: Math.round(totalBytes / bytesPerRow) };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Could not check the files",
      };
    }
  }

  /**
   * Vertically concatenates the checked archive entries into one dataset.
   * Each file is parsed and appended in turn so only one file plus the final
   * grid live in memory; header detection is skipped because the first row
   * was already verified identical in every file.
   */
  private async importArchiveTables(
    entries: readonly ArchiveEntry[],
    archive: ArrayBuffer,
    fileName: string,
    headers: readonly string[],
  ): Promise<void> {
    try {
      const hasHeaders = this.headersCheckbox.checked;
      const grid: string[][] = hasHeaders ? [[...headers]] : [];
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry === undefined) continue;
        this.setLoadingText(`Appending “${entry.name}”… (${index + 1}/${entries.length})`);
        const bytes = await readArchiveEntry(archive, entry.path);
        const data = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const parsed = parseDelimited(decodeText(data).text, { hasHeaders: true });
        if (!hasHeaders) grid.push([...parsed.headers]);
        for (const row of parsed.rows) grid.push(row);
        if (index % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      this.setLoadingText("");
      const base = fileName.replace(/\.zip$/i, "");
      await this.loadTable(grid, `${base} — ${entries.length} files`, hasHeaders);
      this.setAction(
        `Imported ${entries.length} files · ${(hasHeaders ? grid.length - 1 : grid.length).toLocaleString()} rows`,
      );
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not import the files");
    }
  }

  /** Decompresses a .gz and routes the inner file (data, workbook or zip). */
  private async openGzip(buffer: ArrayBuffer, fileName: string): Promise<void> {
    this.hideTablePicker();
    this.setLoadingText("Decompressing…");
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
    this.setLoadingText("Decompressing bzip2…");
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
    this.setLoadingText("");
    await this.load({ buffer: data, name: innerName, source: "file" });
  }

  /** Lists worksheets (biggest first) and either loads the only one or shows a picker. */
  private async openWorkbook(buffer: ArrayBuffer, fileName: string): Promise<void> {
    this.hideTablePicker();
    this.setLoadingText("Reading workbook…");
    this.sourceBytes = buffer.byteLength;
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

      this.setLoadingText("");
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
    this.setLoadingText(`Reading “${sheetName}”…`);
    try {
      const rows =
        pending.kind === "xlsx"
          ? await readWorkbookSheet(pending.buffer, sheetName)
          : await readLegacySheet(pending.workbook, sheetName);
      if (rows.length === 0) throw new Error("That worksheet has no data");
      this.setLoadingText("");
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
    this.setLoadingText("Building table…");

    try {
      const hasHeaders = hasHeadersOverride ?? this.headersCheckbox.checked;
      const loaded = await this.client.load({
        name,
        delimiter: "auto",
        hasHeaders,
        table: { rows, hasHeaders },
      });
      this.statusEl.textContent = "";
      this.hideLoadProgress();
      this.openWorkspace(loaded);
    } catch (error) {
      if (error instanceof LoadCancelledError) {
        this.hideLoadProgress();
        this.statusEl.classList.remove("error");
        this.statusEl.textContent = this.lastLoaded
          ? "Import cancelled — the loaded data is unchanged."
          : "Import cancelled — nothing was loaded.";
      } else {
        const reason = error instanceof Error ? error.message : "unknown error";
        this.setStatusError(
          `Could not build the table: ${reason}. ${
            this.lastLoaded ? "The previous dataset is unchanged." : "Nothing was loaded."
          }`,
        );
      }
    } finally {
      this.loading = false;
    }
  }

  private setStatusError(message: string): void {
    this.hideLoadProgress();
    this.statusEl.textContent = message;
    this.statusEl.classList.add("error");
  }

  /** Prominent feedback from the moment a file is picked. */
  private showLoadProgress(name: string, bytes: number | null): void {
    this.loadTitle.textContent = `Processing ${name}${
      bytes === null ? "" : ` · ${formatBytes(bytes)}`
    }`;
    this.setLoadDetail("Reading file…", null, null);
    this.loadCancel.disabled = false;
    this.statusEl.textContent = "";
    this.statusEl.classList.remove("error");
    this.loadPanel.classList.remove("hidden");
  }

  /** Stops the in-flight import at the worker's next checkpoint. */
  private cancelLoad(): void {
    if (!this.loading) return;
    this.loadCancel.disabled = true;
    this.setLoadDetail("Cancelling…", null, null);
    this.client.cancelLoad();
  }

  private hideLoadProgress(): void {
    this.loadPanel.classList.add("hidden");
  }

  private setLoadDetail(text: string, current: number | null, total: number | null): void {
    this.loadDetail.textContent = text;
    const determinate = current !== null && total !== null && total > 0;
    this.loadBar.classList.toggle("indeterminate", !determinate);
    this.loadBar.style.width = determinate
      ? `${Math.round((current / total) * 100)}%`
      : "";
  }

  /** Routes load-flow text to the panel while it is visible, else the status line. */
  private setLoadingText(text: string): void {
    if (this.loadPanel.classList.contains("hidden")) {
      this.statusEl.textContent = text;
      this.statusEl.classList.remove("error");
      return;
    }
    this.setLoadDetail(text, null, null);
  }

  private setLoadingProgress(text: string, current?: number, total?: number): void {
    if (this.loadPanel.classList.contains("hidden")) return;
    this.setLoadDetail(text, current ?? null, total ?? null);
  }

  private handleProgress(progress: ProgressMessage): void {
    if (progress.phase === "read" || progress.phase === "parse" || progress.phase === "infer") {
      const fallback =
        progress.phase === "read"
          ? "Reading file…"
          : progress.phase === "parse"
            ? "Parsing…"
            : "Inferring schema…";
      this.setLoadingProgress(progress.detail ?? fallback, progress.current, progress.total);
    } else if (progress.phase === "build" || progress.phase === "stats") {
      const fallback = progress.phase === "stats" ? "Computing statistics…" : "Building…";
      this.setLoadingProgress(
        progress.detail ?? fallback,
        progress.current,
        progress.total,
      );
    } else if (progress.phase === "ready") {
      this.setLoadingProgress(progress.detail ?? "Ready");
    } else if (progress.phase === "index" && progress.column !== undefined) {
      this.filterPanel?.setStatus(progress.column, progress.active === true ? "Building index…" : "");
    } else if (progress.phase === "sort") {
      if (progress.active === true) this.countEl.textContent = "Sorting…";
    }
  }

  private openWorkspace(loaded: LoadedMessage | TransformedMessage): void {
    if (loaded.type === "transformed") {
      const captured = this.chartsPanel?.captureConfigs() ?? this.chartRestore;
      if (captured !== null) {
        const remapped = remapChartConfigs(captured, loaded.columns);
        this.chartRestore = remapped.kept;
        this.chartRemoved = remapped.removed;
      }
    } else {
      this.chartRestore = null;
      this.chartRemoved = 0;
    }
    this.metas = loaded.columns;
    this.rowCount = loaded.rowCount;
    this.lastLoaded = loaded;
    if (loaded.type === "loaded") this.archetypeOverride = null;
    // A new dataset starts with a fresh change history and display formats.
    this.changesTotal = 0;
    this.showChanges = false;
    this.displayFormats.clear();
    this.syncChangesButton();
    // Views are definitions over column indexes; a load or transform can change
    // the schema, so start fresh rather than risk stale references.
    this.resetViews();
    this.datasetName = loaded.name;
    this.workspaceTitle.textContent = `${loaded.name} — ${loaded.rowCount.toLocaleString()} rows`;
    this.filters.clear();
    this.renderFilterChips();
    this.cleanedColumns.clear();
    this.nullEdits.length = 0;
    this.typeEdits.length = 0;
    if (loaded.type === "transformed") {
      this.transformOps = loaded.ops;
      this.transformBaseSchema = loaded.baseSchema;
      this.syncTransformBatches();
    } else {
      this.transformOps = [];
      this.transformBaseSchema = [];
      this.transformCommitSizes = [];
    }
    this.specials.clear();
    this.columnSpecials.clear();
    this.excludedRowCount = 0;
    this.clearPendingDeletes();
    this.shuffleActive = false;
    this.updateStepsButton();

    this.pasteView.classList.add("hidden");
    this.workspace.classList.remove("hidden");
    this.updateNewButton();

    const columnsWithNulls = loaded.columns.filter((column) => column.stats.nulls > 0).length;
    const emptyText =
      columnsWithNulls === 0
        ? "no missing values"
        : `${columnsWithNulls} of ${loaded.columnCount} columns have missing values`;
    const duplicateText =
      loaded.stats.duplicateGroups > 0
        ? ` · ${loaded.stats.duplicateGroups.toLocaleString()} duplicate groups (${loaded.stats.duplicateRows.toLocaleString()} redundant rows)`
        : "";
    const encodingText =
      loaded.encoding === null
        ? ""
        : ` · ${loaded.encoding === "utf-8" ? "UTF-8" : loaded.encoding}`;
    const delimiter = delimiterLabel(loaded.delimiter);
    const delimiterText = delimiter === null ? "" : ` · ${delimiter}-separated`;
    const sizeText = this.sourceBytes === null ? "" : ` · ${formatBytes(this.sourceBytes)}`;
    this.metaEl.textContent =
      `${loaded.name} · ${loaded.rowCount.toLocaleString()} × ${loaded.columnCount.toLocaleString()}`;
    this.metaEl.title =
      `${loaded.rowCount.toLocaleString()} rows × ${loaded.columnCount.toLocaleString()} columns` +
      `${sizeText}${delimiterText}${encodingText}${duplicateText} · ${emptyText} · ${Math.round(loaded.ingestMs)} ms`;

    this.table?.dispose();
    this.table = null;
    clear(this.tableHost);

    this.chartsPanel?.dispose();
    this.chartsPanel = null;
    clear(this.chartHost);

    clear(this.filterHost);
    this.filterSearch.value = "";
    this.filterPanel = null;
    this.sidebarEl.classList.add("hidden");
    this.latestFacets = {};
    this.latestHistograms = {};

    this.latestStats = loaded.stats;
    this.overview?.render(
      loaded,
      {
        sizeLabel: this.sourceBytes === null ? null : formatBytes(this.sourceBytes),
      },
      this.archetypeOverride,
    );
    this.refreshMissingness();
    this.renderHealthGroup();
    this.updateCount(loaded.rowCount, 0);
    this.updateGuardrail(loaded, loaded.source === "file" || loaded.type === "transformed");
    if (loaded.type === "transformed" && this.chartRemoved > 0) {
      const count = this.chartRemoved;
      this.showWarning(
        `${count} chart${count === 1 ? "" : "s"} removed because ${
          count === 1 ? "its" : "their"
        } column was deleted.`,
      );
    }
    if (loaded.type === "loaded") {
      this.view = readDefaultView();
      const sidebarPreference = this.readSidebarCollapsed();
      this.setSidebarCollapsed(sidebarPreference ?? loaded.columnCount > 8);
    }
    this.updateChartBadge();
    this.setView(this.view);
  }

  private ensureTable(): void {
    if (this.table !== null) return;
    this.table = new ResultTable(this.tableHost, {
      onSort: (column, dir) => this.changeSort(column, dir),
      onColumnInspect: (column, anchor) => this.openColumnInspector(column, anchor),
      onTypeChange: (column, type) => this.changeType(column, type),
      onColumnSpecial: (column, kind) => this.toggleColumnSpecial(column, kind),
      onMergeSimilar: (column) => this.openMerge(column),
      onColumnContext: (column, x, y) => this.openColumnMenu(column, x, y),
      onToggleColumnDelete: (column) => this.toggleColumnDelete(column),
      onToggleRowDelete: (position) => this.toggleRowDelete(position),
      onSuggestion: (column, suggestion) => this.applySuggestion(column, suggestion),
      onConvertToken: (column, tokens) => this.convertToken(column, tokens),
      onRequestRows: (start, end, done) => {
        void this.client
          .getRows(start, end)
          .then((message) =>
            done(message.start, message.rows, message.groups, message.flags, message.changed),
          )
          .catch(() => done(start, []));
      },
    });
    this.table.setColumns(this.metas);
    this.table.setSort(-1, 1);
    this.table.setCount(this.resultCount);
    this.table.setFormats(this.displayFormats);
    this.table.setShowChanges(this.showChanges);
    this.syncColumnQa();
    this.syncPendingDeletes();
  }

  private ensureCharts(): void {
    if (this.chartsPanel !== null) return;
    this.chartOpened = true;
    this.updateChartBadge();
    this.chartsPanel = new ChartsPanel(this.chartHost, {
      datasetName: () => this.datasetName,
      requestBins: (column, options) => this.client.getChartBins(column, options),
      requestSeries: (input) => this.client.getChartSeries(input),
      requestBoxStats: (input) => this.client.getBoxStats(input),
      requestCrosstab: (input) => this.client.getCrosstab(input),
      requestCorrelation: (columns) => this.client.getCorrelation(columns),
      requestGroupedBins: (input) => this.client.getGroupedBins(input),
      requestViewAggregate: (source) => this.aggregateForSource(source),
      requestAggregate: (view) => this.client.getAggregate(view),
      requestTextProfile: (column) => this.client.getTextProfile(column),
      requestGridCounts: (xColumn, yColumn, bins, measure, groupColumn) =>
        this.client.getGridCounts(xColumn, yColumn, bins, measure, groupColumn),
      requestAnimation: (input) => this.client.getAnimation(input),
      tableSourceLabel: () =>
        this.filters.size === 0 &&
        this.specials.size === 0 &&
        this.columnSpecials.size === 0
          ? "Table"
          : "Table (filtered)",
      onCardAdded: (label) =>
        this.setAction(`Added a ${label} chart — it sits at the end of the grid`),
      onFilter: (column, filter, preview) =>
        this.changeFilter(column, filter, preview ?? false),
      currentFilter: (column) => this.filters.get(column) ?? null,
    });
    if (this.chartRestore !== null) {
      const remapped = remapChartConfigs(this.chartRestore, this.metas);
      this.chartsPanel.restore(remapped.configs, this.metas);
      this.chartRestore = null;
    } else {
      this.chartsPanel.setColumns(this.metas);
    }
    this.chartsPanel.setSources(this.viewSources());
    this.chartsPanel.setFiltered(this.latestFacets, this.latestHistograms);
    this.chartsPanel.setRowCount(this.resultCount);
  }

  /** The view list every Source selector offers, alongside the table. */
  private viewSources(): { id: string; name: string }[] {
    return this.viewsPanel?.sources() ?? [];
  }

  private aggregateForSource(source: string): Promise<AggregateMessage | null> {
    const def = this.viewsPanel?.viewDef(source);
    if (def === undefined) return Promise.resolve(null);
    return this.client.getAggregate(def);
  }

  private ensureFilters(): void {
    if (this.filterPanel !== null) return;
    this.filterPanel = new FilterPanel(this.filterHost, this.metas, this.filters, {
      onFilter: (column, filter, preview) => this.changeFilter(column, filter, preview ?? false),
      onSuggestion: (column, suggestion) => this.applySuggestion(column, suggestion),
    });
    this.sidebarEl.classList.remove("hidden");
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
          this.applyFacets(message.facets, message.histograms);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
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
          ? "Rows are removed from the working set — counts and exports exclude them, and the deletion is undoable from the Recipe. Columns are removed as tracked transform steps."
          : "Columns are removed as tracked transform steps, undoable from the Recipe.",
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
        this.applyFacets(message.facets, message.histograms);
        this.table?.setCount(message.count);
        this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
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
      this.applyFacets(message.facets, message.histograms);
      this.table?.setCount(message.count);
      this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
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
    this.syncHealthChips();

    // Grouping takes over ordering in the worker, so clear the sort indicator.
    if (kind === "duplicates" && active) this.table?.setSort(-1, 1);

    this.queueSend(() =>
      this.client
        .setSpecial(kind, active)
        .then((message) => {
          this.updateCount(message.count, message.queryMs);
          this.applyFacets(message.facets, message.histograms);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private shuffleRows(): void {
    if (this.datasetName === "" || this.loading) return;
    this.queueSend(() =>
      this.client
        .shuffle()
        .then((message) => {
          this.table?.setSort(-1, 1);
          this.shuffleActive = false;
          this.table?.setCount(message.count);
          this.table?.setFirstRows(message.firstRows, undefined, message.firstFlags, message.firstChanged);
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
    this.renderFilterChips();

    this.table?.setHighlights(this.highlightRules());

    this.queueSend(() =>
      this.client
        .setFilter(column, filter, preview)
        .then((message) => {
          this.updateCount(message.count, message.queryMs);
          if (!preview) this.applyFacets(message.facets, message.histograms);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private changeType(column: number, type: ColumnType, record = true): void {
    const hadFilter = this.filters.has(column);
    const name = this.metas[column]?.name ?? `Column ${column + 1}`;
    const previous = this.metas[column]?.type;
    this.queueSend(() =>
      this.client
        .setType(column, type)
        .then((message) => {
          this.metas[column] = message.meta;
          this.filters.delete(column);
          this.renderFilterChips();
          this.refreshCharts();
          if (hadFilter) {
            this.showWarning(
              `Type changed to ${TYPE_LABELS[type]} — the previous filter on “${name}” was cleared.`,
            );
          }
          if (record && previous !== undefined && previous !== type) {
            this.typeEdits.push({
              column,
              label: `${message.meta.name}: type → ${TYPE_LABELS[type]}`,
              detail: `type → ${TYPE_LABELS[previous]} → ${TYPE_LABELS[type]}`,
              previous,
            });
            this.updateStepsButton();
          }
          this.overview?.updateColumn(column, message.meta);
          this.filterPanel?.updateMeta(column, message.meta);
          this.table?.updateColumn(column, message.meta);
          this.applyFacets(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private applySuggestion(column: number, suggestion: ColumnSuggestion): void {
    const meta = this.metas[column];
    switch (suggestion.kind) {
      case "sentinel": {
        const extra = [...new Set([...(meta?.nullPolicy.extra ?? []), suggestion.value])];
        const name = meta?.name ?? `Column ${column + 1}`;
        this.applyNullPolicy(column, extra, meta?.nullPolicy.keep ?? [], {
          label: `${name}: treat “${suggestion.value}” as missing`,
        });
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
      case "time":
      case "duration": {
        // The ambiguous value text stays as-is; the column type decides how
        // ranges, sorting, histograms and exports read it.
        this.changeType(column, suggestion.kind);
        break;
      }
      case "mixedNumber": {
        const existing = this.cleanedColumns.get(column) ?? [];
        this.applyClean([
          { column, ops: [...existing, { kind: "repairDecimal", locale: suggestion.locale }] },
        ]);
        break;
      }
      case "typeConflict": {
        this.changeType(column, "string");
        break;
      }
      case "formula": {
        const existing = this.cleanedColumns.get(column) ?? [];
        this.applyClean([
          { column, ops: [...existing, { kind: "escapeFormulas" }] },
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
          this.renderFilterChips();
          this.refreshCharts();
          this.overview?.updateColumn(column, message.meta);
          this.filterPanel?.updateMeta(column, message.meta);
          this.table?.updateColumn(column, message.meta);
          this.applyFacets(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
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
          this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
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
    this.syncHealthChips();
    this.renderFilterChips();
    this.filterPanel?.rebuild();
    this.table?.setHighlights([]);

    this.queueSend(async () => {
      for (const kind of activeSpecials) await this.client.setSpecial(kind, false);
      for (const [column, kinds] of activeColumnSpecials) {
        for (const kind of kinds) await this.client.setSpecial(kind, false, column);
      }
      const message = await this.client.clearFilters();
      this.updateCount(message.count, message.queryMs);
      this.applyFacets(message.facets, message.histograms);
      this.table?.setCount(message.count);
      this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
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
      {
        nullAsBlank: this.exportNullAsBlank,
        escapeFormulas: this.exportEscapeFormulas,
        scope: "all",
        limit: this.exportLimit,
      },
      {
        allRows: Math.max(0, this.rowCount - this.excludedRowCount),
        filteredRows: this.resultCount,
        filtersActive: this.filtersActive(),
      },
      {
        onSave: (fileName, settings) => {
          this.exportNullAsBlank = settings.nullAsBlank;
          this.exportEscapeFormulas = settings.escapeFormulas;
          this.exportLimit = settings.limit;
          void this.runExport(
            fileName,
            settings.nullAsBlank,
            settings.escapeFormulas,
            settings.scope,
            settings.limit,
          );
        },
        onClose: () => undefined,
      },
    );
  }

  private filtersActive(): boolean {
    return (
      this.filters.size > 0 ||
      this.specials.size > 0 ||
      this.columnSpecials.size > 0 ||
      this.shuffleActive
    );
  }

  private defaultExportName(): string {
    const hasCleans = this.cleanedColumns.size > 0 || this.transformOps.length > 0;
    const hasFilters = this.filters.size > 0 || this.specials.size > 0 || this.shuffleActive;
    const suffix = hasCleans ? "-cleaned" : hasFilters ? "-filtered" : "";
    return `${exportFileName(this.datasetName)}${suffix}.csv`;
  }

  private async runExport(
    fileName: string,
    nullAsBlank: boolean,
    escapeFormulas: boolean,
    scope: ExportScope,
    limit: number | null,
  ): Promise<void> {
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

      const { total } = await this.client.startExport(scope);
      if (total === 0) {
        this.setAction("Nothing to export");
        return;
      }
      const take = limit === null ? total : Math.min(total, Math.max(1, Math.floor(limit)));

      const parts: string[] = ["\uFEFF"];
      for (let start = 0; start < take; start += EXPORT_CHUNK_ROWS) {
        this.actionEl.textContent = `Exporting… ${Math.round((start / take) * 100)}%`;
        const end = Math.min(start + EXPORT_CHUNK_ROWS, take);
        const chunk = await this.client.getCsv(start, end, { nullAsBlank, escapeFormulas });
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
      const subset = take < total ? ` (first ${take.toLocaleString()} of ${total.toLocaleString()})` : "";
      this.setAction(`Exported ${take.toLocaleString()} rows${subset} to ${fileName}`);
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

  /** After an edit, surface the damage: auto-highlight on the first change. */
  private noteChangedCells(total: number): void {
    this.changesTotal = total;
    if (total > 0 && !this.showChanges) this.showChanges = true;
    this.syncChangesButton();
  }

  private syncChangesButton(): void {
    const has = this.changesTotal > 0;
    this.changesButton.classList.toggle("hidden", !has);
    if (!has) this.showChanges = false;
    this.changesButton.textContent = this.showChanges ? "Hide changes" : "Show changes";
    this.changesButton.setAttribute("aria-pressed", this.showChanges ? "true" : "false");
    this.changesButton.title = has
      ? `${this.changesTotal.toLocaleString()} cells changed since load — highlight them`
      : "Highlight cells whose value changed since load";
    this.table?.setShowChanges(this.showChanges);
  }

  private setView(view: ViewId): void {
    this.view = view;
    if (view === "table" || view === "chart" || view === "views") this.ensureFilters();
    if (view === "table") this.ensureTable();
    if (view === "chart") {
      const existing = this.chartsPanel !== null;
      this.ensureCharts();
      // First open: the panel was just built and already fetched everything,
      // a second full refresh here caused a visible re-render storm.
      if (existing) this.chartsPanel?.repaint();
    }
    if (view === "views") this.ensureViews();
    if (view === "reports") this.ensureReports();
    if (view !== "overview") this.lastLens = view;
    const chart = view === "chart";
    this.chartActive = chart;
    this.workspace.classList.toggle("chart-mode", chart);
    this.workspace.classList.toggle("overview-mode", view === "overview");
    this.overviewHost.classList.toggle("hidden", view !== "overview");
    this.tableHost.classList.toggle("hidden", view !== "table");
    this.chartHost.classList.toggle("hidden", view !== "chart");
    this.viewsHost.classList.toggle("hidden", view !== "views");
    this.reportsHost.classList.toggle("hidden", view !== "reports");
    this.healthHost.classList.toggle("hidden", view === "overview" || this.healthChipCount === 0);
    this.moreButton.classList.toggle("hidden", view === "overview");
    this.addFilterButton.classList.toggle("hidden", view === "overview");
    this.syncTabs();
    this.syncColumnTiles();
    this.hints?.refresh();
  }

  /** Runs one parsed command-bar line. */
  private runCommand(command: ParsedCommand): void {
    switch (command.kind) {
      case "clean":
        this.applyQuickClean(command.column, command.op);
        break;
      case "transform":
        this.applyTransform([...this.transformOps, ...command.ops], command.label);
        break;
      case "dedupe":
        this.dropDuplicates(command.keep);
        break;
      case "prepareTimeSeries": {
        const updates: { column: number; ops: CleanOp[] }[] = [];
        const existing = (column: number): CleanOp[] =>
          (this.cleanedColumns.get(column) ?? []).slice();
        const dateMeta = this.metas[command.dateColumn];
        if (
          dateMeta !== undefined &&
          dateMeta.type !== "date" &&
          dateMeta.type !== "datetime"
        ) {
          updates.push({
            column: command.dateColumn,
            ops: [...existing(command.dateColumn), { kind: "toDate", order: command.dateOrder }],
          });
        }
        const valueMeta = this.metas[command.valueColumn];
        if (
          valueMeta !== undefined &&
          valueMeta.type !== "integer" &&
          valueMeta.type !== "number"
        ) {
          updates.push({
            column: command.valueColumn,
            ops: [...existing(command.valueColumn), { kind: "toNumber", locale: command.valueLocale }],
          });
        }
        if (updates.length === 0) {
          this.setAction("Time series ready — the date and measure are already converted.");
          break;
        }
        this.applyClean(updates);
        this.setAction(
          `${command.label} — check the sentinel chips, sort by the date, filter the period, then “Chart this”`,
        );
        break;
      }
      case "openClean":
        this.openClean(command.column, command.tab ?? "values");
        break;
      case "openTransform":
        this.openTransform();
        break;
      case "export":
        this.openExportDialog();
        break;
      case "views":
        this.setView("views");
        break;
      case "error":
        this.setAction(command.message);
        break;
    }
  }

  private ensureViews(): void {
    if (this.viewsPanel !== null) {
      this.viewsPanel.setColumns(this.metas, this.resultCount);
      return;
    }
    this.viewsPanel = new ViewsPanel(this.viewsHost, {
      requestAggregate: (view) => this.client.getAggregate(view),
      archetype: () => this.effectiveArchetype(),
      onDrill: (column, timeStart, timeEnd, label) => {
        if (timeStart !== null) {
          this.changeFilter(column, { kind: "range", min: timeStart, max: timeEnd });
        } else if (label !== "(missing)") {
          this.changeFilter(column, { kind: "text", mode: "exact", query: label });
        }
        this.setView("table");
      },
      onChart: (view) => {
        this.ensureCharts();
        this.chartsPanel?.addViewChart(view);
        this.setView("chart");
      },
      onUseAsDataset: (view) => this.applyViewAsDataset(view),
      onCopyPandas: (view) => this.copyViewRecipe(view),
      onSlickTable: (view, result) =>
        openSlickTable({
          datasetName: this.datasetName,
          sourceRows: this.resultCount,
          view,
          result,
        }),
      onViewsChanged: () => this.chartsPanel?.setSources(this.viewSources()),
    });
    this.viewsPanel.setColumns(this.metas, this.resultCount);
  }

  /** Views hold column indexes, so a new schema starts with fresh definitions. */
  private resetViews(): void {
    this.viewsPanel = null;
    clear(this.viewsHost);
    this.reportsPanel = null;
    clear(this.reportsHost);
  }

  private ensureReports(): void {
    const stats = this.latestStats ?? this.lastLoaded?.stats;
    if (stats === undefined) return;
    if (this.reportsPanel !== null) {
      this.reportsPanel.setData(this.metas, stats, this.rowCount);
      return;
    }
    this.reportsPanel = new ReportsPanel(this.reportsHost, {
      requestCorrelation: () => this.requestReportCorrelation(),
      requestCoMissingness: () => this.client.getCoMissingness().catch(() => null),
      requestGroupAnomalies: () => this.client.getGroupAnomalies().catch(() => null),
      requestDependencies: () => this.client.getDependencies().catch(() => null),
      requestRelationships: () => this.client.getRelationships().catch(() => null),
      requestTextProfile: (column) => this.client.getTextProfile(column).catch(() => null),
      requestDistributionChanges: () => this.client.getDistributionChanges().catch(() => null),
      requestSimilarClusters: () => this.client.getSimilarClusters().catch(() => null),
      onAction: (finding) => this.runFinding(finding),
    });
    this.reportsPanel.setData(this.metas, stats, this.rowCount);
  }

  private requestReportCorrelation(): Promise<CorrelationMessage | null> {
    const numeric: number[] = [];
    this.metas.forEach((meta, index) => {
      if ((meta.type === "integer" || meta.type === "number") && numeric.length < 12) {
        numeric.push(index);
      }
    });
    if (numeric.length < 2) return Promise.resolve(null);
    return this.client.getCorrelation(numeric).catch(() => null);
  }

  /** Runs a report finding's action. */
  private runFinding(finding: Finding): void {
    const action = finding.action;
    if (action === undefined) return;
    switch (action.kind) {
      case "suggestion":
        this.applySuggestion(action.column, action.suggestion);
        break;
      case "filterSpecial": {
        const active = this.columnSpecials.get(action.column)?.has(action.special) ?? false;
        if (!active) this.toggleColumnSpecial(action.column, action.special);
        this.setAction(finding.title);
        this.setView("table");
        this.table?.flashColumn(action.column);
        break;
      }
      case "filterDuplicates": {
        if (!this.specials.has("duplicates")) this.toggleSpecial("duplicates");
        this.setView("table");
        break;
      }
      case "filterRange":
        this.changeFilter(action.column, { kind: "range", min: action.min, max: action.max });
        this.setView("table");
        this.table?.flashColumn(action.column);
        break;
      case "filterText":
        this.changeFilter(action.column, { kind: "text", mode: "exact", query: action.query });
        this.setView("table");
        this.table?.flashColumn(action.column);
        break;
      case "cleanNulls":
        this.openClean(action.column, "nulls");
        break;
      case "merge":
        this.openMerge(action.column);
        break;
      case "flagAnomalies": {
        const name = this.metas[action.column]?.name ?? "?";
        this.setView("table");
        this.applyTransform(
          [...this.transformOps, { kind: "flagAnomalies", column: action.column }],
          `Flagged unusual cells in “${name}” (new Yes/No column)`,
        );
        break;
      }
      case "winsorize": {
        const name = this.metas[action.column]?.name ?? "?";
        this.setView("table");
        this.applyTransform(
          [
            ...this.transformOps,
            { kind: "winsorize", column: action.column, percent: action.percent },
          ],
          `Winsorised “${name}” at ${action.percent}% / ${100 - action.percent}%`,
        );
        break;
      }
    }
  }

  /** Detected table archetype, unless the user overrode it. */
  private effectiveArchetype(): ArchetypeId {
    if (this.archetypeOverride !== null) return this.archetypeOverride;
    if (this.latestStats === null || this.metas.length === 0) return "general";
    return detectArchetypes(this.metas, this.latestStats, this.rowCount)[0]?.id ?? "general";
  }

  private rerenderOverview(): void {
    if (this.lastLoaded === null) return;
    this.overview?.render(
      this.lastLoaded,
      {
        sizeLabel: this.sourceBytes === null ? null : formatBytes(this.sourceBytes),
      },
      this.archetypeOverride,
    );
  }

  /** Triage queue: every suggested fix in one ranked checklist. */
  private openTriage(): void {
    const stats = this.latestStats;
    if (stats === null) return;
    this.triage?.close();
    this.triage = openTriagePanel(this.metas, stats, {
      onSuggestion: (column, suggestion) => this.applySuggestion(column, suggestion),
      onConvertToken: (column, tokens) => this.convertToken(column, tokens),
      onOpenClean: (column, tab) => this.openClean(column, tab),
      onDedupe: (anchor) => openDedupeMenu(anchor, stats, (keep) => this.dropDuplicates(keep)),
      onClose: () => {
        this.triage = null;
      },
    });
  }

  private applyViewAsDataset(view: ViewDef): void {
    this.applyTransform(
      [
        ...this.transformOps,
        {
          kind: "aggregate",
          dimensions: view.dimensions,
          measures: view.measures,
          fill: view.fill,
        },
      ],
      `Aggregated rows into a dataset (${view.name})`,
    );
  }

  private async copyViewRecipe(view: ViewDef): Promise<void> {
    const recipe = viewToPandas(view, this.metas.map((meta) => meta.name));
    const copied = await copyText(recipe);
    this.setAction(
      copied ? `Copied the pandas recipe for “${view.name}”` : "Copy failed — clipboard unavailable",
    );
  }

  private syncTabs(): void {
    this.tabs?.setSelected(this.view);
  }

  /** "3 ideas" badge until the Chart lens has been opened once. */
  private updateChartBadge(): void {
    const ideas = this.chartOpened ? 0 : suggestCharts(this.metas, this.rowCount).length;
    this.tabs?.setBadge("chart", ideas > 0 ? `${ideas} ideas` : null);
  }

  /** Refreshes the health group and dataset stats after a worker update. */
  private applyDatasetStats(stats: DatasetStats): void {
    this.latestStats = stats;
    this.renderHealthGroup();
    this.overview?.updateHealth(this.metas, stats);
    this.refreshMissingness();
    this.syncColumnTiles();
    this.reportsPanel?.setData(this.metas, stats, this.rowCount);
    this.reportsPanel?.invalidate();
    this.triage?.update(this.metas, stats);
  }

  /** Rebuilds the Overview's zoomed-out missingness map. */
  private refreshMissingness(): void {
    if (this.datasetName === "") return;
    void this.client
      .getMissingness(240)
      .then((message) => this.overview?.setMissingness(message))
      .catch(() => {
        // The map is supplementary; the rest of the Overview still stands.
      });
  }

  /** Compact Table/Chart replacement for the old summary band. */
  private renderHealthGroup(): void {
    clear(this.healthHost);
    const stats = this.latestStats;
    if (stats === null) {
      this.healthChipCount = 0;
      return;
    }
    let count = 0;
    const addChip = (kind: SpecialKind, label: string, title: string): void => {
      const chip = el(
        "button",
        {
          class: "ghost small health-chip",
          type: "button",
          title,
          "aria-pressed": this.specials.has(kind) ? "true" : "false",
        },
        [label],
      ) as HTMLButtonElement;
      chip.dataset.kind = kind;
      chip.addEventListener("click", () => this.toggleSpecial(kind));
      this.healthHost.append(chip);
      count++;
    };
    if (stats.duplicateRows > 0) {
      addChip(
        "duplicates",
        `Duplicates ${stats.duplicateRows.toLocaleString()}`,
        "Show rows that belong to a duplicate group",
      );
      const remove = el(
        "button",
        {
          class: "ghost small",
          type: "button",
          title: `Remove duplicate rows — ${stats.duplicateRows.toLocaleString()} redundant rows`,
        },
        ["Remove duplicates"],
      ) as HTMLButtonElement;
      remove.addEventListener("click", () =>
        openDedupeMenu(remove, stats, (keep) => this.dropDuplicates(keep)),
      );
      this.healthHost.append(remove);
    }
    const columnsWithNulls = this.metas.filter((meta) => meta.stats.nulls > 0).length;
    if (columnsWithNulls > 0) {
      addChip(
        "nulls",
        `Empty cells · ${columnsWithNulls.toLocaleString()} ${
          columnsWithNulls === 1 ? "col" : "cols"
        }`,
        "Show rows with at least one empty cell",
      );
    }
    if (stats.valueAnomalyRows > 0) {
      addChip(
        "valueAnomalies",
        `Outliers ${stats.valueAnomalyRows.toLocaleString()}`,
        "Show rows with a value outside the column fence",
      );
    }
    // Dataset-level placeholder action, always visible even when the affected
    // column is scrolled off screen. Per-column chips live in the headers.
    const tokenTotals = new Map<string, number>();
    for (const meta of this.metas) {
      for (const token of meta.nullTokens) {
        if (token.label !== "" && token.count > 0) {
          tokenTotals.set(token.label, (tokenTotals.get(token.label) ?? 0) + token.count);
        }
      }
    }
    if (tokenTotals.size > 0) {
      const total = [...tokenTotals.values()].reduce((sum, value) => sum + value, 0);
      const ranked = [...tokenTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label]) => label);
      const examples = ranked.slice(0, 3).map((label) => `“${label}”`).join(", ");
      const convert = el(
        "button",
        {
          class: "ghost small placeholder-action",
          type: "button",
          title: `Blank ${total.toLocaleString()} placeholder cells (${examples}) across all columns — undo in the Recipe`,
        },
        [`Convert to nulls (${total.toLocaleString()})`],
      ) as HTMLButtonElement;
      convert.addEventListener("click", () => this.applyNullPolicyAll(ranked, []));
      this.healthHost.append(convert);
      count++;
    }
    this.healthChipCount = count;
    this.healthHost.classList.toggle("hidden", this.view === "overview" || count === 0);
  }

  private syncHealthChips(): void {
    for (const chip of this.healthHost.querySelectorAll<HTMLElement>(".health-chip")) {
      const kind = chip.dataset.kind as SpecialKind | undefined;
      const on = kind !== undefined && this.specials.has(kind);
      chip.classList.toggle("active", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /** `⋯` menu on the Table and Chart lenses: Stats Report and friends. */
  private openMoreMenu(anchor: HTMLElement): void {
    openMenu(anchor, [
      {
        label: "Stats Report",
        title: "Full per-column statistics",
        action: () => this.openStats(),
      },
    ]);
  }

  private setSidebarCollapsed(collapsed: boolean): void {
    this.sidebarCollapsed = collapsed;
    this.sidebarEl.classList.toggle("collapsed", collapsed);
    this.sidebarToggle.textContent = collapsed ? "»" : "«";
    this.sidebarToggle.title = collapsed ? "Show filters" : "Collapse filters";
    try {
      sessionStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Persisting the preference is best-effort.
    }
  }

  private readSidebarCollapsed(): boolean | null {
    try {
      const raw = sessionStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      return raw === null ? null : raw === "true";
    } catch {
      return null;
    }
  }

  private toggleColumnTiles(): void {
    this.tilesOn = !this.tilesOn;
    try {
      sessionStorage.setItem(COLUMN_TILES_KEY, String(this.tilesOn));
    } catch {
      // Persisting the preference is best-effort.
    }
    this.syncColumnTiles();
  }

  /** Shows/hides the column tile strip for the current view and refreshes it. */
  private syncColumnTiles(): void {
    this.tilesButton.classList.toggle("hidden", this.view !== "table");
    this.tilesButton.classList.toggle("active", this.tilesOn);
    this.tilesButton.setAttribute("aria-pressed", this.tilesOn ? "true" : "false");
    const visible = this.tilesOn && this.view === "table";
    this.columnsStrip.classList.toggle("hidden", !visible);
    if (visible) this.renderColumnStrip();
  }

  private renderColumnStrip(): void {
    clear(this.columnsStrip);
    this.metas.forEach((meta, index) => {
      let card: HTMLElement;
      card = buildColumnCard(meta, index, () => this.openStripMenu(index, card));
      this.columnsStrip.append(card);
    });
  }

  /** Column tile menu: Filter · Chart · Clean (plus Drop for empty columns). */
  private openStripMenu(column: number, anchor: HTMLElement): void {
    const meta = this.metas[column];
    const items: { label: string; title?: string; action: () => void }[] = [
      { label: "Filter", action: () => this.focusFilterColumn(column) },
      { label: "Chart", action: () => this.setView("chart") },
      { label: "Clean", action: () => this.openClean(column, "values") },
    ];
    if (meta !== undefined && this.rowCount > 0 && meta.stats.nulls === this.rowCount) {
      items.push({
        label: "Drop empty column",
        title: "Remove this column — it is empty in every row, tracked as a transform step",
        action: () => this.dropEmptyColumns([column]),
      });
    }
    openMenu(anchor, items);
  }

  private filterChipLabel(filter: ColumnFilter): string {
    switch (filter.kind) {
      case "text":
        return filter.query === "" ? "…" : `“${filter.query}”`;
      case "range":
        return `${filter.min === null ? "−∞" : filter.min.toLocaleString()} – ${
          filter.max === null ? "∞" : filter.max.toLocaleString()
        }`;
      case "values":
        return `${filter.selected.length} value${filter.selected.length === 1 ? "" : "s"}`;
    }
  }

  /** Active filters as removable chips in the results bar. */
  private renderFilterChips(): void {
    this.filterChipsEl.replaceChildren();
    if (this.filters.size === 0) {
      this.filterChipsEl.classList.add("hidden");
      return;
    }
    for (const [column, filter] of this.filters) {
      const name = this.metas[column]?.name ?? `Column ${column + 1}`;
      const chip = el("span", { class: "filter-chip" });
      chip.append(
        el("span", { class: "filter-chip-label" }, [`${name} · ${this.filterChipLabel(filter)}`]),
      );
      const remove = el(
        "button",
        {
          class: "filter-chip-remove",
          type: "button",
          "aria-label": `Remove the ${name} filter`,
          title: `Remove the ${name} filter`,
        },
        ["×"],
      ) as HTMLButtonElement;
      remove.addEventListener("click", () => this.changeFilter(column, null));
      chip.append(remove);
      this.filterChipsEl.append(chip);
    }
    this.filterChipsEl.classList.remove("hidden");
  }

  private focusFilterColumn(column: number): void {
    this.setView("table");
    this.ensureFilters();
    this.setSidebarCollapsed(false);
    this.filterPanel?.focusColumn(column);
  }

  /** `+ Add filter`: a searchable column list that opens that column's card. */
  private openAddFilter(anchor: HTMLElement): void {
    const menu = el("div", { class: "context-menu filter-menu", role: "menu" });
    const input = el("input", {
      class: "text-input filter-menu-search",
      type: "search",
      placeholder: "Find a column…",
      spellcheck: "false",
      "aria-label": "Find a column to filter",
    }) as HTMLInputElement;
    const list = el("div", { class: "filter-menu-list" });
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

    const renderList = (): void => {
      list.replaceChildren();
      const needle = input.value.trim().toLowerCase();
      this.metas.forEach((meta, index) => {
        if (needle !== "" && !meta.name.toLowerCase().includes(needle)) return;
        const item = el(
          "button",
          { class: "context-item", type: "button", role: "menuitem" },
          [meta.name],
        ) as HTMLButtonElement;
        item.addEventListener("click", () => {
          close();
          this.focusFilterColumn(index);
        });
        list.append(item);
      });
    };
    input.addEventListener("input", renderList);

    menu.append(input, list);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
    renderList();
    input.focus();
  }

  /** Pushes fresh facet/histogram payloads to the sidebar filters and charts. */
  private applyFacets(
    facets: Record<number, number[]>,
    histograms: Record<number, number[]>,
  ): void {
    this.latestFacets = facets;
    this.latestHistograms = histograms;
    this.filterPanel?.applyResults(facets, histograms);
    this.chartsPanel?.setFiltered(facets, histograms);
    if (this.view === "views") this.viewsPanel?.markStale();
  }

  /** Column metas changed (type/clean/rename) — rebuild chart pickers too. */
  private refreshCharts(): void {
    this.chartsPanel?.setColumns(this.metas);
  }

  private updateCount(count: number, queryMs: number): void {
    this.resultCount = count;
    this.chartsPanel?.setRowCount(count);
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
    const parts: string[] = [];

    if (loaded.type === "loaded") {
      if (this.sampleNote !== null) parts.push(this.sampleNote);
      const { paddedRows, extraCellRows, extraCells } = loaded.ragged;
      if (paddedRows > 0) {
        parts.push(
          `${paddedRows.toLocaleString()} short row${paddedRows === 1 ? "" : "s"} padded with empty cells`,
        );
      }
      if (extraCellRows > 0) {
        parts.push(
          `${extraCellRows.toLocaleString()} row${extraCellRows === 1 ? "" : "s"} with ${extraCells.toLocaleString()} extra cell${extraCells === 1 ? "" : "s"} beyond ${loaded.columnCount} columns — trimmed`,
        );
      }
    }

    if (!fromFile && loaded.rowCount > LARGE_PASTE_ROWS) {
      parts.push(
        `large paste (${loaded.rowCount.toLocaleString()} rows) — "Upload file" is faster and more stable`,
      );
    }

    if (parts.length === 0) {
      this.bannerEl.classList.add("hidden");
      return;
    }
    this.bannerEl.append(
      el("span", { class: "banner-text" }, [`Import check: ${parts.join(" · ")}`]),
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
    const hasData = this.lastLoaded !== null;
    this.pasteView.classList.remove("hidden");
    this.pasteCancel.classList.toggle("hidden", !hasData);
    this.workspace.classList.toggle("hidden", !hasData);
    this.updateNewButton();
  }

  private hidePaste(): void {
    if (this.lastLoaded === null) return;
    this.pasteView.classList.add("hidden");
    this.workspace.classList.remove("hidden");
    this.updateNewButton();
  }

  /**
   * Toolbar button: "New data" opens the load dialog when empty; "Clear data"
   * asks for confirmation, then closes the table and reopens the load dialog.
   */
  private onNewDataClick(): void {
    if (this.lastLoaded === null) {
      this.showPaste();
      return;
    }
    void openConfirm({
      title: "Clear the data?",
      body: "The current table, filters and steps will be closed. Saved recipes are not affected.",
      confirmLabel: "Clear data",
      danger: true,
    }).then((confirmed) => {
      if (confirmed) this.clearData();
    });
  }

  private updateNewButton(): void {
    const hasData = this.lastLoaded !== null;
    this.newButton.textContent = hasData ? "Clear data" : "New data";
    this.newButton.title = hasData
      ? "Close the current table and start over (asks first)"
      : "Load a CSV, Excel, JSON or Parquet file";
  }

  private clearData(): void {
    this.lastLoaded = null;
    this.datasetName = "";
    this.archetypeOverride = null;
    this.sampleNote = null;
    this.workspace.classList.add("hidden");
    this.pasteView.classList.remove("hidden");
    this.pasteCancel.classList.add("hidden");
    this.updateNewButton();
    this.setAction("Data cleared — load a file to start again");
  }

  /** Worker restart after an out-of-memory crash: reset to the start screen. */
  private handleWorkerCrash(): void {
    this.loading = false;
    this.hideLoadProgress();
    this.clearData();
    this.setStatusError(
      "The file was too large for browser memory — the worker restarted and nothing is loaded. Try the sample option or a smaller file.",
    );
  }

  private openClean(
    column?: number,
    tab?: "values" | "nulls",
    op?: CleanOp,
  ): void {
    if (this.datasetName === "" || this.loading) return;
    openCleanPanel(
      this.metas,
      this.cleanedColumns,
      {
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
            let failed = 0;
            for (const entry of message.columns) {
              changed += entry.changed;
              total += entry.total;
              failed += entry.failed;
            }
            return { changed, total, failed };
          }),
        onOpenMerge: (column) => this.openMerge(column),
        onClose: () => undefined,
      },
      { column, tab, op },
    );
  }

  private openMerge(column: number): void {
    const meta = this.metas[column];
    if (meta === undefined) return;
    openMergePanel(meta, column, {
      onApply: (target, ops) => {
        const existing = this.cleanedColumns.get(target) ?? [];
        this.applyClean([{ column: target, ops: [...existing, ...ops] }]);
      },
      onClose: () => {
        this.table?.refreshHeader();
      },
    });
  }

  /** Header click: profile, issues and the verbs for one column. */
  private openColumnInspector(column: number, anchor: HTMLElement): void {
    const meta = this.metas[column];
    if (meta === undefined) return;
    openColumnInspector(anchor, meta, column, {
      displayFormat: this.displayFormats.get(column) ?? null,
      onSort: (dir) => this.changeSort(column, dir),
      onFilter: () => this.focusFilterColumn(column),
      onChart: () => {
        this.ensureCharts();
        this.chartsPanel?.addCard({ kind: chartKindFor(meta.type) ?? "histogram", column });
        this.setView("chart");
      },
      onQuickClean: (op) => this.applyQuickClean(column, op),
      onOpenClean: (tab) => this.openClean(column, tab),
      onOpenTransform: (preset) => this.openTransform(preset),
      onSuggestion: (suggestion) => this.applySuggestion(column, suggestion),
      onMerge: () => this.openMerge(column),
      onRename: () => void this.renameColumn(column),
      onDelete: () => void this.confirmDeleteColumn(column),
      onRound: (decimals) =>
        this.applyTransform(
          [...this.transformOps, { kind: "round", column, decimals }],
          `Rounded “${meta.name}” to ${decimals} decimal place${decimals === 1 ? "" : "s"}`,
        ),
      onFillMissing: (strategy) =>
        this.applyTransform(
          [...this.transformOps, { kind: "impute", column, strategy, groupColumn: null }],
          `Filled missing values in “${meta.name}”`,
        ),
      onDedupe: (keep) => this.dropDuplicates(keep),
      onSplit: (pattern, regex) =>
        this.applyTransform(
          [
            ...this.transformOps,
            {
              kind: "splitColumn",
              column,
              pattern,
              regex,
              dropEmpty: true,
              dropOriginal: false,
              prefix: meta.name,
            },
          ],
          `Split “${meta.name}” on ${regex ? `/${pattern}/` : `“${pattern}”`}`,
        ),
      onDisplayFormat: (decimals) => {
        if (decimals === null) this.displayFormats.delete(column);
        else this.displayFormats.set(column, decimals);
        this.table?.setFormats(this.displayFormats);
        this.setAction(
          decimals === null
            ? `“${meta.name}”: automatic display`
            : `“${meta.name}”: ${decimals} decimal place${decimals === 1 ? "" : "s"}`,
        );
      },
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
      options: { danger?: boolean; instant?: boolean } = {},
    ): void => {
      const item = el(
        "button",
        {
          class: `context-item${options.danger === true ? " danger" : ""}${
            options.instant === true ? " instant" : ""
          }`,
          type: "button",
          role: "menuitem",
        },
        [label],
      ) as HTMLButtonElement;
      if (options.instant === true) {
        item.title = "Applies immediately — Undo is offered in the toast";
      }
      item.addEventListener("click", () => {
        close();
        action();
      });
      menu.append(item);
    };

    const addHeader = (label: string): void => {
      menu.append(el("div", { class: "context-header" }, [label]));
    };

    addItem("Filter this column", () => this.focusFilterColumn(column));

    addHeader("Column");
    addItem("Rename column…", () => void this.renameColumn(column));
    if (meta.type === "integer" || meta.type === "number") {
      const next: NumberLocale = meta.numberLocale === "comma" ? "dot" : "comma";
      const current = meta.numberLocale === "comma" ? "1.234,56" : "1,234.56";
      addItem(`Number format: ${current} — switch`, () =>
        this.changeNumberLocale(column, next),
      );
    }
    if (meta.type === "category") {
      addItem("Merge similar values…", () => this.openMerge(column));
    }
    addItem("Delete column…", () => void this.confirmDeleteColumn(column), { danger: true });

    addHeader("Clean");
    addItem(
      "Trim whitespace",
      () => this.applyQuickClean(column, { kind: "trim" }),
      { instant: true },
    );
    addItem(
      "UPPERCASE",
      () => this.applyQuickClean(column, { kind: "case", style: "upper" }),
      { instant: true },
    );
    addItem(
      "lowercase",
      () => this.applyQuickClean(column, { kind: "case", style: "lower" }),
      { instant: true },
    );
    addItem(
      "Title Case",
      () => this.applyQuickClean(column, { kind: "case", style: "title" }),
      { instant: true },
    );
    addItem(
      "Convert to number",
      () => this.applyQuickClean(column, { kind: "toNumber", locale: meta.numberLocale }),
      { instant: true },
    );
    addItem(
      "Convert to date",
      () => this.applyQuickClean(column, { kind: "toDate", order: meta.dateOrder }),
      { instant: true },
    );
    addItem(
      "Convert to date & time",
      () => this.applyQuickClean(column, { kind: "toDateTime", order: meta.dateOrder }),
      { instant: true },
    );
    addItem(
      "Escape formula-like cells",
      () => this.applyQuickClean(column, { kind: "escapeFormulas" }),
      { instant: true },
    );
    addItem("Find & replace…", () =>
      this.openClean(column, "values", {
        kind: "replace",
        find: "",
        replacement: "",
        ignoreCase: false,
      }),
    );
    addItem("Clean values…", () => this.openClean(column, "values"));
    addItem("Missing values…", () => this.openClean(column, "nulls"));

    addHeader("Transform");
    addItem("Remove duplicate rows", () => this.openTransform({ type: "dedupe" }));
    addItem("Round…", () => this.openTransform({ type: "round", column }));
    addItem("Group by & aggregate…", () => this.openTransform({ type: "groupBy", column }));
    addItem("Fill missing values…", () => this.openTransform({ type: "impute", column }));
    addItem("KNN impute…", () => this.openTransform({ type: "knn", column }));
    addItem("Melt (wide → long)…", () => this.openTransform({ type: "melt", column }));
    addItem("Combine date/time columns…", () =>
      this.openTransform({ type: "combineDate", column }),
    );
    addItem("Split a column…", () => this.openTransform({ type: "splitColumn", column }));
    addItem("Transform dataset…", () => this.openTransform());

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    document.body.append(menu);
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.scrollTop = 0;
  }

  /** Right-click rename: prompts for a new header name and applies it. */
  private async renameColumn(column: number): Promise<void> {
    const meta = this.metas[column];
    if (meta === undefined) return;
    const next = await openPrompt({
      title: "Rename column",
      label: "Column name",
      value: meta.name,
      confirmLabel: "Rename",
    });
    if (next === null) return;
    const name = next.trim();
    if (name === "" || name === meta.name) return;
    const headers = this.metas.map((entry) => entry.name);
    headers[column] = name;
    this.applyHeaderRename(headers);
  }

  /** Applies a parameter-free clean straight from the menu, with an undo toast. */
  private applyQuickClean(column: number, op: CleanOp): void {
    if (op.kind === "toDate" || op.kind === "toDateTime" || op.kind === "toNumber") {
      void this.applyQuickCast(column, op);
      return;
    }
    const existing = this.cleanedColumns.get(column) ?? [];
    this.applyClean([{ column, ops: [...existing, op] }]);
    const name = this.metas[column]?.name ?? `Column ${column + 1}`;
    this.showToast(`${describeCleanOp(op)} applied to “${name}”`, () => {
      const current = this.cleanedColumns.get(column) ?? [];
      const key = JSON.stringify(op);
      let index = -1;
      for (let i = current.length - 1; i >= 0; i--) {
        if (JSON.stringify(current[i]) === key) {
          index = i;
          break;
        }
      }
      if (index < 0) return;
      this.applyClean([{ column, ops: current.filter((_, i) => i !== index) }]);
    });
  }

  /**
   * Cast ops (date, date & time, number) pre-flight the worker preview: a
   * conversion that would change nothing reports how many values don't parse
   * instead of applying a silent no-op with a success toast.
   */
  private async applyQuickCast(column: number, op: CleanOp): Promise<void> {
    const existing = this.cleanedColumns.get(column) ?? [];
    const applied = [...existing, op];
    const name = this.metas[column]?.name ?? `Column ${column + 1}`;
    const preview = await this.client.previewClean([{ column, ops: applied }]).catch(() => null);
    const counts = preview?.columns[0];
    if (counts !== undefined && counts.changed === 0) {
      this.showToast(
        `Nothing changed in “${name}” — ${counts.failed.toLocaleString()} of ${counts.total.toLocaleString()} values don't parse.`,
        () => this.openClean(column, "values"),
        "Review values",
      );
      return;
    }
    this.applyClean([{ column, ops: applied }]);
    const summary =
      counts !== undefined && counts.failed > 0
        ? `Converted ${counts.changed.toLocaleString()} cells · ${counts.failed.toLocaleString()} don't parse and were left unchanged`
        : `${describeCleanOp(op)} applied to “${name}”`;
    this.showToast(summary, () => {
      const current = this.cleanedColumns.get(column) ?? [];
      const key = JSON.stringify(op);
      let index = -1;
      for (let i = current.length - 1; i >= 0; i--) {
        if (JSON.stringify(current[i]) === key) {
          index = i;
          break;
        }
      }
      if (index < 0) return;
      this.applyClean([{ column, ops: current.filter((_, i) => i !== index) }]);
    });
  }

  /** One transient toast at a time, with an optional action button (Undo by default). */
  private showToast(message: string, onUndo?: () => void, actionLabel = "Undo"): void {
    for (const existing of document.querySelectorAll(".toast")) existing.remove();
    const toast = el("div", { class: "toast", role: "status" });
    toast.append(el("span", { class: "toast-text" }, [message]));
    const timer = window.setTimeout(() => toast.remove(), 6000);
    if (onUndo !== undefined) {
      const undo = el("button", { class: "toast-undo", type: "button" }, [actionLabel]);
      undo.title = actionLabel === "Undo" ? "Reverse this action" : actionLabel;
      undo.addEventListener("click", () => {
        window.clearTimeout(timer);
        toast.remove();
        onUndo();
      });
      toast.append(undo);
    }
    const dismiss = el(
      "button",
      { class: "toast-close icon-btn", type: "button", title: "Dismiss" },
      ["×"],
    );
    dismiss.addEventListener("click", () => {
      window.clearTimeout(timer);
      toast.remove();
    });
    toast.append(dismiss);
    document.body.append(toast);
  }

  private async confirmDeleteColumn(column: number): Promise<void> {
    const meta = this.metas[column];
    if (meta === undefined) return;
    const confirmed = await openConfirm({
      title: `Delete column “${meta.name}”?`,
      body:
        "The column is removed from the dataset as a tracked transform step — you can undo it from the Recipe.",
      confirmLabel: "Delete column",
      danger: true,
    });
    if (!confirmed) return;
    this.applyTransform([...this.transformOps, { kind: "drop", column }]);
  }

  /** Keeps the per-commit sizes in step with the current transform op list. */
  private syncTransformBatches(): void {
    const total = this.transformOps.length;
    if (total === 0) {
      this.transformCommitSizes = [];
      return;
    }
    let covered = 0;
    for (const size of this.transformCommitSizes) covered += size;
    if (total > covered) {
      this.transformCommitSizes.push(total - covered);
      return;
    }
    const kept: number[] = [];
    let used = 0;
    for (const size of this.transformCommitSizes) {
      if (used + size <= total) {
        kept.push(size);
        used += size;
      } else {
        break;
      }
    }
    if (used < total) kept.push(total - used);
    this.transformCommitSizes = kept;
  }

  private updateStepsButton(): void {
    const groups = groupSteps(this.stepEntries());
    const count = groups.length;
    this.stepsButton.textContent = count === 0 ? "Recipe" : `Recipe (${count})`;
    this.stepsButton.disabled = count === 0;
    this.stepsButton.title =
      count === 0
        ? "No changes yet — clean, fix or transform a column to start the recipe"
        : "Review, undo or export the applied changes";
    this.hints?.refresh();
  }

  private stepEntries(): StepsPanelEntry[] {
    const entries: StepsPanelEntry[] = [];
    for (const [column, ops] of this.cleanedColumns) {
      const name = this.metas[column]?.name ?? `Column ${column + 1}`;
      for (let index = 0; index < ops.length; index++) {
        entries.push({
          kind: "clean",
          label: `${name}: ${describeCleanOp(ops[index])}`,
          detail: `clean → ${describeCleanOpDetail(ops[index])}`,
          column,
          opIndex: index,
          groupSize: ops.length,
        });
      }
    }
    for (let index = 0; index < this.nullEdits.length; index++) {
      const edit = this.nullEdits[index];
      entries.push({
        kind: "nulls",
        label: edit.label,
        detail: edit.detail,
        column: edit.column,
        opIndex: index,
        groupSize: this.nullEdits.length,
      });
    }
    for (let index = 0; index < this.typeEdits.length; index++) {
      const edit = this.typeEdits[index];
      entries.push({
        kind: "type",
        label: edit.label,
        detail: edit.detail,
        column: edit.column,
        opIndex: index,
        groupSize: this.typeEdits.length,
      });
    }
    const schema =
      this.transformBaseSchema.length > 0
        ? this.transformBaseSchema
        : this.metas.map((meta) => ({
            name: meta.name,
            numeric: meta.type === "integer" || meta.type === "number",
          }));
    let running = schema;
    const batchOf = new Array<number>(this.transformOps.length).fill(-1);
    let batchCursor = 0;
    this.transformCommitSizes.forEach((size, batchIndex) => {
      for (let step = 0; step < size && batchCursor < batchOf.length; step++) {
        batchOf[batchCursor++] = batchIndex;
      }
    });
    for (let index = 0; index < this.transformOps.length; index++) {
      const op = this.transformOps[index];
      const batch = batchOf[index];
      const batchSize = batch >= 0 ? this.transformCommitSizes[batch] : 1;
      entries.push({
        kind: "transform",
        label: describeTransformOp(
          op,
          running.map((entry) => entry.name),
        ),
        detail: `transform → ${describeTransformOpDetail(
          op,
          running.map((entry) => entry.name),
        )}`,
        column: -1,
        opIndex: index,
        groupSize: this.transformOps.length,
        group:
          batchSize > 1
            ? { id: `transform-batch-${batch}`, label: `Transform batch (${batchSize} steps)` }
            : undefined,
      });
      running = schemaAfter(running, op);
    }
    if (this.excludedRowCount > 0) {
      entries.push({
        kind: "rows",
        label: `Removed ${this.excludedRowCount.toLocaleString()} row${
          this.excludedRowCount === 1 ? "" : "s"
        }`,
        detail: "rows → excluded from the working set; undo to restore",
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
      onUndoPolicy: (column, opIndex) => {
        const edit = this.nullEdits[opIndex];
        if (edit === undefined) return;
        this.nullEdits.splice(opIndex, 1);
        if (edit.all === true) this.applyNullPolicyAll([], [], { record: false });
        else {
          this.applyNullPolicy(column, edit.previousExtra, edit.previousKeep, { record: false });
        }
        this.updateStepsButton();
      },
      onUndoType: (column, opIndex) => {
        const edit = this.typeEdits[opIndex];
        if (edit === undefined) return;
        this.typeEdits.splice(opIndex, 1);
        this.changeType(column, edit.previous, false);
        this.updateStepsButton();
      },
      onUndoBatch: (batch) => this.undoBatch(batch),
      onClearAll: () => {
        if (this.transformOps.length > 0) this.applyTransform([]);
        if (this.cleanedColumns.size > 0) {
          this.applyClean(
            [...this.cleanedColumns.keys()].map((column) => ({ column, ops: [] })),
          );
        }
        for (let i = this.nullEdits.length - 1; i >= 0; i--) {
          const edit = this.nullEdits[i];
          if (edit.all === true) this.applyNullPolicyAll([], [], { record: false });
          else this.applyNullPolicy(edit.column, edit.previousExtra, edit.previousKeep, { record: false });
        }
        this.nullEdits.length = 0;
        for (let i = this.typeEdits.length - 1; i >= 0; i--) {
          this.changeType(this.typeEdits[i].column, this.typeEdits[i].previous, false);
        }
        this.typeEdits.length = 0;
        this.updateStepsButton();
      },
      onCopyRecipe: (target) => this.copyRecipe(target),
      recipeSupport: (target) => supportHint(target, this.recipeScript(target).entries),
      onSaveRecipe: () => this.saveRecipe(),
      onReplayRecipe: () => this.pickRecipeFile(),
      onClose: () => undefined,
    });
  }

  /** Reverses every sub-step of a condensed batch in a single action. */
  private undoBatch(batch: readonly StepsPanelEntry[]): void {
    if (batch.length === 0) return;
    if (batch[0].kind === "clean") {
      const perColumn = new Map<number, Set<number>>();
      for (const entry of batch) {
        let indexes = perColumn.get(entry.column);
        if (indexes === undefined) {
          indexes = new Set();
          perColumn.set(entry.column, indexes);
        }
        indexes.add(entry.opIndex);
      }
      const updates = [...perColumn.entries()].map(([column, indexes]) => ({
        column,
        ops: (this.cleanedColumns.get(column) ?? []).filter((_, index) => !indexes.has(index)),
      }));
      this.applyClean(updates);
      return;
    }
    if (batch[0].kind === "transform") {
      const indexes = new Set(batch.map((entry) => entry.opIndex));
      this.applyTransform(this.transformOps.filter((_, index) => !indexes.has(index)));
    }
  }

  /** The canonical recipe contract: applied cleans, null/type edits, transforms. */
  private recipeInput(): RecipeInput {
    const schema =
      this.transformBaseSchema.length > 0
        ? this.transformBaseSchema
        : this.metas.map((meta) => ({
            name: meta.name,
            numeric: meta.type === "integer" || meta.type === "number",
            type: meta.type,
          }));
    return {
      cleans: [...this.cleanedColumns.entries()].map(([column, ops]) => ({
        name: this.metas[column]?.name ?? `Column ${column + 1}`,
        ops,
      })),
      transforms: this.transformOps,
      schema,
      types: this.typeEdits.map((edit) => ({
        name: this.metas[edit.column]?.name ?? `Column ${edit.column + 1}`,
        type: this.metas[edit.column]?.type ?? "string",
      })),
      nulls: this.metas
        .map((meta) => ({
          name: meta.name,
          extra: [...meta.nullPolicy.extra],
          keep: [...meta.nullPolicy.keep],
        }))
        .filter((entry) => entry.extra.length > 0 || entry.keep.length > 0),
      deletedRows: this.excludedRowCount > 0 ? this.excludedRowCount : undefined,
    };
  }

  /** Runs the selected target generator over the canonical recipe input. */
  private recipeScript(target: RecipeTarget): RecipeScript {
    const input = this.recipeInput();
    return target === "polars" ? polarsRecipeScript(input) : pandasRecipeScript(input);
  }

  private async copyRecipe(target: RecipeTarget): Promise<boolean> {
    const recipe = this.recipeScript(target).code;
    return copyText(recipe);
  }

  /** Builds the replayable pipeline file for the current dataset. */
  private buildRecipeFile(): RecipeFile {
    const baseSchema =
      this.transformBaseSchema.length > 0
        ? this.transformBaseSchema
        : this.metas.map((meta) => ({
            name: meta.name,
            numeric: meta.type === "integer" || meta.type === "number",
          }));
    return {
      kind: "turbofuzz-recipe",
      version: 1,
      name: this.datasetName,
      savedAt: new Date().toISOString(),
      columns: this.metas.map((meta) => meta.name),
      cleans: [...this.cleanedColumns.entries()].map(([column, ops]) => ({
        name: this.metas[column]?.name ?? `Column ${column + 1}`,
        ops,
      })),
      nulls: this.metas
        .map((meta) => ({
          name: meta.name,
          extra: [...meta.nullPolicy.extra],
          keep: [...meta.nullPolicy.keep],
        }))
        .filter((entry) => entry.extra.length > 0 || entry.keep.length > 0),
      types: this.typeEdits
        .map((edit) => ({
          name: this.metas[edit.column]?.name ?? `Column ${edit.column + 1}`,
          type: this.metas[edit.column]?.type ?? "string",
        }))
        .filter((entry): entry is RecipeFileType => entry.type !== undefined),
      baseSchema,
      transforms: JSON.parse(JSON.stringify(this.transformOps)) as TransformOp[],
      archetype: this.archetypeOverride ?? undefined,
    };
  }

  private saveRecipe(): void {
    const file = this.buildRecipeFile();
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const base = this.datasetName.replace(/\.[^.]+$/, "") || "turbofuzz";
    anchor.href = url;
    anchor.download = `${base}-recipe.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    this.setAction(`Saved the recipe (${file.cleans.length + file.transforms.length} steps)`);
  }

  private pickRecipeFile(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file !== undefined) void this.replayRecipe(file);
    });
    input.click();
  }

  private async replayRecipe(file: File): Promise<void> {
    let parsed: RecipeFile;
    try {
      parsed = parseRecipeFile(await file.text());
    } catch (error) {
      this.showWarning(error instanceof Error ? error.message : "Could not read the recipe.");
      return;
    }
    const names = this.metas.map((meta) => meta.name);
    let plan = planReplay(parsed, names);
    if (
      plan.cleans.length === 0 &&
      plan.nulls.length === 0 &&
      plan.types.length === 0 &&
      plan.transforms.length === 0
    ) {
      this.showWarning(
        `Nothing could be replayed — no saved column matched. Skipped: ${plan.skipped.join(", ") || "all steps"}.`,
      );
      return;
    }

    // Saved base columns that do not match this file: offer a mapping step
    // instead of silently skipping the transforms.
    if (plan.transformsSkipped && parsed.transforms.length > 0) {
      const missing = parsed.baseSchema
        .map((entry) => entry.name)
        .filter((name) => matchColumns([name], names)[0] === null);
      if (missing.length > 0) {
        const mapping = await openRecipeMapping({ names: missing, columns: names });
        if (mapping !== null && [...mapping.values()].some((value) => value !== null)) {
          plan = planReplay(parsed, names, mapping);
        }
      }
    }
    await this.applyReplayPlan(parsed, plan);
  }

  private async applyReplayPlan(parsed: RecipeFile, plan: ReplayPlan): Promise<void> {
    if (parsed.archetype !== undefined) {
      this.archetypeOverride = parsed.archetype as ArchetypeId;
      this.rerenderOverview();
    }
    try {
      for (const change of plan.types) {
        const previous = this.metas[change.column]?.type ?? "string";
        const message = await this.client.setType(change.column, change.type);
        this.metas[change.column] = message.meta;
        this.table?.updateColumn(change.column, message.meta);
        this.overview?.updateColumn(change.column, message.meta);
        this.typeEdits.push({
          column: change.column,
          label: `${message.meta.name}: type → ${message.meta.type} (replayed)`,
          detail: `type → ${change.type} (replayed)`,
          previous,
        });
      }
      for (const entry of plan.nulls) {
        const message = await this.client.setNullPolicy(entry.column, entry.extra, entry.keep);
        for (const { column, meta } of message.columns) {
          this.metas[column] = meta;
          this.table?.updateColumn(column, meta);
          this.overview?.updateColumn(column, meta);
        }
        this.filterPanel?.updateMeta(entry.column, this.metas[entry.column]);
      }
      if (plan.cleans.length > 0) {
        const message = await this.client.cleanColumns(plan.cleans);
        for (const update of plan.cleans) {
          this.filters.delete(update.column);
          this.cleanedColumns.set(update.column, update.ops);
        }
        for (const { column, meta } of message.columns) {
          this.metas[column] = meta;
          this.table?.updateColumn(column, meta);
          this.overview?.updateColumn(column, meta);
        }
        this.latestFacets = message.facets;
        this.latestHistograms = message.histograms;
        this.applyDatasetStats(message.stats);
        this.updateCount(message.count, message.queryMs);
        this.table?.setCount(message.count);
        this.table?.setFirstRows(
          message.firstRows,
          message.firstGroups,
          message.firstFlags,
          message.firstChanged,
        );
        this.noteChangedCells(message.changedTotal);
      }
      this.updateStepsButton();

      if (plan.transforms.length > 0) {
        const message = await this.client.transform(plan.transforms);
        this.openWorkspace(message);
      } else if (plan.transformsSkipped) {
        this.showWarning(
          `Steps replayed, but the transforms were skipped — the saved base columns ${
            plan.skipped.join(", ") || "do not"
          } did not match this file.`,
        );
      }
      const parts = [
        plan.types.length > 0 ? `${plan.types.length} type` : "",
        plan.nulls.length > 0 ? `${plan.nulls.length} missing-value` : "",
        plan.cleans.length > 0 ? `${plan.cleans.length} clean` : "",
        plan.transforms.length > 0 ? `${plan.transforms.length} transform` : "",
      ].filter((part) => part !== "");
      this.setAction(
        `Replayed ${parts.join(", ")} step${parts.length === 1 ? "" : "s"}${
          plan.skipped.length > 0 ? ` · skipped ${plan.skipped.join(", ")}` : ""
        }`,
      );
    } catch (error) {
      this.showError(error);
    }
  }

  private applyHeaderRename(headers: string[]): void {
    this.queueSend(() =>
      this.client
        .renameHeaders(headers)
        .then((message) => {
          const count = Math.min(this.metas.length, message.headers.length);
          for (let i = 0; i < count; i++) this.metas[i].name = message.headers[i];
          this.refreshCharts();
          this.filterPanel?.rebuild();
          this.table?.refreshHeader();
          this.overview?.updateNames(message.headers);
          this.syncColumnTiles();
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
          this.transformCommitSizes = [];
          for (const update of updates) {
            this.filters.delete(update.column);
            if (update.ops.length === 0) this.cleanedColumns.delete(update.column);
            else this.cleanedColumns.set(update.column, update.ops);
          }
          this.renderFilterChips();
          for (const { column, meta } of message.columns) {
            this.metas[column] = meta;
            this.filterPanel?.updateMeta(column, meta);
            this.table?.updateColumn(column, meta);
            this.overview?.updateColumn(column, meta);
          }
          this.refreshCharts();
          this.applyDatasetStats(message.stats);
          this.table?.setSort(-1, 1);
          this.applyFacets(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
          const reverted = updates.every((update) => update.ops.length === 0);
          const name = message.columns[0]?.meta.name ?? "";
          const label =
            updates.length === 1 ? name : `${updates.length} columns`;
          const changedText =
            message.changedTotal > 0
              ? ` · ${message.changedTotal.toLocaleString()} cells changed`
              : "";
          this.setAction(reverted ? `Reverted ${label}` : `Cleaned ${label}${changedText}`);
          this.noteChangedCells(message.changedTotal);
          this.updateStepsButton();
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  /** Header chip: blank a column's placeholder text, tracked + undoable. */
  private convertToken(column: number, tokens: string[]): void {
    const meta = this.metas[column];
    if (meta === undefined) return;
    const extra = [...new Set([...meta.nullPolicy.extra, ...tokens])];
    this.applyNullPolicy(column, extra, meta.nullPolicy.keep, {
      label: `${meta.name}: placeholder text treated as missing`,
    });
  }

  private applyNullPolicy(
    column: number,
    extra: string[],
    keep: string[],
    options: { record?: boolean; label?: string } = {},
  ): void {
    const previous = this.metas[column]?.nullPolicy;
    const changed =
      previous === undefined ||
      !sameTokens(previous.extra, extra) ||
      !sameTokens(previous.keep, keep);
    this.queueSend(() =>
      this.client
        .setNullPolicy(column, extra, keep)
        .then((message) => {
          this.filters.delete(column);
          this.renderFilterChips();
          for (const { column: index, meta } of message.columns) {
            this.metas[index] = meta;
            this.filterPanel?.updateMeta(index, meta);
            this.table?.updateColumn(index, meta);
            this.overview?.updateColumn(index, meta);
          }
          if (options.record !== false && changed) {
            const name = message.columns[0]?.meta.name ?? `Column ${column + 1}`;
            this.nullEdits.push({
              column,
              label: options.label ?? `${name}: missing-value policy updated`,
              detail: "nulls → exact-match missing tokens",
              previousExtra: [...(previous?.extra ?? [])],
              previousKeep: [...(previous?.keep ?? [])],
            });
            this.updateStepsButton();
          }
          this.refreshCharts();
          this.applyDatasetStats(message.stats);
          this.table?.setSort(-1, 1);
          this.applyFacets(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
          this.setAction(
            `Nulls resolved - ${(message.columns[0]?.meta.stats.nulls ?? 0).toLocaleString()} blanks in ${message.columns[0]?.meta.name ?? "column"}`,
          );
          this.noteChangedCells(message.changedTotal);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private applyNullPolicyAll(
    extra: string[],
    keep: string[],
    options: { record?: boolean } = {},
  ): void {
    this.queueSend(() =>
      this.client
        .resolveNullsAll(extra, keep)
        .then((message) => {
          this.filters.clear();
          for (const { column, meta } of message.columns) this.metas[column] = meta;
          this.refreshCharts();
          if (options.record !== false && (extra.length > 0 || keep.length > 0)) {
            this.nullEdits.push({
              column: -1,
              all: true,
              label: "All columns: missing-value policy updated",
              detail: "nulls → exact-match missing tokens (all columns)",
              previousExtra: [],
              previousKeep: [],
            });
            this.updateStepsButton();
          }
          this.table?.updateColumns(this.metas);
          for (const { column, meta } of message.columns) {
            this.overview?.updateColumn(column, meta);
          }
          this.applyDatasetStats(message.stats);
          this.filterPanel?.rebuild();
          this.table?.setSort(-1, 1);
          this.applyFacets(message.facets, message.histograms);
          this.updateCount(message.count, message.queryMs);
          this.table?.setCount(message.count);
          this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
          this.setAction(
            `Nulls resolved — ${message.stats.totalNullCells.toLocaleString()} blanks`,
          );
          this.noteChangedCells(message.changedTotal);
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  private openTransform(preset?: { type: string; column?: number }): void {
    if (this.datasetName === "" || this.loading) return;
    const baseSchema =
      this.transformBaseSchema.length > 0
        ? this.transformBaseSchema
        : this.metas.map((meta) => ({
            name: meta.name,
            numeric: meta.type === "integer" || meta.type === "number",
          }));
    openTransformPanel(
      this.transformOps,
      baseSchema,
      {
        onApply: (ops) => this.applyTransform(ops),
        onPreview: (ops) => this.client.previewTransform(ops),
        onClose: () => undefined,
      },
      preset,
    );
  }

  private applyTransform(ops: TransformOp[], action?: string): void {
    const before = this.rowCount;
    this.queueSend(() =>
      this.client
        .transform(ops)
        .then((message) => {
          this.openWorkspace(message);
          const plural = ops.length === 1 ? "" : "s";
          const rowsText =
            before !== message.rowCount
              ? ` · rows ${before.toLocaleString()} → ${message.rowCount.toLocaleString()}`
              : "";
          this.setAction(
            (action ??
              (ops.length === 0 ? "Transforms reset" : `Applied ${ops.length} transform step${plural}`)) +
              rowsText,
          );
        })
        .catch((error: unknown) => this.showError(error)),
    );
  }

  /** Quick action from the Duplicates QA control: drop duplicate rows. */
  private dropDuplicates(keep: DedupeKeep): void {
    const label =
      keep === "first" ? "kept first copy" : keep === "last" ? "kept last copy" : "removed all copies";
    this.applyTransform(
      [...this.transformOps, { kind: "dedupe", keep }],
      `Removed duplicate rows (${label})`,
    );
  }

  /** Quick action from the QA block: drop columns that are empty in every row. */
  private dropEmptyColumns(columns: number[]): void {
    if (columns.length === 0) return;
    this.applyTransform(
      [
        ...this.transformOps,
        ...columns.map((column) => ({ kind: "drop" as const, column })),
      ],
      `Dropped ${columns.length} empty column${columns.length === 1 ? "" : "s"}`,
    );
  }
}
