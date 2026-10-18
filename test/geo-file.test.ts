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

test("rejects GeoJSON with a non-WGS84 CRS", async () => {
  await assert.rejects(
    parseGeoFile(
      bufferOf({
        type: "FeatureCollection",
        crs: { type: "name", properties: { name: "EPSG:3857" } },
        features: [],
      }),
      "projected.geojson",
    ),
    /EPSG:4326|WGS84/,
  );
});
