# Session Summary: Foundation and Quick Wins

**Date:** 2026-10-18  
**Branch:** `agent/foundation-quick-wins`  
**Base:** `e1061a5` on `main`

## Goal

Start the approved implementation plan with low-risk, high-value slices before the larger chart and pivot work:

- commit the planning documents;
- establish a green baseline;
- ship chart/table quick wins;
- add safe type conversion;
- add multi-file CSV loading with provenance.

## Completed work

### Planning

- Committed `plan-loading-table-charts-pivot.md` and `charting_aggregation_ux_spec.md`.
- Baseline established before changes: 670 tests passing, typecheck passing, production build passing.

### Chart defaults and labeling

- Default qualitative palette changed to Set1.
- User-facing `Bars` renamed to `Count plot`; internal kind remains `"bar"` for compatibility.
- Updated aria labels, help copy, tests, and the default category limit from 5 to 10.

### Aggregate Barplot

- Added a new `Barplot` chart kind alongside `Count plot`.
- Barplot aggregates a numeric measure by category, supports mean/sum/median/min/max, and can split into one series per optional group value.
- Added gallery fit rules, setup-dialog fields, axis labels, CSV export, and tests.

### Custom GeoJSON and zipped Shapefile regions

- Added a `Load regions` control to Map cards. GeoJSON is parsed locally; zipped Shapefiles are parsed by lazily loaded `shpjs` (which handles `.dbf` attributes and `.prj` reprojection to WGS84).
- GeoJSON with a non-WGS84 legacy CRS is rejected with a clear message instead of being drawn wrong.
- Loaded regions replace the world basemap, fit the viewport, support reset back to the region bounds, and can be cleared back to the world map.
- Parser unit tests cover polygon/multipolygon bounds and CRS rejection.
- Choropleth join: choose a feature property, match it to a category/string dataset column, and colour regions by row count or a numeric measure with count/sum/mean/median/min/max aggregation. The join respects current table filters and uses the fixed colour-domain controls.

### Chart-scoped filters

- Aggregate-backed chart cards (value lines/bars/barplots, treemaps, and joined choropleths) now have a category/value chart filter that is independent of the table filters.
- Each card also has an `Also respect table filters` toggle, default on, so a chart can keep its own scope when the table is filtered.
- The card scope line names the active chart filter; chart filters survive column renames through the named-config mapping and are included in aggregate tests.
- Chart filters now also apply to scatter/density and map point requests, heatmap crosstabs, correlation matrices, box plots, bubble/map grids, and animated frames.
- Chart-filter coverage is exercised by worker tests for aggregate, series, crosstab, correlation, box, grid, and animation payloads.
- Geo choropleths report how many loaded regions matched the join and mark unmatched regions in the hover tooltip.

### Generated chart code

- Added idiomatic pandas and Polars generators for count/aggregate barplots, time series, KPIs, correlations, heatmaps, and scatter-like charts.
- Card menus now download `.py` files for pandas and Polars; unsupported chart kinds explain why instead of emitting misleading code.
- Generated code includes chart filters and warns when table filters were intentionally ignored; time series map grains to `resample`/`group_by_dynamic`.
- Tests cover barplot aggregation, top-N, time resampling, and unsupported-kind warnings.

### ChartSpec export

- Added a versioned `ChartSpec` model that stores fields by name, source, aggregation/calculation, chart filters, table-filter scope, and presentation settings.
- Every chart card menu now offers `Download chart spec (JSON)`.
- Unit coverage verifies named fields, filter labels, calculations, and JSON round-trip; the menu test verifies discoverability.
- The spec is the foundation for generated chart code and future re-import.

### Stacked Barplot

- Grouped Barplots gain a `Stack groups` option alongside the default side-by-side layout.
- Stacked scaling uses the per-category positive total, draws segments bottom-up, and labels the note as stacked.
- The control appears only for Barplots with a Group and resets cleanly to side-by-side.
- Config coverage asserts the layout survives chart setup.

### Density viewport correction

- Density heat grids, contour bands, and contour lines now crop to the active pan/zoom viewport instead of stretching the full grid into the visible frame.
- Cropping preserves cell counts and recomputes the visible peak; axes, notes, and sampling labels match the visible cells.
- Unit coverage verifies cropped dimensions, counts, bounds, and peak.

### Pivot resampling

- Time views now expose a `Resample` grain control (hour through year) that rewrites the first time dimension, enables zero-fill, and orders buckets ascending.
- Existing empty-period and partial-period controls continue to apply, making resampling a one-control operation.
- Component coverage asserts the request uses the chosen grain and zero fill.

