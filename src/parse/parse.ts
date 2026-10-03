import Papa from "papaparse";
import { detectDelimiter, type Delimiter } from "./delimiter.js";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
  hasHeaders: boolean;
}

export interface ParseOptions {
  delimiter?: Delimiter | "auto";
  hasHeaders?: boolean;
}

export interface StructuredTable {
  headers: string[];
  rows: string[][];
}

/** Turns a raw grid into named headers plus width-normalised rows. */
export function structureTable(data: string[][], hasHeaders: boolean): StructuredTable {
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
  for (const row of rows) {
    if (row.length < width) {
      while (row.length < width) row.push("");
    } else if (row.length > width) {
      row.length = width;
    }
  }

  return { headers, rows };
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
  const { headers, rows } = structureTable(data, hasHeaders);

  return { headers, rows, delimiter, hasHeaders };
}
