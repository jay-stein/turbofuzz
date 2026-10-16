import type { LengthFence, ValueFence } from "../data/anomalies.js";
import type { ViewDef } from "../data/aggregate.js";
import type { PairOperator } from "../data/pair-checks.js";
import type { DependencyPair } from "../data/dependencies.js";
import type { GroupAnomalyPair } from "../data/group-anomalies.js";
import type { RelationshipData } from "../data/relationships.js";
import type { TextProfile } from "../data/text-profile.js";
import type { DistributionChange } from "../data/distribution.js";
import type { SimilarClusterEntry } from "../data/similar-clusters.js";
import type { AnimationResult } from "../data/chart-frames.js";
import type { GridCountsResult } from "../data/chart-stats.js";
import type { TimeGrain } from "../data/aggregate.js";
import type { ChartBinOptions, ChartBins } from "../data/chart-bins.js";
import type { SeriesMode, SeriesResult } from "../data/chart-series.js";
import type { BoxStatsResult, CorrelationResult, CrossTabResult } from "../data/chart-stats.js";
import type { CleanOp } from "../data/clean-ops.js";
import type { HistogramData, NullTokenCount } from "../data/column.js";
import type { ColumnSuggestion } from "../data/suggestions.js";
import type { DatasetStats } from "../data/stats.js";
import type { ColumnSchema, TransformOp } from "../data/transform-ops.js";
import type { DateOrder } from "../parse/dates.js";
import type { Delimiter } from "../parse/delimiter.js";
import type { FileEncoding } from "../parse/encoding.js";
import type { ColumnStats } from "../parse/infer.js";
import type { NumberLocale } from "../parse/numbers.js";
import type { RaggedInfo } from "../parse/parse.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { ColumnType } from "../types.js";

export interface CategoryMeta {
  labels: string[];
  counts: number[];
}

/** Dominant-format profile for a text-like column (format-validity check). */
export interface ColumnPatternMeta {
  mask: string;
  share: number;
  total: number;
  offCount: number;
  examples: string[];
}

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  numberLocale: NumberLocale;
  dateOrder: DateOrder;
  /** Datetime column: at least one source value carried a zone offset. */
  timeZoneAware?: boolean;
  stats: ColumnStats;
  anomalyCounts: { values: number; lengths: number };
  /** Category columns: number of near-duplicate value clusters we can merge. */
  similarGroups: number;
  categories: CategoryMeta | null;
  histogram: HistogramMeta | null;
  valueFence: ValueFence | null;
  lengthFence: LengthFence | null;
  nullPolicy: { extra: string[]; keep: string[] };
  nullTokens: NullTokenCount[];
  suggestions: ColumnSuggestion[];
  /** Dominant-format check: mask, off-pattern count and examples (null when none). */
  pattern?: ColumnPatternMeta | null;
}

export type HistogramMeta = HistogramData;

export interface ColumnDetail {
  name: string;
  type: ColumnType;
  distinct: number;
  nulls: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  stddev: number | null;
  minLength: number | null;
  maxLength: number | null;
  avgLength: number | null;
  median: number | null;
  topValues: { label: string; count: number }[] | null;
}

export type ProgressPhase =
  | "read"
  | "parse"
  | "infer"
  | "build"
  | "stats"
  | "index"
  | "sort"
  | "ready";

export interface ProgressMessage {
  type: "progress";
  phase: ProgressPhase;
  detail?: string;
  /** Steps done within the phase, for a determinate progress bar. */
  current?: number;
  total?: number;
  column?: number;
  active?: boolean;
  /** The load this progress belongs to; absent for non-load phases. */
  requestId?: number;
}

export type LoadRequest = {
  type: "load";
  requestId: number;
  name: string;
  delimiter: Delimiter | "auto";
  hasHeaders: boolean;
  text?: string;
  buffer?: ArrayBuffer;
  table?: { rows: string[][]; hasHeaders: boolean };
  /** Parse only the first N rows: the safe path offered for giant files. */
  maxRows?: number;
};

