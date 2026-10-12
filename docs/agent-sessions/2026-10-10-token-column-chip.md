# 2026-10-10 - Column header chip for placeholder null text

## Goal

User request (corrected from per-cell to per-column): a chip on any column
whose cells contain placeholder text read as missing ("NA", "NULL", "TBD"…)
that shortcuts the user to clean: one click blanks the placeholder text.

## What shipped

- **Header chip** (`src/ui/table.ts`): columns with non-empty null tokens get
  an amber `fix`-styled chip reading `N placeholders`. Its tooltip names the
  tokens and the split (`3,514 blank + 835 placeholder text “N/A”`) and says
  the click blanks the placeholder text as an undoable step. Clicking passes
  every non-empty token to the app.
- **Action** (`src/ui/app.ts`): `convertToken(column, tokens)` extends the
  column's null policy with those tokens and applies it through the existing
  `setNullPolicy` path — cells are blanked, a Process Log null edit is
  recorded, and the Undo path works. Because the missing-value policy blanks
  every null spelling at once, the chip counts all placeholder cells in the
  column rather than one token, and it disappears after the click.
- **One line per header**: when a column has placeholder tokens the chip
  replaces the generic "N empty cells" chip. Showing both wrapped the header
  QA row and pushed the first data row from 222 to 246px (budget B1);
  replacing keeps it at one line.
- `onConvertToken?: (column, tokens)` added to `ResultTableOptions`.

## Files changed

- `src/ui/table.ts`, `src/ui/app.ts`.
- Tests: `test/ui-table.test.ts` (chip text/title, replacement of the empty
  chip, click payload, blank-only columns get no chip).

## Commands executed

```
npm test            # 393 tests, 393 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python check_token_chip.py http://localhost:4174/ placeholders.csv
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Results

- `check_token_chip.py`: chip `7 placeholders` with title
  `7 cells in “amount” are missing — click to blank the placeholder text
  “NA”, “TBD”, “N/A” (undo in the Process Log)`; one click blanks all 7,
  leaves zero token cells, removes the chip and writes `Process Log (1)`.
- **21/21 budgets pass**: B1 222 (was 246 with both chips), B5 69/70.

## Decisions

- Per-column action: only the clicked column is blanked (`setNullPolicy`),
  unlike the Overview's dataset-wide "Convert to nulls".
- The chip replaces the empty-cells chip because the header row cannot hold
  both at 180px columns without wrapping; the tooltip still reports the full
  missing count and the blank/placeholder split.
- After conversion the chip vanishes (no tokens remain) and, if blanks
  remain, the generic "N empty cells" chip takes its place on re-render.
