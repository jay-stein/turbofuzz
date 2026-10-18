# Implementation Plan: Loading, Table, Charts, Pivot, and Aggregation UX

**Status:** Draft for review  
**Date:** 2026-10-18  
**Baseline:** `main` at `e1061a5`  
**Scope owner:** Product/data tooling  
**Source documents:**
- `charting_aggregation_ux_spec.md` (integrated throughout; see the specification matrix in section 9)
- `01_PRODUCT_BRIEF.md`
- `02_CORE_JOURNEYS.md`
- `07_QUALITY_GATES.md`
- `docs/map-view-spike-memo.md`

**Note:** This document is a plan only. No implementation changes are included.

---

## 1. Executive summary

This plan covers seven connected outcomes:

1. **Multi-file loading with provenance.** Load multiple CSV files in one operation, concatenate them into the existing single-dataset model, and add an exact per-row `_input_filename` column.
2. **Safe, fast type conversion.** Replace the current silent reinterpretation with a real cast flow that confirms the target type, previews mismatches, and offers pandas-style `Coerce`, `Keep invalid`, and `Reject` policies.
3. **A responsive Table.** Remove avoidable full-dataset rebuilds, re-inference, and header/row re-renders from common clean/cast operations, and support batched conversions.
4. **Unambiguous chips.** Separate filter chips from fix chips, make their effects visible, add Undo and previews where appropriate, and stop showing dataset-level cleanup as unexplained controls inside Chart view.
5. **A chart builder that supports aggregation and exploration.** Roll the charting aggregation specification into the existing chart card architecture: context-aware aggregations, explicit count semantics, time grain, numeric binning, breakdowns, category limits, chart-level filters, quick calculations, drill-down, underlying-row inspection, and a declarative chart specification.
6. **Chart presentation and interaction upgrades.** Add Set1 as the default qualitative palette, rename the current bar chart to Count plot, add a Seaborn-style Barplot, support numeric color-domain overrides, pan/zoom/reset on every chart with axes, direct chart-data CSV export, and user-supplied GeoJSON/Shapefile maps.
7. **A pandas-style Pivot View.** Rename the current View lens, support 0-3 index fields and 0-3 column fields, multiple values and aggregations, safe custom lambdas, margins, `fill_value`, `dropna`, sorting, named pivots, CSV export, and resample-style time aggregation.

The work is deliberately sequenced so that the shared aggregation model is upgraded once and reused by Chart, Pivot, and recipe generation, rather than implementing three drifting definitions.

---

## 2. Research findings

### 2.1 Data loading and dataset state

- The app has one dataset. Every successful load replaces the worker's dataset (`src/worker/search.worker.ts:507-639`). There are no dataset tabs or dataset IDs in the protocol.
- The only existing multi-file append is ZIP "Import all" (`src/ui/app.ts:1395-1427`). It builds one row grid in the UI, adds no provenance column, and loses per-file delimiter/encoding/number-locale information.
- Direct file input and drag/drop only take the first file (`src/ui/app.ts:659-693`). The input has no `multiple` attribute.
- The correct insertion point for `_input_filename` is worker-side after each file is parsed and header-detected, before `buildDataset` (`src/worker/ingest.ts:79-162`, `src/data/build.ts:102-141`).
- A UI-side `table` payload cannot preserve the `_input_filename` name in no-header mode, because `structureTable(..., false)` names every column `Column N` (`src/parse/parse.ts:60-93`).
- Adding a plain string column changes duplicate detection, empty-row detection, anomaly profiling, DQ scoring, and can allocate one category bitset per file (`src/data/stats.ts:84-184`, `src/data/column.ts:479-514`). It needs a provenance role.

### 2.2 Table, cleaning, and type conversion

- UPPERCASE is not slow because of `toUpperCase()`. Each clean:
  - replays the entire clean-op list from `cleanSource` (`src/data/clean-ops.ts:90-97`, `src/worker/search.worker.ts:1614-1682`);
  - re-runs profiling, inference, and suggestion detection in `ColumnData.create` (`src/data/column.ts:132-233`);
  - recomputes all-column hashes, duplicate groups, null rows, empty rows, anomalies, and pattern profiles (`src/data/stats.ts:84-184`);
  - rebuilds the query engine, facets, and histograms;
  - re-renders the whole table header and clears the row cache (`src/ui/table.ts:137-142`, `src/ui/app.ts:4689-4727`).
- Existing measurements: one-column trim + rebuild at 100k rows is p50 144ms/p95 150ms; 300k rows is p50 307ms/p95 321ms (`bench/results-latency.md:19,32`). At 100k x 40 columns, build+stats alone is roughly 2.5s (`bench/results-ingest.md:10-19`).
- Cast previews run the full pipeline and then apply runs it again (`src/ui/app.ts:4147-4179`, `src/worker/search.worker.ts:2159-2186`).
- `setType` is not a cast. It only reinterprets raw strings, does not canonicalize valid values, does not update null statistics, and only counts non-parsing values for number/integer/date/datetime (`src/data/column.ts:244-266`, `src/worker/search.worker.ts:915-934`).
- Current clean casts keep invalid values unchanged (`src/data/clean-ops.ts:48-80`). The pandas recipe generator nevertheless emits `errors="coerce"` (`src/data/recipe.ts:500-521`), so app behavior and generated code already disagree.
- Pandas/NumPy do not have one global "Boolean > integer > float > string" ladder. NumPy promotes bool to integer to float; strings/object win over numeric types; pandas extension dtypes add nullable variants. We will define an explicit product lattice instead of claiming exact pandas promotion.
- Pandas conversion APIs use `raise`, `coerce`, and `ignore` error policies. That maps cleanly to a "Reject / Coerce / Keep invalid" dialog.

### 2.3 Chips

- Two semantic families share one visual language (`src/ui/table.ts:421-661`, `src/ui/app.ts:3267-3359`):
  - QA count chips toggle row filters.
  - Suggestion, placeholder, and type-conflict chips mutate data or change a type immediately.
- Some destructive chips show Undo (quick cleans), others do not (suggestion/token chips).
- Suggestion counts are sampled but presented as exact. Suggestions can remain stale after `setType`.
- In Chart view, the results bar shows dataset-level chips such as `Empty cells` and `Convert to nulls (N)` without chart-specific explanation.
- There are three label implementations, which can drift (`src/data/suggestions.ts`, `src/ui/column-inspector.ts`, `src/ui/filters.ts`).

### 2.4 Charts and the charting aggregation specification

- Charts are canvas-based with a large per-kind draw switch (`src/ui/chart-card.ts:4956-4994`). There is no charting library.
- The current `bar` kind is a hybrid:
  - without a measure it is a count plot (`src/ui/chart-card.ts:6858-6949`);
  - with `valueColumn` it becomes an aggregate bar chart (`src/ui/chart-card.ts:5014-5193`, `5563-5698`).
  - Existing saved cards with a value column must be migrated to a new `barplot` kind.
- The existing builder already supports measure, aggregation (mean/sum/median/min/max), primary grouping, a second grouping dimension for some chart types, time grain, numeric bins, top-N, and Other. The aggregation engine already supports time grains, date parts, bins, weighted measures, conditions, expressions, and post-operations (`src/data/aggregate.ts`).
- Gaps against the charting spec:
  - controls are scattered across the card rather than grouped as Measure / Group by / Break down / Filters / Quick calculation / Advanced;
  - count semantics are not explicit (row count vs non-null count vs distinct count);
  - invalid aggregate choices are still offered for text/date/boolean fields;
  - default category limits are inconsistent (count bars default to 5);
  - chart-level filters do not exist separately from table filters;
  - quick calculations are available in Views but not exposed as chart calculations;
  - there is no drill-down from a time grain or "inspect contributing rows" flow;
  - there is no declarative ChartSpec shared by rendering, CSV export, and recipe generation;
  - scatter/map point sampling is not disclosed;
  - units/additivity are not addressed;
  - suggestions do not explain why they were chosen.
- Pan/zoom/reset exists for map, scatter, density, line/histogram X, and count bars (`src/ui/chart-card.ts:689-703`, `4080-4100`, `4425-4566`), but not for aggregate bars/lines, bubble, box, heatmap, correlation, treemap, or terms.
- Known interaction bugs:
  - density heat/contours ignore the viewport, so axes zoom but marks do not (`src/ui/chart-card.ts:7287-7377`);
  - map brush always maps to the whole world even when zoomed/panned (`src/ui/chart-utils.ts:579-599`, `src/ui/chart-card.ts:4408-4411`);
  - scatter/density/bubble/map have little or no hit-testing/tooltips.
