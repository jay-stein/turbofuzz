/**
 * The recipe contract shared by every code generator (pandas now, Polars
 * next): one status vocabulary and one report shape, so the exporters can
 * never silently drop an applied step.
 */

import type { ColumnType } from "../types.js";
import { builtInNullTokens } from "../parse/null-tokens.js";
import { detectTable, type HeaderLayout } from "../parse/header-detect.js";
import type { Delimiter } from "../parse/delimiter.js";
import type { FileEncoding } from "../parse/encoding.js";

export type RecipeTarget = "pandas" | "polars";

/**
 * Library versions the generated scripts were run against by the parity harness
 * (tools/recipe-parity). They must equal the pins in tools/recipe-parity/requirements.txt:
 * run_parity.py refuses other versions and test/recipe-versions.test.ts compares the two.
 */
export const TESTED_PANDAS = "3.1.1";
export const TESTED_POLARS = "2.1.0";
/** Oldest versions the harness was also run on and passed. Anything older is untested. */
export const MIN_VERIFIED_PANDAS = "2.3.3";
export const MIN_VERIFIED_POLARS = "1.44.2";

const LIBRARY: Record<RecipeTarget, { name: string; tested: string; min: string }> = {
  pandas: { name: "pandas", tested: TESTED_PANDAS, min: MIN_VERIFIED_PANDAS },
  polars: { name: "Polars", tested: TESTED_POLARS, min: MIN_VERIFIED_POLARS },
};

/** "3.1.1" → "3.1". */
function minor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

/** Script header lines naming the library version the script is written for and was tested with. */
export function versionHeaderLines(target: RecipeTarget): string[] {
  const { name, tested, min } = LIBRARY[target];
  const major = Number(tested.split(".")[0]);
  return [
    `# Written for ${name} ${minor(tested)} (tested with ${name} ${tested}). Install: pip install "${target}>=${minor(tested)},<${major + 1}"`,
    `#   Also passes the same checks on ${name} ${min}; versions older than that are untested.`,
  ];
}

/** "tested with pandas 3.1.1" — shown beside the language picker in the Recipe drawer. */
export function testedVersionLine(target: RecipeTarget): string {
  return `Tested with ${LIBRARY[target].name} ${LIBRARY[target].tested}`;
}

export type SupportStatus = "supported" | "supported_with_warning" | "manual_step_required";

export interface SupportEntry {
  /** Step label in recipe order, e.g. `impute: mean of amount within city`. */
  label: string;
  /** `manual_step_required` names the missing work in `note`. */
  status: SupportStatus;
  note?: string;
}

export interface RecipeScript {
  target: RecipeTarget;
  code: string;
  /** One entry per applied step, in apply order. */
  entries: SupportEntry[];
}

export interface SupportSummary {
  supported: number;
  warnings: number;
  manual: number;
}

export function supportSummary(entries: readonly SupportEntry[]): SupportSummary {
  let supported = 0;
  let warnings = 0;
  let manual = 0;
  for (const entry of entries) {
    if (entry.status === "supported") supported++;
    else if (entry.status === "supported_with_warning") warnings++;
    else manual++;
  }
  return { supported, warnings, manual };
}

/** Human line for the Recipe drawer: what the exporter can and cannot do. */
export function supportHint(target: RecipeTarget, entries: readonly SupportEntry[]): string {
  const { supported, warnings, manual } = supportSummary(entries);
  if (entries.length === 0) return `No steps to export as ${target}. ${testedVersionLine(target)}.`;
  const parts = [`${supported + warnings} of ${entries.length} steps export as executable ${target}`];
  if (warnings > 0) parts.push(`${warnings} with a documented limitation`);
  if (manual > 0) parts.push(`${manual} need manual translation`);
  parts.push(testedVersionLine(target));
  return parts.join(" · ");
}

