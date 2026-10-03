# 2026-10-03 — Facets, phonetic search, histograms

## Goal

Three query-UX features on top of the worker architecture, all designed to
add ~0 ms to the interactive path.

## Faceted counts (`d3ea693`)

- After each query the worker computes per-value counts for category/boolean
  columns, excluding each column's own filter (standard faceting semantics).
- Implemented with `BitSet.andCount(other)` — AND + popcount in one pass, no
  intermediate allocation. ~0.2 ms per 8-value facet at 1M rows.
- `QueryEngine.evaluateBits(filters, excludeColumn)` added.
- UI dims zero-count values (`.value-row.zero`) but never hides them; counts
  update in place, the list is never rebuilt.

## Phonetic / "sounds like" (`df8503d`)

- `double-metaphone` (2.0.1, ESM, typed) encodes each **distinct token** once
  during the existing lazy fuzzy-index build into `Map<code, tokenIds[]>`.
- Query = normalize → Double Metaphone (primary + secondary) → hash lookup →
  posting-list expansion. No row scanning, no per-query encoding of data.
- Falls back to fuzzy when a code lookup returns nothing.
- Measured: **0.054 ms** at 100k rows, **0.386 ms** at 1M.

## Histograms (`f942608`)

- `ColumnData.histogram(64)`: one cached O(rows) scan per numeric/date column
  at ingest (~1-2 ms at 1M).
- Filtered histograms computed in the worker for range-filtered columns
  only, excluding that column's own filter, so the full baseline stays visible
  with the selected band highlighted (`hist-bar.selected` / `.dimmed`).
- Pure DOM bars (64 divs), no canvas.

## Verification

- `npm test`: 39 tests pass.
- `npm run build`: main 25.5 kB (8.6 kB gzip), worker 45.6 kB.
- Queries remain ~0.1 ms at 100k / ~0.4-1.1 ms at 1M (bench:app).

## Branch state

`agent/facets-phonetic-histograms` → `f942608` (3 commits on top of
`agent/app-mvp`).
