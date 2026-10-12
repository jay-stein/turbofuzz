# 2026-10-08 - Chart polish: smart axes, annotations, KDE

## Goal

User feedback on the chart cards:

1. Y axes should show round numbers (e.g. 50,000 instead of 48,780).
2. Add annotations (median value on box plots called out as an example).
3. KDE / contour plots like seaborn would be valuable.

Branch: `agent/chart-polish` (created from `agent/chart-phase2`).

## What shipped

- **Smart axes.** Histogram and bar count axes now use `niceTicks(0, max, 4)`
  with grid lines and whole-number labels (`formatCount` -> 50,000), instead
  of the raw max / half. `formatTick` drops insignificant digits (`50k`,
  `12.8k`, `1.5M`, trailing `.0` removed).
- **Annotations.**
  - Histogram: dashed median line with its value (the worker returns a sampled
    median in `chartBins.median`), plus a KDE curve overlay (checkbox, on by
    default) scaled to the count axis.
  - Box plot: median value labelled above each box and the group size (`n`)
    under each category label.
  - Scatter/density: Pearson r annotated in the corner; the worker computes it
    in the same `getChartSeries` handler (`ChartSeriesMessage.correlation`).
- **KDE / contours** (`src/data/kde.ts`, pure):
  - `smoothSeries` — 1D Gaussian smoothing (mass-preserving) for the histogram
    KDE curve.
  - `smoothGrid` — separable 2D Gaussian smoothing of the density grid.
  - `marchingSquares` — 16-case iso-line extraction returning flat segments.
  - `contourLevels` — levels spread below the peak (5 -> 18%..91%).
  - Density cards got a **Style** control: **Heat** (exact, unchanged),
    **Contours** (smoothed field as filled ramp bands + iso-lines) and
    **Heat + lines** (default).
- Help content and `next_steps.md` updated.

## Files changed

- `src/data/kde.ts` (new).
- `src/ui/chart-card.ts`: config `densityStyle` + `kde`, style select, KDE
  checkbox, draw changes (`paintDensityHeat`, `paintDensityBands`,
  `paintContourLines`, `drawCorrelationNote`, median lines/labels).
- `src/ui/chart-utils.ts`: `formatCount`, `formatTick` cleanup.
- `src/ui/chart-panel.ts`: `requestBins` type now `ChartBinsMessage`.
- `src/worker/protocol.ts`: `median` on `ChartBinsMessage`, `correlation` on
  `ChartSeriesMessage`.
- `src/worker/search.worker.ts`: sampled median for bins, Pearson r for series.
- `src/ui/help-content.ts`, `next_steps.md`.
- Tests: `test/kde.test.ts` (new), `test/chart-panel.test.ts`,
  `test/ui-charts.test.ts`, `test/worker-chart-series.test.ts`.

## Commands executed

```
npm run typecheck   # clean
npm test            # 278 tests, 278 pass
npm run build       # tsc + vite build, clean
npx wrangler deploy # v4fba649c, 4 assets uploaded
```

## Decisions / notes

- Contours/KDE run on the main thread from the existing density grid payload —
  no new worker request, no extra network/worker traffic; sigma 1.6 for the
  2D field, 1.4 for the 1D curve, 5 contour levels.
- The histogram KDE overlay is scaled in count units (Gaussian smoothing of
  the bins preserves mass), so it lines up with the count axis rather than
  needing a second axis.
- Sampled medians (`column.medianSampled()`, cached) are used for the
  annotation so million-row columns stay instant.
- Window `r` is NaN-safe: an undefined pair (constant column, too few
  observations) simply omits the annotation.

## Deploy

- Commit `7a23fe9` on `agent/chart-polish`.
- Live: https://turbofuzz.mrjaystein.workers.dev
- Version ID: `4fba649c-b91f-4515-85e1-ff45a85c6952`.
- Verified the served HTML references `index-CzT0CYBd.js`.

## Still open (roadmap)

- Small multiples and trend overlays (Phase 2 remainder) — note the scatter
  r annotation and 1D KDE partly cover trend overlays already.
- Hover, zoom/pan, click-to-filter, rectangle brush + selection filter,
  linked highlight (Phase 3); K-means, SAB mirror, WebGL (Phase 4).
