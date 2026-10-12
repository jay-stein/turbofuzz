# TurboFuzz — Principal UX review & redesign spec (2026-10-12)

**Reviewed:** `main` @ `3a8761c` — source and `next_steps.md`, plus screenshots of 7 screens supplied by Quincy (Citi Bike file, 224,736 × 15, dark theme: Overview, Table, Chart, Clean ×3 tabs, Transform). Visual findings are in §10; §1–9 were written from code and are consistent with them.
**Goal:** move analysts from "like" to "love" without touching the latency budget or the privacy story.

---

## 1. Summary

TurboFuzz has a strong engine and two good screens (Overview, Table). It reads as "like, not love" because of the **interaction model**, not capability:

| # | Problem | Evidence in the code |
|---|---|---|
| 1 | Two navigation systems in one row; one doesn't navigate | `ViewTabs` (`Overview \| Table \| Chart`) and `PipelineStepper` (`Load → Clean → Transform → Export`) share `nav-row` in `app.ts`. The stepper only opens drawers and "never changes the selected view" (`stepper.ts`). |
| 2 | One job, three front doors, three commit models | Header ⋯ menu (instant + undo toast), chips above headers, Clean/Transform drawers (stage → preview → Apply). `next_steps.md` §10 already names this. |
| 3 | Aggregation is buried and destructive | `groupBy` is 1 of 9 entries in `TRANSFORM_TYPES` and is `{dimension, measure, aggregate}` — one group column, one measure — and it replaces the dataset. |
| 4 | Charts have no visual vocabulary | `+ Add chart` auto-picks the next unused type from a fixed order (scatter → correlation → box → heatmap, `chart-panel.ts`); changing type means choosing from text labels (`CHART_KIND_LABELS`, 8 kinds). |
| 5 | Mode-heavy fixes | UPPERCASE is ~7 interactions via the drawer (per `next_steps.md` §10). Transform drawer can only remove the *last* staged step. |

**Design principle:** *act on the data where it is, show the consequence, always allow undo.*

**Keep as-is:** Overview, Table, instant filter loop, Process Log, pandas recipe export, no-chart-library rule, `connect-src 'none'` privacy story.

---

## 2. Target information architecture

```
Overview | Table | Views | Charts | Reports          [Recipe (N)]  [Export]
```

- **Lenses, not stages.** Tabs never imply dependency. Charts do not require a View.
- Retire the stepper from the nav row. Its orientation job moves to the **Recipe (N)** button (the Process Log) and **Export**. Load becomes a dialog.
- Keyboard: extend the existing `1/2/3` shortcuts to `1–4`.
- `ViewId` in `view-tabs.ts` gains `"views"`; `VIEW_ORDER` becomes `overview, table, views, chart`.

---

## 3. Aggregate Views (new lens)

### 3.1 Model
A view is a **saved definition**, never a copied dataset.

```ts
interface ViewDef {
  id: string;
  name: string;
  groupBy: number[];                       // 1–2 columns (dimensions)
  measures: { column: number | null; agg: Aggregate | "distinct" | "pctTotal" }[];
  sort: { key: string; dir: "asc" | "desc" };
  limit: number;                           // default 500 groups
  respectFilters: boolean;                 // default true
}
```
- `Aggregate` today is `count | sum | mean | min | max | median` (`transform-ops.ts`); `distinct` and `pctTotal` are additions.
- Cap: **5 views** (UX guard, not a technical limit). Session state; saved into the Recipe later.

### 3.2 Worker
- New request `getAggregate(viewDef)` beside `getGroupedBins` / `getCrosstab` / `getBoxStats` in `protocol.ts`.
- Hash group-by over the filtered result order; return key labels plus typed-array measure columns, `groupCount`, `truncated`, `ms`.
- Cache by `(dataGeneration, filterSignature, viewDef)` — same pattern as `HistogramCache`. Only the **active** view recomputes on filter change; others go stale-then-refresh when selected.
- Budget: **< 50 ms** at 100k rows for ≤ 3 measures; > 10k groups returns top-N + "Other" with a visible "top 500 of 47,201 groups" note.

