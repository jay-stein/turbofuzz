<!-- markdownlint-disable-file -->

# Task Research Notes: Overview, Chart, Map, Treemap and Reports/Outlier Feedback

> Status: **Research complete, implementation not started.** This note maps every feedback item to the current code, verifies root causes, evaluates the map/outlier options, and proposes one implementation path.
>
> **Decisions locked 2026-10-25:** Relationships live on the new Outliers page; Isolation Forest, PCA and LOF all ship in the first release. The page uses a **two-tier compute model**: a default quick pass targeting **<5 seconds**, and an explicit **Deep compute** brain button for the thorough pass, which must always finish in **under 30 seconds**. Smart sampling/caching keeps the default path as snappy as possible.

## Research Executed

### File Analysis

- `src/ui/overview.ts` (752 lines)
  - The Overview renders `datasetLine → health tiles → next steps → missingness map → all columns → actions` (lines 485-492).
  - The only Stats Report entry point is a small `link stats-link` in the bottom action row (lines 695-702); the CSS is `font-size: 12.5px` (`src/styles.css:6119-6121`).
  - The missingness section is built before the column grid (line 489-490), not at the bottom.
- `src/ui/missingness.ts` (615 lines)
  - The map starts collapsed when `complete >= 0.99` and at least one column has missing values (line 240-241).
  - The only way to expand it is the small `Show map` button in the heading (lines 175-186); it is hidden unless `collapsible` (line 333).
  - The map wrapper is capped at `max-width: 820px` (`src/styles.css:5925-5928`) and the canvas is capped at `MATRIX_MAX_HEIGHT = 320` (line 7).
- `src/ui/app.ts` (5,293 lines)
  - `chartOpened` is set only when the ChartsPanel is constructed (lines 2028-2031).
  - `updateChartBadge()` derives `ideas` from `suggestCharts(...).length` and displays `"N ideas"` until `chartOpened` (lines 3339-3343).
  - `ensureCharts()` wires the panel and restores saved configs; it does not add a default card (lines 2028-2077).
  - Reports is mounted as a separate host (lines 957, 967, 2940, 3200-3218).
- `src/ui/chart-panel.ts` (993 lines)
  - `setColumns()` adds one default card the first time it sees columns (lines 789-797); this is the hard-coded chart preload.
  - `presetFor()` picks a first-card type from the data (lines 321-373); `setColumns()` calls `addCard()` with no preset, so this is the preloaded card.
  - The empty state appends three suggested chart buttons (lines 965-990) in addition to the toolbar and chart-type rail.
- `src/ui/chart-utils.ts` (733 lines)
  - `suggestCharts()` always returns at most three ideas (`return ideas.slice(0, 3)`, line 385); that is why the badge says "3 ideas" for most datasets.
  - `pickDefaultCard()` chooses a line, bar, or histogram card for the preload (lines 236-274).
- `src/ui/chart-card.ts` (10,395 lines)
  - Chart Settings is a native `<details>` popover (lines 2185-2189) with absolute positioning (`src/styles.css:4885-4925`), but there is no outside-click or Escape close handler; it stays open until the summary is clicked again.
  - The map basemap is the vendored 110m TopoJSON, lazily imported (lines 172-190, 180-185).
  - `fitMapView()` already fits the 1st-99th percentile of plotted points (lines 108-157), and `mapViewOrAuto()` uses that fit (lines 6697-6711).
  - Wheel zoom, drag pan, and double-click reset already exist (lines 2226-2229, 5986-6005, 6648-6665, 6695-6763).
  - The only visible reset control is `Reset view`, and it is hidden until a zoom/pan has happened (lines 5909-5935); there are no visible zoom or auto-fit buttons.
  - Map layer buttons say `Load regions` / `Clear regions` (lines 1728-1763).
  - Treemap only accepts `isCategoryType` (line 3503), only sums a numeric `sizeColumn` (lines 4745-4767), and falls back to facet counts when `sizeColumn < 0` (lines 4813-4817).
  - The treemap `Size` picker is hidden in Settings; the treemap does not expose a measure/aggregation choice at add time (chart setup falls through to the category-only branch, `src/ui/chart-setup.ts:257-280`).
- `src/ui/chart-setup.ts` (332 lines)
  - Treemap is handled by the final `else` branch: only a `Category` selector, no measure or aggregation (lines 257-280).
- `src/ui/chart-gallery.ts` (439 lines)
  - `fitChartKind("treemap")` requires a category column and presets `sizeColumn: -1` (lines 105-118).
- `src/ui/view-tabs.ts` (120 lines)
  - `ViewId` and `VIEW_ORDER` include `reports` (lines 3-11); the label is "Reports" (lines 34-37).
- `src/ui/reports-panel.ts` (587 lines)
  - Reports has three tabs: Quality, Relationships, Anomalies (lines 30-36).
  - Quality combines quality findings plus co-missingness, dependencies, text profiles, distribution changes, and near-duplicate clusters (lines 320-377).
  - Relationships uses Pearson/Spearman/Cramér's V/η² plus an "Explain column" selector (lines 387-415, 497-531).
  - Anomalies combines univariate findings with group-relative findings (lines 379-385).
- `src/data/relationships.ts` (350+ lines)
  - Already computes Pearson, Spearman, Cramér's V, and η² over current rows, with effect-size ranking (lines 1-220+).
- `src/data/dependencies.ts`
  - Already discovers functional dependencies/candidate keys ("determinant → dependent") with violation counts.
- `src/data/anomalies.ts` (260 lines)
  - Existing univariate outliers are robust: modified z-score/MAD, log1p for right-skewed positive data, quantile fallback, and text-length fences (lines 1-260).
- `src/data/group-anomalies.ts` (230+ lines)
  - Existing group-relative outliers use robust z per group (median/MAD), a minimum group size, and combined per-column bits.
- `src/worker/protocol.ts` / `src/worker/search.worker.ts` / `src/ui/worker-client.ts`
  - Worker requests already return typed arrays and apply row masks; `getGroupAnomalies` is the closest precedent for a new outlier request (protocol lines 519-531; worker lines 1559-1572).
