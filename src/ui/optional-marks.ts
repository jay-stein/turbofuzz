/**
 * Columns the user marked optional (true) or required (false), keyed by column
 * name so the choice carries to next month's file. Session-only, like the
 * sensitive marks; an in-memory copy works when storage is blocked.
 */
const KEY = "turbofuzz.optional.marks";

let memory: Record<string, boolean> = {};
let loaded = false;

function read(): Record<string, boolean> {
  if (!loaded) {
    loaded = true;
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          memory = parsed as Record<string, boolean>;
        }
      }
    } catch {
      // Keep the in-memory store.
    }
  }
  return memory;
}

export function getOptionalMarks(): Record<string, boolean> {
  return { ...read() };
}

/** Records the choice; marking a name the way detection would anyway is still stored. */
export function setOptionalMark(name: string, optional: boolean): void {
  read()[name] = optional;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Session-only memory still holds the choice for this run.
  }
}
