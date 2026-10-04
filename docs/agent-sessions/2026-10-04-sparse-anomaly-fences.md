# 2026-10-04 — Sparse columns and zero-inflated numeric fences

## Changes

1. **Sparse columns skipped**: columns with >50% null cells get no value or
   length fences (`MAX_NULL_RATIO`). On LoanStats3a this skips 40 columns
   (`mths_since_*`, `bc_util`, …), mostly 91–100% empty.
2. **MAD = 0 → no numeric fence** (was: mean-deviation fallback that flagged
   every value differing from the median). Zero-inflated count columns like
   `delinq_2yrs` and `out_prncp` were lighting up thousands of rows.
3. **log1p fences for non-negative skewed columns** (was: strict positive
   check). Columns with zeros (`last_pymnt_amnt`, `revol_bal`) previously fell
   back to linear fences and flagged their entire heavy right tail. They now
   use `log(1 + x)` with the same modified z-score, converted back via
   `expm1`.

## Result on LoanStats3a.csv.zip (42,536 × 96)

| | before | after |
|---|---|---|
| value anomaly rows | 23,726 (56%) | 4,835 (11.4%) |
| columns with flags | many | 15 |
| `last_pymnt_amnt` | 10,770 | 0 (log1p fence) |
| `delinq_2yrs` | 4,735 | 0 (MAD = 0) |
| `out_prncp` | 3,374 | 0 (MAD = 0) |
| `total_rec_int` | 2,802 | 265 |

Length anomalies unchanged at 2,873. `annual_inc` still log-fenced (197).

## Tests

110 passing: zero-MAD column now expects no fence/flags, plus the sparse
value+length skip test. Typecheck clean.
