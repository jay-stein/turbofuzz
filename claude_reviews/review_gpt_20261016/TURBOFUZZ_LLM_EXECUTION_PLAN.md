# TurboFuzz: Prioritised LLM Execution Plan

**Purpose:** Give a coding agent a staged, testable path from the current TurboFuzz branch to a reliable data workbench with sound temporal types, pandas and Polars recipe output, and measured large-file performance.

**Target repository/branch:** `jay-stein/turbofuzz`, branch `agent/chart-axis-labels` (confirm the active checkout/branch before changing files).

**Execution style:** Work sequentially through the gates below. Inspect the actual checkout before assuming paths or behaviour. Make small, reviewable changes; run the stated tests after each phase; preserve current working behaviour; do not deploy or push changes unless explicitly instructed by the user.

---

## Strategic priorities

| Priority | Outcome | Why it comes here |
|---|---|---|
| P0 | Reproducible baseline and test map | Prevents an agent from making a broad rewrite without knowing what already works. |
| P1 | Correct logical types, particularly Date vs Datetime | Type inference affects filtering, sorting, profiling, transformations, chart axes and both recipe generators. |
| P1 | Dual pandas and Polars recipe output with explicit support diagnostics | A user-visible product feature; reuse one operation history, not two independently maintained pipelines. |
| P1 | Instrument ingestion and add a repeatable large-file benchmark | Establishes whether perceived performance issues are real and identifies the most valuable optimisation. |
| P2 | Bounded-memory/batched ingestion where benchmarks justify it | High engineering impact; avoid premature, invasive rewrites. |
| P2 | Transformation/recipe UX hardening | Makes longer workflows inspectable, reversible and honest about semantic limitations. |
| P2 | Chart axis and dense-layout polish | Builds on the type system so temporal axes are formatted correctly. |
| P3 | Optional type-system extensions and advanced execution modes | Avoids widening scope before the core is trustworthy. |

**Important sequencing note:** Type work and recipe work are related. Land and stabilise the temporal type model before adding Polars code generation. Benchmark instrumentation can be developed in parallel only if that does not change the data model or operation semantics.

## Phase 0 — Repository reconnaissance and baseline

### Tasks

1. Confirm the checked-out branch, working tree and package scripts. Do not overwrite uncommitted user changes.
2. Read the current implementations of:
   - `src/types.ts`
   - `src/parse/infer.ts` and date parsing helpers
   - `src/data/column.ts`, `src/data/dataset.ts`, `src/data/recipe.ts`
   - cleaning and transform operation definitions
   - worker ingestion protocol and parser
   - filter/search code that treats date/numeric columns specially
   - table column rendering, profile panels, chart axis formatting and export panel
   - current unit tests and benchmark scripts
3. Run the existing checks without changing code:
   - `npm test`
   - `npm run typecheck`
   - `npm run build`
   - `npm run bench:quick` (and `npm run bench:real` if it is safe and practical)
4. Record failures that existed before changes. Do not mislabel baseline failures as regressions.
5. Write a concise internal map of every place where `ColumnType === "date"`, numeric parsing, type labels, type inference and recipe export are handled. Use search rather than relying on memory.

### Deliverables

- A baseline note in the PR/agent summary: commands, pass/fail status, existing failures and any benchmark results.
- A list of operation kinds that the current Recipe generator can and cannot faithfully translate.
- No product behaviour changes in this phase.

### Gate to proceed

The tests and build have been run, the existing type/recipe flow is mapped, and the agent can name the likely regression surfaces.

---

## Phase 1 — Correct the logical type model

### Objective

Stop treating calendar dates and timestamps as the same type. Infer, display and operate on temporal values predictably without breaking existing numeric, identifier or category behaviour.

### Recommended type taxonomy

For this increment, add the minimum useful, cross-library logical types:

- Existing: `string`, `category`, `integer`, `number`, `boolean`, `identifier`
- Keep `date` for **calendar date only**
- Add `datetime` for a date plus time-of-day
- Add `time` for a time-of-day without a date
- Add `duration` for elapsed time / time delta
- Add an explicit `unknown` or `null-only` inference state only if the existing model can represent it cleanly; do not accidentally cast all-empty columns to a confident string/date/numeric type.

