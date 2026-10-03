# 2026-10-03 — Latency tuning on real data

## Goal

Find and remove the remaining latency hotspots using real-world CSVs, with a
reusable before/after benchmark.

## Harness

`bench/real.ts` (`npm run bench:real -- --csv=... [--rows=N]`) runs a real file
through the app pipeline and times each interaction class: typing per mode,
cached repeats, range drags, histogram updates, facet toggles, combined
queries and sorting. Verified against `winemag-data-130k-v2.csv` (130k × 14)
and the first 1M rows of `city_temperature.csv`.

## Changes

1. **Prefix narrowing (`ab3d2e5`)** — contains/exact keep a stack of prefix
   result bitsets; `contains(q)` is a subset of `contains(prefix)`, so typing
   scans only the previous result and backspace is a cache hit. Falls back to
   a full scan when the query is edited mid-string.
2. **Incremental facet deltas (`ab3d2e5`)** — value selections keep their
   bitset; toggling a value is one AND/OR pass instead of re-ORing every value.
3. **Rank cache + reversed scan (`536092a`)** — one ascending rank per column;
   descending is the same rank walked backwards. Histograms cache by the
   other-filters signature, so dragging a column's own range reuses them.
4. **First page in results + latest-wins coalescing (`f6d2215`)** — the result
   message carries the first 40 rows; at most one query is in flight and a
   newer interaction replaces the pending one.

## Before / after (p50 / p95 ms)

city_temperature, 1M rows:

| interaction | before | after |
|---|---|---|
| typing: contains | 16 / 21 | **0.62 / 20** |
| typing: exact | 4.1 / 4.7 | **1.0 / 19** |
| facet: toggle | 5.8 / 9.1 | **2.2 / 6.9** |
| combined: text+range+category | 15 / 76 | **1.8 / 44** |
| slider: histogram (cached) | n/a | 0.0 / 21 |
| sort: descending | ~250 ms rebuild | **~5 ms reverse scan** |

winemag, 130k rows:

| interaction | before | after |
|---|---|---|
| typing: contains | 5.8 / 9.9 | **1.1 / 18** |
| typing: exact | 1.0 / 2.3 | 0.6 / 12 |
| combined: text+range+category | 8.3 / 9.0 | **0.79 / 3.8** |

The p95 values are dominated by the very first keystroke (a full scan is
unavoidable before there is a prefix to narrow from). Fuzzy and phonetic were
already sub-ms.

## Remaining hotspots

- `toIndices()` materialises up to 1M row ids on every query (~2–5 ms),
  dominating completed queries now that filtering is ~0.1–1 ms. A lazy
  materialisation (serve pages straight from the result bitset, materialise
  only for export) is the next candidate.
- Range drags still scan the numeric column (~5–8 ms at 1M); the BitSet is
  reallocated per step.
- First keystroke is a full scan; a value-level n-gram index would remove it
  for large datasets.

## Verification

- `npm test`: 48 tests pass, including prefix-narrowing equivalence against
  full scans, facet-delta equivalence, and rank direction tests.
- `npm run typecheck`, `npm run build` clean.

## Branch state

`agent/latency-tuning`: `ab3d2e5`, `536092a`, `f6d2215` (on top of the
benchmark commit `837824a`).
