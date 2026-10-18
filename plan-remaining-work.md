# Implementation Plan: Remaining Loading, Table, Charts, and Pivot Work

**Status:** Ready for review
**Date:** 2026-10-18
**Baseline:** `agent/foundation-quick-wins` at `9f63043`
**Source documents:**
- `plan-loading-table-charts-pivot.md` (original plan)
- `charting_aggregation_ux_spec.md`
- `docs/agent-sessions/2026-10-18-foundation-quick-wins.md` (delivered baseline)

**Purpose:** turn the remaining backlog into sequenced, independently reviewable work packages with explicit dependencies, acceptance criteria, tests, and release gates.

---

## 1. Current baseline

Already delivered and not to be rebuilt:

- multi-file CSV append with `_input_filename`, provenance role, progress/cancel, duplicate/empty-row/DQ exclusion;
- cast engine and confirmation dialog with coerce/keep/reject;
- Set1 default, Count plot rename, `Filter:`/`Fix:` chip labels, merged `N issues` header chip;
- chart-scoped filters, respect-table-filters toggle, explicit non-null/distinct counts;
- chart calculations: rolling mean (7), cumulative, difference, % change, % of total, rank, YoY;
- density viewport correction, stacked grouped Barplots;
- pan/zoom/reset across line, histogram, scatter, density, map, bubble, count plot, box, heatmap, treemap, terms, and correlation;
- GeoJSON + zipped Shapefile loading, CRS rejection, choropleth join, hover/click, matched/unmatched counts;
- Pivot rename, multi-field row indexes, multi-field column headers, margins, fill/drop, measure selector, resample grain, flat CSV;
- ChartSpec JSON export and pandas/Polars code downloads for supported chart kinds;
- complete worker-backed Pivot View with drag/drop wells, typed report filters, multi-date hierarchies, pivot heatmap charts and grouped chart sources;
- typed table header filters sharing the sidebar filter card, with dataset-anchored date bounds.

Baseline test state: **757 tests passing**, typecheck and production build green.

---

## 2. Scope and non-goals

### In scope

- Completing the remaining chart-builder, chart-exploration, ChartSpec, geo, and Pivot requirements from the original plan.
- Completing batch casting, mismatch review, type-lattice explanations, and table rebuild performance work.
- Completing multi-file preflight/metadata hardening and shared chip semantics.
- Release hardening: E2E coverage, benchmarks, accessibility, CSP/manual review, and documentation.

### Out of scope for this plan

- Dataset tabs or multi-dataset state; the app remains single-dataset.
- LocalStorage persistence for pivots; pivots remain in-memory session artifacts.
- Pie/donut charts unless user research prioritises them.
- Point-in-polygon joins; maps join through feature attributes only.
- Arbitrary Python lambdas; only the safe parsed mini-language is supported.
- Bootstrap confidence intervals; v1 error bars use the documented normal approximation only.

---

## 3. Delivery principles

1. **One aggregation model.** Chart, Pivot, ChartSpec, CSV export, and generated code must compile to the same aggregation definitions.
2. **Worker owns heavy work.** Matrix assembly, batch casts, margins, and large aggregations stay off the main thread.
3. **Every operation is inspectable.** Aggregation, grain, filters, calculations, sampling, and units are visible in the UI and exported artifacts.
4. **No silent data changes.** Casts, derived measures, placeholder conversion, and inferred business metrics require confirmation or an explicit opt-in.
5. **Feature flags are not required.** Land behind tests and progressive disclosure; keep the main path compact.
6. **One reviewable slice per merge.** Each work package below should be shippable with tests and documentation on its own.

---

## 4. Sprint 1: 10-Day Impact Sprint

**Status:** Complete on 2026-10-19. All selected packages landed; remaining work is in the deferred backlog.

**Budget:** 10 engineer-days, including 0.5 day contingency.

**Selection rule:** highest user-visible leverage per day, preferring work that removes daily friction over architectural purity or release mechanics.

### Research findings

- W1 is complete.
- W2 is almost entirely unbuilt. Batch casting and mismatch review are the largest remaining data-cleaning friction points.
- W3 already has time controls, gap policies, numeric bins and calculations. What remains is chart comprehension: summary, richer measures, sorting, warnings and series limits.
- W4 already has Barplot depth, viewport coverage, chart CSV and direct geo loading. Inspector and drill actions are the highest-value gaps.
- W5 pandas/Polars generation exists, but full ChartSpec adoption is a larger refactor with mostly technical/export value.
- W6, W7 and W8 are hardening/release streams; they should follow the next user-facing pass.

### Sprint budget

| Order | Package | Deliverable | Days |
|---:|---|---|---:|
| 1 | **W2.2** | Batch conversion queue: one selection, one worker rebuild, per-column failures, single Undo. | 2.5 |
| 2 | **W2.1** | `castFailures` bitset plus **Review mismatches** filter matching the cast dialog counts. | 1.0 |
| 3 | **W3.2 + W3.3** | Always-visible chart summary sentence and expanded, type-aware measure menu (stddev, variance, percentile, row/total percentages, boolean/date aggregates). | 2.0 |
| 4 | **W3.4** | Non-additive warnings for summing rates, ratios, percentages, indices and similar fields, with mean/median alternatives. | 0.5 |
| 5 | **W3.5** | Chart sorting: value asc/desc, label, chronological time, numeric-bin order, deterministic tie-break, without re-aggregation. | 1.0 |
| 6 | **W3.10** | Category/series controls: visible limit, Other bucket, Show all, series cap and high-cardinality warning. | 1.5 |
| 7 | **W4.1** | Point/bar inspector showing measure, aggregation, value, counts, active filters, grain/bin and sampling disclosure. | 1.5 |
|  | **Total** |  | **10.0** |