/** One header comment listing every step the generator cannot fully express. */
export function supportHeaderLines(entries: readonly SupportEntry[]): string[] {
  const manual = entries.filter((entry) => entry.status === "manual_step_required");
  const warnings = entries.filter((entry) => entry.status === "supported_with_warning");
  const lines: string[] = [];
  if (manual.length === 0 && warnings.length === 0) {
    lines.push("# Every applied step is generated below.");
    return lines;
  }
  lines.push("# Non-equivalent steps (review before trusting the output):");
  for (const entry of warnings) {
    lines.push(`#   ~ ${entry.label}${entry.note === undefined ? "" : ` — ${entry.note}`}`);
  }
  for (const entry of manual) {
    lines.push(`#   ! ${entry.label}${entry.note === undefined ? "" : ` — ${entry.note}`}`);
  }
  return lines;
}

/**
 * Report line for a date or datetime type step. The order the app read the column in is
 * passed through `dateOrders`; without it the script reads day first, the app's default.
 */
export function typeDateEntry(name: string, type: "date" | "datetime", order: string | undefined, review: string | null): SupportEntry {
  const label = `type: ${name} → ${type}`;
  if (review !== null) return { label, status: "manual_step_required", note: review };
  if (order === undefined) {
    return { label, status: "supported_with_warning", note: "the day/month order was not recorded; read day first, the app's default" };
  }
  return { label, status: "supported" };
}

/** Types a default CSV reader would wrongly turn into numbers (0800 → 800, 20240315 → 20,240,315). */
const READ_AS_TEXT: ReadonlySet<ColumnType> = new Set(["identifier", "string", "category", "date", "datetime", "time"]);

/**
 * Names of the columns the app holds as text or identifiers (leading zeroes, digit-only
 * dates) so the script's reader can be told not to guess a numeric type for them.
 */
