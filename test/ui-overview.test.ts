import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { DatasetStats } from "../src/data/stats.js";
import { Overview, chartStep, delimiterLabel, formatLabelFor, healthTiles, pickNextSteps, typeMix } from "../src/ui/overview.js";
import type { ColumnMeta, LoadedMessage } from "../src/worker/protocol.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.getComputedStyle = window.getComputedStyle.bind(window);
  globals.localStorage = window.localStorage;
  return window;
}

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
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
    ...overrides,
  };
}

function stats(overrides: Partial<DatasetStats> = {}): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 0,
    totalNullCells: 0,
    totalCells: 100,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
    ...overrides,
  };
}

test("next steps rank firing rules by rows affected and end with the chart", () => {
  const columns = [
    meta({ name: "region", type: "category", stats: { ...meta().stats, nulls: 2 } }),
    meta({ name: "amount", type: "number", stats: { ...meta().stats, nulls: 0 } }),
  ];
  const steps = pickNextSteps(
    columns,
    stats({ rowsWithNulls: 30, duplicateRows: 12 }),
    100,
  );
  assert.deepEqual(
    steps.map((step) => step.id),
    ["empties", "duplicates", "chart"],
  );
  assert.equal(steps[0].text, "1 column has empty cells");
  assert.equal(steps[1].text, "12 duplicate rows");
  assert.equal(steps[2].action.kind, "chart");
  assert.equal(steps[2].action.column, 0);
  assert.equal(steps[2].text, "Chart rows by region");
});

test("next steps show only the top two rules when more than three fire", () => {
  const columns = [
    meta({
      name: "notes",
      type: "string",
      stats: { ...meta().stats, nulls: 4 },
      suggestions: [{ kind: "toNumber" } as never],
    }),
    meta({
      name: "sku",
      type: "category",
      stats: { ...meta().stats, distinct: 1 },
      similarGroups: 2,
    }),
  ];
  const steps = pickNextSteps(
    columns,
    stats({ rowsWithNulls: 50, duplicateRows: 20 }),
    100,
  );
  assert.equal(steps.length, 3);
  assert.deepEqual(
    steps.map((step) => step.id),
    ["empties", "duplicates", "chart"],
  );
});

test("split date parts surface a one-click combine step", () => {
  const columns = [
    meta({ name: "Year", type: "integer" }),
    meta({ name: "Month", type: "integer" }),
    meta({ name: "Day", type: "integer" }),
  ];
  const steps = pickNextSteps(columns, stats(), 300);
  const combine = steps.find((step) => step.id === "combineDate");
  assert.ok(combine !== undefined);
  assert.equal(combine.text, "Combine Year, Month, Day into a date");
  assert.equal(combine.button, "Combine");
  assert.equal(combine.action.kind, "combineDate");
  if (combine.action.kind === "combineDate") {
    assert.deepEqual(
      combine.action.op.parts.map((part) => part.role),
      ["year", "month", "day"],
    );
    assert.equal(combine.action.op.timeZone, "naive");
  }
});

test("next steps fire one-click fixes, near duplicates and constants", () => {
  const columns = [
    meta({ name: "a", suggestions: [{ kind: "toDate" } as never] }),
    meta({ name: "b", similarGroups: 3 }),
    meta({ name: "c", type: "integer", stats: { ...meta().stats, distinct: 1 } }),
  ];
  const steps = pickNextSteps(columns, stats(), 10);
  const ids = steps.map((step) => step.id);
  assert.ok(ids.includes("fixes"));
  assert.ok(ids.includes("nearDuplicates"));
  assert.ok(ids.includes("constant"));
  const fixes = steps.find((step) => step.id === "fixes");
  assert.equal(fixes?.text, "1 column has one-click fixes");
  const constants = steps.find((step) => step.id === "constant");
  assert.equal(constants?.text, "1 column holds a single value");
});

test("a clean dataset only suggests a chart", () => {
  const columns = [meta({ name: "amount", type: "number" })];
  const steps = pickNextSteps(columns, stats(), 100);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].id, "chart");
  assert.equal(steps[0].text, "Distribution of amount");
});

test("chart slot prefers dates, then categories, then numerics", () => {
  assert.equal(
    chartStep([meta({ name: "when", type: "date" }), meta({ name: "n", type: "number" })]).text,
    "Chart when over time",
  );
  assert.equal(
    chartStep([meta({ name: "who", type: "category" }), meta({ name: "n", type: "number" })]).text,
    "Chart rows by who",
  );
  assert.equal(chartStep([meta({ name: "n", type: "number" })]).text, "Distribution of n");
  assert.equal(chartStep([meta({ name: "s", type: "string" })]).text, "Chart the data");
});

