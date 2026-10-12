# 2026-10-10 - Placeholder null tokens: bold red cells + convert CTA

## Goal

User feedback: values like `NA` are cleverly read as missing, but the raw text
is hard to see under the null hatching and there is no obvious call to action
to convert placeholder text into real nulls.

## What shipped

- **Readable tokens** (`src/ui/table.ts`, `src/styles.css`): null cells whose
  raw value is non-empty get a `null-token-cell` class — bold red
  (`var(--danger)`, 700) on top of the hatch — plus a tooltip explaining that
  the value is read as missing and where to convert it. Truly empty null
  cells keep the old muted style (no text anyway).
- **One-click convert** (`src/ui/overview.ts`, `src/ui/app.ts`): when any
  column has non-empty null tokens, the generic "N columns have empty cells"
  next step is replaced by `7 cells hold placeholder text like “NA”, “TBD”`
  with a **Convert to nulls** button. It applies the null policy for those
  exact tokens across the dataset through the existing tracked
  `resolveNullsAll` path (Process Log + Undo). Files with only blank cells
  keep the review-first "Open Clean" card.
- Types: `NextStepAction` gains `blankTokens`, `OverviewCallbacks` gains
  `onBlankTokens`.

## Files changed

- `src/ui/table.ts`, `src/ui/overview.ts`, `src/ui/app.ts`,
  `src/styles.css`.
- Tests: `test/ui-table.test.ts` (token vs blank vs value cell classes and
  tooltip), `test/ui-overview.test.ts` (convert card, review card retained
  for blank-only files).

## Commands executed

```
npm test            # 388 tests, 388 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python check_null_tokens.py http://localhost:4174/ placeholders.csv
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Results

- `check_null_tokens.py`: with a file containing `NA` / `N/A` / `TBD`, the
  Overview card reads `7 cells hold placeholder text like “NA”, “TBD”`; the
  NA cell computes to `font-weight: 700`, `rgb(180, 35, 24)` (light theme
  danger) while still hatched; clicking Convert blanks every placeholder
  (`Nulls resolved — 8 blanks`, zero placeholder cells left).
- **21/21 budgets pass** (0 failures); 388 tests pass.

## Decisions

- The CTA blanks the tokens (exact-match extra policy) rather than merely
  keeping the heuristic: the raw file text becomes a real null, which is what
  "not actually missing data" needed. Cells that are already empty are
  untouched.
- The convert card deliberately replaces the generic empties card for such
  files instead of showing both; after converting, the card disappears (the
  tokens no longer exist) and blanks-only files fall back to "Open Clean".
- Token cells keep their original text (red) rather than being blanked in the
  view; the conversion is always an explicit, undoable step.
