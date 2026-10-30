/**
 * Explicit date formats: "YYYY-MM", "DD.MM.YYYY HH:mm", or strftime ("%Y-%m"). Used
 * when automatic reading (ISO, day-first or month-first) does not fit a column, e.g.
 * year-month values like 1749-01. A format is stored where a date order goes, as
 * "fmt:<pattern>", so every place that reads dates with an order reads it too.
 *
 * Tokens (case matters: MM is month, mm is minutes):
 *   YYYY year · YY two-digit year (70-99 → 1900s) · Q quarter 1-4
 *   MMMM / MMM month name (full or short, either is accepted) · MM / M month number
 *   DD / D day · dddd / ddd weekday name (read and ignored)
 *   HH / H hour 0-23 · hh / h hour 1-12 with A · mm minutes · ss seconds
 *   S / SS / SSS fraction of a second · A / a AM or PM · Z offset (Z, +10:00, +1000)
 *   [text] literal text · a space matches one or more spaces · anything else is literal
 * Parts a format leaves out start at their first value: no day means the 1st, no
 * month means January (or the quarter's first month).
 */

export type DateFormatPrefix = `fmt:${string}`;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};
const MONTH_WORD = "[A-Za-z]{3,9}\\.?";
const WEEKDAY_WORD = "[A-Za-z]{2,9}\\.?";

type Field = "year" | "year2" | "quarter" | "monthName" | "month" | "day" | "hour" | "hour12" | "minute" | "second" | "fraction" | "meridiem" | "offset" | "skip";

interface Compiled {
  regex: RegExp;
  fields: Field[];
  hasTime: boolean;
  hasDate: boolean;
}

/** Longest tokens first, so MMMM wins over MM. */
const TOKENS: [string, Field, string][] = [
  ["YYYY", "year", "(\\d{4})"],
  ["MMMM", "monthName", `(${MONTH_WORD})`],
  ["dddd", "skip", `(${WEEKDAY_WORD})`],
  ["MMM", "monthName", `(${MONTH_WORD})`],
  ["ddd", "skip", `(${WEEKDAY_WORD})`],
  ["SSS", "fraction", "(\\d{1,9})"],
  ["YY", "year2", "(\\d{2})"],
  ["MM", "month", "(\\d{1,2})"],
  ["DD", "day", "(\\d{1,2})"],
  ["HH", "hour", "(\\d{1,2})"],
  ["hh", "hour12", "(\\d{1,2})"],
  ["mm", "minute", "(\\d{1,2})"],
  ["ss", "second", "(\\d{1,2})"],
  ["SS", "fraction", "(\\d{1,9})"],
  ["Q", "quarter", "([1-4])"],
  ["M", "month", "(\\d{1,2})"],
  ["D", "day", "(\\d{1,2})"],
  ["H", "hour", "(\\d{1,2})"],
  ["h", "hour12", "(\\d{1,2})"],
  ["S", "fraction", "(\\d{1,9})"],
  ["A", "meridiem", "([AaPp]\\.?[Mm]\\.?)"],
  ["a", "meridiem", "([AaPp]\\.?[Mm]\\.?)"],
  ["Z", "offset", "(Z|z|[+-]\\d{2}(?::?\\d{2})?)"],
];

const STRFTIME: Record<string, string> = {
  Y: "YYYY", y: "YY", m: "MM", d: "DD", e: "D", H: "HH", I: "hh", M: "mm", S: "ss", f: "SSS",
  p: "A", b: "MMM", h: "MMM", B: "MMMM", a: "ddd", A: "dddd", z: "Z", "%": "[%]",
};

/** "%Y-%m" → "YYYY-MM"; other patterns are returned as they are. */
export function fromStrftime(pattern: string): string {
  if (!pattern.includes("%")) return pattern;
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "%" && i + 1 < pattern.length) {
      const code = pattern[++i]!;
      out += STRFTIME[code] ?? `[%${code}]`;
    } else if (/[A-Za-z]/.test(ch)) out += `[${ch}]`;
    else out += ch;
  }
  return out;
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cache = new Map<string, Compiled | null>();

