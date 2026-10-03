# 2026-10-03 — Resizable table columns

## Design

- `ResultTable` keeps a per-column width array (default 180px, clamped
  56–720px) and builds the grid template from it for the header, spacer and
  every visible row.
- The header cell is now a div containing the sort button (`.th-label`) and a
  thin drag handle (`.col-resize`) on the right edge. Dragging updates only
  the grid templates of the header and currently rendered rows — no data
  fetch, no re-render, no cache invalidation.
- Double-clicking a handle resets that column to the default width.
- Widths persist for the lifetime of a dataset (the table instance is reused
  across filter/sort changes) and reset when a new dataset is loaded.

## Verification

- Typecheck, 64 tests and production build clean.
- Main bundle 13.2 kB gzip.
