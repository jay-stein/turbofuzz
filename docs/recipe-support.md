# Recipe export support matrix

The applied Recipe (value cleans, missing-value policy, logical types,
transform steps) is the single contract every exporter reads. Each step gets a
status per target, and anything that is not executable appears in the generated
header's warning list — no step is ever silently dropped.

Statuses:

- `supported` — executable, semantically equivalent code.
- `supported_with_warning` — executable, with a documented limitation.
- `manual_step_required` — not generated; the missing work is named in the note.

Execution check: `tools/recipe-parity/` generates fixtures and runs both
generated scripts in a Python environment with `pandas` and `polars`,
comparing cell-by-cell against TurboFuzz's own result. The suite passes on all
9 fixtures × 2 targets (verified against pandas 3.0.6 and polars 2.0.0).

## Clean operations (`CleanOp`)

| Operation | pandas | Polars | Notes |
|---|---|---|---|
| `trim` | supported | supported | strip + collapse runs |
| `case` | supported | supported | title/upper/lower |
| `replace` | supported | supported | literal or `(?i)` regex |
| `toNumber` | supported | supported | locale-aware pre-processing |
| `repairDecimal` | supported | supported | swaps the other decimal convention only |
| `escapeFormulas` | supported | supported | mirrors the spreadsheet-formula guard |
| `toDate` | supported | supported_with_warning | pandas `to_datetime`; Polars `str.to_datetime(strict=False)` parses ISO, day-first needs an explicit format |

## Missing-value policy and logical types

| Step | pandas | Polars | Notes |
|---|---|---|---|
| Treat token as missing (`extra`) | supported | supported | replace to NA/null |
| Keep token as a value (`keep`) | manual | manual | reader nulls it first; adjust `keep_default_na`/`null_values` |
| type → integer / number | supported | supported | coerce-like casting |
| type → date | supported | supported | Python date objects / native `pl.Date` |
| type → datetime | supported | supported | pandas `datetime64[ns]` (naive read as UTC); Polars `pl.Datetime` (naive stays naive) |
| type → time | warning | supported | pandas needs ≥2.0 `format="mixed"`; `pl.Time` |
| type → duration | warning | warning | colon/unit forms; verify unusual spellings |
| type → category | supported | supported | |
| type → boolean | manual | manual | map the exact source spellings |
| type → string / identifier | warning | warning | read as text so leading zeroes survive |
| row deletions | manual | manual | data-dependent; counted in the header |

## Transform operations (`TransformOp`)

| Operation | pandas | Polars | Notes |
|---|---|---|---|
| `dedupe` | supported | supported | keep first/last/none; order preserved |
| `drop` | supported | supported | schema-guarded |
| `round` | supported | supported_with_warning (negative) | Polars may not support negative decimals |
| `groupBy` | supported | supported | sorted by the dimension to match the app |
| `impute` constant/mean/median/ffill/bfill | supported | supported | grouped variants via `transform`/`over` |
| `impute` mode | supported_with_warning (grouped) | supported_with_warning (grouped) | libraries pick the smallest mode on ties |
| `knn` | manual | manual | scikit-learn / explicit neighbour logic named in the note |
| `melt` | supported | supported | empty `valueVars` defaults to non-id columns |
| `aggregate` core (value dims, time grains, date parts, bins edges, measures, expression terms, where shapes, weighted measures) | supported | supported | sorted by the first dimension |
| aggregate bins (width/quantile), fiscal, week-start, timezone | warning | warning | documented adjustment in the note/comment |
| aggregate fill, cohort/since, unsupported where shapes, post ops | manual | manual | named in the note |
| `winsorize` | supported | supported | quantile clip |
| `flagAnomalies` | manual | manual | fences derive from the data |
| `combineDate` year..second/epoch/date/datetime + dropParts | supported | supported | Polars builds `pl.datetime(...)` with `day=1` default |
| `combineDate` auto role, offset/AM-PM columns | manual | manual | named work in the note |
| `combineDate` time-neutral timezone | warning | warning | source offsets win over localisation |
| `splitColumn` delimiter / regex-with-groups | supported | supported_with_warning | Polars appends new columns at the end of the frame |
| `splitColumn` regex without groups | supported | manual | Polars needs capture groups or an explicit split |
| `splitColumn` dropEmpty | manual | manual | per-row packing has no direct library equivalent |

## Language selection

The Recipe drawer has a pandas / Polars selector next to **Copy recipe**. Both
generators read the same `RecipeInput`, so the selected language never changes
the operations — only the emitted code and the per-language support line.
Data export (CSV) stays in the separate Export dialog; the recipe is source
code, not a data file.
