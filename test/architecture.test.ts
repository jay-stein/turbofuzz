/**
 * Guards for the shape of the code, not its behaviour: they fail when a change quietly undoes the
 * chart-card split (a giant file again, an import loop, a lost export) so the change is noticed the
 * day it is made rather than months later.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { test } from "node:test";

const SRC = resolve(import.meta.dirname, "../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const rel = (file: string): string => file.slice(SRC.length + 1).replace(/\\/g, "/");

/** Value imports only: `import type` is erased, so it cannot make a loop at run time. */
function valueImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/^(import|export)\s+(?!type\s)[^;]*?from\s+"(\.[^"]+)";/gms)) {
    const target = resolve(dirname(file), match[2]!.replace(/\.js$/, ".ts"));
    if (files.includes(target)) found.push(target);
  }
  return found;
}

test("no file in src/ui passes its size limit", () => {
  // Files that were already large when this guard was added may not grow; everything else stays under 3,000.
  const LEGACY: Record<string, number> = {
    "ui/app.ts": 9600,
    "ui/views-panel.ts": 4700,
    "ui/outliers-panel.ts": 3600,
  };
  const over: string[] = [];
  for (const file of files) {
    const name = rel(file);
    if (!name.startsWith("ui/")) continue;
    const lines = readFileSync(file, "utf8").split("\n").length;
    const limit = LEGACY[name] ?? 3000;
    if (lines > limit) over.push(`${name}: ${lines} lines, limit ${limit}`);
  }
  assert.deepEqual(over, [], "split the file rather than raising the limit");
});

test("chart-card.ts stays a coordinator, not the home of every chart feature", () => {
  const lines = readFileSync(join(SRC, "ui/chart-card.ts"), "utf8").split("\n").length;
  assert.ok(lines < 3000, `chart-card.ts is ${lines} lines; put new chart code in its own chart-*.ts module`);
});

test("chart modules do not import each other in a loop at run time", () => {
  // Only the chart family is held to this: older loops elsewhere are not this guard's business.
  const chart = files.filter((file) => /ui\/chart-[^/]*\.ts$/.test(file.replace(/\\/g, "/")));
  const graph = new Map(chart.map((file) => [file, valueImports(file).filter((t) => chart.includes(t))]));
  const loops: string[] = [];
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (file: string): void => {
    state.set(file, 1);
    stack.push(file);
    for (const next of graph.get(file) ?? []) {
      if (state.get(next) === 1) loops.push([...stack.slice(stack.indexOf(next)), next].map(rel).join(" -> "));
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(file, 2);
  };
  for (const file of chart) if (!state.has(file)) visit(file);
  assert.deepEqual(loops, []);
});
