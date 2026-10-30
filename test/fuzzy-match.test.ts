import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyRank, fuzzyScore } from "../src/search/fuzzy-match.js";

const names = ["order_id", "customer_name", "country", "Order Date", "total_amount", "Cafe Zürich", "London"];
const find = (q: string): string[] => fuzzyRank(names, q, (n) => n);

test("exact and prefix beat contains, which beats letters in order", () => {
  assert.equal(find("country")[0], "country");
  assert.deepEqual(find("order").slice(0, 2), ["order_id", "Order Date"]);
  assert.equal(find("amount")[0], "total_amount");
  const exact = fuzzyScore("country", "country")!, prefix = fuzzyScore("coun", "country")!, contains = fuzzyScore("ount", "country")!, letters = fuzzyScore("cty", "country")!;
  assert.ok(exact > prefix && prefix > contains && contains > letters);
});

test("a few letters, initials or separators still find the name", () => {
  assert.equal(find("ctry")[0], "country");
  assert.equal(find("ordid")[0], "order_id");
  assert.equal(find("order date")[0], "Order Date");
  assert.equal(find("cust name")[0], "customer_name");
  assert.equal(find("zurich")[0], "Cafe Zürich", "accents are ignored");
  assert.equal(find("NAME")[0], "customer_name", "case is ignored");
});

test("a slipped, missing, doubled or swapped letter is forgiven (longer queries)", () => {
  assert.equal(find("lodnon")[0], "London");
  assert.equal(find("contry")[0], "country");
  assert.equal(find("coutnry")[0], "country");
  assert.equal(find("custmer")[0], "customer_name");
  assert.equal(find("ordr dat")[0], "Order Date", "a typo in one of several words");
});

test("things that do not fit are left out, and an empty query keeps everything in order", () => {
  assert.deepEqual(find("xyzq"), []);
  assert.deepEqual(find("  "), names);
  assert.equal(fuzzyScore("zz", "country"), null);
  // Short queries are not guessed at: "ab" does not turn into every name with an a and a b far apart.
  assert.equal(fuzzyScore("ab", "a long name that ends in b"), null);
});