- The default palette is `Pastel1` (`src/data/palettes.ts:75`). Set1 already exists. Set1's yellow and light gray need contrast treatment.
- Numeric color domains are not configurable. Numeric scatter color uses sampled points; map heat assumes a zero minimum; heatmap uses primary-color alpha; density uses a hardcoded legacy ramp; correlation uses fixed red/blue.
- Chart CSV export does not exist. The card menu only has Duplicate, PNG, Full row width, and Remove (`src/ui/chart-card.ts:2734-2761`).
- Geo support is only the bundled Natural Earth 110m TopoJSON world basemap (`src/data/topo.ts`, `src/data/world-110m.ts`, `drawMap` at `src/ui/chart-card.ts:5200-5472`). There is no GeoJSON/Shapefile parser, feature join, or user-defined region support.

### 2.5 Pivot/View page

- The current Views lens is session-only, max 2 group-by dimensions, one expanded card, and max 5 views (`src/ui/views-panel.ts:46-48`, `212-214`, `840`). Views reset on every load or transform (`src/ui/app.ts:1728-1730`).
- The pivot renderer uses only the first dimension as rows, one selected dimension as columns, and only `measures[0]` (`src/ui/views-panel.ts:1550-1619`). It keys cells by label strings, so three-level indexes would collide.
- The aggregation engine is more capable than the current UI:
  - arbitrary dimensions and multi-key group-by (`src/data/aggregate.ts:96-111`, `1326-1377`);
  - count/distinct/sum/mean/min/max/median/stddev/first/last/mode/pN/expressions;
  - time grains minute to year, date parts, week/fiscal/timezone, gap fill, partial periods, cohort/since.
- It lacks `size`, `var`, and a true user-defined lambda. The expression DSL supports arithmetic over aggregate terms only (`src/data/aggregate.ts:200-331`).
- Pandas `pivot_table` research (pandas 3.0.6):
  - `margins=True` adds one `All` row and one `All` column; pandas does not add per-level subtotals for multi-level indexes.
  - `fill_value` applies after aggregation to missing cells.
  - `dropna=True` omits group keys with NA and excludes rows with NA values before computing margins.
  - Column level order is values (when multiple), then aggfunc (when multiple), then column fields. Margins `All` is added at the last column-field level per value/agg block.
  - Multiple values + multiple aggfuncs + margins currently raises in pandas 3.0.6 because of duplicate `None` column-level names. We should support this cleanly with explicit level names and document the deviation.
- `resample` research:
  - key options are `rule`, `closed`, `label`, `origin`, and `offset`;
  - defaults are left/left for most fixed frequencies and right/right for month/quarter/year/week;
  - fixed multiples such as `3min` and calendar multiples are supported;
  - gap/upsampling semantics matter.
- The app already has a timezone-aware time bucket engine, so resample support should extend it rather than build a second engine.
- The production CSP is `script-src 'self'` without `unsafe-eval` (`public/_headers`). Arbitrary JavaScript/Python lambdas using `eval` or `new Function` cannot be supported without weakening the security model. A safe lambda mini-language is required.

### 2.6 External behavior notes

- **Seaborn barplot (0.13.2):** `x`, `y`, `hue`, `order`, `hue_order`, `estimator`, `errorbar`, `orient`, `dodge`, `capsize`, palette, etc. `countplot` is the separate count-only chart.
- **Pandas conversion:** `to_numeric(errors=...)`, `to_datetime(errors=...)`, and `astype` provide the model for coerce/reject/keep.
- **GeoJSON:** RFC 7946 uses WGS84 longitude/latitude. A valid modern GeoJSON file needs no user CRS prompt.
- **Shapefile:** `.shp` holds geometry, `.dbf` holds attributes, and `.prj` defines the CRS. Without `.prj`, coordinates are ambiguous. Projected coordinates must be reprojected before drawing on a WGS84 world map. Recommended local dependencies are `shpjs` (Shapefile/DBF/PRJ plus `proj4`) or `proj4` directly, lazy-loaded.
- **CSP:** no eval-based custom lambdas. Use a parsed expression language.

---

## 3. Design decisions

| Decision | Recommendation |
|---|---|
| Multi-file behavior | Concatenate into one dataset. No multi-dataset tabs. Align columns by normalized header name with an explicit preflight dialog. |
| `_input_filename` | Add only when more than one source is loaded. Value is the exact basename with extension (`blah_01.csv`). Force string type and mark it as a provenance column. |
| Provenance statistics | Exclude `_input_filename` from duplicate hashing, empty-row detection, anomaly profiles, DQ scoring, and default chart suggestions. It remains filterable, chartable manually, and exportable. |
| Type mismatch default | Offer pandas-like `Coerce`, `Keep invalid`, and `Reject`. Recommend `Coerce` when mismatches exist, but require explicit confirmation. |
| Conversion model | Add a real cast layer that canonicalizes valid values. Keep `setType` reinterpretation only as an advanced "Reinterpret only" mode. |
| Custom lambda | Implement a safe `lambda x: ...` parser over aggregate functions. Do not use `eval` or `new Function`. |
| Chart bar rename | Keep internal kind `"bar"` as Count plot. Add `"barplot"` for the aggregate chart. Migrate legacy `bar + valueColumn` configs to `barplot`. |
| ChartSpec | Introduce one versioned declarative chart configuration that drives rendering, CSV export, suggestions, and supported pandas/Polars generation. |
| Count vocabulary | Distinguish row count, non-null count, and distinct count everywhere: Chart, Pivot, Views, CSV headers, and recipes. |
| Chart-level filters | Add chart-scoped filters separate from table filters, with a visible "also respect table filters" toggle. |
| Category limits | Default to a readable number (initially 10 where appropriate), show the limit and any Other bucket, and allow "Show all". |
| Chart calculations | Keep them non-destructive and in the ChartSpec. Distinguish aggregation, bucketing, derived columns, window calculations, normalization, filtering, and resampling. |
| Chart CSV scope | Default to the full data behind the chart. Offer "visible window only" for zoomed/windowed charts. State sampling or aggregation. |
| Color overrides | Add `colorMin`, `colorMax`, and optional `colorCenter` to the shared color-scale module. |
| Pan/zoom | Implement a generic viewport controller. Every chart with axes gets wheel zoom, drag pan, double-click reset, and a reset button. KPI has no axes; reset is hidden/disabled with a note. |
| Geo CRS | GeoJSON assumes WGS84 and needs no prompt. Shapefile reads `.prj`; reproject projected coordinates with `proj4`; if `.prj` is missing, require an explicit CRS choice or an explicit "assume WGS84" confirmation. |
| Named pivots | In-memory, named, remapped by column name across transforms, reset on a new dataset. LocalStorage persistence is not in v1. |
| Pivot margins | One All row and one All column, computed from raw rows, not by summing cells. Support multiple values/aggs with explicit internal level names. |
| Pivot time | Support time buckets everywhere plus resample options when time is a pivot dimension. Full resample semantics are exact when time is the sole row index; with other dimensions the operation is equivalent to time-bucket group-by. Document this. |
| Aggregation consistency | Chart, Pivot, and Views compile to the same aggregation definitions and recipe generators. No divergent count or time-bucket semantics. |
| Chart/pivot persistence | Chart configs remain session state. Pivots are named analysis artifacts and stay out of the data Recipe; provide a separate "Copy pandas pivot code" action. |

---

## 4. Workstream A: Multi-file CSV loading with `_input_filename`

### A1. User experience

1. Add `multiple` to the hidden file input (`src/ui/app.ts:659-675`) and iterate all dropped files (`677-693`).
2. If exactly one file is selected, behavior is unchanged and no `_input_filename` column is added.
3. If more than one file is selected:
   - read only a 256KB prefix of each file for a preflight check;
   - show a dialog listing file names, sizes, estimated rows, common/extra/missing columns, and total estimated cells;
   - default action: "Append rows, align columns by name";
   - alternatives: "Require identical columns" or "Cancel";
   - show: "A `_input_filename` column will be added with each file's name";
   - if the combined estimate crosses the large-load threshold, offer sample/load all/cancel using one combined threshold rather than the current inconsistent 8M/20M guards.
4. Support delimited text files in v1 (CSV/TSV/PSV/TXT/DAT). ZIP "Import all" reuses the same pipeline. Multi-sheet workbook append can follow later.
5. Sort direct selections by name for reproducible concatenation. Archive entries remain path-sorted.

### A2. Worker and protocol design

- Extend `LoadRequest` (`src/worker/protocol.ts:109-120`) with a `files` array carrying per-file `{ name, buffer?, text? }`, plus multi-file options. Keep existing single-file fields for compatibility.
- Extend `SearchWorkerClient.load` (`src/ui/worker-client.ts:123-134`) to transfer all buffers.
- Add a multi-file ingest helper in `src/worker/ingest.ts`:
  - parse each file with `decodeText`, `parseDelimited`, and `detectTable`;
  - preserve per-file delimiter, encoding, and number prior until the combined build;
  - align columns by trimmed, whitespace-normalized, case-folded header names;
  - use the first file's column order; append extra columns at the end; fill missing cells with `""`;
  - require identical widths in no-header mode;
  - sum ragged counts;
  - inject `_input_filename` after structure/header detection and before `buildDataset`.
