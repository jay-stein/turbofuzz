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
- ChartSpec JSON export and pandas/Polars code downloads for supported chart kinds.

Baseline test state: **692 tests passing**, typecheck and production build green.

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

## 4. Workstreams

### W1. Pivot completion

**Goal:** replace the remaining client-side/aggregate-derived pivot behavior with a first-class worker pivot model and complete the pandas-style Pivot View.

**Depends on:** none; can start immediately.  
**Blocks:** W5 (pivot recipe parity), W9 (pivot benchmarks).

| ID | Task | Acceptance |
|---|---|---|
| W1.1 | Add `PivotRequest`/`PivotMessage` and `computePivot` in the worker; reuse `computeAggregate` internally for base, row-margin, column-margin, and grand-total passes. | Worker returns matrix cells, labels, times, measure names, margins, partial flags, truncation, and a stable level schema. No large long-form payload reaches the UI. |
| W1.2 | Add `PivotDef` with ordered `values`, `index` (0–3), `columns` (0–3), options, and time settings; compile it to worker requests. | At least one value and at least one index/column field is enforced; duplicate index/column use is either blocked or explicitly warned. |
| W1.3 | Replace the layout-only pivot builder with Values / Index / Columns field wells: add/remove, up/down reorder, “Add all numeric”, value aggregation chips. | Up to 3 index and 3 column fields render correctly; aggregation changes are visible per value. |
| W1.4 | Support multiple values and multiple aggregations simultaneously. Column headers use explicit internal level names: values → aggfunc → column fields. | Two values × two aggregations × two column fields renders a stable multi-level header; CSV and generated code use the same level order. |
| W1.5 | Implement the safe custom aggregate mini-language: `lambda x: ...` over mean/median/sum/min/max/count/size/nunique/std/var/first/last/quantile, arithmetic, and numeric literals. | Parse errors and sample results are shown before apply; no `eval`/`new Function`; pandas output preserves the lambda text. |
| W1.6 | Complete pivot options: sort index/columns, source order, `margins_name`, pandas-compatible `dropna`, fill behavior, and validation against existing labels. | Options are visible in the pivot summary; margins still come from raw rows; behaviors have help text and tests. |
| W1.7 | Complete time/resample: every-N frequency, closed label/origin/offset, per-combination gap fill with cartesian cap, multiple-time-field warning, timezone/fiscal/week controls. | Sole-time-index resample matches pandas fixtures; multi-dimension gap fill is capped and disclosed; parity fixtures cover DST and fiscal periods. |
| W1.8 | Complete named pivots: unique-name validation, duplicate action, stable IDs, remap by column name across transforms, reset on new dataset, refresh bound charts on definition edit. | Renames preserve IDs; transforms remap columns; bound charts refetch after edits; missing columns produce an orphan/reload state. |
| W1.9 | Complete pivot CSV: flat default, optional multi-row headers, margins, fill, measure/agg names, formula escaping, BOM/CRLF, and large-output guard. | Exports match the displayed matrix; >250k-cell outputs warn or stream; formula-like cells are escaped. |
| W1.10 | Complete pivot code generation: real `pivot_table` for pandas with values/index/columns/aggfunc/fill/margins/dropna/sort/time settings; Polars equivalent or explicit support note; separate “Copy pandas pivot code”. | Golden code tests cover multi-value/multi-agg/margins/fill/dropna/time; unsupported time/agg cases are listed, not silently approximated. |
| W1.11 | Add a dedicated pivot heatmap chart kind with index/column level selectors and shared colour scale; verify line/bar/KPI bindings. | Pivot heatmap renders, exports CSV, and reacts to pivot definition/filter changes. |

**Estimate:** 10–14 engineer-days.  
**Exit gate:** pivot matrix, margins, multi-level headers, resample, named artifacts, CSV, code, and pivot heatmap all work without client-side matrix assembly.

---

### W2. Casting, mismatch review, and table performance

**Goal:** finish the cast workflow and remove avoidable rebuilds from common clean/cast operations.

**Depends on:** none.  
**Blocks:** W7 (chip risk semantics), W9 (performance gates).