### Sprint exit gate

- `npm run typecheck`, `npm test` and `npm run build` are green.
- New controls have keyboard/aria coverage and do not regress existing chart/table behavior.
- Batch cast cancel is atomic and never loses the prior dataset.
- No selected package leaves a half-wired control in the UI.

### Deferred backlog

**W2 — remaining performance/review work**
- W2.3 type lattice.
- W2.4 incremental clean application.
- W2.5 type-preserving rebuilds.
- W2.6 deferred/chunked dataset stats.
- W2.7 long-operation progress/stale/cancel states.
- W2.8 clean benchmarks and latency guards.
- W2.9 expanded cast/type/performance tests.

**W3 — remaining chart architecture**
- W3.1 shared chart-builder structure across Add/Edit/Duplicate/Reset is complete in Sprint 2.
- W3.6–W3.9 are already complete; no backlog work.
- W3.2-W3.5 and W3.10 are complete.

**W4 — remaining exploration**
- W4.2 explicit drill/filter/underlying-rows actions are complete in Sprint 2; dedicated period comparison remains a follow-up.
- W4.4 shared colour-scale module is complete in Sprint 2.
- W4.8 unknown/null category disclosure and chart data-issue actions are complete at column level; filtered counts remain a follow-up.
- W4.3, W4.5, W4.6 and W4.7 are already complete.

**W5 — ChartSpec adoption**
- W5.1 multi-measure/lossless spec expansion.
- W5.2 render ChartCard from the spec.
- W5.3 CSV/duplication from the spec.
- W5.4 spec import/validation/apply.
- W5.6 golden result-parity tests.
- W5.7 separate pivot code actions and keep pivots out of the Recipe.
- W5.5 pandas/Polars generation is already complete.

**W6 — multi-file hardening**
- W6.1 256 KB preflight.
- W6.2 combined sampling/threshold.
- W6.3 per-file metadata.
- W6.4 full provenance exclusion.
- W6.5 multi-file tests.

**W7 — shared chips and DQ UX**
- W7.1 shared chip module.
- W7.2 collapsed fix chips and sampled-count labels.
- W7.3 type-change entry-point audit.
- W7.4 chart data-issue action consistency is complete in Sprint 2.
- W7.5 component test coverage.

**W8 — release hardening**
- W8.1 E2E coverage.
- W8.2 benchmarks.
- W8.3 accessibility review.
- W8.4 CSP/manual review.
- W8.5 docs/help/session/support updates.
- W8.6 final full gate.

---

## 4b. Sprint 2: Chart Actions and Trust

**Status:** Complete on 2026-10-19, with the scoped follow-ups recorded below.

**Budget:** 10 engineer-days, including 0.5 day contingency.

**Selection rule:** finish the chart exploration loop before starting ChartSpec or release hardening. Sprint 1 made charts explain themselves; Sprint 2 makes them actionable and trustworthy.

### Research findings

- W4.1 is complete, but the inspector is read-only. There is no direct “show me these rows”, “filter to this group”, drill, breakdown or compare follow-through.
- W4.2 is entirely unbuilt. Existing hit actions filter or zoom the chart; they do not expose table scope or a reusable action model.
- W4.4 is partially built: `colorMin`/`colorMax` live inside `ChartCard`, but there is no shared module, no diverging centre control and no single legend/domain path.
- W4.8 is unbuilt. `(empty)` and placeholder categories are visible in charts without counts, explanation or scoped fix actions.
- W3.1 is unbuilt. Add/Edit/Duplicate/Reset still assemble field controls through separate paths, which makes chart-action parity expensive.
- W7.4 depends on W4.8 and is small once the data-issue surface exists.
- W5 ChartSpec adoption should wait until the action/colour/missing-value semantics are settled; otherwise the spec will encode behaviour that is still moving.

### Sprint budget

| Order | Package | Deliverable | Days |
|---:|---|---|---:|
| 1 | **W3.1** | Shared chart-builder structure across Add/Edit/Duplicate/Reset with one validation/summary path. | 1.0 |
| 2 | **W4.2** | Explicit chart actions: filter table, view underlying rows, drill, break down, compare, duplicate, config undo and reset. | 3.5 |
| 3 | **W4.8** | Unknown/null category counts, chart data-issue bar, scoped placeholder conversion and undo. | 2.0 |
| 4 | **W4.4** | Shared colour-scale module with auto/manual domains, diverging centre, legend and clipping guarantees. | 2.0 |
| 5 | **W7.4** | Chart data-issue actions use the shared chip risk/exactness/undo semantics. | 0.5 |
| 6 | **Integration reserve** | Cross-package keyboard/a11y/regression pass and bug buffer. | 0.5 |
|  | **Total** |  | **9.5 + 0.5 contingency = 10.0** |

### Work package detail

#### W3.1 — One chart builder (1.0 day)

