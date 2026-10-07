import { test } from "node:test";
import assert from "node:assert/strict";
import { pandasRecipe } from "../src/data/recipe.js";

test("generates pandas lines for clean ops", () => {
  const recipe = pandasRecipe({
    cleans: [
      {
        name: "city",
        ops: [
          { kind: "trim" },
          { kind: "case", style: "title" },
          { kind: "replace", find: "Fremantel", replacement: "Fremantle", ignoreCase: false },
          { kind: "toNumber", locale: "comma" },
        ],
      },
    ],
    transforms: [],
    schema: [],
  });
  assert.match(recipe, /df\["city"\] = df\["city"\]\.str\.strip\(\)/);
  assert.match(recipe, /df\["city"\] = df\["city"\]\.str\.title\(\)/);
  assert.match(recipe, /str\.replace\("Fremantel", "Fremantle", regex=False\)/);
  assert.match(recipe, /pd\.to_numeric\(/);
  assert.match(recipe, /df\.to_csv\("cleaned\.csv", index=False\)/);
});

test("generates pandas lines for transforms with schema tracking", () => {
  const recipe = pandasRecipe({
    cleans: [],
    transforms: [
      { kind: "dedupe", keep: "first" },
      { kind: "groupBy", dimension: 0, measure: 1, aggregate: "sum" },
      { kind: "melt", idVars: [0], valueVars: [1], varName: "variable", valueName: "value" },
    ],
    schema: [
      { name: "region", numeric: false },
      { name: "sales", numeric: true },
    ],
  });
  assert.match(recipe, /df = df\.drop_duplicates\(keep="first"\)/);
  assert.match(recipe, /df\.groupby\("region", as_index=False\)\["sales"\]\.sum\(\)/);
  assert.match(recipe, /df\.rename\(columns=\{"sales": "Sum\(sales\)"\}\)/);
  assert.match(recipe, /value_vars=\["Sum\(sales\)"\]/);
});

test("emits a comment for knn imputation", () => {
  const recipe = pandasRecipe({
    cleans: [],
    transforms: [{ kind: "knn", fill: [0], predictors: [1], k: 5 }],
    schema: [
      { name: "a", numeric: true },
      { name: "b", numeric: true },
    ],
  });
  assert.match(recipe, /KNN impute a from b \(k=5\)/);
});
