import type { ExceptionGroup } from "../data/dq-exceptions.js";
import type { DQReport } from "../data/dq-report.js";
import { provenanceRows } from "../data/provenance.js";
import type { ColumnType } from "../types.js";
import { XLSX_DATETIME_FORMAT, XLSX_DATE_FORMAT, XLSX_DURATION_FORMAT, XLSX_TIME_FORMAT, serial } from "../worker/xlsx-export.js";
import { XlsxBuilder, type SheetWriter, type StyleSpec, type XCell } from "./xlsx-styled.js";
import { columnLetters } from "./xlsx-writer.js";

/** One issue as the Quality page lists it, already masked for sensitive columns. */
export interface WorkbookIssue {
  severity: "fix" | "review" | "info";
  /** Score dimension label (Completeness…), or "Review" for advisory findings. */
  dimension: string;
  column: string | null;
  title: string;
  evidence: string;
  impact: string | null;
  rows: number;
  /** The button that fixes it in the app, or null. */
  fix: string | null;
}

/** One column's profile, values already masked when the column may be sensitive. */
export interface WorkbookColumn {
  name: string;
  type: ColumnType;
  typeLabel: string;
  /** What the column means (Email, Person name…), or "". */
  meaning: string;
  score: number | null;
  nulls: number;
  distinct: number;
  /** Numbers as numbers; dates and times as epoch ms (or ms for time/duration). */
  min: number | null;
  max: number | null;
  mean: number | null;
  minLength: number | null;
  maxLength: number | null;
  top: { label: string; count: number }[];
  example: string;
  fixRows: number;
  reviewRows: number;
  flags: string[];
  sensitive: boolean;
}

/** A finding that ties several columns together (dependency, co-missingness, near duplicates). */
export interface WorkbookRelation {
  kind: string;
  columns: string[];
  title: string;
  rows: number;
}

export interface WorkbookVariants {
  column: string;
  /** Spellings by count descending; the first is the one to keep. */
  spellings: { value: string; count: number }[];
}

export interface QualityWorkbookInput {
  report: DQReport;
  /** Shown on the Summary, e.g. 2026-11-15 10:30. */
  created: string;
  issues: WorkbookIssue[];
  columns: WorkbookColumn[];
  relations: WorkbookRelation[];
  variants: WorkbookVariants[];
  /** Masked example values per sensitive column name. */
  sensitiveExamples: Record<string, string[]>;
  /** True when the person chose to include raw values of sensitive columns. */
  rawValues: boolean;
}

export interface QualityWorkbook {
  bytes: Uint8Array;
  /** Failing cells found, and how many the Exceptions sheet lists. */
  exceptions: { total: number; written: number };
}

/** Failing cells listed per check at most, so one noisy check cannot crowd out the rest. */
export const EXCEPTIONS_PER_CHECK = 500;
const DAY_MS = 86_400_000;
const nf = new Intl.NumberFormat("en");

/** The look, shared with the comparison report: light fills, dark text on them. */
const P = {
  ink: "1F2937",
  dim: "6B7280",
  line: "9CA3AF",
  rule: "E5E7EB",
  zebra: "F9FAFB",
  greyFill: "E5E7EB",
  greyTint: "F3F4F6",
  redFill: "FEE2E2",
  redInk: "991B1B",
  redStrong: "FCA5A5",
  amberFill: "FEF3C7",
  amberInk: "78350F",
  amberStrong: "FDE68A",
  greenFill: "DCFCE7",
  greenInk: "166534",
  greenStrong: "86EFAC",
  blueFill: "DBEAFE",
  blueInk: "1E3A8A",
  violetFill: "EDE9FE",
  violetInk: "4C1D95",
  pinkFill: "FCE7F3",
  pinkInk: "831843",
};

type Band = "good" | "fair" | "poor" | "none";
const BAND: Record<Band, { fill: string; ink: string; bar: string; word: string }> = {
  good: { fill: P.greenFill, ink: P.greenInk, bar: "22C55E", word: "GOOD" },
  fair: { fill: P.amberFill, ink: P.amberInk, bar: "F59E0B", word: "FAIR" },
  poor: { fill: P.redFill, ink: P.redInk, bar: "EF4444", word: "POOR" },
  none: { fill: P.greyTint, ink: P.dim, bar: "9CA3AF", word: "N/A" },
};
const SEVERITY = {
  fix: { fill: P.redFill, ink: P.redInk, word: "FIX" },
  review: { fill: P.amberFill, ink: P.amberInk, word: "REVIEW" },
  info: { fill: P.blueFill, ink: P.blueInk, word: "INFO" },
} as const;
/** A sensitive class in words. */
const SENSITIVE_WORDS: Record<string, string> = {
  contact: "Contact details",
  government_id: "Government id",
  financial: "Financial",
  personal_name: "People's names",
  demographic: "Demographic",
  health: "Health",
  location: "Location",
  free_text: "Free text with personal data",
};
const RULE_INK: Record<string, string> = { critical: "B91C1C", major: "C2410C", minor: P.dim };
const TYPE_FILL: Partial<Record<ColumnType, string>> = {
  integer: P.blueFill,
  number: P.blueFill,
  date: "CCFBF1",
  datetime: "CCFBF1",
  time: "CCFBF1",
  duration: "CCFBF1",
  boolean: P.greyFill,
  category: P.violetFill,
  identifier: P.amberFill,
  string: P.pinkFill,
};

