import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  HASH_LIMIT_BYTES,
  buildProvenance,
  fingerprintBytes,
  provenanceRows,
  sha256Hex,
  sizeText,
  type ProvenanceInput,
  type ReportProvenance,
} from "../src/data/provenance.js";
import { buildDQReport, dqReportHtml, dqReportMarkdown } from "../src/data/dq-report.js";
import { builtInNullTokens } from "../src/parse/null-tokens.js";

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
const DEFAULT_WEIGHTS = { completeness: 30, validity: 30, uniqueness: 15, consistency: 15, timeliness: 10, accuracy: 0 };

function input(over: Partial<ProvenanceInput> = {}): ProvenanceInput {
  return {
    kind: "file",
    files: [{ name: "survey.csv", bytes: 44_000_000, modified: "2019-06-11T09:30:00.000Z", sha256: "ab".repeat(32), hashNote: null }],
    inside: null,
    encoding: "UTF-8",
    delimiter: "comma",
    delimiterChosen: false,
    header: "found automatically",
    rowsRead: 28_245,
    columnsRead: 21,
    sampled: null,
    missingWords: ["-", "null", "n/a", "unknown"],
    columnOverrides: [],
    steps: [],
    rowsNow: 28_245,
    columnsNow: 21,
    scoreVersion: 3,
    weights: DEFAULT_WEIGHTS,
    defaultWeights: DEFAULT_WEIGHTS,
    bands: { good: 90, fair: 75 },
    optionalColumns: [],
    reviewedChecks: 0,
    freshness: null,
    rules: 0,
    tool: { version: "0.1.0", build: "abc1234" },
    ...over,
  };
}

