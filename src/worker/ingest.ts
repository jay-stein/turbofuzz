import { buildDataset, buildDatasetAsync } from "../data/build.js";
import type { Dataset } from "../data/dataset.js";
import { decodeText, type FileEncoding } from "../parse/encoding.js";
import { detectTable } from "../parse/header-detect.js";
import { isJsonName, parseJsonGrid } from "../parse/json.js";
import type { NumberLocale } from "../parse/numbers.js";
import {
  measureRagged,
  parseDelimited,
  structureTable,
  type RaggedInfo,
} from "../parse/parse.js";
import type { Delimiter } from "../parse/delimiter.js";
import type { ProgressPhase } from "./protocol.js";

export interface IngestProgress {
  phase: ProgressPhase;
  detail?: string;
  current?: number;
  total?: number;
}

export interface IngestOptions {
  name: string;
  delimiter: Delimiter | "auto";
  hasHeaders: boolean;
  text?: string;
  buffer?: ArrayBuffer;
  table?: { rows: string[][]; hasHeaders: boolean };
  /** Parse only the first N rows of delimited text (large-file sampling). */
  maxRows?: number;
  onProgress?: (progress: IngestProgress) => void;
}

export interface IngestResult {
  dataset: Dataset;
  encoding: FileEncoding | null;
  /** Auto-detected delimiter for delimited text; null for JSON, tables, grids. */
  delimiter: Delimiter | null;
  /** Rows that were padded or truncated to match the final column set. */
  ragged: RaggedInfo;
}

export interface IngestControl {
  /** True when the caller wants the load aborted at the next checkpoint. */
  cancelled?: () => boolean;
}

export interface IngestFile {
  name: string;
  text?: string;
  buffer?: ArrayBuffer;
}

/** The decoded/parsed grid plus everything the column build needs. */
interface PreparedGrid {
  headers: string[];
  rows: string[][];
  encoding: FileEncoding | null;
  delimiter: Delimiter | null;
  ragged: RaggedInfo;
  numberPrior: NumberLocale;
}

function buildProgress(options: IngestOptions): (progress: {
  detail: string;
  current?: number;
  total?: number;
  phase?: "build" | "stats";
}) => void {
  return (progress) => {
    options.onProgress?.({
      phase: progress.phase ?? "build",
      detail: progress.detail,
      current: progress.current,
      total: progress.total,
    });
  };
}

/**
 * Decode + parse + header detection. Reports `read` and `parse` progress;
 * the caller reports `infer` before building columns.
 */
function prepareGrid(options: IngestOptions): PreparedGrid {
  if (options.table !== undefined) {
    const { headers, rows, ragged } = structureTable(
      options.table.rows,
      options.table.hasHeaders,
    );
    return { headers, rows, encoding: null, delimiter: null, ragged, numberPrior: "dot" };
  }

  let text = options.text;
  let encoding: FileEncoding | null = null;

  if (text === undefined && options.buffer !== undefined) {
    options.onProgress?.({ phase: "read", detail: "Reading file…" });
    const decoded = decodeText(options.buffer);
    text = decoded.text;
    encoding = decoded.encoding;
  }

  const source = text ?? "";

  // JSON is structure-carrying, so it bypasses delimiter/header detection.
  if (isJsonName(options.name)) {
    options.onProgress?.({ phase: "parse", detail: "Parsing JSON…" });
    const grid = parseJsonGrid(source, options.hasHeaders);
    return {
      headers: grid.headers,
      rows: grid.rows,
      encoding,
      delimiter: null,
      ragged: measureRagged(grid.rows, grid.headers.length),
      numberPrior: "dot",
    };
  }
  if (looksLikeJson(source, options.delimiter)) {
    try {
      options.onProgress?.({ phase: "parse", detail: "Parsing JSON…" });
      const grid = parseJsonGrid(source, options.hasHeaders);
      return {
        headers: grid.headers,
        rows: grid.rows,
        encoding,
        delimiter: null,
        ragged: measureRagged(grid.rows, grid.headers.length),
        numberPrior: "dot",
      };
    } catch {
      // Not JSON after all — fall through to delimited parsing.
    }
  }

  options.onProgress?.({ phase: "parse" });
  // Keep the raw row lengths: the final width is only known after header
  // detection, and raggedness is measured against that width below.
  const parsed = parseDelimited(source, {
    delimiter: options.delimiter,
    hasHeaders: false,
    normalizeRows: false,
    ...(options.maxRows === undefined ? {} : { preview: options.maxRows }),
  });

  // Semicolon delimiters and windows-1252 are strong European-locale signals,
  // so numeric columns with ambiguous separators lean towards decimal commas.
  const numberPrior: NumberLocale =
    parsed.delimiter === ";" || encoding === "windows-1252" ? "comma" : "dot";

  // Same smart header detection as worksheets: skip title rows and merge
  // multi-level headers instead of blindly taking row 1.
  let headers = parsed.headers;
  let rows = parsed.rows;
  let ragged = parsed.ragged;
  if (options.hasHeaders) {
    const detected = detectTable(parsed.rows);
    if (detected.headerRows > 0) {
      headers = detected.headers.map((value, index) =>
        value.trim() === "" ? `Column ${index + 1}` : value,
      );
      rows = detected.rows;
      ragged = measureRagged(rows, headers.length);
    }
  }

  return { headers, rows, encoding, delimiter: parsed.delimiter, ragged, numberPrior };
}

