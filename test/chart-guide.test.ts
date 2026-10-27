import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ChartGuide, needsVsHave } from "../src/ui/chart-guide.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function col(name: string, type: ColumnMeta["type"], distinct: number, grouped = false): ColumnMeta {
  return {
    name,
    type,
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: { nulls: 0, distinct, samples: [], topValues: [], min: null, max: null, mean: null, stddev: null, minLength: null, maxLength: null, avgLength: null },
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: grouped ? { labels: ["a", "b"], counts: [1, 1] } : null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [],
  };
}

const columns = [col("order_date", "date", 300), col("region", "category", 4, true), col("revenue", "number", 700)];

test("needs vs you have names the filled and missing slots", () => {
  const line = needsVsHave("line", [{ index: 0 }, { index: 2 }], columns, 1000);
  assert.deepEqual(
    line.map((l) => [l.slot, l.have]),
    [["Date", "order_date"], ["Value", "revenue"], ["Group by", null]],
  );
  const bars = needsVsHave("barplot", [{ index: 2 }], columns, 1000);
  assert.equal(bars[0].have, null, "no category picked");
  assert.equal(bars[0].need, "1 category");
  assert.equal(bars[1].have, "revenue");
});

test("the guide opens with the selection and an availability tab, with no requests", () => {
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement });
  let fetched = 0;
  (globalThis as Record<string, unknown>).fetch = () => {
    fetched++;
    return Promise.reject(new Error("no network"));
  };
  const guide = new ChartGuide(() => ({ columns, rowCount: 1000, picks: () => [{ index: 1 }, { index: 2 }] }));
  const t = performance.now();
  guide.open();
  const ms = performance.now() - t;
  assert.ok(ms < 50, `opens in under 50 ms, took ${ms}`);
  assert.ok(guide.isOpen);
  const text = guide.root.textContent ?? "";
  assert.match(text, /Barplot/);
  assert.match(text, /Needs vs you have/);
  assert.match(text, /Category: region ✓/);
  assert.match(text, /No pie charts/);
  (guide.root.querySelectorAll(".chart-guide-tab")[1] as unknown as { click(): void }).click();
  assert.match(guide.root.textContent ?? "", /What makes up the whole\?/);
  assert.match(guide.root.textContent ?? "", /needs a latitude.longitude pair/, "an unavailable chart says what it needs");
  assert.equal(guide.root.querySelectorAll("a").length, 0, "no outside links");
  assert.match(text, /Storytelling with Data/, "the inspiration is credited in plain text");
  assert.equal(fetched, 0);
  guide.close();
  assert.equal(guide.isOpen, false);
});