test("SHA-256 matches the standard test vectors and Node's own", async () => {
  assert.equal(await sha256Hex(bytes("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await sha256Hex(bytes("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const text = "name,age\nAda,36\nAlan,41\n";
  assert.equal(await sha256Hex(bytes(text)), createHash("sha256").update(text).digest("hex"));
});

test("a fingerprint says why there is none instead of guessing", async () => {
  const text = "a,b\n1,2\n";
  assert.deepEqual(await fingerprintBytes(async () => bytes(text), 8), { sha256: createHash("sha256").update(text).digest("hex"), note: null });

  let read = false;
  const tooBig = await fingerprintBytes(async () => { read = true; return bytes(""); }, HASH_LIMIT_BYTES + 1);
  assert.equal(tooBig.sha256, null);
  assert.match(tooBig.note ?? "", /larger than 512 MB/);
  assert.equal(read, false, "a file over the limit is not read a second time");

  const gone = await fingerprintBytes(async () => { throw new Error("NotReadableError"); }, 8);
  assert.equal(gone.sha256, null);
  assert.match(gone.note ?? "", /could not be read again/);

  const changed = await fingerprintBytes(async () => bytes("a,b\n1,2\n3,4\n"), 8);
  assert.equal(changed.sha256, null);
  assert.match(changed.note ?? "", /size changed after loading/);
});

test("the provenance records the file, how it was read, what changed and the score settings", () => {
  const p = buildProvenance(input());
  assert.equal(p.source.files[0]!.sha256, "ab".repeat(32));
  assert.equal(p.read.rows, 28_245);
  assert.equal(p.scoring.weightsAreDefault, true);
  assert.equal(p.tool.name, "TurboFuzz");
  const custom = buildProvenance(input({ weights: { ...DEFAULT_WEIGHTS, completeness: 50 } }));
  assert.equal(custom.scoring.weightsAreDefault, false);
  const long = buildProvenance(input({ steps: Array.from({ length: 70 }, (_, i) => `step ${i}`) }));
  assert.equal(long.changes.steps, 70);
  assert.equal(long.changes.labels.length, 61);
  assert.equal(long.changes.labels.at(-1), "…and 10 more");
});

test("the rows read like an audit note: file, fingerprint, reading, changes, settings, build", () => {
  const rows = Object.fromEntries(provenanceRows(buildProvenance(input())));
  assert.equal(rows["Source"], "file");
  assert.equal(rows["File"], "survey.csv · 44,000,000 bytes (42.0 MB) · modified 2019-06-11T09:30:00.000Z");
  assert.equal(rows["SHA-256"], "ab".repeat(32));
  assert.equal(rows["Read as"], "UTF-8 · comma-separated (detected) · header: found automatically");
  assert.equal(rows["Rows read"], "28,245 rows × 21 columns");
  assert.match(rows["Counted as missing"]!, /4 built-in words and symbols such as null, n\/a, unknown, and empty cells/);
  assert.match(rows["Changes since loading"]!, /^none: this is the table as read/);
  assert.match(rows["Score"]!, /version 3 · weights completeness 30, validity 30.*\(default\) · bands good from 90, fair from 75/);
  assert.equal(rows["Computed by"], "TurboFuzz 0.1.0 (build abc1234), in the browser");
  assert.equal(rows["Columns treated as optional"], undefined, "nothing to say, nothing printed");
});

test("changes, samples, customised scoring and a missing fingerprint are all said plainly", () => {
  const p = buildProvenance(
    input({
      kind: "files",
      files: [
        { name: "a.csv", bytes: 100, modified: null, sha256: "11".repeat(32), hashNote: null },
        { name: "b.csv", bytes: 1_200, modified: null, sha256: null, hashNote: "the file could not be read again after loading (it may have moved or changed)" },
      ],
      sampled: "first 200,000 rows of ≈1,234,567",
      delimiterChosen: true,
      columnOverrides: [{ column: "Status", counted: ["tba"], kept: ["none"] }],
      steps: ["Trim: name", "Removed 12 rows"],
      rowsNow: 28_233,
      weights: { ...DEFAULT_WEIGHTS, completeness: 50 },
      optionalColumns: ["Notes"],
      reviewedChecks: 2,
      freshness: "Timestamp no older than 7 days",
      rules: 3,
      tool: { version: "0.1.0", build: null },
    }),
  );
  const rows = Object.fromEntries(provenanceRows(p));
  assert.equal(rows["Source"], "2 files appended into one table");
  assert.equal(rows["SHA-256 of a.csv"], "11".repeat(32));
  assert.match(rows["SHA-256 of b.csv"]!, /^not computed: the file could not be read again/);
  assert.match(rows["Rows read"]!, /only part of the file: first 200,000 rows of ≈1,234,567$/);
  assert.match(rows["Read as"]!, /comma-separated \(chosen\)/);
  assert.equal(rows["Missing-value rule for Status"], "also counts tba as missing; keeps none as real values");
  assert.match(rows["Changes since loading"]!, /^2 steps, so this report describes 28,233 rows × 21 columns, not the file as it arrived: Trim: name; Removed 12 rows$/);
  assert.match(rows["Score"]!, /\(customised\)/);
  assert.equal(rows["Columns treated as optional"], "Notes");
  assert.equal(rows["Issues reviewed and set aside"], "2 checks");
  assert.equal(rows["Freshness rule"], "Timestamp no older than 7 days");
  assert.equal(rows["Own rules"], "3 rules");
  assert.equal(rows["Computed by"], "TurboFuzz 0.1.0, in the browser");
});

test("sizes read exactly and humanly", () => {
  assert.equal(sizeText(null), "size unknown");
  assert.equal(sizeText(512), "512 bytes");
  assert.equal(sizeText(2048), "2,048 bytes (2.0 KB)");
});

test("the built-in missing words are the ones the app uses", () => {
  const words = builtInNullTokens();
  assert.ok(words.includes("n/a") && words.includes("null") && words.includes("-"));
  assert.ok(!words.includes(""), "an empty cell is not a word");
});

const SCORE = {
  overall: 80,
  band: "fair",
  dimensions: [{ dimension: "validity", label: "Validity", abbreviation: "Val", score: 80, weight: 1, note: null, checks: [] }],
} as unknown as Parameters<typeof buildDQReport>[0];

function report(provenance: ReportProvenance | undefined) {
  return buildDQReport(SCORE, "survey.csv", 28_245, 21, "2026-11-02T00:00:00.000Z", provenance === undefined ? {} : { provenance });
}

test("the report carries the provenance in Markdown and HTML, and none when there is none", () => {
  const p = buildProvenance(input());
  const withIt = report(p);
  const markdown = dqReportMarkdown(withIt);
  assert.match(markdown, /## Provenance/);
  assert.match(markdown, new RegExp(`- SHA-256: ${"ab".repeat(32)}`));

  const html = dqReportHtml(withIt);
  assert.match(html, /<h2>Provenance<\/h2>/);
  assert.match(html, new RegExp(`<th scope="row">SHA-256</th><td><code>${"ab".repeat(32)}</code></td>`));
  assert.ok(html.indexOf("Provenance") < html.indexOf("<h2>Dimensions"), "provenance comes before the findings");

  const without = report(undefined);
  assert.doesNotMatch(dqReportMarkdown(without), /Provenance/);
  assert.doesNotMatch(dqReportHtml(without), /Provenance/);
});

test("hostile file names and sheet names are escaped in the HTML report, and no script is added", () => {
  const p = buildProvenance(
    input({
      files: [{ name: '<img src=x onerror="alert(1)">.csv', bytes: 1, modified: null, sha256: null, hashNote: "<b>hidden</b>" }],
      inside: "<script>alert(2)</script>",
    }),
  );
  const html = dqReportHtml(report(p));
  assert.doesNotMatch(html, /<img|<script|onerror="alert/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;\.csv/);
  assert.match(html, /not computed: &lt;b&gt;hidden&lt;\/b&gt;/);
});