/** Stops the in-flight load at its next cancellation checkpoint. */
export type CancelLoadRequest = { type: "cancelLoad" };

export type SetFilterRequest = {
  type: "setFilter";
  requestId: number;
  column: number;
  filter: ColumnFilter | null;
  preview?: boolean;
};

export type ClearFiltersRequest = { type: "clearFilters"; requestId: number };

export type SpecialKind =
  | "duplicates"
  | "nulls"
  | "valueAnomalies"
  | "lengthAnomalies"
  | "groupAnomalies"
  | "pattern"
  | "keyDuplicates"
  | "pairCheck";

export type SetSpecialRequest = {
  type: "setSpecial";
  requestId: number;
  kind: SpecialKind;
  active: boolean;
  /** When set (and kind is not duplicates), scope the special to one column. */
  column?: number;
};

export type DropRowsRequest = {
  type: "dropRows";
  requestId: number;
  /** Positions in the current result order to remove from the working set. */
  positions: number[];
};

export type ClearExcludedRowsRequest = { type: "clearExcludedRows"; requestId: number };

export type ShuffleRequest = { type: "shuffle"; requestId: number; limit?: number };

export type SortRequest = {
  type: "sort";
  requestId: number;
  column: number;
  dir: 1 | -1;
};

export type GetRowsRequest = {
  type: "getRows";
  requestId: number;
  start: number;
  end: number;
};

export type SetTypeRequest = {
  type: "setType";
  requestId: number;
  column: number;
  columnType: ColumnType;
};

export type SetNumberLocaleRequest = {
  type: "setNumberLocale";
  requestId: number;
  column: number;
  locale: NumberLocale;
};

export type GetStatsRequest = { type: "getStats"; requestId: number };

export type GetChartBinsRequest = {
  type: "getChartBins";
  requestId: number;
  column: number;
  options: ChartBinOptions;
};

export interface ChartBinsMessage extends ChartBins {
  type: "chartBins";
  requestId: number;
  column: number;
  /** Sampled column median, drawn as an annotation (null when undefined). */
  median: number | null;
}

export type GetGroupedBinsRequest = {
  type: "getGroupedBins";
  requestId: number;
  column: number;
  groupColumn: number;
  options: ChartBinOptions;
  topN: number;
};

export interface GroupedBinsMessage {
  type: "groupedBins";
  requestId: number;
  column: number;
  groupColumn: number;
  /** Aligned with codes, groups and totals. */
  labels: string[];
  /** Category code per series; -1 marks the Other bucket. */
  codes: number[];
  /** Bin counts per series (length = bins). */
  groups: number[][];
  totals: number[];
  /** Index of the Other series, or -1. */
  otherIndex: number;
  bins: number;
  overflow: number;
  above: number;
  below: number;
  total: number;
  /** Worker compute time for this payload. */
  ms: number;
}

export type GetMissingnessRequest = {
  type: "getMissingness";
  requestId: number;
  /** Maximum row buckets for the missingness map (capped at 1024). */
  buckets: number;
};

export interface MissingnessMessage {
  type: "missingness";
  requestId: number;
  /** Row buckets actually used (top bucket = first rows). */
  buckets: number;
  columns: number;
  /** Row-major missing-cell counts per bucket × column (exact). */
  cells: Uint16Array;
  totalRows: number;
  columnNames: string[];
  /** Worker compute time for this payload. */
  ms: number;
}

export type GetChartSeriesRequest = {
  type: "getChartSeries";
  requestId: number;
  xColumn: number;
  yColumn: number;
  /** -1 (or omitted) draws every point in the chart colour. */
  colorColumn?: number;
  sizeColumn?: number;
  mode: SeriesMode;
  limit?: number;
};

export interface ChartSeriesMessage {
  type: "chartSeries";
  requestId: number;
  xColumn: number;
  yColumn: number;
  colorColumn: number;
  sizeColumn: number;
  colorLabels: string[] | null;
  /** Worker compute time for this payload. */
  ms: number;
  /** Pearson r of the two plotted columns over the filtered pairs (NaN if undefined). */
  correlation: number;
  result: SeriesResult;
}

