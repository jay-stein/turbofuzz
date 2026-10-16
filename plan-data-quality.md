# Plan: Data Quality Checks, Weighted Score & Snowsight-Style Chart Aggregations

> Status: **Proposed — pending review**
> Date: 2026-10-16
> Source research:
> - `.copilot-tracking/research/20261016-ataccama-vs-open-source-dq-checks-research.md` (checks + score)
> - `.copilot-tracking/research/20261016-snowflake-chart-aggregations-research.md` (chart aggregations — Track B §7)
> - Track C (§8) starts as a **spike**: decision memo first, build only if the measured numbers pass.
>
> Prime directive: lightning-fast, low-latency, minimal bloat, fully offline. Nothing here may break the <50 ms keystroke loop or the `connect-src 'none'` promise.

**Reading order:** §1 vision → §2 scope → §3 score design → §4 UX (dedicated Quality view) → §5 checks → §6 reports → §7 Track B → §8 Track C (map spike) → §9–§14 delivery & governance.

---

## 1. Goal & tracks

TurboFuzz can already detect a wide set of data issues (empties, outliers, sentinels, type conflicts, duplicates, dependency conflicts, drift…). What it lacks versus Ataccama ONE, Great Expectations, Soda, dbt and Deequ is:

1. **A few check families** that all of those tools share, and
2. **A single overall quality number** with a per-dimension breakdown — surfaced in a dedicated, fully transparent view.

**Track A — Data Quality (§3–§6):** check families + weighted score + the dedicated Quality view + reports/exports.

**Track B — Chart aggregations (§7):** Snowsight-style on-the-fly measure/aggregation/bucket controls on chart cards (the aggregate engine already exists; this is UI surfacing) + KPI cards + chart suggestions.

**Track C — Map view (§8, research spike):** decide whether a lightweight, fully offline world map is feasible — bundled basemap (~100 KB class), automatic lat/lon + degree-format detection, points/density reusing the existing pipeline. Spike first (decision memo), build only if the measured numbers pass.

All tracks keep TurboFuzz's differentiators: instant, private, check-then-fix, every issue visible, every fix undoable. Tracks B and C are independent and can interleave with the milestones in §9.

**User decisions locked in (2026-10-16):**

- **The score is weighted** — overall = weighted mean of applicable dimension scores, N.A.-excluded. Not Ataccama's "a record fails if any rule fails" (that model assumes hand-authored per-attribute rules and would punish wide tables unfairly — see §12 Decisions log).
- **Transparency is a hard requirement** — the score is never a black box. A user must be able to walk from the number → dimension → check → pass/fail/N.A. counts → the actual failing rows/cells, with one click to filter, fix or export.

---

## 2. Scope

### In scope

- P0 check families: composite-key uniqueness, format/pattern validity, pair/consistency checks, allowed-values checks.
- P1: weighted Overall Quality score, **dedicated Quality view** with full drill-down, score tile, Process Log deltas, completeness targets, freshness check, user thresholds.
- P2: Data Quality report export (own JSON/CSV/Markdown first; SodaCL / dbt YAML / GX JSON / DQDL after) including the score and per-check pass/fail counts; failed-rows export per check.
- Track B (§7): chart aggregation inspector, time-bucket switcher, KPI/scorecard card, auto-chart suggestions, smart tick labels, **Views lens UX rework** (obvious naming, minimisable stacked cards, new-view-below), small statistics-inspector polish.
- Track C (§8): research spike for an offline world map — bundled basemap options, lat/lon + DMS detection, point/density reuse — with a build/no-build decision memo.

### Out of scope (deliberately)

- Scheduled scans, alerting/notifications, catalogs, lineage, warehouse pushdown, DQ gates — all need a server and contradict the offline model.
- ML anomaly detection service, multivariate row scoring — parked as P3 stretch.
- Accuracy dimension scoring — shown honestly as **"No reference available"** (N.A.), mirroring Ataccama's own state for rules without reference data.
- Python/library charting (Streamlit in Snowflake, notebook Altair/Plotly) — violates the no-dependency, offline model; only the *aggregation-inspector* interaction pattern is borrowed.
- A router-style multi-page app — the Quality view is a lens/tab inside the existing single workspace (see §4.2 rationale).
- Network map tiles or mapping libraries (Leaflet/MapLibre/Mapbox, OSM/satellite tiles) — any map we build is a bundled, low-resolution world outline; no external requests, ever.

---

## 3. Score model (specification)

### 3.1 Dimensions, applicability, weights

| Dimension | Default weight | Applicable when | Primary source data |
|---|---|---|---|
| Completeness | 30 | Always (columns can be excluded) | Null policy + per-column cell counts |
| Validity | 30 | At least one typed/patternable non-null cell | Type-conflict / mixed-decimal / formula / off-pattern counts |
| Uniqueness | 15 | At least one key-like column or user-defined key | Duplicate rows on key column(s), whole-row duplicates |
| Consistency | 15 | At least one discovered/defined rule | Functional-dependency conflicts, pair-check violations |
| Timeliness | 10 | A date column is chosen for freshness | Latest value vs now / median interval |
| Accuracy | — | **Never (offline)** | Displayed as "No reference available" (N.A.) |

- **Overall = Σ(weight_d × score_d) / Σ(weight_d)** over **applicable** dimensions only. If no dimension is applicable (e.g. a 1×1 dataset), hide the indicator with a tooltip — same behaviour as Ataccama's all-N.A. case.
- Weights and band thresholds are user-editable (persisted in `localStorage`, per the theme-setting precedent). Defaults: **weights 30/30/15/15/10**, **bands ≥90 green · 75–89.9 amber · <75 red**.
- Dimension scores are displayed 0–100 rounded to 1 decimal for the overall score, integers for dimensions.

