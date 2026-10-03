# 2026-10-03 — 1M-row support: Web Worker architecture

## Goal

Make 1M-row loads feel responsive: no main-thread freeze, bounded main
memory, sampled stats, and a paste guardrail. Queries stay instant.

## Architecture

The worker now owns the dataset, the QueryEngine and the fuzzy indexes. The
main thread is a thin renderer:

- **Worker** (`src/worker/search.worker.ts`): parse, type/build, stats,
  filtering, sorting (rank arrays), fuzzy index builds, row pages.
- **Main** (`src/ui/*`): paste/upload UI, filter controls, progress display,
  a virtualised table that requests visible row pages asynchronously.
- **Protocol** (`src/worker/protocol.ts`): typed request/response messages with
  request IDs; progress messages for parse/build/index/sort phases.
- **Client** (`src/ui/worker-client.ts`): promise-based typed wrapper.

Key decisions:

- Filter results never cross the boundary wholesale; the worker returns only
  the match count and serves visible row indices. Main memory stays flat.
- File uploads are read as `ArrayBuffer` and **transferred** to the worker
  (zero-copy); pasted text is cloned once (single string).
- Sorting builds a global rank array in the worker; filtered+sorted results are
  produced by scanning the rank, so filter changes with an active sort stay
  O(rows) instead of re-sorting.
- `medianSampled(50_000)`: strided sample instead of sorting millions of
  values (1218 ms → 206 ms at 1M); exact below 50k.
- Guardrail: pasting >300,000 rows shows a dismissible banner suggesting
  file upload.
- Chunked build with yields was made unnecessary by the worker; instead the
  ingest reports per-column progress.

## Files changed

- `src/worker/protocol.ts`, `src/worker/ingest.ts`, `src/worker/search.worker.ts` (new)
- `src/ui/worker-client.ts` (new)
- `src/ui/app.ts`, `filters.ts`, `table.ts`, `stats.ts` — async worker-driven
- `src/data/column.ts` — `fuzzyBuilt`, `medianSampled`
- `src/data/build.ts` — per-column progress callback
- `src/search/query-engine.ts` — public `evaluateBits`
- `test/ingest.test.ts`, `test/worker.test.ts` (new), `test/stats.test.ts`
- `bench/app-smoke.ts` — sampled median

## Verification

- `npm test`: 33 tests pass, including a fake-`self` worker lifecycle test
  (load → rows → filter → sort → stats → setType → clear).
- `npm run build`: main bundle 23.6 kB (8.1 kB gzip); worker chunk 37.5 kB.
- `npm run bench:app -- --rows=1000000` (5 columns):
  - parse 685 ms, build 1854 ms, stats 902 ms — all in worker, UI live
  - fuzzy index 643 ms (first fuzzy use, worker)
  - sampled median 206 ms (was 1218 ms exact)
  - combined query 0.34 ms
- Browser click-through still required: the worker URL is emitted correctly by
  Vite, but this environment cannot run a real browser.

## Branch state

`agent/app-mvp` → `23b9bc7 feat(worker): offload ingest, stats and search to a worker`