### 3.3 UI
```
[ View 1 ▾ ] [ View 2 ] [ + ]                 ☑ respects filters
Group by:  [Region ×] [+]     Measures: [Σ Amount ×] [x̄ Price ×] [# rows ×] [+]
┌──────────┬────────────┬──────────┬────────┐
│ Region   │ Σ Amount   │ x̄ Price  │ # rows │   ← inline data bars
│ North    │ ████████ …│          │        │   ← click row = drill down to Table
│ Total    │            │          │        │
└──────────┴────────────┴──────────┴────────┘
[ Chart this ]  [ Copy as pandas ]  [ Use as dataset ]
```
- **First open:** three one-click starter views derived from column types ("Count by *Region*", "Sum of *Amount* by *Region*", "*Amount* by month").
- Builder = two pill zones (click a column to add; aggregate chosen on the measure pill). No form dropdowns.
- **Drill-down:** clicking a group row sets the matching filter and switches to Table.
- **Chart this:** creates a chart card bound to the view; auto-picks bars (1 dim, 1 measure), line (date dim), heatmap (2 dims), grouped bars (1 dim, ≥ 2 measures).
- **Copy as pandas:** `df.groupby([...]).agg(...)`, consistent with `recipe.ts`.
- **Use as dataset:** applies today's destructive `groupBy` transform (extended to multi-dim/multi-measure) for users who want to export aggregates.
- Fold the backlog "Slick Tables" idea in here: a view can render as a publication-style table and export PNG/HTML.

### 3.4 Acceptance
- File drop → first aggregate view on screen in ≤ 3 clicks, ≤ 60 s.
- Filtering updates the active view and any chart bound to it in < 100 ms on 100k rows.
- Views never alter the Table or Process Log.

---

## 3.5 Generalised aggregation (supersedes the `ViewDef` in §3.1)

Group-by is one case. Every aggregation is three independent layers, so build **one engine, not eight features**:

1. **Dimension transform** — how rows map to output rows: the raw value, a **time bucket** (minute → year), a **date part** (day-of-week, hour-of-day, month-of-year), a **numeric bin**, quantiles, or custom ranges.
2. **Measure** — what is computed per output row: count, distinct, sum, mean, min, max, median, percentile, stddev, first/last (by time), mode; optionally conditional (`where`), weighted, or a **ratio of aggregates** (revenue ÷ orders, never a mean of ratios).
3. **Post-aggregation ops** on the ordered output: rolling window, cumulative, difference, % change, period-over-period (MoM, YoY), share of total, rank, top-N + Other, gap-fill.

```ts
interface ViewDef {
  id: string; name: string; respectFilters: boolean;
  dimensions: { column: number; by:
      | "value"
      | { time: "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
          weekStart?: 0 | 1; fiscalStartMonth?: number; tz?: string }
      | { datePart: "dow" | "hour" | "month" | "dom" | "week" }   // seasonality profiles
      | { bin: { width: number } | { n: number } | { quantiles: number } | { edges: number[] } } }[];
  measures: { column: number | null;
      agg: "count" | "distinct" | "sum" | "mean" | "min" | "max" | "median" | "stddev" | "first" | "last" | "mode" | `p${number}`;
      where?: FilterSpec; weight?: number; ratioOf?: { column: number; agg: string };
      post?: { op: "rolling" | "cumulative" | "diff" | "pctChange" | "yoy" | "pctTotal" | "rank"; window?: number | string } }[];
  fill?: "none" | "zero" | "null" | "carry";   // empty periods
  pivot?: number;                              // dimension index to spread across columns
  sort: { key: string; dir: "asc" | "desc" }; limit: number;
}
```

| You say | Dimension | Measure (+ post) |
|---|---|---|
| Monthly average | month of `starttime` | mean of `tripduration` |
| Daily max | day | max |
| 7-day rolling average of daily sales | day | sum → rolling mean, 7d |
| Month-on-month % change | month | sum → % change |
| Revenue per order, by month | month | ratio: sum(revenue) ÷ distinct(order id) |
| Top 10 customers + Other, Pareto | value of customer | sum → rank, cumulative % of total |
| Busiest hour × weekday | date parts hour + weekday, pivot | count → heatmap |
| Age bands | bin edges 18/30/45/65 | mean, count |

