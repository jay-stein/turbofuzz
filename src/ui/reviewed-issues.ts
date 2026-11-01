/**
 * Data-quality issues the analyst looked at and decided are fine (a birth year of -63 for a Roman emperor), per file name and check.
 * Session-only, like the optional and sensitive marks; the count is kept so the issue comes back if more rows are affected.
 * An in-memory copy works when storage is blocked.
 */
const KEY = "turbofuzz.reviewed.issues";

export interface ReviewedMark { rows: number; title: string }

let memory: Record<string, ReviewedMark> = {};
let loaded = false;

function read(): Record<string, ReviewedMark> {
  if (!loaded) {
    loaded = true;
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) memory = parsed as Record<string, ReviewedMark>;
      }
    } catch {
      // Keep the in-memory store.
    }
  }
  return memory;
}

function write(): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Session-only memory still holds the choice for this run.
  }
}

/** The marks for one file, by check id. */
export function getReviewed(dataset: string): Record<string, ReviewedMark> {
  const out: Record<string, ReviewedMark> = {};
  const prefix = `${dataset}|`;
  for (const [key, mark] of Object.entries(read())) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = mark;
  return out;
}

export function setReviewed(dataset: string, id: string, mark: ReviewedMark): void {
  read()[`${dataset}|${id}`] = mark;
  write();
}

export function clearReviewed(dataset: string, id: string): void {
  delete read()[`${dataset}|${id}`];
  write();
}
