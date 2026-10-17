# Core User Journeys

> Status: Draft — populated from repository reconnaissance on 2026-10-17 (commit `0410948`). Entry points are verified in source. No journey has been browser-tested end to end; the repository contains no committed E2E suite.

For each journey, capture a baseline before redesigning it. Record the starting state, expected steps, result, failure states and relevant screenshot/test IDs.

## How to use this register

- **Source-verified** means the control and path exist in the repository.
- **Existing automated coverage** means unit/component/worker tests that exist today, not proof that the user journey works in the app.
- **Proposed browser tests** and **manual checks** are not implemented automation. Any item under “Browser verification required” is currently a manual/proposed check unless explicitly stated otherwise.
- Do not mark a journey as passed because the screen looks correct or because isolated tests pass.

---

## J1 — Import a dataset and understand it

**User goal:** Load a file or pasted rows and understand what was imported.

**Current starting state:** Start screen with drop zone, “Paste rows instead” details and “Try sample data”. No dataset loaded.

**Actual entry points (source-verified):**
- Drop a file on the start card, or click to browse.
- “Paste rows instead” → delimiter and “First row is header” → “Load pasted data”; `Ctrl+Enter` also loads pasted text.
- “Try sample data”.
- ZIP: archive entry picker; optionally “Import all N files (append rows)” when headers match.
- XLSX/XLS: worksheet picker.
- Large plain delimited/JSON buffers and pasted text: automatic dialog offering first 100,000 rows as a sample, full load, or cancel. Workbook, Parquet, ZIP-entry and decompressed-inner paths do not use this dialog; ZIP “Import all” has a separate 20M-cell guard.
- “New data” / “Clear data” in the topbar returns to the start screen.

**Expected steps:**
1. Choose a supported file or paste rows.
2. Resolve archive/sheet/large-file choices if offered.
3. Wait for load progress; optionally cancel.
4. Land in Overview (or Table if “Open in Table next time” was previously enabled).
5. Review dataset facts, type mix, import-check banner, health tiles and next steps.

**Expected outcome:**
- Import succeeds or fails with a specific, actionable message.
- Row and column counts, file format, delimiter, encoding, inferred types and basic quality signals are visible.
- Ragged rows, trimmed extra cells, sample mode and encoding fallbacks are disclosed.
- The original file is not silently modified.
- A failed or cancelled load leaves the previous dataset unchanged. Exception: a worker OOM crash clears the workspace and returns to the start screen with an explanation.

**Failure states to test:**
- Valid CSV, malformed/ragged CSV, empty file, duplicate headers, blank headers.
- Unsupported extension and unsupported compression.
- UTF-8 BOM and windows-1252 fallback. UTF-16 is **not implemented**; the README claim should be verified/corrected.
- JSON variants and workbook sheets.
- ZIP with one/many/no supported entries.
- Plain delimited/JSON file or paste above the 8M-cell guard; sample, full-load and cancel paths. Also verify workbook/Parquet/archive-entry behaviour, which bypasses this dialog.
- Worker out-of-memory crash and recovery.
- Paste with the header checkbox off.

**Existing automated coverage:**
- Strong at parser/worker level: `parse`, `ingest`, `encoding`, `header-detect`, `infer`, `json`, `xlsx`, `parquet`, `archive`, `bz2`, fixtures, load guard, worker load/cancel.
- `worker.test.ts` starts from a real load and exercises rows, filters, sort, stats, type change and export.
- **No automated coverage** for `App.loadFile`, drag/drop, file picker, archive/sheet picker, paste controls or the start-screen-to-workspace transition.

**Browser verification required (manual/proposed until automated):**
- Drag/drop and file selection.
- Actual file and archive/sheet pickers.
- Paste and keyboard shortcut.
- Progress, cancellation and OOM recovery.
- Import banner and Overview landing with real data.

**Relevant fixtures:** `test/fixtures/euro_win1252.csv`, `messy_values.csv`, `messy_report.xlsx`, `ragged.csv`, `sample.parquet`; built-in “Try sample data”.

---

## J2 — Profile data quality

**User goal:** Find the most important data-quality issues and understand what to fix first.

**Current starting state:** A dataset is loaded. Overview is shown by default.

**Actual entry points (source-verified):**
- **Data Quality** tab, topbar DQ score tile, keyboard `2`.
- Command palette: “quality”, “score”, “dq” or “data quality”.
- Overview: health tiles and “N issues found — Review all” (triage queue).
- Overview “Next steps” cards.
- Per-column header/sidebar QA and fix chips.

