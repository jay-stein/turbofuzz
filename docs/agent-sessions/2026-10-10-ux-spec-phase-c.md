# 2026-10-10 - UX spec Phase C: chart render pass, grid safety, chart-first defaults, density

## Goal

Work through Phase C of `claude_reviews/review_claude_20261010/STAGE4-turbofuzz-post-import-ux-spec-v2-FINAL.md`:

- WI-14: one render pass for size, text and margins.
- WI-16: keep the chart grid across transforms.
- WI-4: make the first chart a good one, chart-first.
- WI-8: collapse a healthy data health block.
- WI-9: filter chips and a collapsible sidebar.

Branch: `agent/ux-spec-phase-a` (continuing on top of Phase B).

## What shipped

- **WI-14** (`d9fbb3d`): every card observes its `.chart-canvas-wrap` with a
  `ResizeObserver` coalesced to one animation frame; the canvas follows the
  card at any width (the 300px minimum is gone); on-screen text has an 11px
  floor while PNG exports keep `height/540`; the left margin is measured from
  the widest Y tick label; the `r = …` note is drawn above the plot.
- **WI-16** (`3747ac4`): `configToNames`/`remapChartConfigs` snapshot card
  configs by column name before a transformed rebuild, remap them to the new
  indexes and restore them when the Chart tab next mounts. Cards referencing a
  deleted or renamed column are dropped and counted in the banner; the grid
  resets only on a fresh load and an emptied grid stays empty.
- **WI-4** (`26162f8`): `pickDefaultCard` follows the spec rules (date ≥ 8
  distinct → time series, category 2–12 → bars, numeric ≥ 13 → histogram) and
  skips ID-like columns; numeric columns with ≤ 12 distinct values count as
  categories. The card header is one row (Type · Column/pickers · Duplicate ·
  PNG · Settings · ✕) with everything else behind a closed Settings disclosure.
  KDE defaults off below 30 distinct values. A chip strip offers up to three
  ready-made charts while the grid has exactly one card, and the Chart tab
  carries an “N ideas” badge until first opened.
- **WI-8** (`7c3f185`): when no QA count is above zero the Overview health
  block collapses to `✓ No duplicates, no empty cells, no outliers`.
- **WI-9** (`6e20184`): active filters render as removable chips in the results
  bar with a searchable `+ Add filter` menu; the sidebar collapses to a 48px
  rail (default when the file has more than 8 columns, remembered in
  `sessionStorage`).

## Files changed

- `src/ui/chart-card.ts`, `src/ui/chart-panel.ts`, `src/ui/chart-utils.ts`,
  `src/ui/app.ts`, `src/ui/overview.ts`, `src/ui/view-tabs.ts`,
  `src/styles.css`.
- Tests: `test/chart-panel.test.ts` (pickDefaultCard mixes, remap),
  `test/ui-charts.test.ts` (text floor and date-margin growth),
  `test/ui-overview.test.ts` (healthy collapse).

## Commands executed

```
npm test            # 344 tests, 344 pass
npm run typecheck   # clean
npm run build       # tsc + vite build, clean
npx vite preview --port 4174
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Acceptance results (Appendix A)

Phase B: 15 pass / 6 fail. **Phase C: 20 pass / 1 fail.**

| Budget | Phase B | Phase C | Target |
|---|---|---|---|
| B5 controls on Table tab | 99 ✗ | **67 ✓** | ≤ 70 (WI-9) |
| B10 chart canvas bottom, 1280×720 | 589 ✓ | **602 ✓** | ≤ 720 |
| B11 controls above first plot | 23 ✗ | **5 ✓** | ≤ 8 (WI-4) |
| C1 smallest on-screen chart text | 7 ✗ | **12.5 ✓** | ≥ 11 (WI-14) |
| C2 canvas width tracks card | 748 ✗ | **0 ✓** | ≤ 2 (WI-14) |
| C6 charts survive a column delete | (1, False) ✗ | **(3, True) ✓** | (3, True) (WI-16) |
| C7 default scatter Date × Date | False ✓ | **False ✓** | False |
| C8 hover tooltip | 0 ✗ | 0 ✗ | ≥ 1 (WI-17) |

All other budgets stayed green. The only remaining failure is C8, which is
WI-17 in Phase D.

## Measurement-harness adaptations

The local copy of `measure_post_import.py` (in
`%TEMP%\opencode\ux-phase-a\`) was adapted to the new UI — the spec invites
this in section 8:

- C5 now switches the first card to Histogram and opens its Settings
  disclosure before choosing `revenue` and filling the title, because the
  default card is a time series and the title lives behind Settings.
- C6 opens Settings before titling its card for the same reason.

## Decisions and blockers

- “Numeric columns with ≤ 12 distinct values are treated as categories” is
  implemented in `isChartCategory`, used by both `pickDefaultCard` and
  `suggestCharts`.
- ID-like detection uses uniqueness against the row count (the metadata has no
  monotonicity flag): `identifier` columns, or string/integer/number columns
  whose distinct count equals the row count.
- Renaming a column is treated as delete+add by name-based remapping, so a
  chart pointed at a renamed column is dropped with the banner message.
- `opencode export` still cannot run non-interactively; this summary is the
  record.

## Next

Phase D per the spec’s order: WI-17 (hover values and click-to-filter, the last
failing budget), WI-18 (empty states), WI-10 (clean drawer initial tab),
WI-11 (suggestions with evidence), WI-12 (first-run hints), WI-13
(accessibility follow-through). Phase E: WI-19, WI-20.