Do not add binary, nested list/struct, decimal, geospatial or other specialised types in this increment. Document them as future candidates. Do not conflate **semantic role** (`identifier`, `category`) with temporal/numeric storage types in a large refactor unless repository analysis proves the current union cannot support the feature safely. Preserve the current category and identifier behaviours for now.

### Tasks

1. Update the central type union, type labels and any options/dropdowns.
2. Inspect `parseDate` and inference order. Add explicit predicates/parsers for date-only, datetime, time-only and duration candidates. Prefer clear helper functions with direct tests over one large regex.
3. Date inference requirements:
   - ISO date-only input such as `2026-10-16` infers `date`.
   - Timestamp input such as `2026-10-16 09:30:00` or `2026-10-16T09:30:00Z` infers `datetime`.
   - A timestamp at midnight is still `datetime` if the source value includes a time component. Do not strip semantic information because every time happens to be `00:00:00`.
   - A date-only column must remain a date when used in filters, profiles, tables, charts and recipes.
   - Ambiguous values such as `01/02/2026` must follow the existing date-order policy and surface ambiguity/confidence to the user; do not silently introduce a different locale assumption.
   - Mixed date-only and timestamp strings should have a documented rule, preferably `datetime` when time components are present, with parse failures/mixed formats surfaced in profiling.
   - Preserve timezone offsets and distinguish timezone-aware timestamps from naive timestamps in metadata. Do not silently attach the computer's local timezone.
   - Time-only and duration inference must be conservative: `01:30` may be a wall-clock time or an elapsed duration. Use value patterns, column context and confidence; otherwise leave it as text and provide a conversion suggestion.
4. Keep inference robust against sampling misses. Use samples for provisional inference, then validate against all rows or report the full-column parse success/failure counts when the column is materialised. A sample-only inference must not imply that every row can be parsed.
5. Update typed numeric/date accessors and caches so `date` and `datetime` are not unintentionally handled identically. Keep data precision appropriate to the implementation and document any milliseconds/microseconds/nanoseconds limitation.
6. Update all affected surfaces:
   - type badges and manual type override
   - type suggestion and data-quality profile
   - sorting, range filters, search facets and min/max summaries
   - cleaning/conversion UI and date/time combination operations
   - chart selection, axis ticks and time-series axis formatting
   - CSV display/export and recipe schema metadata
7. Define missing-value behaviour consistently. Distinguish a missing/null cell from floating-point `NaN` where possible. Document the current CSV/string-backed representation if perfect preservation is not possible in this release.
8. Keep date parsing policy explicit: supported formats, DMY/MDY choice, invalid-value handling (`error`, `coerce to missing`, or preserve original), and timezone policy must be represented in operation parameters rather than inferred anew by each exporter.

### Required tests

- Date-only ISO and locale-formatted values.
- Datetime with seconds/fractional seconds, midnight timestamps and timezone offsets.
- Date-only strings mixed with timestamp strings.
- Ambiguous DMY/MDY data.
- Invalid dates, null tokens and all-null columns.
- Time-only values and ambiguous `HH:MM` values.
- Duration strings including `HH:MM:SS` with values greater than 24 hours.
- Identifier columns with leading zeroes and long digit sequences remain identifiers.
- Type override invalidates relevant parsing/statistics caches.
- Date/datetime filtering and chart axis formatting use the intended temporal semantics.

### Gate to proceed

Typecheck/build pass; all existing date tests still pass; new temporal tests pass; all central `ColumnType` switches have been reviewed; no feature silently changes an ambiguous date interpretation.

---

## Phase 2 — Make the recipe operation history a shared contract

### Objective

Support pandas and Polars output without building two separate transformation systems or claiming false equivalence.

### Tasks

1. Treat the persisted clean and transform operations plus input schema as the canonical recipe contract. Reuse the existing operation model wherever possible.
2. Define a small exporter interface and a shared support report. Each operation kind must have a declared status for each target:
   - `supported`: emits executable, semantically equivalent code
   - `supported_with_warning`: emits executable code but has a documented limitation
   - `manual_step_required`: cannot be safely generated; explicitly names the missing work
