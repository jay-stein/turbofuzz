# 2026-10-03 — Null cell highlighting

## Goal

While the Null rows filter is active, show *which* cells are null, in a muted
red (#FAA18F) rather than anything abrasive.

## Design

- `ResultTable.setNullHighlight(active)` toggles a render mode; `fillCell`
  checks each visible value with the shared `isNullToken` detector and adds a
  `.null-cell` class. Empty strings, whitespace, `N/A`, `NULL`, `-`, Excel
  errors and every other recognised marker all tint.
- No protocol or worker changes: only ~40 visible rows x visible columns are
  checked per repaint, reusing the exact ingest-time semantics (so what is
  tinted always matches what the filter counts as null).
- The class is applied per cell, so the row's zebra striping stays visible
  between null cells.
- Wired in `App.toggleSpecial` (on/off) and reset by Clear all; a new dataset
  starts with a fresh table.

## Styling

```css
--null: #faa18f;
--null-text: #4a1d13;
.td.null-cell { background: var(--null); color: var(--null-text); }
```

Explicit dark text keeps contrast in both light and dark themes.

## Verification

- 69 tests pass, typecheck and production build clean.
