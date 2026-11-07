import { test } from "node:test";
import assert from "node:assert/strict";
import { scanDrivers } from "../src/data/timeseries/drivers.js";

let seed = 3;
const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
function world(n: number, m: number) {
  const temp = Float64Array.from({ length: n }, (_, t) => 20 + 6 * Math.sin((2 * Math.PI * t) / m) + 8 * rnd() + (t > n * 0.7 && t < n * 0.75 ? 15 : 0));
  const y = Float64Array.from({ length: n }, (_, t) => 100 + 0.1 * t + 10 * Math.sin((2 * Math.PI * t) / m) + 2.5 * (temp[t]! - 20) + 2 * rnd());
  const noise = Float64Array.from({ length: n }, () => 50 + 10 * rnd());
  const copy = Float64Array.from(y, (v) => v * 1.1);
  return { y, temp, noise, copy };
}

test("a column that moves the series is offered with the error it cuts; noise is not, and a copy of the series is named, not offered", () => {
  const n = 240, w = world(n, 12);
  const s = scanDrivers(w.y, n, 12, { temp: w.temp, noise: w.noise, copy: w.copy }, new Set());
  assert.equal(s.hints[0]?.col, "temp");
  assert.ok(s.hints[0]!.cut > 0.2, `cut ${s.hints[0]?.cut}`);
  assert.equal(s.hints[0]!.sign, 1);
  assert.ok(!s.hints.some((h) => h.col === "noise" || h.col === "copy"));
  assert.deepEqual(s.leaked, ["copy"]);
  assert.equal(s.tested, 3);
});

test("with no real driver nothing is offered, and a short history is not judged", () => {
  const n = 240, w = world(n, 12);
  const calm = Float64Array.from({ length: n }, (_, t) => 100 + 10 * Math.sin((2 * Math.PI * t) / 12) + 2 * rnd());
  assert.equal(scanDrivers(calm, n, 12, { noise: w.noise }, new Set()).hints.length, 0);
  assert.equal(scanDrivers(w.y.slice(0, 30), 30, 12, { temp: w.temp.slice(0, 30) }, new Set()).hints.length, 0);
});

test("columns already used as drivers are skipped", () => {
  const n = 240, w = world(n, 12);
  assert.equal(scanDrivers(w.y, n, 12, { temp: w.temp }, new Set(["temp"])).hints.length, 0);
});
