import Papa from "papaparse";
import { detectDelimiter, type Delimiter } from "./delimiter.js";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
  hasHeaders: boolean;
  ragged: RaggedInfo;
}

export interface ParseOptions {
  delimiter?: Delimiter | "auto";
  hasHeaders?: boolean;
  /** Pad/truncate rows to the table width (default true). */
  normalizeRows?: boolean;
  /** Stop after this many rows (Papaparse preview) for sampling big files. */
  preview?: number;
}

/** Counts describing rows that do not match the final table width. */
export interface RaggedInfo {
  /** Data rows shorter than the width; the missing cells become empty. */
  paddedRows: number;
  /** Data rows that carried non-empty cells past the width. */
  extraCellRows: number;
  /** Total non-empty cells dropped past the width. */
  extraCells: number;
  /** File lines where a quote never closed and was dropped so the rows after it read normally. */
  strayQuoteLines?: number[];
  /** Unreadable characters shown as U+FFFD in the decoded text: how many, and the file line of the first. */
  replaced?: { count: number; line: number };
}

export interface StructuredTable {
  headers: string[];
  rows: string[][];
  ragged: RaggedInfo;
}

export function measureRagged(rows: readonly string[][], width: number): RaggedInfo {
  let paddedRows = 0;
  let extraCellRows = 0;
  let extraCells = 0;
  for (const row of rows) {
    if (row.length < width) {
      paddedRows++;
      continue;
    }
    if (row.length <= width) continue;
    let extra = 0;
    for (let i = width; i < row.length; i++) {
      if ((row[i] ?? "") !== "") extra++;
    }
    if (extra > 0) {
      extraCellRows++;
      extraCells += extra;
    }
  }
  return { paddedRows, extraCellRows, extraCells };
}

/** Turns a raw grid into named headers plus width-normalised rows. */
export function structureTable(
  data: string[][],
  hasHeaders: boolean,
  normalize = true,
): StructuredTable {
  let headers: string[];
  let rows: string[][];

  if (hasHeaders && data.length > 0) {
    headers = data[0].map((value, index) => {
      const trimmed = value.trim();
      return trimmed === "" ? `Column ${index + 1}` : trimmed;
    });
    rows = data.slice(1);
  } else {
    const width = data.reduce((max, row) => Math.max(max, row.length), 0);
    headers = Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
    rows = data;
  }

  const width = headers.length;
  const ragged = measureRagged(rows, width);
  if (normalize) {
    for (const row of rows) {
      if (row.length < width) {
        while (row.length < width) row.push("");
      } else if (row.length > width) {
        row.length = width;
      }
    }
  }

  return { headers, rows, ragged };
}

/**
 * Papaparse picks one line ending from the start of the file, so a file whose
 * header ends in CRLF but whose rows end in LF (or the reverse, or a second
 * export pasted on the end) reads rows together. When a file mixes the two
 * anywhere, CRLF becomes LF throughout; quoted line breaks stay inside their
 * cells either way. Files with one kind of ending pass through untouched.
 */
const LONE_LF = /(?:^|[^\r])\n/;

export function evenLineEndings(text: string): string {
  // About 10 ms per 200 MB when there is no CRLF, 100 ms when every line has one.
  if (text.indexOf("\r\n") === -1) return text;
  return LONE_LF.test(text) ? text.replace(/\r\n/g, "\n") : text;
}

/** Re-reads after a stray quote at most this many times; each is a full pass. */
const MAX_QUOTE_REPAIRS = 20;

function lineOf(text: string, at: number): number {
  let line = 1;
  for (let next = text.indexOf("\n"); next !== -1 && next < at; next = text.indexOf("\n", next + 1)) line++;
  return line;
}

/** Where a stray opening quote sits when the error says one swallowed a line break; -1 otherwise. */
function strayQuoteAt(input: string, error: Papa.ParseError, data: readonly unknown[]): number {
  if (error.code !== "MissingQuotes" && error.code !== "InvalidQuotes") return -1;
  const at = error.index === undefined ? -1 : error.index - 1;
  if (at < 0 || input.charCodeAt(at) !== 34) return -1;
  if (error.code === "MissingQuotes") return at;
  const nextQuote = input.indexOf('"', at + 1);
  const nextLine = input.indexOf("\n", at + 1);
  if (nextLine !== -1 && (nextQuote === -1 || nextLine < nextQuote)) return at;
  // `"VAL" VALMA PAUL`: the quote closes on its own line but junk follows, so Papaparse reads on to some
  // later quote. When the row it built holds line breaks, those were rows: drop the opening quote.
  const row = typeof error.row === "number" ? data[error.row] : undefined;
  return Array.isArray(row) && row.some((cell) => typeof cell === "string" && cell.includes("\n")) ? at : -1;
}

