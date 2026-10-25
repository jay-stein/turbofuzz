# Quality Gates and Definition of Done

## Every UX change must have

- [ ] A single, approved problem statement.
- [ ] Evidence that the problem exists.
- [ ] Explicit acceptance criteria.
- [ ] A list of existing behaviours to preserve.
- [ ] A defined scope and explicit non-goals.
- [ ] A known-good Git commit or clean rollback point.
- [ ] Automated tests appropriate to the affected behaviour.
- [ ] Manual browser verification for material UX changes.
- [ ] A change-log entry and updates to relevant inventory/baseline documents.
- [ ] A record of which test layers are existing automation, proposed automation or manual checks.
- [ ] A latency check: speed is the project's core goal. Work on a hot path (load, per-column metadata, search, filter, render) is lazy or cached, and any feature touching data volume has a `bench/` script with a p95 budget wired into `npm run gate`. The only exception is the Outliers page deep mode.

## Current repository baseline

| Layer | Status |
|---|---|
| Static/unit/component | **Existing.** `npm run typecheck` passes; `npm test` runs 650 `node:test` tests with `tsx` and `happy-dom`; both passed on 2026-10-17. `npm run build` exists (typecheck + Vite build). |
| Lint/formatting | **Not available.** No lint or formatter script/config exists. Do not claim one was run. |
| App-level integration | **Missing.** No test imports `src/ui/app.ts`. `FilterPanel` and `ReportsPanel` also have no direct tests. |
| End-to-end/browser | **Missing.** No committed Playwright/Cypress/Puppeteer suite or configuration. |
| Visual regression | **Missing.** No screenshot tooling or baseline images in the repository. |
| Accessibility automation | **Missing.** No axe-core or equivalent in the repository. |
| CI | **Missing.** No CI configuration found. |
| Manual browser verification | **Required but not yet baselined.** No recorded viewport/device matrix or current screenshot set. |

## Test layers

### 1. Static and unit checks

Run the repository-native commands that actually exist:

```bash
npm run typecheck
npm test
npm run build
```

- `npm test` is the existing automated suite: 650 tests across parsing, search, data, worker, component and recipe logic.
- `npm run typecheck` is the TypeScript check.
- `npm run build` performs typecheck plus a Vite production build and writes `dist/`.
- There is no lint script. Record this gap rather than claiming a lint pass.
- These checks are **existing automation**, not browser coverage.

### 2. Component / integration tests

Test changed components and interactions, especially validation, state transitions, filters, transformations, and error handling.

Existing `happy-dom` tests cover several panels, but not the full app. In particular, there is no test for `App`, `FilterPanel` or `ReportsPanel`. Any new App-level test that uses a real Worker is a proposed addition, not an existing capability.

### 3. End-to-end critical journeys

**Status: proposed, not implemented.** No E2E suite exists in the repository.

Propose browser tests for the journeys in `02_CORE_JOURNEYS.md`, using deterministic fixtures:

- Import a known CSV through the real file input, or paste rows and use “Try sample data”.
- Confirm schema/profile output and the Overview landing.
- Find a seeded quality issue and follow a drill-down.
- Apply a transformation, verify values and undo it through Recipe.
- Generate a chart and verify its visible state.
- Export CSV or a recipe and validate the content.
- Exercise Undo, delete restore, Clear data and recipe replay.

Use `test/fixtures/messy_values.csv`, `euro_win1252.csv`, `messy_report.xlsx`, `ragged.csv` or `sample.parquet`. These are fixtures, not proof that browser automation already exists.

### 4. Visual regression

**Status: proposed, not implemented.** Capture screenshots for stable, important states once a browser harness exists. Review diffs rather than blindly accepting them. Dynamic charts, dates, animation and random identifiers may need controlled test data, disabled animation or targeted masking.

Start with a small set: Overview, Table, Data Quality, Chart, at one or two viewports. Do not claim visual regression coverage before baselines are committed and reviewed.

### 5. Manual UX review

Manual review is required for material changes until the relevant browser tests exist. Interact with the app at the supported viewport sizes; confirm the supported matrix first rather than assuming desktop-only or mobile support.

Manual checks should include:

- File picker and drag/drop.
- Large-file prompt, cancellation and worker OOM reset.
- Dialog focus trapping/restoration and keyboard navigation.
- Live filter/facet updates and report scope.
- Canvas chart rendering, zoom/pan, focus mode and theme repaint.
- Clipboard, CSV/chart downloads, File System Access and WebCodecs MP4.
- Recipe save/replay and column mapping.
- Empty, loading, error and no-match states.

Record the URL, commit, browser, viewport, dataset fixture and screenshot/test evidence for each material review.

## Release gate

A change is ready only if:

- Acceptance criteria are met.
- Relevant existing tests pass, or any failure is explicitly explained and approved.
- The status of proposed browser/visual/accessibility tests is recorded; absence of those tests is not reported as a pass.
- No unintended feature loss or discoverability regression is found.
- The UI has been inspected in the actual browser when the change is visual or interactive, with evidence recorded.
- The implementation stays within the approved scope.
- Remaining risks are documented.

## App-specific gates

- **Privacy/network:** no new outbound request, upload or server API. Production CSP keeps `connect-src 'none'`; verify this remains true.
- **Data integrity:** distinguish display-only changes from stored-data changes. Data-shaping changes must appear in Recipe and be reversible where supported.
- **Recipe scope:** confirm the change does not accidentally imply that filters, display formatting, views or chart configuration are part of Recipe.
- **Report scope:** when touching Reports, state whether each finding uses the full dataset or the current filtered rows.
- **Large files:** state which import paths use the 8M-cell prompt and which bypass it; do not generalise the guard to workbook, Parquet or archive-entry paths.
- **State loss:** remember that reload loses the dataset and pipeline; Clear data and worker OOM are not recoverable in-session.
- **Navigation:** there is no URL routing; test tab switching and workspace transitions as application state, not routes.
- **Multiple entry points:** check the contextual path (header/menu/inspector), the global path (tab/palette/Overview) and the Recipe history.
- **Browser-only surfaces:** explicitly mark file picker, clipboard, downloads, WebCodecs, canvas, focus and responsive behaviour as manual/proposed unless automated browser tests exist.

## Failure policy

If a relevant test fails:

1. Do not claim the task is complete.
2. Identify whether the failure is pre-existing, caused by the change, or uncertain.
3. Fix it within scope if practical; otherwise report it and ask for a decision.
4. Do not weaken or delete a test merely to obtain a green result without explicit justification.

## Rollback

Before a risky change, create a branch or commit the known-good state. If a regression is broader than the benefit, revert the change rather than piling on unrelated fixes.