**Why time series is different from a plain group-by**
- The output is **ordered and calendar-aware**: sorted axis, regular grid and **gap-fill** (empty days/months as zero, null or carried forward). A plain group-by silently drops them.
- **Partial periods:** the first and last bucket are often incomplete. Flag them (hatched) and let the user exclude them.
- **Conventions:** week start (Mon/Sun), fiscal-year start month, time zone (reuse `timezone.ts`).
- **Never average averages:** each grain is computed from rows, not from the previous grain.
- **Calendar-aligned comparisons:** YoY matches the same month last year, not "12 rows back" when months are missing.

**UI**
- Date pills carry a grain menu (`starttime ▾ Month`); a **Day / Week / Month / Quarter / Year** segmented control re-buckets the view instantly.
- Measure pills open a grouped menu: Basic · Distribution (median, p90, stddev) · Time-aware (first, last) · Window (rolling, cumulative, % change, YoY).
- **Chart this** picks line/area for time dimensions, bars for date parts, heatmap for two date parts or categories, Pareto for ranked views. Today's Time series card plots row counts only (screenshot note: "rows over time"), so measure-over-time charts need a view as their Source.

**Engine:** time-bucket keys come from integer arithmetic per row (day/week by floor division with a cached tz offset; month/quarter/year via a month-start lookup built once), so cost stays O(n) and the < 50 ms budget holds. Window ops run on the small aggregated output, not on rows.

**Phasing:** v1 = value + time grains + date parts + core aggregates + gap-fill + cumulative/rolling/% change. v2 = bins/quantiles, pivot, conditional/weighted/ratio measures, YoY, cohorts. Later = event-log specifics (time between events, sessionisation, funnels).

---

## 4. Charts: tile gallery + Source selector

- **`+ Add chart` opens a tile gallery** (replace the type cycle in `chart-panel.ts`).
- **Group tiles by question:**
  - *How is it distributed?* Histogram · Box · Density
  - *How does it change over time?* Time series
  - *How do groups compare?* Bars · Heatmap
  - *How are two things related?* Scatter · Correlation
- **Two layers:**
  1. **Suggested for your data** — live mini-previews rendered from existing bins/facets (nearly free; data already computed).
  2. **All chart types** — ~1 KB inline-SVG illustrations, no library.
- Tiles that don't fit the columns grey out with the reason ("needs 2 numeric columns").
- **Source selector on every card:** `Table (filtered)` | `View 1–5`. A card bound to a view reads that view's result; no raw-row path.
- Acceptance: a new user can create their first chart without reading a label; chart creation ≤ 2 clicks from the gallery.

---

## 5. Replacing Clean and Transform

The engine stays (null policy, KNN, melt, `combineDate`, fuzzy merge, `repairDecimal`). The shell changes.

1. **Column first, verb second.** Header click opens an inspector (profile + issues) with verbs in context: Trim, Case, Convert, Split, Round, Fill missing.
2. **Command bar (Ctrl/Cmd+K).** ~16 verbs (7 clean + 9 transform): `upper amount`, `split name on space`, `fill amount median by region`. Columns autocomplete as chips.
3. **One commit model.** Apply immediately, show an Undo toast, log to the Process Log. Hover shows a before → after strip of 5 sample values (replaces "Preview mode"). Only structural or expensive ops (melt, KNN, split) keep a preview card + Apply. This resolves `next_steps.md` §9 item 11 and §10.
4. **Show the damage.** After any op: changed cells highlight in the Table; counter "1,204 cells changed · rows 21,000 → 20,401"; a "Show changes" toggle highlights all cells modified since load.
5. **Triage queue.** Overview's health card becomes "7 issues found → Review all": checklist of fix chips (sentinels, decimal commas, trims, type conflicts, formula escape) with before/after samples and one Apply.
6. **Recipe as the spine.** Process Log is renamed Recipe, ordered, undoable, exportable as pandas (exists). Later: **Save recipe → replay on next month's export** (local JSON; header-name matching with a mapping step).
7. **Remove duplicate surfaces.** Drawers retire once 1–5 land. "Group by" moves to Views. The header ⋯ menu stays as the secondary path.

Acceptance: UPPERCASE a column in ≤ 2 interactions (from ~7); every applied op is undoable; no op ships without a visible changed-cell count.

---

## 6. Roadmap (rough estimates)