- Filename values:
  - direct file: `File.name`;
  - archive: entry basename, using relative path only if duplicate basenames need disambiguation;
  - gzip/bzip2: inner filename.
- Filename header collision: use `_input_filename`, then `_input_filename_2`, etc., case-insensitively.
- Add a provenance role to `ColumnData` and `ColumnMeta`:
  - force type `string`, type-locked;
  - exclude from stats hashing, duplicate detection, empty-row detection, anomaly/pattern profiling, DQ scoring, and default chart suggestions;
  - include in table, filters, exports, and manual chart selection.
- Add per-file metadata to `DatasetMessage`: `files: { name, rows, encoding, delimiter }[]`, and make `source` explicit (`"file" | "paste" | "archive" | "multi"`).
- Use one request ID for progress and cancellation. Report per-file progress. Swap the dataset only after all files parse and build succeeds, preserving current atomicity.

### A3. Memory, sampling, and cancellation

- Parse files sequentially and release each file's decoded text and row grid before the next.
- Build the combined row grid once, then let the existing async build release processed rows.
- If sampling is chosen, allocate the 100k-row sample across files proportionally to estimated rows, with a minimum per non-empty file.
- Check cancellation between files and between build chunks.
- Ensure a cancelled multi-file load keeps the previous dataset.

### A4. Tests

- Unit: identical headers, reordered headers, extra/missing headers, duplicate column names, no-header files, mixed encodings/delimiters, ragged rows, filename collision.
- Worker: one multi-file request, progress, cancellation, atomic swap.
- Export: `_input_filename` appears with correct values and respects all/filtered scope.
- Recipe: decide whether provenance is optional in `baseSchema`; replay on a single file must not silently skip transforms because `_input_filename` is missing.
- E2E: Playwright `setInputFiles` with two CSVs; assert filename values, row order, row count, and CSV export.
- Regression: single-file behavior unchanged.

**Indicative size: 5-7 engineer-days.**

---

## 5. Workstream B: Type conversion, confirmation, and Table performance

### B1. Conversion model

Introduce a proper cast layer separate from `setType`:

- Targets: integer, number, date, datetime, time, duration, boolean, category, string.
- Policies:
  - **Coerce**: canonicalize valid values; invalid values become missing. Matches pandas `errors="coerce"` conceptually.
  - **Keep invalid**: canonicalize valid values; leave invalid text unchanged and count it. This is the current per-cell behavior.
  - **Reject**: do not mutate; show counts/examples and keep the dialog open. Matches `errors="raise"` adapted to a UI.
- Extend `CleanOp` or add a dedicated cast spec:
  - extend `toNumber`, `toDate`, and `toDateTime` with a policy;
  - add `toInteger`, `toTime`, `toDuration`, and `toBoolean`;
  - keep `repairDecimal` and simple text clean operations unchanged.
- Add a cheap dry-run/count path that parses values without rebuilding `ColumnData`.
- When a cast applies:
  - coerce invalid to `""`, the existing null token, so null statistics update naturally;
  - keep invalid values raw while canonicalizing valid values, locking the target type and returning the non-parsing count;
  - reject with no mutation.
- Clear or replace the previous `typeOverrides` entry appropriately.
- Add a per-column `castFailures` bitset and a `castFailures` special filter for "Review mismatches".
- Recompute suggestions after a cast so stale conversion chips disappear.

### B2. Type lattice

Create a small type-lattice module:

- null < boolean < integer < number for numeric-like values;
- date < datetime;
- time and duration as separate families;
- category and identifier are not promotion targets;
- incompatible mixes fall back to string.

Use it for:

- multi-file schema reconciliation and preview explanations;
- deciding whether a proposed conversion is lossless;
- showing whether a conversion is safe or has mismatches.

Document that this is the product's deterministic lattice, inspired by NumPy/pandas promotion but not claimed to be identical.

### B3. Confirmation dialog

Create `src/ui/cast-dialog.ts` using the existing dialog and chart-setup form patterns (`src/ui/dialog.ts:8-53`, `src/ui/chart-setup.ts:50-283`).

Contents:

- Heading: `Change "amount" from Text to Number`.
- Summary: total values, nulls, parseable values, mismatches, and up to 10 mismatch examples.
- Error policy radio group:
  - Coerce invalid values to blank (pandas-style).
  - Keep invalid values as text (current behavior).
  - Cancel conversion if any value fails.
- Type-specific options:
  - number: decimal convention (auto/dot/comma);
  - date/time: auto/day-first/month-first; note that datetimes are stored as UTC;
  - integer: decimals are mismatches by default; an explicit "Round" option is optional and off by default;
  - boolean: preview the accepted true/false token sets.
- Conversion mode:
  - "Convert values" (default): rewrite/canonicalize cells and apply the error policy.
  - "Reinterpret only": current `setType` behavior, with invalid values left as text and the trade-off explained.
- Apply button with counts: `Convert 9,998 cells - 2 will be blank`.
- Batch option: "Apply this conversion to selected columns".

Intercept all manual type-change entry points:

- header type select (`src/ui/table.ts:389-401`);
- inspector quick actions (`src/ui/column-inspector.ts:322-333`);
- header menu and command bar (`src/ui/app.ts:4048-4062`, `2743-2744`);
- Quality page type downgrade (`src/ui/app.ts:3127`);
- suggestion chips (`src/ui/app.ts:2239-2302`);
- Clean panel staged casts (`src/ui/clean-panel.ts:540-545`).

Recipe replay bypasses the dialog deliberately (`src/ui/app.ts:4591-4603`).

On cancel, reset the header select to the current type. After apply, show a toast with counts, Undo, and "Review mismatches". Warn if the cast will clear transform history.

### B4. Batch conversion

Add a "Types" tab or bulk action in Clean:

- table of columns with current type, inferred type, mismatch hints, and target type;
- checkboxes for multiple columns;
- one "Convert selected..." action that opens one queue and sends a single worker request;
- one rebuild, one response, one Undo batch.

This directly addresses slow multi-column conversions and avoids N full worker/UI cycles and dropped requests from `queueSend`.

### B5. Performance work

Implement in measured order after adding benchmarks:

1. **Incremental clean application**: when appending a new clean op, apply only that op to the current column values. Keep `cleanSource` for undo, reordering, and op removal; fall back to full replay only when the op list is edited or reordered.
2. **Type-preserving column rebuild**: for trim/case/replace, reuse the known type and skip inference and suggestion detection. Recompute only what can change: raw values, null masks, distinct/counts, lengths, categories, histograms, anomalies, and numeric caches. For casts, the target type is explicit.
3. **Reuse unchanged column work**: update only the changed column's profiling/bitsets; reuse unchanged columns' anomaly and pattern data; update duplicate/empty/null-row masks from affected rows where possible.
4. **Defer or chunk dataset-level stats**: return table rows and column metadata first; compute dataset-level health/DQ metrics in a second phase with an "Updating dataset metrics..." state. Or make the stats pass chunked/async so the worker can report progress.
5. **Preview plus apply once**: use the cheap dry-run for mismatch counting; do not run the full rebuild twice.
6. **UI patching**: add `updateColumnHeader` so one column change does not rebuild the entire header; clear/refresh only the visible row window; debounce side-panel refreshes during rapid edits.
7. **Progress and responsiveness**: use worker progress for long casts/rebuilds; show determinate status for large multi-column conversions; avoid unfeedbacked UI freezes above roughly 100ms.
8. **Benchmarks**: add `bench/clean.ts` covering uppercase, lowercase, title case, single-column cast, 10-column batch cast, and coerce/keep policies.
   - Suggested budgets: 100k rows one-column case p95 <= 250ms; 300k rows p95 <= 600ms; 100k rows 10-column batch cast p95 <= 2s with progress; no avoidable main-thread task >100ms.

### B6. Tests

- Cast policies for number, integer, date, datetime, time, duration, and boolean.
- Invalid examples: `T` in an integer column, `2.5` to integer, invalid date rollovers, timezone offsets, currency, percent, accounting negatives, decimal comma.
- Preview counts, examples, and apply labels.
- Null statistics and DQ refresh after coerce.
- Cast-failure filter.
- Undo and recipe round-trip; recipe `errors=` matches the selected policy.
- Batch conversion, request coalescing, and performance guards.
- Cancel resets the header select and does not mutate.

**Indicative size: 8-12 engineer-days.**

---

## 6. Workstream C: Chips UX

### C1. Establish two chip primitives

Create a shared `src/ui/chips.ts` and shared suggestion metadata.

- **Filter chip**
  - clearly labelled and styled as a toggle;
  - `aria-pressed`;
  - label starts with `Filter:` or uses a funnel icon plus explicit text, e.g. `Filter: 12 empty cells`;
  - active state is visually obvious and includes a clear action;
  - tooltip: "Show only rows matching this issue. Filters also affect charts."
