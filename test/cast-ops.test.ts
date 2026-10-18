import { test } from "node:test";
import assert from "node:assert/strict";
import { castColumn } from "../src/data/cast-ops.js";

test("coerce blanks invalid values and keeps null tokens", () => {
  const result = castColumn(["1", "2.5", "T", "", "NA"], {
    target: "integer",
    policy: "coerce",
  });
  assert.deepEqual(result.values, ["1", "", "", "", "NA"]);
  assert.equal(result.failed, 2);
  assert.equal(result.changed, 2);
  assert.deepEqual(result.examples, ["2.5", "T"]);
  assert.equal(result.applied, true);
});

test("keep canonicalises valid values and leaves invalid text alone", () => {
  const result = castColumn([" 1,234.50 ", "oops", "$9"], {
    target: "number",
    policy: "keep",
    locale: "dot",
  });
  assert.deepEqual(result.values, ["1234.5", "oops", "9"]);
  assert.equal(result.failed, 1);
  assert.equal(result.changed, 2);
});

test("reject does not mutate when any value fails", () => {
  const input = ["2024-01-01", "not a date"];
  const result = castColumn(input, { target: "date", policy: "reject" });
  assert.deepEqual(result.values, input);
  assert.equal(result.failed, 1);
  assert.equal(result.changed, 0);
  assert.equal(result.applied, false);
});

test("casts dates, times, durations and booleans", () => {
  assert.deepEqual(
    castColumn(["01/02/2024", "2024-02-01"], {
      target: "date",
      policy: "coerce",
      dateOrder: "dmy",
    }).values,
    ["2024-02-01", "2024-02-01"],
  );
  assert.deepEqual(
    castColumn(["9:05", "23:59"], { target: "time", policy: "coerce" }).values,
    ["09:05", "23:59"],
  );
  assert.deepEqual(
    castColumn(["2h 30m", "01:15:00"], { target: "duration", policy: "coerce" }).values,
    ["2:30:00", "1:15:00"],
  );
  assert.deepEqual(
    castColumn(["Yes", "no", "1", "FALSE", "maybe"], {
      target: "boolean",
      policy: "coerce",
    }).values,
    ["true", "false", "true", "false", ""],
  );
});
