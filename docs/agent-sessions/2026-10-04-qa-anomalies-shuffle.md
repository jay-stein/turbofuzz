# 2026-10-04 — Data QA block, anomaly detection, dice shuffle

## Goal

Make data quality visible at a glance: a prominent red-tinted QA block with
duplicate/null/anomaly toggles, red highlighting of offending cells and rows,
and a fast random shuffle control.

## Anomaly rules (chosen with the user)

- **Numeric values — MAD (modified z-score, Iglewicz–Hoaglin).** Flag
  `|0.6745 (x − median) / MAD| > 3.5`. When MAD is zero (mostly-identical
  values) fall back to the mean absolute deviation around the median so a
  lone large value is still flagged. Computed per integer/number column from
  a ≤50k sample; skips columns with fewer than 20 present values.
- **Text lengths — per-column Tukey fences (1.5×IQR)** on trimmed lengths.
  Applies to text/category/identifier columns; skips columns with fewer than
  8 present values or zero IQR.
- One pass at ingest produces row bitsets (`valueAnomalyBits`,
  `lengthAnomalyBits`), per-column fences for cell tinting, and the counts
  shown on the buttons. Re-derived on column type changes.

## UI

- **QA block** replaces the old overview card: "Data QA" header, prominent
  light-red buttons for Duplicates / Nulls / Value outliers / Length outliers,
  each showing its count and toggling a filter ("on" state = solid red).
  Details still opens the stats modal.
- **Red highlighting is always on**: null cells solid red, duplicate rows a
  lighter red wash, outlier cells red with a left bar and a tooltip explaining
  the rule. Buttons only control row filtering.
- **Shuffle**: prominent accent button with an inline dice-5 SVG next to
  Copy/Export. The worker does an in-place xorshift32 Fisher–Yates over the
  current result ids and clears any column sort; the table scrolls to top.
  ~10ms at millions of ids, pseudo-random.

## Plumbing

- Protocol: `SpecialKind` (4 kinds), fences in `ColumnMeta`, `firstFlags`/
  `flags` bitmasks (bit 0 = duplicate row) on every rows-bearing message,
  `shuffle`/`shuffled` request pair, `stats` included in `columnMeta` so the
  QA counts refresh after a type change.
- Table caches row flags alongside rows; `setColumns` now takes `ColumnMeta`.
- `valueLength` moved to `src/parse/value-length.ts` (shared with ingest and
  table rendering).

## Verification

- `npm test`: 102 passing (anomaly fences, MAD fallback, special filter,
  shuffle reorder/flags).
- `npm run typecheck`, `npm run build` clean.
- Ingest overhead: 200k×5 synthetic build 397ms (stats 155ms) — no
  perceptible regression.