**Expected steps:**
1. Open the Data Quality dashboard.
2. Read the overall score, band, facts and six dimensions (Completeness, Validity, Uniqueness, Consistency, Timeliness, Accuracy).
3. Review “What to fix first”, ranked by estimated points gained.
4. Use “Show only issues” or a dimension card to narrow the checks.
5. Act on a check (“Review empties”, “Show off-format”, “Convert to …”, “Show failing”) or review the column/dataset directly.
6. Optionally adjust weights/bands or export the report.

**Expected outcome:**
- The score is clearly dataset-level and excludes filters and advisory findings.
- Each check states exact pass/fail/n-a counts and its evidence.
- Not-applicable dimensions explain why they are n/a.
- Checks with a filter or convert action can reveal affected rows. Checks without one show their evidence but currently have no explicit drill-down explanation; verify whether this is acceptable.
- Data-changing fixes (for example a type conversion) are reversible from the Recipe. “Show failing” and dimension filters are view state, not data changes.
- DQ report copy/download reflects the current breakdown.

**Failure states to test:**
- Clean data, multiple issue types, no issues, all values missing in a column.
- High-cardinality columns, text fallback that could be numeric/date.
- Consistency/timeliness checks before any pair/key/freshness check exists.
- A failing check with no drill-down or fix action.
- Filters active: DQ must still describe the whole dataset.
- Clipboard blocked during “Copy report”.

**Existing automated coverage:**
- Strong data-layer coverage: `score`, `dq-report`, `findings`, anomalies, missingness, dependencies, relationships, distribution.
- Component coverage: `quality-page.test.ts` (score, dims, fixes, matrix, issue-only mode, downgrade conversion), `quality-panel.test.ts` (legacy/unused drawer), `ui-overview.test.ts` (health tiles and next steps), `triage-panel.test.ts`.
- **No App-level test** for the DQ tile, DQ tab, matrix drill-down, filter-to-table transition or DQ export wiring.

**Browser verification required (manual/proposed until automated):**
- Real score tile and tab rendering with a loaded fixture.
- Drill-down from checks/matrix to filtered table.
- Weights/bands persistence and re-render.
- Markdown/JSON export and clipboard behaviour.
- Correct rendering of n/a and advisory-only states.

**Note:** `src/ui/quality-panel.ts` is not mounted by the current `App`; `QualityPage` is the live dashboard. Do not treat tests for the legacy drawer as coverage of the current screen.

---

## J3 — Search, filter and inspect records

**User goal:** Find relevant records quickly and understand the result set.

**Current starting state:** A dataset is loaded; Table, Views or Chart lens is open.

**Actual entry points (source-verified):**
- Left “Filters” sidebar with “Find a column…” and “Clear all”.
- Per-column filter cards: Contains / Exact / Fuzzy / Sounds like; value checkboxes with counts; numeric/date/time/duration ranges and histogram slider. These are per-column filters, not a dataset-wide search box.
- Results bar: `+ Add filter`, active filter chips and result count.
- Column header QA chips; health chips (“Duplicates”, “Empty cells”, “Outliers”).
- Table sorting and column header inspection.
- The sidebar is initialized for Table, Views and Chart. Quality and Reports do not initialize it; a previously built sidebar may remain visible and needs browser verification.

**Expected steps:**
1. Locate a column in the sidebar or use “+ Add filter”.
2. Choose a mode or range and enter/select a value.
3. Observe live result count, facets and filtered histograms.
4. Add or remove filters; clear one or all.
5. Inspect matching rows in the table; optionally copy or export the filtered rows.

**Expected outcome:**
- Filter semantics and scope are clear.
- Active filters are visible, individually removable and reflected in the result count.
- Facet counts and histograms update without losing the current view.
- Clearing filters restores the expected rows.
- No-match states and empty results are explained.
- Filter changes do not silently alter the stored data.

**Failure states to test:**
- Exact, contains, fuzzy and phonetic matches.
- Accents, apostrophes, ß/ss and special characters.
- No matches and zero-valued facets.
- Numeric/date ranges, reversed bounds, empty bounds.
- Multiple filters, special filters and column-scoped specials.
- Very wide/high-cardinality data; rapid typing and filter changes.
- Filter state while switching to Chart/Views and back.

**Existing automated coverage:**
- Strong engine coverage: `query`, `fuzzy`, `phonetic`, `incremental`, `column-specials`, worker filter/special tests, order tests.
- **No direct tests for `src/ui/filters.ts` (FilterPanel).**
- **No App-level tests** for filter chips, `+ Add filter`, sidebar search, `Clear all`, or Chart/Views reacting to filters.

