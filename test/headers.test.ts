import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HEADER_OPTIONS,
  normalizeHeaders,
  type HeaderNormalizeOptions,
} from "../src/data/headers.js";

function withOptions(overrides: Partial<HeaderNormalizeOptions>): HeaderNormalizeOptions {
  return { ...DEFAULT_HEADER_OPTIONS, ...overrides };
}

test("snake_case removes spaces and brackets", () => {
  assert.deepEqual(
    normalizeHeaders(["Annual Usage", "Customer Name"], withOptions({ caseStyle: "snake" })),
    ["annual_usage", "customer_name"],
  );
});

test("camelCase joins words", () => {
  assert.deepEqual(
    normalizeHeaders(["Customer Name", "Annual Usage"], withOptions({ caseStyle: "camel" })),
    ["customerName", "annualUsage"],
  );
});

test("camelCase splits existing camel boundaries", () => {
  assert.deepEqual(
    normalizeHeaders(["CustomerName", "HTTPResponse"], withOptions({ caseStyle: "camel" })),
    ["customerName", "httpResponse"],
  );
});

test("title case capitalises each word", () => {
  assert.deepEqual(
    normalizeHeaders(["annual_usage"], withOptions({ caseStyle: "title" })),
    ["Annual Usage"],
  );
});

test("lower and upper case the whole value", () => {
  assert.deepEqual(
    normalizeHeaders(["Annual Usage"], withOptions({ caseStyle: "lower" })),
    ["annual usage"],
  );
  assert.deepEqual(
    normalizeHeaders(["annual usage"], withOptions({ caseStyle: "upper" })),
    ["ANNUAL USAGE"],
  );
});

test("keep leaves the value unchanged apart from tidy options", () => {
  assert.deepEqual(
    normalizeHeaders(
      ["Annual Usage"],
      withOptions({ caseStyle: "keep", trim: false, stripBrackets: false, dedupe: false }),
    ),
    ["Annual Usage"],
  );
});

test("strips wrapping brackets", () => {
  assert.deepEqual(
    normalizeHeaders(["[Annual Usage]", "(Customer Name)"], withOptions({ caseStyle: "keep" })),
    ["Annual Usage", "Customer Name"],
  );
});

test("trims and collapses whitespace", () => {
  assert.deepEqual(
    normalizeHeaders(["  Annual   Usage  "], withOptions({ caseStyle: "keep" })),
    ["Annual Usage"],
  );
});

test("dedupes case-insensitively with numeric suffixes", () => {
  assert.deepEqual(
    normalizeHeaders(["Name", "name", "Name"], withOptions({ caseStyle: "keep" })),
    ["Name", "name_2", "Name_3"],
  );
});

test("empty headers fall back to Column N", () => {
  assert.deepEqual(
    normalizeHeaders(["", "  ", "x"], withOptions({ caseStyle: "keep" })),
    ["Column 1", "Column 2", "x"],
  );
});
