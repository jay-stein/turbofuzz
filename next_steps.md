# TurboFuzz — UX workflow review & next steps

> Scope: the proposed `Load → Clean → Transform → View/Visualise → Export` flow.
> Prime directive: **lightning-fast, low-latency, minimal bloat**. Everything below is
> judged against that.

---

## 1. Verdict on the proposed flow

The five-stage mental model is **correct** and worth building toward. But the
proposal has one structural risk and two naming traps that, if built literally,
would *hurt* the latency story instead of helping it:

1. **"Clean" and "Transform" are not just new screens — they are a step change in the
   data model.** The codebase today is built around an **immutable `Dataset`** derived
   once at ingest (`src/data/build.ts`). Every feature — search, fuzzy index, ranges,
   facets, histograms, QA toggles, duplicate detection, anomaly detection — is derived
   lazily from per-column `raw` string arrays and cached (`src/data/column.ts`).
   A "Clean" or "Transform" step that edits cell values means either rebuilding that
   whole graph or introducing a derivation layer. This is the single most important
   architectural decision, and the rest of this doc is built around it.

2. **"Clean" is largely already done — don't rebuild it, surface it.** Null detection
   (`'null'`, `'N/A'`, `'NA'`, `'—'`, `'#N/A'`, `'undefined'`, etc.) already exists in
   `src/parse/null-tokens.ts` and already feeds `nullMask`, `stats.nulls`, and the
   "Nulls" QA toggle. What's genuinely *not* done is **standardisation /
   normalisation of retained values** (case, whitespace, casing conventions, header
   cleanup). That is the real Clean work.

3. **Do not split Filter out of View.** Filtering is currently woven *into* View (the
   sidebar filter panel drives live facets + filtered histograms in the same frame,
   `src/ui/app.ts` + `src/worker/search.worker.ts`). Pulling Filter into its own stage
   would break the "type → instant result" loop that is the product's core. Keep
   Filter + View as one stage.

4. **Visualise should be a *view mode*, not a separate screen.** A chart of the
   current result set only makes sense *with the filters active*. Charts should live
   inside View (a tab or split), not a destination that loses filter context.

---

## 2. Critical review, stage by stage

### Load — done

Well covered: paste, file, URL, archives (zip/gz/bz2), xlsx/xls, header detection,
type inference, plus:

- **Delimited `.txt` / `.dat`** — same auto-delimiter path as CSV.
- **JSON / JSONL / NDJSON** — array of objects (nested objects flattened to dotted
  paths), array of arrays, JSONL records and pandas-style column-oriented objects.
  Pasted JSON is sniffed when the delimiter is auto.
- **Parquet** — flat primitive columns read via `hyparquet`, decoded lazily inside
  the worker so the reader is code-split and never touches the core bundle.

Deliberately **not** supported: **HDF5 (`.h5`/`.hdf5`)** — a complex, non-tabular
container with immature JS tooling; the app rejects it with a clear message and
suggests exporting to CSV or Parquet first.

### Clean — detection is done; standardisation is the gap

What already works:

- `isNullToken()` (`src/parse/null-tokens.ts`) collapses the "string null" problem at
  ingest time — before any index is built. This is the *correct* place for it, because
  it keeps one null semantics everywhere downstream.

**Per-column null review (done):** Clean → Nulls lists the exact distinct values each
column treats as missing with counts, so false positives (a town called `NULL`, a state
abbreviated `NA`) can be un-nulled, and custom sentinels (`-999`) can be added. The
policy is exact-match and per column, threaded through inference, categories, numeric
stats, anomalies, cell styling and transforms, and lives in the non-destructive clean
state (rebuild + carry specials), so it composes with value cleans and reverts.

What to add (the actual work):