- `src/search/query-engine.ts` (388 lines)
  - `setSpecialBits()` already supports externally computed specials (lines 98-106), and `SpecialFilter`/`Dataset` bits drive table filtering.
- `src/data/dataset.ts` (72 lines)
  - `applyGroupAnomalies()` stores lazily computed group bits (lines 67-71); a new outlier model can follow the same pattern.
- `tools/vendor-world.mjs`
  - The vendor script currently writes only `src/data/world-110m.ts`; it is easy to generalize for a 50m module.

### Code Search Results

- `Show map|Hide map|collapsible|expanded`
  - Confirms the missingness map's collapse state is the reason it disappears on near-complete data (`missingness.ts:166-168`, `240-241`, `328-335`).
- `setBadge|chartOpened|suggestCharts`
  - Confirms the "3 ideas" badge is a hard-coded `slice(0, 3)` problem, not a count of actual chart cards.
- `addCard\(\)|setColumns`
  - Confirms the chart preload is the unconditional `this.addCard()` in `setColumns()` when `entries.length === 0`.
- `chart-settings-disclosure`
  - Confirms Settings is a native `<details>` and has no close-on-outside or Escape logic.
- `Load regions|Clear regions|world-110m|fitMapView|resetViewButton`
  - Confirms the map uses 110m, has hidden reset-only controls, and no visible zoom/auto-fit buttons.
- `treemap|sizeColumn|isCategoryType`
  - Confirms treemap is category-only, count-by-default, and sum-only.
- `reports|ReportsPanel|ensureReports`
  - Enumerates all removal points: view tabs, app host/panel, command bar, help copy, CSS, tests.
- `anomaly|groupAnomal|relationship|dependenc`
  - Confirms existing univariate, group-relative, relationship, and dependency engines are reusable rather than needing replacement.

### External Research

- #fetch:https://scikit-learn.org/stable/modules/outlier_detection.html
  - Verifies the outlier-detection vs novelty-detection distinction.
  - States that `IsolationForest` and `LocalOutlierFactor` "perform reasonably well" on the comparison datasets, while `OneClassSVM` "is known to be sensitive to outliers and thus does not perform very well for outlier detection."
  - Confirms `contamination` sets a percentile threshold on the score; LOF is for outlier detection by default and scores training samples via `negative_outlier_factor_`.
- #fetch:https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html
  - Defaults: `n_estimators=100`, `max_samples="auto"` = `min(256, n_samples)`, `contamination` in `(0, 0.5]`.
  - Confirms path length is the normality score and random partitioning gives shorter paths for anomalies.
- #fetch:https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.LocalOutlierFactor.html
  - Default `n_neighbors=20`; locality is defined by k-nearest-neighbor distances; recommends k above the smallest cluster size and below the maximum number of nearby potential outliers.
- #fetch:https://github.com/topojson/world-atlas
  - `countries-50m.json` is Natural Earth Admin 0 boundaries at **1:50m medium scale**; `countries-110m.json` is **1:110m small scale**.
  - Both files include `countries` and `land` geometry, are quantized, and are in decimal degrees; the repo is a redistribution of Natural Earth 4.1.0 (public domain).
- Local measurements of the candidate basemaps:
  - `countries-50m.json`: 756,420 bytes raw, 232,879 bytes gzip, 1,959 arcs, 80,617 points, 241 country geometries.
  - `world-110m.ts` (current embedded basemap): 108,002 bytes, 38,692 bytes gzip, 595 arcs, 8,246 points, 177 country geometries.
  - 50m is ~7× the bytes and ~9.8× the points of 110m; it is the right "slight increase" and still far smaller than 10m.

### Project Conventions

- Standards referenced: `07_QUALITY_GATES.md` (test layers, no-lint gap, manual browser verification), `next_steps.md` (latency, no-bloat, offline-first), `08_DECISION_LOG.md` (decisions need evidence), and the existing research stream under `.copilot-tracking/research/`.
- Instructions followed: browser-only/no-network architecture; worker-owned heavy computation; typed-array protocol payloads; generation guards; reversible data operations; tests with `node:test` + `happy-dom`; no new runtime network requests.

## Key Discoveries

### Project Structure

TurboFuzz is a Vite + TypeScript browser app. The view shell is `Overview | Data Quality | Table | Pivot View | Chart | Reports`, with each lens mounted into its own host in `app.ts`. Heavy work lives in `src/worker/search.worker.ts`; the UI receives typed arrays and metadata. Charts are independent `ChartCard` instances inside `ChartsPanel`. Map rendering is canvas-based and uses a vendored 110m TopoJSON.

The important structural consequence: **any row-level outlier method must run in the worker**, because the UI only has column metadata and not the raw values. The existing `getGroupAnomalies` request is the template: compute in worker, store row bits, return summaries, and optionally apply a special filter.

### Implementation Patterns

- **Lens state is application state, not routing** (`view-tabs.ts`, `app.ts:2928-2959`). Removing Reports and adding Outliers is a view-ID change plus a new host/panel.
- **Heavy work is asynchronous and generation-guarded** (`chart-card.ts:4714-4739`, worker request handlers). A new outlier analysis should follow the same pattern and return `ms`.
- **Typed arrays keep payloads small** (`Float32Array`, `Uint32Array`, `BitSet`). Scores and row indices should use typed arrays, not object arrays.
- **Worker row masks filter the table** (`QueryEngine.setSpecialBits`, `Dataset.groupAnomalyBits`). A new outlier model should store a `BitSet` and expose a special filter.
- **Chart cards already own their own controls and settings**; global chart configuration changes belong in `ChartCard`/`ChartsPanel`, not in `app.ts`.
- **Map rendering is shared/cached**: `basemapCache` and `basemapLoading` already prevent duplicate basemap imports (`chart-card.ts:174-190`). A 50m detail layer can be added without touching the map card API.

### Complete Examples

Current root causes, verified:

```ts
// chart-panel.ts:789-797 - the preloaded chart
setColumns(columns: ColumnMeta[]): void {
  this.columns = columns;
  this.syncRail();
  if (!this.initialised) {
    this.initialised = true;
    if (columns.length > 0 && this.entries.length === 0) {
      this.addCard(); // <-- auto-preload
      return;
    }
  }
  // ...
}
```

