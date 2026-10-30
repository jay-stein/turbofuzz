import { parseWithFormat, type DateFormatPrefix } from "./date-format.js";

/**
 * How day/month dates are read: day first, month first, or an explicit format
 * ("fmt:YYYY-MM", see date-format.ts) that every value must follow.
 */
export type DateOrder = "dmy" | "mdy" | DateFormatPrefix;

/** The explicit format inside a date order, or null for day-first / month-first. */
export function orderFormat(order: DateOrder | undefined): string | null {
  return order !== undefined && order.startsWith("fmt:") ? order.slice(4) : null;
}

const DMY_OR_MDY = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;
// Same, followed by a clock time: 4/27/2021 11:02:10, 27.04.2021 09:05.
const DMY_OR_MDY_TIME = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})[ T]+(\d.*)$/;
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const YMD = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/;
const ISO_DATETIME =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[Tt ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

const MONTH_NUMBERS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAY_NAMES = new Set([
  "sun",
  "sunday",
  "mon",
  "monday",
  "tue",
  "tues",
  "tuesday",
  "wed",
  "wednesday",
  "thu",
  "thur",
  "thurs",
  "thursday",
  "fri",
  "friday",
  "sat",
  "saturday",
]);

const WEEKDAY_PREFIX = /^([A-Za-z]{3,9})\.?,?\s+/;
// Also accepts a hyphen between parts: 18-Jun-1996, 3-Mar-96.
const WEEKDAY_FIRST = /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+|-)([A-Za-z]{3,9})\.?,?(?:\s+|-)(\d{2,4})(?:\s+(.+))?$/i;
const MONTH_FIRST = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})(?:\s+(.+))?$/i;
const TRAILING_TIME =
  /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(?:([ap])\.?m\.?)?\s*(?:(z|utc|gmt)|([+-])(\d{1,2}):?(\d{2})?)?$/i;

function monthNumber(name: string): number | null {
  return MONTH_NUMBERS[name.toLowerCase()] ?? null;
}

/** Strict UTC epoch: rejects rolled-over dates like 2026-02-30 or 2026-13-01. */
function strictUtcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): number | null {
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return ms;
}

/** One parsed temporal value: epoch ms plus the details inference needs. */
export interface DateValue {
  ms: number;
  /** The source carried a time-of-day component (still a `datetime`). */
  hasTime: boolean;
  /** The source carried an explicit UTC/zone offset. */
  hasOffset: boolean;
}

interface Clock {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes: number;
  hasOffset: boolean;
}

const ZERO_CLOCK: Clock = { hour: 0, minute: 0, second: 0, millisecond: 0, offsetMinutes: 0, hasOffset: false };

/** Parses the time part after a date: 9:05, 11:02:10, 3:04 PM, with optional zone. */
function parseTrailingTime(trailing: string): Clock | null {
  const time = trailing.match(TRAILING_TIME);
  if (time === null) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = time[3] === undefined ? 0 : Number(time[3]);
  const millisecond = time[4] === undefined ? 0 : Number(time[4].padEnd(3, "0"));
  const meridiem = time[5] === undefined ? null : time[5].toLowerCase();
  if (meridiem !== null) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "p" && hour !== 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  let hasOffset = false;
  if (time[7] !== undefined) {
    const hours = Number(time[8]);
    const minutes = time[9] === undefined ? 0 : Number(time[9]);
    if (hours > 14 || minutes > 59) return null;
    offsetMinutes = (time[7] === "-" ? -1 : 1) * (hours * 60 + minutes);
    hasOffset = true;
  }
  return { hour, minute, second, millisecond, offsetMinutes, hasOffset };
}

