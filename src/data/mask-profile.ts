import { skipsFormatCheck } from "./semantic-type.js";
import { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";

/** Dominant format of a column and the rows that break it. */
export interface PatternProfile {
  column: number;
  /** Run-length mask: letters -> A, digits -> 9, separators kept literal. */
  mask: string;
  /** Share of sampled non-null cells matching the dominant mask (0–1). */
  share: number;
  /** Non-null cells in the whole column. */
  total: number;
  /** Non-null cells whose mask differs from the dominant one. */
  offCount: number;
  /** Rows with an off-pattern value (null rows are never set). */
  offBits: BitSet;
  /** Up to 3 distinct off-pattern examples. */
  examples: string[];
}

/** Below this many non-null cells a dominant format is not meaningful. */
const MIN_CELLS = 50;
/** The dominant mask must cover at least this share of the sample. */
const MIN_SHARE = 0.8;
/** Non-null cells sampled to discover the dominant mask. */
const SAMPLE_CAP = 2000;
/** Single-run masks (pure text or pure digits) add nothing over the type. */
const MIN_MASK_RUNS = 2;
/** Masks longer than this many runs read as free-form (URLs, sentences). */
const MAX_MASK_RUNS = 24;
const MAX_EXAMPLES = 3;

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

const PATTERN_TYPES = new Set(["string", "category", "identifier"]);

/**
 * Run-length character mask for one value: consecutive letters collapse to a
 * single `A`, digits to a single `9`, and punctuation stays literal (repeated
 * separators collapse too). "AB-1234" and "CD-5678" share the mask "A-9";
 * "John Smith" is "A A"; "2000" is "9".
 */
export function maskFor(value: string): string {
  let out = "";
  let previous = "";
  for (const char of value.trim()) {
    const code = char.codePointAt(0) ?? 0;
    if (ZERO_WIDTH.has(code)) continue;
    const cls =
      code >= 48 && code <= 57
        ? "9"
        : (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code > 127
          ? "A"
          : char;
    if (cls === previous) continue;
    out += cls;
    previous = cls;
  }
  return out;
}

const CATEGORY_LABEL_MAX = 30;

/**
 * Dominant-format profiles for text-like columns (string/category/identifier).
 * The mask is discovered from a strided sample; the off-pattern bitset is a
 * full pass so every breaking cell can be filtered and shown. Columns whose
 * dominant mask is a single run (free text, plain digits), covers less than
 * `MIN_SHARE` of the sample, or has no off-pattern cells return no profile.
 */
export function computePatternProfiles(
  columns: readonly ColumnData[],
  rowCount: number,
  only?: ReadonlySet<number>,
): PatternProfile[] {
  const profiles: PatternProfile[] = [];
  for (let column = 0; column < columns.length; column++) {
    if (only !== undefined && !only.has(column)) continue;
    const data = columns[column];
    if (data?.role === "provenance") continue;
    if (data === undefined || !PATTERN_TYPES.has(data.type)) continue;
    // URLs, names, addresses and free text legitimately vary in shape.
    if (skipsFormatCheck(data.semantic)) continue;
    // A short value list (age bands, ratings) is a set of labels, not one format.
    if (data.type === "category" && data.stats.distinct <= CATEGORY_LABEL_MAX) continue;
    const total = rowCount - data.stats.nulls;
    if (total < MIN_CELLS) continue;

    const step = Math.max(1, Math.floor(total / SAMPLE_CAP));
    const counts = new Map<string, number>();
    let sampled = 0;
    let seen = 0;
    for (let row = 0; row < rowCount; row++) {
      if (data.nullMask.get(row)) continue;
      if (seen++ % step !== 0) continue;
      const mask = maskFor(data.raw[row]);
      if (mask === "" || mask.length > MAX_MASK_RUNS) continue;
      counts.set(mask, (counts.get(mask) ?? 0) + 1);
      sampled++;
    }
    if (sampled < MIN_CELLS) continue;
    let mask = "";
    let best = 0;
    for (const [candidate, count] of counts) {
      if (count > best) {
        best = count;
        mask = candidate;
      }
    }
    if (mask.length < MIN_MASK_RUNS) continue;
    const share = best / sampled;
    if (share < MIN_SHARE) continue;

    const offBits = new BitSet(rowCount);
    const examples: string[] = [];
    const seenExamples = new Set<string>();
    let offCount = 0;
    for (let row = 0; row < rowCount; row++) {
      if (data.nullMask.get(row)) continue;
      const value = data.raw[row];
      if (maskFor(value) === mask) continue;
      offBits.set(row);
      offCount++;
      if (examples.length < MAX_EXAMPLES && !seenExamples.has(value)) {
        seenExamples.add(value);
        examples.push(value);
      }
    }
    if (offCount === 0) continue;
    profiles.push({ column, mask, share, total, offCount, offBits, examples });
  }
  return profiles;
}
