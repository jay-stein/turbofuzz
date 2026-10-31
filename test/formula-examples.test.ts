import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { formulasFromExamples } from "../src/data/formula-examples.js";
import type { ColumnType } from "../src/types.js";

function col(name: string, type: ColumnType, raw: string[]): ColumnData {
  const c = ColumnData.create(name, raw);
  c.setType(type, true);
  return c;
}
const cols = [
  col("first", "string", ["Ada", "Alan", "Grace"]),
  col("last", "string", ["Lovelace", "Turing", "Hopper"]),
  col("email", "string", ["ada.l@x.org", "al@y.com", "grace@navy.mil"]),
  col("price", "number", ["10", "2.5", "4"]),
  col("qty", "integer", ["3", "4", "5"]),
  col("ordered", "date", ["2024-01-15", "2024-02-29", "2023-12-31"]),
];

test("the rule behind a few typed results is found, simplest first", () => {
  assert.equal(formulasFromExamples(cols, 3, [{ row: 0, output: "ada.l" }])[0], 'LEFT([email], FIND("@", [email]) - 1)');
  assert.equal(formulasFromExamples(cols, 3, [{ row: 0, output: "Ada Lovelace" }])[0], '[first] & " " & [last]');
  assert.equal(formulasFromExamples(cols, 3, [{ row: 1, output: "Turing, Alan" }])[0], '[last] & ", " & [first]');
  assert.equal(formulasFromExamples(cols, 3, [{ row: 0, output: "30" }, { row: 1, output: "10" }])[0], "[price] * [qty]");
  assert.equal(formulasFromExamples(cols, 3, [{ row: 0, output: "2024" }])[0], "YEAR([ordered])");
  assert.equal(formulasFromExamples(cols, 3, [{ row: 2, output: "navy.mil" }])[0], 'MID([email], FIND("@", [email]) + 1, 1000)');
  assert.deepEqual(formulasFromExamples(cols, 3, [{ row: 0, output: "nothing like it" }]), []);
});

test("the search stays quick on a wide table", () => {
  const wide = Array.from({ length: 40 }, (_, i) => col(`c${i}`, i % 2 ? "number" : "string", ["a b", "1", "x-y"]));
  const t0 = performance.now();
  formulasFromExamples(wide, 3, [{ row: 0, output: "zzz" }]);
  assert.ok(performance.now() - t0 < 1500, "under 1.5 s");
});
