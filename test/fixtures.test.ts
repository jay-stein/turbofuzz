import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildDataset } from "../src/data/build.js";
import { detectTable } from "../src/parse/header-detect.js";
import { readWorkbookSheet } from "../src/parse/xlsx.js";
import { clusterSimilar } from "../src/search/similar.js";
import { ingestDataset } from "../src/worker/ingest.js";

function fixture(name: string): ArrayBuffer {
  const raw = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}

test("euro_win1252.csv reads decimal commas per column", () => {
  const { dataset } = ingestDataset({
    name: "euro_win1252.csv",
    delimiter: "auto",
    hasHeaders: true,
    buffer: fixture("euro_win1252.csv"),
  });

  const umsatz = dataset.columns.find((column) => column.name === "Umsatz");
  assert.ok(umsatz !== undefined);
  assert.equal(umsatz.type, "number");
  assert.equal(umsatz.numberLocale, "comma");
  umsatz.numbers();
  assert.ok(umsatz.stats.max !== null && umsatz.stats.max <= 999.99);
  assert.ok(umsatz.stats.mean !== null && umsatz.stats.mean > 300 && umsatz.stats.mean < 700);

  const datum = dataset.columns.find((column) => column.name === "Datum");
  assert.ok(datum !== undefined);
  assert.equal(datum.type, "date");
  datum.numbers();
  assert.ok((datum.stats.min ?? 0) >= Date.UTC(2024, 0, 1));
});

test("messy_report.xlsx dates survive ingest", async () => {
  const grid = await readWorkbookSheet(fixture("messy_report.xlsx"), "Q3 Report");
  const detected = detectTable(grid);
  assert.ok(detected.headers.includes("Sales Actual"));
  assert.ok(detected.headers.includes("Sales Budget"));
  const headers = detected.headers.map((value, index) =>
    value.trim() === "" ? `Column ${index + 1}` : value,
  );
  const dataset = buildDataset("Q3 Report", headers, detected.rows);

  const date = dataset.columns.find((column) => column.name === "Date");
  assert.ok(date !== undefined);
  assert.equal(date.type, "date");
  const dates = date.raw.filter((value) => value !== "");
  assert.equal(dates[0], "2024-07-01");
  assert.equal(dates[dates.length - 1], "2024-08-09");

  const code = dataset.columns.find((column) => column.name === "Code");
  assert.ok(code !== undefined);
  assert.equal(code.type, "identifier");
  assert.equal(code.raw[0], "00149");
});

test("ragged.csv keeps four rows without header contamination", () => {
  const { dataset } = ingestDataset({
    name: "ragged.csv",
    delimiter: "auto",
    hasHeaders: true,
    buffer: fixture("ragged.csv"),
  });
  assert.equal(dataset.rowCount, 4);
  assert.equal(dataset.columns[0].name, "id");
  assert.equal(dataset.columns[0].raw[0], "1");
  assert.equal(dataset.columns[0].raw[3], "4");
});

test("messy_values.csv city variants cluster into one merge", () => {
  const { dataset } = ingestDataset({
    name: "messy_values.csv",
    delimiter: "auto",
    hasHeaders: true,
    buffer: fixture("messy_values.csv"),
  });

  const city = dataset.columns.find((column) => column.name === "city");
  assert.ok(city !== undefined);
  assert.equal(city.type, "category");

  const categories = city.categories();
  const clusters = clusterSimilar(
    categories.labels.map((value, index) => ({ value, count: categories.counts[index] })),
  );
  const fremantle = clusters.find((cluster) =>
    cluster.values.some((entry) => entry.value.toLowerCase().includes("fremantle")),
  );
  assert.ok(fremantle !== undefined, "expected a Fremantle cluster");
  const variants = fremantle.values.map((entry) => entry.value.trim().toLowerCase());
  assert.ok(variants.includes("fremantle"));
  assert.ok(variants.includes("fremantel"));
  assert.ok(variants.includes("freemantle"));
});

test("messy_values.csv surfaces sentinel and boolean suggestions", () => {
  const { dataset } = ingestDataset({
    name: "messy_values.csv",
    delimiter: "auto",
    hasHeaders: true,
    buffer: fixture("messy_values.csv"),
  });

  const score = dataset.columns.find((column) => column.name === "score");
  assert.ok(score !== undefined);
  assert.ok(
    score.suggestions.some(
      (suggestion) => suggestion.kind === "sentinel" && suggestion.value === "-999",
    ),
    "expected -999 to be suggested as a missing-value code",
  );

  const paid = dataset.columns.find((column) => column.name === "paid");
  assert.ok(paid !== undefined);
  assert.ok(paid.suggestions.some((suggestion) => suggestion.kind === "boolean"));
});
