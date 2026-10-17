# Product Brief

> Status: Draft — populated from repository reconnaissance on 2026-10-17 (commit `0410948`). Product, audience and usability statements remain hypotheses until validated with users and in a browser.

## Product in one sentence

TurboFuzz is a fully client-side browser tool for loading, understanding, cleaning, reshaping, filtering, visualising and exporting tabular data — including reproducible pandas/Polars recipes — without uploading files.

## Intended users

These are hypotheses inferred from the product's capabilities, not validated user research:

- **Primary hypothesis:** analysts and operations/business users who receive messy CSV, Excel or JSON extracts and need to inspect, repair and export them without a data platform.
- **Secondary hypothesis:** data scientists and analysts exploring unfamiliar datasets who want search, profiling, charts and reproducible pandas/Polars code.
- **Secondary hypothesis:** developers and data engineers who need a quick local utility for schema inspection, filtering and recipe generation.

Select a primary user and validate their top tasks before treating any of these as settled.

## Core value

Help users move from an unfamiliar or messy dataset to a trustworthy understanding, useful analysis and an exportable result, while preserving visibility and control over every change.

TurboFuzz's differentiating constraint is that this happens entirely on the user's device: there is no upload, server API or outbound network request.

## Product outcomes

1. Users can load common tabular formats and understand the shape, schema and provenance of the dataset.
2. Users can see the most important data-quality problems and navigate to the affected columns, rows or checks.
3. Users can search and filter records with clear modes and visible result counts.
4. Users can clean and transform data with previews, an ordered Recipe and reversible steps.
5. Users can explore aggregates and charts tied to the current rows or a selected view, and reports whose scope is stated — dataset-level or current rows.
6. Users can export results or reproducible pandas/Polars code, with scope and limitations stated before export.
7. Users can recover from mistakes through undo, revert and replay paths.

## Non-goals for UX work

- Adding features solely because competitors have them.
- Redesigning unrelated screens during a targeted fix.
- Optimising visual novelty at the expense of consistency.
- Hiding advanced capabilities without a clear discoverability path.
- Claiming usability success without observing user tasks or tests.
- Introducing a server, file upload or URL-fetch path; these contradict the product's privacy model.
- Treating the app as a multi-page website: it currently has no URL routing or deep-linkable screen state.

## Design principles

### 1. Preserve user control

Show previews for potentially destructive transformations. Make scope and consequences clear. Provide undo or recovery where feasible.

### 2. Make data state visible

Users should be able to understand which dataset, columns, filters, transformations, charts and checks are currently active.

### 3. Prefer discoverability over cleverness

Use understandable labels and predictable placement. Do not rely on unexplained icons or hidden gestures for important actions.

### 4. Progressive disclosure, not feature burial

Keep common actions prominent. Place advanced options in logical, labelled locations with clear paths back to them.

### 5. Consistency across workflows

Similar actions should look and behave similarly unless there is a user-centred reason to differ. Clean, filter, chart and export actions currently appear in several contextual entry points; changes must keep those paths consistent.

### 6. Evidence before redesign

Prioritise observed task failures, confusion and regression over personal taste.

### 7. Reproducibility and trust

Make transformations inspectable, results explainable and exports reproducible. The Recipe is the contract for data-shaping changes and generated code. Filters, display formatting, views and chart configuration are separate state and are not part of the Recipe.

### 8. Privacy by construction

Keep processing local. Files are parsed in a Web Worker; production CSP sets `connect-src 'none'`. Any feature that needs a network call is outside the product model.

## Verified product constraints

