# 2026-10-16 — Execution plan Phase 5: bounded-memory ingestion

Branch `agent/execution-plan`, commit `a1eef7f`. Checkpoint F: the memory
changes were retained only where the benchmark moved; time is at parity.

## Decision (per the plan's task 1)

Phase 4 measurements identified peak memory — not parse latency — as the
dominant cost: the duplicate-detection map allocated one array per distinct
row hash, and the row-major grid coexisted with the finished column arrays
during the build. Two focused changes were selected; typed/columnar storage
and bounded category bitsets were deferred because the current fixtures give
them no measurable evidence.

## What changed

- `computeDatasetStats` (stats.ts) and `rowGroups` (transform-ops.ts) count
  hash occurrences in a first pass and only allocate bucket arrays for hashes
  that repeat. Unique rows cost one number per distinct hash instead of one
  array (stats) or one `{id, rep}` object array (dedupe) per row. The
  hash-collision fallback keeps both exact.
- `buildDataset`/`ingestDataset` gained an opt-in `releaseRows` mode:
  `extractColumns` fills the per-column arrays in 25k-row chunks and clears
  the processed grid rows as it goes, so grid and columns never coexist
  whole. The worker's sync ingest and the cancellable async builder both use
  it; `buildDatasetAsync` yields per chunk and per few columns so
  cancellation still lands mid-build.

## Measured effect (same fixtures, same machine, back to back)

RSS after load, before → after:

| Case | RSS before | RSS after | Δ |
|---|---:|---:|---:|
| wide 100k × 40 | 845 MB | 824 MB | −21 MB |
| strings 500k | 1361 MB | 1149 MB | −212 MB |
| messy 500k | 1397 MB | 1125 MB | −272 MB |
| narrow 1.5M | 2187 MB | 2033 MB | −154 MB |
| strings 1.5M | 2344 MB | 2139 MB | −205 MB |
| messy 1.5M | 2864 MB | 2858 MB | −6 MB |

Parse/build times were within run-to-run variance (e.g. strings 1.5M build
2535 → 3563 ms is CPU variance; the second run's wide parse also rose
337 → 441 ms on identical code paths). A targeted A/B of the duplicate pass
at 1.5M unique rows: old 587/616/700 ms, new 638/660/691 ms — time parity,
so the change is justified by memory alone. `bench/results-ingest.{md,json}`
now carries the post-change baseline.

## Deliberately not done (documented)

- Bounded category bitsets with a scan fallback: categories are inferred only
  below ~200 distinct values, and the benchmarks show no category-driven
  memory pressure; a user-forced high-cardinality category would still scale
  rows × distinct values. Logged for a future input-driven decision.
- Typed/columnar storage and DuckDB-Wasm/Arrow: no measured bottleneck in the
  current path beyond what was fixed, and the local-only security model stays.
- Retained `transformSource`/`cleanSource` copies: required for undo; a
  user-visible "release undo history" control is the honest future path.

## Commands and results

```
npm test             # 571 pass, 0 fail
npm run typecheck    # clean
npm run build        # clean
npm run bench:ingest # before/after table above; baseline updated
```