test("health tiles report completeness and warn above zero", () => {
  const tiles = healthTiles(
    [meta({ stats: { ...meta().stats, nulls: 5 } }), meta()],
    stats({ totalNullCells: 15, totalCells: 150, duplicateRows: 3, valueAnomalyRows: 7 }),
  );
  assert.equal(tiles.length, 4);
  assert.equal(tiles[0].id, "complete");
  assert.equal(tiles[0].value, "90.0%");
  assert.equal(tiles[0].warn, true);
  assert.equal(tiles[1].value, "3");
  assert.equal(tiles[2].value, "1 of 2");
  assert.equal(tiles[3].value, "7");
  assert.equal(tiles.every((tile) => typeof tile.label === "string"), true);
});

test("overview renders dataset line, tiles, next steps and every column", () => {
  const window = setupDom();
  const host = document.createElement("div");
  const overview = new Overview(host, {
    onOpenTable: () => {},
    onOpenChart: () => {},
    onFilterColumn: () => {},
    onCleanColumn: () => {},
    onOpenCleanNulls: () => {},
    onDedupe: () => {},
    onOpenMerge: () => {},
    onReviewColumn: () => {},
    onDropColumn: () => {},
    onOpenStats: () => {},
  });

  const columns = Array.from({ length: 12 }, (_, index) =>
    meta({ name: `col_${index}`, type: index % 2 === 0 ? "number" : "category" }),
  );
  const loaded = {
    type: "loaded",
    name: "sales_demo.csv",
    rowCount: 6015,
    columnCount: 12,
    columns,
    stats: stats({ totalCells: 12 * 6015, duplicateRows: 15 }),
    encoding: null,
    ingestMs: 293,
  } as unknown as LoadedMessage;

  overview.render(loaded);

  assert.match(host.querySelector(".overview-facts")?.textContent ?? "", /6,015 rows × 12 columns/);
  assert.equal(host.querySelectorAll(".health-tile").length, 4);
  assert.ok(host.querySelectorAll(".next-step-card").length >= 1);
  assert.equal(host.querySelectorAll(".overview-column-grid .stat-card").length, 12);
  assert.ok(host.querySelector(".overview-actions .primary") !== null);

  const checkbox = host.querySelector<HTMLInputElement>(".overview-actions input[type=checkbox]");
  assert.ok(checkbox !== null);
  checkbox.checked = true;
  checkbox.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal(window.localStorage.getItem("turbofuzz.view.default"), "table");
  checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal(window.localStorage.getItem("turbofuzz.view.default"), null);

  overview.updateColumn(0, meta({ name: "renamed", type: "number" }));
  assert.match(
    host.querySelector('.overview-column-grid .stat-card[data-column="0"]')?.textContent ?? "",
    /renamed/,
  );
});

test("a healthy dataset collapses the health block to one line", () => {
  setupDom();
  const host = document.createElement("div");
  const overview = new Overview(host, {
    onOpenTable: () => {},
    onOpenChart: () => {},
    onFilterColumn: () => {},
    onCleanColumn: () => {},
    onOpenCleanNulls: () => {},
    onDedupe: () => {},
    onOpenMerge: () => {},
    onReviewColumn: () => {},
    onDropColumn: () => {},
    onOpenStats: () => {},
  });
  overview.render({
    type: "loaded",
    name: "clean.csv",
    rowCount: 10,
    columnCount: 1,
    columns: [meta({ name: "amount", type: "number" })],
    stats: stats({ totalCells: 10 }),
    encoding: null,
    ingestMs: 3,
  } as unknown as LoadedMessage);

  assert.equal(host.querySelectorAll(".health-tile").length, 0);
  assert.match(host.querySelector(".overview-clear")?.textContent ?? "", /No duplicates/);
});

test("formatLabelFor and delimiterLabel name the file facts", () => {
  assert.equal(formatLabelFor("a.CSV"), "CSV");
  assert.equal(formatLabelFor("dir/b.tsv"), "TSV");
  assert.equal(formatLabelFor("rows.jsonl"), "JSON");
  assert.equal(formatLabelFor("book.xls"), "Excel 97–2003");
  assert.equal(formatLabelFor("data.parquet"), "Parquet");
  assert.equal(formatLabelFor("unknown"), null);
  assert.equal(delimiterLabel(","), "comma");
  assert.equal(delimiterLabel("\t"), "tab");
  assert.equal(delimiterLabel(null), null);
  assert.equal(delimiterLabel(undefined), null);
});

test("typeMix counts numeric, date, category, text and boolean columns", () => {
  const columns = [
    meta({ name: "a", type: "integer" }),
    meta({ name: "b", type: "number" }),
    meta({ name: "c", type: "date" }),
    meta({ name: "d", type: "string" }),
    meta({ name: "e", type: "category" }),
    meta({ name: "f", type: "boolean" }),
    meta({ name: "g", type: "identifier" }),
  ];
  assert.equal(typeMix(columns), "2 numeric · 1 date · 1 category · 1 text · 1 boolean · 1 ID");
  assert.equal(typeMix([]), "");
});