3. Audit current pandas output. The existing generator is described as best-effort and some operations produce comments rather than executable equivalent operations. Correct the most-used operations and surface every non-equivalent step before export. Never silently drop a recipe operation.
4. Define the first supported operation matrix by inspecting `CleanOp` and `TransformOp`, not by guessing. Cover the common path first: trim/case/replace, null-token handling, number/date conversion, round/drop, dedupe, filter where represented in recipe state, imputation, group-by/aggregate, melt/unpivot, split and combine date/time. Handle KNN and specialised aggregate semantics honestly.
5. Preserve the operation order and schema evolution; ensure column renames/drops and columns created by earlier steps are referenced correctly by later generated code.
6. Add a language selector to the recipe export UI: **pandas** or **Polars**. Keep **data export** (CSV) separate from **recipe export** (Python `.py`) so the UI does not conflate a code recipe with exporting Parquet data.
7. Keep existing pandas default behaviour backwards-compatible unless there is a clear reason to change it. Remember recipe generation is a source-code export; do not add external network calls to the browser application.
8. Include a generated header with required dependencies, expected input path/format, target library version assumptions where necessary, null/date policies and any non-equivalent operations.

### Gate to proceed

Every operation in the recipe history appears in the generated code or in a visible, specific warning list; the two generators read the same operation history; existing pandas output has golden tests.

---

## Phase 3 — Add Polars recipe generation

### Product decision

Implement **correct, readable Polars output first**. Prefer idiomatic Polars expressions over mechanically translating pandas syntax. Start with eager `DataFrame` output if that is the least risky way to establish parity. Design the exporter so a LazyFrame/`scan_*` mode can be introduced later without changing the canonical recipe contract. Do not claim lazy/out-of-core execution until the generated output actually uses and tests it.

### Tasks

1. Implement `polarsRecipe(...)` or an equivalent target-specific generator alongside the current pandas generator.
2. Add target-specific equivalents for the operation matrix established in Phase 2. Examples of idiomatic patterns (adapt to current Polars API and type needs):
   - string cleanup with `pl.col(...).str.strip_chars()` / casing functions
   - numeric casting with an explicit strict/non-strict policy
   - null token conversion using `when/then/otherwise` or replacement APIs
   - rounding, dropping, dedupe/unique and grouping
   - group-by aggregation and count semantics
   - melt via the current supported Polars unpivot API
   - splitting/extracting string columns
   - Date/Datetime/Time/Duration casts and parsing with explicit format and timezone handling
3. Generated code should start from a clear, editable input line and finish with an output write. If the source format is not retained by the app, say so and use an explicit placeholder rather than pretending every input was CSV. If the app has source-format metadata, use it to select the appropriate reader when that reader is supported.
4. Provide clear setup comments, e.g. `pip install polars`, and include `pandas`/`polars` dependency guidance as appropriate. Do not bundle Python runtime dependencies into the browser.
5. Handle date-only semantics explicitly. Polars has a native `pl.Date`; use `pl.Datetime` for timestamps and preserve timezones/units when represented. Avoid turning all date columns into midnight datetimes.
6. Handle the fact that pandas and Polars have different representations for date-only values. For pandas, choose and document a convention (`datetime64` normalised to midnight versus Python `date` objects/object dtype) and make it consistent. For Polars, prefer native `Date`. Don't promise dtype identity when the libraries model it differently.
7. Add generated recipe language controls, copy/download controls if available, syntax-safe strings/column names, and a visible warning panel for unsupported steps. Names containing spaces, quotes, punctuation, Unicode or Python keywords must generate safe column references.
8. Add tests comparing pandas and Polars execution against the same small golden fixtures. If Python interpreters/dependencies are available in CI, execute the scripts. If not, add an integration-test script that does so in a documented Python environment, alongside Node-level generator tests.
9. Add documentation with a per-operation support table and at least one end-to-end example in both pandas and Polars.

### Required recipe conformance tests

- Column names containing spaces, quotes, punctuation and Unicode.
- String trimming/case/replace.
- Null-token conversion and invalid casts.
- Date-only parse vs datetime parse and timezone-aware timestamps.
- Numeric conversion with locale parameters.
- Deduplication with each supported keep policy.
- Group-by count, sum, mean and null handling.
- Melt/unpivot and generated column names.
- Split columns and drop-original option.
- Imputation strategies that are advertised as supported.
- An explicitly unsupported operation that creates a visible warning, not silent omission.
- Output rows, values, nulls and column names match between TurboFuzz's expected result and each generated library script for common supported operations.

### Gate to proceed

