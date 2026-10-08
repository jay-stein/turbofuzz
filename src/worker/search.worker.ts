import { ColumnData } from "../data/column.js";
import { computeAnomalies } from "../data/anomalies.js";
import { buildDataset, datasetFromColumns, rebuildDataset } from "../data/build.js";
import { applyCleanOps } from "../data/clean-ops.js";
import type { Dataset } from "../data/dataset.js";
import { applyTransformOps, type TransformOp } from "../data/transform-ops.js";
import { binValues } from "../data/chart-bins.js";
import { categoryCodes, computeSeries } from "../data/chart-series.js";
import { computeBoxStats, computeCorrelation, computeCrossTab } from "../data/chart-stats.js";
import type { FileEncoding } from "../parse/encoding.js";
import {
  createNullPolicy,
  EMPTY_NULL_POLICY,
  isNullToken,
  type NullPolicy,
} from "../parse/null-tokens.js";
import { isParquetName, readParquetGrid } from "../parse/parquet.js";
import type { NumberLocale } from "../parse/numbers.js";
import { measureRagged, type RaggedInfo } from "../parse/parse.js";
import { filteredHistogram, filtersSignature, HistogramCache } from "../search/aggregates.js";
import { BitSet } from "../search/bitset.js";
import { buildRank, orderIds } from "../search/order.js";
import { clusterSimilar } from "../search/similar.js";
import {
  QueryEngine,
  type ColumnFilter,
  type ColumnSpecialKind,
} from "../search/query-engine.js";
import type { ColumnType } from "../types.js";
import { buildCsv } from "./csv.js";
import { ingestDataset, type IngestResult } from "./ingest.js";
import type {
  CleanColumnsRequest,
  ClearExcludedRowsRequest,
  ColumnDetail,
  ColumnMeta,
  DropRowsRequest,
  GetRowsRequest,
  GetStatsRequest,
  GetChartBinsRequest,
  GetChartSeriesRequest,
  GetBoxStatsRequest,
  GetCrosstabRequest,
  GetCorrelationRequest,
  LoadRequest,
  PreviewCleanRequest,
  PreviewTransformRequest,
  RenameHeadersRequest,
  ResolveNullsAllRequest,
  SetFilterRequest,
  SetNullPolicyRequest,
  SetNumberLocaleRequest,
  SetTypeRequest,
  SortRequest,
  SpecialKind,
  TransformRequest,
  WorkerRequest,
  WorkerResponse,
} from "./protocol.js";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

let dataset: Dataset | null = null;
let engine: QueryEngine | null = null;
const filters = new Map<number, ColumnFilter>();
let sortedIds: Uint32Array = new Uint32Array(0);
let rankColumn = -1;
let rankAsc: Uint32Array | null = null;
let sortDir: 1 | -1 = 1;
let exportIds: Uint32Array | null = null;
let duplicateRank: Uint32Array | null = null;
const specials = new Set<SpecialKind>();
// Per-column specials (empties/outliers), carried across clean rebuilds too.
const columnSpecials = new Map<number, Set<ColumnSpecialKind>>();
// Rows removed via the delete actions, by original dataset row id.
const excludedIds = new Set<number>();
let excludedBits: BitSet | null = null;
const histogramCache = new HistogramCache();
// Non-destructive clean state: the untouched source column per cleaned column.
const cleanSource = new Map<number, ColumnData>();
// Per-column null overrides, persisted so value cleans and reverts re-apply them.
const nullPolicies = new Map<number, NullPolicy>();
// Explicit number-locale overrides, re-applied whenever a column is rebuilt.
const numberLocales = new Map<number, NumberLocale>();
// Explicit type overrides, so rebuilds keep the user's chosen interpretation.
const typeOverrides = new Map<number, ColumnType>();
// Non-destructive transform state: the base dataset captured before the first
// transform plus the ordered op list, re-derived from that base on every change.
let transformSource: Dataset | null = null;
let transformOps: TransformOp[] = [];
let datasetSource: "paste" | "file" = "paste";
let datasetEncoding: FileEncoding | null = null;
let datasetRagged: RaggedInfo = { paddedRows: 0, extraCellRows: 0, extraCells: 0 };

const FIRST_PAGE_ROWS = 40;

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer !== undefined && transfer.length > 0) scope.postMessage(message, transfer);
  else scope.postMessage(message);
}

scope.onmessage = (event) => {
  void dispatch(event.data);
};

