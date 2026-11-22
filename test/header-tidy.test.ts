import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyAllNames } from "../src/ui/header-tidy.js";

test("every column name to snake_case at once, with an undo that puts them back", () => {
  const names = ["Date of Birth", "outcome_age_(days)", "Spay/Neuter", "id"];
  const applied: string[][] = [];
  const toasts: { text: string; undo?: () => void }[] = [];
  tidyAllNames(names, "snake", (headers) => applied.push(headers), (text, undo) => toasts.push({ text, undo }));
  assert.deepEqual(applied[0], ["date_of_birth", "outcome_age_days", "spay_neuter", "id"]);
  assert.equal(toasts[0]!.text, "Renamed 3 columns to snake_case");
  toasts[0]!.undo?.();
  assert.deepEqual(applied[1], names);
});

test("names already in the style change nothing and say so", () => {
  const applied: string[][] = [];
  const toasts: string[] = [];
  tidyAllNames(["a_b", "c"], "snake", (headers) => applied.push(headers), (text) => toasts.push(text));
  assert.equal(applied.length, 0);
  assert.deepEqual(toasts, ["Every column name is already snake_case"]);
});
