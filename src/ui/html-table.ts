export interface ScrapedTable {
  rows: string[][];
}

export interface TableCandidate {
  label: string;
  rows: number;
  columns: number;
  grid: string[][];
}

interface Candidate {
  element: Element;
  grid: string[][];
  headerFlags: boolean[];
  consumed: boolean;
}

interface ExtractedGrid {
  grid: string[][];
  headerFlags: boolean[];
}

const CANDIDATE_SELECTOR = 'table, [role="table"], [role="grid"], [role="treegrid"]';
const ROW_SELECTOR = 'tr, [role="row"]';
const IGNORED_IN_CELLS = "sup.reference, style, script, .mw-editsection, .noprint";

function roleOf(element: Element): string {
  return (element.getAttribute("role") ?? "").toLowerCase();
}

/** Static-only visibility check: `hidden`, inline display:none/visibility:hidden. */
function isStaticallyHidden(element: Element): boolean {
  if (element.hasAttribute("hidden")) return true;
  const style = element.getAttribute("style");
  if (style === null) return false;
  const lowered = style.toLowerCase();
  return (
    lowered.includes("display:none") ||
    lowered.includes("display: none") ||
    lowered.includes("visibility:hidden") ||
    lowered.includes("visibility: hidden")
  );
}

function isHeaderCell(cell: Element): boolean {
  if (cell.tagName === "TH") return true;
  const role = roleOf(cell);
  return role === "columnheader" || role === "rowheader";
}

function isCellElement(cell: Element): boolean {
  if (cell.tagName === "TH" || cell.tagName === "TD") return true;
  const role = roleOf(cell);
  return role === "columnheader" || role === "rowheader" || role === "cell" || role === "gridcell";
}

/** Nearest ancestor (or self) that is itself a table/grid candidate. */
function closestCandidate(element: Element): Element | null {
  let current: Element | null = element;
  while (current !== null) {
    if (current.matches(CANDIDATE_SELECTOR)) return current;
    current = current.parentElement;
  }
  return null;
}

function cellsOf(row: Element): Element[] {
  const cells: Element[] = [];
  for (const child of Array.from(row.children)) {
    if (isCellElement(child)) cells.push(child);
  }
  return cells;
}

function rowsOf(candidate: Element): Element[] {
  const rows: Element[] = [];
  for (const row of Array.from(candidate.querySelectorAll(ROW_SELECTOR))) {
    if (closestCandidate(row) === candidate && cellsOf(row).length > 0) rows.push(row);
  }
  return rows;
}

function cellText(cell: Element): string {
  if (isStaticallyHidden(cell)) return "";

  let source: Element = cell;
  if (cell.querySelector(IGNORED_IN_CELLS) !== null) {
    source = cell.cloneNode(true) as Element;
    for (const noise of Array.from(source.querySelectorAll(IGNORED_IN_CELLS))) {
      noise.remove();
    }
  }
  return (source.textContent ?? "").replace(/\s+/g, " ").trim();
}

