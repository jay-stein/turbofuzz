<!-- markdownlint-disable-file -->

# Task Research Notes: Snowflake Chart UX — On-the-Fly & Temporal Aggregations for TurboFuzz

> Status: **Folded into `plan-data-quality.md` as §7 (Track B), 2026-10-16.** This document remains the detailed evidence base.

## Research Executed

### File Analysis

- `src/data/aggregate.ts` (1,692 lines)
  - The existing **aggregation engine** is already Snowflake-grade and then some: `TimeGrain = minute|hour|day|week|month|quarter|year`; date parts (dow/hour/month/dom/week); numeric bins (equal width, N quantiles, explicit edges); cohorts ("first period per entity") and "periods since"; `weekStart`, `fiscalStartMonth`, timezone-aware bucketing; aggregates `count, distinct, sum, mean, min, max, median, stddev, first, last, mode, expr, pN`; post-ops `rolling, cumulative, diff, pctChange, pctTotal, rank, yoy`; weighted and conditional measures; `ViewDef` with fill (none/zero/carry), sort/limit, `respectFilters`, partial-period handling and pivot.
- `src/ui/chart-card.ts` (~6k lines)
  - Chart cards have a **source selector: filtered table or a saved aggregate view**; view-bound cards draw the view's aggregate (line if first dimension is time, bars otherwise).
  - Ad-hoc measures exist only on specific card types: **bubble** (rows per cell or sum/mean/min/max of a numeric column), **treemap** (sum). Time series bucket counts are auto-chosen ("human periods"), and the **animation** feature has a grain dropdown (hour→year) with per-bucket frames.
- `src/worker/protocol.ts` + `src/worker/search.worker.ts`
  - Existing worker requests: `getChartBins`, `getChartSeries`, `getBoxStats`, `getCrosstab`, `getCorrelation`, plus the `aggregate` request for ViewDef evaluation. Typed-array payloads, generation-guarded.
- `src/data/chart-frames.ts`, `chart-bins.ts`, `chart-series.ts`, `chart-stats.ts`
  - Frame/bucket plumbing for animated and static charts; bubble grids with per-cell measures.
- `src/ui/help-content.ts` (animation copy) — confirms animation granularity defaults "from the data's span".

### Code Search Results

- `getChart|chartBins|chartSeries|aggregate` across `src/`
  - 100+ matches: the aggregate engine is wired to chart cards only via (a) saved views, (b) bubble/treemap one-off measures, (c) animation frames. **No general in-card "measure + aggregation + bucket" inspector exists**; plain time-series bins are auto and not user-switchable.
- `bucket|grain|TimeGrain|measure` in `chart-card.ts`
  - 92 matches: grain usage concentrated in animation (`animationGrain`), `defaultGrainFor`, and preferred bucket counts — not in a general chart-aggregation UI.

### External Research

- #fetch:https://docs.snowflake.com/en/user-guide/ui-snowsight-visualizations
  - **Chart types**: bar, line, scatterplots, heat grids, **scorecards**. One chart at a time per query; Snowsight **auto-generates a chart** from query results; charts update automatically when their columns are available and flag missing columns.
  - **Data section (inspector)**: add/remove columns, swap the column used, and change how a column is represented — example verbatim: "change the bucketing for a time column from day to minutes".
  - **Aggregate & bucket without modifying the query** ("Charts simplify grouping numbers, dates, and timestamps of more or less continuous values into various *buckets*… Without modifying your query, you can easily select a different bucket of time (e.g. weekly or monthly data) in the inspector panel").
  - Bucket rules: **date, week, month, year for date columns** (plus minutes in the example); **numeric columns bucket by integer values**.
  - Aggregation functions: **average, count, minimum, maximum, median, mode, sum**.
  - Example worksheet SQL shows the parameterised variant: `WHERE O_ORDERDATE = :daterange ... GROUP BY :datebucket(O_ORDERDATE), ...` (filters/bucket controls bound into SQL as worksheet parameters).