**Browser verification required (manual/proposed until automated):**
- Real sidebar interaction and live facet updates.
- Range slider dragging and typed bounds.
- Filter chips and “Clear all”.
- Result-count wording under filters and shuffle.
- Chart source/filtered-histogram updates while the Chart lens is open.

---

## J4 — Clean and transform data safely

**User goal:** Correct or reshape data while understanding and controlling every change.

**Current starting state:** A dataset is loaded.

**Actual entry points (source-verified):**
- Column header click → inspector: quick cleans, fill, split, round, missing values, merge, rename, delete.
- Right-click header → Column / Clean / Transform menus.
- Overview next steps and QA chips.
- Command palette: clean/case/convert/escape/round/fill/split/group/dedupe/drop/transform.
- “Recipe” in the nav row for undo and history.

**Expected steps:**
1. Identify a problem through a chip, Overview or column inspection.
2. Apply a parameter-free clean directly, or open Clean/Transform for configured operations.
3. For parameter-free cleans, observe the immediate change and use the Undo toast if needed. For Clean/Transform panels, review preview/impact notes before applying.
4. Confirm the change and observe the updated table and action status.
5. Open Recipe to inspect, reorder, undo a step or undo all.
6. Optionally export generated code.

**Expected outcome:**
- The user understands the operation, target columns, scope and affected rows.
- Configurable operations preview or clearly describe their effect; instant cleans rely on the Undo toast.
- Pending and applied changes are distinguishable.
- Every **data-shaping** change lands in Recipe and can be reversed where supported: cleans, null policies, type changes, row deletions and transforms.
- Filters, display-only number formatting/grouping, views and chart configuration are separate state and are **not** in Recipe.
- Individual transforms: only the last transform can be undone individually; a committed transform batch can be undone as a batch. Cleans can be reordered within a column.
- Errors do not silently discard or corrupt data.
- Type changes, null policies, row deletions and transforms are all represented.

**Failure states to test:**
- Valid operation, invalid input, zero affected rows, many affected rows.
- Chained cleans on one column and across columns.
- Type conversion with unparseable values.
- KNN/fill with missing or unrelated predictors.
- Split regex with no capture groups or invalid pattern.
- Combine date/time with mixed orders and time zones.
- Delete rows/columns, then restore/undo.
- Transform that changes schema while views/charts are open.

**Existing automated coverage:**
- Strong operation coverage: `clean-ops`, `transform-ops`, `split-column`, `date-combine`, KNN, worker clean/convert/null-policy/duplicates/transform/preview, `recipe`.
- Component coverage: `clean-panel`, `ui-transform`, `column-inspector`, `steps-panel`, `steps-group`.
- Cross-cutting worker workflow: `workflow-timeseries` (convert → nulls → sort → filter → aggregate → recipe).
- **No App-level test** for applying a fix, the undo toast, header rename, delete/restore, transform commit/undo, or recipe replay through the file picker.

**Browser verification required (manual/proposed until automated):**
- Preview counts and impact notes with real data.
- Immediate clean actions and Undo toast.
- Recipe reorder/undo/undo-all.
- Delete staging, confirmation and restore.
- Transform application with charts/views open.
- Recipe save/replay file flow.

---

## J5 — Generate an analysis or visualisation

**User goal:** Get useful insight from the current dataset and filters.

**Current starting state:** A dataset is loaded.

**Actual entry points (source-verified):**
- **Chart** tab, keyboard `5`.
- “+ Add chart” gallery or left chart-type rail.
- Per-card **Source** selector: the filtered Table or a saved View.
- Column inspector “Chart”; Overview “Open Chart”; Views “Chart this”.
- **Views** tab for saved aggregate definitions.
- **Reports** tab, keyboard `6`, for Quality / Relationships / Anomalies.
- Stats Report from Overview or the table/chart `⋯` menu.

**Expected steps:**
1. Open Chart, Views or Reports.
2. Choose a chart type, aggregate view or report tab.
3. Select columns/source, filters and settings.
4. Inspect the result and its labels/units/source note.
5. Optionally focus, zoom/pan, animate or export an image/animation.
6. For Views: drill into a group, chart it, render a Slick table, copy pandas code or use it as a dataset.

