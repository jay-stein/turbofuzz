import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveZoneSpec, wallTimeToInstant, zoneOffsetMinutes } from "../src/data/timezone.js";

test("zone specs resolve special names, offsets and IANA zones", () => {
  assert.equal(resolveZoneSpec("UTC").kind, "utc");
  assert.equal(resolveZoneSpec("naive").kind, "naive");
  assert.equal(resolveZoneSpec("").kind, "naive");
  const fixed = resolveZoneSpec("+10:30");
  assert.equal(fixed.kind, "fixed");
  if (fixed.kind === "fixed") assert.equal(fixed.offsetMinutes, 630);
  assert.equal(resolveZoneSpec("Australia/Sydney").kind, "iana");
  assert.equal(resolveZoneSpec("Not/AZone").kind, "naive");
});

test("IANA zones follow daylight saving", () => {
  const sydney = resolveZoneSpec("Australia/Sydney");
  assert.equal(zoneOffsetMinutes(Date.UTC(2024, 0, 15), "Australia/Sydney"), 660);
  assert.equal(zoneOffsetMinutes(Date.UTC(2024, 6, 15), "Australia/Sydney"), 600);

  const newYork = resolveZoneSpec("America/New_York");
  assert.equal(zoneOffsetMinutes(Date.UTC(2024, 0, 15), "America/New_York"), -300);
  assert.equal(zoneOffsetMinutes(Date.UTC(2024, 6, 15), "America/New_York"), -240);

  const winter = wallTimeToInstant(2024, 1, 15, 12, 0, 0, 0, sydney);
  assert.equal(winter.offsetMinutes, 660);
  assert.equal(winter.epoch, Date.UTC(2024, 0, 15, 12) - 660 * 60_000);

  const summer = wallTimeToInstant(2024, 7, 15, 12, 0, 0, 0, sydney);
  assert.equal(summer.offsetMinutes, 600);

  const nyWinter = wallTimeToInstant(2024, 1, 15, 12, 0, 0, 0, newYork);
  assert.equal(nyWinter.offsetMinutes, -300);
  assert.equal(nyWinter.epoch, Date.UTC(2024, 0, 15, 12) + 300 * 60_000);
});

test("utc, fixed and naive specs behave predictably", () => {
  const utc = wallTimeToInstant(2024, 3, 4, 14, 35, 0, 0, resolveZoneSpec("UTC"));
  assert.equal(utc.epoch, Date.UTC(2024, 2, 4, 14, 35));
  assert.equal(utc.offsetMinutes, 0);

  const fixed = wallTimeToInstant(2024, 3, 4, 14, 35, 0, 0, resolveZoneSpec("+10:00"));
  assert.equal(fixed.epoch, Date.UTC(2024, 2, 4, 4, 35));
  assert.equal(fixed.offsetMinutes, 600);

  const naive = wallTimeToInstant(2024, 3, 4, 14, 35, 0, 0, resolveZoneSpec("naive"));
  assert.equal(naive.epoch, Date.UTC(2024, 2, 4, 14, 35));
  assert.equal(naive.offsetMinutes, null);
});