- Extract the field/measure/source/validation structure currently repeated across Add, Edit, Duplicate and Reset.
- Keep the existing chart kinds and controls; this is a structural extraction, not a redesign.
- One helper produces the suggested configuration, one validates it, and one renders the summary for every entry point.
- Acceptance: Add/Edit/Duplicate/Reset produce the same summary and validation messages for the same config; duplicate and reset preserve/reset the same fields consistently.
- Tests: builder parity table across all four entry points; no behavior change for existing chart setup tests.

#### W4.2 — Explicit chart actions (3.5 days)

Add a consistent action surface on point/bar/category interactions. The inspector stays as the preview; actions state their scope before applying.

Required actions:
- **Filter table to this group** — adds ordinary, visible table filters; never silently changes table scope.
- **View underlying rows** — switches to the table with the same filter and reports the exact matching row count.
- **Drill to finer grain** — next date grain for time charts; selected breakdown for category charts. No arbitrary hierarchy authoring.
- **Break down by another field** — opens the shared builder prefilled with the current measure/group and the chosen breakdown.
- **Compare group/period** — same measure, comparison dimension/period, explicit labels; no hidden second aggregation.
- **Duplicate, config undo, reset to suggested** — one undo stack for config changes; duplicate preserves source and filters.
- Acceptance: every action names its scope; chart selection alone never filters the table; action filters are visible/removable; underlying-row counts equal the chart bucket count; drill/compare produce a normal editable chart.
- Tests: action-to-filter mapping, row-count parity, undo/duplicate/reset, keyboard activation and focus return, no implicit table changes.

#### W4.8 — Unknown/null chart categories (2.0 days)

- Count unknown, null and placeholder categories separately in aggregate results.
- Add a results-bar disclosure such as “12 missing · 3 unknown” with an explanation.
- Actions: filter to affected rows, convert placeholders scoped to the chart dimension, and undo. Conversion uses the existing cast/clean preview rules.
- Keep `(empty)` visible but explain it; do not silently drop or recode values.
- Acceptance: chart counts reconcile with the disclosure; conversion preview and undo restore the original chart; scope is limited to the affected dimension; CSV/summary disclose the treatment.
- Tests: counts for null/unknown/placeholder, scoped conversion, undo, CSV summary, no mutation without confirmation.

#### W4.4 — Shared colour scale (2.0 days)

- Extract `src/ui/color-scale.ts` for numeric scatter/map, map heat, heatmap, density and correlation.
- Support `colorMin`, `colorMax`, optional divergent `colorCenter`, auto/manual domains and one legend path.
- Auto domains cover the displayed data; manual domains may clip by design and must say so. Diverging centre behaviour is explicit and tested.
- Acceptance: all five chart paths use the same scale/legend; no chart silently clips data; pivot heatmap keeps its current behaviour.
- Tests: domain calculation, centre/diverging, clipping disclosure, legend formatting, chart golden/regression coverage.

#### W7.4 — Issue-action consistency (0.5 day)

- Route the new chart issue actions through the same chip kind/risk/exactness/undo semantics as table fixes.
- Prevent a second parallel action vocabulary in chart results.
- Acceptance: chart issue chips state whether they filter or fix, include exact/sampled counts, and expose Undo where mutation occurs.
- Tests: shared chip labels, `aria-pressed`, apply/undo, stale disappearance.

### Sprint 2 follow-ups

- **Period comparison:** the current action is an explicit duplicate-for-comparison that keeps both cards editable. A dedicated two-period/two-group compare editor remains deferred.
- **Chart issue counts:** disclosure uses column-level cleaned stats, so it does not yet recompute per active chart filter. Scoped bucket counts remain deferred.
- **Correlation colour:** correlation cells keep their fixed red/neutral/blue mapping, but now expose the shared centred domain/legend path.

### Sprint exit gate

- `npm run typecheck`, `npm test` and `npm run build` are green.
- Every chart action is reachable by keyboard and states its scope.
- No action silently filters the table or mutates values.
- Chart bucket counts match underlying-row counts after the same filters.
- Missing/unknown categories reconcile across chart, summary, CSV and disclosure.
- Colour domains and legends are consistent across all supported chart kinds.
- No selected package leaves a half-wired control.

### Explicit non-goals

- W5 ChartSpec expansion/render migration.
- W2 cast/rebuild performance work.
- W6 multi-file preflight.
- W8 E2E/benchmark/accessibility release gate.
- New chart kinds or a general hierarchy/drill-path authoring UI.

### Follow-on order

After Sprint 2, the remaining sequence is:

1. **W5 ChartSpec adoption** — now that action, colour and missing-value semantics are settled.
2. **Backlog A** — W2 type lattice, incremental clean, type-preserving rebuilds and benchmarks.
3. **Backlog C** — W6 multi-file hardening, W7 shared chips, W8 release gate.

---

## 4c. Sprint 3: ChartSpec Adoption

**Status:** Complete on 2026-10-19, with the scoped follow-ups recorded below.

**Budget:** 10 engineer-days, including 0.5 day contingency.

**Selection rule:** make the exported spec the lossless source of truth for runtime config, duplication and import before expanding code-generation coverage.

### Delivered

