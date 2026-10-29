# TurboFuzz — Chart UX Spec: data-first builder + dynamic chart guide

**For:** Claude Code, working in `jay-stein/turbofuzz`
**Scope:** the Chart tab flow, the chart-selection guide, and the small bugs found on the way. Visual polish lives in `turbofuzz-polish-spec.md`; this spec only touches layout where the flow needs it.
**Evidence:** live review of https://turbofuzz.mrjaystein.workers.dev/ on 2026-10-27 (built-in browser, 1440x900, dark theme) with the reference datasets from `turbofuzz-test-data.js`, plus research into how Storytelling with Data, Tableau, Power BI, Data to Viz and the FT Visual Vocabulary guide chart choice.
**Companion files:** `chart-recommender.mjs` (reference implementation, 16 passing tests in `chart-recommender.test.mjs`).
I have not read the repo. Selectors and the column-profile shape are inferred from the live DOM and UI; adapt them.

---

## 0. TL;DR

1. **Your diagnosis is right.** Every route into charting starts by choosing a chart type, then a modal asks for fields, then the card lands at the bottom of the grid. Data comes last.
2. **Flip it:** ① pick the data (Source = Table by default, or a Pivot view; click fields, like Pivot) → ② see up to 3 recommended charts with a one-line reason each → ③ the chart appears at the top of the grid with a slim Customize drawer.
3. **The guide is a rules engine on column metadata, not a document.** It already exists in embryo ("Suggested for your data"); it needs to rank by selected fields, explain itself, and warn about bad choices. The reference module is 5.1 KB gzipped minified and ran `quickStarts()` on a 71-column table in about 0.3-0.4 ms (Node).
4. **Keep chart type as a secondary path**, filling the same field slots. Pure data-first slows people who already know the chart they want.
5. **One bug to fix first:** the top suggestion on time-series data ("units over time") draws an empty card. Details in C3.

---

## 1. Goals and constraints

- **Data first.** The user's first decision is *what are we looking at*, not *which chart*.
- **Fast by default.** The guide must not slow first paint, chart creation, or the 250k-row case. No network, no model, no dependencies. Budgets in section 6.
- **Explain, don't just suggest.** Each recommendation carries one sentence of why. Warnings are specific to the user's data ("40 bars is hard to read"), not generic.
- **Analyst stays in control.** Nothing is hidden or locked; poor-fit fields are listed lower with a reason, and an explicit chart choice is never overridden.
- **Original wording.** The research below informs the rules. Do not copy guide text from Storytelling with Data or any other source; link to them instead.

---

## 2. Research: what the experts do

