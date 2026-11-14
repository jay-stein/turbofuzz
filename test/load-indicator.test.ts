import { test } from "node:test";
import assert from "node:assert/strict";
import { formatElapsed, loadDetailText, percentOf } from "../src/ui/load-indicator.js";
import { createProgressThrottle } from "../src/parse/progress-throttle.js";

test("elapsed time reads in seconds, then minutes", () => {
  assert.equal(formatElapsed(0), "0 s");
  assert.equal(formatElapsed(42_900), "42 s");
  assert.equal(formatElapsed(89_000), "1 min 29 s");
});

test("a percent is shown only when the report can back it", () => {
  assert.equal(percentOf({ detail: "x", current: 50, total: 200 }), 25);
  assert.equal(percentOf({ detail: "x" }), null);
  assert.equal(percentOf({ detail: "x", current: 5, total: 0 }), null);
  assert.equal(percentOf({ detail: "x", current: 9, total: 4 }), null, "past the total is not a percent");
  assert.equal(percentOf({ detail: "x", current: -1, total: 4 }), null);
});

test("the detail line joins the words, the percent and the elapsed time", () => {
  const text = loadDetailText({ detail: "Reading rows: 420,000 so far", current: 1, total: 4 }, 1000, 43_000);
  assert.equal(text, "Reading rows: 420,000 so far · 25% · 42 s");
  assert.equal(loadDetailText({ detail: "Reading file…" }, 0, 3000), "Reading file · 3 s");
});

test("progress reports are limited to a few a second, but a new phase or a finished one always goes out", () => {
  let clock = 0;
  const gate = createProgressThrottle(250, () => clock);
  assert.equal(gate("parse"), true);
  clock = 100;
  assert.equal(gate("parse"), false);
  clock = 249;
  assert.equal(gate("parse"), false);
  clock = 250;
  assert.equal(gate("parse"), true);
  clock = 260;
  assert.equal(gate("build"), true, "a new phase is never held back");
  clock = 270;
  assert.equal(gate("build", true), true, "a finished phase is never held back");
  let sent = 0;
  for (clock = 1000; clock < 2000; clock += 10) if (gate("stats")) sent++;
  assert.ok(sent <= 5, `at most 4 per second plus the phase start, got ${sent}`);
});