- **Fix chip**
  - a real button with a verb label, e.g. `Fix: treat "NA" as missing`;
  - tooltip explains exactly what will change and that it is undoable;
  - data-changing or type-changing fixes open a preview/confirmation; low-risk null-token fixes apply immediately with an Undo toast;
  - after success, the chip disappears or becomes a short-lived "Applied" state.

Add metadata to suggestions (`src/data/suggestions.ts`):

- `kind: "filter" | "fix"`;
- `risk: "safe" | "data-change" | "type-change"`;
- `countIsExact: boolean`;
- short label, full label, and effect description.

All surfaces use the same labels and rendering: table header, filter sidebar, column inspector, Triage, Overview, and Quality page.

### C2. Header layout and labeling

- Filter issues collapse into one `N issues` menu.
- Fix chips collapse into `Fix issues (N)` when there are more than two.
- Sampled counts get `~` and a tooltip explaining the sample.
- Remove stale suggestions after type changes.
- Make the inspector's outlier action actually toggle the anomaly filter, or relabel it to match its behavior.
- Add a short "What do these chips do?" help affordance in the table header/help drawer.

### C3. Chart view cleanup

- Keep filter chips, but present them as filters that affect all charts.
- Move dataset-level cleanup (`Convert to nulls`) out of the chart results bar into a `Data issues (N)` popover/button.
- The popover explains: "Values like NA and NULL are currently counted as real categories. Convert them to missing so charts group them under `(empty)` and exclude them from measures."
- Provide `Convert N placeholders to missing` with preview, Undo, and a link to Clean.
- When a category chart shows an `(empty)` group, add a tooltip/note explaining that it contains nulls/placeholders.
- Add a chart-level "Values like NA/NULL detected" warning with "Treat as missing" and "Keep as category" actions scoped to the chart's dimension columns.

### C4. Tests

- Filter chips have correct `aria-pressed` and toggling behavior.
- Fix chips apply through the correct path, show Undo where expected, and disappear after resolution.
- Sampled counts are marked.
- Stale suggestions disappear after a type change.
- Chart data-issue popover counts and actions match the underlying null tokens.
- Component tests for header, inspector, filter panel, Triage, and chart results bar.

**Indicative size: 4-6 engineer-days.**

---

## 7. Workstream D: Charting aggregation and exploration UX

This workstream integrates `charting_aggregation_ux_spec.md` into the existing chart card architecture. The goal is one explicit chart configuration that is easy for a first-time user, accurate for an analyst, and reusable by CSV export and recipe generation.

### D1. Chart builder information architecture

Refactor the chart card controls and the add-chart dialog into one shared builder structure:

1. **Chart summary**
   - always-visible sentence such as `Sum of Revenue by Month and Region`;
   - source label (current filtered table or a named pivot);
   - sampling/aggregation note when relevant.
2. **Measure**
   - one or more measure fields;
   - context-aware aggregation menu per measure;
   - optional weight/condition under Advanced.
3. **Group by (X)**
   - field plus time grain or numeric binning when applicable;
   - clear display of the chosen grain/bin.
4. **Break down by**
   - optional second dimension;
   - chart-type-specific presentation: color/series, stacked/grouped bars, small multiples, or faceting;
   - series cap and Other bucket.
5. **Filters**
   - chart-level filters with visible active-filter chips;
   - "Also respect table filters" toggle, default on.
6. **Quick calculation**
   - rolling, cumulative, percentage, period comparison, index-to-100;
   - visible calculation summary and reset.
7. **Advanced**
   - null handling, missing-period policy, category limit, sorting, Other behavior, axis settings, legend, palette, color domain, orientation, stacking, error bars, interpolation.

Keep the main path compact. Do not expose every statistical function or rendering setting at once. Use context-sensitive menus and a collapsed Advanced section.

Shared implementation:

- extract a `ChartSpec` model and builder controls from `chart-card.ts` and `chart-setup.ts`;
- use the same builder for Add chart, Edit chart, Duplicate, and Reset to suggested configuration;
- debounce preview updates, cancel stale computations, and show stale/loading states;
- keep chart configuration out of the data Recipe.

### D2. Aggregation model and count semantics

Extend the shared aggregation vocabulary in `src/data/aggregate.ts` and every UI surface:

- `rowCount` / "Rows": number of rows in the group.
- `nonNullCount` / "Count of values": number of non-null values in the selected field.
- `distinctCount` / "Distinct values": unique non-null values unless documented otherwise.
- `sum`, `mean`, `median`, `min`, `max`.
- `stddev`, `variance`, configurable `percentile`.
- `percentOfRows` and `percentOfTotal`.
- Boolean: true count, false count, true percentage, missing count.
- Date/time: count, earliest, latest; time bucketing is a grouping operation, not a measure.
- Categorical/string: row count, distinct count, percentage of rows, top categories; numeric summaries are not offered unless the column is explicitly converted.
- Unknown/mixed: row count and only supported operations; prompt to review inferred types.

Rules:

- Only show aggregations that are valid for the selected field type.
- Every aggregation documents its null handling and denominator.
- Count, non-null count, and distinct count are never all labelled "Count".
- Percentage-of-total uses the full filtered aggregation scope, not just the visible top-N.
- Show a warning when a measure appears to be non-additive (for example a rate, ratio, percentage, temperature, or index) and the user selects `sum`; do not silently imply that summing is meaningful.
- Keep the selected aggregation visible in the chart summary, tooltip, CSV headers, and recipe output.

### D3. Grouping, breakdowns, category limits, and sorting

- X/grouping field supports category, time, date part, and numeric bin dimensions.
- A second grouping dimension is supported where the chart type can represent it. Cap the number of series (initially 12) and offer an Other bucket; warn when combinations are too many.
- Default category limit is 10 where appropriate for bar/count/box/heatmap-style charts, configurable per chart. The limit and Other bucket must be visible.
- Sorting:
  - by aggregated value descending/ascending;
  - by category label;
  - chronological for time;
  - numeric order for numeric bins;
  - deterministic tie-breaking, preferably by label.
- High-cardinality warnings and an easy "Show all" path.
- All grouping and limit metadata is part of the ChartSpec, not hard-coded in the renderer.

### D4. Time aggregation, gaps, and timezone behavior

- Available grains depend on the detected timestamp range, precision, and number of observations.
- Default grain is chosen from span and approximate point count. It must be visible and easy to change.
- Support minute, hour, day, week, month, quarter, and year, plus 15-minute and 30-minute intervals where the data supports them.
- Support "every N" frequencies (for example 3 minutes, 2 weeks, 3 months).
- Calendar options:
  - week start day;
  - calendar vs fiscal year/quarter;
  - day of week, hour of day, month of year.
- Missing periods:
  - display gaps by default where appropriate;
  - optionally generate a continuous time axis;
  - explicit fill policies: zero, forward fill, or interpolation when valid;
  - visually distinguish observed values from filled values;
  - warn when periods are absent or partial.
- Timezones:
  - preserve timezone-aware timestamps;
  - do not invent a timezone for naive timestamps; use the documented dataset/application default and make it accessible;
  - handle DST transitions explicitly;
  - show the active timezone in the chart summary.
- Reuse and extend the existing `TimeOptions`/`timeBucket` implementation; align with the Pivot resample options so there is one time-bucketing model.

### D5. Numeric binning and distributions

- Support equal-width bins, equal-frequency/quantile bins, and user-defined width or boundaries.
- The existing `BinSpec` already supports width, quantiles, and explicit edges (`src/data/aggregate.ts:9-12`); expose it in the chart builder.
- A single numeric field can produce a histogram/distribution summary by default.
- Show readable bin labels and define boundary ownership.
- Do not silently drop out-of-range values when custom bins are used; show a count and an overflow/underflow treatment.
- Sort numeric bins by numeric boundaries, not label text.
- Reuse the same bin definition in Pivot View where a numeric dimension is used.

### D6. Chart calculations and operation categories

Expose non-destructive chart calculations in the ChartSpec:

- rolling mean and rolling sum;
- cumulative sum;
- percentage of total;
- period-over-period absolute and percentage change;
- year-over-year comparison;
- index to 100/base-period normalization;
- weighted average when a weight field is selected;
- reference lines and target values where useful.

For every calculation, define and display:

- ordering;
- window length;
- denominator;
- missing-period behavior;
- behavior when required inputs are unavailable.

Keep these concepts distinct in the UI, internal configuration, and recipe output:

| Operation | Example | Role |
|---|---|---|
| Aggregation | Sum revenue by month | Combines raw rows within groups |
| Bucketing | Group timestamps by hour | Defines group boundaries |
| Derived column | Revenue = price x quantity | Creates a row-level value, only with confirmation |
| Window calculation | 7-day rolling average | Calculates across an ordered result |
| Normalization | Index a series to 100 | Rescales values for comparison |
| Filtering | Only show 2025 | Selects rows/groups |
| Resampling/materialization | One record per hour | Creates a reusable dataset only if the user chooses |

