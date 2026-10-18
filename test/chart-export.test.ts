import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsToCsv } from "../src/ui/chart-export.js";

test("chart CSV rows escape separators, quotes and newlines", () => {
  assert.equal(
    rowsToCsv([
      ["x", "y"],
      ["plain", "a,b"],
      ['quote"inside', "line\nbreak"],
    ]),
    'x,y\r\nplain,"a,b"\r\n"quote""inside","line\nbreak"',
  );
});
