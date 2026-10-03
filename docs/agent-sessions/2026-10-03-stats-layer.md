# 2026-10-03 — Stats layer (duplicates, nulls, simple stats)

## Goal

Add dataset/column statistics without adding any work to the filter path.

## Design

- **All stats computed once at ingest.** Query latency is untouched: combined
  4-filter p50 stayed at 0.06-0.07 ms at 100k rows.
- **Duplicate rows are exact.** Each row is FNV-1a hashed cell-by-cell into
  buckets; only same-bucket rows get an exact cell-by-cell comparison. No full
  row-key strings, no false positives.
- Dataset stats: duplicate rows, duplicate groups, empty rows, empty cells,
  total cells.
- Column stats: nulls, distinct (existing) plus length min/avg/max (computed
  in the existing ingest loop, effectively free) and mean/stddev (computed in
  the numeric parse pass). Median is lazy: sorts a copy of the numeric values
  only when the Stats modal is opened, then caches.
- Stats modal fills per-column details in `requestAnimationFrame` after the
  modal paints, so lazy medians never block the modal opening.

## Files changed

- `src/data/stats.ts` — hash-bucketed duplicate detection, empty/null totals.
- `src/data/column.ts` — length stats at ingest; mean/stddev in `numbers()`;
  cached lazy `median()`; resets on type override.
- `src/data/dataset.ts`, `src/data/build.ts` — `DatasetStats` on the dataset.
- `src/parse/infer.ts` — extended `ColumnStats` interface.
- `src/ui/stats.ts` — stats modal (summary grid + per-column table).
- `src/ui/app.ts` — Stats button + meta line duplicate/empty summary.
- `src/styles.css` — modal styles.
- `test/stats.test.ts` — duplicate/null/length/mean/median tests.
- `bench/app-smoke.ts` — stats and median timing output.

## Verification

- `npm test`: 28 tests pass.
- `npm run build`: 51.2 kB JS / 17.9 kB gzip (+1.4 kB gzip over MVP).
- `npm run bench:app` at 100k rows, 5 columns:
  - dataset stats pass: 55 ms (one-time)
  - length/numeric stats: free (inside ingest pass)
  - lazy median: 48 ms (only when Stats modal opens, cached)
  - combined query: 0.06 ms (unchanged)

## Notes

- Duplicate detection is exact raw-value equality (no trimming/normalisation).
- Synthetic benchmark data has no duplicates, so the 100k smoke run reports
  zero duplicates; correctness is covered by unit tests.

## Branch state

`agent/app-mvp` → `2b33ea6 feat(stats): add dataset and column statistics`