function spanOf(cell: Element, attribute: "colspan" | "rowspan"): number {
  const raw = Number.parseInt(cell.getAttribute(attribute) ?? "1", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 1;
}

/**
 * Flattens rows into a rectangular grid, expanding colspan/rowspan so merged
 * cells keep their value across the covered columns and rows.
 * `headerFlags[i]` marks grid rows that came from a header-only source row.
 */
function expandGrid(rows: Element[]): ExtractedGrid {
  const grid: string[][] = [];
  const headerFlags: boolean[] = [];
  const spans = new Map<number, { text: string; left: number }>();

  for (const row of rows) {
    const cells = cellsOf(row);
    if (cells.length === 0) continue;

    const gridRow: string[] = [];
    let column = 0;

    const placePendingSpans = (): void => {
      let span = spans.get(column);
      while (span !== undefined) {
        gridRow[column] = span.text;
        span.left--;
        if (span.left === 0) spans.delete(column);
        column++;
        span = spans.get(column);
      }
    };

    for (const cell of cells) {
      placePendingSpans();
      const text = cellText(cell);
      const colspan = spanOf(cell, "colspan");
      const rowspan = spanOf(cell, "rowspan");
      for (let c = 0; c < colspan; c++) {
        gridRow[column] = text;
        if (rowspan > 1) spans.set(column, { text, left: rowspan - 1 });
        column++;
      }
    }
    placePendingSpans();

    grid.push(gridRow);
    headerFlags.push(cells.every(isHeaderCell));
  }

  // Merge consecutive header rows ("Gross leasable area" + "(m²)").
  while (grid.length > 1 && headerFlags[0] === true && headerFlags[1] === true) {
    const top = grid[0];
    const next = grid[1];
    for (let c = 0; c < top.length; c++) {
      const value = next[c] ?? "";
      if (value !== "" && value !== top[c]) {
        top[c] = top[c] === undefined || top[c] === "" ? value : `${top[c]} ${value}`;
      }
    }
    grid.splice(1, 1);
    headerFlags.splice(1, 1);
  }

  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  for (const row of grid) {
    while (row.length < width) row.push("");
    if (row.length > width) row.length = width;
  }
  return { grid, headerFlags };
}

function maxColumns(grid: string[][]): number {
  return grid.reduce((max, row) => Math.max(max, row.length), 0);
}

function isMinimumShape(grid: string[][]): boolean {
  return grid.length >= 2 && maxColumns(grid) >= 2;
}

function isHeaderOnly(candidate: Candidate): boolean {
  return (
    candidate.grid.length > 0 &&
    candidate.grid.length <= 2 &&
    candidate.headerFlags.every(Boolean)
  );
}

/**
 * Static stand-in for split sticky-header grids: an adjacent header-only table
 * followed by a same-width data table is stitched into one candidate.
 */
function stitchHeaderTables(candidates: Candidate[]): void {
  for (let i = 0; i < candidates.length - 1; i++) {
    const header = candidates[i];
    const body = candidates[i + 1];
    if (header.consumed || body.consumed) continue;
    if (!isHeaderOnly(header) || isHeaderOnly(body)) continue;
    const columns = maxColumns(header.grid);
    if (columns === 0 || columns !== maxColumns(body.grid)) continue;

    body.grid = [...header.grid, ...body.grid];
    body.headerFlags = [...header.headerFlags, ...body.headerFlags];
    header.consumed = true;
  }
}

/**
 * Data Richness Score (adapted from the scraper spec, minus layout-dependent
 * signals). Rows/columns dominate, then visible text, then density/headers.
 */
function dataRichnessScore(candidate: Candidate): number {
  const { grid } = candidate;
  const physicalRows = grid.length;
  const physicalColumns = maxColumns(grid);

  const ariaRows = Number.parseInt(candidate.element.getAttribute("aria-rowcount") ?? "", 10);
  const ariaColumns = Number.parseInt(candidate.element.getAttribute("aria-colcount") ?? "", 10);
  const rows =
    Number.isFinite(ariaRows) && ariaRows > 0 ? Math.max(physicalRows, ariaRows) : physicalRows;
  const columns =
    Number.isFinite(ariaColumns) && ariaColumns > 0
      ? Math.max(physicalColumns, ariaColumns)
      : physicalColumns;

  let visibleChars = 0;
  let populated = 0;
  const totalCells = Math.max(1, physicalRows * physicalColumns);
  for (const row of grid) {
    for (const cell of row) {
      if (cell === "") continue;
      const compact = cell.replace(/\s+/g, "");
      visibleChars += compact.length;
      if (/[\p{L}\p{N}]/u.test(cell)) populated++;
    }
  }

  const density = populated / totalCells;
  const headerBonus = candidate.headerFlags.some(Boolean) ? 50 : 0;

  return rows * columns * 0.4 + visibleChars * 0.3 + density * 100 + headerBonus;
}

const CHROME_CLASSES = /(^|\s)(navbox|vertical-navbox|sidebar|toc|catlinks|mw-editsection)(\s|$)/;

/** Navigation/footer chrome is not data even when it is table-shaped. */
function isStructuralChrome(element: Element): boolean {
  let node: Element | null = element;
  while (node !== null) {
    const tag = node.tagName;
    if (tag === "NAV" || tag === "FOOTER") return true;
    const role = roleOf(node);
    if (role === "navigation" || role === "contentinfo" || role === "banner" || role === "search") {
      return true;
    }
    if (CHROME_CLASSES.test(node.getAttribute("class") ?? "")) return true;
    node = node.parentElement;
  }
  return false;
}

function isExcluded(element: Element): boolean {
  const role = roleOf(element);
  if (role === "presentation" || role === "none") return true;
  if (isStaticallyHidden(element)) return true;
  return isStructuralChrome(element);
}

function cleanText(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** Visible-ish text: textContent with style/script blocks removed. */
function elementText(element: Element): string {
  let source: Element = element;
  if (element.querySelector("style, script") !== null) {
    source = element.cloneNode(true) as Element;
    for (const noise of Array.from(source.querySelectorAll("style, script"))) {
      noise.remove();
    }
  }
  return cleanText(source.textContent);
}

function headingText(element: Element): string | null {
  if (/^H[1-6]$/.test(element.tagName)) {
    const text = elementText(element);
    return text === "" ? null : text;
  }
  for (const child of Array.from(element.children)) {
    if (/^H[1-6]$/.test(child.tagName)) {
      const text = elementText(child);
      if (text !== "") return text;
    }
  }
  return null;
}

/** Nearest preceding heading, walking up a few ancestor levels. */
function nearestHeading(element: Element): string | null {
  let node: Element | null = element;
  for (let depth = 0; depth < 3 && node !== null; depth++) {
    let sibling = node.previousElementSibling;
    while (sibling !== null) {
      const heading = headingText(sibling);
      if (heading !== null) return heading;
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
  }
  return null;
}

function descriptorFor(element: Element): string | null {
  for (const child of Array.from(element.children)) {
    if (child.tagName === "CAPTION") {
      const text = elementText(child);
      if (text !== "") return text;
    }
  }
  const aria = cleanText(element.getAttribute("aria-label"));
  if (aria !== "") return aria;
  const summary = cleanText(element.getAttribute("summary"));
  if (summary !== "") return summary;

  const figure = element.closest("figure");
  const figcaption = figure?.querySelector("figcaption");
  if (figcaption !== null && figcaption !== undefined) {
    const text = elementText(figcaption);
    if (text !== "") return text;
  }

  return nearestHeading(element);
}

function dataRowCount(candidate: Candidate): number {
  const hasHeader = candidate.headerFlags[0] === true;
  return Math.max(0, candidate.grid.length - (hasHeader ? 1 : 0));
}

/**
 * Finds up to `limit` data-rich grids on a page, best first.
 *
 * Candidates: HTML tables plus ARIA tables/grids/treegrids (covers many
 * server-rendered React/Angular grids). Declarative shadow DOM roots are also
 * scanned; imperative shadow DOM, iframes and JS-rendered grids are not
 * present in raw HTML and therefore out of scope for this static scraper.
 */
export function findDataTables(html: string, limit = 10): TableCandidate[] {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const roots: ParentNode[] = [doc];
  for (const template of Array.from(
    doc.querySelectorAll("template[shadowrootmode], template[shadowroot]"),
  )) {
    const content = (template as HTMLTemplateElement).content;
    if (content !== null) roots.push(content);
  }

  const candidates: Candidate[] = [];
  const seen = new Set<Element>();
  for (const root of roots) {
    for (const element of Array.from(root.querySelectorAll(CANDIDATE_SELECTOR))) {
      if (seen.has(element) || isExcluded(element)) continue;
      seen.add(element);
      const extracted = expandGrid(rowsOf(element));
      if (extracted.grid.length === 0) continue;
      candidates.push({
        element,
        grid: extracted.grid,
        headerFlags: extracted.headerFlags,
        consumed: false,
      });
    }
  }
  if (candidates.length === 0) return [];

  stitchHeaderTables(candidates);
  const live = candidates.filter((candidate) => !candidate.consumed);

  const scored = live
    .filter((candidate) => isMinimumShape(candidate.grid))
    .map((candidate) => ({ candidate, score: dataRichnessScore(candidate) }));
  if (scored.length === 0) return [];

  // Prefer candidates with real data rows; fall back to any minimum-shape
  // table when a page only has header+one-row tables.
  const withDataRows = scored.filter((entry) => dataRowCount(entry.candidate) >= 2);
  const pool = withDataRows.length > 0 ? withDataRows : scored;

  // Largest by rows x columns wins; the richness score breaks ties.
  pool.sort((a, b) => {
    const areaA = dataRowCount(a.candidate) * maxColumns(a.candidate.grid);
    const areaB = dataRowCount(b.candidate) * maxColumns(b.candidate.grid);
    if (areaB !== areaA) return areaB - areaA;
    return b.score - a.score;
  });

  return pool.slice(0, Math.max(1, limit)).flatMap((entry, index) => {
    const rows = entry.candidate.grid.map((row) => row.slice());
    while (rows.length > 0 && rows[0].every((cell) => cell === "")) rows.shift();
    if (rows.length === 0) return [];
    return [
      {
        label: descriptorFor(entry.candidate.element) ?? `Table ${index + 1}`,
        rows: dataRowCount(entry.candidate),
        columns: maxColumns(entry.candidate.grid),
        grid: rows,
      },
    ];
  });
}

/** Convenience wrapper: the single most data-rich grid, or null. */
export function firstTableRows(html: string): string[][] | null {
  const best = findDataTables(html, 1)[0];
  return best === undefined ? null : best.grid;
}
