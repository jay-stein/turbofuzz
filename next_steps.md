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
2. ~~**XLSX (write)**~~ — decided against (2026-10-30): not a good export format.
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
- **Export formats beyond CSV** — CSV, semicolon CSV, TSV, JSON and JSON Lines
  ship (with gzip/zip). **XLSX export was removed on 2026-10-30 and will not
  come back**: it is a poor interchange format (type guessing, row cap, no
  streaming). Reading Excel files on import is unchanged. Parquet would need a
  lazy writer and is only worth doing on real demand.
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
surface itself is still open. Since then the Process Log also **condenses
batches**: transforms applied in one commit, and the same clean op applied to
3+ columns, collapse into one row with a + toggle for the sub-steps, and the
button badge counts actions rather than raw substeps. Parameter-free cleans
(trim, case, convert number/date, formula escaping) now apply instantly from
the column menu with an Undo toast, while configurable operations keep the
panel flow with the column and operation preselected.

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
- **Slick Tables view (idea 2026-10-08).** Add a third result view beside
  Table and Chart, inspired by Python's **great_tables** package: a rendered,
  publication-style summary table — title/subtitle, grouped header spans,
  formatted numbers, colour scales and bars inline in cells, footnotes and
  source notes — generated from the current filtered result set (or from a
  grouped aggregate) and exportable as PNG/HTML. Keep it a render-only view
  (no new data model): it can reuse the existing ColumnMeta stats, facets and
  `getStats` aggregates. Proposed tab label: "Slick Tables" (Table / Chart /
  Slick Tables).

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


## Chart interaction status (2026-10-30)

High priority per the owner. Shipped: hover tooltips, click-to-filter (bars, bins,
cells, terms), wheel zoom and drag pan on every continuous chart, map brush, and
as of 2026-10-30 a **Shift+drag brush** on scatter, density, bubble, histogram and
time series (CHG-2026-10-30-02). Still open, in suggested order:

1. ~~**Linked highlight, same column**~~ — shipped 2026-10-30 (CHG-2026-10-30-03):
   hovering a slice outlines it in every other card of that column.
