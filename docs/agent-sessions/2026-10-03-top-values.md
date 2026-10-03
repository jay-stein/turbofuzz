# 2026-10-03 — Top frequent values on column cards

## Goal

Show the top 3 most frequent values with labels and counts for text columns,
in addition to the distinct count.

## Design

- `ColumnData.create` already built a `Set` of distinct values for stats; it
  now builds a counting `Map` instead. Same memory order, plus one number per
  distinct key, discarded after ingest.
- Top 3 extracted with a bounded selection (compare against the current third
  place; sort only the three-element array) — no O(n log n) sort over millions
  of distinct keys.
- `ColumnStats.topValues: { label, count }[]` carries the result to the client
  in the existing metadata message. No extra worker requests.
- Summary band: non-numeric cards render three rows `label ▇▇▇ 54.3k` (compact
  counts via `Intl.NumberFormat`), scaled to the top value. Category cards use
  the same rows now, so counts appear there too.
- The full stats modal shows top values for text/identifier columns as well.

## Verification

- 64 tests pass, including exact top-3 counts with ties.
- Ingest at 1M rows unchanged within variance (build ~1.9 s, stats pass
  ~0.7 s); queries unaffected.