| Feature | Where it fits | Difficulty | Latency risk |
|---|---|---|---|
| Header normalisation (snake/camel, trim, strip brackets, dedupe names) | header-only, no index rebuild | trivial | none |
| Trim / strip whitespace (stored value) | column op | easy | none (rebuild column) |
| Case normalisation (upper/lower/title) | column op | easy | none |
| Standardise categorical values ("ACTIVE"→"Active") | column op | easy | none |
| Null-token remap (treat `-999`/custom tokens as null) | column op, per-column | medium | none |
| Convert stored value ("1,234" → 1234; dates to ISO) | column op | medium | none |

**Key design rule:** Clean must be **non-destructive and reversible**. Implement it as
a list of per-column *operations* applied to produce a derived column, never as
in-place mutation of `raw`. This gives you undo/redo, a live "before/after" preview
(on a sample), and cache invalidation for free.

### Transform — native group-by first, escape hatch later

What's cheap and should be built natively (all are O(n) scans over columnar arrays,
comfortably <100ms at 100k rows):

- **Deduplicate** — exact dedupe is already computed at ingest
  (`src/data/stats.ts`: `rowHashes` + `duplicateBits`). Expose it as an *action*
  (keep first / keep last / drop all duplicate rows) producing a new dataset. Note:
  the existing "Duplicates" QA toggle intentionally shows *all* copies for
  comparison — keep that, and add "remove" as a separate transform.
- **Group-by aggregate** — trivial given `ColumnData.numbers()` and
  `categories()`. dimension column + measure column → grouped sum/mean/count/min/max/
  median. This covers 80% of real transform demand.
- **Round / column maths** — round a column to N decimal places, including negative
  values: `-1` → nearest 10, `-2` → nearest 100, `-3` → nearest 1000. Lives in
  **Transform, not Clean**, because it is column maths rather than string
  standardisation. Implementation: `factor = 10 ** -decimals; Math.round(v / factor) * factor`
  (positive decimals should format via `toFixed` to keep consistent precision); leave
  non-numeric cells untouched.
- **Impute missing values** — constant / mean / median / mode / forward / backward,
  each with an optional group column (e.g. fill missing sales with the median *within
  each city*). O(n), deterministic, rebuilds the column like any other op. Null
  detection already comes from `isNullToken`, so the QA null count drops afterwards.
- **KNN impute** — numeric columns only. **Fill** columns are the targets; **predictors**
  are the columns used to measure similarity (not modified), so a single column can be
  filled from related columns. Donors are rows complete across both sets, distances are
  standardised, nan-euclidean (scaled by observed dims), and cells take the
  distance-weighted mean of the k nearest donors, with a median fallback when donors are
  scarce or a row has no observed predictor. Deterministic and capped at 20k donors by
  strided sampling.
- **Not doing: MICE / IterativeImputer** — it is iterative regressions over every
  feature and needs a linear-algebra stack; slow at 100k rows and against the
  fast/no-bloat goal. Park it behind the same lazy "Advanced" door as DuckDB-Wasm if
  it is ever genuinely needed.
- **Melt (wide → long)** — pandas-compatible params: `id_vars`, `value_vars`
  (default: every non-id column), `var_name`, `value_name`. The old column names
  become values in the `var_name` column; row order is variable-major, matching
  pandas. Capped at 2M output rows so a runaway melt errors instead of freezing.
- **Pivot (long → wide)** — still deferred; needs distinct-value discovery per key
  column and collision handling.

What to **defer or make opt-in**:

- **Joins, window functions, multi-dataset transforms** — this is where
  `DuckDB-Wasm` / `Polars-Wasm` genuinely pay off (the plan already says so). But they
  are heavy dependencies. **Recommendation: ship native group-by/dedupe/melt now, and
  add DuckDB-Wasm later as a lazily `import()`-ed "Advanced" mode** so it never bloats
  the initial bundle. Do not introduce a 5–10 MB WASM dependency to satisfy a
  feature that is mostly "sum a column grouped by another column."

- **Fuzzy dedupe** (dedupe on *similar*, not identical, rows) is a genuinely hard,
  O(n²)-ish problem that will not be "lightning fast". **Defer.** Exact dedupe first.