### 3.2 Per-check pass rates (all N.A.-excluded)

- **Completeness** (per column): `1 − null cells / eligible cells`. Columns are **required** by default; a column can be marked optional → its cells become N.A. for completeness (Ataccama's exclusion semantics; also matches "N/A does not skew the score").
- **Validity** (per column): `1 − invalid non-null cells / non-null cells`, where invalid = fails inferred type + mixed-decimal other-convention cells (until repaired) + formula-like cells + off-pattern cells (once a format check exists). Null cells are **N.A.**, not failures (Ataccama's email example, verbatim).
- **Uniqueness** (per key): `1 − duplicate rows on the key / rows with a populated key`; rows with a null key part are **"Not populated" = N.A.** (Ataccama's default Uniqueness result state — user can flip this to Fail per key if they want strictness).
- **Consistency** (per rule): `1 − violating rows / rows where the rule applies`; functional-dependency conflicts are the v1 source, pair checks add to it as they ship.
- **Timeliness** (per freshness rule): pass = latest non-null date within the user threshold (default 30 days); N.A. if the column is all empty.

### 3.3 What does **not** score (advisory-only findings)

Outliers (values can be legitimately extreme), length outliers, near-duplicate/mergeable value clusters, unit-mix splits, text-mining findings. These stay as chips/findings but never move the score — otherwise the number punishes legitimate data and invites distrust. This is stated in the UI ("advisory findings don't affect the score").

### 3.4 Recompute & determinism

- Recompute triggers: ingest complete; null-policy change; column type change; every applied clean/transform step; threshold/weight edits. **Not** on filter changes — the score describes the dataset **after the current step pipeline, over all rows** (a filter-scoped score is a possible future toggle, §14).
- Deterministic: integer counts over full column scans; no ML, no randomness. Same data + settings ⇒ same score, always.
- Budget: recompute ≤ 50 ms at 100k rows (aggregation over already-computed stats; new counts are O(cells) single passes, same pattern as `computeAnomalies`).

---

## 4. User experience

### 4.1 Score tile

- Lives in the dataset summary band near the key facts: big number + band colour + delta since ingest + tiny sparkline of score across process steps.
- Hover → quick popover: top 3 score contributors ("Validity 81 — Email format, Score type conflict, Amount decimals").
- Click → opens the **Quality view** (§4.2) directly. (The earlier "Data Quality drawer" idea is superseded by the dedicated view — more room for the matrix and checks list; see §12.)

### 4.2 Dedicated Data Quality view

**Placement & rationale.** The Quality view is a **lens/tab in the View stage** (`Table · Chart · Quality`), not a router page. This preserves the one-workspace principle (`next_steps.md` §7: no six full-screen pages), keeps the filter sidebar, summary band and Process Log visible, and makes "check → filter failing rows → back to Quality" a one-click round trip. Entry points: the score tile, the command bar (`quality` / `dq` / `score`), check deep links, and the Help drawer.

**Layout (top to bottom; wide screens use the two-column zone):**

```
┌ View: [ Table ] [ Chart ] [ ● Quality ] ───────────────────────── [Export DQ report] ─┐
│                                                                                       │
│  DATA QUALITY                                             ┌──────┐                    │
│  20,184 rows · 18 cols · 6 steps applied    87.4  fair    │ 87.4 │  Δ +3.8 vs step 5  │
│  Score covers all rows after steps; filters don't change it └────┘                    │
│  [ ] Show only issues        [Weights & bands ▾]   [Required columns ▾]  [Help]       │
│                                                                                       │
│  ┌ Completeness ────────┐ ┌ Validity ────────────┐ ┌ Uniqueness ──────────┐          │
│  │ 94.1   ████████████░ │ │ 81.3   ██████████░░░  │ │ 100    █████████████ │          │
│  │ w 30 · 12 checks     │ │ w 30 · 9 checks      │ │ w 15 · 4 checks      │          │
│  │ 1,636 fail · 402 n/a │ │ 394 fail · 0 n/a     │ │ 0 fail · 0 n/a       │          │
│  └──────────────────────┘ └──────────────────────┘ └──────────────────────┘          │
│  ┌ Consistency ─────────┐ ┌ Timeliness ──────────┐ ┌ Accuracy ────────────┐          │
│  │ 92.1   ████████████░ │ │ 100    █████████████ │ │  n/a                 │          │
│  │ w 15 · 3 checks      │ │ w 10 · 1 check       │ │ No reference data    │          │
│  │ 41 fail · 0 n/a      │ │ 0 fail · 0 n/a       │ │ available (offline)  │          │
│  └──────────────────────┘ └──────────────────────┘ └──────────────────────┘          │
│                                                                                       │
│  ┌ Checks (21) ───────────────────────────────┐  ┌ Column × dimension ─────────────┐ │
│  │ [All dimensions ▾] [Issues only] [fails ▾] │  │            Comp  Valid Uniq Cons │ │
│  │                                            │  │  Email     98.8  99.8  —    —    │ │
│  │  ▾ Email format (AA…@AA.AA)   35 fail      │  │  Amount    99.9  91.2  —    —    │ │
│  │    19,731/19,766 pass · 99.8% · method:    │  │  Name      96.1  97.0  —    88.4 │ │
│  │    dominant mask AA…@AA.AA (97.2% share)   │  │  City      97.4  99.1  —    —    │ │
│  │    [Filter failing rows] [Export] [Fix ▾]  │  │  (click any cell to drill)       │ │
│  │    ┌ failing preview ────────────────────┐ │  └──────────────────────────────────┘ │
│  │    │ bob@x · carl@ · 33 more             │ │  ┌ Why is this my score? [expand] ─┐ │
│  │    └─────────────────────────────────────┘ │  │ 87.4 = Σ(w·s)/Σw over 4 of 5    │ │
│  │                                            │  │ dims (Accuracy n/a)             │ │
│  │  ▸ Phone is populated          234 fail    │  │ ├ Completeness 94.1 (w 30)      │ │
│  │  ▸ Country in allowed list     12 fail     │  │ ├ Validity 81.3 (w 30)          │ │
│  │  ▸ Delivery ≥ Order date       89 fail     │  │ ├ Uniqueness 100 (w 15)         │ │
│  │  …                                         │  │ ├ Consistency 92.1 (w 15)       │ │
│  └────────────────────────────────────────────┘  │ └ Timeliness n/a                │ │
│                                                  └──────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Zones & components:**

1. **Header strip** — overall score + band label, delta since the previous step (and since ingest), scope note ("all rows after steps"), settings popovers (weights & bands, required/optional columns, thresholds), "Show only issues" toggle, Export DQ report.
2. **Dimension cards** — five contributing dimensions + an Accuracy n/a card. Each: score, band colour **plus a text label** (never colour-only), mini bar, weight, check count, fail + N.A. counts. Click a card → toggles the checks list to that dimension ("results only for selected dimensions" à la Ataccama).
3. **Checks panel** (left, widest column) — grouped by dimension, sorted by fails by default; each row expands to:
   - pass/fail/N.A. counts and pass rate, method/evidence line (reuses `Finding.evidence`: "robust median fence (MAD)", "dominant mask AA…@AA.AA (97.2% share)"),
   - inline **failing-rows preview** (first ~5 rows, lazy via the existing filter request) + `N more`,
   - actions: **Filter failing rows** (applies the filter and switches to Table — back returns to Quality with the filter intact), **Export failing rows (CSV)**, **Fix ▾** (existing one-click remedies; each lands in the Process Log with a score delta).
4. **Column × dimension matrix** (right column, top) — columns down, dimensions across, cells show pass rate with heat colour; `—` = not applicable, `n/a` = excluded. Click a cell → expands the checks touching that column/dimension. This is the "where is the problem" triage view.
5. **"Why is this my score?" tree** (right column, bottom) — expandable calculation: overall → dimension (weight, applicable checks) → per-column/check counts, with N.A. marked. Everything countable and explainable; no opaque sub-scores.

**Interactions:** dimension filter + issues-only + sort are independent toggles; expanding is inline (no navigation); filters from the sidebar do not change the score but are noted ("score is dataset-level; 12,410 rows currently filtered" hint with a one-click "score this filter" parked as a future toggle, §14).

**States:** computing after a step (skeleton + previous score + spinner chip); all-N.A. (overall hidden, explainer present — Ataccama parity); fully clean (positive empty state: "All 21 checks pass"); small-n caution (`n < 50` chips on affected checks); sampled checks labelled ("sampled").

**Accessibility:** band chips carry text labels; bars have accessible values; full keyboard navigation of dimension cards, check rows and matrix; preview tables are real tables.

### 4.3 Process Log integration

- Every Process Log entry gains a **score delta chip**: `87.4 → 91.2 (+3.8)`, tooltip shows the per-dimension moves. Undo restores the previous score. This is the payoff loop: apply sentinel policy (Completeness ↑), repair decimals (Validity ↑), dedupe a key (Uniqueness ↑).

### 4.4 UI surface summary

| Surface | Change |
|---|---|
| Summary band | + Score tile (number, band, delta, sparkline; hover popover; click → Quality view) |
| View stage | + **Quality lens** (Table · Chart · Quality) with dimension cards, checks panel, column × dimension matrix, calculation tree |
| Column QA chips | + completeness target status, + format/pattern chip, + allowed-values chip, + pair-check chip |
| Process Log | + score delta chip per step (hover = dimension moves) |
| Chart cards | + Quick aggregate inspector (dimension / measure / aggregation / split), bucket switcher, numeric bin control |
| Chart gallery | + KPI/scorecard card type; auto-suggested type + bindings on add |
| Export dialog | + "Data Quality report" and "Export failing rows" scopes |
| Help drawer | + "Quality score" topic (model, advisory exclusions, the view) and "Chart aggregations" topic |

No new full-screen pages; the Quality view is a lens in the existing workspace and the drawer pattern introduced for Help remains the house style for anything smaller.

---

## 5. Checks to build

### 5.1 Composite-key uniqueness (P0)

- **UI**: multi-select columns (header multi-select or picker in the QA panel) → "Check duplicates on these columns".
- **Engine**: hash selected raw values per row (reuse `rowHashes` machinery); count duplicate groups + rows; store bits for filtering.
- **Finding**: `"N duplicate rows on (a, b, c)"` — severity review; actions: filter duplicates, **scoped dedupe transform** (keep first/last/drop-all) as a new `transform-ops` variant.
- **Scoring**: Uniqueness; null key parts = N.A. by default (configurable to Fail).
- **Acceptance**: works at 1M rows within ingest budget; dedupe transform undoes cleanly; recipe support report mentions the scoped key columns.

### 5.2 Format/pattern validity (mask profiler) (P0)

- **Engine**: classify each cell into a **mask** (`A` letter, `9` digit, `#` other; separators literal): `AA-9999`, `999-999-9999`. Dominant mask discovered from a capped sample (e.g. ≤ 2,000 non-null cells/column, strided); pass/fail classification over all cells is a cheap char-class pass. Null tokens excluded (N.A.).
- **Finding**: `"Email" has 214 values that don't match the dominant format AA·A@AA·AA` — example values listed; actions: filter, optional **user-supplied regex** ("advanced") to override the mask.
- **Guardrails**: only surface the check when the dominant mask share ≥ threshold (e.g. 80%) and n ≥ 50 — avoids flagging genuinely mixed free text.
- **Scoring**: Validity.
- **Acceptance**: no false positives on free-text columns in the torture fixture; off-pattern filter shows exact cells; optional regex validated without catastrophic backtracking (input length cap + timeout-safe pattern check).

### 5.3 Pair / cross-column consistency (P0)

- **UI**: "Add consistency check" — column A, operator (`≥`, `>`, `=`, `≈ tolerance`, `in set`), column B (or constant).
- **Engine**: single pass over typed values; null on either side = N.A.; date-aware comparisons for date-typed columns (a date ≥ date, not string compare).
- **Finding**: `"Delivery Date" is before "Order Date" on 89 rows` + filter.
- **Arithmetic identity** (same family, second step): sum of selected columns ≈ target column with a user tolerance → "Parts don't add up to Total on 12 rows".
- **Scoring**: Consistency.
- **Acceptance**: operators and tolerance behavior covered by unit tests; works after type conversions; conflicts survive filtering correctly.

### 5.4 Allowed values / reference list (P0)

- **UI**: from the existing category facet ("Use as allowed values") or paste a list.
- **Engine**: out-of-set scan (categories already hashed); nulls N.A.
- **Finding**: `"Country" has 12 values outside the allowed list` with the offending values + counts; filter action.
- **Scoring**: Validity (as a "valid set" check) — category checks are first-class validity rules in Ataccama/GX/Soda.
- **Acceptance**: case/whitespace normalization follows the app's existing search normalization semantics (documented in the finding's method line).

### 5.5 Completeness targets (P1)

Per-column required/optional flag + optional target % (default: required = counts toward score, optional = N.A.). Status colour in the column QA chips.

### 5.6 Freshness check (P1)

Date column picker + threshold (default 30 days); finding + Timeliness dimension.

### 5.7 Threshold surfacing (P1)

Editable thresholds for existing drift (PSI/Cramér's V) and similarity suggestions — surfaced as pass/fail in the Quality view where applicable, but drift stays advisory unless the user promotes it to a scoring check.

---

## 6. Reports & export (P2)

1. **In-app report first** — "Export DQ report" from the Quality view header: downloadable **JSON + Markdown/CSV** containing the score, per-dimension scores, per-check pass/fail/N.A. counts, failing-row samples (capped), settings used (weights, thresholds), and timestamp. The report is essentially "this view, exported".
2. **Pipeline formats next** (extend `src/data/recipe*.ts` + support report, exactly like the pandas/Polars recipes):
   - SodaCL YAML (`duplicate_count(...) = 0`, `missing_percent(...) < x`, `freshness(...)`, reference checks),
   - dbt `data_tests` YAML (`unique`, `not_null`, `accepted_values`, `relationships`, `dbt_utils.unique_combination_of_columns`),
   - Great Expectations suite JSON (subset we can express faithfully),
   - Deequ DQDL ruleset (subset).
   - Anything not faithfully translatable goes into the **support report** (e.g. robust-MAD outlier flags — data-derived fences are recomputed downstream).
3. **Failed-rows export** per check (CSV), reusing the streamed export.

---

## 7. Track B — Chart aggregations (Snowsight-style)

> Research: `.copilot-tracking/research/20261016-snowflake-chart-aggregations-research.md`.
> Key finding: `src/data/aggregate.ts` is already a **superset** of Snowsight's aggregation surface (Snowsight offers avg / count / min / max / median / mode / sum and day→minute bucketing; we have stddev, percentiles, distinct, first/last, expressions, rolling / cumulative / diff / pctChange / pctTotal / rank / YoY, cohorts, fiscal calendars, timezones, bins). The gap is **UI surfacing**, not engine capability.

### 7.1 In-card aggregation inspector (core)

- ✅ **v1 shipped (line cards):** a **Value** control (Count of rows | any numeric column) + **Agg** (mean/sum/median/min/max) + **Bucket** (Auto · minute→year) sits directly on every unbound line card — no View required. The card compiles an implicit `ViewDef` (date dimension with the chosen grain, one measure) and fetches it through the existing `requestAggregate` worker path, then renders via the view-aggregate line renderer. Picking a Value clears any Group split (value line and grouped counts are different charts); Views remain the path for multi-dimension/multi-measure specs.
- ✅ **Histogram bins shipped (2026-10-16):** an unbound histogram card with a **Value** set compiles `{ column, by: { bin: { n: binCount } } }` from its Bins control and draws a measure per bin (bars in bin order); Value/Agg controls reuse the quick aggregate. Density cards stay excluded by design — a density grid encodes counts, not a measure.
- ✅ **Split-by shipped (2026-10-16):** a line/bar card with **Value** set keeps the **Group** control — the ViewDef gains a second (group) dimension and the renderer pivots the returned rows into one colored series per group value (top 8 by absolute total; canvas legend + note). Group select refreshes the value aggregate. Density cards stay excluded by design (counts, not a measure). **C1 done.**
- Remaining for C1: (none — line/bar/KPI/histogram + split-by shipped; density excluded).
- Any chart card gains a **Quick aggregate** mode beside "filtered table" and "saved view": pick dimension (any column; optional time bucket, date part or numeric bin), one or more measures (`count(*)` or column × aggregate), optional split-by series.
- The spec compiles to an **implicit `ViewDef`** and rides the existing `aggregate` worker request with the active filters (`respectFilters` semantics as-is). Rendering reuses existing renderers: line when the first dimension is a time bucket, bars otherwise.
- Snowsight parallel: bucket/aggregation changes happen **without modifying the query**; their chart types are bar / line / scatterplots / heat grids / scorecards with an inspector Data section.

### 7.2 Time-bucket switcher

- Every time dimension gets `Auto · Minute · Hour · Day · Week · Month · Quarter · Year`; "Auto" keeps the current human-period logic; label ticks keep the existing nice-period formatting. The animation grain dropdown (`chart-card.ts`) is the UI precedent; Snowsight's "change the bucketing for a time column from day to minutes" is the target behaviour.
- Numeric dimensions get bin control (equal width / N quantiles / explicit edges) using the existing `BinSpec` — Snowsight buckets numerics by integer values; bins are strictly richer.

### 7.3 KPI / scorecard card

New card type: single aggregate value (`sum(revenue)`, `median(age)`, `distinct(customers)`, `count(*)`) with optional period comparison via existing post-ops (`diff`, `pctChange`, `yoy`, `rolling`) and a sparkline from the aggregate series. Snowsight ships scorecards as a chart type; ours is computable offline with zero new engine work.

- ✅ **Shipped (2026-10-16):** the **KPI** card type in the gallery (new "What is the headline number?" group). Controls: **Value** (any numeric column) × **Agg** (mean/sum/median/min/max) plus an optional **Date** column; with a date the card compiles a time-bucket `ViewDef`, shows the latest bucket large (compacted like value axes), the change vs the previous bucket in green/red (`↑ +2.5 (6.3%)`), and a faint sparkline of the series; without a date it compiles a **dimension-less** `ViewDef` (grand total over all filtered rows — the aggregate engine already grouped `dimensions: []` into one group). Comparison is computed client-side from the returned series (no post-op plumbing needed for v1; `diff`/`pctChange` remain available for view measures).

### 7.4 Auto-chart suggestions

When a card is added (or column picks change), suggest type + bindings from column types: date + numeric → line; category + numeric → bars; numeric + numeric → scatter; single measure → KPI; two categories → heat grid. One-click accept; mirrors Snowsight's auto-generated chart.

- ✅ **Shipped (2026-10-16):** `suggestCharts` (typed ideas with fitting presets), the gallery's "Suggested for your data" strip with live previews, `pickDefaultCard` for the first card, and the setup dialog that confirms/adjusts bindings before the card lands. The KPI tile's preset follows the same rules (first numeric measure).

### 7.5 Smart tick labels

- **Problem (user report, 2026-10-16):** value axes compact big-looking numbers even when the domain is year-like — the Citi Bike birth-year column (1900–2026) should read as bare 4-digit years (1970, 2010), not "1.9k". Compact is only wanted when the range between min and max is genuinely large.
- **Rule (domain-driven, centralised in `formatTick`, `src/ui/chart-utils.ts`):**
  1. **Year-like**: every tick is an integer AND the domain sits inside `[1000, 2200]` → render bare integers with no compact and no thousand separators (`1970`, `2010` are labels, not quantities — `1,970` / `1.970` reads wrong in some locales).
  2. **Compact only for wide spans**: use `190k` / `1.5M` only when `max − min ≥ 10,000` (tunable constant) or when full labels would overflow the axis on a non-year-like domain.
  3. **Everything else**: locale-formatted numbers with thousand separators and the existing decimal trimming (`1,500` · `12.5` · `0.75`).
- **Coverage:** all numeric axes route through the same helper with the tick span — histogram x/y, box plot y (replacing the local `plainIntegerTicks` heuristic at `chart-card.ts:5724` and its hard-coded `≤ 100_000` check), scatter/density/correlation/heatmap axes, time-series y axes, animation frames, profile mini-histograms, treemap/count axes and the new Track B aggregate/KPI cards. Tooltips keep full precision.
- **Why now:** a partial implementation exists only on the box-plot y-axis and only when the source column is typed `integer`; the rule must move into the formatter so every renderer behaves the same (and so the new Track B charts inherit it).
- **Acceptance:** Citi Bike birth-year axis shows `1970`-style bare years; a 1.5M-row count axis still shows `50k` / `1.5M`; a 0–1,500 count axis shows `1,500` (not `1.5k`); decimal and negative axes unchanged; no new label overlap on existing fixtures; formatter unit tests cover year-like, wide-span, small-int, decimal, negative and locale cases.

### 7.6 Later polish (A5)

Invalid-row meter on profile cards (type-conflict counts already exist), email-domain split for detected email columns, typed exact-value entry on histogram tooltips (Snowsight contextual-statistics parity). Optional; only after 7.1–7.4 land.

### 7.7 Mechanics

- Cache keys `(dataGeneration, filtersSignature, specHash)` cleared by `engine.invalidate()`, reusing the `HistogramCache` pattern; responses remain generation-guarded.
- No new worker messages required for the core case beyond a thin `quickAggregate` wrapper over the existing `aggregate` path.
- Rejected for this track: `:daterange` / `:datebucket` SQL parameters (no SQL layer offline — client-side bucketing is the equivalent), Streamlit/notebook charting (library-based).

### 7.8 Views lens UX rework (user feedback, 2026-10-16)

**Diagnosis (verified in `views-panel.ts` / `view-tabs.ts`):** views are horizontal tabs; only the active view's builder renders; renaming is a hidden double-click (announced only in a tooltip); there is no way to see a minimised view above while editing another; `+ View` appends to the tab strip. The underlying model (saved aggregates over the filtered table, bindable to chart cards) is right — the surface reads like browser tabs and hides its gestures.

**Rework: stacked, minimisable view cards (accordion) instead of tabs.**

1. **Card header (always visible):** the view name is a **visible inline rename** — click the name (hover ✎ affordance) to open an input; Enter/blur commits, Escape cancels; double-click stays as a shortcut. New views start in edit mode with placeholder "Name your view…". A summary line shows when minimised: `dimensions × measures · N groups` using `measureSymbol`, plus a "stale" dot when filters/columns changed since the last compute.
2. **Minimise:** an explicit chevron button (aria-expanded; "Minimise view" / "Expand view") on every card, and the header row is click-to-toggle. Exactly **one card expanded at a time** — only the expanded view computes (matches today's single-active refresh cost) and it makes "finish A → minimise → start B" the primary path. Minimised cards keep their last result with a stale marker.
3. **New below:** a "＋ New view below" button in each expanded card's footer inserts a blank view directly beneath the active one, auto-minimises the previous one and focuses the name field; the end of the stack keeps "＋ New view" / "＋ Cohort view" (existing cohort builder).
4. **Remove:** keep the header × (only when >1 view), unchanged behaviour; `MAX_VIEWS = 5` unchanged for now.
5. **Keep:** starter views (archetype-based) become collapsed cards except the first; the actions bar (chart this, use as dataset, pandas recipe, slick table) moves to the expanded card footer; drill-down/table unchanged; the "Views" help topic is updated to describe naming/minimising (drop the "double-click to rename" copy).
6. **Out of scope for this pass:** drag-to-reorder, multiple expanded cards, persisting minimise state, cross-view comparison.

**Acceptance:** renaming is discoverable without a tooltip (visible affordance + labelled input); a view can be minimised with one click and a new one created directly below it with one more; only one view ever computes at a time; keyboard operable (header toggle, name edit, new-below); all existing behaviours (chart binding, dataset conversion, pandas recipe, slick table, cohort, drill-down) unchanged.

---

## 8. Track C — Map view (research spike)

> Value case: for lat/lon datasets (the Citi Bike fixture has station coordinates), a world map is the natural "where" view. Everything except the basemap already exists — worker sampling and density grids (`getChartSeries`) draw the points, numeric range filters map 1:1 to map brushing (lat × lon), canvas rendering and PNG export are shared, and the archetype/suggestion engine can learn to detect coordinates. The spike answers one question: **can the basemap be small, offline and instant?**

**Constraints (non-negotiable):**

- **No network**: no tile servers, no mapping libraries (Leaflet / MapLibre / Mapbox), no CDN assets — the basemap ships as a same-origin asset (CSP untouched).
- **Initial bundle untouched**: the basemap loads lazily on first map card (the Parquet-reader precedent), never in the critical path.
- **Spike budget targets**: basemap asset ≤ ~150 KB raw at world scale; first map paint ≤ 50 ms at 100k rows; extra peak RAM ≤ ~10 MB.

**Verified source data (Natural Earth 4.1.0 via world-atlas 2 — quantized TopoJSON, decimal degrees, ISO 3166-1 numeric country ids):**

| File | Contents | Measured raw size (2026-10-16) |
|---|---|---|
| `countries-110m.json` | countries **and** land, 1:110m | **105 KB** (one file covers both) |
| `land-110m.json` | land only, 1:110m | 54 KB |
| `countries-50m.json` | countries + land, 1:50m | 739 KB |

**Basemap candidates to evaluate (measured, not guessed):**

1. **Build-time raster land mask** — rasterise Natural Earth land at 2048×1024 into a 1-bit mask (256 KB raw bitmap; PNG likely 30–60 KB), drawn via `ImageData` / offscreen canvas and recoloured per theme. Cheapest to draw, lowest RAM; no borders; pixelation on zoom.
2. **Build-time vector land/countries** — pre-process the 110m TopoJSON into flat `Float32Array` coordinate blobs at build time (a `build:geo` script; no runtime TopoJSON decoder, no dependency), drawn as canvas polygons. Borders plus optional country hover; ~105 KB class; slightly more draw cost, still trivial at world scale.
3. 1:50m vectors as an optional higher-detail variant if 110m is too coarse (739 KB raw — still lazy, but re-check the budget before adopting).

**Latitude/longitude detection (second half of the spike):**

- Name heuristics (`lat` / `latitude`, `lon` / `lng` / `long` / `longitude`, prefix/case-insensitive) + value-range checks (lat ∈ [−90, 90], lon ∈ [−180, 180]) + pair consistency (both columns present, similar populated counts, plausible spread). Reuse the archetype/suggestion engine's scoring approach; surface as a "Looks like coordinates — map it" suggestion.
- **Degrees formats** to parse: signed decimal (`51.5074, -0.1278`), hemisphere-suffixed decimal (`51.5074 N`, `0.1278 W`), DMS (`51°30'26"N`, `0°7'39"E`), space/compact DMS (`51 30 26 N`, `N51 30 26`). Conversion to decimal degrees is for plotting only (non-destructive); an optional "Convert to decimal degrees" clean op if the user wants it stored.
- **No-go formats** (listed explicitly so the memo can close them): UTM/MGRS, geohash, state-plane and national grids.
- Missing or out-of-range coordinates are **N.A.** (excluded and counted), consistent with the DQ score semantics.

**Interactions & mechanics (reuse, not rebuild):**

- Pan/zoom = the existing chart view transform; above the point cap the existing `getChartSeries` auto-switch goes to density on the map; hover tooltips and click-to-filter reuse the scatter card's hit regions.
- **Rectangle brush → two existing range filters (lat + lon)** — cross-filtering, linked charts, exports and the Quality view all work for free.
- PNG export and theme repaints reuse the canvas export/theme paths; projection choice (equirectangular vs Web Mercator with clamped poles) and antimeridian handling are decided in the memo.

**Spike deliverables (decision memo in `docs/`, ~1–2 days):**

- Measured sizes, first-paint and RAM for candidates 1 and 2 against the budget targets (plus the 50m variant if the budget allows).
- DMS/decimal parsing coverage report against fixtures (`test/` cases incl. the Citi Bike station coordinates).
- Recommendation: **build, defer or drop** — with the numbers. If build: a new chart card type in the card gallery with a lazy-loaded basemap, the usual budgets and tests; no impact on Track A/B milestones.

**✅ Shipped (2026-10-16):** the **Map** chart card type in the Charts section. `src/data/geo.ts` (decimal/DMS parsing, lat/lon pair detection by name and range) + `src/data/topo.ts` (dependency-free TopoJSON decoder, ~3 ms for the 110m file) + `src/data/world-110m.ts` (vendored Natural Earth countries/land, generated by `tools/vendor-world.mjs`, code-split and decoded once per session). The card draws land + coastline in equirectangular projection, plots filtered points (batched by colour), and a drag-rectangle brush range-filters both coordinate columns through the existing filter path. The series request gained a `clip` flag so maps keep the full ±180/±90 range (p1–p99 clipping stays for scatter). Gallery: "Where is it?" group + a "Map of coordinates" suggestion when a pair is detected.

---

## 9. Milestones

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| M1 | P0 checks | §5.1–5.4 + findings + filters + scoped dedupe transform | Fixture tests per check; no regressions; bench entries recorded |
| M2 | Score engine + Quality view | `src/data/score.ts`, worker payload, score tile, Quality lens (dimension cards, checks panel, column × dimension matrix, calculation tree, failing previews), weights/bands/required settings, freshness, Process Log deltas | Determinism tests; N.A. exclusion tests; delta-after-fix tests; ≤ 50 ms at 100k; keyboard pass |
| M3 | Report & export | In-app DQ report (JSON/MD/CSV) from the view, failed-rows export, SodaCL/dbt/GX/DQDL emitters + support report | Emitted files match the covered subset of each format; support report lists gaps |
| M4 (later) | Strict mode & extras | Optional "cap at lowest dimension" mode (Ataccama parity), multivariate row score, reference-file checks, filter-scoped score toggle | Only if demanded |

Suggested sequencing rule: M1 checks feed M2's score; do **not** ship the score/view with only the legacy checks, or it will be dominated by Validity surprises (patterns, pairs) that users can't yet see.

### Track B & C milestones (independent — can interleave)

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| C1 | Quick aggregate + buckets | §7.1–7.2 inspector, implicit-ViewDef compile, cache, bucket switcher, bin control | Any card switches measure/aggregation/bucket live; ≤ 50 ms at 100k; no regressions in view-bound/animated cards |
| C2 | KPI card + suggestions + smart ticks | §7.3–7.5 | KPI comparisons via post-ops; suggestions match column types; year-like axes show bare 4-digit years |
| C3 (later) | Statistics-inspector polish | §7.6 | Only if demanded |
| C4 (spike) | Map view research | §8 | Decision memo with measured basemap size, first-paint, RAM and DMS coverage + build/no-build recommendation |
| C5 | Views lens UX rework | §7.8 | Obvious naming (visible inline edit), one-click minimise, "new view below", single-expanded accordion; keyboard pass; existing view behaviours unchanged |

---

## 10. Performance budgets

| Operation | Budget | Notes |
|---|---|---|
| Composite-key hashing | within ingest cost | Same O(rows × key cols) as row hashes |
| Pattern discovery | ≤ 10 ms/column on sample | ≤ 2,000 non-null sampled cells |
| Pattern classification (full) | ≤ 20 ms/column at 100k rows | Single char-class pass, typed arrays |
| Score recompute (all checks) | ≤ 50 ms at 100k rows | Aggregation over existing stats + incremental counts |
| Quality view open | ≤ 16 ms first paint | Payload is counts + links; failing previews lazy |
| Quick aggregate (1 dim • ≤ 2 measures) | ≤ 50 ms at 100k rows | Same walk as view aggregates; cached per (generation, filters, spec) |
| Bucket switch (grain change) | same as quick aggregate | Re-aggregates with a new spec; no data reload |
| Benchmarks | extend `bench/` | Add score recompute, pattern pass and quick aggregate to `bench:ingest`; record in `bench/results*.md` |

All new payloads go through the existing worker protocol with typed arrays; nothing heavy lands on the main thread.

---

## 11. Test plan

- **Unit** (`test/`, node:test via tsx): one fixture per check family (clean, all-fail, empty, mixed-locale, date-pair, null-key). Score tests: determinism, N.A. exclusion, weight renormalisation when a dimension is N.A., band thresholds, delta after each op type (null policy ↑Completeness; decimal repair ↑Validity; scoped dedupe ↑Uniqueness; nothing ↑ on undo — restores).
- **Quality view**: dimension filters, issues-only toggle, matrix pass-rate math, failing-preview paging, all-N.A. and clean states, keyboard navigation.
- **Chart aggregations**: ViewDef compilation of card specs (each aggregate, split, fill), time-bucket edge correctness (week start, fiscal, timezone, partial periods), KPI comparison math, cache invalidation on generation/filter change, suggestion heuristic on column types.
- **Smart tick labels**: formatter matrix — year-like domains (bare integers), spans ≥ 10k (compact), small integer spans (locale separators), decimals, negatives, locale (de-DE separators); Citi Bike birth-year fixture asserts 4-digit labels on histogram and box-plot axes.
- **Integration**: torture fixture end-to-end — ingest → score tile → open Quality view → drill to a check → filter → fix → score delta in Process Log → export report; plus: add chart → quick aggregate → switch bucket → KPI card.
- **Bench**: `bench:ingest` + new score/pattern/aggregate passes at 100k/500k/1.5M; numbers recorded in `bench/results-ingest.md`.
- **Commands**: `npm test`, `npm run typecheck`, `npm run bench:quick` before any merge.

---

## 12. Decisions log

| Decision | Choice | Rationale |
|---|---|---|
| Scoring model | **Weighted mean of applicable dimension scores** (user-confirmed) | Honest for auto-generated checks; Ataccama's record-fail model assumes authored rules |
| N.A. semantics | N.A. excluded from numerator and denominator everywhere | Copied from Ataccama; prevents optional fields from skewing scores |
| Advisory findings | Never scored (outliers, near-duplicates, unit mix, text findings) | They suggest review, not errors; keeps the number trustworthy |
| Accuracy | Always "No reference available" (N.A.) | Honest offline state; matches Ataccama's own N.A. path |
| Default weights | 30/30/15/15/10 (Completeness/Validity/Uniqueness/Consistency/Timeliness) | Completeness + Validity are what data consumers feel first; renormalised per dataset |
| Bands | ≥90 green / 75–89.9 amber / <75 red (editable) | Clear, configurable, avoids false precision |
| Score scope | Dataset-level after current steps, all rows (filter-scoped toggle later) | Score describes the current *state of the data product*, not a user's current view |
| Transparency surface | **Dedicated Quality view (View lens) replaces the drawer concept**; score tile deep-links to it | Room for dimension cards, checks list, column × dimension matrix and calculation tree; preserves one-workspace model; no router page |
| Chart aggregation inspector | Per-card quick aggregate compiled to an implicit `ViewDef`; a third source mode beside filtered table / saved views | Engine already exists; keeps explicit view authoring optional; no new dependencies |
| Time bucket default | "Auto" from the data span (animation precedent); explicit grains override | Matches Snowsight's day→minute / day→week switching without a query round-trip |
| Tick label style | Domain-driven: year-like window `[1000, 2200]` → bare integers; compact only when the tick span ≥ 10,000 | Users read years as labels, not quantities (reported on Citi Bike birth years); keeps 50k/1.5M on genuinely wide count axes |
| Scorecards | KPI card using existing post-ops (diff / pctChange / yoy) | Snowsight scorecard parity, offline |
| Chart suggestions | Type + bindings from column types on card add | Mirrors Snowsight's auto-generated chart; cheap onboarding win |
| Python charting | Rejected (Streamlit / notebook libraries) | Violates offline/no-dependency model; only the inspector interaction pattern is borrowed |
| Map view | Research spike only (§8): bundled offline geometry, no tile servers, no mapping libraries; build decision only after the measured memo | Point/density pipeline and range-filter brushing already exist — only the basemap is new; preserves the CSP + offline promise |
| Views lens layout | Stacked minimisable cards (accordion), one expanded at a time; visible inline rename; "New view below" inserts under the active card | Replaces the tab strip + hidden double-click rename (user feedback); keeps the single-active compute cost |

---

## 13. Risks & mitigations

- **Score skew on wide/sparse tables**: completeness on many optional text columns drags the mean. → required/optional flags + N.A. exclusion + weight editing + "show only issues".
- **Small-dataset instability** (1 duplicate in 10 rows ⇒ Uniqueness 90): show counts next to percentages; `n < 50` caution chips; never hide the raw counts.
- **Pattern false positives** (mixed locales, free text): dominant-mask share threshold, sample-size floor, user regex override; scoring only when ≥80% mask share.
- **View density creep**: the Quality view has many components. → two-column zone collapses to stacked on narrow screens; checks list is the single scroll region; matrix and tree are collapsible; no new navigation levels.
- **Performance at 1M rows**: full-scan counts documented per check; bench gate at 100k required before merge; sampled fallback carries a visible "sampled" tag.
- **Chart inspector load with many cards**: every card aggregates separately. → cache per (generation, filters, spec); only re-request when a spec or the data generation changes; bench gate at 100k before merge.
- **Recipe/export drift**: emitters live beside the existing recipe-support machinery so they age together.

---

## 14. Open questions (defaults proposed — change before M1 if desired)

1. **Pattern checks auto-on or suggested?** Proposal: discovered automatically, shown as a suggestion chip first (consistent with sentinels); becomes a scoring check once the user accepts it ("Add format check") — mirrors the app's suggestion philosophy.
2. **Default completeness target**: 100% for required columns with issues shown, or 95% before it colours amber? Proposal: no target percentage initially — required columns score directly; target % arrives with the "completeness targets" setting.
3. **Failed-rows export naming/scope**: "Export failing rows (CSV)" per check — fine? Or fold into the existing export dialog scopes?
4. **Filter-scoped score**: dataset-level is the default. Add a "score the current filter" toggle in the Quality view now or later? Proposal: later (M4) — it complicates the Process Log deltas.
5. **Quick-aggregate in recipes/export**: should card aggregate specs appear in the pandas/Polars recipe export like saved views do? Proposal: yes, once §7.1 lands — cards become replayable artefacts.
6. **Pivot / heat-grid scope**: heat grid from a split-by (pivot dimension) in v1 of the inspector, or after? Proposal: bars/line/KPI first; pivot follows the existing `ViewDef.pivot` support.
7. **Quality view in shared insights/URLs**: not persisted in URLs initially (privacy/clean URLs); revisit with the insights work.
