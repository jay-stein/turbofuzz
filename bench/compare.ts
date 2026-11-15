import { ColumnData } from "../src/data/column.js";
import { pairColumns } from "../src/data/compare/columns.js";
import { suggestKeys } from "../src/data/compare/keys.js";
import { matchRows } from "../src/data/compare/match.js";
import { buildReport } from "../src/data/compare/report.js";
import { filterPositions, rowWindow } from "../src/data/compare/view.js";
import { diffColumns, diffWindow, mostChangedColumn, sortDiffPositions } from "../src/data/compare/diffs.js";
import { suggestColumnPairs } from "../src/data/compare/pair-suggest.js";
import { columnShifts, groupShift } from "../src/data/compare/shift.js";
import { DEFAULT_RULES, compareColumn, type CompareSide } from "../src/data/compare/types.js";
import { compareReportWorkbook } from "../src/ui/compare/compare-xlsx.js";
import { measure, ms } from "./bench-utils.js";

// Latency budgets for compare mode's engine (plan-compare.md, Speed). Two
// datasets of ROWS x 20 columns; B has 2% of rows changed, 1% removed, 1%
// added and is in a different order. Loading the files is ingest's budget, so
// columns are built (and parsed to numbers) before timing.
const ROWS = Number(process.argv.find((arg) => arg.startsWith("--rows="))?.split("=")[1] ?? 1_000_000);
const scale = ROWS / 1_000_000;
// Measured 2026-11-08 at 1M rows: keys 1.1 s, key match 1.7 s, whole rows 2.9-4.1 s (it numbers all
// 40M cells; GC pauses vary), report 0.16 s. Whole-row matching stays exact rather than trusting a hash.
const BUDGET = {
  suggestKeys: Math.max(300, 1500 * scale),
  matchKey: Math.max(600, 2000 * scale),
  matchContent: Math.max(800, 4500 * scale),
  report: Math.max(100, 500 * scale),
  // A screen of the side-by-side view: drawn on every scroll, so it must fit in a frame.
  window: 16,
  // The floor allows for a busy machine at gate size (200k ran 250-560 ms); the 1M budget is the real target (measured 0.65 s).
  shift: Math.max(800, 1500 * scale),
  groups: Math.max(50, 400 * scale),
};

const cities = ["Sydney", "Melbourne", "Perth", "Hobart", "Darwin", "Adelaide", "Brisbane", "Canberra"];
const status = ["open", "closed", "pending", "void"];

function makeTable(rows: number, variant: "a" | "b"): Record<string, string[]> {
  const ids: number[] = [];
  for (let i = 0; i < rows; i++) {
    if (variant === "b" && i % 100 === 7) continue; // removed in B
    ids.push(i);
  }
  if (variant === "b") {
    for (let i = 0; i < rows / 100; i++) ids.push(rows + i); // added in B
    // A different order: swap neighbouring blocks of 1,000.
    for (let start = 0; start + 2000 <= ids.length; start += 2000) {
      const block = ids.slice(start, start + 1000);
      ids.copyWithin(start, start + 1000, start + 2000);
      ids.splice(start + 1000, 1000, ...block);
    }
  }
  const changed = (id: number, column: number): boolean => variant === "b" && (id * 31 + column) % 50 === 0;
  const table: Record<string, string[]> = { order_id: ids.map((id) => `ORD-${id}`) };
  for (let c = 0; c < 6; c++) table[`amount_${c}`] = ids.map((id) => ((id * (c + 3)) % 10_000 / 100 + (changed(id, c) ? 1 : 0)).toFixed(2));
  for (let c = 0; c < 4; c++) table[`qty_${c}`] = ids.map((id) => String(((id * (c + 7)) % 500) + (changed(id, c + 6) ? 1 : 0)));
  for (let c = 0; c < 3; c++) table[`city_${c}`] = ids.map((id) => cities[(id + c + (changed(id, c + 10) ? 1 : 0)) % cities.length]);
  for (let c = 0; c < 2; c++) table[`status_${c}`] = ids.map((id) => status[(id + c + (changed(id, c + 13) ? 1 : 0)) % status.length]);
  for (let c = 0; c < 2; c++) table[`date_${c}`] = ids.map((id) => `2024-${String(1 + ((id + c) % 12)).padStart(2, "0")}-${String(1 + ((id + (changed(id, c + 15) ? 1 : 0)) % 28)).padStart(2, "0")}`);
  table.note = ids.map((id) => (id % 5 === 0 ? "" : `note ${id % 997}${changed(id, 19) ? "!" : ""}`));
  return table;
}

