# 2026-10-04 — Length outliers: 3 × P90 rule

## Change

Replaced percentile-tail/IQR length fences with a single per-column rule:
flag trimmed lengths greater than **3 × the column's 90th-percentile length**
(one-sided — only overlong values). P90 comes from the same strided ≤50k
sample; columns need ≥8 values; P90 of 0 disables the fence. Tooltip is now
"Overlong value — N chars (expected at most X)".

## Observed on PPR-ALL.csv

| column | P90 | max | 2× | 2.5×/3× |
|---|---|---|---|---|
| Address | 46 | 98 | 20 | 0 |
| Postal Code | 9 | 20 | 10 | 0 |
| others | – | ≤ P90 × 2 | 0 | 0 |

At the requested 3× the file has no genuine length outliers (length anomalies
0). Lowering `LENGTH_FACTOR` in `src/data/anomalies.ts` to 2 would show the
20 unusually long addresses and 10 postal codes.

## Tests

104 passing — overlong rule (990×10-char + 10×40-char → fence 30, 10 flagged)
and uniform-length no-outlier case.