/** Parses `D Mon YYYY` / `Mon D, YYYY`, optionally weekday-prefixed and timed. */
function parseMonthNameValue(raw: string): DateValue | null {
  let s = raw.trim().replace(/\s+/g, " ");
  if (s === "") return null;

  const weekday = s.match(WEEKDAY_PREFIX);
  if (weekday !== null && WEEKDAY_NAMES.has(weekday[1].toLowerCase())) {
    s = s.slice(weekday[0].length);
  }

  let match = s.match(WEEKDAY_FIRST);
  let day: number;
  let monthText: string;
  let yearText: string;
  let trailing: string | undefined;
  if (match !== null) {
    day = Number(match[1]);
    monthText = match[2];
    yearText = match[3];
    trailing = match[4];
  } else {
    match = s.match(MONTH_FIRST);
    if (match === null) return null;
    monthText = match[1];
    day = Number(match[2]);
    yearText = match[3];
    trailing = match[4];
  }

  const month = monthNumber(monthText);
  if (month === null || day < 1 || day > 31) return null;

  let year = Number(yearText);
  if (yearText.length < 3) year += year >= 70 ? 1900 : 2000;

  let clock: Clock = ZERO_CLOCK;
  if (trailing !== undefined) {
    const parsed = parseTrailingTime(trailing);
    if (parsed === null) return null;
    clock = parsed;
  }
  const { hour, minute, second, millisecond, offsetMinutes, hasOffset } = clock;

  const base = strictUtcMs(year, month, day, hour, minute, second, millisecond);
  if (base === null) return null;
  return {
    ms: base - offsetMinutes * 60_000,
    hasTime: trailing !== undefined,
    hasOffset,
  };
}

export function looksLikeDate(value: string): boolean {
  const s = value.trim();
  return ISO.test(s) || YMD.test(s) || DMY_OR_MDY.test(s);
}

export function detectDateOrder(values: readonly string[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const value of values) {
    const m = value.trim().match(DMY_OR_MDY) ?? value.trim().match(DMY_OR_MDY_TIME);
    if (m === null) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  return mdy > dmy ? "mdy" : "dmy";
}

/**
 * Classifies one cell as a calendar date or a timestamp, preserving whether
 * the source carried a time component and an explicit zone offset. Invalid
 * date-shaped values (including bad clock parts) return null.
 */
export function classifyDateValue(raw: string, order: DateOrder = "dmy"): DateValue | null {
  const s = raw.trim();
  if (s === "") return null;
  const format = orderFormat(order);
  if (format !== null) return parseWithFormat(s, format);

  let m = s.match(ISO_DATETIME);
  if (m !== null) {
    const millisecond = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
    const utc = strictUtcMs(
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      m[6] === undefined ? 0 : Number(m[6]),
      millisecond,
    );
    if (utc === null) return null;
    const zone = m[8];
    if (zone === undefined || /^z$/i.test(zone)) {
      return { ms: utc, hasTime: true, hasOffset: zone !== undefined };
    }
    const sign = zone.startsWith("-") ? -1 : 1;
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(3).replace(":", "") || 0);
    if (hours > 14 || minutes > 59) return null;
    return { ms: utc - sign * (hours * 60 + minutes) * 60_000, hasTime: true, hasOffset: true };
  }

  // A date followed by a broken time ("2026-10-16T25:00") must not silently
  // degrade to midnight; it is an invalid value.
  if (/^\d{4}-\d{1,2}-\d{1,2}[Tt ]/.test(s)) return null;

  m = s.match(ISO);
  if (m !== null) {
    const ms = strictUtcMs(Number(m[1]), Number(m[2]), Number(m[3]));
    return ms === null ? null : { ms, hasTime: false, hasOffset: false };
  }

  m = s.match(YMD);
  if (m !== null) {
    const ms = strictUtcMs(Number(m[1]), Number(m[2]), Number(m[3]));
    return ms === null ? null : { ms, hasTime: false, hasOffset: false };
  }

  m = s.match(DMY_OR_MDY);
  if (m !== null) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const day = order === "dmy" ? a : b;
    const month = order === "dmy" ? b : a;
    const ms = strictUtcMs(year, month, day);
    return ms === null ? null : { ms, hasTime: false, hasOffset: false };
  }

  m = s.match(DMY_OR_MDY_TIME);
  if (m !== null) {
    const clock = parseTrailingTime(m[4]);
    if (clock === null) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const day = order === "dmy" ? a : b;
    const month = order === "dmy" ? b : a;
    const base = strictUtcMs(year, month, day, clock.hour, clock.minute, clock.second, clock.millisecond);
    if (base === null) return null;
    return { ms: base - clock.offsetMinutes * 60_000, hasTime: true, hasOffset: clock.hasOffset };
  }

  return parseMonthNameValue(s);
}