| Order | Package | Deliverable | Days |
|---:|---|---|---:|
| 1 | **W5.1** | Spec v2 covering all currently supported config fields, column names, filters, aggregation, binning and presentation. | 3.0 |
| 2 | **W5.2** | `chartSpecToConfig` compile/validation path and `ChartCard.applySpecText`; invalid specs never partially apply. | 2.0 |
| 3 | **W5.3** | Duplicate/compare rebuild from the compiled spec; CSV remains configured by the same runtime config. | 1.0 |
| 4 | **W5.4** | Card-menu JSON import with shape/version/column validation and an explicit error dialog. | 1.5 |
| 5 | **W5.5** | `chartSpecSupport` report plus generated-file support notes. | 0.5 |
| 6 | **W5.6** | Round-trip, invalid-import, apply-atomicity, support-report and code-generation tests. | 1.5 |
| 7 | **W5.7** | Audit pivot code separation: View pandas copy remains outside the data Recipe. | 0.5 |
|  | **Total** |  | **10.0** |

### Sprint 3 follow-ups

- **Multi-measure charts:** the runtime still supports one measure per card, so the spec is lossless for the supported single-measure surface.
- **Executable parity:** tests compare compiled configs and golden code; no Python interpreter is run in the suite.
- **CSV payload:** rows remain derived from live worker results; the config that shapes those results is now the compiled spec.
- **Dedicated pivot code button:** the intact View recipe already carries pivot code separately; a one-click pivot-only copy action remains backlog.

### Sprint exit gate

- `npm run typecheck`, `npm test` and `npm run build` are green.
- An imported spec either applies completely or leaves the card unchanged.
- A config exported through the spec and recompiled is lossless for supported fields.
- Unsupported code-generation features are listed explicitly, not silently approximated.

---

## 4d. Sprint 4: Cleaning Correctness and Performance

**Status:** Complete on 2026-10-19, with the scoped follow-ups recorded below.

**Budget:** 10 engineer-days, including 0.5 day contingency.

**Selection rule:** make the clean/cast path faster and more explainable before adding multi-file preflight or release mechanics.

### Research findings

- `handleCleanColumns` replays the complete op list from `cleanSource` on every clean, even when the previous result is already in memory.
- `rebuildDataset` calls `datasetFromColumns`/`computeDatasetStats`, redoing the shared row-level pass even when one column changed.
- Type promotion logic is spread across inference, build/append reconciliation and cast handling; there is no single lattice with user-facing reasons.
- `bench/latency.ts` already covers queries and rebuild paths, but there is no clean-specific 100k/300k/10-column benchmark gate.
- W2.6 deferred stats and W2.7 progress/cancel states remain deferred; the current load progress/cancel path is already in place.

### Sprint budget

| Order | Package | Deliverable | Days |
|---:|---|---|---:|
| 1 | **W2.3** | Explicit type-lattice module used by cast safety, explanations and multi-file reconciliation. | 2.0 |
| 2 | **W2.4** | Incremental clean application: append one op to current values; replay only on reorder/removal. | 2.0 |
| 3 | **W2.5** | Type-preserving rebuild for trim/case/replace and explicit-target casts; skip unaffected stats. | 2.0 |
| 4 | **W2.8** | Clean benchmarks and latency guards for 100k one-column, 300k and 100k 10-column cases. | 1.5 |
| 5 | **W2.9** | Type-lattice, incremental-clean, rebuild-parity and benchmark tests. | 1.5 |
| 6 | **Integration reserve** | Regression pass, stale-cache checks and budget buffer. | 0.5 |
|  | **Total** |  | **9.5 + 0.5 contingency = 10.0** |

### Work package detail

#### W2.3 - Type lattice (2.0 days)

- Add one lattice for null/boolean/integer/number, date/datetime, time, duration, category, identifier and string.
- Use it for cast compatibility, multi-file column reconciliation and dialog explanations.
- Incompatible mixes fall back to string with a reason naming the conflicting types.
- Acceptance: no silent type reinterpretation; every fallback has a stable explanation.
- Tests: pairwise matrix, multi-file mixed types, cast/keep/coerce and recipe parity.

#### W2.4 - Incremental clean application (2.0 days)

- Keep the current post-clean values as the next source when appending an op.
- Replay from the pristine source only on reorder, removal or policy change.
- Preserve undo, exact changed-cell flags and mutation masks.
- Acceptance: applying a clean op does not replay the full history; undo/reorder still produces the same bytes.
- Tests: append/reorder/remove parity, undo, no-op cleans and changed-cell masks.

#### W2.5 - Type-preserving rebuild (2.0 days)

- Skip inference/suggestions for trim/case/replace and explicit-target casts where the type cannot change.
- Recompute only stats that can be affected; reuse unaffected column caches.
- Keep dataset-level duplicate/null/anomaly bitsets correct after partial stats updates.
- Acceptance: clean benchmarks improve materially; stats that cannot change are not recomputed.
- Tests: exact stat parity against a full rebuild, cache reuse, revert and post-transform cleans.

#### W2.8 - Clean benchmarks (1.5 days)

- Add `bench/clean.ts` with 100k one-column, 300k and 100k 10-column batch cases.
- Cover coerce and keep policies, plus an undo/rebuild case.
- Budgets: p95 <=250 ms, <=600 ms and <=2 s respectively, with no avoidable >100 ms main-thread task.
- Acceptance: benchmark output is deterministic enough for CI and failures name the budget.
- Tests: benchmark smoke run and budget assertion helpers.

#### W2.9 - Coverage (1.5 days)

- Type-lattice matrix and fallback-reason tests.
- Incremental clean parity and performance guards.
- Worker batch cast/clean integration and recipe replay.
- Full gate: typecheck, unit suite, build and `bench:quick`.

### Sprint exit gate