```ts
// chart-utils.ts:385 - why the badge is always "3 ideas"
return ideas.slice(0, 3);
```

```ts
// app.ts:3339-3343 - badge driven by the capped suggestion list
private updateChartBadge(): void {
  const ideas = this.chartOpened ? 0 : suggestCharts(this.metas, this.rowCount).length;
  this.tabs?.setBadge("chart", ideas > 0 ? `${ideas} ideas` : null);
}
```

```ts
// missingness.ts:240-241 + 328-335 - why the map disappears
this.collapsible = affected > 0 && complete >= 0.99;
this.expanded = !this.collapsible;
// ...
const showMap = !this.collapsible || this.expanded;
this.wrap.classList.toggle("hidden", !showMap);
this.mapToggle.classList.toggle("hidden", !this.collapsible);
```

```ts
// chart-card.ts:2185-2189 - Settings is a normal details element
const settings = el("details", { class: "chart-settings-disclosure" }, [
  el("summary", { title: "Colours, ranges, titles and other settings" }, ["Settings"]),
  settingsBody,
]);
head.append(settings);
```

```ts
// chart-card.ts:4756-4761 - treemap only sums a numeric size column
const view: ViewDef = {
  id: "chart-treemap",
  name: "Treemap",
  dimensions: [{ column: this.config.column, by: "value" }],
  measures: [{ column: this.config.sizeColumn, agg: "sum" }],
  // ...
};
```

### API and Schema Documentation

#### Map basemap options

| Option | Source / resolution | Size | Points | Verdict |
|---|---|---:|---:|---|
| Current 110m | `world-atlas@2 countries-110m` / Natural Earth 1:110m | 108 KB TS / 39 KB gzip | 8,246 | Keep for world view |
| 50m | `world-atlas@2 countries-50m` / Natural Earth 1:50m | 756 KB JSON / 233 KB gzip | 80,617 | **Recommended detail layer** |
| 10m | `world-atlas@2 countries-10m` / Natural Earth 1:10m | Multi-MB | Very high | Reject for this app; violates low-bloat |

Recommended hybrid: keep 110m for the whole-world view, lazy-load 50m when the map viewport's longitude span is regional (proposed threshold `<= 60°`). While 50m loads, keep drawing 110m and show a subtle "Loading map detail…" note; repaint when ready. This gives a visible resolution jump without paying 233 KB on first paint or 80k-point draw cost at world scale.

#### Outlier algorithm suitability for TurboFuzz

| Algorithm | What it finds | Data assumptions | Browser cost | Explainability | TurboFuzz verdict |
|---|---|---|---|---|---|
| Modified z / MAD / IQR | Univariate values far from the median | Numeric, roughly unimodal; MAD > 0 | O(n), no deps | High: fence, median, z | **Already implemented**; keep as baseline |
| Log/quantile fences | Skewed positive values without flagging the tail | Numeric, non-negative for log | O(n) | High | **Already implemented**; keep |
| Text length/format fences | Overlong or off-pattern text | Text-like columns | O(n) | High | **Already implemented**; surface on Outliers page |
| Rare category frequency | Categories that almost never occur | Category/boolean | O(n) | High | **Add** as categorical outlier check; cheap |
| Isolation Forest | Global multivariate anomalies; high-dimensional tabular data | Numeric matrix after scaling; no distribution assumption | Train O(t·ψ·log ψ), score O(t·log ψ) per row; memory O(t·ψ) | Medium: path length + split-feature counts | **Recommended default multivariate method** |
| LOF | Local anomalies where density varies across clusters | Numeric, low-to-moderate dim; kNN meaningful | O(n²·d) brute force; O(n log n) average with a kd-tree in low dim; memory O(n·k) | Medium: local density ratio + neighbor distances | **Ship in first release**, capped at ~20k rows and **<=8 numeric features** (10 features exceeded the 2s prototype budget) |
| KNN distance | Simple global distance outliers | Numeric, low dim | Same kNN cost as LOF | High: distance to k-th neighbor | **Covered by LOF infrastructure**; expose only as a secondary score, not a headline method |
| DBSCAN | Noise points and arbitrary-shaped clusters | Numeric, one global `eps`/`minPts`, density-consistent | O(n log n) average with index; O(n²) worst | Medium: cluster id + noise flag | **Optional cluster/noise mode**, not a core row score |
| One-Class SVM | Novelty detection around a clean normal boundary | Requires clean training data; kernel/`nu` tuning; O(n²) kernel | High; RBF kernel is quadratic | Low: boundary distance, parameters opaque | **Reject for v1**; scikit-learn itself notes it is outlier-sensitive |
| GMM | Low-likelihood points under a mixture of Gaussians | Numeric, choose k, Gaussian components; covariance stability | EM O(n·k·d²) per iteration (full covariance) | Medium: component likelihood | **Defer**; useful only for well-behaved subpopulations |
| PCA reconstruction error | Points that do not fit linear correlations | Numeric, standardized, linear structure | Covariance O(n·d²) + O(d³); reconstruction O(n·d·k) | High: per-feature reconstruction residual | **Ship in first release**; fast enough for 500k rows × 16 features (~1s prototype) and ideal for correlated metric columns |
| ABOD | Angle-variance outliers in very high dimensions | Numeric, high dim | Exact is effectively cubic; approximations quadratic | Low/medium | **Defer**; too costly for the benefit |
| Autoencoder | Complex nonlinear reconstruction anomalies | Large clean training set, neural training, GPU/WebGL budget | High; model training and inference | Low: latent/reconstruction error | **Reject for v1**; violates no-bloat/offline-simple goals |
| Matrix Profile / STL | Time-series anomalies, seasonality, motifs | Ordered time series with a date/time axis | STL O(n); matrix profile O(n²) naive / O(n log n) STUMP | Medium/high for time series | **Defer** until an explicit time-series outlier mode exists |

**Recommended first release**: existing univariate fences + rare category frequency + text length/pattern + **Isolation Forest** (default row-level method) + **PCA reconstruction** + **LOF** (capped) + existing group-relative robust z. The three multivariate methods are all feasible within the ~2s budget at the caps documented below; they are not merely future options. Do not add One-Class SVM, GMM, ABOD, or autoencoders now.

