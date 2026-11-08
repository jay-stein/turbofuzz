import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { MemoryMonitor, estimatedBytes, memoryGauge, usedBytes } from "../src/ui/memory-gauge.js";
import type { SearchWorkerClient } from "../src/ui/worker-client.js";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

function setup(measure?: () => Promise<{ bytes: number }>): void {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  Object.defineProperty(globalThis, "navigator", { value: { deviceMemory: 8 }, configurable: true });
  Object.defineProperty(globalThis, "crossOriginIsolated", { value: measure !== undefined, configurable: true });
  const perf = globalThis.performance as unknown as Record<string, unknown>;
  perf.memory = { jsHeapSizeLimit: 4 * GB };
  perf.measureUserAgentSpecificMemory = measure;
}

function client(data: number, compare = 0, undo = 0, caches = 0): SearchWorkerClient {
  return { memory: async () => ({ type: "memory", requestId: 0, dataBytes: data, undoBytes: undo, cacheBytes: caches, compareBytes: compare }) } as unknown as SearchWorkerClient;
}

test("the gauge stays hidden with no data, then shows the figure, its share and its tone", async () => {
  setup();
  const monitor = new MemoryMonitor(client(0));
  const gauge = memoryGauge(monitor);
  assert.ok(gauge.classList.contains("hidden"));
  assert.deepEqual(monitor.state.limit, { bytes: 4 * GB, source: "browser" });

  const busy = new MemoryMonitor(client(3 * GB, 0.5 * GB));
  const full = memoryGauge(busy);
  await busy.refresh();
  assert.equal(usedBytes(busy.state), 3.5 * GB);
  assert.ok(!full.classList.contains("hidden"));
  assert.equal(full.querySelector(".mem-label")?.textContent, "3.5 GB");
  assert.equal(full.dataset.tone, "high");
  assert.equal(full.getAttribute("aria-label"), "Memory: 3.5 GB of about 4.0 GB (88%). Close to the limit.");
  monitor.dispose();
  busy.dispose();
});

test("undo copies and indexes count too, so a transform or a search moves the gauge", async () => {
  setup();
  const monitor = new MemoryMonitor(client(1 * GB, 0, 1 * GB, 0.5 * GB));
  const gauge = memoryGauge(monitor);
  await monitor.refresh();
  assert.equal(estimatedBytes(monitor.state), 2.5 * GB);
  assert.equal(gauge.querySelector(".mem-label")?.textContent, "2.5 GB");
  assert.equal(gauge.dataset.tone, "warn");
  monitor.dispose();
});

test("where the browser measures the tab, that figure is the one in use; where it refuses, the gauge stops asking", async () => {
  setup(async () => ({ bytes: 600 * MB }));
  const measured = new MemoryMonitor(client(400 * MB));
  await measured.refresh();
  assert.equal(measured.state.measured, 600 * MB);
  assert.equal(usedBytes(measured.state), 600 * MB);
  measured.dispose();

  setup(async () => {
    throw new Error("SecurityError");
  });
  const refused = new MemoryMonitor(client(400 * MB));
  assert.equal(refused.canMeasure, true);
  await refused.refresh();
  assert.equal(refused.state.measured, null);
  assert.equal(refused.canMeasure, false, "a refusal is remembered, so the panel says the browser does not say");
  assert.equal(usedBytes(refused.state), 400 * MB);
  refused.dispose();
});
