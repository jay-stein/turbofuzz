# 2026-10-10 - Grouped time series (one line per category)

## Goal

User request after Phase D: the Time series card drew a single aggregated
line and had no way to split it. Add a **Group by** picker so a date column
can be plotted as one line per category, with a legend and per-group hover
values. New branch `agent/chart-grouped-lines` off `agent/ux-spec-phase-d`.

## What shipped

- **Worker** (`src/data/chart-bins.ts`, `src/worker/search.worker.ts`,
  `src/worker/protocol.ts`, `src/ui/worker-client.ts`): new
  `getGroupedBins` request and `groupedBins` response. `groupedBinValues`
  ranks category codes by filtered volume, gives the top 8 their own bins and
  folds the rest into an Other bucket, using the same range/bins as the
  ungrouped chart. `total`, `below`, `above` and `overflow` are reported once.
- **Chart card** (`src/ui/chart-card.ts`): a `Group` tagged picker appears on
  Time series cards when the file has category columns; `groupColumn` is part
  of the card config, so Duplicate, PNG and transform remapping keep it.
  Grouped cards draw one line per category (palette colours, shared count
  axis, automatic date range), a clickable legend that toggles line
  visibility (aria-pressed, not a filter), and a `groupedSeriesHitRegions`
  tooltip listing the date range plus every visible group's count. Clicking a
  slot still sets the existing date-range filter. The canvas label reads
  "Time series of order_date by region, 6,015 rows shown".
- **Panel/app**: `requestGroupedBins` plumbed through `ChartsPanel` and
  `ensureCharts`; `configToNames`/`remapChartConfigs` carry `groupColumn`.

## Files changed

- `src/data/chart-bins.ts`, `src/worker/protocol.ts`,
  `src/worker/search.worker.ts`, `src/ui/worker-client.ts`,
  `src/ui/chart-card.ts`, `src/ui/chart-panel.ts`, `src/ui/app.ts`,
  `src/styles.css`.
- Tests: new `test/chart-bins.test.ts`; `test/chart-hits.test.ts` (grouped
  slot tooltips), `test/worker-chart-stats.test.ts` (worker payload),
  `test/ui-charts.test.ts` (legend labels, toggling, aria label, tooltip),
  `test/chart-panel.test.ts` (config fixtures).

## Commands executed

```
npm test            # 370 tests, 370 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python measure_post_import.py http://localhost:4174/ sales_demo.csv
python check_grouped_lines.py http://localhost:4174/ sales_demo.csv
python check_perth_click.py http://localhost:4174/ sales_demo.csv
python check_phase_d.py http://localhost:4174/ sales_demo.csv text_only.csv
```

## Results

- **21/21 budgets still pass**; the only movement is B11 controls above the
  first plot 5 → 6 (the Group picker) and B10 canvas bottom 602 → 636 at
  1280×720, both inside budget.
- `check_grouped_lines.py` 7/7: Group by region gives 6 legend entries and
  "6 lines by region"; the canvas label names the grouping; a legend click
  hides a line ("5 of 6") without changing the row count; clicking a slot
  sets a one-chip date range filter.
- Perth bar click still filters to 977 rows; Phase D smoke checks still 13/13.

## Decisions

- **Legend toggles visibility, not filters.** Filtering on a legend click
  would collapse the other lines to zero and change the row count; a legend
  is expected to control the drawing, so `hiddenGroups` is session-local on
  the card.
- **Top 8 + Other** is fixed rather than a setting; the bar card's Top bars
  control is not shown on line cards to keep the header at one row.
- Grouping is line-only for now; scatter/density already have a Colour
  column and the other kinds have no natural group axis.

## Next

Optional follow-ups if wanted: keyboard focus for bars/legend (deferred from
WI-17), and a Top lines setting for grouped charts.
