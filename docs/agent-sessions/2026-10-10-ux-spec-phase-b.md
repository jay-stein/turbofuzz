# 2026-10-10 - UX spec Phase B: tabs, Overview landing, summary band retirement

## Goal

Work through Phase B of `claude_reviews/review_claude_20261010/STAGE4-turbofuzz-post-import-ux-spec-v2-FINAL.md`:

- WI-3: separate the view tabs from the pipeline rail.
- WI-2: land on an Overview (health, next steps, all columns).
- WI-5: the summary band lives on the Overview only (its content is superseded
  by the new Overview; Table and Chart get a compact health group).

Branch: `agent/ux-spec-phase-a` (continuing on top of Phase A).

## What shipped

- **WI-3** (`1e74353`): `StageId` no longer contains `view`; the rail reads
  Load · Clean · Transform · Export with Process Log counts (`Clean · 2`) and
  an `optional` hint before a stage is used. Drawers only add a temporary
  active class. A new `ViewTabs` component (`role=tablist`, roving tabindex,
  arrow keys, 1/2/3 shortcuts, `aria-selected`) sits beside the rail in a
  responsive `nav-row`. Table, chart and filter panels mount lazily on first
  visit. Added `test/ui-stepper.test.ts`.
- **WI-2** (`e690739`): new `src/ui/overview.ts` renders, from the loaded
  message only: the dataset line (`sales_demo.csv · 6,015 rows × 12 columns ·
  293 ms` plus encoding badge), four health tiles, ranked next-step cards
  ending in a chart slot (rules: empties, duplicates, one-click fixes,
  near-duplicates, constants), every column as a shared stat card in a
  wrapping grid with a Filter/Chart/Clean menu, and an action row with
  `Explore the table →`, `Open in Table next time` (persisted as
  `turbofuzz.view.default`) and a Stats Report link. `pickNextSteps`,
  `healthTiles` and `chartStep` are pure and covered by
  `test/ui-overview.test.ts`.
- **WI-5** (`40575c7`): the summary band no longer mounts. Table and Chart show
  a compact health group (`Duplicates 15`, `Empty cells · 2 cols`,
  `Outliers 47`) in the results bar, each toggling the same special filters,
  with `Remove duplicates` beside the Duplicates chip only when duplicates
  exist. Stats Report is the Overview link and a `⋯` menu item elsewhere.
  `summary-band.ts` keeps only the shared `buildColumnCard`; the dedupe menu
  moved to `dedupe-menu.ts` and all popovers share `menu.ts`.

## Files changed

- New: `src/ui/view-tabs.ts`, `src/ui/overview.ts`, `src/ui/menu.ts`,
  `src/ui/dedupe-menu.ts`, `test/ui-stepper.test.ts`, `test/ui-overview.test.ts`.
- `src/ui/stepper.ts` (rewritten), `src/ui/summary-band.ts` (reduced to the
  card builder), `src/ui/app.ts` (workspace structure, lazy mounting, views,
  health group, default-view preference), `src/styles.css`.
- Tests updated: `test/ui-summary.test.ts` now covers the shared dedupe menu.

## Commands executed

```
npm test            # 335 tests, 335 pass
npm run typecheck   # clean
npm run build       # tsc + vite build, clean
npx vite preview --port 4174
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Acceptance results (Appendix A)

| | Phase A | Phase B | Target |
|---|---|---|---|
| B1 first data row top, 1440×900 | 387 ✗ | **222 ✓** | ≤ 230 |
| B2 full rows, 1440×900 | 18 ✗ | **24 ✓** | ≥ 22 |
| B3 full rows, 1280×720 | 11 ✗ | **17 ✓** | ≥ 16 |
| B4 controls on landing | 99 ✗ | **31 ✓** | ≤ 40 |
| B5 controls on Table tab | 99 ✗ | 99 ✗ | ≤ 70 (WI-9) |
| B6 landing tab | None ✗ | **Overview ✓** | Overview |
| B7 stepper View stage | True ✗ | **False ✓** | False |
| B8 “N rows × M cols” on landing | 0 ✓ | **1 ✓** | ≤ 1 |
| B9 `order_id` type | Text ✓ | **Text ✓** | ≠ Date |
| B10 chart canvas bottom, 1280×720 | 819 ✗ | **589 ✓** | ≤ 720 |
| B11 controls above first plot | 23 ✗ | 23 ✗ | ≤ 8 (WI-4) |
| B12 first canvas ms | 58 ✓ | **80 ✓** | ≤ 300 |
| B13 tablist of 3 | (False, 0) ✗ | **(True, 3) ✓** | (True, 3) |
| C1 chart text | 7 ✗ | 7 ✗ | ≥ 11 (WI-14) |
| C2 canvas tracks card | 552 ✗ | 748 ✗ | ≤ 2 (WI-14) |
| C3 clipped axis labels | 0 ✓ | **0 ✓** | 0 |
| C4 preset correlation columns | 3 ✓ | **3 ✓** | ≥ 2 |
| C5 Duplicate keeps settings | True ✓ | **True ✓** | True |
| C6 charts survive a column delete | (1, False) ✗ | (1, False) ✗ | (3, True) (WI-16) |
| C7 default scatter Date × Date | False ✓ | **False ✓** | False |
| C8 hover tooltip | 0 ✗ | 0 ✗ | ≥ 1 (WI-17) |

Phase A: 7 pass / 14 fail. **Phase B: 15 pass / 6 fail.** All Phase B budgets
pass; the remaining six belong to Phase C (WI-14, WI-16, WI-4) and Phase D
(WI-17).

## Decisions and blockers

- WI-5’s “SummaryBand only on the Overview” was implemented as a retirement:
  the new Overview supersedes the band’s QA block and column strip, so the
  band never mounts (acceptance only forbids it on Table/Chart). The
  “Drop N empty columns” action was preserved as a “Drop empty column” item in
  the Overview column menu.
- The health tiles are informational; the special-filter toggles live in the
  Table/Chart health group and keep `aria-pressed`.
- The chart next-step currently opens the Chart lens; wiring “open with that
  card” is part of WI-4.
- `opencode export` still cannot run non-interactively (the picker shows a
  short session ID the CLI rejects); this summary is the record.

## Next

Phase C per the spec’s order: WI-14 (one render pass: size, text, margins),
WI-16 (keep the chart grid across transforms), WI-4 (chart-first defaults and
one-row settings), then WI-8 and WI-9. Re-run Appendix A after the phase.