| Area | Current constraint | Evidence |
|---|---|---|
| Platform | Browser-based. Requires modern JavaScript/ES modules, a Web Worker and canvas. Responsive CSS exists at 1100, 900 and 720px breakpoints, but the supported browser/device matrix and whether mobile use is in scope are unconfirmed. | `vite.config.ts`, `src/ui/worker-client.ts`, `src/ui/chart-card.ts`, `src/styles.css` |
| Processing model | Fully local. No server API, upload or outbound fetch. | `README.md:8-15`, `wrangler.jsonc`, `public/_headers` |
| Input formats | CSV, TSV, PSV, TXT/DAT, JSON/JSONL/NDJSON, Excel `.xlsx`/`.xls`, Parquet, ZIP, GZ and BZ2. | `src/ui/app.ts:136-145`, `README.md:19-23` |
| Text encoding | UTF-8 is attempted strictly; invalid UTF-8 falls back to windows-1252 with an explicit repair for the C1 range. UTF-16 is **not implemented** in the current decoder, despite the README claiming it. | `src/parse/encoding.ts:1`, `41-54`; `README.md:19-21` discrepancy |
| Unsupported inputs | HDF5 (`.h5`/`.hdf5`); `.xz`, `.zst`, `.7z`, `.rar`, `.tar`, `.lz4`; URL/scrape import. | `src/ui/app.ts:139-145`, `README.md:79-83` |
| Dataset size | No fixed row limit. Plain delimited/JSON file buffers and pasted text above about 8 million estimated cells offer first 100,000 rows as a sample, full load, or cancel. Workbook, Parquet, ZIP-entry and decompressed-inner paths do not use that dialog; ZIP “Import all” has a separate 20M-cell guard. Practical limit is browser memory. Load cancellation preserves prior data; a worker OOM resets to the start screen. | `src/ui/load-guard.ts:8-10`, `src/ui/app.ts:1030-1042`, `1170-1182`, `1199`, `1249-1263`, `1307-1312`, `3547-3553` |
| State model | In-memory. Dataset, filters, cleans, transforms, views and chart configuration are lost on reload. Small preferences persist in localStorage/sessionStorage. | `src/ui/app.ts:334-455`, `src/ui/overview.ts:82-99`, `src/ui/chart-panel.ts:38-42` |
| Navigation | Six in-memory lenses: Overview, Data Quality, Table, Views, Chart, Reports. No URL routing, browser history or deep links. Keyboard shortcuts `1`–`6`. | `src/ui/view-tabs.ts:3-12`, `src/ui/app.ts:984-1015` |
| Output formats | CSV download and clipboard copy; live DQ page Markdown/JSON; chart PNG/GIF/MP4; Slick table HTML/PNG; pandas and Polars recipe code; replayable JSON recipe file. Parquet export is visibly marked planned and disabled. SodaCL/dbt/Great Expectations/Deequ emitters exist in code but no current UI exposes them. | `src/ui/export-panel.ts`, `src/ui/app.ts:3069-3108`, `src/ui/steps-panel.ts`, `src/ui/views-panel.ts`, `src/ui/quality-panel.ts:180-195` |
| Analysis scope | Charts bind to the filtered Table or a saved View. The DQ score is dataset-level. Reports mix dataset-level findings (quality, dependencies, group anomalies) with current-row analyses (co-missingness, relationships, distribution drift, near-duplicates), and the panel does not currently state each finding’s scope. | `src/ui/chart-card.ts:193-194`, `819-835`; `src/ui/reports-panel.ts:40-53`; `src/worker/search.worker.ts:1289-1395` |
| Framework | Vanilla TypeScript, Vite, custom DOM rendering and canvas charts. No UI framework or component library. | `package.json`, no framework dependency |
| Tests | 650 `node:test` tests via `tsx`, plus `happy-dom` component tests. No App-level integration tests, browser E2E, visual, accessibility or CI coverage. There is no lint script or formatter configuration. | `package.json:8-19`, `test/` |
| Accessibility | Semantic elements, ARIA roles, dialog focus traps and keyboard menu support exist, but no formal target or audit has been recorded. | `src/ui/dialog.ts`, `src/ui/menu.ts`, `src/ui/view-tabs.ts` |
| Performance | 100k-row aggregation has a unit-level guard; ingest benchmarks exist up to 1.5M rows. No browser-level performance budget is enforced. | `test/perf-guard.test.ts`, `bench/` |

## Constraints to confirm

- Which browsers and devices are supported, and whether mobile/tablet use is in scope.
- Maximum dataset size the product intends to support, and the acceptable failure mode above it.
- Accessibility target (for example WCAG 2.2 AA) and required assistive-technology coverage.
- Whether losing state on refresh is acceptable, or whether deep links/restoration are required.
- Which primary user group matters most and what their top three tasks are.
- Required export formats beyond CSV and recipe code.
- Acceptable latency for import, filter, chart and aggregate operations on representative data.

## Product success measures

Establish baselines before setting targets:

- Successful completion rate for each core journey in `02_CORE_JOURNEYS.md`.
- Time and number of steps to complete common tasks.
- Number of errors or recoveries per task.
- Percentage of users who can locate important existing features.
- UI regression count per release.
- Automated test pass rate for critical journeys.
- Browser smoke-test pass rate and visual-diff review status.

Current baseline (repository-only):

- Automated suite: 650 tests passing in about 12 seconds.
- Typecheck: passing.
- Build command: `npm run build` (typecheck + Vite build); not part of the current automated gate.
- Browser/E2E coverage: none committed.
- Visual regression coverage: none.
- Accessibility automation: none in the repository.
- Lint/formatting: no lint or formatter script/config.
- CI pipeline: none found.
