import { ColumnData } from "../data/column.js";
import { isGroupableColumn } from "../data/groupable.js";
import { computeAggregate } from "../data/aggregate.js";
import { computePivot } from "../data/pivot.js";
import { coMissingness } from "../data/comissingness.js";
import { computeDependencies } from "../data/dependencies.js";
import { computeGroupAnomalies } from "../data/group-anomalies.js";
import { computeOutlierAnalysis } from "../data/outliers.js";
import { computeRelationships } from "../data/relationships.js";
import { computeColumnNetwork } from "../data/column-network.js";
import { textProfile } from "../data/text-profile.js";
import { computeDistributionChanges } from "../data/distribution.js";
import { computeSimilarClusters } from "../data/similar-clusters.js";
import { computeAnomalies } from "../data/anomalies.js";
import { computeKeyDuplicates } from "../data/key-duplicates.js";
import { computePairViolations } from "../data/pair-checks.js";
import {
  buildDataset,
  buildDatasetAsync,
  datasetFromColumns,
  rebuildDataset,
  recomputeDatasetStats,
} from "../data/build.js";
import {
  applyCleanOps,
  applyCleanOpsIncremental,
  type CleanOp,
} from "../data/clean-ops.js";
import { castColumn } from "../data/cast-ops.js";
import type { Dataset } from "../data/dataset.js";
import { applyTransformOps, type TransformOp } from "../data/transform-ops.js";
import { binValues, groupedBinValues } from "../data/chart-bins.js";
import { missingnessGrid } from "../data/missingness.js";
import { categoryCodes, computeSeries } from "../data/chart-series.js";
import {
  computeBoxStats,
  computeCorrelation,
  computeCrossTab,
  computeGridCounts,
  type GridMeasure,
} from "../data/chart-stats.js";
import { computeBarFrames, computeBubbleFrames, computeHistogramFrames } from "../data/chart-frames.js";
import type { FileEncoding } from "../parse/encoding.js";
import type { Delimiter } from "../parse/delimiter.js";
import {
  createNullPolicy,
  EMPTY_NULL_POLICY,
  isNullToken,
  type NullPolicy,
} from "../parse/null-tokens.js";
import { isParquetName, readParquetGrid } from "../parse/parquet.js";
import { parseNumber, type NumberLocale } from "../parse/numbers.js";
import { parseDate } from "../parse/dates.js";
import { measureRagged, type RaggedInfo } from "../parse/parse.js";
import { filteredHistogram, filtersSignature, HistogramCache } from "../search/aggregates.js";
import { BitSet } from "../search/bitset.js";
import { buildRank, orderIds } from "../search/order.js";
import { clusterSimilar } from "../search/similar.js";
import {
  QueryEngine,
  type ColumnFilter,
  type ColumnSpecialKind,
  type SpecialFilter,
} from "../search/query-engine.js";
import { isNumericLikeType, type ColumnType } from "../types.js";
import { buildCsv } from "./csv.js";
import {
  ingestDataset,
  ingestDatasetAsync,
  ingestFilesAsync,
  type IngestResult,
} from "./ingest.js";
import type {
  CleanColumnsRequest,
  ClearExcludedRowsRequest,
  ColumnDetail,
  ColumnMeta,
  FileImportMeta,
  DropRowsRequest,
  FinalizeStatsRequest,
  GetRowsRequest,
  GetStatsRequest,
  GetChartBinsRequest,
  GetGroupedBinsRequest,
  GetMissingnessRequest,
  GetChartSeriesRequest,
  GetBoxStatsRequest,
  GetCrosstabRequest,
  GetCorrelationRequest,
  GetAggregateRequest,
  GetPivotRequest,
  GetCoMissingnessRequest,
  GetGroupAnomaliesRequest,
  GetOutlierAnalysisRequest,
  GetDependenciesRequest,
  GetRelationshipsRequest,
  GetColumnNetworkRequest,
  GetTextProfileRequest,
  GetDistributionChangesRequest,
  GetSimilarClustersRequest,
  GetGridCountsRequest,
  GetAnimationRequest,
  LoadRequest,
  PreviewCleanRequest,
  PreviewTransformRequest,
  RenameHeadersRequest,
  ResolveNullsAllRequest,
  SetFilterRequest,
  SetFiltersRequest,
  SetNullPolicyRequest,
  SetNumberLocaleRequest,
  SetTypeRequest,
  CheckKeyDuplicatesRequest,
  CheckPairRequest,
  SortRequest,
  SpecialKind,
  ProgressPhase,
  TransformRequest,
  TransformPreviewNote,
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
// Global specials only; "pattern" is column-only and never joins this set.
const specials = new Set<SpecialFilter>();
// Per-column specials (empties/outliers), carried across clean rebuilds too.
const columnSpecials = new Map<number, Set<ColumnSpecialKind>>();
// Rows removed via the delete actions, by original dataset row id.
const excludedIds = new Set<number>();
let excludedBits: BitSet | null = null;
const histogramCache = new HistogramCache();
// Cells whose current value differs from the first-seen value, by column,
// for the "changed cells" highlight. Masks are keyed by original row id.
const changeBase = new Map<number, readonly string[]>();
const changedMasks = new Map<number, BitSet>();
let changedTotalCells = 0;
/** Rows that failed the most recent cast for each column. */
const castFailureMasks = new Map<number, BitSet>();
let castFailureUnion: BitSet | null = null;

/** Records which cells of a column now differ from its first-seen values. */
function castFailureMask(
  source: ColumnData,
  ops: readonly CleanOp[],
): BitSet | null {
  let castIndex = -1;
  for (let index = ops.length - 1; index >= 0; index--) {
    if (ops[index]?.kind === "cast") {
      castIndex = index;
      break;
    }
  }
  if (castIndex < 0) return null;
  const cast = ops[castIndex] as Extract<CleanOp, { kind: "cast" }>;
  const before =
    castIndex === 0 ? source.raw : applyCleanOps(source.raw, ops.slice(0, castIndex));
  const result = castColumn(before, {
    target: cast.target,
    policy: cast.policy,
    locale: cast.locale,
    dateOrder: cast.order,
  });
  const mask = new BitSet(before.length);
  for (let row = 0; row < result.failures.length; row++) {
    if (result.failures[row] === 1) mask.set(row);
  }
  return mask;
}

function refreshCastFailureUnion(rowCount: number): void {
  const union = new BitSet(rowCount);
  for (const mask of castFailureMasks.values()) {
    mask.forEachRow((row) => union.set(row));
  }
  castFailureUnion = union;
}

function castFailureCounts(): { column: number; count: number }[] {
  return [...castFailureMasks]
    .map(([column, mask]) => ({ column, count: mask.count() }))
    .filter((entry) => entry.count > 0);
}
/** Records which cells of a column now differ from its first-seen values. */
function recordChange(column: number, before: readonly string[], after: readonly string[]): void {
  let base = changeBase.get(column);
  if (base === undefined || base.length !== after.length) {
    base = before.slice();
    changeBase.set(column, base);
  }
  const existing = changedMasks.get(column);
  if (existing !== undefined) changedTotalCells -= existing.count();
  const mask = new BitSet(after.length);
  let count = 0;
  const limit = Math.min(base.length, after.length);
  for (let i = 0; i < limit; i++) {
    if (base[i] !== after[i]) {
      mask.set(i);
      count++;
    }
  }
  changedMasks.set(column, mask);
  changedTotalCells += count;
}

function resetChangedCells(): void {
  changeBase.clear();
  changedMasks.clear();
  changedTotalCells = 0;
  castFailureMasks.clear();
  castFailureUnion = null;
}

/** Row-major change flags for a slice of the current result order, or null. */
function changedFlagsSlice(start: number, end: number): Uint8Array | null {
  if (changedMasks.size === 0 || dataset === null) return null;
  const columnCount = dataset.columnCount;
  const boundedStart = Math.max(0, start);
  const boundedEnd = Math.min(end, sortedIds.length);
  const flags = new Uint8Array((boundedEnd - boundedStart) * columnCount);
  let any = false;
  for (let position = boundedStart; position < boundedEnd; position++) {
    const id = sortedIds[position];
    for (let c = 0; c < columnCount; c++) {
      const mask = changedMasks.get(c);
      if (mask !== undefined && mask.get(id)) {
        flags[(position - boundedStart) * columnCount + c] = 1;
        any = true;
      }
    }
  }
  return any ? flags : null;
}
// Non-destructive clean state: the untouched source column per cleaned column.
const cleanSource = new Map<number, ColumnData>();
// The op prefix already represented by the current column raw values.
const cleanOpsApplied = new Map<number, CleanOp[]>();
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
let datasetSource: "paste" | "file" | "multi" = "paste";
let datasetFiles: FileImportMeta[] = [];
let datasetEncoding: FileEncoding | null = null;
let datasetDelimiter: Delimiter | null = null;
let datasetRagged: RaggedInfo = { paddedRows: 0, extraCellRows: 0, extraCells: 0 };
// The in-flight load, so cancelLoad can flag it and the build loop can stop.
let activeLoad: { requestId: number; cancelled: boolean } | null = null;

const FIRST_PAGE_ROWS = 40;

/** Progress tied to one load, so the client can drop messages from old loads. */
function postLoadProgress(
  requestId: number,
  progress: {
    phase: ProgressPhase;
    detail?: string;
    current?: number;
    total?: number;
  },
): void {
  post({
    type: "progress",
    requestId,
    phase: progress.phase,
    detail: progress.detail,
    current: progress.current,
    total: progress.total,
  });
}

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
    // cancelLoad is fire-and-forget and has no requestId to answer.
    if (!("requestId" in message)) return;
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
    case "cancelLoad":
      handleCancelLoad();
      break;
    case "setFilter":
      handleSetFilter(message);
      break;
    case "setFilters":
      handleSetFilters(message);
      break;
    case "finalizeStats":
      handleFinalizeStats(message);
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
    case "checkKeyDuplicates":
      handleCheckKeyDuplicates(message);
      break;
    case "checkPair":
      handleCheckPair(message);
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
    case "getGroupedBins":
      handleGetGroupedBins(message);
      break;
    case "getMissingness":
      handleGetMissingness(message);
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
    case "getAggregate":
      handleGetAggregate(message);
      break;
    case "getPivot":
      handleGetPivot(message);
      break;
    case "getCoMissingness":
      handleGetCoMissingness(message);
      break;
    case "getGroupAnomalies":
      handleGetGroupAnomalies(message);
      break;
    case "getOutlierAnalysis":
      handleGetOutlierAnalysis(message);
      break;
    case "getDependencies":
      handleGetDependencies(message);
      break;
    case "getRelationships":
      handleGetRelationships(message);
      break;
    case "getColumnNetwork":
      handleGetColumnNetwork(message);
      break;
    case "getTextProfile":
      handleGetTextProfile(message);
      break;
    case "getDistributionChanges":
      handleGetDistributionChanges(message);
      break;
    case "getSimilarClusters":
      handleGetSimilarClusters(message);
      break;
    case "getGridCounts":
      handleGetGridCounts(message);
      break;
    case "getAnimation":
      handleGetAnimation(message);
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
    case "getChartGroups": {
      const { dataset } = state();
      const groups: Record<number, { labels: string[]; counts: number[] }> = {};
      for (const index of message.columns) {
        const column = dataset.columns[index];
        if (column === undefined || column.role === "provenance") continue;
        if (isGroupableColumn(column.type, column.stats.distinct)) {
          groups[index] = column.categorySummary();
        }
      }
      post({ type: "chartGroups", requestId: message.requestId, groups });
      break;
    }
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
  });
}

