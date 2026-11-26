import { test } from "node:test";
import assert from "node:assert/strict";
import { applyHover, buildChartHtml, buildHitMap, hoverFields, type HoverChoices } from "../src/ui/chart-html-export.js";
import type { HitRegion } from "../src/ui/chart-hit-regions.js";

const region = (x: number, y: number, w: number, h: number, lines: string[], contains?: HitRegion["contains"]): HitRegion => ({ x, y, w, h, lines, actions: [], ...(contains === undefined ? {} : { contains }) });

test("the hover lines are listed once each: the mark's name, then each labelled line", () => {
  const fields = hoverFields([region(0, 0, 1, 1, ["R0", "Sum of sales: 24,900"]), region(0, 0, 1, 1, ["R1", "Sum of sales: 3", "Rows: 12"])]);
  assert.deepEqual(fields.map((field) => field.key), ["name", "Sum of sales", "Rows"]);
  assert.equal(fields[0]!.label, "Name of the mark");
  assert.equal(fields[1]!.example, "24,900");
  assert.equal(fields[2]!.example, "12");
});

test("the analyst's choices: a hidden line is left out, labels are renamed, the name gets a label, the note is added", () => {
  const lines = ["R0", "Sum of sales: 24,900", "Rows: 12"];
  const choices: HoverChoices = {
    fields: hoverFields([region(0, 0, 1, 1, lines)]),
    note: "  Source: ledger ",
    details: true,
  };
  choices.fields[0]!.rename = "Region";
  choices.fields[1]!.rename = "Revenue";
  choices.fields[2]!.show = false;
  assert.deepEqual(applyHover(lines, choices), ["Region: R0", "Revenue: 24,900", "Source: ledger"]);
  // Nothing chosen: the chart's own lines, as they are.
  assert.deepEqual(applyHover(lines, { fields: hoverFields([region(0, 0, 1, 1, lines)]), note: "", details: false }), lines);
});

test("the hover map puts the later mark on top where marks overlap, and covers every cell", () => {
  const map = buildHitMap([region(0, 0, 10, 10, ["a"]), region(4, 4, 10, 10, ["b"]), region(30, 0, 10, 10, ["c"], (x) => x < 34)], 40, 20, 2);
  const grid: number[] = [];
  for (let i = 0; i < map.runs.length; i += 2) for (let n = 0; n < map.runs[i + 1]!; n++) grid.push(map.runs[i]!);
  assert.equal(grid.length, map.cols * map.rows);
  const at = (x: number, y: number): number => grid[Math.floor(y / 2) * map.cols + Math.floor(x / 2)]! - 1;
  assert.equal(at(1, 1), 0);
  assert.equal(at(6, 6), 1, "b was drawn later, so it wins the overlap");
  assert.equal(at(20, 18), -1, "between marks is no mark");
  assert.equal(at(31, 5), 2);
  assert.equal(at(37, 5), -1, "a shape that does not fill its box only takes the cells it covers");
});

test("the page is one file whose data cannot end its script or inject markup", () => {
  const html = buildChartHtml({
    title: "Sales <b>by</b> region",
    subtitle: "s.csv",
    width: 10,
    height: 10,
    image: "data:image/png;base64,AAAA",
    theme: "dark",
    background: "#0b0f17",
    regions: [{ x: 0, y: 0, w: 5, h: 5, lines: ["</script><script>alert(1)</script>"] }],
    map: { cell: 2, cols: 5, rows: 5, runs: [1, 25] },
    details: [],
  });
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.match(html, /<title>Sales &lt;b&gt;by&lt;\/b&gt; region<\/title>/);
  assert.equal(html.match(/<\/script>/g)?.length, 2, "only the page's own two script blocks close");
  assert.ok(!/https?:\/\//.test(html), "nothing is fetched from the internet");
});