- `npm run typecheck`, `npm test`, `npm run build` and `npm run bench:quick` are green.
- Clean performance budgets pass.
- No silent type changes or stale stats after incremental rebuild.
- Undo/reorder/removal produce byte-identical values to a full replay.

### Sprint 4 follow-ups

- W2.6 deferred/chunked dataset metrics.
- W2.7 long-operation progress/stale/cancel polish.
- W2.3 multi-file diagnostics: the lattice is wired to cast explanations; append still infers after concatenation, so per-file conflict reporting moves with W6.
- W6 multi-file preflight/metadata hardening moves to Sprint 5.

---

## 5. Workstreams

### W1. Pivot completion

**Goal:** replace the remaining client-side/aggregate-derived pivot behavior with a first-class worker pivot model and complete the pandas-style Pivot View.

**Status:** Complete. Pivot drag/drop, typed report filters, date hierarchies, chart-source grouping and pivot heatmaps are delivered; legacy aggregate pivot assembly is removed.

**Depends on:** none; can start immediately.
**Blocks:** W5 (pivot recipe parity), W9 (pivot benchmarks).

| ID | Task | Acceptance |
|---|---|---|
| W1.1 | Complete — add `PivotRequest`/`PivotMessage` and `computePivot` in the worker; reuse `computeAggregate` internally for base, row-margin, column-margin, and grand-total passes. | Worker returns matrix cells, labels, times, measure names, margins, partial flags, truncation, and a stable level schema. No large long-form payload reaches the UI. |
| W1.2 | Complete — add `PivotDef` with ordered `values`, `index` (0–3), `columns` (0–3), options, and time settings; compile it to worker requests. | At least one value and at least one index/column field is enforced; duplicate index/column use is either blocked or explicitly warned. |
| W1.3 | Complete — replace the layout-only pivot builder with Values / Index / Columns field wells: add/remove, up/down reorder, “Add all numeric”, value aggregation chips. | Up to 3 index and 3 column fields render correctly; aggregation changes are visible per value. |
| W1.4 | Complete — support multiple values and multiple aggregations simultaneously. Column headers use explicit internal level names: values → aggfunc → column fields. | Two values × two aggregations × two column fields renders a stable multi-level header; CSV and generated code use the same level order. |
| W1.5 | Complete — implement the safe custom aggregate mini-language: `lambda x: ...` over mean/median/sum/min/max/count/size/nunique/std/var/first/last/quantile, arithmetic, and numeric literals. | Parse errors and sample results are shown before apply; no `eval`/`new Function`; pandas output preserves the lambda text. |
| W1.6 | Complete pivot options: sort index/columns, source order, `margins_name`, pandas-compatible `dropna`, fill behavior, and validation against existing labels. | Options are visible in the pivot summary; margins still come from raw rows; behaviors have help text and tests. |
| W1.7 | Complete time/resample: every-N frequency, closed label/origin/offset, per-combination gap fill with cartesian cap, multiple-time-field warning, timezone/fiscal/week controls. | Sole-time-index resample matches pandas fixtures; multi-dimension gap fill is capped and disclosed; parity fixtures cover DST and fiscal periods. |
| W1.8 | Complete named pivots: unique-name validation, duplicate action, stable IDs, remap by column name across transforms, reset on new dataset, refresh bound charts on definition edit. | Renames preserve IDs; transforms remap columns; bound charts refetch after edits; missing columns produce an orphan/reload state. |
| W1.9 | Complete pivot CSV: flat default, optional multi-row headers, margins, fill, measure/agg names, formula escaping, BOM/CRLF, and large-output guard. | Exports match the displayed matrix; >250k-cell outputs warn or stream; formula-like cells are escaped. |
| W1.10 | Complete pivot code generation: real `pivot_table` for pandas with values/index/columns/aggfunc/fill/margins/dropna/sort/time settings; Polars equivalent or explicit support note; separate “Copy pandas pivot code”. | Golden code tests cover multi-value/multi-agg/margins/fill/dropna/time; unsupported time/agg cases are listed, not silently approximated. |
| W1.11 | Complete — dedicated pivot heatmap chart kind with index/column level selectors, measure selector, shared colour scale, CSV and filter refresh. Legacy aggregate pivot assembly removed. | Pivot heatmap renders, exports CSV, and reacts to pivot definition/filter changes. |

**Estimate:** 10–14 engineer-days.
**Exit gate:** pivot matrix, margins, multi-level headers, resample, named artifacts, CSV, code, and pivot heatmap all work without client-side matrix assembly.

---

### W2. Casting, mismatch review, and table performance

**Goal:** finish the cast workflow and remove avoidable rebuilds from common clean/cast operations.

**Depends on:** none.
**Blocks:** W7 (chip risk semantics), W9 (performance gates).

**Sprint 4 scope:** W2.3-W2.5 and W2.8-W2.9. W2.6 and W2.7 remain deferred.