function compile(input: string): Compiled | null {
  const cached = cache.get(input);
  if (cached !== undefined) return cached;
  const pattern = fromStrftime(input);
  let source = "";
  const fields: Field[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "[") {
      const end = pattern.indexOf("]", i + 1);
      const literal = end < 0 ? pattern.slice(i + 1) : pattern.slice(i + 1, end);
      source += escapeRegex(literal);
      i = end < 0 ? pattern.length : end + 1;
      continue;
    }
    if (/\s/.test(ch)) {
      source += "\\s+";
      while (i < pattern.length && /\s/.test(pattern[i]!)) i++;
      continue;
    }
    const token = TOKENS.find(([t]) => pattern.startsWith(t, i));
    if (token !== undefined) {
      source += token[2];
      fields.push(token[1]);
      i += token[0].length;
      continue;
    }
    source += escapeRegex(ch);
    i++;
  }
  const has = (f: Field[]): boolean => fields.some((x) => f.includes(x));
  const hasDate = has(["year", "year2"]);
  const result = fields.length === 0 || !hasDate
    ? null
    : { regex: new RegExp(`^${source}$`), fields, hasDate, hasTime: has(["hour", "hour12", "minute", "second"]) };
  cache.set(input, result);
  return result;
}

/** Why a format cannot be used, or null when it can. */
export function formatProblem(pattern: string): string | null {
  if (pattern.trim() === "") return "Type a format, e.g. YYYY-MM or DD/MM/YYYY HH:mm.";
  const c = compile(pattern.trim());
  if (c === null) return "A format needs a year (YYYY or YY, or %Y / %y).";
  const fields = c.fields;
  if (fields.includes("hour12") && !fields.includes("meridiem")) return "hh is a 12-hour clock: add A for AM/PM, or use HH for 0-23.";
  return null;
}

export interface FormatValue {
  ms: number;
  hasTime: boolean;
  hasOffset: boolean;
}

/** Reads one value with an explicit format; null when it does not match or is not a real date. */
export function parseWithFormat(raw: string, pattern: string): FormatValue | null {
  const c = compile(pattern.trim());
  if (c === null) return null;
  const m = raw.trim().match(c.regex);
  if (m === null) return null;
  let year = NaN, month = 1, day = 1, hour = 0, minute = 0, second = 0, ms = 0, pm: boolean | null = null, offset = 0, hasOffset = false;
  let hour12 = false;
  for (let k = 0; k < c.fields.length; k++) {
    const text = m[k + 1]!;
    switch (c.fields[k]) {
      case "year": year = Number(text); break;
      case "year2": { const y = Number(text); year = y + (y >= 70 ? 1900 : 2000); break; }
      case "quarter": month = (Number(text) - 1) * 3 + 1; break;
      case "monthName": { const n = MONTHS[text.replace(/\.$/, "").toLowerCase()]; if (n === undefined) return null; month = n; break; }
      case "month": month = Number(text); break;
      case "day": day = Number(text); break;
      case "hour": hour = Number(text); break;
      case "hour12": hour = Number(text); hour12 = true; break;
      case "minute": minute = Number(text); break;
      case "second": second = Number(text); break;
      case "fraction": ms = Math.round(Number(`0.${text}`) * 1000); break;
      case "meridiem": pm = text[0]!.toLowerCase() === "p"; break;
      case "offset": {
        if (/^z$/i.test(text)) { hasOffset = true; break; }
        const sign = text[0] === "-" ? -1 : 1, digits = text.slice(1).replace(":", "");
        const oh = Number(digits.slice(0, 2)), om = digits.length > 2 ? Number(digits.slice(2)) : 0;
        if (oh > 14 || om > 59) return null;
        offset = sign * (oh * 60 + om);
        hasOffset = true;
        break;
      }
      case "skip": break;
    }
  }
  if (pm !== null || hour12) {
    if (hour < 1 || hour > 12) return null;
    if (pm === true && hour !== 12) hour += 12;
    if (pm === false && hour === 12) hour = 0;
  }
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  // setUTCFullYear, not Date.UTC: Date.UTC reads years 0-99 as 1900-1999.
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { ms: d.getTime() - offset * 60_000, hasTime: c.hasTime, hasOffset };
}

