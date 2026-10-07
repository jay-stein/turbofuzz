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
}

/** Counts describing rows that do not match the final table width. */
export interface RaggedInfo {
  /** Data rows shorter than the width; the missing cells become empty. */
  paddedRows: number;
  /** Data rows that carried non-empty cells past the width. */
  extraCellRows: number;
  /** Total non-empty cells dropped past the width. */
  extraCells: number;
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

export function parseDelimited(text: string, options: ParseOptions = {}): ParsedTable {
  const delimiter =
    options.delimiter !== undefined && options.delimiter !== "auto"
      ? options.delimiter
      : detectDelimiter(text);

  const result = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: "greedy",
  });

  const data = result.data.filter((row) => Array.isArray(row) && row.length > 0);
  const hasHeaders = options.hasHeaders ?? true;
  const normalize = options.normalizeRows ?? true;
  const { headers, rows, ragged } = structureTable(data, hasHeaders, normalize);

  return { headers, rows, delimiter, hasHeaders, ragged };
}