| ID | Task | Acceptance |
|---|---|---|
| W2.1 | Complete — add `castFailures` bitset per column and a `Review mismatches` special filter. | Applying “Keep invalid” records exact failing rows; the filter shows only mismatches; counts match the dialog. |
| W2.2 | Complete — add batch conversion UI: Types view/table with current/inferred/target types, multi-select, one queue, one worker request, one Undo batch. | 10-column cast performs one request/rebuild; partial failures are reported per column; cancel reverts the queue without mutation. |
| W2.3 | Complete - add `type-lattice.ts` for lossless promotions, text fallback reasons and cast compatibility. | Cast dialog explains risk; multi-file append still relies on combined inference, with per-file diagnostics deferred to W6. |
| W2.4 | Complete - incremental clean applies only the new op suffix; reorder/removal replays from source. | Undo/reorder returns byte-identical values and changed-cell masks remain exact. |
| W2.5 | Complete - type-preserving column rebuilds skip suggestions and selective stats reuse unaffected bits/fences/patterns. | Full-rebuild parity tests pass; unaffected columns and caches are reused. |
| W2.6 | Defer or chunk dataset-level stats with an “Updating dataset metrics…” state; patch only the affected header/visible rows. | Table rows render before health/DQ metrics complete; no avoidable main-thread task exceeds 100 ms. |
| W2.7 | Add progress, stale, cancel, and error states for long batch casts/rebuilds. | Large casts show determinate progress and can be cancelled without losing the prior dataset. |
| W2.8 | Complete - add `bench/clean.ts`, `bench:clean` and clean budgets for 100k/300k/10-column/undo cases. | Measured p95 is inside the 250 ms/600 ms/2 s budgets. |
| W2.9 | Complete - lattice, incremental-clean, selective-rebuild and clean benchmark tests. | Full suite and clean budgets are green. |

**Estimate:** 8–12 engineer-days.
**Exit gate:** batch casts are one request/one rebuild/one undo; mismatch review is exact; clean performance budgets pass.

---

### W3. Chart builder and aggregation depth

**Goal:** finish the shared builder and the aggregation/grouping controls required by the plan.

**Depends on:** W1.1 (worker aggregation interface remains shared); W5.1 (spec shape should be agreed early).
**Blocks:** W4, W5.

| ID | Task | Acceptance |
|---|---|---|
| W3.1 | Complete - extract one shared chart-builder structure used by Add chart, Edit chart, Duplicate, and Reset to suggested configuration. | Shared defaults, edit dialog, config application, validation and summary path; chart config remains out of the data Recipe. |
| W3.2 | Complete — add an always-visible chart summary sentence: measure, aggregation, grouping, breakdown, filters, grain/calculation, source. | Summary updates live and names every semantic choice. |
| W3.3 | Complete — expand measure menu: stddev, variance, custom percentile, percent of rows, percent of total, boolean true/false/percentage/missing, date earliest/latest. | Only valid operations appear per type; null handling and denominator are documented in tooltips. |
| W3.4 | Complete — add non-additive/unit warnings when summing rate/ratio/percentage/index/temperature-like fields. | Warning states why summing may be misleading and offers mean/median alternatives. |
| W3.5 | Complete — add user-facing sorting: value asc/desc, label, chronological time, numeric-bin order, deterministic tie-break. | Sorting updates without re-aggregation; time/numeric ordering is correct. |
| W3.6 | Complete time controls in charts: visible default grain, every-N, 15/30-minute where supported, week start, fiscal calendar, date parts, timezone selection and summary. | Same time-bucket model as Pivot; active timezone and grain visible in the summary. |
| W3.7 | Complete gap/missing-period controls: drop/zero/carry/interpolate where valid, observed-vs-filled styling, partial-period warning. | Filled periods are visually distinct; absent periods are never silently zero without an explicit policy. |
| W3.8 | Complete numeric-bin controls: equal width, quantile/equal frequency, custom edges, boundary ownership, under/overflow counts, numeric sorting. | Chart and Pivot use the same bin definition; out-of-range values are reported. |
| W3.9 | Complete calculations: rolling sum, configurable window, index-to-100/base period, period-over-period absolute comparison, weighted average, reference/target values. | Calculation summary shows ordering/window/denominator/missing behavior; chart data remains non-destructive. |
| W3.10 | Complete — add category/series controls: default 10, visible limit, Other bucket, “Show all”, 12-series cap, high-cardinality warning. | Limit/Other/cap visible in summary, CSV, and spec; deterministic ordering. |

**Estimate:** 10–14 engineer-days.
**Exit gate:** a user can build, inspect, and reproduce an aggregated chart without implicit defaults; aggregation, grain, bins, sorting, calculation, limits, and Other are all explicit.

---

### W4. Chart exploration, presentation, and geo completion

**Goal:** finish the inspect/drill/present interactions and the remaining geo/presentation requirements.

**Depends on:** W3.2 (summary), W3.9 (calculations), W5.1 (spec for viewport/export).
**Blocks:** W9.