export type GetBoxStatsRequest = {
  type: "getBoxStats";
  requestId: number;
  valueColumn: number;
  categoryColumn: number;
  topN: number;
  groupOther: boolean;
};

export interface BoxStatsMessage {
  type: "boxStats";
  requestId: number;
  valueColumn: number;
  categoryColumn: number;
  ms: number;
  result: BoxStatsResult;
}

export type GetCrosstabRequest = {
  type: "getCrosstab";
  requestId: number;
  xColumn: number;
  yColumn: number;
  topX: number;
  topY: number;
  groupOther: boolean;
};

export interface CrosstabMessage {
  type: "crosstab";
  requestId: number;
  xColumn: number;
  yColumn: number;
  ms: number;
  result: CrossTabResult;
}

export type GetCorrelationRequest = {
  type: "getCorrelation";
  requestId: number;
  columns: number[];
};

export interface CorrelationMessage {
  type: "correlation";
  requestId: number;
  /** Dataset column indexes, aligned with the matrix rows/columns. */
  columns: number[];
  labels: string[];
  ms: number;
  result: CorrelationResult;
}

export type ExportScope = "all" | "filtered";

export type StartExportRequest = {
  type: "startExport";
  requestId: number;
  /** "all" = every row after steps, ignoring filters (default "filtered"). */
  scope?: ExportScope;
};

export interface ExportOptions {
  /** Replace null/heuristic-missing cells with an empty string (default true). */
  nullAsBlank?: boolean;
  /** Prefix formula-like cells with ' so spreadsheets import them as text. */
  escapeFormulas?: boolean;
}

export type GetCsvRequest = {
  type: "getCsv";
  requestId: number;
  start: number;
  end: number;
  options?: ExportOptions;
};

export type RenameHeadersRequest = {
  type: "renameHeaders";
  requestId: number;
  headers: string[];
};

export interface CleanUpdate {
  column: number;
  ops: CleanOp[];
}

export type CleanColumnsRequest = {
  type: "cleanColumns";
  requestId: number;
  updates: CleanUpdate[];
};

export type TransformRequest = {
  type: "transform";
  requestId: number;
  ops: TransformOp[];
};

export type PreviewTransformRequest = {
  type: "previewTransform";
  requestId: number;
  ops: TransformOp[];
};

export type PreviewCleanRequest = {
  type: "previewClean";
  requestId: number;
  updates: CleanUpdate[];
};

export type SetNullPolicyRequest = {
  type: "setNullPolicy";
  requestId: number;
  column: number;
  extra: string[];
  keep: string[];
};

export type GetAggregateRequest = {
  type: "getAggregate";
  requestId: number;
  /** The saved view definition (dimensions, measures, sort, limit). */
  view: ViewDef;
};

export interface AggregateMessage {
  type: "aggregate";
  requestId: number;
  viewId: string;
  labels: string[];
  dimensions: string[][];
  dimensionNames: string[];
  dimensionIsTime: boolean[];
  dimensionTimes: Float64Array[];
  measures: Float64Array[];
  measureNames: string[];
  totals: Float64Array;
  groupCount: number;
  totalGroups: number;
  truncated: boolean;
  /** Per shown group: the period is incomplete at a data edge. */
  partials: boolean[] | null;
  /** Worker compute time for this payload. */
  ms: number;
}

export type ResolveNullsAllRequest = {
  type: "resolveNullsAll";
  requestId: number;
  extra: string[];
  keep: string[];
};

export type GetCoMissingnessRequest = {
  type: "getCoMissingness";
  requestId: number;
};

export interface CoMissingnessMessage {
  type: "coMissingness";
  requestId: number;
  /** Dataset column indexes included (capped, only columns with nulls). */
  columns: number[];
  labels: string[];
  /** Missing cells per column. */
  nullCells: number[];
  /** Row-major K×K counts of rows missing in both columns. */
  pairs: number[];
  ms: number;
}

