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

Baseline test state: **729 tests passing**, typecheck and production build green.

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

## 4. 10-Day Impact Sprint

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
- W3.1 shared chart-builder structure across Add/Edit/Duplicate/Reset.
- W3.6–W3.9 are already complete; no backlog work.
- (W3.2–W3.5 and W3.10 are in the sprint.)

**W4 — remaining exploration**
- W4.2 explicit drill/filter/underlying-rows actions.
- W4.4 shared colour-scale module.
- W4.8 unknown/null category disclosure and chart data-issue actions.
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
- W7.4 chart data-issue action consistency.
- W7.5 component test coverage.

**W8 — release hardening**
- W8.1 E2E coverage.
- W8.2 benchmarks.
- W8.3 accessibility review.
- W8.4 CSP/manual review.
- W8.5 docs/help/session/support updates.
- W8.6 final full gate.

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

| ID | Task | Acceptance |
|---|---|---|
| W2.1 | **Sprint** — add `castFailures` bitset per column and a `Review mismatches` special filter. | Applying “Keep invalid” records exact failing rows; the filter shows only mismatches; counts match the dialog. |
| W2.2 | **Sprint** — add batch conversion UI: Types view/table with current/inferred/target types, multi-select, one queue, one worker request, one Undo batch. | 10-column cast performs one request/rebuild; partial failures are reported per column; cancel reverts the queue without mutation. |
| W2.3 | Add an explicit type-lattice module and use it for multi-file reconciliation, cast safety, and dialog explanations. | Lattice covers null/boolean/integer/number, date/datetime, time, duration, category, identifier, string; incompatible mixes fall back to string with reasons. |
| W2.4 | Implement incremental clean application: append one op to current values; replay only on reorder/removal. | Applying a clean op does not replay the full history; undo/reorder still exact. |
| W2.5 | Implement type-preserving rebuild for trim/case/replace and explicit-target casts; skip inference/suggestions where safe. | Benchmarks show material improvement; stats that cannot change are not recomputed. |
| W2.6 | Defer or chunk dataset-level stats with an “Updating dataset metrics…” state; patch only the affected header/visible rows. | Table rows render before health/DQ metrics complete; no avoidable main-thread task exceeds 100 ms. |
| W2.7 | Add progress, stale, cancel, and error states for long batch casts/rebuilds. | Large casts show determinate progress and can be cancelled without losing the prior dataset. |
| W2.8 | Add `bench/clean.ts` and latency guards: 100k one-column case, 300k case, 100k 10-column batch, coerce/keep. | Budgets: p95 ≤250 ms, ≤600 ms, ≤2 s respectively, with no avoidable >100 ms main-thread task. |
| W2.9 | Tests for cast policies, failure filter, batch apply/cancel/undo, type lattice, recipe parity, and performance guards. | All new paths covered; existing cast dialog/recipe tests remain green. |

**Estimate:** 8–12 engineer-days.
**Exit gate:** batch casts are one request/one rebuild/one undo; mismatch review is exact; clean performance budgets pass.

---

### W3. Chart builder and aggregation depth

**Goal:** finish the shared builder and the aggregation/grouping controls required by the plan.

**Depends on:** W1.1 (worker aggregation interface remains shared); W5.1 (spec shape should be agreed early).
**Blocks:** W4, W5.

