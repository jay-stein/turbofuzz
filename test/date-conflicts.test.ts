import { test } from "node:test";
import assert from "node:assert/strict";
import { profileBuffer } from "../scripts/lib/profile.js";
import { buildIssues } from "../src/data/dq-issues.js";
import { applyCleanOps } from "../src/data/clean-ops.js";
import { detectNumericDate, numericDateText } from "../src/parse/numeric-dates.js";
import { pandasRecipeScript } from "../src/data/recipe.js";
import { polarsRecipeScript } from "../src/data/recipe-polars.js";

const encode = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

async function profile(name: string, rows: string[][]) {
  const p = await profileBuffer(name, encode(rows.map((r) => r.join(",")).join("\n") + "\n"));
  return { ...p, issues: buildIssues({ score: p.score, metas: p.metas, rowCount: p.dataset.rowCount, review: [], sensitiveColumns: new Set() }) };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** 60 dates written three ways: iso, dd/mm/yyyy, "12 Mar 2024". */
function threeWays(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 60; i++) {
    const day = 13 + (i % 15);
    if (i % 3 === 0) out.push(`2024-03-${pad(day)}`);
    else if (i % 3 === 1) out.push(`${pad(day)}/03/2024`);
    else out.push(`${day} Mar 2024`);
  }
  return out;
}

test("one stray datetime among dates written three ways no longer hides the mixed formats", async () => {
  const clean = threeWays();
  const before = await profile("d.csv", [["when"], ...clean.map((v) => [v])]);
  assert.equal(before.metas[0]!.type, "date");
  assert.ok((before.metas[0]!.dateFormats?.minority ?? 0) > 0);
  const stray = [...clean, "2020-05-05T10:00:00"];
  const after = await profile("d.csv", [["when"], ...stray.map((v) => [v])]);
  assert.equal(after.metas[0]!.type, "datetime");
  const formats = after.metas[0]!.dateFormats;
  assert.ok(formats !== null && formats !== undefined, "layouts reported for a datetime column");
  assert.ok(formats.formats.length >= 3);
  assert.ok(formats.minority >= 39, `minority ${formats.minority}`);
  const check = after.score.dimensions.flatMap((d) => d.checks).find((c) => c.id === "validity.dateformat.0");
  assert.ok((check?.fail ?? 0) > 0);
  assert.ok((after.score.overall ?? 100) < 100);
  const issue = after.issues.find((i) => i.kind === "dateFormat");
  assert.ok(issue !== undefined);
  assert.equal(issue.fixes.length, 0, "a time of day is involved, so no automatic fix");
});

test("look-alike: a datetime column in one layout stays quiet", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => [`2024-03-${pad(1 + (i % 28))}T10:${pad(i % 60)}:00`]);
  const p = await profile("d.csv", [["when"], ...rows]);
  assert.equal(p.metas[0]!.type, "datetime");
  assert.equal(p.metas[0]!.dateFormats ?? null, null);
});

function conflictRows(dayFirst: number, monthFirst: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < dayFirst; i++) out.push(`${pad(13 + (i % 15))}/03/2024`);
  for (let i = 0; i < monthFirst; i++) out.push(`03/${pad(13 + (i % 15))}/2024`);
  for (let i = 0; i < 10; i++) out.push(`0${1 + (i % 9)}/0${1 + ((i + 3) % 9)}/2024`);
  return out;
}

test("dates half day-first, half month-first stay text and are reported with both counts", async () => {
  const p = await profile("d.csv", [["when"], ...conflictRows(30, 25).map((v) => [v])]);
  const meta = p.metas[0]!;
  assert.equal(meta.type, "string", "never typed until the person chooses");
  assert.equal(meta.dateConflict?.dayFirst, 30);
  assert.equal(meta.dateConflict?.monthFirst, 25);
  assert.equal(meta.dateConflict?.either, 10);
  const issue = p.issues.find((i) => i.kind === "dateConflict");
  assert.ok(issue !== undefined);
  assert.equal(issue.severity, "fix");
  assert.equal(issue.fixes.length, 0, "no automatic conversion");
  assert.match(issue.evidence, /30 dates are day-first and 25 month-first: pick one reading/);
  assert.deepEqual(issue.sides?.map((s) => s.special), ["dateDayFirst", "dateMonthFirst"]);
  assert.ok((p.score.overall ?? 100) < 100);
});

