export interface WorkbookSheet {
  name: string;
  rows: number;
  columns: number;
}

const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;

type ZipFiles = Record<string, Uint8Array>;

async function unzipFiltered(
  data: Uint8Array,
  filter: (name: string) => boolean,
): Promise<ZipFiles> {
  // Loaded on demand so the main bundle stays lean.
  const { unzip } = await import("fflate");
  return new Promise((resolve, reject) => {
    unzip(data, { filter: (file) => filter(file.name) }, (error, files) => {
      if (error !== null) reject(error);
      else resolve(files);
    });
  });
}

/** Case-insensitive file lookup (ZIP paths vary by writer). */
function fileOf(files: ZipFiles, path: string): Uint8Array | undefined {
  if (files[path] !== undefined) return files[path];
  const lowered = path.toLowerCase();
  for (const key of Object.keys(files)) {
    if (key.toLowerCase() === lowered) return files[key];
  }
  return undefined;
}

function decode(bytes: Uint8Array | undefined): string {
  return bytes === undefined ? "" : new TextDecoder().decode(bytes);
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i"));
  return match === null ? null : decodeXmlEntities(match[1]);
}

function columnIndex(letters: string): number {
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

function parseRange(ref: string): { rows: number; columns: number } {
  const match = ref.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (match === null) return { rows: 0, columns: 0 };
  const startColumn = columnIndex(match[1].toUpperCase());
  const startRow = Number.parseInt(match[2], 10);
  const endColumn = match[3] === undefined ? startColumn : columnIndex(match[3].toUpperCase());
  const endRow = match[4] === undefined ? startRow : Number.parseInt(match[4], 10);
  return {
    rows: Math.max(0, Math.min(MAX_ROWS, endRow - startRow + 1)),
    columns: Math.max(0, Math.min(MAX_COLUMNS, endColumn - startColumn + 1)),
  };
}

/**
 * Fast sheet size. Excel writes a `<dimension ref="A1:F100"/>` element, so
 * most workbooks need no cell parsing at all. When it is missing (some
 * writers omit it), fall back to counting row tags and peeking at the first
 * rows' cell references — approximate is fine for messy files.
 */
function sheetSize(xml: string): { rows: number; columns: number } {
  const dimension = xml.match(/<dimension[^>]*ref="([^"]+)"/i);
  if (dimension !== null) {
    const size = parseRange(dimension[1]);
    if (size.rows > 0 || size.columns > 0) return size;
  }

  let rows = 0;
  let index = xml.indexOf("<row");
  while (index !== -1 && rows < MAX_ROWS) {
    rows++;
    index = xml.indexOf("<row", index + 4);
  }

  let columns = 0;
  const window = xml.slice(0, 200_000);
  const cellRefs = window.matchAll(/<c[^>]*r="([A-Z]+)\d+"/gi);
  let checked = 0;
  for (const match of cellRefs) {
    columns = Math.max(columns, columnIndex(match[1].toUpperCase()) + 1);
    if (++checked > 2_000) break;
  }

  return { rows, columns };
}

interface SheetEntry {
  name: string;
  rid: string;
}

interface Relationship {
  target: string;
  type: string;
}

function parseWorkbookSheets(xml: string): SheetEntry[] {
  const sheets: SheetEntry[] = [];
  for (const match of xml.matchAll(/<sheet\b([^>]*)\/?>/gi)) {
    const attributes = match[1];
    const name = attribute(attributes, "name");
    const rid = attribute(attributes, "r:id") ?? attribute(attributes, "id");
    if (name !== null && rid !== null) sheets.push({ name, rid });
  }
  return sheets;
}

function parseRelationships(xml: string): Map<string, Relationship> {
  const relationships = new Map<string, Relationship>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const attributes = match[1];
    const id = attribute(attributes, "Id");
    const target = attribute(attributes, "Target");
    const type = attribute(attributes, "Type") ?? "";
    if (id !== null && target !== null) relationships.set(id, { target, type });
  }
  return relationships;
}

function normalizeTarget(target: string): string {
  let path = target.replace(/\\/g, "/");
  if (path.startsWith("/")) path = path.slice(1);
  if (path.startsWith("xl/")) return path;
  return `xl/${path}`;
}

/**
 * Lists worksheets with fast size estimates, biggest first. Unzips only the
 * workbook metadata and worksheet XML (never shared strings or media).
 */
