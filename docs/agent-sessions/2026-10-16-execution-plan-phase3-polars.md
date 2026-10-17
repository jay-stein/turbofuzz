# 2026-10-16 — Execution plan Phase 3: Polars exporter and execution parity

Branch `agent/execution-plan`, commit `0b821cf`. Checkpoint D: both exporters
read the same operation history, emit the same `SupportEntry[]` contract, and
the generated scripts were executed against TurboFuzz's own results.

## What changed

- `src/data/recipe-polars.ts`: `polarsRecipeScript(input)` mirrors the pandas
  pipeline with idiomatic Polars — `str.strip_chars`, `str.replace_all`,
  `cast(..., strict=False)`, `dt.truncate`, `unique(maintain_order=True)`,
  `unpivot`, `fill_null` with `over(...)`, `forward_fill`/`backward_fill`,
  `clip` with quantiles, `pl.datetime(...)` for combineDate, `str.extract`
  per capture group for regex splits and a runtime-width `list.to_struct`
  for delimiter splits. Native `pl.Date`/`pl.Time`/`pl.Duration` are used;
  naive timestamps stay naive (documented in the header).
- Aggregate views translate to `group_by(...).agg([...])` with value, time
  grain, date-part and bin dimensions; sum/mean/min/max/median/stddev/
  first/last/distinct/mode/percentile measures; `where` masks via
  `when/then/otherwise`; weighted helpers; expression terms and a final
  expression assignment. `df.sort(key)` is emitted after grouping so the
  row order matches the app and pandas.
- `polarsTransformLines` mirrors the schema guards and per-op statuses of the
  pandas generator (missing columns are manual entries, never `undefined`).
- Recipe drawer: pandas/Polars language selector with a live per-target
  support line; `App.recipeScript(target)` is the single entry point.
- `docs/recipe-support.md`: two-target matrix; README and help updated.

## Execution parity (not just generator tests)

- `tools/recipe-parity/make_cases.ts` builds 9 fixtures: input.csv (verbatim
  cells), expected.csv (TurboFuzz runtime + canonical CSV export),
  pandas.py, polars.py. `npm run parity:cases` regenerates them; the cases
  are committed.
- `tools/recipe-parity/run_parity.py` executes each script in an isolated
  temp dir and compares cell by cell (numeric-aware, blanks equivalent).
- Executed with pandas 3.0.6 and polars 2.0.0: **9 fixtures × 2 targets all
  PASS** (cleanup, null tokens + comma numbers, date typing, dedupe, mean
  impute, melt defaults, group-by mean, delimiter split, combineDate).
- Manual/reader-dependent operations are intentionally outside the executed
  set; their contract is locked by the support-report tests.

## Commands and results

```
npm test             # 569 pass, 0 fail
npm run typecheck    # clean
npm run build        # clean
npm run parity:cases # fixtures regenerated
python tools/recipe-parity/run_parity.py   # PARITY PASS (venv: pandas 3.0.6, polars 2.0.0)
```

## Known limitations (documented in the support matrix)

- Polars split columns are appended at the end of the frame (pandas runtime
  inserts at the source position); regex splits without capture groups and
  `dropEmpty` are manual steps.
- Negative `round` decimals carry a warning on Polars (API support varies).
- `keep`-token policies, boolean mapping, KNN, outlier flags, aggregate
  fill/cohort/since and post-aggregation ops are manual entries on both
  targets with the missing work named.
- Version assumptions: pandas ≥ 2.0 (`format="mixed"` for time), polars ≥ 1.0
  (verified against 3.0.6 / 2.0.0).

## Next (Phase 4)

Benchmark ingestion at 100k/500k/1.5M rows, phase-specific progress events
(reading/parsing/inferring/building/profiling/ready/cancelled/error), a real
cancel path with late-response guards, and honest error recovery messaging.
