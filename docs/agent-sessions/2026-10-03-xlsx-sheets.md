# 2026-10-03 — Worksheet listing: order, 50 cap, actual extents

## Changes

- **Workbook order, first 50**: worksheet listing no longer sorts by size or
  limits to 10. `listWorkbookSheets(buffer, 50)` and
  `listLegacySheets(buffer, 50)` return the first 50 sheets in workbook order
  (empty sheets skipped) with the total count for the picker title.
- **Actual data extents**: the stored `<dimension>` element (which includes
  formatting-only cells) is no longer used for sizes. `dataExtent` does one
  linear pass over `<v>` and `<is>` markers, resolving each to its enclosing
  cell reference; formatting has neither marker, so it never counts. The
  legacy path uses SheetJS `!ref`, which is already value-based.
- Picker no longer badges a "best match" for worksheets (nothing is ranked).

## Performance note

The first version of the extent scan walked rows and did per-cell
`indexOf` lookups that ran to end-of-document, going quadratic on
formatting-heavy sheets: 183-sheet workbook took **9.7 s** for 50 sheets.
Rewritten as a single marker-driven pass: **294 ms** for the same 50 sheets
(previous dimension-only time was 477 ms, with inflated sizes).

## Verified

- `solar.xlsx` (183 sheets): `CP Bills City Jan 2022` now reports **100 x 27**
  instead of the stored dimension's 6,613 x 1,373.
- Legacy `.xls`: `Totals` then `Top Routes` in workbook order, listed in
  656 ms.
- 88 tests pass, including order/limit, formatting-only-row exclusion, and
  inline-string extents.
