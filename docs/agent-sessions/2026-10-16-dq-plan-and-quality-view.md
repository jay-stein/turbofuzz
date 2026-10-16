# 2026-10-16 — Data Quality Plan, Quality View & Chart Aggregations

## Goal

Research how Ataccama ONE and the open-source DQ ecosystem (Great Expectations, Soda, dbt, Deequ) handle data quality checks and scoring, then research Snowflake Snowsight's on-the-fly and temporal chart aggregations. Turn both into a well-organised plan for TurboFuzz: p0/p1 check families, a weighted Overall Quality score with an Ataccama-style N.A.-excluded breakdown, a dedicated Data Quality view with full issue transparency, and a Snowsight-style chart aggregation track. Commit the work.

## Files changed

- `plan-data-quality.md` *(new)* — the plan. Order: goal & tracks → scope → score model → UX (score tile, **dedicated Quality view** with wireframe, dimension cards, checks panel, column × dimension matrix, calculation tree, failing previews) → checks (P0/P1) → reports & export → Track B chart aggregations → milestones (M1–M4, C1–C3) → budgets → tests → decisions → risks → open questions.
- `.copilot-tracking/research/20261016-ataccama-vs-open-source-dq-checks-research.md` *(new)* — Ataccama rule taxonomy (detection vs DQ evaluation rules; Validity/Uniqueness/Completeness/Accuracy/Timeliness dimensions with Pass/Fail/N.A. effects), verified Overall Quality formula (record-based, N.A.-excluded, never above lowest dimension), Data Trust Index; open-source check catalogs: Great Expectations (63 core expectations, Apache-2.0, now under Fivetran), SodaCL (metrics + check families; Soda Core is open-core with a custom licence), dbt data tests (unique/not_null/accepted_values/relationships, Apache-2.0), Deequ DQDL (full rule list, Apache-2.0). Includes the gap matrix against TurboFuzz's existing checks.
- `.copilot-tracking/research/20261016-snowflake-chart-aggregations-research.md` *(new)* — Snowsight chart model: bucket switching (day→minutes; date/week/month/year; integer buckets for numerics) and aggregation functions (avg/count/min/max/median/mode/sum) applied client-side without modifying the query; dashboards; contextual statistics inspector (filled/empty meters with invalid rows, histograms, frequency/email-domain/JSON-key distributions); `:daterange`/`:datebucket` parameters. Key finding: `src/data/aggregate.ts` is already a superset of Snowsight's aggregation surface — the gap is UI surfacing. Folded into the plan as Track B (§7).
- `docs/agent-sessions/2026-10-16-dq-plan-and-quality-view.md` *(new)* — this summary.

## Commands executed

- Research fetches (Ataccama docs + product pages, Soda/GX/dbt/Deequ docs and GitHub APIs, Snowflake docs incl. `llms.txt` indexes), codebase greps/reads (`findings.ts`, `anomalies.ts`, `aggregate.ts`, `chart-card.ts`, worker protocol).
- `npm run typecheck` — pass (docs-only change; no test run needed).
- `git status --short`, `git log --oneline -5`, `git branch --show-current`.
- `git add` + `git commit` — see below.

## Important decisions

- **Score**: weighted mean of applicable dimension scores (user decision); N.A. excluded from numerator and denominator (Ataccama semantics); advisory findings (outliers, near-duplicates, unit mix, text) never score; Accuracy shown as "No reference available" (N.A.).
- **Transparency**: dedicated `Quality` lens in the View stage (Table · Chart · Quality) replaces the earlier drawer concept — dimension cards, checks list with failing previews, column × dimension matrix, "Why is this my score?" tree; every number drills to counts and rows.
- **Track B**: in-card quick aggregate compiles to an implicit `ViewDef` (no new engine); bucket switcher mirrors Snowsight's day→minute behaviour; KPI card uses existing post-ops; Python/Streamlit charting rejected.
- **Defaults proposed** (editable): weights 30/30/15/15/10, bands ≥90/75, freshness 30 days — open questions listed in plan §13.

## Blockers / notes

- `opencode export` cannot complete while the session is live (timed out, partial file removed). Run `opencode export` after the session ends per the global session-handling rule.
- Ataccama's outlier-detection detail page is JS-rendered (no content captured); anomaly detection is documented at the feature level only.
- Soda Core's licence is NOASSERTION ("Other"); only GX/dbt/Deequ are unambiguously Apache-2.0.

## Follow-up (same session)

- Added **§7.5 Smart tick labels** to `plan-data-quality.md` (user request, Citi Bike birth-year example): year-like domains (integer ticks inside 1000–2200) render as bare 4-digit years (`1970`, `2010`); compact notation (`1.9k` / `1.5M`) only when the tick span ≥ 10,000. A partial heuristic exists only on the box-plot y-axis (`chart-card.ts:5728`, column-type check + hard-coded `≤ 100_000`) — the plan centralises the rule in `formatTick` (`chart-utils.ts`) and extends it to every numeric axis. Logged in the decisions log, C2 milestone updated, formatter test matrix added.
