import { buildDataset } from "../data/build.js";
import type { Dataset } from "../data/dataset.js";
import { decodeText, type FileEncoding } from "../parse/encoding.js";
import { detectTable } from "../parse/header-detect.js";
import { parseDelimited, structureTable } from "../parse/parse.js";
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
}

export function ingestDataset(options: IngestOptions): IngestResult {
  if (options.table !== undefined) {
    const { headers, rows } = structureTable(options.table.rows, options.table.hasHeaders);
    const dataset = buildDataset(options.name, headers, rows, (detail) => {
      options.onProgress?.({ phase: "build", detail });
    });
    return { dataset, encoding: null };
  }

  let text = options.text;
  let encoding: FileEncoding | null = null;

  if (text === undefined && options.buffer !== undefined) {
    const decoded = decodeText(options.buffer);
    text = decoded.text;
    encoding = decoded.encoding;
  }

  options.onProgress?.({ phase: "parse" });
  const parsed = parseDelimited(text ?? "", {
    delimiter: options.delimiter,
    hasHeaders: false,
  });

  // Same smart header detection as worksheets/scraped tables: skip title
  // rows and merge multi-level headers instead of blindly taking row 1.
  let headers = parsed.headers;
  let rows = parsed.rows;
  if (options.hasHeaders) {
    const detected = detectTable(parsed.rows);
    if (detected.headerRows > 0) {
      headers = detected.headers.map((value, index) =>
        value.trim() === "" ? `Column ${index + 1}` : value,
      );
      rows = detected.rows;
    }
  }

  const dataset = buildDataset(options.name, headers, rows, (detail) => {
    options.onProgress?.({ phase: "build", detail });
  });

  return { dataset, encoding };
}