export async function listWorkbookSheets(buffer: ArrayBuffer): Promise<WorkbookSheet[]> {
  const data = new Uint8Array(buffer);
  const files = await unzipFiltered(
    data,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      /^xl\/worksheets\/.+\.xml$/i.test(name),
  );

  const entries = parseWorkbookSheets(decode(fileOf(files, "xl/workbook.xml")));
  const relationships = parseRelationships(decode(fileOf(files, "xl/_rels/workbook.xml.rels")));

  const sheets: WorkbookSheet[] = [];
  for (const entry of entries) {
    const relationship = relationships.get(entry.rid);
    if (relationship === undefined || !relationship.type.includes("worksheet")) continue;
    const path = normalizeTarget(relationship.target);
    const size = sheetSize(decode(fileOf(files, path)));
    if (size.rows === 0 && size.columns === 0) continue;
    sheets.push({ name: entry.name, rows: size.rows, columns: size.columns });
  }

  sheets.sort(
    (a, b) => b.rows * b.columns - a.rows * a.columns || b.rows - a.rows,
  );
  return sheets;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    let text = "";
    for (const run of item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)) {
      text += decodeXmlEntities(run[1]);
    }
    strings.push(text);
  }
  return strings;
}

function cellValue(inner: string, type: string, shared: string[]): string {
  if (type === "inlineStr") {
    const text = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/i);
    return text === null ? "" : decodeXmlEntities(text[1]);
  }
  const value = inner.match(/<v>([\s\S]*?)<\/v>/i);
  const raw = value === null ? "" : decodeXmlEntities(value[1]);
  if (type === "s") {
    const index = Number.parseInt(raw, 10);
    return Number.isFinite(index) && shared[index] !== undefined ? shared[index] : "";
  }
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return raw;
}

/**
 * Parses one worksheet into a rectangular string grid: shared/inline strings,
 * booleans, cached formula values, and merge expansion. Dates stay as Excel
 * serial numbers — approximate by design for speed.
 */
export async function readWorkbookSheet(
  buffer: ArrayBuffer,
  sheetName: string,
): Promise<string[][]> {
  const data = new Uint8Array(buffer);
  const files = await unzipFiltered(
    data,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      name === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/.+\.xml$/i.test(name),
  );

  const entries = parseWorkbookSheets(decode(fileOf(files, "xl/workbook.xml")));
  const relationships = parseRelationships(decode(fileOf(files, "xl/_rels/workbook.xml.rels")));
  const entry = entries.find((candidate) => candidate.name === sheetName);
  const relationship = entry === undefined ? undefined : relationships.get(entry.rid);
  if (entry === undefined || relationship === undefined) return [];

  const sheetXml = decode(fileOf(files, normalizeTarget(relationship.target)));
  if (sheetXml === "") return [];
  const shared = parseSharedStrings(decode(fileOf(files, "xl/sharedStrings.xml")));

  const rows = new Map<number, string[]>();
  let nextRow = 0;
  let maxColumns = 0;

  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowAttributes = rowMatch[1];
    const rowRef = attribute(rowAttributes, "r");
    const rowIndex = rowRef === null ? nextRow : Number.parseInt(rowRef, 10) - 1;
    nextRow = rowIndex + 1;

    const cells: string[] = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attributes = cellMatch[1];
      const ref = attribute(attributes, "r");
      const type = attribute(attributes, "t") ?? "n";
      const value = cellValue(cellMatch[2] ?? "", type, shared);
      const column = ref === null ? cells.length : columnIndex(ref.replace(/\d+$/, "").toUpperCase());
      cells[column] = value;
    }

    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    maxColumns = Math.max(maxColumns, cells.length);
    rows.set(rowIndex, cells);
  }

  // Merge expansion: the top-left value fills the merged rectangle.
  for (const merge of sheetXml.matchAll(/<mergeCell[^>]*ref="([^"]+)"/gi)) {
    const range = merge[1].match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (range === null) continue;
    const startColumn = columnIndex(range[1].toUpperCase());
    const startRow = Number.parseInt(range[2], 10) - 1;
    const endColumn = columnIndex(range[3].toUpperCase());
    const endRow = Number.parseInt(range[4], 10) - 1;
    const value = rows.get(startRow)?.[startColumn] ?? "";
    for (let r = startRow; r <= endRow; r++) {
      const row = rows.get(r) ?? [];
      for (let c = startColumn; c <= endColumn; c++) row[c] = value;
      maxColumns = Math.max(maxColumns, endColumn + 1);
      rows.set(r, row);
    }
  }

  if (rows.size === 0) return [];
  const maxRow = Math.max(...rows.keys());
  const grid: string[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const row = rows.get(r) ?? [];
    while (row.length < maxColumns) row.push("");
    grid.push(row);
  }

  while (grid.length > 0 && grid[grid.length - 1].every((cell) => cell === "")) grid.pop();
  return grid;
}
