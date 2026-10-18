import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function filesUnder(path: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

test("the CSP enforces local-only execution and no eval", () => {
  const headers = readFileSync(join(root, "public", "_headers"), "utf8");
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /default-src 'none'/);
  assert.match(headers, /script-src 'self'/);
  assert.doesNotMatch(headers, /unsafe-eval/);
});

test("source does not use eval, new Function or network fetch", () => {
  const sources = filesUnder(join(root, "src"));
  const offenders: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    if (/\beval\s*\(/.test(text) || /\bnew\s+Function\s*\(/.test(text) || /\bfetch\s*\(/.test(text)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});