| ID | Task | Acceptance |
|---|---|---|
| W3.1 | Extract one shared chart-builder structure used by Add chart, Edit chart, Duplicate, and Reset to suggested configuration. | Same validation, summary, and field controls across all entry points; chart config remains out of the data Recipe. |
| W3.2 | **Sprint** — add an always-visible chart summary sentence: measure, aggregation, grouping, breakdown, filters, grain/calculation, source. | Summary updates live and names every semantic choice. |
| W3.3 | **Sprint** — expand measure menu: stddev, variance, custom percentile, percent of rows, percent of total, boolean true/false/percentage/missing, date earliest/latest. | Only valid operations appear per type; null handling and denominator are documented in tooltips. |
| W3.4 | **Sprint** — add non-additive/unit warnings when summing rate/ratio/percentage/index/temperature-like fields. | Warning states why summing may be misleading and offers mean/median alternatives. |
| W3.5 | **Sprint** — add user-facing sorting: value asc/desc, label, chronological time, numeric-bin order, deterministic tie-break. | Sorting updates without re-aggregation; time/numeric ordering is correct. |
| W3.6 | Complete time controls in charts: visible default grain, every-N, 15/30-minute where supported, week start, fiscal calendar, date parts, timezone selection and summary. | Same time-bucket model as Pivot; active timezone and grain visible in the summary. |
| W3.7 | Complete gap/missing-period controls: drop/zero/carry/interpolate where valid, observed-vs-filled styling, partial-period warning. | Filled periods are visually distinct; absent periods are never silently zero without an explicit policy. |
| W3.8 | Complete numeric-bin controls: equal width, quantile/equal frequency, custom edges, boundary ownership, under/overflow counts, numeric sorting. | Chart and Pivot use the same bin definition; out-of-range values are reported. |
| W3.9 | Complete calculations: rolling sum, configurable window, index-to-100/base period, period-over-period absolute comparison, weighted average, reference/target values. | Calculation summary shows ordering/window/denominator/missing behavior; chart data remains non-destructive. |
| W3.10 | **Sprint** — add category/series controls: default 10, visible limit, Other bucket, “Show all”, 12-series cap, high-cardinality warning. | Limit/Other/cap visible in summary, CSV, and spec; deterministic ordering. |

**Estimate:** 10–14 engineer-days.
**Exit gate:** a user can build, inspect, and reproduce an aggregated chart without implicit defaults; aggregation, grain, bins, sorting, calculation, limits, and Other are all explicit.

---

### W4. Chart exploration, presentation, and geo completion

**Goal:** finish the inspect/drill/present interactions and the remaining geo/presentation requirements.

**Depends on:** W3.2 (summary), W3.9 (calculations), W5.1 (spec for viewport/export).
**Blocks:** W9.

| ID | Task | Acceptance |
|---|---|---|
| W4.1 | **Sprint** — add a point/bar inspector: label, measure/aggregation, value, row count, non-null count, active table/chart filters, grain/bin, sampled/full disclosure. | Tooltip/inspector stays consistent for aggregated and raw charts. |
| W4.2 | Add explicit actions: filter table to group, view underlying rows, drill to finer grain, break down by another field, compare group/period, duplicate, config undo, reset to suggested. | Actions state their scope; chart selection never silently filters the table. |
| W4.3 | Complete Barplot: time X, error bars (SD/SE/95% normal), order controls, hue order/cap, orientation, weighted measure, negative-value baseline. | Error method disclosed; hover shows n/estimate/error; legacy bar+value configs migrate safely. |
| W4.4 | Extract a shared colour-scale module: numeric scatter/map, map heat, heatmap, density, correlation; `colorMin`, `colorMax`, `colorCenter`; manual/auto legend. | One scale path; domain never clips data; diverging centre behavior documented and tested. |
| W4.5 | Complete viewport coverage: Barplot category + Y zoom, pivot heatmap windows, generic reset/controller, card-menu “Reset zoom & pan”. | Reset disabled at default; export can use current or full domain. |
| W4.6 | Complete chart CSV: visible-window option, formula-injection escaping, per-kind schemas, sampled/aggregated disclosure. | Exports match the spec and displayed scope; escaping/BOM tests pass. |
| W4.7 | Complete geo: direct multi-select `.shp/.dbf/.prj`, missing-`.prj` CRS prompt or assume-WGS84 confirmation, geometry cap/simplify warning, unmatched diagnostic list, direct numeric property coloring, map-source registry. | No projected coordinates are treated as degrees; reload state is clear; join diagnostics are actionable. |
| W4.8 | Add unknown/null category disclosure and chart data-issue actions: data-issue count, convert placeholders scoped to chart dimensions, treat/keep actions. | Chart grouping explains `(empty)` and placeholder values; actions preview, undo, and link to Clean. |

