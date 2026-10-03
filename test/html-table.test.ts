import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { findDataTables, firstTableRows } from "../src/ui/html-table.js";

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

test("extracts ARIA grids", () => {
  const html = `
    <div role="grid" aria-rowcount="3" aria-colcount="2">
      <div role="row">
        <div role="columnheader">Name</div><div role="columnheader">Age</div>
      </div>
      <div role="row">
        <div role="gridcell">Alice</div><div role="gridcell">30</div>
      </div>
      <div role="row">
        <div role="gridcell">Bob</div><div role="gridcell">40</div>
      </div>
    </div>`;

  assert.deepEqual(firstTableRows(html), [
    ["Name", "Age"],
    ["Alice", "30"],
    ["Bob", "40"],
  ]);
});

test("scores candidates and prefers the richer table, not DOM order", () => {
  const html = `
    <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
    <table>
      <tr><th>Name</th><th>City</th><th>Score</th></tr>
      <tr><td>Alice</td><td>Melbourne</td><td>10</td></tr>
      <tr><td>Bob</td><td>Sydney</td><td>20</td></tr>
      <tr><td>Cara</td><td>Brisbane</td><td>30</td></tr>
    </table>`;

  const rows = firstTableRows(html);
  assert.equal(rows?.[0]?.[0], "Name");
  assert.equal(rows?.length, 4);
});

test("excludes statically hidden tables", () => {
  const html = `
    <table style="display:none"><tr><th>Hidden</th><th>Col</th></tr><tr><td>a</td><td>b</td></tr></table>
    <table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>`;

  assert.deepEqual(firstTableRows(html), [
    ["Name", "Age"],
    ["Alice", "30"],
  ]);
});

test("findDataTables returns descriptors and data sizes, best first", () => {
  const html = `
    <h2>Quarterly performance</h2>
    <table>
      <tr><th>Region</th><th>Q1</th></tr>
      <tr><td>North</td><td>10</td></tr>
      <tr><td>South</td><td>20</td></tr>
    </table>
    <table aria-label="Small extras">
      <tr><th>X</th><th>Y</th></tr>
      <tr><td>1</td><td>2</td></tr>
    </table>`;

  const tables = findDataTables(html, 10);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].label, "Quarterly performance");
  assert.deepEqual([tables[0].rows, tables[0].columns], [2, 2]);
  assert.equal(tables[1].label, "Small extras");
});

test("findDataTables prefers a caption and falls back to generic numbering", () => {
  const html = `
    <table>
      <caption>Sales by region</caption>
      <tr><th>A</th><th>B</th></tr>
      <tr><td>1</td><td>2</td></tr>
    </table>
    <table>
      <tr><th>A</th><th>B</th></tr>
      <tr><td>3</td><td>4</td></tr>
    </table>`;

  const tables = findDataTables(html, 10);
  assert.equal(tables[0].label, "Sales by region");
  assert.equal(tables[1].label, "Table 2");
});

test("findDataTables respects the limit and excludes degenerate tables", () => {
  const html = `
    <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
    <table><tr><th>A</th><th>B</th></tr><tr><td>3</td><td>4</td></tr></table>
    <table><tr><td>junk</td></tr></table>`;

  assert.equal(findDataTables(html, 1).length, 1);
  const all = findDataTables(html, 10);
  assert.equal(all.length, 2);
  assert.equal(all[0].label, "Table 1");
  assert.equal(all[1].label, "Table 2");
});

test("stitches an adjacent header-only table onto its data table", () => {
  const html = `
    <table><tr><th>Name</th><th>Age</th></tr></table>
    <table>
      <tr><td>Alice</td><td>30</td></tr>
      <tr><td>Bob</td><td>40</td></tr>
    </table>`;

  assert.deepEqual(firstTableRows(html), [
    ["Name", "Age"],
    ["Alice", "30"],
    ["Bob", "40"],
  ]);
});