| Source | What it does | What we take | What we leave |
|--------|--------------|--------------|---------------|
| **Storytelling with Data (Knaflic)**: chart guide plus articles on bars/lines, bar charts, dot plots, slopegraphs, pies | Starts from the *message* and audience, not the chart. Bars for categories and absolute values, from a zero baseline, sorted by value unless the categories have a natural order. Lines only for ordered data (time); a line across unordered categories implies a relationship that is not there. Slopegraph for exactly two points per series. Dot plot for small distributions or comparisons where a zero baseline is not needed; connected dots for before/after. Pies discouraged; when part-to-whole matters, a 100% stacked horizontal bar. Stacked bars compare totals well but not sub-components. "Test several views." | The rule set in section 5, the zero-baseline and sorting defaults, "no pies", and offering 2-3 options with trade-offs. | Her audience/narrative inputs (we do not know the audience); verbatim text. |
| **Storytelling with Data on AI chart choice** | Inputs are message, data, audience, context. Ask for 2-3 options, ask what each makes easy to see and what it obscures, then the human chooses. Favour familiar chart types. | "2-3 options + a reason + the user decides" as the UI shape. | The chat workflow. |
| **Tableau Show Me** | Field-first: select fields, then Show Me offers chart types that fit; one recommended type is outlined; hovering shows minimum requirements. Newer versions can start from the data source and "Choose for me". | Field-first flow, one marked recommendation, visible requirements per chart. | The dense chart-type grid. |
| **Power BI** | Either order: pick fields or a visual first. A "Suggest a type" toggle changes the visual as you add fields, and turns off when you pick a type yourself. | Both entry orders; the lock-on-explicit-choice rule. | Auto-switching without a lock (confusing). |
| **FT Visual Vocabulary** | Seven relationships: deviation, correlation, ranking, distribution, change over time, magnitude, part-to-whole. | Question-style grouping (the app's gallery already groups by question). Add *part-to-whole*. | |
| **Data to Viz** | Groups charts by dataset format; the data *and* the goal decide; the tree narrows options, the analyst tries the feasible ones; a caveats section for common pitfalls. | Narrow to feasible options by data shape; attach pitfalls to charts. | The full decision-tree poster. |

**Reading notes (honesty about coverage).** The Storytelling with Data chart-guide page lists 21 chart types by name only; the guidance sits in linked articles. I read the articles for bars vs lines, bar charts, dot plots, slopegraphs, pie alternatives and AI chart choice, not every chart in the guide. The Data to Viz entry above is from a third-party write-up of it, not the site itself. The FT Visual Vocabulary entry comes from the European data-visualisation guide's summary of it.

---

## 3. Current state (evidence)

### 3.1 What already works (keep)

- The chart gallery is grouped by question ("What is the headline number?", "How is it distributed?", "How do groups compare?", "How are two things related?"…), with unavailable types greyed with a reason ("needs a text column", "needs a latitude/longitude pair").
- A **Suggested for your data** row already exists at the top of the gallery.
- Pivot view has the right pattern: Rows / Columns / Values / Filters zones, "click a field below or drag it", auto-titled ("Sum of units by region"), plus a **Chart this** button.
- Time series Calc options (rolling mean, cumulative, difference, % change, % of total, rank, year-over-year) are strong. Count plot already has "Top bars 10 / Group rest as Other".

### 3.2 Problems

| ID | Finding | Evidence |
|----|---------|----------|
| C1 | **Type-first everywhere.** Rail, "+ Add chart" and the suggestions all open an "Add a <type> chart" modal; none creates a chart directly. | Tested 15 enabled gallery entries (3 suggestions + 12 types): all 15 opened a modal with 1-3 field selects (Time series: Date only; Treemap: Group by, Size by, Aggregation). Gallery popover is 540x880 px at 1440x900, nearly the full viewport height. |
| C2 | **Suggestions are formulaic and unexplained.** Always three, text-only, no thumbnail or reason; they appear to take columns in file order. | Dataset A: "units over time / units by region / Distribution of units" (picks `units`, the earlier column, over `revenue`; `region` over `product`). Customers (400 rows): "balance over time / balance by city / Distribution of balance". Wide (500 rows x 14): "f1 by batch / Distribution of f1 / f1 vs f2". |
| C3 | **Bug: the top suggestion on time-series data draws an empty card.** | Dataset A, Chart tab, "+ Add chart" > "units over time" > Add chart. Card shows "Aggregate · waiting for the first result" and "The aggregate has no groups to draw yet." Reproduced twice (once from a clean reload with a single add and a 3 s wait). Console is empty. Switching *Time resolution* from Auto to Month immediately draws a 24-point line. Cause not investigated; passing an explicit resolution avoids it (CH-0). |
| C4 | **Source choice is hidden and inconsistent.** It exists only inside per-chart Settings after creation. For a chart made via Chart this, the Source and Chart type selects show blank. | Source options listed only `Table`. Chart-this card header says "Count plot from View" while its orange badge says "Table · Whole dataset (730 rows)" and the plot is a sum-by-region bar. |
| C5 | **New charts land out of sight.** | "+ Add chart" appends at the end of the grid; the status text says so ("it sits at the end of the grid"). After Chart this, the user arrives on the Chart tab looking at the older chart; the new one is below the fold. |
| C6 | **Field lists are unfiltered and unranked.** | Barplot "Category" lists region, product, `units` (51 distinct values), discount_pct; Box plot "Group by" and Heatmap "Rows/Columns" also list numeric columns (e.g. `units`, which is also a Box plot Values option). Lists follow file order: no role icons, no "suggested first", no cardinality hint. (A histogram of a date column is valid, so that is not a problem.) |
| C7 | **Configuration is split two ways.** | Treemap's modal asks for Aggregation; Barplot and KPI modals do not. The suggestion "units over time" opens a modal showing only Date, then plots *Sum of units*: the measure and aggregation are invisible. |
| C8 | **Card layout is heavy.** | Settings column takes about a quarter of the card width at 1440 px; a time series shows Chart type, Source, Date, Time resolution, Sort, Value, Aggregate, Group by, Calc, then Chart filter, filter value, colour controls. The card shows a heading ("Time series: Sum of units by order_date from Table") *and* a generic inner title ("Aggregate"). |
| C9 | **Two lists of the same 14 types** (the left rail and the gallery). | |
| C10 | **Chart this picks a misleading type label.** | Sum-by-region pivot became "Count plot". |
| C11 | **Possible overlap.** Colour-swatch row from a lower card paints over the sticky "+ Add chart" bar while scrolling. | Seen twice; cause unconfirmed (low confidence). |

### 3.3 Not reviewed

Chart tab at phone width and in light theme, chart types other than Histogram, Time series, Barplot, Scatter and Count plot (via Chart this), Animate/Export, the PNG export, performance of chart creation at 250k rows. Source code.

---

## 4. Proposed flow

### 4.1 States

**State A: Builder (default when the Chart tab has no charts; collapsible once it has)**

```
┌ CHART ─────────────────────────────────────────────────────────────────────┐
│ 1  DATA   Source  (o) Table · 730 rows    ( ) View: Sum of units by region │
│                   [x] Respect table filters (2 active)                     │
│    Fields                                    Selected                      │
│    ┌─────────────────────────────────┐       [ order_date  time     x ]    │
│    │ T  order_date     730 distinct  │       [ revenue  Σ Total v   x ]    │
│    │ #  revenue        228 - 15.1k   │       roles: T time  C category  # measure
│    │ #  units          15 - 65       │                                     │
│    │ C  region         4             │                                     │
│    │ C  product        3             │                                     │
│    │ C  discount_pct   5   (0 - 20)  │                                     │
│    └─────────────────────────────────┘                                     │
│    Quick starts:  [ Total revenue by month ] [ Total revenue by region ]   │
│                   [ units vs revenue ]                                     │
│                                                                            │
│ 2  CHART  Recommended for these fields                    More options (3) │
│    ┌────────┐ ┌────────┐ ┌────────┐                                       │
│    │  line  │ │  KPI   │ │  bars  │   "Revenue by month: the line shows   │
│    │ BEST   │ │        │ │        │    the trend."                        │
│    └────────┘ └────────┘ └────────┘                                       │
│    Not available: Map (needs latitude and longitude columns)              │
│    or choose a chart type first >                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

**State B: Chart created.** The builder collapses to one line, so the chart gets the space; the new card appears **at the top** of the grid, scrolled into view, highlighted for about 1.2 s, with an Undo toast.

```
 Table · order_date, revenue (Total) · Line v   [ Edit data ] [ Customize v ] [ Guide ]   [ + New chart ]
 ┌ Total revenue by month ───────────────────────────────────────────────┐
 │  (chart, full card width)                                              │
 │  note: nothing to flag                                                 │
 └────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Interaction rules

1. **Source.** Segmented control: `Table (n rows)` first and selected, then each Pivot view by its auto title (about 5 at most). Choosing a view swaps the field list to the view's output: row fields become category/time, value fields become measures, and aggregation is `none` ("as in view").
2. **Fields.** Click to add or remove; max 4 on the shelf (beyond that, a note says to keep the 2-3 that carry the message). The list shows a role glyph, distinct count or range, and null %, ordered time > measures > categories (toggle for file order). Reuse Pivot's field-list component.
3. **Roles.** Detected from the column profile. Click the glyph to override (an integer `year` is treated as time; a 5-level integer like `discount_pct` is a category but can be a measure). ID-like columns are shown dimmed and never charted ("use for counts").
4. **Aggregation chip** on every measure, visible, not buried: Total / Average / Median / Min / Max / Count distinct. Defaults from the name: percentages, rates, prices, ages and unknown names default to **Average**; revenue, units, fare, balance default to **Total**. Warn when the choice looks wrong.
5. **Quick starts (up to 3).** Replace today's three "Suggested" labels. One click selects the fields *and* creates the chart (no second confirmation). Chosen by role and name hints, not file order, and never an ID/email/phone.
6. **Recommended tiles.** Up to 3 primary (first marked BEST) plus "More options". Each tile: thumbnail, name, one-line why. Click creates the chart immediately with sensible config; there is no modal. Not-possible types show the reason ("needs latitude and longitude columns").
7. **Chart type first (secondary).** "Or choose a chart type" opens the existing question-grouped gallery. With an empty shelf, the shelf turns into labelled slots for that type (Barplot: *Category*, *Measure*), each with a filtered field list (suggested fields first, other columns below with a reason). With fields already chosen, they are mapped to slots and the empty slot is called out.
8. **Explicit choice locks.** Once the user picks a type, adding fields does not switch it (Power BI's rule).
9. **Chart this (from Pivot).** Source = that view, fields preselected, top recommendation applied, new card at the top and scrolled into view: the same path as a quick start.
10. **Customize drawer** (replaces the always-open Settings column): Data (source, fields, aggregation, resolution, chart filter), Look (colour, sort, labels), Export. Opens beside or over the card; the chart keeps at least 80% of the card width when closed.
11. **Keyboard.** Type to search fields; Enter adds; `G` opens the Guide; the command bar understands `chart <measure> by <category>`.

### 4.3 Edge cases to handle

- **View with a cross-tab** (Rows and Columns set): treat the column field as a second category; the recommender gives heatmap / grouped bars.
- **Views are already aggregated:** never re-aggregate (reference: `source: 'view'` returns `agg: 'none'`).
- **Table filters active:** keep the "respect table filters" toggle visible with the count.
- **Selection no chart can draw** (e.g. three categories): say why and what to change, never an empty gallery.
- **Large tables (250k rows):** the recommendation panel appears from column profiles alone; no aggregate is computed until a tile is clicked. Scatter on large n recommends density first.

---

## 5. The dynamic Chart Guide

Three layers, cheapest first. All use the same registry (section 6.2).

### 5.1 Layer 1: Recommendations (always visible)

Computed from the **selected fields' roles** and the dataset size. Deterministic, order-stable, explained. Rule table (implemented and tested in `chart-recommender.mjs`):

| Selection (roles) | Primary | Alternatives | Notes shown |
|-------------------|---------|--------------|-------------|
| 1 measure | Histogram | Box plot, KPI | |
| 1 category | Count plot (sorted) | Treemap when many categories | "Top 10 + Other" for > 12 |
| category + measure | Bar (sorted, zero baseline) | Dot plot* (many categories), Box plot (enough rows per group), Treemap (additive, many) | Horizontal when many or long labels |
| time + measure | Line, explicit resolution | KPI + trend, Bar when ≤ 12 periods | Resolution chosen for 12-60 points |
| time + measure + category (≤ 5) | Multi-line | | |
| time + measure + category (6-12) | Small multiples* | Lines, highlight one and grey the rest | |
| time + measure + category (> 12) | Top 5 lines | | "Only the top 5 are drawn" |
| time + 2-3 measures | Lines | Small multiples* | "Different scales: index to 100 or use panels, not a second axis" |
| 2 measures | Scatter (Density when n > 5,000) | Density / Scatter | |
| 2 measures named lat/lon | Map | | |
| 3 measures | Bubble | Scatter, Correlation | |
| ≥ 4 measures | Correlation | Scatter of the first pair | "Showing the first 12" |
| 2 categories | Heatmap | Grouped bars (≤ 4 levels), 100% stacked bar* (≤ 6) | |
| ≥ 3 categories | Heatmap of the first two | | "Filter on the third instead" |
| 1 text column | Top terms | | |

\* = a chart type the app does not have yet (section 8). Until added, hide the tile or show it disabled with "coming soon" (decision D3).

**Quick starts** pick, by score: the best time column (most distinct), the best measure (money words first, then other additive, then rates; more variety; fewer nulls), and the best category (3-12 levels, status/type/region-like names, few nulls; not names, emails or phones). Outputs per dataset (from the reference tests):

| Dataset | Quick start 1 | Quick start 2 | Quick start 3 |
|---------|---------------|---------------|---------------|
| A sales time series | Total revenue by month (line) | Total revenue by region (bars) | units vs revenue (scatter) |
| B messy customers | Total balance by week (line) | Total balance by city (bars) | age vs balance (scatter) |
| C 250k trips | Total fare by day (line) | Total fare by zone (bars) | distance_km vs fare (density) |
| D 71-column ML | Average feature_01… by week (line) | Average feature_01… by batch (bars) | Which measures move together (correlation) |

IDs (`customer_id`, `email`, `phone`, `trip_id`, `sample_id`) are never chosen.

### 5.2 Layer 2: Guide drawer (on demand)

Right-hand drawer (360 px, ≥ 1280 px wide; bottom sheet below that). Opened by **Guide** or `G`. Two tabs:

- **For your selection:** each recommended and alternative chart with a mini diagram, *Use when*, *Watch out*, up to 3 *Design tips*, and **Needs vs You have** ("Needs: 1 time + 1 measure. You have: order_date ✓, revenue ✓"). A short "Not offered" list explains why (no pies: parts are hard to compare; use bars or a 100% stacked bar).
- **By question:** the app's existing question groups plus *What makes up the whole?* and (later) *How did it change between two points?*. Each chart carries an availability badge for the current data: "available", or "needs a time column".
- Footer: "Learn more" links to external guides (open in a new tab with `rel="noopener noreferrer"`, only on click, so the page still makes zero requests by itself).

Copy rules: original wording, plain language, under about 45 words per chart, no jargon. Write it as data (`guide.json`) so it can be edited without touching code.

### 5.3 Layer 3: Chart notes (small, specific, after creation)

At most two one-line notes under the chart, dismissible, driven by `lint()` in the reference module:

- Summing a column that looks like a rate or percentage: "discount_pct looks like a percentage. Summing it rarely makes sense; use Average."
- Bars not starting at zero: "Bars must start at zero or their lengths mislead. Consider a dot plot."
- More than 12 bars: "40 bars is hard to read. Show the top 10 and group the rest as Other."
- More than 5 lines: "7 lines tangle. Use small multiples, or highlight one line and grey the rest."
- A line on an unordered category axis: error, "A line needs an ordered x-axis (a date). Use bars for categories."

Note names are matched as whole words (so `duration` is not read as `ratio` and `discount` is not read as `count`): a bug the reference tests caught.

---

## 6. Architecture and performance

### 6.1 Principles

- **Metadata only.** The recommender reads the per-column profile the app already computes at import (type, distinct count, null %, min/max). It never scans rows and never renders.
- **No dependencies, no network, no model.** Rules are plain functions plus a small table.
- **Lazy where it can be.** Guide copy and thumbnails load on first Guide open or first Chart-tab visit (prefetch on idle after the first chart). Recommendation tiles use static inline SVG.
- **One registry.** A single `CHARTS` table (slots, accepted roles, optional/required, label) drives: gallery enable/disable and reasons, field lists per slot, the "Needs" line in the Guide, and the builder's slot labels. This also fixes C6 and C7.

### 6.2 Registry shape (see `CHARTS`, `fieldsFor()`, `availability()` in the reference)

```js
barplot: { label: 'Barplot', slots: [
  { name: 'Category', kinds: ['cat'] },
  { name: 'Measure',  kinds: ['measure'] } ] }
```

`fieldsFor(chartId, slotIndex, columns, nRows)` returns `{ suggested, other }`; `other` entries carry a reason ("51 distinct values: too many groups"). Nothing is hidden.

### 6.3 Reference module facts

| Fact | Value | How measured |
|------|-------|--------------|
| Size | 20.6 KB source; 5.1 KB gzipped when minified with esbuild (includes registry, quick starts, lint) | `wc -c`, esbuild `--minify`, `gzip -9` |
| Speed | `quickStarts()` on a 71-column table: about 0.3-0.4 ms per call | 200-iteration loop in Node, this container (not a browser measurement) |
| Tests | 16 passing: roles, resolution, whole-word hints, every rule family, IDs, views, lint, field lists, availability, speed | `node --test chart-recommender.test.mjs` |

### 6.4 Budgets (targets for the repo; measure the baseline first)

| Item | Budget |
|------|--------|
| Recommender + registry JS | ≤ 6 KB gzipped |
| Guide copy (lazy chunk) | ≤ 4 KB gzipped; loads on first Guide open or idle |
| Thumbnails | inline SVG sprite, ≤ 6 KB raw; no raster images |
| `recommend()` / `quickStarts()` | ≤ 2 ms for 100 columns, main thread |
| Builder open (Chart tab visit) | ≤ 50 ms; quick starts cached per dataset version |
| Tile click to first chart painted | no slower than today's Add chart to paint (+10% at most); record the current figure first, it was not measured here |
| Network | 0 requests; keep the on-page "0 network requests" claim true |
| Memory | profile objects only; no copies of row data |
| 250k-row table | recommendations visible before any aggregate runs |

---

## 7. Work items

### P0: do first

| ID | Change | Acceptance |
|----|--------|-----------|
| **CH-0** | Fix the blank suggested time series (C3). Always pass an explicit time resolution (`autoResolution(spanMs)`: smallest unit with ≤ 60 points, never fewer than 12 where avoidable). Also find out why Auto produced no groups. | Dataset A: "units over time" draws a 24-point monthly line in ≤ 1 s with no "waiting"/"no groups" state; dataset C draws daily points; Auto works when chosen manually. |
| **CH-1** | Add the `CHARTS` registry with roles and slots, and use it for gallery availability and field lists. | Barplot Category on A suggests region, product, discount_pct and lists `units`/`revenue` under "Other" with a reason; same for Box plot Group by and Heatmap. |
| **CH-2** | Build the data-first Builder (State A/B): Source, field list with roles, shelf, aggregation chip, quick starts, recommended tiles. Remove the add-chart modal. | From the Chart tab on any dataset: chart on screen in ≤ 2 clicks (quick start), ≤ 3 clicks (fields + tile). No modal between selecting a tile and seeing the chart. |
| **CH-3** | New cards go to the **top**, scroll into view, highlight briefly, show an Undo toast. Same for Chart this. | After Chart this the new chart is in the viewport without scrolling. |
| **CH-4** | Fix source labelling for view charts: Source lists Table and each view and shows the current one; Chart type shows the real type; heading and badge agree ("Barplot from view: Sum of units by region · 4 groups"). | No blank Source/Chart type selects; no "Count plot" label on a sum-by-region bar. |

### P1: next

| ID | Change | Acceptance |
|----|--------|-----------|
| **CH-5** | Integrate the recommender: tiles with thumbnails and the one-line why, quick starts replacing the formulaic suggestions. | Quick-start table in 5.1 reproduced on datasets A-D; no ID/email/phone ever suggested. |
| **CH-6** | Guide drawer (For your selection / By question), `guide.json` lazy-loaded. | Opens in ≤ 50 ms after first load; "Needs vs You have" correct for the current selection; zero requests. |
| **CH-7** | Card redesign: Customize drawer instead of the permanent Settings column; remove the generic inner "Aggregate" title; chart gets ≥ 80% of the card width. | Visual check at 1440x900 and 1024x768; title appears once. |
| **CH-8** | Chart notes (`lint`) and aggregation defaults (Average for rate-like). | `discount_pct` sum shows the percentage note; bars from a non-zero baseline show the baseline note. |

### P2: later

| ID | Change |
|----|--------|
| **CH-9** | New chart types (section 8). |
| **CH-10** | Optional editable takeaway title computed from the aggregate result, e.g. "East leads at 6,886 (27% of total)". Off by default. |
| **CH-11** | Decide linked vs snapshot semantics for view charts and show a "source changed" badge if linked (D1). |
| **CH-12** | Retire the duplicate left rail; the gallery lives under "Choose a chart type". |
| **CH-13** | Investigate and fix the swatch-over-toolbar overlap (C11). |

---

## 8. Chart types to add (in value order)

The app has 14 types. Knaflic-style guidance leans on a few it lacks. Add only what the engine renders cheaply; each should be small (reuse the bar/line drawing code).

1. **Dot plot** (Cleveland): many categories or no zero baseline; connected dots for two points.
2. **100% stacked horizontal bar**: the recommended part-to-whole alternative to a pie.
3. **Small multiples**: the answer to "too many lines".
4. **Slopegraph**: exactly two points per series (before/after).
5. **Waterfall**: commonly used in finance reporting; fits your analytics/finance audience (my suggestion, not from the guide research).

**Do not add pies.** The guidance consistently discourages them; the recommender never offers one, and the Guide explains why.

---

## 9. Test plan

Load datasets with `TF_TEST.load('A'|'B'|'C'|'D')` (`turbofuzz-test-data.js`).

| Check | Dataset | Expected |
|-------|---------|----------|
| Quick starts match section 5.1 | A, B, C, D | Titles and chart types as tabulated |
| Suggested time series draws | A, C | Line with explicit resolution; no empty state |
| Source = Table by default; views listed after "Chart this" | A | Table selected; view appears with its title |
| Fields filtered by slot | A | Barplot Category: region, product, discount_pct suggested; units, revenue under "Other" with reason |
| IDs never suggested or charted | B, C, D | customer_id, email, phone, trip_id, sample_id absent from quick starts; note shown if selected |
| Overplot guard | C | distance_km vs fare recommends Density first, Scatter second |
| Percentage aggregation | A | `discount_pct` defaults to Average; Sum shows the note |
| Too many lines | custom: time + measure + 8-level category | Small multiples (or disabled with "coming soon") |
| New card placement | any | At top, in viewport, highlighted, Undo available |
| 250k rows | C | Recommendations visible before any aggregate; tile click to chart painted: record the time and compare with today's |
| No network | any | Zero requests from Builder and Guide |
| Keyboard | any | Field search, Enter to add, `G` opens Guide |

Run the reference tests in CI: `node --test chart-recommender.test.mjs`.

---

## 10. Decisions for you and risks

**Decisions**

- **D1. Linked or snapshot view charts?** If a chart references a view and the view changes or is deleted: update live (with a "linked to view" chip) or freeze? I recommend linked, with "source removed" handling.
- **D2. Should quick starts create the chart in one click?** I recommend yes (fastest path; Undo covers mistakes).
- **D3. Tiles for chart types you do not have yet:** hide them, or show disabled with "coming soon"? I recommend hide until built.
- **D4. External "Learn more" links** (Storytelling with Data, Data to Viz): include as click-only links, or keep the app fully self-contained?
- **D5. Which new chart types**, and in what order (section 8)?

**Risks**

- The reference assumes a column-profile shape (`type`, `distinct`, `nullPct`, `min`/`max`, optional `avgLen`/`ordinal`) and date min/max as epoch milliseconds. Adapt to the real objects.
- Name hints are English-centric and heuristic. The visible aggregation chip and role override are the safety net.
- Everything depends on correct type inference (integer-coded categories, year columns, near-unique IDs). Misclassification produces confident wrong tiles, so keep role glyphs clickable.
- If the registry is not shared with the renderer, the two will drift. Make the registry the only place chart requirements are declared.
- Not measured: real chart-creation latency, phone-width behaviour of the Chart tab, light theme, other chart types' settings panels. The budgets in 6.4 are targets, not results.

---

## 11. Sources

- [Storytelling with Data: chart guide](https://www.storytellingwithdata.com/chart-guide) (lists 21 chart types by name)
- [When bars win, and when lines do](https://www.storytellingwithdata.com/blog/when-bars-winand-when-lines-do)
- [What is a bar chart?](https://www.storytellingwithdata.com/blog/2020/2/19/what-is-a-bar-chart)
- [Alternatives to pies](https://www.storytellingwithdata.com/blog/2014/06/alternatives-to-pies)
- [What is a dot plot?](https://www.storytellingwithdata.com/blog/2020/12/9/what-is-a-dot-plot)
- [What is a slopegraph?](https://www.storytellingwithdata.com/blog/2020/7/27/what-is-a-slopegraph)
- [How to use AI to choose the right chart](https://www.storytellingwithdata.com/blog/swd-ai-choose-an-appropriate-visual)
- [Tableau: Use Show Me to start a view](https://help.tableau.com/current/pro/desktop/en-us/buildauto_showme.htm)
- [Power BI: on-object interaction](https://learn.microsoft.com/en-au/power-bi/create-reports/power-bi-on-object-interaction)
- [From Data to Viz (R-bloggers write-up)](https://www.r-bloggers.com/2018/07/from-data-to-viz-find-the-graphic-you-need/)
- [EU data visualisation guide: choosing charts, the message](https://data.europa.eu/apps/data-visualisation-guide/choosing-charts-the-message) (summarises the FT Visual Vocabulary)
