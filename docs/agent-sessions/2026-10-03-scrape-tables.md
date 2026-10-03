# 2026-10-03 — Scraper: data-table selection and merged cells

## Symptom

Scraping
`https://en.wikipedia.org/wiki/List_of_largest_shopping_centres_in_Australia`
did not produce the expected table.

## Root cause

- The proxy fetch was fine (200, `text/html`). The first `<table>` in the DOM
  is a **maintenance notice** (`class="ambox ... metadata"`,
  `role="presentation"`), so "first table" ingestion picked junk.
- The real data table is the second one, and its header uses `rowspan="2"`
  and `colspan="2"`; without span expansion the header and body columns do not
  line up.

## Fix

`src/ui/html-table.ts`:

1. **Table selection**: skip `role="presentation"` and tables with fewer than
   2 rows or 2 columns; prefer the first `.wikitable` (Wikipedia/MediaWiki
   convention), otherwise the first data-shaped table.
2. **Span expansion**: `expandTable` flattens `colspan`/`rowspan` into a
   rectangular grid, propagating merged values across covered rows/columns.
3. **Header merge**: consecutive header-only rows are merged, so
   "Gross leasable area" + "(m²)" becomes one header.
4. **Noise removal**: `<sup class="reference">[1]</sup>`, `style`, `script`,
   `.mw-editsection` and `.noprint` are stripped from cell text.

## Verification

- Validated against the live page: 51 rows, header
  `Centre | Location | Suburb | State | Current size Area | Current size Ref`,
  body starting at Chadstone.
- 4 new tests using happy-dom (`test/html-table.test.ts`): ambox + wikitable
  selection, presentation-table skipping, body rowspan/colspan expansion,
  null when no data table. 73 tests total.
- happy-dom is a devDependency only; production bundle unchanged.