| Phase | Scope | Effort | Why this order |
|---|---|---|---|
| 0 | Nav cleanup: remove stepper from nav row; add **Recipe (N)** + **Export** buttons; `1–4` shortcuts | 1–2 days | Removes the two-nav confusion immediately; drawers keep working |
| 0b | Fix the 7 visual bugs in §10 (items 1–7) and re-order Overview (items 8–9) | ~1 day | Cheap trust wins; several are visible on first use |
| 1 | Chart tile gallery (static tiles + suggested row); Source selector stub = Table only | 3–5 days | Cheap, visible, independent of Views — can run in parallel with 2 |
| 2 | **Aggregate Views**: `getAggregate`, lens, builder, starter views, drill-down, Chart this, copy pandas | 1–2 weeks | Biggest analyst value; unlocks the Source selector |
| 2b | Generalised aggregation (§3.5): time grains, date parts, gap-fill, window ops | ~1 week | Time series is the common case; same engine as Views, so build it in |
| 2c | **Table archetype detection** (§11): "Looks like…" line, archetype-ranked Next steps and starter views | 3–5 days | Heuristics over stats the worker already has; reshapes everything downstream |
| 3 | Column inspector, command bar, instant-apply commit model, changed-cell highlight | ~1 week | Mostly wiring: instant path already exists for parameter-free ops |
| 4 | Triage queue; retire Clean/Transform drawers; "Use as dataset" bridge for group-by | ~1 week | Only once 2 and 3 cover everything the drawers did |
| 4b | **Reports lens v1 — Quality** (§12.1): schema health, category consistency, missingness by group, column usefulness, inferred constraints, each with a Fix | 1–2 weeks | Most primitives exist; the work is the shared Finding shape and UI |
| 4c | **Relationships** and **Anomalies** reports (§12.2–12.3) | 2–3 weeks | Reuses correlation, crosstab, box-stats and KNN machinery |
| 5 | Recipe save/replay; Slick-table export from a view | 1–2 weeks | Highest delight, needs column-matching rules |

## 7. Latency budget (additions)

| Operation | Budget |
|---|---|
| Active view recompute on filter keystroke (100k rows, ≤ 3 measures) | < 50 ms |
| Instant-apply of a cheap column op | < 500 ms (existing Clean/Transform budget) |
| Chart tile suggested-row previews | from cached bins; no new worker scan |
| Views at > 10k groups | top-N + Other; never block > 100 ms |

## 8. Success measures ("love" signals)
- Time from file drop to first chart from an aggregate view: **≤ 60 s**.
- Interactions for common value ops (case, trim, convert): **~7 → 1–2**.
- Share of applied operations that are undoable: **100%**.
- Repeat use: recipe replays per user (once Phase 5 ships).

## 9. Risks & open questions
- **Filter fan-out:** 5 views + N chart cards reacting to every keystroke. Mitigate by recomputing only the active view and visible cards, with the signature cache.
- **View cap of 5:** fine for v1; revisit if users hit it.
- **Group-by semantics change:** extending `groupBy` to multi-dim/multi-measure touches `transform-ops.ts`, `recipe.ts` and tests (`worker-transform.test.ts`, `transform-ops.test.ts`).
- **Instant-apply vs expensive ops:** needs a clear rule for what counts as "cheap" (suggest: < 500 ms estimated rebuild at current row count).
- **Selection/drill-down filters** must appear sensibly in the Process Log (likely manual, non-replayable).
- **Still unverified:** behaviour below ~1300 px width, the light theme, keyboard focus order, and measured contrast ratios.

---

## 10. Visual findings (screenshots, Citi Bike file, dark theme)

**Already good — keep and extend:** Overview "Next steps" cards with one-click actions (`6,717 cells hold placeholder text like "\N"` → *Convert to nulls*; *Chart starttime over time* → *Open Chart*); amber chips above column headers; hatched `\N` cells; the "Chart · 3 ideas" tab badge; density plot with contours, `r` annotation and query ms in the footer; right-aligned numbers. The Next-steps cards are the model for §5 (gesture, not mode).