| ID | Task | Acceptance |
|---|---|---|
| W4.1 | Complete — add a point/bar inspector: label, measure/aggregation, value, row count, non-null count, active table/chart filters, grain/bin, sampled/full disclosure. | Tooltip/inspector stays consistent for aggregated and raw charts. |
| W4.2 | Complete - filter table to group, view underlying rows, drill to finer grain, break down by another field, duplicate-for-comparison, edit/reset. | Actions state their scope; chart selection never silently filters the table; dedicated period comparison remains a follow-up. |
| W4.3 | Complete Barplot: time X, error bars (SD/SE/95% normal), order controls, hue order/cap, orientation, weighted measure, negative-value baseline. | Error method disclosed; hover shows n/estimate/error; legacy bar+value configs migrate safely. |
| W4.4 | Complete - shared colour-scale domains/ramps/legend for scatter, density, map points, map heat, map regions, pivot heatmap and correlation. | One scale/legend path; manual domains disclose clipping; diverging centre runs through the shared domain. |
| W4.5 | Complete viewport coverage: Barplot category + Y zoom, pivot heatmap windows, generic reset/controller, card-menu “Reset zoom & pan”. | Reset disabled at default; export can use current or full domain. |
| W4.6 | Complete chart CSV: visible-window option, formula-injection escaping, per-kind schemas, sampled/aggregated disclosure. | Exports match the spec and displayed scope; escaping/BOM tests pass. |
| W4.7 | Complete geo: direct multi-select `.shp/.dbf/.prj`, missing-`.prj` CRS prompt or assume-WGS84 confirmation, geometry cap/simplify warning, unmatched diagnostic list, direct numeric property coloring, map-source registry. | No projected coordinates are treated as degrees; reload state is clear; join diagnostics are actionable. |
| W4.8 | Complete - column-level missing/placeholder/sentinel disclosure with filter, show-rows, convert and treat actions. | Chart dimensions explain missing/placeholder values; fixes use existing undoable paths; filtered bucket counts remain a follow-up. |

**Estimate:** 10–14 engineer-days.
**Exit gate:** chart selection, inspection, drill/compare, error bars, colour domains, viewport, CSV scope, and geo diagnostics all meet the UX spec.

---

### W5. ChartSpec adoption and code parity

**Status:** Complete with scoped follow-ups (2026-10-19).

**Goal:** make the declarative spec the single source for rendering, CSV, duplication, suggestions, and generated code.

**Depends on:** W3.1, W3.3, W3.6, W3.9, W4.4, W4.6.
**Blocks:** release sign-off.

| ID | Task | Acceptance |
|---|---|---|
| W5.1 | Complete - expand `ChartSpec` v2 to all currently supported fields: filters, aggregation, binning, presentation, colour domain and animation. | Spec is versioned, serializable and lossless for supported single-measure charts; multi-measure runtime remains a follow-up. |
| W5.2 | Complete - `chartSpecToConfig` compiles to the runtime config; `ChartCard.applySpecText` applies only after full validation. | Duplicate/export/render all use the same semantic fields; invalid specs leave the card untouched. |
| W5.3 | Complete - duplicate and compare rebuild through the compiled spec; CSV remains driven by the same runtime config and live results. | CSV headers/rows match the chart scope and aggregation. |
| W5.4 | Complete - card-menu JSON import with shape, version, source and column validation. | Invalid/unsupported specs explain why and never partially apply. |
| W5.5 | Complete - `chartSpecSupport` plus generated-file support notes for unsupported operations. | Unsupported operations are labelled, not silently approximated. |
| W5.6 | Complete - config round-trip, invalid import, atomic apply, support-report and golden code tests. | Golden code/config parity is covered; executable Python parity is not run in-suite. |
| W5.7 | Complete - audit confirms View pandas code carries pivot rendering separately from the data Recipe. | Recipe remains data-shaping only; a one-click pivot-only copy action remains backlog. |

**Estimate:** 6–9 engineer-days.
**Exit gate:** ChartSpec drives rendering/CSV/duplication/code; unsupported cases are explicitly reported; no parallel semantic definitions remain.

---

### W6. Multi-file loading hardening

**Goal:** complete the preflight, metadata, and sampling behavior from Workstream A.

**Depends on:** W7.1 (chip risk/action semantics for preflight warnings is optional).
**Blocks:** none.

| ID | Task | Acceptance |
|---|---|---|
| W6.1 | Add 256 KB per-file preflight: names, sizes, estimated rows/cells, common/extra/missing columns, total estimate. | Dialog appears before append; users can cancel, require identical columns, or append with alignment. |
| W6.2 | Use one combined large-load threshold and proportional sample allocation across files with a non-empty minimum. | Combined sampling is deterministic and disclosed; per-file estimates are shown. |
| W6.3 | Add per-file metadata to `DatasetMessage` and explicit `source: "multi"`; preserve per-file delimiter/encoding/number prior. | Dataset summary can report file count/rows/encoding; parsing remains atomic. |
| W6.4 | Fully exclude provenance from anomaly/pattern profiling and DQ scoring while keeping it in table/filter/export. | DQ score and anomaly counts ignore `_input_filename`; exports include it. |
| W6.5 | Tests: preflight diff, identical-column mode, proportional sampling, mixed encodings/delimiters, filename collision, atomic cancel, export scope, Recipe replay without `_input_filename`. | Unit/worker/E2E coverage for all above. |

**Estimate:** 3–5 engineer-days.
**Exit gate:** multi-file import is predictable, inspectable before commit, and does not distort data quality.

---

### W7. Shared chips and data-quality UX

**Goal:** finish the unified filter/fix chip model and chart data-issue surface.

**Depends on:** W2.1 (mismatch filter), W4.8 (chart data issues).
**Blocks:** none.

| ID | Task | Acceptance |
|---|---|---|
| W7.1 | Create `src/ui/chips.ts` plus shared suggestion metadata: kind, risk, exactness, short/full labels, effect. | Table, filters, inspector, Triage, Overview, Quality use one rendering/label source. |
| W7.2 | Collapse >2 fix chips into `Fix issues (N)`; sampled counts use `~` with explanation. | Header stays readable; every action remains reachable. |
| W7.3 | Verify all type-change entry points use the cast dialog; staged clean casts and recipe replay exceptions documented. | No silent type reinterpretation remains; cancel restores header select. |
| W7.4 | Complete - chart issue chips use Filter:/Fix: semantics, counts, `aria-pressed` and existing undo paths. | Filter and fix actions are distinguishable and mutation actions expose Undo. |
| W7.5 | Component tests: header, inspector, filter panel, Triage, Overview, Quality, chart results bar. | `aria-pressed`, apply/undo, stale disappearance, exact counts covered. |

