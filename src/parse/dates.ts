export type DateOrder = "dmy" | "mdy";

const DMY_OR_MDY = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const YMD = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/;

export function looksLikeDate(value: string): boolean {
  const s = value.trim();
  return ISO.test(s) || YMD.test(s) || DMY_OR_MDY.test(s);
}

export function detectDateOrder(values: readonly string[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const value of values) {
    const m = value.trim().match(DMY_OR_MDY);
    if (m === null) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  return mdy > dmy ? "mdy" : "dmy";
}

export function parseDate(raw: string, order: DateOrder = "dmy"): number {
  const s = raw.trim();
  if (s === "") return NaN;

  let m = s.match(ISO);
  if (m !== null) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = s.match(YMD);
  if (m !== null) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = s.match(DMY_OR_MDY);
  if (m !== null) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const day = order === "dmy" ? a : b;
    const month = order === "dmy" ? b : a;
    if (day < 1 || day > 31 || month < 1 || month > 12) return NaN;
    return Date.UTC(year, month - 1, day);
  }

  const t = Date.parse(s);
  if (Number.isNaN(t)) return NaN;
  // Date.parse yields local-time midnight for formats without a zone; map the
  // calendar fields back to UTC so results do not shift by timezone offset.
  const local = new Date(t);
  return Date.UTC(local.getFullYear(), local.getMonth(), local.getDate());
}

export function toDateInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
