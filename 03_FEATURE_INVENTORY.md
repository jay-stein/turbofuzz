# Feature Inventory

> Status: Draft — populated from repository reconnaissance on 2026-10-17 (commit `0410948`). Entry points are verified in source. No browser-based discoverability or usability study has been run.

## Inventory rules

- Record every existing user-facing capability, including less prominent features.
- Record the exact current location and entry path.
- Do not infer that a feature exists from a roadmap, code symbol or previous AI suggestion; verify it.
- Update this file whenever a feature is added, renamed, relocated, replaced or removed.
- A feature that is difficult to find is not automatically a feature that should be removed.
- Mark browser-dependent behaviour separately from source-verified existence.

## Verification legend

- **Source-verified:** the control, route and callback exist in the repository.
- **Browser-unverified:** the feature depends on a real browser API or visual rendering and has not been confirmed in a browser.
- **Hidden / not reachable:** code exists but no current UI path exposes it.

No browser verification was performed for this inventory. All discoverability scores are therefore **D0 — unknown/not tested**, even where the source path is a prominent top-level tab.

## Inventory table

| ID | Status | Feature | User job | Current location / entry path | Importance | Discoverability | Dependencies / limitations | Decision / notes |
|---|---|---|---|---|---|---|---|---|
| F-001 | Existing | File import | Load data | Start screen drop zone: drop, click to browse, or drag/drop; topbar “New data” (clear-data flow is F-048) | Core | D0 — not tested | Browser file API/drag-drop; browser-unverified. Formats: CSV, TSV, PSV, TXT/DAT, JSON/JSONL/NDJSON, XLSX/XLS, Parquet, ZIP, GZ, BZ2. HDF5 and xz/zst/7z/rar/tar/lz4 rejected. | Primary import path. |
| F-002 | Existing | Paste import | Load copied rows | Start screen “Paste rows instead” → delimiter, “First row is header”, “Load pasted data”; `Ctrl+Enter` | Core | D0 — not tested | Browser clipboard/textarea; browser-unverified. Header checkbox and delimiter also apply to file imports. | Shares import controls with file import; consider whether that placement is discoverable. |
| F-003 | Existing | Sample data | Try the app without a file | Start screen “Try sample data” | Useful | D0 — not tested | Built-in CSV; browser-unverified. | Useful for onboarding and deterministic smoke tests. |
| F-004 | Existing | Archive and workbook selection | Choose a table inside a container | ZIP: table picker, including “Import all N files (append rows)” when headers match; XLSX/XLS: worksheet picker | Core | D0 — not tested | ZIP scans supported entries; browser-unverified. Import-all has a 20M-cell guard. | Previously removed URL/scrape import is not a feature. |
| F-005 | Existing | Large-load guard, progress and cancel | Load large files safely | Automatic above ~8M estimated cells for plain delimited/JSON buffers and pasted text: sample first 100k rows, full load, cancel; load panel with Cancel | Core | D0 — not tested | Browser-unverified. Workbook, Parquet, ZIP-entry and decompressed-inner paths bypass this dialog; ZIP “Import all” has a separate 20M-cell guard. Practical limit is browser memory. Cancel preserves prior data; worker OOM resets to the start screen. | Important trust/recovery surface; import coverage is uneven by input type. |
| F-006 | Existing | Import diagnostics | Understand what changed on import | Banner after load; dataset facts on Overview/topbar | Useful | D0 — not tested | Source-verified. Covers padded short rows, trimmed extra cells, sample note and encoding. Encoding support is UTF-8 then windows-1252 fallback only; UTF-16 is not implemented despite the README claim. | Should be included in import browser checks; README needs correction. |
| F-007 | Existing | Header, encoding and type inference | Understand schema | Automatic on load; type selectable from table header | Core | D0 — not tested | Source-verified. Types: Text, Category, Integer, Number, Date, Date & time, Time of day, Duration, Boolean, ID. | No direct UI test of header type changes. |
| F-008 | Existing | Overview dashboard | Understand the dataset and next actions | “Overview” tab; default landing unless “Open in Table next time” is set | Core | D0 — not tested | Source-verified. Shows facts, archetype, health tiles, next steps, missingness map, all-column cards, Stats link. | Entry point for several cleanup journeys. |
| F-009 | Existing | Missingness map | See where data is missing | Overview section | Core | D0 — not tested | Canvas rendering; browser-unverified. Tooltips explain row blocks and columns. | Canvas/a11y behaviour needs browser checks. |
| F-010 | Existing | Health and QA special filters | Find duplicates, empties, outliers | Results bar chips: “Duplicates N”, “Empty cells · N cols”, “Outliers N”; “Remove duplicates”; “Convert to nulls” | Core | D0 — not tested | Source-verified. Chips combine with column filters; special filters are not data changes. | App-level chip behaviour is untested. |
| F-011 | Existing | One-click fix suggestions | Repair a recognised issue | Per-column header chips, sidebar suggestion chips, Overview next steps | Core | D0 — not tested | Source-verified. Sentinel tokens, mixed decimals, type conflicts, formula-like cells, boolean/number/date conversion. | Fixes are logged and reversible from Recipe. |
| F-012 | Existing | Review-all triage queue | Work through issues in one place | Overview “N issues found — Review all” | Useful | D0 — not tested | Source-verified. Fixes apply immediately; resolved items tick and leave the list. | Component-tested; no App-level test. |
| F-013 | Existing | Data Quality dashboard | Diagnose dataset quality | Topbar DQ score tile; “Data Quality” tab; keyboard `2`; palette “quality”/“score”/“dq”/“data quality” | Core | D0 — not tested | Source-verified. Score is dataset-level and ignores filters. Six dimensions; weights/bands persisted. Failing checks with no filter/convert action have no drill-down button. | `QualityPage` is live; `quality-panel.ts` is legacy/unmounted. Verify the UX for non-actionable checks. |
| F-014 | Existing | DQ report export | Share/retain the diagnosis | Quality page “Copy report” (Markdown) and “Download JSON” | Useful | D0 — not tested | Clipboard/download; browser-unverified. SodaCL/dbt/GX/DQDL emitters exist in code but are not exposed by the live page. | See “Hidden / uncertain” below. |
| F-015 | Existing | Filter sidebar | Find records by value/range | Left “Filters” sidebar; “Find a column…”; per-column cards | Core | D0 — not tested | Source-verified. Contains/Exact/Fuzzy/Sounds like; value checkboxes; numeric/date/time/duration ranges and histogram slider. | **No direct tests for `FilterPanel`.** |
| F-016 | Existing | Filter chips and quick add | See/remove active filters | Results bar: active chips, “+ Add filter”; sidebar “Clear all” | Core | D0 — not tested | Source-verified. | No App-level test. |
| F-017 | Existing | Table grid | Inspect records | “Table” tab; Overview “Explore the table” / “Open Table”; keyboard `3` | Core | D0 — not tested | Source-verified. Virtualized rows, sort, column resize by divider drag (double-click resets), row-index header, group separators. | Core workspace. |
| F-018 | Existing | Column inspector | Understand/fix one column | Click a column header | Core | D0 — not tested | Source-verified. Profile, issues, sort/filter/chart, quick cleans, fill/split/round, merge, rename, delete, display format/grouping, and quality checks (Compare with, Allowed values, Check freshness; see F-045). | Popover; keyboard/focus browser-unverified. |
| F-019 | Existing | Column context menu | Reach grouped column actions | Right-click a column header | Core | D0 — not tested | Source-verified. Column, Clean and Transform groups; dangerous actions are marked. | Important alternate entry point; consistency with inspector must be maintained. |
| F-020 | Existing | Clean panel | Normalize values, names and missing tokens | Right-click “Clean values…”/“Missing values…”; inspector “All clean options”; palette “clean”/“nulls”; suggestion chips; Overview “Open Clean” | Core | D0 — not tested | Source-verified. Tabs: Column names, Values, Nulls. Preview counts before apply. | Component-tested; App-level apply/undo untested. |
| F-021 | Existing | Transform panel | Reshape data | Right-click Transform actions; inspector structural actions; palette “transform”/“group”/“fill”/“split”/“dedupe” | Core | D0 — not tested | Source-verified. Dedupe, drop, round, group-by, impute, KNN, melt, combine date/time, split. Staged pipeline + preview. | Component-tested; schema-change side effects untested in app. |
| F-022 | Existing | Merge similar values | Consolidate near-duplicate categories | Header “N mergeable” chip; column context menu; Overview next step; inspector | Useful | D0 — not tested | Source-verified. Category columns; merge panel. | Only mergeable clusters are surfaced. |
| F-023 | Existing | Delete rows and columns | Remove unwanted data | Row/column delete controls in table; “Delete selected” bar | Core | D0 — not tested | Source-verified. Staged red state then confirm; columns are tracked transforms; deleted rows restorable from Recipe. | No App-level test. |
| F-024 | Existing | Show changes | Review what changed since load | Results bar “Show changes” | Useful | D0 — not tested | Source-verified. Highlights changed cells; toggle only when changes exist. | Display only; does not modify data. |
| F-025 | Existing | Info Tiles | Keep column summaries visible while working | Results bar “Info Tiles”; `T` on Table | Useful | D0 — not tested | Source-verified. Session preference. | Table-only. |
| F-026 | Existing | Recipe history and undo | Control applied changes | Nav row “Recipe” | Core | D0 — not tested | Source-verified. Undo individual steps, reorder cleans, expand batches, undo all. “Undo all” covers cleans, null policies, types and transforms; deleted rows are restored separately. | The central recovery surface; App-level wiring untested. |
| F-027 | Existing | Code recipe generation | Reproduce work in Python | Inside Recipe: pandas/Polars selector, “Copy recipe” | Core | D0 — not tested | Clipboard; browser-unverified. Generated scripts plus support report for manual steps. | Strong generator tests, including golden pandas/Polars scripts. |
| F-028 | Existing | Recipe save and replay | Reuse a pipeline later | Inside Recipe: “Save recipe.” / “Replay recipe.” | Useful | D0 — not tested | File download/upload; browser-unverified. Replay matches columns by name and reports missing mappings. | JSON recipe file; plan/replay logic is unit-tested. |
| F-029 | Existing | Views / aggregates | Analyse groups without changing rows | “Views” tab; keyboard `4`; palette “views” | Core | D0 — not tested | Source-verified. Up to 5 views; starter views; +New view; +Cohort view; dimensions, measures, filters, group limit, pivot, partial periods. Saved views are reset on load or transform schema changes. | Definitions only; the working table is unchanged; views do not persist across schema changes. |
| F-030 | Existing | View outputs | Move from aggregate to output | Per active view: “Chart this”, “Slick table”, “Copy as pandas”, “Use as dataset” | Useful | D0 — not tested | Source-verified. “Use as dataset” commits an aggregate transform; Slick table exports HTML/PNG. | Browser export unverified. |
| F-031 | Existing | Charts | Visualise the current result set | “Chart” tab; keyboard `5`; “+ Add chart”; chart-type rail; inspector “Chart”; Overview “Open Chart”; Views “Chart this”; per-card Source selector (F-044) | Core | D0 — not tested | Source-verified. 13 card types: histogram, time series, bars, scatter, density, box, treemap, top terms, heatmap, correlation, bubble, KPI, map. Cards can bind to the filtered Table or a saved View. | Custom canvas; visual rendering browser-unverified. |
| F-032 | Existing | Chart interaction and export | Explore and publish charts | Per-card controls: type/columns/settings, group, ranges, palettes, axes, wide, focus, zoom/pan, Shift+drag brush filter (scatter, density, bubble, histogram, time series, map), any-width time buckets, animate, PNG/GIF/MP4 | Core | D0 — not tested | Source-verified logic and component tests; real canvas, WebCodecs and downloads browser-unverified. | High-risk visual surface with no screenshot baseline. |
| F-033 | Existing | Reports | Find quality, relationship and anomaly findings | “Reports” tab; keyboard `6` | Core | D0 — not tested | Source-verified. Tabs: Quality, Relationships, Anomalies; “Explain [column]”; fix/review/show-rows actions, including Flag column and Winsorise 1% (F-046). Scope is mixed: some findings use dataset-level stats, others use the current filtered rows, and no scope label is rendered. | Data findings tested; `ReportsPanel` has no direct test. Report scope needs browser verification and likely a UX clarification. |
| F-034 | Existing | Stats report | Inspect per-column statistics | Overview “Stats Report”; results-bar `⋯` → “Stats Report” on any non-Overview lens | Useful | D0 — not tested | Source-verified. Summary boxes + per-column stats table. | No direct component test. |
| F-035 | Existing | CSV export and clipboard copy | Reuse results elsewhere | Nav row “Export…” → CSV, scope all/filtered, first-N, blank nulls, formula escaping; results bar “Copy” | Core | D0 — not tested | File System Access/download/clipboard; browser-unverified. Parquet is displayed disabled as “planned”. | Export panel and CSV/worker chunking are tested; browser flow is not. |
| F-036 | Existing | Command palette | Perform actions without hunting | Topbar “Do something…” or `Ctrl/⌘+K` | Useful | D0 — not tested | Source-verified. Only opens when the workspace is visible; the topbar button is present on the start screen but does nothing there. Verbs include clean/case/convert/escape/round/fill/split/group/dedupe/drop/clean/nulls/transform/export/views/quality/keydup/timeseries. | Parser heavily tested; palette open/execute flow untested. |
| F-037 | Existing | Help | Learn the product offline | Topbar “Help” | Useful | D0 — not tested | Source-verified. Searchable 12-topic drawer. | Component-tested. |
| F-038 | Existing | Theme | Choose light/dark appearance | Topbar “Theme: Auto/Light/Dark” | Secondary | D0 — not tested | localStorage; follows OS in Auto. Canvas repaint on theme change browser-unverified. | Unit-tested theme resolution; visual theme unverified. |
| F-039 | Existing | Keyboard shortcuts | Switch lenses and controls faster | `1`–`6` lenses, `T` Info Tiles, `Ctrl/⌘+K` palette, arrow/Home/End on tabs; menus support arrows, Home/End, Enter and Escape | Useful | D0 — not tested | Source-verified. Ignored while typing in inputs. | Hint copy currently says “1–5” although six tabs exist. |
| F-040 | Existing | Preferences and default view | Keep working preferences | Overview “Open in Table next time”; topbar theme; sidebar collapse; Info Tiles; chart layout/rail; DQ weights | Secondary | D0 — not tested | localStorage/sessionStorage. Dataset and pipeline state are not persisted across reload. | No browser persistence tests. |
| F-041 | Existing | Shuffle data | View rows in random order | Results bar “Shuffle data” | Useful | D0 — not tested | Source-verified. Worker shuffle; clears sort and updates counts. Not sampling; random order is display state. | Browser-unverified; App-level untested. |
| F-042 | Existing | First-run hints | Discover key controls | Automatic anchored callouts after load; dismiss with × or Escape | Secondary | D0 — not tested | Six hints cover tabs, palette, column menu, Recipe, Info Tiles and placeholder actions; persisted under `turbofuzz.hints.seen`. localStorage may be unavailable. | Browser-unverified; unit tests cover storage/targets only. |
| F-043 | Existing | Number-locale switch | Correct decimal/thousands interpretation | Right-click header → “Number format: … — switch” | Useful | D0 — not tested | Source-verified. Changes parsing and stats for the column, not merely display. Depends on worker `setNumberLocale` and type inference. | High impact on values; browser-unverified. |
| F-044 | Existing | Chart data-source selector | Chart the filtered table or a saved aggregate | Per chart card “Source” selector | Useful | D0 — not tested | Source-verified. Offers “Table”/“Table (filtered)” or a saved View; options refresh when views change; a removed View falls back to the table. | Browser-unverified; chart-card tests cover config, not the full source UI. |
| F-045 | Existing | Column and dataset checks | Validate keys, pairs, freshness and allowed values | Column inspector “Compare with…”, “Allowed values…”, “Check freshness…”; palette `keydup` | Core | D0 — not tested | Source-verified. Feed DQ Consistency/Timeliness/Uniqueness. Pair and key checks filter to failures and add user-run checks; freshness adds a check without filtering; allowed-values filters only. | Browser-unverified; engines tested, App wiring not. |
| F-046 | Existing | Report anomaly remedies | Act on an anomaly finding | Reports → Anomalies → “Flag column”, “Winsorise 1%” and filter actions | Useful | D0 — not tested | Source-verified. Applies tracked transforms (new Yes/No column; percentile clamp) or filters; undo via Recipe where applicable. | Browser-unverified; findings/transform logic tested, App wiring not. |
| F-047 | Existing | Display-only number formatting | Read values with fixed decimals or separators | Column inspector decimal-place and thousands-separator controls | Useful | D0 — not tested | Source-verified. Display only; stored values and Recipe are unchanged. | Browser-unverified; table tests cover formatting logic. |
| F-048 | Existing | Clear data / restart | Close current work and start over | Topbar “Clear data” when a dataset is loaded → confirmation | Useful | D0 — not tested | Source-verified. Resets the workspace to the start screen; the dialog states saved recipes are not affected. Clearing is not undoable; the file must be reloaded. | Browser-unverified; distinct from “New data” before a load. |
| F-049 | Existing | Time Series page | See trend, season, unusual periods, a backtested forecast and the typical day/week/year of one column over a date column | “Time Series” tab; keyboard `8`; command bar `forecast` (aliases series, decompose, seasonality, trend); “Open in Time Series →” on Chart line cards | Core | D2 — e2e tested | Engine in the worker (src/data/timeseries), respects Table filters. Grains 5-minute to yearly. Needs a Date/Datetime column; split dates go through `combine`. Clicking a period filters the Table to it. Export CSV of the series and components. | Ported from prototypes/time-series (CHG-2026-10-30-06); close-out CHG-2026-10-30-07 (time-weighted mean, repeated totals, structural hours, scaled seasons, Python reference). The Chart line card stays and links here. |
| F-050 | Existing | Map page | See rows' coordinates on a full-width world map, over your own offline map picture, with world cities and up to 100 markers of your own | “Map” tab; keyboard `9`; command bar `map` (aliases maps, markers, geo); “Open in Map →” on Chart map cards | Core | D2 — e2e tested | The Chart map card at full width, fed by the chart panel (follows Table filters). Background JPG/PNG/WebP placed as whole world, by world file (.jgw/.pgw/.wld, degrees or Web Mercator metres) or typed edges; plate carrée or Web Mercator; opacity, greyscale, outline, credit line. Markers: editable table, paste from a spreadsheet, CSV upload/download, city search, click to add, 9 shapes or an uploaded SVG (geometry only), colour. 7,342 Natural Earth cities (public domain) as a lazy 74 KB chunk. Picture and markers kept per dataset in IndexedDB; no network. | CHG-2026-10-30-08. The map card stays in Chart (same decision as the line card). |

