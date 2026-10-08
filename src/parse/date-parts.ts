import { detectDateOrder, type DateOrder } from "./dates.js";

export type DatePartRole =
  | "auto"
  | "date"
  | "datetime"
  | "time"
  | "year"
  | "month"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "millisecond"
  | "meridiem"
  | "offset"
  | "epoch";

export interface DateComponents {
  year: number | null;
  month: number | null;
  day: number | null;
  hour: number | null;
  minute: number | null;
  second: number | null;
  millisecond: number | null;
  meridiem: "am" | "pm" | null;
  offsetMinutes: number | null;
}

export function emptyComponents(): DateComponents {
  return {
    year: null,
    month: null,
    day: null,
    hour: null,
    minute: null,
    second: null,
    millisecond: null,
    meridiem: null,
    offsetMinutes: null,
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ISO_DATETIME =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[Tt ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
const YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const DMY_OR_MDY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/;
const DAY_MONTH_YEAR = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{2,4})$/;
const MONTH_DAY_YEAR = /^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -](\d{2,4})$/;
const MONTH_YEAR = /^([A-Za-z]{3,9})[ -](\d{4})$/;
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*([AaPp](?:\.?[Mm]\.?)?)?$/;
const HOUR_MERIDIEM = /^(\d{1,2})\s*([AaPp](?:\.?[Mm]\.?)?)$/;

function normalize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, "$1");
}

function pivotYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

export function monthFromName(value: string): number | null {
  const key = value.trim().toLowerCase().replace(/\.$/, "").slice(0, 3);
  const index = MONTHS.indexOf(key);
  return index < 0 ? null : index + 1;
}

export function parseOffsetMinutes(value: string): number | null {
  const s = value.trim().toUpperCase();
  if (s === "") return null;
  if (s === "Z" || s === "UTC" || s === "GMT") return 0;
  const match = s.match(/^(?:(?:UTC|GMT)\s*)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (match === null) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? 0);
  if (hours > 14 || minutes > 59) return null;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
}

function meridiemOf(value: string): "am" | "pm" | null {
  const s = value.trim().toLowerCase();
  if (/^a(\.?m\.?)?$/.test(s)) return "am";
  if (/^p(\.?m\.?)?$/.test(s)) return "pm";
  return null;
}

export interface ParsedDateFields {
  year: number;
  month: number;
  day: number;
}

export function parseDateFields(value: string, order: DateOrder): ParsedDateFields | null {
  const s = normalize(value);
  if (s === "") return null;

  let match = s.match(YMD);
  if (match !== null) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return validDateFields(year, month, day);
  }

  match = s.match(DMY_OR_MDY);
  if (match !== null) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = pivotYear(Number(match[3]));
    const day = order === "dmy" ? a : b;
    const month = order === "dmy" ? b : a;
    return validDateFields(year, month, day);
  }

  match = s.match(DAY_MONTH_YEAR);
  if (match !== null) {
    const month = monthFromName(match[2]);
    if (month === null) return null;
    return validDateFields(pivotYear(Number(match[3])), month, Number(match[1]));
  }

  match = s.match(MONTH_DAY_YEAR);
  if (match !== null) {
    const month = monthFromName(match[1]);
    if (month === null) return null;
    return validDateFields(pivotYear(Number(match[3])), month, Number(match[2]));
  }

  match = s.match(MONTH_YEAR);
  if (match !== null) {
    const month = monthFromName(match[1]);
    if (month === null) return null;
    return validDateFields(Number(match[2]), month, 1);
  }

  return null;
}

function validDateFields(year: number, month: number, day: number): ParsedDateFields | null {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { year, month, day };
}

export interface ParsedClockFields {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  meridiem: "am" | "pm" | null;
}

export function parseClockFields(value: string): ParsedClockFields | null {
  const s = normalize(value);
  if (s === "") return null;

  let match = s.match(CLOCK);
  if (match !== null) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = match[3] === undefined ? 0 : Number(match[3]);
    const millisecond = match[4] === undefined ? 0 : Number(match[4].padEnd(3, "0"));
    const meridiem = match[5] === undefined ? null : meridiemOf(match[5]);
    if (match[5] !== undefined && meridiem === null) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    return { hour, minute, second, millisecond, meridiem };
  }

  match = s.match(HOUR_MERIDIEM);
  if (match !== null) {
    const hour = Number(match[1]);
    const meridiem = meridiemOf(match[2]);
    if (meridiem === null || hour > 12) return null;
    return { hour, minute: 0, second: 0, millisecond: 0, meridiem };
  }

  match = s.match(/^(\d{4})$/);
  if (match !== null) {
    const hour = Number(match[1].slice(0, 2));
    const minute = Number(match[1].slice(2));
    if (hour > 23 || minute > 59) return null;
    return { hour, minute, second: 0, millisecond: 0, meridiem: null };
  }

  match = s.match(/^(\d{6})$/);
  if (match !== null) {
    const hour = Number(match[1].slice(0, 2));
    const minute = Number(match[1].slice(2, 4));
    const second = Number(match[1].slice(4, 6));
    if (hour > 23 || minute > 59 || second > 59) return null;
    return { hour, minute, second, millisecond: 0, meridiem: null };
  }

  return null;
}