- #fetch:https://docs.snowflake.com/en/user-guide/ui-snowsight-dashboards
  - Dashboards are **flexible collections of chart/table tiles**; custom **dashboard filters** usable in the queries behind tiles; Run-all; per-tile menu (view chart, edit query, duplicate, unplace, delete); charts open back into a worksheet for editing ("Return to dashboard").
- #fetch:https://docs.snowflake.com/en/user-guide/ui-snowsight-query
  - **Automatic contextual statistics** (inspector) for selections and columns: filled/empty meters with **invalid-row counts** for some types (email/JSON); **histograms** for date/time/numeric; **frequency distributions** for categorical; **email-domain distributions**; **JSON key distributions**. Interactions: click a bar or drag across the histogram to filter, click value labels to type exact values.
  - Non-costly presentation transforms: thousands separators, percentage, decimal precision, date formatting (contrast with sort/other transforms that re-query).
- #fetch:https://docs.snowflake.com/en/user-guide/ui-snowsight/llms.txt (Snowsight section index) and https://docs.snowflake.com/llms.txt
  - Wide-net context: the visualization surface spans worksheets, dashboards, **Snowflake Notebooks visualizations** (see "Visualize data in Snowflake Notebooks"), Streamlit in Snowflake apps, and Snowsight templates. Charting in notebooks/Streamlit is library-based (Altair/Plotly/Streamlit charts) — the aggregation *inspector* magic is Snowsight's.
- #fetch:https://docs.snowflake.com/en/user-guide/ui-snowsight-worksheets.md (checked for the filter-parameter docs)
  - Filters/parameter docs live with the query/visualization pages; the `:daterange`/`:datebucket` pattern above is the verified reference. Note: Legacy Worksheets/Dashboards are being retired June 22, 2026 (Workspaces is the successor) — the *chart aggregation model* persists; watch for renames in future docs.

### Project Conventions

- Standards referenced: this research stream (`.copilot-tracking/research/20261016-ataccama-vs-open-source-dq-checks-research.md`) and the new `plan-data-quality.md`; latency budgets and no-libraries rules from `next_steps.md`; chart patterns from `src/ui/chart-card.ts`.

## Key Discoveries

### Project Structure

TurboFuzz's chart pipeline is: **worker requests → typed-array payloads → canvas renderers**, with the aggregate engine (`aggregate.ts`) feeding saved views, animation frames and one-off measures (bubble/treemap). The engine is a superset of Snowsight's aggregation surface (18+ aggregates incl. mode/median/stddev/percentiles/distinct/first-last/expr, post-ops incl. YoY, cohort and fiscal calendars, timezone-aware buckets). The missing piece is not *capability* — it is the **inspector**: Snowsight's "pick a column → switch bucket day→minute → switch aggregate → chart redraws" loop, available on every chart.

### Implementation Patterns

- ViewDef is the right abstraction to reuse: a card-level "quick aggregate" can compile to an implicit `ViewDef` (dimensions + measures + fill + limit) and go through the existing `aggregate` worker request, gaining caching and `respectFilters` semantics for free.
- Worker responses are generation-guarded and cache-friendly (`HistogramCache` precedent, `filtersSignature`); a chart-aggregate cache can key on `(generation, filtersSignature, specHash)`.
- The animation grain dropdown (`hour→year` options in `chart-card.ts`) is the exact UI precedent for a general **bucket switcher**.

### Complete Examples

Snowsight's parameterised bucket pattern (source: #fetch:https://docs.snowflake.com/en/user-guide/ui-snowsight-visualizations):

```sql
SELECT
  COUNT(O_ORDERDATE) as orders, O_ORDERDATE as date
FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.ORDERS
WHERE O_ORDERDATE = :daterange
GROUP BY :datebucket(O_ORDERDATE), O_ORDERDATE
ORDER BY O_ORDERDATE
LIMIT 10;
```

TurboFuzz already expresses the same semantics offline via `ViewDef` (source: `src/data/aggregate.ts`):

