import { buildDataset } from "../data/build.js";
import type { Dataset } from "../data/dataset.js";
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

export function ingestDataset(options: IngestOptions): Dataset {
  const text =
    options.text ?? (options.buffer === undefined ? "" : new TextDecoder().decode(options.buffer));

  options.onProgress?.({ phase: "parse" });
  const parsed = parseDelimited(text, {
    delimiter: options.delimiter,
    hasHeaders: options.hasHeaders,
  });

  const dataset = buildDataset(options.name, parsed.headers, parsed.rows, (detail) => {
    options.onProgress?.({ phase: "build", detail });
  });

  return dataset;
}
