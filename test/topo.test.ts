import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeArcs,
  decodeCountries,
  decodeLand,
  projectLat,
  projectLon,
} from "../src/data/topo.js";
import { WORLD_110M } from "../src/data/world-110m.js";

function bbox(rings: readonly Float64Array[]): {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
} {
  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const lon = ring[i] ?? 0;
      const lat = ring[i + 1] ?? 0;
      lonMin = Math.min(lonMin, lon);
      lonMax = Math.max(lonMax, lon);
      latMin = Math.min(latMin, lat);
      latMax = Math.max(latMax, lat);
    }
  }
  return { lonMin, lonMax, latMin, latMax };
}

test("the 110m basemap decodes countries and land", () => {
  const started = performance.now();
  const arcs = decodeArcs(WORLD_110M);
  const countries = decodeCountries(WORLD_110M, arcs);
  const land = decodeLand(WORLD_110M, arcs);
  const decodeMs = performance.now() - started;

  assert.equal(arcs.length, WORLD_110M.arcs.length);
  assert.ok(countries.length >= 150, `found ${countries.length} countries`);
  assert.ok(land.length >= 100, `found ${land.length} land rings`);
  assert.ok(
    countries.every((country) => country.rings.length > 0),
    "every country has at least one ring",
  );
  assert.ok(decodeMs < 500, `decode took ${decodeMs.toFixed(1)} ms`);

  const australia = countries.find((country) => country.name === "Australia");
  assert.ok(australia !== undefined, "Australia is named");
  const box = bbox(australia.rings);
  assert.ok(box.lonMin >= 110 && box.lonMax <= 156, `lon ${box.lonMin}..${box.lonMax}`);
  assert.ok(box.latMin >= -45 && box.latMax <= -9, `lat ${box.latMin}..${box.latMax}`);
});

test("quantized arcs decode to absolute degrees", () => {
  const arcs = decodeArcs(WORLD_110M);
  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;
  for (const arc of arcs) {
    for (let i = 0; i < arc.length; i += 2) {
      lonMin = Math.min(lonMin, arc[i] ?? 0);
      lonMax = Math.max(lonMax, arc[i] ?? 0);
      latMin = Math.min(latMin, arc[i + 1] ?? 0);
      latMax = Math.max(latMax, arc[i + 1] ?? 0);
    }
  }
  assert.ok(lonMin >= -180.1 && lonMax <= 180.1, `lon ${lonMin}..${lonMax}`);
  assert.ok(latMin >= -90.1 && latMax <= 90.1, `lat ${latMin}..${latMax}`);
  assert.ok(lonMax - lonMin > 300, "the map wraps the world");
});

test("equirectangular projection maps the world onto the unit square", () => {
  assert.equal(projectLon(-180), 0);
  assert.equal(projectLon(180), 1);
  assert.equal(projectLon(0), 0.5);
  assert.equal(projectLat(90), 0);
  assert.equal(projectLat(-90), 1);
  assert.equal(projectLat(0), 0.5);
});
