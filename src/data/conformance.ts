import { classifyDateValue, type DateOrder } from "../parse/dates.js";
import { stratifiedSample } from "../parse/infer.js";
import { parseNumber, type NumberLocale } from "../parse/numbers.js";
import type { NullPolicy } from "../parse/null-tokens.js";
import { isNullWithPolicy } from "../parse/null-tokens.js";
import type { ColumnType } from "../types.js";

/** Intended type a column is judged against; storage type may differ. */
export type IntendedType = "integer" | "number" | "date" | "datetime";

/**
 * Exact conformance of a column's cells against its intended type. The intended
 * type comes from the majority of values (not a 95% cliff), and the counts are
 * one pass over every row, so a Quantity column with 12% "ERROR" is an integer
 * column with that many non-conforming cells instead of a category that hides them.
 */
export interface Conformance {
  intended: IntendedType;
  /** Non-null cells that fit the intended type. */
  conforming: number;
  /** Non-null cells that do not; each is counted once. */
  nonConforming: number;
  /** Up to three distinct non-conforming values. */
  examples: string[];
}

/** Share of sampled values that must fit a type for it to be the intended one. */
export const INTENDED_MIN_SHARE = 0.6;
const SAMPLE = 2000;
const PROBE_MIN_SHARE = 0.4;
const MIN_VALUES = 5;
const INTEGER = /^[+-]?\d{1,15}$/;
const INTEGER_ZERO_TAIL = /^[+-]?\d+\.0+$/;

const STORAGE_NUMERIC: ReadonlySet<ColumnType> = new Set(["integer", "number"]);
const STORAGE_DATE: ReadonlySet<ColumnType> = new Set(["date", "datetime"]);

function fitsInteger(value: string): boolean {
  return INTEGER.test(value) || INTEGER_ZERO_TAIL.test(value);
}

/** Does one trimmed value parse as the intended type? Shared with the rows-affected pass. */
export function rowFitsIntended(
  value: string,
  type: IntendedType,
  locale: NumberLocale,
  dateOrder: DateOrder,
): boolean {
  return fitsType(value, type, locale, dateOrder);
}

function fitsType(
  value: string,
  type: IntendedType,
  locale: NumberLocale,
  dateOrder: DateOrder,
): boolean {
  switch (type) {
    // Integer columns judge parsability like the old type-conflict rule did:
    // a stray decimal is a format matter, not a non-conforming cell.
    case "integer":
    case "number":
      return Number.isFinite(parseNumber(value, locale));
    case "date":
    case "datetime":
      return classifyDateValue(value, dateOrder) !== null;
  }
}

/**
 * Picks the intended type. A typed numeric/temporal column keeps its type;
 * text-like storage (category, string) is promoted only when a clear majority
 * of ALL non-null values fit (an exact pass, so a periodic sample cannot hide
 * or inflate the junk share). Identifiers and booleans are never given an
 * intended type, so codes such as phone numbers and ticket ids are not judged
 * as numbers.
 */
function chooseIntended(
  storage: ColumnType,
  raw: readonly string[],
  nullPolicy: NullPolicy,
  locale: NumberLocale,
  dateOrder: DateOrder,
): IntendedType | null {
  if (STORAGE_NUMERIC.has(storage) || STORAGE_DATE.has(storage)) {
    return storage as IntendedType;
  }
  if (storage !== "category" && storage !== "string") return null;

  // Cheap gate: the exact pass over every row only runs when a sample shows a
  // plausible numeric share (well under the majority bar, to tolerate sampling
  // noise), so free-text columns skip it.
  let probed = 0;
  let probedNumbers = 0;
  for (const value of stratifiedSample(raw, SAMPLE)) {
    if (isNullWithPolicy(value, nullPolicy)) continue;
    probed++;
    if (Number.isFinite(parseNumber(value.trim(), locale))) probedNumbers++;
  }
  if (probed < MIN_VALUES) return null;

  let total = 0;
  let integers = 0;
  let numbers = 0;
  let leadingZero = false;
  for (let i = 0; probedNumbers / probed >= PROBE_MIN_SHARE && i < raw.length; i++) {
    if (isNullWithPolicy(raw[i], nullPolicy)) continue;
    const value = raw[i].trim();
    total++;
    if (Number.isFinite(parseNumber(value, locale))) {
      numbers++;
      if (fitsInteger(value)) integers++;
      if (value.length > 1 && value.charCodeAt(0) === 48 && /^0\d+$/.test(value)) {
        leadingZero = true;
      }
    }
  }
  if (total >= MIN_VALUES && numbers / total >= INTENDED_MIN_SHARE) {
    // Leading-zero digit strings are codes, whatever share parses.
    if (leadingZero) return null;
    return integers / numbers >= 0.95 ? "integer" : "number";
  }

  // Dates are costlier to classify, so judge them on a sample.
  let dates = 0;
  let times = false;
  let sampled = 0;
  for (const value of stratifiedSample(raw, SAMPLE)) {
    if (isNullWithPolicy(value, nullPolicy)) continue;
    sampled++;
    const parsed = classifyDateValue(value.trim(), dateOrder);
    if (parsed !== null) {
      dates++;
      if (parsed.hasTime) times = true;
    }
  }
  if (sampled >= MIN_VALUES && dates / sampled >= INTENDED_MIN_SHARE) {
    return times ? "datetime" : "date";
  }
  return null;
}

/**
 * One exact pass over every non-null cell. Returns null when the column has no
 * intended type (free text, identifiers, booleans, categories of words).
 */
export function measureConformance(
  raw: readonly string[],
  storage: ColumnType,
  nullPolicy: NullPolicy,
  locale: NumberLocale,
  dateOrder: DateOrder,
): Conformance | null {
  const intended = chooseIntended(storage, raw, nullPolicy, locale, dateOrder);
  if (intended === null) return null;

  let conforming = 0;
  let nonConforming = 0;
  const examples: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (isNullWithPolicy(value, nullPolicy)) continue;
    const trimmed = value.trim();
    if (fitsType(trimmed, intended, locale, dateOrder)) {
      conforming++;
    } else {
      nonConforming++;
      if (examples.length < 3 && !examples.includes(trimmed)) examples.push(trimmed);
    }
  }
  return { intended, conforming, nonConforming, examples };
}
