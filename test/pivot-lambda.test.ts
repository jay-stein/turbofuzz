import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePivotLambda } from "../src/data/pivot-lambda.js";

test("lambda functions rewrite to safe aggregate expressions", () => {
  const compiled = compilePivotLambda("lambda x: sum(x) / size(x)", "amount");
  assert.ok(compiled.ok);
  assert.equal(compiled.expression, "(sum(amount) / count(amount))");

  const range = compilePivotLambda("lambda x: max(x) - min(x)", "amount");
  assert.ok(range.ok);
  assert.equal(range.expression, "(max(amount) - min(amount))");

  const variance = compilePivotLambda("lambda x: var(x)", "amount");
  assert.ok(variance.ok);
  assert.equal(
    variance.expression,
    "(stddev(amount) * stddev(amount))",
  );
});

test("lambda quantiles become pN aggregates", () => {
  const compiled = compilePivotLambda("lambda x: quantile(90)", "amount");
  assert.ok(compiled.ok);
  assert.equal(compiled.expression, "p90(amount)");
});

test("lambda validation rejects unsafe or unsupported input", () => {
  assert.equal(compilePivotLambda("mean(x)", "amount").ok, false);
  assert.equal(compilePivotLambda("lambda x: evil(x)", "amount").ok, false);
  assert.equal(compilePivotLambda("lambda x: quantile(101)", "amount").ok, false);
  assert.equal(compilePivotLambda("lambda x: 1 +", "amount").ok, false);
  assert.equal(compilePivotLambda("lambda y: mean(y)", "amount").ok, false);
});
