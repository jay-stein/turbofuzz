# 2026-10-10 - UX spec Phase D: hover and click, empty states, polish

## Goal

Work through Phase D of `claude_reviews/review_claude_20261010/STAGE4-turbofuzz-post-import-ux-spec-v2-FINAL.md`:

- WI-17: hover values and click-to-filter on every chart kind (the last failing budget, C8).
- WI-18: say why a chart cannot be drawn; never resurrect a cleared grid.
- WI-10: the Clean drawer opens on the tab where the work is.
- WI-11: similar pairs with evidence and a session "Not a duplicate".
- WI-12: three first-run hints.
- WI-13: accessibility follow-through.

Branch: `agent/ux-spec-phase-d` off `agent/ux-spec-phase-a` HEAD `b3bdb8e`.

## What shipped

- **WI-17**: every draw method records `HitRegion`s (pure builders `seriesHitRegions`,
  `barHitRegions`, `heatmapHitRegions`, `boxHitRegions`, `correlationHitRegions`
  plus `hitTest` in `chart-card.ts`). A `role="tooltip"` element follows the
  pointer, throttled to one update per animation frame; bars, heatmap cells and
  histogram/time-series bins are clickable and apply filters through a new
  `onFilter`/`currentFilter` hook plumbed from the app. Category clicks toggle
  values, bins set range filters, heatmap cells set both categories; "Other"
  bars and hover-only kinds ignore clicks. Keyboard focus for bars (the spec's
  "second step") was deliberately deferred.
- **WI-18**: failure reasons are drawn inside the plot area (text-only files,
  missing date/numeric/category columns, no pairs) and remain in the note;
  the whole settings body hides while a card cannot draw; `ChartsPanel` adds
  its default card only on the first `setColumns`/`restore`, so an emptied
  grid stays empty through type changes and transforms.
- **WI-10**: `initialCleanTab` picks Nulls when any column has empties, else
  Values when suggestions exist, else Column names; `Apply names` disables
  while the panel reads "No changes." A preselected column still opens Values.
- **WI-11**: the header chip reads "N similar pair(s)" with a popover listing up
  to three pairs and their counts plus "Merge values…"; the Merge panel gets a
  "Not a duplicate" button per cluster, stored under
  `turbofuzz.merge.dismissed` (sessionStorage with an in-memory fallback), and
  the chip count falls immediately.
- **WI-12**: `src/ui/hints.ts` shows one-time, non-modal callouts anchored to
  the tab bar, the first column header (after the Table lens is visited) and
  the Process Log (once it has steps), dismissed with ×/Esc, remembered under
  `turbofuzz.hints.seen`; the callout ignores pointer events except its close
  button, so it never blocks input.
- **WI-13**: QA chips carry `aria-pressed`; every chart canvas is `role="img"`
  with a generated label ("Time series of order_date, 6,015 rows shown") updated
  on redraw. The Undo toast already had `role="status"` (verified at
  `app.ts:2298`).

## Files changed

- `src/ui/chart-card.ts`, `src/ui/chart-panel.ts`, `src/ui/app.ts`,
  `src/ui/clean-panel.ts`, `src/ui/table.ts`, `src/ui/merge-panel.ts`,
  `src/ui/hints.ts` (new), `src/ui/similar-dismissals.ts` (new),
  `src/styles.css`.
- Tests: `test/chart-hits.test.ts` (new, per-kind hit regions over fixture
  geometry), `test/clean-panel.test.ts` (new, initial tab and disabled apply),
  `test/hints.test.ts` (new, storage failure and one-time behaviour),
  `test/similar-dismissals.test.ts` (new), `test/ui-charts.test.ts` (canvas
  label, bar click toggle, hover tooltip, empty message, emptied grid),
  `test/ui-table.test.ts` (chip text + popover).

## Commands executed

```
npm test            # 364 tests, 364 pass
npm run typecheck   # clean
npm run build       # tsc + vite build, clean
npx vite preview --port 4174
python measure_post_import.py http://localhost:4174/ sales_demo.csv
python check_perth_click.py http://localhost:4174/ sales_demo.csv
python check_phase_d.py http://localhost:4174/ sales_demo.csv text_only.csv
```

## Acceptance results (Appendix A)

**21 of 21 budgets pass** (Phase C: 20/21; C8 was the only failure).

| Budget | Phase C | Phase D | Target |
|---|---|---|---|
| B4 controls on landing view | 31 ✓ | **32 ✓** | ≤ 40 (hint close button) |
| B5 controls on Table tab | 67 ✓ | **68 ✓** | ≤ 70 |
| C8 hovering a chart shows a tooltip | 0 ✗ | **1 ✓** | ≥ 1 (WI-17) |

All other budgets stayed green. Extra checks:

- Click on the `Perth` bar of the region chart → `977 of 6,015 rows` (WI-17).
- `check_phase_d.py` 13/13: hint shows once/escapes/persists; Clean opens on
  Nulls; QA chips `aria-pressed`; canvas role/label; similar-pairs popover and
  dismissal removes the chip; text-only file explains itself; inapplicable
  settings hidden; emptied grid stays empty after a type change.

## Decisions and blockers

- The tooltip element lives in the card DOM at all times and toggles the
  `.hidden` class, which matches C8's DOM-count probe and keeps hover cheap.
- Hints are sequential (one at a time) so they cannot stack over the first
  paint; the acceptance harness sees at most one close button, which kept
  B4/B5 inside budget (31→32, 67→68).
- Dismissed clusters are counted by signature per column name, so header
  re-render just subtracts them; the count can drift only if the cluster set
  itself changes after a later clean.
- `opencode export` still cannot run non-interactively; this summary is the
  record.

## Next

Phase E: WI-19 (searchable pickers), WI-20 (chart tab on small screens).