**Estimate:** 10–14 engineer-days.
**Exit gate:** chart selection, inspection, drill/compare, error bars, colour domains, viewport, CSV scope, and geo diagnostics all meet the UX spec.

---

### W5. ChartSpec adoption and code parity

**Goal:** make the declarative spec the single source for rendering, CSV, duplication, suggestions, and generated code.

**Depends on:** W3.1, W3.3, W3.6, W3.9, W4.4, W4.6.
**Blocks:** release sign-off.

| ID | Task | Acceptance |
|---|---|---|
| W5.1 | Expand `ChartSpec` to multiple measures, per-measure aggregation, grain/bin, breakdowns, filters, limits/Other/sort, null/missing policy, calculations, display options, viewport, sampling, and geo source ID. | Spec is versioned, serializable, and lossless for supported charts. |
| W5.2 | Make ChartCard rendering read the spec (or a compiled view of it) instead of ad-hoc config branches. | Duplicate/export/render all use the same semantic fields. |
| W5.3 | Make chart CSV and duplication use the spec. | CSV headers/rows match the spec scope and aggregation. |
| W5.4 | Add ChartSpec import/validation and “apply spec” flow for supported versions. | Invalid/unsupported specs explain why and never partially apply. |
| W5.5 | Complete pandas/Polars code for all supported spec features; emit an explicit support report for unsupported operations. | Golden tests cover code strings and supported parity; sampled/geo/approximate CI cases are labelled. |
| W5.6 | Add golden result-parity tests where feasible (aggregation, nulls, time grain, bins, sorting, percentages, margins). | Code and in-app results agree on fixtures. |
| W5.7 | Keep pivots out of the data Recipe; add separate pivot code actions. | Recipe remains data-shaping only. |

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
| W7.4 | Make chart data-issue/placeholder actions consistent with shared chip risk/undo rules. | Preview and Undo available where required. |
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
| **Sprint: daily friction** | W2.1-W2.2, W3.2-W3.5, W3.10, W4.1 | Batch casts, mismatch review, chart summary/measures/sorting/warnings, inspector. |
| **Backlog A: correctness and performance** | W2.3-W2.9, W6 | Type lattice, incremental rebuilds, deferred stats, multi-file hardening, benchmarks. |
| **Backlog B: chart architecture** | W3.1, W4.2, W4.4, W4.8, W5 | Shared builder, drill actions, shared colour scale, null disclosure, ChartSpec adoption. |
| **Backlog C: release quality** | W7, W8 | Shared chips, E2E, benchmarks, accessibility, CSP review and docs. |

The sprint is intentionally single-threaded enough to finish in 10 engineer-days. Backlog A/B/C starts only after the sprint exit gate passes.

---
## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| ChartSpec refactor destabilises rendering | Land spec expansion behind adapters; migrate one chart kind at a time; keep golden render/CSV tests. |
| Batch casts exhaust memory or block the UI | Sequential parse/rebuild, one request per batch, progress + cancel, benchmark budgets. |
| Time/resample parity drifts | Shared time-bucket model, pandas-generated fixtures, support-report for unsupported settings. |
| Geo files block the UI | Lazy modules, geometry caps, simplification warning, worker-safe parsing where possible. |
| E2E flakiness | Stable data fixtures, deterministic waits, no network, per-flow screenshots/artifacts. |
| Scope creep from pie/donut/advanced CI | Explicit non-goals; require user research before adding. |

---

## 8. Definition of done

The 10-day sprint is complete when the selected W2/W3/W4 acceptance tests pass, the sprint exit gate is green, and no selected package leaves a half-wired control.

The full remaining plan is complete when:

- all W1–W8 acceptance criteria are met;
- chart, pivot, CSV, code generation, and recipes share one aggregation/time/bin semantics;
- chart and pivot CSV/code outputs are reproducible from their declarative specs;
- batch casting and clean operations meet the performance budgets;
- multi-file preflight, provenance, and DQ behavior are covered by tests;
- no silent type changes, placeholder conversions, or unfiltered chart selections remain;
- E2E, benchmarks, accessibility, CSP/manual review, and docs pass;
- `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build` are green.