**Estimate:** 4–6 engineer-days.
**Exit gate:** every chip clearly says whether it filters or fixes, its risk, and how to undo it.

---

### W8. Release hardening and quality gates

**Goal:** close the plan with release-grade confidence.

**Depends on:** W1–W7.

| ID | Task | Acceptance |
|---|---|---|
| W8.1 | Add E2E coverage for multi-file preflight/import, batch cast, chart builder, chart filters, drill/inspect, CSV, geo upload/join, pivot multi-field/margins, pivot heatmap, spec/code export. | Playwright flows pass in CI with no console/page errors. |
| W8.2 | Add benchmarks: `bench/clean.ts`, `bench/pivot.ts`, `bench/multifile.ts`, chart configuration benchmarks. | Budgets from the plan are enforced/documented. |
| W8.3 | Run accessibility review: keyboard paths, focus traps, aria labels, colour contrast, reduced motion. | No blocking findings; fixes tracked and closed. |
| W8.4 | CSP/manual review: no `eval`/`new Function`, no network fetch, lazy geo modules, focus traps, empty/loading/error states. | CSP unchanged; manual checklist signed off. |
| W8.5 | Update help content, README, session summary, and support/report documentation. | New surfaces discoverable; unsupported cases documented. |
| W8.6 | Final full gate: `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, benchmarks. | All green; branch ready for review/push. |

**Estimate:** 5–8 engineer-days.
**Exit gate:** original plan’s definition of done plus all 14 charting acceptance criteria are met.

---

## 6. Sequencing and milestones

| Milestone | Work packages | Outcome |
|---|---|---|
| **M0: Pivot complete** | W1 | Complete. Worker pivot, field wells, filters, date hierarchies, pivot heatmap and chart sources. |
| **Sprint 1: daily friction** | W2.1-W2.2, W3.2-W3.5, W3.10, W4.1 | Complete. Batch casts, mismatch review, chart summary/measures/sorting/warnings, inspector. |
| **Sprint 2: chart actions and trust** | W3.1, W4.2, W4.4, W4.8, W7.4 | Complete. Shared builder, drill/filter/rows actions, missing-value disclosure, shared colour scales, consistent issue actions. |
| **Sprint 3: ChartSpec adoption** | W5 | Complete. Lossless spec v2, compile/apply, import validation, support report and parity tests. |
| **Sprint 4: cleaning correctness and performance** | W2.3, W2.4, W2.5, W2.8, W2.9 | Complete. Type lattice/cast explanations, incremental clean, selective rebuild and clean benchmarks. |
| **Backlog A: remaining correctness and performance** | W2.6-W2.7, W6 | Deferred stats, progress/cancel polish, multi-file preflight and provenance hardening. |
| **Backlog C: release quality** | W7, W8 | Shared chips, E2E, benchmarks, accessibility, CSP review and docs. |

Sprints 1-4 are complete. The remaining Backlog A/C work starts after the Sprint 4 exit gate.

---
## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chart actions become a second configuration system | All actions compile to normal chart/table config; no hidden state; one undo stack and shared builder. |
| Drill/compare scope expands into a hierarchy editor | Limit Sprint 2 to next date grain and one selected breakdown; defer arbitrary drill paths. |
| Shared colour refactor changes existing chart output | Centralise calculation first, then migrate one chart kind per test; keep existing domain/legend fixtures. |
| Missing-value conversion mutates data silently | Reuse cast/clean preview, scope conversion to the selected dimension, require confirmation and expose Undo. |
| ChartSpec refactor destabilises rendering | Land spec expansion behind adapters; migrate one chart kind at a time; keep golden render/CSV tests. |
| Batch casts exhaust memory or block the UI | Sequential parse/rebuild, one request per batch, progress + cancel, benchmark budgets. |
| Time/resample parity drifts | Shared time-bucket model, pandas-generated fixtures, support-report for unsupported settings. |
| Geo files block the UI | Lazy modules, geometry caps, simplification warning, worker-safe parsing where possible. |
| E2E flakiness | Stable data fixtures, deterministic waits, no network, per-flow screenshots/artifacts. |
| Scope creep from pie/donut/advanced CI | Explicit non-goals; require user research before adding. |

---

## 8. Definition of done

Sprint 1 is complete. Sprint 2 is complete when the selected W3/W4/W7 acceptance tests pass, the Sprint 2 exit gate is green, and no selected package leaves a half-wired control.

The full remaining plan is complete when:

- all W1–W8 acceptance criteria are met;
- chart, pivot, CSV, code generation, and recipes share one aggregation/time/bin semantics;
- chart and pivot CSV/code outputs are reproducible from their declarative specs;
- batch casting and clean operations meet the performance budgets;
- multi-file preflight, provenance, and DQ behavior are covered by tests;
- no silent type changes, placeholder conversions, or unfiltered chart selections remain;
- E2E, benchmarks, accessibility, CSP/manual review, and docs pass;
- `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build` are green.
