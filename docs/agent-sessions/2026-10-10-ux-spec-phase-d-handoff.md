# 2026-10-10 - UX spec Phase D handoff (fresh-session context)

Phases A-C of the Stage 4 UX spec are done on `agent/ux-spec-phase-a`
(HEAD `3b3039e`, clean tree). Phase D should start in a fresh session.

## Where things are

- Spec: `claude_reviews/review_claude_20261010/STAGE4-turbofuzz-post-import-ux-spec-v2-FINAL.md`
- Session records: `docs/agent-sessions/2026-10-10-ux-spec-phase-a.md`,
  `2026-10-10-ux-spec-phase-b.md`, `2026-10-10-ux-spec-phase-c.md`
- Acceptance: **20 of 21 budgets pass**; only C8 (hover tooltip) fails.
- Suggested branch: `agent/ux-spec-phase-d` off `agent/ux-spec-phase-a`
  (the branch name still says phase-a because it accumulated all three phases).

## Environment already set up

- Playwright 1.63 installed to the global Python (`pip install playwright`);
  the harness launches `channel="chrome"` instead of the bundled browser.
- Harness lives in `C:\Users\mrjay\AppData\Local\Temp\opencode\ux-phase-a\`:
  `measure_post_import.py` (patched), `make_sales_demo.py`, `sales_demo.csv`,
  `gen_edge.py`.
- Harness patches already applied: C5 switches the first card to Histogram and
  opens its Settings disclosure before selecting `revenue`; C6 opens Settings
  before filling the title. Keep these when re-running.
- Run: `npm run build`, start `npx vite preview --port 4174` (a hidden
  `Start-Process` works), run the script from that temp dir, then kill the
  process listening on 4174.

## Phase D work items

- **WI-17 (P2, M) - hover values and click-to-filter.** This closes C8.
  - `role="tooltip"` follows the pointer: histogram bins (range + count),
    bars and heatmap cells (category, count, percent), time series (date +
    count), box plots (five-number summary), correlation cells (r and n).
  - Uses the payloads the card already holds; throttle to one update per
    animation frame.
  - Clicking a bar/category/heatmap cell toggles that value in the existing
    filter path; histogram bins set a range filter.
  - Acceptance: C8 plus a click on the `Perth` bar of the region chart changing
    the row count to 977.
  - Tests: a hit-testing function per chart kind over fixture geometry.
- **WI-18 (P2, S) - say why a chart cannot be drawn.** Message inside the plot
  area; hide settings that cannot apply; `ChartsPanel.setColumns()` adds the
  default card only on first load, never after the user removed every card.
- **WI-10 (P2, S) - clean drawer opens where the work is.** Initial tab Nulls
  when any column has empties, else Values when suggestions exist, else Column
  names; `Apply names` disabled while the panel reads "No changes".
- **WI-11 (P2, S) - suggestions with evidence.** "2 similar pairs" with a
  popover of up to three pairs and counts; `Not a duplicate` per cluster,
  remembered for the session.
- **WI-12 (P2, S) - first-run hints.** Three one-time hints (tab bar, column
  header right-click, Process Log), dismissed with `x`/Esc, stored under
  `turbofuzz.hints.seen`.
- **WI-13 (P2, S) - accessibility follow-through.** `aria-pressed` on QA chips
  (health chips already have it), each chart canvas gets `role="img"` with a
  generated label updated on redraw, Undo toast gets `role="status"`.

Phase E afterwards: WI-19 (searchable pickers), WI-20 (chart tab on small
screens).

## Code pointers for WI-17

- `src/ui/chart-card.ts` is the whole chart renderer. Data lives on the card:
  `binResult`/`meta.histogram`, `seriesResult` (points or density grid),
  `boxResult`, `crossResult`, `correlationResult`. Draw methods:
  `drawSeries` (histogram/line), `drawBars`, `drawPoints`/`drawDensity`,
  `drawBox`, `drawHeatmap`, `drawCorrelation`.
- Easiest hit-testing approach: each draw method already computes slot/cell
  geometry; record `this.hitRegions: { x, y, w, h, payload }[]` while drawing
  and rebuild it every render. Then a `pointermove` handler scans the regions,
  shows the tooltip, and `click` applies the filter.
- The default card is now a **time series** (`pickDefaultCard`), and the C8
  probe moves the mouse to 45% width / 60% height of the first canvas - the
  line kind must register hit regions too (slot columns with date + count).
- C8 counts `[role=tooltip]` elements in the DOM regardless of visibility, but
  make the tooltip genuinely appear on hover.
- Filter plumbing: app has `changeFilter(column, filter, preview)` and the
  `filters` map (`{ kind: "values", selected }`, `{ kind: "range", min, max }`,
  `{ kind: "text", mode, query }`). Chart cards currently have no `onFilter`
  callback; add one to `ChartCardOptions`/`ChartsPanelOptions` and pass it
  through from `ensureCharts()`.

## Things that changed in A-C that Phase D must respect

- Views are `Overview | Table | Chart` (`src/ui/view-tabs.ts`); Table/Chart
  panels mount lazily via `ensureTable`/`ensureCharts`/`ensureFilters`.
- Chart cards keep config across transforms by column name
  (`configToNames`/`remapChartConfigs` in `src/ui/chart-panel.ts`).
- Card settings live behind a `<details class="chart-settings-disclosure">`;
  the header is one row (Type, column pickers, Duplicate, PNG, Settings, x).
- Shared popover menu helper: `src/ui/menu.ts` (`openMenu`); dedupe menu:
  `src/ui/dedupe-menu.ts`; column cards: `buildColumnCard` in
  `src/ui/summary-band.ts`; Overview: `src/ui/overview.ts`.
- The always-on summary band is retired; Table/Chart use the compact health
  group in the results bar (`renderHealthGroup` in `app.ts`).

## Known limitations

- `opencode export` cannot run non-interactively (the picker shows a short
  session id the CLI rejects), so these markdown summaries are the record.
- Excel-sourced data, touch and screen readers were not tested, matching the
  spec's own limits.
