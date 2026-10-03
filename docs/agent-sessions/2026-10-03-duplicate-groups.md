# 2026-10-03 — Duplicate rows grouped together

## Goal

When "Duplicate rows" is toggled, identical rows should be adjacent and
visually separated into groups so they can be compared.

## Design

- The ingest pass already computes a 32-bit FNV hash per row; `rowHashes` is
  now kept on the `Dataset`.
- The worker lazily builds a `duplicateRank` (all rows sorted by hash, then
  row id) the first time the duplicates toggle is activated.
- When duplicates is active **and no column sort is active**, results are
  produced by scanning `duplicateRank` and keeping rows that pass the result
  bitset — so identical rows are contiguous in O(rows) without re-sorting per
  query. Activating duplicates clears any active column sort (the UI clears
  its sort indicator too), because grouping and a column sort are mutually
  exclusive.
- Result and row-page messages carry parallel `firstGroups` / `groups`
  boolean arrays marking where a new group begins. The table renders a top
  separator (`box-shadow` inset, no layout shift) on those rows.
- Hash collisions are astronomically unlikely and only merge unrelated rows
  into one visual group; correctness of filtering is unaffected.

## Verification

- 69 tests pass, including a worker lifecycle test: a 6-row dataset with two
  duplicate pairs returns count 4, groups of 2, adjacent identical rows,
  separators on first and third rows, and correct per-page flags.
- Typecheck and production build clean.
