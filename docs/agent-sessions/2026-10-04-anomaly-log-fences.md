# 2026-10-04 — Log-space fences for skewed numeric anomalies

## Problem

PPR-ALL.csv (`Price (€)`) flagged 14,936 of 361,725 rows (4.1%) as value
outliers, including plainly ordinary prices such as €634,000. Cause: Irish
house prices are strongly right-skewed, and a linear MAD fence
(median €180,616, MAD €86k, upper bound ≈ €628k) treats the whole legitimate
upper tail as anomalous. This is the known failure mode of median/MAD rules
on multiplicative (log-normal) distributions.

## Fix

- `ValueFence` is now `{ center, lo, hi, log }` — raw-unit bounds plus a mode
  flag, so the table check is a simple `value < lo || value > hi`.
- `numericFence` computes Bowley skewness `(q3 + q1 − 2·median) / (q3 − q1)`
  from the same sorted sample. When the column is strictly positive and
  `skew > 0.1`, the modified z-score is computed on `log(value)` and converted
  back: `lo = exp(center − radius)`, `hi = exp(center + radius)`. The 0.1
  threshold keeps symmetric data linear (Bowley ≈ 0) while catching log-normal
  prices (≈ 0.24 here). MAD and the mean-deviation fallback are unchanged.
- Cell tooltip now reads `Value outlier — median X, expected LO – HI`.

## Result on PPR-ALL.csv

- Price: 14,936 → **2,560 flagged** (0.7%): 1,780 nominal/sub-€14k transfers
  below 14,125 and 780 genuine €2.3M+ sales above 2,309,479. €634,000 is no
  longer flagged.
- Other columns unchanged (address length 6,317; postal code 14).

## Tests

103 passing, including a synthetic right-skewed price column where linear
fencing would flag the entire upper cluster but log fencing flags only the
true extreme.
