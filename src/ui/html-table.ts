export interface ScrapedTable {
  rows: string[][];
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

function isDataShaped(grid: string[][]): boolean {
  return grid.length >= 3 && maxColumns(grid) >= 2;
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

function isExcluded(element: Element): boolean {
  const role = roleOf(element);
  if (role === "presentation" || role === "none") return true;
  return isStaticallyHidden(element);
}

/**
 * Picks the single most data-rich grid on a page and extracts it.
 *
 * Candidates: HTML tables plus ARIA tables/grids/treegrids (covers many
 * server-rendered React/Angular grids). Declarative shadow DOM roots are also
 * scanned; imperative shadow DOM, iframes and JS-rendered grids are not
 * present in raw HTML and therefore out of scope for this static scraper.
 */
export function firstTableRows(html: string): string[][] | null {
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
  if (candidates.length === 0) return null;

  stitchHeaderTables(candidates);
  const live = candidates.filter((candidate) => !candidate.consumed);

  const scored = live
    .filter((candidate) => isMinimumShape(candidate.grid))
    .map((candidate) => ({ candidate, score: dataRichnessScore(candidate) }));
  if (scored.length === 0) return null;

  const solid = scored.filter((entry) => isDataShaped(entry.candidate.grid));
  const pool = solid.length > 0 ? solid : scored;
  pool.sort((a, b) => b.score - a.score);

  const rows = pool[0].candidate.grid.map((row) => row.slice());
  while (rows.length > 0 && rows[0].every((cell) => cell === "")) rows.shift();
  return rows.length > 0 ? rows : null;
}
