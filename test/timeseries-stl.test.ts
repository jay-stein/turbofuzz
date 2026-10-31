import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mstl, stl } from "../src/data/timeseries/stl.js";

interface Case { name: string; kind: "stl" | "mstl-loose"; y: number[]; m?: number; seasonal_window?: number; robust?: boolean; periods?: number[]; seasonal: number[] | number[][]; trend: number[]; tolerance_sd_fraction?: number }
const cases = (JSON.parse(readFileSync("test/fixtures/stl-reference.json", "utf8")) as { cases: Case[] }).cases;
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i]! - b[i]!)); return d; };

test("STL matches statsmodels (R's stl settings) to rounding on monthly, outlier-robust and weekly series", () => {
  for (const c of cases.filter((k) => k.kind === "stl")) {
    const r = stl(c.y, c.m!, { seasonal: c.seasonal_window!, robust: c.robust });
    assert.ok(maxDiff(r.seasonal, c.seasonal as number[]) < 1e-6, `${c.name} seasonal ${maxDiff(r.seasonal, c.seasonal as number[])}`);
    assert.ok(maxDiff(r.trend, c.trend) < 1e-6, `${c.name} trend ${maxDiff(r.trend, c.trend)}`);
  }
});

test("MSTL agrees with statsmodels' MSTL to within 2% of the series' spread", () => {
  const c = cases.find((k) => k.kind === "mstl-loose")!;
  const r = mstl(c.y, c.periods!);
  const mean = c.y.reduce((a, b) => a + b, 0) / c.y.length, sd = Math.sqrt(c.y.reduce((a, b) => a + (b - mean) ** 2, 0) / c.y.length);
  c.periods!.forEach((_, i) => assert.ok(maxDiff(r.seasonal[i]!, (c.seasonal as number[][])[i]!) < c.tolerance_sd_fraction! * sd, `season ${i}`));
  assert.ok(maxDiff(r.trend, c.trend) < c.tolerance_sd_fraction! * sd);
});

test("components always add back to the series, and a pure season comes out as the season", () => {
  const y = Array.from({ length: 96 }, (_, i) => 10 + 5 * Math.sin((2 * Math.PI * i) / 12));
  const r = stl(y, 12, { seasonal: 7 });
  for (let i = 0; i < y.length; i++) assert.ok(Math.abs(r.seasonal[i]! + r.trend[i]! + r.remainder[i]! - y[i]!) < 1e-9);
  assert.ok(maxDiff(r.trend, new Float64Array(96).fill(10)) < 0.6, "trend is flat");
  const m = mstl(Array.from({ length: 600 }, (_, i) => 100 + 30 * Math.sin((2 * Math.PI * i) / 24) + 10 * Math.sin((2 * Math.PI * i) / 168)), [168, 24]);
  assert.deepEqual(m.periods, [24, 168], "periods are taken shortest first");
  for (let i = 0; i < 600; i += 37) assert.ok(Math.abs(m.seasonal[0]![i]! + m.seasonal[1]![i]! + m.trend[i]! + m.remainder[i]! - (100 + 30 * Math.sin((2 * Math.PI * i) / 24) + 10 * Math.sin((2 * Math.PI * i) / 168))) < 1e-9);
});

test("a robust fit shrugs off an outlier that a plain fit smears into the season", () => {
  const y = Array.from({ length: 120 }, (_, i) => 100 + 20 * Math.sin((2 * Math.PI * i) / 12));
  const noisy = [...y]; noisy[60] += 300;
  const plain = stl(noisy, 12, { seasonal: 7 }), robust = stl(noisy, 12, { seasonal: 7, robust: true });
  const truth = stl(y, 12, { seasonal: 7 });
  assert.ok(maxDiff(robust.seasonal, truth.seasonal) < maxDiff(plain.seasonal, truth.seasonal) / 3);
});
