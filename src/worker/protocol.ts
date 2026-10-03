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

export type SetSpecialRequest = {
  type: "setSpecial";
  requestId: number;
  kind: "duplicates" | "nulls";
  active: boolean;
};

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

export type WorkerRequest =
  | LoadRequest
  | SetFilterRequest
  | ClearFiltersRequest
  | SetSpecialRequest
  | SortRequest
  | GetRowsRequest
  | SetTypeRequest
  | GetStatsRequest
  | StartExportRequest
  | GetCsvRequest;

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
}

export interface SortedMessage {
  type: "sorted";
  requestId: number;
  count: number;
  column: number;
  dir: 1 | -1;
  firstRows: string[][];
  firstGroups?: boolean[];
}

export interface RowsMessage {
  type: "rows";
  requestId: number;
  start: number;
  rows: string[][];
  groups?: boolean[];
}

export interface ColumnMetaMessage {
  type: "columnMeta";
  requestId: number;
  column: number;
  meta: ColumnMeta;
  count: number;
  queryMs: number;
  facets: Record<number, number[]>;
  histograms: Record<number, number[]>;
  firstRows: string[][];
  firstGroups?: boolean[];
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
  | RowsMessage
  | ColumnMetaMessage
  | StatsMessage
  | ExportStartedMessage
  | CsvChunkMessage
  | ErrorMessage;
