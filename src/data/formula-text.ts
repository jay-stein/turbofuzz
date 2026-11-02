/**
 * TEXT(value, format) for new-column formulas: the Excel formats people actually type.
 * The pandas and Polars recipes carry a line-for-line Python port (formula-export.ts, _fmt),
 * so keep the two in step.
 *
 * Dates: yy yyyy, m mm mmm mmmm, d dd ddd dddd, h hh, m mm (minutes after h or before s),
 * s ss, AM/PM and A/P, with "quoted text", \escaped characters and any separators.
 * Numbers: 0 and # places, a thousands comma, a decimal point, %, a currency sign or other
 * text before and after, and up to three sections (positive;negative;zero). General is
 * the number as the app shows it. Anything else (scientific, fractions, text between
 * digit places, fractional seconds) is an error, never a silent guess.
 */

export type TextFormatResult = { ok: true; text: string } | { ok: false; reason: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 86_400_000;

type DateTok =
  | { k: "lit"; s: string }
  | { k: "y" | "mo" | "d" | "h" | "mi" | "s"; n: number }
  | { k: "ampm"; long: boolean; lower: boolean };

interface NumSection {
  prefix: string;
  suffix: string;
  intMin: number;
  thousands: boolean;
  decMin: number;
  decMax: number;
  point: boolean;
  percent: boolean;
  /** No digit places at all: the section is only text. */
  literalOnly: boolean;
}

type Parsed =
  | { kind: "date"; tokens: DateTok[]; twelve: boolean }
  | { kind: "number"; sections: NumSection[] }
  | { kind: "general" }
  | { kind: "error"; reason: string };

const NOT_SUPPORTED = "TEXT does not support this format";
const cache = new Map<string, Parsed>();

/** The format split into its characters, with quoted and escaped text kept whole: [text, isLiteral]. */
function pieces(fmt: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i]!;
    if (c === '"') {
      let j = fmt.indexOf('"', i + 1);
      if (j < 0) j = fmt.length;
      out.push([fmt.slice(i + 1, j), true]);
      i = j + 1;
    } else if (c === "\\") {
      out.push([fmt[i + 1] ?? "", true]);
      i += 2;
    } else {
      out.push([c, false]);
      i++;
    }
  }
  return out;
}

function parseFormat(fmt: string): Parsed {
  const hit = cache.get(fmt);
  if (hit !== undefined) return hit;
  const parsed = parseUncached(fmt);
  if (cache.size >= 64) cache.clear();
  cache.set(fmt, parsed);
  return parsed;
}

function parseUncached(fmt: string): Parsed {
  if (fmt.trim().toLowerCase() === "general") return { kind: "general" };
  const parts = pieces(fmt);
  const bare = parts.filter(([, lit]) => !lit).map(([c]) => c).join("");
  // Digit places make it a number format (so "0 days" is a number then the word days); date letters alone make it a date.
  if (/[0#?]/.test(bare)) return parseNumber(parts, bare);
  if (/[ymdhs]/i.test(bare) || /a\/p/i.test(bare)) return parseDate(fmt);
  return parseNumber(parts, bare);
}

function parseDate(fmt: string): Parsed {
  const tokens: DateTok[] = [];
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i]!;
    const lc = c.toLowerCase();
    if (c === '"') {
      let j = fmt.indexOf('"', i + 1);
      if (j < 0) j = fmt.length;
      tokens.push({ k: "lit", s: fmt.slice(i + 1, j) });
      i = j + 1;
    } else if (c === "\\") {
      tokens.push({ k: "lit", s: fmt[i + 1] ?? "" });
      i += 2;
    } else if (lc === "y" || lc === "m" || lc === "d" || lc === "h" || lc === "s") {
      let j = i;
      while (j < fmt.length && fmt[j]!.toLowerCase() === lc) j++;
      tokens.push({ k: lc === "m" ? "mo" : (lc as "y" | "d" | "h" | "s"), n: j - i });
      i = j;
    } else if (lc === "a" && /^am\/pm/i.test(fmt.slice(i))) {
      tokens.push({ k: "ampm", long: true, lower: fmt.slice(i, i + 5) === fmt.slice(i, i + 5).toLowerCase() });
      i += 5;
    } else if (lc === "a" && /^a\/p/i.test(fmt.slice(i))) {
      tokens.push({ k: "ampm", long: false, lower: fmt.slice(i, i + 3) === fmt.slice(i, i + 3).toLowerCase() });
      i += 3;
    } else if (c === "0" || c === "#" || c === "?") {
      return { kind: "error", reason: NOT_SUPPORTED };
    } else {
      tokens.push({ k: "lit", s: c });
      i++;
    }
  }
  // m is minutes straight after an hour or straight before a second, and the month otherwise.
  const real = tokens.map((t, at) => [t, at] as const).filter(([t]) => t.k !== "lit");
  real.forEach(([t], r) => {
    if (t.k !== "mo") return;
    if (real[r - 1]?.[0].k === "h" || real[r + 1]?.[0].k === "s") (t as { k: string }).k = "mi";
  });
  return { kind: "date", tokens, twelve: tokens.some((t) => t.k === "ampm") };
}

function parseNumber(parts: [string, boolean][], bare: string): Parsed {
  if (/[eE][+-]/.test(bare)) return { kind: "error", reason: NOT_SUPPORTED };
  const sections: NumSection[] = [];
  let cur: [string, boolean][] = [];
  const flush = (): boolean => {
    const section = numberSection(cur);
    if (section === null) return false;
    sections.push(section);
    cur = [];
    return true;
  };
  for (const part of parts) {
    if (!part[1] && part[0] === ";") {
      if (!flush()) return { kind: "error", reason: NOT_SUPPORTED };
    } else cur.push(part);
  }
  if (!flush()) return { kind: "error", reason: NOT_SUPPORTED };
  if (sections.length > 3) sections.length = 3;
  return { kind: "number", sections };
}