#### Performance feasibility (prototype evidence)

A throwaway Node/V8 prototype (typed arrays, seeded PRNG, synthetic clustered data + 1% injected outliers) was measured on this machine. It is not the final browser/worker implementation, but it establishes that the requested methods fit the **quick <5s / deep <30s** budget with sensible caps. Final code must be benchmarked inside the real worker and leave ~30% headroom for slower machines/browsers.

| Method | Prototype workload | Measured | Verdict |
|---|---|---:|---|
| Isolation Forest | 100k rows × 16 features, 100 trees × 256 sample | **1.20 s** | Quick-safe |
| Isolation Forest | 100k × 16, 100 trees × 512 sample | **1.54 s** | Quick-safe higher-fidelity option |
| Isolation Forest | 250k × 16, 100 trees × 256 sample | **2.92 s** | Quick-safe |
| Isolation Forest | 500k × 16, 64 trees × 256 sample | **4.03 s** | Quick-safe at the 5s ceiling |
| Isolation Forest | 500k × 16, 64 trees × 512 sample | **5.17 s** | Slightly over quick; not the default |
| Isolation Forest | 500k × 16, 200 trees × 1024 sample | **21.83 s** | **Deep-safe** (<30s) |
| PCA reconstruction | 100k × 16, 5 components | **0.20 s** | Quick-safe |
| PCA reconstruction | 500k × 16, 5 components | **0.97 s** | Quick-safe |
| PCA reconstruction | 1M × 16, 5 components | **2.05 s** | Quick-safe |
| PCA reconstruction | 100k × 40, 5 components | **1.34 s** | Quick-safe |
| PCA reconstruction | 500k × 40, 5 components | **6.54 s** | Quick-over; use Deep or reduce features |
| PCA reconstruction | 1M × 40, 5 components | **13.33 s** | **Deep-safe** (<30s) |
| LOF kNN (kd-tree) | 20k rows × 8 features, k=20 | **0.96 s** | Quick-safe |
| LOF kNN (kd-tree) | 20k × 10, k=20 | **2.67 s** | Quick-safe |
| LOF kNN (kd-tree) | 30k × 8, k=20 | **1.66 s** | Quick-safe |
| LOF kNN (kd-tree) | 50k × 8, k=20 | **3.62 s** | Quick-safe at the 5s ceiling |
| LOF kNN (kd-tree) | 50k × 10, k=20 | **12.70 s** | **Deep-safe**; not quick |
| LOF kNN (kd-tree) | 100k × 8, k=20 | **10.52 s** | **Deep-safe** |
| Brute-force kNN | 10k × 8, k=20 | **1.44 s** | kd-tree is required; brute force at 20k is 5.7s |

**Recommended two-tier runtime caps**

| Method | Quick pass (no brain click) — target <5s | Deep compute (brain button) — hard ceiling <30s |
|---|---|---|
| Isolation Forest | Adaptive trees/sample: ≤250k rows = 100×256 (2.92s measured); 250k-500k = 64×256 (4.03s measured); above 500k, deterministic sample to 500k. Seed 42. | **200 trees × 1024 sample, score up to 500k rows** (21.8s measured at 500k × 16). Above 500k rows, sample to 500k. |
| PCA | Auto components to 90% variance (max 5-8); up to **1M rows × 20 features** (1M × 16 = 2.05s measured; 500k × 40 = 6.5s so quick caps features). | **1M rows × 40 features** (13.3s measured); above either, sample rows/features. |
| LOF | k=20, kd-tree; **50k rows × 8 features** (3.6s measured) or **20k × 10 features** (2.67s measured). | **100k rows × 8 features** (10.5s measured) or **50k × 10 features** (12.7s measured); auto-project to 6 PCA components if the feature count is higher. |
| Univariate / group-relative | Existing fences; full dataset, O(n). | Same; no deep mode needed. |

Quick mode should aim for 1-3s typical and never exceed the 5s ceiling. If the selected scope/feature set would exceed it, sample down deterministically and say so ("Quick scan: analyzed 100k of 500k rows"). Deep compute is only triggered by the brain button, must show an up-front estimate ("~18s"), and must abort/fall back before 30s.

**Implementation consequences**

- **Quick pass first, deep on demand.** Run the quick pass automatically when the user opens the Outliers tab (or switches scope); cache it. The brain button reruns the same method with the deep settings and replaces the visuals when ready. Never make the quick path wait for the deep path.
- Add the **Deep compute** control as an explicit brain-icon button with the label "Deep compute", a tooltip ("Thorough analysis; typically 10-30 seconds"), and an up-front time estimate. While running, show progress and a cancel action; if the estimate would exceed 30s, downsample or refuse with an explanation.
- Use a **smart compute** strategy: univariate/relationship summaries first, stratified deterministic samples, feature screening (drop constants/IDs, cap one-hot categories), cached column stats, and reuse of the same sampled matrix across IF/PCA. Only compute LOF's kd-tree when LOF is selected.
- Use `Float32Array` for the feature matrix (100k × 16 = 6.4 MB; 500k × 16 = 32 MB; 1M × 16 = 64 MB) and free it after scoring. For deep mode, prefer releasing the quick-mode matrix before allocating the deep one.
- For IF, build trees from a seeded sample and score every analyzed row; for LOF, build one kd-tree and reuse it for all queries; for PCA, compute the covariance once and use power iteration for the top components.
- For **LOF >8 features**, prefer automatic PCA projection to 6 components with a visible note ("LOF ran on a 6-component projection to stay under the latency budget"). This preserves the visual workflow without silently dropping features.
- Add a benchmark script under `bench/` (e.g. `bench:outliers`) with quick/deep cases and p95 gates: quick <=5000ms, deep <=30000ms, and a hard failure if deep exceeds 30s.

#### Reports inventory and migration

