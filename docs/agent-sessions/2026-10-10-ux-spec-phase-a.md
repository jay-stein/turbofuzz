# 2026-10-10 - UX spec Phase A: date parsing, summary, results bar, chart presets

## Goal

Work through Phase A of `claude_reviews/review_claude_20261010/STAGE4-turbofuzz-post-import-ux-spec-v2-FINAL.md`:

- WI-1: stop typing `PREFIX-123` IDs as dates (P0).
- WI-6: state the dataset summary once (top bar + tooltip).
- WI-7: results bar hierarchy (Export is the only primary action, Process Log count, Shuffle as ghost).
- WI-15: chart presets and Duplicate keep their settings.

Check in before starting Phase B.

## Setup

- First committed the review-doc archive reorganisation on `agent/ux-batch`
  (`6455742`): `review_claude_20261007/` moved under `claude_reviews/`, plus the
  2026-10-08 and 2026-10-10 review rounds added.
- Created `agent/ux-spec-phase-a` off `agent/ux-batch @ 6455742`.

## What shipped

- **WI-1** (`8d920bf`): replaced the `Date.parse` fallback in
  `src/parse/dates.ts` with explicit English month-name parsing
  (`D Mon YYYY` / `Mon D, YYYY`, optional weekday prefix, ordinal suffix,
  optional trailing time and zone). Bare years and ID-like strings now return
  `NaN`, so `order_id` (`ORD-00001`) infers as text. Existing month-name tests
  still pass; added the spec probe table to `test/parse.test.ts` and a
  column-level case to `test/ingest.test.ts`.
- **WI-6** (`2ba9d3e`): the top bar now reads `sales_demo.csv · 6,015 × 12`;
  the detail (missing values, duplicate groups, encoding, parse time) moved to
  its `title` tooltip. Removed `.qa-sub` and the QA footer `.overview-foot`.
- **WI-7** (`4d70c75`): `Export…` is the only `.primary` button in the results
  bar; `Shuffle all` dropped the dice icon and wrapper and matches Copy's
  `ghost small` style; `Process Log` shows its count and is hidden at zero
  instead of disabled/dimmed.
- **WI-15** (`1fab1d9`): `syncOptions()` is a no-op until columns exist, so a
  preset's `column`, `x`, `y`, `correlationColumns` and `title` survive
  construction; correlation cards with fewer than two selected columns fill
  `numeric.slice(0, 6)`; the title input initialises from `config.title`.
  Added a preset/duplicate regression test to `test/ui-charts.test.ts`.

## Files changed

- `src/parse/dates.ts`, `src/ui/app.ts`, `src/ui/summary-band.ts`,
  `src/ui/chart-card.ts`, `src/styles.css`.
- Tests: `test/parse.test.ts`, `test/ingest.test.ts`, `test/ui-charts.test.ts`.
- `docs/agent-sessions/2026-10-10-ux-spec-phase-a.md` (this file).

## Commands executed

```
npm test            # 324 tests, 324 pass (baseline 320 + 4 new)
npm run typecheck   # clean
npm run build       # tsc + vite build, clean
pip install playwright                      # 1.63.0 (global Python 3.14)
python make_sales_demo.py sales_demo.csv    # Appendix B, 6,015 rows
npx vite preview --port 4174
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

The measurement script (Appendix A) was extracted from the spec into
`%TEMP%\opencode\ux-phase-a\` and patched to use `p.chromium.launch(channel="chrome")`
so it drives the installed Chrome instead of downloading Chromium.

## Acceptance results (Appendix A)

Baseline on `ux-batch @ 59807c5`: 1 pass, 20 fail. After Phase A: **7 pass,
14 fail**.

Phase A targets, all now passing:

| Budget | Before | After |
|---|---|---|
| B8 “N rows × M cols” stated on landing | 2 | **0** (target ≤ 1) |
| B9 `order_id` is not typed Date | Date | **Text** |
| C4 columns selected on a preset correlation card | 0 | **3** (target ≥ 2) |
| C5 Duplicate keeps column and title | False | **True** |

Free improvements from WI-1 on top of the target list: C3 (clipped axis
labels) and C7 (default scatter plots Date against Date) now pass because
`order_id` is no longer a date. B1 improved 408 → 387px, B2 17 → 18 rows and
B10 838 → 819px from removing the duplicated QA footer.

Remaining failures are the Phase B–E work items (tabs/Overview, chart render
pass, transforms rebuild, tooltips, pickers, small screens).

## Decisions and blockers

- WI-1 parses month-name dates in `dates.ts` directly rather than importing
  `date-parts.ts`, which would create a circular import (`date-parts` already
  imports `detectDateOrder` from `dates`).
- WI-15 chose the “`syncOptions()` no-op until columns exist” option over
  passing columns into the constructor, because `ChartsPanel.addCard()` already
  calls `card.setColumns()` immediately after construction.
- The phase-A regression test for preset survival was added to
  `test/ui-charts.test.ts` (which has the happy-dom canvas harness) instead of
  `test/chart-panel.test.ts` (pure functions only) as the spec suggested.
- `opencode export` could not be run non-interactively: the picker displays a
  short ID (`dgearpkB`) that the CLI rejects, and the interactive picker cannot
  be driven from the tool shell. This summary was written instead.

## Next

Phase B: WI-3 (tabs separate from the pipeline rail), WI-2 (Overview landing),
WI-5 (summary band Overview-only). Re-run Appendix A after the phase lands.
