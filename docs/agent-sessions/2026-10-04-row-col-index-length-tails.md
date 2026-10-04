# 2026-10-04 — Row/column index gutter and stricter length outliers

## Row + column indexes

- Table grid gained a 46px sticky left gutter: each row shows its 1-based
  position in the current order (`46px` prepended to the grid template,
  included in total width, sticky-left with opaque row/even/duplicate
  backgrounds). Header shows `#` above the gutter.
- Each column header now shows a small 9.5px column number before the name.

## Length outliers

- Replaced the 1.5×IQR fences with:
  - **large columns (≥200 non-null values)** — percentile tails at
    0.5%/99.5%, i.e. ~1% flagged in total, strictly outside;
  - **small columns** — far 3×IQR fences (percentiles are too jumpy there);
  - constant-length columns never flag.
- PPR-ALL.csv verification: Address fence 17–62, 3,466 flagged (0.96%:
  1,832 below, 1,634 above) vs 6,317 before. Postal Code 14, County 0,
  Description of Property 3, Property Size 2. Total length anomalies
  6,330 → 3,482.

## Tests

104 passing (percentile-tail test added: 995×10-char + 5×11-char flags
exactly the 5 long values). Typecheck clean.
