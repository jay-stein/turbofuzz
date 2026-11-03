import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeoFile } from "../src/data/geo-file.js";

function bufferOf(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test("parses GeoJSON polygons and computes bounds", async () => {
  const dataset = await parseGeoFile(
    bufferOf({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Alpha" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [140, -38],
                [146, -38],
                [146, -32],
                [140, -32],
                [140, -38],
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: { NAME: "Beta" },
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [150, -30],
                  [151, -30],
                  [151, -29],
                  [150, -30],
                ],
              ],
            ],
          },
        },
      ],
    }),
    "regions.geojson",
  );
  assert.equal(dataset.features.length, 2);
  assert.equal(dataset.features[0]?.label, "Alpha");
  assert.equal(dataset.features[1]?.label, "Beta");
  assert.deepEqual(dataset.bounds, { lonMin: 140, lonMax: 151, latMin: -38, latMax: -29 });
  assert.equal(dataset.features[0]?.rings[0]?.length, 10);
});

const square = (x: number, y: number, size: number): number[][][] => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]];
const collection = (coordinates: number[][][], crs?: string): object => ({
  type: "FeatureCollection",
  ...(crs === undefined ? {} : { crs: { type: "name", properties: { name: crs } } }),
  features: [{ type: "Feature", properties: { NAME: "A" }, geometry: { type: "Polygon", coordinates } }],
});

test("a file states its system: lat/long ones are used as they are, projected ones are worked out", async () => {
  const gda = await parseGeoFile(bufferOf(collection(square(140, -38, 1), "urn:ogc:def:crs:EPSG::7844")), "a.geojson");
  assert.equal(gda.crs.source, "file");
  assert.equal(gda.crs.converted, false);
  assert.match(gda.crs.label, /GDA2020/);
  assert.equal(gda.bounds.lonMin, 140);
  // Web Mercator: 0, 0 is at the equator on the prime meridian, and x = 111319.49 m is one degree of longitude.
  const merc = await parseGeoFile(bufferOf(collection(square(0, 0, 111319.49), "EPSG:3857")), "b.geojson");
  assert.equal(merc.crs.converted, true);
  assert.ok(Math.abs(merc.bounds.lonMax - 1) < 1e-4, String(merc.bounds.lonMax));
  assert.ok(Math.abs(merc.bounds.latMax - 0.99997) < 1e-3, String(merc.bounds.latMax));
});

test("published control point: British National Grid, Caister water tower, with the datum shift", async () => {
  // Ordnance Survey's worked example: E 651409.903, N 313177.270. On the grid's own datum that is 52.65757N, 1.71792E;
  // in WGS 84, which everything else here is, about 52.6580N, 1.7161E, some 100 metres away.
  const geo = await parseGeoFile(bufferOf(collection(square(651409.903, 313177.27, 1), "EPSG:27700")), "bng.geojson");
  assert.ok(Math.abs(geo.bounds.latMin - 52.658) < 2e-4, String(geo.bounds.latMin));
  assert.ok(Math.abs(geo.bounds.lonMin - 1.7161) < 2e-4, String(geo.bounds.lonMin));
});

test("with nothing stated, degrees are taken as degrees, and anything else asks", async () => {
  const plain = await parseGeoFile(bufferOf(collection(square(103, 1, 1))), "c.geojson");
  assert.equal(plain.crs.source, "assumed");
  await assert.rejects(parseGeoFile(bufferOf(collection(square(300000, 5800000, 100))), "d.geojson"), (error: Error) => {
    assert.equal(error.name, "GeoCrsNeededError");
    assert.match(error.message, /Choose the coordinate system/);
    return true;
  });
});

test("the person can override: by code, by proj4 string, and over what the file says", async () => {
  const utm = await parseGeoFile(bufferOf(collection(square(500000, 5800000, 100))), "e.geojson", { crs: "EPSG:28355" });
  assert.equal(utm.crs.source, "user");
  assert.ok(Math.abs(utm.bounds.lonMin - 147) < 1e-6, "the zone's central meridian");
  const string = await parseGeoFile(bufferOf(collection(square(500000, 5800000, 100))), "f.geojson", { crs: "+proj=utm +zone=55 +south +ellps=GRS80 +units=m +no_defs" });
  assert.ok(Math.abs(string.bounds.lonMin - 147) < 1e-6);
  const over = await parseGeoFile(bufferOf(collection(square(0, 0, 111319.49), "EPSG:7844")), "g.geojson", { crs: "EPSG:3857" });
  assert.equal(over.crs.source, "user");
  await assert.rejects(parseGeoFile(bufferOf(collection(square(0, 0, 1))), "h.geojson", { crs: "EPSG:99999" }), /not in this offline list. Search by place or name/);
});