| Reports content | Current source | Destination after removal |
|---|---|---|
| Quality findings list | `qualityFindings()` | Data Quality > "Advanced findings" (only unique checks; avoid duplicating DQ checks) |
| Co-missingness | `coMissingnessFindings()` | Data Quality > "Missing together" |
| Functional dependencies | `dependencyFindings()` | New Outliers page > "Relationships" tab (keys and links) |
| Relationships / Explain column | `relationshipFindings()`, `relationshipDataFindings()`, `explainColumn()` | New Outliers page > "Relationships" tab |
| Distribution shifts | `distributionFindings()` | Data Quality > "Drift between halves" |
| Near-duplicate clusters | `similarClusterFindings()` | Data Quality > "Near-duplicate values" or Triage |
| Text profiles | `textProfileFindings()` | Data Quality > "Text profile" or the Chart "Top terms" card |
| Univariate anomalies | `anomalyFindings()` | New Outliers page > "Value outliers" |
| Group-relative anomalies | `groupAnomalyFindings()` | New Outliers page > "Group-relative" |

The Reports Quality tab is not a pure duplicate: it contains unique co-missingness, dependency, drift, near-duplicate, and text-profile checks. **Do not delete those silently.** The user has decided that relationships and functional dependencies belong on the new Outliers page. The remaining unique quality signals move to Data Quality; only the duplicate list presentation is retired.

#### Proposed worker schema for outlier analysis

```ts
export type OutlierMethod = "isolationForest" | "lof" | "pca";

export type GetOutlierAnalysisRequest = {
  type: "getOutlierAnalysis";
  requestId: number;
  method: OutlierMethod;
  /** Numeric feature columns; 2-20 for multivariate methods. */
  columns: number[];
  /** Flag the top share of scored rows (0.01 = top 1%). */
  contamination: number;
  /** IF: number of trees (default 100). */
  trees?: number;
  /** IF: sample size per tree (default 256, optional 512 for higher fidelity). */
  sampleSize?: number;
  /** LOF: neighbors (default 20); only offered when rows <= 20k and features <= 8. */
  neighbors?: number;
  /** PCA: components (default auto from explained variance, max 8). */
  components?: number;
  /** Deterministic seed; results must be reproducible. */
  seed?: number;
  /** Fit/score the current filtered rows (default true). */
  respectFilters?: boolean;
};

export interface OutlierRowDetail {
  row: number;
  score: number;
  /** Top contributing features, already scaled and labelled. */
  contributions: { column: number; label: string; value: number; contribution: number }[];
  /** Raw display values for the row, for the review table. */
  values: string[];
}

export interface OutlierAnalysisMessage {
  type: "outlierAnalysis";
  requestId: number;
  method: OutlierMethod;
  labels: string[];
  /** One score per analyzed row; NaN for rows excluded by missing values. */
  scores: Float32Array;
  rowIndices: Uint32Array;
  threshold: number;
  flagged: number;
  analyzed: number;
  excluded: number;
  details: OutlierRowDetail[];
  /** Optional feature importance for the model as a whole. */
  featureImportance: { column: number; label: string; weight: number }[];
  ms: number;
}
```

The worker then stores a `BitSet` (a new `Dataset.outlierBits` or a worker-level override) and exposes a `SpecialFilter = "outlierModel"` so the table can filter to the flagged rows. The existing `setSpecialBits()` path already supports this.

#### Treemap schema / semantics

Power BI-style semantics map cleanly onto the existing aggregate engine:

| Power BI concept | TurboFuzz implementation |
|---|---|
| Rows at source granularity | Current filtered table rows (or a saved view source) |
| Group into categories | `ViewDef.dimensions: [{ column, by: "value" }]` |
| Measure / aggregation | `ViewDef.measures: [{ column: numeric or null, agg }]` |
| Area proportional to total | Existing `squarifyLayout()` already sizes by value (already correct) |
| Default count | `column: null, agg: "count"` |
| Other bucket | Existing `topN` + "Other" logic; keep |
| Drill-down hierarchy | Phase 2: two dimensions + drill state; not required for the first fix |

Recommended UI: **Group by** (category or text), **Size by** (Count of rows or a numeric column), **Aggregation** (count/distinct/sum/mean/median/min/max; default sum for a numeric measure, count when none), **Top tiles** (default 10-20). Text grouping is allowed but high-cardinality text must show a warning and use top-N + Other. Tile area must always be the aggregate, never row count by accident.

### Configuration Examples

Map vendor flow (offline, no CDN at runtime):

```bash
# Download once during development, then vendor both resolutions
node tools/vendor-world.mjs countries-110m.json
node tools/vendor-world.mjs countries-50m.json --out world-50m
```

Proposed map LOD behavior:

```ts
type BasemapDetail = "110m" | "50m";
const DETAIL_LON_SPAN = 60; // degrees

function detailFor(view: MapViewport): BasemapDetail {
  return view.lonMax - view.lonMin <= DETAIL_LON_SPAN ? "50m" : "110m";
}
```

Proposed outlier defaults:

```json
{
  "isolationForest": { "trees": 100, "sampleSize": 2048, "contamination": 0.01 },
  "lof": { "neighbors": 20, "maxRows": 20000, "contamination": 0.01 },
  "pca": { "components": "auto-90%-variance", "contamination": 0.01 }
}
```

### Technical Requirements

- **No new network requests.** Vendor 50m into `src/data/`; production CSP already blocks outbound connections.
- **Worker-first.** Isolation Forest/LOF/PCA must run in the worker, not on the main thread.
- **Deterministic.** Seed the PRNG; the same data, columns, and parameters must produce the same flags.
- **Explainable.** Every flagged row must show a method, threshold, and at least one reason (feature contribution, fence, group, or pattern). No unlabeled score.
- **Missing data must be explicit.** Default complete-case; show excluded rows. If median imputation is offered, label it and show how many values were filled.
- **Scale caps and latency.** Quick pass target **<5s**; Deep compute hard ceiling **<30s**. IF quick: adaptive 100×256/64×256, score up to 500k; IF deep: 200×1024, score up to 500k. PCA quick: up to 1M × 20; deep: up to 1M × 40. LOF quick: 50k × 8 or 20k × 10; deep: 100k × 8 or 50k × 10. Above the caps, deterministic sample and show "analyzed N of M". Deep compute always exposes an estimate and a cancel path.
- **Map performance.** 50m should be lazy, detail-only, cached, and drawn progressively; do not block the first map paint.
- **Accessibility.** Map controls need `aria-label`s; the missingness map already has an aria label; treemap tiles need a text/table fallback or an accessible tile list.
- **Tests.** Unit tests for each algorithm on synthetic known-outlier data; worker protocol tests; UI tests for labels/toggles; map LOD tests; performance bench for 10k/100k rows where feasible.
- **No lint script exists.** Use `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`; do not claim a lint pass.