/** Flags the in-flight load; the build loop stops at its next checkpoint. */
function handleCancelLoad(): void {
  if (activeLoad !== null) activeLoad.cancelled = true;
}

async function handleLoad(message: LoadRequest): Promise<void> {
  const started = performance.now();
  const active = { requestId: message.requestId, cancelled: false };
  activeLoad = active;
  const cancelled = (): boolean => active.cancelled;
  const cancelNow = (): void => {
    post({ type: "loadCancelled", requestId: message.requestId });
  };

  try {
    // Parquet is decoded lazily inside the worker; every other format goes
    // through the shared text/table ingest path.
    let ingested: IngestResult | null;
    if (message.files !== undefined && message.files.length > 1) {
      ingested = await ingestFilesAsync(
        message.files,
        {
          name: message.name,
          delimiter: message.delimiter,
          hasHeaders: message.hasHeaders,
          maxRows: message.maxRows,
          deferStats: message.deferStats,
          onProgress: (progress) =>
            postLoadProgress(message.requestId, {
              phase: progress.phase,
              detail: progress.detail,
              current: progress.current,
              total: progress.total,
            }),
        },
        { cancelled },
      );
    } else if (message.buffer !== undefined && isParquetName(message.name)) {
      postLoadProgress(message.requestId, { phase: "read", detail: "Reading parquet…" });
      const grid = await readParquetGrid(message.buffer);
      if (cancelled()) {
        cancelNow();
        return;
      }
      postLoadProgress(message.requestId, { phase: "infer", detail: "Inferring schema…" });
      const dataset = await buildDatasetAsync(
        message.name,
        grid.headers,
        grid.rows,
        (progress) =>
          postLoadProgress(message.requestId, {
            phase: progress.phase ?? "build",
            detail: progress.detail,
            current: progress.current,
            total: progress.total,
          }),
        "dot",
        { shouldCancel: cancelled, deferStats: message.deferStats },
      );
      if (dataset === null) {
        cancelNow();
        return;
      }
      ingested = {
        dataset,
        encoding: null,
        delimiter: null,
        ragged: measureRagged(grid.rows, grid.headers.length),
      };
    } else {
      // Small synchronous loads complete before a cancel could ever arrive;
      // file buffers and large pastes/tables use the cancellable chunked path.
      const tableCells =
        message.table === undefined
          ? 0
          : message.table.rows.length * Math.max(1, message.table.rows[0]?.length ?? 1);
      const cancellable =
        message.buffer !== undefined ||
        tableCells > 50_000 ||
        (message.text !== undefined && message.text.length > 1_000_000);
      const options = {
        name: message.name,
        delimiter: message.delimiter,
        hasHeaders: message.hasHeaders,
        text: message.text,
        buffer: message.buffer,
        table: message.table,
        maxRows: message.maxRows,
        deferStats: message.deferStats,
        onProgress: (progress: {
          phase: ProgressPhase;
          detail?: string;
          current?: number;
          total?: number;
        }) =>
          postLoadProgress(message.requestId, {
            phase: progress.phase,
            detail: progress.detail,
            current: progress.current,
            total: progress.total,
          }),
      };
      ingested = cancellable
        ? await ingestDatasetAsync(options, { cancelled })
        : ingestDataset(options);
    }

    if (ingested === null || cancelled()) {
      cancelNow();
      return;
    }

    const { dataset: next, encoding, ragged, delimiter } = ingested;
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
    cleanOpsApplied.clear();
    resetChangedCells();
    nullPolicies.clear();
    numberLocales.clear();
    typeOverrides.clear();
    transformSource = null;
    transformOps = [];
    datasetSource =
      message.files !== undefined && message.files.length > 1
        ? "multi"
        : message.buffer !== undefined || (message.files !== undefined && message.files.length > 0)
          ? "file"
          : "paste";
    datasetFiles = ingested.files ?? [];
    datasetEncoding = encoding;
    datasetDelimiter = delimiter;
    datasetRagged = ragged;
    sortedIds = engine.evaluate(filters);

    postLoadProgress(message.requestId, { phase: "ready", detail: "Ready" });
    post({
      type: "loaded",
      requestId: message.requestId,
      name: next.name,
      headers: next.columns.map((column) => column.name),
      rowCount: next.rowCount,
      columnCount: next.columnCount,
      columns: next.columns.map((column, index) => metaFor(next, column, index)),
      stats: next.stats,
      statsPending: ingested.deferredStats === true,
      ingestMs: performance.now() - started,
      source: datasetSource,
      files: datasetFiles.length > 0 ? datasetFiles : undefined,
      encoding: datasetEncoding,
      delimiter: datasetDelimiter,
      ragged: datasetRagged,
    });
  } finally {
    if (activeLoad === active) activeLoad = null;
  }
}

