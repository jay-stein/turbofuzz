// Real-world regression corpus: every folder under test/fixtures/real-world is
// run through the app's own ingest, profiling and scoring (no browser, no network)
// and checked against its expect.json. Add datasets with scripts/corpus-add.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { matchesFlag, profileBuffer, raisedFlags, type Flag } from "../scripts/lib/profile.js";

interface Expect {
  hasHeaders?: boolean;
  rows?: number;
  columns?: number;
  band?: { min: number; max: number };
  types?: Record<string, string>;
  must_flag: Flag[];
  /** column "*" means any column. */
  must_not_flag: Flag[];
  /** Documented wrong flags we know about; informational, not asserted. */
  known_gaps?: unknown[];
}

const root = join("test", "fixtures", "real-world");
const folders = existsSync(root)
  ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "data.csv")))
  : [];

// The data files are local only (see .gitignore); a fresh checkout has none, so skip.
test("the corpus is not empty", { skip: folders.length === 0 && "no local corpus data (data.csv files are not in git)" }, () => {
  assert.ok(folders.length >= 5, `expected real-world fixtures in ${root}`);
});

for (const folder of folders) {
  test(`real-world: ${folder.name}`, async () => {
    const dir = join(root, folder.name);
    const expect = JSON.parse(readFileSync(join(dir, "expect.json"), "utf8")) as Expect;
    const file = readFileSync(join(dir, "data.csv"));
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    const profile = await profileBuffer("data.csv", buffer, { hasHeaders: expect.hasHeaders ?? true });
    const raised = raisedFlags(profile);

    if (expect.rows !== undefined) assert.equal(profile.dataset.rowCount, expect.rows, "row count");
    if (expect.columns !== undefined) assert.equal(profile.metas.length, expect.columns, "column count");
    if (expect.band !== undefined) {
      const overall = profile.score.overall ?? 0;
      assert.ok(
        overall >= expect.band.min && overall <= expect.band.max,
        `score ${overall.toFixed(1)} outside ${expect.band.min}-${expect.band.max}`,
      );
    }
    for (const [name, type] of Object.entries(expect.types ?? {})) {
      const meta = profile.metas.find((m) => m.name === name);
      assert.equal(meta?.type, type, `type of “${name}”`);
    }
    for (const flag of expect.must_flag) {
      assert.ok(
        matchesFlag(raised, flag),
        `missing flag ${JSON.stringify(flag)}; raised: ${JSON.stringify(raised)}`,
      );
    }
    for (const flag of expect.must_not_flag) {
      const wrong = raised.filter(
        (r) => r.kind === flag.kind && (flag.column === "*" || r.column === flag.column) &&
          (flag.value === undefined || r.value === flag.value) &&
          (flag.confidence === undefined || r.confidence === flag.confidence),
      );
      assert.deepEqual(wrong, [], `unexpected ${flag.kind} flag on ${flag.column}`);
    }
  });
}