## Recommended Approach

### 1. Overview: make the report and the missingness map first-class

**Stats Report**

- Add a prominent `Stats report` button to the top dataset header (`buildDatasetLine`), with a small inline report icon (document + bars) and the label visible. Place it at the right edge of the header, before the type-mix line, using `margin-left: auto`.
- Keep the existing `StatsModal`; the request is placement/prominence, not new statistics.
- Remove the tiny bottom `stats-link` to avoid duplicate entry points, or keep it as a secondary text link only if the top button feels crowded.
- Acceptance: the button is visible without scrolling at common viewports, has an accessible name, and opens the same per-column report.

**Missing values map**

- Move `buildMissingness()` to the **last** section of the Overview render order (after the column grid and action row). Give it a clear heading and a short "at a glance" summary.
- Remove the `Show map`/`Hide map` toggle and the `collapsible` state. Always render the expanded map when at least one column has missing cells. If the dataset is 100% complete, show a one-line `100% complete — no missing cells` state instead of a wall of blue.
- Remove the `max-width: 820px` cap (or raise it substantially) so the map uses the available width; keep a sensible min height. Consider raising `MATRIX_MAX_HEIGHT` from 320 to ~420 so the map is readable on wide screens.
- Keep the summary, caption, hover tooltips, and worst-run marker. Those are the "at a glance" information the user missed.
- Acceptance: a 99.5%-complete dataset shows the full map without any hidden button; the map is the last Overview section; zero-missing data shows a clean completion line.

### 2. Chart view: no badge, no preload, no lingering Settings

**Remove the "3 ideas" badge**

- Delete the `suggestCharts(...).length` badge logic and the `chartOpened` state. The badge is guaranteed to say "3 ideas" for most datasets because `suggestCharts()` slices to three. The chart rail and the gallery already provide discoverability.
- Remove `updateChartBadge()` and the `suggestCharts` import from `app.ts`. Keep `suggestCharts()` for the gallery's "Suggested for your data" section, which is optional and not a preload.

**Do not preload a chart**

- In `ChartsPanel.setColumns()`, remove the `this.addCard()` call. The first visit must show the empty state with the rail and `+ Add chart`; no card until the user chooses one.
- Simplify the empty state to a single clear message ("No charts yet — pick a type from the rail or use + Add chart") rather than three auto-generated suggestion buttons. The gallery still offers suggestions when the user opens it.
- Preserve `restore()` for saved configs after transforms; only the first-load default is removed.
- Update the existing test that expects one default card; replace it with a test asserting zero cards on first `setColumns()` and a card only after an explicit `addCard`/setup action.

**Close Settings without re-clicking "Settings"**

- Add outside-click and `Escape` close behavior to the `chart-settings-disclosure` popover. When one card's Settings opens, close any other open card's Settings.
- Add a visible affordance (small `×` or chevron) inside the panel so the close behavior is discoverable; keep the existing `summary` toggle.
- Do not auto-close after every control change; users often change several settings in one visit. Outside-click/Escape gives the requested "minimise again" behavior without fighting the user.
- Add a test that opens Settings, clicks the chart canvas or presses Escape, and asserts the details element is closed.

### 3. Map: 50m detail, visible zoom, auto-fit, clearer labels

**Resolution**

- Vendor `countries-50m.json` as a second lazy module (`src/data/world-50m.ts`) using the existing vendor script generalized with an output argument.
- Keep 110m for the world view and load 50m when the viewport is regional (`lonSpan <= 60°`). Draw 110m until 50m is decoded, then repaint. Cache both in `basemapCache`.
- Do not move to 10m: it is multi-MB and violates the app's low-bloat principle.

**Zoom and auto-fit**

- Add an always-visible map control group over the canvas: `+`, `−`, and `Fit data` (auto-fit). Extract the existing wheel-zoom math into `zoomMap(factor)` and reuse it; `Fit data` calls the existing `resetMapZoom()` behavior (sets `mapView` to null, which reaches `mapViewOrAuto()`).
- Keep drag-to-pan, wheel zoom, and double-click reset. Keep `Reset view` for non-map zoomable charts, but map cards get the visible control group.
- Ensure the initial auto-fit happens after the first `seriesResult` arrives; the current `mapViewOrAuto()` already fits the 1st-99th percentile, but the first frame can paint the world before data arrives. Add a test for "first series render fits data, not the world" and a small loading note while the basemap/points load.
- If the data genuinely spans the globe, do not fake a zoom; show the full world and let the user use the new controls.

**Labels**

- Rename `Load regions` to `Load extra map data` and `Clear regions` to `Clear extra map data`. Keep the tooltip explaining GeoJSON/zipped Shapefile.
- Keep the map layer row in Settings; the label change is the requested clarity fix.

### 4. Treemap: category or text, explicit measure and aggregation

**Grouping**

- Allow category **or text** as the treemap group. Exclude obvious IDs by default; if a text column has very high cardinality, show a warning and use top-N + Other rather than refusing the chart.
- Update `fitChartKind("treemap")`, `openChartSetupDialog`, and `ChartCard.allowsPrimary()` consistently.
- Treat a text column as exact value groups, not tokenized words. Token frequency remains the existing "Top terms" chart.

**Measure and aggregation**

- Replace the treemap's hidden `sizeColumn`/sum-only path with the existing `valueColumn` + `valueAgg` measure model.
- Add setup fields: **Group by**, **Size by** (`Count of rows` or a numeric column), and **Aggregation** (`count`, `distinct`, `sum`, `mean`, `median`, `min`, `max`; filtered by column type). Default to count; when a numeric measure is chosen, default to sum (Power BI-like).
- Always build a `ViewDef` with the chosen dimension and measure. This makes category and text grouping share one code path and makes the aggregate respect filters and chart-scoped filters.
- Update the tile tooltip to say e.g. `Sum of population · 12.4% of total · 318 rows`, not just a share.
- Keep the existing `squarifyLayout()`; it already encodes area proportionally.
- Phase 2 (optional): drill-down by adding a second group dimension and a drill state; the user described this as optional Power BI context, not a v1 requirement.

