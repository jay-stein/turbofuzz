# 2026-10-03 — Wide-dataset latency pass (russian_house_train.csv)

## Profile (30,471 rows x 292 columns = 8.9M cells)

Worker load path before:

| stage | before | after |
|---|---|---|
| parse (Papa) | ~700 ms | ~580 ms (unchanged code) |
| transpose | ~140 ms | ~135 ms |
| create (types/stats) | ~1250 ms | **~930 ms** |
| dataset stats | ~400 ms | **~263 ms** |
| per-column metadata (numbers + histograms) | ~3000 ms | **~606 ms** |

Queries were already sub-ms on this file; sort 1-6 ms; typing 0.2-0.7 ms.

## Changes

1. **`parseNumber` fast path** (`9583046` era parse fn): plain numeric strings
   (`123`, `-4.5`, `0.189`, `1e5`) go straight through `Number()` with a
   hex/octal/binary guard; the regex/separator/currency path only runs for
   formatted values. This was the single biggest cost — it ran once per cell
   for every numeric column in both inference and `numbers()`.
2. **`numbers()` drops its `isNullToken` call**: every null marker already
   parses to NaN, so the check was redundant per cell.
3. **`isNullToken` fast rejects digit-leading values** without allocations
   (most cells in numeric files), and negative numbers via `-digit`.
4. **Ingest pre-inference**: a sample-only guess picks a plain distinct `Set`
   for columns that will be numeric/date, skipping frequency-map updates.
5. **`valueLength`** avoids `trim()` allocation when a value has no edge
   whitespace.
6. **Column-major row hashing** in dataset stats for cache locality.
7. **UI**: summary cards render in animation-frame chunks (36 first, then
   per frame) and use `content-visibility: auto` with intrinsic sizes, so
   hundreds of column cards and filter cards skip offscreen layout/paint.

## Verification

- 68 tests pass (new parseNumber edge cases: hex, binary, Infinity, `5.`,
  `.5`, `1 234`, leading zeros).
- `bench:real` on the same file: build/types/stats 1968 -> 1524 ms with
  queries unchanged.
- 1M x 5 app smoke unaffected; combined query p50 ~0.3 ms.
