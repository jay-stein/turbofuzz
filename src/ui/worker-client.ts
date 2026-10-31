import type { TsConfig, TsMode } from "../data/timeseries/aggregate.js";
import type { HeaderLayout } from "../parse/header-detect.js";
import type { Delimiter } from "../parse/delimiter.js";
import type { ChartExclusion } from "../data/chart-exclusions.js";
import type { NumberLocale } from "../parse/numbers.js";
import type { TimeGrain, ViewDef } from "../data/aggregate.js";
import type { PivotDef } from "../data/pivot.js";
import type { PairOperator } from "../data/pair-checks.js";
import type { Rule } from "../data/rules.js";
import type { ChartBinOptions } from "../data/chart-bins.js";
import type { SeriesMode } from "../data/chart-series.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { TransformOp } from "../data/transform-ops.js";
import type { ColumnType } from "../types.js";
import type {
  AggregateMessage,
  AnimationChart,
  AnimationMessage,
  BoxStatsMessage,
  GetSliceBreakdownRequest,
  SliceBreakdownMessage,
  ChartBinsMessage,
  ChartSeriesMessage,
  CorrelationMessage,
  CrosstabMessage,
  CleanedMessage,
  CleanPreviewMessage,
  CleanUpdate,
  CoMissingnessMessage,
  ColumnMetaMessage,
  CsvChunkMessage,
  DatasetStatsMessage,
  DependenciesMessage,
  DistributionChangesMessage,
  GridCountsMessage,
  KeyDuplicatesMessage,
  KeyDuplicateCountMessage,
  PairCheckMessage,
  PairCountMessage,
  RulesEvaluatedMessage,
  PivotMessage,
  SimilarClustersMessage,
  ExportOptions,
  ExportScope,
  ExportStartedMessage,
  ChartGroupsMessage,
  GroupAnomaliesMessage,
  OutlierAnalysisMessage,
  OutlierMethod,
  OutlierMode,
  GroupedBinsMessage,
  HeadersRenamedMessage,
  LoadedMessage,
  MissingnessMessage,
  ProgressMessage,
  ColumnNetworkMessage,
  RelationshipsMessage,
  TimeSeriesMessage,
  ResultsMessage,
  RowsMessage,
  RowIdsMessage,
  RowPositionMessage,
  OrderMessage,
  FormulaPreviewMessage,
  RowLimit,
  ShuffledMessage,
  SortedMessage,
  SpecialKind,
  StatsMessage,
  TextProfileMessage,
  ColumnSampleMessage,
  ValueSuggestionsMessage,
  SensitiveColumnMessage,
  RowsAffectedMessage,
  ExceptionsMessage,
  SensitiveDoneMessage,
  TransformedMessage,
  TransformPreviewMessage,
  WorkerRequest,
  WorkerResponse,
} from "../worker/protocol.js";

interface Pending {
  resolve: (message: WorkerResponse) => void;
  reject: (error: Error) => void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type WorkerRequestPayload = DistributiveOmit<WorkerRequest, "requestId">;

export interface LoadOptions {
  name: string;
  delimiter: Delimiter | "auto";
  hasHeaders: boolean;
  text?: string;
  buffer?: ArrayBuffer;
  table?: { rows: string[][]; hasHeaders: boolean };
  /** Several files concatenated with an `_input_filename` column. */
  files?: { name: string; text?: string; buffer?: ArrayBuffer }[];
  /** Parse only the first N rows (safe path for very large files). */
  maxRows?: number;
  /** Open the table first and finalize metrics separately. */
  deferStats?: boolean;
  /** User-chosen header layout replacing automatic detection. */
  headerLayout?: HeaderLayout;
}

/** The user cancelled an in-flight load; the dataset is unchanged. */
export class LoadCancelledError extends Error {
  constructor() {
    super("Import cancelled");
    this.name = "LoadCancelledError";
  }
}

export class SearchWorkerClient {
  private worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private progressHandler: ((message: ProgressMessage) => void) | null = null;
  private crashHandler: (() => void) | null = null;
  /** The load whose progress the UI may show; prevents stale-load flicker. */
  private currentLoadId: number | null = null;

  constructor() {
    this.worker = this.spawn();
  }