## Data Quality additions (2026-10-29)

| ID | Status | Feature | User job | Entry path | Notes |
|---|---|---|---|---|---|
| F-DQ-01 | Existing | Honest score band with a stated reason | Trust the band word | Data Quality hero ("Fair because ...") | Decision DEC-2026-10-29-01. Band caps and optional columns. Verified by unit tests and the corpus. |
| F-DQ-02 | Existing | Issue queue with previews, apply and undo | Fix what is wrong | Data Quality, Issues tab; "Fix top 3", "Apply all safe fixes" | Each fix is its own undoable Recipe step. Browser tests. |
| F-DQ-03 | Existing | Mixed formats and impossible values | Catch silent damage | Issues tab | Dates written two ways, `$` on some numbers, age/percent/year ranges. |
| F-DQ-04 | Existing | Rows affected, exceptions CSV | Hand findings to the data owner | Hero tiles and "Download exceptions CSV" | Sensitive columns masked by default. |
| F-DQ-05 | Existing | Per-column score and column strip | See the worst columns first | Data Quality, Columns tab | Formula in `columnScore`. |
| F-DQ-06 | Existing | Sensitive-column advice, mask/hash/drop | Avoid sharing personal data | Sensitive tab | Advisory only; never changes the score. PII benchmark in `test/pii-benchmark.test.ts`. |
| F-DQ-07 | Existing | Rules (recommend, edit, score, file) | Keep expectations | Rules tab; `turbofuzz-rules.json` | Plain data, no eval. Session-remembered offer to re-apply. Emitters for SodaCL, dbt, GX, DQDL. |
| F-DQ-08 | Existing | Local history and drift | See change between loads | History tab | IndexedDB, counts and rates only, can be switched off and cleared. |
| F-DQ-09 | Existing | Offline reference accuracy | Catch misspelt countries and similar | All checks (Accuracy) | Lists load on demand; weight 0 by default. |
| F-DQ-10 | Existing | Duplicates ignoring an id; suggested pair checks | Find repeats and impossible orderings | Issues tab; All checks | Name-pair checks can be turned off for the session. |
| F-DQ-11 | Existing | HTML report, supplier message | Share results | Data Quality hero | One self-contained printable page; no values from flagged columns. |