**Expected outcome:**
- Available analysis types are discoverable. The gallery shows visible reasons for disabled types; the chart rail exposes the reason through a tooltip, which needs browser verification.
- Chart results are tied to the selected Source; reports must state whether each finding is dataset-level or based on current rows.
- Charts explain empty/invalid states instead of rendering blank axes.
- Labels, units, aggregation semantics and source are understandable.
- Chart cards may be remapped after a transform, but saved Views are reset on load or transform schema changes. They do not persist across those changes.
- Exports reflect the visible result.

**Failure states to test:**
- Numeric, categorical, date-only, datetime and mixed-type data.
- Insufficient rows, constant columns, all-empty columns, high cardinality.
- Filters leaving zero rows.
- Column deletion/rename while charts/views exist.
- Correlation with fewer than two columns.
- Map without valid coordinates; animation without a date column.
- WebCodecs unavailable for MP4.
- Reports with filters active: compare dataset-level and current-row findings to confirm the displayed scope is clear.

**Existing automated coverage:**
- Extensive: `aggregate`, `chart-bins`, `chart-series`, `chart-stats`, `chart-frames`, `chart-gallery`, `chart-setup`, `chart-panel`, `chart-hits`, `ui-charts`, `views-panel`, `map`, `geo`, `topo`, `gif`.
- Chart canvas is tested with a mock context, not a real renderer.
- Reports data findings are tested, but `ReportsPanel` has no direct test.
- **No real-browser visual, interaction or export verification.**

**Browser verification required (manual/proposed until automated):**
- Canvas rendering and visual legibility at supported widths.
- Wheel zoom, drag pan, focus mode and map brush.
- Chart source switching and filtered-row semantics.
- PNG/GIF/MP4 downloads and file validity.
- Reports rendering, “Explain [column]” and finding actions.
- Views drill-down, pivot rendering and Slick table export.

---

## J6 — Export data or a reproducible recipe

**User goal:** Take the result into another tool or reproduce the work.

**Current starting state:** A dataset is loaded, optionally filtered and transformed.

**Actual entry points (source-verified):**
- Nav row “Export…” → CSV name, scope, first-N, blank nulls, formula escaping. Parquet is shown as “planned” and disabled.
- Results bar “Copy” → filtered rows as CSV.
- Quality page “Copy report” / “Download JSON”.
- Chart cards: PNG; animation cards: GIF or MP4.
- Views “Slick table” → HTML or PNG.
- Recipe: “Copy recipe”, “Save recipe.”, “Replay recipe.”, pandas/Polars selector.
- DQ pipeline emitters (SodaCL/dbt/Great Expectations/Deequ) exist in code but are not exposed by the live QualityPage; the legacy `quality-panel.ts` that exposed them is unmounted.

**Expected steps:**
1. Open Export, choose file name and scope.
2. Confirm whether all rows after steps or only filtered rows will be written.
3. Optionally set a first-N subset, blank null handling and formula escaping.
4. Save/download and verify the file.
5. For reproducibility, open Recipe, choose pandas or Polars, copy/save and optionally replay later.

**Expected outcome:**
- Export format and row scope are explicit before writing.
- The user knows whether filters and transformations are included.
- Export failure or blocked clipboard is reported.
- Generated code reflects the actual ordered Recipe.
- Unsupported/manual steps are named, never silently omitted.
- Saved recipe files replay by column name and report unmatched/missing columns.

**Failure states to test:**
- No filters vs active filters; all rows vs first-N; zero filtered rows.
- Original, cleaned, transformed and deleted-row states.
- Null markers, European decimals, date/datetime values and formula-like cells.
- Unusual/problematic column names.
- Parquet export (must remain disabled) and hidden DQ pipeline formats (must not be presented as live).
- Clipboard permission denied.
- File System Access unavailable or user cancels.
- Recipe with unsupported KNN/fence/flag steps.
- Recipe replay with missing/renamed columns.

**Existing automated coverage:**
- Strong: `csv`, `export-panel`, worker `startExport`/`getCsv` scope and chunking, `dq-report`, `recipe`, `recipe-polars`, `recipe-file`, `recipe-mapping`, `steps-panel`.
- **No browser download, clipboard, File System Access or full `App.runExport` test.**
- No E2E check that filtered-vs-all export contains the expected rows.
- No visual verification of chart/Slick-table exports.

**Browser verification required (manual/proposed until automated):**
- Real download and clipboard permissions.
- File System Access path and fallback.
- CSV encoding/BOM/formula escaping in a spreadsheet.
- Chart PNG/GIF/MP4 files.
- Recipe save/replay through the file picker.

---

## J7 — Recover from a mistake or failed operation

