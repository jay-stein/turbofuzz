import { getOptionalMarks, setOptionalMark } from "./optional-marks.js";
import { DELIMITER_LABELS, type Delimiter } from "../parse/delimiter.js";
import {
  listArchiveEntries,
  readArchiveEntry,
  readArchivePrefixes,
  type ArchiveEntry,
} from "../parse/archive.js";
import { decompressBzip2 } from "../parse/bz2.js";
import { decodeText } from "../parse/encoding.js";
import { parseDelimited } from "../parse/parse.js";
import { detectTable, type HeaderLayout } from "../parse/header-detect.js";
import { openHeaderRowDialog } from "./header-row-dialog.js";
import { openProtectDialog, type ProtectMode } from "./protect-dialog.js";
import { openFixPreview } from "./fix-preview-dialog.js";
import { buildColumnHealth, buildIssues, type FixStep, type PageIssue } from "../data/dq-issues.js";
import { columnsIgnoring, idLikeColumns, nearDuplicateFinding } from "../data/near-duplicates.js";
import { maskValue } from "../data/mask-value.js";
import { getSensitiveMark, setSensitiveMark } from "./sensitive-marks.js";
import {
  scoreSensitivity,
  type ColumnSensitivityInput,
  type SensitiveFinding,
} from "../data/sensitivity.js";
import { listLegacySheets, readLegacySheet } from "../parse/xls.js";
import { listWorkbookSheets, readWorkbookSheet } from "../parse/xlsx.js";
import type { ColumnFilter } from "../search/query-engine.js";
import {
  detectArchetypes,
  type ArchetypeId,
} from "../data/archetype.js";
import type { ViewDef } from "../data/aggregate.js";
import { describeCleanOp, describeCleanOpDetail, type CleanOp } from "../data/clean-ops.js";
import type { CastOptions, CastTarget } from "../data/cast-ops.js";
import { openCastDialog } from "./cast-dialog.js";
import { openBatchCastDialog } from "./batch-cast-dialog.js";
import { formatBound, openRangePrompt } from "./range-prompt.js";
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
import { suggestionLabel, type ColumnSuggestion } from "../data/suggestions.js";
import {
  describeTransformOp,
  describeTransformOpDetail,
  schemaAfter,
  type ColumnSchema,
  type DedupeKeep,
  type ImputeStrategy,
  type TransformOp,
} from "../data/transform-ops.js";
import type { NumberLocale } from "../parse/numbers.js";
import type { WorkBook } from "xlsx";
import { TYPE_LABELS, isNumericLikeType, type ColumnType } from "../types.js";
import type {
  AggregateMessage,
  CleanUpdate,
  ColumnMeta,
  DatasetStatsMessage,
  PivotMessage,
  CorrelationMessage,
  ExportScope,
  LoadedMessage,
  ProgressMessage,
  ResultsMessage,
  SpecialKind,
  TransformedMessage,
} from "../worker/protocol.js";
import { clear, el, svgIcon } from "./dom.js";
import { openDedupeMenu } from "./dedupe-menu.js";
import { openMenu, type MenuItem } from "./menu.js";
import { buildColumnCard } from "./summary-band.js";
import { Overview, STATS_ICON, delimiterLabel, readDefaultView } from "./overview.js";
import type { DatasetStats } from "../data/stats.js";
import { FilterPanel } from "./filters.js";
import { ChartsPanel, remapChartConfigs, type NamedChartCardConfig } from "./chart-panel.js";
import type { BrushRange, MapBrushSelection } from "./chart-card.js";
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
import { chipText } from "./chips.js";
import {
  buildMultiFilePreflight,
  openMultiFilePreflight,
  type FilePreflightSample,
  type MultiFileAppendMode,
  type MultiFilePreflight,
} from "./multi-file-preflight.js";
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
import {
  EXPORT_COMPRESSIONS,
  encodeExport,
  formatInfo,
  type ExportCompression,
  type ExportFormat,
} from "./export-formats.js";
import { openMergePanel } from "./merge-panel.js";
import { normalize } from "../search/normalize.js";
import {
  computeDQScore,
  type DQScore,
  type DQScoreConfig,
  type ScoreCheck,
} from "../data/score.js";
import {
  buildDQReport,
  dqReportJson,
  dqReportMarkdown,
  dqReportHtml,
  supplierMessage,
  type DQReport,
  emitDQChecks,
} from "../data/dq-report.js";
import { safeFileName } from "./chart-utils.js";
import type { DQExportKind } from "./quality-panel.js";
import {
  QualityPage,
  type FreshnessColumn,
  type FixOutcome,
  type SensitiveCard,
  type SensitiveChange,
} from "./quality-page.js";
import { suggestPairs, type PairOperator } from "../data/pair-checks.js";
import {
  describeRule,
  parseRulesFile,
  recommendRules,
  ruleToCheck,
  schemaFingerprint,
  serialiseRules,
  type Rule,
  type RuleResult,
} from "../data/rules.js";
import {
  buildSnapshot,
  historyKey,
  isDuplicateLoad,
  openIndexedDbStore,
  type HistoryStore,
  type Snapshot,
} from "../data/history.js";
import { accuracyChecks, candidateKinds } from "../data/reference.js";
import { openStandardiseReview } from "./standardise-review-dialog.js";
import { buildRulesPanel } from "./rules-panel.js";
import { buildHistoryPanel } from "./history-panel.js";
import { DEFAULT_HEADER_OPTIONS, normalizeHeaders } from "../data/headers.js";
import { groupSteps, openStepsPanel, type StepsPanelEntry } from "./steps-panel.js";
import { openTransformPanel } from "./transform-panel.js";
import { ViewTabs, viewSwitchHint, type ViewId } from "./view-tabs.js";
import { ViewsPanel, type ViewSource } from "./views-panel.js";
import { openCommandBar, type ParsedCommand } from "./command-bar.js";
import { openTriagePanel, type TriagePanelHandle } from "./triage-panel.js";
import { openColumnInspector } from "./column-inspector.js";
import { openSlickTable } from "./slick-table.js";
import { chartKindFor } from "./chart-utils.js";
import {
  OutliersPanel,
  type OutliersPanelOptions,
} from "./outliers-panel.js";
import {
  coMissingnessFindings,
  distributionFindings,
  similarClusterFindings,
  reviewFindings,
  textProfileFindings,
  type Finding,
} from "../data/findings.js";

const LARGE_PASTE_ROWS = 300_000;
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
const MULTI_FILE_EXTENSIONS = [".csv", ".tsv", ".psv", ".txt", ".dat"];
const PREFLIGHT_BYTES = 256 * 1024;
const DEFER_STATS_BYTES = 2_000_000;
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

const DQ_CONFIG_KEY = "turbofuzz.dqConfig";

function loadDQConfig(): DQScoreConfig {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(DQ_CONFIG_KEY);
    if (raw === null) return {};
    return JSON.parse(raw) as DQScoreConfig;
  } catch {
    return {};
  }
}

