# 2026-10-08 - Phase 2 chart types: box, heatmap, correlation

## Goal

Continue the multi-variable chart roadmap in `next_steps.md` after the user
asked to "keep going" on the chart cards. Phase 2 covers box plots, a
two-category heatmap, a correlation matrix and small multiples; small
multiples/trend overlays were left for a follow-up, the other three shipped.

Branch: `agent/chart-phase2` (created from `agent/chart-cards`).

## What shipped

- **Box plot** card (Value × Groups): Tukey 1.5×IQR whiskers, median line,
  sampled outlier dots, top-N groups + Other, missing-value count. Worker
  request `getBoxStats`; sorting and five-number summaries are exact over the
  filtered rows.
- **Heatmap** card (Columns × Rows): category × category counts, top-N per
  axis + Other, count labels when cells are large enough, colour intensity by
  sqrt(count/max). Worker request `getCrosstab`.
- **Correlation** card: numeric-column multi-select (defaults to the first
  six numeric columns, capped at 12), Pearson matrix with pairwise-complete
  observations, diverging blue–red cells, grey cells for undefined pairs
  (constant column / too few pairs). Worker request `getCorrelation`.
- **Card UX**: the pair pickers are reused with per-kind validation
  (`allowsX`/`allowsY`), tag labels change (X/Y, Value/Groups,
  Columns/Rows), the bar settings row doubles for box/heatmap (Top groups /
  Top per axis), and the colour row hides for correlation.
- **Presets**: `+ Add chart` now cycles scatter → correlation → box →
  heatmap before repeating defaults, based on the kinds already present.
- Help content and `next_steps.md` progress notes updated.

## Files changed

- `src/data/chart-stats.ts` (new): `computeBoxStats`, `computeCrossTab`,
  `computeCorrelation` — pure, node-testable.
- `src/worker/protocol.ts`: `GetBoxStatsRequest`/`BoxStatsMessage`,
  `GetCrosstabRequest`/`CrosstabMessage`,
  `GetCorrelationRequest`/`CorrelationMessage` (all carry `ms`).
- `src/worker/search.worker.ts`: three handlers over `sortedIds`, typed-array
  transfers (outlier buffers, counts, matrix + counts).
- `src/ui/worker-client.ts`: `getBoxStats`, `getCrosstab`, `getCorrelation`.
- `src/ui/chart-utils.ts`: new kinds/labels, `isPairKind`, `correlationCell`
  diverging colour helper, `hexToRgb` accepts `rgb()` strings.
- `src/ui/chart-card.ts`: config/pickers/refresh logic for the new kinds and
  the `drawBox` / `drawHeatmap` / `drawCorrelation` renderers.
- `src/ui/chart-panel.ts`: new request callbacks and the kind-aware presets.
- `src/ui/app.ts`: wires the three client methods.
- `src/styles.css`: multi-select styling.
- `src/ui/help-content.ts`, `next_steps.md`: docs.
- `test/chart-stats.test.ts`, `test/worker-chart-stats.test.ts` (new),
  `test/ui-charts.test.ts` (draw paths for all kinds),
  `test/chart-panel.test.ts` (`correlationCell`).

## Commands executed

```
npm run typecheck   # clean
npm test            # 273 tests, 273 pass
npm run build       # tsc + vite build, clean
npx wrangler deploy # v8d247d77, 5 assets uploaded
```

## Decisions / notes

- Separate worker requests per aggregate (instead of widening
  `getChartSeries`) keep each payload minimal and the protocol explicit.
- Correlation is capped at 12 columns (66 pairwise passes worst case) and
  uses pairwise-complete observations; undefined pairs stay NaN end-to-end
  and render grey.
- Heatmap "Other" aggregation uses the existing `groupOther` setting and
  reports it in the note line.
- Box outliers are sampled to 400 per group so extreme columns cannot bloat
  the payload.

## Deploy

- Commit `d7ac91f` on `agent/chart-phase2`.
- Live: https://turbofuzz.mrjaystein.workers.dev
- Version ID: `8d247d77-287e-462c-9237-ccd3709a8acb`.
- Verified the served HTML references `index-BJS_sKjE.js`.

## Still open (roadmap)

- Small multiples and trend overlays (Phase 2 remainder).
- Hover, zoom/pan, click-to-filter, rectangle brush + selection filter,
  linked highlight (Phase 3); K-means, SAB mirror, WebGL (Phase 4).
