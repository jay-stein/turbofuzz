export interface ParquetGrid {
  headers: string[];
  rows: string[][];
}

export function isParquetName(name: string): boolean {
  return name.toLowerCase().endsWith(".parquet");
}

/**
 * Reads a parquet file (flat primitive columns) into a string grid. Nested
 * values are stringified; nulls become empty cells.
 *
 * hyparquet and its decompressors are imported lazily so they never touch the
 * core bundle and are only paid for when a parquet file is actually opened.
 */
export async function readParquetGrid(buffer: ArrayBuffer): Promise<ParquetGrid> {
  const { parquetMetadata, parquetReadObjects, parquetSchema } = await import("hyparquet");
  const { compressors } = await import("hyparquet-compressors");

  const file = {
    byteLength: buffer.byteLength,
    slice: (start: number, end?: number): ArrayBuffer => buffer.slice(start, end),
  };

  let headers: string[] = [];
  try {
    headers = parquetSchema(parquetMetadata(buffer)).children.map((child) => child.element.name);
  } catch {
    headers = [];
  }

  const objects = await parquetReadObjects({ file, compressors, rowFormat: "object" });
  if (headers.length === 0 && objects.length > 0) headers = Object.keys(objects[0]);
  const rows = objects.map((object) => headers.map((header) => cellToString(object[header])));
  return { headers, rows };
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return JSON.stringify(value) ?? "";
}
