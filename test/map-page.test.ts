import { test } from "node:test";
import assert from "node:assert/strict";
import { autoLabel, markersToCsv, MAX_MARKER_SIZE, MAX_MARKERS, parseMarkers } from "../src/data/map-markers.js";

const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("markers read from pasted cells with a header, in any column order", () => {
  const r = parseMarkers("Name\tLongitude\tLatitude\tColour\nLondon\t-0.1276\t51.5072\tblue\nNowhere\tabc\t\n", { symbol: "pin", color: "#dc2626" });
  assert.equal(r.markers.length, 1);
  assert.deepEqual(r.markers[0], { label: "London", lat: 51.5072, lon: -0.1276, symbol: "pin", color: "#2563eb", size: 7 });
  assert.equal(r.skipped.length, 1);
});

test("a size column sets each marker's size, clamped; the default size fills the rest", () => {
  const r = parseMarkers("label,lat,lon,size\nA,10,20,12\nB,11,21,99px\nC,12,22,\n", { symbol: "pin", color: "#dc2626", size: 9 });
  assert.deepEqual(r.markers.map((m) => m.size), [12, MAX_MARKER_SIZE, 9]);
  const back = parseMarkers(markersToCsv(r.markers), { symbol: "pin", color: "#dc2626" });
  assert.deepEqual(back.markers.map((m) => m.size), [12, MAX_MARKER_SIZE, 9]);
});

test("bare latitude, longitude rows under a label header still read, and get Marker N labels", () => {
  const r = parseMarkers("label,lat,lon\nHobart,-42.88,147.33\n-12.46,130.84\n-34.93;138.60\n", { symbol: "pin", color: "#dc2626" });
  // The semicolon line reads too: each line may use its own separator.
  assert.deepEqual(r.markers.map((m) => [m.label, m.lat, m.lon]), [["Hobart", -42.88, 147.33], ["", -12.46, 130.84], ["", -34.93, 138.6]]);
  assert.equal(r.skipped.length, 0);
  // Numbering carries on from the markers already on the map.
  assert.deepEqual(autoLabel(r.markers, 3).map((m) => m.label), ["Hobart", "Marker 5", "Marker 6"]);
});

test("markers read without a header, including degrees and minutes", () => {
  const r = parseMarkers(`Sydney,33°52'S,151°12'E,star,#00aa00\n"Paris, FR",48.8566,2.3522`, { symbol: "pin", color: "#dc2626" });
  assert.equal(r.markers.length, 2);
  near(r.markers[0]!.lat, -(33 + 52 / 60)); near(r.markers[0]!.lon, 151.2);
  assert.equal(r.markers[0]!.symbol, "star");
  assert.equal(r.markers[0]!.color, "#00aa00");
  assert.equal(r.markers[1]!.label, "Paris, FR");
});

test("markers stop at the limit and round-trip through CSV", () => {
  const lines = Array.from({ length: MAX_MARKERS + 5 }, (_, i) => `p${i},${(i % 80) - 40},${i - 50}`).join("\n");
  const r = parseMarkers(lines, { symbol: "dot", color: "#111111" });
  assert.equal(r.markers.length, MAX_MARKERS);
  assert.equal(r.over, 5);
  const back = parseMarkers(markersToCsv(r.markers.slice(0, 3)), { symbol: "pin", color: "#000000" });
  assert.deepEqual(back.markers, r.markers.slice(0, 3));
});

test("the bundled cities decode small and search by name, largest first", async () => {
  const { CITY_NAMES, CITY_COORDS } = await import("../src/data/reference/world-cities.js");
  const { decodeCities, findCity, searchCities } = await import("../src/data/cities.js");
  const c = decodeCities(CITY_NAMES, CITY_COORDS);
  assert.ok(c.names.length > 7000);
  assert.equal(c.lat.length, c.names.length);
  const london = findCity(c, "london");
  assert.ok(london);
  near(london.lat, 51.5, 0.1); near(london.lon, -0.12, 0.1);
  // Accents do not matter, and the bigger city comes first.
  assert.equal(searchCities(c, "sao pa", 3)[0]?.name, "São Paulo");
  assert.equal(searchCities(c, "Paris", 1)[0]?.name, "Paris");
  near(searchCities(c, "Paris", 1)[0]!.lon, 2.35, 0.05);
});

test("a list of city names becomes markers", async () => {
  const { CITY_NAMES, CITY_COORDS } = await import("../src/data/reference/world-cities.js");
  const { decodeCities, findCity } = await import("../src/data/cities.js");
  const c = decodeCities(CITY_NAMES, CITY_COORDS);
  const r = parseMarkers("city\nTokyo\nNairobi\nAtlantis", { symbol: "pin", color: "#dc2626" }, MAX_MARKERS, [], (n) => findCity(c, n));
  assert.deepEqual(r.markers.map((m) => m.label), ["Tokyo", "Nairobi"]);
  assert.equal(r.skipped.length, 1);
});

test("rows pasted as space-separated columns are understood, with or without a header", () => {
  const style = { symbol: "pin" as const, color: "#dc2626" };
  const pasted = "label    lat    long\npony    -33    151\nunicorn    -40    121\nrandom    -42    110.5";
  const a = parseMarkers(pasted, style);
  assert.deepEqual(a.markers.map((m) => [m.label, m.lat, m.lon]), [["pony", -33, 151], ["unicorn", -40, 121], ["random", -42, 110.5]]);
  assert.equal(a.skipped.length, 0);
  // Tabs and commas still work, and a label of several words survives.
  const b = parseMarkers("label\tlat\tlon\nOpera House\t-33.85\t151.21", style);
  assert.equal(b.markers[0]!.label, "Opera House");
  const c = parseMarkers("Sydney Opera House -33.85 151.21\nAuckland -36.85 174.76", style);
  assert.deepEqual(c.markers.map((m) => [m.label, m.lat, m.lon]), [["Sydney Opera House", -33.85, 151.21], ["Auckland", -36.85, 174.76]]);
  const d = parseMarkers("name lat lon\nSydney Opera House -33.85 151.21", style);
  assert.equal(d.markers[0]!.label, "Sydney Opera House");
  assert.equal(d.markers[0]!.lat, -33.85);
});