The existing post-operation engine (`src/data/aggregate.ts:58-65`, `665-770`) covers much of this. Add missing operations and expose them in Chart, not only in Views. Chart calculations do not alter source data; an explicit "Materialize as dataset" action can be added later.

### D7. Smart suggestions and automatic defaults

Use field profiling and type combinations to suggest starting charts:

| Detected fields or pattern | Suggested starting point |
|---|---|
| Date/time + numeric | Line chart with a sensible grain and aggregation |
| Category + numeric | Sorted bar chart with sum or mean visibly selected |
| Category + numeric + date/time | Time series with optional category breakdown |
| Two numeric fields | Scatter plot |
| One numeric field | Histogram and distribution summary |
| One categorical field | Frequency bar chart |
| Start date/time + end date/time | Duration distribution or timeline when valid |
| Latitude + longitude | Map |
| Boolean/status field | Count by status and optional percentage of rows |

Rules:

- Suggestions are grounded in detected field types and profile statistics.
- Never silently create speculative business metrics. `price x quantity` may be suggested as a derived measure but must be confirmed.
- Show why a suggestion was chosen and which fields/aggregations it selected.
- Suggestions must be overridable and must not imply a confirmed relationship.
- Use full-dataset statistics, not a preview sample, for suggestions.

### D8. Exploration, drill-down, and underlying-row inspection

Chart interactions must support lightweight analysis, not just presentation.

Add a chart point/bar inspector that shows:

- the group label;
- the measure and aggregation;
- value, row count, and non-null count;
- active table filters and chart-level filters;
- the selected time grain/bin;
- whether the value is sampled or based on full data.

Actions:

- filter the table to the selected group (explicit action, not a silent global filter);
- view the underlying rows contributing to the value;
- drill from a coarser time grain to a finer grain;
- break down the selected period/category by another field;
- compare the selected group with another period or category;
- duplicate the chart;
- undo a chart configuration change;
- reset to the suggested/default chart.

The underlying-rows view must state the active filters and grouping criteria. Do not imply that chart selection filters the whole dataset unless the user explicitly chooses that action. This is a separate surface from the Table filter panel; the relationship between the two must be visible.

### D9. Declarative ChartSpec and recipe consistency

Replace the implicit mix of card config and rendering logic with a versioned declarative `ChartSpec`.

The spec must represent:

- source (current filtered table, a named pivot, or another supported source);
- chart type;
- X/grouping fields;
- one or more measures;
- aggregation function per measure;
- time grain or numeric bin definition;
- additional grouping/breakdown dimensions;
- chart-level filters and the respect-table-filters flag;
- category limit, Other behavior, and sorting;
- null and missing-period policies;
- post-aggregation calculations;
- display options required to reproduce the chart meaningfully (palette, color domain, orientation, stacking, error bars, axis titles, legend);
- sampling policy and disclosure.

Requirements:

- Rendering, CSV export, chart duplication, and pandas/Polars generation all use the same spec.
- The spec is serializable and can be inspected/exported.
- Keep the spec separate from the data Recipe. Chart config and calculations are analysis state, not data-shaping steps.
- Add "Copy chart code" for supported configurations.
- Generate idiomatic pandas and Polars code, not an artificial shared syntax.
- Unsupported operations are identified explicitly in a support report. Examples likely to be unsupported initially: sampled scatter exports, safe custom lambdas that cannot be represented exactly, approximate CI error bars, and geo joins.
- Rendering and recipe generation must use equivalent null, time-bucket, bin-boundary, sorting, and percentage semantics.
- Add golden tests for generated code and for result parity where feasible.

### D10. Chart presentation and interaction features

#### D10.1 Set1 default and Count plot rename

- Change `DEFAULT_PALETTE` to `"Set1"` (`src/data/palettes.ts:75`) and move Set1 to the top of the qualitative list.
- Introduce a separate default sequential ramp (for example `Blues`) for heat/density/sequential contexts so they do not fall back to the legacy hardcoded ramp.
- Rename user-facing `Bars` to `Count plot` while keeping internal kind `"bar"`:
  - label map (`src/ui/chart-utils.ts:27-41`);
  - card type select and aria label (`src/ui/chart-card.ts:840-848`, `4104-4137`);
  - gallery labels/reasons (`src/ui/chart-gallery.ts:79-83`, `303-395`);
  - setup dialog headings (`src/ui/chart-setup.ts:60`, `281`);
  - help copy (`src/ui/help-content.ts:214`, `234-235`);
  - tests referencing "Bar chart of...".
- Add contrast treatment for Set1's yellow/light gray: swatch borders, line outlines, and a legend contrast check.

#### D10.2 Seaborn-style Barplot

Add a new `"barplot"` chart kind with:

- x: categorical or time field;
- y: numeric measure (required);
- hue: optional categorical field;
- estimator: mean, sum, median, min, max, count;
- error bars: none, SD, SE, 95% CI (normal approximation), with a tooltip stating the method;
- order: x ascending/descending, by estimate, or custom;
- hue order and a hue cap with Other;
- orientation: vertical/horizontal;
- layout: dodged (default) or stacked (product extension);
- optional weight column if the aggregate engine supports it cleanly;
- top-N and Other behavior for high-cardinality x/hue, clearly labelled.

Data path:

- reuse `computeAggregate` with dimensions `[x, hue]` and measures `[estimator(y), count(y), stddev(y)]` (`src/data/aggregate.ts:1105-1687`);
- compute error bounds client-side:
  - mean: `sd / sqrt(n) * 1.96`;
  - sum: `sd * sqrt(n) * 1.96`;
  - median/min/max: disable normal CI or use an explicitly implemented percentile range;
- do not claim bootstrap CI parity in v1; label the method;
- add a dedicated draw path rather than overloading `drawSplitAggregate`;
- support negative values with a zero baseline and a domain that includes error bounds;
- add hover/click regions for x and optional hue, with tooltips showing n, estimate, and error;
- add pan/zoom through the generic viewport;
- migrate old `bar` cards with a value column to `barplot` in `remapChartConfigs`;
- update all exhaustive kind lists, gallery groups/icons, controls, aria labels, and tests.

#### D10.3 Sequential/diverging color min/max

Add to ChartSpec:

- `colorMin`, `colorMax`, and optional `colorCenter`;
- UI inputs in the palette group with Auto placeholders and a reset action;
- validation: finite numbers and `min < max`; otherwise keep the previous valid domain and show an inline error.

Create a shared color-scale module used by:

- numeric scatter/map point color;
- map heat;
- heatmap cells (migrate from primary-color alpha to the selected ramp);
- density bands/contours (migrate from the hardcoded ramp);
- correlation (diverging domain defaults to -1 to 1, overridable).

Behavior:

- default domain from data or column stats;
- user values clamp the ramp, not the data;
- diverging palettes center on zero when the domain crosses zero unless `colorCenter` is set;
- legend shows min/mid/max, measure name, and whether the domain is auto or manual;
- state whether the domain uses sampled or full data; prefer full-column min/max where possible.

#### D10.4 Pan/zoom/reset on every chart with axes

Extract a generic viewport controller rather than adding more per-kind state:

- viewport types: numeric X/Y, time X, category window per axis, map lon/lat, item window/top-N;
- interactions: wheel zoom anchored at the cursor, drag pan, double-click reset, reset button, keyboard/touch support where practical;
- reset restores the auto domain/window and is disabled when already at default;
- click-to-filter and drag-to-pan share a movement threshold, as current bar/map code does;
- export respects the current viewport, with an option for full-domain export.

| Chart | Zoom/pan behavior |
|---|---|
| Line / histogram | X zoom/pan (existing) |
| Scatter / density | X/Y zoom/pan; fix density grid clipping/resampling |
| Map | Lon/lat zoom/pan; fix brush bounds under zoom; add feature/point hit testing |
| Bubble | Add X/Y zoom/pan |
| Countplot | Category window zoom/pan (existing), rename, improved reset |
| Barplot | Category window plus numeric Y zoom/pan |
| Box | Category window plus numeric Y zoom/pan |
| Heatmap | Category windows on both axes |
| Treemap / terms | Item window/top-N zoom and pan; reset to default |
| Correlation | Row/column window zoom/pan |
| Pivot heatmap | Index/column window zoom/pan |
| KPI | No axes; reset hidden/disabled with a clear note |

Add reset button visibility and a card-menu "Reset zoom & pan" item. Add unit tests for viewport math and component tests for wheel/drag/reset.

#### D10.5 Chart CSV export

Add "Download chart data (CSV)" to the card menu and a small export action.

- Export the data behind the chart:
  - full filtered domain by default;
  - optional "visible window only" for zoomed/windowed charts;
  - state if scatter/map points are sampled;
  - bound pivot/view charts export the aggregate/pivot result, not raw table rows.
