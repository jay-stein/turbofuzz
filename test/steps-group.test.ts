import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSteps, type StepsPanelEntry } from "../src/ui/steps-panel.js";

function clean(
  column: number,
  opIndex: number,
  groupSize: number,
  description: string,
): StepsPanelEntry {
  return {
    kind: "clean",
    label: `col${column}: ${description}`,
    detail: `clean → ${description}`,
    column,
    opIndex,
    groupSize,
  };
}

function transform(index: number, detail: string): StepsPanelEntry {
  return {
    kind: "transform",
    label: `Transform ${index + 1}`,
    detail,
    column: -1,
    opIndex: index,
    groupSize: 3,
  };
}

test("identical cleans across three or more columns condense into one group", () => {
  const entries = [clean(0, 0, 1, "Trim"), clean(1, 0, 1, "Trim"), clean(2, 0, 1, "Trim")];
  const groups = groupSteps(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Trim · 3 columns");
  assert.equal(groups[0].entries.length, 3);
});

test("two columns are not condensed (avoids over-collapsing)", () => {
  const groups = groupSteps([clean(0, 0, 1, "Trim"), clean(1, 0, 1, "Trim")]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].entries.length, 1);
});

test("different operation sequences stay separate", () => {
  const groups = groupSteps([
    clean(0, 0, 1, "Trim"),
    clean(1, 0, 1, "lowercase"),
    clean(2, 0, 1, "Trim"),
  ]);
  assert.equal(groups.length, 3);
});

test("multi-op cleans group by their operation list", () => {
  const entries = [
    clean(0, 0, 2, "Trim"),
    clean(0, 1, 2, "UPPERCASE"),
    clean(1, 0, 2, "Trim"),
    clean(1, 1, 2, "UPPERCASE"),
    clean(2, 0, 2, "Trim"),
    clean(2, 1, 2, "UPPERCASE"),
  ];
  const groups = groupSteps(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "2 operations · 3 columns");
  assert.equal(groups[0].detail, "Trim → UPPERCASE");
  assert.equal(groups[0].entries.length, 6);
});

test("repeated entries from the same column never merge", () => {
  const entries = [clean(0, 0, 3, "Trim"), clean(0, 1, 3, "Trim"), clean(0, 2, 3, "Trim")];
  const groups = groupSteps(entries);
  assert.equal(groups.length, 3);
});

test("explicit transform batches collapse by group id", () => {
  const batch = { id: "transform-batch-0", label: "Transform batch (3 steps)" };
  const entries: StepsPanelEntry[] = [
    { ...transform(0, "transform → dedupe()"), group: batch },
    { ...transform(1, "transform → drop()"), group: batch },
    { ...transform(2, "transform → round()"), group: batch },
  ];
  const groups = groupSteps(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Transform batch (3 steps)");
  assert.equal(groups[0].entries.length, 3);
});

test("single transform batches and other kinds stay flat", () => {
  const entries: StepsPanelEntry[] = [
    transform(0, "transform → dedupe()"),
    { kind: "rows", label: "Removed 2 rows", column: -1, opIndex: 0, groupSize: 1 },
  ];
  const groups = groupSteps(entries);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].entries.length, 1);
  assert.equal(groups[1].entries[0].kind, "rows");
});
