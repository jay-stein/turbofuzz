# 2026-10-08 - Batch undo + grouped column menu with presets

## Goal

Follow-ups from the Process Log grouping work:

1. Add a batch-level undo button to condensed groups.
2. Rework the column right-click menu: section it into Column / Clean /
   Transform, list every clean and transform function, and when one is chosen
   open its panel with that column and operation preselected (e.g. Trim on
   "fruit" preselects fruit in the Clean → Values builder).

Branch: `agent/ux-batch`.

## What shipped

- **Batch undo.** Condensed group rows now show an undo icon next to the +/−
  toggle. `undoBatch` in `app.ts`:
  - clean batches: collect the exact `(column, opIndex)` pairs, drop those ops
    from each column's list and re-apply through `applyClean`;
  - transform batches: remove the batch's ops from `transformOps` and re-derive
    the dataset (so a mid-pipeline batch can be undone, not just the last one).
- **Grouped column menu.** The context menu now has uppercase section headers:
  - *Column*: Filter, Rename…, Merge similar (categories only), Delete…
  - *Clean*: Trim, UPPERCASE, lowercase, Title Case, Find & replace…,
    Convert to number…, Convert to date…, Clean values…, Missing values…
  - *Transform*: Remove duplicate rows, Round…, Group by & aggregate…,
    Fill missing values…, KNN impute…, Melt…, Combine date/time columns…,
    Split a column…, Transform dataset…
  The menu scrolls if taller than the viewport.
- **Preselection plumbing.**
  - `CleanPanelOptions.op` and `buildValuesTab(..., initialOp)` preselect the
    operation select plus its inputs (case style, replace find/replace/ignore,
    number locale, date order) alongside the existing column selection.
  - `openTransformPanel(..., preset)` sets the step type and preselects the
    target column per builder (drop/round column, group-by dimension, impute
    column, KNN fill checkbox, split column, combine-date checkbox + role
    enabled).
  - Clean menu items now open the panel preselected instead of applying
    immediately (the old immediate `applyQuickClean` path was removed).
- Help updated (Process Log batch undo, grouped right-click menu with
  preselection).

## Files changed

- `src/ui/steps-panel.ts` (`onUndoBatch`, group undo button)
- `src/ui/app.ts` (`undoBatch`, sectioned menu, `openClean`/`openTransform`
  presets, removed `applyQuickClean`)
- `src/ui/clean-panel.ts` (`op` preset option + `initialOp` handling)
- `src/ui/transform-panel.ts` (`preset` argument + per-case preselect helper)
- `src/styles.css` (`.context-header`, scrollable menu)
- `src/ui/help-content.ts`
- `test/steps-panel.test.ts` (batch toggle + batch undo)

## Commands executed

```
npm run typecheck   # clean
npm test            # 318 tests, 318 pass
npm run build       # tsc + vite build, clean
npx wrangler deploy # v0afd6a50
```

## Decisions / notes

- Batch undo intentionally restores state without opening the panel; the
  existing per-substep undo/reorder paths are unchanged.
- The menu's immediate one-click clean ops were replaced by the preset flow at
  the user's request; the Clean panel's Preview still shows the before/after
  before applying.
- Melt and Combine/KNN presets only auto-check the clicked column; the rest of
  the builder stays as the user's choice.

## Deploy

- Commit `1b673f0` on `agent/ux-batch`.
- Live: https://turbofuzz.mrjaystein.workers.dev
- Version ID: `0afd6a50-d23c-4aa8-9d92-f923584742a5`.
- Verified the served HTML references `index-D5_tj0yw.js`.