  /** Creates (or recreates) the worker and wires its handlers. */
  private spawn(): Worker {
    const worker = new Worker(new URL("../worker/search.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(event.data);
    worker.onerror = (event: ErrorEvent) => {
      const error = new Error(event.message === "" ? "Search worker crashed" : event.message);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.currentLoadId = null;
      // An out-of-memory file kills the worker with all its data. Restart it
      // so the next load works, and let the app explain what happened.
      worker.terminate();
      this.worker = this.spawn();
      this.crashHandler?.();
    };
    return worker;
  }

  /** Called once after a worker crash and restart (e.g. browser OOM). */
  onCrash(handler: () => void): void {
    this.crashHandler = handler;
  }

  onProgress(handler: (message: ProgressMessage) => void): void {
    this.progressHandler = handler;
  }

  load(options: LoadOptions): Promise<LoadedMessage> {
    const transfer: ArrayBuffer[] = [];
    if (options.buffer !== undefined) transfer.push(options.buffer);
    for (const file of options.files ?? []) {
      if (file.buffer !== undefined) transfer.push(file.buffer);
    }
    const requestId = this.nextId++;
    return new Promise<LoadedMessage>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: WorkerResponse) => void,
        reject,
      });
      this.currentLoadId = requestId;
      this.worker.postMessage({ type: "load", ...options, requestId } as WorkerRequest, transfer);
    });
  }

  /** Stops the in-flight load at its next checkpoint; the dataset is unchanged. */
  cancelLoad(): void {
    this.worker.postMessage({ type: "cancelLoad" } as WorkerRequest);
  }

  setFilter(
    column: number,
    filter: ColumnFilter | null,
    preview = false,
  ): Promise<ResultsMessage> {
    return this.request<ResultsMessage>({ type: "setFilter", column, filter, preview });
  }

  setFilters(
    filters: { column: number; filter: ColumnFilter | null }[],
    preview = false,
  ): Promise<ResultsMessage> {
    return this.request<ResultsMessage>({ type: "setFilters", filters, preview });
  }
  clearFilters(): Promise<ResultsMessage> {
    return this.request<ResultsMessage>({ type: "clearFilters" });
  }

  finalizeStats(): Promise<DatasetStatsMessage> {
    return this.request<DatasetStatsMessage>({ type: "finalizeStats" });
  }

  setSpecial(kind: SpecialKind, active: boolean, column?: number): Promise<ResultsMessage> {
    return this.request<ResultsMessage>({ type: "setSpecial", kind, active, column });
  }

  dropRows(positions: number[]): Promise<ResultsMessage> {
    return this.request<ResultsMessage>({ type: "dropRows", positions });
  }

  /** Removes specific dataset rows (by id) from the working set. */
  dropRowsById(rowIds: number[]): Promise<ResultsMessage> {
    return this.request<ResultsMessage>({ type: "dropRows", positions: [], rowIds });
  }

  clearExcludedRows(): Promise<ResultsMessage> {
    return this.request<ResultsMessage>({ type: "clearExcludedRows" });
  }

  shuffle(limit?: number): Promise<ShuffledMessage> {
    return this.request<ShuffledMessage>({ type: "shuffle", limit });
  }

  sort(column: number, dir: 1 | -1, reversed?: boolean, rowLimit?: RowLimit | null): Promise<SortedMessage> {
    return this.request<SortedMessage>({ type: "sort", column, dir, reversed, rowLimit });
  }

  /** Dataset row indexes of the rows at positions [start, end) in the current order. */
  getRowIds(start: number, end: number): Promise<RowIdsMessage> {
    return this.request<RowIdsMessage>({ type: "getRowIds", start, end });
  }

  /** Position of a dataset row in the current order (-1 when filtered out). */
  findRow(row: number): Promise<RowPositionMessage> {
    return this.request<RowPositionMessage>({ type: "findRow", row });
  }

  getOrder(): Promise<OrderMessage> {
    return this.request<OrderMessage>({ type: "getOrder" });
  }

  /** Checks a new column's formula and evaluates it, without changing the data. */
  previewFormula(formula: string): Promise<FormulaPreviewMessage> {
    return this.request<FormulaPreviewMessage>({ type: "previewFormula", formula });
  }

  getRows(start: number, end: number): Promise<RowsMessage> {
    return this.request<RowsMessage>({ type: "getRows", start, end });
  }

  setType(column: number, columnType: ColumnType): Promise<ColumnMetaMessage> {
    return this.request<ColumnMetaMessage>({ type: "setType", column, columnType });
  }

  setNumberLocale(column: number, locale: NumberLocale): Promise<ColumnMetaMessage> {
    return this.request<ColumnMetaMessage>({ type: "setNumberLocale", column, locale });
  }

  getStats(): Promise<StatsMessage> {
    return this.request<StatsMessage>({ type: "getStats" });
  }

  getChartBins(
    column: number,
    options: ChartBinOptions,
    chartExclude?: ChartExclusion[],
  ): Promise<ChartBinsMessage> {
    return this.request<ChartBinsMessage>({
      type: "getChartBins",
      column,
      options,
      ...(chartExclude === undefined ? {} : { chartExclude }),
    });
  }

  getGroupedBins(input: {
    column: number;
    groupColumn: number;
    options: ChartBinOptions;
    topN: number;
    chartExclude?: ChartExclusion[];
  }): Promise<GroupedBinsMessage> {
    return this.request<GroupedBinsMessage>({ type: "getGroupedBins", ...input });
  }

  getMissingness(buckets: number): Promise<MissingnessMessage> {
    return this.request<MissingnessMessage>({ type: "getMissingness", buckets });
  }

  getChartSeries(input: {
    xColumn: number;
    yColumn: number;
    colorColumn?: number;
    sizeColumn?: number;
    mode: SeriesMode;
    limit?: number;
    clip?: boolean;
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters?: boolean;
  }): Promise<ChartSeriesMessage> {
    return this.request<ChartSeriesMessage>({ type: "getChartSeries", ...input });
  }

  getSliceBreakdown(input: Omit<GetSliceBreakdownRequest, "type" | "requestId">): Promise<SliceBreakdownMessage> {
    return this.request<SliceBreakdownMessage>({ type: "getSliceBreakdown", ...input });
  }

  getBoxStats(input: {
    valueColumn: number;
    categoryColumn: number;
    topN: number;
    groupOther: boolean;
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters?: boolean;
  }): Promise<BoxStatsMessage> {
    return this.request<BoxStatsMessage>({ type: "getBoxStats", ...input });
  }

  getCrosstab(input: {
    xColumn: number;
    yColumn: number;
    topX: number;
    topY: number;
    groupOther: boolean;
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters?: boolean;
  }): Promise<CrosstabMessage> {
    return this.request<CrosstabMessage>({ type: "getCrosstab", ...input });
  }

  getCorrelation(
    columns: number[],
    scope?: {
      chartFilter?: { column: number; code: number };
      chartExclude?: ChartExclusion[];
      respectFilters?: boolean;
    },
  ): Promise<CorrelationMessage> {
    return this.request<CorrelationMessage>({ type: "getCorrelation", columns, ...scope });
  }

  getAggregate(view: ViewDef): Promise<AggregateMessage> {
    return this.request<AggregateMessage>({ type: "getAggregate", view });
  }

  getPivot(pivot: PivotDef): Promise<PivotMessage> {
    return this.request<PivotMessage>({ type: "getPivot", pivot });
  }

  getCoMissingness(): Promise<CoMissingnessMessage> {
    return this.request<CoMissingnessMessage>({ type: "getCoMissingness" });
  }

  getGroupAnomalies(): Promise<GroupAnomaliesMessage> {
    return this.request<GroupAnomaliesMessage>({ type: "getGroupAnomalies" });
  }

  getOutlierAnalysis(input: {
    method: OutlierMethod;
    columns: number[];
    contamination: number;
    mode: OutlierMode;
    trees?: number;
    sampleSize?: number;
    neighbors?: number;
    components?: number;
    seed?: number;
    respectFilters?: boolean;
  }): Promise<OutlierAnalysisMessage> {
    return this.request<OutlierAnalysisMessage>({ type: "getOutlierAnalysis", ...input });
  }

  getDependencies(respectFilters = true): Promise<DependenciesMessage> {
    return this.request<DependenciesMessage>({ type: "getDependencies", respectFilters });
  }

  countKeyDuplicates(columns: number[]): Promise<KeyDuplicateCountMessage> {
    return this.request<KeyDuplicateCountMessage>({ type: "countKeyDuplicates", columns });
  }

  checkKeyDuplicates(columns: number[]): Promise<KeyDuplicatesMessage> {
    return this.request<KeyDuplicatesMessage>({ type: "checkKeyDuplicates", columns });
  }

  evaluateRules(rules: Rule[]): Promise<RulesEvaluatedMessage> {
    return this.request<RulesEvaluatedMessage>({ type: "evaluateRules", rules });
  }

  countPair(columnA: number, columnB: number, operator: PairOperator): Promise<PairCountMessage> {
    return this.request<PairCountMessage>({ type: "countPair", columnA, columnB, operator });
  }

  checkPair(input: {
    columnA: number;
    columnB: number;
    operator: PairOperator;
    tolerance?: number;
  }): Promise<PairCheckMessage> {
    return this.request<PairCheckMessage>({ type: "checkPair", ...input });
  }

  getRelationships(respectFilters = true): Promise<RelationshipsMessage> {
    return this.request<RelationshipsMessage>({ type: "getRelationships", respectFilters });
  }

  getTimeSeries(input: {
    dateColumn: number;
    groupColumn: number;
    respectFilters?: boolean;
    config: TsConfig | null;
    mode: TsMode;
    view?: ViewDef;
  }): Promise<TimeSeriesMessage> {
    return this.request<TimeSeriesMessage>({ type: "getTimeSeries", ...input });
  }

  getColumnNetwork(respectFilters = true): Promise<ColumnNetworkMessage> {
    return this.request<ColumnNetworkMessage>({ type: "getColumnNetwork", respectFilters });
  }

  /**
   * Scans text-like columns for sensitive content in one cancellable worker pass.
   * `onColumn` fires per column as results arrive; `done` settles when the pass
   * ends (or is cancelled). Call `cancel()` when the data changes.
   */
  scanSensitive(
    options: { columns?: number[]; exact?: boolean },
    onColumn: (message: SensitiveColumnMessage) => void,
  ): { done: Promise<SensitiveDoneMessage>; cancel: () => void } {
    const requestId = this.nextId++;
    this.streams.set(requestId, (message) => onColumn(message as SensitiveColumnMessage));
    const done = new Promise<SensitiveDoneMessage>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => {
          this.streams.delete(requestId);
          resolve(value as SensitiveDoneMessage);
        },
        reject: (error) => {
          this.streams.delete(requestId);
          reject(error);
        },
      });
    });
    this.worker.postMessage({ type: "scanSensitive", requestId, ...options } as WorkerRequest);
    return {
      done,
      cancel: () => this.worker.postMessage({ type: "cancelScan", scanId: requestId } as WorkerRequest),
    };
  }

  getExceptions(
    maskColumns: number[],
    includeRaw: boolean,
    optional: number[],
    checkId: string | null,
  ): Promise<ExceptionsMessage> {
    return this.request<ExceptionsMessage>({ type: "getExceptions", maskColumns, includeRaw, optional, checkId });
  }

  getRowsAffected(): Promise<RowsAffectedMessage> {
    return this.request<RowsAffectedMessage>({ type: "getRowsAffected" });
  }

  /** The column's distinct values that best fit what was typed, best first. */
  getValueSuggestions(column: number, query: string, limit = 8): Promise<ValueSuggestionsMessage> {
    return this.request<ValueSuggestionsMessage>({ type: "getValueSuggestions", column, query, limit });
  }

  /** A spread of the column's non-empty values (up to limit). */
  getColumnSample(column: number, limit = 1000): Promise<ColumnSampleMessage> {
    return this.request<ColumnSampleMessage>({ type: "getColumnSample", column, limit });
  }

  getTextProfile(
    column: number,
    limit?: number,
    terms = true,
  ): Promise<TextProfileMessage> {
    return this.request<TextProfileMessage>({ type: "getTextProfile", column, limit, terms });
  }

  getDistributionChanges(): Promise<DistributionChangesMessage> {
    return this.request<DistributionChangesMessage>({ type: "getDistributionChanges" });
  }

  getSimilarClusters(): Promise<SimilarClustersMessage> {
    return this.request<SimilarClustersMessage>({ type: "getSimilarClusters" });
  }

  getGridCounts(
    xColumn: number,
    yColumn: number,
    bins?: number,
    measure?: { column: number; agg: "sum" | "mean" | "min" | "max" },
    groupColumn?: number,
    scope?: {
      chartFilter?: { column: number; code: number };
      chartExclude?: ChartExclusion[];
      respectFilters?: boolean;
    },
  ): Promise<GridCountsMessage> {
    return this.request<GridCountsMessage>({
      type: "getGridCounts",
      xColumn,
      yColumn,
      bins,
      measure,
      groupColumn,
      ...scope,
    });
  }

  getAnimation(input: {
    timeColumn: number;
    grain: TimeGrain;
    chart: AnimationChart;
    column: number;
    yColumn: number;
    bins?: number;
    topN?: number;
    measure?: { column: number; agg: "sum" | "mean" | "min" | "max" };
    groupColumn?: number;
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters?: boolean;
  }): Promise<AnimationMessage> {
    return this.request<AnimationMessage>({ type: "getAnimation", ...input });
  }

  renameHeaders(headers: string[]): Promise<HeadersRenamedMessage> {
    return this.request<HeadersRenamedMessage>({ type: "renameHeaders", headers });
  }

  cleanColumns(updates: CleanUpdate[]): Promise<CleanedMessage> {
    return this.request<CleanedMessage>({ type: "cleanColumns", updates });
  }

  setNullPolicy(column: number, extra: string[], keep: string[]): Promise<CleanedMessage> {
    return this.request<CleanedMessage>({ type: "setNullPolicy", column, extra, keep });
  }

  resolveNullsAll(extra: string[], keep: string[]): Promise<CleanedMessage> {
    return this.request<CleanedMessage>({ type: "resolveNullsAll", extra, keep });
  }

  transform(ops: TransformOp[]): Promise<TransformedMessage> {
    return this.request<TransformedMessage>({ type: "transform", ops });
  }

  previewTransform(ops: TransformOp[]): Promise<TransformPreviewMessage> {
    return this.request<TransformPreviewMessage>({ type: "previewTransform", ops });
  }

  previewClean(updates: CleanUpdate[]): Promise<CleanPreviewMessage> {
    return this.request<CleanPreviewMessage>({ type: "previewClean", updates });
  }

  startExport(scope: ExportScope = "filtered"): Promise<ExportStartedMessage> {
    return this.request<ExportStartedMessage>({ type: "startExport", scope });
  }

  getChartGroups(columns: number[]): Promise<ChartGroupsMessage> {
    return this.request<ChartGroupsMessage>({ type: "getChartGroups", columns });
  }

  getCsv(start: number, end: number, options?: ExportOptions): Promise<CsvChunkMessage> {
    return this.request<CsvChunkMessage>({ type: "getCsv", start, end, options });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }

  private request<T extends WorkerResponse>(
    message: WorkerRequestPayload,
    transfer?: Transferable[],
  ): Promise<T> {
    const requestId = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: WorkerResponse) => void,
        reject,
      });
      this.worker.postMessage({ ...message, requestId } as WorkerRequest, transfer ?? []);
    });
  }

  /** Streamed per-column results, keyed by the request that asked for them. */
  private streams = new Map<number, (message: WorkerResponse) => void>();

  private handle(message: WorkerResponse): void {
    if (message.type === "sensitiveColumn") {
      this.streams.get(message.requestId)?.(message);
      return;
    }
    if (message.type === "progress") {
      // Drop progress from an earlier load so a cancelled import cannot keep
      // painting the panel after the next one started.
      if (message.requestId !== undefined && message.requestId !== this.currentLoadId) return;
      this.progressHandler?.(message);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (pending === undefined) return;
    this.pending.delete(message.requestId);
    if (message.type === "loadCancelled") {
      if (this.currentLoadId === message.requestId) this.currentLoadId = null;
      pending.reject(new LoadCancelledError());
    } else if (message.type === "error") {
      if (this.currentLoadId === message.requestId) this.currentLoadId = null;
      pending.reject(new Error(message.message));
    } else {
      if (this.currentLoadId === message.requestId && message.type === "loaded") {
        this.currentLoadId = null;
      }
      pending.resolve(message);
    }
  }
}
