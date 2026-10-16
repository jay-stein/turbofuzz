# Recipe export support matrix

The applied Recipe (value cleans, missing-value policy, logical types,
transform steps) is the single contract every exporter reads. Each step gets a
status per target, and anything that is not executable appears in the generated
header's warning list — no step is ever silently dropped.

Statuses:

- `supported` — executable, semantically equivalent code.
- `supported_with_warning` — executable, with a documented limitation.
- `manual_step_required` — not generated; the missing work is named in the note.

## Clean operations (`CleanOp`)

| Operation | pandas | Notes |
|---|---|---|
| `trim` | supported | `str.strip()` + collapse runs |
| `case` | supported | `str.title/upper/lower` |
| `replace` | supported | literal or `(?i)` regex |
| `toNumber` | supported | locale-aware pre-processing |
| `repairDecimal` | supported | swaps the other decimal convention only |
| `escapeFormulas` | supported | mirrors the spreadsheet-formula guard |
| `toDate` | supported | `pd.to_datetime(dayfirst=...)` |

## Missing-value policy and logical types

| Step | pandas | Notes |
|---|---|---|
| Treat token as missing (`extra`) | supported | `replace([tokens], pd.NA)` |
| Keep token as a value (`keep`) | manual | reader nulls it first; adjust `keep_default_na`/`na_values` |
| type → integer / number | supported | `pd.to_numeric(errors="coerce")` |
| type → date | supported | `to_datetime(...).dt.date` (Python date objects) |
| type → datetime | supported | `datetime64[ns]`; naive timestamps read as UTC |
| type → time | supported_with_warning | requires pandas ≥ 2.0 `format="mixed"` |
| type → duration | supported_with_warning | colon/unit forms; verify unusual spellings |
| type → category | supported | `astype("category")` |
| type → boolean | manual | map the exact source spellings |
| type → string / identifier | supported_with_warning | read as text so leading zeroes survive |
| row deletions | manual | data-dependent; counted in the header |

## Transform operations (`TransformOp`)

| Operation | pandas | Notes |
|---|---|---|
| `dedupe` | supported | `drop_duplicates(keep=…)` |
| `drop` | supported | schema-guarded |
| `round` | supported | |
| `groupBy` | supported | count/sum/mean/min/max/median |
| `impute` constant/mean/median/ffill/bfill | supported | grouped variants via `transform` |
| `impute` mode | supported_with_warning (grouped) | pandas picks the smallest mode on ties |
| `knn` | manual | `sklearn.impute.KNNImputer` named in the note |
| `melt` | supported | empty `valueVars` defaults to non-id columns |
| `aggregate` (group-by view) | supported | executable named aggregation |
| aggregate fill (`zero`/`carry`) | manual | group axis is not reindexed |
| aggregate fiscal/week-start/timezone | supported_with_warning | labels/buckets need the documented adjustment |
| aggregate “only where” (unsupported shapes) | manual | mask shape has no generated equivalent |
| expression measures | supported; manual when a term cannot be named | |
| post ops (cumulative/rolling/diff/pctChange/pctTotal/rank/yoy) | manual | comments carry the exact call |
| `winsorize` | supported | quantile clip |
| `flagAnomalies` | manual | fences derive from the data |
| `combineDate` year..second/epoch/date/datetime/time | supported | `pd.to_datetime(dict(...))` |
| `combineDate` auto role | manual | re-run auto-detection or state the role |
| `combineDate` offsets/AM-PM columns | manual | named work in the note |
| `combineDate` timezone | supported_with_warning | source offsets win over localisation |
| `combineDate` dropParts | supported | drops emitted after the output column |
| `splitColumn` | supported | regex capture groups or delimiter split |
| `splitColumn` dropEmpty | manual | per-row packing has no direct pandas equivalent |

## Polars

The Polars target is added in Phase 3 of the execution plan and will fill the
same contract. Until then the recipe drawer exports pandas only.
