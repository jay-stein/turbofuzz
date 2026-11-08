import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ColumnData } from "../src/data/column.js";
import { pairColumns } from "../src/data/compare/columns.js";
import { suggestKeys } from "../src/data/compare/keys.js";
import { matchRows } from "../src/data/compare/match.js";
import { buildReport } from "../src/data/compare/report.js";
import { DEFAULT_RULES, compareColumn, type CompareRules, type CompareSide } from "../src/data/compare/types.js";
import { describeRun, renderReport, type ReportInput } from "../src/ui/compare/compare-report.js";
import type { KeyChoice } from "../src/ui/compare/compare-setup.js";

function setupDom(): Window["document"] {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  return window.document;
}

function side(name: string, table: Record<string, string[]>): CompareSide {
  const columns = Object.entries(table).map(([column, raw]) => compareColumn(ColumnData.create(column, raw)));
  return { name, rowCount: columns[0]?.raw.length ?? 0, columns };
}

const info = (s: CompareSide) => ({ name: s.name, rowCount: s.rowCount, columns: s.columns.map((c) => ({ name: c.name, type: c.type })) });

function input(a: CompareSide, b: CompareSide, key: KeyChoice, rules: CompareRules = DEFAULT_RULES, manual: { a: number; b: number }[] = []): ReportInput {
  const pairing = pairColumns(a, b, manual);
  const match = matchRows(a, b, pairing, key.kind === "content" ? null : key.pairs.map((i) => pairing.pairs[i]!), rules);
  return {
    setup: { type: "compareSetup", requestId: 0, a: info(a), b: info(b), pairing, keys: suggestKeys(a, b, pairing, rules), ms: 1 },
    report: buildReport(a, b, pairing, match),
    ms: 42,
    key,
    rules,
  };
}

const A = side("before.csv", {
  id: ["1", "2", "3", "4", "5"],
  status: ["pending", "pending", "shipped", "shipped", "pending"],
  amount: ["10", "20", "30", "40", "50"],
  note: ["a", "b", "c", "d", "e"],
  legacy: ["x", "x", "x", "x", "x"],
});
const B = side("after.csv", {
  id: ["1", "2", "3", "4", "6", "6"],
  status: ["shipped", "shipped", "shipped", "returned", "pending", "pending"],
  amount: ["10", "20", "30", "40", "500", "1"],
  note: ["a", "b", "c", "d", "f", "g"],
  extra: ["p", "q", "r", "s", "t", "u"],
});

test("the report shows the rows, the key problems, the changes, the columns and the totals", () => {
  const document = setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  const opened: string[] = [];
  renderReport(host, input(A, B, { kind: "pairs", pairs: [0] }), { rows: (filter) => opened.push(`${filter.show}:${filter.pair}`) });
  const text = (selector: string): string[] => [...host.querySelectorAll(selector)].map((node) => node.textContent ?? "");

  assert.deepEqual(text(".cmp-tile-value"), ["1", "3", "1", "2", "5 → 6"]);
  assert.match(host.querySelector(".cmp-warn")?.textContent ?? "", /1 row in B repeat a key/);
  assert.deepEqual(text(".cmp-change-name"), ["status"]);
  assert.deepEqual(text(".cmp-pair"), ["pending→shipped×2", "shipped→returned×1"]);
  assert.match(host.querySelector(".cmp-quiet")?.textContent ?? "", /No changes in id, amount, note\./);
  assert.deepEqual(text(".cmp-schema-row"), ["Addedextra", "Removedlegacy"]);
  // amount only (id is the key): all rows 150 → 601, matched 100 → 100, so the change is all in rows added or removed.
  assert.deepEqual(text(".cmp-totals-name"), ["amount"]);
  const totals = text(".cmp-totals-grid > span");
  assert.deepEqual(totals.slice(3), ["A", "150", "100", "B", "601", "100", "B − A", "+451 (+300.67%)", "0"]);
  assert.match(host.textContent ?? "", /Most of the change in amount comes from rows added or removed/);
  // Counts and column names open those rows side by side.
  (host.querySelectorAll(".cmp-tile")[2] as unknown as { click(): void }).click();
  (host.querySelector(".cmp-change-name") as unknown as { click(): void }).click();
  assert.deepEqual(opened, ["onlyA:null", "changed:1"]);
});

test("matching on whole rows says why no cell changes are listed", () => {
  const document = setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  renderReport(host, input(A, B, { kind: "content" }), { rows: () => undefined });
  assert.equal(host.querySelectorAll(".cmp-change").length, 0);
  assert.match(host.textContent ?? "", /a changed row counts as one removed and one added/);
  assert.equal(host.querySelector(".cmp-warn"), null, "no key, no key warnings");
});

test("an empty value shows as (empty), and the run line names the key and the rules", () => {
  const document = setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  const a = side("a", { id: ["1", "2"], shipped: ["", "2024-01-02"] });
  const b = side("b", { id: ["1", "2"], shipped: ["2024-01-05", "2024-01-02"] });
  const rules = { ...DEFAULT_RULES, numberAbs: 0.5, ignoreCase: true };
  const run = input(a, b, { kind: "pairs", pairs: [0] }, rules);
  renderReport(host, run, { rows: () => undefined });
  const old = host.querySelector(".cmp-old");
  assert.equal(old?.textContent, "(empty)");
  assert.ok(old?.classList.contains("cmp-blank"));
  assert.equal(describeRun(run), "Matched on key id · numbers ±0.5 · case ignored · extra spaces ignored · compared in 42 ms");
  assert.match(host.textContent ?? "", /The same columns, with the same types, on both sides/);
});