function handleFinalizeStats(message: FinalizeStatsRequest): void {
  const { dataset: current } = state();
  const started = performance.now();
  const finalized = recomputeDatasetStats(current, (phase, currentStep, total) => {
    post({
      type: "progress",
      requestId: message.requestId,
      phase: "stats",
      detail: `${phase} (${currentStep}/${total}).`,
      current: currentStep,
      total,
    });
  });
  dataset = finalized.dataset;
  engine = new QueryEngine(finalized.dataset);
  applySpecials(engine);
  duplicateRank = null;
  histogramCache.clear();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  const queryMs = performance.now() - started;
  post({
    type: "datasetStats",
    requestId: message.requestId,
    stats: finalized.result.stats,
    columns: finalized.dataset.columns.map((column, index) =>
      metaFor(finalized.dataset, column, index),
    ),
    count: sortedIds.length,
    queryMs,
    facets: computeFacets(finalized.dataset, engine, bits),
    histograms: computeHistograms(finalized.dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
  });
}

function handleSetFilters(message: SetFiltersRequest): void {
  const { dataset, engine } = state();
  for (const entry of message.filters) {
    const filter = entry.filter;
    if (filter !== null && filter.kind === "text" && filter.mode === "fuzzy") {
      const column = dataset.columns[entry.column];
      if (column !== undefined && !column.fuzzyBuilt) {
        post({ type: "progress", phase: "index", column: entry.column, active: true });
        column.fuzzyIndex();
        post({ type: "progress", phase: "index", column: entry.column, active: false });
      }
    }
    if (filter === null) filters.delete(entry.column);
    else filters.set(entry.column, filter);
  }
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
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
    if (message.kind === "pattern") {
      // Column-only special: without a column there is nothing to intersect.
      return;
    }
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
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
    changed: changedFlagsSlice(start, message.end) ?? undefined,
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
    nonParsing: countNonParsing(column, message.columnType),
  });
}

/** Composite-key duplicate check: stores bits and activates the special. */
function handleCheckKeyDuplicates(message: CheckKeyDuplicatesRequest): void {
  const { dataset, engine } = state();
  const result = computeKeyDuplicates(dataset.columns, message.columns, dataset.rowCount);
  dataset.keyDuplicateBits = result.duplicateBits;
  engine.setSpecial("keyDuplicates", true);
  specials.add("keyDuplicates");

  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "keyDuplicates",
    requestId: message.requestId,
    columns: message.columns,
    duplicateRows: result.duplicateRows,
    duplicateGroups: result.duplicateGroups,
    counted: result.counted,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
  });
}

/** Pair/consistency check: stores violation bits and activates the special. */
function handleCheckPair(message: CheckPairRequest): void {
  const { dataset, engine } = state();
  const result = computePairViolations(
    dataset.columns,
    message.columnA,
    message.columnB,
    message.operator,
    message.tolerance ?? 0,
    dataset.rowCount,
  );
  dataset.pairCheckBits = result.violationBits;
  engine.setSpecial("pairCheck", true);
  specials.add("pairCheck");

  const started = performance.now();
  const bits = engine.evaluateBits(filters);
  sortedIds = computeSortedIds(bits);
  post({
    type: "pairCheck",
    requestId: message.requestId,
    columnA: message.columnA,
    columnB: message.columnB,
    operator: message.operator,
    violations: result.violations,
    compared: result.compared,
    count: sortedIds.length,
    queryMs: performance.now() - started,
    facets: computeFacets(dataset, engine, bits),
    histograms: computeHistograms(dataset, engine),
    firstRows: rowsSlice(0, FIRST_PAGE_ROWS),
    firstGroups: groupFlags(0, FIRST_PAGE_ROWS),
    firstFlags: rowFlagsSlice(0, FIRST_PAGE_ROWS),
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
  });
}