| ID | Task | Acceptance |
|---|---|---|
| W2.1 | Add `castFailures` bitset per column and a `Review mismatches` special filter. | Applying “Keep invalid” records exact failing rows; the filter shows only mismatches; counts match the dialog. |
| W2.2 | Add batch conversion UI: Types view/table with current/inferred/target types, multi-select, one queue, one worker request, one Undo batch. | 10-column cast performs one request/rebuild; partial failures are reported per column; cancel reverts the queue without mutation. |
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
| W3.2 | Add an always-visible chart summary sentence: measure, aggregation, grouping, breakdown, filters, grain/calculation, source. | Summary updates live and names every semantic choice. |
| W3.3 | Expand measure menu: stddev, variance, custom percentile, percent of rows, percent of total, boolean true/false/percentage/missing, date earliest/latest. | Only valid operations appear per type; null handling and denominator are documented in tooltips. |
| W3.4 | Add non-additive/unit warnings when summing rate/ratio/percentage/index/temperature-like fields. | Warning states why summing may be misleading and offers mean/median alternatives. |
| W3.5 | Add user-facing sorting: value asc/desc, label, chronological time, numeric-bin order, deterministic tie-break. | Sorting updates without re-aggregation; time/numeric ordering is correct. |
| W3.6 | Complete time controls in charts: visible default grain, every-N, 15/30-minute where supported, week start, fiscal calendar, date parts, timezone selection and summary. | Same time-bucket model as Pivot; active timezone and grain visible in the summary. |
| W3.7 | Complete gap/missing-period controls: drop/zero/carry/interpolate where valid, observed-vs-filled styling, partial-period warning. | Filled periods are visually distinct; absent periods are never silently zero without an explicit policy. |
| W3.8 | Complete numeric-bin controls: equal width, quantile/equal frequency, custom edges, boundary ownership, under/overflow counts, numeric sorting. | Chart and Pivot use the same bin definition; out-of-range values are reported. |
| W3.9 | Complete calculations: rolling sum, configurable window, index-to-100/base period, period-over-period absolute comparison, weighted average, reference/target values. | Calculation summary shows ordering/window/denominator/missing behavior; chart data remains non-destructive. |
| W3.10 | Add category/series controls: default 10, visible limit, Other bucket, “Show all”, 12-series cap, high-cardinality warning. | Limit/Other/cap visible in summary, CSV, and spec; deterministic ordering. |

**Estimate:** 10–14 engineer-days.  
**Exit gate:** a user can build, inspect, and reproduce an aggregated chart without implicit defaults; aggregation, grain, bins, sorting, calculation, limits, and Other are all explicit.

---

### W4. Chart exploration, presentation, and geo completion

**Goal:** finish the inspect/drill/present interactions and the remaining geo/presentation requirements.

**Depends on:** W3.2 (summary), W3.9 (calculations), W5.1 (spec for viewport/export).  
**Blocks:** W9.

| ID | Task | Acceptance |
|---|---|---|
| W4.1 | Add a point/bar inspector: label, measure/aggregation, value, row count, non-null count, active table/chart filters, grain/bin, sampled/full disclosure. | Tooltip/inspector stays consistent for aggregated and raw charts. |
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

## 5. Sequencing and milestones

| Milestone | Work packages | Outcome |
|---|---|---|
| **M1: Truth and performance** | W2, W6 | Batch casts, mismatch review, multi-file preflight, faster clean path. |
| **M2: Chart semantics** | W3, W5.1–W5.3 | Shared builder, full aggregation/time/bin/sort/calculation controls, spec-driven rendering/CSV. |
| **M3: Exploration and presentation** | W4, W5.4–W5.6 | Inspector/drill/compare, Barplot depth, colour/viewport/CSV polish, geo completion, spec import/code parity. |
| **M4: Pivot completion** | W1 | Worker pivot, field wells, multi-value/agg, resample, named pivots, pivot heatmap/code. |
| **M5: Chips and release** | W7, W8 | Shared chip model, E2E, benchmarks, accessibility, CSP/manual review. |

W1 and W2 can run in parallel after W3.1/W3.2 interface decisions. W4 depends on W3. W5 depends on W3/W4. W6/W7 can run alongside. W8 closes the release.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| ChartSpec refactor destabilises rendering | Land spec expansion behind adapters; migrate one chart kind at a time; keep golden render/CSV tests. |
| Pivot worker work becomes an XL rewrite | Implement `computePivot` on top of `computeAggregate`; keep the current matrix renderer until parity tests pass. |
| Batch casts exhaust memory or block the UI | Sequential parse/rebuild, one request per batch, progress + cancel, benchmark budgets. |
| Time/resample parity drifts | Shared time-bucket model, pandas-generated fixtures, support-report for unsupported settings. |
| Geo files block the UI | Lazy modules, geometry caps, simplification warning, worker-safe parsing where possible. |
| E2E flakiness | Stable data fixtures, deterministic waits, no network, per-flow screenshots/artifacts. |
| Scope creep from pie/donut/advanced CI | Explicit non-goals; require user research before adding. |

---

## 7. Definition of done

The remaining plan is complete when:

- all W1–W8 acceptance criteria are met;
- chart, pivot, CSV, code generation, and recipes share one aggregation/time/bin semantics;
- chart and pivot CSV/code outputs are reproducible from their declarative specs;
- batch casting and clean operations meet the performance budgets;
- multi-file preflight, provenance, and DQ behavior are covered by tests;
- no silent type changes, placeholder conversions, or unfiltered chart selections remain;
- E2E, benchmarks, accessibility, CSP/manual review, and docs pass;
- `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build` are green.