```ts
export interface ViewDef {
  id: string;
  name: string;
  dimensions: DimensionSpec[];       // raw value | time bucket | date part | bin | cohort | since
  measures: MeasureSpec[];           // column/null + agg + expr + weight + where + post[]
  fill: "none" | "zero" | "carry";
  sort: { key: string; dir: "asc" | "desc" };
  limit: number;
  respectFilters: boolean;
  partial?: "show" | "exclude";
  pivot?: number;
}
```

### API and Schema Documentation

**Snowsight chart aggregation model (verified):**
- Auto-generated chart per result set; one chart type at a time; live update when columns exist; missing-column flags.
- Inspector "Data" section: bind/replace columns; per-column representation; **bucketing** for time (day→minutes example; date/week/month/year listed) and **integer bucketing** for numerics — *without modifying the query*.
- Aggregations offered: average, count, minimum, maximum, median, mode, sum.
- Appearance section styles per chart type (e.g. heat grid labels/colour-by).
- Scorecards exist as a chart type (KPI tile); no deeper public doc section found — treat ours as a design opportunity rather than a clone.
- Contextual statistics: filled/empty meters (+ invalid rows for some types), histograms (interactive range select + typed exact values), frequency distributions, email-domain distributions, JSON key distributions — all over up to ~1M cached rows.

**Mapping table (Snowsight → TurboFuzz):**

| Snowsight capability | TurboFuzz today | Verdict |
|---|---|---|
| Bucket a time column day→minute/week/month without re-querying | Engine supports minute→year, tz, fiscal, week start; UI exposes grain only for animation | **Strong gap (UI only)** — add bucket switcher |
| Aggregation function menu (avg/count/min/max/median/mode/sum) | Engine has all of these + stddev/pN/distinct/first/last/expr | **Gap (UI only)** — expose per-measure menu |
| Numeric bucketing by integer values | Bins (width / n quantiles / edges) | Ahead |
| Auto-generate a chart from results | "+ Add chart" gallery; defaults are type-driven | **Small gap** — add a suggestion heuristic |
| One chart per query; dashboard of tiles | Multi-card grid with 1–4 per row, layout persisted | Ahead |
| Dashboard custom filters | Global live sidebar filters drive all charts | Parity |
| Scorecards (KPI tiles) | Info tiles exist (dataset facts); no measure-backed KPI card | **Opportunity** — KPI card type w/ comparisons |
| Contextual stats w/ invalid-row meter, email-domain distribution, JSON key distribution | Histograms, top values, QA chips, text profiles | Mostly parity; email-domain + JSON-key ideas for later |
| Interactive histogram (drag-select, typed exact values) | Range sliders + histogram backdrop + filter panel | Minor polish subset |
| Filter parameters (`:daterange`, `:datebucket`) that re-run SQL | Not applicable offline (no SQL re-run) — client-side bucketing is the equivalent | N/A by design |
| Cross-chart interactions | Click-to-filter planned (roadmap Phase 3) | Watch, not Snowflake-documented |

### Configuration Examples

Sketch of the card-level "quick aggregate" spec (compiles to `ViewDef` under the hood):

```ts
interface QuickAggregate {
  dimension: { column: number; bucket?: TimeGrain | "auto" | { bin: BinSpec } };
  measures: { column: number | null; agg: Aggregate; post?: PostOp[] }[];
  splitBy?: number;              // optional series column
  fill?: "none" | "zero" | "carry";
  respectFilters: boolean;
}
```

### Technical Requirements

- No new dependencies: the aggregate engine, worker protocol and canvas renderers already exist; the work is a UI inspector + one request path + caching.
- Latency: aggregation over `sortedIds` is the same O(rows) walk the engine already does for views; target < 50 ms at 100k rows for a single-dimension/one-measure spec (measure against `bench/`).
- Cache keying: `(dataGeneration, filtersSignature, specHash)` — reuse the `HistogramCache` invalidation pattern (clear on `engine.invalidate()`).
- Auto-grain: pick from data span like animation does (defaults "from the data's span"); explicit override wins; label ticks with the same nice-period logic (`preferredBucketCount`).
- Must not disturb the keystroke path: inspector changes request one aggregation; steering data flows through the existing worker message pipeline with typed arrays.

