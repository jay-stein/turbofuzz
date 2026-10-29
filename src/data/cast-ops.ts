import {
  formatDurationMs,
  parseDate,
  parseDuration,
  parseTimeOfDay,
  toDateInputValue,
  toDateTimeValue,
  toTimeInputValue,
  type DateOrder,
} from "../parse/dates.js";
import { isNullToken } from "../parse/null-tokens.js";
import { parseNumber, type NumberLocale } from "../parse/numbers.js";

export type CastTarget =
  | "integer"
  | "number"
  | "date"
  | "datetime"
  | "time"
  | "duration"
  | "boolean";

export type CastPolicy = "coerce" | "keep" | "reject";

export interface CastOptions {
  target: CastTarget;
  policy: CastPolicy;
  locale?: NumberLocale;
  dateOrder?: DateOrder;
}

/**
 * Share of non-empty values a conversion may blank before the user must say so.
 * Above it the dialogs require an explicit confirmation.
 */
export const CAST_LOSS_CONFIRM_SHARE = 0.01;

/**
 * True when turning this text into a number would change its digits: leading
 * zeros (007, 0412 345 678) or more digits than a double holds exactly.
 */
export function losesDigits(value: string): boolean {
  const trimmed = value.trim();
  return /^[+-]?0\d/.test(trimmed) || /^[+-]?\d{16,}$/.test(trimmed);
}

export interface CastResult {
  values: string[];
  changed: number;
  failed: number;
  /** 1 for each source row that did not parse under the cast. */
  failures: Uint8Array;
  examples: string[];
  applied: boolean;
  /** Non-empty source values (the base for loss percentages). */
  nonEmpty: number;
  /** Values whose digits a number cast would change (leading zeros, 16+ digits). */
  digitLoss: number;
}

const TRUE_VALUES = new Set(["true", "t", "yes", "y", "1"]);
const FALSE_VALUES = new Set(["false", "f", "no", "n", "0"]);

function castOne(value: string, options: CastOptions): { value: string; ok: boolean } {
  const locale = options.locale ?? "dot";
  const order = options.dateOrder ?? "dmy";
  switch (options.target) {
    case "integer": {
      const parsed = parseNumber(value, locale);
      return Number.isFinite(parsed) && Number.isInteger(parsed)
        ? { value: String(parsed), ok: true }
        : { value, ok: false };
    }
    case "number": {
      const parsed = parseNumber(value, locale);
      return Number.isFinite(parsed) ? { value: String(parsed), ok: true } : { value, ok: false };
    }
    case "date": {
      const parsed = parseDate(value, order);
      return Number.isFinite(parsed)
        ? { value: toDateInputValue(parsed), ok: true }
        : { value, ok: false };
    }
    case "datetime": {
      const parsed = parseDate(value, order);
      return Number.isFinite(parsed)
        ? { value: toDateTimeValue(parsed), ok: true }
        : { value, ok: false };
    }
    case "time": {
      const parsed = parseTimeOfDay(value);
      return Number.isFinite(parsed)
        ? { value: toTimeInputValue(parsed), ok: true }
        : { value, ok: false };
    }
    case "duration": {
      const parsed = parseDuration(value);
      return Number.isFinite(parsed)
        ? { value: formatDurationMs(parsed), ok: true }
        : { value, ok: false };
    }
    case "boolean": {
      const normalized = value.trim().toLowerCase();
      if (TRUE_VALUES.has(normalized)) return { value: "true", ok: true };
      if (FALSE_VALUES.has(normalized)) return { value: "false", ok: true };
      return { value, ok: false };
    }
  }
}

/**
 * Converts every non-null cell to the requested target. Invalid values follow
 * the pandas-style policy: coerce to blank, keep the original text, or reject
 * the whole conversion so the caller can show a preview instead of mutating.
 */
export function castColumn(values: readonly string[], options: CastOptions): CastResult {
  const out = values.slice();
  const failures = new Uint8Array(values.length);
  let changed = 0;
  let failed = 0;
  let nonEmpty = 0;
  let digitLoss = 0;
  const examples: string[] = [];
  const numeric = options.target === "integer" || options.target === "number";

  for (let index = 0; index < out.length; index++) {
    const raw = values[index] ?? "";
    if (isNullToken(raw)) continue;
    nonEmpty++;
    if (numeric && losesDigits(raw)) digitLoss++;
    const result = castOne(raw, options);
    if (!result.ok) {
      failed++;
      failures[index] = 1;
      if (examples.length < 5 && !examples.includes(raw)) examples.push(raw);
      if (options.policy === "coerce") {
        out[index] = "";
        changed++;
      }
      continue;
    }
    if (result.value !== raw) {
      out[index] = result.value;
      changed++;
    }
  }

  if (options.policy === "reject" && failed > 0) {
    return {
      values: values.slice(),
      changed: 0,
      failed,
      failures,
      examples,
      applied: false,
      nonEmpty,
      digitLoss,
    };
  }
  return { values: out, changed, failed, failures, examples, applied: true, nonEmpty, digitLoss };
}