export function parseDate(raw: string, order: DateOrder = "dmy"): number {
  const value = classifyDateValue(raw, order);
  return value === null ? NaN : value.ms;
}

const TIME_OF_DAY = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(?:([ap])\.?m\.?)?$/i;

/**
 * `HH:MM[:SS[.fff]]` (optionally 12-hour with am/pm) → milliseconds since
 * midnight. Out-of-range clocks (`25:10`) and non-clock strings are NaN.
 */
export function parseTimeOfDay(raw: string): number {
  const m = raw.trim().match(TIME_OF_DAY);
  if (m === null) return NaN;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] === undefined ? 0 : Number(m[3]);
  const millisecond = m[4] === undefined ? 0 : Number(m[4].padEnd(3, "0"));
  const meridiem = m[5] === undefined ? null : m[5].toLowerCase();
  if (meridiem !== null) {
    if (hour < 1 || hour > 12) return NaN;
    if (meridiem === "p" && hour !== 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59 || second > 59) return NaN;
  return ((hour * 60 + minute) * 60 + second) * 1000 + millisecond;
}

const DURATION_CLOCK = /^(\d{1,9}):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/;
const DURATION_UNITS = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi;
const UNIT_MS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1_000,
};

/**
 * Elapsed time. The clock form requires two colons (`H:MM:SS`, hours may
 * exceed 23); the unit form needs explicit h/m/s/d letters (`1h 30m`).
 * One-colon `HH:MM` stays ambiguous and is rejected here.
 */
export function parseDuration(raw: string): number {
  const s = raw.trim();
  if (s === "") return NaN;
  const clock = s.match(DURATION_CLOCK);
  if (clock !== null) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3]);
    const millis = clock[4] === undefined ? 0 : Number(clock[4].padEnd(3, "0"));
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
  }
  if (!/[a-z]/i.test(s)) return NaN;
  DURATION_UNITS.lastIndex = 0;
  let total = 0;
  let consumed = "";
  let match: RegExpExecArray | null;
  while ((match = DURATION_UNITS.exec(s)) !== null) {
    consumed += match[0];
    total += Number(match[1]) * UNIT_MS[match[2].toLowerCase()[0]];
  }
  const stripped = s.replace(/[\s,]+/g, "").toLowerCase();
  const consumedStripped = consumed.replace(/[\s,]+/g, "").toLowerCase();
  if (consumedStripped.length !== stripped.length) return NaN;
  return total;
}

export function toDateInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM-DDTHH:MM` for a `datetime-local` input (UTC wall time). */
export function toDateTimeInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  const date = toDateInputValue(epochMs);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${date}T${h}:${min}`;
}

/** Parses a `datetime-local` value as UTC, matching the column data model. */
export function fromDateTimeInputValue(value: string): number {
  const m = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m === null) return NaN;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] === undefined ? 0 : Number(m[6]),
  );
}

/** `HH:MM` for a `time` input, from ms since midnight. */
export function toTimeInputValue(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `H:MM:SS` (sign preserved) for elapsed milliseconds. */
export function formatDurationMs(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const total = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Canonical ISO 8601 timestamp for CSV/recipe export. */
export function toDateTimeValue(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.000Z$/, "Z");
}
