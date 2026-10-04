# 2026-10-03 — Table ranking: area first

## Problem

On `https://en.wikipedia.org/wiki/Michael_Jordan` the "best match" was an
"External links" table (1x2). Two causes:

- The Data Richness Score weighted visible text/density above area, so a
  tiny prose-heavy table outranked a 17x13 statistics table.
- Minimum-shape filtering used total grid rows, so header + one data row
  tables (displayed as "1 row") slipped through, and navigation chrome
  (navboxes) counted as data.

## Fix

- **Ranking is now area-primary**: data rows x columns descending, DRS only as
  a tiebreaker.
- **Minimum-data filter**: candidates need 2+ *data* rows (header excluded)
  when any exist; header+one-row tables remain available as a fallback on
  pages where they are all there is.
- **Navigation chrome excluded**: candidates inside `nav`, `footer`,
  `role=navigation/contentinfo/banner/search`, or with navbox/sidebar/toc
  classes are skipped.
- **Descriptor cleanup**: `style`/`script` blocks are stripped before reading
  caption/figcaption/heading text — a TemplateStyles block had leaked CSS into
  a table's name.

## Validation

Michael Jordan page (67 raw tables): 7 real candidates, headed by
`NBA regular season statistics — 17x13 (area 221)` then
`NBA playoff statistics — 14x13`. Shopping centres page unchanged:
`List by gross lettable area — 50x6` then `List by number of stores — 50x5`.

83 tests pass (largest-area-wins, one-row fallback, navigation exclusion).