test("look-alike: slashed dates that agree on one order stay a date column", async () => {
  const p = await profile("d.csv", [["when"], ...conflictRows(40, 0).map((v) => [v])]);
  assert.equal(p.metas[0]!.type, "date");
  assert.equal(p.metas[0]!.dateConflict ?? null, null);
  assert.equal(p.issues.some((i) => i.kind === "dateConflict"), false);
});

test("look-alike: ordinary text columns are not probed as date conflicts", async () => {
  const p = await profile("d.csv", [["note"], ...Array.from({ length: 50 }, (_, i) => [`item ${i} 13/20`])]);
  assert.equal(p.metas[0]!.dateConflict ?? null, null);
});

test("numeric dates: serial, Unix seconds, milliseconds and yyyymmdd are offered, never converted", async () => {
  const n = 30;
  const serial = Array.from({ length: n }, (_, i) => String(45361 + i * 7));
  const secs = Array.from({ length: n }, (_, i) => String(1710071890 + i * 86400));
  const ms = secs.map((v) => `${v}000`);
  const ymd = Array.from({ length: n }, (_, i) => `2024${pad(1 + (i % 12))}${pad(1 + i)}`);
  const qty = Array.from({ length: n }, (_, i) => String(45361 + i * 7));
  const p = await profile("d.csv", [
    ["order_date", "created_at", "timestamp", "date", "quantity"],
    ...serial.map((_, i) => [serial[i]!, secs[i]!, ms[i]!, ymd[i]!, qty[i]!]),
  ]);
  const formats = p.metas.map((m) => m.suggestions.find((s) => s.kind === "numericDate")) ;
  assert.equal(formats[0]?.kind === "numericDate" && formats[0].format, "excelSerial");
  assert.equal(formats[1]?.kind === "numericDate" && formats[1].format, "epochSeconds");
  assert.equal(formats[2]?.kind === "numericDate" && formats[2].format, "epochMillis");
  assert.equal(formats[3]?.kind === "numericDate" && formats[3].format, "yyyymmdd");
  assert.equal(formats[4], undefined, "a quantity with the same digits is not a date");
  assert.equal(p.metas[0]!.type, "integer", "typed as before until the person converts");
});

test("numeric dates: look-alikes stay quiet and conversions are exact", () => {
  assert.equal(detectNumericDate("order_date", ["1", "2", "3", "4", "5", "6"]), null);
  assert.equal(detectNumericDate("order_date", Array(10).fill("45361")), null, "one repeated value is a constant, not a date column");
  assert.equal(detectNumericDate("customer_id", ["45361", "45362", "45363", "45364", "45365"]), null);
  assert.equal(numericDateText("45361", "excelSerial"), "2024-03-10");
  assert.equal(numericDateText("1710071890", "epochSeconds"), "2024-03-10T11:58:10Z");
  assert.equal(numericDateText("1710071890000", "epochMillis"), "2024-03-10T11:58:10Z");
  assert.equal(numericDateText("20240310", "yyyymmdd"), "2024-03-10");
  assert.equal(numericDateText("20241340", "yyyymmdd"), null);
  assert.deepEqual(applyCleanOps(["20240310", "99999999", "x"], [{ kind: "numberToDate", format: "yyyymmdd" }]), ["2024-03-10", "99999999", "x"]);
});

test("numeric dates export to pandas and Polars scripts", () => {
  const input = { cleans: [{ name: "created_at", ops: [{ kind: "numberToDate" as const, format: "epochSeconds" as const }] }], transforms: [], schema: [] } as never;
  assert.match(pandasRecipeScript(input).code, /pd\.to_datetime\(_n, unit="s"/);
  assert.match(polarsRecipeScript(input).code, /pl\.from_epoch/);
});