- Per-kind schemas, for example:
  - countplot: `category,count,percent,is_other`;
  - barplot: `x,hue,estimate,error_low,error_high,n`;
  - histogram/line: `bin_start,bin_end,count` or one column per group;
  - scatter: `x,y,color,size`;
  - density/bubble/map heat: cell centers, counts, measures;
  - box: group, count, min, q1, median, q3, max, whiskers, outliers;
  - heatmap: x, y, count, percent;
  - correlation: long-form `column_a,column_b,r,n`;
  - treemap/terms: label/value/share;
  - KPI/aggregate: dimension columns plus measure columns.
- Use a shared CSV formatting/escaping helper with BOM and CRLF, matching table export, but keep it out of the worker bundle.
- Use safe filenames and existing download patterns.
- Tests for each serializer, escaping, formula-injection protection, BOM, and sampled-data notes.

#### D10.6 GeoJSON and Shapefile maps

Parsing and CRS:

- GeoJSON:
  - parse natively and validate `FeatureCollection`/`Feature`/geometry types;
  - RFC 7946 means WGS84 lon/lat, so no CRS prompt;
  - if a legacy `crs` member exists and is not WGS84, require reprojection via `proj4`.
- Shapefile:
  - support zipped `.shp/.dbf/.prj` bundles and direct multi-select grouped by basename;
  - parse geometry and DBF attributes;
  - use `.prj` to determine CRS;
  - if projected, reproject to WGS84 with `proj4`;
  - if `.prj` is missing, require the user to choose a CRS or explicitly "Assume WGS84" with a warning.
- Lazy-load `shpjs`/`proj4` so the main chart bundle is unaffected.
- Cap geometry size and simplify/warn for very large files.

Internal model:

- `GeoFeature`: id, label, properties, normalized rings.
- `GeoDataset`: features, bounds, CRS, source name.
- Handle Polygon/MultiPolygon, holes, and ring orientation.
- Keep feature properties for joins.

Map UI:

- map source: World basemap or Custom regions;
- region file chooser and CRS status/override;
- join field (feature property) and match column (dataset column);
- measure/count and aggregation;
- color scale;
- unmatched feature/row counts and a small diagnostic list;
- optional direct numeric property coloring when no dataset join is needed;
- choropleth rendering with hover tooltip (feature name, value, row count), click-to-filter, and legend;
- keep point/heat modes;
- store only `mapSourceId` and filename in ChartSpec; keep parsed geometry in a session registry; show "Reload map file" if missing;
- do not support point-in-polygon assignment in v1; join via feature attributes;
- normalize join keys (trim, case-fold, diacritics, common ISO codes) and report unmatched counts.

#### D10.7 Additional chart kinds

The charting spec mentions pie/donut "where appropriate". These are not required for the initial release and should not delay the core aggregation experience. Add them only after the aggregation model and barplot are stable, if user research supports them.

### D11. Correctness, nulls, full-data semantics, and performance

- **Full-data semantics**: aggregations must use the complete eligible dataset, not only the rows loaded for a visual preview. Scatter/map point sampling must be disclosed. Histograms, line bins, bars, and pivot aggregations must use all filtered rows unless the user explicitly requests sampling.
- **Nulls and invalid values**:
  - define and consistently apply null handling for every aggregation;
  - surface missing-value counts when they materially affect a measure or grouping;
  - distinguish nulls, empty strings, invalid parsed values, and zero;
  - do not conflate empty strings and explicit "Unknown" labels without a defined policy;
  - show missing-period indicators instead of silently treating absent periods as zero.
- **Sorting**:
  - time axes chronological;
  - numeric bins by numeric boundaries;
  - category sorting deterministic;
  - window calculations use a well-defined ordering and tie-breaking policy.
- **Units and additive measures**:
  - preserve available units when known;
  - avoid implying all measures can be summed;
  - show the selected aggregation clearly;
  - warn when a measure name suggests a rate/ratio/index and the user selects sum.
- **Performance**:
  - target approximately 100,000 rows as the initial responsive use case;
  - debounce interactive config changes;
  - cancel stale computations;
  - cache aggregate results by ChartSpec/filter signature;
  - show loading, stale, empty, and error states;
  - avoid recomputing profiling or full aggregations unnecessarily.
- **Readability limits**: warn when a configuration produces too many series, categories, or points; offer Other, top-N, filters, or chart-type changes.

### D12. Chart tests and acceptance criteria

The charting aggregation spec's acceptance criteria apply in full. In addition to the feature-specific tests in D10:

1. A user can load a dataset with date/time, category, and numeric fields and create an aggregated chart without writing code.
2. The user can select a numeric measure and choose a supported aggregation from a context-appropriate menu.
3. The user can group by a category and by a supported time grain.
4. The selected aggregation and time grain are clearly visible.
5. The user can add a second grouping dimension where the chart type supports it.
6. The chart uses all eligible rows or clearly discloses sampling/approximation.
7. Row count, non-null count, and distinct count are distinct operations.
8. Nulls and absent periods are not silently treated as zero.
9. Time axes are chronological and category/bin sorting is predictable.
10. High-cardinality charts remain readable through limits, sorting, and a visible Other bucket.
11. Changing aggregation or grouping updates the chart without a data transformation.
12. The chart configuration is inspectable/exportable in declarative form.
13. Supported chart configurations generate semantically equivalent pandas and Polars code, or clearly identify unsupported cases.
14. Empty data, invalid types, all-null measure columns, and failed computations produce understandable empty/error states.

Edge cases to test (from the spec plus this plan):

- dates as strings in multiple formats;
- date-only versus timestamps;
- duplicate timestamps and irregular sampling;
- timezones and DST transitions;
- missing days/months and empty groups;
- numeric columns with nulls, empty strings, invalid strings, and mixed types;
- negative and zero values;
- high-cardinality categories;
- equal aggregate values and deterministic tie-breaking;
- very long category labels;
- all-null or constant columns;
- distinct counts with nulls and mixed representations;
- profiling sample differing from the full dataset;
- numeric bin boundaries and out-of-range values;
- non-additive units;
- configurations that produce too many series or points;
- chart-level filters combined with table filters;
- pan/zoom/reset after changing chart type or source;
- sampled scatter/map disclosure;
- chart CSV for sampled, aggregated, and pivot-backed data.

**Indicative size for the charting aggregation work: 20-30 engineer-days, plus 15-20 days for the presentation features in D10.**

---

## 8. Workstream E: Pivot View

### E1. Rename and information architecture

- Rename user-facing `Views` to `Pivot View`:
  - `src/ui/view-tabs.ts:3-12`, `19-38`;
  - tab title, help copy, command-bar alias, keyboard hint, and tests.
- Keep internal `ViewId = "views"` initially to avoid churn; rename later only if worthwhile.
- Replace the current Views panel with a Pivot View built on the same aggregate engine, without losing existing capabilities:
  - time grains, week/fiscal, timezone;
  - weighted measures, conditions, post operations, expressions;
  - respect-filters;
  - advanced measure editing in a collapsible section.

### E2. Pivot data model

Introduce a serializable pivot definition:

- name and stable id;
- `values`: one or more value columns, each with one or more aggregations;
- `index`: 0-3 ordered fields;
- `columns`: 0-3 ordered fields;
- options: margins, margins name, fill value, dropna, sort, respect filters;
- time settings: frequency/multiple, closed, label, origin, offset, week start, fiscal month, timezone, gap fill, partial-period handling.

At request time, compile this into a worker pivot request. The worker should build the matrix, not send a huge long-form result to the UI.

- New `PivotRequest`/`PivotMessage` in `src/worker/protocol.ts`.
- New worker `computePivot` that reuses `computeAggregate` internally:
  - base aggregation over all index+column dimensions;
  - margin passes over index-only, column-only, and no dimensions;
  - matrix assembly, labels, times, measure names, margins, truncation, and partial flags.
- This avoids client-side label-key collisions and gives correct margins for non-additive aggregations.

### E3. Values, index, columns, and aggregation

UI:

- three field wells: Values, Index, Columns;
- max 3 fields in Index and 3 in Columns;
- reorder with up/down controls and remove buttons;
- Values well: each value pill has aggregation chips; add/remove aggregations;
- prevent the same column from appearing in both index and columns unless explicitly allowed with a warning;
- require at least one value and at least one index or column field; show a clear empty-state validation;
- offer "Add all numeric" as a shortcut for values;
- default aggregation: mean for numeric values, count for non-numeric; the user can override.

Aggregations:

- reuse the shared aggregation vocabulary from D2;
- keep existing sum, mean, median, min, max, count, distinct, stddev, first, last, mode, pN;
- add `size` and `var`;
- expose quantile/pN with a custom p;
- make count, non-null count, and distinct count explicit.

Custom lambda:

- because CSP blocks `eval`/`new Function`, implement a parsed mini-language:
  - syntax: `lambda x: <expression>`;
  - `x` is the selected value column's group values, with missing values excluded by default;
  - supported functions: `mean`, `median`, `sum`, `min`, `max`, `count`, `size`, `nunique`, `std`, `var`, `first`, `last`, `quantile(p)`;
  - arithmetic: `+ - * / ( )` and numeric literals;
  - validate and show a sample result/error before applying;
  - generate the original Python lambda in the pandas recipe.
