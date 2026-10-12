import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  clearDismissedClusters,
  clusterSignature,
  dismissCluster,
  dismissedClusterCount,
  isClusterDismissed,
} from "../src/ui/similar-dismissals.js";
import type { SimilarCluster } from "../src/search/similar.js";

test("dismissed clusters are remembered and counted per column", () => {
  const window = new Window();
  (globalThis as Record<string, unknown>).sessionStorage = window.sessionStorage;
  clearDismissedClusters();
  const cluster: SimilarCluster = {
    values: [
      { value: "Widget B", count: 2 },
      { value: "Widget A", count: 5 },
    ],
    suggested: "Widget A",
  };
  assert.equal(isClusterDismissed("product", cluster), false);
  dismissCluster("product", cluster);
  assert.equal(isClusterDismissed("product", cluster), true);
  assert.equal(dismissedClusterCount("product"), 1);
  assert.equal(dismissedClusterCount("region"), 0);
  clearDismissedClusters();
  assert.equal(dismissedClusterCount("product"), 0);
});

test("cluster identity ignores member order", () => {
  const a: SimilarCluster = {
    values: [
      { value: "x", count: 1 },
      { value: "y", count: 1 },
    ],
    suggested: "x",
  };
  const b: SimilarCluster = {
    values: [
      { value: "y", count: 1 },
      { value: "x", count: 1 },
    ],
    suggested: "y",
  };
  assert.equal(clusterSignature(a), clusterSignature(b));
});