async function dispatch(message: WorkerRequest): Promise<void> {
  try {
    await handle(message);
  } catch (error) {
    post({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handle(message: WorkerRequest): Promise<void> {
  switch (message.type) {
    case "load":
      await handleLoad(message);
      break;
    case "setFilter":
      handleSetFilter(message);
      break;
    case "clearFilters":
      handleClearFilters(message);
      break;
    case "setSpecial":
      handleSetSpecial(message);
      break;
    case "dropRows":
      handleDropRows(message);
      break;
    case "clearExcludedRows":
      handleClearExcludedRows(message);
      break;
    case "shuffle":
      handleShuffle(message);
      break;
    case "sort":
      handleSort(message);
      break;
    case "getRows":
      handleGetRows(message);
      break;
    case "setType":
      handleSetType(message);
      break;
    case "setNumberLocale":
      handleSetNumberLocale(message);
      break;
    case "getStats":
      handleGetStats(message);
      break;
    case "getChartBins":
      handleGetChartBins(message);
      break;
    case "getChartSeries":
      handleGetChartSeries(message);
      break;
    case "getBoxStats":
      handleGetBoxStats(message);
      break;
    case "getCrosstab":
      handleGetCrosstab(message);
      break;
    case "getCorrelation":
      handleGetCorrelation(message);
      break;
    case "renameHeaders":
      handleRenameHeaders(message);
      break;
    case "cleanColumns":
      handleCleanColumns(message);
      break;
    case "setNullPolicy":
      handleSetNullPolicy(message);
      break;
    case "resolveNullsAll":
      handleResolveNullsAll(message);
      break;
    case "transform":
      handleTransform(message);
      break;
    case "previewTransform":
      handlePreviewTransform(message);
      break;
    case "previewClean":
      handlePreviewClean(message);
      break;
    case "startExport":
      if (message.scope === "all") {
        const { dataset: current } = state();
        const all = new BitSet(current.rowCount);
        all.setAll();
        exportIds = withoutExcluded(all).toIndices();
      } else {
        exportIds = sortedIds.slice();
      }
      post({ type: "exportStarted", requestId: message.requestId, total: exportIds.length });
      break;
    case "getCsv": {
      const { dataset } = state();
      const ids = exportIds ?? sortedIds;
      const start = Math.max(0, message.start);
      const end = Math.min(message.end, ids.length);
      post({
        type: "csv",
        requestId: message.requestId,
        start,
        text: buildCsv(dataset, ids, start, end, start === 0, message.options),
      });
      break;
    }
  }
}

function state(): { dataset: Dataset; engine: QueryEngine } {
  if (dataset === null || engine === null) throw new Error("No dataset loaded");
  return { dataset, engine };
}

/** Re-applies active specials (global and per-column) onto a rebuilt engine. */
function applySpecials(target: QueryEngine): void {
  for (const kind of specials) target.setSpecial(kind, true);
  for (const [column, kinds] of columnSpecials) {
    for (const kind of kinds) target.setColumnSpecial(column, kind, true);
  }
}

/**
 * Duplicates view: when the duplicates toggle is on and no explicit sort is
 * active, rows are ordered by content hash so identical rows sit together.
 */
function computeSortedIds(bits: BitSet): Uint32Array {
  const usable = withoutExcluded(bits);
  if (specials.has("duplicates") && rankAsc === null) return orderByDuplicates(usable);
  return orderIds(usable, rankAsc, sortDir);
}

function orderByDuplicates(bits: BitSet): Uint32Array {
  const { dataset } = state();
  if (duplicateRank === null) {
    const rank = new Uint32Array(dataset.rowCount);
    for (let i = 0; i < rank.length; i++) rank[i] = i;
    const hashes = dataset.rowHashes;
    rank.sort((a, b) => {
      const ha = hashes[a];
      const hb = hashes[b];
      return ha === hb ? a - b : ha - hb;
    });
    duplicateRank = rank;
  }

  const out = new Uint32Array(bits.count());
  let k = 0;
  for (let i = 0; i < duplicateRank.length; i++) {
    const row = duplicateRank[i];
    if (bits.get(row)) out[k++] = row;
  }
  return out;
}

/** True where a row starts a new duplicate group (for separators). */
function groupFlags(start: number, end: number): boolean[] | undefined {
  if (!specials.has("duplicates") || rankAsc !== null || dataset === null) return undefined;
  const boundedEnd = Math.min(end, sortedIds.length);
  const flags: boolean[] = new Array(Math.max(0, boundedEnd - start));
  const hashes = dataset.rowHashes;
  for (let i = start; i < boundedEnd; i++) {
    flags[i - start] =
      i === 0 || hashes[sortedIds[i]] !== hashes[sortedIds[i - 1]];
  }
  return flags;
}

/** Bit 0 marks a row that belongs to a duplicate group. */
function rowFlagsSlice(start: number, end: number): Uint8Array {
  if (dataset === null) return new Uint8Array(0);
  const boundedEnd = Math.min(end, sortedIds.length);
  const flags = new Uint8Array(Math.max(0, boundedEnd - start));
  for (let i = start; i < boundedEnd; i++) {
    flags[i - start] = dataset.duplicateBits.get(sortedIds[i]) ? 1 : 0;
  }
  return flags;
}

/** xorshift32 Fisher–Yates over the current result ids; ~10ms at millions. */
function shuffleInPlace(ids: Uint32Array): void {
  let state = (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000)) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  for (let i = ids.length - 1; i > 0; i--) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    const swap = ids[i];
    ids[i] = ids[j];
    ids[j] = swap;
  }
}

function handleShuffle(message: { requestId: number; limit?: number }): void {
  const { engine } = state();
  rankColumn = -1;
  rankAsc = null;
  sortDir = 1;
  duplicateRank = null;
  // Recompute from the filters so repeated shuffles always sample the full
  // current result set (a previous sample must not shrink the pool).
  sortedIds = computeSortedIds(engine.evaluateBits(filters));
  shuffleInPlace(sortedIds);

  const limit = message.limit;
  if (
    limit !== undefined &&
    Number.isFinite(limit) &&
    limit > 0 &&
    limit < sortedIds.length
  ) {
    sortedIds = sortedIds.slice(0, Math.floor(limit));
  }

  post({
    type: "shuffled",
    requestId: message.requestId,
    count: sortedIds.length,
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

async function handleLoad(message: LoadRequest): Promise<void> {
  const started = performance.now();

  // Parquet is decoded lazily inside the worker; every other format goes through
  // the shared text/table ingest path, which stays synchronous.
  let ingested: IngestResult;
  if (message.buffer !== undefined && isParquetName(message.name)) {
    post({ type: "progress", phase: "parse", detail: "Reading parquet…" });
    const grid = await readParquetGrid(message.buffer);
    const dataset = buildDataset(message.name, grid.headers, grid.rows, (detail) =>
      post({ type: "progress", phase: "build", detail }),
    );
    ingested = {
      dataset,
      encoding: null,
      ragged: measureRagged(grid.rows, grid.headers.length),
    };
  } else {
    ingested = ingestDataset({
      name: message.name,
      delimiter: message.delimiter,
      hasHeaders: message.hasHeaders,
      text: message.text,
      buffer: message.buffer,
      table: message.table,
      onProgress: (progress) =>
        post({ type: "progress", phase: progress.phase, detail: progress.detail }),
    });
  }

  const { dataset: next, encoding, ragged } = ingested;
  dataset = next;
  engine = new QueryEngine(next);
  filters.clear();
  rankColumn = -1;
  rankAsc = null;
  sortDir = 1;
  exportIds = null;
  duplicateRank = null;
  specials.clear();
  columnSpecials.clear();
  clearExclusions();
  histogramCache.clear();
  cleanSource.clear();
  nullPolicies.clear();
  numberLocales.clear();
  typeOverrides.clear();
  transformSource = null;
  transformOps = [];
  datasetSource = message.buffer !== undefined ? "file" : "paste";
  datasetEncoding = encoding;
  datasetRagged = ragged;
  sortedIds = engine.evaluate(filters);

  post({
    type: "loaded",
    requestId: message.requestId,
    name: next.name,
    headers: next.columns.map((column) => column.name),
    rowCount: next.rowCount,
    columnCount: next.columnCount,
    columns: next.columns.map((column, index) => metaFor(next, column, index)),
    stats: next.stats,
    ingestMs: performance.now() - started,
    source: datasetSource,
    encoding: datasetEncoding,
    ragged: datasetRagged,
  });
}

function handleSetFilter(message: SetFilterRequest): void {
  const { dataset, engine } = state();

  if (message.filter !== null && message.filter.kind === "text" && message.filter.mode === "fuzzy") {
    const column = dataset.columns[message.column];
    if (!column.fuzzyBuilt) {
      post({ type: "progress", phase: "index", column: message.column, active: true });
      column.fuzzyIndex();
      post({ type: "progress", phase: "index", column: message.column, active: false });
    }
  }

  if (message.filter === null) filters.delete(message.column);
  else filters.set(message.column, message.filter);

  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  const queryMs = performance.now() - started;
  const preview = message.preview === true;
  post({
    type: "results",
    requestId: message.requestId,
    count: sortedIds.length,
    queryMs,
    facets: preview ? {} : computeFacets(dataset, engine, bits),
    histograms: preview ? {} : computeHistograms(dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

function handleClearFilters(message: { requestId: number }): void {
  const { dataset, engine } = state();
  filters.clear();
  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  const queryMs = performance.now() - started;
  post({
    type: "results",
    requestId: message.requestId,
    count: sortedIds.length,
    queryMs,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

function handleSetSpecial(message: {
  requestId: number;
  kind: SpecialKind;
  active: boolean;
  column?: number;
}): void {
  const { dataset, engine } = state();
  if (message.column !== undefined && message.kind !== "duplicates") {
    const kind = message.kind as ColumnSpecialKind;
    engine.setColumnSpecial(message.column, kind, message.active);
    let kinds = columnSpecials.get(message.column);
    if (message.active) {
      if (kinds === undefined) {
        kinds = new Set();
        columnSpecials.set(message.column, kinds);
      }
      kinds.add(kind);
    } else if (kinds !== undefined) {
      kinds.delete(kind);
      if (kinds.size === 0) columnSpecials.delete(message.column);
    }
  } else {
    engine.setSpecial(message.kind, message.active);
    if (message.active) specials.add(message.kind);
    else specials.delete(message.kind);
  }

  // Grouping takes over the ordering; drop any column sort so identical rows
  // are actually adjacent.
  if (message.kind === "duplicates" && message.active) {
    rankColumn = -1;
    rankAsc = null;
    sortDir = 1;
  }

  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "results",
    requestId: message.requestId,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

function handleSort(message: SortRequest): void {
  const { dataset, engine } = state();

  if (message.column < 0) {
    rankColumn = -1;
    rankAsc = null;
    sortDir = 1;
  } else {
    if (message.column !== rankColumn) {
      post({ type: "progress", phase: "sort", column: message.column, active: true });
      rankAsc = buildRank(dataset, message.column);
      rankColumn = message.column;
      post({ type: "progress", phase: "sort", column: message.column, active: false });
    }
    sortDir = message.dir;
  }

  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "sorted",
    requestId: message.requestId,
    count: sortedIds.length,
    column: rankColumn,
    dir: sortDir,
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

function rowsSlice(start: number, end: number): string[][] {
  if (dataset === null) return [];
  const boundedStart = Math.max(0, start);
  const boundedEnd = Math.min(end, sortedIds.length);
  const columns = dataset.columns;
  const rows: string[][] = [];
  for (let i = boundedStart; i < boundedEnd; i++) {
    const rowIndex = sortedIds[i];
    const row = new Array<string>(columns.length);
    for (let c = 0; c < columns.length; c++) row[c] = columns[c].raw[rowIndex];
    rows.push(row);
  }
  return rows;
}

function handleGetRows(message: GetRowsRequest): void {
  const start = Math.max(0, message.start);
  post({
    type: "rows",
    requestId: message.requestId,
    start,
    rows: rowsSlice(start, message.end),
    groups: groupFlags(start, message.end),
    flags: rowFlagsSlice(start, message.end),
  });
}

function handleSetType(message: SetTypeRequest): void {
  const { dataset, engine } = state();
  const column = dataset.columns[message.column];
  column.setType(message.columnType, true);
  typeOverrides.set(message.column, message.columnType);
  dataset.applyAnomalies(computeAnomalies(dataset.columns, dataset.rowCount));
  filters.delete(message.column);
  engine.invalidate();
  histogramCache.delete(message.column);

  if (rankColumn === message.column) {
    rankColumn = -1;
    rankAsc = null;
    sortDir = 1;
  }

  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "columnMeta",
    requestId: message.requestId,
    column: message.column,
    meta: metaFor(dataset, column, message.column),
    stats: dataset.stats,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

/**
 * Switches a column's decimal-mark convention. Numeric values, stats,
 * histograms and anomalies all change, so the column's own range filter is
 * cleared and the engine is invalidated, mirroring the type-change path.
 */
function handleSetNumberLocale(message: SetNumberLocaleRequest): void {
  const { dataset, engine } = state();
  const column = dataset.columns[message.column];
  column.setNumberLocale(message.locale);
  numberLocales.set(message.column, message.locale);
  dataset.applyAnomalies(computeAnomalies(dataset.columns, dataset.rowCount));
  filters.delete(message.column);
  engine.invalidate();
  histogramCache.delete(message.column);

  if (rankColumn === message.column) {
    rankColumn = -1;
    rankAsc = null;
    sortDir = 1;
  }

  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "columnMeta",
    requestId: message.requestId,
    column: message.column,
    meta: metaFor(dataset, column, message.column),
    stats: dataset.stats,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

/**
 * Per-value counts for category columns under the current filters, excluding
 * each column's own filter so unchecking always remains meaningful.
 */
function computeFacets(
  dataset: Dataset,
  engine: QueryEngine,
  resultBits: BitSet,
): Record<number, number[]> {
  const facets: Record<number, number[]> = {};
  for (let columnIndex = 0; columnIndex < dataset.columnCount; columnIndex++) {
    const column = dataset.columns[columnIndex];
    if (column.type !== "category" && column.type !== "boolean") continue;
    const categories = column.categories();
    let base = filters.has(columnIndex)
      ? engine.evaluateBits(filters, columnIndex)
      : resultBits;
    const excluded = excludedRowBits();
    if (excluded !== null) {
      base = base.clone();
      base.andNot(excluded);
    }
    const counts = new Array<number>(categories.bits.length);
    for (let value = 0; value < categories.bits.length; value++) {
      counts[value] = base.andCount(categories.bits[value]);
    }
    facets[columnIndex] = counts;
  }
  return facets;
}

function handleGetStats(message: GetStatsRequest): void {
  const { dataset } = state();
  post({
    type: "stats",
    requestId: message.requestId,
    rowCount: dataset.rowCount,
    columnCount: dataset.columnCount,
    stats: dataset.stats,
    columns: dataset.columns.map(detailsFor),
  });
}

/** Custom chart bins over the current result order (chart tab settings). */
function handleGetChartBins(message: GetChartBinsRequest): void {
  const { dataset } = state();
  const column = dataset.columns[message.column];
  if (column === undefined) throw new Error("Unknown column");
  const bins = binValues(column.numbers(), sortedIds, message.options);
  const numeric = column.type === "integer" || column.type === "number" || column.type === "date";
  post({
    type: "chartBins",
    requestId: message.requestId,
    column: message.column,
    median: numeric ? column.medianSampled() : null,
    ...bins,
  });
}

/**
 * Scatter sample (<= limit points) or exact density grid for two numeric
 * columns over the current result order, with optional colour and size
 * encodings. Numeric arrays are computed fresh inside `computeSeries`, so the
 * column caches are never transferred (which would detach them).
 */
function handleGetChartSeries(message: GetChartSeriesRequest): void {
  const { dataset } = state();
  const xColumn = dataset.columns[message.xColumn];
  const yColumn = dataset.columns[message.yColumn];
  if (xColumn === undefined || yColumn === undefined) throw new Error("Unknown column");

  let colorValues: Float64Array | null = null;
  let colorCodes: Uint16Array | null = null;
  let colorLabels: string[] | null = null;
  const colorIndex = message.colorColumn ?? -1;
  if (colorIndex >= 0 && colorIndex < dataset.columnCount) {
    const column = dataset.columns[colorIndex];
    if (column.type === "category" || column.type === "boolean") {
      const categories = column.categories();
      colorCodes = categoryCodes(categories.bits, dataset.rowCount);
      colorLabels = categories.labels;
    } else {
      colorValues = column.numbers();
    }
  }

  let size: Float64Array | null = null;
  const sizeIndex = message.sizeColumn ?? -1;
  if (sizeIndex >= 0 && sizeIndex < dataset.columnCount) {
    size = dataset.columns[sizeIndex].numbers();
  }

  const started = performance.now();
  const xNumbers = xColumn.numbers();
  const yNumbers = yColumn.numbers();
  const result = computeSeries(
    xNumbers,
    yNumbers,
    sortedIds,
    colorValues,
    colorCodes,
    size,
    {
      mode: message.mode,
      limit: message.limit ?? 20_000,
      gridCols: 128,
      gridRows: 72,
    },
  );
  const correlation = computeCorrelation([xNumbers, yNumbers], sortedIds).values[1] ?? Number.NaN;

  const transfer: Transferable[] = [];
  if (result.mode === "density") {
    transfer.push(result.counts.buffer);
  } else {
    transfer.push(result.x.buffer, result.y.buffer);
    if (result.colorValues !== null) transfer.push(result.colorValues.buffer);
    if (result.colorCodes !== null) transfer.push(result.colorCodes.buffer);
    if (result.size !== null) transfer.push(result.size.buffer);
  }

  post(
    {
      type: "chartSeries",
      requestId: message.requestId,
      xColumn: message.xColumn,
      yColumn: message.yColumn,
      colorColumn: colorIndex,
      sizeColumn: sizeIndex,
      colorLabels,
      ms: performance.now() - started,
      correlation,
      result,
    },
    transfer,
  );
}

/** Tukey box summaries per category of a numeric column (filtered rows). */
function handleGetBoxStats(message: GetBoxStatsRequest): void {
  const { dataset } = state();
  const valueColumn = dataset.columns[message.valueColumn];
  const categoryColumn = dataset.columns[message.categoryColumn];
  if (valueColumn === undefined || categoryColumn === undefined) throw new Error("Unknown column");
  const categories = categoryColumn.categories();
  const codes = categoryCodes(categories.bits, dataset.rowCount);
  const started = performance.now();
  const result = computeBoxStats(valueColumn.numbers(), codes, categories.labels, sortedIds, {
    topN: message.topN,
    groupOther: message.groupOther,
  });
  const transfer: Transferable[] = [];
  for (const group of result.groups) transfer.push(group.outliers.buffer);
  post(
    {
      type: "boxStats",
      requestId: message.requestId,
      valueColumn: message.valueColumn,
      categoryColumn: message.categoryColumn,
      ms: performance.now() - started,
      result,
    },
    transfer,
  );
}

/** Category × category counts for the heatmap card (filtered rows). */
function handleGetCrosstab(message: GetCrosstabRequest): void {
  const { dataset } = state();
  const xColumn = dataset.columns[message.xColumn];
  const yColumn = dataset.columns[message.yColumn];
  if (xColumn === undefined || yColumn === undefined) throw new Error("Unknown column");
  const xCategories = xColumn.categories();
  const yCategories = yColumn.categories();
  const started = performance.now();
  const result = computeCrossTab(
    categoryCodes(xCategories.bits, dataset.rowCount),
    categoryCodes(yCategories.bits, dataset.rowCount),
    xCategories.labels,
    yCategories.labels,
    sortedIds,
    { topX: message.topX, topY: message.topY, groupOther: message.groupOther },
  );
  post(
    {
      type: "crosstab",
      requestId: message.requestId,
      xColumn: message.xColumn,
      yColumn: message.yColumn,
      ms: performance.now() - started,
      result,
    },
    [result.counts.buffer],
  );
}

/** Pearson correlation matrix for up to 12 numeric columns (filtered rows). */
function handleGetCorrelation(message: GetCorrelationRequest): void {
  const { dataset } = state();
  const seen = new Set<number>();
  const indexes: number[] = [];
  for (const index of message.columns) {
    if (index < 0 || index >= dataset.columnCount || seen.has(index)) continue;
    seen.add(index);
    indexes.push(index);
    if (indexes.length >= 12) break;
  }
  const started = performance.now();
  const result = computeCorrelation(
    indexes.map((index) => dataset.columns[index].numbers()),
    sortedIds,
  );
  post(
    {
      type: "correlation",
      requestId: message.requestId,
      columns: indexes,
      labels: indexes.map((index) => dataset.columns[index].name),
      ms: performance.now() - started,
      result,
    },
    [result.values.buffer, result.counts.buffer],
  );
}

/**
 * Header-only rename: updates column names without touching raw data, indexes
 * or the query engine. Names do not participate in any bitset, so no
 * invalidation is required — export and every downstream message read
 * `column.name`, so this single mutation stays the source of truth.
 */
function handleRenameHeaders(message: RenameHeadersRequest): void {
  const { dataset } = state();
  const columns = dataset.columns;
  const count = Math.min(message.headers.length, columns.length);
  for (let i = 0; i < count; i++) {
    const next = message.headers[i].trim();
    if (next !== "") columns[i].name = next;
  }
  post({
    type: "headersRenamed",
    requestId: message.requestId,
    headers: columns.map((column) => column.name),
  });
}

/**
 * Applies (or reverts) non-destructive value cleans for one or more columns in
 * a single rebuild. An empty op list restores that column's untouched source
 * object; affected columns are recreated from the op list, then the shared
 * dataset stats/bitsets are recomputed once. This generalises the setType
 * invalidation pattern to N columns while keeping unaffected columns (and their
 * lazy caches) alive.
 */
function handleCleanColumns(message: CleanColumnsRequest): void {
  const { dataset: current } = state();
  // Cleaning after a transform bakes the transforms in: the current (already
  // transformed) column set becomes the new clean source.
  transformSource = null;
  transformOps = [];
  const columns = current.columns.slice();
  const affected: number[] = [];

  for (const update of message.updates) {
    const column = update.column;
    if (column < 0 || column >= columns.length) continue;

    let source = cleanSource.get(column);
    if (source === undefined) {
      source = current.columns[column];
      cleanSource.set(column, source);
    }

    const policy = nullPolicies.get(column) ?? EMPTY_NULL_POLICY;
    const raw = update.ops.length === 0 ? source.raw : applyCleanOps(source.raw, update.ops);
    const rebuilt = ColumnData.create(current.columns[column].name, raw, policy);
    const typeOverride = typeOverrides.get(column);
    if (typeOverride !== undefined) rebuilt.setType(typeOverride, true);
    const locale = numberLocales.get(column);
    if (locale !== undefined) rebuilt.setNumberLocale(locale);
    columns[column] = rebuilt;

    filters.delete(column);
    affected.push(column);
  }

  const next = rebuildDataset(current, columns);
  const newEngine = new QueryEngine(next);
  // Special toggles live on the engine, so carry them across the rebuild.
  applySpecials(newEngine);
  dataset = next;
  engine = newEngine;

  rankColumn = -1;
  rankAsc = null;
  sortDir = 1;
  duplicateRank = null;
  exportIds = null;
  histogramCache.clear();

  const started = performance.now();
  const bits = newEngine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "cleaned",
    requestId: message.requestId,
    columns: affected.map((column) => ({
      column,
      meta: metaFor(next, next.columns[column], column),
    })),
    stats: next.stats,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(next, newEngine, bits),
    histograms: computeHistograms(next, newEngine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

/**
 * Rebuilds a column under a null policy: every distinct value that the
 * heuristic calls null (and every custom token) is replaced with an empty cell,
 * except values the user un-nulled. Kept values stay as real text.
 */
function blankAndRebuild(column: ColumnData, policy: NullPolicy): ColumnData {
  const blank = new Set<string>(policy.extra);
  const seen = new Set<string>();
  for (const value of column.raw) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (!policy.keep.has(value) && isNullToken(value)) blank.add(value);
  }
  const raw =
    blank.size === 0
      ? column.raw.slice()
      : column.raw.map((value) => (blank.has(value) ? "" : value));
  const rebuilt = ColumnData.create(column.name, raw, policy);
  return rebuilt;
}

/**
 * Per-column null resolution: tokens the user left ticked (and any custom
 * tokens) are replaced with an empty cell, so nulls become proper blanks rather
 * than sentinel text; tokens the user un-nulled stay as real values. Shape is
 * unchanged, so this mirrors the clean path (carry specials, invalidate caches,
 * clear that column's filter). Re-applying re-derives from the current raw, so
 * un-nulling and re-nulling stay consistent.
 */
function handleSetNullPolicy(message: SetNullPolicyRequest): void {
  const { dataset: current } = state();
  const column = current.columns[message.column];
  if (column === undefined) throw new Error(`Unknown column ${message.column + 1}`);

  const policy = createNullPolicy(message.extra, message.keep);
  nullPolicies.set(message.column, policy);

  const columns = current.columns.slice();
  const rebuilt = blankAndRebuild(column, policy);
  const typeOverride = typeOverrides.get(message.column);
  if (typeOverride !== undefined) rebuilt.setType(typeOverride, true);
  const locale = numberLocales.get(message.column);
  if (locale !== undefined) rebuilt.setNumberLocale(locale);
  columns[message.column] = rebuilt;

  const next = rebuildDataset(current, columns);
  const newEngine = new QueryEngine(next);
  applySpecials(newEngine);
  dataset = next;
  engine = newEngine;

  filters.delete(message.column);
  rankColumn = -1;
  rankAsc = null;
  sortDir = 1;
  duplicateRank = null;
  exportIds = null;
  histogramCache.clear();

  const started = performance.now();
  const bits = newEngine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "cleaned",
    requestId: message.requestId,
    columns: [{ column: message.column, meta: metaFor(next, rebuilt, message.column) }],
    stats: next.stats,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(next, newEngine, bits),
    histograms: computeHistograms(next, newEngine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

/**
 * Batch null resolution across every column: blanks the ticked tokens and
 * applies the same keep/extra policy everywhere in a single rebuild. Filters are
 * cleared because every column's values may have changed.
 */
function handleResolveNullsAll(message: ResolveNullsAllRequest): void {
  const { dataset: current } = state();
  const policy = createNullPolicy(message.extra, message.keep);
  const columns = current.columns.map((column, index) => {
    const next = blankAndRebuild(column, policy);
    const typeOverride = typeOverrides.get(index);
    if (typeOverride !== undefined) next.setType(typeOverride, true);
    const locale = numberLocales.get(index);
    if (locale !== undefined) next.setNumberLocale(locale);
    return next;
  });

  nullPolicies.clear();
  for (let i = 0; i < columns.length; i++) nullPolicies.set(i, policy);

  const next = rebuildDataset(current, columns);
  const newEngine = new QueryEngine(next);
  applySpecials(newEngine);
  dataset = next;
  engine = newEngine;

  filters.clear();
  rankColumn = -1;
  rankAsc = null;
  sortDir = 1;
  duplicateRank = null;
  exportIds = null;
  histogramCache.clear();

  const started = performance.now();
  const bits = newEngine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "cleaned",
    requestId: message.requestId,
    columns: columns.map((column, index) => ({
      column: index,
      meta: metaFor(next, column, index),
    })),
    stats: next.stats,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(next, newEngine, bits),
    histograms: computeHistograms(next, newEngine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

/** Bitmask of deleted rows for the current dataset, built on demand. */
function excludedRowBits(): BitSet | null {
  if (excludedIds.size === 0) return null;
  if (excludedBits === null) {
    const { dataset: current } = state();
    excludedBits = new BitSet(current.rowCount);
    for (const id of excludedIds) excludedBits.set(id);
  }
  return excludedBits;
}

function clearExclusions(): void {
  excludedIds.clear();
  excludedBits = null;
}

/** Result bits with deleted rows removed; never mutates the input. */
function withoutExcluded(bits: BitSet): BitSet {
  const excluded = excludedRowBits();
  if (excluded === null) return bits;
  const out = bits.clone();
  out.andNot(excluded);
  return out;
}

/** A copy of the dataset with deleted rows physically removed. */
function datasetWithoutExcluded(current: Dataset): Dataset {
  const keep: number[] = [];
  for (let row = 0; row < current.rowCount; row++) {
    if (!excludedIds.has(row)) keep.push(row);
  }
  const columns = current.columns.map((column) => {
    const raw = keep.map((row) => column.raw[row]);
    return ColumnData.create(column.name, raw, column.nullPolicy);
  });
  return datasetFromColumns(current.name, columns);
}

/** Deleted rows become permanent when a transform pipeline is first applied. */
function materializeExcluded(current: Dataset): Dataset {
  if (excludedIds.size === 0) return current;
  const next = datasetWithoutExcluded(current);
  clearExclusions();
  return next;
}

function handleDropRows(message: DropRowsRequest): void {
  const { dataset, engine } = state();
  for (const position of message.positions) {
    if (position >= 0 && position < sortedIds.length) excludedIds.add(sortedIds[position]);
  }
  excludedBits = null;

  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "results",
    requestId: message.requestId,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

function handleClearExcludedRows(message: ClearExcludedRowsRequest): void {
  const { dataset, engine } = state();
  clearExclusions();

  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "results",
    requestId: message.requestId,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

/**
 * Applies an ordered transform pipeline to the captured base dataset. The op
 * list is always re-derived from the base, so removing steps is exact and
 * shape-changing transforms rebuild the whole dataset. Starting or changing a
 * transform bakes in any pending cleans and deleted rows.
 */
function handleTransform(message: TransformRequest): void {
  const { dataset: current } = state();
  cleanSource.clear();
  numberLocales.clear();
  typeOverrides.clear();

  let next: Dataset;
  let baseColumns: readonly ColumnData[];
  if (message.ops.length === 0) {
    if (transformSource === null) {
      next = current;
    } else {
      next = transformSource;
      transformSource = null;
      clearExclusions();
    }
    transformOps = [];
    baseColumns = next.columns;
  } else {
    if (transformSource === null) {
      // First transform: deleted rows become permanent before the pipeline runs.
      transformSource = materializeExcluded(current);
    } else {
      clearExclusions();
    }
    baseColumns = transformSource.columns;
    next = applyTransformOps(transformSource.name, transformSource.columns, message.ops);
    transformOps = message.ops;
  }

  const baseSchema = baseColumns.map((column) => ({
    name: column.name,
    numeric: column.type === "integer" || column.type === "number",
  }));

  dataset = next;
  engine = new QueryEngine(next);
  filters.clear();
  rankColumn = -1;
  rankAsc = null;
  sortDir = 1;
  duplicateRank = null;
  exportIds = null;
  specials.clear();
  columnSpecials.clear();
  histogramCache.clear();

  const started = performance.now();
  sortedIds = engine.evaluate(filters);
  post({
    type: "transformed",
    requestId: message.requestId,
    name: next.name,
    headers: next.columns.map((column) => column.name),
    rowCount: next.rowCount,
    columnCount: next.columnCount,
    columns: next.columns.map((column, index) => metaFor(next, column, index)),
    stats: next.stats,
    ingestMs: performance.now() - started,
    source: datasetSource,
    encoding: datasetEncoding,
    ragged: datasetRagged,
    ops: transformOps,
    baseSchema,
  });
}

/**
 * Runs the staged transform pipeline against the base columns without
 * committing, so the panel can show before/after row and null counts.
 */
function handlePreviewTransform(message: PreviewTransformRequest): void {
  const { dataset: current } = state();
  const base =
    transformSource ?? (excludedIds.size > 0 ? datasetWithoutExcluded(current) : current);
  const next = message.ops.length === 0 ? base : applyTransformOps(base.name, base.columns, message.ops);
  post({
    type: "transformPreview",
    requestId: message.requestId,
    baseRowCount: base.rowCount,
    rowCount: next.rowCount,
    baseNullCells: base.stats.totalNullCells,
    nullCells: next.stats.totalNullCells,
    columnCount: next.columnCount,
    columnNames: next.columns.map((column) => column.name),
  });
}

/**
 * Counts how many cells an op list would change versus the untouched source,
 * so the clean panel can show an exact impact instead of sample rows.
 */
function handlePreviewClean(message: PreviewCleanRequest): void {
  const { dataset: current } = state();
  const columns = message.updates.map((update) => {
    const index = update.column;
    const column = current.columns[index];
    if (column === undefined) return { column: index, changed: 0, total: 0 };
    const source = cleanSource.get(index) ?? column;
    const raw = update.ops.length === 0 ? source.raw : applyCleanOps(source.raw, update.ops);
    let changed = 0;
    for (let i = 0; i < raw.length; i++) if (raw[i] !== source.raw[i]) changed++;
    return { column: index, changed, total: raw.length };
  });
  post({ type: "cleanPreview", requestId: message.requestId, columns });
}

function metaFor(dataset: Dataset, column: ColumnData, index: number): ColumnMeta {
  if (column.type === "integer" || column.type === "number" || column.type === "date") {
    column.numbers();
  }
  let categories: ColumnMeta["categories"] = null;
  let similarGroups = 0;
  if (column.type === "category" || column.type === "boolean") {
    const built = column.categories();
    categories = { labels: built.labels, counts: built.counts };
    if (column.type === "category") {
      similarGroups = clusterSimilar(
        built.labels.map((label, i) => ({ value: label, count: built.counts[i] })),
      ).length;
    }
  }
  return {
    name: column.name,
    type: column.type,
    numberLocale: column.numberLocale,
    dateOrder: column.dateOrder,
    stats: column.stats,
    anomalyCounts: {
      values: dataset.valueColumnBits[index]?.count() ?? 0,
      lengths: dataset.lengthColumnBits[index]?.count() ?? 0,
    },
    similarGroups,
    categories,
    histogram: column.histogram(),
    valueFence: dataset.valueFences[index] ?? null,
    lengthFence: dataset.lengthFences[index] ?? null,
    nullPolicy: { extra: [...column.nullPolicy.extra], keep: [...column.nullPolicy.keep] },
    nullTokens: [...column.nullTokens],
    suggestions: column.suggestions,
  };
}

/**
 * Filtered histograms for range-filtered columns. The distribution excludes
 * the column's own filter, so dragging that column's range reuses the cached
 * histogram (its "other filters" signature did not change).
 */
function computeHistograms(dataset: Dataset, engine: QueryEngine): Record<number, number[]> {
  const histograms: Record<number, number[]> = {};
  for (const [columnIndex, filter] of filters) {
    if (filter.kind !== "range") continue;

    const signature = filtersSignature(filters, columnIndex);
    const cached = histogramCache.get(columnIndex, signature);
    if (cached !== null) {
      histograms[columnIndex] = cached;
      continue;
    }

    const baseBits = withoutExcluded(engine.evaluateBits(filters, columnIndex));
    const bins = filteredHistogram(dataset.columns[columnIndex], baseBits, dataset.rowCount);
    if (bins === null) continue;
    histogramCache.set(columnIndex, signature, bins);
    histograms[columnIndex] = bins;
  }
  return histograms;
}

function detailsFor(column: ColumnData): ColumnDetail {
  const numeric =
    column.type === "integer" || column.type === "number" || column.type === "date";
  let median: number | null = null;
  if (numeric) {
    column.numbers();
    median = column.medianSampled();
  }

  let topValues: ColumnDetail["topValues"] = null;
  if (column.type === "category" || column.type === "boolean") {
    const built = column.categories();
    topValues = built.labels
      .map((label, index) => ({ label, count: built.counts[index] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  } else if (column.stats.topValues.length > 0) {
    topValues = column.stats.topValues;
  }

  return {
    name: column.name,
    type: column.type,
    distinct: column.stats.distinct,
    nulls: column.stats.nulls,
    min: column.stats.min,
    max: column.stats.max,
    mean: column.stats.mean,
    stddev: column.stats.stddev,
    minLength: column.stats.minLength,
    maxLength: column.stats.maxLength,
    avgLength: column.stats.avgLength,
    median,
    topValues,
  };
}