const isPlace = (c: string, lit: boolean): boolean => !lit && (c === "0" || c === "#" || c === "?");

/** One section of a number format, or null when it uses something this does not support. */
function numberSection(parts: [string, boolean][]): NumSection | null {
  const s: NumSection = { prefix: "", suffix: "", intMin: 0, thousands: false, decMin: 0, decMax: 0, point: false, percent: false, literalOnly: true };
  // 0 before the digit places, 1 among them, 2 after them.
  let state = 0;
  for (let k = 0; k < parts.length; k++) {
    const [c, lit] = parts[k]!;
    if (isPlace(c, lit)) {
      if (state === 2) return null;
      state = 1;
      s.literalOnly = false;
      if (s.point) {
        s.decMax++;
        if (c === "0") s.decMin++;
      } else if (c === "0") s.intMin++;
      continue;
    }
    const next = parts[k + 1];
    if (!lit && c === "." && (state === 1 || (state === 0 && next !== undefined && isPlace(next[0], next[1])))) {
      if (s.point) return null;
      state = 1;
      s.literalOnly = false;
      s.point = true;
      continue;
    }
    if (!lit && c === "," && state === 1) {
      // A comma between places is the thousands separator; one after the last place would scale by 1000.
      const after = parts.slice(k + 1).find(([d, l]) => l || d !== ",");
      if (s.point || after === undefined || !isPlace(after[0], after[1])) return null;
      s.thousands = true;
      continue;
    }
    if (!lit && c === "%") s.percent = true;
    if (state === 1) state = 2;
    if (state === 0) s.prefix += c;
    else s.suffix += c;
  }
  return s;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(ms: number, tokens: DateTok[], twelve: boolean): string {
  const d = new Date(ms);
  const hour = d.getUTCHours();
  let out = "";
  for (const t of tokens) {
    switch (t.k) {
      case "lit": out += t.s; break;
      case "y": out += t.n <= 2 ? pad2(d.getUTCFullYear() % 100) : String(d.getUTCFullYear()).padStart(4, "0"); break;
      case "mo": {
        const m = d.getUTCMonth();
        out += t.n === 1 ? String(m + 1) : t.n === 2 ? pad2(m + 1) : t.n === 3 ? MONTHS[m]!.slice(0, 3) : t.n === 4 ? MONTHS[m]! : MONTHS[m]![0]!;
        break;
      }
      case "d": {
        const w = d.getUTCDay();
        out += t.n === 1 ? String(d.getUTCDate()) : t.n === 2 ? pad2(d.getUTCDate()) : t.n === 3 ? DAYS[w]!.slice(0, 3) : DAYS[w]!;
        break;
      }
      case "h": {
        const h = twelve ? hour % 12 || 12 : hour;
        out += t.n === 1 ? String(h) : pad2(h);
        break;
      }
      case "mi": out += t.n === 1 ? String(d.getUTCMinutes()) : pad2(d.getUTCMinutes()); break;
      case "s": out += t.n === 1 ? String(d.getUTCSeconds()) : pad2(d.getUTCSeconds()); break;
      case "ampm": {
        const text = t.long ? (hour < 12 ? "AM" : "PM") : hour < 12 ? "A" : "P";
        out += t.lower ? text.toLowerCase() : text;
        break;
      }
    }
  }
  return out;
}

function formatNumber(value: number, sections: NumSection[]): TextFormatResult {
  const negative = value < 0;
  let section = sections[0]!;
  let sign = negative ? "-" : "";
  if (sections.length >= 2 && negative) {
    section = sections[1]!;
    sign = "";
  } else if (sections.length >= 3 && value === 0) {
    section = sections[2]!;
  }
  if (section.literalOnly) return { ok: true, text: sign + section.prefix + section.suffix };
  let x = Math.abs(value);
  if (section.percent) x *= 100;
  const factor = Math.pow(10, section.decMax);
  const scaled = Math.floor(x * factor + 0.5 + 1e-9);
  if (!(scaled < 1e15)) return { ok: false, reason: "TEXT: the number is too large for this format" };
  const digits = String(scaled).padStart(section.decMax + 1, "0");
  let whole = digits.slice(0, digits.length - section.decMax).replace(/^0+/, "");
  let decimals = digits.slice(digits.length - section.decMax);
  while (decimals.length > section.decMin && decimals.endsWith("0")) decimals = decimals.slice(0, -1);
  if (whole.length < section.intMin) whole = whole.padStart(section.intMin, "0");
  if (section.thousands) whole = whole.replace(/\B(?=(\d{3})+$)/g, ",");
  return { ok: true, text: sign + section.prefix + whole + (section.point ? `.${decimals}` : "") + section.suffix };
}

/**
 * The value written in the format. `isDate` says the value is a moment in milliseconds;
 * otherwise a date format reads it as days since 1970-01-01, as the rest of the formulas do.
 */
export function formatForText(value: number, format: string, isDate: boolean, general: (n: number) => string): TextFormatResult {
  const parsed = parseFormat(format);
  switch (parsed.kind) {
    case "error": return { ok: false, reason: parsed.reason };
    case "general": return { ok: true, text: general(value) };
    case "date": return { ok: true, text: formatDate(isDate ? value : value * DAY_MS, parsed.tokens, parsed.twelve) };
    case "number": return formatNumber(value, parsed.sections);
  }
}
