import { test } from "node:test";
import assert from "node:assert/strict";
import { nextThemePreference, resolveTheme, themeLabel } from "../src/ui/theme.js";

test("theme preference cycles Auto, Light, Dark", () => {
  assert.equal(nextThemePreference("auto"), "light");
  assert.equal(nextThemePreference("light"), "dark");
  assert.equal(nextThemePreference("dark"), "auto");
});

test("resolved theme follows the OS only in Auto", () => {
  assert.equal(resolveTheme("auto", true), "dark");
  assert.equal(resolveTheme("auto", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("theme labels are human-readable", () => {
  assert.equal(themeLabel("auto"), "Auto");
  assert.equal(themeLabel("light"), "Light");
  assert.equal(themeLabel("dark"), "Dark");
});
