# 2026-10-10 - Overview missing values map (missingno-style)

## Goal

User request: a simple, minimal chart on the Overview that shows the table
zoomed out to the max as a heatmap — blue where data exists, dark grey for
missing — inspired by missingno's matrix.

## What shipped

- **Worker**: new `getMissingness` request / `missingness` response
  (`src/worker/protocol.ts`, `src/worker/search.worker.ts`,
  `src/ui/worker-client.ts`) backed by a pure `missingnessGrid`
  (`src/data/missingness.ts`): the table's null masks are downsampled into up
  to 240 row buckets per column; each cell holds the missing ratio (0–255),
  so sparse nulls show as a faint darkening instead of a solid stripe. The
  grid is computed over the whole working dataset (post-transform, pre-filter)
  and transferred as a `Uint8Array`.
- **UI**: `src/ui/missingness.ts` renders the section between the health tiles
  and Next steps: a `role="img"` canvas, 96px matrix + column labels (only
  when they fit, ≤ 32 columns) and a caption
  (`12 columns × 6,015 rows · blue = data · grey = missing · 2 columns
  affected`). Blue is `--accent`; missing blends towards dark grey by the
  bucket's missing share. A `ResizeObserver` coalesced to one animation frame
  keeps the canvas at its container width; `Overview.render` disposes the old
  chart instance.
- **App**: `refreshMissingness()` runs after every load/transform
  (`openWorkspace`) and after stats-changing worker updates
  (`applyDatasetStats`, covering cleans, null policies and type changes).

## Files changed

- `src/data/missingness.ts` (new), `src/ui/missingness.ts` (new),
  `src/worker/protocol.ts`, `src/worker/search.worker.ts`,
  `src/ui/worker-client.ts`, `src/ui/overview.ts`, `src/ui/app.ts`,
  `src/styles.css`.
- Tests: new `test/missingness.test.ts` (bucketing, downsampling, empty
  dataset); `test/worker-chart-stats.test.ts` (message payload);
  `test/ui-overview.test.ts` (caption, aria label).

## Commands executed

```
npm test            # 379 tests, 379 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python measure_post_import.py http://localhost:4174/ sales_demo.csv
python check_missingness.py http://localhost:4174/ sales_demo.csv
```

## Results

- **21/21 budgets still pass** (B4 landing controls 32 → 29 as the extra
  section moves some below the fold; B8 unchanged).
- `check_missingness.py` samples the canvas pixels: the sales demo shows a
  large blue field, the `customer_email` column as dark grey and `notes` as a
  faint darker stripe; caption and aria label report 12 columns, 6,015 rows,
  2 affected columns.

## Decisions

- The matrix reads the full working dataset, not the filtered result — the
  Overview describes the file, and this keeps it aligned with the health
  tiles.
- No axis/grid lines, no tooltips and no per-row resolution: at 6,015 rows the
  grid uses ~25 rows per block, which is what "zoomed out to the max" means
  here.
- Height is deliberately small (96px plot + 14px labels) so the map reads as
  a summary strip, not a hero chart.

## Next

Optional: deploy (`agent/overview-missingness` also contains the dataset
facts work from `agent/dataset-file-facts`).

## Revision (same day): faithful missingno shape

After re-reading `missingno.matrix` (the source uses `imshow` over every row,
white `axvline` separators and a right-hand completeness sparkline with
max/min dots and counts), the map was revised:

- **Proportional height**: the matrix grows with the row-block count
  (`round(buckets * 1.4)`, clamped to 96–320px) instead of a fixed strip, so
  a tall table reads as a tall matrix.
- **Column separators**: 1px panel-coloured lines between column bands when
  the bands are wide enough (missingno's white grid lines).
- **Sparkline**: a right gutter with a per-block nullity profile (grey bars
  normalised to the min–max range like missingno's `xlim [min-2, max+2]`),
  accent dot + percentage at the worst block and dim dot + percentage at the
  best, so "the middle of the table has issues" is visible at a glance.
  Caption gained `≈ N rows per block` when the grid downsamples, and the
  aria label names the worst run (`…; worst run of rows is 7% missing`).
- **Hidden-view guard**: the canvas skips drawing while its wrapper has zero
  width (Overview hidden). Without it, switching to the Chart tab triggered a
  10px off-screen render that broke budget C1; caught by the harness and
  fixed.

Re-verified: 380 tests, 21/21 budgets (`check_missingness.py` now asserts
height ≥ 300 for the 240-block sales grid, sparkline pixels in the right
gutter, the "rows per block" caption and the worst-run aria label).
