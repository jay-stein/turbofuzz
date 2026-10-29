import { test } from "node:test";
import { Window } from "happy-dom";
import assert from "node:assert/strict";
import {
  buildMultiFilePreflight,
  openMultiFilePreflight,
  type FilePreflightSample,
} from "../src/ui/multi-file-preflight.js";

const sample = (name: string, headers: string[], size: number, rows: number): FilePreflightSample => ({
  name,
  size,
  headers,
  sampleRows: rows,
  sampleBytes: 1000,
  encoding: "utf-8",
  delimiter: ",",
});

test("multi-file preflight estimates rows, cells and column differences", () => {
  const preflight = buildMultiFilePreflight([
    sample("a.csv", ["id", "value", "extra"], 2000, 100),
    sample("b.csv", ["value", "id"], 1000, 50),
  ]);
  assert.equal(preflight.files[0]?.estimatedRows, 200);
  assert.equal(preflight.files[0]?.estimatedCells, 600);
  assert.equal(preflight.files[1]?.estimatedRows, 50);
  assert.deepEqual(preflight.files[0]?.extraColumns, ["extra"]);
  assert.deepEqual(preflight.files[1]?.missingColumns, ["extra"]);
  assert.equal(preflight.identicalColumns, false);
  assert.deepEqual(preflight.commonColumns, ["id", "value"]);
  assert.equal(preflight.totalRows, 250);
});

test("multi-file preflight reports identical headers", () => {
  const preflight = buildMultiFilePreflight([
    sample("a.csv", ["ID", "Value"], 1000, 10),
    sample("b.csv", ["id", "value"], 1000, 10),
  ]);
  assert.equal(preflight.identicalColumns, true);
  assert.deepEqual(preflight.commonColumns, ["ID", "Value"]);
});
function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

test("preflight disables identical mode when columns differ", async () => {
  setupDom();
  const preflight = buildMultiFilePreflight([
    sample("a.csv", ["id", "value", "extra"], 2000, 100),
    sample("b.csv", ["value", "id"], 1000, 50),
  ]);
  const pending = openMultiFilePreflight(preflight);
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const identical = doc.querySelector('input[value="identical"]') as unknown as HTMLInputElement;
  assert.equal(identical.disabled, true);
  const confirm = doc.querySelector(".multi-file-modal .primary") as unknown as { click(): void };
  confirm.click();
  assert.equal(await pending, "align");
});
test("flags files whose columns mostly differ from the first file", () => {
  const aligned = buildMultiFilePreflight([
    sample("a.csv", ["id", "value", "extra"], 2000, 100),
    sample("b.csv", ["value", "id"], 1000, 50),
  ]);
  assert.deepEqual(aligned.mismatchedFiles, []);

  const shifted = buildMultiFilePreflight([
    sample("jan.csv", ["id", "value", "region"], 2000, 100),
    sample("feb.csv", ["Monthly export", "", ""], 1000, 50),
    sample("mar.csv", ["id", "value", "region"], 1000, 50),
  ]);
  assert.deepEqual(shifted.mismatchedFiles, ["feb.csv"]);
});
