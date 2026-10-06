export interface JsonGrid {
  headers: string[];
  rows: string[][];
}

export function isJsonName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".ndjson");
}

/**
 * Parses JSON / JSON Lines into a grid. Supports an array of objects (nested
 * objects flattened to dotted paths), an array of arrays, JSONL records, and
 * pandas' column-oriented object (`{col: [values]}`).
 */
export function parseJsonGrid(text: string, hasHeaders: boolean): JsonGrid {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("That file is empty");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return parseJsonLines(trimmed);
  }
  return gridFromValue(parsed, hasHeaders);
}

function parseJsonLines(text: string): JsonGrid {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const records: unknown[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      records.push(JSON.parse(lines[i]));
    } catch {
      throw new Error(`Not valid JSON (line ${i + 1})`);
    }
  }
  if (records.length === 0) throw new Error("That file is empty");
  if (records.every(isPlainObject)) return objectsTable(records as Record<string, unknown>[]);
  if (records.every(Array.isArray)) return arraysTable(records as unknown[][], false);
  throw new Error("Unsupported JSON structure");
}

function gridFromValue(value: unknown, hasHeaders: boolean): JsonGrid {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error("That JSON array is empty");
    if (value.every(isPlainObject)) return objectsTable(value as Record<string, unknown>[]);
    if (value.every(Array.isArray)) return arraysTable(value as unknown[][], hasHeaders);
    throw new Error("Unsupported JSON array — expected an array of objects or arrays");
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.every(([, column]) => Array.isArray(column))) {
      return columnsTable(entries as [string, unknown[]][]);
    }
    return objectsTable([value]);
  }
  throw new Error("Unsupported JSON — expected an array of objects or arrays");
}

function objectsTable(records: readonly Record<string, unknown>[]): JsonGrid {
  const flattened = records.map((record) => {
    const cells = new Map<string, string>();
    flattenValue(record, "", cells);
    return cells;
  });
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const cells of flattened) {
    for (const key of cells.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  const rows = flattened.map((cells) => headers.map((header) => cells.get(header) ?? ""));
  return { headers, rows };
}

function columnsTable(entries: readonly [string, unknown[]][]): JsonGrid {
  const headers = entries.map(([name]) => name);
  const height = entries.reduce((max, [, values]) => Math.max(max, values.length), 0);
  const rows: string[][] = [];
  for (let row = 0; row < height; row++) {
    rows.push(entries.map(([, values]) => cellToString(values[row])));
  }
  return { headers, rows };
}

function arraysTable(arrays: readonly unknown[][], hasHeaders: boolean): JsonGrid {
  const width = arrays.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) throw new Error("That JSON array has no columns");
  const headerRow = hasHeaders && arrays.length > 0 ? arrays[0].map(cellToString) : null;
  const body = headerRow === null ? arrays : arrays.slice(1);
  const headers =
    headerRow === null
      ? Array.from({ length: width }, (_, index) => `Column ${index + 1}`)
      : Array.from({ length: width }, (_, index) => {
          const value = (headerRow[index] ?? "").trim();
          return value === "" ? `Column ${index + 1}` : value;
        });
  const rows = body.map((row) =>
    Array.from({ length: width }, (_, index) => cellToString(row[index])),
  );
  return { headers, rows };
}

function flattenValue(value: unknown, prefix: string, out: Map<string, string>): void {
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenValue(child, prefix === "" ? key : `${prefix}.${key}`, out);
    }
    return;
  }
  out.set(prefix, cellToString(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value) ?? "";
}
