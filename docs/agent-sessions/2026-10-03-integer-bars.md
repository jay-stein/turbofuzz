# 2026-10-03 — Numeric stat cards use mini bar charts

## Problem

Numeric/date stat cards used an open SVG polyline with a fill, which shaded
odd wedges between the line and its closing segment — the "weird" look.

## Fix

`buildMiniHistogram` renders the cached histogram bins as actual bars:

- Bins are downsampled to at most 32 by summing groups so bars stay wide
  enough at card width.
- Heights scale to the tallest bar (8% minimum for non-zero); hover shows the
  exact count and its share of the column.
- Styling matches the filter-panel histogram: soft accent bars, solid accent
  on hover.

No data changes, no extra worker requests. Typecheck, 64 tests and build all
clean.