function saveDQConfig(config: DQScoreConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DQ_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage is best-effort; the session still uses the in-memory config.
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

/** One delimited file to append: a loose file or an archive entry. */
interface AppendSource {
  name: string;
  size: number;
  /** Reads roughly the first `bytes` bytes (enough for header detection). */
  prefix: (bytes: number) => Promise<ArrayBuffer>;
  /** Reads the whole file; called again on reload, so it must return a fresh buffer. */
  all: () => Promise<ArrayBuffer>;
}

interface ImportSource {
  name: string;
  /** The chosen header layout, or null while the automatic guess is in use. */
  layout: HeaderLayout | null;
  /** Shown in the header-row chooser, e.g. that one layout covers several files. */
  note?: string;
  /** First rows as parsed, before any header handling. */
  readPreview: () => Promise<string[][]>;
  /** Re-reads the source with a new layout (null = automatic) and rebuilds the table. */
  reload: (layout: HeaderLayout | null) => Promise<void>;
}

const HEADER_PREVIEW_ROWS = 60;

/** Copies bytes into a standalone ArrayBuffer that can be transferred to the worker. */
function bytesToBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
const MULTI_FILE_HEADER_NOTE =
  "Shown for the first file. The same rows to skip and header rows apply to every file, so they need a consistent layout.";
const HEADER_PREVIEW_BYTES = 1_000_000;

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
  private exportFormat: ExportFormat = "csv";
  private exportCompression: ExportCompression = "none";
  private exportDatePrefix = true;
  private bannerEl!: HTMLElement;
  private healthHost!: HTMLElement;
  private healthChipCount = 0;
  private moreButton!: HTMLButtonElement;
  private statsButton!: HTMLButtonElement;
  private convertTypesButton!: HTMLButtonElement;
  private headerRowButton!: HTMLButtonElement;
  /** How the current table was read, so the header row can be re-chosen and reloaded. */
  private importSource: ImportSource | null = null;
  private readonly specials = new Set<SpecialKind>();
  private readonly castFailureCounts = new Map<number, number>();
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
  /** Columns showing thousands separators (display only, data unchanged). */
  private displayGrouping = new Set<number>();
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
  private view: ViewId = "overview";
  private lastLens: ViewId = "table";
  private tabs: ViewTabs | null = null;
  private overviewHost!: HTMLElement;
  private overview: Overview | null = null;
  private latestStats: DatasetStats | null = null;
  /** Current weighted data-quality score (plan §3), or null before load. */
  private dqScore: DQScore | null = null;
  /** User-run checks that feed the score (pair, key, freshness). */
  private dqUserChecks: ScoreCheck[] = [];
  /** Persisted weights/bands overrides for the score. */
  private dqConfig: DQScoreConfig = loadDQConfig();
  /** Active freshness rule (column + max age in days), if the user set one. */
  private freshnessRule: { column: number; days: number } | null = null;
  private scoreTile!: HTMLButtonElement;
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
  private outliersHost!: HTMLElement;
  private relationshipsHost!: HTMLElement;
  private qualityHost!: HTMLElement;
  private qualityPage: QualityPage | null = null;
  /** Engine output for the current data: one finding per possibly-sensitive column. */
  private sensitiveFindings: SensitiveFinding[] = [];
  /** Worker-scanned shape counts per text-like column, filled as results stream in. */
  private sensitiveInputs = new Map<number, ColumnSensitivityInput>();
  private sensitiveScan: { cancel: () => void } | null = null;
  private sensitiveRenderTimer: number | null = null;
  private sensitiveNotes = new Map<number, string>();
  /** Distinct rows failing a deterministic check; undefined while counting. */
  private rowsAffected: { count: number; total: number } | null | undefined = undefined;
  private rowsAffectedKey = "";
  private nearDuplicate: Finding | null = null;
  private nearDuplicateKey = "";
  private suggestedPairsKey = "";
  private accuracyKey = "";
  private rules: Rule[] = [];
  private ruleResults = new Map<string, RuleResult>();
  private ruleKey = "";
  private ruleSuggestions: Rule[] = [];
  private savedRulesOffered = false;
  private historyStore: HistoryStore | null | undefined = undefined;
  private historySnapshots: Snapshot[] = [];
  private historyKeyRecorded = "";
  private disabledSuggestions = new Set<string>();
  private sensitiveScanned = false;
  private sensitiveKey = "";
  private advancedFindings: Finding[] = [];
  private advancedKey = "";
  private advancedLoading = false;
  private advancedToken = 0;
  private outliersPanel: OutliersPanel | null = null;
  private relationshipsPanel: OutliersPanel | null = null;
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
        text: `Overview, Table, Pivot View, Outliers, Relationships and Chart are lenses — ${viewSwitchHint()}.`,
        target: () => (this.workspace.classList.contains("hidden") ? null : this.tabHost),
      },
      {
        id: "command-bar",
        text: "“Enter a command” in the toolbar (or Ctrl/⌘ + K) opens the command bar — “upper amount”, “melt keep region”, “group region sum sales”.",
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
    this.scoreTile = el(
      "button",
      {
        class: "ghost small score-tile hidden",
        type: "button",
        title: "Data quality score — click for the full breakdown",
      },
      [],
    ) as HTMLButtonElement;
    this.scoreTile.addEventListener("click", () => this.openQuality());

    const paletteButton = el(
      "button",
      {
        class: "ghost small palette-button",
        type: "button",
        title: "Type a command — e.g. “convert date_time to datetime”, “upper amount”, “group region sum sales”",
      },
      [el("span", { class: "palette-button-label" }, ["Enter a command"]), el("span", { class: "kbd" }, ["Ctrl/⌘ K"])],
    ) as HTMLButtonElement;
    paletteButton.addEventListener("click", () => this.openPalette());
    helpButton.classList.add("topbar-wide");
    this.themeButton.classList.add("topbar-wide");
    topbar.append(paletteButton, el("span", { class: "grow" }), this.scoreTile, this.themeButton, helpButton);

    this.newButton = el("button", { class: "ghost small topbar-wide", type: "button" }, ["New data"]);
    this.newButton.title = "Load a CSV, Excel, JSON or Parquet file";
    this.newButton.addEventListener("click", () => this.onNewDataClick());
    const overflowButton = el(
      "button",
      { class: "ghost small topbar-overflow", type: "button", title: "Theme, help and data", "aria-label": "More" },
      ["⋯"],
    ) as HTMLButtonElement;
    overflowButton.addEventListener("click", () =>
      openMenu(overflowButton, [
        { label: this.themeButton.textContent ?? "Theme", action: () => this.themeButton.click() },
        { label: "Help", action: () => helpButton.click() },
        { label: this.newButton.textContent ?? "New data", action: () => this.newButton.click() },
      ]),
    );
    topbar.append(this.newButton, overflowButton);

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
      multiple: "multiple",
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
      const files = [...(fileInput.files ?? [])];
      if (files.length > 0) void this.loadFiles(files);
      fileInput.value = "";
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
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      dropzone.classList.remove("dragging");
      void this.loadFiles(files);
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
      { class: "ghost small nav-action", type: "button", title: "Review, undo or export the applied changes" },
      ["Recipe"],
    ) as HTMLButtonElement;
    this.stepsButton.addEventListener("click", () => this.openSteps());

    this.exportButton = el(
      "button",
      {
        class: "ghost small nav-action",
        type: "button",
        title: "Choose a file name and format, then export",
      },
      ["Export…"],
    ) as HTMLButtonElement;
    this.exportButton.addEventListener("click", () => this.openExportDialog());

    // Lives in the top bar so it is reachable on every page, including
    // Overview (which has no filter sidebar) and with the sidebar collapsed.
    this.convertTypesButton = el(
      "button",
      {
        class: "ghost small nav-action convert-types-button",
        type: "button",
        title: "Change how columns are read: integer, number, date, text, identifier…",
        "aria-label": "Convert column types",
      },
      ["Convert types"],
    ) as HTMLButtonElement;
    this.convertTypesButton.addEventListener("click", () => this.openBatchTypes());

    this.headerRowButton = el(
      "button",
      {
        class: "ghost small nav-action header-row-button",
        type: "button",
        title: "Choose which row holds the column names, or how many rows to skip",
        "aria-label": "Set header row",
      },
      ["Header row…"],
    ) as HTMLButtonElement;
    this.headerRowButton.disabled = true;
    this.headerRowButton.addEventListener("click", () => void this.openHeaderRowOverride());

    const actionsMenu = el(
      "button",
      { class: "ghost small nav-actions-menu", type: "button", title: "Convert types, recipe and export" },
      ["Actions ▾"],
    ) as HTMLButtonElement;
    actionsMenu.addEventListener("click", () =>
      openMenu(actionsMenu, [
        { label: "Convert types", action: () => this.convertTypesButton.click() },
        {
          label: "Header row…",
          title: this.headerRowButton.title,
          disabled: this.headerRowButton.disabled,
          action: () => this.headerRowButton.click(),
        },
        {
          label: this.stepsButton.textContent ?? "Recipe",
          title: this.stepsButton.title,
          disabled: this.stepsButton.disabled,
          action: () => this.stepsButton.click(),
        },
        { label: "Export…", title: this.exportButton.title, disabled: this.exportButton.disabled, action: () => this.exportButton.click() },
      ]),
    );
    const navRow = el("div", { class: "nav-row" }, [
      tabHost,
      el("span", { class: "grow" }),
      el("div", { class: "nav-actions" }, [
        this.convertTypesButton,
        this.headerRowButton,
        this.stepsButton,
        this.exportButton,
        actionsMenu,
      ]),
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
    const typesButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Convert column types" },
      ["Types"],
    ) as HTMLButtonElement;
    typesButton.addEventListener("click", () => this.openBatchTypes());
    sidebarHead.append(typesButton);
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

    this.statsButton = el(
      "button",
      {
        class: "ghost small stats-toolbar-button",
        type: "button",
        title: "Open the full per-column Stats Report",
      },
      [svgIcon(STATS_ICON, "stats-report-icon"), "Stats report"],
    ) as HTMLButtonElement;
    this.statsButton.addEventListener("click", () => this.openStats());

    resultsRow.append(
      this.countEl,
      this.filterChipsEl,
      this.addFilterButton,
      this.healthHost,
      this.tilesButton,
      this.statsButton,
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
    this.outliersHost = el("div", { class: "outliers-host hidden" });
    this.relationshipsHost = el("div", { class: "outliers-host hidden" });
    this.qualityHost = el("div", { class: "quality-host hidden" });
    this.columnsStrip = el("div", { class: "column-strip hidden" });
    results.append(
      resultsBar,
      this.columnsStrip,
      this.qualityHost,
      this.tableHost,
      this.chartHost,
      this.viewsHost,
      this.outliersHost,
      this.relationshipsHost,
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
      onBlankTokens: (tokens) => {
        const examples = tokens.slice(0, 3).map((token) => `“${token}”`).join(", ");
        this.confirmFix(
          `Blank placeholder values ${examples}?`,
          "Matching placeholder text becomes empty cells in every affected column. This is recorded in the Recipe and can be undone.",
          "Blank placeholders",
          () => this.applyNullPolicyAll(tokens, []),
        );
      },
      onArchetypeChange: (id) => {
        this.archetypeOverride = id;
        this.rerenderOverview();
      },
      onOpenTriage: () => this.openTriage(),
      onOpenQuality: () => this.setView("quality"),
      issueSummary: () => this.issueSummary(),
    });
    const body = el("div", { class: "workspace-body" }, [sidebar, results]);
    workspace.append(navRow, this.overviewHost, body);
    return workspace;
  }

  /** Opens the fuzzy command palette (Ctrl/⌘+K or the "Enter a command" button). */
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
      else if (event.key === "2") this.setView("quality");
      else if (event.key === "3") this.setView("table");
      else if (event.key === "4") this.setView("views");
      else if (event.key === "5") this.setView("outliers");
      else if (event.key === "6") this.setView("relationships");
      else if (event.key === "7") this.setView("chart");
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
    const importSource = (layout: HeaderLayout | null): ImportSource => ({
      name: "Pasted data",
      layout,
      readPreview: async () =>
        parseDelimited(text.slice(0, HEADER_PREVIEW_BYTES), {
          delimiter: this.delimiterSelect.value as Delimiter | "auto",
          hasHeaders: false,
          normalizeRows: false,
          preview: HEADER_PREVIEW_ROWS,
        }).rows,
      reload: (next) =>
        this.load({
          text,
          name: "Pasted data",
          source: "paste",
          maxRows,
          headerLayout: next ?? undefined,
          importSource: importSource(next),
        }),
    });
    void this.load({
      text,
      name: "Pasted data",
      source: "paste",
      maxRows,
      importSource: importSource(null),
    });
  }

  private async load(options: {
    text?: string;
    buffer?: ArrayBuffer;
    files?: { name: string; buffer?: ArrayBuffer }[];
    name: string;
    source: "paste" | "file";
    maxRows?: number;
    deferStats?: boolean;
    headerLayout?: HeaderLayout;
    importSource?: ImportSource;
  }): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.generation++;
    this.pendingSend = null;
    this.hideTablePicker();
    this.setLoadingText(
      options.files !== undefined && options.files.length > 1
        ? `Parsing ${options.files.length} files.`
        : "Parsing.",
    );
    this.sourceBytes =
      options.text !== undefined
        ? new TextEncoder().encode(options.text).byteLength
        : options.files !== undefined
          ? options.files.reduce((sum, file) => sum + (file.buffer?.byteLength ?? 0), 0)
          : (options.buffer?.byteLength ?? null);

    try {
      const loaded = await this.client.load({
        name: options.name,
        delimiter: this.delimiterSelect.value as Delimiter | "auto",
        hasHeaders: this.headersCheckbox.checked,
        text: options.text,
        buffer: options.buffer,
        files: options.files,
        maxRows: options.maxRows,
        headerLayout: options.headerLayout,
        deferStats:
          options.deferStats ??
          ((options.buffer !== undefined || options.files !== undefined) &&
            (this.sourceBytes ?? 0) >= DEFER_STATS_BYTES),
      });
      this.statusEl.textContent = "";
      this.hideLoadProgress();
      this.openWorkspace(loaded);
      this.setImportSource(options.importSource ?? null);
      if (loaded.statsPending === true) void this.finalizeDatasetMetrics(loaded);
      if (options.files !== undefined && options.files.length > 1) {
        this.setAction(
          `${options.files.length} files appended - ${loaded.rowCount.toLocaleString()} rows with _input_filename.`,
        );
      }
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

  private async loadFiles(files: File[]): Promise<void> {
    if (files.length === 1) {
      await this.loadFile(files[0]);
      return;
    }
    const unsupported = files.find(
      (file) => !MULTI_FILE_EXTENSIONS.includes(extensionOf(file.name)),
    );
    if (unsupported !== undefined) {
      this.setStatusError(
        "Multiple-file import supports CSV, TSV, PSV, TXT and DAT files. Select one file for other formats.",
      );
      return;
    }
    await this.appendSources(
      files.map((file) => ({
        name: file.name,
        size: file.size,
        prefix: (bytes) => file.slice(0, bytes).arrayBuffer(),
        all: () => file.arrayBuffer(),
      })),
      `${files.length} files`,
    );
  }

  /**
   * Appends several delimited sources (loose files or archive entries) into one
   * table: preflight with a shared header-row choice, then one worker load that
   * aligns columns by name. Every source gets the same layout.
   */
  private async appendSources(unsorted: readonly AppendSource[], label: string): Promise<void> {
    const sorted = [...unsorted].sort((a, b) => a.name.localeCompare(b.name));
    // One header layout for every file: appended files must share a format.
    let layout: HeaderLayout | null = null;
    let preflight: MultiFilePreflight;
    let mode: MultiFileAppendMode;
    for (;;) {
      const samples: FilePreflightSample[] = [];
      for (const file of sorted) {
        const buffer = await file.prefix(PREFLIGHT_BYTES);
        const decoded = decodeText(buffer);
        const delimiter = this.delimiterSelect.value as Delimiter | "auto";
        const detect = layout !== null || this.headersCheckbox.checked;
        const parsed = parseDelimited(decoded.text, {
          delimiter,
          hasHeaders: false,
          normalizeRows: false,
          preview: 500,
        });
        // Same header handling as the real load, so the preview matches it.
        const table = detect ? detectTable(parsed.rows, layout ?? undefined) : null;
        const fallback = table === null ? parseDelimited(decoded.text, { delimiter, hasHeaders: false, preview: 500 }) : null;
        samples.push({
          name: file.name,
          size: file.size,
          headers: table?.headers ?? fallback?.headers ?? [],
          sampleRows: table?.rows.length ?? fallback?.rows.length ?? 0,
          sampleBytes: buffer.byteLength,
          encoding: decoded.encoding,
          delimiter: parsed.delimiter,
        });
      }
      preflight = buildMultiFilePreflight(samples);
      const choice = await openMultiFilePreflight(preflight);
      if (choice === null) return;
      if (choice !== "headerRow") {
        mode = choice;
        break;
      }
      const picked = await this.chooseMultiFileHeader(sorted, layout);
      if (picked !== undefined) layout = picked;
    }
    if (mode === "identical" && !preflight.identicalColumns) {
      this.setStatusError("The files do not have identical columns.");
      return;
    }
    this.sampleNote = null;
    let maxRows: number | undefined;
    if (preflight.totalCells > LARGE_LOAD_CELLS) {
      const choice = await openLargeLoadDialog(
        {
          rows: preflight.totalRows,
          cells: preflight.totalCells,
          columns: preflight.commonColumns.length,
        },
        label,
      );
      if (choice === null) return;
      if (choice === "sample") {
        maxRows = SAMPLE_ROWS;
        this.sampleNote = `sample: ~${SAMPLE_ROWS.toLocaleString()} rows across ${sorted.length} files`;
      }
    }
    this.showLoadProgress(
      label,
      sorted.reduce((sum, file) => sum + file.size, 0),
    );
    try {
      const payload: { name: string; buffer: ArrayBuffer }[] = [];
      for (const file of sorted) {
        payload.push({ name: file.name, buffer: await file.all() });
      }
      const importSource = (current: HeaderLayout | null): ImportSource => ({
        name: label,
        layout: current,
        note: MULTI_FILE_HEADER_NOTE,
        readPreview: () => this.readFilePreview(sorted[0]),
        reload: async (next) => {
          const again: { name: string; buffer: ArrayBuffer }[] = [];
          for (const file of sorted) again.push({ name: file.name, buffer: await file.all() });
          await this.load({
            files: again,
            name: label,
            source: "file",
            maxRows,
            headerLayout: next ?? undefined,
            importSource: importSource(next),
          });
        },
      });
      await this.load({
        files: payload,
        name: label,
        source: "file",
        maxRows,
        headerLayout: layout ?? undefined,
        importSource: importSource(layout),
      });
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not read files");
    }
  }

  /** First rows of a delimited file exactly as parsed, for the header-row chooser. */
  private async readFilePreview(file: AppendSource): Promise<string[][]> {
    return parseDelimited(decodeText(await file.prefix(HEADER_PREVIEW_BYTES)).text, {
      delimiter: this.delimiterSelect.value as Delimiter | "auto",
      hasHeaders: false,
      normalizeRows: false,
      preview: HEADER_PREVIEW_ROWS,
    }).rows;
  }

  /**
   * Asks for the header layout using the first file as the example. The result
   * applies to every file; undefined means the user cancelled, null means
   * "back to the automatic guess".
   */
  private async chooseMultiFileHeader(
    files: readonly AppendSource[],
    current: HeaderLayout | null,
  ): Promise<HeaderLayout | null | undefined> {
    const preview = await this.readFilePreview(files[0]);
    if (preview.length === 0) return undefined;
    const auto = detectTable(preview);
    const result = await openHeaderRowDialog({
      name: files[0].name,
      preview,
      current: current ?? { skipRows: auto.skipRows, headerRows: auto.headerRows },
      overridden: current !== null,
      note: MULTI_FILE_HEADER_NOTE,
    });
    if (result === null) return undefined;
    return result.kind === "auto" ? null : result.layout;
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
      const sampleRows = maxRows === "sample" ? SAMPLE_ROWS : undefined;
      // The buffer is handed to the worker, so a reload re-reads the file.
      const importSource = (layout: HeaderLayout | null): ImportSource => ({
        name: file.name,
        layout,
        readPreview: async () =>
          parseDelimited(decodeText(await file.slice(0, HEADER_PREVIEW_BYTES).arrayBuffer()).text, {
            delimiter: this.delimiterSelect.value as Delimiter | "auto",
            hasHeaders: false,
            normalizeRows: false,
            preview: HEADER_PREVIEW_ROWS,
          }).rows,
        reload: async (next) =>
          this.load({
            buffer: await file.arrayBuffer(),
            name: file.name,
            source: "file",
            maxRows: sampleRows,
            headerLayout: next ?? undefined,
            importSource: importSource(next),
          }),
      });
      await this.load({
        buffer,
        name: file.name,
        source: "file",
        maxRows: sampleRows,
        importSource: importSource(null),
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
      // Delimited files can be appended into one table. The preflight shows how
      // well the columns line up and lets the user choose one header row for all.
      const allDelimited = entries.every(
        (entry) => !WORKBOOK_EXTENSIONS.includes(extensionOf(entry.name)),
      );
      if (allDelimited) {
        const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
        this.showPicker(
          `${entries.length} files in ${fileName} — pick one, or append them all`,
          pickItems,
          {
            label: `Import all ${entries.length} files (append rows)`,
            title: "Append every file into one table. You can check the columns and choose the header row first.",
            note: `${formatBytes(totalBytes)} · header row can be chosen`,
            onSelect: () => {
              this.hideTablePicker();
              void this.appendSources(
                entries.map((entry) => this.archiveSource(entry, buffer)),
                `${fileName.replace(/\.zip$/i, "")} — ${entries.length} files`,
              );
            },
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
      await this.loadWithHeaderSource(
        data,
        `${fileName.replace(/\.zip$/i, "")}/${entry.path}`,
        async () => bytesToBuffer(await readArchiveEntry(archive, entry.path)),
      );
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not extract file");
    }
  }

  /** An archive entry as an append source; reads only the bytes asked for. */
  private archiveSource(entry: ArchiveEntry, archive: ArrayBuffer): AppendSource {
    return {
      name: entry.name,
      size: entry.size,
      prefix: async (bytes) => {
        const prefixes = await readArchivePrefixes(archive, [entry.path], bytes);
        const data = prefixes.get(entry.path);
        if (data === undefined) throw new Error(`“${entry.name}” could not be read`);
        return bytesToBuffer(data);
      },
      all: async () => bytesToBuffer(await readArchiveEntry(archive, entry.path)),
    };
  }

  /** Decompresses a .gz and routes the inner file (data, workbook or zip). */
  private async openGzip(buffer: ArrayBuffer, fileName: string): Promise<void> {
    this.hideTablePicker();
    this.setLoadingText("Decompressing…");
    try {
      const { gunzipSync } = await import("fflate");
      const inner = gunzipSync(new Uint8Array(buffer));
      await this.routeDecompressed(inner, fileName.replace(/\.gz$/i, ""), async () =>
        bytesToBuffer(gunzipSync(new Uint8Array(buffer))),
      );
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
      await this.routeDecompressed(inner, fileName.replace(/\.bz2$/i, ""), async () =>
        bytesToBuffer(await decompressBzip2(buffer)),
      );
    } catch (error) {
      this.setStatusError(error instanceof Error ? error.message : "Could not decompress file");
    }
  }

  /** Routes a freshly decompressed buffer to the right loader. */
  private async routeDecompressed(
    inner: Uint8Array,
    innerName: string,
    /** Produces the decompressed bytes again, so the header row can be re-chosen. */
    reopen?: () => Promise<ArrayBuffer>,
  ): Promise<void> {
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
    if (reopen === undefined) {
      await this.load({ buffer: data, name: innerName, source: "file" });
      return;
    }
    await this.loadWithHeaderSource(data, innerName, reopen);
  }

  /**
   * Loads a delimited buffer that came out of an archive or compressed file and
   * remembers how to re-extract it, so the header row can be chosen afterwards.
   */
  private async loadWithHeaderSource(
    data: ArrayBuffer,
    name: string,
    reopen: () => Promise<ArrayBuffer>,
  ): Promise<void> {
    const importSource = (layout: HeaderLayout | null): ImportSource => ({
      name,
      layout,
      readPreview: async () =>
        parseDelimited(decodeText((await reopen()).slice(0, HEADER_PREVIEW_BYTES)).text, {
          delimiter: this.delimiterSelect.value as Delimiter | "auto",
          hasHeaders: false,
          normalizeRows: false,
          preview: HEADER_PREVIEW_ROWS,
        }).rows,
      reload: async (next) =>
        this.load({
          buffer: await reopen(),
          name,
          source: "file",
          headerLayout: next ?? undefined,
          importSource: importSource(next),
        }),
    });
    await this.load({ buffer: data, name, source: "file", importSource: importSource(null) });
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
  private async loadGrid(grid: string[][], name: string, layout?: HeaderLayout): Promise<void> {
    const source: ImportSource = {
      name,
      layout: layout ?? null,
      readPreview: async () => grid.slice(0, HEADER_PREVIEW_ROWS),
      reload: (next) => this.loadGrid(grid, name, next ?? undefined),
    };
    if (layout === undefined && !this.headersCheckbox.checked) {
      await this.loadTable(grid, name, false);
      this.setImportSource(source);
      return;
    }

    const detected = detectTable(grid, layout);
    const combined =
      detected.headerRows > 0 ? [detected.headers, ...detected.rows] : detected.rows;
    if (combined.length === 0) throw new Error("That table has no data");

    await this.loadTable(combined, name, detected.headerRows > 0);
    this.setImportSource(source);

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
    this.setImportSource(null);

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
    const captured = this.chartsPanel?.captureConfigs() ?? this.chartRestore;
    const hadOrphans =
      (captured ?? []).some((config) => (config.missingColumns?.length ?? 0) > 0) ||
      (this.chartRestore ?? []).some((config) => (config.missingColumns?.length ?? 0) > 0);
    if (captured !== null) {
      const remapped = remapChartConfigs(captured, loaded.columns);
      this.chartRestore = remapped.named;
      this.chartRemoved = remapped.removed;
    } else {
      this.chartRestore = null;
      this.chartRemoved = 0;
    }
    if (loaded.type === "loaded" && !hadOrphans) {
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
    this.displayGrouping.clear();
    // User-run checks reference filter bits that reset with the data.
    this.dqUserChecks = [];
    this.freshnessRule = null;
    this.sensitiveScan?.cancel();
    this.sensitiveScan = null;
    this.sensitiveInputs.clear();
    this.sensitiveFindings = [];
    this.sensitiveScanned = false;
    this.sensitiveKey = "";
    this.syncChangesButton();
    // Views are definitions over column indexes; a load or transform can change
    // the schema, so start fresh rather than risk stale references.
    this.resetViews();
    const scoreBaselineReset = this.datasetName !== loaded.name;
    if (scoreBaselineReset) {
      // Rules and history belong to one file; a different file starts clean.
      this.rules = [];
      this.ruleResults = new Map();
      this.ruleKey = "";
      this.savedRulesOffered = false;
      this.historyKeyRecorded = "";
      this.historySnapshots = [];
    }
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
    this.castFailureCounts.clear();
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
    this.actionEl.textContent = "";
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
    this.refreshScore(scoreBaselineReset);
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
    if (this.chartRemoved > 0) {
      const count = this.chartRemoved;
      this.showWarning(
        `${count} chart${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} a column that is no longer in this table. Open Chart to rebind or remove ${count === 1 ? "it" : "them"}.`,
      );
    }
    if (loaded.type === "loaded") {
      this.view = readDefaultView();
      const sidebarPreference = this.readSidebarCollapsed();
      this.setSidebarCollapsed(
        sidebarPreference ?? (loaded.columnCount > 8 || window.innerWidth < 1100),
      );
    }
    this.setView(this.view);
  }

  /** Finish heavy metrics after the table is already interactive. */
  private async finalizeDatasetMetrics(loaded: LoadedMessage): Promise<void> {
    const name = loaded.name;
    this.setAction("Updating dataset metrics in the background.");
    try {
      const message = await this.client.finalizeStats();
      if (this.datasetName !== name) return;
      this.metas = message.columns;
      this.latestStats = message.stats;
      if (this.lastLoaded !== null) {
        this.lastLoaded = {
          ...this.lastLoaded,
          columns: message.columns,
          stats: message.stats,
        };
      }
      this.table?.setColumns(this.metas);
      this.table?.setCount(message.count);
      this.table?.setFirstRows(
        message.firstRows,
        message.firstGroups,
        message.firstFlags,
        message.firstChanged,
      );
      for (let index = 0; index < this.metas.length; index++) {
        this.filterPanel?.updateMeta(index, this.metas[index] as ColumnMeta);
      }
      this.applyDatasetStats(message.stats);
      this.updateCount(message.count, message.queryMs);
      this.chartsPanel?.setColumns(this.metas);
      this.setAction("Dataset metrics ready.");
    } catch (error) {
      this.setAction(
        error instanceof Error
          ? `Dataset metrics could not be completed: ${error.message}`
          : "Dataset metrics could not be completed.",
      );
    }
  }
  private ensureTable(): void {
    if (this.table !== null) return;
    this.table = new ResultTable(this.tableHost, {
      onSort: (column, dir) => this.changeSort(column, dir),
      onColumnInspect: (column, anchor) => this.openColumnInspector(column, anchor),
      onTypeChange: (column, type) => this.changeType(column, type),
      quickFilterFor: (column) => {
        const filter = this.filters.get(column);
        return filter?.kind === "text" && filter.mode === "contains" ? filter.query : "";
      },
      columnFilterFor: (column) => this.filters.get(column) ?? null,
      onColumnFilter: (column, filter) => this.changeFilter(column, filter),
      onQuickFilter: (column, query) =>
        this.changeFilter(
          column,
          query === "" ? null : { kind: "text", mode: "contains", query },
        ),
      onColumnSpecial: (column, kind) => this.viewColumnSpecial(column, kind),
      onMergeSimilar: (column) => this.openMerge(column),
      onColumnContext: (column, x, y) => this.openColumnMenu(column, x, y),
      onToggleColumnDelete: (column) => this.toggleColumnDelete(column),
      onToggleRowDelete: (position) => this.toggleRowDelete(position),
      onSuggestion: (column, suggestion) => this.applySuggestion(column, suggestion),
      onConvertToken: (column, tokens) => this.convertToken(column, tokens),
      onWinsorize: (column, percent) => this.winsorizeColumn(column, percent),
      onFlagAnomalies: (column) => this.flagAnomaliesColumn(column),
      onOpenClean: (column, tab) => this.openClean(column, tab),
      onFillMenu: (anchor, column) => openMenu(anchor, this.fillMenuItems([column])),
      onOutlierMenu: (anchor, column) => openMenu(anchor, this.outlierMenuItems([column])),
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
    this.table.setSensitive(this.sensitiveNotes);
    this.table.setSort(-1, 1);
    this.table.setCount(this.resultCount);
    this.table.setFormats(this.displayFormats);
    this.table.setGrouping(this.displayGrouping);
    this.table.setShowChanges(this.showChanges);
    this.syncColumnQa();
    this.syncPendingDeletes();
  }

  private ensureCharts(): void {
    if (this.chartsPanel !== null) {
      this.chartsPanel.ensureGroups();
      return;
    }
    this.chartsPanel = new ChartsPanel(this.chartHost, {
      datasetName: () => this.datasetName,
      requestBins: (column, options, exclude) =>
        this.client.getChartBins(column, options, exclude),
      requestSeries: (input) => this.client.getChartSeries(input),
      requestBoxStats: (input) => this.client.getBoxStats(input),
      requestChartGroups: async (columns) => (await this.client.getChartGroups(columns)).groups,
      requestCrosstab: (input) => this.client.getCrosstab(input),
      requestCorrelation: (columns, scope) => this.client.getCorrelation(columns, scope),
      requestGroupedBins: (input) => this.client.getGroupedBins(input),
      requestViewAggregate: (source) => this.aggregateForSource(source),
      requestViewPivot: (source) => this.pivotForSource(source),
      requestAggregate: (view) => this.client.getAggregate(view),
      requestTextProfile: (column) => this.client.getTextProfile(column),
      requestGridCounts: (xColumn, yColumn, bins, measure, groupColumn, scope) =>
        this.client.getGridCounts(xColumn, yColumn, bins, measure, groupColumn, scope),
      requestAnimation: (input) => this.client.getAnimation(input),
      tableSourceLabel: () =>
        this.filters.size === 0 &&
        this.specials.size === 0 &&
        this.columnSpecials.size === 0
          ? "Table"
          : "Table (filtered)",
      onCardAdded: (label, undo) => {
        const message = `Added a ${label} chart at the top of the grid`;
        this.setAction(message);
        if (undo !== undefined) this.showToast(message, undo);
      },
      onCardEdited: (message) => this.setAction(message),
      onFilter: (column, filter, preview) =>
        this.changeFilter(column, filter, preview ?? false),
      currentFilter: (column) => this.filters.get(column) ?? null,
      onFilterTable: (filters, label) => this.applyChartFilters(filters, label, false),
      onShowRows: (filters, label) => this.applyChartFilters(filters, label, true),
      onConvertToken: (column, tokens) => this.convertToken(column, tokens),
      onSuggestion: (column, suggestion) => this.applySuggestion(column, suggestion),
      onMapBrush: (selection) => this.filterToMapArea(selection),
      onBrush: (ranges) => this.filterToBrush(ranges),
    });
    if (this.chartRestore !== null) {
      const remapped = remapChartConfigs(this.chartRestore, this.metas);
      this.chartsPanel.restore(remapped.entries, this.metas);
      this.chartRestore = null;
      this.chartRemoved = 0;
    } else {
      this.chartsPanel.setColumns(this.metas);
    }
    this.chartsPanel.setSources(this.viewSources());
    this.chartsPanel.setFiltered(this.latestFacets, this.latestHistograms);
    this.chartsPanel.setRowCount(this.resultCount);
    this.chartsPanel.setTotalRowCount(this.rowCount);
    this.chartsPanel.ensureGroups();
  }

  /** The view list every Source selector offers, alongside the table. */
  private viewSources(): ViewSource[] {
    return this.viewsPanel?.sources() ?? [];
  }

  private aggregateForSource(source: string): Promise<AggregateMessage | null> {
    const def = this.viewsPanel?.viewDef(source);
    if (def === undefined) return Promise.resolve(null);
    return this.client.getAggregate(def);
  }

  private pivotForSource(source: string): Promise<PivotMessage | null> {
    const def = this.viewsPanel?.pivotDef(source);
    if (def === undefined) return Promise.resolve(null);
    return this.client.getPivot(def);
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
        this.applyDropResult(message);
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

  private applyDropResult(message: ResultsMessage): void {
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
  }

  /** Removes outlier rows picked on the Outliers page; returns whether anything was removed. */
  private async removeRowsById(rows: number[]): Promise<boolean> {
    if (rows.length === 0) return false;
    const confirmed = await openConfirm({
      title: rows.length === 1 ? `Remove row ${(rows[0] ?? 0) + 1}?` : `Remove ${rows.length} rows?`,
      body: "The row is removed from the working set — counts and exports exclude it. This is recorded and undoable from the Recipe (Restore removed rows).",
      confirmLabel: rows.length === 1 ? "Remove row" : "Remove rows",
      danger: true,
    });
    if (!confirmed) return false;
    try {
      const message = await this.client.dropRowsById(rows);
      this.excludedRowCount += rows.length;
      this.applyDropResult(message);
      this.setAction(`Removed ${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}`);
      return true;
    } catch (error) {
      this.showError(error);
      return false;
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

  /**
   * A View chip shows one issue in isolation: clear every other filter and
   * special first so the result is exactly the rows the chip describes.
   */
  private viewSpecial(kind: SpecialKind): void {
    if (this.specials.has(kind)) {
      this.toggleSpecial(kind);
      return;
    }
    const activeSpecials = [...this.specials];
    const activeColumns = [...this.columnSpecials.entries()].map(
      ([column, kinds]) => [column, [...kinds]] as const,
    );
    this.shuffleActive = false;
    this.filters.clear();
    this.specials.clear();
    this.columnSpecials.clear();
    this.specials.add(kind);
    this.syncHealthChips();
    this.renderFilterChips();
    this.syncColumnQa();
    this.filterPanel?.rebuild();
    this.table?.setHighlights([]);
    if (kind === "duplicates") this.table?.setSort(-1, 1);
    this.queueSend(() =>
      this.runIsolatedSpecial(activeSpecials, activeColumns, () =>
        this.client.setSpecial(kind, true),
      ),
    );
  }

  private viewColumnSpecial(column: number, kind: ColumnQaKind): void {
    if (this.columnSpecials.get(column)?.has(kind) === true) {
      this.toggleColumnSpecial(column, kind);
      return;
    }
    const activeSpecials = [...this.specials];
    const activeColumns = [...this.columnSpecials.entries()].map(
      ([index, kinds]) => [index, [...kinds]] as const,
    );
    this.shuffleActive = false;
    this.filters.clear();
    this.specials.clear();
    this.columnSpecials.clear();
    this.columnSpecials.set(column, new Set([kind]));
    this.syncHealthChips();
    this.renderFilterChips();
    this.syncColumnQa();
    this.filterPanel?.rebuild();
    this.table?.setHighlights([]);
    this.queueSend(() =>
      this.runIsolatedSpecial(activeSpecials, activeColumns, () =>
        this.client.setSpecial(kind, true, column),
      ),
    );
  }

  private async runIsolatedSpecial(
    activeSpecials: readonly SpecialKind[],
    activeColumns: readonly (readonly [number, readonly ColumnQaKind[]])[],
    apply: () => Promise<ResultsMessage>,
  ): Promise<void> {
    try {
      await this.client.clearFilters();
      for (const active of activeSpecials) {
        await this.client.setSpecial(active, false);
      }
      for (const [column, kinds] of activeColumns) {
        for (const active of kinds) {
          await this.client.setSpecial(active, false, column);
        }
      }
      const result = await apply();
      this.updateCount(result.count, result.queryMs);
      this.applyFacets(result.facets, result.histograms);
      this.table?.setCount(result.count);
      this.table?.setFirstRows(
        result.firstRows,
        result.firstGroups,
        result.firstFlags,
        result.firstChanged,
      );
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
    this.renderFilterChips();

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

  /** Chart actions apply ordinary, removable filters; only "show rows" navigates. */
  private applyChartFilters(
    filters: readonly { column: number; filter: ColumnFilter }[],
    label: string,
    showRows: boolean,
  ): void {
    if (filters.length === 0) return;
    for (const item of filters) this.filters.set(item.column, item.filter);
    this.renderFilterChips();
    this.table?.refreshFilters();
    this.table?.setHighlights(this.highlightRules());
    this.queueSend(() =>
      this.client
        .setFilters([...filters])
        .then((message) => {
          this.updateCount(message.count, message.queryMs);
          this.applyFacets(message.facets, message.histograms);
          this.chartsPanel?.refreshBoundViews();
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
    if (showRows) {
      this.setView("table");
      this.table?.scrollToTop();
      const column = filters[0]?.column;
      if (column !== undefined) this.table?.flashColumn(column);
    }
    this.setAction(
      `${showRows ? "Showing rows for" : "Filtered table to"} ${label} (${filters.length} filter${filters.length === 1 ? "" : "s"})`,
    );
  }
  /** Shift+drag on a chart: range-filter each brushed column and say what was kept. */
  private filterToBrush(ranges: BrushRange[]): void {
    const parts: string[] = [];
    for (const range of ranges) {
      this.changeFilter(range.column, { kind: "range", min: range.min, max: range.max });
      const meta = this.metas[range.column];
      const fmt = (value: number): string =>
        meta?.type === "date" || meta?.type === "datetime"
          ? new Date(value).toISOString().slice(0, meta.type === "date" ? 10 : 16).replace("T", " ")
          : Number(value.toPrecision(6)).toLocaleString();
      parts.push(`${meta?.name ?? "column"} ${fmt(range.min)} to ${fmt(range.max)}`);
    }
    this.setAction(`Chart selection: ${parts.join(", ")}`);
  }

  /** Map rectangle brush: range-filter both coordinate columns to the area. */
  private filterToMapArea(selection: MapBrushSelection): void {
    const lat = this.metas[selection.latColumn]?.name ?? "latitude";
    const lon = this.metas[selection.lonColumn]?.name ?? "longitude";
    this.changeFilter(selection.lonColumn, {
      kind: "range",
      min: selection.lonMin,
      max: selection.lonMax,
    });
    this.changeFilter(selection.latColumn, {
      kind: "range",
      min: selection.latMin,
      max: selection.latMax,
    });
    this.setAction(
      `Map area: ${lon} ${selection.lonMin.toFixed(3)} to ${selection.lonMax.toFixed(3)}, ${lat} ${selection.latMin.toFixed(3)} to ${selection.latMax.toFixed(3)}`,
    );
  }

  private changeFilter(column: number, filter: ColumnFilter | null, preview = false): void {
    this.shuffleActive = false;
    if (filter === null) this.filters.delete(column);
    else this.filters.set(column, filter);
    this.renderFilterChips();
    this.table?.refreshFilters();

    this.table?.setHighlights(this.highlightRules());

    this.queueSend(() =>
      this.client
        .setFilter(column, filter, preview)
        .then((message) => {
          this.updateCount(message.count, message.queryMs);
          if (!preview) {
            this.applyFacets(message.facets, message.histograms);
            this.chartsPanel?.refreshBoundViews();
          }
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

  private changeType(
    column: number,
    type: ColumnType,
    record = true,
  ): boolean | Promise<boolean> {
    if (record && this.castTargetFor(type) !== null) {
      return this.confirmCast(column, type);
    }
    this.setColumnType(column, type, record);
    return true;
  }

  private castTargetFor(type: ColumnType): CastTarget | null {
    switch (type) {
      case "integer":
      case "number":
      case "date":
      case "datetime":
      case "time":
      case "duration":
      case "boolean":
        return type;
      default:
        return null;
    }
  }

  /** Batch conversion queue shared by all filter/sidebar entry points. */
  private async openBatchTypes(): Promise<void> {
    if (this.metas.length === 0) return;
    const columns = this.metas.map((meta, index) => ({
      index,
      name: meta.name,
      type: meta.type,
      suggested:
        meta.typeDowngrade?.candidate ??
        (this.castTargetFor(meta.type) !== null ? null : null),
      locale: meta.numberLocale,
      order: meta.dateOrder,
      existing: this.cleanedColumns.get(index) ?? [],
    }));
    const result = await openBatchCastDialog({
      columns,
      preview: (updates) => this.client.previewClean(updates),
    }).catch(() => null);
    if (result === null || result.updates.length === 0) return;
    this.applyClean(result.updates);
    this.showToast(
      `Converted ${result.count} column${result.count === 1 ? "" : "s"}`,
      () => this.applyClean(result.previous),
    );
  }
  /** Confirms a value-rewriting type change before touching the dataset. */
  private async confirmCast(column: number, type: ColumnType): Promise<boolean> {
    const meta = this.metas[column];
    const target = this.castTargetFor(type);
    if (meta === undefined || target === null || meta.type === type) return false;
    const name = meta.name;
    const existing = this.cleanedColumns.get(column) ?? [];
    const initial: CastOptions = {
      target,
      policy: "coerce",
      locale: meta.numberLocale,
      dateOrder: meta.dateOrder,
    };
    const castOp = (options: CastOptions): CleanOp => ({
      kind: "cast",
      target: options.target,
      policy: options.policy,
      locale: options.locale,
      order: options.dateOrder,
    });
    const result = await openCastDialog({
      name,
      fromType: meta.type,
      target,
      initial,
      preview: async (options) => {
        const preview = await this.client.previewClean([
          { column, ops: [...existing, castOp(options)] },
        ]);
        const counts = preview.columns[0];
        return {
          changed: counts?.changed ?? 0,
          total: counts?.total ?? 0,
          failed: counts?.failed ?? 0,
          examples: counts?.examples,
          nonEmpty: counts?.nonEmpty,
          digitLoss: counts?.digitLoss,
        };
      },
    }).catch(() => null);
    if (result === null) {
      this.table?.updateColumn(column, meta);
      return false;
    }
    if (result.kind === "reinterpret") {
      this.setColumnType(column, type);
      return true;
    }
    const op = castOp(result.options);
    this.applyClean([{ column, ops: [...existing, op] }]);
    const key = JSON.stringify(op);
    this.showToast(`Converted "${name}" to ${TYPE_LABELS[type]}`, () => {
      const current = this.cleanedColumns.get(column) ?? [];
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
    return true;
  }

  private setColumnType(column: number, type: ColumnType, record = true): void {
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
          // Decimal display options target real-number columns; a stale
          // preference must not survive a change to integer (or text/date).
          if (type !== "number" && this.displayFormats.has(column)) {
            this.displayFormats.delete(column);
            this.table?.setFormats(this.displayFormats);
          }
          // Tell the user what happened — and when values cannot be
          // represented in the new type, say how many instead of pretending.
          if (previous !== undefined && previous !== type) {
            const nonParsing = message.nonParsing ?? 0;
            if (nonParsing > 0) {
              this.showWarning(
                `“${name}” is now ${TYPE_LABELS[type]} — ${nonParsing.toLocaleString()} value${
                  nonParsing === 1 ? "" : "s"
                } don't parse as ${TYPE_LABELS[type].toLowerCase()} and stay as text.`,
              );
            } else {
              this.showToast(
                `“${name}” is now ${TYPE_LABELS[type]} — display and stats updated.`,
              );
            }
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

  private confirmFix(
    title: string,
    body: string,
    confirmLabel: string,
    run: () => void,
  ): void {
    void openConfirm({ title, body, confirmLabel }).then((confirmed) => {
      if (confirmed) run();
    });
  }

  private winsorizeColumn(column: number, percent: number, switchToTable = false): void {
    const meta = this.metas[column];
    const name = meta?.name ?? "?";
    const count = meta?.anomalyCounts.values ?? 0;
    this.confirmFix(
      `Clip “${name}” at ${percent}% / ${100 - percent}%?`,
      `${count.toLocaleString()} extreme value${count === 1 ? "" : "s"} outside the ${percent}% / ${
        100 - percent
      }% fences will move to the boundary. This is recorded in the Recipe and can be undone.`,
      "Clip values",
      () => {
        if (switchToTable) this.setView("table");
        this.applyTransform(
          [...this.transformOps, { kind: "winsorize", column, percent }],
          `Winsorised "${name}" at ${percent}% / ${100 - percent}%`,
        );
      },
    );
  }

  private flagAnomaliesColumn(column: number, switchToTable = false): void {
    const meta = this.metas[column];
    const name = meta?.name ?? "?";
    const count = meta?.anomalyCounts.values ?? 0;
    this.confirmFix(
      `Flag unusual values in “${name}”?`,
      `${count.toLocaleString()} value${count === 1 ? "" : "s"} outside the column fence will be marked in a new Yes/No column. This is recorded in the Recipe and can be undone.`,
      "Add flag column",
      () => {
        if (switchToTable) this.setView("table");
        this.applyTransform(
          [...this.transformOps, { kind: "flagAnomalies", column }],
          `Flagged unusual cells in "${name}" (new Yes/No column)`,
        );
      },
    );
  }

  private applySuggestion(column: number, suggestion: ColumnSuggestion): void {
    const name = this.metas[column]?.name ?? `Column ${column + 1}`;
    this.confirmFix(
      `Apply this fix to “${name}”?`,
      `${suggestionLabel(suggestion)}. The change is recorded in the Recipe and can be undone.`,
      "Apply fix",
      () => this.applySuggestionNow(column, suggestion),
    );
  }

  private applySuggestionNow(column: number, suggestion: ColumnSuggestion): void {
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
    this.castFailureCounts.clear();
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
        format: this.exportFormat,
        compression: this.exportCompression,
        datePrefix: this.exportDatePrefix,
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
          this.exportFormat = settings.format ?? "csv";
          this.exportCompression = settings.compression ?? "none";
          this.exportDatePrefix = settings.datePrefix ?? true;
          void this.runExport(
            fileName,
            settings.nullAsBlank,
            settings.escapeFormulas,
            settings.scope,
            settings.limit,
            this.exportFormat,
            this.exportCompression,
            settings.sensitiveMode ?? "include",
          );
        },
        onClose: () => undefined,
      },
      this.exportSensitiveColumns().map((card) => card.name),
    );
  }

  /**
   * Possibly-sensitive columns worth a heads-up at export: likely or possible
   * (High or Medium) and not dismissed, or any column the user marked sensitive.
   * Weak signals are ignored so the notice stays rare.
   */
  private exportSensitiveColumns(): SensitiveCard[] {
    return this.sensitiveCards().filter(
      (card) =>
        card.dismissed !== true && (card.confirmed === true || card.confidence !== "low"),
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
    return `${exportFileName(this.datasetName)}${suffix}`;
  }

  private async runExport(
    fileName: string,
    nullAsBlank: boolean,
    escapeFormulas: boolean,
    scope: ExportScope,
    limit: number | null,
    format: ExportFormat = "csv",
    compression: ExportCompression = "none",
    sensitiveMode: "include" | "mask" | "exclude" = "include",
  ): Promise<void> {
    if (this.datasetName === "" || this.loading) return;
    const columnHandling =
      sensitiveMode === "include"
        ? []
        : this.exportSensitiveColumns().map((card) => ({ column: card.column, mode: sensitiveMode }));
    try {
      const info = formatInfo(format);
      const csvFamily = format === "csv" || format === "csv-semicolon" || format === "tsv";
      const compressionExt = EXPORT_COMPRESSIONS.find((entry) => entry.value === compression)?.ext ?? "";
      const pickerType: { description: string; accept: Record<string, string[]> } =
        compression === "none"
          ? { description: `${info.label} file`, accept: { [info.mime]: [info.ext] } }
          : compression === "gzip"
            ? { description: "Gzip archive", accept: { "application/gzip": [compressionExt] } }
            : { description: "Zip archive", accept: { "application/zip": [compressionExt] } };
      // Ask for the destination up front, while the click is still a user
      // gesture; the chunks are streamed into the chosen file afterwards.
      let handle: FileHandleLike | null = null;
      const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
      if (typeof picker === "function") {
        try {
          handle = await picker.call(window, {
            suggestedName: fileName,
            types: [pickerType],
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

      const parts: string[] = [];
      for (let start = 0; start < take; start += EXPORT_CHUNK_ROWS) {
        this.actionEl.textContent = `Exporting… ${Math.round((start / take) * 100)}%`;
        const end = Math.min(start + EXPORT_CHUNK_ROWS, take);
        const chunk = await this.client.getCsv(start, end, {
          nullAsBlank,
          escapeFormulas: csvFamily && escapeFormulas,
          ...(columnHandling.length > 0 ? { columnHandling } : {}),
        });
        parts.push(chunk.text);
      }
      this.actionEl.textContent = `Encoding ${info.label}…`;
      const { blob } = await encodeExport(parts.join(""), format, compression, fileName);

      if (handle !== null) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
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
    if (view === "outliers") this.ensureOutliers();
    if (view === "relationships") this.ensureRelationships();
    if (view === "quality") this.ensureQuality();
    if (view !== "overview") this.lastLens = view;
    const chart = view === "chart";
    this.chartActive = chart;
    this.workspace.classList.toggle("chart-mode", chart);
    this.workspace.classList.toggle("overview-mode", view === "overview");
    this.overviewHost.classList.toggle("hidden", view !== "overview");
    this.qualityHost.classList.toggle("hidden", view !== "quality");
    this.tableHost.classList.toggle("hidden", view !== "table");
    this.chartHost.classList.toggle("hidden", view !== "chart");
    this.viewsHost.classList.toggle("hidden", view !== "views");
    this.outliersHost.classList.toggle("hidden", view !== "outliers");
    this.relationshipsHost.classList.toggle("hidden", view !== "relationships");
    this.healthHost.classList.toggle("hidden", view === "overview" || this.healthChipCount === 0);
    this.moreButton.classList.toggle("hidden", view === "overview");
    this.statsButton.classList.toggle("hidden", view !== "table");
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
      case "cleanAll": {
        // "upper all" style: append the same clean op to every column.
        const updates = this.metas.map((_, column) => ({
          column,
          ops: [...(this.cleanedColumns.get(column) ?? []), command.op],
        }));
        this.applyClean(updates);
        break;
      }
      case "headerCase": {
        const headers = normalizeHeaders(
          this.metas.map((meta) => meta.name),
          { ...DEFAULT_HEADER_OPTIONS, caseStyle: command.style },
        );
        this.applyHeaderRename(headers);
        break;
      }
      case "transform":
        this.applyTransform([...this.transformOps, ...command.ops], command.label);
        break;
      case "dedupe":
        this.dropDuplicates(command.keep);
        break;
      case "quality":
        this.openQuality();
        break;
      case "keyDuplicates": {
        this.setView("table");
        const label = command.label;
        this.queueSend(() =>
          this.client
            .checkKeyDuplicates(command.columns)
            .then((message) => {
              const tail =
                message.duplicateRows === 0
                  ? `no duplicate rows (${message.counted.toLocaleString()} rows with a complete key)`
                  : `${message.duplicateRows.toLocaleString()} duplicate row${
                      message.duplicateRows === 1 ? "" : "s"
                    } in ${message.duplicateGroups.toLocaleString()} group${
                      message.duplicateGroups === 1 ? "" : "s"
                    }`;
              this.setAction(`${label}: ${tail}`);
              this.showToast(`${label} — ${tail}.`, () => this.toggleSpecial("keyDuplicates"));
              this.dqUserChecks = [
                ...this.dqUserChecks.filter((check) => check.id !== "uniqueness.key"),
                {
                  id: "uniqueness.key",
                  dimension: "uniqueness",
                  label,
                  detail: `${message.counted.toLocaleString()} rows with a complete key`,
                  pass: Math.max(0, message.counted - message.duplicateRows),
                  fail: message.duplicateRows,
                  na: Math.max(0, this.rowCount - message.counted),
                  column: null,
                  filter: "keyDuplicates",
                  fixLabel: "Show duplicates",
                },
              ];
              this.refreshScore();
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
        break;
      }
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
      case "filter":
        this.setView("table");
        this.changeFilter(command.column, command.filter);
        break;
      case "clearFilters":
        this.clearFilters();
        break;
      case "sort":
        this.setView("table");
        this.changeSort(command.column, command.dir);
        break;
      case "type":
        this.changeType(command.column, command.type);
        break;
      case "rename": {
        const headers = this.metas.map((meta) => meta.name);
        headers[command.column] = command.name;
        this.applyHeaderRename(headers);
        break;
      }
      case "merge":
        this.setView("table");
        this.openMerge(command.column);
        break;
      case "chart":
        this.ensureCharts();
        this.setView("chart");
        if (command.column !== undefined && command.column >= 0) {
          const meta = this.metas[command.column];
          if (meta !== undefined) {
            this.chartsPanel?.addChart({
              kind: chartKindFor(meta.type) ?? "histogram",
              column: command.column,
            });
          }
        }
        break;
      case "openView":
        this.setView(command.view);
        break;
      case "shuffle":
        this.shuffleRows();
        break;
      case "copy":
        void this.copyResults();
        break;
      case "tiles":
        this.toggleColumnTiles();
        break;
      case "stats":
        this.openStats();
        break;
      case "recipe":
        this.openSteps();
        break;
      case "help":
        openHelpDrawer();
        break;
      case "theme":
        this.themePreference = command.preference;
        applyThemePreference(command.preference);
        this.themeButton.textContent = `Theme: ${command.preference === "auto" ? "Auto" : command.preference === "light" ? "Light" : "Dark"}`;
        break;
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
      requestPivot: (pivot) => this.client.getPivot(pivot),
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
        this.setView("chart");
        this.chartsPanel?.addViewChart(view);
      },
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
    this.outliersPanel = null;
    clear(this.outliersHost);
    this.relationshipsPanel = null;
    clear(this.relationshipsHost);
  }

  private outliersPanelOptions(): OutliersPanelOptions {
    return {
      requestOutlier: (input) => this.client.getOutlierAnalysis(input),
      requestCorrelation: (respectFilters) =>
        this.requestNumericCorrelation(respectFilters),
      requestGroupAnomalies: () => this.client.getGroupAnomalies().catch(() => null),
      requestDependencies: (respectFilters) =>
        this.client.getDependencies(respectFilters).catch(() => null),
      requestRelationships: (respectFilters) =>
        this.client.getRelationships(respectFilters).catch(() => null),
      requestColumnNetwork: (respectFilters) =>
        this.client.getColumnNetwork(respectFilters).catch(() => null),
      requestSimilarClusters: () => this.client.getSimilarClusters().catch(() => null),
      onShowOutliers: () => {
        if (!this.specials.has("outliers")) this.toggleSpecial("outliers");
        this.setView("table");
      },
      onClearOutliers: () => {
        if (this.specials.has("outliers")) this.toggleSpecial("outliers");
        else this.setAction("The outlier filter is not active");
      },
      onFilterValue: (column, code) => {
        this.changeFilter(column, { kind: "values", selected: [code] });
        this.setView("table");
        this.table?.flashColumn(column);
      },
      onFinding: (finding) => this.runFinding(finding),
      // Fixes stay on the Outliers page so the review can carry on afterwards.
      onWinsorize: (column, percent) => this.winsorizeColumn(column, percent, false),
      onFlagAnomalies: (column) => this.flagAnomaliesColumn(column, false),
      onOpenClean: (column) => this.openClean(column, "values"),
      onRemoveRows: (rows) => this.removeRowsById(rows),
    };
  }

  private ensureOutliers(): void {
    const stats = this.latestStats ?? this.lastLoaded?.stats;
    if (stats === undefined) return;
    if (this.outliersPanel !== null) {
      this.outliersPanel.setData(this.metas, stats, this.rowCount, this.resultCount);
      this.outliersPanel.autoStart();
      return;
    }
    this.outliersPanel = new OutliersPanel(
      this.outliersHost,
      this.outliersPanelOptions(),
      "outliers",
    );
    this.outliersPanel.setData(this.metas, stats, this.rowCount, this.resultCount);
    this.outliersPanel.autoStart();
  }

  private ensureRelationships(): void {
    const stats = this.latestStats ?? this.lastLoaded?.stats;
    if (stats === undefined) return;
    if (this.relationshipsPanel !== null) {
      this.relationshipsPanel.setData(this.metas, stats, this.rowCount, this.resultCount);
      return;
    }
    this.relationshipsPanel = new OutliersPanel(
      this.relationshipsHost,
      this.outliersPanelOptions(),
      "relationships",
    );
    this.relationshipsPanel.setData(this.metas, stats, this.rowCount, this.resultCount);
  }

  private requestNumericCorrelation(
    respectFilters = true,
  ): Promise<CorrelationMessage | null> {
    const numeric: number[] = [];
    this.metas.forEach((meta, index) => {
      if ((meta.type === "integer" || meta.type === "number") && numeric.length < 12) {
        numeric.push(index);
      }
    });
    if (numeric.length < 2) return Promise.resolve(null);
    return this.client.getCorrelation(numeric, { respectFilters }).catch(() => null);
  }

  /** Runs an Outliers or advanced-quality finding action. */
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
      case "keyDuplicates":
        this.runCommand({ kind: "keyDuplicates", columns: action.columns, label: action.label });
        break;
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

  /** Refreshes the health group and dataset stats after a worker update. */
  private applyDatasetStats(stats: DatasetStats): void {
    this.latestStats = stats;
    this.refreshScore();
    this.renderHealthGroup();
    this.overview?.updateHealth(this.metas, stats);
    this.refreshMissingness();
    this.syncColumnTiles();
    this.outliersPanel?.setData(this.metas, stats, this.rowCount, this.resultCount);
    this.outliersPanel?.invalidate();
    this.relationshipsPanel?.setData(this.metas, stats, this.rowCount, this.resultCount);
    this.relationshipsPanel?.invalidate();
    this.triage?.update(this.metas, stats);
    this.sensitiveKey = "";
    this.advancedKey = "";
    // Scan whether or not the Quality page is open, so the header dots are there too.
    void this.refreshSensitiveColumns();
    void this.refreshRowsAffected();
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

  /** Recomputes the dataset quality score and refreshes the tile. */
  private refreshScore(baselineReset = false): void {
    const stats = this.latestStats;
    if (stats === null || this.metas.length === 0) {
      this.dqScore = null;
      this.scoreTile.classList.add("hidden");
      return;
    }
    const previous = baselineReset ? null : (this.dqScore?.overall ?? null);
    const score = computeDQScore(
      this.metas,
      stats,
      this.rowCount,
      { ...this.dqConfig, optional: getOptionalMarks() },
      this.dqUserChecks,
    );
    this.dqScore = score;
    this.syncScoreTile(
      previous === null || score.overall === null ? null : score.overall - previous,
    );
    this.renderQualityPage();
  }

  /** Score tile: number + band colour + delta versus the previous step. */
  private syncScoreTile(delta: number | null): void {
    const score = this.dqScore;
    if (score === null || score.overall === null) {
      this.scoreTile.classList.add("hidden");
      return;
    }
    const rounded = Math.round(score.overall * 10) / 10;
    clear(this.scoreTile);
    this.scoreTile.append(
      el("span", { class: `score-tile-value band-${score.band}` }, [rounded.toFixed(1)]),
      el("span", { class: "score-tile-label" }, ["DQ"]),
    );
    if (delta !== null && Math.abs(delta) >= 0.05) {
      this.scoreTile.append(
        el("span", { class: `score-tile-delta ${delta > 0 ? "up" : "down"}` }, [
          `${delta > 0 ? "▲ +" : "▼ "}${delta.toFixed(1)}`,
        ]),
      );
    }
    this.scoreTile.title = `Data quality ${rounded.toFixed(1)} (${score.band}) — click for the full breakdown`;
    this.scoreTile.classList.remove("hidden");
  }

  /** The Data Quality page (plan §4.2): the diagnostic QA dashboard. */
  private openQuality(): void {
    if (this.dqScore === null) return;
    this.setView("quality");
  }

  /** One check's “show failing rows” action, shared by the page. */
  private handleQualityFilter(check: ScoreCheck): void {
    if (check.column === null) {
      if (check.filter === "duplicates" && !this.specials.has("duplicates")) {
        this.toggleSpecial("duplicates");
      } else if (
        check.filter === "keyDuplicates" &&
        !this.specials.has("keyDuplicates")
      ) {
        this.toggleSpecial("keyDuplicates");
      } else if (check.filter === "pairCheck" && !this.specials.has("pairCheck")) {
        this.toggleSpecial("pairCheck");
      }
      this.setView("table");
      return;
    }
    if (check.filter === "merge") {
      this.openMerge(check.column);
      return;
    }
    if (check.filter === "nulls" || check.filter === "pattern" || check.filter === "valueAnomalies") {
      const active = this.columnSpecials.get(check.column)?.has(check.filter) ?? false;
      if (!active) this.toggleColumnSpecial(check.column, check.filter);
    } else if (check.filter === "duplicates" && !this.specials.has("duplicates")) {
      this.toggleSpecial("duplicates");
    }
    this.setView("table");
    this.table?.flashColumn(check.column);
  }

  /** Builds the DQ page lazily; first open renders the current score. */
  private ensureQuality(): void {
    if (this.qualityPage !== null) return;
    this.qualityPage = new QualityPage(this.qualityHost, {
      onExport: (kind) => this.exportQuality(kind),
      config: this.dqConfig,
      onConfigChange: (config) => {
        this.dqConfig = config;
        saveDQConfig(config);
        this.refreshScore();
      },
      onFilter: (check) => this.handleQualityFilter(check),
      onConvert: (column, type) => this.changeType(column, type),
      onFinding: (finding) => this.runFinding(finding),
      onSensitiveChange: (card, change) => this.onSensitiveChange(card, change),
      onScanExact: (column) => void this.scanSensitiveExact(column),
      onProtect: (card, anchor) => this.openProtectMenu(card, anchor),
      onFixIssues: (issues) => this.fixIssues(issues),
      onShowIssue: (issue) => this.showIssue(issue),
      onReviewIssue: (issue) => this.reviewIssue(issue),
      buildRulesPanel: () => this.rulesPanel(),
      ruleCount: () => this.rules.length,
      buildHistoryPanel: () => this.historyPanel(),
      onDisableSuggestion: (id) => {
        this.disabledSuggestions.add(id);
        this.dqUserChecks = this.dqUserChecks.filter((check) => check.id !== id);
        this.refreshScore();
      },
      onExceptions: (includeRaw) => this.downloadExceptions(includeRaw),
      maskedColumns: () => this.maskedColumns(),
      onOptionalChange: (name, optional) => {
        setOptionalMark(name, optional);
        this.refreshScore();
      },
      onOpenColumn: (column, anchor) => this.openColumnInspector(column, anchor),
      onShowAffectedRows: () => this.showAffectedRows(),
    });
    this.renderQualityPage();
    void this.refreshSensitiveColumns();
  }

  private freshnessColumns(): FreshnessColumn[] {
    const out: FreshnessColumn[] = [];
    this.metas.forEach((meta, column) => {
      if (
        (meta.type === "date" || meta.type === "datetime") &&
        meta.stats.max !== null
      ) {
        out.push({ column, name: meta.name, latest: meta.stats.max });
      }
    });
    return out;
  }

  /**
   * Scans every text-like column for sensitive content in ONE cancellable worker
   * pass. Results stream in per column, so the page fills in as they arrive and
   * first paint is never blocked. A new load, step or edit restarts the scan.
   */
  private async refreshSensitiveColumns(): Promise<void> {
    const key = `${this.generation}:${this.metas.map((meta) => meta.name).join("|")}`;
    if (key === this.sensitiveKey) return;
    this.sensitiveKey = key;
    this.sensitiveScan?.cancel();
    this.sensitiveScan = null;
    this.sensitiveInputs.clear();
    this.sensitiveScanned = false;
    this.recomputeSensitive();
    this.renderQualityPage();
    const hasText = this.metas.some(
      (meta) => meta.type === "string" || meta.type === "category" || meta.type === "identifier",
    );
    if (!hasText) {
      this.sensitiveScanned = true;
      this.renderQualityPage();
      return;
    }
    const scan = this.client.scanSensitive({}, (message) => {
      if (key !== this.sensitiveKey) return;
      this.sensitiveInputs.set(message.input.column, message.input);
      this.recomputeSensitive();
      this.scheduleSensitiveRender();
    });
    this.sensitiveScan = scan;
    try {
      const done = await scan.done;
      if (key !== this.sensitiveKey || done.cancelled) return;
    } catch {
      return;
    }
    this.sensitiveScanned = true;
    this.flushSensitiveRender();
  }

  /** Rescans one column over every value, replacing its sampled counts with exact ones. */
  private async scanSensitiveExact(column: number): Promise<void> {
    const key = this.sensitiveKey;
    const scan = this.client.scanSensitive({ columns: [column], exact: true }, (message) => {
      if (key !== this.sensitiveKey) return;
      this.sensitiveInputs.set(message.input.column, message.input);
      this.recomputeSensitive();
    });
    try {
      await scan.done;
    } catch {
      return;
    }
    if (key === this.sensitiveKey) this.flushSensitiveRender();
  }

  /** Rebuilds the findings (cheap, pure) from the shapes received so far plus column names. */
  private recomputeSensitive(): void {
    const inputs: ColumnSensitivityInput[] = this.metas.map((meta, column) => {
      const scanned = this.sensitiveInputs.get(column);
      return (
        scanned ?? {
          column,
          name: meta.name,
          type: meta.type,
          semantic: meta.semantic ?? null,
          shapes: null,
          sampled: 0,
          scanned: Math.max(0, this.rowCount - meta.stats.nulls),
        }
      );
    });
    this.sensitiveFindings = scoreSensitivity(inputs);
    this.syncSensitiveMarkers();
  }

  /** The findings with the user's earlier decisions applied (not sensitive, marked, label). */
  private sensitiveCards(): SensitiveCard[] {
    return this.sensitiveFindings.map((finding) => {
      const meta = this.metas[finding.column];
      const mark = getSensitiveMark(finding.name, meta?.type ?? "");
      const samples = (meta?.stats.samples ?? []).filter((value) => value.trim() !== "").slice(0, 3);
      return {
        ...finding,
        ...(mark.dismissed === true ? { dismissed: true } : {}),
        ...(mark.confirmed === true ? { confirmed: true } : {}),
        label: mark.label ?? finding.label,
        examples: samples.map(maskValue),
        revealed: samples,
      };
    });
  }

  /** Small dot on the header (and a line in the inspector) for columns still flagged. */
  private syncSensitiveMarkers(): void {
    const notes = new Map<number, string>();
    for (const card of this.sensitiveCards()) {
      if (card.dismissed === true) continue;
      if (card.confidence === "low" && card.confirmed !== true) continue;
      notes.set(card.column, card.reasons.map((reason) => reason.label).join("; "));
    }
    this.sensitiveNotes = notes;
    this.table?.setSensitive(notes);
  }

  /** The table drill-down behind an issue: its check's rows, or its finding's action. */
  private showIssue(issue: PageIssue): void {
    if (issue.finding !== undefined) {
      this.runFinding(issue.finding);
      return;
    }
    if (issue.check === undefined) return;
    if (issue.kind === "variants" && issue.column !== null) {
      this.openMerge(issue.column);
      return;
    }
    if (issue.kind === "empty" && issue.column !== null) {
      this.openClean(issue.column, "nulls");
      return;
    }
    if (issue.kind === "unreadable" && issue.column !== null) {
      this.setView("table");
      this.table?.flashColumn(issue.column);
      return;
    }
    this.handleQualityFilter(issue.check);
  }

  /** Counts the distinct rows that fail a check (worker pass) and shows them on the tile. */
  private async refreshRowsAffected(): Promise<void> {
    const key = `${this.generation}:${this.rowCount}:${this.metas.map((meta) => `${meta.name}:${meta.stats.nulls}:${meta.type}`).join("|")}`;
    if (key === this.rowsAffectedKey) return;
    this.rowsAffectedKey = key;
    this.rowsAffected = undefined;
    void this.refreshNearDuplicates();
    void this.refreshSuggestedPairs();
    void this.refreshRules();
    void this.refreshAccuracy();
    void this.recordHistory();
    try {
      const message = await this.client.getRowsAffected();
      if (key !== this.rowsAffectedKey) return;
      this.rowsAffected = { count: message.count, total: message.total };
    } catch {
      if (key === this.rowsAffectedKey) this.rowsAffected = null;
    }
    this.renderQualityPage();
  }

  /** Filters the table to the rows counted by the Rows affected tile. */
  private showAffectedRows(): void {
    if (!this.specials.has("affectedRows")) this.toggleSpecial("affectedRows");
    this.setView("table");
    const count = this.rowsAffected?.count ?? 0;
    this.showToast(`Showing the ${count.toLocaleString()} rows that fail a check.`, () => {
      if (this.specials.has("affectedRows")) this.toggleSpecial("affectedRows");
    });
  }

  /**
   * One preview, then each ticked issue is applied as its own undoable Recipe
   * step. The returned undo functions put each column back exactly as it was.
   */
  private async fixIssues(issues: readonly PageIssue[]): Promise<FixOutcome | null> {
    const chosen = await openFixPreview(issues);
    if (chosen === null || chosen.length === 0) return null;
    const items: FixOutcome["items"] = [];
    for (const issue of issues.filter((candidate) => chosen.includes(candidate.id))) {
      const undos: (() => void)[] = [];
      for (const step of issue.fixes) {
        const undo = this.applyFixStep(step);
        if (undo !== null) undos.push(undo);
      }
      items.push({
        id: issue.id,
        // Undo in reverse order so stacked steps unwind cleanly.
        undo: () => [...undos].reverse().forEach((undo) => undo()),
      });
    }
    this.showToast(
      items.length === 1 ? "Applied 1 fix" : `Applied ${items.length} fixes`,
      () => items.forEach((item) => item.undo()),
      "Undo all",
    );
    return { items };
  }

  /** Applies one fix step as an undoable Recipe step; returns how to undo it, or null if nothing ran. */
  private applyFixStep(step: FixStep): (() => void) | null {
    const meta = this.metas[step.column];
    if (meta === undefined) return null;
    if (step.kind === "standardise") {
      const existing = this.cleanedColumns.get(step.column) ?? [];
      const op: CleanOp = { kind: "recode", pairs: step.pairs };
      this.applyClean([{ column: step.column, ops: [...existing, op] }]);
      return () => this.applyClean([{ column: step.column, ops: existing }]);
    }
    if (step.kind === "numberSymbols") {
      const existing = this.cleanedColumns.get(step.column) ?? [];
      const op: CleanOp = { kind: "toNumber", locale: step.locale };
      this.applyClean([{ column: step.column, ops: [...existing, op] }]);
      return () => this.applyClean([{ column: step.column, ops: existing }]);
    }
    if (step.kind === "dateFormat") {
      const existing = this.cleanedColumns.get(step.column) ?? [];
      const op: CleanOp = { kind: "toDate", order: step.order };
      this.applyClean([{ column: step.column, ops: [...existing, op] }]);
      return () => this.applyClean([{ column: step.column, ops: existing }]);
    }
    if (step.kind === "placeholders") {
      const previous = { extra: [...meta.nullPolicy.extra], keep: [...meta.nullPolicy.keep] };
      const extra = [...new Set([...previous.extra, ...step.tokens])];
      this.applyNullPolicy(step.column, extra, previous.keep, {
        label: `${meta.name}: placeholder text treated as missing`,
      });
      return () =>
        this.applyNullPolicy(step.column, previous.extra, previous.keep, {
          label: `${meta.name}: placeholder change undone`,
        });
    }
    return null;
  }

  /** One-by-one spelling review: choose each group's standard, then apply as one undoable step. */
  private async reviewIssue(issue: PageIssue): Promise<FixOutcome | null> {
    const standardise = issue.fixes.find((step) => step.kind === "standardise");
    if (standardise === undefined || standardise.kind !== "standardise" || standardise.groups === undefined) return null;
    const placeholders = issue.fixes.find((step) => step.kind === "placeholders");
    const placeholderCells =
      placeholders !== undefined && placeholders.kind === "placeholders"
        ? placeholders.preview.reduce((sum, line) => sum + line.count, 0)
        : 0;
    const result = await openStandardiseReview({
      columnName: issue.columnName ?? "column",
      groups: standardise.groups,
      placeholderCells,
    });
    if (result === null) return null;
    const undos: (() => void)[] = [];
    if (result.pairs.length > 0) {
      const undo = this.applyFixStep({ ...standardise, pairs: result.pairs });
      if (undo !== null) undos.push(undo);
    }
    if (result.treatPlaceholders && placeholders !== undefined) {
      const undo = this.applyFixStep(placeholders);
      if (undo !== null) undos.push(undo);
    }
    if (undos.length === 0) return null;
    const undo = (): void => [...undos].reverse().forEach((fn) => fn());
    this.showToast(`Standardised ${result.pairs.length} ${result.pairs.length === 1 ? "spelling" : "spellings"} in \u201c${issue.columnName ?? "column"}\u201d`, undo, "Undo");
    return { items: [{ id: issue.id, undo }] };
  }

  /** Mask / hash / drop for a flagged column. Each is an undoable Recipe step. */
  private openProtectMenu(card: SensitiveCard, anchor: HTMLElement): void {
    openMenu(anchor, [
      { label: "Mask values…", action: () => void this.protectColumn(card.column, "mask") },
      { label: "Hash values…", action: () => void this.protectColumn(card.column, "hash") },
      { label: "Drop column…", action: () => void this.confirmDeleteColumn(card.column) },
    ]);
  }

  private async protectColumn(column: number, mode: ProtectMode): Promise<void> {
    const meta = this.metas[column];
    if (meta === undefined) return;
    const op = await openProtectDialog({
      name: meta.name,
      mode,
      samples: meta.stats.samples,
      affected: Math.max(0, this.rowCount - meta.stats.nulls),
    });
    if (op === null) return;
    const existing = this.cleanedColumns.get(column) ?? [];
    this.applyClean([{ column, ops: [...existing, op] }]);
    const key = JSON.stringify(op);
    this.showToast(`${mode === "mask" ? "Masked" : "Hashed"} “${meta.name}”`, () => {
      const current = this.cleanedColumns.get(column) ?? [];
      const index = current.findIndex((entry) => JSON.stringify(entry) === key);
      if (index < 0) return;
      this.applyClean([{ column, ops: current.filter((_, i) => i !== index) }]);
    });
  }

  private onSensitiveChange(card: SensitiveCard, change: SensitiveChange): void {
    const meta = this.metas[card.column];
    if (meta === undefined) return;
    setSensitiveMark(card.name, meta.type, change);
    this.syncSensitiveMarkers();
    this.flushSensitiveRender();
  }

  /** Streaming results repaint at most a few times a second. */
  private scheduleSensitiveRender(): void {
    if (this.sensitiveRenderTimer !== null) return;
    this.sensitiveRenderTimer = window.setTimeout(() => this.flushSensitiveRender(), 150);
  }

  private flushSensitiveRender(): void {
    if (this.sensitiveRenderTimer !== null) {
      window.clearTimeout(this.sensitiveRenderTimer);
      this.sensitiveRenderTimer = null;
    }
    this.renderQualityPage();
  }

  /** Name-pair consistency checks (end after start, ...), counted off the table filter. */
  private async refreshSuggestedPairs(): Promise<void> {
    const pairs = suggestPairs(this.metas);
    const key = `${this.generation}:${this.rowCount}:${pairs.map((pair) => `${pair.a}-${pair.b}`).join(",")}`;
    if (key === this.suggestedPairsKey) return;
    this.suggestedPairsKey = key;
    const checks: ScoreCheck[] = [];
    for (const pair of pairs) {
      const id = `consistency.suggested.${pair.a}.${pair.b}`;
      if (this.disabledSuggestions.has(id)) continue;
      try {
        const message = await this.client.countPair(pair.a, pair.b, pair.operator);
        if (key !== this.suggestedPairsKey) return;
        checks.push({
          id,
          dimension: "consistency",
          label: `${pair.label} (suggested)`,
          detail: `${message.compared.toLocaleString()} rows compared · proposed from the column names`,
          pass: Math.max(0, message.compared - message.violations),
          fail: message.violations,
          na: 0,
          column: null,
          filter: null,
          fixLabel: null,
          suggested: true,
        });
      } catch {
        return;
      }
    }
    this.dqUserChecks = [...this.dqUserChecks.filter((check) => check.suggested !== true), ...checks];
    this.refreshScore();
  }

  /** Offline Accuracy: columns that name a country, currency, state, weekday or month are checked against bundled lists. */
  private async refreshAccuracy(): Promise<void> {
    if (!this.metas.some((meta) => meta.categories !== null && candidateKinds(meta.name).length > 0)) return;
    const key = `${this.generation}:${this.rowCount}`;
    if (key === this.accuracyKey) return;
    this.accuracyKey = key;
    let checks: ScoreCheck[];
    try {
      checks = await accuracyChecks(this.metas);
    } catch {
      return;
    }
    if (key !== this.accuracyKey) return;
    this.dqUserChecks = [...this.dqUserChecks.filter((check) => !check.id.startsWith("accuracy.")), ...checks];
    this.refreshScore();
  }

  private rulesStorageKey(): string {
    return `turbofuzz.rules.${schemaFingerprint(this.metas)}`;
  }

  private saveRulesSession(): void {
    try {
      sessionStorage.setItem(this.rulesStorageKey(), JSON.stringify(this.rules.map(({ suggested: _s, ...rule }) => rule)));
    } catch {
      // Session storage may be blocked; the rules still work for this load.
    }
  }

  private savedRules(): Rule[] {
    try {
      const text = sessionStorage.getItem(this.rulesStorageKey());
      if (text === null) return [];
      const parsed = parseRulesFile(JSON.stringify({ version: 1, rules: JSON.parse(text) }));
      return "error" in parsed ? [] : parsed.file.rules;
    } catch {
      return [];
    }
  }

  /** Evaluates the accepted rules in the worker and feeds them to the score as checks. */
  private async refreshRules(): Promise<void> {
    if (this.metas.length === 0) return;
    const key = `${this.generation}:${this.rowCount}:${this.rules.map((rule) => JSON.stringify(rule)).join("|")}`;
    if (key === this.ruleKey) return;
    this.ruleKey = key;
    this.ruleSuggestions = recommendRules(this.metas, this.rowCount).filter(
      (candidate) =>
        !this.rules.some(
          (rule) => rule.type === candidate.type && rule.column === candidate.column && (rule.other ?? "") === (candidate.other ?? ""),
        ),
    );
    if (this.rules.length === 0) {
      this.ruleResults = new Map();
      this.dqUserChecks = this.dqUserChecks.filter((check) => !check.id.startsWith("rule."));
      this.refreshScore();
      return;
    }
    try {
      const message = await this.client.evaluateRules(this.rules);
      if (key !== this.ruleKey) return;
      this.ruleResults = new Map(message.results.map((result) => [result.id, result]));
    } catch {
      return;
    }
    const checks = this.rules.map((rule) => {
      const result = this.ruleResults.get(rule.id);
      const column = this.metas.findIndex((meta) => meta.name === rule.column);
      return ruleToCheck(rule, result ?? { id: rule.id, fail: 0, compared: 0, examples: [], error: null }, column === -1 ? null : column);
    });
    this.dqUserChecks = [...this.dqUserChecks.filter((check) => !check.id.startsWith("rule.")), ...checks];
    this.refreshScore();
  }

  private setRules(rules: Rule[]): void {
    this.rules = rules;
    this.saveRulesSession();
    void this.refreshRules();
    this.renderQualityPage();
  }

  private rulesPanel(): HTMLElement {
    const saved = this.savedRules();
    const offer = !this.savedRulesOffered && this.rules.length === 0 && saved.length > 0 ? { count: saved.length } : null;
    return buildRulesPanel(
      {
        accepted: this.rules,
        suggested: this.ruleSuggestions,
        results: this.ruleResults,
        columnNames: this.metas.map((meta) => meta.name),
        savedOffer: offer,
      },
      {
        accept: (rule) => {
          const { suggested: _s, ...kept } = rule;
          this.setRules([...this.rules, kept]);
        },
        acceptAll: () => this.setRules([...this.rules, ...this.ruleSuggestions.map(({ suggested: _s, ...kept }) => kept)]),
        remove: (id) => this.setRules(this.rules.filter((rule) => rule.id !== id)),
        update: (rule) => this.setRules(this.rules.map((existing) => (existing.id === rule.id ? rule : existing))),
        download: () => {
          const blob = new Blob([serialiseRules(this.rules, this.metas)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = "turbofuzz-rules.json";
          anchor.click();
          URL.revokeObjectURL(url);
          this.setAction("Downloaded the rules file");
        },
        load: (text) => {
          const parsed = parseRulesFile(text);
          if ("error" in parsed) {
            this.showError(new Error(parsed.error));
            return;
          }
          this.setRules([...this.rules, ...parsed.file.rules]);
          const matches = parsed.file.fingerprint === schemaFingerprint(this.metas);
          this.showToast(
            `Loaded ${parsed.file.rules.length} rule${parsed.file.rules.length === 1 ? "" : "s"}${parsed.dropped > 0 ? `, skipped ${parsed.dropped} invalid` : ""}${matches ? "" : ". The columns differ from the file the rules were made for; rules for missing columns will show an error."}`,
          );
        },
        applySaved: () => {
          this.savedRulesOffered = true;
          this.setRules(this.savedRules());
        },
      },
    );
  }

  private historyEnabled(): boolean {
    try {
      return localStorage.getItem("turbofuzz.history.enabled") !== "false";
    } catch {
      return true;
    }
  }

  /** One snapshot per load (rates and counts only), compared with the previous load of this file. */
  private async recordHistory(): Promise<void> {
    if (!this.historyEnabled() || this.datasetName === "" || this.dqScore === null) return;
    const key = `${this.generation}:${this.rowCount}`;
    if (key === this.historyKeyRecorded) return;
    this.historyKeyRecorded = key;
    if (this.historyStore === undefined) this.historyStore = await openIndexedDbStore();
    const store = this.historyStore;
    if (store === null || this.dqScore === null) return;
    const flagged = new Set(this.sensitiveCards().filter((card) => card.dismissed !== true).map((card) => card.name));
    // Until the sensitive scan has run, no category labels are stored at all.
    const metas = this.sensitiveScanned ? this.metas : this.metas.map((meta) => ({ ...meta, categories: null }));
    const rates: Record<string, number> = {};
    for (const [id, result] of this.ruleResults) rates[id] = result.compared === 0 ? 1 : 1 - result.fail / result.compared;
    const snapshot = buildSnapshot(this.datasetName, metas, this.rowCount, this.dqScore, flagged, rates);
    try {
      const existing = await store.list(historyKey(this.datasetName));
      if (!isDuplicateLoad(existing[existing.length - 1], snapshot)) await store.add(snapshot);
      this.historySnapshots = await store.list(historyKey(this.datasetName));
    } catch {
      return;
    }
    this.renderQualityPage();
  }

  private historyPanel(): HTMLElement {
    return buildHistoryPanel(
      { snapshots: this.historySnapshots, enabled: this.historyEnabled() },
      {
        setEnabled: (enabled) => {
          try {
            localStorage.setItem("turbofuzz.history.enabled", String(enabled));
          } catch {
            // Preference only.
          }
          this.renderQualityPage();
        },
        clear: () => {
          void (async () => {
            try {
              await this.historyStore?.clear();
            } catch {
              // Nothing to clear.
            }
            this.historySnapshots = [];
            this.historyKeyRecorded = "";
            this.setAction("Cleared the local history");
            this.renderQualityPage();
          })();
        },
      },
    );
  }

  /** Worth-reviewing findings: the metadata ones plus the worker-counted near duplicates. */
  private reviewList(stats: DatasetStats): Finding[] {
    const list = reviewFindings(this.metas, stats, this.rowCount);
    if (this.nearDuplicate !== null) list.push(this.nearDuplicate);
    return list;
  }

  /** Rows equal on every column except an id column; counted once per load, off the main thread. */
  private async refreshNearDuplicates(): Promise<void> {
    const ids = idLikeColumns(this.metas, this.rowCount);
    const compared = columnsIgnoring(this.metas, ids);
    const key = `${this.generation}:${this.rowCount}:${ids.join(",")}`;
    if (key === this.nearDuplicateKey) return;
    this.nearDuplicateKey = key;
    this.nearDuplicate = null;
    if (ids.length === 0 || compared.length === 0) return;
    try {
      const message = await this.client.countKeyDuplicates(compared);
      if (key !== this.nearDuplicateKey) return;
      this.nearDuplicate = nearDuplicateFinding(this.metas, ids, compared, message.duplicateRows, message.duplicateGroups);
    } catch {
      return;
    }
    this.renderQualityPage();
  }

  /** The Quality page's own counts (null until the score exists), shared with the Overview. */
  private issueSummary(): { fix: number; review: number } | null {
    const score = this.dqScore;
    const stats = this.latestStats;
    if (score === null || stats === null) return null;
    const issues = buildIssues({
      score,
      metas: this.metas,
      rowCount: this.rowCount,
      review: this.reviewList(stats),
      sensitiveColumns: new Set(),
    });
    return {
      fix: issues.filter((issue) => issue.severity === "fix").length,
      review: issues.filter((issue) => issue.severity === "review").length,
    };
  }

  private renderQualityPage(): void {
    if (this.qualityPage === null) return;
    const score = this.dqScore;
    const stats = this.latestStats;
    if (score === null || stats === null) {
      this.qualityPage.render(null);
      return;
    }
    const sensitiveColumns = new Set(
      this.sensitiveCards()
        .filter((card) => card.dismissed !== true && (card.confirmed === true || card.confidence !== "low"))
        .map((card) => card.column),
    );
    const issues = buildIssues({
      score,
      metas: this.metas,
      rowCount: this.rowCount,
      review: this.reviewList(stats),
      sensitiveColumns,
    });
    this.qualityPage.render({
      score,
      rowCount: this.rowCount,
      visibleRowCount: this.resultCount,
      stats,
      columnNames: this.metas.map((meta) => meta.name),
      issues,
      health: buildColumnHealth(this.metas, issues, this.rowCount, sensitiveColumns, score),
      rowsAffected: this.rowsAffected,
      datasetKey: `${this.datasetName}:${this.generation}`,
      sensitive: this.sensitiveCards(),
      sensitiveScanned: this.sensitiveScanned,
      freshness: this.freshnessColumns(),
    });
    void this.refreshRowsAffected();
    if (this.view !== "quality") return;
    const key = [
      this.datasetName,
      this.rowCount,
      this.resultCount,
      this.metas.map((meta) => `${meta.name}:${meta.type}:${meta.stats.nulls}`).join("|"),
    ].join("~");
    if (key !== this.advancedKey) {
      this.advancedKey = key;
      void this.loadAdvancedQualitySignals(key);
    }
    this.appendAdvancedQualitySection();
  }

  /**
   * Unique quality signals that used to live in the Reports Quality tab:
   * co-missingness, drift between row halves, near-duplicate clusters and text
   * profiles. Functional dependencies moved to the Outliers Relationships tab.
   */
  private async loadAdvancedQualitySignals(key: string): Promise<void> {
    if (this.advancedLoading) return;
    this.advancedLoading = true;
    const token = ++this.advancedToken;
    this.advancedFindings = [];
    this.appendAdvancedQualitySection();
    const textColumns = this.metas
      .map((meta, index) => ({ meta, index }))
      .filter((entry) => entry.meta.type === "string")
      .slice(0, 3);
    try {
      const [coMissing, distribution, similar, ...texts] = await Promise.all([
        this.client.getCoMissingness().catch(() => null),
        this.client.getDistributionChanges().catch(() => null),
        this.client.getSimilarClusters().catch(() => null),
        ...textColumns.map((entry) =>
          this.client.getTextProfile(entry.index).catch(() => null),
        ),
      ]);
      if (token !== this.advancedToken || key !== this.advancedKey) return;
      const findings: Finding[] = [];
      if (coMissing !== null) {
        findings.push(
          ...coMissingnessFindings(
            coMissing.columns,
            coMissing.labels,
            coMissing.nullCells,
            coMissing.pairs,
          ).map((finding) => ({ ...finding, scope: "rows" as const })),
        );
      }
      if (distribution !== null && distribution.changes.length > 0) {
        findings.push(
          ...distributionFindings(distribution.changes).map((finding) => ({
            ...finding,
            scope: "rows" as const,
          })),
        );
      }
      if (similar !== null && similar.entries.length > 0) {
        const covered = similar.entries.filter((entry) => {
          const variants = this.metas[entry.column]?.variants;
          return (
            variants !== null &&
            variants !== undefined &&
            (this.metas[entry.column]?.similarGroups ?? 0) <= variants.groups
          );
        });
        const entries = similar.entries.filter((entry) => !covered.includes(entry));
        findings.push(
          ...similarClusterFindings(entries).map((finding) => ({
            ...finding,
            scope: "rows" as const,
          })),
        );
      }
      const profiles = texts.filter(
        (profile): profile is NonNullable<typeof profile> => profile !== null,
      );
      if (profiles.length > 0) {
        findings.push(
          ...textProfileFindings(
            profiles.map((profile) => ({
              column: profile.column,
              label: profile.label,
              profile: profile.profile,
            })),
          ).map((finding) => ({ ...finding, scope: "dataset" as const })),
        );
      }
      findings.sort(
        (a, b) =>
          (b.severity === "fix" ? 2 : b.severity === "review" ? 1 : 0) -
            (a.severity === "fix" ? 2 : a.severity === "review" ? 1 : 0) ||
          b.impact.rows - a.impact.rows,
      );
      this.advancedFindings = findings;
    } finally {
      if (token === this.advancedToken) {
        this.advancedLoading = false;
        this.appendAdvancedQualitySection();
        if (key !== this.advancedKey) void this.loadAdvancedQualitySignals(this.advancedKey);
      }
    }
  }

  private appendAdvancedQualitySection(): void {
    const section = el("section", { class: "qp-advanced" });
    section.append(
      el("h2", { class: "overview-heading" }, ["Advanced signals"]),
      el("p", { class: "qp-advanced-hint" }, [
        "Missing-together patterns, drift between row halves, near-duplicate values and text profiles. Relationships and functional dependencies live in the Outliers lens.",
      ]),
    );
    if (this.advancedLoading) {
      section.append(el("div", { class: "qp-advanced-empty" }, ["Checking advanced signals…"]));
    } else if (this.advancedFindings.length === 0) {
      section.append(
        el("div", { class: "qp-advanced-empty" }, ["✓ No additional signals found."]),
      );
    } else {
      for (const finding of this.advancedFindings.slice(0, 12)) {
        const row = el("div", { class: `advanced-finding severity-${finding.severity}` });
        const body = el("div", { class: "advanced-finding-body" });
        body.append(
          el("span", { class: "advanced-finding-title" }, [finding.title]),
          el("span", { class: "advanced-finding-evidence" }, [
            finding.evidence.map((entry) => `${entry.metric}: ${entry.value}`).join(" · "),
          ]),
        );
        row.append(body);
        if (finding.action !== undefined) {
          const action = el(
            "button",
            { class: "ghost small", type: "button" },
            [finding.fixLabel ?? "Show rows"],
          ) as HTMLButtonElement;
          action.addEventListener("click", () => this.runFinding(finding));
          row.append(action);
        }
        section.append(row);
      }
    }
    this.qualityPage?.setAdvanced(section);
  }

  /** The report with its extra sections; flagged columns contribute counts only. */
  private buildReport(score: DQScore): DQReport {
    const stats = this.latestStats;
    const sensitiveCards = this.sensitiveCards().filter((card) => card.dismissed !== true);
    const flagged = new Set(sensitiveCards.map((card) => card.column));
    const issues =
      stats === null
        ? []
        : buildIssues({
            score,
            metas: this.metas,
            rowCount: this.rowCount,
            review: this.reviewList(stats),
            sensitiveColumns: flagged,
          });
    const health = buildColumnHealth(this.metas, issues, this.rowCount, flagged, score);
    return buildDQReport(
      score,
      this.datasetName === "" ? "dataset" : this.datasetName,
      this.rowCount,
      this.metas.length,
      new Date().toISOString(),
      {
        bandReason: score.bandCap === null ? null : `${score.bandCap.band} because ${score.bandCap.reason}`,
        sensitiveColumns: flagged,
        issues: issues.map((issue) => ({
          severity: issue.severity,
          title: issue.title,
          evidence: issue.evidence,
          rows: issue.rows,
          column: issue.column,
        })),
        columnTable: health.map((entry) => ({
          column: entry.column,
          name: entry.name,
          type: entry.type,
          score: entry.score?.score ?? null,
          fill: this.rowCount === 0 ? 0 : (this.rowCount - (this.metas[entry.column]?.stats.nulls ?? 0)) / this.rowCount,
        })),
        sensitive: sensitiveCards.map((card) => ({ name: card.name, class: card.class, label: card.label })),
        rules: this.rules.map((rule) => {
          const result = this.ruleResults.get(rule.id);
          return { text: describeRule(rule), severity: rule.severity, fail: result?.fail ?? 0, compared: result?.compared ?? 0 };
        }),
        trend: this.historySnapshots.map((snapshot) => ({ at: snapshot.at, overall: snapshot.overall })),
      },
    );
  }

  private maskedColumns(): number[] {
    return this.sensitiveCards()
      .filter((card) => card.dismissed !== true)
      .map((card) => card.column);
  }

  /** exceptions.csv from the worker: one row per failing cell; sensitive values masked by default. */
  private async downloadExceptions(includeRaw: boolean): Promise<void> {
    if (this.rowCount > 100_000 && !window.confirm(`This is a large file (${this.rowCount.toLocaleString()} rows). Building the exceptions file may take a few seconds. Continue?`)) return;
    try {
      const message = await this.client.getExceptions(
        this.maskedColumns(),
        includeRaw,
        this.dqScore?.optionalColumns ?? [],
        null,
      );
      const blob = new Blob([message.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(this.datasetName === "" ? "dataset" : this.datasetName)}-exceptions.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.setAction(`Downloaded ${message.count.toLocaleString()} exceptions`);
    } catch {
      this.setAction("Could not build the exceptions file");
    }
  }

  /** DQ report export (plan §6): report file + pipeline-format emitters. */
  private async exportQuality(kind: DQExportKind): Promise<boolean> {
    const score = this.dqScore;
    if (score === null) return false;
    const report = this.buildReport(score);
    if (kind === "html") {
      const blob = new Blob([dqReportHtml(report)], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(this.datasetName === "" ? "dataset" : this.datasetName)}-dq-report.html`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.setAction("Downloaded the data-quality report (HTML)");
      return true;
    }
    if (kind === "supplier") {
      const ok = await copyText(supplierMessage(report));
      this.setAction(ok ? "Copied a message for the data supplier" : "Clipboard blocked — copy failed");
      return ok;
    }
    if (kind === "json") {
      const blob = new Blob([dqReportJson(report)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(this.datasetName === "" ? "dataset" : this.datasetName)}-dq-report.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.setAction("Downloaded the data-quality report (JSON)");
      return true;
    }
    let text: string;
    if (kind === "markdown") {
      text = dqReportMarkdown(report);
    } else {
      const emitted = emitDQChecks(
        this.metas,
        this.datasetName === "" ? "dataset" : this.datasetName,
      );
      const body = emitted[kind];
      text =
        emitted.support.length === 0
          ? body
          : `${body}\n# Support notes — not translated:\n${emitted.support
              .map((line) => `# - ${line}`)
              .join("\n")}\n`;
    }
    const ok = await copyText(text);
    this.setAction(ok ? `Copied the DQ ${kind} export` : "Clipboard blocked — copy failed");
    return ok;
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
    // One split chip per issue: label = issue and count (click = view), the
    // small "Fix ▾" segment opens the fix. Keeps the strip to a single row.
    const addChip = (
      kind: SpecialKind,
      label: string,
      title: string,
      fix?: HTMLButtonElement,
    ): void => {
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
      chip.addEventListener("click", () => this.viewSpecial(kind));
      if (fix === undefined) {
        this.healthHost.append(chip);
      } else {
        fix.classList.add("health-fix");
        const fixLabel = fix.textContent ?? "Fix";
        fix.setAttribute("aria-label", fixLabel);
        fix.textContent = "Fix ▾";
        this.healthHost.append(el("span", { class: "split-chip" }, [chip, fix]));
      }
      count++;
    };
    const tokenTotals = new Map<string, number>();
    for (const meta of this.metas) {
      for (const token of meta.nullTokens) {
        if (token.label !== "" && token.count > 0) {
          tokenTotals.set(token.label, (tokenTotals.get(token.label) ?? 0) + token.count);
        }
      }
    }
    const placeholderTotal = [...tokenTotals.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    if (stats.duplicateRows > 0) {
      const remove = el(
        "button",
        {
          class: "ghost small",
          type: "button",
          title: `Remove duplicate rows — ${stats.duplicateRows.toLocaleString()} redundant rows`,
        },
        [chipText("fix", "Remove duplicates…")],
      ) as HTMLButtonElement;
      remove.addEventListener("click", () =>
        openDedupeMenu(remove, stats, (keep) => this.dropDuplicates(keep)),
      );
      addChip(
        "duplicates",
        `View duplicates · ${stats.duplicateRows.toLocaleString()}`,
        "Show rows that belong to a duplicate group",
        remove,
      );
    }
    const columnsWithNulls = this.metas
      .map((meta, index) => ({ meta, index, count: meta.stats.nulls }))
      .filter((entry) => entry.count > 0);
    if (columnsWithNulls.length > 0) {
      const label =
        placeholderTotal > 0
          ? `View placeholders · ${placeholderTotal.toLocaleString()}`
          : `View empty cells · ${columnsWithNulls.length.toLocaleString()} ${
              columnsWithNulls.length === 1 ? "col" : "cols"
            }`;
      const fix = el(
        "button",
        {
          class: "ghost small",
          type: "button",
          title:
            "Fill the empty cells in one click: median or mean for numbers, the most common value for text",
        },
        [chipText("fix", placeholderTotal > 0 ? "placeholder cells…" : "empty cells…")],
      ) as HTMLButtonElement;
      fix.addEventListener("click", () =>
        openMenu(fix, this.fillMenuItems(columnsWithNulls.map((entry) => entry.index))),
      );
      addChip(
        "nulls",
        label,
        placeholderTotal > 0
          ? "Show rows with missing cells, including placeholder text like “NA”"
          : "Show rows with at least one empty cell",
        fix,
      );
    }
    if (stats.valueAnomalyRows > 0) {
      const outlierColumns = this.metas
        .map((meta, index) => ({
          meta,
          index,
          count: meta.anomalyCounts.values,
        }))
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      if (outlierColumns.length > 0) {
        const fix = el(
          "button",
          {
            class: "ghost small",
            type: "button",
            title: "Quick fixes for the columns with the most value outliers",
          },
          [chipText("fix", "outliers…")],
        ) as HTMLButtonElement;
        fix.addEventListener("click", () =>
          openMenu(
            fix,
            this.outlierMenuItems(outlierColumns.map((entry) => entry.index)),
          ),
        );
        addChip(
          "valueAnomalies",
          `View outliers · ${stats.valueAnomalyRows.toLocaleString()}`,
          "Show rows with a value outside the column fence",
          fix,
        );
      } else {
        addChip(
          "valueAnomalies",
          `View outliers · ${stats.valueAnomalyRows.toLocaleString()}`,
          "Show rows with a value outside the column fence",
        );
      }
    }
    // Dataset-level placeholder action, always visible even when the affected
    // column is scrolled off screen. Per-column chips live in the headers.
    if (placeholderTotal > 0) {
      const ranked = [...tokenTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label]) => label);
      const examples = ranked.slice(0, 3).map((label) => `“${label}”`).join(", ");
      const convert = el(
        "button",
        {
          class: "ghost small placeholder-action",
          type: "button",
          title: `Fix: blank ${placeholderTotal.toLocaleString()} placeholder cells (${examples}) across all columns. Filters and charts then treat them as missing instead of real categories. Undo is in the Recipe.`,
        },
        [`Fix: convert ${placeholderTotal.toLocaleString()} placeholders to missing`],
      ) as HTMLButtonElement;
      convert.addEventListener("click", () =>
        this.confirmFix(
          `Convert ${placeholderTotal.toLocaleString()} placeholders to missing?`,
          `Values such as ${examples} will become empty cells in every affected column. This is recorded in the Recipe and can be undone.`,
          "Convert to missing",
          () => this.applyNullPolicyAll(ranked, []),
        ),
      );
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
      case "compare": {
        const op = {
          eq: "=",
          ne: "≠",
          gt: ">",
          gte: "≥",
          lt: "<",
          lte: "≤",
          aboveAvg: "above average",
          belowAvg: "below average",
        }[filter.op];
        return filter.value === undefined ? op : `${op} ${filter.value.toLocaleString()}`;
      }
      case "blank":
        return filter.negate ? "not blank" : "blank";
      case "values":
        return `${filter.selected.length} value${filter.selected.length === 1 ? "" : "s"}`;
    }
  }

  /** Active filters as removable chips in the results bar. */
  private renderFilterChips(): void {
    this.filterChipsEl.replaceChildren();
    const failureTotal = [...this.castFailureCounts.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    if (this.filters.size === 0 && failureTotal === 0) {
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
    if (failureTotal > 0) {
      const review = el(
        "button",
        {
          class: "filter-chip cast-failure-chip",
          type: "button",
          title: "Show rows whose values failed the most recent type conversion",
        },
        [`Review cast mismatches (${failureTotal.toLocaleString()})`],
      ) as HTMLButtonElement;
      review.classList.toggle("active", this.specials.has("castFailures"));
      review.addEventListener("click", () => this.viewSpecial("castFailures"));
      this.filterChipsEl.append(review);
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
    this.outliersPanel?.setVisibleRowCount(count);
    this.relationshipsPanel?.setVisibleRowCount(count);
    if (this.qualityPage !== null && this.lastLoaded !== null) this.renderQualityPage();
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
    this.copyButton.title =
      count === 0 ? "No rows match the current filters — nothing to copy" : "Copy filtered rows as CSV";
    this.exportButton.title =
      count === 0
        ? "No rows match the current filters — nothing to export"
        : "Choose a file name and format, then export";
    this.convertTypesButton.disabled = columnCount === 0;
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

  private setImportSource(source: ImportSource | null): void {
    this.importSource = source;
    this.headerRowButton.disabled = source === null;
  }

  /** Opens the header-row chooser for the current table and reloads with the choice. */
  private async openHeaderRowOverride(): Promise<void> {
    const source = this.importSource;
    if (source === null || this.loading) return;
    let preview: string[][];
    try {
      preview = await source.readPreview();
    } catch {
      this.setStatusError("Could not read the file again to preview its rows.");
      return;
    }
    if (preview.length === 0) return;
    const auto = detectTable(preview);
    const result = await openHeaderRowDialog({
      name: source.name,
      preview,
      current: source.layout ?? { skipRows: auto.skipRows, headerRows: auto.headerRows },
      overridden: source.layout !== null,
      ...(source.note === undefined ? {} : { note: source.note }),
    });
    if (result === null) return;
    if (this.stepEntries().length > 0) {
      const confirmed = await openConfirm({
        title: "Reload with a different header row?",
        body: "Reloading re-reads the file, so the changes in the Recipe will be discarded.",
        confirmLabel: "Reload",
      });
      if (!confirmed) return;
    }
    await source.reload(result.kind === "auto" ? null : result.layout);
  }

  private clearData(): void {
    this.importSource = null;
    this.headerRowButton.disabled = true;
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

  /**
   * One-click fills for the "empty cells" chip. Each column gets the choices
   * that suit its type (median/mean for numbers, most common value or
   * "Unknown" for text, carry-forward for dates); everything is a recorded
   * `impute` step, so it shows in the Recipe and can be undone. Clean stays
   * available as the last entry for null markers and finer control.
   */
  private fillMenuItems(candidates: number[]): MenuItem[] {
    const items: MenuItem[] = [];
    const ranked = candidates
      .map((index) => ({ index, meta: this.metas[index] as ColumnMeta }))
      .filter((entry) => entry.meta !== undefined && entry.meta.stats.nulls > 0)
      .sort((a, b) => b.meta.stats.nulls - a.meta.stats.nulls);
    const numeric: number[] = [];
    const textual: number[] = [];
    const header = (name: string, count: number): MenuItem => ({
      label: `${name} · ${count.toLocaleString()} empty`,
      disabled: true,
      action: () => undefined,
    });
    const fill = (index: number, strategy: ImputeStrategy, label: string): MenuItem => ({
      label,
      title: `${label} — recorded in the Recipe and can be undone`,
      action: () => this.confirmFill([index], strategy, label),
    });
    for (const entry of ranked) {
      const { index, meta } = entry;
      if (meta.type === "identifier") continue;
      if (isNumericLikeType(meta.type)) numeric.push(index);
      else if (meta.type === "string" || meta.type === "category" || meta.type === "boolean") {
        textual.push(index);
      }
    }
    for (const entry of ranked.slice(0, 6)) {
      const { index, meta } = entry;
      items.push(header(meta.name, meta.stats.nulls));
      if (meta.type === "identifier") {
        items.push({
          label: "Identifiers shouldn’t be filled — see Fill missing…",
          action: () => this.openTransform({ type: "impute", column: index }),
        });
      } else if (isNumericLikeType(meta.type)) {
        items.push(
          fill(index, { kind: "median" }, "Fill with median"),
          fill(index, { kind: "mean" }, "Fill with mean"),
          fill(index, { kind: "constant", value: "0" }, "Fill with 0"),
        );
      } else if (meta.type === "date" || meta.type === "datetime") {
        items.push(
          fill(index, { kind: "forward" }, "Fill with the previous value"),
          fill(index, { kind: "backward" }, "Fill with the next value"),
        );
      } else {
        const top = meta.stats.topValues[0]?.label;
        items.push(
          fill(
            index,
            { kind: "mode" },
            top === undefined
              ? "Fill with the most common value"
              : `Fill with the most common (“${top.length > 20 ? `${top.slice(0, 19)}…` : top}”)`,
          ),
          fill(index, { kind: "constant", value: "Unknown" }, "Fill with “Unknown”"),
        );
      }
    }
    if (ranked.length > 6) {
      items.push({
        label: `${(ranked.length - 6).toLocaleString()} more columns — choose in Fill missing…`,
        action: () => this.openTransform({ type: "impute", column: ranked[6]?.index }),
      });
    }
    if (numeric.length > 1) {
      items.push({
        label: `Fill all ${numeric.length} numeric columns with median`,
        action: () =>
          this.confirmFill(numeric, { kind: "median" }, `Fill ${numeric.length} numeric columns with median`),
      });
    }
    if (textual.length > 1) {
      items.push({
        label: `Fill all ${textual.length} text columns with the most common value`,
        action: () =>
          this.confirmFill(
            textual,
            { kind: "mode" },
            `Fill ${textual.length} text columns with the most common value`,
          ),
      });
    }
    const first = ranked[0];
    items.push({
      label: "More fill methods…",
      title: "Most common value, previous/next, a constant, KNN, or fill by group",
      action: () => this.openTransform({ type: "impute", column: first?.index }),
    });
    return items;
  }

  /**
   * Fix choices for the "outliers…" chips. The first entry sends you to the
   * Outliers page to judge the rows; the rest change one column and are all
   * recorded in the Recipe (undoable): clip at a percentile or a range you
   * type, empty the outliers so a fill can replace them, or flag them.
   */
  private outlierMenuItems(columns: number[]): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: "Review the outliers first…",
        title: "See how confident each method is, then keep, fix or remove rows one by one",
        action: () => this.setView("outliers"),
      },
    ];
    for (const index of columns) {
      const meta = this.metas[index];
      if (meta === undefined) continue;
      const count = meta.anomalyCounts.values;
      items.push({
        label: `${meta.name} · ${count.toLocaleString()} unusual`,
        disabled: true,
        action: () => undefined,
      });
      items.push(
        {
          label: "Clip at 1% / 99%",
          title: `Winsorise “${meta.name}” — extreme values move to the 1st/99th percentile`,
          action: () => this.winsorizeColumn(index, 1),
        },
        {
          label: "Clip at 5% / 95%",
          title: `A stronger clip: values beyond the 5th/95th percentile move to them`,
          action: () => this.winsorizeColumn(index, 5),
        },
        {
          label: "Clip to a range I choose…",
          title: "Type your own lowest and highest allowed values",
          action: () => void this.clipToRange(index),
        },
      );
      const fence = meta.valueFence;
      if (fence !== null) {
        items.push({
          label: "Empty the outliers (then fill them)…",
          title: `Blank values outside ${formatBound(fence.lo)} – ${formatBound(fence.hi)}, then use Fix: empty cells to fill them`,
          action: () => this.blankOutliers(index, fence.lo, fence.hi),
        });
      }
      items.push({
        label: "Flag unusual values",
        title: `Add a Yes/No column marking the outlier rows of “${meta.name}”`,
        action: () => this.flagAnomaliesColumn(index),
      });
    }
    return items;
  }

  /** Clip (or empty) one column to limits the user types, with the column's span as context. */
  private async clipToRange(column: number): Promise<void> {
    const meta = this.metas[column];
    if (meta === undefined) return;
    const { min, max } = meta.stats;
    const fence = meta.valueFence;
    const span =
      min !== null && max !== null ? `Currently ${formatBound(min)} to ${formatBound(max)}.` : "";
    const typical =
      fence === null ? "" : ` Typical range ${formatBound(fence.lo)} – ${formatBound(fence.hi)}.`;
    const choice = await openRangePrompt({
      title: `Clip “${meta.name}” to a range`,
      hint: `${span}${typical} Leave a side blank for no limit on that side.`.trim(),
      min: fence === null ? null : Number(fence.lo.toPrecision(6)),
      max: fence === null ? null : Number(fence.hi.toPrecision(6)),
      confirmLabel: "Apply",
    });
    if (choice === null) return;
    const verb = choice.outside === "blank" ? "Emptied" : "Clipped";
    this.applyTransform(
      [
        ...this.transformOps,
        { kind: "clip", column, min: choice.min, max: choice.max, outside: choice.outside },
      ],
      `${verb} “${meta.name}” outside ${choice.min ?? "−∞"} … ${choice.max ?? "∞"}`,
    );
  }

  private blankOutliers(column: number, lo: number, hi: number): void {
    const meta = this.metas[column];
    const name = meta?.name ?? "?";
    const count = meta?.anomalyCounts.values ?? 0;
    this.confirmFix(
      `Empty the outliers in “${name}”?`,
      `${count.toLocaleString()} value${count === 1 ? "" : "s"} outside ${formatBound(lo)} – ${formatBound(hi)} will become empty cells. Use Fix: empty cells afterwards to fill them with the median, mean or another value. This is recorded in the Recipe and can be undone.`,
      "Empty the outliers",
      () =>
        this.applyTransform(
          [...this.transformOps, { kind: "clip", column, min: lo, max: hi, outside: "blank" }],
          `Emptied the outliers in “${name}”`,
        ),
    );
  }

  private confirmFill(columns: number[], strategy: ImputeStrategy, label: string): void {
    const cells = columns.reduce((sum, index) => sum + (this.metas[index]?.stats.nulls ?? 0), 0);
    const names = columns
      .slice(0, 3)
      .map((index) => `“${this.metas[index]?.name ?? "?"}”`)
      .join(", ");
    this.confirmFix(
      `${label}?`,
      `${cells.toLocaleString()} empty cell${cells === 1 ? "" : "s"} in ${names}${
        columns.length > 3 ? ` and ${columns.length - 3} more` : ""
      } will be filled. This is recorded in the Recipe and can be undone.`,
      "Fill empty cells",
      () =>
        this.applyTransform(
          [
            ...this.transformOps,
            ...columns.map(
              (column): TransformOp => ({ kind: "impute", column, strategy, groupColumn: null }),
            ),
          ],
          label,
        ),
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
      displayGrouping: this.displayGrouping.has(column),
      sensitiveWhy: this.sensitiveNotes.has(column)
        ? [this.sensitiveNotes.get(column) ?? ""]
        : [],
      onSort: (dir) => this.changeSort(column, dir),
      onFilter: () => this.focusFilterColumn(column),
      onChart: () => {
        this.ensureCharts();
        this.setView("chart");
        this.chartsPanel?.addChart({ kind: chartKindFor(meta.type) ?? "histogram", column });
      },
      onQuickClean: (op) => this.applyQuickClean(column, op),
      onOpenClean: (tab) => this.openClean(column, tab),
      onOpenTransform: (preset) => this.openTransform(preset),
      onSuggestion: (suggestion) => this.applySuggestion(column, suggestion),
      onMerge: () => this.openMerge(column),
      onAllowedValues: (values) => this.checkAllowedValues(column, values),
      onCompare: (target, operator, tolerance) =>
        this.checkPair(column, target, operator, tolerance),
      onCheckFreshness: (days) => this.checkFreshness(column, days),
      columns: () => this.metas,
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
      onDisplayGrouping: (on) => {
        if (on) this.displayGrouping.add(column);
        else this.displayGrouping.delete(column);
        this.table?.setGrouping(this.displayGrouping);
        this.setAction(
          on
            ? `“${meta.name}”: thousands separators shown (values unchanged)`
            : `“${meta.name}”: thousands separators off`,
        );
      },
    });
  }

  /** Freshness rule (plan §6): scores Timeliness against “now”. */
  private checkFreshness(column: number, days: number): void {
    const meta = this.metas[column];
    const latest = meta?.stats.max ?? null;
    if (meta === undefined || latest === null) return;
    const ageDays = Math.max(0, (Date.now() - latest) / 86_400_000);
    const fresh = ageDays <= days;
    this.freshnessRule = { column, days };
    this.dqUserChecks = [
      ...this.dqUserChecks.filter((check) => check.dimension !== "timeliness"),
      {
        id: "timeliness.freshness",
        dimension: "timeliness",
        label: `“${meta.name}” is fresh (≤ ${days} day${days === 1 ? "" : "s"})`,
        detail: `newest value ${new Date(latest).toISOString().slice(0, 10)} · ${ageDays.toFixed(
          1,
        )} days old`,
        pass: fresh ? 1 : 0,
        fail: fresh ? 0 : 1,
        na: 0,
        column: null,
        filter: null,
        fixLabel: null,
      },
    ];
    this.refreshScore();
    this.setAction(
      fresh
        ? `“${meta.name}”: fresh — newest value is ${ageDays.toFixed(1)} days old`
        : `“${meta.name}”: stale — newest value is ${ageDays.toFixed(0)} days old (over ${days})`,
    );
  }

  /**
   * Allowed-values check (plan §5.4): compares the column's categories against
   * the user's list (same normalisation as search) and filters to the values
   * outside it. Display/filters only — the stored data is never changed.
   */
  private checkAllowedValues(column: number, allowed: readonly string[]): void {
    const meta = this.metas[column];
    const categories = meta?.categories ?? null;
    if (meta === undefined || categories === null) return;
    const allowedSet = new Set(allowed.map((value) => normalize(value)));
    const offending: number[] = [];
    let count = 0;
    categories.labels.forEach((label, code) => {
      if (!allowedSet.has(normalize(label))) {
        offending.push(code);
        count += categories.counts[code] ?? 0;
      }
    });
    if (count === 0) {
      this.showToast(`“${meta.name}”: every value is in the allowed list.`);
      return;
    }
    this.changeFilter(column, { kind: "values", selected: offending });
    this.setView("table");
    this.table?.flashColumn(column);
    this.showToast(
      `“${meta.name}”: ${count.toLocaleString()} ${count === 1 ? "cell" : "cells"} outside the allowed list — filtered.`,
      () => this.changeFilter(column, null),
    );
  }

  /** Pair/consistency check (plan §5.3): compare two columns, filter failures. */
  private checkPair(
    columnA: number,
    columnB: number,
    operator: PairOperator,
    tolerance: number,
  ): void {
    const nameA = this.metas[columnA]?.name ?? `Column ${columnA + 1}`;
    const nameB = this.metas[columnB]?.name ?? `Column ${columnB + 1}`;
    const symbol =
      operator === "gte" ? "≥" : operator === "gt" ? ">" : operator === "eq" ? "=" : "≈";
    const label = `“${nameA}” ${symbol}${
      operator === "approx" ? ` (±${tolerance})` : ""
    } “${nameB}”`;
    this.setView("table");
    this.queueSend(() =>
      this.client
        .checkPair({ columnA, columnB, operator, tolerance })
        .then((message) => {
          const tail =
            message.violations === 0
              ? `no failures (${message.compared.toLocaleString()} rows compared)`
              : `${message.violations.toLocaleString()} row${
                  message.violations === 1 ? "" : "s"
                } fail`;
          this.setAction(`${label}: ${tail}`);
          this.showToast(`${label}: ${tail}.`, () => this.toggleSpecial("pairCheck"));
          this.dqUserChecks = [
            ...this.dqUserChecks.filter((check) => check.id !== "consistency.pair"),
            {
              id: "consistency.pair",
              dimension: "consistency",
              label,
              detail: `${message.compared.toLocaleString()} rows compared`,
              pass: Math.max(0, message.compared - message.violations),
              fail: message.violations,
              na: 0,
              column: null,
              filter: "pairCheck",
              fixLabel: "Show failing",
            },
          ];
          this.refreshScore();
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
          if (message.noop === true) {
            this.showToast("Nothing changed - the values already match.");
            this.setAction("Nothing changed");
            return;
          }
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
          this.castFailureCounts.clear();
          for (const failure of message.castFailures) {
            if (failure.count > 0) this.castFailureCounts.set(failure.column, failure.count);
          }
          this.renderFilterChips();
          if (this.castFailureCounts.size === 0 && this.specials.delete("castFailures")) {
            void this.client.setSpecial("castFailures", false);
          }
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
    const total = meta.nullTokens
      .filter((token) => tokens.includes(token.label))
      .reduce((sum, token) => sum + token.count, 0);
    const examples = tokens.slice(0, 3).map((token) => `“${token}”`).join(", ");
    this.confirmFix(
      `Convert placeholders in “${meta.name}” to missing?`,
      `${total.toLocaleString()} cell${total === 1 ? "" : "s"} (${examples}) will become empty. This is recorded in the Recipe and can be undone.`,
      "Convert to missing",
      () => {
        const extra = [...new Set([...meta.nullPolicy.extra, ...tokens])];
        this.applyNullPolicy(column, extra, meta.nullPolicy.keep, {
          label: `${meta.name}: placeholder text treated as missing`,
        });
      },
    );
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
          this.castFailureCounts.clear();
          for (const failure of message.castFailures) {
            if (failure.count > 0) this.castFailureCounts.set(failure.column, failure.count);
          }
          this.renderFilterChips();
          if (this.castFailureCounts.size === 0 && this.specials.delete("castFailures")) {
            void this.client.setSpecial("castFailures", false);
          }
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
    const stats = this.latestStats;
    const removed =
      keep === "none" ? (stats?.rowsInDuplicateGroups ?? 0) : (stats?.duplicateRows ?? 0);
    this.confirmFix(
      "Remove duplicate rows?",
      `${removed.toLocaleString()} redundant row${
        removed === 1 ? "" : "s"
      } will be removed (${label}). This is recorded in the Recipe and can be undone.`,
      "Remove duplicates",
      () =>
        this.applyTransform(
          [...this.transformOps, { kind: "dedupe", keep }],
          `Removed duplicate rows (${label})`,
        ),
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
