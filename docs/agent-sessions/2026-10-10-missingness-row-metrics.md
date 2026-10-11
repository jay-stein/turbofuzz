# 2026-10-10 - Missing values tooltip: every metric linked to the hovered rows

## Goal

User feedback after trying the hover on the Citi Bike file: the percentage
kept reading 93.3% because it counted *columns* touched by any missing value,
which is constant when the same columns have gaps everywhere. They want every
metric in the tooltip to describe the hovered row block.

## What shipped

- **Exact per-block missing counts** (`src/data/missingness.ts`,
  `src/worker/protocol.ts`): the missingness grid now sends missing-cell
  counts (`Uint16Array`) per bucket × column instead of rounded 0–255 ratios,
  so hover numbers are exact rather than reconstructed.
- **Row-linked tooltip** (`src/ui/missingness.ts`): text is now
  `Rows 221,927–222,863 · 10 missing cells of 14,055 · 99.9% available` —
  row range, exact missing cells in the block, the block's total cells and
  cell-level availability all move with the hovered rows.
- `nullityProfile` takes `totalRows` and derives block ratios from counts
  (`blockRows` mirrors the worker's bucketing); the matrix rendering divides
  counts by the block's row count.

## Files changed

- `src/data/missingness.ts`, `src/worker/protocol.ts`, `src/ui/missingness.ts`,
  `test/missingness.test.ts`, `test/worker-chart-stats.test.ts`,
  `test/ui-overview.test.ts`.

## Commands executed

```
npm test            # 391 tests, 391 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python check_missingness_rows.py http://localhost:4174/ "2014-02 - Citi Bike trip data.csv"
python check_missingness.py http://localhost:4174/ sales_demo.csv
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Results

- **Citi Bike file (224,736 × 15, 41.9 MB)**, five hover positions:
  `41 missing cells of 14,055 · 99.7%`, `19 ... 99.9%`, `10 ... 99.9%`,
  `7 ... 100%`, `10 ... 99.9%` — distinct counts `[7, 10, 19, 41]`, distinct
  percentages `{100, 99.7, 99.9}`, block sizes `{14,040, 14,055}`.
- Sales demo: `Rows 1,128–1,152 · 18 missing cells of 300 · 94.0% available`
  and `Rows 4,512–4,536 · 16 missing cells of 300 · 94.7% available`.
- **21/21 budgets pass** (0 failures); 391 tests pass.

## Decisions

- Counts are exact per block (Uint16Array) because reconstructing counts from
  rounded ratios would misreport single missing cells in big blocks.
- The column count was dropped from the tooltip: it stayed constant across
  rows and was the source of the complaint. The dataset-level "N columns
  affected" still lives in the caption and aria label.
