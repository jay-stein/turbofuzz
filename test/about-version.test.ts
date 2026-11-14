import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBuildDate, versionLine } from "../src/ui/about.js";

test("the build date reads unambiguously, from the UTC date", () => {
  assert.equal(formatBuildDate("2026-11-14"), "14 Nov 2026");
  assert.equal(formatBuildDate("2026-01-05"), "5 Jan 2026");
  assert.equal(formatBuildDate("2026-12-31T23:59:59Z"), "31 Dec 2026");
});

test("a missing or malformed date is not shown", () => {
  assert.equal(formatBuildDate(null), null);
  assert.equal(formatBuildDate("yesterday"), null);
  assert.equal(formatBuildDate("2026-13-01"), null);
});

test("the version line carries version, build and date", () => {
  assert.equal(versionLine("0.1.0", "abc1234", "2026-11-14"), "Version 0.1.0 · build abc1234 · updated 14 Nov 2026");
  assert.equal(versionLine("0.1.0", "abc1234+", "2026-11-14"), "Version 0.1.0 · build abc1234+ · updated 14 Nov 2026");
  assert.equal(versionLine("0.1.0", null, "2026-11-14"), "Version 0.1.0 · updated 14 Nov 2026");
});

test("outside a build the line says development build", () => {
  assert.equal(versionLine("dev", null, null), "Version dev · development build");
});