export type GetGroupAnomaliesRequest = {
  type: "getGroupAnomalies";
  requestId: number;
};

export interface GroupAnomaliesMessage {
  type: "groupAnomalies";
  requestId: number;
  pairs: GroupAnomalyPair[];
  /** Every flagged row across the analysed pairs. */
  totalFlagged: number;
  ms: number;
}

export type GetDependenciesRequest = {
  type: "getDependencies";
  requestId: number;
};

export interface DependenciesMessage {
  type: "dependencies";
  requestId: number;
  /** Candidate keys and the columns they determine (98%+ functional). */
  pairs: DependencyPair[];
  ms: number;
}

export type GetRelationshipsRequest = {
  type: "getRelationships";
  requestId: number;
};

export interface RelationshipsMessage {
  type: "relationships";
  requestId: number;
  /** Ranked associations by effect size (Pearson, Spearman, V, η²). */
  relationships: RelationshipData[];
  ms: number;
}

export type GetTextProfileRequest = {
  type: "getTextProfile";
  requestId: number;
  column: number;
  /** Maximum ranked terms returned (default 30). */
  limit?: number;
};

export interface TextProfileMessage {
  type: "textProfile";
  requestId: number;
  column: number;
  label: string;
  profile: TextProfile;
  ms: number;
}

export type GetSimilarClustersRequest = {
  type: "getSimilarClusters";
  requestId: number;
};

export interface SimilarClustersMessage {
  type: "similarClusters";
  requestId: number;
  /** Near-duplicate value clusters per column (capped, approximate). */
  entries: SimilarClusterEntry[];
  ms: number;
}

export type GetGridCountsRequest = {
  type: "getGridCounts";
  requestId: number;
  xColumn: number;
  yColumn: number;
  /** Grid resolution per axis (4–120, default 40). */
  bins?: number;
  /** Optional per-cell measure driving the bubble sizes. */
  measure?: { column: number; agg: "sum" | "mean" | "min" | "max" };
  /** Optional category column splitting the bubbles into one set per group. */
  groupColumn?: number;
};

export interface GridCountsMessage {
  type: "gridCounts";
  requestId: number;
  /** Row counts per cell of the x/y grid (bubble chart). */
  result: GridCountsResult;
  ms: number;
}

export type AnimationChart = "bar" | "bubble" | "histogram";

export type GetAnimationRequest = {
  type: "getAnimation";
  requestId: number;
  timeColumn: number;
  grain: TimeGrain;
  chart: AnimationChart;
  /** bar/histogram: the value column; bubble: the x column. */
  column: number;
  /** bubble: the y column (ignored for bar). */
  yColumn: number;
  /** bubble grid resolution (default 40). */
  bins?: number;
  /** bar: categories kept before Other (default 8). */
  topN?: number;
  /** Optional per-cell measure driving the bubble sizes. */
  measure?: { column: number; agg: "sum" | "mean" | "min" | "max" };
  /** bubble: optional category column splitting the bubbles into sets. */
  groupColumn?: number;
};

export interface AnimationMessage {
  type: "animation";
  requestId: number;
  /** Frames plus the per-kind series (bars or bubble grids). */
  result: AnimationResult;
  ms: number;
}

export type GetDistributionChangesRequest = {
  type: "getDistributionChanges";
  requestId: number;
};

export type CheckKeyDuplicatesRequest = {
  type: "checkKeyDuplicates";
  requestId: number;
  columns: number[];
};

export type CheckPairRequest = {
  type: "checkPair";
  requestId: number;
  columnA: number;
  columnB: number;
  operator: PairOperator;
  tolerance?: number;
};

export interface PairCheckMessage {
  type: "pairCheck";
  requestId: number;
  columnA: number;
  columnB: number;
  operator: PairOperator;
  /** Rows where both values are present and the comparison fails. */
  violations: number;
  /** Rows where both values are present (null on either side is N.A.). */
  compared: number;
  count: number;
  queryMs: number;
  facets: Record<number, number[]>;
  histograms: Record<number, number[]>;
  firstRows: string[][];
  firstGroups?: boolean[];
  firstFlags?: Uint8Array;
  firstChanged?: Uint8Array;
}

