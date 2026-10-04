# 2026-10-04 — Header type pickers and shuffle count

## Per-column type in the table header

- Each `.th` is now a two-row cell: name/sort/index/resize on top, and a small
  uppercase type `<select>` underneath (Text, Category, Integer, Number, Date,
  Boolean, ID / Exact). Changing it calls the existing worker `setType` flow
  (fences/stats recomputed) and syncs the left filter pane via `updateMeta`.
- `ResultTable.updateColumn(column, meta)` replaces one column's metadata
  without resetting user-resized widths; app calls it after `setType`.
- `COLUMN_TYPES` was missing `"date"` — added, which also restores the Date
  option in the left filter pane's type selector.

## Shuffle count fix

- `shuffleRows` never called `updateCount`, so the results bar kept the old
  count after sampling. It now updates the bar and shows sample-aware wording:
  `100 random rows · sampled from 92,070 · <1 ms` (instead of presenting the
  remainder as "filtered out").
- The worker recomputes `sortedIds` from the current filters before shuffling,
  so repeated shuffles always draw from the full filtered set — previously a
  25-row sample followed by "Shuffle all" could only shuffle the 25.
- Any filter, sort, special toggle or clear exits sample mode back to the
  normal count wording.

## Verification

104 tests pass (shuffle limit-larger-than-result-set now re-samples the full
set). Typecheck and build clean.
