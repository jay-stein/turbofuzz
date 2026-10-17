# 2026-10-16 — Execution plan Phase 4: ingestion benchmark, progress and cancel

Branch `agent/execution-plan`, commit `8ab3bc3`. Checkpoint E: repeatable
baseline for all chosen fixture sizes, testable progress states, predictable
cancellation and recovery.

## What changed

- Progress protocol: `read → parse → infer → build → stats → index → sort →
  ready`, each load message carries the load `requestId` so stale progress
  cannot repaint a newer import. `cancelLoad`/`loadCancelled` round out the
  contract; `cancelLoad` has no requestId of its own.
- `ingest.ts` splits into `prepareGrid` (decode/parse/header detection) plus
  sync `ingestDataset` and cancellable `ingestDatasetAsync`. The async column
  build (`buildDatasetAsync`) yields every 4 columns and aborts cleanly;
  `computeDatasetStats` runs as the final non-chunked pass.
- Cancellable scope: file buffers, tables > 50k cells and pastes > 1 MB.
  Small pastes stay synchronous (nothing to cancel), which also keeps every
  existing worker test exact.
- Worker: `handleLoad` tracks the active load, checks cancellation between
  phases and never swaps state on cancel; parquet shares the chunked build.
- Client: `LoadCancelledError`, `cancelLoad()`, requestId-based stale-progress
  filtering and `currentLoadId` cleanup on loaded/error/cancelled.
- App: Cancel button in the load panel; cancelled imports say the loaded data
  is unchanged; failures name the file, the reason and the next action.
- Tests: `test/worker-load-cancel.test.ts` proves a cancelled big load posts
  `loadCancelled`, never `loaded`, and leaves the previous dataset queryable,
  and that big loads report phased progress tied to their requestId.

## Benchmark (`npm run bench:ingest`)

Seeded fixtures at 100k / 500k / 1.5M rows: narrow (3 numeric), wide (40
mixed), high-cardinality strings (3), messy (invalid dates, -999/blank
amounts, null tokens, ragged rows). Results: `bench/results-ingest.md` +
`bench/results-ingest.json` (regression baseline). Memory is Node RSS, a
labelled proxy — browser memory is not measurable in this environment.

Highlights (single warm process; RSS grows across cases because V8 retention
is lazy):

| Case | parse | ingest (parse+build+stats) | filter p50 | sort p50 | RSS after |
|---|---:|---:|---:|---:|---:|
| narrow 100k | 54 ms | 278 ms | 0.15 ms | 39 ms | 293 MB |
| wide 100k × 40 | 337 ms | 2831 ms | 0.03 ms | 32 ms | 845 MB |
| messy 500k | 604 ms | 1578 ms | 0.08 ms | 180 ms | 1.4 GB |
| narrow 1.5M | 1027 ms | 3649 ms | 0.24 ms | 580 ms | 2.2 GB |
| strings 1.5M | 1524 ms | 3660 ms | 0.31 ms | 4530 ms | 2.3 GB |
| messy 1.5M | 1228 ms | 5562 ms | 0.31 ms | 569 ms | 2.9 GB |

The cell budget (`--max-cells`, default 20M) skips wide 500k/1.5M with a
printed reason; Parquet fixtures are not generated because the project has no
offline Parquet writer (reader-only via hyparquet).

## Decision note for Phase 5 (per the plan's task 1)

Dominant costs, in order:

1. **Peak memory**, not parse latency: ~2–3 GB RSS at 1.5M rows and 845 MB
   for a 100k × 40 wide file. The load path holds the decoded string, the
   Papaparse grid, per-column `string[]` copies and then the dataset's bitsets
   and maps simultaneously; V8 retention pushed RSS upward monotonically
   across benchmark cases.
2. **Build + stats** is 60–80% of ingest time (wide 100k: 2.2 s of 2.8 s).
   `computeDatasetStats` allocates a `Map<number, group array>` over row
   hashes — the largest avoidable allocation for all-unique rows.
3. **Sort/transform on high-cardinality strings** at 1.5M: 4.5 s each for
   `buildRank` (string comparator) and a dedupe rebuild.
4. Category bitsets scale as rows × distinct values and are eagerly built for
   every category/boolean column in `metaFor`; wide fixtures show this.

Recommended Phase 5 increment (measure before/after with `bench:ingest`):
batched/streamed column builders that release the grid as columns fill;
duplicate detection without per-hash arrays (bucket counts first, arrays only
for real duplicate groups); and a bound for category bitsets on
high-cardinality columns with a fallback scan path. Each change must move the
benchmark or be reverted.

## Commands and results

```
npm test             # 571 pass, 0 fail
npm run typecheck    # clean
npm run build        # clean
npm run bench:ingest # full baseline written to bench/results-ingest.{md,json}
```