## Recommended Approach

**Add a Snowsight-style "quick aggregate" inspector to every chart card, backed by the existing ViewDef engine — plus a bucket switcher, a KPI/scorecard card, and auto-chart suggestions.** This is UI surfacing of capabilities TurboFuzz already owns; no new engine, no new dependencies, no server.

Workstream, in priority order:
1. **A1 — In-card aggregation inspector** (the core "magic"): on a chart card, pick dimension (any column, with optional time bucket/numeric bin), one or more measures (`count(*)` or column × aggregate), optional split-by series. Compiles to an implicit `ViewDef` evaluated by the existing `aggregate` worker request with the active filters; results render through the existing line/bar renderers (line when the first dimension is a time bucket; bars otherwise). Persisted per card like today's chart settings.
2. **A2 — Bucket switcher**: `Auto · Minute · Hour · Day · Week · Month · Quarter · Year` on any time dimension (the animation grain dropdown is the UI precedent); "Auto" keeps the current human-period logic. Also expose numeric binning (width / quantile / edges) in the same control.
3. **A3 — KPI / scorecard card type**: single aggregate value (e.g. `sum(revenue)`, `median(age)`, `distinct(customers)`) with optional period comparison using existing post-ops (`diff`, `pctChange`, `yoy`, `rolling`) and a sparkline from the aggregate series. This is Snowsight's scorecard, but computable offline.
4. **A4 — Auto-chart suggestion**: when a card is added or a column selection changes, propose chart type + bindings from column types (date+numeric → line; category+numeric → bars; numeric+numeric → scatter; single measure → KPI), with one-click accept. Mirrors "Snowsight automatically generates a chart".
5. **A5 (later polish)** — statistics inspector parity: invalid-row meter in the profile cards (type-conflict counts already exist), email-domain split for detected email columns, typed exact-value entry on histogram tooltips. Optional, small.

Deliberately rejected: Streamlit/Notebooks charting (library-based, Python — violates the no-dependency/offline model); `:daterange`/`:datebucket` SQL parameters (no SQL layer offline — the client-side equivalent is exactly A1+A2); dashboard cross-filter plumbing beyond what the global filter sidebar already provides.

## Implementation Guidance

- **Objectives**: make every chart card an ad-hoc aggregate explorer (dimension × measure × aggregation × bucket), make time granularity a first-class live control, add a KPI card, and suggest sensible charts — all inside the existing worker/canvas architecture and latency budget.
- **Key Tasks**:
  1. `QuickAggregate` model → compile to `ViewDef`; add `requestQuickAggregate(spec)` client method (reuse the `aggregate` worker path; include `sortedIds`/filter signature and generation).
  2. Card inspector UI: dimension/measure/split/bucket controls per card type; disable/ignore options that don't apply (e.g. heat grid); persist in card config; keep "Source: filtered table vs saved view" selector intact (quick-aggregate is a third mode or a degenerate view).
  3. Bucket switcher component shared with animation (extract the existing dropdown); label ticks via the existing nice-period logic.
  4. KPI card renderer + comparison post-op selection; small sparkline reuse.
  5. Suggestion heuristic on card add / column change; one-click "Use this chart".
  6. Caching: `(generation, filtersSignature, specHash)` cache cleared with `engine.invalidate()`; generation guards on responses.
  7. Tests: ViewDef compilation of card specs; bucket-edge correctness (tz, week start, fiscal, partial periods); KPI comparison math; cache invalidation. Bench: quick aggregate at 100k/500k (single dim/measure) within budget.
- **Dependencies**: none new. Engine `aggregate.ts`, worker protocol, `chart-*` renderers, animation grain UI, `HistogramCache` invalidation pattern.
- **Success Criteria**: any card can switch measure/aggregation/bucket live with results re-rendered from the worker in < 50 ms at 100k rows; grain changes need no data reload; KPI card computes comparisons; suggestions match column types; no regressions in existing view-bound/animated cards; `npm test`, `npm run typecheck`, `npm run bench:quick` green.
