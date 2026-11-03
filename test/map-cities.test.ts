import assert from "node:assert/strict";
import test from "node:test";
import { cityOverlay } from "../src/ui/map-cities.js";

test("city names can be limited to some of the cities, and bigger ones are not lost to smaller ones outside", () => {
  Object.assign(globalThis, {
    document: { documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => "#000000" }),
  });
  const written: string[] = [];
  const ctx = new Proxy(
    {
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: (text: string) => written.push(text),
      strokeText: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
    } as Record<string, unknown>,
    { set: () => true },
  ) as unknown as CanvasRenderingContext2D;
  const cities = { names: ["Inside", "Outside", "Also inside"], lon: Float64Array.of(10, 20, 30), lat: Float64Array.of(10, 20, 30) } as never;
  const view = { lonMin: 0, lonMax: 40, latMin: 0, latMax: 40 };
  const plot = { x: 0, y: 0, w: 800, h: 800, ui: 1 };
  cityOverlay(cities)(ctx, view, plot);
  assert.deepEqual(written, ["Inside", "Outside", "Also inside"]);
  written.length = 0;
  cityOverlay(cities, () => [], () => 11, () => (index) => index !== 1)(ctx, view, plot);
  assert.deepEqual(written, ["Inside", "Also inside"]);
  written.length = 0;
  cityOverlay(cities, () => [], () => 11, () => null)(ctx, view, plot);
  assert.equal(written.length, 3, "no limit, no filtering");
});
