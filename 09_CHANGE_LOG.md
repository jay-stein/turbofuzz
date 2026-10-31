# UX Change Log

Record shipped or attempted UX changes and what was verified.

## Entry template

### CHG-YYYY-MM-DD-NN — Short title

- **Status:** Planned / In progress / Verified / Rolled back
- **Related issue / decision:**
- **Git commit / PR:**
- **Problem addressed:**
- **Scope:**
- **Explicit non-goals:**
- **Acceptance criteria:**
- **Files / components changed:**
- **Tests run and results:**
- **Manual browser verification:**
- **Regression findings:**
- **Feature inventory / baseline updates:**
- **Known limitations:**
- **Decision:** Ship / revise / roll back
- **Date:**

---

## Recent changes

Add entries here. Keep unsuccessful attempts too if they reveal useful constraints or recurring failure modes.

### CHG-2026-10-31-19 — Time Series: "Periods" becomes a clear data table

- **Status:** Verified
- **Related issue:** Owner: "what is the Periods button - is that the table of the numbers? is it actuals or forecast? that is vague".
- **Scope:**
  - **Button:** "Show data table" / "Hide data table", with a tooltip.
  - **Caption:** says the table lists the periods in view, how many, and that Export downloads them all.
  - **Status column:** Actual / Actual, held out / Actual, partial / No rows; *how filled* / No rows / Forecast. Forecast rows are shaded; filled and empty rows are dimmed.
  - **Headers:** "Actual (measure)" and "Forecast (model name)".
  - **Row limit:** past 400 rows in view it keeps the latest 400, so the forecast is never cut off.
  - The help text describes the Export menu and the data table.
- **Tests run and results:** a Time Series e2e case; full suite 1160 unit and 108 e2e pass; build OK.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-18 — Time Series: an Export menu for analysts

- **Status:** Verified
- **Related issue:** Owner: no visible way to export the forecast; wanted the model details and performance as CSV.
- **Scope:** The faint "Export CSV" became a clear **Export ▾** menu with four CSVs:
  - **Forecast:** future periods, model, forecast and the 80% and 95% bands.
  - **Series and forecast:** the old export, plus a row_type column (actual / filled / empty / actual held out / forecast), the model name and the 95% band.
  - **Model scorecard:** one row per model, ranked by the chosen measure: all seven measures, vs repeat-last-cycle, grade, folds beaten, band and held-out checks, the validation window, train length, horizon and fold step, the fitted range, and parameters (e.g. `ETS(A,Ad,M) alpha=… beta=… gamma=… phi=… AICc=…`).
  - **Backtest detail:** long form (model, fold, fold origin, step ahead, period, actual, forecast, error, abs error, filled), so any measure can be recomputed; MAE recomputed from it matches the board.
- **How:** The fold forecasts stay in the worker and are only sent when this export asks (`backtest: true` on getTimeSeries), so normal page updates carry no extra data.
- **Tests run and results:** `test/timeseries-export.test.ts` (2); an e2e downloading all four; Time Series e2e green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-17 — Time Series: Rank by up front

- **Status:** Verified
- **Related issue:** Owner: "Rank by" was hard to see, though it drives the page (it picks the Auto model, the line on the chart).
- **Scope:**
  - **Rank by** (default MASE, marked "(default)") and **Validate** moved from the Models panel into the Forecast toolbar beside Forecast ahead. Rank by is highlighted, with a "?" that opens Which model, and why?.
  - The chart legend names the forecast's model: "Forecast: Best smoothing · Auto, best on MASE", or "picked".
  - The summary strip's Forecast cell names the model.
  - The Models panel says what it is ranked by, the window and the number of folds.
- **Tests run and results:** Time Series e2e (12) pass.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-16 — Time Series: better gap fills, and a smart one for the models

- **Status:** Verified
- **Related issue:** Owner, testing on `gym_stats.csv` (10-minute gym counts, 2,334 of 13,971 hours empty, gaps up to 25 days): "filled with the usual pattern" performed poorly.
- **Evidence:** Real stretches of the hourly series were hidden and refilled, 60 per gap length, scored by mean absolute error in people:
  - The usual pattern is best up to about 6 hours (3.7 at 3 h).
  - From 12 hours up, the median of the same hour-of-week in the nearest 4 cycles either side misses 20-40% less (24 h: 7.5 vs 9.3; 72 h: 5.5 vs 9.3; 240 h: 7.3 vs 10.0).
  - Carry-forward and linear are 2-3× worse on long gaps.
- **Scope:**
  - New gap choices: *filled smartly* (the usual pattern for gaps up to a quarter of the shortest season, the nearby typical value beyond), *nearby typical value*, *copied from the cycle before*, *carried forward*, alongside the usual pattern, interpolated, zero and left empty.
  - The models now bridge gaps with the smart fill instead of the usual pattern; they still never learn from or score filled periods.
  - Series with no gaps skip the fill work.
- **Tests run and results:** `test/timeseries-fill.test.ts` (2); Time Series unit and e2e; bench:timeseries within budgets (one noisy run over on the daily drag, which does not touch the fill).
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-15 — Time Series: validation window, seven accuracy measures, "Which model, and why?"

