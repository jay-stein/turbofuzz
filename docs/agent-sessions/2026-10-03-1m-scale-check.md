# 2026-10-03 — 1M row scale check

## Goal

Answer empirically whether the app handles a 1,000,000-row paste, and identify
the real limits. No app code changed; the smoke test gained optional column
selection and RSS reporting for honest measurements.

## Measurements (5 columns, Node 24, i5-12500H)

| Stage | 100k | 1M |
|---|---|---|
| parse (Papa + sniff) | 89 ms | 686 ms |
| build (types + stats) | 132 ms | 2,326 ms |
| - of which dataset stats | 34 ms | 1,325 ms |
| fuzzy index (name, lazy) | 82 ms | 977 ms |
| median (lazy, stats modal) | 64 ms | 1,218 ms |
| combined 4-filter query | 0.09 ms | 1.17 ms |
| RSS after dataset build | 231 MB | 894 MB

## Conclusions

- **Queries scale beautifully**: 1.17 ms for a combined fuzzy + contains +
  category + range filter over 1M rows. Bitsets (125 KB each) and the token
  dictionary are the reason.
- **Load does not**: ~3-4 s main-thread work at 1M (parse + build + stats)
  plus ~1 s for the first fuzzy index build. In the browser this is a frozen
  UI unless parsing/building moves to a worker.
- **Memory is the real ceiling**: RSS ~0.9 GB at 1M x 5 with transient CSV and
  parsed-row arrays; wide (12-column) data at 1M will approach 1.5-2.5 GB,
  which is beyond many mobile and low-RAM devices.
- **Paste path is impractical at 1M**: the clipboard text alone is tens of MB,
  and a textarea of that size is janky. File upload is the viable path.
- GC pressure adds variance (stats pass measured 0.8-1.3 s across runs).

## Recommended follow-ups (not implemented)

1. Web Worker pipeline: parse + build + stats + fuzzy index off the main
   thread with progress; transfer typed arrays back. Fixes the freeze, not
   the memory.
2. Progressive/chunked build with yields for >300k rows.
3. Approximate/sampled median instead of full sort in the stats modal.
4. Friendly guardrail above ~300k rows suggesting file upload.

## Commands

```bash
npm run bench:app -- --rows=100000
npm run bench:app -- --rows=1000000
```

## Branch state

`agent/app-mvp` → `322bcca chore(bench): report memory and select generator columns in app smoke`