### Bugs (fix first)
| # | Screen | Finding | Fix |
|---|---|---|---|
| 1 | Clean › Values | Button reads **"Add another"** with zero ops; the selected op isn't staged until clicked, so *Apply* stays disabled while the preview shows struck-through values identical to the new ones (`382 → 382`) | Rename to "Add"; auto-stage the selected op; no strikethrough when nothing changes |
| 2 | Chart › Box plot | Y ticks read "2k, 2k, 1.9k, 1.9k, 1.9k" (compact `k` formatting applied to years); title says "1 groups"; the *Customer* group (all birth years missing) silently vanishes, explained only by a footer note | Plain integers for integer columns in a narrow range; pluralise; show an empty-group row "Customer — no values" |
| 3 | Table headers | A column with two chips (*birth year*: empty cells + outliers) pushes its title and × lower than neighbours, so the header row misaligns | Fixed chip row, or merge into one "2 issues" chip |
| 4 | Clean › Nulls | "Columns: All columns" select is drawn red/pink like an error state; placeholder truncates ("treat as nul") | Neutral style; shorten placeholder |
| 5 | Transform | Both "No transforms — the data is unchanged." and "No steps yet." render; the native `<select>` list covers the hint text below it | One empty state; replace the select with a verb list (§5) |
| 6 | Chart › Correlation | X labels truncate to "start sta…" ×3 so columns are indistinguishable; ID columns (`start/end station id`, `bikeid`) are included though correlating identifiers is meaningless; matrix isn't centred (empty right third) | Rotate/abbreviate labels; exclude `identifier` type by default; centre |
| 7 | Clean › Column names | Empty bordered box under "No changes." looks broken | Hide until there is a preview |

### Hierarchy and IA
| # | Screen | Finding | Fix |
|---|---|---|---|
| 8 | Overview | The biggest element (~30% of height) is the missing-values block where 14 of 15 columns are solid blue; the most actionable element (*Next steps*) sits below it and *Explore the table →* is at the bottom | *Next steps* first; collapse missingness to one line + ranked bars when ≥ 99% complete |
| 9 | Overview KPI tiles | 3 of 4 tiles are amber, including "99.8% complete" | Reserve amber for things needing action |
| 10 | Clean | Opens on *Column names*; the real issue (6,717 `\N`) is on the third tab, *Nulls*. Each tab has a different footer (`Apply names` / `Apply to column` / `Apply nulls`) | Open on the tab with findings; retire tabs per §5 |
| 11 | Filters sidebar (Table, Chart) | Lists all 15 columns, each with a type select, a `1,234.56` format box and × — ~45 controls before any filter exists; mixes schema editing with filtering | Search + "Add filter" only; move type/format to the column inspector (§5.1) |
| 12 | Table | Numeric headers are left-aligned over right-aligned numbers; decimals vary (`40.7262807`, `40.72229346`, `40.7390169121`); row and header × icons (~50 destructive icons on screen) | Right-align numeric headers; per-column display format; show × on hover/select |
| 13 | Toolbar | Copy/Export are bottom-right on Overview but top-right on Table and Chart; the dice icon is unlabeled; stepper sits ~1,300 px from the tabs at low contrast | One consistent location; tooltip/label; see §2 |
| 14 | Naming | Table already has a **Tiles** button | Call the chart gallery "Chart types", or rename the existing button |
| 15 | Chart cards | Crowded toolbar (type, two selects with micro-caps labels, Duplicate, PNG, Settings, red ×) with the destructive × as prominent as the rest; titles repeat the file name; time series has no axis label or bin size; a "Scatter" card auto-renders density while the menu still says Scatter | Move Duplicate/PNG/× into a ⋯ menu; drop file name from titles; label the y axis ("Rows per day"); show "Scatter → Density (auto)" |
| 16 | Overview cards | ~10 px grey-on-dark text; stats truncate ("median 544 · m…", "Lafayette S…"); *gender* orphans onto a second row | Larger type, two-line stats, fixed column count; check contrast |

---

## 11. Table archetype detection ("what is this file?")

**Idea:** classify the table's structure at ingest and let it shape what the app offers next. It is a **lens on suggestions, never a gate**: nothing is hidden if the guess is wrong.

**Mechanics:** heuristic scoring in the worker over stats it already has (column types, cardinality, uniqueness, null rate, date monotonicity and spacing). Name tokens (`amount`, `qty`, `sku`, `debit`, `target`…) only boost the score, since headers are often messy. Cost < 20 ms. Returns the top two archetypes with confidence and the **evidence list**; below ~50% it says "General table". The user can override, and the override is saved in the Recipe.

