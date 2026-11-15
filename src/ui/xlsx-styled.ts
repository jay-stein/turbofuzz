import { columnLetters, sheetName } from "./xlsx-writer.js";

/**
 * A styled, streaming .xlsx writer (Office Open XML) for report-like
 * workbooks: fonts, fills, borders, number formats, merged cells, frozen
 * panes, autofilter, tab colours, colour scales, data bars, internal links and
 * print setup. Rows are rendered to XML and deflated as they are written
 * (fflate), so a sheet never exists as one giant string. Text is stored as
 * inline strings, never as formulas, so `=`, `+`, `-` and `@` need no escaping.
 * The plain `buildXlsx` writer stays for simple tables.
 */

/** A cell value; null is an empty cell (which can still carry a style). */
export type XCell = string | number | boolean | null;

export type EdgeStyle = "thin" | "medium" | "hair" | "dotted";

export interface Edge {
  style: EdgeStyle;
  /** RRGGBB. */
  color?: string;
}

export interface StyleSpec {
  bold?: boolean;
  italic?: boolean;
  /** Points; 11 when absent. */
  size?: number;
  /** Font colour, RRGGBB. */
  color?: string;
  /** Solid fill, RRGGBB. */
  fill?: string;
  /** A hatch: the pattern's colour on a background (both RRGGBB). */
  hatch?: { fg: string; bg: string };
  border?: { left?: Edge; right?: Edge; top?: Edge; bottom?: Edge };
  align?: "left" | "center" | "right";
  valign?: "top" | "center" | "bottom";
  wrap?: boolean;
  /** An Excel number format code; General when absent. */
  numFmt?: string;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** Excel refuses a longer cell; longer text is cut. */
const CELL_LIMIT = 32_767;
const ROWS_PER_PUSH = 4000;
const NEEDS_PRESERVE = /^\s|\s$|\n/;
const NEEDS_ESCAPE =/[&<>"\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff￾￿]/;

/** Characters XML 1.0 cannot hold are dropped; the special ones are escaped. Plain text takes the fast path. */
function xml(text: string): string {
  if (!NEEDS_ESCAPE.test(text)) return text;
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Built-in number formats Excel knows by id; anything else becomes a custom format from 164. */
const BUILTIN_FORMATS: Record<string, number> = { General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10 };

const rgb = (hex: string): string => `FF${hex.toUpperCase()}`;

/** The workbook's styles: each distinct look is stored once and referred to by its cellXfs index. */
export class StyleBook {
  private fonts: string[] = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  private fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders: string[] = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  private formats: string[] = [];
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private index = new Map<string, number>([["{}", 0]]);
  private parts = new Map<string, number>();

  private part(list: string[], xmlText: string): number {
    const key = `${list === this.fonts ? "f" : list === this.fills ? "l" : "b"}${xmlText}`;
    let at = this.parts.get(key);
    if (at === undefined) {
      at = list.length;
      list.push(xmlText);
      this.parts.set(key, at);
    }
    return at;
  }

  private formatId(code: string | undefined): number {
    if (code === undefined) return 0;
    const builtin = BUILTIN_FORMATS[code];
    if (builtin !== undefined) return builtin;
    let at = this.formats.indexOf(code);
    if (at < 0) {
      at = this.formats.length;
      this.formats.push(code);
    }
    return 164 + at;
  }

  /** The cellXfs index of a style; the same spec always gives the same index, and no spec gives 0. */
  style(spec: StyleSpec): number {
    const key = JSON.stringify(spec);
    const known = this.index.get(key);
    if (known !== undefined) return known;
    const font =
      spec.bold === true || spec.italic === true || spec.size !== undefined || spec.color !== undefined
        ? this.part(
            this.fonts,
            `<font>${spec.bold === true ? "<b/>" : ""}${spec.italic === true ? "<i/>" : ""}<sz val="${spec.size ?? 11}"/>${spec.color === undefined ? "" : `<color rgb="${rgb(spec.color)}"/>`}<name val="Calibri"/><family val="2"/></font>`,
          )
        : 0;
    const fill =
      spec.hatch !== undefined
        ? this.part(this.fills, `<fill><patternFill patternType="lightUp"><fgColor rgb="${rgb(spec.hatch.fg)}"/><bgColor rgb="${rgb(spec.hatch.bg)}"/></patternFill></fill>`)
        : spec.fill !== undefined
          ? this.part(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${rgb(spec.fill)}"/><bgColor indexed="64"/></patternFill></fill>`)
          : 0;
    const side = (name: string, edge: Edge | undefined): string => (edge === undefined ? `<${name}/>` : `<${name} style="${edge.style}"><color rgb="${rgb(edge.color ?? "BFBFBF")}"/></${name}>`);
    const border = spec.border === undefined ? 0 : this.part(this.borders, `<border>${side("left", spec.border.left)}${side("right", spec.border.right)}${side("top", spec.border.top)}${side("bottom", spec.border.bottom)}<diagonal/></border>`);
    const numFmtId = this.formatId(spec.numFmt);
    const aligned = spec.align !== undefined || spec.valign !== undefined || spec.wrap === true;
    const alignment = aligned ? `<alignment${spec.align === undefined ? "" : ` horizontal="${spec.align}"`}${spec.valign === undefined ? "" : ` vertical="${spec.valign}"`}${spec.wrap === true ? ' wrapText="1"' : ""}/>` : "";
    const attrs = `numFmtId="${numFmtId}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmtId !== 0 ? ' applyNumberFormat="1"' : ""}${font !== 0 ? ' applyFont="1"' : ""}${fill !== 0 ? ' applyFill="1"' : ""}${border !== 0 ? ' applyBorder="1"' : ""}${aligned ? ' applyAlignment="1"' : ""}`;
    const at = this.xfs.length;
    this.xfs.push(alignment === "" ? `<xf ${attrs}/>` : `<xf ${attrs}>${alignment}</xf>`);
    this.index.set(key, at);
    return at;
  }

  xml(): string {
    return (
      XML_HEAD +
      `<styleSheet xmlns="${NS}">` +
      (this.formats.length === 0 ? "" : `<numFmts count="${this.formats.length}">${this.formats.map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(code)}"/>`).join("")}</numFmts>`) +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/>' +
      "</styleSheet>"
    );
  }
}

export interface SheetSetup {
  name: string;
  /** RRGGBB. */
  tabColor?: string;
  /** Column widths in characters, from column A. */
  widths?: readonly number[];
  /** Rows and columns kept in view while scrolling. */
  freeze?: { rows: number; cols: number };
  gridlines?: boolean;
  landscape?: boolean;
  /** Print one page wide (and as many tall as needed). */
  fitWidth?: boolean;
  /** First and last (1-based) row to repeat on every printed page. */
  printTitleRows?: readonly [number, number];
}

export interface ColourScale {
  /** A1 range. */
  ref: string;
  /** Low, middle and high colours, RRGGBB. */
  colors: readonly [string, string, string];
  /** The value the middle colour sits at; the midpoint of the data when absent. */
  middle?: number;
}

export interface SheetEnd {
  /** A1 range of the header row and the rows under it. */
  autoFilter?: string;
  /** A1 ranges to merge. */
  merges?: readonly string[];
  colourScales?: readonly ColourScale[];
  dataBars?: readonly { ref: string; color: string }[];
  /** Links from a cell to a cell of a sheet of this workbook. */
  links?: readonly { ref: string; sheet: string; tip?: string }[];
}

/** Absolute form of an A1 range: A2:C9 becomes $A$2:$C$9. */
function absolute(ref: string): string {
  return ref.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
}

function quoted(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

interface Placed {
  setup: SheetSetup;
  name: string;
  filter: string | null;
}

/** One sheet being written; rows must be added in ascending order. */
export class SheetWriter {
  private batch: string[] = [];
  private last = 0;
  private ended = false;

  constructor(
    private readonly file: { push(data: Uint8Array, final?: boolean): void },
    private readonly encode: (text: string) => Uint8Array,
    private readonly placed: Placed,
    private readonly selected: boolean,
    private readonly letters: (index: number) => string,
  ) {
    const { setup } = placed;
    const freeze = setup.freeze;
    let view = "";
    if (freeze !== undefined && (freeze.rows > 0 || freeze.cols > 0)) {
      const both = freeze.rows > 0 && freeze.cols > 0;
      const pane = both ? "bottomRight" : freeze.rows > 0 ? "bottomLeft" : "topRight";
      view =
        `<pane${freeze.cols > 0 ? ` xSplit="${freeze.cols}"` : ""}${freeze.rows > 0 ? ` ySplit="${freeze.rows}"` : ""} topLeftCell="${letters(freeze.cols)}${freeze.rows + 1}" activePane="${pane}" state="frozen"/>` +
        (both ? '<selection pane="topRight"/><selection pane="bottomLeft"/>' : "") +
        `<selection pane="${pane}"/>`;
    }
    const cols = (setup.widths ?? []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
    const head =
      XML_HEAD +
      `<worksheet xmlns="${NS}">` +
      `<sheetPr>${setup.tabColor === undefined ? "" : `<tabColor rgb="${rgb(setup.tabColor)}"/>`}${setup.fitWidth === true ? '<pageSetUpPr fitToPage="1"/>' : ""}</sheetPr>` +
      `<sheetViews><sheetView${setup.gridlines === false ? ' showGridLines="0"' : ""}${selected ? ' tabSelected="1"' : ""} workbookViewId="0">${view}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (cols === "" ? "" : `<cols>${cols}</cols>`) +
      "<sheetData>";
    this.file.push(this.encode(head), false);
  }

  /** Writes row `r` (1-based): the cell values from column A, each with a style (one number for the whole row, or one per cell). */
  row(r: number, cells: readonly XCell[], styles: number | readonly number[] = 0, height?: number): void {
    if (this.ended) throw new Error("sheet already ended");
    if (r <= this.last) throw new Error(`rows must ascend: ${r} after ${this.last}`);
    this.last = r;
    let out = `<row r="${r}"${height === undefined ? "" : ` ht="${height}" customHeight="1"`}>`;
    const each = typeof styles === "number" ? null : styles;
    // A cell directly after the previous one needs no reference: the XML (and the deflate work) stays smaller.
    let gap = true;
    for (let k = 0; k < cells.length; k++) {
      const value = cells[k];
      const s = each === null ? (styles as number) : (each[k] ?? 0);
      const attr = s === 0 ? "" : ` s="${s}"`;
      let cell: string;
      if (value === null || value === "") cell = s === 0 ? "" : `<c%R${attr}/>`;
      else if (typeof value === "string") {
        const text = value.length > CELL_LIMIT ? value.slice(0, CELL_LIMIT) : value;
        const space = NEEDS_PRESERVE.test(text) ? ' xml:space="preserve"' : "";
        cell = `<c%R t="inlineStr"${attr}><is><t${space}>${xml(text)}</t></is></c>`;
      } else if (typeof value === "number") cell = Number.isFinite(value) ? `<c%R${attr}><v>${value}</v></c>` : s === 0 ? "" : `<c%R${attr}/>`;
      else cell = `<c%R t="b"${attr}><v>${value ? 1 : 0}</v></c>`;
      if (cell === "") gap = true;
      else {
        out += cell.replace("%R", gap ? ` r="${this.letters(k)}${r}"` : "");
        gap = false;
      }
    }
    this.batch.push(`${out}</row>`);
    if (this.batch.length >= ROWS_PER_PUSH) {
      this.file.push(this.encode(this.batch.join("")), false);
      this.batch = [];
    }
  }

  /** True once `end` has been called. */
  get done(): boolean {
    return this.ended;
  }

  /** Closes the sheet: after the rows come the filter, merges, colour rules, links and print setup, in the order the format requires. */
  end(end: SheetEnd = {}): void {
    if (this.ended) throw new Error("sheet already ended");
    this.ended = true;
    this.placed.filter = end.autoFilter ?? null;
    let priority = 1;
    let tail = "</sheetData>";
    if (end.autoFilter !== undefined) tail += `<autoFilter ref="${end.autoFilter}"/>`;
    if (end.merges !== undefined && end.merges.length > 0) tail += `<mergeCells count="${end.merges.length}">${end.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`;
    for (const scale of end.colourScales ?? []) {
      const mid = scale.middle === undefined ? '<cfvo type="percentile" val="50"/>' : `<cfvo type="num" val="${scale.middle}"/>`;
      tail += `<conditionalFormatting sqref="${scale.ref}"><cfRule type="colorScale" priority="${priority++}"><colorScale><cfvo type="min"/>${mid}<cfvo type="max"/><color rgb="${rgb(scale.colors[0])}"/><color rgb="${rgb(scale.colors[1])}"/><color rgb="${rgb(scale.colors[2])}"/></colorScale></cfRule></conditionalFormatting>`;
    }
    for (const bar of end.dataBars ?? []) {
      tail += `<conditionalFormatting sqref="${bar.ref}"><cfRule type="dataBar" priority="${priority++}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${rgb(bar.color)}"/></dataBar></cfRule></conditionalFormatting>`;
    }
    if (end.links !== undefined && end.links.length > 0) {
      tail += `<hyperlinks>${end.links.map((link) => `<hyperlink ref="${link.ref}" location="${xml(`${quoted(link.sheet)}!A1`)}"${link.tip === undefined ? "" : ` tooltip="${xml(link.tip)}"`} display="${xml(link.sheet)}"/>`).join("")}</hyperlinks>`;
    }
    const { setup } = this.placed;
    tail += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>';
    tail += `<pageSetup orientation="${setup.landscape === true ? "landscape" : "portrait"}"${setup.fitWidth === true ? ' fitToWidth="1" fitToHeight="0"' : ""}/>`;
    this.file.push(this.encode(`${this.batch.join("")}${tail}</worksheet>`), true);
    this.batch = [];
  }
}

/** A workbook written sheet by sheet. */
export class XlsxBuilder {
  readonly styles = new StyleBook();
  private readonly placed: Placed[] = [];
  private readonly taken = new Set<string>();
  private open: SheetWriter | null = null;

  private constructor(
    private readonly zip: { add(file: unknown): void; end(): void },
    private readonly deflate: new (name: string, options: { level: 1 }) => { push(data: Uint8Array, final?: boolean): void },
    private readonly encode: (text: string) => Uint8Array,
    private readonly chunks: Uint8Array[],
    private readonly errors: { failure: Error | null },
  ) {}

  static async create(): Promise<XlsxBuilder> {
    const { Zip, ZipDeflate, strToU8 } = await import("fflate");
    const chunks: Uint8Array[] = [];
    const errors: { failure: Error | null } = { failure: null };
    const zip = new Zip((error, data) => {
      if (error !== null) errors.failure = error;
      else chunks.push(data);
    });
    return new XlsxBuilder(zip as never, ZipDeflate as never, strToU8, chunks, errors);
  }

  /** A valid, unique sheet name (reserved), to pass to `sheet` and to link to before the sheet exists. */
  uniqueName(name: string): string {
    return sheetName(name, this.taken);
  }

  /** Starts a sheet named with a name from `uniqueName`; the previous sheet must have ended. */
  sheet(setup: SheetSetup): SheetWriter {
    if (this.open !== null && !this.open.done) throw new Error("the previous sheet has not ended");
    const placed: Placed = { setup, name: setup.name, filter: null };
    this.placed.push(placed);
    const file = new this.deflate(`xl/worksheets/sheet${this.placed.length}.xml`, { level: 1 });
    this.zip.add(file);
    this.open = new SheetWriter(file, this.encode, placed, this.placed.length === 1, columnLetters);
    return this.open;
  }

  private text(name: string, content: string): void {
    const file = new this.deflate(name, { level: 1 });
    this.zip.add(file);
    file.push(this.encode(content), true);
  }

  /** Writes the package parts that depend on every sheet and returns the .xlsx bytes. */
  finish(): Uint8Array {
    const n = this.placed.length;
    this.text(
      "[Content_Types].xml",
      XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        this.placed.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        "</Types>",
    );
    this.text("_rels/.rels", XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    const names: string[] = [];
    this.placed.forEach((p, i) => {
      if (p.filter !== null) names.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xml(`${quoted(p.name)}!${absolute(p.filter)}`)}</definedName>`);
      const rows = p.setup.printTitleRows;
      if (rows !== undefined) names.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xml(`${quoted(p.name)}!$${rows[0]}:$${rows[1]}`)}</definedName>`);
    });
    this.text(
      "xl/workbook.xml",
      XML_HEAD +
        `<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
        this.placed.map((p, i) => `<sheet name="${xml(p.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        "</sheets>" +
        (names.length === 0 ? "" : `<definedNames>${names.join("")}</definedNames>`) +
        "</workbook>",
    );
    this.text(
      "xl/_rels/workbook.xml.rels",
      XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        this.placed.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    );
    this.text("xl/styles.xml", this.styles.xml());
    this.zip.end();
    if (this.errors.failure !== null) throw this.errors.failure;
    let size = 0;
    for (const chunk of this.chunks) size += chunk.length;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks.length = 0;
    return bytes;
  }
}