### Chart calculations

- Aggregate-backed chart cards now expose a `Calc` selector: rolling mean (7), cumulative, difference, % change, % of total, rank, and year-over-year.
- Calculations use the shared post-aggregation engine and remain non-destructive; the active calculation is shown in the card scope line.
- `None` clears the calculation without touching the data or measure.

### Explicit count aggregates

- Chart aggregation now offers `Count non-null` and `Count distinct` alongside mean/sum/median/min/max; row counts remain the count plot / no-measure path.
- Both selections flow through the shared aggregate engine, CSV export, axis labels and chart tests.

### Provenance columns

- `_input_filename` (and suffixed variants) is now marked as a `provenance` role on both the worker column and `ColumnMeta`.
- Duplicate detection, empty-row counts, completeness/null totals, quality findings, anomaly findings, and default chart suggestions skip provenance columns.
- Tests assert the role survives multi-file ingest and that identical content from different files still counts as duplicate rows.

### Multi-column pivot layouts and fill controls

- Pivot builder now shows an R/C layout bar: click a field to move it between the row index and nested column headers, with a live active state and an explicit `R = row index, C = column field` hint.
- Multiple spread dimensions render as grouped, `colspan`-aware header rows; CSV export flattens them with ` / ` separators.
- Empty pivot cells can display a chosen fill value or stay blank, and `Drop empty` hides rows/columns with no values.
- Multi-measure pivots expose a `Value` selector; the matrix, margins, note and CSV all follow the selected measure.
- Margins now compute from all row and column fields, not just the first one.
- Pill styling, focus/hover states, fill input, and nested header styling were added to the pivot UI.

### Multi-field pivot rows

- Pivot View now accepts up to four dimensions; every dimension except the spread dimension forms the row index.
- The pivot matrix and CSV export render one header/cell per row-index field, so three or four dimensions can be inspected as a nested row hierarchy.
- Margins stay single-index for now; the UI suppresses them when more than one row field is active rather than showing a misleading total.

### Pivot margins

- Added an optional `Margins` toggle to pivoted views. The worker computes the All row, All column, and grand total from raw rows for the active aggregate function, so means/medians are not approximated by summing cells.
- Margins are included in the pivot display and CSV export.

### Pivot/aggregate CSV export

- Added `Export CSV` to the Pivot View actions. Normal aggregates export one row per group; the current pivot matrix exports row headers plus one column per spread value.

### Bubble and heatmap viewports

- Bubble charts now share the X/Y pan and zoom viewport used by scatter/density, with reset support.
- Heatmaps now support category-window zoom and pan on both axes, with reset support.
- Box plots now support category-window X zoom/pan and numeric Y zoom/pan, with reset support.
- Correlation matrices now support a shared row/column zoom window and pan, with reset support.
- Treemaps and top-terms charts now support item-window zoom/pan over their ranked categories/terms, with reset support.
- GeoJSON/Shapefile regions now show their label, join property and measure on hover; clicking a matched category filters to it.

### Chart CSV export

- Added `src/ui/chart-export.ts` with CSV escaping and BOM download helpers.
- Added `Download data (CSV)` to the chart card menu.
- Exports the data behind count plots, aggregate line/bar/KPI/histogram cards, bins, grouped bins, scatter/density, bubble/map grids, box plots, heatmaps, correlations, treemaps, terms, and fallback category counts.

### Table and chips

- Suggestion chips now read `Fix: …` in the table header, filter sidebar, and column inspector.
- Placeholder cleanup in the results bar now reads `Fix: convert N placeholders to missing` with a clearer explanation.

### Clean performance

- Added a no-op fast path: re-applying a clean that changes no cell returns `noop: true` without rebuilding the dataset or query engine.
- The app reports “Nothing changed” instead of recording a misleading no-op step.

### Safe type conversion

- Added `src/data/cast-ops.ts` with `coerce`, `keep`, and `reject` policies for integer, number, date, datetime, time, duration, and boolean.
- Added cast operations to the clean pipeline, including descriptions, recipe-file replay, and support-report handling.
- Added `src/ui/cast-dialog.ts`: confirms the target type, previews changed/failed counts and examples, exposes decimal/date options, supports “Reinterpret only”, and blocks reject when mismatches exist.
- Type changes from the header, command bar, Quality page, and type suggestions now use the confirmation flow.
- Added worker preview support for cast failure counts and examples.
- Casts remain undoable and appear in the Recipe; unsupported recipe targets are marked `manual_step_required` rather than generating incorrect code.

