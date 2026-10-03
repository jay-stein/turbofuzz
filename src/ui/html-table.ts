export interface ScrapedTable {
  rows: string[][];
}

const IGNORED_IN_CELLS = "sup.reference, style, script, .mw-editsection, .noprint";

function cellText(cell: Element): string {
  let source: Element = cell;
  if (cell.querySelector(IGNORED_IN_CELLS) !== null) {
    source = cell.cloneNode(true) as Element;
    for (const noise of Array.from(source.querySelectorAll(IGNORED_IN_CELLS))) {
      noise.remove();
    }
  }
  return (source.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Direct th/td children of a row (nested tables must not be counted). */
function directCells(row: Element): Element[] {
  const cells: Element[] = [];
  for (const child of Array.from(row.children)) {
    const tag = child.tagName;
    if (tag === "TH" || tag === "TD") cells.push(child);
  }
  return cells;
}

function spanOf(cell: Element, attribute: "colspan" | "rowspan"): number {
  const raw = Number.parseInt(cell.getAttribute(attribute) ?? "1", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 1;
}

/**
 * Flattens a table into a rectangular grid, expanding colspan/rowspan so
 * merged cells keep their value across the covered columns and rows.
 * `headerFlags[i]` marks grid rows that came from a header-only source row.
 */
function expandTable(table: Element): { grid: string[][]; headerFlags: boolean[] } {
  const grid: string[][] = [];
  const headerFlags: boolean[] = [];
  const spans = new Map<number, { text: string; left: number }>();

  for (const row of Array.from(table.querySelectorAll("tr"))) {
    const cells = directCells(row);
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
    headerFlags.push(cells.every((cell) => cell.tagName === "TH"));
  }

  // Merge consecutive header rows ("Gross leasable area" + "(m²)").
  while (
    grid.length > 1 &&
    headerFlags[0] === true &&
    headerFlags[1] === true
  ) {
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

function isDataShaped(table: Element): boolean {
  if (table.getAttribute("role") === "presentation") return false;
  const rows = table.querySelectorAll("tr");
  if (rows.length < 2) return false;
  let maxColumns = 0;
  for (const row of Array.from(rows)) {
    maxColumns = Math.max(maxColumns, directCells(row).length);
    if (maxColumns >= 2) return true;
  }
  return false;
}

/**
 * Picks the most likely data table: prefers a `wikitable` (Wikipedia and many
 * MediaWiki sites), otherwise the first table that is not presentation-only
 * and has at least two rows and two columns. Maintenance/nav/layout tables
 * are skipped.
 */
export function firstTableRows(html: string): string[][] | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = Array.from(doc.querySelectorAll("table"));
  if (tables.length === 0) return null;

  const dataTables = tables.filter(isDataShaped);
  const wikiTable = dataTables.find((table) => table.classList.contains("wikitable"));
  const chosen = wikiTable ?? dataTables[0];
  if (chosen === undefined) return null;

  const { grid } = expandTable(chosen);
  while (grid.length > 0 && grid[0].every((cell) => cell === "")) grid.shift();
  return grid.length > 0 ? grid : null;
}
