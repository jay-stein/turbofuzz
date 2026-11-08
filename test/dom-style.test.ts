import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { el } from "../src/ui/dom.js";

test("el() applies a style through the CSSOM, which the deployed Content-Security-Policy allows", () => {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.document = window.document;
  const node = el("div", { style: "width: 40%; grid-template-columns: 34px 120px" });
  assert.equal(node.style.width, "40%");
  assert.equal(node.style.gridTemplateColumns, "34px 120px");
});
