# 2026-10-16 — Execution plan Phase 2: shared recipe contract

Branch `agent/execution-plan`, commit `4312e1e`. Checkpoint C: the applied
history is the single export contract, the pandas support matrix is
documented, and the generated script is locked by golden tests.

## What changed

- `src/data/recipe-support.ts`: `RecipeTarget`, the three-state
  `SupportStatus` (`supported` / `supported_with_warning` /
  `manual_step_required`), `SupportEntry`, `RecipeScript`, `supportSummary`
  and `supportHint`.
- `pandasRecipeScript(input)` returns `{ target, code, entries }`; every
  applied step emits exactly one entry in apply order, and the script header
  lists every non-equivalent step (warnings and manual steps). `pandasRecipe`
  remains the string wrapper for the Copy button.
- `RecipeInput` extended: `nulls` (per-column missing tokens kept/added),
  `types` (logical-type edits), `deletedRows`. The app builds it once in
  `App.recipeInput()`; the Recipe drawer shows
  `supportHint("pandas", …)` above the step list.
- pandas correctness fixes:
  - `escapeFormulas` is now executable (mirrors the @/=/tab/CR and signed
    expression guard, `import re` added only when needed).
  - grouped mode impute is executable with a tie-breaking warning.
  - `melt` with empty `valueVars` now defaults to non-id columns (matches
    runtime), and indexes are filtered to the tracked schema.
  - `combineDate` emits `dropParts` drops and guards parts that are gone.
  - `splitColumn` with `dropEmpty` is an explicit manual step (per-row
    packing has no pandas equivalent).
  - Every single-column op is schema-guarded: a missing column produces a
    comment + manual entry instead of `df[undefined]`.
  - `aggregate.fill` is passed through; the fill reindex is flagged manual.
- Missing-value edits and type edits are generated (`extra` tokens →
  `replace([...], pd.NA)`; number/date/datetime/time/duration/category
  conversions). Reader-dependent cases (keep tokens, boolean mapping) are
  manual entries with the exact missing work named.
- Header now includes dependencies, the input placeholder (the app does not
  record the source format), null/date conventions and the warning list.
- `docs/recipe-support.md`: full per-operation support matrix.
- Tests: golden full-script test, never-drop test (`undefined`-free,
  4/4 manual report), combineDate dropParts, grouped mode warning, alongside
  the existing recipe tests. Help text updated.

## Commands and results

```
npm test             # 562 pass, 0 fail
npm run typecheck    # clean
npm run build        # clean
```

## Known limitations (documented, not hidden)

- `aggregate` fill, post-aggregation window ops, KNN, outlier flags,
  data-dependent fences and per-row split packing are manual entries.
- Row deletions are reported but not regenerated.
- The pandas `date` convention is Python date objects; `datetime` is
  `datetime64[ns]` with naive timestamps read as UTC. Documented in the
  script header and the support matrix.

## Next (Checkpoint D)

Phase 3: `polarsRecipeScript()` reading the same `RecipeInput` and emitting
the same `SupportEntry[]` contract, idiomatic Polars (`unpivot`,
`str.strip_chars`, `dt.truncate`, `cast(..., strict=False)`, native
`pl.Date`/`pl.Time`/`pl.Duration`), a pandas/Polars language selector in the
Recipe drawer, and conformance fixtures plus a documented Python parity
runner (`tools/recipe-parity/`).
