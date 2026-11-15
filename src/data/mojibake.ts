import { MOJIBAKE, repairMojibake } from "../parse/encoding.js";
import { stratifiedSample } from "../parse/infer.js";

/**
 * Text that was decoded with the wrong encoding and stored that way: "Ã©" for "é", "â€™" for "’".
 * Found per column, by the classic double-encoding pattern, in 2% or more of the values.
 */
export interface MojibakeSummary {
  /** Cells that match the pattern (exact). */
  count: number;
  /** Populated cells (exact). */
  total: number;
  /** Cells the repair can fix exactly. */
  fixable: number;
  /** Up to three distinct values with what the repair makes of them (to null when it cannot). */
  examples: { from: string; to: string | null }[];
}

const SAMPLE = 2000;
const MIN_SHARE = 0.02;

/** True when the value carries the double-encoding pattern. */
export function looksMojibake(value: string): boolean {
  return MOJIBAKE.test(value);
}

/**
 * A sample decides whether the column is worth a full count, so an ordinary text column costs
 * about 2,000 pattern checks. Null when fewer than 2% of the populated values match.
 */
export function detectMojibake(raw: readonly string[], isMissing: (value: string) => boolean): MojibakeSummary | null {
  let hits = 0;
  let seen = 0;
  for (const value of stratifiedSample(raw, SAMPLE)) {
    if (value === "" || isMissing(value)) continue;
    seen++;
    if (MOJIBAKE.test(value)) hits++;
  }
  if (seen === 0 || hits / seen < MIN_SHARE / 2) return null;
  let count = 0;
  let total = 0;
  let fixable = 0;
  const examples: { from: string; to: string | null }[] = [];
  const shown = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i] ?? "";
    if (value === "" || isMissing(value)) continue;
    total++;
    if (!MOJIBAKE.test(value)) continue;
    count++;
    const fixed = repairMojibake(value);
    if (fixed !== null) fixable++;
    if (examples.length < 3 && !shown.has(value)) {
      shown.add(value);
      examples.push({ from: value, to: fixed });
    }
  }
  return count > 0 && count / total >= MIN_SHARE ? { count, total, fixable, examples } : null;
}