Both exporters have a clearly stated operation support matrix. The common path executes on real fixtures and produces equivalent results for supported operations. Non-equivalent operations are flagged before export.

---

## Phase 4 — Benchmark ingestion and make progress truthful

### Objective

Know what large-file performance currently is before replacing the data model.

### Tasks

1. Extend or add reproducible fixtures at 100k, 500k and 1.5M rows. Use at least:
   - narrow numeric/time-series data
   - wide mixed-type data
   - high-cardinality strings
   - messy input with invalid dates, null tokens and ragged rows
   - representative Parquet if the current project can generate/read it offline
2. Measure parse time, schema/type-inference time, dataset/profile build time, time-to-first-useful-preview, filter/sort latency, transformation latency and export latency.
3. Record approximate peak memory where the available automation/browser tooling can measure it. Label estimates clearly; do not fabricate a browser memory metric if it cannot be collected.
4. Add phase-specific progress events for `reading`, `parsing`, `inferring schema`, `building columns`, `profiling/indexing`, `ready`, `cancelled` and `error`. Current/total should mean what the UI says it means; use indeterminate progress when a reliable denominator is unavailable.
5. Add a real cancel path that stops parser/worker work and releases references. Verify that cancelling cannot leave the UI stuck in a loading state or accept late worker responses for a cancelled import.
6. Ensure errors say what failed, whether the original dataset remains available, and what the user can do next.
7. Add a performance regression report in the benchmark output; do not add strict timing assertions to generic unit tests where CI variability will make them flaky.

### Gate to proceed

The team has a repeatable baseline for all chosen fixture sizes, progress states are testable, and cancellation/error recovery behaves predictably.

---

## Phase 5 — Reduce peak memory / batch the ingestion path where justified

### Objective

Avoid materialising multiple full copies of a large CSV in JavaScript memory.

### Tasks

1. Use Phase 4 measurements to identify the dominant memory and latency costs. Write a short decision note before selecting an approach.
2. Consider incremental parsing in the Web Worker and batched column builders rather than creating a complete `string[][]` and then copying each cell into per-column arrays.
3. If beneficial, represent data internally as typed/columnar buffers where feasible. Keep string storage efficient and avoid building expensive per-cell indexes until requested.
4. Compute basic schema and preview early; progressively calculate profiles and expensive fuzzy/category indexes. Make each deferred capability show a clear `building` state when requested.
5. Do not precompute a full categorical bitset for every high-cardinality value if doing so causes memory to scale as rows × unique-values. Bound category indexes and provide a fallback for high-cardinality columns.
6. Investigate using DuckDB-Wasm or Arrow only after profiling identifies the value. Keep the local-only security model: no server-side file uploads and no network execution dependencies.
7. Ensure all transformations, undo/redo, recipes and exports remain correct with the new data path. Add parity tests comparing the old and new implementations during migration where possible.
8. Add explicit input-size and memory-pressure messaging only based on realistic benchmarks and conservative estimates; do not hardcode arbitrary “safe” row limits.

### Gate to proceed

The benchmark report demonstrates a measurable improvement in peak memory or responsiveness on target fixtures without correctness regressions. If a rewrite does not improve the measured bottleneck, revert or narrow it.

---

## Phase 6 — Make transformation chains transparent and reliable

### Tasks

1. Standardise previews for potentially destructive operations. Show a sample of before/after values, affected rows, changed types, invalid-cast counts and resulting null count when available.
2. For dedupe, state the key columns and rows removed. For imputation, state which values were replaced and the strategy used. For date parsing, state the format/date order/timezone and failed parse count.
3. Make Recipe history inspectable, reversible and explicit about dependencies between steps. Reordering is allowed only when the operation model can establish it is safe.
4. Ensure pandas/Polars generation uses exactly the applied operation state, not separate UI-only state.
5. Add a high-value shortcut workflow for a common messy time series: parse datetime → convert numeric measure → replace sentinels with null → sort by time → filter a period → aggregate/resample → chart → export recipe.
6. Add keyboard navigation/focus states to menus, dialogs, type selectors and recipe export. Preserve the existing command bar shortcuts.

### Gate to proceed

The common cleaning workflow has an end-to-end fixture and repeatable browser test. Users can identify the effect of each step and see any recipe-generation gaps before exporting.

---

## Phase 7 — Chart readability and temporal axes

