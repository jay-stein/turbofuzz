import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterSimilar } from "../src/search/similar.js";

test("clusters the Fremantle spelling variants", () => {
  const clusters = clusterSimilar([
    { value: "Fremantel", count: 48 },
    { value: "Fremantle", count: 48 },
    { value: "Freemantle", count: 59 },
    { value: "Perth", count: 100 },
    { value: "Joondalup", count: 60 },
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].suggested, "Freemantle");
  assert.deepEqual(
    clusters[0].values.map((entry) => entry.value),
    ["Freemantle", "Fremantel", "Fremantle"],
  );
});

test("threshold controls cluster tightness", () => {
  const values = [
    { value: "Sydney", count: 10 },
    { value: "Sidney", count: 2 },
  ];
  assert.equal(clusterSimilar(values, 0.9).length, 1);
  assert.equal(clusterSimilar(values, 0.95).length, 0);
});

test("case and padding fold before matching", () => {
  const clusters = clusterSimilar([
    { value: "Perth", count: 10 },
    { value: " PERTH ", count: 4 },
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].suggested, "Perth");
  assert.equal(clusters[0].values[1].value, " PERTH ");
});

test("unrelated values stay in separate clusters or none at all", () => {
  assert.deepEqual(
    clusterSimilar([
      { value: "Alice", count: 5 },
      { value: "Bob", count: 5 },
    ]),
    [],
  );
});