/** Non-null cells that cannot be represented in the column's (new) type. */
function countNonParsing(column: ColumnData, type: ColumnType): number {
  const numeric = type === "integer" || type === "number";
  const temporal = type === "date" || type === "datetime";
  if (!numeric && !temporal) return 0;
  let failures = 0;
  for (let row = 0; row < column.raw.length; row++) {
    const value = column.raw[row];
    if (column.isNull(value)) continue;
    if (numeric) {
      const parsed = parseNumber(value, column.numberLocale);
      if (!Number.isFinite(parsed) || (type === "integer" && !Number.isInteger(parsed))) {
        failures++;
      }
    } else if (!Number.isFinite(parseDate(value, column.dateOrder))) {
      failures++;
    }
  }
  return failures;
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
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
  const numeric = isNumericLikeType(column.type);
  post({
    type: "chartBins",
    requestId: message.requestId,
    column: message.column,
    median: numeric ? column.medianSampled() : null,
    ...bins,
  });
}

/** Downsampled null map of the working table for the Overview heatmap. */
function handleGetMissingness(message: GetMissingnessRequest): void {
  const { dataset } = state();
  const started = performance.now();
  const grid = missingnessGrid(dataset.columns, dataset.rowCount, message.buckets);
  post(
    {
      type: "missingness",
      requestId: message.requestId,
      buckets: grid.buckets,
      columns: dataset.columnCount,
      cells: grid.cells,
      totalRows: dataset.rowCount,
      columnNames: dataset.columns.map((column) => column.name),
      ms: performance.now() - started,
    },
    [grid.cells.buffer],
  );
}

/**
 * Bins of one column split by a category column, for grouped time series.
 * The top N groups by filtered volume get their own series; the rest fold into
 * an Other bucket, so a high-cardinality grouping cannot explode the legend.
 */
function handleGetGroupedBins(message: GetGroupedBinsRequest): void {
  const { dataset } = state();
  const column = dataset.columns[message.column];
  const groupColumn = dataset.columns[message.groupColumn];
  if (column === undefined || groupColumn === undefined) throw new Error("Unknown column");
  const categories = groupColumn.categories();
  const codes = categoryCodes(categories.bits, dataset.rowCount);
  const started = performance.now();
  const result = groupedBinValues(
    column.numbers(),
    codes,
    categories.labels.length,
    sortedIds,
    message.options,
    message.topN,
  );
  const labels: string[] = [];
  const seriesCodes: number[] = [];
  const groups: number[][] = [];
  const totals: number[] = [];
  for (const series of result.groups) {
    labels.push(categories.labels[series.code] ?? "(blank)");
    seriesCodes.push(series.code);
    groups.push(series.bins);
    totals.push(series.total);
  }
  let otherIndex = -1;
  if (result.other !== null) {
    otherIndex = groups.length;
    labels.push("Other");
    seriesCodes.push(-1);
    groups.push(result.other.bins);
    totals.push(result.other.total);
  }
  post({
    type: "groupedBins",
    requestId: message.requestId,
    column: message.column,
    groupColumn: message.groupColumn,
    labels,
    codes: seriesCodes,
    groups,
    totals,
    otherIndex,
    bins: groups[0]?.length ?? 0,
    overflow: result.overflow,
    above: result.above,
    below: result.below,
    total: result.total,
    ms: performance.now() - started,
  });
}