**User goal:** Return to a known-good state after an accidental change, a failed load or a destructive action.

**Current starting state:** A dataset is loaded, or an operation has just been attempted.

**Actual entry points (source-verified):**
- Undo toast after a parameter-free clean.
- Nav row “Recipe” → individual step undo, batch undo, clean reordering, “Undo all”, and row-deletion restore.
- Recipe “Replay recipe.” → load a saved JSON recipe and apply it by column name.
- Topbar “Clear data” → confirmation dialog, then return to the start screen.
- Worker crash handler → automatic reset to the start screen with an explanation.
- Load panel “Cancel” → stop an in-flight import and keep the previous dataset.

**Expected steps:**
1. Notice the mistake or failure and the feedback shown by the app.
2. Use the Undo toast for an immediate clean, or open Recipe for applied data-shaping changes.
3. Undo one step, one batch or all changes; restore deleted rows from Recipe.
4. Alternatively, confirm “Clear data” and start again.
5. If a recipe file is available, replay it and resolve any column mappings or skipped steps.

**Expected outcome:**
- Undo restores the prior data and keeps the table, views and charts coherent.
- Restoring deleted rows is available from Recipe.
- “Undo all” reverses cleans, null policies, type changes and transforms; it does not restore deleted rows. Row deletions are restored separately with “Undo the row deletions”.
- Clear data is confirmed, visibly closes the workspace and states that saved recipes are not affected.
- A worker OOM is not recoverable in-session: the app restarts with nothing loaded and explains what happened.
- Reloading the browser loses the dataset and pipeline; this is current behaviour, not a recovery path.
- Recipe replay applies steps to the current dataset and reports missing/mismatched columns; it does not restore the original file.
- Cancelled imports leave the previous dataset intact.

**Failure states to test:**
- Undo toast after each quick-clean type.
- Undo a clean, a null-policy change, a type change, a deleted row set and a transform batch.
- Attempt to undo a non-last transform step.
- Reorder cleans, then undo.
- Cancel “Clear data” and confirm it leaves the workspace intact.
- Confirm “Clear data” and verify the workspace/state reset.
- Worker OOM during a large load.
- Cancel a large load mid-progress.
- Replay a recipe with missing, renamed or ambiguous columns.
- Browser reload to confirm current state-loss behaviour.

**Existing automated coverage:**
- `steps-panel`, `steps-group`, `recipe-file`, `recipe-mapping` and worker load-cancel tests.
- No App-level test for the Undo toast, Recipe wiring, delete restore, Clear data or worker crash recovery.
- No OOM test and no end-to-end test of recovery after a real browser failure.

**Browser verification required (manual until automated):**
- Undo toast timing and scope.
- Recipe undo/batch/undo-all with charts and views open.
- Restore deleted rows.
- Clear data cancel/confirm.
- Worker OOM reset and messaging.
- Large-load cancellation.
- Recipe replay file picker and mapping dialog.

---

## Journey scoring

Record this after a browser baseline and after UX changes. The current status is repository-only:

| Journey | Current result | Automated evidence | Browser evidence | Main gaps |
|---|---|---|---|---|
| J1 Import and understand | Not browser-tested | Strong parser/worker, no App/UI flow | None | File picker, drag/drop, paste, archive/sheet, large-load UI |
| J2 Profile quality | Not browser-tested | Strong score/data + QualityPage component | None | DQ tile/tab, drill-down, export wiring |
| J3 Search/filter | Not browser-tested | Strong engine, no FilterPanel/App tests | None | Sidebar interaction, chips, facet updates, chart coupling |
| J4 Clean/transform | Not browser-tested | Strong operations/panels/worker, partial App gaps | None | Apply/undo wiring, delete/restore, recipe replay |
| J5 Analyse/visualise | Not browser-tested | Strong logic/component, mocked canvas | None | Real rendering, interactions, exports, Reports panel |
| J6 Export/recipe | Not browser-tested | Strong generators/dialog/worker chunks | None | Downloads, clipboard, File System Access, full export |
| J7 Recovery | Not browser-tested | Partial: steps/recipe/load-cancel logic | None | Undo toast, Recipe wiring, delete restore, Clear data, OOM, replay |

For each future run, record:

- Completion: pass / partial / fail / not tested.
- Steps/clicks, if meaningful.
- Time to complete, if measured.
- Confusion or recovery points.
- Relevant issue IDs.
- Screenshot or test evidence.
- Regression tests required after changes.

Do not mark a journey as passed solely because the screen looks correct or because isolated unit tests pass.