test("the dataset line shows format, delimiter, encoding, size and type mix", () => {
  setupDom();
  const host = document.createElement("div");
  const overview = new Overview(host, {
    onOpenTable: () => {},
    onOpenChart: () => {},
    onFilterColumn: () => {},
    onCleanColumn: () => {},
    onOpenCleanNulls: () => {},
    onDedupe: () => {},
    onOpenMerge: () => {},
    onReviewColumn: () => {},
    onDropColumn: () => {},
    onOpenStats: () => {},
  });
  overview.render(
    {
      type: "loaded",
      name: "euro.csv",
      rowCount: 100,
      columnCount: 4,
      columns: [
        meta({ name: "when", type: "date" }),
        meta({ name: "amount", type: "number" }),
        meta({ name: "tax", type: "number" }),
        meta({ name: "city", type: "category" }),
      ],
      stats: stats({ totalCells: 400 }),
      encoding: "utf-8",
      delimiter: ";",
      ingestMs: 12,
    } as unknown as LoadedMessage,
    { sizeLabel: "529 KB" },
  );

  const facts = host.querySelector(".overview-facts")?.textContent ?? "";
  assert.match(facts, /euro\.csv/);
  assert.match(facts, /529 KB/);
  assert.match(facts, /12 ms/);
  const badges = [...host.querySelectorAll(".overview-badge")].map(
    (badge) => badge.textContent,
  );
  assert.deepEqual(badges, ["CSV", "semicolon", "UTF-8"]);
  assert.equal(
    host.querySelector(".overview-types")?.textContent,
    "2 numeric · 1 date · 1 category",
  );
});

test("the missing values map reports columns, rows and affected columns", () => {
  setupDom();
  const host = document.createElement("div");
  const overview = new Overview(host, {
    onOpenTable: () => {},
    onOpenChart: () => {},
    onFilterColumn: () => {},
    onCleanColumn: () => {},
    onOpenCleanNulls: () => {},
    onDedupe: () => {},
    onOpenMerge: () => {},
    onReviewColumn: () => {},
    onDropColumn: () => {},
    onOpenStats: () => {},
  });
  overview.render({
    type: "loaded",
    name: "gap.csv",
    rowCount: 10,
    columnCount: 2,
    columns: [meta({ name: "a" }), meta({ name: "b" })],
    stats: stats({ totalCells: 20 }),
    encoding: "utf-8",
    delimiter: ",",
    ingestMs: 2,
  } as unknown as LoadedMessage);

  assert.ok(host.querySelector(".missingness-section") !== null);
  overview.setMissingness({
    type: "missingness",
    requestId: 1,
    buckets: 2,
    columns: 2,
    cells: Uint16Array.from([0, 3, 0, 0]),
    totalRows: 10,
    columnNames: ["a", "b"],
    ms: 1,
  });
  const caption = host.querySelector(".missingness-caption")?.textContent ?? "";
  assert.match(caption, /2 columns × 10 rows/);
  assert.match(caption, /blue = data/);
  assert.match(caption, /1 column affected/);
  assert.match(
    host.querySelector(".missingness-canvas")?.getAttribute("aria-label") ?? "",
    /1 column has missing values/,
  );
});

test("placeholder null tokens surface a one-click convert step", () => {
  const columns = [
    meta({
      name: "amount",
      stats: { ...meta().stats, nulls: 40 },
      nullTokens: [
        { label: "NA", count: 30 },
        { label: "", count: 10 },
      ],
    }),
    meta({
      name: "notes",
      stats: { ...meta().stats, nulls: 5 },
      nullTokens: [{ label: "TBD", count: 5 }],
    }),
  ];
  const steps = pickNextSteps(columns, stats({ rowsWithNulls: 45 }), 100);
  const convert = steps.find((step) => step.id === "nullTokens");
  assert.ok(convert !== undefined);
  assert.equal(convert.text, "35 cells hold placeholder text like “NA”, “TBD”");
  assert.equal(convert.button, "Convert to nulls");
  assert.deepEqual(convert.action, { kind: "blankTokens", tokens: ["NA", "TBD"] });
  assert.ok(!steps.some((step) => step.id === "empties"), "the review card is replaced");
});

test("columns with only blank cells keep the review-first empties step", () => {
  const columns = [
    meta({
      name: "amount",
      stats: { ...meta().stats, nulls: 4 },
      nullTokens: [{ label: "", count: 4 }],
    }),
  ];
  const steps = pickNextSteps(columns, stats({ rowsWithNulls: 4 }), 100);
  assert.ok(steps.some((step) => step.id === "empties"));
  assert.ok(!steps.some((step) => step.id === "nullTokens"));
});
