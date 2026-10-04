# 2026-10-04 — Smart bounds detection for delimited files

## Problem

`LoanStats3a.csv.zip` loaded as **1 column**. Two bugs compounded:

1. `detectDelimiter` only considered a delimiter if the *first* line contained
   it (`first === 0 → skip`). The LendingClub preamble line has no commas, so
   every candidate was skipped and the comma fallback was used.
2. Even with the right delimiter, `ingestDataset` called
   `parseDelimited(hasHeaders: true)`, which takes row 1 as the header and
   truncates every row to the header width — 1 column.

The smart `detectTable` (title skipping, width fan-out scoring, multi-level
header merge) only ran for worksheets and scraped tables, never for CSV.

## Fix

- `detectDelimiter` now scores the modal field count per delimiter across the
  first 10 non-empty lines, ignoring lines with zero occurrences. A junk first
  row no longer vetoes the real delimiter.
- `ingestDataset` parses the raw grid (`hasHeaders: false`) and, when the
  caller wants headers, runs `detectTable` on it — so title rows are skipped
  and blank header cells fall back to `Column N`. `hasHeaders: false` still
  returns the raw grid untouched.

## Result on LoanStats3a.csv.zip

- 42,536 rows × 96 columns, headers `id, member_id, loan_amnt, …,
  policy_code`, first data row `54734 …`, ingest 2.4s.
- Verified the 1-column truncation is gone end-to-end through the zip path.

## Tests

109 passing: delimiter with a title row (comma and semicolon variants) and an
ingest case mirroring the LendingClub preamble (`rowCount 2 × 4 columns`).