### 5. Remove Reports and add an Outliers lens

**Remove Reports**

- Remove `reports` from `ViewId`/`VIEW_ORDER`, the label map, the app host/panel/imports, `ensureReports`, the command-bar entry, help copy, CSS, and the Reports tests.
- Replace the Reports slot with a new **Outliers** lens. Keep six tabs total so the existing `1-6` shortcut hint remains valid.
- Do not silently drop unique Reports content. Migrate:
  - Relationships + Explain column + functional dependencies → **Outliers page > "Relationships" tab** (user decision; do not put these in Data Quality).
  - Co-missingness, distribution shifts, near-duplicate clusters, text profiles → Data Quality > "Advanced signals" (or a compact collapsible section).
  - Univariate and group-relative anomaly findings → **Outliers page > "Outliers" tab**.
  - Reports Quality's duplicate presentation → retire; Data Quality already owns the scored checks.
- Update `src/ui/help-content.ts`, `src/ui/command-bar.ts`, `test/command-bar.test.ts`, `test/help-drawer.test.ts`, `test/reports-panel.test.ts`, and any view-tab expectations.

**Outliers page: a visual analysis dashboard, not a findings list**

The page should feel like a data story. Two top-level tabs keep the two intents clear:

- **Outliers**
- **Relationships**

Both tabs share the same scope bar (current rows vs whole dataset), a prominent `Analyze`/`Refresh` action, and a short generated insight strip. On arrival, populate only the cheap univariate/categorical summary and the relationship overview; the heavy IF/PCA/LOF runs start only when the user clicks **Run analysis** (or explicitly selects a method), so the page never surprises the user with a 2-second freeze. The selected method and its caps are visible before it runs.

**Outliers tab — "Anomaly landscape"**

1. **Insight strip** at the top: 2-4 generated cards such as "1.3% of current rows are unusual", "63% of flagged rows agree across 2+ methods", "Strongest signal: amount × quantity", "LOF finds 14 rows that Isolation Forest misses". Each card is clickable and applies the relevant filter or method.
2. **Method selector cards** (not a plain dropdown): Isolation Forest, PCA reconstruction, LOF, Value outliers, Group-relative. Each card states what it finds, what it needs, its quick/deep runtime route, and whether it is available for the current columns. Selected method gets a strong accent and a visible "Run quick scan" button.
   - Beside the quick action sits the **Deep compute** button: a brain icon + text, tooltip "Thorough analysis; typically 10-30 seconds", and an estimated duration. It is visually distinct (not the default primary action) so users know it is the slow, thorough path.
   - While deep compute runs, replace the estimate with a progress bar, keep the quick results visible, and offer Cancel. Never block the page behind the deep run.
3. **Anomaly landscape**: a 2D projection scatter (use the first two PCA components, or a sampled 2D projection) with:
   - all rows as small translucent points,
   - flagged rows as larger, high-contrast points (red/orange),
   - density contours or a soft background for normal clusters,
   - hover tooltip and click-to-inspect.
   - Sample to ~2,000-5,000 points for the visual; the scores themselves cover all analyzed rows.
4. **Score distribution**: histogram of anomaly scores with a threshold marker, flagged share, and a small "top 1%" / "top 5%" switch. This makes the threshold tangible.
5. **Method agreement**: a compact matrix/bar showing how many rows are flagged by IF, PCA, LOF, and combinations ("flagged by 2+ methods", "only LOF"). This is the "amazing insight" part and is cheap to compute from existing bitsets.
6. **Top outliers**: ranked cards/rows with a row preview, score, method badges, and a **fingerprint** bar showing the top contributing features (e.g. "amount 42%, quantity 27%, region 12%"). Clicking a row opens a side detail panel with all values and an "Apply filter" / "Show rows" action.
7. **Group-relative** and **Value outliers** render as focused sub-views with their own ranked summaries and per-column counts.
8. **Categorical & text** cards: rare categories, unexpected formats/patterns, overlong values, near-duplicate clusters. This is how mostly-text tables still get useful outlier coverage.
9. **Time (future)** stays separate; do not mix STL/matrix profile into the tabular view.

**Relationships tab — "How columns move together"**

1. **Correlation heatmap** of the selected numeric columns (reuse the existing correlation matrix / palette helpers). Hover a cell for the pair, effect size, n, and a one-sentence interpretation.
2. **Ranked associations**: horizontal bars for the top Pearson/Spearman/Cramér's V/η² associations, colored by method and signed where appropriate. Clicking an association opens a scatter or grouped profile.
3. **Dependency network**: a lightweight node-link graph of functional dependencies ("station id → station name", "country → region") with violation counts; edges are clickable to explain the link. Use a simple deterministic layout (no force simulation) to keep it fast and stable.
4. **Explain a column**: keep the existing selector and generated sentence ("Revenue is strongly associated with units (r = 0.82); it is not evidence of causation").
5. **Pair detail**: a selected numeric pair gets a scatter/hexbin with the relationship line or density overlay; a selected categorical pair gets a heatmap/mosaic.
6. **Insight cards** for surprising links, e.g. "Region explains 34% of the variation in amount (η² = 0.34)" or "Customer ID determines name and city in 99.8% of rows". These are generated from the existing relationship/dependency engines, not invented.

**Visual language and performance**

- Use the existing design tokens/palettes; reserve accent red/orange for anomalies, blue/teal for normal structure, and muted gray for non-selected methods.
- Prefer one hero chart + 2-3 supporting charts + a detail panel over a wall of tiny charts. Progressive disclosure keeps it a "feast" rather than a cluttered dashboard.
- Charts render from **sampled or aggregated** data (2k-5k scatter points, histograms, top-N bars) so the page stays interactive at 100k rows. Never draw 100k individual points on the relationships tab.
- Show method/scope/sample-size/threshold/excluded-row counts in a compact "analysis recipe" line so the visuals are trustworthy.
- Provide empty, loading, and "not enough numeric columns" states with a clear next step. LOF and IF method cards explain their caps before the user runs them.

