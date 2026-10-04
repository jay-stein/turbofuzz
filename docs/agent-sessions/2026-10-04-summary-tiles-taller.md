# 2026-10-04 — Taller summary tiles with top-5 values

## Changes

- Stat cards grow from 104px to 142px tall (contain-intrinsic-size updated),
  so the summary band uses the available vertical space. The QA block
  stretches to match.
- Category tiles show the top 5 values instead of 3; the ingest-time bounded
  top-N selection in `ColumnData.create` now keeps 5 (`TOP_VALUES`), with the
  same replace-smallest invariant (no full sort of keys).
- Numeric/date sparklines grow from 26px to 42px tall for a clearer shape.
- Top-value label width 54px → 58px; row gap 2px → 3px.

## Verification

104 tests (top-values test now expects all four values with exact counts).
Typecheck and build clean.
