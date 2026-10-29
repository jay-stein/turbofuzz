import type { ColumnMeta } from "../worker/protocol.js";
import { schemaFingerprint } from "./rules.js";
import type { DQScore } from "./score.js";

/**
 * Local history (decision D5): one small snapshot per load, kept in this browser
 * only. A snapshot holds counts and rates, never cell values; category labels are
 * stored only for low-cardinality columns that are not flagged sensitive.
 */
export interface ColumnSnapshot {
  name: string;
  type: string;
  /** Share of rows populated, 0..1. */
  fill: number;
  distinct: number;
  /** Labels of a small closed set; absent for sensitive or high-cardinality columns. */
  labels?: string[];
}

export interface Snapshot {
  /** Normalised dataset name; snapshots of the same name are compared. */
  key: string;
  at: number;
  fingerprint: string;
  rowCount: number;
  overall: number | null;
  dimensions: Record<string, number | null>;
  columns: ColumnSnapshot[];
  /** Rule id -> pass rate, 0..1. */
  ruleRates: Record<string, number>;
}

export const MAX_LABELS = 12;
export const MAX_SNAPSHOTS = 30;

export function historyKey(datasetName: string): string {
  return datasetName.trim().toLowerCase();
}

export function buildSnapshot(
  datasetName: string,
  metas: readonly ColumnMeta[],
  rowCount: number,
  score: DQScore,
  sensitiveNames: ReadonlySet<string>,
  ruleRates: Record<string, number> = {},
  at: number = Date.now(),
): Snapshot {
  const dimensions: Record<string, number | null> = {};
  for (const dimension of score.dimensions) dimensions[dimension.label] = dimension.score;
  return {
    key: historyKey(datasetName),
    at,
    fingerprint: schemaFingerprint(metas),
    rowCount,
    overall: score.overall,
    dimensions,
    columns: metas.map((meta) => {
      const labels = meta.categories?.labels;
      const keep =
        labels !== undefined && labels.length > 0 && labels.length <= MAX_LABELS && !sensitiveNames.has(meta.name);
      return {
        name: meta.name,
        type: meta.type,
        fill: rowCount === 0 ? 0 : (rowCount - meta.stats.nulls) / rowCount,
        distinct: meta.stats.distinct,
        ...(keep ? { labels: [...labels] } : {}),
      };
    }),
    ruleRates,
  };
}

export interface SnapshotDiff {
  rowDelta: number;
  scoreDelta: number | null;
  added: string[];
  removed: string[];
  retyped: { name: string; from: string; to: string }[];
  fillShifts: { name: string; from: number; to: number }[];
  newCategories: { name: string; labels: string[] }[];
  /** True when nothing differs worth showing. */
  unchanged: boolean;
}

/** Fill-rate shifts smaller than this many points are noise. */
export const FILL_SHIFT = 0.05;

export function diffSnapshots(previous: Snapshot, current: Snapshot): SnapshotDiff {
  const before = new Map(previous.columns.map((column) => [column.name, column]));
  const after = new Map(current.columns.map((column) => [column.name, column]));
  const added = current.columns.filter((column) => !before.has(column.name)).map((column) => column.name);
  const removed = previous.columns.filter((column) => !after.has(column.name)).map((column) => column.name);
  const retyped: SnapshotDiff["retyped"] = [];
  const fillShifts: SnapshotDiff["fillShifts"] = [];
  const newCategories: SnapshotDiff["newCategories"] = [];
  for (const column of current.columns) {
    const old = before.get(column.name);
    if (old === undefined) continue;
    if (old.type !== column.type) retyped.push({ name: column.name, from: old.type, to: column.type });
    if (Math.abs(old.fill - column.fill) >= FILL_SHIFT) fillShifts.push({ name: column.name, from: old.fill, to: column.fill });
    if (old.labels !== undefined && column.labels !== undefined) {
      const known = new Set(old.labels);
      const fresh = column.labels.filter((label) => !known.has(label));
      if (fresh.length > 0) newCategories.push({ name: column.name, labels: fresh });
    }
  }
  const scoreDelta = previous.overall !== null && current.overall !== null ? current.overall - previous.overall : null;
  const rowDelta = current.rowCount - previous.rowCount;
  return {
    rowDelta,
    scoreDelta,
    added,
    removed,
    retyped,
    fillShifts,
    newCategories,
    unchanged:
      rowDelta === 0 &&
      added.length + removed.length + retyped.length + fillShifts.length + newCategories.length === 0 &&
      (scoreDelta === null || Math.abs(scoreDelta) < 0.05),
  };
}

export interface HistoryStore {
  list(key: string): Promise<Snapshot[]>;
  add(snapshot: Snapshot): Promise<void>;
  clear(): Promise<void>;
}

/** The same file reloaded within a minute is not a new point in the history. */
export function isDuplicateLoad(last: Snapshot | undefined, next: Snapshot): boolean {
  return last !== undefined && last.fingerprint === next.fingerprint && last.rowCount === next.rowCount && next.at - last.at < 60_000;
}

const DB_NAME = "turbofuzz.history";
const STORE = "snapshots";

/** The IndexedDB-backed store, or null when IndexedDB is missing or blocked (the tab then hides). */
export function openIndexedDbStore(): Promise<HistoryStore | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { autoIncrement: true });
        store.createIndex("key", "key");
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
          new Promise((done, fail) => {
            const tx = db.transaction(STORE, mode);
            const req = work(tx.objectStore(STORE));
            req.onsuccess = () => done(req.result);
            req.onerror = () => fail(req.error);
          });
        resolve({
          list: async (key) => {
            const all = await run("readonly", (store) => store.index("key").getAll(key));
            return (all as Snapshot[]).sort((a, b) => a.at - b.at);
          },
          add: async (snapshot) => {
            await run("readwrite", (store) => store.add(snapshot));
            // Keep only the newest MAX_SNAPSHOTS per dataset.
            const keys = (await run("readonly", (store) => store.index("key").getAllKeys(snapshot.key))) as IDBValidKey[];
            const extra = keys.length - MAX_SNAPSHOTS;
            for (let i = 0; i < extra; i++) await run("readwrite", (store) => store.delete(keys[i]));
          },
          clear: async () => {
            await run("readwrite", (store) => store.clear());
          },
        });
      };
    } catch {
      resolve(null);
    }
  });
}

/** In-memory store, for tests. */
export function memoryStore(): HistoryStore {
  let all: Snapshot[] = [];
  return {
    list: async (key) => all.filter((snapshot) => snapshot.key === key).sort((a, b) => a.at - b.at),
    add: async (snapshot) => {
      all.push(snapshot);
      const mine = all.filter((entry) => entry.key === snapshot.key);
      if (mine.length > MAX_SNAPSHOTS) all = all.filter((entry) => entry.key !== snapshot.key || mine.indexOf(entry) >= mine.length - MAX_SNAPSHOTS);
    },
    clear: async () => {
      all = [];
    },
  };
}