export function ingestDataset(options: IngestOptions): IngestResult {
  const prepared = prepareGrid(options);
  options.onProgress?.({ phase: "infer", detail: "Inferring schema…" });
  const dataset = buildDataset(
    options.name,
    prepared.headers,
    prepared.rows,
    buildProgress(options),
    prepared.numberPrior,
    // The worker owns the parsed grid; releasing rows as columns fill lowers
    // the peak while the grid and the column arrays would otherwise coexist.
    true,
  );
  return {
    dataset,
    encoding: prepared.encoding,
    delimiter: prepared.delimiter,
    ragged: prepared.ragged,
  };
}

/**
 * Cancellable variant used by the worker: identical parse semantics, but the
 * column build yields between columns so a `cancelLoad` message can arrive.
 * Returns null when the load was cancelled before the dataset was built.
 */
export async function ingestDatasetAsync(
  options: IngestOptions,
  control: IngestControl = {},
): Promise<IngestResult | null> {
  const prepared = prepareGrid(options);
  options.onProgress?.({ phase: "infer", detail: "Inferring schema…" });
  const dataset = await buildDatasetAsync(
    options.name,
    prepared.headers,
    prepared.rows,
    buildProgress(options),
    prepared.numberPrior,
    { shouldCancel: control.cancelled },
  );
  if (dataset === null) return null;
  return {
    dataset,
    encoding: prepared.encoding,
    delimiter: prepared.delimiter,
    ragged: prepared.ragged,
  };
}

function headerKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Parses several files, aligns their columns by normalised header name and
 * appends one `_input_filename` cell per row. Column order follows the first
 * file; later files append any new columns at the end.
 */
export async function ingestFilesAsync(
  files: readonly IngestFile[],
  options: Omit<IngestOptions, "text" | "buffer" | "table" | "name"> & { name: string },
  control: IngestControl = {},
): Promise<IngestResult | null> {
  if (files.length === 0) throw new Error("No files to import");
  const prepared: PreparedGrid[] = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    options.onProgress?.({
      phase: "read",
      detail: `Reading ${file.name} (${index + 1} of ${files.length}).`,
      current: index,
      total: files.length,
    });
    prepared.push(
      prepareGrid({
        name: file.name,
        delimiter: options.delimiter,
        hasHeaders: options.hasHeaders,
        text: file.text,
        buffer: file.buffer,
        onProgress: options.onProgress,
      }),
    );
    if (control.cancelled?.() === true) return null;
  }

  const headers = [...prepared[0].headers];
  const targets = new Map<string, number>();
  headers.forEach((header, index) => {
    if (!targets.has(headerKey(header))) targets.set(headerKey(header), index);
  });
  for (const grid of prepared.slice(1)) {
    for (const header of grid.headers) {
      const key = headerKey(header);
      if (targets.has(key)) continue;
      targets.set(key, headers.length);
      headers.push(header);
    }
  }

  let filenameHeader = "_input_filename";
  for (let suffix = 2; targets.has(headerKey(filenameHeader)); suffix++) {
    filenameHeader = `_input_filename_${suffix}`;
  }
  const filenameIndex = headers.length;
  headers.push(filenameHeader);

  const rows: string[][] = [];
  let ragged: RaggedInfo = { paddedRows: 0, extraCellRows: 0, extraCells: 0 };
  for (let fileIndex = 0; fileIndex < prepared.length; fileIndex++) {
    const grid = prepared[fileIndex];
    const mapping = grid.headers.map((header) => targets.get(headerKey(header)) ?? -1);
    for (const row of grid.rows) {
      const out = new Array<string>(headers.length).fill("");
      for (let column = 0; column < row.length && column < mapping.length; column++) {
        const target = mapping[column];
        if (target >= 0) out[target] = row[column];
      }
      out[filenameIndex] = files[fileIndex].name;
      rows.push(out);
    }
    ragged = {
      paddedRows: ragged.paddedRows + grid.ragged.paddedRows,
      extraCellRows: ragged.extraCellRows + grid.ragged.extraCellRows,
      extraCells: ragged.extraCells + grid.ragged.extraCells,
    };
    if (control.cancelled?.() === true) return null;
  }

  options.onProgress?.({ phase: "infer", detail: "Inferring schema." });
  const dataset = await buildDatasetAsync(
    options.name,
    headers,
    rows,
    buildProgress({ ...options, name: options.name }),
    prepared[0].numberPrior,
    { shouldCancel: control.cancelled },
  );
  if (dataset === null) return null;

  const encoding = prepared.every((grid) => grid.encoding === prepared[0].encoding)
    ? prepared[0].encoding
    : null;
  const delimiter = prepared.every((grid) => grid.delimiter === prepared[0].delimiter)
    ? prepared[0].delimiter
    : null;
  return { dataset, encoding, delimiter, ragged };
}

/** Sniff pasted text: only when the delimiter is auto and it starts like JSON. */
function looksLikeJson(text: string, delimiter: Delimiter | "auto"): boolean {
  if (delimiter !== "auto") return false;
  const first = text.trimStart().charAt(0);
  return first === "{" || first === "[";
}