### Tasks

1. Tie axis formatting to logical column type, not column-name heuristics alone.
2. Date-only axes should format calendar dates; datetime axes should show time components at a suitable granularity; timezone-aware timestamps should make timezone treatment clear.
3. Add axis-title override, unit/number/date-format options and a tooltip for truncated long titles.
4. Adapt label density and margins to actual chart/card width; avoid letting a four-column layout silently make a chart unreadable.
5. Provide an expand/focus mode that retains the chart's config and returns to the grid without resetting it.
6. Audit legend visibility/toggling, keyboard use, contrast, empty-data charts and long category labels.
7. Test narrow and wide layouts, long column names, negative/fractional values, high-cardinality categories, date-only/date-time axes and export dimensions.

### Gate to proceed

Axis titles/ticks do not overlap or clip on supported viewports; temporal axes preserve Date vs Datetime semantics; users can expand dense charts and retain configuration.

---

## Phase 8 — Optional follow-on scope, only after the core gates pass

Candidates, ordered by value and cost:

1. Polars LazyFrame recipe mode (`scan_csv`/`scan_parquet`) with tested supported-operation semantics.
2. Decimal/fixed-precision currency type or explicit numeric precision metadata.
3. Semantic roles such as currency, percentage, coordinates and identifier separated from physical/logical storage type, if needed for better inference and recipe fidelity.
4. Strongly typed/native handling of Parquet values, including categorical, binary, list and struct types, if the product commits to those use cases.
5. More recipe targets (e.g. DuckDB SQL) only after pandas and Polars are reliable.

Do not start these merely because they look attractive. Use user feedback and benchmarks to select the next investment.

---

# Cross-cutting Definition of Done

For each phase, the coding agent must:

- Make a focused change with a clear commit-sized diff (do not commit unless repository/user instructions explicitly permit it).
- Add or update unit tests for new logic and regression tests for previous behaviour.
- Run `npm test`, `npm run typecheck` and `npm run build`.
- Run relevant benchmark/integration tests where the phase affects performance or generated code.
- Inspect `git diff` for accidental unrelated changes, unused abstractions and stale comments.
- Update README/docs and user-visible labels whenever supported behaviour changes.
- Report what was completed, what remains, commands run, results and known limitations.
- Never claim an E2E browser or Python-execution test passed unless it was actually run.
- Never hide an unsupported transformation behind a comment that looks like executable success.

## Suggested implementation checkpoints

- **Checkpoint A:** baseline is green or baseline failures are documented.
- **Checkpoint B:** Date/Datetime/Time/Duration distinctions pass tests across inference, filters and charts.
- **Checkpoint C:** pandas exporter support matrix is documented and existing output is covered by golden tests.
- **Checkpoint D:** Polars exporter produces executable code for the advertised common path; parity fixtures pass.
- **Checkpoint E:** large-file benchmark and honest progress/cancel states are in place.
- **Checkpoint F:** memory optimisation is retained only if measured results justify it.
- **Checkpoint G:** transformation/recipe UX and chart usability have end-to-end tests.

# Ready-to-paste LLM coding-agent prompt

You are the senior engineer implementing the plan in this repository. Execute the phases in order, starting with Phase 0. Inspect the actual checkout before assuming paths. Do not ask the user to repeat information already in this document. Do not perform a large rewrite in one pass. For each phase: state the narrow objective, inspect relevant code, implement the smallest coherent diff, add tests, run the relevant test/typecheck/build commands, review the diff, and report the results. If a test fails, determine whether it is a pre-existing failure or your regression and fix your regression before proceeding. Do not deploy, push, or commit unless explicitly authorised.

Treat Date vs Datetime as a correctness requirement, not a cosmetic label. Implement the shared recipe operation contract first and add both pandas and Polars outputs from the same applied operation history. Do not claim code-generation parity for an operation until generated code has been tested against a fixture. Clearly warn about operations that require manual translation. For large-file performance, establish repeatable benchmark measurements before changing the ingestion architecture; retain expensive architectural changes only when they demonstrate a measurable benefit and all correctness tests pass.

At every checkpoint, provide a concise progress report listing changed files, behaviour added, tests run and results, known limitations and the next phase. Stop only at a failing safety/correctness gate or when implementation is complete; never report a test as passed unless it was actually run.