| Archetype | Signals | Shapes the next steps |
|---|---|---|
| Time series | one date column, regular or unique, sorted; numeric measures; few categoricals | Daily/monthly views; gap and duplicate-timestamp checks; rolling average; change points; drift |
| Orders & transactions | unique id + date + amount/qty/price-like numerics + repeating customer/product keys | Revenue by month/category; top-N customers (Pareto); negative/zero qty and refund checks; group-relative outliers |
| Customer / entity records | one row per entity (unique email/id); mostly text/category attributes | Near-duplicate entities; category consistency (VIC / Victoria / Vic.); completeness by field; email/phone/postcode validity |
| Financial / accounting | debit/credit/amount/balance, account code, period/date, currency | Debits = credits and totals reconciliation; currency/unit consistency; sign checks; fiscal-period views; unusual postings |
| Inventory / operational | SKU/location keys + on-hand/reorder quantities; snapshots or movements | Stock by location; negative stock; zero-movement items; non-negative constraints; snapshot drift |
| Event / activity log | dense irregular timestamps, event/type category, user/session id, large row count | Events per hour/day; top event types; time between events; burst detection |
| Survey | many low-cardinality or ordinal columns (Likert, Yes/No), respondent id, free text, skip-logic missingness | Frequency per question; cross-tabs by segment; straight-lining; missingness by skip pattern |
| ML dataset | many numeric features + one low-cardinality or numeric target-like column; maybe a split flag | Class balance; relationships vs target; redundant/leaky features; constant and ID columns; drift between splits |
| Messy / semi-structured | header detection triggered, ragged rows, flattened JSON paths, mixed types, high issue density | Import repair first (headers, ragged rows, type conflicts), then re-classify |

**Shown on Overview:** one line under the file title, e.g. *Looks like: Event log · 78% — 2 timestamp columns, 224k irregular rows, 329 repeating station ids [wrong? change]*. It re-ranks the existing Next-steps cards (`NextStep.score` already ranks them), picks the starter Views and chart suggestions, and orders the Reports.

**Worked example (your Citi Bike file, to be verified):** likely *Event log* with a denormalised station dimension. Suggested: trips per day (time view), top start stations (rank), duration by user type (group), an anomaly report on `tripduration`, and a missingness-by-group finding. Your screenshots show 6,717 `\N` birth years, ~6.7k *Customer* rides and ~6.7k `gender = 0`; a co-missingness finding would probably report that these are the same rows.

**Risks:** a wrong guess erodes trust, so always show evidence and a one-click override and allow hybrids. Wide ML tables vs surveys are separated by the target-like column and ordinal low-cardinality columns.

---

## 12. Reports lens (5th tab): first-class, and they fix things

Reports are not an import-settings page. **Reports** is a lens with three tabs: **Quality · Relationships · Anomalies**. Keyboard shortcut `5`.

**One shared `Finding` shape** (build the engine once; each report is a producer):

```ts
interface Finding {
  id: string; report: string;                     // e.g. "quality.categoryConsistency"
  severity: "fix" | "review" | "info";
  title: string;                                  // plain-language sentence
  evidence: { metric: string; value: string; n: number }[];
  method: string; why: string;                    // detection method and reason
  rows: RowSelector;                              // click = filter Table; adds a "Why flagged" column
  impact: { rows: number; columns: number[] };
  fix?: { label: string; op: CleanOp | TransformOp };   // becomes a Recipe step with Undo
  dismissible: true;                              // "not a problem", remembered (see similar-dismissals.ts)
}
```
Findings are ranked by impact × severity × archetype relevance. They feed the **triage queue** (§5.5): review, tick, one Apply.

