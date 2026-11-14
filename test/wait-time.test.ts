import assert from "node:assert/strict";
import { test } from "node:test";
import { preparationKey } from "../src/search/prepare-key.js";
import { normalize } from "../src/search/normalize.js";
import { formatWait, PREPARE_NOTE_DELAY_MS, PrepareNote, waitedMs } from "../src/ui/wait-time.js";

test("the printed figure is the wait, so it includes preparation and facets the worker's matching step leaves out", () => {
  // Fake clock: request sent at t=1000, the worker's matching step took 8 ms, the answer arrived at t=3800.
  assert.equal(waitedMs(1000, 3800, 8), 2800);
});

test("the worker's own figure is kept when it is larger than the measured wait", () => {
  assert.equal(waitedMs(1000, 1005, 40), 40);
  assert.equal(waitedMs(1000, 900, Number.NaN), 0);
});

test("no operation prints <1 ms for work that happened", () => {
  assert.equal(formatWait(0.2), "1 ms");
  assert.equal(formatWait(8.4), "8 ms");
  assert.equal(formatWait(6156), "6,156 ms");
  assert.equal(formatWait(0), null);
  assert.equal(formatWait(null), null);
});

test("the first-use note appears only when the work is still running after the delay", () => {
  const shown: string[] = [];
  let due: (() => void) | null = null;
  let delay = 0;
  const note = new PrepareNote(
    (text) => shown.push(text),
    ((run: () => void, ms: number) => {
      due = run;
      delay = ms;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as never,
    (() => {
      due = null;
    }) as never,
  );
  note.start("customer_name");
  assert.equal(delay, PREPARE_NOTE_DELAY_MS);
  assert.deepEqual(shown, []);
  note.stop(); // fast operation finished first
  assert.equal(due, null);
  assert.deepEqual(shown, []);
  note.start("customer_name");
  (due as (() => void) | null)?.(); // still running at the delay
  assert.deepEqual(shown, ["Preparing the customer_name column (first use)…"]);
});

test("only filters with one-off column preparation are named", () => {
  assert.equal(preparationKey({ kind: "text", mode: "contains", query: "a" }), "text");
  assert.equal(preparationKey({ kind: "text", mode: "fuzzy", query: "a" }), "index");
  assert.equal(preparationKey({ kind: "text", mode: "phonetic", query: "a" }), "index");
  assert.equal(preparationKey({ kind: "range", min: 1, max: 2 }), "numbers");
  assert.equal(preparationKey({ kind: "blank", negate: false }), null);
  assert.equal(preparationKey(null), null);
});

test("the plain-ASCII fast path in normalize matches the full pipeline", () => {
  assert.equal(normalize("Hello World"), "hello world");
  assert.equal(normalize("  Hello   World "), "hello world");
  assert.equal(normalize("José  Núñez"), "jose nunez");
  assert.equal(normalize("a\tb"), "a b");
  assert.equal(normalize(""), "");
});
