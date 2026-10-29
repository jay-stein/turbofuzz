import type { SensitiveLabel } from "../data/sensitivity.js";

/**
 * What the user decided about a possibly-sensitive column: not sensitive,
 * definitely sensitive, or a handling label. Keyed by column name and type (never
 * by position), so the same decision applies to next month's file. Mirrored in
 * sessionStorage like the merge dismissals; an in-memory copy keeps it working when
 * storage is blocked.
 */
export interface SensitiveMark {
  dismissed?: boolean;
  confirmed?: boolean;
  label?: SensitiveLabel;
}

const KEY = "turbofuzz.sensitive.marks";

let memory: Record<string, SensitiveMark> = {};
let loaded = false;

const keyFor = (name: string, type: string): string => `${name}\u0000${type}`;

function read(): Record<string, SensitiveMark> {
  if (!loaded) {
    loaded = true;
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          memory = parsed as Record<string, SensitiveMark>;
        }
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
    // Session-only memory still remembers the decision for this run.
  }
}

export function getSensitiveMark(name: string, type: string): SensitiveMark {
  return read()[keyFor(name, type)] ?? {};
}

/** Merges a change into the stored mark; an empty result removes it. */
export function setSensitiveMark(name: string, type: string, change: SensitiveMark): void {
  const store = read();
  const next: SensitiveMark = { ...store[keyFor(name, type)], ...change };
  if (next.dismissed !== true) delete next.dismissed;
  if (next.confirmed !== true) delete next.confirmed;
  if (next.label === undefined) delete next.label;
  if (Object.keys(next).length === 0) delete store[keyFor(name, type)];
  else store[keyFor(name, type)] = next;
  write();
}

/** Forgets every decision (tests, and a future "reset" action). */
export function clearSensitiveMarks(): void {
  memory = {};
  loaded = true;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