The page should state method, scope (`current rows` vs `whole dataset`), sample size, threshold, and excluded/missing rows. Each method card should answer "what it finds / what it needs / cost" so the user can choose intelligently, and each visual should answer a real question rather than exist for decoration.

### 6. Outlier implementation sequence

1. Add protocol types and worker request handler for `getOutlierAnalysis`.
2. Build a shared numeric-matrix preparation step: select numeric columns, exclude IDs/provenance, robust scale, log1p for positive skew, complete-case default, deterministic sampling.
3. Implement **Isolation Forest** first (pure TS, **100 trees, 256 sample** default, seeded; score up to 100k rows; return top details and split-feature contributions).
4. Add a new `SpecialFilter = "outlierModel"` / `Dataset.outlierBits`, apply the flagged rows to the table, and expose "Show rows" / "Clear flag".
5. Implement **PCA reconstruction** second (correlation matrix + power iteration; per-feature residual contributions; cap 500k rows / 20-30 features).
6. Implement **LOF** third with a kd-tree for low-dimensional numeric data, capped at **20k rows × 8 features**; auto-project to 6 PCA components for 9-10 features, or disable with an explanatory message above the caps.
7. Add rare-category and text/pattern outlier checks; reuse existing anomaly/pattern engines where possible.
8. Implement the quick/deep parameter routing and result cache keyed by `(generation, scope, columns, method, mode)`. Quick pass runs with the small caps; Deep compute reruns only on explicit brain-button click.
9. Build the Outliers dashboard shell: insight strip, method cards, **Deep compute brain button with estimate/progress/cancel**, anomaly landscape, score histogram, method agreement, top-row fingerprints, and side detail panel.
10. Build the Relationships tab by extracting the existing `ReportsPanel` relationship/dependency UI into a reusable panel: correlation heatmap, ranked associations, dependency network, explain-column selector, and pair details.
11. Add a `bench:outliers` script covering quick and deep cases; assert quick p95 <= 5000ms and deep p95 <= 30000ms, with a hard failure above 30s.
12. Add tests for known synthetic outliers, deterministic seeds, missing-data exclusion, method overlap, UI apply/clear behavior, quick/deep mode switching, and relationship visuals.
13. Only after the above is stable, consider DBSCAN cluster-noise mode or time-series STL/matrix profile.

## Implementation Guidance

- **Objectives**
  - Make the Overview's stats report and missingness map impossible to miss.
  - Remove chart noise: no badge, no preloaded card, no sticky Settings popover.
  - Make the map legible and controllable: 50m detail, visible zoom, auto-fit, clearer labels.
  - Make the treemap match Power BI semantics: category or text group, explicit measure/aggregation, count default, proportional area.
  - Replace the low-value Reports lens with a visual Outliers dashboard that includes the useful relationship insights and ships IF, PCA and LOF in the first release, with a snappy quick pass and an explicit brain-button Deep compute path.
- **Key Tasks**
  - Overview: top stats button + icon; missingness section moved last and always expanded; full-width map; tests.
  - Chart: remove `chartOpened`/badge; remove default `addCard()`; simplify empty state; Settings outside-click/Escape; tests.
  - Map: vendor 50m; LOD loader; `+`/`−`/`Fit data` controls; label changes; initial-fit test; manual browser check.
  - Treemap: category/text grouping; `valueColumn`/`valueAgg` measure path; setup dialog fields; tooltip/measure labels; tests.
  - Reports: remove view/panel/command/help/CSS/tests; migrate relationships/dependencies to the new Outliers page and unique quality signals to Data Quality; add the Outliers view.
  - Outliers: protocol/worker/data model; IF + PCA + capped LOF all in the first release; quick/deep parameter routing and cache; brain-button Deep compute with estimate/progress/cancel; rare category/text checks; anomaly landscape, score distribution, method-agreement visuals, row fingerprints; relationships heatmap/network; quick/deep benchmarks; tests.
- **Dependencies**
  - 50m vendoring depends on the existing `tools/vendor-world.mjs` and `src/data/topo.ts` decoder; no new runtime dependency.
  - Outliers depend on worker protocol additions and a numeric-matrix preparation utility; no ML package is required for IF/PCA, and LOF needs a small kd-tree implementation.
  - The Relationships tab depends only on extracting the existing `ReportsPanel` relationship/dependency logic; the heavy math already exists.
  - Reports removal depends on the Outliers page shell and the Data Quality advanced-signals migration, not on new algorithm work.
- **Success Criteria**
  - The Stats Report is visible at the top of Overview with an icon and accessible label.
  - A 99%+ complete dataset shows the full missingness map at the bottom without a hidden toggle.
  - Opening Chart shows no cards until the user adds one; the "3 ideas" badge is gone.
  - Settings closes on outside click/Escape and only one card's Settings is open at a time.
  - Map cards show 50m country detail when zoomed in, have visible `+`, `−`, and `Fit data` controls, and fit regional data on first render.
  - Map buttons read "Load extra map data"/"Clear extra map data".
  - Treemap accepts category or text, defaults to count, exposes sum/mean/median/min/max, and shows the measure in tooltips.
  - Reports is gone; the new Outliers page has an **Outliers** tab and a **Relationships** tab, with unique quality signals still reachable in Data Quality.
  - The Outliers tab surfaces univariate, multivariate, group-relative, and categorical/text anomalies with generated insights, an anomaly landscape, score distribution, method-overlap visuals, and row fingerprints.
  - The Relationships tab surfaces a correlation heatmap, ranked associations, functional-dependency links, and an explain-column narrative.
  - IF, PCA and LOF all run from the first release. The quick pass completes under **5s** at its caps; the **Deep compute brain button** completes under **30s** at its caps and always shows an estimate, progress and cancel. All methods show scope/caps/excluded rows.
  - The default page feels snappy: quick results appear first, charts render progressively, and deep compute never blocks the quick view.
  - `npm run typecheck`, `npm test`, `npm run build`, `npm run bench:outliers`, and relevant Playwright tests pass; the bench gate enforces quick <=5s and deep <=30s. No new network request is introduced.
