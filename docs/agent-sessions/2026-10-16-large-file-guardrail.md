# 2026-10-16 — Large-file guardrail, sample loading and crash recovery

Commit `5db155b` on `agent/execution-plan`, pushed and deployed as version
`78d8f6a1-349b-4b6a-b0b9-443f570627dd`.

## Problem

Nothing stopped an analyst from loading a multi-million-row file: the load
would run the worker out of memory, the tab would hang, and — worse — the
dead worker left the session stuck (no restart, previous dataset gone).

## What shipped

- **Pre-flight estimate**: `estimateFromBuffer`/`estimateFromText` decode the
  first 256 KB, detect the delimiter, and estimate rows from the file's
  byte size and average row length. Verified on a generated 2,000,000-row,
  59.5 MB CSV: estimate 2,000,043 rows × 4 columns (0.0% error). Variable
  row lengths make this approximate, hence the "roughly" wording.
- **Three-way dialog** above ~8M estimated cells (≈3 GB+ risk by the Phase 5
  benchmarks): "Load first 100,000 rows" (primary), "Load everything
  anyway", Cancel. Cancel states that nothing was loaded.
- **Sample loading**: `LoadRequest.maxRows` flows to Papaparse's `preview`,
  so only the first N rows are materialised; the Import banner records
  "sample: first 100,000 rows of ≈5,200,000".
- **Crash recovery**: the client now restarts the worker after an OOM and
  reports via `onCrash`; the app resets to the start screen with
  "The file was too large for browser memory — the worker restarted and
  nothing is loaded. Try the sample option or a smaller file." instead of
  leaving a dead worker behind.
- Help documents the guardrail.

## Tests

- `test/load-guard.test.ts`: estimator maths (including partial-row and tiny
  samples) and the three-way dialog choices (sample / all / cancel).
- `test/ingest.test.ts`: `maxRows` previews only the first rows.

## Commands and results

```
npm test             # 583 pass, 0 fail
npm run typecheck    # clean
npm run build        # clean
npm run build && npx wrangler deploy   # version 78d8f6a1
```
