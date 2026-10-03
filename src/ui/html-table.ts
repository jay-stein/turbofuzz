export interface ScrapedTable {
  rows: string[][];
}

/**
 * Extracts the first <table> on a page as a raw grid. Deliberately simple:
 * cell spans and nested tables are not handled — first table, row order,
 * `th`/`td` text content.
 */
export function firstTableRows(html: string): string[][] | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (table === null) return null;

  const rows: string[][] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells = tr.querySelectorAll("th, td");
    if (cells.length === 0) continue;
    const row: string[] = [];
    for (const cell of cells) {
      row.push((cell.textContent ?? "").replace(/\s+/g, " ").trim());
    }
    rows.push(row);
  }

  while (rows.length > 0 && rows[0].every((cell) => cell === "")) rows.shift();
  if (rows.length === 0) return null;

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return null;
  for (const row of rows) {
    while (row.length < width) row.push("");
    if (row.length > width) row.length = width;
  }
  return rows;
}