### View / Visualise — reuse what's already computed

This is the highest-leverage insight in this doc: **the chart data already exists and
is already computed in the worker.**

- Numeric/date histograms: `ColumnData.histogram()` (64 bins) and
  `filteredHistogram()` + `HistogramCache` (`src/search/aggregates.ts`) already produce
  the exact bins for a filtered result set — the same data the mini-histograms and
  range-slider backdrop already consume.
- Category/boolean bars: `computeFacets()` in `search.worker.ts` already returns
  per-value counts under the active filters.
- Time series = a histogram over a `date` column; bar chart = facets; histogram =
  existing histogram bins.

So "Visualise" is **~90% a rendering concern, ~10% plumbing**. Recommended shape:

- A chart panel inside the View stage. Charts consume the same `results` /
  `histograms` / `facets` messages the filter panel already receives — **no new
  worker round-trip, no shipping row data to the main thread**.
- Render on the main thread with a tiny canvas/SVG renderer. The data volumes are
  trivial (≤64 bins, ≤~12 categories), so a single `requestAnimationFrame` paint is
  easily <16 ms.
- Chart types to ship first: **histogram** (numeric), **time-series/line** (date),
  **bar** (category), **scatter** (two numeric). Each is a few dozen lines against the
  bins you already have.
- **PNG export = free**: render to an offscreen `<canvas>`, then
  `canvas.toBlob("image/png")`. No library needed. This satisfies "export chart to PNG"
  with zero added dependencies.

Deliberately avoid charting libraries (Chart.js, ECharts, Plotly, D3). They contradict
the "no bloat / zero latency" goal. The bins are tiny; you can draw them yourself.

### Export — add formats that reuse what's in the bundle

Current state (`src/ui/app.ts` + `src/worker/csv.ts`): CSV export of the filtered
result set, streamed in 20k-row chunks. Good foundation.

Recommended additions, in order of value-per-bloat:

1. **TSV / JSON Lines** — trivial variants of the existing `buildCsv`, effectively free.
2. **XLSX (write)** — `xlsx` (SheetJS) is *already* a dependency for reading
   (`src/parse/xlsx.ts`). Reusing it to *write* typed Excel files costs ~0 extra bundle
   bytes and gives you a format that preserves types. Do this before Parquet.
3. **Parquet** — the right "typed" format long-term, but a writer (hyparquet /
   parquet-wasm / `@dsnp/parquetjs`) is a real dependency. **Load it lazily via
   dynamic `import()`** so it never affects initial load or the happy path.
4. **Type-aware CSV quoting** — the current export already carries types internally;
   just ensure numbers/booleans/dates serialise correctly (they already do for the
   most part, but make it explicit).

Keep everything **streamed** (chunked writes into a `Blob`) as it already is — never
build one giant string in memory.

---

## 3. Refined workflow (recommended)

```text
┌─────────────────────────────────────────────────────────────┐
│  LOAD                                                       │
│  paste · file · URL · archive · workbook                    │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  WORKSPACE  (single screen, left rail = pipeline stepper)   │
│                                                             │
│   [ Load ] [ Clean ] [ Transform ] [ View ▾ ] [ Export ]    │
│                                        │                    │
│                                        ├─ Table  (default)  │
│                                        └─ Chart  (toggle)   │
│                                                             │
│   Clean / Transform are panels, not destinations.           │
│   View = Filter (sidebar) + Table OR Chart.                 │
│   Filters stay live at all times; charts reflect filters.   │
└─────────────────────────────────────────────────────────────┘
```

One workspace, one dataset, a left-rail stepper for orientation. Filter + View remain
coupled; Clean/Transform are collapsible panels; Visualise is a View tab; Export is a
panel at the end. This keeps the "type → result in <50 ms" loop intact while still
telling the Load→Export story.

---

## 4. Concrete next steps (in order)