/** Rows for a chart request: table scope, optionally narrowed by its own filter. */
function chartScopedIds(
  respectFilters?: boolean,
  filter?: { column: number; code: number },
): Uint32Array {
  const { dataset } = state();
  let ids: Uint32Array = sortedIds;
  if (respectFilters === false) {
    const all = new BitSet(dataset.rowCount);
    all.setAll();
    ids = Uint32Array.from(withoutExcluded(all).toIndices());
  }
  if (filter !== undefined && filter.column >= 0 && filter.code >= 0) {
    const column = dataset.columns[filter.column];
    if (column !== undefined && isGroupableColumn(column.type, column.stats.distinct)) {
      const codes = categoryCodes(column.categories().bits, dataset.rowCount);
      ids = Uint32Array.from(ids.filter((id) => codes[id] === filter.code));
    }
  }
  return ids;
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
  const ids = chartScopedIds(message.respectFilters, message.chartFilter);
  const xNumbers = xColumn.numbers();
  const yNumbers = yColumn.numbers();
  const result = computeSeries(
    xNumbers,
    yNumbers,
    ids,
    colorValues,
    colorCodes,
    size,
    {
      mode: message.mode,
      limit: message.limit ?? 20_000,
      gridCols: 128,
      gridRows: 72,
      clip: message.clip,
    },
  );
  const correlation = computeCorrelation([xNumbers, yNumbers], ids).values[1] ?? Number.NaN;

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
  const result = computeBoxStats(
    valueColumn.numbers(),
    codes,
    categories.labels,
    chartScopedIds(message.respectFilters, message.chartFilter),
    {
      topN: message.topN,
      groupOther: message.groupOther,
    },
  );
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
    chartScopedIds(message.respectFilters, message.chartFilter),
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

/** Aggregate view over the filtered rows (or every row after steps). */
function handleGetAggregate(message: GetAggregateRequest): void {
  const { dataset } = state();
  const started = performance.now();
  let ids = sortedIds;
  if (!message.view.respectFilters) {
    const all = new BitSet(dataset.rowCount);
    all.setAll();
    ids = withoutExcluded(all).toIndices();
  }
  const filterColumn = message.view.filterColumn ?? -1;
  const filterCode = message.view.filterCode ?? -1;
  if (filterColumn >= 0 && filterCode >= 0 && filterColumn < dataset.columnCount) {
    const column = dataset.columns[filterColumn];
    if (isGroupableColumn(column.type, column.stats.distinct)) {
      const codes = categoryCodes(column.categories().bits, dataset.rowCount);
      ids = ids.filter((id) => codes[id] === filterCode);
    }
  }
  const result = computeAggregate(message.view, dataset.columns, dataset.rowCount, ids);
  const transfer: Transferable[] = [result.totals.buffer];
  for (const values of result.measures) transfer.push(values.buffer);
  for (const values of result.dimensionTimes) transfer.push(values.buffer);
  post(
    {
      type: "aggregate",
      requestId: message.requestId,
      viewId: message.view.id,
      labels: result.labels,
      dimensions: result.dimensions,
      dimensionNames: result.dimensionNames,
      dimensionIsTime: result.dimensionIsTime,
      dimensionTimes: result.dimensionTimes,
      measures: result.measures,
      measureNames: result.measureNames,
      totals: result.totals,
      groupCount: result.groupCount,
      totalGroups: result.totalGroups,
      truncated: result.truncated,
      partials: result.partials,
      ms: performance.now() - started,
    },
    transfer,
  );
}

/** Worker-side pivot matrix over the filtered rows. */
function handleGetPivot(message: GetPivotRequest): void {
  const { dataset } = state();
  const started = performance.now();
  let ids = sortedIds;
  if (!message.pivot.respectFilters) {
    const all = new BitSet(dataset.rowCount);
    all.setAll();
    ids = withoutExcluded(all).toIndices();
  }
  const result = computePivot(message.pivot, dataset.columns, dataset.rowCount, ids);
  const transfer: Transferable[] = [];
  for (const measure of result.measures) {
    transfer.push(measure.values.buffer, measure.rowTotals.buffer, measure.colTotals.buffer);
  }
  for (const times of result.rowTimes) transfer.push(times.buffer);
  for (const times of result.colTimes) transfer.push(times.buffer);
  post(
    {
      type: "pivot",
      requestId: message.requestId,
      pivotId: message.pivot.id,
      ...result,
      ms: performance.now() - started,
    },
    transfer,
  );
}
/** Pairwise co-missingness across the filtered rows (Reports → Quality). */
function handleGetCoMissingness(message: GetCoMissingnessRequest): void {
  const { dataset } = state();
  const started = performance.now();
  const candidates: number[] = [];
  dataset.columns.forEach((column, index) => {
    if (candidates.length < 20 && column.stats.nulls > 0) candidates.push(index);
  });
  const result = coMissingness(
    candidates.map((index) => dataset.columns[index].nullMask),
    dataset.rowCount,
    sortedIds,
  );
  post({
    type: "coMissingness",
    requestId: message.requestId,
    columns: candidates,
    labels: candidates.map((index) => dataset.columns[index].name),
    nullCells: result.nullCells,
    pairs: result.pairs,
    ms: performance.now() - started,
  });
}

/** Group-relative anomalies: values unusual next to their category peers. */
function handleGetGroupAnomalies(message: GetGroupAnomaliesRequest): void {
  const { dataset } = state();
  const started = performance.now();
  const result = computeGroupAnomalies(dataset.columns, dataset.rowCount);
  dataset.applyGroupAnomalies(result.columnBits, result.combined);
  post({
    type: "groupAnomalies",
    requestId: message.requestId,
    pairs: result.pairs,
    totalFlagged: result.totalFlagged,
    ms: performance.now() - started,
  });
}

/**
 * Multivariate outliers (Isolation Forest, PCA reconstruction, LOF). The
 * worker stores the flagged rows as a BitSet so the table can filter to them
 * without returning every row to the UI.
 */
function handleGetOutlierAnalysis(message: GetOutlierAnalysisRequest): void {
  const { dataset, engine } = state();
  const started = performance.now();
  let ids = sortedIds;
  if (message.respectFilters === false) {
    const all = new BitSet(dataset.rowCount);
    all.setAll();
    ids = withoutExcluded(all).toIndices();
  }
  const result = computeOutlierAnalysis(dataset.columns, ids, {
    method: message.method,
    columns: message.columns,
    contamination: message.contamination,
    mode: message.mode,
    trees: message.trees,
    sampleSize: message.sampleSize,
    neighbors: message.neighbors,
    components: message.components,
    seed: message.seed,
  });
  const bits = new BitSet(dataset.rowCount);
  for (let i = 0; i < result.rowIndices.length; i++) {
    if ((result.scores[i] ?? Number.NEGATIVE_INFINITY) >= result.threshold) {
      bits.set(result.rowIndices[i] ?? 0);
    }
  }
  dataset.outlierBits = bits;
  engine.setSpecialBits("outliers", bits);
  post(
    {
      type: "outlierAnalysis",
      requestId: message.requestId,
      method: result.method,
      mode: result.mode,
      labels: result.labels,
      columns: result.columns,
      scores: result.scores,
      rowIndices: result.rowIndices,
      threshold: result.threshold,
      flagged: result.flagged,
      analyzed: result.analyzed,
      excluded: result.excluded,
      sampled: result.sampled,
      totalRows: result.totalRows,
      projected: result.projected,
      projectionComponents: result.projectionComponents,
      omittedFeatures: result.omittedFeatures,
      details: result.details,
      featureImportance: result.featureImportance,
      visualRows: result.visualRows,
      visualX: result.visualX,
      visualY: result.visualY,
      visualFlagged: result.visualFlagged,
      ms: performance.now() - started,
    },
    [
      result.scores.buffer,
      result.rowIndices.buffer,
      result.visualRows.buffer,
      result.visualX.buffer,
      result.visualY.buffer,
      result.visualFlagged.buffer,
    ],
  );
}

/** Candidate keys and the columns they determine (data integrity/joins). */
function handleGetDependencies(message: GetDependenciesRequest): void {
  const { dataset } = state();
  const started = performance.now();
  let ids = sortedIds;
  if (message.respectFilters === false) {
    const all = new BitSet(dataset.rowCount);
    all.setAll();
    ids = withoutExcluded(all).toIndices();
  }
  const pairs = computeDependencies(dataset.columns, dataset.rowCount, {}, ids);
  post({
    type: "dependencies",
    requestId: message.requestId,
    pairs,
    ms: performance.now() - started,
  });
}

/** Ranked relationship discovery over the current rows (Reports → Relationships). */
function handleGetRelationships(message: GetRelationshipsRequest): void {
  const { dataset } = state();
  const started = performance.now();
  let ids = sortedIds;
  if (message.respectFilters === false) {
    const all = new BitSet(dataset.rowCount);
    all.setAll();
    ids = withoutExcluded(all).toIndices();
  }
  const relationships = computeRelationships(dataset.columns, dataset.rowCount, ids);
  post({
    type: "relationships",
    requestId: message.requestId,
    relationships,
    ms: performance.now() - started,
  });
}

/** Column-level associations including text columns. */
function handleGetColumnNetwork(message: GetColumnNetworkRequest): void {
  const { dataset } = state();
  const started = performance.now();
  let ids = sortedIds;
  if (message.respectFilters === false) {
    const all = new BitSet(dataset.rowCount);
    all.setAll();
    ids = withoutExcluded(all).toIndices();
  }
  const result = computeColumnNetwork(dataset.columns, ids, dataset.rowCount);
  post({
    type: "columnNetwork",
    requestId: message.requestId,
    ...result,
    ms: performance.now() - started,
  });
}

/** Token frequencies and value shapes for one text column. */
function handleGetTextProfile(message: GetTextProfileRequest): void {
  const { dataset } = state();
  const column = dataset.columns[message.column];
  if (column === undefined) throw new Error("Unknown column");
  const started = performance.now();
  const profile = textProfile(
    column.raw,
    column.nullMask,
    message.limit ?? 30,
    message.terms !== false,
  );
  post({
    type: "textProfile",
    requestId: message.requestId,
    column: message.column,
    label: column.name,
    profile,
    ms: performance.now() - started,
  });
}

/** PSI / Cramér's V between the first and second half of the current rows. */
function handleGetDistributionChanges(message: GetDistributionChangesRequest): void {
  const { dataset } = state();
  const started = performance.now();
  const changes = computeDistributionChanges(dataset.columns, dataset.rowCount, sortedIds);
  post({
    type: "distributionChanges",
    requestId: message.requestId,
    changes,
    ms: performance.now() - started,
  });
}

/** Near-duplicate value clusters over the current rows (blocked, capped). */
function handleGetSimilarClusters(message: GetSimilarClustersRequest): void {
  const { dataset } = state();
  const started = performance.now();
  const entries = computeSimilarClusters(dataset.columns, dataset.rowCount, sortedIds);
  post({
    type: "similarClusters",
    requestId: message.requestId,
    entries,
    ms: performance.now() - started,
  });
}

/** Resolves a wire measure into per-row values for grid aggregation. */
function gridMeasure(
  dataset: Dataset,
  measure?: { column: number; agg: "sum" | "mean" | "min" | "max" },
): GridMeasure | undefined {
  if (measure === undefined) return undefined;
  const column = dataset.columns[measure.column];
  if (column === undefined) return undefined;
  return { values: column.numbers(), agg: measure.agg };
}

/** Top category codes (plus Other) for overlaid bubble sets. */
function bubbleGroups(
  column: ColumnData,
  rowCount: number,
  limit = 10,
): { codes: Uint16Array; labels: string[] } {
  const { codes, labels } = categoryCodesFor(column, rowCount);
  if (labels.length <= limit) return { codes, labels };
  const counts = new Uint32Array(labels.length);
  for (const code of codes) counts[code]++;
  const order = [...labels.keys()].sort((a, b) => counts[b] - counts[a]);
  const map = new Uint16Array(labels.length).fill(limit);
  const outLabels: string[] = [];
  order.slice(0, limit).forEach((code, index) => {
    map[code] = index;
    outLabels.push(labels[code] ?? "?");
  });
  outLabels.push("Other");
  const outCodes = new Uint16Array(rowCount);
  for (let row = 0; row < rowCount; row++) outCodes[row] = map[codes[row]] ?? limit;
  return { codes: outCodes, labels: outLabels };
}

/** Row counts per x/y grid cell for the bubble chart. */
function handleGetGridCounts(message: GetGridCountsRequest): void {
  const { dataset } = state();
  const x = dataset.columns[message.xColumn];
  const y = dataset.columns[message.yColumn];
  if (x === undefined || y === undefined) throw new Error("Unknown column");
  const started = performance.now();
  const groupColumn =
    message.groupColumn === undefined ? undefined : dataset.columns[message.groupColumn];
  const result = computeGridCounts(
    x.numbers(),
    y.numbers(),
    chartScopedIds(message.respectFilters, message.chartFilter),
    message.bins ?? 40,
    gridMeasure(dataset, message.measure),
    groupColumn === undefined ? undefined : bubbleGroups(groupColumn, dataset.rowCount),
  );
  const transfer: Transferable[] = [result.counts.buffer];
  if (result.values !== null) transfer.push(result.values.buffer);
  for (const group of result.groups ?? []) {
    transfer.push(group.counts.buffer);
    if (group.values !== null) transfer.push(group.values.buffer);
  }
  post(
    { type: "gridCounts", requestId: message.requestId, result, ms: performance.now() - started },
    transfer,
  );
}

/** Compact category codes without the per-category bitsets. */
function categoryCodesFor(
  column: ColumnData,
  rowCount: number,
): { codes: Uint16Array; labels: string[] } {
  const index = new Map<string, number>();
  const labels: string[] = [];
  const codes = new Uint16Array(rowCount);
  for (let row = 0; row < rowCount; row++) {
    const value = column.nullMask.get(row) ? "(empty)" : (column.raw[row] ?? "").trim();
    let code = index.get(value);
    if (code === undefined) {
      code = labels.length;
      index.set(value, code);
      labels.push(value);
    }
    codes[row] = code;
  }
  return { codes, labels };
}

/** Per-time-bucket frames for animated bar and bubble charts. */
function handleGetAnimation(message: GetAnimationRequest): void {
  const { dataset } = state();
  const timeColumn = dataset.columns[message.timeColumn];
  if (timeColumn === undefined) throw new Error("Unknown time column");
  const started = performance.now();
  const times = timeColumn.numbers();
  const ids = chartScopedIds(message.respectFilters, message.chartFilter);
  if (message.chart === "histogram") {
    const column = dataset.columns[message.column];
    if (column === undefined) throw new Error("Unknown column");
    const result = computeHistogramFrames(
      times,
      column.numbers(),
      ids,
      message.grain,
      message.bins ?? 32,
    );
    post(
      { type: "animation", requestId: message.requestId, result, ms: performance.now() - started },
      result.hist === undefined ? [] : [result.hist.counts.buffer],
    );
    return;
  }
  if (message.chart === "bubble") {
    const x = dataset.columns[message.column];
    const y = dataset.columns[message.yColumn];
    if (x === undefined || y === undefined) throw new Error("Unknown column");
    const groupColumn =
      message.groupColumn === undefined ? undefined : dataset.columns[message.groupColumn];
    const result = computeBubbleFrames(
      times,
      x.numbers(),
      y.numbers(),
      ids,
      message.grain,
      message.bins ?? 40,
      gridMeasure(dataset, message.measure),
      groupColumn === undefined ? undefined : bubbleGroups(groupColumn, dataset.rowCount),
    );
    const transfer: Transferable[] = [];
    if (result.bubble !== undefined) {
      transfer.push(result.bubble.grids.buffer);
      if (result.bubble.values !== null) transfer.push(result.bubble.values.buffer);
    }
    post(
      { type: "animation", requestId: message.requestId, result, ms: performance.now() - started },
      transfer,
    );
    return;
  }
  const column = dataset.columns[message.column];
  if (column === undefined) throw new Error("Unknown column");
  const { codes, labels } = categoryCodesFor(column, dataset.rowCount);
  if (labels.length > 60_000) {
    throw new Error("Too many distinct categories to animate — try a bubble chart instead");
  }
  const result = computeBarFrames(
    times,
    codes,
    labels,
    ids,
    message.grain,
    message.topN ?? 8,
  );
  post(
    { type: "animation", requestId: message.requestId, result, ms: performance.now() - started },
    result.bar === undefined ? [] : [result.bar.counts.buffer],
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
    chartScopedIds(message.respectFilters, message.chartFilter),
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

function cleanTarget(
  ops: readonly CleanOp[],
  current: ColumnData,
): { type: ColumnType | undefined; dateOrder: ColumnData["dateOrder"]; numberLocale: NumberLocale } {
  let type: ColumnType | undefined = current.type;
  let dateOrder = current.dateOrder;
  let numberLocale = current.numberLocale;
  for (const op of ops) {
    switch (op.kind) {
      case "cast":
        // Casts may keep invalid text or blank it, so let inference decide.
        type = undefined;
        if (op.locale !== undefined) numberLocale = op.locale;
        if (op.order !== undefined) dateOrder = op.order;
        break;
      case "toNumber":
        type = undefined;
        numberLocale = op.locale;
        break;
      case "repairDecimal":
        numberLocale = op.locale;
        break;
      case "toDate":
        type = undefined;
        dateOrder = op.order;
        break;
      case "toDateTime":
        type = undefined;
        dateOrder = op.order;
        break;
      case "trim":
      case "case":
      case "replace":
      case "escapeFormulas":
        break;
    }
  }
  return { type, dateOrder, numberLocale };
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
  const prepared = message.updates
    .filter((update) => update.column >= 0 && update.column < current.columns.length)
    .map((update) => {
      const source = cleanSource.get(update.column) ?? current.columns[update.column];
      const prior = cleanOpsApplied.get(update.column) ?? [];
      const application =
        update.ops.length === 0
          ? { values: source.raw, replayed: true }
          : applyCleanOpsIncremental(
              current.columns[update.column].raw,
              source.raw,
              prior,
              update.ops,
            );
      return {
        update,
        source,
        raw: application.values,
        replayed: application.replayed,
        failures: castFailureMask(source, update.ops),
      };
    });

  // A case/trim op that changes nothing should not pay for a full rebuild.
  // Bail out before touching transform state so the UI can simply report a no-op.
  const unchanged =
    prepared.length > 0 &&
    prepared.every(({ update, raw }) => {
      const before = current.columns[update.column].raw;
      if (raw.length !== before.length) return false;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== before[i]) return false;
      }
      return true;
    });
  if (unchanged) {
    post({
      type: "cleaned",
      requestId: message.requestId,
      columns: prepared.map(({ update }) => ({
        column: update.column,
        meta: metaFor(current, current.columns[update.column], update.column),
      })),
      stats: current.stats,
      count: sortedIds.length,
      queryMs: 0,
      facets: {},
      histograms: {},
      firstRows: [],
      changedTotal: changedTotalCells,
      castFailures: castFailureCounts(),
      noop: true,
    });
    return;
  }

  // Cleaning after a transform bakes the transforms in: the current (already
  // transformed) column set becomes the new clean source.
  transformSource = null;
  transformOps = [];
  const columns = current.columns.slice();
  const affected: number[] = [];

  for (const { update, source, raw } of prepared) {
    const column = update.column;
    cleanSource.set(column, source);
    if (update.ops.length === 0) cleanOpsApplied.delete(column);
    else cleanOpsApplied.set(column, update.ops.map((op) => ({ ...op })));

    const policy = nullPolicies.get(column) ?? EMPTY_NULL_POLICY;
    const previous = current.columns[column];
    const target = cleanTarget(update.ops, previous);
    recordChange(column, previous.raw, raw);
    const explicitType = typeOverrides.get(column);
    const rebuilt = ColumnData.create(previous.name, raw, policy, target.numberLocale, {
      type: explicitType ?? target.type,
      skipSuggestions: true,
      dateOrder: target.dateOrder,
      numberLocale: target.numberLocale,
    });
    if (explicitType !== undefined) rebuilt.setType(explicitType, true);
    const locale = numberLocales.get(column);
    if (locale !== undefined) rebuilt.setNumberLocale(locale);
    columns[column] = rebuilt;

    filters.delete(column);
    affected.push(column);
  }

  for (const { update, failures } of prepared) {
    if (failures === null) castFailureMasks.delete(update.column);
    else castFailureMasks.set(update.column, failures);
  }
  refreshCastFailureUnion(current.rowCount);
  const next = rebuildDataset(current, columns, affected);
  const newEngine = new QueryEngine(next);
  newEngine.setSpecialBits(
    "castFailures",
    castFailureUnion ?? new BitSet(next.rowCount),
  );
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
    changedTotal: changedTotalCells,
    castFailures: castFailureCounts(),
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
  recordChange(message.column, column.raw, rebuilt.raw);
  const typeOverride = typeOverrides.get(message.column);
  if (typeOverride !== undefined) rebuilt.setType(typeOverride, true);
  const locale = numberLocales.get(message.column);
  if (locale !== undefined) rebuilt.setNumberLocale(locale);
  columns[message.column] = rebuilt;

  const next = rebuildDataset(current, columns);
  const newEngine = new QueryEngine(next);
  applySpecials(newEngine);
  newEngine.setSpecialBits(
    "castFailures",
    castFailureUnion ?? new BitSet(next.rowCount),
  );
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
    changedTotal: changedTotalCells,
    castFailures: castFailureCounts(),
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
    recordChange(index, column.raw, next.raw);
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
  newEngine.setSpecialBits(
    "castFailures",
    castFailureUnion ?? new BitSet(next.rowCount),
  );
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
    changedTotal: changedTotalCells,
    castFailures: castFailureCounts(),
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
  for (const id of message.rowIds ?? []) {
    if (Number.isInteger(id) && id >= 0 && id < dataset.rowCount) excludedIds.add(id);
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
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
    firstChanged: changedFlagsSlice(0, FIRST_PAGE_ROWS) ?? undefined,
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
  cleanOpsApplied.clear();
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
    type: column.type,
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
  // Transforms change the row set, so previous cell-change positions are void.
  resetChangedCells();

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
    files: datasetFiles.length > 0 ? datasetFiles : undefined,
    encoding: datasetEncoding,
    delimiter: datasetDelimiter,
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
    notes: transformPreviewNotes(base, message.ops),
  });
}

