# 2026-10-13 — Chart X/Y axis titles

Goal: the X and Y axis labels were missing from chart cards. A previous
session left `axisLabels()`/`drawAxisTitles()` in `src/ui/chart-card.ts`
uncommitted and never called.

## Root cause

- The partial fix defined the two methods but nothing invoked them, so no
  titles were ever drawn.
- The frame reserved no room for titles: a Y title would collide with the
  tick labels and an X title with the bottom labels.

## Fix (branch `agent/chart-axis-labels`, commit `d1b9252`)

- `drawChart` computes `axisLabels()` before the frame, passes title
  presence into `frame()`, and calls `drawAxisTitles()` after the kind
  draw — skipped for empty-state messages (`plotMessageDrawn`) and
  view-bound cards (`source !== ""`).
- `Frame` gains `tickW` (widest Y tick) and `labelPad` (20ui band when a Y
  title exists); `frame()` grows the left margin by the band and the
  bottom by 14ui when an X title is present.
- The Y title is rotated beside the ticks at
  `left - 6ui - tickW - 9ui`; the X title is centred under the plot.
- Mapping corrected: box groups are on X (values on Y), grouped histograms
  label Y `% of group` (Y ticks sized from `100%`), histogram/line/bar Y is
  `Rows`, scatter/density/bubble/heatmap use their column names, while
  treemap/terms/correlation stay untitled. Heatmap row labels shift left
  by the reserved band.
- Tests: two new cases (both axes labelled; empty states draw no titles)
  and the three canvas mocks gained save/restore/translate/rotate so the
  rotated title can be captured.

## Commands

```
npm run typecheck        # clean
npx tsx --test test/ui-charts.test.ts test/chart-panel.test.ts   # 56 pass
npm test                 # 544 pass
npm run build            # clean
npm run build && npx wrangler deploy
```

## Deploy

Deployed from `agent/chart-axis-labels`:
version `4fd39cb0-5b39-434d-a1ef-7fe77890c390`
(https://turbofuzz.mrjaystein.workers.dev). Only `index.html` and two
hashed chunks changed on the asset store.

## Notes

- `opencode export` remains interactive-only in this environment; this file
  is the session record.
- The uncommitted methods from the earlier session are included in `d1b9252`,
  so nothing of the partial fix was left behind.