function toSide(name: string, table: Record<string, string[]>): CompareSide {
  const columns = Object.entries(table).map(([column, raw]) => ColumnData.create(column, raw));
  for (const column of columns) if (column.type !== "string" && column.type !== "category") column.numbers();
  return { name, rowCount: columns[0].raw.length, columns: columns.map(compareColumn) };
}

let failed = false;
function gate(label: string, budget: number, fn: () => void, iterations = 3): void {
  const timing = measure(fn, { iterations, warmup: 1 });
  const over = timing.p95 > budget;
  if (over) failed = true;
  console.log(`${over ? "OVER" : "ok  "} ${label}  p95 ${ms(timing.p95)} ms  budget ${Math.round(budget)} ms`);
}

console.log(`compare: building two datasets of ${ROWS.toLocaleString()} rows x 20 columns…`);
const a = toSide("a", makeTable(ROWS, "a"));
const b = toSide("b", makeTable(ROWS, "b"));
const pairing = pairColumns(a, b);

let keyPair = -1;
gate(`suggest keys, ${ROWS.toLocaleString()} rows`, BUDGET.suggestKeys, () => {
  keyPair = suggestKeys(a, b, pairing, DEFAULT_RULES)[0]?.pairs[0] ?? -1;
});
if (keyPair !== 0) {
  console.log(`FAIL the suggested key is pair ${keyPair}, expected order_id`);
  failed = true;
}

let match = matchRows(a, b, pairing, [pairing.pairs[0]], DEFAULT_RULES);
gate(`match + diff on a key, ${ROWS.toLocaleString()} rows`, BUDGET.matchKey, () => {
  match = matchRows(a, b, pairing, [pairing.pairs[0]], DEFAULT_RULES);
});
gate(`match whole rows (no key), ${ROWS.toLocaleString()} rows`, BUDGET.matchContent, () => {
  matchRows(a, b, pairing, null, DEFAULT_RULES);
});
gate(`report, ${ROWS.toLocaleString()} rows`, BUDGET.report, () => {
  buildReport(a, b, pairing, match);
});

const changedRows = filterPositions(match, { show: "changed", pairs: [] });
const middle = Math.floor(changedRows.length / 2);
gate(`side-by-side window of 100 changed rows, ${ROWS.toLocaleString()} rows`, BUDGET.window, () => {
  rowWindow(a, b, pairing, match, changedRows, middle, middle + 100);
}, 20);

