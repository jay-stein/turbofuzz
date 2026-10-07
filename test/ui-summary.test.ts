import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { SummaryBand } from "../src/ui/summary-band.js";
import type { DedupeKeep } from "../src/data/transform-ops.js";
import type { ColumnMeta, LoadedMessage } from "../src/worker/protocol.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  globals.requestAnimationFrame = (callback: () => void) => {
    callback();
    return 0;
  };
  return window;
}

function columnMeta(): ColumnMeta {
  return {
    name: "a",
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 5,
      samples: [],
      topValues: [],
      min: null,
      max: null,
      mean: null,
      stddev: null,
      minLength: null,
      maxLength: null,
      avgLength: null,
    },
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [],
  };
}

function loadedMessage(): LoadedMessage {
  return {
    type: "loaded",
    requestId: 1,
    name: "t",
    headers: ["a"],
    rowCount: 10,
    columnCount: 1,
    columns: [columnMeta()],
    stats: {
      duplicateRows: 3,
      duplicateGroups: 2,
      rowsInDuplicateGroups: 7,
      emptyRows: 0,
      rowsWithNulls: 0,
      totalNullCells: 0,
      totalCells: 10,
      valueAnomalyRows: 0,
      lengthAnomalyRows: 0,
      computeMs: 1,
    },
    ingestMs: 5,
    source: "file",
    encoding: null,
  };
}

test("duplicates quick action offers keep-first, keep-last and remove-all", () => {
  const window = setupDom();
  const document = window.document as unknown as Document;
  const host = document.createElement("div") as unknown as HTMLElement;
  const calls: DedupeKeep[] = [];

  const band = new SummaryBand(host, {
    onToggleSpecial: () => {},
    onOpenStats: () => {},
    onColumnClick: () => {},
    onDropDuplicates: (keep) => calls.push(keep),
  });
  band.render(loadedMessage());

  const trigger = host.querySelector(".qa-dedupe") as unknown as { click(): void };
  trigger.click();

  const menu = document.querySelector(".qa-menu");
  assert.ok(menu !== null, "expected the dedupe menu");
  const items = menu.querySelectorAll(".context-item");
  assert.equal(items.length, 3);
  assert.match(items[0].textContent ?? "", /Keep first copy — 3 rows/);
  assert.match(items[1].textContent ?? "", /Keep last copy — 3 rows/);
  assert.match(items[2].textContent ?? "", /Remove all copies — 7 rows/);

  (items[0] as unknown as { click(): void }).click();
  assert.deepEqual(calls, ["first"]);
  assert.equal(document.querySelector(".qa-menu"), null, "menu closes after choosing");
});

test("the quick action is disabled when there are no duplicates", () => {
  const window = setupDom();
  const document = window.document as unknown as Document;
  const host = document.createElement("div") as unknown as HTMLElement;
  const message = loadedMessage();
  message.stats.duplicateRows = 0;
  message.stats.duplicateGroups = 0;
  message.stats.rowsInDuplicateGroups = 0;

  const band = new SummaryBand(host, {
    onToggleSpecial: () => {},
    onOpenStats: () => {},
    onColumnClick: () => {},
    onDropDuplicates: () => {},
  });
  band.render(message);

  const trigger = host.querySelector(".qa-dedupe") as unknown as { disabled: boolean };
  assert.equal(trigger.disabled, true);
});
