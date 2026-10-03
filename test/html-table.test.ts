import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { firstTableRows } from "../src/ui/html-table.js";

const window = new Window();
(globalThis as Record<string, unknown>).DOMParser = window.DOMParser;

test("skips a presentation notice and picks the wikitable with merged headers", () => {
  const html = `
    <html><body>
      <table class="ambox metadata" role="presentation"><tr><td>Notice</td></tr></table>
      <table class="wikitable sortable">
        <tr>
          <th rowspan="2">Centre</th><th rowspan="2">Location</th>
          <th colspan="2">Gross leasable area</th><th rowspan="2">Year</th>
        </tr>
        <tr><th>(m²)</th><th>(sq ft)</th></tr>
        <tr>
          <td>Chadstone<sup class="reference">[1]</sup></td>
          <td>Malvern East</td><td>129,924</td><td>1,398,490</td><td>1960</td>
        </tr>
      </table>
    </body></html>`;

  assert.deepEqual(firstTableRows(html), [
    ["Centre", "Location", "Gross leasable area (m²)", "Gross leasable area (sq ft)", "Year"],
    ["Chadstone", "Malvern East", "129,924", "1,398,490", "1960"],
  ]);
});

test("skips presentation layout tables on generic pages", () => {
  const html = `
    <table role="presentation"><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>
    <table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>`;

  assert.deepEqual(firstTableRows(html), [
    ["Name", "Age"],
    ["Alice", "30"],
  ]);
});

test("expands rowspan and colspan in the body", () => {
  const html = `
    <table>
      <tr><th>A</th><th>B</th></tr>
      <tr><td rowspan="2">x</td><td>1</td></tr>
      <tr><td>2</td></tr>
      <tr><td colspan="2">wide</td></tr>
    </table>`;

  assert.deepEqual(firstTableRows(html), [
    ["A", "B"],
    ["x", "1"],
    ["x", "2"],
    ["wide", "wide"],
  ]);
});

test("returns null when there is no data-shaped table", () => {
  assert.equal(
    firstTableRows('<table role="presentation"><tr><td>only</td></tr></table>'),
    null,
  );
  assert.equal(firstTableRows("<p>no tables here</p>"), null);
});