export interface KeyDuplicatesMessage {
  type: "keyDuplicates";
  requestId: number;
  columns: number[];
  /** Rows beyond the first copy of each duplicated key combination. */
  duplicateRows: number;
  duplicateGroups: number;
  /** Rows whose key is fully populated (null key parts are skipped as N.A.). */
  counted: number;
  count: number;
  queryMs: number;
  facets: Record<number, number[]>;
  histograms: Record<number, number[]>;
  firstRows: string[][];
  firstGroups?: boolean[];
  firstFlags?: Uint8Array;
  firstChanged?: Uint8Array;
}

export interface DistributionChangesMessage {
  type: "distributionChanges";
  requestId: number;
  /** PSI (numeric) or Cramér's V (category) between row halves. */
  changes: DistributionChange[];
  ms: number;
}

export type WorkerRequest =
  | LoadRequest
  | CancelLoadRequest
  | SetFilterRequest
  | ClearFiltersRequest
  | SetSpecialRequest
  | DropRowsRequest
  | ClearExcludedRowsRequest
  | ShuffleRequest
  | SortRequest
  | GetRowsRequest
  | SetTypeRequest
  | SetNumberLocaleRequest
  | GetStatsRequest
  | GetChartBinsRequest
  | GetGroupedBinsRequest
  | GetMissingnessRequest
  | GetChartSeriesRequest
  | GetBoxStatsRequest
  | GetCrosstabRequest
  | GetCorrelationRequest
  | StartExportRequest
  | GetCsvRequest
  | RenameHeadersRequest
  | CleanColumnsRequest
  | TransformRequest
  | PreviewTransformRequest
  | PreviewCleanRequest
  | SetNullPolicyRequest
  | ResolveNullsAllRequest
  | GetAggregateRequest
  | GetCoMissingnessRequest
  | GetGroupAnomaliesRequest
  | GetDependenciesRequest
  | GetRelationshipsRequest
  | GetTextProfileRequest
  | GetDistributionChangesRequest
  | GetSimilarClustersRequest
  | CheckKeyDuplicatesRequest
  | CheckPairRequest
  | GetGridCountsRequest
  | GetAnimationRequest;

export interface DatasetMessage {
  requestId: number;
  name: string;
  headers: string[];
  rowCount: number;
  columnCount: number;
  columns: ColumnMeta[];
  stats: DatasetStats;
  ingestMs: number;
  source: "paste" | "file";
  encoding: FileEncoding | null;
  /** Auto-detected delimiter for delimited files (null for JSON, Excel, data grids). */
  delimiter: Delimiter | null;
  /** Ragged rows seen at import time (padded or dropped extra cells). */
  ragged: RaggedInfo;
}

export interface LoadedMessage extends DatasetMessage {
  type: "loaded";
}

/** The in-flight load was cancelled before it swapped the dataset. */
export interface LoadCancelledMessage {
  type: "loadCancelled";
  requestId: number;
}

export interface TransformedMessage extends DatasetMessage {
  type: "transformed";
  ops: TransformOp[];
  baseSchema: ColumnSchema[];
}

export interface ResultsMessage {
  type: "results";
  requestId: number;
  count: number;
  queryMs: number;
  facets: Record<number, number[]>;
  histograms: Record<number, number[]>;
  firstRows: string[][];
  firstGroups?: boolean[];
  firstFlags?: Uint8Array;
  firstChanged?: Uint8Array;
}

export interface SortedMessage {
  type: "sorted";
  requestId: number;
  count: number;
  column: number;
  dir: 1 | -1;
  firstRows: string[][];
  firstGroups?: boolean[];
  firstFlags?: Uint8Array;
  firstChanged?: Uint8Array;
}