### 12.1 Quality reports
| Report | Discovers | Have today | New work | One-click fix |
|---|---|---|---|---|
| Schema health | wrong types, mixed date formats, numbers stored as text | type inference, type-conflict chip, date-order detection | format inventory per column ("62% dd/mm/yyyy, 31% ISO, 7% text"); currency/percent/thousands symbols | Convert to number/date; standardise to ISO |
| Duplicate analysis | exact, near-duplicate, likely same entity | exact dedupe (`rowHashes`) | near-duplicate clusters via blocking keys (phonetic, normalised) + similarity, capped | Review clusters, pick survivor, merge |
| Category consistency | VIC / Victoria / Vic. | fuzzy merge ("N mergeable"), phonetic | abbreviation and code dictionaries (states, countries), loaded lazily | Merge map with a chosen canonical value |
| Unit inconsistency | mixed currencies, 0.15 vs 15, "5 kg" vs "200 g" | none | bimodal-range detection (values in 0–1 and 1–100), unit/currency token parsing | Normalise to a chosen target unit |
| Missingness | by column, group, time, and **co-missing combinations** | per-column counts, row-block strip, null policy | by group/time, co-missingness ("missing together"), missing-vs-other-field association | Fill (impute exists), drop, or flag column |
| Constraint violations | negative qty, impossible dates, out-of-range, broken rules | outlier fences only | inferred constraints (non-negative, end ≥ start, duration ≈ end − start) + a rule builder | Filter violators; set null; clamp; flag |
| Join readiness | candidate keys, cardinality, unmatched keys, row multiplication | none | single-file: candidate keys, key null/whitespace/case hygiene; cross-file needs multi-file support (later) | Normalise keys |
| Data integrity | broken foreign keys, inconsistent totals, violated relationships | none | functional-dependency discovery (A → B with exceptions, e.g. station id → name/lat/lon); totals checks (debits = credits) | Show violators; set canonical value |
| Column usefulness | constant, near-constant, ID-like, redundant | "constant value" flag, identifier type | near-constant threshold, 1:1 redundant pairs, derived columns | Drop columns (undoable) |
| Distribution changes | shifts in ranges, category mix, missing rate | none | windowed comparison (PSI / KS / chi-square) over time, row order or split flag | Filter to a period; flag a regime column |

### 12.2 Relationship discovery
- **Methods, cheapest first:** Pearson (exists, ≤ 12 columns) → Spearman by ranks → **mutual information** from the existing 2-D density grid (non-linear) → Cramér's V for category × category (from `getCrosstab`) → correlation ratio η² for numeric × category (group stats) → **redundancy** (|ρ| > 0.95 or functional dependency) → **possible confounding** as Simpson-style sign flips of an X–Y association within strata of a third category, plus collinearity clusters.
- **Outcome mode:** "Explain [column]" ranks drivers by effect size and writes the sentence: *"Delivery time is more strongly associated with order size (ρ = 0.71) than with distance (ρ = 0.18)."* The outcome is auto-suggested for ML and transaction archetypes. Without an outcome, show the top 10 pairs by effect size, not all pairs.
- **Wording rules:** "associated with", never "causes"; always show n and effect size; use effect-size thresholds, not p-values (everything is "significant" at 224k rows); label as exploratory.
- **Budget:** sample ≤ 100k rows for MI, cap 20 columns (190 pairs), compute progressively.

### 12.3 Outlier and anomaly report
Four detectors; **every flagged row carries its method, score and a reason**:
1. **Univariate extremes** (exists: MAD / log / quantile fences) — add a "why" sentence.
2. **Group-relative:** value vs peers in the same category or period (robust z within group, min group size 30). *"These 23 transactions are unusually large relative to others in the same category."*
3. **Unusual combinations:** individually normal values that are jointly rare — kNN distance on standardised numerics (reuse `knn.ts`, sampled donors) and rare category pairs from the crosstab (observed ≪ expected).
4. **Time-aware:** spikes vs rolling median/MAD, level shifts, change points, distribution shift between windows.

Row reason example: *Amount 48,200 vs Electronics median 310 · robust z = 61 · method: group-relative.* **Actions:** filter to flagged, add a non-destructive **flag column**, exclude from Views, winsorise or null (Recipe step), export flagged rows with reasons. Say "unusual", not "wrong".

### 12.4 Where I'd push back
1. **Scope:** this is a product's worth of features. Ship **Quality v1 first**, because most primitives already exist; then Relationships and Anomalies.
2. **Relationship discovery needs an outcome** (or a top-N cap), otherwise all-pairs output is noise with multiple-comparison problems.
3. **Confounding can only be flagged, not proven.** Keep the claims to Simpson-style flips and collinearity.
4. **Join readiness and broken foreign keys across tables** need multi-file support the app doesn't have. Ship the single-table equivalents (candidate keys, dependency violations, internal totals) and plan multi-file separately.
5. **Near-duplicate detection** must use blocking and a cap, with a visible "approximate · analysed N of M rows" label (the backlog already notes fuzzy dedupe isn't O(n)-cheap).
6. **Latency:** reports run lazily and progressively after load in the worker and never block Table or Views; each carries a budget and an "analysed N of M rows" note.