function parseEpochMs(value: string): number | null {
  const s = normalize(value);
  if (!/^-?\d{10,19}$/.test(s)) return null;
  const digits = s.replace("-", "").length;
  const number = Number(s);
  if (!Number.isFinite(number)) return null;
  if (digits <= 10) return number * 1000;
  if (digits <= 13) return number;
  if (digits <= 16) return Math.round(number / 1000);
  return Math.round(number / 1_000_000);
}

function applyIsoDatetime(value: string, out: DateComponents, withTime: boolean): boolean {
  const match = normalize(value).match(ISO_DATETIME);
  if (match === null) return false;
  const fields = validDateFields(Number(match[1]), Number(match[2]), Number(match[3]));
  if (fields === null) return false;
  out.year = fields.year;
  out.month = fields.month;
  out.day = fields.day;
  if (withTime) {
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    const millisecond = match[7] === undefined ? 0 : Number(match[7].padEnd(3, "0"));
    if (hour > 23 || minute > 59 || second > 59) return false;
    out.hour = hour;
    out.minute = minute;
    out.second = second;
    out.millisecond = millisecond;
    if (match[8] !== undefined) out.offsetMinutes = parseOffsetMinutes(match[8]);
  }
  return true;
}

/**
 * Applies one cell to the component accumulator according to its role.
 * Returns false when the cell is non-empty but cannot represent its role.
 */
export function parseDatePart(
  value: string,
  role: DatePartRole,
  order: DateOrder,
  out: DateComponents,
): boolean {
  const s = normalize(value);
  if (s === "") return false;

  switch (role) {
    case "date": {
      if (applyIsoDatetime(s, out, false)) return true;
      const fields = parseDateFields(s, order);
      if (fields === null) return false;
      out.year = fields.year;
      out.month = fields.month;
      out.day = fields.day;
      return true;
    }
    case "datetime": {
      if (applyIsoDatetime(s, out, true)) return true;
      const fields = parseDateFields(s, order);
      if (fields === null) return false;
      out.year = fields.year;
      out.month = fields.month;
      out.day = fields.day;
      return true;
    }
    case "time": {
      const clock = parseClockFields(s);
      if (clock === null) return false;
      out.hour = clock.hour;
      out.minute = clock.minute;
      out.second = clock.second;
      out.millisecond = clock.millisecond;
      if (clock.meridiem !== null) out.meridiem = clock.meridiem;
      return true;
    }
    case "year": {
      const match = s.match(/(\d{4})/) ?? s.match(/^(\d{2})$/);
      if (match === null) return false;
      out.year = pivotYear(Number(match[1]));
      return true;
    }
    case "month": {
      const numeric = Number(s);
      if (Number.isInteger(numeric) && s.match(/^\d{1,2}$/) !== null) {
        if (numeric < 1 || numeric > 12) return false;
        out.month = numeric;
        return true;
      }
      const month = monthFromName(s);
      if (month === null) return false;
      out.month = month;
      return true;
    }
    case "day": {
      if (s.match(/^\d{1,2}$/) === null) return false;
      const day = Number(s);
      if (day < 1 || day > 31) return false;
      out.day = day;
      return true;
    }
    case "hour": {
      if (s.match(/^\d{1,2}$/) === null) return false;
      const hour = Number(s);
      if (hour > 23) return false;
      out.hour = hour;
      return true;
    }
    case "minute":
    case "second": {
      if (s.match(/^\d{1,2}$/) === null) return false;
      const number = Number(s);
      if (number > 59) return false;
      if (role === "minute") out.minute = number;
      else out.second = number;
      return true;
    }
    case "millisecond": {
      if (s.match(/^\d{1,3}$/) === null) return false;
      out.millisecond = Number(s.padEnd(3, "0"));
      return true;
    }
    case "meridiem": {
      const meridiem = meridiemOf(s);
      if (meridiem === null) return false;
      out.meridiem = meridiem;
      return true;
    }
    case "offset": {
      const offset = parseOffsetMinutes(s);
      if (offset === null) return false;
      out.offsetMinutes = offset;
      return true;
    }
    case "epoch": {
      const ms = parseEpochMs(s);
      if (ms === null) return false;
      const date = new Date(ms);
      out.year = date.getUTCFullYear();
      out.month = date.getUTCMonth() + 1;
      out.day = date.getUTCDate();
      out.hour = date.getUTCHours();
      out.minute = date.getUTCMinutes();
      out.second = date.getUTCSeconds();
      out.millisecond = date.getUTCMilliseconds();
      return true;
    }
    case "auto": {
      if (applyIsoDatetime(s, out, true)) return true;
      const fields = parseDateFields(s, order);
      if (fields !== null) {
        out.year = fields.year;
        out.month = fields.month;
        out.day = fields.day;
        return true;
      }
      const clock = parseClockFields(s);
      if (clock !== null) {
        out.hour = clock.hour;
        out.minute = clock.minute;
        out.second = clock.second;
        out.millisecond = clock.millisecond;
        if (clock.meridiem !== null) out.meridiem = clock.meridiem;
        return true;
      }
      const ms = parseEpochMs(s);
      if (ms === null) return false;
      return parseDatePart(s, "epoch", order, out);
    }
  }
}

