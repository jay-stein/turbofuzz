import { test } from "node:test";
import assert from "node:assert/strict";
import { notATableMessage } from "../src/parse/not-a-table.js";

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

test("a PDF is refused with the plain message", () => {
  assert.equal(
    notATableMessage("report.pdf", enc("%PDF-1.7\n%âã")),
    "“report.pdf” is a PDF, not a table. Open it in a PDF reader, or export its table to CSV or Excel first.",
  );
});

test("random bytes under a PDF name are refused by extension, and under a CSV name by content", () => {
  const random = new Uint8Array(2000);
  let seed = 7;
  for (let i = 0; i < random.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; random[i] = seed >> 8 & 0xff; }
  assert.match(notATableMessage("report.pdf", random) ?? "", /is a PDF, not a table/);
  assert.match(notATableMessage("data.csv", random) ?? "", /is a binary file, not a table/);
});

test("magic bytes beat a misleading extension", () => {
  assert.match(notATableMessage("data.csv", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])) ?? "", /an image/);
  assert.match(notATableMessage("data.txt", enc("MZ\u0090\u0000")) ?? "", /a program/);
  assert.match(notATableMessage("memo.docx", Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0])) ?? "", /not a table/);
});

test("UTF-16 text with a byte-order mark and without one still loads", () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("name\tcity\nZoë\tMünchen\n", "utf16le")]);
  assert.equal(notATableMessage("people.txt", le), null);
  assert.equal(notATableMessage("people.txt", Buffer.from("name\tcity\nZoe\tMunich\n", "utf16le")), null);
  assert.equal(notATableMessage("people.txt", Buffer.from("name\tcity\nZoe\tMunich\n", "utf16le").swap16()), null);
});

test("Latin-1 / windows-1252 and UTF-8 text load", () => {
  assert.equal(notATableMessage("a.csv", Uint8Array.from([...enc("name;city\nJos"), 0xe9, ...enc(";Gen"), 0xe8, ...enc("ve\n\x80 5\n")])), null);
  assert.equal(notATableMessage("a.csv", enc("name,city\nZoë,München\n﻿x\r\n1\t2\n")), null);
  assert.equal(notATableMessage("empty.csv", new Uint8Array(0)), null);
});
