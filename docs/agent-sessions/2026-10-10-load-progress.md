# 2026-10-10 - Load progress feedback for big files

## Goal

User request: loading a big file showed nothing for a while, and "building
columns" was vague. Give immediate feedback naming the file and its size, and
real progress through the load.

## What shipped

- **Immediate panel**: picking/dropping a file (or pasting text) shows a
  prominent panel in the paste card right away —
  `Processing big.csv · 16.1 MB` with a spinner and a progress bar, before
  the bytes are even read. `role="status"` + `aria-live="polite"`.
- **Fine-grained progress** (`src/data/build.ts`, `src/data/stats.ts`,
  `src/data/anomalies.ts`, `src/worker/ingest.ts`, `src/worker/protocol.ts`):
  `ProgressMessage` gained `current`/`total`. The build pass reports
  `Building columns (3/8)…`, the stats pass reports
  `Hashing rows (3/8)…` then `Checking outliers (3/8)…`. The panel switches
  to a determinate bar whenever numbers are known, and stays animated
  (indeterminate) for parse/read steps.
- **Routing** (`src/ui/app.ts`): all load-flow status text now goes through
  `setLoadingText`, which targets the panel while it is visible (archive
  reading, extraction, decompression, worksheet reading) and falls back to
  the small status line otherwise. The panel hides on success, on errors and
  while the archive/worksheet pickers are open.

## Files changed

- `src/worker/protocol.ts`, `src/worker/ingest.ts`,
  `src/worker/search.worker.ts`, `src/data/build.ts`, `src/data/stats.ts`,
  `src/data/anomalies.ts`, `src/ui/app.ts`, `src/styles.css`.
- Tests: `test/ingest.test.ts` (build steps expose current/total, stats
  steps include hash/outlier progress).

## Commands executed

```
npm test            # 380 tests, 380 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python check_load_progress.py http://localhost:4174/ big.csv
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Results

- `check_load_progress.py` on the 300,000-row / 16.1 MB `big.csv` captured
  all 27 detail updates via a MutationObserver: `Reading file…`, `Parsing…`,
  `Building columns (1..8/8)…`, `Computing dataset stats…`,
  `Hashing rows (1..8/8)…`, `Checking outliers (1..8/8)…`; the panel hides
  once the workspace opens.
- **21/21 budgets still pass**; the panel is hidden during measurement, so
  control counts are unchanged.

## Decisions

- Progress bars are determinate only where we truly know the step count
  (per-column build, hash and outlier passes); parse/read/decompress stay
  indeterminate, which is honest and still proves movement.
- The panel lives in the paste card (where the file was dropped); a mid-load
  screenshot shows `Processing big.csv · 16.1 MB — Building columns (1/8)…`
  with the bar filled 1/8.
- The worker posts progress from inside the build loops; the main thread
  receives them while the worker keeps running, so the bar updates in real
  time even though the worker itself never yields.

## Next

Optional: deploy (`agent/load-progress` also contains grouped time series,
dataset facts and the missingno-style map).
