# 2026-10-03 — Spreadsheet header detection

## Problem

Spreadsheets commonly start with title/notes/section rows and use two-deep
merged headers, e.g. `domestic_airline_activity_TopRoutes...xls`:

- Top Routes: 5 junk rows, header levels at rows 6 and 7
  (`Revenue` + `Passengers`), data from row 8.
- Totals: 7 junk rows, single header row.

## Design

`src/parse/header-detect.ts` (pure, ~2ms per sheet):

1. **Score each of the first 25 rows**: `textRatio*2 + widthRatio*2 +
   numericDataBelow*3 - selfNumeric*3`. The best score wins; a minimum score
   falls back to the first non-empty row (previous behaviour).
2. **Extend downward** while numeric data follows and rows remain text-only
   (≤20% numeric) — captures the two-deep header case, capped at 3 levels.
3. **Merge levels column-wise**, skipping blanks and de-duplicating values
   repeated by merged cells (`Revenue` + `Passengers` -> `Revenue Passengers`).
4. Returns `{ skipRows, headerRows, headers, rows, title }`; the first
   non-empty value above the header becomes the table title.

Applied through `App.loadGrid()` for both worksheet loads and URL-scraped
tables when "First row is header" is enabled. A transient status in the
results bar reports `skipped N rows · M header rows`.

## Real-file results

- Top Routes: skip 5, 2 header rows, 6,239 data rows, headers like
  `Revenue Passengers`, `Aircraft Trips`, `Distance GC (klm)`.
- Totals: skip 7, 1 header row, title `DOMESTIC/REGIONAL AIRLINES`, 106 rows.
- One cosmetic miss: the sheet's stray filter label in the header block joins
  into the first column header; inherent to the source layout.

## Tests

94 tests pass: title skipping, two-level merge, dedupe of repeated header
values, all-text tables, numeric-only fallback, empty grids.