/**
 * The format as strftime for pandas/Polars code (%Y-%m), or null when it uses a token
 * strftime has no code for (Q, quarter).
 */
export function toStrftime(pattern: string): string | null {
  const p = fromStrftime(pattern.trim());
  const map: Record<string, string> = {
    YYYY: "%Y", MMMM: "%B", dddd: "%A", MMM: "%b", ddd: "%a", SSS: "%f", YY: "%y", MM: "%m", DD: "%d", HH: "%H",
    hh: "%I", mm: "%M", ss: "%S", SS: "%f", M: "%m", D: "%d", H: "%H", h: "%I", S: "%f", A: "%p", a: "%p", Z: "%z",
  };
  let out = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i]!;
    if (ch === "[") {
      const end = p.indexOf("]", i + 1);
      out += (end < 0 ? p.slice(i + 1) : p.slice(i + 1, end)).replace(/%/g, "%%");
      i = end < 0 ? p.length : end + 1;
      continue;
    }
    if (p.startsWith("Q", i)) return null;
    const token = Object.keys(map).find((t) => p.startsWith(t, i));
    if (token !== undefined) {
      out += map[token];
      i += token.length;
    } else {
      out += ch === "%" ? "%%" : ch;
      i++;
    }
  }
  return out;
}

/** Whether the format names a day (pandas fills a missing day with 1; Polars needs one). */
export function formatHasDay(pattern: string): boolean {
  return compile(pattern.trim())?.fields.includes("day") ?? false;
}

export interface FormatPreset {
  format: string;
  example: string;
  /** Has a time of day (offered for date & time). */
  time: boolean;
}

/** Common formats, offered with how many sample values each one reads. */
export const DATE_FORMAT_PRESETS: readonly FormatPreset[] = [
  { format: "YYYY-MM-DD", example: "2024-03-15", time: false },
  { format: "YYYY-MM", example: "2024-03", time: false },
  { format: "YYYY/MM/DD", example: "2024/03/15", time: false },
  { format: "YYYY/MM", example: "2024/03", time: false },
  { format: "YYYYMMDD", example: "20240315", time: false },
  { format: "YYYYMM", example: "202403", time: false },
  { format: "YYYY", example: "2024", time: false },
  { format: "DD/MM/YYYY", example: "15/03/2024", time: false },
  { format: "MM/DD/YYYY", example: "03/15/2024", time: false },
  { format: "DD-MM-YYYY", example: "15-03-2024", time: false },
  { format: "DD.MM.YYYY", example: "15.03.2024", time: false },
  { format: "DD/MM/YY", example: "15/03/24", time: false },
  { format: "MM/DD/YY", example: "03/15/24", time: false },
  { format: "MM/YYYY", example: "03/2024", time: false },
  { format: "DD-MMM-YYYY", example: "15-Mar-2024", time: false },
  { format: "D MMM YYYY", example: "15 Mar 2024", time: false },
  { format: "MMM D, YYYY", example: "Mar 15, 2024", time: false },
  { format: "MMM YYYY", example: "Mar 2024", time: false },
  { format: "MMMM YYYY", example: "March 2024", time: false },
  { format: "MMM-YY", example: "Mar-24", time: false },
  { format: "YYYY [Q]Q", example: "2024 Q1", time: false },
  { format: "YYYY-[Q]Q", example: "2024-Q1", time: false },
  { format: "YYYY-MM-DD HH:mm:ss", example: "2024-03-15 14:30:00", time: true },
  { format: "YYYY-MM-DD HH:mm", example: "2024-03-15 14:30", time: true },
  { format: "YYYY-MM-DD[T]HH:mm:ssZ", example: "2024-03-15T14:30:00+10:00", time: true },
  { format: "YYYY-MM-DD HH:mm:ss.SSS", example: "2024-03-15 14:30:00.250", time: true },
  { format: "DD/MM/YYYY HH:mm", example: "15/03/2024 14:30", time: true },
  { format: "DD/MM/YYYY HH:mm:ss", example: "15/03/2024 14:30:00", time: true },
  { format: "MM/DD/YYYY hh:mm A", example: "03/15/2024 02:30 PM", time: true },
  { format: "MM/DD/YYYY HH:mm", example: "03/15/2024 14:30", time: true },
  { format: "DD.MM.YYYY HH:mm", example: "15.03.2024 14:30", time: true },
  { format: "YYYYMMDDHHmmss", example: "20240315143000", time: true },
  { format: "YYYY-MM-DD HH", example: "2024-03-15 14", time: true },
];