export function parseDelimited(text: string, options: ParseOptions = {}): ParsedTable {  const delimiter =
    options.delimiter !== undefined && options.delimiter !== "auto"
      ? options.delimiter
      : detectDelimiter(text);

  const config = {
    delimiter,
    skipEmptyLines: "greedy" as const,
    ...(options.preview === undefined ? {} : { preview: options.preview }),
  };
  let input = evenLineEndings(text);
  let result = Papa.parse<string[]>(input, config);
  // A quote that never closes swallows the following rows into one cell, up to
  // the end of the file or the next quote. Papaparse reports where it opened:
  // drop that quote, read again, and say which line. A malformed quote that
  // swallows no line break (`"5" long`) is left as Papaparse reads it.
  const strayQuoteLines: number[] = [];
  const strayAt = (error: Papa.ParseError): number => strayQuoteAt(input, error, result.data);
  for (let repairs = 0; repairs < MAX_QUOTE_REPAIRS; repairs++) {
    let at = -1;
    for (const error of result.errors) {
      at = strayAt(error);
      if (at >= 0) break;
    }
    if (at < 0) break;
    strayQuoteLines.push(lineOf(input, at));
    input = input.slice(0, at) + input.slice(at + 1);
    result = Papa.parse<string[]>(input, config);
  }

  const data = result.data.filter((row) => Array.isArray(row) && row.length > 0);
  const hasHeaders = options.hasHeaders ?? true;
  const normalize = options.normalizeRows ?? true;
  const { headers, rows, ragged } = structureTable(data, hasHeaders, normalize);
  if (strayQuoteLines.length > 0) ragged.strayQuoteLines = strayQuoteLines;

  return { headers, rows, delimiter, hasHeaders, ragged };
}

/**
 * Two first rows count as identical headers when trimmed and case-folded.
 * Used by the ZIP "Import all" check before appending files.
 */
export function sameHeaderRow(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if ((a[index] ?? "").trim().toLowerCase() !== (b[index] ?? "").trim().toLowerCase()) {
      return false;
    }
  }
  return true;
}

/** Characters per Papaparse chunk: a few tens of ms of parsing, so a cancel lands quickly. */
const ASYNC_CHUNK_CHARS = 4_000_000;

export interface AsyncParseHooks {
  /** Rows read so far and the text position, called once per chunk (the caller throttles). */
  onChunk?: (rowsRead: number, charsRead: number, totalChars: number) => void;
  /** Checked between chunks; true abandons the parse. */
  cancelled?: () => boolean;
}

/** Papaparse over `input` in pausable chunks, yielding between them; null when cancelled. */
function parseChunked(
  input: string,
  config: { delimiter: Delimiter; skipEmptyLines: "greedy" },
  hooks: AsyncParseHooks,
): Promise<{ data: string[][]; errors: Papa.ParseError[] } | null> {
  return new Promise((resolve, reject) => {
    const data: string[][] = [];
    const errors: Papa.ParseError[] = [];
    let base = 0;
    let stopped = false;
    Papa.parse<string[]>(input, {
      ...config,
      chunkSize: ASYNC_CHUNK_CHARS,
      chunk: (chunk: Papa.ParseResult<string[]>, parser: Papa.Parser) => {
        for (const row of chunk.data) data.push(row);
        // Error indexes are relative to the chunk; the cursor of the one before locates them.
        for (const error of chunk.errors) errors.push({ ...error, index: (error.index ?? 0) + base });
        base = chunk.meta.cursor;
        hooks.onChunk?.(data.length, base, input.length);
        parser.pause();
        setTimeout(() => {
          if (hooks.cancelled?.() === true) {
            stopped = true;
            resolve(null);
            parser.abort();
          } else parser.resume();
        }, 0);
      },
      complete: () => {
        if (!stopped) resolve({ data, errors });
      },
      error: (error: Error) => reject(error),
    });
  });
}

/**
 * Same result as `parseDelimited`, but reads big text in chunks, reporting
 * rows read and yielding between chunks so the worker can see a cancel.
 * Returns null when cancelled. Previews and small text use the plain call.
 */
export async function parseDelimitedAsync(
  text: string,
  options: ParseOptions = {},
  hooks: AsyncParseHooks = {},
): Promise<ParsedTable | null> {
  if (options.preview !== undefined || text.length <= ASYNC_CHUNK_CHARS) return parseDelimited(text, options);
  const delimiter =
    options.delimiter !== undefined && options.delimiter !== "auto"
      ? options.delimiter
      : detectDelimiter(text);
  const config = { delimiter, skipEmptyLines: "greedy" as const };
  let input = evenLineEndings(text);
  let result = await parseChunked(input, config, hooks);
  const strayQuoteLines: number[] = [];
  for (let repairs = 0; result !== null && repairs < MAX_QUOTE_REPAIRS; repairs++) {
    let at = -1;
    for (const error of result.errors) {
      at = strayQuoteAt(input, error, result.data);
      if (at >= 0) break;
    }
    if (at < 0) break;
    strayQuoteLines.push(lineOf(input, at));
    input = input.slice(0, at) + input.slice(at + 1);
    result = await parseChunked(input, config, hooks);
  }
  if (result === null) return null;
  const data = result.data.filter((row) => Array.isArray(row) && row.length > 0);
  const hasHeaders = options.hasHeaders ?? true;
  const { headers, rows, ragged } = structureTable(data, hasHeaders, options.normalizeRows ?? true);
  if (strayQuoteLines.length > 0) ragged.strayQuoteLines = strayQuoteLines;
  return { headers, rows, delimiter, hasHeaders, ragged };
}
