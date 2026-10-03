# 2026-10-03 — Range slider for numbers and dates

## Goal

Brush-style min/max filtering for numeric and date columns without adding
latency.

## Design

- **Dual-handle brush over the existing histogram** (`src/ui/range-slider.ts`).
  Handles snap to bin edges; the band can be dragged to move a window; a click
  on the track jumps the nearest handle; arrow keys/Home/End work for keyboard
  users. The precise min/max inputs remain and stay in sync.
- **Preview mode**: pointer moves send `setFilter { preview: true }`. The
  worker returns count + first rows only, skipping facets and histograms until
  the release commits the final value. Combined with the existing latest-wins
  queue, a drag never queues intermediate work.
- **Monotonic range narrowing** (`QueryEngine.rangeBits`): dragging a thumb
  inward produces a subset of the previous range, so the worker scans only the
  previous selection — but only when that selection is under half the column
  (scanning a dense subset costs as much as scanning the column itself).
- Highlights only invalidate the table when the rules actually change, so
  range drags don't refetch row pages.

## Benchmarks (city_temperature, 1M rows, p50/p95 ms)

| interaction | before | after |
|---|---|---|
| slider: wide drag (5-95% band) | 5.2 / 8.1 | 7.3 / 10 (plain scan) |
| slider: drag within 15% selection | — | **0.58 / 0.87** |
| histogram during own-column drag | computed each step | 0.0 (cache hit) |

## Tests

- Range narrowing equivalence across widening, narrowing and clearing steps.
- Worker preview mode returns correct count with empty facets/histograms.
- `npm test`: 56 pass; typecheck and build clean.

## Branch state

`agent/range-slider` → `7ec6667` + `47b31b2` (fast-forwarded to `main`, pushed).