test("a statement that lands outside the Earth asks rather than draws", async () => {
  await assert.rejects(parseGeoFile(bufferOf(collection(square(300000, 5800000, 100), "EPSG:4326")), "i.geojson"), (error: Error) => error.name === "GeoCrsNeededError");
});

/** A stored (uncompressed) zip. */
function zipOf(files: Record<string, Uint8Array>): ArrayBuffer {
  const crc = (bytes: Uint8Array): number => {
    let value = ~0;
    for (const byte of bytes) {
      value ^= byte;
      for (let k = 0; k < 8; k++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    return ~value >>> 0;
  };
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const names = new TextEncoder();
  for (const [name, data] of Object.entries(files)) {
    const encoded = names.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc(data), true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, encoded.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(16, crc(data), true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, encoded.length, true);
    entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), encoded, data);
    central.push(new Uint8Array(entry.buffer), encoded);
    offset += 30 + encoded.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

/** Squares as a polygon shapefile. */
function shp(squares: [number, number, number][]): Uint8Array {
  const recordSize = 8 + 44 + 4 + 5 * 16;
  const view = new DataView(new ArrayBuffer(100 + squares.length * recordSize));
  view.setInt32(0, 9994);
  view.setInt32(24, view.byteLength / 2);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true);
  squares.forEach(([x, y, size], index) => {
    const at = 100 + index * recordSize;
    view.setInt32(at, index + 1);
    view.setInt32(at + 4, (recordSize - 8) / 2);
    view.setInt32(at + 8, 5, true);
    [x, y, x + size, y + size].forEach((value, k) => view.setFloat64(at + 12 + k * 8, value, true));
    view.setInt32(at + 44, 1, true);
    view.setInt32(at + 48, 5, true);
    view.setInt32(at + 52, 0, true);
    [[x, y], [x, y + size], [x + size, y + size], [x + size, y], [x, y]].forEach(([px, py], k) => {
      view.setFloat64(at + 56 + k * 16, px!, true);
      view.setFloat64(at + 64 + k * 16, py!, true);
    });
  });
  return new Uint8Array(view.buffer);
}

/** A dBase table with one text field, NAME. */
function dbf(names: string[]): Uint8Array {
  const width = 20;
  const header = 32 + 32 + 1;
  const view = new DataView(new ArrayBuffer(header + names.length * (width + 1) + 1));
  const bytes = new Uint8Array(view.buffer);
  view.setUint8(0, 3);
  view.setUint32(4, names.length, true);
  view.setUint16(8, header, true);
  view.setUint16(10, width + 1, true);
  bytes.set(new TextEncoder().encode("NAME"), 32);
  view.setUint8(32 + 11, 67);
  view.setUint8(32 + 16, width);
  view.setUint8(32 + 32, 13);
  names.forEach((name, index) => {
    const at = header + index * (width + 1);
    bytes[at] = 32;
    bytes.set(new TextEncoder().encode(name.padEnd(width)), at + 1);
  });
  bytes[bytes.length - 1] = 26;
  return bytes;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

test("a zip with several shapefiles: the most detailed is read, and the others can be chosen", async () => {
  // As a real download has it: a country and its counties side by side.
  const zip = zipOf({
    "IRL_adm0.shp": shp([[-10, 51, 4]]),
    "IRL_adm0.dbf": dbf(["Ireland"]),
    "IRL_adm0.prj": text(WGS84),
    "IRL_adm1.shp": shp([[-10, 51, 2], [-8, 51, 2]]),
    "IRL_adm1.dbf": dbf(["Kerry", "Cork"]),
    "IRL_adm1.prj": text(WGS84),
  });
  const counties = await parseGeoFile(zip, "IRL_adm.zip");
  assert.equal(counties.layer, "IRL_adm1");
  assert.deepEqual(counties.layers, [{ name: "IRL_adm0", features: 1 }, { name: "IRL_adm1", features: 2 }]);
  assert.deepEqual(counties.features.map((feature) => feature.properties.NAME), ["Kerry", "Cork"]);
  assert.equal(counties.crs.source, "file");
  assert.equal(counties.crs.converted, false);
  const country = await parseGeoFile(zip, "IRL_adm.zip", { layer: "IRL_adm0" });
  assert.equal(country.features.length, 1);
});

test("a shapefile in a projected system is worked out from its .prj; with none, it asks", async () => {
  const lcc = 'PROJCS["NAD_1983_StatePlane_New_York_Long_Island_FIPS_3104_Feet",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",984250.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-74.0],PARAMETER["Standard_Parallel_1",40.66666666666666],PARAMETER["Standard_Parallel_2",41.03333333333333],PARAMETER["Latitude_Of_Origin",40.16666666666666],UNIT["Foot_US",0.3048006096012192]]';
  // Near Manhattan on that grid, in feet.
  const feet: [number, number, number][] = [[987000, 210000, 5000]];
  const stated = await parseGeoFile(zipOf({ "a.shp": shp(feet), "a.dbf": dbf(["A"]), "a.prj": text(lcc) }), "a.zip");
  assert.equal(stated.crs.converted, true);
  assert.ok(stated.bounds.lonMin > -74.1 && stated.bounds.lonMax < -73.9, String(stated.bounds.lonMin));
  assert.ok(stated.bounds.latMin > 40.7 && stated.bounds.latMax < 40.8, String(stated.bounds.latMin));
  const silent = zipOf({ "a.shp": shp(feet), "a.dbf": dbf(["A"]) });
  await assert.rejects(parseGeoFile(silent, "a.zip"), (error: Error) => error.name === "GeoCrsNeededError");
  const told = await parseGeoFile(silent, "a.zip", { crs: "EPSG:2263" });
  assert.ok(Math.abs(told.bounds.lonMin - stated.bounds.lonMin) < 1e-4, "the table's definition agrees with the file's own");
  assert.ok(Math.abs(told.bounds.latMin - stated.bounds.latMin) < 1e-4);
  assert.equal(told.crs.source, "user");
});

test("a GeoPackage says what to do instead", async () => {
  await assert.rejects(parseGeoFile(new ArrayBuffer(8), "x.gpkg"), /GeoPackage/);
  await assert.rejects(parseGeoFile(zipOf({ "x.gpkg": text("x") }), "x.zip"), /GeoPackage/);
});

test("a height or depth system says it cannot place a map, however it is given", async () => {
  const depth = 'VERT_CS["CD UK & Ireland VORF08 depth",VERT_DATUM["Chart Datum UK & Ireland VORF08",2005,AUTHORITY["EPSG","1331"]],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Depth",DOWN],AUTHORITY["EPSG","10151"]]';
  await assert.rejects(parseGeoFile(bufferOf(collection(square(-8, 52, 1))), "h.geojson", { crs: depth }), /height or depth, not a position on the map/);
  await assert.rejects(parseGeoFile(bufferOf(collection(square(-8, 52, 1))), "h.geojson", { crs: "EPSG:10151" }), /height or depth system/);
});

test("the list of systems can be searched by place, name or code, and guesses fit the file", async () => {
  const { guessCrs, resolveCrs, searchCrs, toLonLat } = await import("../src/data/geo-crs.js");
  assert.deepEqual(searchCrs("ireland").map((choice) => choice.code).sort((a, b) => a - b), [2157, 29902]);
  assert.ok(searchCrs("utm 55").some((choice) => choice.code === 32755));
  assert.equal(searchCrs("7844")[0]!.code, 7844);
  assert.ok(searchCrs("").length > 20);
  // Metres on the Irish Transverse Mercator grid, around Dublin: E 715000, N 734000.
  const guesses = guessCrs({ xMin: 700000, xMax: 730000, yMin: 720000, yMax: 750000 }).map((choice) => choice.code);
  assert.ok(guesses.includes(2157), String(guesses));
  // Every system on the list, zones included, is something proj4 can read and run.
  for (const { code } of searchCrs("utm").concat(searchCrs(""))) {
    const crs = resolveCrs(`EPSG:${code}`);
    assert.ok(crs !== null, String(code));
    const point = Float64Array.of(500000, 500000);
    if (!crs.geographic) toLonLat(crs)(point);
    assert.ok(Number.isFinite(point[0]!) && Number.isFinite(point[1]!), String(code));
  }
});

