import { test } from "node:test";
import assert from "node:assert/strict";
import { backgroundOps, mercY, parseWorldFile, placementProblem, WHOLE_WORLD } from "../src/data/map-background.js";
import { autoLabel, markersToCsv, MAX_MARKER_SIZE, MAX_MARKERS, parseMarkers } from "../src/data/map-markers.js";

const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("a world file in degrees places a plate carree picture", () => {
  // 0.1 degree pixels, top-left pixel centre at (-9.95, 59.95), 200 x 100 pixels.
  const p = parseWorldFile("0.1\n0\n0\n-0.1\n-9.95\n59.95\n", 200, 100);
  assert.ok(!("error" in p));
  assert.equal(p.projection, "plate");
  near(p.west, -10); near(p.east, 10); near(p.north, 60); near(p.south, 50);
});

test("a world file in metres is Web Mercator, converted to degrees", () => {
  const R = 6378137, x = (lon: number): number => (lon * Math.PI * R) / 180, y = (lat: number): number => mercY(lat) * R;
  const w = 512, h = 512, px = (x(10) - x(0)) / w, py = (y(50) - y(55)) / h;
  const text = [px, 0, 0, py, x(0) + px / 2, y(55) + py / 2].join("\n");
  const p = parseWorldFile(text, w, h);
  assert.ok(!("error" in p));
  assert.equal(p.projection, "mercator");
  near(p.west, 0, 1e-6); near(p.east, 10, 1e-6); near(p.north, 55, 1e-6); near(p.south, 50, 1e-6);
});

test("rotated or malformed world files are refused with a reason", () => {
  assert.ok("error" in parseWorldFile("0.1\n0.01\n0\n-0.1\n0\n0", 10, 10));
  assert.ok("error" in parseWorldFile("not a world file", 10, 10));
  assert.match(placementProblem({ ...WHOLE_WORLD, west: 20, east: 10 }) ?? "", /West must be less than east/);
});

test("a plate carree picture is cropped to the visible window", () => {
  const ops = backgroundOps(WHOLE_WORLD, 3600, 1800, { lonMin: 0, lonMax: 90, latMin: 0, latMax: 45 }, 0, 0, 900, 450);
  assert.equal(ops.length, 1);
  const [o] = ops;
  near(o!.sx, 1800); near(o!.sw, 900); near(o!.sy, 450); near(o!.sh, 450);
  near(o!.dx, 0); near(o!.dw, 900); near(o!.dy, 0); near(o!.dh, 450);
});

test("a mercator picture is drawn in strips that follow latitude", () => {
  const p = { west: -180, east: 180, south: -60, north: 60, projection: "mercator" as const };
  const ops = backgroundOps(p, 1000, 1000, { lonMin: -180, lonMax: 180, latMin: -60, latMax: 60 }, 0, 0, 720, 240, 24);
  assert.equal(ops.length, 24);
  // Rows near the poles cover more picture per screen pixel than rows at the equator.
  const first = ops[0]!, middle = ops[12]!;
  assert.ok(first.sh / first.dh > middle.sh / middle.dh);
  near(ops[0]!.sy, 0); near(ops[23]!.sy + ops[23]!.sh, 1000, 1e-6);
});

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
