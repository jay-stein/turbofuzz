# 2026-10-03 — Scraper: Data Richness scoring (table_scraper.md adaptation)

## What was applied

From `table_scraper.md`, adapted to a **static HTML** scraper (we parse the
server response, there is no live page):

- **Candidate identification (§2.2)**: `<table>`, `[role="table"]`,
  `[role="grid"]`, `[role="treegrid"]` (covers many server-rendered
  React/Angular grids). Declarative shadow DOM roots
  (`template[shadowrootmode]`) are scanned too.
- **Exclusions (§2.3)**: `role=presentation`/`none`; statically hidden
  (`hidden`, inline `display:none`/`visibility:hidden`); grids smaller than
  2 columns / 2 rows. Grids smaller than 3 rows are deprioritised, not
  dropped, so small datasets still work when nothing bigger exists.
- **Stitching (§3, static version)**: an adjacent header-only table followed
  by a same-column-count data table is merged into one candidate.
- **Scoring (§4)**: `rows x columns x 0.4 + visibleChars x 0.3 + density x 100
  + header bonus 50`; highest score wins. `aria-rowcount`/`aria-colcount`
  raise the row/column counts when present.
- **Extraction (§5)**: same span expansion as before, header detection via
  `th`/`role=columnheader`/`role=rowheader`, whitespace normalisation, and
  reference/edit-link/script stripping from cell text.

## What is out of scope for static HTML

- **§2.1 Shadow DOM (imperative) and iframes**: not present in the response;
  cross-origin iframes are inaccessible without a privileged context.
- **§2.3 computed-style invisibility and bounding boxes**: needs layout.
- **§3 column-width matching**: `getBoundingClientRect` unavailable; column
  count is used instead.
- **§4.2 `innerText`**: no CSS engine; textContent minus known hidden nodes is
  the approximation.
- **§5.3 virtualised scrolling**: cannot scroll a static response; aria
  counts are used for scoring only, extraction is limited to physical rows.

Supporting these would require a real browser/headless rendering step (e.g. a
Playwright service), which is a different architecture from the current
client-side, zero-backend scraper.

## Verification

- 77 tests pass; new tests cover ARIA grid extraction, richer-table
  preference over DOM order, static hidden exclusion, and header stitching.
- Re-validated against the Wikipedia shopping-centre page: same 51 rows and
  correct header.