### Multi-file CSV loading

- File picker and drag/drop now accept multiple files.
- Worker-side ingestion parses each delimited file, aligns columns by normalized header name, appends extra columns, and adds `_input_filename` with the exact file name.
- Multi-file input is limited to CSV/TSV/PSV/TXT/DAT; a preflight confirmation explains that rows will be appended.
- Single-file behavior is unchanged.
- Added unit coverage for header alignment, missing/extra columns, and filename provenance.

### Chart fixes

- Map brush bounds now follow the current zoom/pan viewport instead of always mapping to the whole world.
- Fixed sequential/diverging colour scale minimum and maximum inputs for numeric colour mappings and map heat; invalid bounds are rejected with an inline message.

## Commits

- `9a90e02` docs(planning): add implementation plan and charting spec
- `c87ced4` feat(charts): default to Set1 and label bars as count plot
- `3765451` feat(charts): export chart data as CSV
- `f852fae` feat(table): label suggestion chips as fixes
- `ad9b7fd` perf(clean): skip rebuilds for no-op value cleans
- `2ffed4a` feat(data): add cast policies for type conversion
- `73f8df8` feat(table): confirm type changes with cast policies
- `224ccf9` feat(load): append multiple CSV files with input filenames
- `d322b32` feat(pivot): rename views to pivot view and widen chart top-n
- `82021b2` feat(charts): allow fixed colour scale bounds
- `9d2bb38` fix(charts): map brush follows the zoomed viewport
- `b5904e5` fix(chips): clarify placeholder cleanup action
- `2a194a2` docs(readme): document multi-file load cast safety and chart updates
- `1d9206f` feat(charts): add aggregate barplot
- `28ae6e0` feat(charts): add pan and zoom to bubble charts
- `a2e9b62` feat(pivot): export aggregate and pivot results as CSV
- `c2360ec` feat(charts): zoom and pan heatmap categories
- `7a1a153` feat(pivot): add worker-computed margins
- `3814a27` feat(charts): zoom and pan box plots
- `d8aa0a8` feat(charts): zoom and pan correlation matrices
- `17c5ca6` feat(charts): zoom and pan treemaps and terms
- `8f14d58` feat(charts): inspect and filter geojson regions
- `b338aa2` feat(charts): add chart-scoped aggregate filters
- `292eab1` feat(charts): filter point, crosstab and correlation requests
- `d021fc1` feat(charts): filter box, grid and animation requests
- `b9084de` feat(pivot): support multi-field row indexes
- `622787a` feat(pivot): add multi-column layouts and fill controls
- `644779e` feat(pivot): let multi-measure pivots switch values
- `172c4e0` feat(ingest): mark provenance columns and exclude them from stats
- `51846bc` feat(charts): expose non-null and distinct count aggregates
- `36f5288` feat(charts): add non-destructive measure calculations
- `32dced0` feat(pivot): add resample grain control
- `786cbe8` fix(charts): crop density grids to the viewport
- `d5f963a` feat(charts): add stacked grouped barplots
- `fc4339e` feat(charts): add portable chart spec export
- `18affde` feat(charts): generate pandas and polars chart code
- `1580efe` feat(charts): load geojson and zipped shapefile regions
- `21836d1` feat(charts): join geojson regions to dataset measures

## Validation

Final state after the session:

- `npm run typecheck` passes.
- `npm test`: 692 tests passing.
- `npm run build` passes.
- No network or eval paths were introduced.
- Pre-existing untracked files `DATA_QC_SPEC.md` and `UX_IMPROVEMENT_BACKLOG.md` were left untouched.
- Nothing was pushed.

## Decisions

- Keep internal chart kind `"bar"` for count plots; use labels rather than a risky key migration.
- Cast recipes that cannot be represented faithfully are marked manual instead of emitting silently different pandas/Polars code.
- Multi-file append aligns columns by normalized header name and uses the first file’s column order.
- `_input_filename` is currently a normal string column; the planned provenance-role/statistics exclusion is still outstanding.
- Multi-file loads intentionally support delimited text only in this slice; workbook/sheet append remains future work.

## Remaining backlog

