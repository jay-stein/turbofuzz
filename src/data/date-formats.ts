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
