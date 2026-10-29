export type ExportFormat = "csv" | "csv-semicolon" | "tsv" | "json" | "jsonl";
export type ExportCompression = "none" | "gzip" | "zip";

export interface ExportFormatInfo {
  value: ExportFormat;
  label: string;
  hint: string;
  ext: string;
  mime: string;
}

export const EXPORT_FORMATS: readonly ExportFormatInfo[] = [
  {
    value: "csv",
    label: "CSV (.csv)",
    hint: "Comma-separated text. Opens everywhere; UTF-8 with a BOM so Excel reads accents.",
    ext: ".csv",
    mime: "text/csv",
  },
  {
    value: "csv-semicolon",
    label: "CSV, semicolon (.csv)",
    hint: "European-style CSV for spreadsheets that expect ; as the separator.",
    ext: ".csv",
    mime: "text/csv",
  },
  {
    value: "tsv",
    label: "Tab-separated (.tsv)",
    hint: "Tab-separated text. Pastes cleanly into spreadsheets and survives commas in values.",
    ext: ".tsv",
    mime: "text/tab-separated-values",
  },
  {
    value: "json",
    label: "JSON (.json)",
    hint: "An array of row objects keyed by column name. Numbers are written as numbers.",
    ext: ".json",
    mime: "application/json",
  },
  {
    value: "jsonl",
    label: "JSON Lines (.jsonl)",
    hint: "One JSON object per line. Streams well into databases and data tools.",
    ext: ".jsonl",
    mime: "application/x-ndjson",
  },
];

export const EXPORT_COMPRESSIONS: readonly { value: ExportCompression; label: string; ext: string }[] =
  [
    { value: "none", label: "None", ext: "" },
    { value: "gzip", label: "Gzip (.gz)", ext: ".gz" },
    { value: "zip", label: "Zip (.zip)", ext: ".zip" },
  ];

export function formatInfo(format: ExportFormat): ExportFormatInfo {
  return EXPORT_FORMATS.find((entry) => entry.value === format) ?? EXPORT_FORMATS[0];
}

/** Binary formats and compression need the whole file; text formats stream. */
export function isTextOnly(format: ExportFormat, compression: ExportCompression): boolean {
  return compression === "none";
}

/** Local time as YYYYMMDDHHMMSS, e.g. 20261026004030. */
export function timestampString(now: Date = new Date()): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return (
    `${pad(now.getFullYear(), 4)}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

const KNOWN_EXTENSION = /\.(csv|tsv|json|jsonl|ndjson|gz|zip)$/i;

/** Drops any export extension the user typed so the format chooses it. */
export function stripExportExtension(name: string): string {
  let result = name.trim();
  while (KNOWN_EXTENSION.test(result)) result = result.replace(KNOWN_EXTENSION, "");
  return result;
}

/**
 * Final file name: optional `YYYYMMDDHHMMSS_` prefix, the user's name, then the
 * extension for the format and compression. Unsafe path characters are replaced.
 */
export function buildExportFileName(
  name: string,
  fallback: string,
  format: ExportFormat,
  compression: ExportCompression,
  datePrefix: boolean,
  now: Date = new Date(),
): string {
  const typed = stripExportExtension(name);
  const base = (typed === "" ? stripExportExtension(fallback) : typed)
    .replace(/[\/:*?"<>|]+/g, "-")
    .trim();
  const compressionExt = EXPORT_COMPRESSIONS.find((entry) => entry.value === compression)?.ext ?? "";
  const prefix = datePrefix ? `${timestampString(now)}_` : "";
  return `${prefix}${base === "" ? "export" : base}${formatInfo(format).ext}${compressionExt}`;
}

const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function typedCell(value: string, booleans: boolean): string | number | boolean | null {
  if (value === "") return null;
  if (PLAIN_NUMBER.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number) && String(number) === value) return number;
  }
  if (booleans && (value === "true" || value === "false")) return value === "true";
  return value;
}

/** papaparse loads on demand so plain CSV exports and first paint never pay for it. */
async function papa(): Promise<typeof import("papaparse")> {
  const module = await import("papaparse");
  return (module as unknown as { default?: typeof import("papaparse") }).default ?? module;
}

async function parseRows(csv: string): Promise<string[][]> {
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const parsed = (await papa()).parse<string[]>(text, { skipEmptyLines: true });
  return parsed.data;
}

function toRecords(rows: string[][]): Record<string, string | number | boolean | null>[] {
  const [header = [], ...body] = rows;
  return body.map((row) => {
    const record: Record<string, string | number | boolean | null> = {};
    header.forEach((name, index) => {
      record[name] = typedCell(row[index] ?? "", true);
    });
    return record;
  });
}

export interface EncodedExport {
  blob: Blob;
  mime: string;
}

/**
 * Converts the worker's CSV text (header row first) into the chosen format and
 * compression. CSV passes through unchanged so large exports stay cheap.
 */
export async function encodeExport(
  csvText: string,
  format: ExportFormat,
  compression: ExportCompression,
  innerFileName: string,
): Promise<EncodedExport> {
  let payload: Uint8Array | string;
  switch (format) {
    case "csv":
      payload = csvText.charCodeAt(0) === 0xfeff ? csvText : `﻿${csvText}`;
      break;
    case "csv-semicolon":
      payload = `﻿${(await papa()).unparse(await parseRows(csvText), { delimiter: ";", newline: "\r\n" })}\r\n`;
      break;
    case "tsv":
      payload = `${(await papa()).unparse(await parseRows(csvText), { delimiter: "\t", newline: "\r\n" })}\r\n`;
      break;
    case "json":
      payload = `${JSON.stringify(toRecords(await parseRows(csvText)), null, 2)}\n`;
      break;
    case "jsonl":
      payload = `${toRecords(await parseRows(csvText))
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`;
      break;
  }

  const info = formatInfo(format);
  if (compression === "none") {
    return { blob: new Blob([payload as BlobPart], { type: `${info.mime};charset=utf-8` }), mime: info.mime };
  }
  const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const { gzipSync, zipSync } = await import("fflate");
  if (compression === "gzip") {
    return { blob: new Blob([gzipSync(bytes) as BlobPart], { type: "application/gzip" }), mime: "application/gzip" };
  }
  const inner = innerFileName.replace(/\.zip$/i, "");
  return {
    blob: new Blob([zipSync({ [inner]: bytes }) as BlobPart], { type: "application/zip" }),
    mime: "application/zip",
  };
}