1b. ~~**Linked highlight across columns**~~ — shipped 2026-10-30 for count plot,
   histogram, count time series and aggregated bar/line (CHG-2026-10-30-04), and
   for scatter (CHG-2026-10-30-05: the slice's own points are drawn in orange).
   Still to do: density/heatmap cells, box plots, bubble, and split-by series.
2. **Brush on category charts** — drag across several bars/cells to select a set.
3. **Lasso** for scatter, and a brush that stays as an editable, movable selection.
4. **Keyboard access** — arrow keys to step through bars/points, Enter to filter.
5. **Touch** — two-finger pinch zoom and long-press brush.

## BIG TODO: a dedicated Time Series page (logged 2026-10-30, future plan)

**Name:** "Time Series" for now; revisit (candidates: Trends, Forecast, Seasonality).

**Aim:** one page, separate from the Chart cards, for **decomposition** (trend +
seasonality + remainder), **trend** reading, and **forecasting** (simple first, then
with dependent variables). The Chart card's time series stays the quick look; this
page is where someone goes to understand and predict a series. It must stay in the
speed ethos: everything runs on the already-aggregated series (hundreds to a few
thousand points), never on raw rows, so every step is milliseconds.

### The hard part is the question before the maths

Decomposition and forecasting both need **one regular series**: one value per period,
no holes. Raw data is rarely that, so the page has to settle three things first, and
the UI should make each an explicit, visible choice with a sensible default rather
than hiding it:

1. **Grain** — the period (hour, day, week, month). Already solved by the Every N
   bucket control; the page reuses it. Default from the span and from the data's
   natural cadence (median gap between timestamps), not just the span.
2. **Which aggregate**: sum, mean, median, min, max, first, last, or count of rows.
   The page never guesses meaning from column names or values. Default: sum (count of
   rows when no measure is picked). The aggregate is a word in the series sentence, one
   click to change, and the line under it says plainly what it does ("Each week is the
   sum of the rows that fall in it").
3. **Missing periods** — a gap is not a zero for a mean. Reuse the existing Missing
   periods policy (gap / zero / carry); add **interpolate** here, because most
   decomposition methods cannot take holes. Say how many periods were filled.

Also surface, before any model: how many periods, how many are filled, the date range,
and a plain warning when the series is too short for the chosen seasonality (rule of
thumb: at least two full seasonal cycles).

### Which seasonality? Detect it, do not make the user guess

Candidate periods follow from the grain: daily data → 7 (weekly), ~30/365 (monthly,
yearly); hourly → 24 (daily), 168 (weekly); weekly → 52; monthly → 12.

- **Autodetect** by autocorrelation (ACF) on the detrended series, or a periodogram,
  and show the strongest few candidate periods with a strength score ("weekly cycle:
  strong, 0.71; yearly: weak"). Pre-select the best, let the user pick another or
  several (multi-seasonal, e.g. daily + weekly for hourly data).
- Show a **seasonal plot** (one line per cycle, overlaid) and a month-by-weekday
  heatmap next to the decomposition: people trust seasonality they can see.
- If nothing clears a threshold, say so ("no clear repeating pattern") instead of
  forcing a fit.

### Biggest bang for buck (build in this order)

1. **Series prep + trend view** (smallest, most useful): regular series with the
   aggregate/gap choices above, a moving-average and a LOESS-style smooth as the
   trend line, and a plain-English trend read ("up 12% over the period, steepest in
   Q3"). O(n), no new dependencies.
2. **Classical decomposition, then STL.** Start with additive/multiplicative classical
   decomposition (moving average + seasonal means), O(n), tiny. Add **STL** (LOESS
   based, robust to outliers, handles any period) as the default once it is tested
   against a reference (statsmodels). Output panels: observed, trend, seasonal,
   remainder, plus "strength of trend / strength of seasonality" scores. Additive vs
   multiplicative auto-pick by whether the seasonal swing grows with the level.
3. **Anomalies from the remainder**: flag periods where the remainder is beyond a
   robust (MAD) fence. This reuses the outlier language already in the app and is
   nearly free once step 2 exists.
4. **Simple forecast with an honest interval**: seasonal naive and Holt-Winters
   (ETS) as the baselines, with prediction intervals and a **backtest** (hold out the
   last cycle, report error vs naive). Always show the naive baseline next to the
   model; a forecast that cannot beat seasonal naive should say so.
5. **Forecast with dependent variables** (regression on lag + calendar + driver
   features, decided: see "Forecast methods" below; no ARIMA, no boosting): pick driver columns from
   the table (any numeric or 0/1 column), aggregated with their own sensible
   aggregate. Needs the drivers' **future values** to forecast, so the UI must ask
   for them (or forecast the drivers first) and flag drivers that are not known in
   advance. Start with a linear model on lags + calendar dummies + drivers; it
   explains itself, which matters more than the last point of accuracy.
6. **Later**: multiple series at once (one per category, small multiples), changepoint
   detection, lists of special dates, exporting the fitted components and forecast
   as columns or CSV, and the recipe/code export (statsmodels/Prophet-style Python).

### Forecast methods (decided 2026-10-30): no new dependencies, drivers in release one

Everything runs on the aggregated series (hundreds to a few thousand points) in the
worker, in pure typed-array TypeScript. Owner decision: **regression with drivers
ships in the first forecast release**, not as a second pass. Build order and rough size:

1. **Baselines** (~30 lines): naive, seasonal naive, mean, drift. They are also the
   yardstick; say so on the page when the model cannot beat seasonal naive.
2. **Exponential smoothing** (~150): simple, Holt, damped Holt (default trend),
   Holt-Winters additive/multiplicative. Fit by Nelder-Mead on squared error.
3. **Theta** (~20 on top of 2): simple smoothing plus half the long-run trend.
4. **Decompose then forecast** (~200): STL, forecast the seasonally adjusted part with
   Holt or drift, add the seasonal part back. Shares code with the decomposition view.
5. **Regression with drivers** (~150 + OLS): trend, Fourier terms (several
   seasonalities at once, long periods such as 365), event and special-date dummies, and the
   chosen driver columns, optionally lagged. OLS by QR; ridge when columns are
   collinear. Explains itself with coefficients, which matters more than the last point
   of accuracy. AR terms (lags of the target) come from the same fit; no ARIMA.
6. **Ensemble** (~10): average of 2, 3 and 4.

**One band for every model:** rolling-origin backtest, empirical error quantiles per
horizon step (80% and 95%, widening with horizon), no normality assumption. The same
backtest chooses the model (lowest MASE) and gives the "band covered X% of held-out
points" figure. Needs about 3 seasons of history; shorter series fall back to a
residual band labelled "wide and rough".

**Period choice:** detect, do not ask. Periodogram (small FFT or O(n^2) DFT) plus the
autocorrelation function over the candidates the grain implies (daily 7 and 365, hourly
24 and 168, monthly 12); default to the strongest with its strength shown, overridable.
The backtest answers "daily mean or max" empirically for the aggregate choice.

**Drivers must be usable in the future.** A driver column is accepted only when its
future values are known (derived from the calendar, or entered in a small grid
on the page) or it is lagged by at least the horizon. Otherwise the page says the driver
would have to be forecast too and offers to do that, marked as compounding error.
The backtest must use only information available at each origin, or it looks great by
peeking at the future.

**Tests:** fixed fixtures (airline passengers, a synthetic seasonal series with a known
driver effect) with expected output checked against reference implementations; bench
budget forecast + backtest under 200 ms for 1,000 periods.

### More models, event impact (decided 2026-10-30)

**Position:** the gap is not model count. For one aggregated series of a few hundred
points, the forecasting competitions (M3, M4) favour simple statistical methods and
their combinations; machine learning won M5 only by learning across thousands of
related series. More candidates also hurt: with about 8 backtest origins, picking the
best of a dozen models mostly picks luck. Keep the leaderboard to about six and spend
the effort on robustness and on the cases where today's models break.

**Add, in this order:**

1. **Theta** (~20 lines): already planned; strong in M3/M4 and a good blend member.
2. **Full ETS family with automatic choice:** additive/multiplicative error, trend
   (none, additive, damped) and season, chosen by AICc, as in R `forecast`, Excel and
   Nixtla AutoETS. Multiplicative seasonality matters whenever the swing grows with
   the level.
3. **Multiple seasonalities (MSTL + ETS):** daily data has weekly and yearly cycles,
   hourly has daily and weekly. The prototype's Holt-Winters only sees the weekly
   cycle at daily grain, which is why it loses there.
4. **Sparse series (Croston, TSB):** a series filtered to a small slice is often
   mostly zeros and every model above fails, with a nonsense band. Detect it (average
   interval between non-zero values, and their CV squared) and switch automatically.
   About 40 lines.
5. **Coherent hierarchy:** forecast each group and the total, then reconcile (MinT,
   or bottom-up to start) so groups add up to the total. We already slice by any
   category column; forecasts that do not add up are the first thing an analyst notices.

**Skip, with reasons:**
- ARIMA / auto-ARIMA: about 400 fragile lines (order search, stationarity), rarely
  beats 2-3 on aggregated series; the regression already carries AR terms.
- Gradient boosting and neural models (LightGBM, N-BEATS, DeepAR): need many related
  series and training time; break the millisecond budget for no gain on one series.
- Foundation models (TimesFM, Chronos, TimeGPT): genuinely strong zero-shot, but tens to
  hundreds of MB of weights plus a runtime dependency in the browser, or an API call.
  That breaks offline use, the no-new-dependency rule and the latency budget. If ever,
  an opt-in extra, never a core model.

**Event impact (owner: "super good"), a fourth mode beside Explore, Decompose,
Forecast.** Pick a date (a lasting step detected in another column, a changepoint, or
drag a line). The page forecasts what the series would have done from data before that
date (the event's own column held at its pre-event level, every other driver at its
actual values), then shades actual minus
expected and reports the total, relative and per-period effect with an 80% range and a
verdict: "clear" only when the 95% range leaves out zero, "possible" when only the
80% range does, otherwise "no clear effect"; capped at "possible" with under two years
of history before the event, since a yearly swing cannot be separated from it. The range comes from the same backtest
machinery as the forecast band: cumulative errors of backtests spread across the
whole history before the event (bias from the later ones, spread from all), so the range
sees every season and an unrelated series does not raise false alarms. Same idea
as Google's CausalImpact, but no new model. Rules:
- Expected is fitted only on data before the event; nothing after it leaks in.
- Needs enough history before the event to learn the normal pattern; say how much
  ("needs 79 weeks before the event, this one has 61; daily grain needs less").
- Events are suggested from the data (lasting steps in other columns, changepoints), and the
  person can name their own; the event list is part of the recipe.
- Verdict wording never claims causation beyond "compared with what the pattern before
  the event predicted"; other things that changed at the same time are named when known
  (another driver changing in the window, a data gap).

### Context-free by design, and the model roster (owner, 2026-10-30)

**Owner rule: a Swiss army knife for any time series.** Plain decomposition and
forecasting that works the same whatever the numbers measure. No views, presets,
defaults, wording or examples for a kind of data or an industry. The page reads only
the numbers, never what they mean.

What it may look at is the **shape** of the numbers, because that is what keeps the
maths valid on every series: values below zero, runs of zeros, whole numbers, gaps,
how many cycles of history exist, which cycles are present. Shape decides which models
are allowed and how changes are worded; meaning decides nothing.

- **Columns are just columns.** The measure, the slice and the drivers are whatever the
  person picks. Labels use the column names as they are.
- **Aggregates are stated, not guessed:** sum, mean, median, min, max, first, last,
  count. Default sum; the sentence says which.
- **Drivers:** any numeric or 0/1 column, each with one rule for its values after the
  data ends: held at its recent level, same as a year earlier, a % change from its
  recent level, or entered values. Drivers start empty. Effects are worded "goes with",
  never "causes"; the band does not include doubt about driver assumptions, and the card
  says so.
- **Events:** lasting steps in any other numeric column, changepoints in the series,
  and dates the person adds. Nothing is labelled by domain ("price rise", "promotion");
  labels name the column and the step ("driver_x stepped down to 26").
- **Calendar effects** are generic: day of week, day of month, month, year. Special
  dates come from the person (a date column or a pasted list), never from built-in
  country tables.
- **Wording follows the shape:** percentages only when the series stays above zero;
  otherwise changes, effects and seasonal swings are in the series' own units.
  Forecast ranges stay at or above zero only when the history does.
- Prototype v4 follows all of this: a neutral sample table (date, group, value,
  value_signed, value_sparse, driver_x, flag_x) and no domain words anywhere.

**Model roster, by shape only.** Pure TypeScript on the aggregated series, no
dependencies. "proto" marks those already in the prototype.

| Model | Series shape it suits | Notes |
|---|---|---|
| Seasonal naive, naive, drift, mean | every series (baselines) | proto (seasonal naive) |
| Seasonal average (mean of the same point in earlier cycles) | a season but no trend | proto |
| Holt-Winters / full ETS family by AICc | trend and season | proto (one variant); add multiplicative and auto choice |
| Theta | robust default, short series | proto ("Steady trend") |
| STL + ETS, MSTL | several cycles at once (daily or finer grain) | |
| Regression with Fourier terms and drivers (Prophet-style) | driver columns or calendar effects | proto; logs only when the series is positive; add AR errors |
| Structural model via Kalman filter (local level / local linear trend + season + drivers) | missing values and irregular gaps; best engine for event impact | fits around gaps instead of filling them; ~250 lines |
| Count models (Poisson / negative binomial) | small whole numbers | whole-number ranges, never below zero |
| Sparse-series models (Croston, SBA, TSB, ADIDA) | mostly zeros | forecasts a rate, not a shape |
| Hurdle (chance of non-zero × size when non-zero) | zeros mixed with a skewed size | lopsided range |
| Quantile regression | skewed series | lopsided range, drivers allowed |
| Analogues (k nearest past windows) | odd shapes nothing else fits | explainable: "like Mar 2024 and Oct 2025" |
| Temporal hierarchies (forecast at several grains, reconcile) | any series | usually more accurate; grains agree; uses our any-width resampling |
| Group reconciliation (bottom-up, MinT) | sliced series | groups add up to the total |
| Simple and weighted combinations | any series | the backtest decides |
| Later: TBATS (non-integer cycles such as 52.18 weeks), Gaussian process (n ≤ 500) | specialist | only if benchmarks justify |
| Skipped: ARIMA (possible later on the Kalman engine), boosting, neural nets, foundation models | | no dependency, latency, one series |

**Model router (shape only).** A cheap profile decides which models enter the
leaderboard; the model card says what it saw (prototype shows this):
- mostly zeros → sparse-series models and seasonal average; no logs;
- zeros mixed with a skewed size → hurdle model and quantile range;
- small whole numbers → count models;
- values below zero → additive only, no logs or Box-Cox, ranges may go below zero;
- values bounded 0 to 1 or 0 to 100 → logit scale;
- several cycles (daily or finer grain) → MSTL and Fourier regression;
- missing values → the Kalman model fits around them; others use the filled series, marked;
- a big level shift → changepoint-aware trend and an offer to fit only after it;
- under two full cycles → non-seasonal models only, with the reason.

**Test fixtures, defined by shape:** trend plus multiplicative season; additive season
crossing zero; two cycles at daily grain; mostly zeros; small counts; a level shift;
missing stretches; a series shorter than two cycles; a constant series. Each with
expected outputs checked against a reference implementation.

### Series prep is a visible pipeline: resample, fill, transform, smooth

Shown as an ordered list of steps the person can toggle, reorder and read (like the
Process Log), because the order changes the answer (resample *then* smooth, not the
reverse) and because it doubles as the recipe/code export:

1. **Resample** (arbitrary width, see below)
2. **Fill / ignore** (gap and NA policy, see below)
3. **Transform** (log, per-day rate, index to 100, difference, % change, z-score)
4. **Smooth** (rolling average, exponential, LOESS)
5. **Model** (decompose, forecast)

### Resampling must be fully flexible, not "weekly/monthly"

Any width in any unit: **3-weekly, 5-hourly, 90-minute, 2-quarter, 10-day**. The
engine already buckets by any whole width (the Every N control shipped 2026-10-30),
so the page reuses it and adds what analysis needs on top:

- **Anchor choice.** Today buckets align to the calendar/epoch, so "every 3 weeks"
  starts on an arbitrary week. For analysis offer **"start from my first
  observation"** (and "from a date I pick") as well as calendar-aligned. This is an
  engine follow-up (an `origin` option beside `every`).
- **Label** each bucket by its start, end or midpoint; make the edge rule explicit
  (start-inclusive) and say so in the tooltip.
- **Aggregate per resample, separate from the display.** Daily sum then weekly mean
  is a legitimate pipeline; allow a two-stage aggregate.
- **Upsampling** (coarser to finer, e.g. monthly to daily) needs a fill rule
  (interpolate, carry forward, spread evenly); warn that it invents data.
- **Auto** picks a round step for the span (already true for short spans) and
  suggests one from the data's natural cadence.
- **Days that never have data.** If some weekdays never have rows, they are
  structural, not gaps: detect it and offer "skip days that never have data" so a jump
  across them is not a hole and the weekly cycle uses only the days that exist.

### Edge cases the page must handle explicitly (each a visible choice with a default)

Missing data has **two different meanings** and needs two separate policies:
a **missing period** (no rows at all) and a **missing value** (a row exists but the
measure is NA/blank/sentinel). Options for each: **ignore (leave the hole)**,
**zero**, **carry forward**, **carry backward**, **linear interpolate** (time-weighted
for uneven gaps), **seasonal fill** (same period last cycle), **drop the period**.
Defaults: sums and counts zero, levels and rates ignore. Always report how many
periods were filled or ignored, and mark filled points on the chart (hollow marker).

- **Leading and trailing gaps**: never fill outside the observed range.
- **Partial first/last period**: flag (already hatched on the card) and offer to
  exclude; a half-finished current week must not read as a collapse in the trend.
- **Several rows per period** are aggregated; **duplicate timestamps** and unsorted
  input are handled quietly and noted.
- **Uneven month lengths**: a monthly *sum* is biased by days in the month; offer a
  per-day rate. Leap years and 52/53-week years: seasonal period 365.25 days or ISO
  weeks, not a fixed 52.
- **Short series**: disable (with the reason) a rolling window longer than the
  series, and seasonality without two full cycles.
- **Flat/constant series**: no seasonality or trend to find; say so.
- **Zeros and negatives** break multiplicative decomposition and log transforms:
  auto-switch to additive and explain.
- **Outliers**: option to winsorise or ignore flagged periods before fitting, so one
  spike does not become a fake seasonal peak (STL's robust mode helps).
- **Huge series**: decimate by min/max per pixel for drawing and auto-coarsen the
  grain above a point cap; never freeze.
- **Many categories**: one series per category as small multiples (top N + Other),
  not 40 tangled lines.
- **Text measures and unparsed dates**: reuse the data-quality fixes (number and date
  conversion) and link to them from the page.
- Time zones and DST stay out of scope (dates used as stored).

### Quality-of-life features to include (the list people reach for)

- **Rolling (moving) average**: window in periods, any N; mean or median; trailing or
  centred; minimum periods before it starts; several windows at once (7 and 30);
  drawn as an overlay on the raw series; optional rolling min/max/std and a
  volatility band.
- **Exponential smoothing** (span or alpha) and a **LOESS** smooth, with a slider
  that redraws instantly (all O(n) on the small aggregated series).
- **Cumulative sum**, **period-over-period change** (difference, % change), **same
  period last year** and year-on-year comparison, **index to 100** at a chosen base
  period, **growth rate** (CAGR) over a selection.
- **Compare**: overlay years on one axis (seasonal plot), overlay two series (index
  or dual axis), and a lag/autocorrelation plot (ACF/PACF) for the curious.
- **Seasonally adjusted series** (observed minus seasonal) as a one-click view, since
  that is often what people actually want to see.
- **Trend in plain English** with units: "+3.2 per week (up 12% over the period)",
  and slope significance, not just a line.
- **Peaks and troughs** marked and listed; **event markers** (the person adds a dated
  label of their own) drawn as vertical lines and carried into exports.
- **Zoom and brush on the series** (the Shift+drag select already exists on charts),
  with "analyse only this range" and a train/test split marker for forecasting.
- **Summary strip**: periods, missing, filled, range, mean, trend slope, strongest
  seasonality, forecast error vs naive.
- **Settings are remembered per dataset**, undoable, and shareable as part of the
  recipe; **export** the prepared series, the components and the forecast (value,
  lower, upper) as CSV, the chart as PNG, and the pipeline as pandas/statsmodels code.
- Every control gets a one-line "what this does" tooltip; defaults are chosen from
  the data, never blank.

### Build and risk notes

- Run in the existing worker on the aggregated series; no WebAssembly or numerical
  library unless benchmarks demand it. STL, Holt-Winters and a small ridge regression
  are a few hundred lines each in plain typed arrays.
- Add `bench/` budgets: decompose 10k periods < 50 ms, forecast + backtest < 200 ms.
- Validate every method against a Python reference on fixed fixtures before shipping
  (this is the main correctness risk; wrong decompositions look plausible).
- Time zones stay out of scope (dates used as stored); DST-free daily and above is the
  supported world, sub-daily data is treated as naive local time.
- Decide early whether this page edits the dataset (adds trend/seasonal/remainder or
  forecast columns as a Transform step) or only reads it. Recommendation: read-only
  first, with an explicit "add as columns" action later.
- **Decided (owner, 2026-10-30): two ways in.** The page has its own nav entry, and
  every Chart card's time series gets an **"Analyse this series"** action (in the card
  menu and on the card toolbar). It carries over the date column, measure, aggregate,
  grain and Every N width, week/financial-year options, missing-period policy, the
  card's own filters/exclusions and the table filters, so the page opens on exactly
  the series the person was looking at, with those choices still editable. Going back
  returns to the Chart view with the card untouched.

### Forecast display (owner request, 2026-10-30): confidence band with shading

The forecast view must show the prediction as a **line with a shaded confidence
band** around it, not a bare line:

- History drawn solid; the forecast continues from the last observed point as a
  dashed line, with a visual break (a faint vertical "forecast starts" marker).
- A shaded band between the **lower and upper bound** of the prediction interval
  (default 80%, with a second lighter, wider 95% band as an option, i.e. a fan that
  widens with the horizon because uncertainty grows). The fill sits between the two
  bound lines, same hue as the forecast at ~15-25% opacity, and the bound lines
  themselves are drawn thin so the band edge is readable.
- Bounds come from the model's residual spread (seasonal naive and Holt-Winters:
  analytic or simulated intervals; regression with drivers: residual quantiles
  scaled by horizon), never from the fit on the history alone. A backtest on a held
  out final stretch shows the realised coverage ("80% band contained 78% of the
  held-out points") so the band is checked, not just drawn.
- The tooltip over a forecast period lists the point forecast and both bounds
  ("Jun 2025: 1,240 (80%: 1,090 to 1,390)"), the axis keeps the band in range, the
  legend names the interval level, and the band is included in PNG export and in the
  exported forecast table (columns forecast, lower, upper).
- Shading must not rely on colour alone (dashed forecast line plus the band edge
  lines), and the band must stay readable in light and dark themes.
- The same band component should serve the trend overlay on the plain Chart card
  later (a smoothed line with its confidence ribbon), so build it once as a shared
  draw helper.

### Commercial-grade bar (owner request, 2026-10-30): beautiful, interactive, instant

The sections above say *what* the page computes. This one says what makes it feel like
a product people pay for: one clear layout, direct manipulation instead of forms, and
answers that appear while the pointer is still moving. Speed is the feature, so every
item below names its latency budget.

#### Layout: one workbench, not a form

- **Series sentence as the header.** The series is described in words, and each word
  is a control: "Weekly **sum** of **value** for group **A**, **Jan 2023 to Oct 2026**,
  gaps **filled with zero**". Click a word to change it. This replaces a wall of
  dropdowns and doubles as the chart title in exports.
- **Hero chart** (about 60% of the height) with an **overview navigator** strip under
  it: the whole series in miniature with a draggable window, as in market charts.
  Range presets beside it (3M, 6M, YTD, 1Y, All, Fit forecast).
- **Linked panels** under the hero sharing its x axis: trend, seasonal, remainder (the
  decomposition), and the seasonal plot / weekday-by-month heatmap. One crosshair
  runs through all of them.
- **Insight rail** on the right: findings written as sentences, each with a number
  and a "show me" action that flies the chart to it and rings the marks.
  "Strong weekly cycle: Saturdays run 34% above the week's average."
  "Trend turned down in Aug 2025 (changepoint)." "3 unusual weeks." "Forecast beats
  seasonal naive by 18%." Ranked by strength; nothing shown that did not clear a test.
- **Pipeline strip** at the bottom: Resample, Fill, Transform, Smooth, Model as chips,
  each with a tiny before/after sparkline so the effect of a step is visible without
  opening it. Toggling a chip is instant and undoable.
- **Modes, not pages:** Explore, Decompose, Forecast as tabs over the same hero chart,
  so the series, zoom and crosshair stay put while the analysis changes.

#### Visual language

- Reuse the app tokens (`--accent`, `--text-dim`, `--chart-*`) with a dedicated series
  palette: history in ink, trend in the accent, forecast in a second hue, its band the
  same hue whose opacity fades with the horizon (uncertainty you can see), anomalies as
  small rings in the danger colour, filled periods as hollow markers, event markers as
  thin vertical rules with a flag label.
- **Direct labels instead of legends:** values at the line ends ("Forecast Dec 2026:
  1,240", "Trend +3.2 a week"), placed with simple collision avoidance.
- **Two-level date axis** (days over months over years) that never repeats the year on
  every tick; tabular numerals everywhere; abbreviated units (1.2k, 3.4M) with the
  exact value in the readout.
- Quiet gridlines, generous margins, one accent at a time. Dark mode designed, not
  inverted. Colour-blind safe hues; nothing encoded by colour alone (dashes, markers).
- **Motion with meaning, 150 to 200 ms:** when the grain, model or smoothing changes,
  the line morphs from old to new values (same periods tween, others cross-fade); the
  forecast band grows out of the last observed point. Off under
  `prefers-reduced-motion`. Never animate while the user is dragging (instant there).
- **Designed states:** skeleton panels while loading (never a blank or a spinner over
  data), an explained empty state ("needs a date column and at least 12 periods"),
  inline warnings next to the thing they are about, not in a toast.

#### Interaction: direct manipulation

- **Crosshair readout** synced across all panels: period, value, trend, seasonal,
  remainder, forecast and both bounds, change vs previous period and vs same period
  last year. Arrow keys step one period; Home/End jump.
- **Drag the forecast horizon** by its end handle on the chart; the band redraws while
  dragging.
- **Drag the train/test split line** to backtest from any date; error and coverage
  update live. This turns "is this model any good?" into something you can feel.
- **What-if drivers:** for regression forecasts, each driver gets a slider or a small
  editable future grid ("driver_x +5% from March"); the forecast and band respond while
  dragging. **Scenarios** A/B/C can be saved and overlaid with their own bands.
- **Click a point to see its rows:** every period is backed by real rows, so a click
  filters the Table to that period (and slice). This is the edge over standalone
  forecasting tools and reuses the existing filter path.
- **Click an anomaly** to explain it (which rows drove it), exclude it from fitting,
  or mark it as an event.
- **Brush to analyse a range** (Shift+drag already exists), **pin** a period to compare
  against while hovering others, and annotate any point with a note that travels into
  exports.
- **Model leaderboard:** every method with its backtest error vs seasonal naive, a
  coverage figure and an error sparkline over the backtest origins. Click to switch
  the hero; hover a row to ghost that model's forecast over the current one.
- Undo/redo for every change; the whole page state is part of the recipe and is
  restored per dataset. Command bar entries for the common actions.

#### Speed architecture: how it stays instant

- **Two tiers of compute.** Only the first touches rows: aggregating rows into the
  series (worker, cached by its key). Everything after runs on the series (n up to a
  few thousand), where most steps take under a millisecond.
- **Run small things where the pointer is.** Smoothing sliders, rolling windows,
  transforms and the crosshair readout run on the main thread on the cached series,
  skipping the worker round trip, so they redraw in the same frame as the drag.
  Fitting, backtests and period detection run in the worker.
- **Progressive results.** Seasonal naive appears at once; exponential smoothing,
  STL, regression and the ensemble stream in as each finishes, and the leaderboard
  fills row by row. A generation counter drops stale answers; a new change cancels
  outstanding work.
- **Per-stage cache** keyed by the pipeline up to that stage: changing the smoothing
  does not re-resample, changing the model does not re-fill. Refits warm-start from
  the previous parameters, so dragging the split line refits in a few iterations.
- **Layered canvases per panel:** a static layer (axes, grid, history, band) and an
  interaction layer (crosshair, brush, handles, ghost lines). Hover never redraws the
  data. Paths cached as `Path2D`; long series decimated min/max per pixel.
- **Deterministic numbers:** seeded resampling, fixed optimiser starts, so values do not
  flicker between identical runs.
- **Budgets (p95, wired into `npm run gate` as benches):**
  - crosshair, hover, slider drag: under 8 ms per frame (60 fps)
  - pipeline change to first paint: under 50 ms (1M rows into the series under 100 ms)
  - one model fit plus forecast, 1,000 periods: under 30 ms
  - full leaderboard with backtests, 1,000 periods: under 300 ms, streamed
  - page open from "Analyse this series": under 150 ms to a drawn hero chart

#### Trust: what makes people believe the numbers

- A **model card** for the shown forecast: method, parameters, fitted period, backtest
  error vs naive, realised band coverage, and the warnings that apply.
- Every derived number has a "how is this computed" popover in plain words.
- Honest refusals: too short, no seasonality found, structural break detected ("the
  series changed in Mar 2024; fit only after it?").
- Correctness gate: each method checked against statsmodels on fixed fixtures, plus
  property tests (a pure sine has seasonal strength near 1, a straight line has trend
  slope equal to its gradient, forecasts of a constant are that constant).

#### Accessibility and export

- Everything reachable by keyboard; a "view as table" for every panel; insights in an
  ARIA live region; contrast checked in both themes.
- **Presentation export:** PNG/SVG at 2x with the series sentence as title, a subtitle
  for the model and interval, a source footnote and the band legend. CSV of the series,
  components and forecast (value, lower, upper). Python (pandas + statsmodels) that
  reproduces the pipeline.

#### Code shape

- Pure maths in `src/data/timeseries/` (prep, period, stl, ets, theta, regress,
  backtest, insights), each unit tested against fixtures. UI in `src/ui/timeseries/`
  (page, hero chart, navigator, panels, leaderboard, insight rail, pipeline strip).
  Shared `band-draw.ts` and a time-axis module that the Chart card can adopt later.
  **Do not grow `chart-card.ts`** (about 12k lines already).
- Build a **clickable prototype first** (static HTML with a fixed series) to settle the
  layout, palette and motion before any engine work; then build behind it.

#### Release phases

1. **Explore:** series sentence, hero chart and navigator, rolling and smoothing
   overlays, crosshair readout, click to rows, insight rail (trend, peaks, partial
   periods), pipeline strip, budgets in the gate.
2. **Understand:** decomposition panels, seasonal plot and heatmap, period detection,
   anomalies and changepoints in the insight rail.
3. **Predict:** models, leaderboard, band, draggable horizon and split, drivers with
   what-if sliders and scenarios.
4. **Polish:** presentation export, small multiples per category, annotations and
   events, code export.

### Layout (proposed 2026-10-30, awaiting owner sign-off)

Plan page: https://claude.ai/artifact/MVR5tuZ4hRVpVfN7i8ivn9 ; prototype v2 follows it:
https://claude.ai/artifact/Wbr9eDFTFfFwtW5hT9xTGy (both private to the owner).

- **Page one, the workbench, seven zones:** header (back, four modes Explore /
  Decompose / Forecast / Impact, Export), series sentence, summary strip (five fixed
  facts plus one mode cell), mode toolbar on the chart's top edge (at most five
  controls, coloured by mode), chart plus navigator, detail on the chart's time axis,
  findings rail (swipeable row above the chart below 1020 px).
- **Rules:** the chart never moves between modes; controls sit on the chart's edge;
  summary before detail; one time axis for everything below the chart; one colour per
  mode (blue, violet, teal) with red/green only for meaning; drag handles on the chart
  instead of forms, mirrored in the toolbar for keyboard use.
- **Page two, the brief:** a read-only one-page summary generated from the workbench
  state (sentence as title, three numbers, one chart, top three findings, method
  footnote); PNG/PDF or a link back. Open: ship in release one or later.
- Every planned feature maps to an existing zone (later models are leaderboard rows,
  hierarchy is "by group" small multiples in the detail).

### Market survey (2026-10-30): what to borrow, and the gap we fill

A quick survey of the leaders. Two families: **code libraries** (Prophet, Nixtla
StatsForecast/TimeGPT, R fable) with strong methods and no UI, and **BI tools**
(Tableau, Power BI, Excel, Datadog) with a one-click forecast that is mostly a black box.

| Product | What it does well | Borrow |
|---|---|---|
| Meta Prophet | Trend + seasonalities + holidays as one additive regression; changepoints drawn on the plot; components plot; tuning by plain knobs (trend flexibility, seasonality strength); cross-validation with error plotted against horizon; saturating growth (cap/floor) | Components panel incl. holiday/event effects; changepoint lines on the trend; "trend flexibility" slider; error-vs-horizon plot; cap/floor for bounded measures (shares, percentages) |
| Tableau | Holt-Winters chosen automatically; Describe Forecast shows the model and a GOOD/OK/POOR quality rating against a naive forecast; 90/95/99% intervals; minimum data rules stated | A one-word quality grade against naive, next to the number that backs it |
| Excel Forecast Sheet | One click; detects season length; exposes timeline completion (zeros vs interpolate), aggregation of duplicates, forecast start date, a stats table | Choosing the forecast start date as the backtest; duplicate aggregation and completion as visible options |
| Power BI | Anomaly detection with a sensitivity slider; clicking an anomaly gives possible explanations ranked by strength, in words; forecast detects seasonality. Anomalies and forecast cannot share one visual | Sensitivity slider; "why is this point unusual" ranked by which slice drove it; show anomalies and forecast together |
| Datadog | Anomaly algorithms named by behaviour (basic, agile, robust) rather than by maths; band width as one bounds setting; needs 3x the seasonal period of history | Model choices named by behaviour ("reacts fast", "steady", "ignores spikes"); one band-width control; state the history rule |
| Nixtla StatsForecast / TimeGPT | Fast auto-selected ETS and ARIMA; conformal prediction intervals at several levels at once; native and conformal bands | Confirms our backtest (conformal-style) band and multi-level fan |
| R fable / fpp3 | 80% and 95% fan as the default display; trend and seasonal strength features | 80/95 fan as default; strength scores (already planned) |

**Prophet's model is our regression model plus changepoints.** Prophet fits a
piecewise-linear trend (hinge terms at candidate changepoints, shrunk towards none),
Fourier seasonalities and holiday dummies. That is plan item 5 with hinge columns and
a ridge or L1 penalty, so a "Prophet-style" model needs no dependency and lands in the
first forecast release with drivers. Saturating (logistic) growth is a later option.

**The gap in the market, and the pitch:** the BI tools forecast without showing how
good the forecast is, and the libraries show it but need code. None of them (in this
survey) combines:
- a band whose coverage is checked on held-out data and stated next to it,
- forecasts, anomalies and decomposition on one chart at the same time,
- drivers with live what-if sliders,
- a click from any period to the rows behind it,
- all of it offline in the browser, redrawing while the pointer moves.

Unchecked: a third-party page says Prophet is in maintenance mode (bug fixes only). It
does not change what we borrow, since we implement the model ourselves.

Sources: help.tableau.com (forecast_describe), learn.microsoft.com (Power BI anomaly
detection; Excel CreateForecastSheet), support.microsoft.com (Create a forecast in Excel),
docs.datadoghq.com (anomaly monitors), nixtlaverse.nixtla.io and nixtla.io (AutoETS,
prediction intervals), Prophet R reference and course notes.

## TODO (logged 2026-10-29)

- **Time-series chart review (DONE 2026-10-29, see CHG-2026-10-29-10). Time-zone conversion is out of scope (decided 2026-10-30); arbitrary-width time buckets, interpolation and a trend overlay remain.** Time-series charts are not
  hitting the mark. Do a proper review against
  `charting_aggregation_ux_spec.md` section 6 (temporal aggregation): time
  grains (day/week/month/quarter/year), automatic grain choice, calendar
  options, irregular series and missing periods, time-zone and DST behaviour.
  The owner cannot see the time-series aggregation that was discussed, so first
  establish what is and is not wired into the chart builder, then fix the gaps
  and review the visual design (axes, gaps, tooltips, trend overlay).
- **Filter any chart on an unrelated column (TODO).** A chart should accept its
  own row filter on a column that is not plotted. Example: points scored per
  month by team, restricted to include MJ and Shaq and exclude LeBron. Needs an
  include/exclude value picker per chart card (chart-local, not the table
  filter), applied in the worker before aggregation, saved in the chart spec and
  recipe, and shown on the card so the chart says what it excludes.

### Real-data test of the prototype (in progress, 2026-10-30)

Files: `prototypes/time-series/` holds the working prototype (with the new CSV loader,
NOT yet published; published v4 lacks it), the layout page, the test harness
`run-real.cjs` (expects the datasets in `../ts-data/`) and the first run's output
`real-run1.txt`. Datasets (public): airline passengers, Melbourne daily min temps,
monthly sunspots, daily female births, shampoo, NOAA CO2 monthly, global temp (two
sources), AAPL daily, USGS quakes M6+, Wikipedia "Christmas" daily views, Fremont
bridge hourly counts.

Done: generic CSV loader (date column detection incl. dd/mm vs mm/dd, ISO with time,
yyyy-mm, decimal years; numeric, 0/1 and group columns; time-counter and date-part
columns kept out of defaults), row-based aggregation (sum/mean/median/min/max/first/
last/count of rows), native cadence, weekdays that never have rows, coverage-based
partial and gap logic, yearly grain, no-season (trend only) path, detected cycles
(ACF), grains finer than the data disabled. Run 1: 10 of 11 load and run all four
modes with no errors or NaN text; shampoo ("1-01" dates) refused with a clear message.

Run 1 issues 1-14: **all fixed 2026-10-30** (run 2 output: `real-run2.txt`). Fixes in
brief: grain floor `cadence * 0.97`; partial share stored per period; why-line says when
"all" adds groups; trend only below seasonal strength 0.15 with a moving-average detrend
for cycle search; long profiles smoothed before naming peaks; rates choose month / year /
decade / century and a before/after pair shares one unit; events only from chosen
drivers plus the trend changepoint (sample defaults to `driver_x`); "the row count";
event-like data has no gaps; structural weekdays not counted as missing; "finer than a
day" only when a (day, group) has several rows; cadence in words with a count; trend %
from the first and last 5%; no group share with one group.

**Run 2 (2026-10-30), 16 files** (datasets in the session scratchpad; set `TS_DATA` to
point the harness at them). Added: owner's parking file, Beijing PM2.5, UCI Air Quality,
ETTh1, ETTm1. 15 load and run all four modes with no errors and no NaN text; shampoo
("1-01" dates) is still refused with a clear message. Fixed during the run:

- **Dates built from split columns in the page**: no date column, but Year / Month /
  Day / Hour / Minute columns (exact, aliases, or one shared prefix; month names too)
  now build the dates, and the toast says so (Beijing).
- **Separate Date and Time columns** (`18.00.00` or `18:00`) are joined (Air Quality).
- **Semicolon files** with decimal commas; fully blank rows skipped quietly.
- **Missing-value codes** read from the values alone (a repeated round number of 99+
  that is negative when nothing else is, or all nines and 10x the rest): Air Quality's
  -200 is treated as missing and the Data finding says so.
- **Regression blow-up** on short series (parking, 111 days: error 575,000x naive):
  yearly terms only with a full year of data, weekly only with three weeks, and log
  forecasts capped at 20x the largest value seen.
- **"Sum depends on how many readings"** warning with a one-click "Use mean": fires on
  parking (205-320 readings a day), Air Quality (14-24) and global temp (1-2 a month,
  i.e. two sources added together). Worded neutrally (level vs amount), no guessing
  from names.
- A rough cycle that is too irregular to model (sunspots, ~11 years) is reported as
  "rough cycle" instead of disappearing; column names keep their own case ("pm2.5");
  impact's relative low end never goes below -100%.

Run 3 (sub-daily, 2026-10-30, `real-run3.txt`): **sub-daily grains done.**
- Rows sit in a base *slot*, not a day: a day for daily data, else the coarsest step on
  a 1 / 5 / 15 / 30 / 60-minute ladder that the median gap fills (jittered 30-minute
  parking readings get 30 minutes). Very long fine tables step up the ladder to stay
  under 1.5M slots.
- New grains 5-minute, 15-minute, 30-minute and Hourly, with weekly and daily seasons
  (168 and 24 at hourly). Grains finer than the data are greyed out as before.
- Regression gets daily Fourier terms. "Same time last week" replaces "last year",
  "vs a week earlier" replaces "vs a year earlier", the range presets become
  1D / 1W / 1M / 3M, and the axis shows hours.
- Partial periods and gaps are counted in slots, so parking's first day is no longer
  flagged as an anomaly.
- Long hourly files still open at daily or weekly, keeping the default under about
  4,000 periods; a Data note offers a one-click switch to hourly.
- Speed:
  - Fits on long series use the latest ~4,000 periods in whole cycles: theta,
    Holt-Winters parameters and regression. Cycle search uses the latest 20,000.
  - Harmonics are computed by rotation; medians use typed sorts and quickselect.
  - Fremont hourly (122k periods): models 360 to 50 ms, decomposition 150 to 46 ms.
  - Daily temperatures: 47 to 35 ms.
- All 21 passes are clean (every readable file at its default grain, plus the six
  sub-daily files at their finest).
- Seasons found: ETTh1 hourly daily 0.53 (peak 00:00), Fremont hourly weekly 0.75
  (Tue 13:00), parking hourly weekly 0.79 (Sat 15:00), Air Quality hourly weekly
  0.41. Beijing hourly shows none: weather swamps the daily cycle.
- Not done: business-hours tables (rows only 9-17) count the night as gaps. This needs
  "structural hours", like the structural weekdays that already exist.

Owner review changes (2026-10-30, after run 3):
- **Impact tab dropped** (owner did not like it). Its model runs, panel, chart handles
  and event findings are removed. In their place, the trend's one clear break is
  drawn on the Explore and Decompose charts: a straight dashed trend on each side,
  labelled "Trend shift 20 Jan 2025: +2.7%/mo → +1.4%/mo". It can be switched off
  with "Trend shift" in the toolbar.
- **What-if scenarios declined for now.** If revisited, build them as scenarios in
  Forecast with evidence gates, not as a slider page: count of independent driver
  changes, the range seen, and the stability of the effect across backtests.
- **Forecast horizon follows the history**, not a fixed per-grain cap: the longest
  forecast that can still be backtested. Parking hourly allows 61 days, ten years of
  daily data about 6 years.
  - Shortcuts from 1 day up to 1 year (sub-daily), or 1 month to 2 years (daily);
    a "Longest" shortcut; "up to N" shown next to the box.
  - Typed numbers are clamped to the limit.
- **Patterns tab** (new). It uses hourly, daily and monthly series whatever grain is
  shown, and counts only complete periods. Contents:
  - Peak and low time of day; peak and low day; weekends vs weekdays; peak month.
  - A typical day: median, middle half, weekday and weekend means.
  - Day-of-week bars; month-of-year bars (the average day in each month, so long
    months are not favoured).
  - A weekday-by-hour heatmap.
- **Decompose "Daily + weekly"** below a day: separate daily-cycle and day-of-week rows.
- Explore zoom is visible: −/+ buttons, Shift-drag a range, and a hint line.
- Typed number boxes for the rolling window and the horizon; rolling min and max.
- Timing readouts removed from the UI.
- Fixed: gap periods were flagged as anomalies, which crashed Decompose on parking
  at mean.

**Shipped in the app (2026-10-30, CHG-2026-10-30-06):**
- The Time Series tab now runs the ported engine in the worker on the loaded,
  filtered table. It is keyboard 8, or the command bar `forecast`.
- Seasonal gap fill: on held-out 6-hour runs it is 2.6x more accurate than a straight
  line. Made-up values are never fitted or scored.
- Tests: 11 unit, 3 e2e. `bench:timeseries` is in the gate.
- The prototype stays as the design reference only.

**Closed out (2026-10-30, CHG-2026-10-30-07):**
- Chart line card kept (owner decision) and linked: "Open in Time Series →" opens the
  page on the same date, measure, aggregate, split and bucket.
- Time-weighted mean; repeated-totals warning; structural hours; scaled
  (multiplicative) seasons, also used by Theta.
- Python reference check done: prototypes/time-series/reference (results.txt).
  Decomposition matches statsmodels to 1e-13; forecasts in line.

## TODO (owner, 2026-10-30): make the data's frequency and shape obvious on the Time Series page

**Items 1 and 2 shipped 2026-10-31 (CHG-2026-10-31-03):** Frequency cell in the strip
(regular / regular with some missing / irregular, with the usual gap and p10-p90), and
the "Several series in one line" banner naming the column behind the repeats, with One
at a time, Average them instead and Keep the sum. **Item 3 shipped 2026-10-31
(CHG-2026-10-31-04):** a Source word reads a Pivot View's periods, linked to the view.
**Item 4 shipped 2026-10-31 (CHG-2026-10-31-05):** 365.25-day and 52.18-week years in
decomposition, seasons too short for the series shown greyed with the 2-cycles-plus-2
rule, and Daily view / Back to hourly in Decompose. Still open: an "Open in Pivot View"
button (needs a preset API on the views panel); periods counted in open slots only for
timetabled data; item 5 (STL/MSTL, Box-Cox, credits in exports).

**1. Show the frequency of the data, plainly.** Say what the page found, in the strip or
the sentence at the top: "hourly", "daily", "monthly", "every 10 minutes", or for uneven
data "irregular, usually every 12 minutes (middle 80% between 8 and 19 minutes)".
- Today: `buildTable` already works out the typical spacing (`cadence`, `cadSlots`) and
  `cadenceText` can say "30 minutes" or "month"; the Data finding mentions it only in
  passing ("Rows come about every 30 minutes"). Nothing says how regular it is.
- Add a **regularity** measure: share of gaps equal to the typical gap, and the spread
  (p10/p90 of gaps). Wording: regular / mostly regular (some missing) / irregular.
- Show it next to "Periods", with a one-click explanation, and use it to decide the
  default aggregate (levels read at uneven times suggest time-weighted mean).

**2. Flag clearly when there is more than one value per time period.** That means the
rows are not one series yet: several rows per timestamp (stores, car parks, sensors) or
many readings per period. The page then aggregates silently, and a sum or mean over
unlike things misleads.
- Today only partial cover exists: a sentence "That adds all N values together; pick one
  if they measure the same thing" (sum across groups), the uneven-readings finding
  (`A.spread`), and the repeated-totals warning (CHG-2026-10-30-07).
- Add one visible banner whenever the typical period holds more than one row: "Each
  hour holds 5 rows (one per car_park). This is 5 series added together. Split by
  car_park, filter to one, or aggregate first." With buttons: split by the group column,
  and "Open in Pivot View".
- Rule: compare rows per period to distinct timestamps; name the column(s) that explain
  the repeats (a category column that is unique within each timestamp).

**3. Read a precomputed Pivot View as the series.** The person may aggregate in Pivot
View first (group by month, measure sum of sales, filtered) and expect Time Series to use
that result, not the raw rows.
- Offer the Pivot View results as a source on the page, like the Chart cards' Source
  selector: "Source: Table / Pivot View: Monthly sales". The view needs a date-like
  dimension (a time-grain dimension) and one numeric measure; extra dimensions become
  the split column.
- The engine takes `TsInput` (times, columns, groups), so this is an adapter from
  `getAggregate`'s result to `TsInput`, plus the frequency taken from the view's grain.
  Keep it linked to the view (as D1 does for charts): when the view changes, the series
  follows.
- A view already aggregated needs no second aggregation: lock "sum/mean" and say so.

**4. Decomposition at which level? (rule of thumb, for hourly data)** Hourly data
usually has a daily and a weekly pattern, and a yearly one only with several years. The
page already decomposes hourly data as daily + weekly (`decomposeMulti`) and can show
the daily-level view by aggregating to days; the open work is choosing and explaining.
- Rule (fpp3, "complex seasonality"): include only the periods likely to be in the data,
  and only if enough cycles exist. fpp3's own example: with 180 days of data, ignore the
  annual cycle; for a natural phenomenon (temperature), weekly seasonality can usually be
  ignored. Hourly data "usually" has daily, weekly and annual patterns. The engine
  currently needs 2 full cycles plus 2 periods (`N >= 2p + 2`); fpp3 gives no minimum,
  so this is our rule, and should be said as such.
- Show both: the hourly decomposition (daily + weekly rows) and a one-click "aggregate to
  daily and decompose" for the weekly/yearly view, because a daily series answers
  "is there a weekday effect or a trend?" without the within-day noise.
- Weekly period from daily data is 7; yearly from daily is 365.25, from weekly 52.18
  (fpp3), which the grain ladder should use rather than 52.
- Irregular opening hours (rows only 7:00 to 21:05 on weekdays): fpp3 re-indexes to
  observation numbers and gives periods in observations (169 per day, 845 per week).
  We now detect closed hours (CHG-2026-10-30-07); next, make the period count open
  slots only.

**5. What to take from Rob Hyndman's work (attribution required).** The book is
*Forecasting: Principles and Practice* (3rd ed.), Rob J. Hyndman and George
Athanasopoulos, OTexts, https://otexts.com/fpp3/. The R package is `forecast`,
https://github.com/robjhyndman/forecast/ (GPL-3).
- **Already used, to credit in Help and the exports:**
  - trend and seasonal strength, 1 - Var(remainder) / Var(detrended or deseasonalised +
    remainder), from the book's decomposition chapter (see `ft`, `fs` in
    `src/data/timeseries/decompose.ts`); the strength measures are credited there to
    Wang, Smith and Hyndman (2006), verify the citation before printing it.
  - classical decomposition with a 2 x m or m moving average for even/odd periods
    (`decompose`), and multiple seasonal periods as in "complex seasonality" (`decomposeMulti`).
  - seasonal naive and drift/theta-style baselines, backtests scored against seasonal naive.
- **Worth adding next:**
  - **STL** (robust, with a seasonal and a trend window) as an option beside classical:
    it handles any period, a seasonal shape that changes slowly, and outliers (robust
    keeps them in the remainder). fpp3's defaults for single-period data are seasonal
    window 11 and trend window 21 for monthly data (from a summary of the page; verify
    on https://otexts.com/fpp3/stl.html before copying), both odd. **MSTL**, the multiple
    seasonality extension, would replace `decomposeMulti`.
  - **Box-Cox / log transform** so seasonal swings of constant relative size become
    constant: lambda between 0 and 0.2 usually works (fpp3 uses 0.10 on Australian gas),
    chosen by the Guerrero method; logs need positive data. This is the principled form
    of the "scaled seasons" choice in CHG-2026-10-30-07 and would also help Holt-Winters
    (the airline-passengers gap in the Python reference check).
  - Fourier terms for long periods in the regression model: fpp3 uses a fixed, subjective
    10 daily and 5 weekly terms for half-hourly data because AICc over-fits there; we
    use harmonics already, so check our counts against these.
  - **Outlier and missing-value cleaning** (the package's `tsoutliers`, `tsclean`) and
    **period detection** (`findfrequency`): not described in anything I could read, so
    read the package documentation (https://pkg.robjhyndman.com/forecast/) before
    building; do not guess the method.
- **Licence care.** The `forecast` package is GPL-3. TurboFuzz has no LICENSE file and no
  `license` field in package.json yet, so decide its licence first: re-implement from the published method and the book's
  formulas, never copy package code. Ideas and published formulas need credit, not
  permission; copied code would bring the GPL with it.
- **Attribution to ship:** a "Methods and credits" entry in the Time Series Help topic
  and a line in the CSV/recipe header ("Decomposition and strength measures follow
  Hyndman and Athanasopoulos, Forecasting: Principles and Practice, 3rd ed., OTexts,
  https://otexts.com/fpp3/"), added in the same change as anything new taken from it.
- Gaps in what I could read: the seasonal-strength page returned 404 (so the formulas
  above are from the code and the book's chapter, not re-checked against the page), the
  STL section came through only as a summary, and the package README has no citation
  text. Re-read https://otexts.com/fpp3/stl.html and the package's "Cite this
  repository" entry directly before quoting either.

Still to do (later, not blocking the Map page):
1. **Multiplicative Holt-Winters** with an automatic choice: statsmodels' beats ours on
   airline passengers (36.5 vs 50.7 MAE over 24 months).
2. **Closed hours in the models**: hourly forecasts on a timetable still fill the
   closed night hours with the seasonal fill (never scored, but drawn).
3. **Speed**: daily models now take 33-42 ms on 2.5k-3.7k days (budget 30 ms); regression is ~25 ms of it (11 refits). Next idea: fixed knot grid so backtest refits share one running Gram matrix.
4. More files from the test-set table below (wide electricity, PeMS, crime events,
   unbalanced debt panel) and the hand-made messy fixtures; then publish.

## Owner requests (logged 2026-10-30): Map page, drop the chart time series, date parts, messy-data testing

### 1. Maps get their own page (out of Chart)

**Shipped 2026-10-30 (CHG-2026-10-30-08):** Map tab with the map card at full width,
offline background pictures (whole world / world file / edges, plate carrée or Web
Mercator), up to 100 markers (table, paste, CSV, city search, click; 9 shapes or an
SVG; colour), and a bundled world-cities layer (Natural Earth, public domain). The map
card stays in Chart with "Open in Map →" (same call as the line card), so saved charts
need no migration. **2026-10-31 (CHG-2026-10-31-02):** dock on the map (cities, marker
size, click to add, Add markers window with paste/CSV/city and preview), marker sizes,
city labels kept clear of marker labels. Still open: markers in recipes/exports beyond
the CSV download.

Move the map card out of the Chart view into a dedicated **Map** page with its own
nav entry, like Time Series. Reasons: a map wants the full width and its own toolbar
(layers, base map, brush, colour/size by column), and it shares little with the card
grid. The Chart view keeps a small "Open in Map" suggestion when it sees a lat/lon
pair, so nobody loses the way in.

- Reuse what exists: `src/data/geo.ts`, `src/data/geo-file.ts`, the bundled
  `src/data/world-110m.ts` outline, the point sampling and density grids, and the
  rectangle brush on the lat/lon range filters.
- Saved charts and recipes with a map card migrate: they open on the Map page with
  the same columns and filters (no silent drop).
- The bundled **offline outline stays the default**, and the page never uses the
  network.

**Base maps stay offline (owner decision, 2026-10-30; replaces the online-tiles idea).**
The app never talks to the internet: `public/_headers` sets `img-src 'self';
connect-src 'none'`, and that stays. Instead the person can load **their own map
image** as the background:

- **Load a background image:** JPG, PNG or WebP, read from a local file with
  `createImageBitmap(file)` and drawn on the canvas, so no CSP change is needed
  (no `blob:`/`data:` image URLs). Nothing is uploaded; the file stays on the device.
- **Place it on the map:** the image needs its edges in lon/lat. Three ways, in order
  of ease: (1) a **world file** sidecar (`.jgw`/`.pgw`/`.wld`) loaded with it, which
  QGIS and most GIS tools write; (2) **"whole world"** (-180..180, -90..90) for
  global images; (3) type the west/east/south/north edges, with a live preview over
  the bundled outline and the data points so a misfit is obvious.
- **Projection:** support plate carree (equirectangular, the usual download) and
  Web Mercator (screenshots/exports of web maps); the person picks, default plate
  carree, and the outline overlay shows if the choice is wrong.
- Controls: opacity, greyscale (so coloured points stay readable), show/hide the
  outline on top, and remove. Very large images are downscaled on load (cap ~8k px
  long edge) with a note.
- **Remembered per dataset** in local storage only (IndexedDB); recipes record that a
  background was used and its bounds, never the image itself.
- **An in-app guide "Get an offline map"** (Help drawer and an empty-state link on
  the Map page) with short steps:
  - Natural Earth raster downloads (naturalearthdata.com, public domain): whole
    world, plate carree, so choose "whole world".
  - NASA Blue Marble / Visible Earth images (public domain): same.
  - Your area from OpenStreetMap: export an image of a box (e.g. from QGIS with the
    OSM layer, then "Export map to image" with a world file), noting OSM attribution
    is required when sharing the result.
  - Any scanned or drawn map: load it and type the four edges.
- PNG/GIF export includes the background, with any attribution the person typed.
- `docs/map-view-spike-memo.md`'s "no network tiles" no-go stands.

### 2. Drop the time series chart from Chart

**Superseded 2026-10-30:** the owner chose to keep the line card (it compares groups
on one chart, which the page does not) and link it to the Time Series page instead.
Done in CHG-2026-10-30-07. Original plan kept below for reference.

Owner: the Time Series page covers it, so the time series card type comes out of
Chart. Order matters:

1. **Do not remove it until the Time Series page ships.** Today the page is only a
   prototype (`prototypes/time-series/`).
2. Then the chart recommender's time series suggestions, the command palette
   `timeseries` verb and the "Add chart" rail send people to the Time Series page
   with the date column and measure filled in.
3. Saved charts and recipes with a time series card migrate to a Time Series page
   state (same columns, aggregate, grain, Every N, filters), with a one-line notice.
4. This replaces the "Analyse this series" card action decided above. The ways in
   become the nav entry plus those redirects. What was built for the card (Shift+drag
   brush, linked highlight on count time series, Every N buckets) carries over to the
   page's hero chart; nothing in the engine is lost.
5. Bar/line charts over a date-like category (such as a "Month" text column) stay in
   Chart. Only the dedicated time series type goes.

### 3. Make a date or datetime from split columns, right in the Time Series page

Very common in real files: `Year`; `Year, Month`; `Year, Month, Day`; plus `Hour`
(and `Minute`). The engine already exists (`src/data/date-combine.ts`, the Transform
"combine date/time" step, with Polars export), so this is mostly wiring plus better
detection:

- **In the Time Series page:** when no date column is found (and always, as a choice
  in the date picker), offer "Build a date from Year, Month, Day, Hour". One click
  adds the combine as a normal Transform step (undoable, in the recipe and the code
  export), then the page opens on the new column.
- **Detection fixes** found while checking (first two **done 2026-10-30** in
  `src/data/date-combine.ts`, with tests; the page prototype also builds dates from
  split columns and joins separate Date + Time columns):
  - `autoCombineParts` makes a datetime only when Hour **and** Minute both exist, so
    `year,month,day,hour` (Beijing PM2.5) becomes a date and 24 hourly rows collapse
    into one day. Hour alone must give a datetime (minute 0).
  - Names must match exactly today. Add common variants (`yr`, `yyyy`, `mon`, `mth`,
    `month_num`, `dd`, `hr`, `hh`, `min`), prefixed forms (`order_year`,
    `OrderMonth`) when the prefix is shared, and month names as values ("Jan",
    "January").
  - `Year` alone: offer a yearly date (1 Jan of that year) or keep it numeric; the
    page treats it as a yearly series either way.
  - `Year + Quarter` (1-4 or "Q1") and `Year + Week` (ISO week) need their own roles;
    there are none today.
  - Separate `Date` + `Time` text columns (UCI Air Quality: `10/03/2004` and
    `18.00.00`, with `-200` as missing) must combine too, including dotted times.
  - Check values, not just names: month 1-12, day valid for that month, hour 0-23.
    Report how many rows failed and why instead of quietly making them null.

### 4. Test on many more real series, including messy ones

Extend `prototypes/time-series/run-real.cjs` (and later a `test/` fixture set with
expected outputs) well past the first 11 datasets, covering every frequency and the
ways real files go wrong.

**Owner's parking file** (`jay-stein/chaddy-parking-scraper`, `data/parking.csv`,
profiled 2026-10-30): 29,405 rows, 5,881 snapshots of 5 car parks (A, B, C, E, F),
12 Jul to 30 Oct 2026. What it teaches:

- **Irregular intervals.** Gaps run from 15 seconds to 3.5 hours. The median is 30
  minutes, but about 40% of gaps are 10-29 minutes and a few hundred are 40-120
  minutes. A native cadence from the median alone says "30 min", which is wrong for
  a third of the data.
- **Levels, not flows.** `occupied` and `vacant` are counts at a moment. Summing them
  per hour is meaningless and grows with the number of snapshots in that hour, so the
  sum default draws a fake pattern. For levels the right answer is a **time-weighted
  mean** (or the last value) per bucket. The page must not guess from names, so it
  should detect uneven sampling and, when the aggregate is sum, say plainly "Buckets
  have 1 to 6 readings each, so a sum changes with how often data was taken", with
  mean / last / time-weighted mean one click away. Add time-weighted mean as an
  aggregate.
- **Repeated totals.** `total_occupied` and `total_vacant` repeat on every car-park
  row, so summing across car parks counts them five times (same family as issue 3 in
  run 1). Detect "constant within a timestamp" columns and warn before summing
  across groups.
- **Long format.** One row per (time, car park); the group column must split it into
  five series cleanly.
- A daily and weekly cycle is likely on sub-daily data, so this is a real test of the
  multi-season (MSTL) path.

**From `liaoyuhua/open-time-series-datasets`**, picked by what each one breaks:

| Dataset | Frequency | Why it is in the set |
|---|---|---|
| Beijing PM2.5 (`jbrownlee/Datasets/pollution.csv`) | hourly, 5 yrs | `year,month,day,hour` split columns; `NA` gaps; wind-direction category |
| ETT (ETTh1 hourly, ETTm1 15-min) | sub-hourly | 70k rows; long clean sub-daily series; daily and weekly cycles |
| UCI Air Quality | hourly | separate `Date` + `Time` (dotted), `-200` sentinel, semicolons, decimal commas |
| UCI Electricity load | 15-min, 370 series | wide format (one column per client); very large |
| Seattle loop / PeMS traffic | 5-min, daily | many sensors; occupancy rates 0-1 |
| Singapore population | annual | very short yearly series; groups |
| Historical public debt | annual, 1800-2015 | unbalanced panel: each country starts in a different year |
| Global climate (1750-2015) | monthly | very long; early years sparse |
| NYC / Baltimore / Kansas City crime | event timestamps | events, not measurements: count per period |
| Airline delays | monthly | several measures; airport groups |
| Wikipedia web traffic (Kaggle) | daily | spikes, zeros, very many series |

Add hand-made messy fixtures for what public data rarely shows alone: duplicate
timestamps, unsorted rows, mixed date formats in one column, Excel serial dates,
`dd/mm` vs `mm/dd` ambiguity, time-zone suffixes on only some rows, a daylight-saving
duplicate hour, trailing blank rows, a partial current month, a series that changes
cadence half way (daily, then weekly), and long dead spells.

For each dataset, record: loads (or refuses with a clear message), detected cadence
and grain, chosen aggregate and its warning, season found, model run times against
the budgets, and no NaN or "0 a month" text. Then fix, re-run and publish.

## BIG TODO (owner, 2026-10-31): the Table view, the most important page

**Owner:** the Table is the most important page in the app, and its ease of use is
paramount. Four asks: insert columns easily (calculated from other columns, a
constant, or whatever the person wants; borrow Power BI's good ideas); navigate the
table (head or tail, reverse the order, go to row n); edit a cell directly, with an
"are you sure" confirm and a way to reverse it; and a real usability pass on the page
wherever it falls short.

**Today (checked 2026-10-31):** no step adds a column. Transforms only reshape or change
existing ones (round, impute, split, combine dates, flag outliers, melt, group by). The
`#` column is the position in the current order, so the file's own row number is lost
once rows are sorted. The grid has no keyboard movement between cells, no "go to row",
no position read-out, no reverse, and cells cannot be edited. Parts to build on: the safe expression compiler behind
Pivot View measures and lambdas (`compileExpression` in `src/data/aggregate.ts`,
`src/data/pivot-lambda.ts`; no JavaScript is ever run), recipe steps with pandas and
Polars export plus the parity tool (`tools/recipe-parity`), the virtual-scrolling grid
(`src/ui/table.ts`), and the Add markers window as a model for a pop-out with a live
preview.

Rules for all of it: every new column is a Recipe step (undoable, replayed on reload,
exported to pandas and Polars, parity-tested); evaluation runs in the worker over whole
columns; nothing is applied without a preview; every control has a keyboard path.

### 1. Insert columns

**Ways in (all open the same "New column" window at the right place):**
- A **+ column** at the right end of the header row (always visible, like a spreadsheet's
  next empty column) and on hover between two headers.
- Header right-click: **Insert column left / right…**, first in the menu.
- Command bar: `add column`, `add column total = [price] * [qty]` (runs straight away
  when it reads, else opens the window filled in).
- From a column: **Add column from this…** opens the window with that column picked.

**The New column window.** One window, five ways to say what goes in it, as Power
Query's *Add Column* ribbon does. Name, position and type sit at the top; a live preview
on the right shows the first 20 rows next to the columns it reads, plus a count of rows
that come out empty or in error and why ("12 rows divide by zero → empty").

1. **Formula** (Power Query *Custom Column*, DAX calculated column, an Excel formula).
   - Columns written as `[Amount]`, autocompleted on `[` from the column list, with each
     column's type shown. Clicking a column in the list inserts it.
   - Excel-style functions, because that is what people know: `IF`, `AND`, `OR`, `NOT`,
     `ROUND`, `ABS`, `MIN`, `MAX`, `LEN`, `LEFT`, `RIGHT`, `MID`, `UPPER`, `LOWER`,
     `TRIM`, `CONCAT` / `&`, `CONTAINS`, `YEAR`, `MONTH`, `DAY`, `WEEKDAY`, `DATEDIFF`,
     `TODAY`, `COALESCE`, `ISBLANK`. Function help appears as you type (signature and
     one example).
   - Row-level only in the first release. Window functions (running total, previous row,
     % of total) come as quick picks below, not as formula syntax.
   - Errors point at the place in the formula ("`[Amout]`: no such column, did you mean
     Amount?", reusing the fuzzy column search).
   - Engine: extend the safe compiler to row expressions over typed columns (numbers,
     text, dates, booleans, blanks); compile once, then evaluate column by column in the
     worker. Never `eval`.
2. **Constant**: a value and its type (text, number, date, Yes/No). Example: a `source`
   column before merging files.
3. **Conditional** (Power Query *Conditional Column*): if / else-if / else rows built
   from pickers (`[Status]` `is` `Closed` → `Done`), so no formula needs writing. It
   compiles to the same expression, and **Show as formula** switches to the formula view
   to keep editing.
4. **From examples** (Power Query *Column From Examples*, Excel *Flash Fill*): type
   what you want in two or three rows and the window finds the rule that gives it,
   shown as a formula you can read and edit. Search a small, fast set of rules: text
   before or after a separator, first or last N characters, a word by position, change
   of case, two columns joined with a separator, a date part, a number rounded or
   scaled. Second phase; name the rule when it is ambiguous ("2 rules fit; this one
   also fits the next 1,000 rows").
5. **Quick picks** (one click, also on a column's header menu under **Add column ▸**):
   duplicate; index (1, 2, 3… in the current order, or the file's row number); date
   parts (year, quarter, month, weekday, hour); text length; bins (equal width, equal
   count, or edges you type); rank; % of total; running total; change from the
   previous row; join columns with a separator.

**Recipe and export.** One new op, `{ kind: "derive", name, at, expr }` (expr kept as
the formula text plus its compiled form), shown in Recipe as `Added "total" =
[price] * [qty]`. Editing the step reopens the window. pandas export: `df.insert(at,
name, …)` with vectorised expressions (`np.where` for IF); Polars: `with_columns` with
`pl.when(...).then(...)`. Every function gets a parity case.

**Computed once (decided, DEC-2026-10-31-02).** A new column is a value computed when
the step runs; the Recipe replays it when earlier steps change. It does not update when
a cell it reads is edited later; editing the formula step recomputes it.

**Budgets (bench/derive.ts, in the gate):** preview on the 20 shown rows < 16 ms per
keystroke; apply a simple formula to 1M rows < 150 ms p95 in the worker; IF over 1M rows
< 250 ms.

### 2. Navigate the table

- **Where am I:** a read-out in the results bar, "Rows 41–66 of 12,480", that follows
  the scroll. Clicking it opens Go to row.
- **Go to row** (Ctrl+G, as in Excel): a small box takes `n` (1-based, in the current
  order), `-1` for the last row, `50%` for the middle, or `file 1234` for the file's own
  row 1234 wherever sorting put it. The row is scrolled to and flashed.
- **Head and tail:** **Top** and **Bottom** buttons (also Ctrl+Home and Ctrl+End).
  **Show first N / last N** puts a chip in the filter bar ("First 100 rows"), the pandas
  `head()` and `tail()` habit, so Copy, Chart and Export see the same rows.
- **Reverse order:** a toggle that reverses whatever order is current (file order,
  sorted or shuffled), with a chip "Order: reversed" next to the filters.
- **Say what the order is:** "Order: file order" / "sorted by Amount ↓, then Region" /
  "shuffled" / "reversed", with one click back to file order.
- **Row numbers:** the `#` column shows position in the current order. Add an optional
  **File row** column with the file's own row number, and show both on hover, so a
  sorted or filtered row can always be traced to the file.
- **Keyboard grid:** a cell cursor with the arrow keys, Page Up/Down, Home/End,
  Ctrl+arrows to the edge of the data (Excel), Enter to open the cell, Ctrl+C to copy
  the cell or a selected range, Esc to clear. Screen-reader grid roles with the row and
  column read out.
- **Go to column:** the same box takes a column name (fuzzy), scrolls to it and flashes
  it.
- **Freeze columns:** pin the first column or columns while scrolling sideways.
- **Come back to the same place:** the scroll position and cursor are kept when you
  switch tabs and return.

### 3. Edit a cell directly (owner, 2026-10-31)

Click a cell to change its value, confirm, and undo later if wanted.

- **Start:** double-click a cell, press Enter or F2 on the cell cursor, or start typing
  (as in a spreadsheet). A single click selects; it never edits by accident.
- **Edit in place:** the cell becomes an input sized to the column, with the old value
  shown under it. For the column's type: numbers are checked as you type (locale
  aware), dates and times get the column's own format with a picker, Yes/No a toggle,
  and a category a list of its values with "new value…". Esc cancels; Enter or Tab
  commits.
- **Are you sure:** on commit a small confirm appears next to the cell, not a page
  modal: "Change Amount in row 1,234 (file row 88) from 4,500 to 45,000?" with Change
  and Cancel. A **Don't ask again for this session** box serves people editing many
  cells. A value that does not fit the type ("abc" in a number column) is said plainly,
  with "keep as text" or "fix" as the choices, and is never quietly emptied.
- **Undo:** every edit is a Recipe step, `{ kind: "setCell", fileRow, column, from,
  to }`, so Undo (Ctrl+Z), the toast's Undo and Recipe all reverse it. Several edits in
  a row group into one step, "Edited 5 cells in Amount", that can be expanded and
  reverted one by one. Edits are tied to the **file's row number**, not the position on
  screen, so sorting, filtering or shuffling never moves an edit to another row (this
  is why the File row number in section 2 comes first).
- **See what was changed:** edited cells carry the existing "changed since load" mark
  (the Changes highlight), with the old value on hover and a "Revert this cell" action.
- **Export:** pandas `df.loc[file_row, "Amount"] = 45000` per edit (one `df.loc` block
  per grouped step); Polars a `when(pl.int_range(...) == row)` update. Parity-tested
  like every step.
- **Limits:** edits on rows a later step removes are kept in the Recipe but report "row
  no longer present"; editing a formula column (section 1) is refused with "edit the
  formula instead"; pasting a block of cells (a range from a spreadsheet) is a second
  phase, behind the same confirm ("Change 40 cells?").

### 4. Usability pass (from screenshots, 2026-10-31)

- **Headers cut the column name** ("Customer…", "Annual …") while the column number,
  type badge, sort arrow and filter take the space. Give the name first claim on the
  width: column number on hover only, type as a small icon, auto-fit widths to the name
  and the content's typical length, full name in a tooltip.
- **The header menu is 26 items long.** Lead with the common actions (Sort, Filter,
  Insert column, Rename, Hide), group the rest into submenus (Clean ▸, Transform ▸,
  Add column ▸), and let typing filter the menu (as the command bar does).
- **Hide and show columns** without deleting them, with a "3 hidden" chip to bring them
  back.
- **Long values:** clicking a cell opens a small peek with the full value, its type and
  Copy; text wrap per column on request.
- **Consistent buttons:** the shuffle button is an unlabelled icon next to labelled
  ones; label it or give every icon button a tooltip and an accessible name.
- **Hints must not cover data:** the first-run hint cards sit over the grid's rows; dock
  them to the results bar or a corner outside the rows.
- **Density:** compact / comfortable row height, remembered.
- **Empty and loading states:** what a filtered-to-nothing table says, with one click to
  clear the filter that emptied it.

### Order of work

**Steps 1-6 shipped 2026-10-31 (CHG-2026-10-31-06 to -13):** navigation, first/last N, New column (formula, value, If / then, quick columns, from examples) with pandas/Polars export, cell editing and pasting, the usability pass. Left: row density, hints off the rows.

**Step 1 shipped 2026-10-31 (CHG-2026-10-31-06):** the bar under the Table with the
position read-out, Go to (row, -1, %, file row, column), Top/Bottom, Reverse, the order in
words and Back to file order, and the File row column. First / last N followed the same
day (CHG-2026-10-31-07).

1. Navigation basics: position read-out, Go to row and column, Top/Bottom, reverse,
   order chip, File row column. Small, and every session benefits; the file row number
   is also what cell edits hang on.
2. New column window: Formula and Constant, + column in the header, the `derive` step
   with pandas and Polars export, parity cases, bench.
3. Keyboard grid (cell cursor) and editing a cell with the confirm, `setCell` steps,
   Undo and the changed-cell mark.
4. Conditional builder and quick picks.
5. Usability pass on headers, the menu, hidden columns and cell peek; frozen columns.
6. From examples; pasting a block of cells.

**Decided (owner, 2026-10-31, DEC-2026-10-31-01):** formulas are Excel style
(`[Column]` references, `IF`, `UPPER`, `YEAR`…), with the matching pandas line shown under
the preview and a few aliases (`&`/`CONCAT`, `COALESCE`/`IFBLANK`).

**Also decided (owner, 2026-10-31, DEC-2026-10-31-02):** new columns are computed once;
"first N / last N" limits what Copy, Chart and Export see, like any other filter; the
cell-edit confirm is on by default, with "don't ask again this session". No open
questions remain for the Table plan.

## Time Series (owner, 2026-10-31): why one model over another, overfitting, AutoARIMA

Owner: "I want the time series user to understand a bit more why they may go with one
model over another. Overfitting is a major concern... rolling window training and
testing... different performance metrics like WAPE, MAE, sMAPE... a pop-out window
explaining the metrics: Metric, Why it's good, When to use it, Math."

### Done first (2026-10-31, CHG-2026-10-31-14): auto-ETS, and an honest backtest

- "Best smoothing": ETS(error A; trend N / A / Ad; season N / A / M), the lowest AICc.
- Holt-Winters used to be tuned on all the history, including the periods its
  backtest was scored on. That flattered it, which is overfitting by another name. Now ETS and
  Holt-Winters backtests use parameters fitted only on data before the first origin.

### Validation and metrics (shipped 2026-10-31, CHG-2026-10-31-15; the fit gap was dropped, see the changelog)

1. **Validation window**, a visible choice on the Forecast board:
   - *Expanding* (default): each backtest trains on everything before its origin.
     This is the classic time-series cross-validation (fpp3 §5.10).
   - *Rolling*: each trains on a fixed-length window ending at its origin, so old
     regimes are forgotten. It shows whether a model only does well with lots of history.
   - Number of folds (3 to 10) and the spacing between them stay automatic (H/3), and are shown.
2. **Metrics**, computed from the same backtest errors (no extra fitting):
   MAE, RMSE, MASE, WAPE, sMAPE, MAPE, bias. A "Rank by" picker on the board; the Auto
   pick follows it.
3. **Overfitting signals** on the board, per model:
   - *Consistency*: the spread of error across folds. A model that wins one fold
     and loses the rest is luck, not skill.
   - *Fit gap*: in-sample error against backtest error. A small fit error with a large
     backtest error means the model learned noise.
4. **"Which model and why" pop-out**: one line per model (when it shines, when it
   fails), plus the metrics table: Metric | Why it's good (strengths) | When to use
   it | Math (formula).

### AutoARIMA (plan only)

The goal is statsforecast's AutoARIMA level, with no dependencies.

- **Search**: Hyndman–Khandakar stepwise (Hyndman & Khandakar 2008, J. Stat. Software 27(3)):
  - start from (2,d,2)(1,D,1), (0,d,0)(0,D,0), (1,d,0)(1,D,0) and (0,d,1)(0,D,1);
  - move p, q, P and Q by ±1 while AICc improves;
  - limits p, q ≤ 5 and P, Q ≤ 2.
- **Differencing**:
  - d from repeated KPSS tests at 5%;
  - D from the seasonal-strength measure (F_s > 0.64, as statsforecast does);
  - never more than d + D = 2.
- **Likelihood**: exact Gaussian likelihood through a state-space form and a Kalman
  filter, with CSS for the starting values, then a bounded quasi-Newton optimiser
  (an L-BFGS-B port, about 300 lines). Stationarity and invertibility are enforced by
  reparametrising through partial autocorrelations.
- **Long seasons** (half-hourly 48, hourly 168, daily 365): full seasonal ARIMA becomes
  slow and unstable when m is above about 24. For those, take the season out with the
  existing decomposition (or MSTL), fit a plain ARIMA on what remains, and add the season back.
  This is what statsforecast's MSTL + AutoARIMA recipe does.
- **Cost**: tens of fits of O(n·r²) Kalman passes. That is fine for a few thousand points,
  too slow for the instant budgets. So it runs on a background tick after the other models
  draw (as Patterns does), marked "Fitting ARIMA…". It is never in the bench
  open/drag paths. Fits are cached per series and window, and the backtest reuses the order
  chosen before the first origin (the same honesty rule as ETS).
- **Prediction intervals**: from the model (ψ-weights), shown beside the backtest-error
  band, so the two can be compared.
- **Parity**: the `.venv-recipe-parity` venv gets `statsforecast`. A script fits
  AirPassengers, a few M4 monthly and quarterly series, and the bundled energy series.
  Pass when the chosen order matches most of the time and MAE is within about 5%.
- **Licence**: written from the published method and statsforecast's Apache-2.0 docs.
  R `forecast` is GPL; do not copy its code.
- **Expected gain**: honest. On M4-style benchmarks AutoARIMA and auto-ETS land within
  a few percent of each other, and the blend of both beats either. The win is a second
  strong, very different model for the Blend, plus a name forecasters trust. It is not
  a leap in accuracy.

### Review against fpp3 (2026-10-31): where we stand, and the overfitting roadmap

Already in line with *Forecasting: Principles and Practice*:
- the seasonal naive benchmark (§5.2);
- time-series cross-validation on a rolling origin, expanding or rolling (§5.10);
- MASE as the default measure, scaled on training data (§5.8);
- ETS chosen by AICc (§8.6);
- Theta and forecast combinations (§13.4);
- STL-style decomposition (§3.6);
- intervals from out-of-sample errors (in the spirit of §5.5).

The honest backtest (settings fitted before the first fold) and the validation curve go beyond most tools.

Ranked improvements, overfitting first (items 1-6 shipped 2026-10-31: lockbox CHG-22, Deep check CHG-23 for 2-5, filled periods CHG-24):
1. **Selection bias from picking the winner.** The Auto pick is the minimum of 7 models over the same folds, so its reported score is optimistic (winner's curse). Fix: score the chosen model on a final lockbox it never saw during selection (the last fold held back from ranking). Report "selected on folds 1..k-1, confirmed on fold k".
2. **Are differences real?** Add a Diebold–Mariano test (with the Harvey small-sample correction) between the pick and the runner-up, and the baseline. "Not significantly better" should push toward the simpler model.
3. **Residual diagnostics (§5.4).** Show the ACF of one-step residuals and a Ljung–Box test. Leftover autocorrelation means the model missed structure; none, with a worse backtest, suggests it is overfitting noise.
4. **Accuracy by horizon (§5.10).** Plot each model's error against steps ahead. Some models win at short range and lose at long range, and one average hides that.
5. **Interval calibration across all folds.** The band check uses only the latest fold. Do leave-one-fold-out coverage for every fold and report 80%/95% coverage and the Winkler or CRPS score (§5.9).
6. **Smoothing models through filled periods.** ETS, Holt-Winters and Theta run through filled values (the regression skips them). Treat them as missing in the state updates (ETS supports it) so no made-up value is learned from.
7. **Transformations (§3.1, §5.6).** Offer Box-Cox / log with bias-adjusted back-transform for all models, not only the regression.
8. **ETS with multiplicative errors (§8.5).** Point forecasts are the same, but the intervals and likelihood differ, as does AICc across error types.
9. **ARIMA (ch. 9).** See the AutoARIMA plan above. The Difference plot in Explore is its first step.
10. **Bagged ETS (§12.5)** for robustness, and **reconciliation (ch. 11)** for split series that should add up to the total.

### Evaluation on 13 real series (2026-10-31, `tools/ts-eval`)

The series:
- monthly: airline passengers, Quebec car sales, shampoo, sunspots;
- daily: Melbourne minimum temperature, California female births;
- hourly: gym occupancy, and Chadstone parking (five car parks and their total).

Findings:
1. **Auto holds up.** On the unseen lockbox fold the Auto pick ranked #1.92 of 7 on average (#1 in 8 of 13).
2. **Rules that switch Auto to a simpler model did worse on unseen data:**
   - simpler when Diebold–Mariano is not significant: mean rank #2.38. It switched 6 times; with 9 folds the test has little power, so it drops real gains. On the gym data it gave up a 28% better model at p = 0.23, and the replacement ranked #6.
   - simplest within 2% of the best: #2.15;
   - simplest within 5%: #2.08.

   Decision: Auto stays as is. The Deep check keeps the DM verdicts as advice, not as an automatic switch. Revisit with more series.
3. **Chadstone parking: timestamps ignore daylight saving.** After Melbourne's clocks went forward (4 Oct 2026), the hour-of-week pattern sits one hour earlier in the recorded times: correlation 0.991 at a one-hour shift, against 0.925 unshifted. Repeat-last-week (MASE 0.6-1.2) then beats every model that blends older weeks (about 2), because their forecasts land an hour late. **To build:** a detector for a persistent phase shift in the daily profile (DST-like when near a March/April or September-November change), with a one-click fix that shifts the periods before (or after) the change by the detected hours.
4. **Bands run slightly narrow.** Leave-one-fold-out coverage of the 80% band is 61-79% (median about 75%) and of the 95% band 89-94%. **To build:** a finite-sample (conformal-style) adjustment of the band quantiles, i.e. the ⌈(n+1)q⌉/n quantile, re-checked with this harness.
5. **No better default for Trend flexibility.** The best setting per series ranges over 1-10 (median about 7) and the curves are often flat. Keep 5, and rely on the per-series validation curve.
6. **Residuals of hourly series are rarely white** (Ljung–Box p < 0.05 on 10 of 13). Expected with several seasons. It argues for the Deep check's honesty, not for a model change yet.
