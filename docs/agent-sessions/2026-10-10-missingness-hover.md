# 2026-10-10 - Missing values sparkline hover tooltip

## Goal

User request: hovering the missing values sparkline should show dynamic text
like "2 missing out of 23 columns (91.3% available)", following the mouse.

Clarified choices:

- Hover target: the whole sparkline gutter, mapped by row position (no need to
  hit the thin line).
- Tooltip names the row range.
- Numbers: columns with any missing cell in that block; available % = columns
  untouched / total (matches the 21/23 = 91.3% example).
- Feedback: a ringed marker on the line at the hovered block.

## What shipped

- `bucketTooltip` (`src/ui/missingness.ts`): pure formatter —
  `Rows 4,512–4,536 · 2 of 12 columns have missing values · 83.3% available`
  (single-row blocks collapse to `Row N`; 100% stays `100%`; 0 available shows
  `0.0%`).
- `nullityProfile` now also returns `affected` (columns with any missing per
  row block); the profile is computed once per `setData` and reused for the
  sparkline and tooltips.
- Hover handling on the canvas: pointer positions in the gutter map to a row
  block (`floor(y / matrixHeight * buckets)`); the tooltip follows the cursor
  inside the wrap, clamps at the edges, and hides over the matrix or on
  pointerleave. The canvas redraw is coalesced to one animation frame; the
  hovered block draws a ringed accent dot (panel-coloured ring) on the line.
- A `role="tooltip"` element lives in the wrap and is hidden by default.

## Files changed

- `src/ui/missingness.ts`, `src/styles.css`.
- Tests: `test/missingness.test.ts` (`affected` per block, tooltip text for
  affected/clean/fully-missing blocks, single-row collapse).

## Commands executed

```
npm test            # 390 tests, 390 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python check_missingness.py http://localhost:4174/ sales_demo.csv
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Results

- Hovering at two different heights gives different blocks:
  `Rows 1,128–1,152 · 2 of 12 columns have missing values · 83.3% available`
  then `Rows 4,512–4,536 · ...`; the tooltip hides over the matrix; the
  screenshot shows the ringed dot on the line.
- **21/21 budgets pass** (0 failures); 390 tests pass.

## Decisions

- The gutter strip is the hover surface (forgiving), but only the gutter — the
  matrix keeps its own clean look and the tooltip cannot fire from there.
- Availability is column-level, matching the requested wording; the aria label
  still reports the worst run percentage for screen readers.
- The worst-block marker keeps its solid accent dot; the hover marker adds a
  panel-coloured ring so both remain distinguishable when they coincide.