const NAME_HINTS: readonly [RegExp, DatePartRole][] = [
  [/datetime|date.?time|timestamp|time.?stamp/i, "datetime"],
  [/timezone|\btz\b|offset|\butc\b|zone/i, "offset"],
  [/\bepoch\b|unix/i, "epoch"],
  [/\byear\b|\byr\b/i, "year"],
  [/\bmonth\b|\bmth\b/i, "month"],
  [/\bday\b|\bdd\b/i, "day"],
  [/\bhour\b|\bhr[s]?\b|\bhh\b/i, "hour"],
  [/\bminute[s]?\b|\bmin[s]?\b|\bmm\b/i, "minute"],
  [/\bsecond[s]?\b|\bsec[s]?\b|\bss\b/i, "second"],
  [/milli|\bms\b/i, "millisecond"],
  [/meridiem|\bam\b|\bpm\b/i, "meridiem"],
  [/\bdate\b|\bdob\b/i, "date"],
  [/\btime\b/i, "time"],
];

/**
 * Suggests a role from the column name and its values. Name hints win, then
 * value shapes are checked (offset, datetime, date, time, epoch, then plain
 * integer ranges ordered from most specific to least).
 */
export function suggestRole(name: string, values: readonly string[]): DatePartRole {
  const samples: string[] = [];
  for (const value of values) {
    if (value.trim() === "") continue;
    samples.push(value);
    if (samples.length >= 200) break;
  }
  if (samples.length === 0) {
    for (const [pattern, role] of NAME_HINTS) {
      if (pattern.test(name)) return role;
    }
    return "auto";
  }

  let offset = 0;
  let datetime = 0;
  let date = 0;
  let time = 0;
  let epoch = 0;
  let numeric = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const value of samples) {
    if (parseOffsetMinutes(value) !== null) offset++;
    if (normalize(value).match(ISO_DATETIME) !== null) datetime++;
    if (parseDateFields(value, "dmy") !== null) date++;
    // Compact forms like 1430 or 235959 are only trusted when the column is
    // explicitly a time column; the auto-detector requires a colon or AM/PM.
    if ((value.includes(":") || /[ap]\.?m/i.test(value)) && parseClockFields(value) !== null) {
      time++;
    }
    if (parseEpochMs(value) !== null) epoch++;
    const number = Number(value.trim());
    if (Number.isInteger(number)) {
      numeric++;
      if (number < min) min = number;
      if (number > max) max = number;
    }
  }

  const ratio = (count: number): number => count / samples.length;
  if (ratio(offset) >= 0.8) return "offset";
  if (ratio(datetime) >= 0.8) return "datetime";
  if (ratio(date) >= 0.8) return "date";
  if (ratio(time) >= 0.8) return "time";
  if (ratio(epoch) >= 0.8) return "epoch";
  if (ratio(numeric) < 0.9) {
    for (const [pattern, role] of NAME_HINTS) {
      if (pattern.test(name)) return role;
    }
    if (samples.some((value) => value.includes(":"))) return "time";
    return "date";
  }

  for (const [pattern, role] of NAME_HINTS) {
    if (pattern.test(name)) return role;
  }
  if (min >= 1900 && max <= 2100) return "year";
  if (min >= 1 && max <= 12) return "month";
  if (min >= 1 && max <= 31) return "day";
  if (min >= 0 && max <= 23) return "hour";
  if (min >= 0 && max <= 59) return "minute";
  if (min >= 0 && max <= 999) return "millisecond";
  return "date";
}

/** Detects day-first vs month-first from samples (auto order). */
export function detectOrder(values: readonly string[]): DateOrder {
  return detectDateOrder(values);
}