- Document this safe deviation from arbitrary Python callables.

Column header levels:

- when multiple values and/or multiple aggregations exist, generate multi-level column headers in pandas-like order:
  1. values (if more than one);
  2. aggfunc (if more than one);
  3. column fields (in order).
- include an internal level name for values/agg to avoid pandas 3.0's duplicate-`None` ambiguity.

### E4. Margins, fill_value, dropna, and sort

- Margins:
  - one `All` row and one `All` column;
  - computed from raw filtered rows, not by summing displayed cells;
  - worker performs index-only, column-only, and no-dimension passes;
  - `margins_name` defaults to `All`, is configurable, and is validated against existing labels;
  - add `All` at the deepest column level per value/agg block, matching pandas;
  - support multiple values + multiple aggs + margins with explicit level names;
  - document that pandas does not add per-level subtotals.
- `fill_value`:
  - numeric scalar, blank means no fill;
  - applied after aggregation to missing cells;
  - do not use it to replace genuinely missing margins unless the margin itself is missing.
- `dropna`:
  - option to drop index/column groups whose keys are missing;
  - exclude rows with missing value observations before computing margins, per pandas docs;
  - make the exact behavior visible in a tooltip/help note.
- `sort`:
  - sort index/column keys ascending by default;
  - time dimensions sort chronologically;
  - allow source order as an alternative;
  - if "sort by measure" is added, mark it as a product extension, not pandas parity.
- `observed` is not applicable because the app derives observed categories only; state that in parity notes.

### E5. Time aggregations and resample

Extend the existing time bucket engine (`src/data/aggregate.ts:368-520`, `1008-1054`):

- frequency: auto/minute/hour/day/week/month/quarter/year;
- "every N" multiplier;
- closed: left/right;
- label: left/right;
- origin: start_day, epoch, start, end, custom;
- offset: optional duration;
- week start, fiscal start month, timezone;
- gap fill: drop/zero/carry;
- partial periods: keep/exclude.

Semantics:

- when a time field is the sole index and there are no column fields, this behaves like `resample(...).agg(...)`;
- with other index/column fields, it behaves like time-bucket grouping; gap fill is applied per combination of the other dimensions, with a cap and warning for large cartesian expansions;
- if multiple time fields are used, no automatic gap fill; warn the user;
- date-part fields (day of week, month name, hour) remain separate dimension types;
- add parity fixtures generated from pandas 3.0.6 for monthly, 3-minute, weekly with week start, `closed`/`label`/`origin`, gap fill, partial periods, and timezone/DST.

### E6. Named pivots

- save/update/duplicate/delete with a name and stable id;
- enforce unique names; allow rename without changing id;
- store definitions with column names, not indexes, and remap on transforms, like chart configs (`src/ui/chart-panel.ts:138-260`);
- reset on new dataset; survive lens switches and in-session transforms where columns still exist;
- surface saved pivots in Chart view's source selector (`viewSources`/`aggregateForSource`, `src/ui/app.ts:1901-1910`);
- fix current gaps:
  - `onViewsChanged` must fire on definition edits, not just add/rename/remove;
  - `setSources` must refresh already-bound cards;
  - bound cards must re-fetch when the pivot definition changes.

### E7. Pivot CSV export

Add an explicit `Export CSV` action in Pivot View and for pivot-bound chart cards.

- Export the full pivot result, not just the visible rows, with a cell cap and progress/warning for large outputs.
- Header options:
  - default: flat headers such as `Region | Product | Sum of Sales` for Excel compatibility;
  - optional: pandas-style multi-row headers for MultiIndex columns.
- Include index fields, margins, fill values, blanks for missing cells, measure names, and aggfunc names.
- Use BOM + CRLF and formula escaping consistent with table export.
- Prefer client-side serialization for normal sizes; add a worker streaming path if the matrix exceeds roughly 250k cells.
- Tests: flat/multi-row headers, margins, fill_value, missing values, formula escaping, and large-output guards.

### E8. Pivot-to-Chart integration

- Saved pivots appear in the chart source list.
- Add a `pivot`/`pivot-heatmap` chart kind:
  - rows = first index level or a selected index level;
  - columns = first column level or selected level;
  - measure selector;
  - heatmap cells with the shared color scale;
  - legend and tooltips.
- Also allow line/bar where the first time/value index is x, the first column field is hue, and the first measure is y; KPI using a chosen measure.
- If multi-level index/columns are too deep for a single chart, expose level selectors and/or flatten visible labels with a separator.
- Bound charts must react to pivot definition changes and filter changes.
- Pivot charts export CSV via the same pivot serializer.

### E9. Pivot pandas/Polars code

- Update `viewToPandas` (`src/data/recipe.ts:449-482`) to generate a real `pivot_table` call for the new definition:
  - values, index, columns, aggfunc (scalar/list/dict), fill_value, margins, margins_name, dropna, sort;
  - MultiIndex levels;
  - time grain via `pd.Grouper`/`resample`, including closed/label/origin/offset where supported;
  - custom lambda as entered.
- Generate Polars equivalents where possible; otherwise add a support-report entry.
- Keep pivots out of the data `RecipeFile`; add a separate "Copy pandas pivot code" action.
- Golden tests for generated code strings and support notes.

### E10. Pivot performance and rendering

- worker-side pivot assembly; no large long-form payload to the UI;
- cache by pivot definition plus filter signature;
- debounce edits and show a stale badge;
- virtualize or cap the displayed matrix (for example 500 rows x 100 columns); export full data;
- sticky row/column headers and merged MultiIndex header cells;
- benchmark 3 index fields + 2 column fields + margins at 100k rows, high-cardinality columns, time gap fill, and 3x3 dimensions with multiple measures;
- target p95 <= 500ms for a typical 100k-row pivot with margins, with progress for larger jobs.

**Indicative size: 10-15 engineer-days for core pivot, plus 6-9 days for time/resample and chart/export integration.**

---

## 9. One aggregation model across Chart, Pivot, and Recipes

The most important integration point is to avoid three separate aggregation implementations.

### 9.1 Shared definitions

- Extend the central `Aggregate`, `MeasureSpec`, `DimensionSpec`, `TimeOptions`, and `PostOp` types in `src/data/aggregate.ts`.
- Chart, Pivot, and existing Views compile to the same worker aggregation requests.
- The shared vocabulary must include:
  - row count, non-null count, distinct count, sum, mean, median, min, max, stddev, variance, percentile, percentage of rows/total;
  - explicit null handling and denominators;
  - time grains, date parts, bins, timezone/fiscal options;
  - post-aggregation calculations.
- ChartSpec and PivotDef are different front-ends; they must not redefine aggregation semantics.

### 9.2 Shared recipes

- One set of pandas/Polars emitters for aggregation, time bucketing, bins, nulls, sorting, limits, and post calculations.
- Chart-specific and pivot-specific wrappers add only the layout/rendering differences.
- Unsupported cases go into the same support report.
- Add parity tests that compare app results and generated pandas results for representative fixtures.

### 9.3 Specification integration matrix

| Charting specification requirement | Plan location |
|---|---|
| Aggregation by field type and count semantics | D2 |
| Multiple grouping dimensions | D3 |
| Category limits, sorting, Other | D3 |
| Time grains, auto grain, calendar, gaps, timezone | D4 |
| Numeric binning and distributions | D5 |
| Chart calculations and operation categories | D6 |
| Smart suggestions and visible defaults | D7 |
| Exploration, drill-down, contributing rows | D8 |
| Declarative configuration and recipe consistency | D9, section 9 |
| Nulls, full-data semantics, sorting, units, performance | D11 |
| Acceptance criteria and edge cases | D12 |
| Suggested implementation phases | Section 10 |

---

## 10. Delivery sequence and parallel tracks

### 10.1 Release slices

| Phase | Contents | Depends on | Outcome | Size |
|---|---|---|---|---|
| 0. Baseline | Fixtures, benchmarks, clean branch, module extraction plan | - | Measurable baseline | S |
| 1. Quick wins | Set1 default, Count plot rename, chart CSV, chip wording/tooltips, uppercase no-op fast path | 0 | Immediate UX wins | S/M |
| 2. Data foundation | Multi-file load + provenance, cast engine + dialog, batch casts | 0/1 | Correct input and conversions | L |
| 3. Table speed and chips | Incremental clean/rebuild, stats deferral, UI patching, filter/fix chip split | 2 | Responsive, unambiguous Table | L |
| 4. Chart aggregation core | Shared aggregation vocabulary, ChartSpec foundation, builder layout, context-aware aggregation, count semantics, time grain, category limits/Other, chart-level filters, smart suggestions | 1/3 | Charting spec Phase 1 | L |
| 5. Chart exploration | Numeric bins, quick calculations, drill-down, contributing rows, chart config undo/reset, barplot, pan/zoom/reset, color domains | 4 | Charting spec Phase 2 | XL |
| 6. Chart portability and advanced | Weighted averages, percentiles, fiscal calendars, advanced resampling, chart code generation, support reports, reusable chart specs | 5 | Charting spec Phase 3 | L |
| 7. Geo | GeoJSON, Shapefile/CRS, choropleth join | 5 | Real map support | L |
| 8. Pivot core | Rename, field wells, shared aggregation, lambda, margins/fill, named pivots, CSV | 3/4 | Pandas-style pivot | XL |
| 9. Pivot time and chart integration | Resample, gap fill, chart binding, pivot recipes | 6/8 | Time-aware pivots | L |
| 10. Hardening | E2E, performance, accessibility, docs, manual review | all | Release-ready | M |

