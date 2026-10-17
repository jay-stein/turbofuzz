# 2026-10-16 — Execution plan Phase 0: baseline and code map

Branch: `agent/execution-plan` (created from `agent/chart-axis-labels` at `4b40a16`).
No product behaviour changed in this phase.

## Baseline commands and results

| Command | Result |
|---|---|
| `npm test` | exit 0 — 544 tests pass, 0 fail |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (vite build clean; only the known >500 kB chunk warning) |
| `npm run bench:quick` | 10k rows: custom token index build 8.97 ms dict + 1.31 ms grams = 10.4 ms, RSS 96 MB, 135 tokens |
| `npm run bench:latency` | 100k rows: all 10 budgets PASS; dataset build 297 ms, RSS after build 223 MB (views 22–66 ms p50, clean commit 127 ms p50, filter keystroke 4.4 ms p50) |
| `npm run bench:real` | not run — requires a user-supplied local CSV (`--csv`), no fixture shipped |

Pre-existing failures: none. Existing date tests noted in the map below must stay green.

## Code map (Phase 0 deliverable)

### Type system

- `ColumnType` union: `src/types.ts:1-8` (string/category/integer/number/date/boolean/identifier); `COLUMN_TYPES` `:10-18`, `TYPE_LABELS` `:20-28`.
- Predicates live in `src/ui/chart-utils.ts`: `isNumericType` (integer|number, date excluded) `:70`, `isCategoryType` `:74`, `chartKindFor` `:47`, `axisKindFor` `:252`, `formatTick` `:449`, `pickDefaultCard` `:123`. Duplicate private numeric predicates exist in `src/data/relationships.ts:24-30`, `src/data/knn.ts:181-183`, `anomalies.ts:101`, `distribution.ts:71`, `group-anomalies.ts:63`.
- `date` is treated as numeric throughout: `ColumnData.numbers()` (`src/data/column.ts:281-334`, parser switch at :300-302), sort rank (`src/search/order.ts:11-13`), range filters (`src/search/query-engine.ts:230-265`), histograms (`column.ts:342-344`), worker bins/details (`search.worker.ts:833, 1893`), filters UI (`filters.ts:199-200, 255-300`), chart bins.
- Date-specific branches: inference (`src/parse/infer.ts:139-144`), parsers/I-O (`src/parse/dates.ts`), combine/parts/timezone (`date-combine.ts`, `date-parts.ts`, `timezone.ts`), aggregate time engine (`aggregate.ts:368-520, 871-1054`), chart axis/type selection.

### Recipe generator coverage (Phase 2 deliverable input)

CleanOp (`src/data/clean-ops.ts:7-14`) via `cleanLines` (`src/data/recipe.ts:416-447`):

| Op | Status |
|---|---|
| trim, case, replace | executable |
| toNumber, repairDecimal | executable |
| escapeFormulas | comment only (`recipe.ts:441-442`) |
| toDate | executable (`pd.to_datetime`) |

TransformOp (`src/data/transform-ops.ts:29-63`) via `transformLines` (`recipe.ts:449-655`):

| Op | Status |
|---|---|
| dedupe, drop, round, groupBy | executable |
| impute constant/mean/median/ffill/bfill (incl. grouped mean/median) | executable |
| impute mode (grouped) | comment only (`recipe.ts:507-511`) |
| knn | comment only (`recipe.ts:525-531`) |
| melt | executable, but empty `valueVars` emits `value_vars=[]` instead of defaulting to non-id (`recipe.ts:532-541`) |
| aggregate | core executable via `viewPandasLines`; `op.fill` ignored; post ops (rolling/cumulative/diff/pctChange/pctTotal/rank/yoy) comment only (`recipe.ts:348-377`); untranslatable where/expr shapes comment only |
| winsorize | executable |
| flagAnomalies | comment only (`recipe.ts:554-558`) |
| combineDate | mixed: year..second/epoch/date/datetime roles executable; `auto`, `meridiem`, `offset` roles comment only; `dropParts` never emitted |
| splitColumn | executable core; `dropEmpty` not represented |

Not emitted at all by `pandasRecipe`: null-policy edits (`nullEdits`), type edits (`typeEdits`),
row deletions, active filters; cleans are grouped by column rather than chronologically.

### Ingestion / progress / cancel (Phase 4-5 deliverable input)

- Text load is synchronous inside the worker (`search.worker.ts:485-495`); progress messages
  carry no `requestId` (`protocol.ts:72-81`); only parquet sets `current/total`.
- No cancel button, no abort protocol; `SearchWorkerClient.dispose()` (terminate) has no call site.
- Peak-memory path: decoded string → Papaparse grid → header-detect copies → per-column `string[]`
  copies (`build.ts:30-34`), plus structured clones across the worker boundary.
- Known scaling risks: category bitsets are rows × distinct (`column.ts:483-484`),
  `computeDatasetStats` duplicate buckets (`stats.ts:43`), eager `numbers()`/histogram/category
  materialisation in `metaFor` (`search.worker.ts:1830-1864`).

### Likely regression surfaces for Phase 1

1. `ColumnType` consumers: type dropdowns/badges, suggestions, `typeEdits` persistence.
2. The "date is numeric" contract: sort, range filters, histograms, chart bins, aggregate views.
3. Inference changes altering existing file types (must not reinterpret ambiguous DMY/MDY).
4. Recipe schema metadata (`ColumnSchema { name, numeric }`) currently has no temporal type.
5. CSV export canonicalisation for date cells (`worker/csv.ts:29-32`).

## Gate

Baseline is green; type/recipe/ingestion flows are mapped; no product changes. Proceeding to
Phase 1 (Date/Datetime/Time/Duration).