1. Provenance role for `_input_filename` so it does not distort duplicate/empty-row/DQ metrics or default chart suggestions.
2. Remaining chart module extraction (`chart-spec`, `chart-viewport`, `chart-color`).
3. Chart aggregation core: ChartSpec, explicit row/non-null/distinct counts, chart-scoped filters for remaining bins/text requests, time grain controls, chart calculations.
4. Extend the new Barplot with error bars, orientation, dodge/stack, explicit ordering, and hue limits.
5. Pan/zoom/reset for every chart with axes; density viewport correction.
6. Geo maps polish: remaining hover/click checks and richer unmatched-region inspection.
7. Full Pivot View: 0–3 index/column fields, multiple values/aggs, margins, fill_value, named pivots, pivot CSV and chart integration, resample-style time.
8. Batch type conversion UI and remaining table performance work.

## Follow-up: map and pivot UX (2026-10-18)

### Goal

Act on live-site feedback: reduce map disorientation, make pivot values easier to filter, and add quick layout/comparison controls.

### Changes

- Map cards now auto-fit the initial viewport to plotted point percentiles instead of opening on the whole globe. Custom regions and heat grids use their own bounds; Reset returns to the data view.
- Result-table headers gained an inline free-text contains filter. Typing is debounced, Enter applies immediately, blur flushes, and an active filter shows a funnel icon plus accent styling. It uses the existing filter engine, chips and URL-safe filter state.
- Pivot fields for text/category/boolean columns gained a value-filter action using exact comma-separated values; filters are applied to raw rows before aggregation, so margins and percentages stay correct.
- Pivot actions gained Transpose (swap index/column wells), Margin % (absolute / % of row / % of column), and Heatmap (accent / coolwarm / coolwarm reversed).
- Percentage margins are shared by the on-screen matrix and pivot CSV export. Coolwarm shading uses raw signed values; percentage cells retain raw values in their tooltip.
- Named-pivot remapping now remaps value-filter columns by name.

### Validation

- `npm run typecheck` passes.
- `npm test`: 711 tests passing.
- `npm run build` passes.
- No network or eval paths introduced.
- Pre-existing untracked files were left untouched.
## Follow-up: draggable pivot fields (2026-10-18)

### Goal

Make pivot field layout feel direct: drag fields between Index, Columns and Values instead of relying on menus.

### Changes

- Pivot field pills show a grip and are draggable. Index/Columns fields can be reordered within a well or moved between wells; Values can be reordered.
- A dimension dropped on Values becomes a measure (mean for numeric columns, count for text/category/boolean columns). A simple measure dropped on Index/Columns becomes a dimension.
- The drag target well is outlined while hovering, the source pill dims, and invalid moves explain themselves in the status line.
- Index invariants are preserved: the final Index field cannot be moved to Columns. Custom/calculated/conditional measures and grouped time/bin dimensions are not silently converted.
- The existing arrow buttons, well toggles and remove controls remain as keyboard/click fallbacks.

### Validation

- `npm run typecheck` passes.
- `npx tsx --test test/views-panel.test.ts`: 17 tests passing.
- Drag conversion and guard cases are covered by pure `movePivotField` tests.
## Follow-up: pivot field shelf and percentage display (2026-10-18)

### Goal

Make the pivot builder feel like a field-list pivot UI and clarify percentage display.

### Changes

- Added an always-visible bounded "All fields" drag box with larger text, every dataset field, type labels, a search box and used-in-view indicators.
- Shelf chips are draggable into Index, Columns or Values. Clicking a chip offers the same three destinations.
- Dropping a shelf column that is already grouped moves that field instead of duplicating it. Dropping it on Values converts or adds the appropriate mean/count value.
- Transpose sits in a full-width action row directly below the All columns shelf and above the result-status line, with a large letter T plus exchange arrows and the word Transpose.
- Renamed the percentage control to "Show as" and added "% of grand total" alongside row/column. Values use 1 decimal place on screen and in CSV.
- Renamed the margins checkbox to "All totals" so it is clearly separate from percentage conversion.

### Validation

- `npm run typecheck` passes.
- `npm test`: 727 tests passing.
- `npm run build` passes.
- New tests cover shelf-column moves and grand-total CSV percentages.
### Guards and time grouping

- Pivot column groups are capped at 500. Larger spreads are truncated with an inline warning showing the displayed and total column counts.
- Date/datetime fields dragged from the field shelf or chosen with + Field default to month buckets, with the normal field menu available to switch to exact values, day, quarter, year or other grains.
- Increased pivot builder, shelf and field text sizes so the drag source and destination wells are easier to scan.
## Follow-up: percentage bases and pivot value filters (2026-10-18)

### Fixes

