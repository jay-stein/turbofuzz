import type { SimilarCluster } from "../search/similar.js";

const KEY = "turbofuzz.merge.dismissed";

type Store = Record<string, string[]>;

/** In-memory mirror so dismissals work even when sessionStorage is blocked. */
let memory: Store = {};
let loaded = false;

function readStore(): Store {
  if (!loaded) {
    loaded = true;
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          const out: Store = {};
          for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (Array.isArray(value)) {
              out[name] = value.filter((entry): entry is string => typeof entry === "string");
            }
          }
          memory = out;
        }
      }
    } catch {
      // Keep the in-memory store.
    }
  }
  return memory;
}

function writeStore(store: Store): void {
  memory = store;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Session-only memory still remembers the dismissal for this run.
  }
}

/** Stable identity for a cluster: its member values, order-independent. */
export function clusterSignature(cluster: SimilarCluster): string {
  return cluster.values
    .map((entry) => entry.value)
    .sort()
    .join("\u0000");
}

export function isClusterDismissed(columnName: string, cluster: SimilarCluster): boolean {
  return readStore()[columnName]?.includes(clusterSignature(cluster)) ?? false;
}

export function dismissCluster(columnName: string, cluster: SimilarCluster): void {
  const store = readStore();
  const list = store[columnName] ?? [];
  const signature = clusterSignature(cluster);
  if (!list.includes(signature)) list.push(signature);
  store[columnName] = list;
  writeStore(store);
}

/** How many clusters were marked "Not a duplicate" for this column. */
export function dismissedClusterCount(columnName: string): number {
  return readStore()[columnName]?.length ?? 0;
}

export function clearDismissedClusters(): void {
  writeStore({});
}