### 10.2 Parallel tracks

- **Track A:** ingestion, casts, Table performance, chips.
- **Track B:** ChartSpec, chart builder, aggregation UX, presentation, geo.
- **Track C:** Pivot core, time/resample, chart integration.

They can run in parallel after Phase 0, but avoid concurrent edits to the same hotspots without sequencing:

- `src/ui/app.ts`
- `src/ui/chart-card.ts`
- `src/worker/protocol.ts`
- `src/worker/search.worker.ts`
- `src/data/aggregate.ts`
- `src/ui/views-panel.ts`

Extract new modules before parallel work:

- `src/ui/cast-dialog.ts`
- `src/ui/chips.ts`
- `src/ui/chart-spec.ts`
- `src/ui/chart-builder.ts`
- `src/ui/chart-viewport.ts`
- `src/ui/chart-color.ts`
- `src/ui/chart-export.ts`
- `src/ui/chart-map.ts`
- `src/ui/pivot-panel.ts`
- `src/data/pivot.ts`
- `src/data/geo-file.ts`
- `src/data/type-lattice.ts`

### 10.3 Suggested first increment

A pragmatic first increment after this plan is approved:

1. Add baseline fixtures/benchmarks and extract module shells.
2. Land Set1, Count plot labeling, chart CSV, chip labels, and the uppercase no-op fast path.
3. Build the cast engine and confirmation dialog, because it is both a correctness and performance fix.
4. Add provenance plus worker-side multi-file ingestion.
5. Centralize the aggregation vocabulary and ChartSpec before adding more chart types.
6. Build the pivot core on the shared aggregation model.

---

## 11. Quality gates and test strategy

### 11.1 Repository gates

There is no lint script. Use:

```bash
npm test
npm run typecheck
npm run build
```

Record that lint/formatting is not available rather than claiming a lint pass. Update README, help content, UX docs, and the change log.

### 11.2 Test layers

- **Unit**
  - multi-file header alignment and filename values;
  - type lattice and cast policies;
  - aggregation vocabulary and count semantics;
  - time bucket/resample options and DST;
  - numeric bin boundaries;
  - safe lambda parser;
  - chart calculations;
  - color-scale domain/clamping/center;
  - viewport math;
  - GeoJSON/Shapefile parsing and CRS handling;
  - chart CSV serializers;
  - pivot matrix, margins, fill, dropna, sort.
- **Worker**
  - atomic multi-file load, progress, cancellation;
  - cast previews/apply/undo;
  - chart aggregate requests with chart-level filters;
  - pivot margins/resample;
  - stale request handling.
- **Component (happy-dom)**
  - cast dialog options and cancel behavior;
  - filter/fix chip semantics and `aria-pressed`;
  - chart builder groups and validation;
  - field wells and pivot headers;
  - chart controls and file selection.
- **E2E (Playwright)**
  - load two CSVs and assert `_input_filename`;
  - type conversion with mismatches to coerce/keep/reject;
  - create an aggregated chart with time grain and count semantics;
  - chart-level filter and drill-down;
  - chart zoom/reset and CSV export;
  - load GeoJSON and zipped Shapefile;
  - create/save a named pivot, chart it, export CSV.
- **Pandas parity**
  - tooling script that generates expected pivot/chart aggregation outputs from pandas 3.0.6 and commits fixtures;
  - do not require pandas at test run time;
  - include margins, multi-level headers, multiple values/aggs, fill_value, dropna, time grains, bins, and resample cases.
- **Performance guards**
  - extend `bench/latency.ts`; add `bench/clean.ts`, `bench/pivot.ts`, `bench/multifile.ts`, and chart configuration benchmarks;
  - budgets from sections B5, D11, and E10;
  - catch O(n^2) regressions.
- **Manual browser review**
  - file picker and drag/drop;
  - large-load prompt and cancellation;
  - type dialog and review mismatch filter;
  - chart builder, chart-level filters, drill-down, pan/zoom/reset;
  - chart and pivot CSV downloads;
  - map loading;
  - CSP remains `connect-src 'none'`, no eval;
  - focus traps and keyboard navigation;
  - empty/loading/error states.

### 11.3 Charting specification acceptance

The 14 acceptance criteria in `charting_aggregation_ux_spec.md` are part of the definition of done for Workstream D. The app-specific additions are:

- chart-level filters are distinct from table filters and visibly summarized;
- chart calculations are non-destructive and clearly separated from data transformations;
- chart CSV and generated code match the ChartSpec;
- unsupported chart/recipe operations are listed explicitly;
- sampled scatter/map points are disclosed;
- high-cardinality warnings and Other buckets are visible;
- chart config supports undo/reset/duplicate.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Multi-file loads exhaust memory | Prefix estimates, one combined threshold, sequential parsing, atomic cancellation, conservative cap. |
| `_input_filename` distorts DQ/duplicates | Provenance role excluded from cross-row stats; still filterable/exportable. |
| Case/cast performance remains poor | Profile first; incremental clean/rebuild; defer stats; progress for long jobs. |
| Cast semantics diverge from pandas recipes | Serialize the selected policy; coerce maps exactly; keep gets a support note or explicit code. |
| Charting spec scope explodes | Deliver in the three spec phases plus explicit release slices; keep advanced analytics behind progressive disclosure. |
| ChartSpec and renderer drift | One ChartSpec drives rendering, CSV, and recipes; golden tests. |
| Chart-level filters confuse table filters | Separate chips, explicit "also respect table filters" toggle, scope summary, and drill actions that require confirmation. |
| Count semantics change breaks existing charts | Add explicit `rowCount`/`nonNullCount`/`distinctCount`; migrate labels; regression tests for existing count charts. |
| Custom lambda blocked by CSP | Safe parsed DSL; do not weaken `script-src`. |
| Chart kind rename breaks existing cards | Keep internal `bar`; migrate `bar + valueColumn` to `barplot`; regression tests. |
| Pan/zoom inconsistent across chart types | One viewport controller, per-kind behavior matrix, shared reset/export semantics, unit tests. |
| Shapefile CRS ambiguity | Require `.prj` or explicit CRS; reproject with `proj4`; never treat projected metres as degrees. |
| Geo files block the UI | Lazy-load parser, simplify geometry, cap features/vertices, warn. |
| Pivot margins wrong for non-additive measures | Compute from raw rows via extra aggregate passes. |
| Pivot UI scope explodes | Core matrix, then margins/fill, then named pivots/chart, then time/resample. |
| Pivot and chart aggregations disagree | Shared aggregation vocabulary and recipe emitters; parity fixtures. |
| Large files or many series make charts unreadable | Category limits, Other, high-cardinality warnings, sampled-disclosure, filters. |
| `app.ts` and `chart-card.ts` merge conflicts | Extract modules before parallel work; sequence protocol changes. |

---

## 13. Definition of done

A workstream is complete only when:

- Acceptance criteria and the relevant charting-spec criteria are met.
- Existing tests and new unit/worker/component/E2E tests pass.
- Performance budgets are measured and met, or the exception is documented.
- No new network requests or eval paths are introduced.
- Data-shaping changes appear in the data Recipe with correct scope and undo behavior.
- Chart config, chart calculations, filters, and pivots are not accidentally presented as data-shaping steps.
- Multi-file, provenance, cast, count, null, sampling, and full-data semantics are explicitly documented.
- Browser/manual checks are recorded for file picking, canvas interactions, downloads, focus, and responsive layouts.
- Help content, README, change log, and relevant plan docs are updated.
- The change is delivered on a feature branch with a clean rollback point, not directly on `main`.

---

## 14. Recommended next steps

1. Review and approve the decisions in section 3.
2. Create the feature branches and baseline fixtures/benchmarks.
3. Extract the module shells listed in section 10.2.
4. Start with the quick wins and the cast engine.
5. Add provenance and multi-file ingestion.
6. Centralize the aggregation vocabulary and ChartSpec before expanding chart types or the pivot UI.
7. Build the pivot core on the shared aggregation model.
8. Complete the charting-spec Phase 1-3 acceptance criteria before declaring the Chart/Pivot work complete.

No implementation changes have been made by this plan.