- Percentage display now divides by the sum of the displayed base cells for row, column and grand-total modes. This keeps percentages at 100% or below for ordinary positive additive and averaged values, and invalid denominators render blank rather than raw numbers with a % sign.
- Pivot dimension filters use a proper funnel icon with an active-value count badge.
- Replaced the exact comma-separated prompt with a searchable value picker: checkboxes, value counts, custom exact values, Apply and a dedicated Clear filter action.
- Field filters are only offered for genuinely pivoted views, where the worker applies them to raw rows.
## Follow-up: remove dataset materialisation and enlarge view headers (2026-10-18)

- Removed the "Use as dataset" action and its callback/application path from Views.
- Replaced the view expand/collapse glyph with a 34px top-left plus/minus icon button.
- Doubled view title size to 26px. Collapsed cards keep the title visible alongside the summary.
## Follow-up: Excel-style multi-date hierarchies (2026-10-18)

- Date and datetime fields can now add a nested hierarchy of Seconds, Minutes, Hours, Days, Months, Quarters and Years in one action.
- The hierarchy dialog is available from a date field's grain menu and directly from the field shelf as Index or Columns groups.
- Applying a hierarchy replaces existing time-grain fields for that column in the same well, preserving the well position and avoiding duplicate grains.
- Added second-grain bucketing, labels, stepping and period indexes to the aggregation engine.
- The existing 500-column cap remains the safeguard for date hierarchies placed in Columns.
## Follow-up: pivot report filters (2026-10-18)

- Added a Filters well to pivoted views. Any dataset column can be filtered, including fields not present in Index, Columns or Values.
- Active report filters appear as chips with a funnel, value count and individual clear button; a Clear all action removes every pivot filter.
- The field shelf menu now offers "Filter values..." for any field, opening the same searchable value picker.
- Report filters are only shown when the view is actually pivoted, so filters cannot silently do nothing in aggregate-only views.
- Extended the filter UI test to assert a report filter on a column absent from the pivot layout.
## Follow-up: typed pivot filters (2026-10-18)

- Numeric fields now filter with Equals, Does not equal, Greater/Less than, Greater/Less than or equal, Between, Above average, Below average, Is blank and Is not blank.
- Date/datetime fields use On, Before, After, On or before, On or after, Between, Is blank and Is not blank.
- Free-text fields use Equals, Does not equal, Contains, Does not contain, Begins with, Ends with, Is blank and Is not blank.
- Category/boolean fields use a checkbox picker for up to 20 values with Is one of, Is not one of, Is blank and Is not blank. Larger categories switch to the fuzzy text filter editor.
- Report filters and dimension funnels share the same type-aware editor. Active filter descriptions and counts now handle all operator kinds.
- Pivot filter definitions support typed number, date, text, value-set and blank filters; the worker evaluates them against raw rows before aggregation.
## Follow-up: draggable filters and filter stats (2026-10-18)

- The Filters well now accepts field-shelf drops, just like Index/Columns/Values. Dropping any field opens its type-aware filter editor; dropping a dimension or measure reuses its source column.
- Filter popovers show a compact stats strip before the controls: Min/Max/Average/Non-null for numeric fields, Earliest/Latest/Non-null for dates, and Distinct/Non-null/blank or length ranges for text and categories.
- The shelf hint now names Filters as a drop destination.
## Follow-up: table operators and chart source hierarchy (2026-10-18)

- Table numeric filters now offer Between, Equals, Does not equal, Greater/Less than, Greater/Less than or equal, Above average, Below average, Is blank and Is not blank.
- Table date/datetime filters offer Between, On, Before, After, On or before, On or after, Is blank and Is not blank. The histogram slider remains available for Between.
- Added compare and blank filter kinds to the query engine with cached, bitset-backed evaluation.
- Chart source selectors now group options into Table data, Pivot views and Saved views, putting pivot results at the same hierarchy level as the table.
- Chart cards retain pivot-view sources as first-class bindable data sources.
## Follow-up: typed table-header filters (2026-10-18)

- Numeric/date/time/duration header quick filters now open a compact operator popover instead of a contains-only text box. It supports the same between/comparison/average/blank operators as the sidebar.
- The popover shows min/max/average or earliest/latest stats before the controls.
- Text and category header filters retain the inline contains input.
- Header filter rows are pinned to the bottom of their grid cells, so their inputs/buttons align vertically even when QA chip rows differ in height.
- Active typed header filters show a concise operator/value summary and the funnel icon.