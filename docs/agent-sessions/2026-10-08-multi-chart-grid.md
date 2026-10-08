# 2026-10-08 - Multi-plot chart grid + scatter/density (Phase 1)

## Goal

Commence the phased plan in `next_steps.md`, specifically the multi-variable
chart roadmap: make the Chart view accommodate more than one plot and ship
Phase 1 (chart-type gallery, scatter, density, worker sampling, auto
threshold, per-chart PNG). Decisions were confirmed with the user up front:

- Multi-plot shape: **independent chart cards in a grid** (1–4 per row).
- Session scope: **multi-plot grid + scatter/density together**.

Branch: `agent/chart-cards` (created from `agent/process-log-help`).
The untracked `review_claude_20261008/` fixture/review folder was left as-is;
the tracked tree was clean before edits.

## What shipped

- **Chart card grid** (`ChartsPanel` + `ChartCard`): add, duplicate, remove;
  per-card type gallery (Histogram, Time series, Bars, Scatter, Density) with
  its own columns, settings, colour/title, canvas and note. Layout (1–4 per
  row) is persisted in `localStorage` under `turbofuzz.charts.columns`.
- **Scatter**: x/y (numeric or date), optional colour by numeric ramp or
  category palette, optional numeric size. Points drawn as fast `fillRect`
  marks, bucket-grouped by colour.
- **Density**: exact 2D histogram (128×72) drawn through an offscreen canvas
  `ImageData` with sqrt-alpha scaling.
- **Worker `getChartSeries`**: one request serves both modes over the current
  filtered result order (`sortedIds`); returns transferable typed arrays.
  Auto mode switches to density above 20,000 matching pairs; "Render:
  Points/Density" overrides. Axes clip to p1–p99 (sampled quantiles) with an
  outside count, matching the histogram convention. Response carries compute
  `ms`, shown in the note line.
- **Metas stay fresh**: app now pushes updated column metas to the chart cards
  on type change, locale change, clean, null-policy and header rename.
- **Help** updated for multiple charts, scatter, density and per-card PNG.

## Files changed

- `src/data/chart-series.ts` (new): `computeSeries` (points/density/auto,
  thinning, quantile clipping), `categoryCodes`.
- `src/worker/protocol.ts`: `GetChartSeriesRequest`, `ChartSeriesMessage`.
- `src/worker/search.worker.ts`: `handleGetChartSeries` (colour resolution,
  transfers — column caches are never transferred).
- `src/ui/worker-client.ts`: `getChartSeries`.
- `src/ui/chart-utils.ts` (new): pure helpers extracted from the old panel
  (kind mapping, category series, colours, `rampColor`, `niceTicks`,
  formatting, export sizes).
- `src/ui/chart-card.ts` (new): one plot card, drawing (all five types), PNG.
- `src/ui/chart-panel.ts`: rewritten as the `ChartsPanel` container.
- `src/ui/app.ts`: `ChartsPanel` wiring + `refreshCharts()` on meta changes.
- `src/styles.css`: toolbar, grid `[data-cols]`, card, tag/select styling,
  responsive collapse.
- `src/ui/help-content.ts`: charts topic.
- `test/chart-panel.test.ts`: imports moved to `chart-utils`, added
  `defaultCardKind` / `niceTicks` / `rampColor` tests.
- `test/chart-series.test.ts`, `test/ui-charts.test.ts`,
  `test/worker-chart-series.test.ts` (new).
- `next_steps.md`: progress logged in the backlog and multi-variable sections.

## Commands executed

```
npm run typecheck   # clean
npm test            # 264 tests, 264 pass
npm run build       # tsc + vite build, clean
```

Focused runs while iterating: `npx tsx --test test/chart-series.test.ts`,
`test/ui-charts.test.ts`, `test/worker-chart-series.test.ts`.

## Decisions / notes

- One request pair (not two) for scatter and density keeps the worker protocol
  small; the mode is a parameter. Sampling/binning lives in
  `src/data/chart-series.ts` so it is node-testable without a worker.
- Canvas drawing uses a clamped UI scale factor (`height / 540`) so text stays
  readable in 2–4-up cards while PNG exports at 720p/1080p/1440p stay
  proportional. No chart library was added.
- p1–p99 axis clipping is applied to both axes in points and density modes,
  consistent with existing histogram behaviour; outside values are counted and
  reported.
- Deferred (roadmap Phase 2+): box plots, correlation matrix, two-category
  heatmap, small multiples, hover/zoom/brush/linked highlight, K-means.

## Blockers

None. Changes on `agent/chart-cards` are ready for review/commit.
