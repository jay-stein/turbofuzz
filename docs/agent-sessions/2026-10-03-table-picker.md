# 2026-10-03 — Table picker for multi-table pages

## Goal

When a scraped page has more than one table, let the user choose which one to
load; one table still loads automatically.

## Design

- `html-table.ts` now exports `findDataTables(html, limit = 10)` returning
  `{ label, rows, columns, grid }[]`, best Data-Richness-Score first.
  `firstTableRows` remains as a thin wrapper for the single-best case.
- **Labels**: `<caption>` -> `aria-label` -> `summary` -> `figcaption` ->
  nearest preceding heading (bounded ancestor walk) -> `Table N`. The heading
  walk scans all previous siblings, since Parsoid-style pages insert
  `<link>`/`<span>` artifacts between a heading and its table.
- **Sizes**: data rows exclude a detected header row; columns are the expanded
  grid width. Degenerate grids (<2 rows or <2 cols) are excluded entirely, so
  the 1x1 junk tables never appear.
- **Picker UI**: a compact panel under the URL field listing
  `Table N · descriptor · 25 rows x 10 columns`, with a "best match" badge on
  the top-scored entry and a Cancel link. Clicking an entry loads that grid.
  A new download or load hides the picker. Generic names are used only when no
  descriptor exists.

## Validation

- Wikipedia shopping-centre page: 2 candidates —
  `List by gross lettable area — 50 rows x 6 cols` (best) and
  `List by number of stores — 50 rows x 5 cols`.
- 80 tests pass, including descriptor priority, generic fallback, limit and
  degenerate exclusion.
