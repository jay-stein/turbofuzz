import { test } from "node:test";
import assert from "node:assert/strict";
import { allPositive, boxCox, guerrero, invBoxCox } from "../src/data/timeseries/boxcox.js";

const near = (a: number, b: number, eps = 1e-9): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

// The classic monthly airline passengers, 1949-1960 (Box and Jenkins).
const AIR = [
  112, 118, 132, 129, 121, 135, 148, 148, 136, 119, 104, 118, 115, 126, 141, 135, 125, 149, 170, 170, 158, 133, 114, 140,
  145, 150, 178, 163, 172, 178, 199, 199, 184, 162, 146, 166, 171, 180, 193, 181, 183, 218, 230, 242, 209, 191, 172, 194,
  196, 196, 236, 235, 229, 243, 264, 272, 237, 211, 180, 201, 204, 188, 235, 227, 234, 264, 302, 293, 259, 229, 203, 229,
  242, 233, 267, 269, 270, 315, 364, 347, 312, 274, 237, 278, 284, 277, 317, 313, 318, 374, 413, 405, 355, 306, 271, 306,
  315, 301, 356, 348, 355, 422, 465, 467, 404, 347, 305, 336, 340, 318, 362, 348, 363, 435, 491, 505, 404, 359, 310, 337,
  360, 342, 406, 396, 420, 472, 548, 559, 463, 407, 362, 405, 417, 391, 419, 461, 472, 535, 622, 606, 508, 461, 390, 432,
];

test("the transformation and its inverse", () => {
  near(boxCox([1, 4, 9], 0.5)[1]!, (2 - 1) / 0.5);
  near(boxCox([Math.E], 0)[0]!, 1);
  for (const l of [-1, -0.3, 0, 0.5, 1, 2]) for (const v of [0.5, 3, 120]) near(invBoxCox(boxCox([v], l)[0]!, l), v, 1e-9);
  assert.equal(invBoxCox(-5, 0.5), 0, "outside the range of the power: zero, not NaN");
  assert.ok(Number.isNaN(boxCox([NaN], 0.3)[0]!));
  assert.equal(boxCox([5], 1)[0], 4, "lambda 1 only shifts the series");
});

test("only a series that is all above zero can be transformed", () => {
  assert.ok(allPositive([1, 2, NaN, 3], 0, 4));
  assert.ok(!allPositive([1, 0, 3], 0, 3));
  assert.ok(!allPositive([1, -2, 3], 0, 3));
  assert.ok(!allPositive([NaN, NaN], 0, 2));
});

test("Guerrero's lambda: 1 when the swings do not grow with the level, near 0 when they grow in proportion", () => {
  // Swings of the same size on a rising level: no transformation needed.
  const additive = Array.from({ length: 96 }, (_, i) => 100 + 2 * i + 8 * Math.sin((2 * Math.PI * i) / 12) + ((i * 7919) % 5) - 2);
  const la = guerrero(additive, 0, additive.length, 12)!;
  assert.ok(la > 0.5, `additive ${la}`);
  // Swings proportional to the level: a log (lambda 0) makes them steady.
  const multiplicative = Array.from({ length: 96 }, (_, i) => (100 + 2 * i) * (1 + 0.2 * Math.sin((2 * Math.PI * i) / 12) + 0.01 * (((i * 7919) % 5) - 2)));
  const lm = guerrero(multiplicative, 0, multiplicative.length, 12)!;
  assert.ok(Math.abs(lm) < 0.45 && lm < la - 0.3, `multiplicative ${lm}`);
});

test("Guerrero's lambda for the airline passengers matches R's BoxCox.lambda (-0.2947)", () => {
  const l = guerrero(AIR, 0, AIR.length, 12)!;
  assert.ok(Math.abs(l - -0.2947) < 0.02, `lambda ${l}`);
});

test("too few stretches, a constant stretch or a non-positive level gives no lambda", () => {
  assert.equal(guerrero([1, 2, 3, 4, 5, 6], 0, 6, 12), null);
  assert.equal(guerrero(Array(48).fill(5), 0, 48, 12), null);
  assert.equal(guerrero(Array.from({ length: 48 }, (_, i) => (i % 2 ? -1 : 1) * (i + 1)), 0, 48, 12), null);
});
