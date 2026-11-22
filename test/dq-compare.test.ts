import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { advanceTrail, compareColumns, trailLabel, type DQBaseline } from "../src/data/dq-baseline.js";
import { buildCompareSection } from "../src/ui/quality-compare.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  return window;
}

test("the trail keeps the score after each step, groups steps that land together, and forgets undone ones", () => {
  let trail = advanceTrail([], [], 70);
  assert.deepEqual(trail, []);
  trail = advanceTrail(trail, ["city: Standardise"], 74);
  trail = advanceTrail(trail, ["city: Standardise", "state: Standardise", "spend: Fill"], 80);
  assert.deepEqual(trail.map((entry) => [trailLabel(entry), entry.overall]), [["city: Standardise", 74], ["state: Standardise and 1 more", 80]]);
  // A late count changes the score with no new step: the newest entry takes it.
  trail = advanceTrail(trail, ["city: Standardise", "state: Standardise", "spend: Fill"], 80.4);
  assert.equal(trail[1]!.overall, 80.4);
  // Undo the last step: it leaves the trail, and the score now belongs to what remains.
  trail = advanceTrail(trail, ["city: Standardise", "state: Standardise"], 77);
  assert.deepEqual(trail.map((entry) => [trailLabel(entry), entry.overall]), [["city: Standardise", 74], ["state: Standardise", 77]]);
  // Undo everything: the trail is empty again.
  assert.deepEqual(advanceTrail(trail, [], 70), []);
});

const base = (overall: number, extra: Partial<DQBaseline> = {}): DQBaseline => ({
  overall,
  band: overall >= 90 ? "good" : overall >= 75 ? "fair" : "poor",
  rowCount: 100,
  rowsAffected: 30,
  emptyCells: 40,
  duplicateRows: 5,
  dimensions: [
    { dimension: "completeness", label: "Completeness", score: 60 },
    { dimension: "validity", label: "Validity", score: 80 },
    { dimension: "timeliness", label: "Timeliness", score: null },
  ],
  columns: [
    { name: "region", type: "category", score: 58, fill: 0.85 },
    { name: "phone_2", type: "string", score: null, fill: 0 },
  ],
  groups: ["junk", "empty"],
  issues: 6,
  ...extra,
});

test("columns are matched by name, the most changed first, a dropped column last", () => {
  const rows = compareColumns(
    [{ name: "a", type: "string", score: 90, fill: 1 }, { name: "b", type: "string", score: 50, fill: 0.5 }, { name: "gone", type: "string", score: null, fill: 0 }],
    [{ name: "a", type: "string", score: 90, fill: 1 }, { name: "b", type: "string", score: 95, fill: 1 }],
  );
  assert.deepEqual(rows.map((row) => row.name), ["b", "a", "gone"]);
  assert.equal(rows[2]!.after, null);
});

test("the report's before and after shows both scores, the counts, a dot per side, each step and the changed columns", () => {
  const window = setupDom();
  const before = base(68.2);
  const after = base(91.7, {
    rowsAffected: 4,
    emptyCells: 2,
    duplicateRows: 0,
    rowCount: 95,
    issues: 1,
    dimensions: [
      { dimension: "completeness", label: "Completeness", score: 94 },
      { dimension: "validity", label: "Validity", score: 80 },
      { dimension: "timeliness", label: "Timeliness", score: null },
    ],
    columns: [{ name: "region", type: "category", score: 99, fill: 1 }],
  });
  const section = buildCompareSection(before, after, [{ label: "Junk data", overall: 74 }, { label: "Fill region", overall: 91.7 }], { bandFair: 75, bandGood: 90 });
  window.document.body.append(section as never);
  const text = section.textContent ?? "";
  assert.match(text, /Raw load68\.2needs work/);
  assert.match(text, /After cleaning91\.7good/);
  assert.equal(section.querySelector(".qc-delta")?.textContent, "+23.5");
  assert.match(text, /Rows failing a check30 → 4/);
  assert.match(text, /Duplicate rows5 → 0/);
  assert.equal(section.querySelectorAll(".qc-tile-value.better").length >= 4, true);
  // Two dots on a scored dimension, one where nothing changed overlaps, and Timeliness says it is not scored.
  assert.equal(section.querySelectorAll(".qc-dim")[0]!.querySelectorAll(".qc-dot").length, 2);
  assert.match(section.querySelectorAll(".qc-dim")[0]!.textContent ?? "", /60\.0 → 94\.0/);
  assert.match(section.querySelectorAll(".qc-dim")[2]!.textContent ?? "", /not scored/);
  // The ledger: raw load, each step with its points, the total.
  const steps = [...section.querySelectorAll(".qc-step")].map((node) => node.textContent);
  assert.deepEqual(steps, ["Raw load68.2", "Junk data+5.8", "Fill region+17.7", "After cleaning91.7"]);
  // Columns: region improved, phone_2 dropped.
  const rows = [...section.querySelectorAll(".qc-table tbody tr")].map((row) => row.textContent);
  assert.deepEqual(rows, ["regioncategory85% → 100%58 → 99", "phone_2string0% → droppedn/a"]);
});

test("with no step applied the section says before and after are the same and offers to start", () => {
  setupDom();
  let opened = 0;
  const section = buildCompareSection(base(70), base(70), [], { bandFair: 75, bandGood: 90, openClean: () => { opened++; } });
  assert.match(section.textContent ?? "", /No cleaning step yet/);
  assert.equal(section.querySelector(".qc-top"), null);
  (section.querySelector("button") as unknown as HTMLButtonElement).click();
  assert.equal(opened, 1);
});