/** "███████░░░" for a share 0..1. */
function textBar(share: number, width: number): string {
  const n = Math.round(Math.max(0, Math.min(1, share)) * width);
  return "█".repeat(n) + "░".repeat(width - n);
}

function bandOf(report: DQReport, score: number | null): Band {
  if (score === null) return "none";
  const good = report.provenance?.scoring.bands.good ?? 90;
  const fair = report.provenance?.scoring.bands.fair ?? 75;
  return score >= good ? "good" : score >= fair ? "fair" : "poor";
}

function severityOfException(severity: string): keyof typeof SEVERITY {
  return severity === "fix" || severity === "review" ? severity : "info";
}

/**
 * The single-table data-quality report as a formatted workbook: Summary,
 * Columns, Findings, Checks & rules, Exceptions, Relationships, Sensitive and
 * About. Everything shown comes from the Quality page's own results, so the
 * numbers match the page; nothing is re-analysed here except the failing cells,
 * which the worker samples per check.
 */
export async function qualityReportWorkbook(input: QualityWorkbookInput, exceptions: readonly ExceptionGroup[]): Promise<QualityWorkbook> {
  const book = await XlsxBuilder.create();
  const names = {
    summary: book.uniqueName("Summary"),
    columns: book.uniqueName("Columns"),
    findings: book.uniqueName("Findings"),
    checks: book.uniqueName("Checks & rules"),
    exceptions: book.uniqueName("Exceptions"),
    relationships: book.uniqueName("Relationships"),
    sensitive: book.uniqueName("Sensitive"),
    about: book.uniqueName("About"),
  };
  const total = exceptions.reduce((sum, group) => sum + group.total, 0);
  const written = exceptions.reduce((sum, group) => sum + group.rows.length, 0);
  writeSummary(book, names, input, { total, written });
  writeColumns(book, names.columns, input);
  writeFindings(book, names.findings, input);
  writeChecks(book, names.checks, input);
  writeExceptions(book, names.exceptions, input, exceptions, total, written);
  writeRelationships(book, names.relationships, input);
  writeSensitive(book, names.sensitive, input);
  writeAbout(book, names.about, input);
  return { bytes: book.finish(), exceptions: { total, written } };
}

type Names = Record<"summary" | "columns" | "findings" | "checks" | "exceptions" | "relationships" | "sensitive" | "about", string>;

/** Row-by-row writing with merges, links and a title band, as every sheet here needs. */
class Page {
  r = 0;
  readonly merges: string[] = [];
  readonly links: { ref: string; sheet: string; tip?: string }[] = [];
  readonly scales: { ref: string; colors: [string, string, string]; middle?: number }[] = [];
  readonly bars: { ref: string; color: string }[] = [];

  constructor(
    readonly book: XlsxBuilder,
    readonly sheet: SheetWriter,
    readonly width: number,
  ) {}

  style(spec: StyleSpec): number {
    return this.book.styles.style(spec);
  }

  line(cells: XCell[], styles: number | number[], height?: number): number {
    const padded = cells.length < this.width ? [...cells, ...new Array<XCell>(this.width - cells.length).fill(null)] : cells;
    const each = typeof styles === "number" ? styles : [...styles, ...new Array<number>(Math.max(0, this.width - styles.length)).fill(styles[styles.length - 1] ?? 0)];
    this.sheet.row(++this.r, padded, each, height);
    return this.r;
  }

  merge(row: number, from: number, to: number): void {
    if (to > from) this.merges.push(`${columnLetters(from)}${row}:${columnLetters(to)}${row}`);
  }

  wide(text: string, spec: StyleSpec, height?: number): number {
    const at = this.line([text], this.style(spec), height);
    this.merge(at, 0, this.width - 1);
    return at;
  }

  blank(): void {
    this.r++;
  }

  /** The dark band across the top: a big title and a grey line under it. */
  band(title: string, subtitle: string, fill: string): void {
    this.wide(title, { bold: true, size: 18, color: "FFFFFF", fill, valign: "center" }, 32);
    this.wide(subtitle, { size: 10, color: "D1D5DB", fill, valign: "center", wrap: true }, subtitle.length > 140 ? 30 : 18);
  }

  section(title: string, accent: string, link?: string): number {
    this.blank();
    const at = this.wide(title.toUpperCase(), { bold: true, size: 11, color: accent, border: { bottom: { style: "medium", color: accent } } }, 22);
    if (link !== undefined) this.links.push({ ref: `A${at}`, sheet: link, tip: `Go to ${link}` });
    return at;
  }

