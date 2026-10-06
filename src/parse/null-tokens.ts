// Exact tokens (after trim + lowercase) — fast path for the common cases.
const EXACT_NULLS = new Set([
  "",
  "-",
  "--",
  "---",
  "----",
  "—",
  "–",
  "?",
  "??",
  "???",
  "...",
  "…",
  "####",
  "null",
  "nil",
  "none",
  "nan",
  "na",
  "n/a",
  "n.a",
  "n.a.",
  "#n/a",
  "undefined",
  "missing",
  "unknown",
  "unspecified",
  "tbd",
  "tba",
  "empty",
  "blank",
  "(empty)",
  "(blank)",
  "(null)",
  "[empty]",
  "[blank]",
  "[null]",
  "<na>",
  "<null>",
  "<none>",
  "not available",
  "not applicable",
  "not provided",
  "not specified",
  "no data",
  "no value",
  "no answer",
  "no response",
  "null value",
  "none supplied",
  "\\n",
  "#value!",
  "#div/0!",
  "#ref!",
  "#name?",
  "#num!",
  "#null!",
  "#error!",
]);

// Compact forms: punctuation, separators and spacing are stripped, so
// "N/A", "N.A.", "N / A", "#N/A" and "<NA>" all reduce to "na".
const COMPACT_NULLS = new Set([
  "na",
  "null",
  "nil",
  "none",
  "nan",
  "undefined",
  "missing",
  "unknown",
  "unspecified",
  "tbd",
  "tba",
  "empty",
  "blank",
  "notavailable",
  "notapplicable",
  "notprovided",
  "notspecified",
  "nodata",
  "novalue",
  "noanswer",
  "noresponse",
  "nullvalue",
  "nonesupplied",
]);

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

// First letters of every COMPACT_NULLS key: n, m, u, t, e, b.
const COMPACT_FIRST = new Set([98, 101, 109, 110, 116, 117]);

/**
 * Per-column override of the global null heuristic. `extra` tokens are treated
 * as null even if the heuristic would not; `keep` tokens are never treated as
 * null (e.g. a town literally called "NULL"). Matching is exact on the raw cell
 * value, so the user un-nulls precisely the tokens they see.
 */
export interface NullPolicy {
  readonly extra: ReadonlySet<string>;
  readonly keep: ReadonlySet<string>;
}

export function createNullPolicy(
  extra: Iterable<string> = [],
  keep: Iterable<string> = [],
): NullPolicy {
  return { extra: new Set(extra), keep: new Set(keep) };
}

export const EMPTY_NULL_POLICY: NullPolicy = { extra: new Set(), keep: new Set() };

export function isNullWithPolicy(raw: string, policy: NullPolicy): boolean {
  if (policy.keep.size > 0 && policy.keep.has(raw)) return false;
  if (policy.extra.size > 0 && policy.extra.has(raw)) return true;
  return isNullToken(raw);
}

/** Array-based variant used by the UI with the serialized policy from ColumnMeta. */
export function isNullWithWire(
  raw: string,
  extra: readonly string[],
  keep: readonly string[],
): boolean {
  if (keep.length > 0 && keep.includes(raw)) return false;
  if (extra.length > 0 && extra.includes(raw)) return true;
  return isNullToken(raw);
}

/**
 * True for common missing-value markers. Case, surrounding/inner whitespace,
 * separators, zero-width characters and punctuation variants are all handled.
 *
 * Deliberately NOT null: boolean/word values ("No", "N", "Yes"), zero ("0"),
 * numeric sentinels like "-999" (could be real data), and "nat" (a name, and
 * the pandas NaT marker is only meaningful inside datetime columns).
 */
export function isNullToken(raw: string): boolean {
  // Fast reject, no allocations: no null phrase starts with a digit, and
  // negative numbers ("-999") are real values.
  const firstCode = raw.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) return false;
  if (firstCode === 45 && raw.length > 1 && raw.charCodeAt(1) >= 48) return false;

  // Cheap reject before allocating: a long value without padding cannot be a
  // null phrase (the longest phrase is ~15 characters).
  if (raw.length > 32 && firstCode > 32 && raw.charCodeAt(raw.length - 1) > 32) {
    return false;
  }

  const value = raw.trim().toLowerCase();
  if (value === "") return true;
  // No null phrase is this long, so skip the compact pass for real text.
  if (value.length > 24) return false;
  if (EXACT_NULLS.has(value)) return true;

  // Scan without allocating: any digit rules out a compact null phrase, and
  // the first kept character must be one that a phrase can start with.
  let first = 0;
  let kept = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 48 && code <= 57) return false;
    if (code >= 97 && code <= 122) {
      if (kept === 0) first = code;
      kept++;
    } else if (code > 127 && !ZERO_WIDTH.has(code)) {
      if (kept === 0) first = code;
      kept++;
    }
  }
  if (kept === 0) return true;
  if (kept < 2 || kept > 15 || !COMPACT_FIRST.has(first)) return false;

  let compact = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      compact += value[i];
    } else if (code > 127 && !ZERO_WIDTH.has(code)) {
      compact += value[i];
    }
  }
  return COMPACT_NULLS.has(compact);
}