const MAX_PREVIEW_SAMPLES = 3;

/** Human label for an impute strategy, including its group column. */
function imputeStrategyLabel(
  op: TransformOp & { kind: "impute" },
  columns: readonly ColumnData[],
): string {
  const strategy =
    op.strategy.kind === "constant" ? `constant “${op.strategy.value}”` : op.strategy.kind;
  const group =
    op.groupColumn === null ? "" : ` within ${columns[op.groupColumn]?.name ?? "group"}`;
  return `${strategy}${group}`;
}

/**
 * Per-op impact notes with before → after samples, computed by applying each
 * staged op to the result of the previous one so the details describe the
 * step the user is looking at.
 */
function transformPreviewNotes(
  base: Dataset,
  ops: readonly TransformOp[],
): TransformPreviewNote[] {
  const notes: TransformPreviewNote[] = [];
  let running = base;
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
    const after = applyTransformOps(base.name, running.columns, [op]);
    switch (op.kind) {
      case "dedupe": {
        const removed = running.rowCount - after.rowCount;
        notes.push({
          op: index,
          text: `Removes ${removed.toLocaleString()} identical row${removed === 1 ? "" : "s"} — every column is the key`,
        });
        break;
      }
      case "drop": {
        const name = running.columns[op.column]?.name;
        notes.push({
          op: index,
          text: name === undefined ? "Column already gone" : `Drops “${name}” and its cells`,
        });
        break;
      }
      case "impute": {
        const before = running.columns[op.column];
        const filled = after.columns[op.column];
        if (before === undefined || filled === undefined) break;
        let replaced = 0;
        const samples: { before: string; after: string }[] = [];
        for (let row = 0; row < before.raw.length; row++) {
          if (!before.isNull(before.raw[row])) continue;
          if (filled.isNull(filled.raw[row])) continue;
          replaced++;
          if (samples.length < MAX_PREVIEW_SAMPLES) {
            samples.push({ before: "(empty)", after: filled.raw[row] });
          }
        }
        notes.push({
          op: index,
          text: `Fills ${replaced.toLocaleString()} missing cell${replaced === 1 ? "" : "s"} (${imputeStrategyLabel(op, running.columns)})`,
          samples,
        });
        break;
      }
      case "combineDate": {
        const output = after.columns[after.columnCount - 1];
        if (output === undefined) break;
        let failed = 0;
        const samples: { before: string; after: string }[] = [];
        for (let row = 0; row < output.raw.length; row++) {
          if (!output.isNull(output.raw[row])) continue;
          let before = "";
          let allPartsMissing = true;
          for (const part of op.parts) {
            const value = running.columns[part.column]?.raw[row] ?? "";
            before = before === "" ? value : `${before} · ${value}`;
            if (value !== "" && !running.columns[part.column]?.isNull(value)) allPartsMissing = false;
          }
          if (allPartsMissing) continue;
          failed++;
          if (samples.length < MAX_PREVIEW_SAMPLES) {
            samples.push({ before, after: "(could not combine)" });
          }
        }
        notes.push({
          op: index,
          text: `Joins ${op.parts.length} part${op.parts.length === 1 ? "" : "s"} into “${output.name}” (${op.output}, ${op.order === "auto" ? "order per column" : `${op.order} order`})` +
            (failed > 0 ? ` · ${failed.toLocaleString()} row${failed === 1 ? "" : "s"} could not be combined` : ""),
          samples,
        });
        break;
      }
      case "flagAnomalies": {
        const output = after.columns[after.columnCount - 1];
        if (output === undefined) break;
        let flagged = 0;
        for (const value of output.raw) if (value === "Yes") flagged++;
        notes.push({
          op: index,
          text: `Adds “${output.name}”: ${flagged.toLocaleString()} row${flagged === 1 ? "" : "s"} flagged`,
        });
        break;
      }
      case "splitColumn": {
        const created = after.columnCount - running.columnCount + (op.dropOriginal ? 1 : 0);
        notes.push({
          op: index,
          text: `Splits into ${created} new column${created === 1 ? "" : "s"}${op.dropEmpty ? " after dropping empty parts" : ""}`,
        });
        break;
      }
      case "melt": {
        const added = after.rowCount - running.rowCount;
        notes.push({
          op: index,
          text: `Unpivots to ${after.rowCount.toLocaleString()} rows (+${added.toLocaleString()})`,
        });
        break;
      }
      case "aggregate": {
        notes.push({
          op: index,
          text: `Aggregates to ${after.rowCount.toLocaleString()} group${after.rowCount === 1 ? "" : "s"} across ${after.columnCount} columns`,
        });
        break;
      }
      case "groupBy": {
        notes.push({
          op: index,
          text: `Aggregates to ${after.rowCount.toLocaleString()} row${after.rowCount === 1 ? "" : "s"}`,
        });
        break;
      }
      default:
        break;
    }
    running = after;
  }
  return notes;
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
    if (column === undefined) return { column: index, changed: 0, total: 0, failed: 0 };
    const source = cleanSource.get(index) ?? column;
    const raw = update.ops.length === 0 ? source.raw : applyCleanOps(source.raw, update.ops);
    let changed = 0;
    for (let i = 0; i < raw.length; i++) if (raw[i] !== source.raw[i]) changed++;
    // For the last cast in the op list, count the cells that still do not
    // parse so the dialog can warn before committing ("12 can't be parsed").
    let castIndex = -1;
    for (let i = update.ops.length - 1; i >= 0; i--) {
      if (update.ops[i].kind === "cast") {
        castIndex = i;
        break;
      }
    }
    let failed = 0;
    let examples: string[] | undefined;
    if (castIndex >= 0) {
      const cast = update.ops[castIndex] as Extract<CleanOp, { kind: "cast" }>;
      const before =
        castIndex === 0 ? source.raw : applyCleanOps(source.raw, update.ops.slice(0, castIndex));
      const result = castColumn(before, {
        target: cast.target,
        policy: cast.policy,
        locale: cast.locale,
        dateOrder: cast.order,
      });
      failed = result.failed;
      examples = result.examples;
    } else {
      const cast = [...update.ops].reverse().find(
        (op) => op.kind === "toNumber" || op.kind === "toDate",
      );
      if (cast !== undefined) {
        for (let i = 0; i < raw.length; i++) {
          if (source.isNull(source.raw[i])) continue;
          const parsed =
            cast.kind === "toDate" ? parseDate(raw[i], cast.order) : parseNumber(raw[i], cast.locale);
          if (!Number.isFinite(parsed)) failed++;
        }
      }
    }
    return {
      column: index,
      changed,
      total: raw.length,
      failed,
      ...(examples === undefined ? {} : { examples }),
    };
  });
  post({ type: "cleanPreview", requestId: message.requestId, columns });
}

function metaFor(dataset: Dataset, column: ColumnData, index: number): ColumnMeta {
  const role = column.role ?? undefined;
  if (isNumericLikeType(column.type)) {
    column.numbers();
  }
  const patternProfile = dataset.patternProfiles[index] ?? null;
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
    ...(role === undefined ? {} : { role }),
    numberLocale: column.numberLocale,
    dateOrder: column.dateOrder,
    ...(column.type === "datetime" ? { timeZoneAware: column.timeZoneAware } : {}),
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
    suggestions: role === undefined ? column.suggestions : [],
    typeDowngrade: column.typeDowngrade,
    pattern:
      patternProfile === null
        ? null
        : {
            mask: patternProfile.mask,
            share: patternProfile.share,
            total: patternProfile.total,
            offCount: patternProfile.offCount,
            examples: patternProfile.examples,
          },
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
  const numeric = isNumericLikeType(column.type);
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
