# 2026-10-10 - Always-visible placeholder action chip

## Context

The per-column placeholder chip shipped earlier (`7 placeholders` in the
column header) works, but on the user's Citi Bike file the affected column
(`birth year`, 6,717 `\N` cells) sits off-screen until the table is scrolled
right — so the feature looked missing.

## What shipped

- **Results-bar chip** (`src/ui/app.ts`, `renderHealthGroup`): whenever any
  column has non-empty null tokens, the health group shows
  `Placeholders 6,717` (dataset total). Tooltip names the tokens and says the
  click blanks them across all columns as an undoable Process Log step;
  clicking calls the existing `applyNullPolicyAll(tokens, [])` path. It
  disappears once no placeholder tokens remain.
- The per-column header chip stays as-is for column-scoped precision.

## Commands executed

```
npm test            # 393 tests, 393 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python check_placeholder_action.py http://localhost:4174/ sales_demo.csv
python debug_token_chips_citi.py https://.../ "2014-02 - Citi Bike trip data.csv"
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Results

- Citi Bike: the header chip `6,717 placeholders` exists on `birth year`
  (visible after horizontal scroll); the new results-bar chip shows the same
  action without scrolling.
- Sales demo: `Placeholders 835` → one click blanks 3,745 placeholder cells
  across all columns (`Nulls resolved — 3,745 blanks`), chip disappears,
  `Process Log (1)` records the undoable step.
- **21/21 budgets pass**, but B5 (Table controls) is now exactly **70/70** —
  no further visible controls can be added to the results bar or table
  header without exceeding the budget.

## Decisions

- Dataset-wide one-click matches the Overview's "Convert to nulls" card and
  the engine's exact-match token policy; the header chip remains the precise
  per-column variant.
- The chip is styled like the health group (`ghost small`) but without the
  `health-chip` class, so the filter-toggle aria state never touches it.
