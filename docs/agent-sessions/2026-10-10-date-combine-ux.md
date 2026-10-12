# 2026-10-10 - One-click date combining + sparkline line chart

## Goal

Two user requests:

1. The missing values "sparkline" should be an actual sparkline (line chart)
   with one filled marker for the worst row.
2. Combining Year/Month/Day into a date should be almost one click when the
   columns are named like their parts (any case), adding Hour/Minute when
   both exist. The timezone option should be removed from the simple flow.

## What shipped

- **Sparkline** (`src/ui/missingness.ts`): the right gutter now strokes the
  per-block nullity profile as a polyline (round joins, 1.2px) with a single
  filled `--accent` marker on the worst run of rows. No text.
- **autoCombineParts** (`src/data/date-combine.ts`): exported pure detection.
  Columns whose name normalises to exactly `year`/`month`/`day`/`hour`/
  `minute`/`second` (case and punctuation ignored) are picked up; Year+Month
  are required, and the clock is included only when BOTH hour and minute
  exist, which switches the output from `date` to `datetime`.
- **Overview next step** (`src/ui/overview.ts`, `src/ui/app.ts`): when the
  detection fires, a Next steps card reads `Combine Year, Month, Day…
  into a date` with one **Combine** button that applies the transform
  directly through `applyTransform` (ranked with the row count, so it is the
  top card on such files).
- **Transform panel** (`src/ui/transform-panel.ts`): opening Transform with
  detected parts pre-selects "Combine date/time columns" and ticks the parts
  with their roles, so Apply commits in one click. The timezone input,
  datalist and note are gone; the op now defaults to `naive` (wall time as
  written), which stops the result from claiming UTC when the data has no
  zone. The `timeZone` field remains in the data model for bespoke use.
- Help text updated to describe the one-click behaviour instead of timezone
  choices.

## Files changed

- `src/ui/missingness.ts` (sparkline, committed first on
  `agent/missingness-sparkline-line`), `src/data/date-combine.ts`,
  `src/ui/overview.ts`, `src/ui/transform-panel.ts`, `src/ui/app.ts`,
  `src/ui/help-content.ts`.
- Tests: `test/date-combine.test.ts` (detection cases),
  `test/ui-overview.test.ts` (combine card), `test/ui-transform.test.ts`
  (pre-selected builder, no timezone field, one-click op).

## Commands executed

```
npm test            # 385 tests, 385 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python check_missingness.py http://localhost:4174/ sales_demo.csv
python check_combine_dates.py http://localhost:4174/ split_dates.csv
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Results

- Sparkline screenshot shows a jagged line in the gutter with the blue marker
  on the worst block.
- `check_combine_dates.py` on a Year/Month/Day/Hour/Minute file: the Overview
  card reads `Combine Year, Month, Day, Hour, Minute into a datetime`;
  clicking it produces the `datetime` column with `2024-01-15T09:30:00`
  (naive, no Z) and the action message "Combined the date columns"; the
  transform panel has no timezone field.
- **21/21 budgets pass** (0 failures); 385 tests pass.

## Decisions

- Detection requires exact part names (case/punctuation-insensitive) rather
  than substring matching, so "Year To Date" or "Month name" cannot trigger
  a wrong combine. The panel still allows manual selection for other files.
- The Overview card and the panel default are safe to auto-apply because the
  op is a tracked, undoable Process Log step and the UI states exactly what
  will happen ("Combine Year, Month, Day…", `Apply "Combine date/time
  columns"`).
- The sparkline line is range-normalised (min–max) like missingno's `xlim`,
  so a small amount of missingness still shows a readable shape.
