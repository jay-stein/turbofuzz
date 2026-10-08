import type { LengthFence, ValueFence } from "../data/anomalies.js";
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

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  numberLocale: NumberLocale;
  dateOrder: DateOrder;
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

export type ProgressPhase = "parse" | "build" | "stats" | "index" | "sort";

export interface ProgressMessage {
  type: "progress";
  phase: ProgressPhase;
  detail?: string;
  column?: number;
  active?: boolean;
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
};

export type SetFilterRequest = {
  type: "setFilter";
  requestId: number;
  column: number;
  filter: ColumnFilter | null;
  preview?: boolean;
};

export type ClearFiltersRequest = { type: "clearFilters"; requestId: number };

export type SpecialKind = "duplicates" | "nulls" | "valueAnomalies" | "lengthAnomalies";

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

export type ResolveNullsAllRequest = {
  type: "resolveNullsAll";
  requestId: number;
  extra: string[];
  keep: string[];
};

export type WorkerRequest =
  | LoadRequest
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
  | ResolveNullsAllRequest;

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
  /** Ragged rows seen at import time (padded or dropped extra cells). */
  ragged: RaggedInfo;
}

export interface LoadedMessage extends DatasetMessage {
  type: "loaded";
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
}

export interface ShuffledMessage {
  type: "shuffled";
  requestId: number;
  count: number;
  firstRows: string[][];
  firstFlags?: Uint8Array;
}

export interface RowsMessage {
  type: "rows";
  requestId: number;
  start: number;
  rows: string[][];
  groups?: boolean[];
  flags?: Uint8Array;
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
}

export interface ErrorMessage {
  type: "error";
  requestId: number;
  message: string;
}

export interface TransformPreviewMessage {
  type: "transformPreview";
  requestId: number;
  baseRowCount: number;
  rowCount: number;
  baseNullCells: number;
  nullCells: number;
  columnCount: number;
}

export interface CleanPreviewMessage {
  type: "cleanPreview";
  requestId: number;
  columns: { column: number; changed: number; total: number }[];
}

export type WorkerResponse =
  | ProgressMessage
  | LoadedMessage
  | TransformedMessage
  | ResultsMessage
  | SortedMessage
  | ShuffledMessage
  | RowsMessage
  | ColumnMetaMessage
  | StatsMessage
  | ChartBinsMessage
  | ChartSeriesMessage
  | BoxStatsMessage
  | CrosstabMessage
  | CorrelationMessage
  | ExportStartedMessage
  | CsvChunkMessage
  | HeadersRenamedMessage
  | CleanedMessage
  | TransformPreviewMessage
  | CleanPreviewMessage
  | ErrorMessage;
