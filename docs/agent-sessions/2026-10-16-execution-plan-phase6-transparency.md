# 2026-10-16 — Execution plan Phase 6: transparent transformations

Branch `agent/execution-plan`, commit `de56193`. Checkpoint G (transformation
half): previews state each step's effect, chains stay ordered and reversible,
and the messy-time-series fixture runs end to end into both recipes.

## What changed

- **Transform preview notes** (`TransformPreviewNote[]` on
  `transformPreview`): per staged op, computed by applying each op to the
  previous step's result so the note describes that step —
  - dedupe: identical rows removed, "every column is the key";
  - impute: filled-cell count, strategy and group, samples
    `(empty) → value`;
  - combineDate: output name, order, rows that could not be combined with the
    joined parts as samples;
  - flagAnomalies: flagged count; split/melt/aggregate/groupBy: shape
    changes.
  The Transform panel renders notes with the sample rows under the summary.
- **Clean preview failures**: number/date casts report how many non-null
  cells still cannot be parsed; the Clean panel shows
  "N cells change · M can't be parsed".
- **Keyboard menus**: `openMenu` focuses the first enabled item,
  ArrowUp/ArrowDown cycle with disabled items skipped, Home/End jump,
  Escape closes and restores focus to the anchor, Tab closes; a
  `:focus-visible` style marks the active item.
- **Time-series shortcut**: the command bar accepts `timeseries` /
  `time series` / `prepare time series`. It picks the best date-like column
  (typed, else a date suggestion) and numeric measure (typed, else a number
  suggestion), applies `toDate` + `toNumber` in one undoable commit and
  points at the next steps (sentinel chips, sort, period filter, Chart
  this); missing sides produce friendly errors.
- **Dependency transparency**: Recipe transform rows now explain that
  transforms run in order and can only be removed from the end, so later
  steps keep their inputs. Generation already reads exactly the applied
  operation state (`App.recipeInput`), verified again by the workflow test.
- Help text documents the cast-failure count and the per-step transform
  notes.

## Gate evidence

`test/workflow-timeseries.test.ts` is the end-to-end fixture for the common
messy time series: load → convert dates + measure → sentinel/TBC null policy
(inference only becomes numeric once the marker is missing) → sort by time →
filter the February–April period → aggregate the measure by month → pandas
and Polars recipes built from the same applied state (three entries each, all
supported). The repo's tests run in happy-dom/worker harnesses rather than a
real browser, so this is the repeatable integration test the architecture
supports; no browser-execution test is claimed.

## Commands and results

```
npm test             # 577 pass, 0 fail
npm run typecheck    # clean
npm run build        # clean
```

## Deliberately not changed

- Transforms stay append-only (last-step removal). The operation model cannot
  prove reordering safety for shape-changing steps, so the plan's
  "reorder only when safe" rule keeps cleans reorderable within a column and
  locks transforms with an explicit reason.
- No App-level browser harness exists in the repo; building one was out of
  scope for this phase and is logged as a future investment.
