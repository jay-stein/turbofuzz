# 2026-10-03 — Real-world null markers

## Goal

Recognise the missing-value conventions that actually show up in exported
data, not just the original ten-token list.

## Recognised (case/padding/separator-insensitive)

- Text: `null`, `nil`, `none`, `nan`, `n/a`, `n.a.`, `na`, `#n/a`, `undefined`,
  `missing`, `unknown`, `unspecified`, `tbd`, `tba`, `empty`, `blank`
- Phrases: `not available`, `not applicable`, `not provided`, `not specified`,
  `no data`, `no value`, `no answer`, `no response`, `null value`,
  `none supplied`
- Punctuation-only: `-`, `--`, `—`, `–`, `?`, `...`, `…`, `####`
- Wrapped forms: `(null)`, `[null]`, `<null>`, `<NA>`, `(empty)`, `[blank]`
- MySQL export: `\N`
- Excel/Sheets errors: `#VALUE!`, `#DIV/0!`, `#REF!`, `#NAME?`, `#NUM!`,
  `#NULL!`, `#ERROR!`
- Invisible-only cells: whitespace, NBSP, zero-width space/BOM

Matching uses an exact set as a fast path, then a compact key (punctuation and
spacing stripped, Unicode letters preserved) so `N/A`, `N.A.`, `N / A`,
`#N/A` and `<NA>` all reduce to `na`.

## Deliberately not null

`no`/`No`/`N` (boolean values), `0`/`0.0` (zero), numeric sentinels like
`-999` (could be real data), and `NaT` (a name; pandas' NaT is only meaningful
in datetime columns). These are documented in the source so behaviour is
predictable.

## Performance

The check runs per cell at ingest, so it avoids allocations: a cheap reject
for long unpadded values, an exact-set fast path, a single scan that rejects
any value containing a digit, and compact-key construction only for words
starting with n/m/u/t/e/b. Micro-benchmark: ~65-70 ns/call vs ~40 for the old
implementation — roughly +0.1-0.2 s per 1M x 5 columns, once, in the worker.

## Verification

- 67 tests: 63 null-ish variants asserted true, 25 real values asserted false,
  and a column of `1,2,N/A,NULL,-,?` infers as integer with 4 nulls.
- Typecheck and build clean.
