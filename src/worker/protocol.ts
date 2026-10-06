import type { LengthFence, ValueFence } from "../data/anomalies.js";
import type { CleanOp } from "../data/clean-ops.js";
import type { DatasetStats } from "../data/stats.js";
import type { Delimiter } from "../parse/delimiter.js";
import type { FileEncoding } from "../parse/encoding.js";
import type { ColumnStats } from "../parse/infer.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { ColumnType } from "../types.js";

export interface CategoryMeta {
  labels: string[];
  counts: number[];
}

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  stats: ColumnStats;
  categories: CategoryMeta | null;
  histogram: HistogramMeta | null;
  valueFence: ValueFence | null;
  lengthFence: LengthFence | null;
}

export interface HistogramMeta {
  bins: number[];
  min: number;
  max: number;
}

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
};

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

export type GetStatsRequest = { type: "getStats"; requestId: number };

export type StartExportRequest = { type: "startExport"; requestId: number };

export type GetCsvRequest = {
  type: "getCsv";
  requestId: number;
  start: number;
  end: number;
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

export type WorkerRequest =
  | LoadRequest
  | SetFilterRequest
  | ClearFiltersRequest
  | SetSpecialRequest
  | ShuffleRequest
  | SortRequest
  | GetRowsRequest
  | SetTypeRequest
  | GetStatsRequest
  | StartExportRequest
  | GetCsvRequest
  | RenameHeadersRequest
  | CleanColumnsRequest;

export interface LoadedMessage {
  type: "loaded";
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

export type WorkerResponse =
  | ProgressMessage
  | LoadedMessage
  | ResultsMessage
  | SortedMessage
  | ShuffledMessage
  | RowsMessage
  | ColumnMetaMessage
  | StatsMessage
  | ExportStartedMessage
  | CsvChunkMessage
  | HeadersRenamedMessage
  | CleanedMessage
  | ErrorMessage;