## Hidden, planned or uncertain capabilities

These are not counted as current user-facing features unless a reachable UI path is confirmed.

| Item | Status | Evidence | Notes |
|---|---|---|---|
| SodaCL export | Hidden / not reachable | `src/data/dq-report.ts` (`emitDQChecks`), legacy `src/ui/quality-panel.ts:180-195` | Live `QualityPage` exposes only “Copy report” (Markdown) and “Download JSON”. |
| dbt export | Hidden / not reachable | Same as above | Same. |
| Great Expectations export | Hidden / not reachable | Same as above | Same. |
| Deequ/DQDL export | Hidden / not reachable | Same as above | Same. |
| Legacy quality drawer | Unmounted | `src/ui/quality-panel.ts:39`; `App` imports only `DQExportKind` from the file | Has tests, but tests do not cover the live dashboard. |
| Parquet export | Planned | `src/ui/export-panel.ts:56-60` | Explicitly disabled and labelled “planned”. |
| URL/scrape import | Removed | `README.md:82-83`, no fetch path | Intentionally removed for privacy. |
| HDF5 import | Not supported | `src/ui/app.ts:139-145` | Error directs users to CSV/Parquet. |

## Discoverability scale

- **D0 — Unknown:** Not tested.
- **D1 — Obvious:** A target user can reasonably find it from the relevant screen.
- **D2 — Findable:** Available through a predictable labelled path.
- **D3 — Hidden/frictional:** Requires guessing, unrelated navigation, or knowledge the user is unlikely to have.
- **D4 — Effectively inaccessible:** Entry path is broken, blocked, or not discoverable by the intended user.

Score only after inspection or a task-based test. Include evidence and test conditions. All rows currently carry D0 because no user task test or browser baseline exists.

## Lifecycle states

Use one of:

- **Existing** — supported and available.
- **Existing but degraded** — works but is harder to find or use than intended.
- **Planned** — not yet implemented.
- **Deprecated candidate** — proposed for removal but not approved.
- **Removed** — intentionally removed with a recorded decision and migration/replacement path if needed.

## Required change review

For every UI change, ask:

1. Which existing feature locations or paths are affected?
2. Could a user lose a familiar entry point?
3. Is a capability being duplicated or made harder to find?
4. Does the feature need a redirect, alternative path, tooltip or migration note?
5. Have the inventory and relevant regression tests been updated?

Additional checks specific to this application:

- Does the change affect both the contextual entry point (header/menu/inspector) and the global entry point (tab, palette, Overview)?
- Does it preserve the Recipe’s ability to describe and reverse the change?
- Does it preserve the distinction between display-only preferences and stored data changes?
- Does it affect chart/view remapping after a schema change?
- Does it work with no data, filtered data, empty results and transform-modified schemas?
- Has it been checked in a real browser, including the canvas and download/clipboard paths where relevant?
