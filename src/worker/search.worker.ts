import type { ColumnData } from "../data/column.js";
import { computeAnomalies } from "../data/anomalies.js";
import type { Dataset } from "../data/dataset.js";
import { filteredHistogram, filtersSignature, HistogramCache } from "../search/aggregates.js";
import type { BitSet } from "../search/bitset.js";
import { buildRank, orderIds } from "../search/order.js";
import { QueryEngine, type ColumnFilter } from "../search/query-engine.js";
import { buildCsv } from "./csv.js";
import { ingestDataset } from "./ingest.js";
import type {
  ColumnDetail,
  ColumnMeta,
  GetRowsRequest,
  GetStatsRequest,
  LoadRequest,
  SetFilterRequest,
  SetTypeRequest,
  SortRequest,
  SpecialKind,
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
const histogramCache = new HistogramCache();

const FIRST_PAGE_ROWS = 40;

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer !== undefined && transfer.length > 0) scope.postMessage(message, transfer);
  else scope.postMessage(message);
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    handle(message);
  } catch (error) {
    post({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

function handle(message: WorkerRequest): void {
  switch (message.type) {
    case "load":
      handleLoad(message);
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
    case "getStats":
      handleGetStats(message);
      break;
    case "startExport":
      exportIds = sortedIds.slice();
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
        text: buildCsv(dataset, ids, start, end, start === 0),
      });
      break;
    }
  }
}

function state(): { dataset: Dataset; engine: QueryEngine } {
  if (dataset === null || engine === null) throw new Error("No dataset loaded");
  return { dataset, engine };
}

/**
 * Duplicates view: when the duplicates toggle is on and no explicit sort is
 * active, rows are ordered by content hash so identical rows sit together.
 */
function computeSortedIds(bits: BitSet): Uint32Array {
  if (specials.has("duplicates") && rankAsc === null) return orderByDuplicates(bits);
  return orderIds(bits, rankAsc, sortDir);
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

function handleShuffle(message: { requestId: number }): void {
  const { dataset } = state();
  rankColumn = -1;
  rankAsc = null;
  sortDir = 1;
  duplicateRank = null;
  shuffleInPlace(sortedIds);
  post({
    type: "shuffled",
    requestId: message.requestId,
    count: sortedIds.length,
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
  });
}

function handleLoad(message: LoadRequest): void {
  const started = performance.now();
  const { dataset: next, encoding } = ingestDataset({
    name: message.name,
    delimiter: message.delimiter,
    hasHeaders: message.hasHeaders,
    text: message.text,
    buffer: message.buffer,
    table: message.table,
    onProgress: (progress) =>
      post({ type: "progress", phase: progress.phase, detail: progress.detail }),
  });

  dataset = next;
  engine = new QueryEngine(next);
  filters.clear();
  rankColumn = -1;
  rankAsc = null;
  sortDir = 1;
  exportIds = null;
  duplicateRank = null;
  specials.clear();
  histogramCache.clear();
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
    source: message.buffer !== undefined ? "file" : "paste",
    encoding,
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
}): void {
  const { dataset, engine } = state();
  engine.setSpecial(message.kind, message.active);
  if (message.active) specials.add(message.kind);
  else specials.delete(message.kind);

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
  column.setType(message.columnType);
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
    const base = filters.has(columnIndex)
      ? engine.evaluateBits(filters, columnIndex)
      : resultBits;
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

function metaFor(dataset: Dataset, column: ColumnData, index: number): ColumnMeta {
  if (column.type === "integer" || column.type === "number" || column.type === "date") {
    column.numbers();
  }
  let categories: ColumnMeta["categories"] = null;
  if (column.type === "category" || column.type === "boolean") {
    const built = column.categories();
    categories = { labels: built.labels, counts: built.counts };
  }
  return {
    name: column.name,
    type: column.type,
    stats: column.stats,
    categories,
    histogram: column.histogram(),
    valueFence: dataset.valueFences[index] ?? null,
    lengthFence: dataset.lengthFences[index] ?? null,
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

    const baseBits = engine.evaluateBits(filters, columnIndex);
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