- **Status:** Verified
- **Related issue / decision:** next_steps.md "Time Series (owner, 2026-10-31): why one model over another, overfitting, AutoARIMA".
- **Scope:**
  - **Validate** on the Forecast board: an *Expanding window* (default; each fold trains on all history before it) or a *Rolling window* (each fold trains on the first fold's length, sliding forward). It applies to every model; repeat-last-cycle needs no training.
  - **Measures:** every model gets MAE, RMSE, MASE, WAPE, sMAPE, MAPE and bias from the same backtest errors, with no extra fitting. **Rank by** picks the measure, and the Auto pick follows it (bias by its size).
  - **Board:** new columns for the chosen measure and **Folds beaten** (folds where the model beat repeating the last cycle).
  - **Model card:** says how the folds trained, lists all the scores, warns when the best model wins under half its folds (a possible lucky lead), and flags a close call (within 5%; prefer the simpler model).
  - **"Which model, and why?" window:** how the scores avoid overfitting, the two windows with fold diagrams, when each model shines and when to doubt it, and the measures table: Metric | Why it's good (strengths) | When to use it | Math (formula).
- **Not done:** the in-sample "fit gap" from the plan. One-step in-sample errors are not comparable with multi-step backtests, so fold wins and the expanding-vs-rolling comparison carry that signal instead.
- **Tests run and results:** `test/timeseries-validation.test.ts` (2), a Time Series e2e case; bench:timeseries within budgets; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-14 — Time Series: auto-ETS, and backtests that never test on tuned data

- **Status:** Verified
- **Scope:** A new model "Best smoothing": ETS with additive errors over trend none / additive / damped and season none / additive / multiplicative (positive series), each fitted by least squares and the lowest AICc kept (Hyndman & Athanasopoulos, fpp3 ch. 8). The model card names the form, e.g. ETS(A,Ad,M), and its parameters. The Blend now averages best smoothing, steady trend and drivers. Overfitting fix: the backtest's smoothing parameters (ETS and Holt-Winters) are now fitted on data before the first backtest origin only; before, Holt-Winters was tuned on all the history including the stretches it was scored on. ETS fits the latest ~800 periods (or six seasons), the backtest cut is rounded down to a coarse step and fits are cached, so a horizon drag refits nothing.
- **Tests run and results:** `test/timeseries-ets.test.ts` (a growing seasonal series picks a multiplicative season and beats additive Holt-Winters); bench:timeseries within budgets; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-13 — New column from examples

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 6 (Power Query Column From Examples, Excel Flash Fill).
- **Scope:** A From examples mode in the New column window: the first six rows with a "You want" box each; as results are typed, the worker tries an ordered set of rules (`src/data/formula-examples.ts`: the column, case, trim, length, text before/after a separator, first/last N characters, date parts, rounding, two columns joined or combined) on just those rows and offers the formulas that give every typed result, simplest first; the preview then shows them on more rows. The answer is an ordinary editable formula.
- **Tests run and results:** `test/formula-examples.test.ts` (2, incl. a 40-column speed check), a New column e2e case; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-12 — Table usability: headers, menu search, hide and freeze columns, cell peek, paste a block

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 5 (and pasting a block from step 6).
- **Scope:** Columns start wide enough for their name and typical value (110-360 px) and the column number shows on hover only, so names stop being cut. The header menu has a search box (type, Enter runs the first match). Hide column (display only; a "N hidden · Show all" note in the Table bar; the cursor skips hidden columns). Freeze columns up to here (sticky, with the row numbers and File row). The Table bar shows the cell under the cursor in full. Paste a block of cells at the cursor: one confirm, a setCells step per column on file rows (up to 5,000 cells). An empty result offers Clear filters.
- **Not done:** row density (the virtual grid's row height is fixed), moving first-run hints off the rows.
- **Tests run and results:** `test/e2e/table-usability.spec.ts` (4); full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-11 — New column: If / then builder and quick columns

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 4.
- **Scope:** The New column window gains If / then (column, test, value → result rows, Else if, Otherwise, Show as formula; numbers and dates compare as such) and Quick column (copy, row number, text length, join two columns, year/month/day/weekday, rank, % of total, running total, change from the row above, equal-width bands; the name follows the pick). Both write formulas, so preview, Recipe, export and parity are unchanged. New whole-column formula functions ROWNUMBER, RANK (ties share the best rank), PERCENTOFTOTAL, RUNNINGSUM, PREVIOUS, BIN, worked out once per column in the stored order and ported exactly to the pandas/Polars helpers.
- **Tests run and results:** `test/new-column-builders.test.ts` (2), whole-column unit test, a new New column e2e case, parity case `formulas` extended (pandas PASS, Polars PASS); full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-10 — Table: cell cursor and editing a cell in place

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 3; DEC-2026-10-31-02 (confirm on by default).
- **Scope:** A cell cursor in the grid (click; arrows, Page Up/Down, Ctrl+arrows to the edges, Home/End, Ctrl+C copies, Esc clears; the grid's keys no longer reach the 1-9 tab shortcuts). Editing in place: double-click, Enter, F2 or typing; Enter commits and moves down, Tab right, Esc cancels. A confirm next to the cell (`src/ui/cell-edit-confirm.ts`) shows old and new value with the file row, warns when the value does not fit a number or date column, and offers Don't ask again for this session. Each edit is a `setCells` clean step keyed by the row's file number (cleans see the current rows), so it stays with the row; consecutive edits on one column merge into one step keeping each cell's first value; after the edit the cursor returns to that cell wherever the row now is. pandas (`df.iloc[...]`) and Polars (`pl.when(pl.int_range(...))`) write it.
- **Tests run and results:** `test/e2e/cell-edit.spec.ts` (3), a setCells unit test, parity case `cell-edits` (pandas PASS, Polars PASS); full suite green.
- **Known limitations:** an edit clears that column's own filter (as any clean does) and the sort returns to file order; pasting a block of cells is a later step.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-09 — Formula columns in the pandas and Polars recipes

- **Status:** Verified
- **Related issue / decision:** DEC-2026-10-31-01 acceptance: every function has a parity case.
- **Scope:** `src/data/formula-export.ts` writes each formula as a small Python function over one row, with one shared helper block (written once per script) that ports the app's rules and all 28 functions; pandas inserts the column with `df.insert`, Polars with `insert_column`, both as the app's text. A formula that no longer reads against the tracked columns is marked for manual work. Row by row is slower than vectorised code, by choice: the recipe must agree with the app cell for cell. Fixed in the app: a formula writing a word that usually means missing ("Unknown", "N/A") showed an empty cell; a new column now keeps its own output.
- **Tests run and results:** recipe parity harness (`tools/recipe-parity`, new `formulas` case: 47 formula columns over blanks, errors and dates): pandas PASS, Polars PASS, every other case PASS; codegen unit test; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-08 — Table: New column window (formula or one value)

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 2; DEC-2026-10-31-01 (Excel style), DEC-2026-10-31-02 (computed once).
- **Scope:** `src/data/column-formula.ts`: Excel-style formulas (`[Column]`, + - * / ^ &, comparisons, 28 functions), checked against column types with errors that point at the place and suggest a fix, compiled to closures (no eval). Rules: blank in, blank out; comparisons with a blank FALSE except `<>`; text compares case-insensitively; date - date is days. A `derive` transform step inserts the column (typed from the result) at a chosen place; it carries over in recipe files and survives renames via `renameInFormula`. A `previewFormula` worker request shows the first 20 rows with the inputs and counts empties and errors by reason (all rows up to 200k, else an even sample). The window (`src/ui/new-column-dialog.ts`): name, place, Formula or Same value for every row, column suggestions after `[`, function help at the caret, column and function lists. Ways in: + after the last header, Insert column left/right, Add column in the Table bar, `add column name = formula`. Fixed: the Table bar showed "No rows" after a transform rebuilt the table.
- **Known limitations:** pandas/Polars export of formulas is the next step (until then the recipe marks the step for manual work).
- **Tests run and results:** `test/column-formula.test.ts` (8), `test/e2e/new-column.spec.ts` (3); full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-07 — Table: first / last N rows

- **Status:** Verified
- **Related issue / decision:** next_steps.md, "BIG TODO: the Table view", section 2; DEC-2026-10-31-02 (it is a filter Copy, Chart and Export respect).
- **Scope:** A First / last N menu in the Table bar (10, 100, 1,000 or a number you type, from the top or the bottom of the current order; All rows), a filter chip ("Last 10 rows ×") that Clear all also removes, and `head 100` / `tail 50` / `head all` in the command bar. The worker applies it where the current rows are built, so the count, the row read-out, chart cards, Pivot View, Time Series, Copy and Export all use the same rows; after a shuffle the first N are a random N; a new dataset clears it.
- **Tests run and results:** a new `test/e2e/table-nav.spec.ts` case; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-06 — Table navigation: where you are, Go to, Top/Bottom, Reverse, file row numbers

- **Status:** Verified
- **Related issue / decision:** next_steps.md, "BIG TODO: the Table view", order of work step 1.
- **Problem addressed:** The Table did not say which rows were on screen or how they were ordered, had no way to jump to a row, the end or a column, could not reverse, and lost the file's own row number once rows were sorted. Past 9,999 rows the # column cut its numbers off.
- **Scope:** A bar under the Table (`src/ui/table-nav.ts`): "Rows 41–66 of 12,480" (click to Go to), Top and Bottom (Ctrl+Home, Ctrl+End), Reverse, File row, the order in words ("file order", "sorted by Amount ↓, reversed", "shuffled") with Back to file order, and Go to (Ctrl+G; `src/ui/table-goto.ts`): a position, -1, 50%, `file 1234`, top/bottom, or a column name (fuzzy). The worker reverses in `computeSortedIds`, so reversal holds through every filter and re-sort; a header sort or a shuffle clears it. New worker requests: `getRowIds` (File row numbers for the rows on screen, only while the column is shown), `findRow` (where a file row sits now, or that filters hide it), `getOrder`. The File row column is remembered in this browser; the # column widens to fit five or more digits. Command bar: `goto …`, `reverse`.
- **Tests run and results:** `test/table-goto.test.ts` (5), command-bar cases, `test/e2e/table-nav.spec.ts` (3); full suite green.
- **Known limitations:** First N / last N, keyboard cell movement and frozen columns are later steps of the plan.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-05 — Time Series: which seasons to decompose, said plainly

- **Status:** Verified
- **Related issue / decision:** next_steps.md, owner TODO 2026-10-30 item 4.
- **Problem addressed:** Seasons the series was too short for disappeared without a word; sub-daily data offered no way to see the week and year without the swings within a day; a yearly season in weekly data used 52 weeks and drifted about a week every five and a half years.
- **Scope:** Decomposition season lengths follow fpp3: a year is 365.25 days and 52.18 weeks (`Grain.decPeriods`; models keep whole-number `periods`). `phaseIndex`/`phaseCount` place each period by its share of the way through a calendar cycle, so all 52 weekly phases are used evenly; whole lengths are unchanged (i % m). The engine returns the grain's seasons the series is too short for (`tooShort`, with the periods needed: 2 cycles + 2); the page shows them greyed with the rule, named as this page's own (fpp3 sets none). Decompose gains Daily view (sub-daily grain to day, for the weekly and yearly season) and Back to hourly. Help credits Hyndman and Athanasopoulos.
- **Tests run and results:** `test/timeseries-seasons.test.ts` (3; ten years of weekly data: yearly strength 0.955 with 52.18 weeks against 0.872 with 52), a new Time Series page e2e test; full suite green; bench:timeseries within budgets.
- **Known limitations:** Closed hours still count in the period length (plan: open slots only). STL/MSTL and Box-Cox from item 5 are not done.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-04 — Time Series reads a Pivot View as its source

- **Status:** Verified
- **Related issue / decision:** next_steps.md, owner TODO 2026-10-30 item 3; D1 (view-sourced charts stay linked).
- **Problem addressed:** Someone who had already aggregated in Pivot View (monthly sum of sales, filtered) had to rebuild the same series from raw rows on the Time Series page.
- **Scope:** A Source word in the subline: Table, or any complete Pivot View with a time-grain dimension and a measure. The worker runs the view's own aggregation (its filters and scope, every group, partial periods kept and flagged) and `src/data/timeseries/view-source.ts` turns the result into engine input: the time dimension is the date, each measure a column (never read as a date part or time counter), other dimensions the split-by choices and the shape check's candidates. The grain is the view's own and only sum or mean (across split rows) are offered; the page says the periods are read as they are, not aggregated again. Edge periods the raw rows only partly cover are marked partial, as for the Table. Linked: editing, renaming or removing the view, or changing the filters, updates the series; a removed view falls back to the Table. Clicking a period filters the Table on the view's date column.
- **Tests run and results:** `test/timeseries-view-source.test.ts` (4), a new Time Series page e2e test; full suite green.
- **Known limitations:** Views are only offered once Pivot View has been opened (its panel creates the starter views). The banner's "Open in Pivot View" button is still to do.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-03 — Time Series: several series in one line, and the data's frequency

- **Status:** Verified
- **Related issue / decision:** next_steps.md, owner TODO 2026-10-30 items 1 and 2.
- **Problem addressed:** Rows with several values per timestamp (one per car park, store, sensor) were summed or averaged into one line without a word, so trend, seasons and forecasts were fitted to a mix of series. The page did not say how often or how regularly rows come.
- **Scope:** `src/data/timeseries/shape.ts` reads the rows behind the series shown: rows per moment, share of repeated moments, the category column whose values differ within (almost) every repeated moment (fewest values first, so a row id loses to the series name), and the spacing (typical gap, share on the beat, share on a whole number of beats, p10/p90). The worker works it out once per data, filter or group change and sends it with the snapshot. The page shows an amber banner ("Each moment in snapshot_time holds 5 rows, one per car_park. This line adds 5 car_park series together…") with One car_park at a time, Average them instead (for a sum) and Keep the sum, and a Frequency cell in the strip ("Every day, regular", "Every 30 minutes, regular, some missing", "Irregular, usually every 30 minutes, most 26 to 34 minutes"). Count series never get the banner.
- **Tests run and results:** `test/timeseries-shape.test.ts` (4) and a new Time Series page e2e test; full suite 1125 unit, 87 e2e. 1M rows: 50 to 90 ms, once per data change. bench:timeseries within budgets.
- **Known limitations:** Open in Pivot View (item 2) and Pivot View as a source (item 3) are not done. A pair of columns that only together tell rows apart is reported as "no single column".
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-02 — Map page: dock on the map, Add markers window, marker size

- **Status:** Verified
- **Problem addressed:** The Cities box sat in the page header away from the map; adding markers was a row of buttons above the map that pushed it down; markers had one fixed size.
- **Scope:** A floating dock on the map (Cities switch, Marker size slider, Click map to add, + Add markers…), on top of the map from 860px, above it on narrower screens. Add markers window (`src/ui/map-add-dialog.ts`): paste box, CSV, city search, live preview with skipped lines, style row (symbol, colour, size), Ctrl+Enter adds. Only latitude and longitude are required; unlabelled rows become Marker N, numbered on from the markers already there. A bare `lat,lon` row under a `label,lat,lon` header still reads, and each line may use its own separator. Markers carry a size (3 to 24 px; `size`/`radius` column; per-row field; saved and in the CSV). The marker table moved under the map. Zoom buttons moved to the bottom left so they no longer cover the map title. City and marker labels use the theme's ink and halo (they were dark-on-white in dark mode), and city names keep clear of markers and their labels. Fixed: map page sections shrank under each other in the scrolling page.
- **Tests run and results:** map-page unit tests (12) and e2e (8, two new: paste with numbering, sizes three ways). bench:map within budgets.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-01 — General and Research modes

- **Status:** Verified
- **Problem addressed:** Nine tabs put specialist views in front of every user.
- **Scope:** A `General | Research` switch at the left of the tab row (`src/ui/mode.ts`). General shows Overview, Data Quality, Table, Pivot View and Chart. Research adds Outliers, Relationships, Time Series and Map in a teal lane after a divider; they slide in when switched on. The mode is remembered (`turbofuzz-mode`, default General). Number keys follow the visible tabs, so Chart is now 5 and the research tabs are 6–9. Switching to General on a research page returns to the last general page, with Undo. In General the chart cards' "Open in Time Series / Map" links and the "Review the outliers first…" menu item are hidden. The command bar's outliers, relationships, forecast and map commands switch to Research, and new `research`, `general` and `mode …` commands were added.
- **Tokens:** `--research`, `--research-soft`, `--research-border`, `--research-text`, `--research-lane`, each with dark values. Teal is used for Research mode only.
- **Tests run and results:** `npm test` 1119/1119; Playwright 83/84 in the full run, with the a11y light-theme test timing out under load (8/8 when rerun on its own). New `test/e2e/mode.spec.ts`; research-page specs start in Research mode.
- **Manual browser verification:** Screenshots at 1440, 622 and 375px in light and dark. Below 480px the switch shows icons only.
- **Known limitations:** Already present before this change: clicking a line card's "Open in Time Series →" right after the card first draws freezes the page under Playwright tracing (reproduced on the previous commit). Relationships overflows horizontally below about 700px, also unchanged.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-29-01 — Band caps and optional columns

- **Status:** Verified (unit tests, corpus run); not yet checked in a browser by the owner
- **Related issue / decision:** DEC-2026-10-29-01, plan tasks BAND and OPT
- **Problem addressed:** A good average hid mostly-empty or mostly-invalid columns; blank-by-design columns led the fix list.
- **Files / components changed:** src/data/score.ts, src/data/optional-columns.ts, src/data/name-hints.ts, src/data/dq-issues.ts, src/ui/quality-layout.ts, src/ui/quality-page.ts, src/ui/optional-marks.ts, src/ui/app.ts
- **Tests run and results:** test/band-optional.test.ts (7), full unit suite 1002 pass.
- **Known limitations:** Optional marks are session-only.
- **Decision:** Ship. Thresholds accepted by the owner as a starting point.
- **Date:** 2026-10-29

### CHG-2026-10-29-02 — Mixed formats and plausible ranges in Validity

- **Status:** Verified (unit tests, corpus run, e2e); not yet checked in a browser by the owner
- **Related issue / decision:** plan tasks T7 and T9
- **Problem addressed:** A date column written several ways, a numeric column with currency symbols on some values, and impossible values (age 999) did not lower Validity.
- **Scope:** Exact counts at load: `dateFormats`, `numberSymbols`, `rangeViolation` on each column. Three new Validity checks, three new fix-list issues, rows-affected includes them. Fixes: date standardise (toDate op), strip symbols (toNumber op), both undoable Recipe steps. Plausible ranges: age 0-120, percent 0-100, year 1900 to next year, gated by whole-word name hints and by the values looking like that thing.
- **Explicit non-goals:** Auto-fix for ambiguous day/month order or dates with times (review only); editable range rules; Show rows filter for these three checks (the column is flashed instead); negative quantities (stay with the existing non-negative finding).
- **Files / components changed:** src/data/date-formats.ts, number-symbols.ts, plausibility.ts, score.ts, dq-issues.ts, dq-rows.ts, column.ts, name-hints.ts, src/worker/protocol.ts, search.worker.ts, src/ui/app.ts, scripts/lib/profile.ts
- **Tests run and results:** date-formats, number-symbols, plausibility, dq-rows-formats; unit suite 1017 pass; e2e 38 pass, 1 flaky setInputFiles timeout that passes alone.
- **Regression findings:** Thousands separators beside short numbers (UCS "35,793" vs "950") were a false positive; grouping now only counts as a second style when a plain 4+ digit value shows the column is not written that way throughout.
- **Known limitations:** Real corpus mixes found: Ask A Manager salary (221 grouped vs 77 plain).
- **Decision:** Ship.
- **Date:** 2026-10-29

### CHG-2026-10-29-03 — Exceptions export (E1) and Apply all safe fixes (T12)

- **Status:** Verified by unit tests; not yet checked in a browser by the owner
- **Related issue / decision:** plan tasks E1 and the apply-all part of T12
- **Problem addressed:** Findings could not be handed to someone who fixes the source system, and the Issues tab had no one-step way to apply every safe fix.
- **Scope:** "Download exceptions CSV" on the Quality hero: one row per failing cell (row, column, check, dimension, severity, value, reason), built in the worker with the same predicates as the scored checks. Values in sensitive-flagged columns are masked unless "Include raw values" is ticked. Values that start like a formula are neutralised. Optional columns do not list their empty cells. "Apply all N safe fixes…" on the Issues tab opens the existing combined preview; each fix stays its own undoable step.
- **Explicit non-goals:** Per-check download buttons on the cards (the worker request already takes a check id); true streaming (the file is built in one message; a confirm appears above 100k rows); a 250k-row timing benchmark.
- **Files / components changed:** src/data/dq-exceptions.ts, src/worker/protocol.ts, search.worker.ts, src/ui/worker-client.ts, app.ts, quality-layout.ts, quality-page.ts
- **Tests run and results:** test/dq-exceptions.test.ts (4).
- **Known limitations:** The exception count can differ slightly from a check's "fail" count where one cell trips several checks; each cell is listed once, under its first reason.
- **Decision:** Ship.
- **Date:** 2026-10-29

### CHG-2026-10-29-04 — Per-column score (part of C1)

- **Status:** Verified by unit test; not yet checked in a browser by the owner
- **Related issue / decision:** plan task C1
- **Scope:** `columnScore(score, column)` applies the dataset formula to one column's checks (pass rate per dimension, optional blanks at reduced weight, weighted by the dimension weights over the dimensions that apply). Shown as a number on each column card in the health strip, with the working in the tooltip.
- **Explicit non-goals:** The profile drawer additions (percentiles, top-10 values, dominant format in words, recommended rules) and virtualised cards for 71+ columns; the existing column inspector is unchanged. Dataset-level checks (duplicate rows) have no column, so they are not in any column score and the column scores do not average to the dataset score.
- **Files / components changed:** src/data/score.ts, src/data/dq-issues.ts, src/ui/quality-layout.ts, src/ui/app.ts, src/styles.css
- **Tests run and results:** test/band-optional.test.ts (8); unit suite 1022 pass.
- **Decision:** Ship.
- **Date:** 2026-10-29

### CHG-2026-10-29-05 — Quality page states (STATES), tests only

- **Status:** Verified (4 new browser tests); screenshot baselines not captured
- **Related issue / decision:** plan task STATES
- **Scope:** The clean-file empty state, the 71-column strip collapse, the post-fix "Fixed this session" group, dark theme and the exceptions download already existed; tests now cover a clean file, a wide file, 390px width with no sideways scroll, a dark-theme contrast sanity check, and the exceptions download.
- **Explicit non-goals:** Screenshot baselines for B/D in both themes; axe run; designed loading and error states beyond the skeleton; score animation.
- **Files / components changed:** test/e2e/quality-layout.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-29-06 — Overview shows the Quality page's issue count (UNIFY, part)

- **Status:** Verified (browser test); not yet checked by the owner
- **Related issue / decision:** plan task UNIFY
- **Scope:** The Overview's "N issues found — Review all" button used its own rough count. It now reads the same issue list as the Quality page ("X issues need fixing · Y worth reviewing") and opens the Quality page. The old count remains only as a fallback before a score exists.
- **Explicit non-goals:** Showing the full issue cards on the Overview; Reports (no separate Reports view was found); retiring the old triage panel, which is still in the code but no longer reached from the Overview button.
- **Files / components changed:** src/ui/overview.ts, src/ui/app.ts, test/e2e/quality-layout.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-29-07 — Near duplicates, suggested pair checks, rules, history, reference accuracy, reports, accessibility

- **Status:** Verified by unit and browser tests; not yet checked in a browser by the owner
- **Related issue / decision:** plan tasks DUPK, T10, R1, R2, S1, REF, REP, SEC, A11Y, DOCS, BENCH-PII, BENCH-PERF; DEC-2026-10-29-02, -03, -04
- **Scope:** Rows equal once an id column is ignored appear as a review item. Name pairs (start/end, created/updated, min/max) become scored consistency checks that can be turned off. Rules tab with recommender, editor, scored checks, a versioned rules file and emitters. History tab with trend and drift. Offline reference lists give Accuracy. HTML report and a message for the data supplier. Help text rewritten for the new page. Axe checks on every Quality tab in both themes (two contrast bugs fixed). A labelled PII benchmark in `npm test` (it found, and this change fixes, version strings read as IP addresses and `1950-2200` ranges read as phone numbers; numeric phone and card columns are now scanned). `npm run bench:dq` in the gate.
- **Also in this change:** Fitness profiles (src/data/fitness.ts; a picker in Score & weights; Sharing starts exports on Mask) and a headless check (`npm run check -- data.csv --rules=rules.json --min-score=80 --exceptions=out.csv`, scripts/lib/check.ts) with a parity test.
- **Explicit non-goals:** Screenshot baselines; saving optional marks or rules across browser restarts; "sharing" raising sensitive flags to review; leakage/constant-column checks for the machine-learning profile; user-overridable semantic types.
- **Files / components changed:** src/data/{near-duplicates,rules,history,reference}.ts, reference/*, pair-checks.ts, dq-report.ts, sensitivity.ts, text-profile.ts, semantic-type.ts; src/ui/{rules-panel,history-panel}.ts, app.ts, quality-page.ts, quality-layout.ts; bench/dq.ts; tests.
- **Date:** 2026-10-29

### CHG-2026-10-29-08 — Review spellings one by one

- **Status:** Verified (unit tests, browser test, screenshot); owner has not tried it
- **Problem addressed:** "Standardise" applied the most common spelling everywhere, with no way to approve groups individually or to pick a different standard when the most common one is the wrong one.
- **Scope:** Spelling issue cards keep the one-click fix and gain "Review one by one…". The dialog lists each group of spellings with counts. The most common is preselected; click any spelling to make it the standard, use Swap on a pair, or type your own. Untick a group to leave it alone; find a spelling; approve or skip all; reset to most common. Optional "also treat placeholders as empty". Applies as one undoable Recipe step and shows under Fixed this session. Ties between equally common spellings now prefer Title Case or lower case over capitals.
- **Files / components changed:** src/data/standardise-review.ts, src/data/variants.ts (all groups, capped at 300), src/data/dq-issues.ts, src/ui/standardise-review-dialog.ts, quality-layout.ts, quality-page.ts, app.ts (fix steps now applied by `applyFixStep`)
- **Explicit non-goals:** The same review for fuzzy matches (Melb. vs Melbourne), which have their own merge panel; remembering a chosen standard across loads.
- **Date:** 2026-10-29

### CHG-2026-10-29-09 — Explicit options in the spelling review; readable column cards

- **Status:** Verified (browser tests incl. axe and the 11px text rule, screenshots in both themes); owner has not tried it
- **Scope:** The spelling review now lists each group as numbered options, each showing exactly what changes and what it becomes ("Option 2: Perth 60, PERTH 60 → perth · 120 cells"). The most frequent spelling is Option 1, highlighted, labelled "Suggested · most frequent" and ticked. Ticking another option moves the choice (one option per group); unticking all leaves the group alone; a last option takes your own typed standard. Swap is no longer a separate control, since Option 2 of a pair is the swap. Column cards in the Data Quality strip no longer clip: the fixed 92px height is gone, the score sits beside the name, text is 12 to 13px and chips wrap.
- **Files / components changed:** src/ui/standardise-review-dialog.ts, quality-layout.ts, src/styles.css, test/e2e/quality-layout.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-29-10 — Time-series charts: honest gaps, calendar axis, one legend, calendar options

- **Status:** Verified (unit tests, 2 browser tests, before/after screenshots); owner has not tried it
- **Related issue / decision:** TODO "time-series chart review" against charting_aggregation_ux_spec.md section 6
- **Audit finding:** The engine already supported grains, financial year, week start, time zone and fill policy; the chart card exposed almost none of it and drew several things wrongly.
- **Fixed:**
  1. A missing stretch of time was drawn as a drop to 0 for averages (a false "0 points"). Empty periods are now gaps: the line breaks, the empty period is shaded and the chart says "N periods have no data" (spec 6.4). A new "Missing periods" control: Automatic (zero for sums and counts, gap otherwise), Show gaps, Count as zero, Carry last value.
  2. Split-by charts closed up over missing periods and spaced buckets by index. They now keep a continuous time axis.
  3. A split chart showed two legends with different colours. There is one now, under the chart, with the colours the lines use; click a name to hide or show that line.
  4. X-axis ticks were three raw dates or arbitrary bucket labels. They now sit on calendar boundaries (years, quarters, months, weeks).
  5. Headline said "mean(points) by order_date (week) · 100 groups"; it now says "Mean of points per week · 100 weeks".
  6. "Time resolution: Auto" now says what it chose ("Auto (week)") and hour and minute are hidden for date-only columns.
  7. Calendar options (spec 6.3): "Week starts" (Monday or Sunday) at a weekly grain and "Financial year starts in" at quarter or year grain. All three new settings save in the chart spec.
- **Engine:** ViewDef.showGaps keeps empty periods as missing values (test/aggregate-gaps.test.ts).
- **Explicit non-goals:** 15- and 30-minute grains, time-zone conversion (dates are used as stored; the Time resolution tooltip says so), interpolation, daylight-saving handling, a trend overlay.
- **Files / components changed:** src/data/aggregate.ts, src/ui/chart-card.ts, chart-utils.ts, chart-spec.ts, test/calendar-ticks.test.ts, test/aggregate-gaps.test.ts, test/e2e/time-series.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-30-01 — Any time-bucket width; XLSX export removed

- **Status:** Verified (unit tests, 2 browser tests); owner has not tried it
- **Problem addressed:** Time series could only bucket by one second, minute, hour, day, week, month, quarter or year. "Every 15 minutes", "every 2 weeks" or "every 10 days" were impossible, and a day of timestamped readings defaulted to hourly buckets.
- **Scope:** A new **Every N** box appears beside Time resolution once a unit is chosen: 15 + Minute, 2 + Week, 10 + Day, 3 + Month, 2 + Quarter all work, with any whole number. Fixed units (second to day) align from the epoch, weeks to the chosen weekday, months/quarters/years to the calendar or financial year. Missing-period filling, the axis, the headline ("Mean of points per 15 minutes"), the saved chart spec and the pandas/Polars code (`15min`, `2W`, `15m`) all follow the width. Auto now picks a round step for short spans (a morning of readings is minutes, a day is half-hours) instead of a single hour bucket; date-only columns get days. "Second" is now offered.
- **Also fixed:** The generated pandas/Polars code for a minute or second grain fell back to monthly.
- **Removed:** XLSX export (and its test, bench entry and docs). It is a poor interchange format. Reading Excel files on import is unchanged.
- **Decision recorded:** Time-zone conversion is out of scope.
- **Files / components changed:** src/data/aggregate.ts (`TimeOptions.every`, `timeBucket`, next-bucket stepping), src/ui/chart-card.ts, chart-utils.ts, chart-spec.ts, src/data/recipe.ts, recipe-polars.ts, src/ui/export-formats.ts, test/time-step.test.ts, test/e2e/time-series.spec.ts, test/export-*.test.ts, bench/groups-export.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-02 — Shift+drag brush on charts

- **Status:** Verified (4 browser tests on scatter, histogram, count time series; 1 on a measure time series); owner has not tried it
- **Problem addressed:** Only the map could be drag-selected. On every other chart you could click one bar or bin, but not "this region" or "this period".
- **Scope:** Hold Shift and drag on a scatter, density, bubble, histogram or time series. Scatter-style charts filter both columns to the rectangle; histograms and time series filter their own column over the dragged span. A time series that plots a measure (with or without Split by) snaps to whole periods, so a weekly chart selects Monday to Sunday. Whole-number columns round outward so edge rows stay in. The result is an ordinary range filter chip with a status line ("Chart selection: x 12 to 18, y 4 to 9"). Drags under 6 px are ignored; plain drag still pans and the wheel still zooms. Charts that support it say "Shift+drag to filter" in the note.
- **Explicit non-goals:** Lasso, a brush that survives as a movable selection, brushing category bars/box/heatmap (click already filters those), cross-chart highlighting.
- **Files / components changed:** src/ui/chart-card.ts (brush space recorded by each draw routine, overlay, `finishBrush`), chart-panel.ts, app.ts (`filterToBrush`), help-content.ts, test/e2e/chart-brush.spec.ts, test/e2e/time-series.spec.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-03 — Linked highlight between chart cards

- **Status:** Verified (5 unit tests, 1 browser test, screenshot); owner has not tried it
- **Problem addressed:** Charts in the grid were islands. Hovering a bar in one gave no sign of where that slice sits in the others.
- **Scope:** Hovering a mark (bar, bin, heatmap cell, term, aggregated period) in one card outlines the marks that show the same slice in every other card plotting the same column: the same category, or a date/number range that overlaps (a month lights the weeks inside it, neighbouring bins that only share an edge do not). It is client-side only: the card sends its hovered click-actions to the panel, the panel passes them to the other cards, and each card outlines matching hit regions on its next paint. No worker request, nothing filtered or stored; the pointer leaving clears it. A card with nothing matching does not repaint at all.
- **Explicit non-goals / known limit:** Charts of different columns do not link (hovering East in a region chart does not mark East points in a scatter). That needs each card to re-run its query for the hovered slice through the existing per-card scope; logged as the next step in next_steps.md.
- **Files / components changed:** src/ui/chart-card.ts (`actionsOverlap`, `setLinkedHighlight`, `drawLinkedOverlay`), chart-panel.ts, help-content.ts, test/linked-highlight.test.ts, test/e2e/chart-brush.spec.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-04 — Linked highlight across columns

- **Status:** Verified (5 unit tests, 1 browser test, screenshot); owner has not tried it
- **Problem addressed:** Linked highlight only linked charts over the same column. Hovering East in a region chart told you nothing about East in the time series or the sales histogram.
- **Scope:** Hover a mark in one chart and every count plot, histogram, count time series and aggregated bar/line over a different column draws the hovered slice's share of each mark in orange, with a "Highlighted: East" caption. A new worker request (`getSliceBreakdown`) reduces the rows in the slice into each mark's bar, bin or period: a row count, or the sum/mean/min/max of the chart's own measure. It runs under the chart's own scope (table filters, chart filter, exclusions) and is debounced 70 ms with stale answers dropped, so sweeping across bars never queues work. Charts with calculations (percent of rows, running totals), split-by or animation do not overlay.
- **Engine:** `ChartExclusion` gains `invert` (leave out the rows that do NOT match), which turns any existing per-chart exclusion path into "keep only this slice". Unknown labels keep nothing; rows missing the sliced value are not in a range slice. Adjacent histogram bins sharing an edge never double count.
- **Explicit non-goals / known limits:** Scatter, density, bubble, box and heatmap charts do not overlay yet (they need a per-point or per-cell version of the same request); slices of text columns only link by the "contains" action.
- **Files / components changed:** src/data/slice-breakdown.ts, chart-exclusions.ts, src/worker/protocol.ts, search.worker.ts, src/ui/worker-client.ts, chart-card.ts, chart-panel.ts, app.ts, help-content.ts, test/slice-breakdown.test.ts, test/e2e/chart-brush.spec.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-05 — Linked highlight on scatter

- **Status:** Verified (1 browser test); owner has not tried it
- **Problem addressed:** Hovering a slice in one chart (a region, a histogram bin) lit up bars and lines elsewhere, but a scatter over other columns stayed silent.
- **Scope:** A scatter card now answers a hovered slice by asking for the slice's own points: its normal sample request with the slice kept (an inverted exclusion) under the card's own scope, unclipped, after the usual 70 ms pause with stale answers dropped. The points are drawn in orange over the plot, clipped to the axes the card already shows (so zoom and pan still line up), with the "Highlighted: East" caption. No new worker message and no change to the card's own sample.
- **Explicit non-goals / known limits:** Density, bubble, box and heatmap charts and split-by series still do not overlay. A slice of more than 20,000 rows is a sample, like the scatter itself.
- **Files / components changed:** src/ui/chart-card.ts (`scheduleSlicePoints`, `drawSlicePoints`, `SeriesRequestInput.chartExclude`), help-content.ts, test/e2e/chart-brush.spec.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-06 — Time Series page in the app

- **Status:** Verified (unit, e2e and bench); owner has used the prototype, not yet the in-app page
- **Related issue / decision:** next_steps.md "BIG TODO: a dedicated Time Series page"; owner chose the full port before the Map page
- **Problem addressed:** The Time Series deep dive lived only as a standalone prototype with its own CSV loader and styles, so it could not see the loaded, cleaned and filtered table.
- **Scope:** A new "Time Series" tab (keyboard 8, command `forecast`). The prototype's engine is now typed modules in src/data/timeseries (base, aggregate, decompose, models, patterns, engine) run by the worker through a `getTimeSeries` request on the current rows, with each stage cached so a drag reruns only the models. The page (src/ui/timeseries-page.ts, -findings.ts, -patterns.ts) draws the snapshots in the app's design tokens: Explore, Decompose, Forecast and Patterns, the trend-shift overlay, history-limited forecast length, seasonal gap fill, Export CSV. Clicking a period filters the Table to it; date range filter chips now read as dates instead of milliseconds.
- **Explicit non-goals:** Impact/what-if (dropped by the owner), the Chart time series card stays until its retirement step, no time zones.
- **Acceptance criteria:** loads any table with a date column, respects filters, all four modes draw, forecast length capped by the testable history, clicking a period filters the Table.
- **Files / components changed:** src/data/timeseries/*, src/ui/timeseries-page.ts, timeseries-findings.ts, timeseries-patterns.ts, src/worker/protocol.ts, search.worker.ts, src/ui/worker-client.ts, app.ts (tab, host, filter chip dates), view-tabs.ts, command-bar.ts, help-content.ts, styles.css, bench/timeseries.ts, package.json (gate)
- **Tests run and results:** test/timeseries.test.ts (11) and the full unit suite (1089 pass); test/e2e/time-series-page.spec.ts (3 pass); bench:timeseries all within budget (daily open 53 ms of 110, hourly open 101 ms of 220, hourly horizon drag 52 ms of 110).
- **Manual browser verification:** parking.csv (29k irregular half-hourly rows) in the dev server: Hourly default, daily + weekly season, 1-month forecast, Patterns, click-to-filter.
- **Known limitations:** Phase labels and season names are English only. Very long hourly tables (100k+ periods) open at a coarser grain to stay fast. Python reference check of the decomposition and models is still to do.
- **Decision:** Ship
- **Date:** 2026-10-30

### CHG-2026-10-30-07 — Time Series: close-out (Chart link, levels, totals, timetables, scaled seasons, Python check)

- **Status:** Verified (unit, e2e, bench, gate)
- **Related issue / decision:** next_steps.md "Remaining for the Time Series page" and "Still to do"; owner chose to keep the Chart line card and link it to the page instead of retiring it
- **Problem addressed:** The Chart line card and the Time Series page did not know about each other; levels read at uneven times (parking) had no right aggregate; a total copied onto every group row was summed once per group; business-hours tables counted every night as a gap; seasons that grow with the level sat in the remainder; no reference check of the maths.
- **Scope:**
  - Chart line cards show "Open in Time Series →" (and a ⋯ menu item) that opens the page on the same date column, measure, aggregate, split column and bucket (week, 2 weeks, month…).
  - New aggregate **time-weighted mean**: each reading holds until the next one of its group, at most three usual spacings. The Data finding offers it when buckets hold uneven numbers of readings.
  - **Repeated totals**: numeric columns equal on every group's row at the same moment are detected; summing one across groups gets a warning with "Use mean", and such a column is never the default measure.
  - **Structural hours**: hours of the day that (almost) never have rows, on hourly or finer data over a week or more, are not gaps or missing coverage; the Data finding names the open hours.
  - **Scaled seasons**: on positive series, a season fitted as a share of the trend replaces the fixed-amount one when it leaves at least 15% less unexplained. Written back as amounts so trend + season + remainder still equals the series. Theta deseasonalises the same way.
  - **Python reference** (prototypes/time-series/reference): trend and seasonal profile match statsmodels' centred moving average and a per-phase median to 1e-13 on five public series; forecast errors are in line with statsmodels Holt-Winters and Theta (results.txt).
- **Explicit non-goals:** retiring the Chart line card (owner: keep it, link through); multiplicative Holt-Winters (statsmodels' beats ours on airline passengers, 36.5 vs 50.7 MAE; logged).
- **Files / components changed:** src/data/timeseries/base.ts, aggregate.ts, decompose.ts, models.ts, engine.ts; src/ui/timeseries-page.ts (open preset), timeseries-findings.ts, chart-card.ts, chart-panel.ts, app.ts, help-content.ts, styles.css; bench/timeseries.ts; test/timeseries.test.ts (+4), test/e2e/time-series.spec.ts (+1); prototypes/time-series/reference/*
- **Tests run and results:** unit 1093 pass; e2e 68 pass; bench:timeseries within budget (hourly switch to time-weighted mean 80 ms of 220); npm run gate exit 0.
- **Manual verification:** engine on parking.csv: total_occupied and total_vacant flagged as repeated, default measure occupied, time-weighted mean offered under sum and mean.
- **Decision:** Ship
- **Date:** 2026-10-30

### CHG-2026-10-30-08 — Map page: background pictures, markers, world cities

- **Status:** Verified (unit, e2e, bench, gate)
- **Related issue / decision:** next_steps.md "Owner requests: 1. Maps get their own page"; offline base maps (owner, 2026-10-30); owner asked for up to 100 markers (editable table, paste, CSV, symbols incl. SVG, colour) and a bundled list of world cities (name, lat, lon only)
- **Problem addressed:** The map lived only as a Chart card: no room, no way to put a real map underneath without the network, no way to add a few points of your own.
- **Scope:**
  - New **Map** tab (keyboard 9, command `map`). It hosts the Chart view's map card at full width through `ChartsPanel.createDetachedCard`, so points, heat grid, boundary files, zoom and the area brush all carry over and follow filters. Chart map cards get "Open in Map →"; the card stays in Chart (as with the line card).
  - **Background picture** (src/data/map-background.ts): local JPG/PNG/WebP via `createImageBitmap` (no CSP change), downscaled past 8k px. Placed as the whole world, from a world file (degrees → plate carrée, metres → Web Mercator), or typed edges with a live check. Mercator pictures are drawn in latitude strips under the lon/lat plot. Opacity, greyscale copy, coastline outline on top, credit line drawn on the map (and in PNG exports).
  - **Markers** (src/data/map-markers.ts, src/ui/map-markers-panel.ts, map-symbols.ts): up to 100 in an editable table; paste cells from a spreadsheet (header by name or none; decimal or DMS), CSV upload/download, find a city, click the map to add. Shapes: ring, dot, cross, plus, square, triangle, diamond, star, pin, or an uploaded SVG of which only shape geometry is read (scripts, styles, links and images in the file are dropped). Colour per marker. Unreadable coordinates are marked and left off the map.
  - **World cities** (src/data/cities.ts, tools/vendor-cities.mjs → src/data/reference/world-cities.ts): Natural Earth populated places, public domain, 7,342 names with coordinates to 0.01°, largest first; 146 KB / 74 KB gzip as a lazy chunk, ~0.4 MB decoded. A "Cities" layer labels the largest in view without overlaps; a list of city names pasted or uploaded becomes markers.
  - Picture and markers are kept per dataset in IndexedDB (`turbofuzz.map`), never uploaded.
  - Fix: `detectGeoPair` skipped decimal coordinate columns unique on every row (taken for row ids); the id rule now applies to whole-number columns only.
- **Explicit non-goals:** network tiles (no-go stands); moving saved map cards out of Chart; label collision between cities and markers.
- **Files / components changed:** src/data/map-background.ts, map-markers.ts, cities.ts, reference/world-cities.ts, geo.ts; src/ui/map-page.ts, map-markers-panel.ts, map-symbols.ts, map-cities.ts, chart-card.ts (background, markers, overlay, click-to-pick, keepEmptyMap, Open in Map), chart-panel.ts (detached cards), app.ts, view-tabs.ts, command-bar.ts, help-content.ts (Map topic with "Get an offline map"), styles.css; tools/vendor-cities.mjs; bench/map.ts, package.json (gate); test/map-page.test.ts, test/geo.test.ts, test/view-tabs.test.ts, test/e2e/map-page.spec.ts
- **Tests run and results:** unit 1104 pass; e2e 74 pass (6 new Map specs, and the existing no-network sweep now opens the Map tab too); bench:map: decode cities 2.8 ms (budget 40), search keystroke 0.25 ms (4), paste 100 city names 0.5 ms (15), mercator strips 0.03 ms (0.5).
- **Manual verification:** screenshot of 300 sites with Cities on and four markers (star, cross, pin, triangle) over Europe.
- **Decision:** Ship
- **Date:** 2026-10-30

### CHG-2026-10-30-09 — Date formats when converting to date / date & time

- **Status:** Verified (unit, e2e, gate)
- **Related issue / decision:** owner, loading monthly-sunspots.csv: "1749-01" stays text (fine), but converting offered only day-first or month-first; wants the common formats listed plus a custom one, for dates and date-times.
- **Problem addressed:** Year-month, year-only, quarter, compact (YYYYMMDD), month-name and custom date-time layouts could not be converted.
- **Scope:** src/parse/date-format.ts reads explicit formats (YYYY, YY, Q, MMMM/MMM, MM/M, DD/D, ddd(d), HH/H, hh/h + A, mm, ss, S..SSS, Z, [literal]; strftime %Y-%m also accepted). A format rides on the existing date order as "fmt:<pattern>", so the cast, Clean, data-quality and worker paths read it unchanged. Missing parts start at 1 (1749-01 → 1749-01-01). After converting, the column reads its rewritten ISO values normally again. One picker (src/ui/date-format-picker.ts) in the change-type dialog and Clean's convert step: automatic day/month first, the common formats that fit a sample of the column first (with how many they read), the rest, and Custom with live checking and a token guide; it starts on the best fit when automatic reading would miss values. New worker request getColumnSample. Recipes: pandas gets format="%Y-%m"; Polars gets a strptime format with "|01" day/month pieces appended when the format has none; quarter formats are flagged for review.
- **Files / components changed:** src/parse/date-format.ts (new), dates.ts; src/ui/date-format-picker.ts (new), cast-dialog.ts, clean-panel.ts, app.ts, help-content.ts, styles.css, worker-client.ts; src/worker/protocol.ts, search.worker.ts; src/data/recipe.ts, recipe-polars.ts, clean-ops.ts, dq-issues.ts; test/date-format.test.ts (7), test/e2e/date-format.spec.ts (3)
- **Tests run and results:** unit 1111 pass; e2e 77 pass; gate exit 0.
- **Decision:** Ship
- **Date:** 2026-10-30

### CHG-2026-10-30-10 — Forgiving search in filters and pickers

- **Status:** Verified (unit, e2e, bench, gate)
- **Related issue / decision:** owner: filters on the left (and others) match exact substrings only; wants to start typing and have it almost know what is meant.
- **Problem addressed:** the sidebar column search, a pick-list's "Find value…", the Add filter column list and the Pivot View value search were `includes()` only, and a free-text filter had no suggestions.
- **Scope:** src/search/fuzzy-match.ts: exact, prefix, word start, contains, every word, letters in order ("ctry" → country, "ordid" → order_id) and one slipped/missing/extra/swapped letter ("lodnon" → London; two for long queries); case, accents and separators ignored. Used in all four pickers, best match first (clearing restores the original order). The sidebar search opens the card when one column is left. Free-text filters (sidebar and header popover) show the column's own values that best fit, with counts; arrow keys and Enter or a click filter to that exact value. New worker request getValueSuggestions (distinct values and match keys built once per column, up to 200k distinct; cheap tiers first, near-miss tier only when too few fit).
- **Explicit non-goals:** the command bar's column lookup (its words are verbs and columns, so guessing there could misfire); changing the filter's Contains default.
- **Files / components changed:** src/search/fuzzy-match.ts (new), src/ui/filters.ts, table.ts, app.ts, views-panel.ts, worker-client.ts, src/worker/protocol.ts, search.worker.ts, styles.css; bench/fuzzy-suggest.ts, package.json (gate); test/fuzzy-match.test.ts, test/e2e/fuzzy-filters.spec.ts
- **Tests run and results:** unit and e2e pass; bench:fuzzy-suggest per keystroke: a few letters 10 ms and a misspelling 21 ms over 100k distinct values (budget 40), 10 and 40 ms over 200k (budget 80).
- **Decision:** Ship
- **Date:** 2026-10-30

