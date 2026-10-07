import { buildDataset } from "../data/build.js";
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
}

export interface IngestOptions {
  name: string;
  delimiter: Delimiter | "auto";
  hasHeaders: boolean;
  text?: string;
  buffer?: ArrayBuffer;
  table?: { rows: string[][]; hasHeaders: boolean };
  onProgress?: (progress: IngestProgress) => void;
}

export interface IngestResult {
  dataset: Dataset;
  encoding: FileEncoding | null;
  /** Rows that were padded or truncated to match the final column set. */
  ragged: RaggedInfo;
}

export function ingestDataset(options: IngestOptions): IngestResult {
  if (options.table !== undefined) {
    const { headers, rows, ragged } = structureTable(
      options.table.rows,
      options.table.hasHeaders,
    );
    const dataset = buildDataset(options.name, headers, rows, (detail) => {
      options.onProgress?.({ phase: "build", detail });
    });
    return { dataset, encoding: null, ragged };
  }

  let text = options.text;
  let encoding: FileEncoding | null = null;

  if (text === undefined && options.buffer !== undefined) {
    const decoded = decodeText(options.buffer);
    text = decoded.text;
    encoding = decoded.encoding;
  }

  const source = text ?? "";

  // JSON is structure-carrying, so it bypasses delimiter/header detection.
  if (isJsonName(options.name)) {
    const grid = parseJsonGrid(source, options.hasHeaders);
    return {
      dataset: buildFromGrid(options.name, grid.headers, grid.rows, options),
      encoding,
      ragged: measureRagged(grid.rows, grid.headers.length),
    };
  }
  if (looksLikeJson(source, options.delimiter)) {
    try {
      const grid = parseJsonGrid(source, options.hasHeaders);
      return {
        dataset: buildFromGrid(options.name, grid.headers, grid.rows, options),
        encoding,
        ragged: measureRagged(grid.rows, grid.headers.length),
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

  const dataset = buildDataset(
    options.name,
    headers,
    rows,
    (detail) => {
      options.onProgress?.({ phase: "build", detail });
    },
    numberPrior,
  );

  return { dataset, encoding, ragged };
}

function buildFromGrid(
  name: string,
  headers: string[],
  rows: string[][],
  options: IngestOptions,
): Dataset {
  return buildDataset(name, headers, rows, (detail) => {
    options.onProgress?.({ phase: "build", detail });
  });
}

/** Sniff pasted text: only when the delimiter is auto and it starts like JSON. */
function looksLikeJson(text: string, delimiter: Delimiter | "auto"): boolean {
  if (delimiter !== "auto") return false;
  const first = text.trimStart().charAt(0);
  return first === "{" || first === "[";
}