export interface ShuffledMessage {
  type: "shuffled";
  requestId: number;
  count: number;
  firstRows: string[][];
  firstFlags?: Uint8Array;
  firstChanged?: Uint8Array;
}

export interface RowsMessage {
  type: "rows";
  requestId: number;
  start: number;
  rows: string[][];
  groups?: boolean[];
  flags?: Uint8Array;
  /** Row-major 1/0 flags: cell value differs from the original ingest value. */
  changed?: Uint8Array;
}

export interface ColumnMetaMessage {
  type: "columnMeta";
  requestId: number;
  column: number;
  meta: ColumnMeta;
  stats: DatasetStats;
  count: number;
  queryMs: number;
  facets: Record<number, number[]>;
  histograms: Record<number, number[]>;
  firstRows: string[][];
  firstGroups?: boolean[];
  firstFlags?: Uint8Array;
  firstChanged?: Uint8Array;
  /** Non-null values that fail to parse under the new column type (setType). */
  nonParsing?: number;
}

export interface StatsMessage {
  type: "stats";
  requestId: number;
  rowCount: number;
  columnCount: number;
  stats: DatasetStats;
  columns: ColumnDetail[];
}

export interface ExportStartedMessage {
  type: "exportStarted";
  requestId: number;
  total: number;
}

export interface CsvChunkMessage {
  type: "csv";
  requestId: number;
  start: number;
  text: string;
}

export interface HeadersRenamedMessage {
  type: "headersRenamed";
  requestId: number;
  headers: string[];
}

export interface CleanedMessage {
  type: "cleaned";
  requestId: number;
  columns: { column: number; meta: ColumnMeta }[];
  stats: DatasetStats;
  count: number;
  queryMs: number;
  facets: Record<number, number[]>;
  histograms: Record<number, number[]>;
  firstRows: string[][];
  firstGroups?: boolean[];
  firstFlags?: Uint8Array;
  firstChanged?: Uint8Array;
  /** Cells changed since load, across every tracked column. */
  changedTotal: number;
}

export interface ErrorMessage {
  type: "error";
  requestId: number;
  message: string;
}

export interface TransformPreviewNote {
  /** Index in the staged op list. */
  op: number;
  text: string;
  /** Up to three before → after cells behind the summary. */
  samples?: { before: string; after: string }[];
}

export interface TransformPreviewMessage {
  type: "transformPreview";
  requestId: number;
  baseRowCount: number;
  rowCount: number;
  baseNullCells: number;
  nullCells: number;
  columnCount: number;
  /** Column names after the staged ops (needed when a split changes the count). */
  columnNames: string[];
  /** Per-op impact details: replacements, failures, samples. */
  notes: TransformPreviewNote[];
}

export interface CleanPreviewMessage {
  type: "cleanPreview";
  requestId: number;
  columns: {
    column: number;
    changed: number;
    total: number;
    /** Non-null cells a cast op could not parse (0 when no cast is staged). */
    failed: number;
  }[];
}

export type WorkerResponse =
  | ProgressMessage
  | LoadedMessage
  | LoadCancelledMessage
  | TransformedMessage
  | ResultsMessage
  | SortedMessage
  | ShuffledMessage
  | RowsMessage
  | ColumnMetaMessage
  | StatsMessage
  | ChartBinsMessage
  | GroupedBinsMessage
  | MissingnessMessage
  | ChartSeriesMessage
  | BoxStatsMessage
  | CrosstabMessage
  | CorrelationMessage
  | AggregateMessage
  | CoMissingnessMessage
  | GroupAnomaliesMessage
  | DependenciesMessage
  | RelationshipsMessage
  | TextProfileMessage
  | DistributionChangesMessage
  | SimilarClustersMessage
  | KeyDuplicatesMessage
  | PairCheckMessage
  | GridCountsMessage
  | AnimationMessage
  | ExportStartedMessage
  | CsvChunkMessage
  | HeadersRenamedMessage
  | CleanedMessage
  | TransformPreviewMessage
  | CleanPreviewMessage
  | ErrorMessage;
