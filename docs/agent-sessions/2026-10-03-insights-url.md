# 2026-10-03 — Insight bar and URL/table loading

## Slider fix

Integer columns snap to whole numbers and date columns to whole days; number
inputs for integer columns get `step=1`. No more `64.516…` on an integer
histogram.

## Insight bar (`1fb897c`)

- Ingest now produces `duplicateBits` (all rows that appear more than once)
  and `nullRowBits` (rows with at least one empty cell) alongside the stats.
  New stat counters: `rowsInDuplicateGroups`, `rowsWithNulls`.
- `QueryEngine.setSpecial("duplicates" | "nulls", active)` ANDs those masks
  with the normal filters; facets and histograms already respect them because
  they use the same evaluation path.
- A persistent chip bar at the top of the workspace shows
  `N rows · M columns`, `Duplicate rows: N` and `Null rows: N` as toggle
  buttons. Clear-all resets them.
- The full per-column stats modal remains on the top bar.

## URL and scrape loading (`1fb897c`)

- New Cloudflare Worker script (`worker/api.ts`) with `/api/fetch?url=…`: a
  same-origin, CORS-friendly proxy with scheme check, private-host blocklist,
  80 MB cap, and an 8 s-class fetch to the origin. Static assets keep
  asset-first routing; the script only runs for `/api/*`.
- Paste view gains a URL row: **Load URL** (downloads bytes, uses the same
  encoding detection) and **Scrape table** (downloads HTML, extracts the first
  `<table>` via DOMParser, sends it to the worker as a raw grid).
- `LoadRequest` accepts an optional `table: { rows, hasHeaders }` payload;
  `structureTable` is shared between CSV parsing and table ingestion.

## Caveats

- `multisportaustralia.com.au` returns **403** to non-browser fetches (bot
  protection) from this machine; the Worker's egress may differ. Test on the
  deployed site.
- `/api/fetch` only exists on the deployed Worker; `npm run dev` (Vite) has no
  API route, so URL loading requires the Cloudflare deployment or
  `wrangler dev`.

## Verification

- 59 tests pass (duplicate/null bitsets, special filters, scraped-table
  ingestion, preview mode, slider narrowing).
- `npm run build` and `npx wrangler deploy --dry-run` both clean; Worker
  bundles at 2.4 KiB with the ASSETS binding.