// Value differences: the first screen is the changed rows, largest change first (sorted once per choice, then windows are cheap).
const diffCols = diffColumns(a, b, pairing);
const sortPair = mostChangedColumn(diffCols, match)!;
let sorted = changedRows;
gate(`value differences: order the changed rows by size, ${ROWS.toLocaleString()} rows`, Math.max(100, 400 * scale), () => {
  sorted = sortDiffPositions(a, b, pairing, match, sortPair, changedRows, "sub", "desc");
});
gate(`value differences: window of 200 rows, ${ROWS.toLocaleString()} rows`, 16, () => {
  diffWindow(a, b, pairing, match, diffCols, [0], sorted, 0, 200, "sub");
}, 20);
{
  const matched = filterPositions(match, { show: "matched", pairs: [] });
  gate(`value differences: order every matched row (header click, unfiltered), ${ROWS.toLocaleString()} rows`, Math.max(600, 2500 * scale), () => {
    sortDiffPositions(a, b, pairing, match, sortPair, matched, "sub", "desc");
  }, 2);
}
// A renamed key column: the pairing is suggested from the first rows, and the best few are read in full.
{
  const renamedB: CompareSide = { ...b, columns: b.columns.map((column, i) => (i === 0 ? { ...column, name: "customer_ref" } : column)) };
  const renamedPairing = pairColumns(a, renamedB);
  let found = 0;
  gate(`suggest a renamed key column, ${ROWS.toLocaleString()} rows`, Math.max(300, 1000 * scale), () => {
    found = suggestColumnPairs(a, renamedB, renamedPairing, DEFAULT_RULES).length;
  });
  if (found !== 1) {
    console.log(`FAIL expected one renamed-column suggestion, got ${found}`);
    failed = true;
  }
}

gate(`what shifted (every column), ${ROWS.toLocaleString()} rows`, BUDGET.shift, () => {
  columnShifts(a, b, pairing, new Set([0]));
});
gate(`mean per group (city_0 x amount_0), ${ROWS.toLocaleString()} rows`, BUDGET.groups, () => {
  groupShift(a, b, pairing, 11, 1, "mean");
});

// The formatted Excel report (Summary, Differences, Changed cells, Only in A/B, Columns, Big Picture): built row
// by row and deflated as it goes, so it must not freeze the worker or hold the sheets as strings.
// About 38% of rows differ in this data, so 135,000 rows give ~50,000 differing rows (13,500 give ~5,000). Measured
// 2026-11-15 in node: 5,000 rows 270-620 ms, 50,000 rows 2.5 s (13 MB; deflate is about half); it runs in the worker.
{
  const timeAsync = async (label: string, budget: number, run: () => Promise<{ differences: { total: number }; bytes: Uint8Array }>): Promise<void> => {
    await run();
    const times: number[] = [];
    let last = await run();
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      last = await run();
      times.push(performance.now() - started);
    }
    times.sort((x, y) => x - y);
    const p95 = times[times.length - 1]!;
    const over = p95 > budget;
    if (over) failed = true;
    console.log(`${over ? "OVER" : "ok  "} ${label}, ${last.differences.total.toLocaleString()} differing rows x 20 columns (${(last.bytes.length / 1e6).toFixed(1)} MB)  p95 ${ms(p95)} ms  budget ${Math.round(budget)} ms`);
  };
  for (const [rows, budget] of [[13_500, 1000], [135_000, 5000]] as const) {
    const ra = toSide("a", makeTable(rows, "a"));
    const rb = toSide("b", makeTable(rows, "b"));
    const rp = pairColumns(ra, rb);
    const rm = matchRows(ra, rb, rp, [rp.pairs[0]], DEFAULT_RULES);
    const rr = buildReport(ra, rb, rp, rm);
    const rs = columnShifts(ra, rb, rp, new Set([0]));
    const meta = { description: "bench", rules: DEFAULT_RULES, autoPaired: null, created: "now" };
    await timeAsync(`Excel report`, budget, () => compareReportWorkbook(ra, rb, rp, rm, [0], rr, rs, meta));
  }
}

const expected = { onlyA: Math.ceil(ROWS / 100), onlyB: Math.floor(ROWS / 100) };
if (match.counts.onlyA !== expected.onlyA || match.counts.onlyB !== expected.onlyB || match.counts.changed === 0) {
  console.log(`FAIL counts ${JSON.stringify(match.counts)}, expected only-in-A ${expected.onlyA} and only-in-B ${expected.onlyB}`);
  failed = true;
} else {
  console.log(`counts ${JSON.stringify(match.counts)}`);
}
if (failed) process.exitCode = 1;