/** How many of the values each format reads, best first (only formats that read any). */
export function rankFormats(values: readonly string[], presets: readonly FormatPreset[] = DATE_FORMAT_PRESETS): { preset: FormatPreset; hits: number }[] {
  const sample = values.map((v) => v.trim()).filter((v) => v !== "").slice(0, 200);
  return presets
    .map((preset) => ({ preset, hits: sample.filter((v) => parseWithFormat(v, preset.format) !== null).length }))
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits);
}

/** Plain words for a date order or format, for step labels: "day first", "format YYYY-MM". */
export function describeOrder(order: string | undefined): string {
  if (order !== undefined && order.startsWith("fmt:")) return `format ${order.slice(4)}`;
  return order === "mdy" ? "month first MM/DD/YYYY" : "day first DD/MM/YYYY";
}

const py = (text: string): string => JSON.stringify(text);

/**
 * pandas arguments for reading dates in this order: format="%Y-%m" for an explicit
 * format, dayfirst otherwise. A format strftime cannot say (quarters) falls back to
 * format="mixed" and is flagged for review.
 */
export function pandasDateArgs(order: string | undefined): { args: string; review: string | null } {
  if (order !== undefined && order.startsWith("fmt:")) {
    const strf = toStrftime(order.slice(4));
    return strf === null
      ? { args: `format="mixed"`, review: `the format ${order.slice(4)} (quarters) has no strftime code; check the parsed dates` }
      : { args: `format=${py(strf)}`, review: null };
  }
  return { args: `dayfirst=${order === "mdy" ? "False" : "True"}`, review: null };
}

/**
 * A Polars expression reading the string column `column` as datetimes in this order.
 * Polars needs a day and month in the format, so year-month or year-only formats get
 * "-01" pieces appended to the values and the format first.
 */
export function polarsDateExpr(column: string, order: string | undefined, extra = ""): { expr: string; review: string | null } {
  if (order === undefined || !order.startsWith("fmt:")) return { expr: `${column}.str.to_datetime(strict=False${extra})`, review: null };
  const pattern = order.slice(4);
  const strf = toStrftime(pattern);
  if (strf === null) {
    return { expr: `${column}.str.to_datetime(strict=False${extra})`, review: `the format ${pattern} (quarters) has no strftime code; check the parsed dates` };
  }
  const fields = compile(pattern.trim())?.fields ?? [];
  let suffix = "", tail = "";
  if (!fields.includes("month") && !fields.includes("monthName")) { suffix += "|01"; tail += "|%m"; }
  if (!fields.includes("day")) { suffix += "|01"; tail += "|%d"; }
  const source = suffix === "" ? column : `(${column} + ${py(suffix)})`;
  return { expr: `${source}.str.to_datetime(format=${py(strf + tail)}, strict=False${extra})`, review: null };
}
