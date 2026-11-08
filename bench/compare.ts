import { ColumnData } from "../src/data/column.js";
import { pairColumns } from "../src/data/compare/columns.js";
import { suggestKeys } from "../src/data/compare/keys.js";
import { matchRows } from "../src/data/compare/match.js";
import { buildReport } from "../src/data/compare/report.js";
import { filterPositions, rowWindow } from "../src/data/compare/view.js";
import { DEFAULT_RULES, compareColumn, type CompareSide } from "../src/data/compare/types.js";
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

const changedRows = filterPositions(match, { show: "changed", pair: null });
const middle = Math.floor(changedRows.length / 2);
gate(`side-by-side window of 100 changed rows, ${ROWS.toLocaleString()} rows`, BUDGET.window, () => {
  rowWindow(a, b, pairing, match, changedRows, middle, middle + 100);
}, 20);

const expected = { onlyA: Math.ceil(ROWS / 100), onlyB: Math.floor(ROWS / 100) };
if (match.counts.onlyA !== expected.onlyA || match.counts.onlyB !== expected.onlyB || match.counts.changed === 0) {
  console.log(`FAIL counts ${JSON.stringify(match.counts)}, expected only-in-A ${expected.onlyA} and only-in-B ${expected.onlyB}`);
  failed = true;
} else {
  console.log(`counts ${JSON.stringify(match.counts)}`);
}
if (failed) process.exitCode = 1;
