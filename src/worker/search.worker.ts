import type { ColumnData } from "../data/column.js";
import type { Dataset } from "../data/dataset.js";
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
let rank: Uint32Array | null = null;
let sortColumn = -1;
let sortDir: 1 | -1 = 1;
let exportIds: Uint32Array | null = null;

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

function handleLoad(message: LoadRequest): void {
  const started = performance.now();
  const next = ingestDataset({
    name: message.name,
    delimiter: message.delimiter,
    hasHeaders: message.hasHeaders,
    text: message.text,
    buffer: message.buffer,
    onProgress: (progress) =>
      post({ type: "progress", phase: progress.phase, detail: progress.detail }),
  });

  dataset = next;
  engine = new QueryEngine(next);
  filters.clear();
  rank = null;
  sortColumn = -1;
  sortDir = 1;
  exportIds = null;
  sortedIds = engine.evaluate(filters);

  post({
    type: "loaded",
    requestId: message.requestId,
    name: next.name,
    headers: next.columns.map((column) => column.name),
    rowCount: next.rowCount,
    columnCount: next.columnCount,
    columns: next.columns.map(metaFor),
    stats: next.stats,
    ingestMs: performance.now() - started,
    source: message.buffer !== undefined ? "file" : "paste",
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
  sortedIds = orderIds(bits, rank);
  const queryMs = performance.now() - started;
  post({
    type: "results",
    requestId: message.requestId,
    count: sortedIds.length,
    queryMs,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
  });
}

function handleClearFilters(message: { requestId: number }): void {
  const { dataset, engine } = state();
  filters.clear();
  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = orderIds(bits, rank);
  const queryMs = performance.now() - started;
  post({
    type: "results",
    requestId: message.requestId,
    count: sortedIds.length,
    queryMs,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
  });
}

function handleSort(message: SortRequest): void {
  const { dataset, engine } = state();

  if (message.column < 0) {
    rank = null;
    sortColumn = -1;
    sortDir = 1;
  } else {
    post({ type: "progress", phase: "sort", column: message.column, active: true });
    rank = buildRank(dataset, message.column, message.dir);
    sortColumn = message.column;
    sortDir = message.dir;
    post({ type: "progress", phase: "sort", column: message.column, active: false });
  }

  const bits = engine.evaluateBits(filters);
  sortedIds = orderIds(bits, rank);
  post({
    type: "sorted",
    requestId: message.requestId,
    count: sortedIds.length,
    column: sortColumn,
    dir: sortDir,
  });
}

function handleGetRows(message: GetRowsRequest): void {
  if (dataset === null) {
    post({ type: "rows", requestId: message.requestId, start: 0, rows: [] });
    return;
  }
  const start = Math.max(0, message.start);
  const end = Math.min(message.end, sortedIds.length);
  const columns = dataset.columns;
  const rows: string[][] = [];
  for (let i = start; i < end; i++) {
    const rowIndex = sortedIds[i];
    const row = new Array<string>(columns.length);
    for (let c = 0; c < columns.length; c++) row[c] = columns[c].raw[rowIndex];
    rows.push(row);
  }
  post({ type: "rows", requestId: message.requestId, start, rows });
}

function handleSetType(message: SetTypeRequest): void {
  const { dataset, engine } = state();
  const column = dataset.columns[message.column];
  column.setType(message.columnType);
  filters.delete(message.column);
  engine.invalidate();

  if (sortColumn === message.column) {
    rank = null;
    sortColumn = -1;
    sortDir = 1;
  }

  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = orderIds(bits, rank);
  post({
    type: "columnMeta",
    requestId: message.requestId,
    column: message.column,
    meta: metaFor(column),
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
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

function metaFor(column: ColumnData): ColumnMeta {
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
  };
}

/**
 * Filtered histograms for range-filtered columns. The distribution excludes
 * the column's own filter so the full baseline stays visible while the
 * selected band is highlighted in the UI.
 */
function computeHistograms(
  dataset: Dataset,
  engine: QueryEngine,
): Record<number, number[]> {
  const histograms: Record<number, number[]> = {};
  for (const [columnIndex, filter] of filters) {
    if (filter.kind !== "range") continue;
    const column = dataset.columns[columnIndex];
    const base = column.histogram();
    if (base === null) continue;

    const numbers = column.numbers();
    const baseBits = engine.evaluateBits(filters, columnIndex);
    const binCount = base.bins.length;
    const bins = new Array<number>(binCount).fill(0);
    const scale = base.max > base.min ? binCount / (base.max - base.min) : 0;

    for (let row = 0; row < dataset.rowCount; row++) {
      if (!baseBits.get(row)) continue;
      const value = numbers[row];
      if (!Number.isFinite(value)) continue;
      let bin = scale > 0 ? Math.floor((value - base.min) * scale) : 0;
      if (bin < 0) bin = 0;
      else if (bin >= binCount) bin = binCount - 1;
      bins[bin]++;
    }
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
