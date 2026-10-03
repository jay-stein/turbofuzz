import { buildDataset } from "../data/build.js";
import type { Dataset } from "../data/dataset.js";
import { decodeText, type FileEncoding } from "../parse/encoding.js";
import { parseDelimited } from "../parse/parse.js";
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
  onProgress?: (progress: IngestProgress) => void;
}

export interface IngestResult {
  dataset: Dataset;
  encoding: FileEncoding | null;
}

export function ingestDataset(options: IngestOptions): IngestResult {
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
    hasHeaders: options.hasHeaders,
  });

  const dataset = buildDataset(options.name, parsed.headers, parsed.rows, (detail) => {
    options.onProgress?.({ phase: "build", detail });
  });

  return { dataset, encoding };
}