export function readAsTextColumns(schema: readonly { name: string; type?: ColumnType }[]): string[] {
  const names: string[] = [];
  for (const { name, type } of schema) {
    if (type !== undefined && READ_AS_TEXT.has(type) && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The words and symbols the app counts as missing in every column (any case, padded with
 * spaces), as a Python list literal, plus the per-column tokens the user chose to keep as
 * values. A reader's own default list is shorter, so the script blanks these itself.
 */
export function missingTokenSetup(nulls: readonly { name: string; keep: readonly string[] }[]): { tokens: string; keep: string } {
  const tokens = `[${builtInNullTokens().map((token) => JSON.stringify(token)).join(", ")}]`;
  const kept = nulls.filter((entry) => entry.keep.length > 0);
  const keep = `{${kept.map((entry) => `${JSON.stringify(entry.name)}: [${entry.keep.map((token) => JSON.stringify(token)).join(", ")}]`).join(", ")}}`;
  return { tokens, keep };
}

/**
 * How the importer read the file, so the script's reader can do the same. Every field is optional:
 * a missing one means the app did not know it, and the script then leaves that option at the
 * library default. `delimiter: null` means the source was not delimited text (JSON, a worksheet),
 * which no CSV reader can be written for.
 */
export interface RecipeSource {
  delimiter?: Delimiter | null;
  /** The encoding the app decoded the bytes as. */
  encoding?: FileEncoding | null;
  /** Records above the header block (titles, notes). Empty lines are not records. */
  skipRows?: number;
  /** Header levels: 0 means the file has no header row, more than 1 were joined. */
  headerRows?: number;
  /** Records between the header block and the first data row (units lines). */
  skipAfter?: number;
  /** Non-empty rows cut from the end (totals, notes). `null`: the end was not inspected. */
  footerRows?: number | null;
  /** Every column name the importer built, before columns were left out. */
  columns?: readonly string[];
  /** Columns the importer left out by choice, by name. */
  dropColumns?: readonly string[];
}

/** The reader choices both generators share, worked out once from `RecipeSource`. */
export interface ReaderPlan {
  sep: Delimiter;
  /** Python that gives `codec` its value, when it is not a plain name (UTF-16 with or without a byte-order mark). */
  codecSetup: string[];
  /** The Python expression for the codec of the bytes: a quoted name, or a variable `codecSetup` defines. */
  codec: string;
  /** pandas encoding arguments, already formatted. */
  pandasEncoding: string[];
  /** pl.read_csv can read it itself: its own name for UTF-8 and lossy UTF-8. Null: it cannot. */
  polarsEncoding: "utf8" | "utf8-lossy" | null;
  /** Polars cannot read this encoding: the bytes are decoded in Python first. */
  transcode: boolean;
  /** Records to skip before the header (one header row) or before the data (header-less, several header rows). */
  skipRecords: number;
  /** One header row straight under the skipped rows: the reader can take the names from the file. */
  fileHeader: boolean;
  /** The importer's column names; null when the caller did not give them. */
  names: readonly string[] | null;
  footerRows: number | null;
  dropColumns: readonly string[];
  /** Comment lines to print above the reader. */
  notes: string[];
}

/**
 * Counts rows the way the importer does: lines with every cell empty are not rows, but pandas and
 * Polars count every line when asked to skip some. Emitted only when rows are skipped.
 */
export const SKIP_LINES_HELPER = [
  "def _tf_skip_lines(path, records, sep, encoding):",
  "    # TurboFuzz does not count empty lines as rows; the readers count every line. This finds the line",
  "    # of the first row after the `records` skipped ones.",
  "    seen, line_no = 0, -1",
  "    with open(path, encoding=encoding, errors=\"replace\") as f:",
  "        for line_no, line in enumerate(f):",
  "            if line.replace(sep, \"\").replace('\"', \"\").strip():",
  "                if seen == records:",
  "                    return line_no",
  "                seen += 1",
  "    return line_no + 1",
];

/** Null when the source is not delimited text or was not recorded: the script keeps the plain reader. */
export function readerPlan(source: RecipeSource | undefined): ReaderPlan | null {
  if (source === undefined || source.delimiter === undefined || source.delimiter === null) return null;
  const encoding = source.encoding ?? null;
  let codec = '"utf-8"';
  const codecSetup: string[] = [];
  let pandasEncoding: string[] = [];
  let polarsEncoding: ReaderPlan["polarsEncoding"] = encoding === null || encoding === "utf-8" ? "utf8" : null;
  const notes: string[] = [];
  switch (encoding) {
    case "utf-8-repaired":
      pandasEncoding = ['encoding="utf-8"', 'encoding_errors="replace"'];
      polarsEncoding = "utf8-lossy";
      break;
    case "windows-1252":
      codec = '"cp1252"';
      pandasEncoding = ['encoding="cp1252"', 'encoding_errors="replace"'];
      break;
    case "utf-32le":
    case "utf-32be":
      // Same as UTF-16: the codec named "utf-32" needs the byte-order mark, the explicit ones keep it as a character.
      codec = "_tf_encoding";
      codecSetup.push(
        `_tf_encoding = "utf-32" if open("input.csv", "rb").read(4) in (b"\\xff\\xfe\\x00\\x00", b"\\x00\\x00\\xfe\\xff") else "${encoding === "utf-32le" ? "utf-32-le" : "utf-32-be"}"`,
      );
      pandasEncoding = ["encoding=_tf_encoding"];
      break;
    case "utf-16le":
    case "utf-16be":
      // Python's "utf-16" needs a byte-order mark, and the explicit -le/-be codecs keep it as a character.
      codec = "_tf_encoding";
      codecSetup.push(
        `_tf_encoding = "utf-16" if open("input.csv", "rb").read(2) in (b"\\xff\\xfe", b"\\xfe\\xff") else "${encoding === "utf-16le" ? "utf-16-le" : "utf-16-be"}"`,
      );
      pandasEncoding = ["encoding=_tf_encoding"];
      break;
  }
  const skipRows = Math.max(0, source.skipRows ?? 0);
  const headerRows = source.headerRows ?? 1;
  const skipAfter = Math.max(0, source.skipAfter ?? 0);
  const fileHeader = headerRows === 1 && skipAfter === 0;
  if (source.footerRows === null) {
    notes.push("# The end of the file was not checked for totals or notes when it was loaded: look at the last rows of cleaned.csv.");
  }
  return {
    sep: source.delimiter,
    codecSetup,
    codec,
    pandasEncoding,
    polarsEncoding,
    transcode: polarsEncoding === null,
    skipRecords: fileHeader ? skipRows : skipRows + headerRows + skipAfter,
    fileHeader,
    names: source.columns === undefined ? null : [...source.columns],
    footerRows: source.footerRows ?? null,
    dropColumns: source.dropColumns ?? [],
    notes,
  };
}

/**
 * Lines run right after the read, in the script's own library: the importer skips every row whose
 * cells are all empty, then leaves out the footer rows it found, then any columns the user left out.
 */
export function afterReadLines(plan: ReaderPlan, target: RecipeTarget): string[] {
  const names = plan.dropColumns.map((name) => JSON.stringify(name)).join(", ");
  const lines = [
    target === "pandas"
      ? 'df = df.dropna(how="all")  # the importer skips rows with every cell empty'
      : "df = df.filter(~pl.all_horizontal(pl.all().is_null()))  # the importer skips rows with every cell empty",
  ];
  if (plan.footerRows !== null && plan.footerRows > 0) {
    const n = plan.footerRows;
    const why = `# the importer left out the last ${n} row${n === 1 ? "" : "s"} (totals or notes after the data)`;
    lines.push(target === "pandas" ? `df = df.iloc[:-${n}]  ${why}` : `df = df.head(-${n})  ${why}`);
  }
  if (plan.dropColumns.length > 0) {
    lines.push(target === "pandas" ? `df = df.drop(columns=[${names}])` : `df = df.drop([${names}])`);
  }
  return lines;
}

/** What a header-row layout and a file's facts say about how the importer read it. */
export function recipeSourceOf(read: {
  preview: readonly string[][];
  /** The last rows of a source too big to hold whole. */
  tail?: readonly string[][];
  /** The preview is the whole source. */
  whole: boolean;
  layout: HeaderLayout | null;
  hasHeaders: boolean;
  delimiter: Delimiter | null;
  encoding: FileEncoding | null;
}): RecipeSource {
  const { preview, tail, whole, layout, hasHeaders, delimiter, encoding } = read;
  if (delimiter === null) return { delimiter: null, encoding };
  // No header detection runs: every record is data and the columns are named automatically.
  if (layout === null && !hasHeaders) {
    return { delimiter, encoding, skipRows: 0, headerRows: 0, skipAfter: 0, footerRows: 0 };
  }
  const at = layout ?? undefined;
  const found = detectTable(preview as string[][], at);
  let footerRows: number | null;
  if (whole) footerRows = found.footerRows;
  else if (tail !== undefined && tail.length > 0) footerRows = detectTable([...preview, ...tail], at).footerRows;
  else footerRows = null;
  // The importer names a blank header cell by its position.
  const named = (headers: readonly string[], index: number): string => ((headers[index] ?? "").trim() === "" ? `Column ${index + 1}` : headers[index]!);
  let columns = found.headers.map((_, index) => named(found.headers, index));
  let dropColumns: string[] = [];
  const dropped = layout?.skipColumns ?? [];
  if (layout !== null && dropped.length > 0) {
    const all = detectTable(preview as string[][], { ...layout, skipColumns: [] }).headers;
    const out = new Set(dropped);
    let kept = 0;
    columns = all.map((_, index) => (out.has(index) ? named(all, index) : named(found.headers, kept++)));
    dropColumns = columns.filter((_, index) => out.has(index));
  }
  return {
    delimiter,
    encoding,
    skipRows: found.skipRows,
    headerRows: found.headerRows,
    skipAfter: found.skipAfter,
    footerRows,
    columns,
    dropColumns,
  };
}