### Step 0 — Write down the latency budget (do this first, it drives everything)

| Operation | Budget | Already met? |
|---|---|---|
| Keystroke filter → result count + first rows | < 50 ms | yes |
| Facet / histogram refresh on filter change | < 50 ms | yes |
| Clean/Transform commit (rebuild derived data) at 100k rows | < 500 ms | to verify |
| Chart render (single frame) | < 16 ms | n/a (new) |
| Export chunk throughput | stream, no blocking > 100 ms | yes |

Add a benchmark for "rebuild derived data from scratch" (the thing Clean/Transform
will trigger) in `bench/` so you know the ceiling before building on it.

### Step 1 — Introduce the pipeline stepper (UI shell only)

- Add a left-rail stepper to `src/ui/app.ts` (`buildWorkspace`) with
  `Load / Clean / Transform / View / Export`.
- Don't change any data flow yet — just the frame. This forces the visual story and
  exposes where each panel mounts without destabilising the working app.

### Step 2 — Clean, part A: header normalisation (cheap win)

- Normalise headers only (snake/camel case, trim, strip brackets, dedupe).
- This touches only `headers` / `ColumnData.name`, **no index rebuild**.
- Implement as a function in `src/data/` that maps the header array, then rebuild the
  `LoadedMessage` headers. Low risk, do it before value operations.

### Step 3 — Clean/Transform engine: the "derived column" layer (the core)

This is the pivotal piece. Recommend:

- Introduce a non-destructive **operation list** model:
  `{ column, op: "trim" | "case" | "map-null" | "replace" | ..., arg }`.
- Each op produces a new `raw` string array for that column (materialised once,
  cached), then reuses the existing `ColumnData` path (`buildDataset`).
- Reuse the **invalidation pattern already proven in `handleSetType`
  (`src/worker/search.worker.ts`)**: rebuild affected columns, `engine.invalidate()`,
  clear the `HistogramCache`, recompute anomalies, re-send `loaded`/`columnMeta`.
- Keep a source `Dataset` plus a list of applied ops → this is your undo/redo and
  your "reset" button. Preview = apply the op to a strided sample first.

This is where most of the engineering effort should go. It is *the* enabler for Clean
and Transform, and it reuses the exact patterns the codebase already establishes.

### Step 4 — Transform actions

- **Dedupe** first: an action that emits a new dataset from
  `duplicateBits`/`rowHashes` (keep-first / keep-last / drop-all).
- **Group-by aggregate** second: dimension + measure → sum/mean/count/min/max/median.
  New dataset with fewer rows; reuse `buildDataset`.
- **Melt/pivot** last (reshapes, invalidates QA bits + filters — clear filters on apply).

### Step 5 — Visualise (reuse histogram/facet data)

- Add a "Chart" tab to the View stage (`src/ui/app.ts` results area).
- On each `results`/`columnMeta` message, feed the existing `histograms` and `facets`
  payloads into a canvas renderer (`src/ui/charts.ts`).
- Ship: histogram, time-series, bar, scatter. PNG export via `canvas.toBlob`.
- No new worker protocol needed for the first pass — the data is already on the wire.

### Step 6 — Export formats

- Add TSV + JSON Lines beside CSV in `src/worker/csv.ts`.
- Reuse `xlsx` for a typed XLSX export (dynamic import, but it's already loaded for
  reads).
- Add Parquet behind a lazy `import()` only if/when a real typed-export need appears.

---

## 5. Architectural principles to follow (non-negotiable)

1. **Non-destructive ops, immutable source.** Never mutate `raw` in place. `Dataset`
   stays the source of truth; Clean/Transform produce derived `ColumnData`.
2. **Columnar + lazy + cached.** Match the existing pattern: `normalized()`,
   `numbers()`, `categories()`, `fuzzyIndex()`, `histogram()` are all built lazily and
   cached. Any new derived value must follow the same shape.
