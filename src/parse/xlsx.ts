export interface WorkbookSheet {
  name: string;
  rows: number;
  columns: number;
}

export interface WorkbookListing {
  sheets: WorkbookSheet[];
  total: number;
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

function attributeBefore(xml: string, start: number, end: number, name: string): string | null {
  const key = `${name}="`;
  let index = xml.indexOf(key, start);
  while (index !== -1 && index < end) {
    const valueStart = index + key.length;
    const valueEnd = xml.indexOf('"', valueStart);
    if (valueEnd === -1 || valueEnd > end) return null;
    if (index === start || /[\s<]/.test(xml[index - 1])) {
      return decodeXmlEntities(xml.slice(valueStart, valueEnd));
    }
    index = xml.indexOf(key, index + 1);
  }
  return null;
}

function scanValueCells(
  xml: string,
  marker: string,
  extent: { rows: number; columns: number },
): void {
  const CELL_OPEN = "<c ";
  let position = xml.indexOf(marker);
  while (position !== -1) {
    const cell = xml.lastIndexOf(CELL_OPEN, position);
    if (cell !== -1) {
      const tagEnd = xml.indexOf(">", cell);
      if (tagEnd !== -1 && tagEnd < position) {
        const ref = attributeBefore(xml, cell, tagEnd, "r");
        if (ref !== null) {
          const match = ref.match(/^([A-Za-z]+)(\d+)$/);
          if (match !== null) {
            const row = Number.parseInt(match[2], 10);
            if (row > extent.rows) extent.rows = Math.min(row, MAX_ROWS);
            const column = columnIndex(match[1].toUpperCase()) + 1;
            if (column > extent.columns) extent.columns = Math.min(column, MAX_COLUMNS);
          }
        }
      }
    }
    position = xml.indexOf(marker, position + marker.length);
  }
}

/**
 * Actual data extent: the highest row and column containing a value-bearing
 * cell. One linear pass over `<v>` (numbers, shared strings, booleans,
 * cached formulas) and `<is>` (inline strings) markers; formatting-only
 * cells have neither, so they never count.
 */
function dataExtent(xml: string): { rows: number; columns: number } {
  const extent = { rows: 0, columns: 0 };
  scanValueCells(xml, "<v>", extent);
  scanValueCells(xml, "<is>", extent);
  return extent;
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
 * Lists up to `limit` worksheets in workbook order with their actual data
 * extent. Unzips only the workbook metadata and the selected worksheets
 * (never shared strings or media), and skips sheets with no values.
 */
export async function listWorkbookSheets(
  buffer: ArrayBuffer,
  limit = 50,
): Promise<WorkbookListing> {
  const data = new Uint8Array(buffer);

  const meta = await unzipFiltered(
    data,
    (name) =>
      name.toLowerCase() === "xl/workbook.xml" ||
      name.toLowerCase() === "xl/_rels/workbook.xml.rels",
  );
  const entries = parseWorkbookSheets(decode(fileOf(meta, "xl/workbook.xml")));
  const relationships = parseRelationships(decode(fileOf(meta, "xl/_rels/workbook.xml.rels")));

  const resolved = entries.flatMap((entry) => {
    const relationship = relationships.get(entry.rid);
    if (relationship === undefined || !relationship.type.includes("worksheet")) return [];
    return [{ name: entry.name, path: normalizeTarget(relationship.target) }];
  });

  const selected = resolved.slice(0, Math.max(1, limit));
  const wanted = new Set(selected.map((sheet) => sheet.path.toLowerCase()));
  const files = await unzipFiltered(data, (name) => {
    const lowered = name.toLowerCase();
    if (lowered === "xl/workbook.xml" || lowered === "xl/_rels/workbook.xml.rels") return true;
    return lowered.startsWith("xl/worksheets/") && wanted.has(lowered);
  });

  const sheets: WorkbookSheet[] = [];
  for (const sheet of selected) {
    const size = dataExtent(decode(fileOf(files, sheet.path)));
    if (size.rows === 0 && size.columns === 0) continue;
    sheets.push({ name: sheet.name, rows: size.rows, columns: size.columns });
  }

  return { sheets, total: resolved.length };
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

/** Built-in numFmt ids that are dates or times (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

/**
 * True when a number format code renders dates/times. Quoted literals and
 * colour/locale sections are stripped first so `0.00"m"` is not mistaken for
 * a minute, while elapsed-time tokens ([h], [mm], [ss]) still count.
 */
function looksLikeDateFormat(code: string): boolean {
  const cleaned = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, "");
  return /[ymdhs]/i.test(cleaned);
}

/**
 * One flag per cellXfs entry: whether that style index renders its numeric
 * value as a date. Custom numFmts win over the built-in table when present.
 */
function parseDateStyleFlags(stylesXml: string): boolean[] {
  const custom = new Map<number, string>();
  for (const match of stylesXml.matchAll(/<numFmt\b([^>]*?)\/?>/gi)) {
    const id = Number.parseInt(attribute(match[1], "numFmtId") ?? "", 10);
    const code = attribute(match[1], "formatCode");
    if (Number.isFinite(id) && code !== null) custom.set(id, code);
  }

  const flags: boolean[] = [];
  const cellXfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i);
  if (cellXfs === null) return flags;
  for (const xf of cellXfs[1].matchAll(/<xf\b([^>]*?)\/?>/gi)) {
    const id = Number.parseInt(attribute(xf[1], "numFmtId") ?? "0", 10);
    const customCode = custom.get(id);
    flags.push(customCode !== undefined ? looksLikeDateFormat(customCode) : BUILTIN_DATE_FORMATS.has(id));
  }
  return flags;
}

function workbookDate1904(workbookXml: string): boolean {
  const match = workbookXml.match(/<workbookPr\b([^>]*?)\/?>/i);
  if (match === null) return false;
  const value = attribute(match[1], "date1904");
  return value === "1" || value?.toLowerCase() === "true";
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Converts an Excel serial to an ISO date (with time when the serial has a
 * fractional part). The 1899-12-30 epoch absorbs the 1900 leap-year bug for
 * serials ≥ 60; earlier serials use 1899-12-31. The 1904 date system is
 * shifted by 1462 days first.
 */
function excelSerialToIso(serial: number, date1904: boolean): string {
  if (!Number.isFinite(serial) || serial < 0) return "";
  const adjusted = date1904 ? serial + 1462 : serial;
  const epoch = adjusted < 60 ? Date.UTC(1899, 11, 31) : EXCEL_EPOCH_UTC;
  const ms = Math.round(epoch + adjusted * 86_400_000);
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const day = `${y}-${m}-${d}`;
  if (adjusted < 1) return date.toISOString().slice(11, 19);
  const inDay = ms % 86_400_000;
  if (inDay === 0) return day;
  return `${day} ${date.toISOString().slice(11, 19)}`;
}

function cellValue(
  inner: string,
  type: string,
  shared: string[],
  styleIsDate: boolean,
  date1904: boolean,
): string {
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
  if (type === "n" && styleIsDate && raw !== "") {
    const serial = Number(raw);
    const iso = excelSerialToIso(serial, date1904);
    if (iso !== "") return iso;
  }
  return raw;
}

/**
 * Parses one worksheet into a rectangular string grid: shared/inline strings,
 * booleans, cached formula values, merge expansion, and Excel date serials
 * converted to ISO via each cell's number format. Dates become real date
 * strings rather than 45,474-style integers.
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
      name === "xl/styles.xml" ||
      /^xl\/worksheets\/.+\.xml$/i.test(name),
  );

  const workbookXml = decode(fileOf(files, "xl/workbook.xml"));
  const entries = parseWorkbookSheets(workbookXml);
  const relationships = parseRelationships(decode(fileOf(files, "xl/_rels/workbook.xml.rels")));
  const entry = entries.find((candidate) => candidate.name === sheetName);
  const relationship = entry === undefined ? undefined : relationships.get(entry.rid);
  if (entry === undefined || relationship === undefined) return [];

  const sheetXml = decode(fileOf(files, normalizeTarget(relationship.target)));
  if (sheetXml === "") return [];
  const shared = parseSharedStrings(decode(fileOf(files, "xl/sharedStrings.xml")));
  const dateStyles = parseDateStyleFlags(decode(fileOf(files, "xl/styles.xml")));
  const date1904 = workbookDate1904(workbookXml);

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
      const styleIndex = Number.parseInt(attribute(attributes, "s") ?? "", 10);
      const styleIsDate = Number.isFinite(styleIndex) && dateStyles[styleIndex] === true;
      const value = cellValue(cellMatch[2] ?? "", type, shared, styleIsDate, date1904);
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
