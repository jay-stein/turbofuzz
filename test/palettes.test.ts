import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_PALETTE,
  DEFAULT_PALETTE,
  isRampPalette,
  PALETTES,
  paletteStops,
  parseCustomColors,
  parsePaletteJson,
  rampAt,
  samplePalette,
} from "../src/data/palettes.js";

test("Set1 is the default and keeps its exact ColorBrewer colours", () => {
  assert.equal(DEFAULT_PALETTE, "Set1");
  const colors = samplePalette("Set1", 4);
  assert.deepEqual(colors, ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3"]);
  const many = samplePalette("Set1", 12);
  assert.equal(many.length, 12);
  assert.equal(many[9], "#e41a1c", "qualitative palettes cycle");
});

test("sequential ramps interpolate between stops", () => {
  const sampled = samplePalette("Blues", 3);
  assert.equal(sampled[0], "#f7fbff");
  assert.equal(sampled[2], "#08306b");
  assert.notEqual(sampled[1], "#f7fbff");
  assert.notEqual(sampled[1], "#08306b");
  const single = samplePalette("Blues", 1);
  assert.equal(single.length, 1);
  assert.equal(isRampPalette("Blues"), true);
  assert.equal(isRampPalette("Set1"), false);
});

test("diverging ramps keep their midpoint light", () => {
  const stops = paletteStops("RdBu");
  const mid = rampAt(stops, 0.5);
  const [r, g, b] = [mid.slice(1, 3), mid.slice(3, 5), mid.slice(5, 7)].map((part) =>
    parseInt(part, 16),
  );
  assert.ok(r > 200 && g > 200 && b > 200, `midpoint should be light, got ${mid}`);
});

test("custom colour maps parse hex lists and reject junk", () => {
  const parsed = parseCustomColors("#2563EB, #10b981; not-a-colour\n#f97316");
  assert.deepEqual(parsed, ["#2563eb", "#10b981", "#f97316"]);
  const sampled = samplePalette(CUSTOM_PALETTE, 5, parsed);
  assert.equal(sampled.length, 5);
  assert.equal(sampled[0], "#2563eb");
  assert.equal(sampled[4], "#f97316");
  // Fewer than two custom stops falls back to the default palette.
  const fallback = samplePalette(CUSTOM_PALETTE, 2, ["#123456"]);
  assert.deepEqual(fallback, ["#e41a1c", "#377eb8"]);
  assert.equal(parseCustomColors("").length, 0);
});

test("every named palette has valid stops", () => {
  for (const palette of PALETTES) {
    assert.ok(palette.colors.length >= 8, `${palette.name} has enough stops`);
    for (const color of palette.colors) {
      assert.match(color, /^#[0-9a-f]{6}$/);
    }
    const sampled = samplePalette(palette.name, 16);
    assert.equal(sampled.length, 16);
    for (const color of sampled) assert.match(color, /^#[0-9a-f]{6}$/);
  }
});

test("seaborn palettes are available", () => {
  const names = PALETTES.map((palette) => palette.name);
  for (const name of [
    "deep",
    "muted",
    "pastel",
    "bright",
    "dark",
    "colorblind",
    "rocket",
    "mako",
    "flare",
    "crest",
    "vlag",
    "icefire",
  ]) {
    assert.ok(names.includes(name), name);
  }
  assert.deepEqual(samplePalette("colorblind", 2), ["#0173b2", "#de8f05"]);
  assert.equal(isRampPalette("rocket"), true);
  assert.equal(isRampPalette("deep"), false);
});

test("parsePaletteJson reads arrays and objects", () => {
  assert.deepEqual(parsePaletteJson('["#abc", "#123456"]'), ["#aabbcc", "#123456"]);
  assert.deepEqual(
    parsePaletteJson('{"name":"mine","colors":["#f00","#00ff00"]}'),
    ["#ff0000", "#00ff00"],
  );
  assert.deepEqual(parsePaletteJson('{"stops":["#000","#fff"]}'), [
    "#000000",
    "#ffffff",
  ]);
  assert.equal(parsePaletteJson('{"colors":["#fff"]}'), null);
  assert.equal(parsePaletteJson("not json"), null);
  assert.equal(parsePaletteJson('{"colors":[1,2]}'), null);
  assert.equal(parsePaletteJson('["#fff","junk"]'), null);
});
