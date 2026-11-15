import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeText, repairMojibake } from "../src/parse/encoding.js";
import { detectMojibake } from "../src/data/mojibake.js";
import { applyCleanOps } from "../src/data/clean-ops.js";
import { profileBuffer } from "../scripts/lib/profile.js";
import { buildIssues } from "../src/data/dq-issues.js";
import { pandasRecipeScript } from "../src/data/recipe.js";
import { polarsRecipeScript } from "../src/data/recipe-polars.js";

function utf32(text: string, little: boolean, bom = true): ArrayBuffer {
  const points = [...(bom ? "﻿" : ""), ...text].map((c) => c.codePointAt(0)!);
  const bytes = new Uint8Array(points.length * 4);
  const view = new DataView(bytes.buffer);
  points.forEach((code, i) => view.setUint32(i * 4, code, little));
  return bytes.buffer;
}

function utf16(text: string, little: boolean, bom: boolean): ArrayBuffer {
  const units = [...(bom ? "﻿" : ""), ...text].flatMap((c) => [...Array(c.length).keys()].map((i) => c.charCodeAt(i)));
  const bytes = new Uint8Array(units.length * 2);
  const view = new DataView(bytes.buffer);
  units.forEach((code, i) => view.setUint16(i * 2, code, little));
  return bytes.buffer;
}

const CJK = "国名\t都市\n日本\t東京\n中国\t北京\n韓国\tソウル\n台湾\t台北\n香港\t香港\n";

test("UTF-32 with a byte-order mark decodes properly, both byte orders", () => {
  const text = "name\tcity\nZoë\t東京 😀\n";
  assert.deepEqual(decodeText(utf32(text, true)), { text, encoding: "utf-32le" });
  assert.deepEqual(decodeText(utf32(text, false)), { text, encoding: "utf-32be" });
});

test("a cut-off UTF-32 file says so with replacement characters instead of garbage", () => {
  const whole = new Uint8Array(utf32("a\tb\n1\t2\n", true));
  const cut = whole.slice(0, whole.length - 2).buffer;
  const decoded = decodeText(cut);
  assert.equal(decoded.encoding, "utf-32le");
  assert.equal(decoded.replaced?.count, 1);
  assert.ok(!decoded.text.includes("\u0000"));
});

test("UTF-16 without a byte-order mark is found when the text is mostly CJK", () => {
  assert.deepEqual(decodeText(utf16(CJK, true, false)), { text: CJK, encoding: "utf-16le" });
  assert.deepEqual(decodeText(utf16(CJK, false, false)), { text: CJK, encoding: "utf-16be" });
});

test("look-alikes: windows-1252, UTF-8 and UTF-8 CJK files are not taken for UTF-16", () => {
  const latin = Uint8Array.from("name;city\nJosé;Zürich\nÅsa;Malmö\nRenée;Besançon\nÉmile;Orléans\n", (c) => c.charCodeAt(0));
  assert.equal(decodeText(latin.buffer).encoding, "windows-1252");
  assert.equal(decodeText(new TextEncoder().encode(CJK).buffer as ArrayBuffer).encoding, "utf-8");
  assert.equal(decodeText(new TextEncoder().encode("a,b\n1,2\n3,4\n5,6\n").buffer as ArrayBuffer).encoding, "utf-8");
  // A few stray NUL bytes in one UTF-8 file are not UTF-16.
  const stray = new TextEncoder().encode("id,name\n" + "1,Ann\n".repeat(300) + "2,B\u0000\n");
  assert.equal(decodeText(stray.buffer as ArrayBuffer).encoding, "utf-8");
});

test("unreadable characters are counted with the line of the first", () => {
  const whole = utf16("a\tb\n1\t2\n3\t4\n", true, true);
  const odd = whole.slice(0, whole.byteLength - 1);
  const decoded = decodeText(odd);
  assert.equal(decoded.replaced?.count, 1);
  assert.equal(decoded.replaced?.line, 3);
  const lone = decodeText(utf16("a\tb\n1\t\uD800\n", true, true));
  assert.equal(lone.replaced?.count, 1);
  assert.equal(lone.replaced?.line, 2);
  assert.equal(decodeText(utf16("a\tb\n1\t2\n", true, true)).replaced, undefined);
});

test("repairMojibake takes double-encoded text back exactly and leaves correct text alone", () => {
  assert.equal(repairMojibake("CafÃ©"), "Café");
  assert.equal(repairMojibake("GÃ¶teborg"), "Göteborg");
  assert.equal(repairMojibake("MÃ¼nchen"), "München");
  assert.equal(repairMojibake("itâ€™s"), "it’s");
  assert.equal(repairMojibake("â€œquotedâ€\u009d"), null, "an undefined cp1252 byte is never guessed");
  assert.equal(repairMojibake("20Â°C"), "20°C");
  for (const clean of ["Café", "München", "Zoë", "naïve", "Straße", "Ünal", "señor", "Ångström", "20°C", "plain"]) {
    assert.equal(repairMojibake(clean), null, clean);
  }
});

const missing = (v: string): boolean => v === "";

test("mojibake in 2%+ of a column is reported with examples; clean accents stay quiet", () => {
  const mixed = [...Array(40).fill("Paris"), ...Array(5).fill("CafÃ©"), "GÃ¶teborg", ...Array(30).fill("Zürich")];
  const found = detectMojibake(mixed, missing);
  assert.equal(found?.count, 6);
  assert.equal(found?.fixable, 6);
  assert.deepEqual(found?.examples.map((e) => e.to), ["Café", "Göteborg"]);
  assert.equal(detectMojibake([...Array(200).fill("Zürich"), ...Array(100).fill("Café"), "München"], missing), null);
  assert.equal(detectMojibake([...Array(300).fill("Paris"), "CafÃ©"], missing), null, "one cell in 300 is under 2%");
});

test("the Data Quality page offers an exact repair that the Recipe scripts carry", async () => {
  const rows = ["city", ...Array(30).fill("Paris"), ...Array(6).fill("CafÃ©"), ...Array(10).fill("Zürich")];
  const text = rows.join("\n") + "\n";
  const bytes = new TextEncoder().encode(text);
  const p = await profileBuffer("m.csv", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.equal(p.metas[0]!.mojibake?.count, 6);
  const issue = buildIssues({ score: p.score, metas: p.metas, rowCount: p.dataset.rowCount, review: [], sensitiveColumns: new Set() }).find((i) => i.kind === "mojibake");
  assert.ok(issue !== undefined);
  assert.equal(issue.fixes[0]?.kind, "mojibake");
  assert.match(issue.title, /wrongly decoded \(mojibake\)/);
  assert.deepEqual(applyCleanOps(["CafÃ©", "Café", "Paris", "â€™"], [{ kind: "fixMojibake" }]), ["Café", "Café", "Paris", "’"]);
  const input = { cleans: [{ name: "city", ops: [{ kind: "fixMojibake" as const }] }], transforms: [], schema: [] } as never;
  assert.match(pandasRecipeScript(input).code, /v\.encode\("cp1252"\)\.decode\("utf-8"\)/);
  assert.match(polarsRecipeScript(input).code, /map_elements\(_tf_fix_mojibake/);
});