3. **Invalidation is explicit and centralised.** Extend the `handleSetType` pattern to
   a general `applyOperations` path: rebuild → `engine.invalidate()` → clear histogram
   cache → recompute anomalies → push fresh `LoadedMessage`/`ColumnMeta`.
4. **Charts consume already-computed bins, never raw rows.** The bins/facets are tiny
   and already produced per keystroke; a chart is just another consumer.
5. **Lazy-load anything heavy.** DuckDB-Wasm and Parquet are dynamic imports, never in
   the critical bundle. Initial load stays lean.

## 6. Risks & gotchas

- **Rebuild cost is the hidden risk.** Clean/Transform will rebuild derived data. At
  100k rows this is fine; at the 300k paste limit it's ~3× — measure it (Step 0) before
  promising "instant" transforms.
- **Transforms invalidate filters.** A melt/pivot or aggregate changes the column set;
  active filters/QA toggles become stale. Decide: clear filters on structural
  transforms (simplest, least surprising).
- **Don't conflate "normalise for search" with "normalise stored values."**
  `normalize()` (`src/search/normalize.ts`) already lowercases + strips punctuation for
  matching — so case/whitespace normalisation is *not* a search-performance win. It's a
  data-hygiene feature. Keep the two concepts separate in the UI, or users will expect
  case normalisation to change search results (it won't, they're already equivalent).
- **Duplicate detection ≠ dedupe.** The QA "Duplicates" toggle shows *all* copies for
  comparison by design. "Remove duplicates" is a destructive transform — keep it as a
  separate, explicit action.
- **Column-name normalisation can collide.** snake/camel conversion can produce
  duplicate names — dedupe with numeric suffixes and surface it.

## 7. What *not* to do

- Don't build six separate full-screen pages. One workspace, one dataset, a stepper.
- Don't add Chart.js/ECharts/Plotly/D3. The bins are tiny; draw them yourself.
- Don't add DuckDB-Wasm or a Parquet writer to the core bundle — lazy-load only.
- Don't implement fuzzy dedupe or joins until exact dedupe + group-by ship and there's
  real demand.
- Don't duplicate the null-detection logic for "Clean" — it already exists; extend the
  token sets in `src/parse/null-tokens.ts` if a token is missing.

---

## Suggested milestone order

1. **M1 — Stepper shell + header normalisation** (Steps 0–2). Zero risk, ships the
   visual story.
2. **M2 — Derived-column engine + Clean value ops** (Step 3). The core enabler.
3. **M3 — Dedupe + group-by + rounding + imputation + melt** (Step 4). First real "transform" value.
4. **M4 — Charts + PNG export** (Step 5). High perceived value, low actual cost.
5. **M5 — Export formats** (Step 6).
6. **M6 (later) — Melt/pivot, then DuckDB-Wasm "Advanced" mode + Parquet.**

---

## 8. Follow-ups logged 2026-10-07 (UX backlog session)

- **Per-column QA is now inline** — empties / value outliers / length outliers
  moved from the Data QA box to clickable chips above each column header
  (amber when present, muted when clean); a `1 value` flag marks constant
  columns. Duplicates stays in the Data QA box.
- **Direct column actions from the header** — quick transforms on a column
  (including deleting the whole column) without opening Clean/Transform.
  Deleting must confirm ("Are you sure?") and should be a tracked, undoable
  step so the steps list can restore it; needs a `drop` transform op.
- **Export formats beyond CSV** — the export dialog lists Parquet as planned.
  XLSX write can reuse the existing SheetJS dependency; Parquet needs a lazy
  writer. TSV / JSON Lines are near-free.
- **Null-resolution steps in the steps list** — treating tokens like `-999`
  as missing is applied but is not shown or undoable in the steps drawer yet.
- **Combine year/month/day columns into a date** — the one review backlog item
  intentionally left out.
- **Worksheet picker preview** — still shows dimensions only; a small data
  preview would help pick the right sheet.
