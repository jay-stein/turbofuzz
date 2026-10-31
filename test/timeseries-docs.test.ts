import { test } from "node:test";
import assert from "node:assert/strict";
import { REFERENCES, REFERENCE_ORDER } from "../src/data/timeseries/references.js";
import { MODEL_KEYS } from "../src/data/timeseries/models.js";

// The documentation module imports the dialog helpers, which need a DOM only when a window opens.
const docs = await import("../src/ui/timeseries-model-docs.js");

test("every model has documentation, and every citation resolves to a listed source", () => {
  for (const k of MODEL_KEYS) {
    const d = docs.MODEL_DOCS[k];
    assert.ok(d && d.summary.length > 40 && d.equations.length > 0 && d.fitting.length > 0 && d.differs.length > 0, k);
  }
  const ids = docs.citedIds();
  assert.ok(ids.length >= 20, `cites ${ids.length} sources`);
  for (const id of ids) assert.ok(REFERENCES[id], `unknown source ${id}`);
  for (const id of ids) assert.ok(REFERENCE_ORDER.includes(id), `${id} is cited but not listed under Sources`);
});

test("the Sources list is complete, and every entry says what it was used for", () => {
  assert.deepEqual([...REFERENCE_ORDER].sort(), Object.keys(REFERENCES).sort());
  for (const r of Object.values(REFERENCES)) assert.ok(r.short && r.full && r.used.length > 10, r.short);
  assert.equal(docs.cite("see [ref:stl] and [ref:nope]").includes("[unknown source nope]"), true);
});
