import { toDateInputValue, toDateTimeValue } from "./dates.js";

/**
 * Whole numbers that are really dates: spreadsheet serial days, Unix seconds or
 * milliseconds, and yyyymmdd. Only offered when the column is named like a date;
 * nothing converts until the person says so.
 */
export type NumericDateFormat = "excelSerial" | "epochSeconds" | "epochMillis" | "yyyymmdd";

export const NUMERIC_DATE_LABELS: Record<NumericDateFormat, string> = {
  excelSerial: "spreadsheet serial numbers",
  epochSeconds: "Unix timestamps in seconds",
  epochMillis: "Unix timestamps in milliseconds",
  yyyymmdd: "yyyymmdd numbers",
};

const WHOLE = /^\d{1,13}$/;
/** 1954 to 2118 as spreadsheet serial days. */
const SERIAL_MIN = 20000;
const SERIAL_MAX = 80000;
/** 2000-01-01 to 2100-01-01. */
const SECONDS_MIN = 946_684_800;
const SECONDS_MAX = 4_102_444_800;
const SERIAL_EPOCH_OFFSET_DAYS = 25569;
const DAY_MS = 86_400_000;

/** The date text a numeric value stands for under a format, or null when it is out of range. */
export function numericDateText(value: string, format: NumericDateFormat): string | null {
  const text = value.trim();
  if (!WHOLE.test(text)) return null;
  const number = Number(text);
  switch (format) {
    case "excelSerial":
      return number >= SERIAL_MIN && number <= SERIAL_MAX ? toDateInputValue((number - SERIAL_EPOCH_OFFSET_DAYS) * DAY_MS) : null;
    case "epochSeconds":
      return text.length === 10 && number >= SECONDS_MIN && number <= SECONDS_MAX ? toDateTimeValue(number * 1000) : null;
    case "epochMillis":
      return text.length === 13 && number >= SECONDS_MIN * 1000 && number <= SECONDS_MAX * 1000 ? toDateTimeValue(number) : null;
    case "yyyymmdd": {
      if (text.length !== 8) return null;
      const year = Math.floor(number / 10000);
      const month = Math.floor(number / 100) % 100;
      const day = number % 100;
      if (year < 1900 || year > 2100) return null;
      const ms = Date.UTC(year, month - 1, day);
      const back = new Date(ms);
      if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
      return toDateInputValue(ms);
    }
  }
}

const NAME_HINT = /(date|timestamp|epoch|unix|yyyymmdd|excel|(^|[^a-z])(dt|ts|time)([^a-z]|$)|created|updated|modified|_at$|_on$)/i;

/** True for names like order_date, created_at, timestamp, Date. */
export function nameSaysDate(name: string): boolean {
  return NAME_HINT.test(name);
}

const FORMATS: readonly NumericDateFormat[] = ["yyyymmdd", "epochMillis", "epochSeconds", "excelSerial"];
const MIN_VALUES = 5;
const MIN_SHARE = 0.95;

/** The one format nearly every populated value fits, or null. Needs a date-like name and some variety. */
export function detectNumericDate(
  name: string,
  values: readonly string[],
): { format: NumericDateFormat; ratio: number; example: string; result: string } | null {
  if (!nameSaysDate(name) || values.length < MIN_VALUES) return null;
  const distinct = new Set(values);
  if (distinct.size < 2) return null;
  for (const format of FORMATS) {
    let ok = 0;
    let example = "";
    let result = "";
    for (const value of values) {
      const text = numericDateText(value, format);
      if (text !== null && ok++ === 0) {
        example = value.trim();
        result = text;
      }
    }
    if (ok / values.length >= MIN_SHARE) return { format, ratio: ok / values.length, example, result };
  }
  return null;
}