  header(labels: XCell[], fill: string, height = 22): number {
    return this.line(labels, this.style({ bold: true, color: "FFFFFF", fill, valign: "center", wrap: true }), height);
  }

  note(text: string): void {
    this.wide(text, { italic: true, size: 9, color: P.dim, wrap: true }, text.length > 150 ? 28 : 16);
  }

  /** A body cell: zebra striped, thin rule under, top-aligned and wrapped. */
  cell(zebra: boolean, extra: StyleSpec = {}): number {
    return this.style({ size: 10, color: P.ink, valign: "top", wrap: true, border: { bottom: { style: "thin", color: P.rule } }, ...(zebra ? { fill: P.zebra } : {}), ...extra });
  }

  chip(severity: keyof typeof SEVERITY): number {
    const s = SEVERITY[severity];
    return this.style({ bold: true, size: 9, fill: s.fill, color: s.ink, align: "center", valign: "center", border: { bottom: { style: "thin", color: P.rule } } });
  }

  end(autoFilter?: string): void {
    this.sheet.end({
      merges: this.merges,
      links: this.links,
      colourScales: this.scales,
      dataBars: this.bars,
      ...(autoFilter === undefined ? {} : { autoFilter }),
    });
  }
}

function page(book: XlsxBuilder, name: string, tabColor: string, widths: number[], options: { freeze?: { rows: number; cols: number }; landscape?: boolean } = {}): Page {
  const sheet = book.sheet({
    name,
    tabColor,
    widths,
    gridlines: false,
    landscape: options.landscape ?? true,
    fitWidth: true,
    ...(options.freeze === undefined ? {} : { freeze: options.freeze, printTitleRows: [options.freeze.rows, options.freeze.rows] as const }),
  });
  return new Page(book, sheet, widths.length);
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

// ---------------------------------------------------------------- Summary

function writeSummary(book: XlsxBuilder, names: Names, input: QualityWorkbookInput, exceptions: { total: number; written: number }): void {
  const { report } = input;
  const p = page(book, names.summary, "3B82F6", [22, 13, 13, 13, 13, 13, 13, 13, 40]);
  p.band(`Data quality report · ${report.dataset}`, `Made with TurboFuzz, in the browser · ${input.created} · Scope: the whole file, ${nf.format(report.rows)} rows × ${nf.format(report.columns)} columns (Table view filters do not apply)`, "111827");

  // Tiles: the score in its band colour, then the counts.
  p.blank();
  const overall = report.overall;
  const band = bandOf(report, overall);
  const fixes = input.issues.filter((i) => i.severity === "fix").length;
  const reviews = input.issues.filter((i) => i.severity === "review").length;
  const tiles: { title: string; value: XCell; sub: string; fill: string; ink: string; fmt?: string; link?: string }[] = [
    { title: "Overall score", value: overall === null ? "n/a" : overall, sub: `${BAND[band].word} · out of 100`, fill: BAND[band].fill, ink: BAND[band].ink, fmt: "0.0" },
    { title: "Rows", value: report.rows, sub: `${nf.format(report.columns)} columns`, fill: P.blueFill, ink: P.blueInk, fmt: "#,##0", link: names.columns },
    { title: "To fix", value: fixes, sub: "issues with a fix", fill: P.redStrong, ink: "7F1D1D", fmt: "#,##0", link: names.findings },
    { title: "To review", value: reviews, sub: `${nf.format(report.sensitive?.length ?? 0)} sensitive column${(report.sensitive?.length ?? 0) === 1 ? "" : "s"}`, fill: P.amberStrong, ink: P.amberInk, fmt: "#,##0", link: names.findings },
  ];
  const top = p.r + 1;
  const tileRow = (value: (t: (typeof tiles)[number]) => XCell, spec: (t: (typeof tiles)[number]) => StyleSpec, height: number): void => {
    const cells: XCell[] = [];
    const styles: number[] = [];
    for (const t of tiles) {
      const s = p.style({ ...spec(t), fill: t.fill, color: t.ink, align: "center", valign: "center" });
      cells.push(value(t), null);
      styles.push(s, s);
    }
    cells.push(null);
    styles.push(0);
    p.line(cells, styles, height);
  };
  tileRow((t) => t.title, () => ({ bold: true, size: 11 }), 20);
  tileRow((t) => t.value, (t) => ({ bold: true, size: 28, ...(t.fmt === undefined ? {} : { numFmt: t.fmt }) }), 42);
  tileRow((t) => t.sub, () => ({ size: 9 }), 16);
  for (let t = 0; t < tiles.length; t++) for (let row = top; row < top + 3; row++) p.merge(row, t * 2, t * 2 + 1);
  tiles.forEach((t, i) => {
    if (t.link !== undefined) p.links.push({ ref: `${columnLetters(i * 2)}${top}`, sheet: t.link, tip: `Go to ${t.link}` });
  });
  if (report.bandReason !== null && report.bandReason !== undefined && report.bandReason !== "") {
    p.blank();
    const at = p.line([report.bandReason], p.style({ bold: true, fill: P.amberFill, color: P.amberInk, wrap: true, valign: "center", border: { left: { style: "medium", color: "F59E0B" } } }), 22);
    p.merge(at, 0, p.width - 1);
  }

  // Dimensions: a score cell in its band colour and a bar.
  p.section("Quality dimensions", "2563EB", names.checks);
  p.header(["Dimension", "Score", "", "", "", "Weight", "Checks passed", "", "What it measures"], "1F2937");
  p.merge(p.r, 1, 4);
  p.merge(p.r, 6, 7);
  report.dimensions.forEach((d, i) => {
    const b = bandOf(report, d.score);
    const zebra = i % 2 === 1;
    const checked = d.pass + d.fail;
    const at = p.line(
      [d.label, d.score ?? "n/a", textBar((d.score ?? 0) / 100, 24), null, null, d.weight, checked === 0 ? "no checks apply" : `${nf.format(d.pass)} of ${nf.format(checked)} (${((d.pass / checked) * 100).toFixed(1)}%)`, null, d.note ?? DIMENSION_TEXT[d.dimension] ?? ""],
      [
        p.cell(zebra, { bold: true }),
        p.style({ bold: true, size: 11, fill: BAND[b].fill, color: BAND[b].ink, align: "center", valign: "center", numFmt: "0.0", border: { bottom: { style: "thin", color: P.rule } } }),
        p.cell(zebra, { color: BAND[b].bar, wrap: false, valign: "center" }),
        p.cell(zebra),
        p.cell(zebra),
        p.cell(zebra, { numFmt: "0.##", align: "center" }),
        p.cell(zebra),
        p.cell(zebra),
        p.cell(zebra, { size: 9, color: P.dim }),
      ],
      20,
    );
    p.merge(at, 2, 4);
    p.merge(at, 6, 7);
  });

  // Top issues.
  const ranked = input.issues.filter((i) => i.severity !== "info").slice(0, 10);
  p.section(`Top issues (${ranked.length} of ${input.issues.length})`, "DC2626", names.findings);
  if (ranked.length === 0) p.note("Nothing to fix or review.");
  else {
    p.header(["Severity", "Column", "Issue", "", "", "", "Rows", "% of rows", "Evidence"], "1F2937");
    p.merge(p.r, 2, 5);
    ranked.forEach((issue, i) => {
      const zebra = i % 2 === 1;
      const at = p.line(
        [SEVERITY[issue.severity].word, issue.column ?? "(table)", issue.title, null, null, null, issue.rows, share(issue.rows, report.rows), issue.evidence],
        [p.chip(issue.severity), p.cell(zebra, { bold: true }), p.cell(zebra), p.cell(zebra), p.cell(zebra), p.cell(zebra), p.cell(zebra, { numFmt: "#,##0" }), p.cell(zebra, { numFmt: "0.0%" }), p.cell(zebra, { size: 9, color: P.dim })],
        Math.max(20, 14 * Math.ceil(Math.max(issue.title.length / 52, issue.evidence.length / 48))),
      );
      p.merge(at, 2, 5);
    });
  }

  // Columns at a glance.
  p.section("Columns at a glance", "7C3AED", names.columns);
  p.header(["Column", "Type", "Filled", "", "", "Score", "Health", "Distinct", "Most common value"], "1F2937");
  p.merge(p.r, 2, 4);
  input.columns.forEach((c, i) => {
    const zebra = i % 2 === 1;
    const filled = report.rows === 0 ? 0 : 1 - c.nulls / report.rows;
    const b = bandOf(report, c.score);
    const top = c.top[0];
    const at = p.line(
      [c.name, c.typeLabel, filled, textBar(filled, 14), null, c.score ?? "n/a", BAND[b].word, c.distinct, top === undefined ? "" : `${top.label} (${nf.format(top.count)})`],
      [
        p.cell(zebra, { bold: true }),
        p.style({ size: 9, fill: TYPE_FILL[c.type] ?? P.greyTint, color: P.ink, align: "center", valign: "top", border: { bottom: { style: "thin", color: P.rule } } }),
        p.cell(zebra, { numFmt: "0%" }),
        p.cell(zebra, { color: filled >= 0.95 ? "22C55E" : filled >= 0.75 ? "F59E0B" : "EF4444", wrap: false }),
        p.cell(zebra),
        p.cell(zebra, { numFmt: "0", align: "center" }),
        p.style({ bold: true, size: 9, fill: BAND[b].fill, color: BAND[b].ink, align: "center", valign: "top", border: { bottom: { style: "thin", color: P.rule } } }),
        p.cell(zebra, { numFmt: "#,##0" }),
        p.cell(zebra, { size: 9, wrap: false }),
      ],
    );
    p.merge(at, 3, 4);
  });

  // Notes.
  p.blank();
  if (exceptions.written < exceptions.total)
    p.note(`The Exceptions sheet lists ${nf.format(exceptions.written)} of ${nf.format(exceptions.total)} failing cells: at most ${nf.format(EXCEPTIONS_PER_CHECK)} per check, so every check is represented. exceptions.csv on the Quality page has them all.`);
  p.note(`Scores are out of 100 and banded good / fair / poor at ${report.provenance?.scoring.bands.good ?? 90} and ${report.provenance?.scoring.bands.fair ?? 75}. ${input.rawValues ? "Sensitive values are shown unmasked, as requested." : "Values of possibly sensitive columns are masked throughout."} How each number is made is on the About sheet.`);
  p.end();
}

const DIMENSION_TEXT: Record<string, string> = {
  completeness: "Cells that hold a value (optional columns count for less).",
  validity: "Values that read as their column's type, format and plausible range.",
  uniqueness: "Rows and keys that are not repeated.",
  consistency: "The same thing written the same way (spelling, case, spaces).",
  timeliness: "Dates in a sensible order and not in the future.",
  accuracy: "Values agree with each other and with reference lists.",
};

// ---------------------------------------------------------------- Columns

function writeColumns(book: XlsxBuilder, name: string, input: QualityWorkbookInput): void {
  const { report } = input;
  const p = page(book, name, "8B5CF6", [24, 12, 16, 8, 9, 10, 10, 9, 13, 13, 12, 8, 8, 46, 28, 10, 10, 44], { freeze: { rows: 4, cols: 1 } });
  p.band("Columns", `One row per column · ${nf.format(report.columns)} columns · ${nf.format(report.rows)} rows · type, fill, spread, top values and flags`, "4C1D95");
  p.blank();
  const head = p.header(["Column", "Type", "Meaning", "Score", "Filled", "Empty", "Distinct", "Distinct %", "Min", "Max", "Mean", "Min len", "Max len", "Top values (rows)", "Example", "Rows to fix", "Rows to review", "Flags"], "5B21B6", 30);
  const first = head + 1;
  input.columns.forEach((c, i) => {
    const zebra = i % 2 === 1;
    const filled = report.rows === 0 ? null : 1 - c.nulls / report.rows;
    const nonEmpty = report.rows - c.nulls;
    const { fmt, value } = typed(c);
    const flags = [...(c.sensitive ? ["Possibly sensitive (values masked)"] : []), ...c.flags];
    p.line(
      [
        c.name,
        c.typeLabel,
        c.meaning,
        c.score,
        filled,
        c.nulls,
        c.distinct,
        nonEmpty === 0 ? null : c.distinct / nonEmpty,
        value(c.min),
        value(c.max),
        c.type === "integer" || c.type === "number" ? c.mean : null,
        c.minLength,
        c.maxLength,
        c.top.map((t) => `${t.label} (${nf.format(t.count)})`).join("; "),
        c.example,
        c.fixRows === 0 ? null : c.fixRows,
        c.reviewRows === 0 ? null : c.reviewRows,
        flags.map((f) => `• ${f}`).join("\n"),
      ],
      [
        p.cell(zebra, { bold: true }),
        p.style({ size: 9, fill: TYPE_FILL[c.type] ?? P.greyTint, color: P.ink, align: "center", valign: "top", border: { bottom: { style: "thin", color: P.rule } } }),
        p.cell(zebra, { size: 9 }),
        p.cell(zebra, { numFmt: "0", align: "center" }),
        p.cell(zebra, { numFmt: "0.0%" }),
        p.cell(zebra, { numFmt: "#,##0" }),
        p.cell(zebra, { numFmt: "#,##0" }),
        p.cell(zebra, { numFmt: "0.0%" }),
        p.cell(zebra, fmt === undefined ? {} : { numFmt: fmt }),
        p.cell(zebra, fmt === undefined ? {} : { numFmt: fmt }),
        p.cell(zebra, { numFmt: "#,##0.00" }),
        p.cell(zebra, { numFmt: "#,##0" }),
        p.cell(zebra, { numFmt: "#,##0" }),
        p.cell(zebra, { size: 9 }),
        p.cell(zebra, { size: 9 }),
        p.cell(zebra, { numFmt: "#,##0", color: P.redInk, bold: true }),
        p.cell(zebra, { numFmt: "#,##0", color: P.amberInk }),
        p.cell(zebra, { size: 9 }),
      ],
      Math.max(18, 13 * Math.max(1, flags.length)),
    );
  });
  const last = p.r;
  if (last >= first) {
    p.scales.push({ ref: `D${first}:D${last}`, colors: ["F87171", "FDE68A", "86EFAC"], middle: 80 });
    p.scales.push({ ref: `E${first}:E${last}`, colors: ["F87171", "FDE68A", "86EFAC"], middle: 0.8 });
    p.bars.push({ ref: `F${first}:F${last}`, color: "FCA5A5" });
    p.bars.push({ ref: `H${first}:H${last}`, color: "A78BFA" });
  }
  p.end(`A${head}:R${Math.max(head, last)}`);
}

/** How a column's min and max go into Excel: dates as real dates, numbers as numbers. */
function typed(c: WorkbookColumn): { fmt: string | undefined; value: (v: number | null) => XCell } {
  switch (c.type) {
    case "date":
    case "datetime":
      return { fmt: c.type === "date" ? XLSX_DATE_FORMAT : XLSX_DATETIME_FORMAT, value: (v) => (v === null ? null : (serial(v) ?? null)) };
    case "time":
    case "duration":
      return { fmt: c.type === "time" ? XLSX_TIME_FORMAT : XLSX_DURATION_FORMAT, value: (v) => (v === null ? null : v / DAY_MS) };
    case "integer":
    case "number":
      return { fmt: undefined, value: (v) => v };
    default:
      return { fmt: undefined, value: () => null };
  }
}

// ---------------------------------------------------------------- Findings

function writeFindings(book: XlsxBuilder, name: string, input: QualityWorkbookInput): void {
  const { report, issues } = input;
  const p = page(book, name, "EF4444", [5, 10, 14, 22, 42, 10, 9, 52, 40, 26], { freeze: { rows: 4, cols: 0 } });
  const count = (s: WorkbookIssue["severity"]): number => issues.filter((i) => i.severity === s).length;
  p.band("Findings", `${issues.length} findings · ${count("fix")} to fix, ${count("review")} to review, ${count("info")} for information · the same list as the Quality page's Issues tab`, "7F1D1D");
  p.blank();
  const head = p.header(["#", "Severity", "Dimension", "Column", "Finding", "Rows", "% of rows", "Evidence", "What it means", "Fix in the app"], "991B1B", 24);
  const first = head + 1;
  issues.forEach((issue, i) => {
    const zebra = i % 2 === 1;
    const longest = Math.max(issue.title.length / 40, issue.evidence.length / 50, (issue.impact ?? "").length / 38);
    p.line(
      [i + 1, SEVERITY[issue.severity].word, issue.dimension, issue.column ?? "(table)", issue.title, issue.rows, share(issue.rows, report.rows), issue.evidence, issue.impact ?? "", issue.fix ?? ""],
      [p.cell(zebra, { color: P.dim }), p.chip(issue.severity), p.cell(zebra), p.cell(zebra), p.cell(zebra, { bold: true }), p.cell(zebra, { numFmt: "#,##0" }), p.cell(zebra, { numFmt: "0.0%" }), p.cell(zebra, { size: 9 }), p.cell(zebra, { size: 9, color: P.dim }), p.cell(zebra, { size: 9, color: P.greenInk, bold: true })],
      Math.max(20, 13 * Math.ceil(longest)),
    );
  });
  if (issues.length === 0) p.note("No findings: every check passed.");
  if (p.r >= first) p.bars.push({ ref: `G${first}:G${p.r}`, color: "F87171" });
  p.end(issues.length === 0 ? undefined : `A${head}:J${p.r}`);
}

// ---------------------------------------------------------------- Checks & rules

function writeChecks(book: XlsxBuilder, name: string, input: QualityWorkbookInput): void {
  const { report } = input;
  const p = page(book, name, "10B981", [16, 40, 56, 10, 10, 10, 11, 10]);
  p.band("Checks & rules", "Every scored check behind the dimensions, then the rules you added on the Quality page", "064E3B");
  const labels = new Map(report.dimensions.map((d) => [d.dimension, d.label]));
  const status = (fail: number, compared: number): number =>
    p.style({ bold: true, size: 9, align: "center", valign: "top", fill: compared === 0 ? P.greyTint : fail === 0 ? P.greenFill : P.redFill, color: compared === 0 ? P.dim : fail === 0 ? P.greenInk : P.redInk, border: { bottom: { style: "thin", color: P.rule } } });
  const word = (fail: number, compared: number): string => (compared === 0 ? "N/A" : fail === 0 ? "PASS" : "FAIL");

  p.section(`Scored checks (${report.checks.length})`, "059669");
  if (report.checks.length === 0) p.note("No checks apply to this table.");
  else {
    p.header(["Dimension", "Check", "Detail", "Passed", "Failed", "Not applicable", "Pass rate", "Status"], "047857");
    const first = p.r + 1;
    const ordered = [...report.checks].sort((a, b) => b.fail / Math.max(1, b.pass + b.fail) - a.fail / Math.max(1, a.pass + a.fail));
    ordered.forEach((c, i) => {
      const zebra = i % 2 === 1;
      const compared = c.pass + c.fail;
      p.line(
        [labels.get(c.dimension) ?? c.dimension, c.label, c.detail, c.pass, c.fail, c.na === 0 ? null : c.na, compared === 0 ? null : c.pass / compared, word(c.fail, compared)],
        [p.cell(zebra), p.cell(zebra, { bold: true }), p.cell(zebra, { size: 9, color: P.dim }), p.cell(zebra, { numFmt: "#,##0" }), p.cell(zebra, { numFmt: "#,##0", ...(c.fail > 0 ? { color: P.redInk, bold: true } : {}) }), p.cell(zebra, { numFmt: "#,##0" }), p.cell(zebra, { numFmt: "0.0%" }), status(c.fail, compared)],
        Math.max(18, 13 * Math.ceil(Math.max(c.label.length / 38, c.detail.length / 60))),
      );
    });
    p.scales.push({ ref: `G${first}:G${p.r}`, colors: ["F87171", "FDE68A", "86EFAC"], middle: 0.95 });
  }

  const rules = report.rules ?? [];
  p.section(`Your rules (${rules.length})`, "059669");
  if (rules.length === 0) p.note("No rules yet. Add them on the Quality page (Checks tab) and they will be listed here with their results.");
  else {
    p.header(["Severity", "Rule", "", "Checked", "Failed", "", "Pass rate", "Status"], "047857");
    p.merge(p.r, 1, 2);
    rules.forEach((rule, i) => {
      const zebra = i % 2 === 1;
      const at = p.line(
        [rule.severity, rule.text, null, rule.compared, rule.fail, null, rule.compared === 0 ? null : 1 - rule.fail / rule.compared, word(rule.fail, rule.compared)],
        [p.cell(zebra, { bold: true, color: RULE_INK[rule.severity] ?? P.ink }), p.cell(zebra), p.cell(zebra), p.cell(zebra, { numFmt: "#,##0" }), p.cell(zebra, { numFmt: "#,##0" }), p.cell(zebra), p.cell(zebra, { numFmt: "0.0%" }), status(rule.fail, rule.compared)],
      );
      p.merge(at, 1, 2);
    });
  }
  p.end();
}

// ---------------------------------------------------------------- Exceptions

function writeExceptions(book: XlsxBuilder, name: string, input: QualityWorkbookInput, groups: readonly ExceptionGroup[], total: number, written: number): void {
  const p = page(book, name, "F59E0B", [10, 24, 48, 52, 14, 10]);
  p.band(
    "Exceptions",
    `One row per failing cell · ${nf.format(written)} of ${nf.format(total)} listed (at most ${nf.format(EXCEPTIONS_PER_CHECK)} per check) · Row = the row number in the Table view · ${input.rawValues ? "raw values" : "sensitive values masked"} · empty cells are counted on the Columns sheet instead`,
    "78350F",
  );
  const order = (s: string): number => (s === "fix" ? 0 : s === "review" ? 1 : 2);
  const sorted = [...groups].sort((a, b) => order(a.severity) - order(b.severity) || b.total - a.total);

  p.section("Failing cells by check", "D97706");
  if (sorted.length === 0) {
    p.note("No failing cells: every value passed every check that looks at single cells.");
    p.end();
    return;
  }
  p.header(["Severity", "Column", "Check", "", "Failing cells", "Listed"], "B45309");
  p.merge(p.r, 2, 3);
  const first = p.r + 1;
  sorted.forEach((g, i) => {
    const zebra = i % 2 === 1;
    const sev = severityOfException(g.severity);
    const at = p.line([SEVERITY[sev].word, g.column, g.reason, null, g.total, g.rows.length], [p.chip(sev), p.cell(zebra, { bold: true }), p.cell(zebra), p.cell(zebra), p.cell(zebra, { numFmt: "#,##0" }), p.cell(zebra, { numFmt: "#,##0", color: P.dim })]);
    p.merge(at, 2, 3);
  });
  p.bars.push({ ref: `E${first}:E${p.r}`, color: "FBBF24" });

  p.section("Every listed cell", "D97706");
  const head = p.header(["Row", "Column", "Value", "Why it fails", "Dimension", "Severity"], "B45309");
  let i = 0;
  for (const g of sorted) {
    const sev = severityOfException(g.severity);
    for (const row of g.rows) {
      const zebra = i++ % 2 === 1;
      // Spaces made visible so a stray one can be seen.
      const shown = row.value === "" ? "(empty)" : /^\s|\s$|\s{2}/.test(row.value) ? row.value.replace(/ /g, "·") : row.value;
      p.line(
        [row.row, row.column, shown, row.reason, row.dimension, SEVERITY[sev].word],
        [p.cell(zebra, { numFmt: "#,##0" }), p.cell(zebra), p.style({ size: 10, color: SEVERITY[sev].ink, fill: SEVERITY[sev].fill, valign: "top", wrap: true, border: { bottom: { style: "thin", color: P.rule } } }), p.cell(zebra, { size: 9 }), p.cell(zebra, { size: 9, color: P.dim }), p.chip(sev)],
      );
    }
  }
  p.end(`A${head}:F${p.r}`);
}

// ---------------------------------------------------------------- Relationships

function writeRelationships(book: XlsxBuilder, name: string, input: QualityWorkbookInput): void {
  const p = page(book, name, "06B6D4", [22, 34, 70, 12]);
  p.band("Relationships", "How columns depend on each other: blanks that travel together, values that decide others, repeated rows, and spellings of the same value", "164E63");

  p.section(`Findings across columns (${input.relations.length})`, "0891B2");
  if (input.relations.length === 0) p.note("No finding ties two or more columns together.");
  else {
    p.header(["Kind", "Columns", "Finding", "Rows"], "0E7490");
    input.relations.forEach((rel, i) => {
      const zebra = i % 2 === 1;
      p.line([rel.kind, rel.columns.join(", "), rel.title, rel.rows], [p.cell(zebra, { bold: true }), p.cell(zebra), p.cell(zebra), p.cell(zebra, { numFmt: "#,##0" })], Math.max(18, 13 * Math.ceil(Math.max(rel.title.length / 66, rel.columns.join(", ").length / 32))));
    });
  }

  p.section(`Spelling variants (${input.variants.length})`, "0891B2");
  if (input.variants.length === 0) p.note("No value is written in more than one way (case, spaces or accents).");
  else {
    p.header(["Column", "Keep", "Other spellings (rows)", "Rows to merge"], "0E7490");
    input.variants.forEach((v, i) => {
      const zebra = i % 2 === 1;
      const [keep, ...others] = v.spellings;
      const minority = others.reduce((sum, s) => sum + s.count, 0);
      const shown = (s: string): string => (/^\s|\s$|\s{2}/.test(s) ? `“${s.replace(/ /g, "·")}”` : `“${s}”`);
      p.line(
        [v.column, keep === undefined ? "" : `${shown(keep.value)} (${nf.format(keep.count)})`, others.map((s) => `${shown(s.value)} (${nf.format(s.count)})`).join("   "), minority],
        [p.cell(zebra, { bold: true }), p.cell(zebra, { color: P.greenInk }), p.cell(zebra, { color: P.amberInk }), p.cell(zebra, { numFmt: "#,##0" })],
      );
    });
  }
  p.end();
}

// ---------------------------------------------------------------- Sensitive

function writeSensitive(book: XlsxBuilder, name: string, input: QualityWorkbookInput): void {
  const p = page(book, name, "EC4899", [26, 24, 16, 46, 50]);
  const list = input.report.sensitive ?? [];
  p.band("Sensitive data", `Columns that may identify people · ${input.rawValues ? "examples shown raw, as requested" : "examples masked"}`, "831843");
  p.blank();
  if (list.length === 0) {
    p.note("No column looks like it identifies people (names, emails, phones, handles, ids). Columns you dismissed on the Sensitive tab are not listed.");
    p.end();
    return;
  }
  p.header(["Column", "Looks like", "Suggested handling", "Examples", "Before sharing"], "9D174D");
  list.forEach((s, i) => {
    const zebra = i % 2 === 1;
    p.line([s.name, SENSITIVE_WORDS[s.class] ?? s.class, s.label, (input.sensitiveExamples[s.name] ?? []).join(", "), "Mask, hash or drop this column before the file leaves the team."], [p.cell(zebra, { bold: true }), p.cell(zebra), p.cell(zebra, { color: P.pinkInk, bold: true }), p.cell(zebra, { size: 9 }), p.cell(zebra, { size: 9, color: P.dim })]);
  });
  p.end();
}

// ---------------------------------------------------------------- About

function writeAbout(book: XlsxBuilder, name: string, input: QualityWorkbookInput): void {
  const { report } = input;
  const p = page(book, name, "6B7280", [26, 100], { landscape: false });
  p.band("About this report", "Where the numbers came from and how they were made", "374151");
  const label = p.style({ bold: true, size: 10, color: P.ink, fill: P.greyTint, valign: "top" });
  const value = p.style({ size: 10, color: P.ink, wrap: true, valign: "top" });
  const info = (k: string, v: string): void => void p.line([k, v], [label, value], Math.max(16, 14 * Math.ceil(v.length / 110)));

  p.section("Scope", "4B5563");
  info("Rows scored", `All ${nf.format(report.rows)} rows of the file. Filters on the Table view do not change this report.`);
  info("Generated", input.created);
  if (report.scoreVersion !== undefined) info("Score version", String(report.scoreVersion));

  p.section("How the score is made", "4B5563");
  const good = report.provenance?.scoring.bands.good ?? 90;
  const fair = report.provenance?.scoring.bands.fair ?? 75;
  info("Overall", "The weighted mean of the dimension scores that apply. A dimension with no checks is left out rather than counted as perfect.");
  info("Bands", `Good at ${good} or more, fair from ${fair}, poor below ${fair}. A serious problem in one column can hold the band down; the Summary says why when it does.`);
  for (const d of report.dimensions) info(`${d.label} (weight ${d.weight})`, `${DIMENSION_TEXT[d.dimension] ?? ""}${d.note === null ? "" : ` ${d.note}`}`);
  info("Exceptions", `Single-cell failures only, at most ${nf.format(EXCEPTIONS_PER_CHECK)} per check. Empty cells are not listed (the Columns sheet counts them). exceptions.csv on the Quality page has every failing cell.`);
  info("Privacy", input.rawValues ? "Raw values were included at your request: treat this file as sensitive." : "Values of columns flagged as possibly sensitive are masked everywhere in this workbook.");

  if (report.provenance !== undefined) {
    p.section("Source and reading", "4B5563");
    for (const [k, v] of provenanceRows(report.provenance)) info(k, v);
  }
  p.end();
}
