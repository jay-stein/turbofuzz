import type { DateOrder } from "../parse/dates.js";

/**
 * Which text formats a date column is written in. A column typed Date can still
 * hold "2023-04-12", "12/04/2023" and "12 Apr 2023" side by side; each parses, but
 * the column is not consistent. Computed exactly over every populated value.
 */
export interface DateFormatShare {
  /** Plain label, e.g. "yyyy-mm-dd" or "dd/mm/yyyy". */
  label: string;
  count: number;
  /** A representative raw value. */
  example: string;
}

export interface DateFormatSummary {
  /** Formats present, most common first. */
  formats: DateFormatShare[];
  /** Populated values counted. */
  total: number;
  /** Values outside the most common format. */
  minority: number;
  /**
   * True when slashed values exist but none of them settles day-first versus
   * month-first (every one has day and month at or below 12).
   */
  ambiguous: boolean;
  /** The order the slashed values imply, or null when ambiguous / none. */
  order: DateOrder | null;
  /** Internal shape key of the most common format (see dateShapeKey), for row-level checks. */
  dominantKey: string;
}

const ISO_DATE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const ISO_DATETIME = /^\d{4}-\d{1,2}-\d{1,2}[Tt ]\d/;
const YMD_SLASH = /^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/;
const SLASH = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;
const SLASH_TIME = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})[ Tt]+\d/;
const HAS_MONTH_NAME = /[A-Za-z]{3}/;

type Shape = "iso" | "isoTime" | "ymdSlash" | "slash" | "slashTime" | "monthName" | "other";

/** The shape key of one raw value, as stored in DateFormatSummary.dominantKey. */
export function dateShapeKey(value: string): string {
  return shapeOf(value.trim());
}

function shapeOf(value: string): Shape {
  if (ISO_DATE.test(value)) return "iso";
  if (ISO_DATETIME.test(value)) return "isoTime";
  if (YMD_SLASH.test(value)) return "ymdSlash";
  if (SLASH.test(value)) return "slash";
  if (SLASH_TIME.test(value)) return "slashTime";
  if (HAS_MONTH_NAME.test(value)) return "monthName";
  return "other";
}

/**
 * Summarises the formats in a date column. Returns null when fewer than two
 * formats are present (nothing to standardise) or the column is empty.
 */
export function summariseDateFormats(
  raw: readonly string[],
  isMissing: (value: string) => boolean,
): DateFormatSummary | null {
  const counts = new Map<string, { count: number; example: string }>();
  let total = 0;
  let dmyEvidence = 0;
  let mdyEvidence = 0;
  let slashed = 0;
  for (let i = 0; i < raw.length; i++) {
    const value = (raw[i] ?? "").trim();
    if (value === "" || isMissing(value)) continue;
    total++;
    const shape = shapeOf(value);
    let key: string = shape;
    if (shape === "slash" || shape === "slashTime") {
      slashed++;
      const m = (shape === "slash" ? SLASH : SLASH_TIME).exec(value);
      const a = Number(m?.[1]);
      const b = Number(m?.[2]);
      if (a > 12 && b <= 12) dmyEvidence++;
      else if (b > 12 && a <= 12) mdyEvidence++;
      key = shape; // resolved to a label once the order is known
    }
    const entry = counts.get(key);
    if (entry === undefined) counts.set(key, { count: 1, example: value });
    else entry.count++;
  }
  if (total === 0 || counts.size < 2) return null;

  const order: DateOrder | null =
    dmyEvidence === 0 && mdyEvidence === 0 ? null : mdyEvidence > dmyEvidence ? "mdy" : "dmy";
  const ambiguous = slashed > 0 && order === null;
  const slashLabel = order === "mdy" ? "mm/dd/yyyy" : order === "dmy" ? "dd/mm/yyyy" : "dd/mm/yyyy or mm/dd/yyyy";
  const labels: Record<string, string> = {
    iso: "yyyy-mm-dd",
    isoTime: "yyyy-mm-dd hh:mm",
    ymdSlash: "yyyy/mm/dd",
    slash: slashLabel,
    slashTime: `${slashLabel} hh:mm`,
    monthName: "12 Apr 2023 (month name)",
    other: "other text",
  };
  const keyed = [...counts.entries()]
    .map(([key, entry]) => ({ key, label: labels[key] ?? key, count: entry.count, example: entry.example }))
    .sort((a, b) => b.count - a.count);
  const formats = keyed.map(({ label, count, example }) => ({ label, count, example }));
  const minority = total - (formats[0]?.count ?? 0);
  return { formats, total, minority, ambiguous, order, dominantKey: keyed[0]?.key ?? "" };
}

/**
 * A text column of slashed dates that contradicts itself: some values can only be
 * day-first (23/03/2024), others only month-first (03/21/2024). Nothing here
 * guesses which reading is right; the person picks.
 */
export interface DateConflict {
  dayFirst: number;
  monthFirst: number;
  /** Values that read either way (both numbers at or below 12). */
  either: number;
  total: number;
  dayFirstExample: string;
  monthFirstExample: string;
}

/** Which reading a slashed value forces: day-first, month-first, or neither (null). */
export function dateSideOf(raw: string): "day" | "month" | null {
  const value = raw.trim();
  const m = SLASH.exec(value) ?? SLASH_TIME.exec(value);
  if (m === null) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 12 && a <= 31 && b >= 1 && b <= 12) return "day";
  if (b > 12 && b <= 31 && a >= 1 && a <= 12) return "month";
  return null;
}

/** The side with fewer clear rows (ties go to month-first), or null when there is no conflict. */
export function minoritySide(conflict: DateConflict | null): "day" | "month" | null {
  if (conflict === null) return null;
  return conflict.dayFirst < conflict.monthFirst ? "day" : "month";
}

const CONFLICT_PROBE = 200;

/**
 * Exact over every populated value, but only for columns that are almost entirely
 * slashed dates (a quick probe of the first values rules out ordinary text).
 * Null when only one reading appears.
 */
export function detectDateConflict(raw: readonly string[], isMissing: (value: string) => boolean): DateConflict | null {
  const slashed = (value: string): boolean => SLASH.test(value) || SLASH_TIME.test(value);
  let probed = 0;
  let hits = 0;
  for (let i = 0; i < raw.length && probed < CONFLICT_PROBE; i++) {
    const value = (raw[i] ?? "").trim();
    if (value === "" || isMissing(value)) continue;
    probed++;
    if (slashed(value)) hits++;
  }
  if (probed === 0 || hits / probed < 0.9) return null;
  let total = 0;
  let slashedCount = 0;
  let dayFirst = 0;
  let monthFirst = 0;
  let dayFirstExample = "";
  let monthFirstExample = "";
  for (let i = 0; i < raw.length; i++) {
    const value = (raw[i] ?? "").trim();
    if (value === "" || isMissing(value)) continue;
    total++;
    if (!slashed(value)) continue;
    slashedCount++;
    const side = dateSideOf(value);
    if (side === "day") {
      if (dayFirst++ === 0) dayFirstExample = value;
    } else if (side === "month") {
      if (monthFirst++ === 0) monthFirstExample = value;
    }
  }
  if (dayFirst === 0 || monthFirst === 0 || slashedCount / total < 0.95) return null;
  return { dayFirst, monthFirst, either: slashedCount - dayFirst - monthFirst, total, dayFirstExample, monthFirstExample };
}
