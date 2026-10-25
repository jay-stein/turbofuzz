import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createForceLayout,
  reheat,
  stepForceLayout,
  type ForceOptions,
} from "../src/data/force-layout.js";

const OPTIONS: ForceOptions = { width: 760, height: 380, margin: 30, floor: 0.02 };
const seeded = (): (() => number) => {
  let state = 7;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

test("nodes stay inside the canvas margins and never become NaN", () => {
  const layout = createForceLayout(
    [0, 1, 2, 3, 4, 5],
    [
      { a: 0, b: 1, strength: 0.9 },
      { a: 1, b: 2, strength: 0.4 },
      { a: 3, b: 4, strength: 0.7 },
    ],
    OPTIONS,
  );
  const random = seeded();
  for (let i = 0; i < 400; i++) stepForceLayout(layout, OPTIONS, random);
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x >= 30 && node.x <= 730 && node.y >= 30 && node.y <= 350);
  }
});

test("strongly linked columns settle closer than unlinked ones", () => {
  const layout = createForceLayout(
    [0, 1, 2],
    [{ a: 0, b: 1, strength: 1 }],
    OPTIONS,
  );
  const random = seeded();
  for (let i = 0; i < 600; i++) stepForceLayout(layout, OPTIONS, random);
  const [a, b, c] = layout.nodes;
  const linked = Math.hypot(a!.x - b!.x, a!.y - b!.y);
  const unlinked = Math.hypot(a!.x - c!.x, a!.y - c!.y);
  assert.ok(linked < unlinked, `${linked} should be < ${unlinked}`);
});

test("a pinned node holds still, and reheating restarts the motion", () => {
  const layout = createForceLayout([0, 1], [{ a: 0, b: 1, strength: 0.5 }], OPTIONS);
  const random = seeded();
  for (let i = 0; i < 300; i++) stepForceLayout(layout, OPTIONS, random);
  assert.ok(layout.alpha <= 0.1, "the layout cools toward the floor");
  const pinned = layout.nodes[0]!;
  pinned.fixed = true;
  pinned.x = 100;
  pinned.y = 100;
  reheat(layout, 0.5);
  assert.ok(layout.alpha >= 0.5);
  for (let i = 0; i < 20; i++) stepForceLayout(layout, OPTIONS, random);
  assert.equal(pinned.x, 100);
  assert.equal(pinned.y, 100);
});

test("positions from a previous layout are reused", () => {
  const layout = createForceLayout([5], [], OPTIONS, new Map([[5, { x: 123, y: 77 }]]));
  assert.equal(layout.nodes[0]!.x, 123);
  assert.equal(layout.nodes[0]!.y, 77);
});
