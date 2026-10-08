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

Well covered: paste, file, archives (zip/gz/bz2), xlsx/xls, header detection,
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
│  paste · file · archive · workbook                          │
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
  moved from the Data QA box to clickable text chips above each column header
  (amber when present, muted when clean, click filters that column's rows);
  a `constant value` flag marks single-value columns, and a `N mergeable` chip
  opens the fuzzy merge panel. Duplicates stays in the Data QA box.
- **Header right-click menu (done 2026-10-07)** — filter this column, merge
  similar values (categories), delete column with an "Are you sure?" confirm.
  Delete is a tracked `drop` transform step, undoable from the Steps list.
  Future: more direct ops from here (trim/case/round/convert) without opening
  the Clean or Transform panels.
- **Row and column delete icons (done 2026-10-07)** — red × on every column
  header and every row. Clicking stages items for deletion (red highlight),
  a bar shows "N rows and M columns selected", and one confirm deletes the
  batch: rows leave the working set (counts/exports exclude them, undo from
  the Steps list) and columns become `drop` steps. Transforms materialise
  deleted rows before running.
- **Clean at scale (done 2026-10-07)** — the Clean → Values tab has an
  "Apply to all columns" toggle that previews and applies the same operation
  list across every column in one pass.
- **Transform affordance (done 2026-10-07)** — "Add step" is now a primary
  (blue) button with a hint line, and "Apply transforms" stays disabled until
  the staged list differs from what is applied.
- **Export formats beyond CSV** — the export dialog lists Parquet as planned.
  XLSX write can reuse the existing SheetJS dependency; Parquet needs a lazy
  writer. TSV / JSON Lines are near-free.
- **Null-resolution steps in the steps list** — treating tokens like `-999`
  as missing is applied but is not shown or undoable in the steps drawer yet.
- **Combine date/time columns into a date or datetime (done 2026-10-08).** A
  `combineDate` transform takes any set of columns, each with a role (auto,
  full date, full datetime, time, year, month, day, hour, minute, second,
  millisecond, AM/PM, UTC offset, epoch) and emits a canonical ISO date or
  datetime column. Auto roles read the column name and values; ambiguous
  numeric dates use per-column US vs day-first detection (or an explicit
  override); 12-hour clocks, compact `1430` times, month names, ordinals and
  embedded offsets are understood. Timezones resolve through `Intl` (UTC,
  local, any IANA zone, fixed ±HH:MM, or naive) with offsets found in the
  data taking priority; DST offsets are computed per instant with caching.
  Source columns can optionally be dropped, and the pandas recipe emits
  `pd.to_datetime(dict(...))` plus `tz_localize`.
- **Worksheet picker preview** — still shows dimensions only; a small data
  preview would help pick the right sheet.

---

## 9. Urgent items from the 2026-10-08 reviews (next todo)

Validated on 2026-10-08 against `review_claude_20261008/torture_utf8_bom.csv`
through the real ingest pipeline. Source reviews:
`turbofuzz_ux_review_20261008.md` and
`turbofuzz_ux_screenshot_review_20261008.md` (both in the repo root folder of
the same name). Severity: data loss / security > trust > friction > polish.

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | **Silent column drop (A1)** — the fixture has 18 columns; only 17 load | **Fixed** | Header width now follows the column extent, so the blank-header column loads as `Column 18` (all `x` kept). |
| 2 | **Ragged rows invisible (A2)** — 5 short rows padded, 5 long rows truncated, no notice | **Fixed** | An import banner reports "5 short rows padded · 5 rows with 10 extra cells beyond 18 columns — trimmed". Row numbers / *Show rows* still to add. |
| 3 | **`xlsx` CVEs** — upgrade 0.18.5 → 0.20.3 (CVE-2023-30533, CVE-2024-22363) | **Done** | npm's registry copy is stuck at 0.18.5, so 0.20.3 is pinned from the official SheetJS CDN tarball. |
| 4 | **Export scope trap (S1)** — CSV export is the filtered result set | **Fixed** | Dialog states both counts, defaults to all rows after steps, and warns when filters are active. Copy stays filtered (its title says so). |
| 5 | **Decimal comma read as thousands (A3)** — `613,26` → `61326` | **Fixed** | Fixture: 677 cells, 55 in the sample. New "Repair N decimal-comma values" chip applies a `repairDecimal` clean op that rewrites only the other-convention values (`613,26` → `613.26`); shown parsed value on hover still to add. |
| 6 | **Missing sentinels not suggested (A4)** — `TBC` (206), `00/00/0000` (245), `-999` (435) treated as real values | **Fixed** | Sentinel detection now covers placeholder words/shapes and repeated-digit codes: the fixture surfaces `TBC`, `00/00/0000` and `-999` chips. Applying one adds it to the column's null policy. |
| 7 | **Type-conflict chip (A5)** — `Score` typed integer while 339 cells say `high` | **Fixed** | "Treat as text (N don't parse)" chip; clicking switches the column to text so no value is coerced or blanked. Fixture surfaces it on `Score`. |
| 8 | **Formula-like cells unflagged (A7)** — `=1+1` (108), `@SUM…` (101) in Email | **Fixed** | "Escape N formula-like cells" chip (clean op prefixes `'`) plus an export-dialog checkbox "Escape formula-like cells" on by default. Plain numbers like `-999` are left alone. |
| 9 | **Quick visual wins (C1–C4, D1, B2)** — right-align numbers + `tabular-nums`, hide zero-count chips, `#2f6fe0` for primary, label the sample/format inputs, centre the first-screen card | **Fixed** | Empties hatch instead of fill, outliers get an amber border, numeric cells right-align with tabular figures, dark-theme primary buttons use dark text, zero-count chips hidden, shuffle/locale controls labelled, sample data is a button and formats/limits are listed. Card centring was already correct in the current build. |
| 10 | **Chrome before data (B1/B3/B4)** — profile strip collapsed by default, sidebar only for selected columns, column-based empty headline | **B1/B4 fixed, B3 open** | The QA block and profile cards start collapsed showing a compact issue summary; the headline is now "N of M columns have missing values" with a "Drop N empty columns" quick action. B3 (sidebar shows filters only for selected columns; profile card opens from the header) is folded into item 11's structural work. |
| 11 | **Steps spine + one commit model + undo toasts (S2/S5)** | **Partly fixed** | Renamed to **Process Log** and extended: missing-value policy changes and column type changes are now logged with per-entry Undo, and fix chips are rendered above column headers. Still open: one commit model everywhere, replayable vs manual marking, undo toasts, full single-spine ordering across transforms. |
| 12 | **Robust outliers/histogram (B5)** — MAD fences or log scale, clip to p1–p99, show median | **Fixed** | Fixture Amount: flags 2,531 (12%) → 204, and the histogram switches to a signed-log axis (largest bin 20,204 → 3,215). Linear charts clip to p1–p99 with an "N beyond range" note; the slider follows the axis. Median is shown beside mean on profile cards and column stats, and the cell tooltip states the fence method (MAD, log or quantile). |
| 13 | **Text merge + fuzzy dedupe/join (B6)** | Todo | Blocking on phonetic key/n-gram; counts on Customer Name. |
| 14 | **Type-conversion guards** — ambiguous dates, locale numbers; leading zeros/17-digit IDs already safe | **Mostly done** | Locale conflicts are detected and repairable (A3), type conflicts surface as a chip (A5), and ambiguous dates use order detection plus an explicit Convert to date. Remaining: per-column exclusion for "Apply to all columns" (D4). |
| 15 | **Positioning/trust** — README, GitHub About, `package.json` copy | **Mostly done** | README added (privacy, features, dev/deploy), `package.json` description updated. GitHub About still to set in the repo settings. |
| 16 | **Fixture checklist** — checks 1, 2, 8, 15 still untested | **Mostly done** | Verified on the torture fixture: BOM, long IDs, postcodes, headers (blank-header column now kept), ragged rows, Amount locale/sentinels, dates, duplicates (599/599), fuzzy merge, formula export, 21k load; 300k × 12 synthetic loads in ~1.25 s with full stats (first contains-filter 155 ms). Remaining: checks 1/2/8/15. |

**Done with the scraping removal (2026-10-08):** URL/scrape loading and the
`/api/fetch` proxy are gone (A6 no longer applies), the deploy is assets-only,
and `connect-src 'none'` in `public/_headers` makes "0 network requests"
browser-enforced. `table_scraper.md` and `html-table.ts` were deleted.

---

## 10. Future: unify Clean + Transform and cut simple-op clicks (logged 2026-10-08)

Problem (observed live): the two panels are one mental job — fixing values and
reshaping rows/columns. Today they have different vocabularies, different
commit models, and neither offers a direct action for the most common ops.
Example: making one column UPPERCASE is
*Stepper → Clean → pick column → Add operation → choose Case → choose style →
Preview → Apply to column* (~7 interactions), while the header ⋯ menu and the
inline chips already overlap in purpose.

Direction:

1. **One Edit surface** (Clean + Transform merged) with a single ordered op
   list; value ops (trim, case, replace, convert) and structural ops (dedupe,
   drop, group by, round, impute) interleave. The engine already keeps both
   pipelines independently (`cleanSource`, `transformSource`); a unified list
   needs one sequence over both.
2. **One-click value ops from the header ⋯ menu** — UPPERCASE, lowercase,
   Title Case, Trim, Convert number/date — applied immediately as a Step with
   an Undo toast. Preview becomes a hover/before-after on the menu item, not a
   mode. "Apply to all columns" stays for bulk.
3. **One commit model** — same change as urgent item 11 (Steps spine): every
   action from every entry point is an applied Step with Undo, so the menu can
   be immediate without a confirm dialog.

Do this together with item 11 and item 10 (chrome reduction); it is mostly the
same wiring. Priority from the 2026-10-08 discussion: after the current
data-safety batch.

**Progress (2026-10-08):** the suggestion chips now also render above column
headers (same actions as the sidebar), missing-value/type changes are logged
with undo, and the header ⋯ menu has direct one-click UPPERCASE / lowercase /
Title Case / Trim ops that apply immediately and land in the Process Log. The
column menu also opens **Clean values…**, **Missing values…** (Clean panel
pre-selected on that column/tab) and **Transform dataset…**. The unified Edit
surface itself is still open.

---

## Appendix — In-app user guide (shipped 2026-10-08)

A **Help** button in the header opens a searchable, offline guide drawer
(`src/ui/help-drawer.ts`, content in `src/ui/help-content.ts`) with one topic
per feature: getting started, import check, Data QA, fix chips, clean,
transform, search, Process Log, export and privacy. Deep links are supported
(`openHelpDrawer(sectionId)`), so panel and chip titles can point at the exact
topic later.

---

## Future backlog (logged 2026-10-08)

- **Visualisations + PNG export.** Shipped 2026-10-08: a Table/Chart toggle in
  the results bar renders histograms (numeric, signed-log aware), time-series
  areas (dates) and top-N category bars (with Other aggregation, count + %
  labels) from the existing facet/histogram payloads — no chart library — and
  exports the canvas as PNG. Custom bin controls (start/end/count and a “> Max”
  overflow bar) are computed in the worker against the filtered rows, and a
  colour picker offers ten presets plus a hex field (per-bar colours for
  category charts). Still open: multi-series charts, annotations and
  percentiles.
- **Multi-plot chart grid + scatter/density (Phase 1, shipped 2026-10-08).**
  The Chart view is now a grid of independent cards (add, duplicate, remove,
  1–4 per row, layout remembered) with a per-card type gallery: histogram,
  time series, bars, scatter and density. Scatter supports x/y plus optional
  numeric/category colour and numeric size; the new `getChartSeries` worker
  request returns either ≤20k sampled points or an exact 128×72 density grid
  over the filtered result order (typed arrays, transferred), auto-switching
  above the point cap. Both modes clip to p1–p99 with an outside count and
  show the worker query ms in the note. Still open from the roadmap: box
  plots, correlation matrix, heatmap and small multiples (Phase 2), then
  hover, zoom, brushing and linked highlighting (Phase 3).
- **Phase 2 chart types (shipped 2026-10-08, same session as the grid).**
  Box plots (numeric value × category, Tukey 1.5×IQR whiskers, sampled
  outlier dots, top-N + Other), category×category heatmaps and Pearson
  correlation matrices (pairwise-complete observations, up to 12 columns,
  diverging blue–red cells, undefined cells greyed) are now card types with
  their own worker requests (`getBoxStats`, `getCrosstab`, `getCorrelation`).
  “+ Add chart” cycles scatter → correlation → box → heatmap before falling
  back to repeated defaults. Still open: small multiples and trend overlays
  (Phase 2 remainder), hover/zoom/brush (Phase 3), K-means/SAB (Phase 4).
- **Theme switching.** Shipped 2026-10-08: header control cycles Auto / Light /
  Dark, persisted in `localStorage`, with explicit `data-theme` palettes and
  `themechange` repaints for charts. Still open: the **quirky mode (TBD)** —
  candidates: Terminal (green-on-black, monospace), Blueprint, Newsprint,
  Vaporwave. Keep the data readable: same tokens, different palette.
- **KNN imputation quality (TODO).** There is no accuracy signal in-app. A
  quick synthetic evaluation (2,000 rows, 10% masked) shows KNN(k=5) RMSE ~33
  vs ~124 for mean/median when the predictors genuinely relate to the target
  (73% better), but ~6-8% *worse* than mean when they do not. Consider a
  hold-out check in the KNN panel ("hide 10% of known cells, report error vs
  mean") and an auto-`k` suggestion. Until then the Help guide should keep the
  caveat that imputation assumes informative predictors.

---

## Multi-variable chart options (investigation, 2026-10-08)

Today's charts are single-variable (histogram, time series, category bars) fed
by facets/histograms + `getChartBins`. The ask is charts that show interaction
between variables (scatter, clusters, density, correlations) while keeping the
lightning-fast, no-libraries, offline principles.

### Data-flow options (the speed decision)

| Option | How | Payload / cost | Verdict |
|---|---|---|---|
| **A. Worker aggregates/samples** | New requests beside `getChartBins`: `getSample`, `getGrid` (2D buckets), `getGroupStats`, `getCorrelation`; compute over `sortedIds` | 10k points ≈ 160 KB transferable; 128×96 grid ≈ 50 KB; 2–5 ms per scan | Recommended baseline |
| **B. SharedArrayBuffer mirror** | Worker mirrors numeric columns into SAB; main thread samples/zooms/brushes with no round-trips; filter commits sync a shared bitmap | 300k × 4 cols ≈ 4.8 MB | Phase-4 turbo; **already possible** — COOP/COEP are live so `crossOriginIsolated` is true |
| **C. OffscreenCanvas/WebGL worker** | Render million-point scatter off-thread, transfer `ImageBitmap` | Large lift | Only if A+B benchmarks demand |
| **D. Signature caches** | Key chart results by data generation + filter signature (like `HistogramCache`) | — | Do from day one inside A |

### Chart families

| Chart | Shows | Worker computation | Effort |
|---|---|---|---|
| Scatter (x, y; colour/size by a third) | Relationship between two numerics | Pixel-stratified/reservoir sample ≤ ~20k points | M |
| Density / hexbin | Mass where points are too many | Exact 2D histogram; optionally precompute 512×512 and slice for instant zoom | S–M |
| Bubble | Scatter + size encoding | Scatter + radius scale | S |
| Multi-series line | Time × measure split by category | Per-bucket aggregates, top-N series + Other, pixel-column min/max | M |
| Box / violin per category | Distribution differences | Five-number summary + small histogram per group (tiny, exact) | S |
| Heatmap (2 categories) | Cross-tab of two categoricals | Hash group-by pair, capped K×K + Other | S |
| Correlation matrix | Which numerics move together | Pearson one pass; Spearman via ranks (approximate on 1M+) | S–M |
| Small multiples | Single-var chart split by category | Reuse histograms/facets per group | S |
| Parallel coordinates | Many variables at once | Sampled lines or binned bands | M–L |
| Trend overlays | Direction + spread | Per-x-bin mean/median + IQR band, optional OLS | S |
| K-means clusters | Natural groupings, filterable/exportable | Implement as a **transform op** (cluster-id column, KNN precedent) | M–L |
| PCA projection | 2-D view of many numerics | Covariance + power iteration | L |

### Interaction models

- **Hover** — screen-space bucket grid over the sample (O(1)); density cells
  show count + bounds.
- **Zoom/pan** — view transform in the chart; scatter re-renders the sample,
  density slices a precomputed fine grid (instant, no worker traffic).
- **Click-to-filter** — point/cluster/heatmap cell maps to existing filter
  kinds; no engine work.
- **Brush (rectangle/lasso)** — the one engine addition: a selection filter
  kind (ids/bitmask to the worker). Unlocks cross-filtering and linked brushing.
- **Linked highlight** — shared client-side highlight state over sampled ids.
- **Export** — PNG as today plus "download chart data (CSV)"; text summaries
  for accessibility.

### Performance guardrails

- Raw points only to ~20k on screen; above that auto-switch to density with a
  "showing N of M rows · Density" label and an override.
- Grid payloads capped at 256×256; sample size selectable (5k / 20k / density /
  all).
- Line charts use min/max per pixel column decimation (exact shape, bounded).
- All worker responses use transferable typed arrays; show chart query + draw
  ms in the note line.
- Canvas 2D to ~100k points; `ImageData` for 1-px density; WebGL only if
  million-point interaction is ever required.

### Phased roadmap

| Phase | Contents | Effort |
|---|---|---|
| 1 | Chart-type gallery + scatter (x/y/colour/size) + density; worker `getSample`/`getGrid`; auto-threshold; PNG | 2–4 days |
| 2 | Box plots, correlation matrix, 2-category heatmap, small multiples (exact aggregates, tiny payloads) | 2–3 days |
| 3 | Hover, zoom/pan, click-to-filter, rectangle brush + selection filter, linked highlight | 3–5 days |
| 4 | K-means transform column, trend bands, SAB mirror for instant brushing, WebGL if benchmarks demand | 1–2 weeks |

### Risks / open questions

- Selection filter must serialize, undo and appear sanely in the Process Log
  (likely a manual, non-replayable entry).
- Spearman on million-row columns: approximate with binned ranks if needed.
- Sampling-bias perception: always show "N of M rows" and offer density.
- Need ≥8 distinguishable category colours; consider a colourblind-safe palette.
- No chart libraries: we own axes, legends and labels — keep one shared
  draw-helpers module (the current `chart-panel.ts` helpers are the seed).

**Recommended first step:** Phase 1 — scatter + density covers the
"interaction between variables" ask, adds one worker request pair, and its
benchmarks decide whether Phase 4 (SAB/WebGL) is ever needed.

**Progress (2026-10-08):** the point layer and the multi-plot shell are in.
The View stage holds independent chart cards (`+ Add chart`, duplicate, remove,
1–4 per row with the layout persisted); each card owns its type, columns,
settings and PNG export. Scatter (x/y, optional colour by numeric ramp or
category palette, optional numeric size) and density (exact 128×72 grid) are
served by a single `getChartSeries` request that walks the filtered result
order and transfers typed arrays; auto mode switches to density above 20,000
matching pairs, and the note shows shown/total/outside plus worker ms.

**Phase 2 progress (2026-10-08):** box plots (value × category, 1.5×IQR
whiskers, sampled outliers, top-N + Other), category×category heatmaps and
Pearson correlation matrices are shipped as card types behind `getBoxStats`,
`getCrosstab` and `getCorrelation` (tiny, exact payloads). Still to do from
this section: small multiples and trend overlays (Phase 2 remainder); hover,
zoom, click-to-filter, brush and linked highlight (Phase 3); K-means/trend
bands/SAB (Phase 4).

**Axis, annotation and KDE polish (2026-10-08):** count axes now use nice
round ticks (0, 20k, 40k …) and compact value labels (50k, 1.5M); histograms
can overlay a 1D KDE curve and mark the median with a dashed line; box plots
label the median and group size; scatter/density annotate Pearson r in the
corner. Density cards gained a **Style** control — Heat (exact), Contours
(Gaussian-smoothed field drawn as filled ramp bands plus marching-squares
iso-lines) and Heat + lines — all computed on the main thread from the
existing grid payload (`src/data/kde.ts`).

