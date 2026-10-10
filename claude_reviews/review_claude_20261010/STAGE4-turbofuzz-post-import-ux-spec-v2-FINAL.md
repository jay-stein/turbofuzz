# TurboFuzz post-import UX spec

**Target branch:** `agent/ux-batch` @ `59807c5` (builds clean, `tsc` clean, 320/320 tests pass)
**Written:** 2026-10-09 · **Revised:** 2026-10-10 (adds the chart-view review, section 6) · **Supersedes:** the audit run against `main` @ `c21ecb5`
**Goal:** a user who loads a file understands what they have, sees what to do next, and finds charts without hunting.

---

## 0. Read this first

1. The branch fixed some of what the first audit found and added a large chart system. Section 2 says what is fixed, what is partial, and what is still open.
2. Every target in this spec is a number checked by `measure_post_import.py` (Appendix A). Today **20 of 21 budgets fail**. Implement work items until they pass.
3. Work items are independent unless a dependency is listed. Suggested order is in section 7.
4. **The chart view got a full review in the 2026-10-10 revision** (section 6). The first version of this spec judged charts from the first-load state only. The full review found that the grid does not redraw when the layout changes, on-screen chart text is 7px, new and duplicated cards lose their settings, and any transform wipes the grid. WI-14 to WI-20 cover them.

Corrections to the earlier audit page: on `main` the first screen showed **15** full table rows at 1440×900 (it said about 16, which counted a partial row), and the chart card has **23** visible controls above the plot, not 33 (33 is the DOM count including hidden ones).

---

## 1. Baseline

Same synthetic 6,015 × 12 sales file, same Chromium 141, same selectors, measured on both builds.

| Metric | `main` c21ecb5 | `ux-batch` 59807c5 | Target |
|---|---|---|---|
| First data row top, 1440×900 | 457px | **408px** | ≤ 230px |
| Full rows visible, 1440×900 | 15 | **17** | ≥ 22 |
| Full rows visible, 1280×720 | 9 | **11** | ≥ 16 |
| Table header height | 127px | **80px** | hold at ≤ 80px |
| Controls visible on first paint, 1440×900 | 112 | **99** | landing ≤ 40, Table tab ≤ 70 |
| Controls visible on first paint, 1280×720 | 86 | **75** | follows the above |
| Summary band height (always shown) | 184px | **184px** | Overview tab only |
| “N rows × M cols” stated on first screen | 2 | **2** | 1 |
| Landing view | Table | **Table** | Overview |
| Stepper stages | 5, View is stage 4 | **unchanged** | 4, no View |
| Way to reach charts | none | **Table \| Chart toggle**, 52×26px, in the results bar | tab bar in the nav row |
| Chart: controls above first plot, 1280×720 | n/a | **23** (33 in the DOM, 10 hidden) | ≤ 8 |
| Chart: canvas visible without scrolling, 1280×720 | n/a | **116 of 234px** | all of it |
| Chart: time to first canvas | n/a | **83–121ms** (varies by run) | ≤ 300ms |
| `order_id` (`ORD-00001…`) column type | Date | **Date** | not Date |
| Chart: smallest on-screen text, default layout | n/a | **7px** | ≥ 11px |
| Chart: canvas width vs card width after changing “per row” | n/a | **552px off** | ≤ 2px |
| Chart: correlation preset columns selected | n/a | **0** | ≥ 2 |
| Chart: cards kept after deleting one column (3 customised cards) | n/a | **1 default card** | 3 |
| Chart: hover tooltip | n/a | **none** | on every kind |

---

## 2. Status of the earlier findings

| # | Earlier finding | Status on `ux-batch` | Evidence |
|---|---|---|---|
| 1 | View is stage 4 but is a lens; highlight snaps back after a drawer closes | **Open** | `src/ui/stepper.ts` is byte-identical to `main`. Measured: active stage `clean` while open, `view` after Esc. |
| 2 | Dataset summary stated twice | **Open** | Top bar “6,015 rows × 12 columns · 2 of 12 columns have missing values · 293 ms”, then the QA header “6,015 rows × 12 cols” and its footer “2 of 12 columns have missing values · 293 ms”. |
| 3 | Stats Report is the widest control; Remove duplicates shown disabled at 0 | **Open** | Screenshot: Stats Report spans the QA block; Remove duplicates is shown disabled with 0 duplicates. |
| 4 | `order_id` typed Date (`ORD-00001` → 2001-01-01) | **Open (P0)** | `Date.parse` fallback still at `src/parse/dates.ts:70`. Card reads “100-01-01 – 6000-01-…”. |
| 5 | Only 6 of 12 column cards visible, horizontal scroll | **Open** | `.summary-columns` is still a 164px-card strip. |
| 6 | 12 always-listed filter rows (38 controls) | **Open** | Sidebar unchanged: 38 of 99 controls. |
| 7 | Shuffle outweighs Export | **Partial** | Count input removed (“Shuffle all”). Still the only bordered, iconed button; Export is ghost. |
| 8 | Header says “no empty cells / no outliers / no long values” on every column | **Fixed** | `qaChip()` in `table.ts` returns `null` at count 0. Header 127 → 80px. |
| 9 | Only visuals can’t be acted on | **Partial** | Chart view with eight kinds (histogram, time series, bars, scatter, density, box, heatmap, correlation), card grid, PNG export, all fast and filter-aware (section 6.2). But the view is hard to find (WI-3), the first chart is poor (WI-4), and the grid has layout, text, state and interaction bugs (section 6.3, WI-14 to WI-20). |
| 10 | Clean drawer opens on “Column names” with a filled Apply button while it reads “No changes.” | **Open** | Screenshot: drawer opens on Column names, Apply names filled blue while the panel reads “No changes.” |
| 11 | “2 mergeable” flags Widget A/B and Gizmo/Gizmo Pro | **Open** | Chip still shown on `product`. |
| 12 | No first-run guidance | **Open** | No hint, coach-mark or onboarding code in `src/ui`. |

**Worth keeping from the branch:** the chart card grid, the user guide drawer (`help-drawer.ts`), the Theme toggle, instant one-click cleans with an Undo toast, Process Log grouping, fix chips in column headers, Split and Combine transforms, and zero-count chip suppression.

---

## 3. User-reported problems mapped to work items

| Problem users report | Root cause in code | Work items |
|---|---|---|
| “Overwhelming, no hierarchy” | Six regions compete on first paint; summary band, 12 filter rows and a heavy results bar all stay on screen in every view | WI-2, WI-5, WI-6, WI-7, WI-9 |
| “Charts are hidden, no next step” | Chart is a 52×26px toggle in the second toolbar; nothing points to it; no next-step guidance | WI-3, WI-4, WI-2 |
| “I never get oriented” | Load lands on the densest view; the stepper marks View as stage 4 and gives no sense of where the user is | WI-2, WI-3 |
| “The tool misread my file” | `order_id` shown as Date on the first card | WI-1 |
| “The charts are tiny and fiddly” | Canvas does not follow the card width; 7px text; settings block above every plot | WI-14, WI-4 |
| “My charts vanished” / “the new chart is wrong” | Transforms rebuild the grid; presets and Duplicate lose their settings | WI-15, WI-16 |
| “I can’t read values off a chart” | No hover, tooltip or click-to-filter | WI-17 |

---

## 4. Design rules (apply to every item)

- **R1. Lenses vs operations.** Tabs (Overview · Table · Chart) change what you look at and never alter data. The pipeline rail (Load · Clean · Transform · Export) changes data and records a step in the Process Log. Nothing is in both.
- **R2. State a fact once.** Rows × columns, parse time and missing-value summary each appear in one place on any screen.
- **R3. Evidence before action.** Every suggestion shows the number behind it and one button that acts on it.
- **R4. Content-first budget.** On the Table tab the first data row starts by 230px at 1440×900. On the Chart tab the plot is fully visible at 1280×720 with no scroll.
- **R5. Do not tax power users.** Preferences persist, tabs have keys, and nothing introduced here adds a worker round trip to the load path.

---

## 5. Work items

Effort: S ≈ half a day, M ≈ 1–2 days. Files use paths on the branch. Chart-view items WI-14 to WI-20 are in section 6.4.

### WI-1 · Stop typing `PREFIX-123` IDs as dates · P0 · S

**Problem.** `parseDate` falls back to `Date.parse`, which V8 applies to ID-like strings. Probed on the branch:

| Input | Today | Should be |
|---|---|---|
| `ORD-00001` | 2001-01-01 | NaN |
| `INV-1001` | 1001-01-01 | NaN |
| `Room 12` | 2001-12-01 | NaN |
| `2024` | 2024-01-01 | NaN (an integer, not a date) |
| `15 Mar 2024`, `Mar 15, 2024`, `March 15 2024`, `Tue, 15 Mar 2024` | parsed | unchanged |

Existing tests depend on the fallback for month-name formats (`test/parse.test.ts:99-100`, `test/date-parts.test.ts:22-23`, `test/clean-ops.test.ts:106`), so replace it rather than delete it.

**Spec.**
- In `src/parse/dates.ts`, replace the `Date.parse` branch (line 70) with explicit parsing of English month names: `D Mon YYYY` and `Mon D, YYYY`, optional weekday prefix, optional ordinal suffix (`1st`), full or three-letter month, optional trailing time. Return `NaN` for everything else.
- A bare four-digit year is not a date.
- Keep the existing inference thresholds in `inferColumnType` (`src/parse/infer.ts:142`); only the parser gets stricter.

**Acceptance.** The table above. `order_id` in the test file infers as text. All 320 existing tests still pass.
**Tests.** Add the table as cases in `test/parse.test.ts`, plus one column-level case in `test/ingest.test.ts`.

---

### WI-2 · Land on an Overview · P0 · M

**Problem.** `openWorkspace()` (`src/ui/app.ts:939`) mounts everything and lands on the table. There is no state that says what the file is.

**Spec.** A third view, `overview`, is the default after load. Everything on it comes from `LoadedMessage`, so there is no new worker request.

Layout, top to bottom:
1. **Dataset line.** File name, `6,015 rows × 12 columns`, parse time, encoding badge when not UTF-8. This is the single place the summary is stated (R2, see WI-6).
2. **Health tiles (max 4).** Complete % (`1 − totalNullCells / totalCells`), Duplicate rows (`stats.duplicateRows`), Columns with empty cells (`n of N`), Outlier rows (`valueAnomalyRows`). Neutral at 0, amber above 0, never red.
3. **Next steps (max 3).** Ranked by rows affected, always ending with one chart slot (WI-4). Rule catalogue:

   | Rule | Fires when | Card text | Button |
   |---|---|---|---|
   | Empties | any `column.stats.nulls > 0` | “2 columns have empty cells” | Open Clean on the Nulls tab |
   | Duplicates | `stats.duplicateRows > 0` | “15 duplicate rows” | opens the existing dedupe menu |
   | One-click fixes | any `column.suggestions.length > 0` | “3 columns have one-click fixes” | Open Table, header fix chips visible |
   | Near-duplicates | any `column.similarGroups > 0` | “1 column has near-identical values” | opens the Merge panel |
   | Constant columns | any `distinct === 1` | “1 column holds a single value” | Review |
   | Chart | always | “Chart orders over time” | opens Chart with that card |

   If more than three fire, show the top two plus the chart card.
4. **All columns.** The existing stat cards in a wrapping CSS grid (`repeat(auto-fill, minmax(164px, 1fr))`), all visible, no horizontal scroll. Clicking a card opens a small menu: Filter · Chart · Clean (today a click only focuses the filter).
5. **Action row.** `Explore the table →` (primary) and a checkbox `Open in Table next time`, persisted under `turbofuzz.view.default` (wrap storage in try/catch).

The table, filter sidebar and chart panel mount on first visit to their tab, so landing paint does less work than today.

**Files.** New `src/ui/overview.ts`; `src/ui/app.ts` (`openWorkspace`, `setView`); export the card builder from `src/ui/summary-band.ts`; `src/styles.css`.
**Acceptance.** B4, B6. All 12 cards visible at 1440 and 1280 widths without horizontal scroll. Each next-step card contains a number and a button.
**Tests.** New `test/ui-overview.test.ts` (happy-dom) covering rule firing and ordering with fixture `ColumnMeta` sets.
**Depends on.** WI-3 for the tab bar. Can land first behind a temporary button.

---

### WI-3 · Separate tabs from the pipeline rail · P0 · S–M

**Problem.** `PIPELINE_STAGES` (`src/ui/stepper.ts:15`) lists View as stage 4. Clean and Transform highlight while their drawer is open, then `onClose: () => this.setStage("view")` snaps back (`app.ts` lines 1747, 1761, 2156 and 2367, plus `openWorkspace` at line 945 and the `view` case in `selectStage` at line 1701). The Table | Chart toggle (`app.ts:478-490`) is a separate, small control in the results bar.

**Spec.**
- Remove `view` from `PIPELINE_STAGES` and from `StageId`. Rail items: **Load ✓ · Clean · Transform · Export**.
- Rail state comes from the Process Log: `Clean · 2` and `Transform · 1` when steps exist, `optional` before. An item is “done” when its count is above zero. Opening a drawer adds a temporary active class and removes it on close; it never changes the selected tab.
- New tab bar `Overview | Table | Chart` in the same row as the rail (tabs left, rail right; the rail wraps under the tabs below 900px). Semantics: `role="tablist"`, each tab `role="tab"` with `aria-selected`, roving `tabindex`, arrow-key navigation.
- Keys `1`, `2`, `3` switch tabs when focus is not in an input.
- The Chart tab shows a small count badge (`3 ideas`, from WI-4) until it has been opened once.
- Delete the `.view-tabs` pair from the results bar (`app.ts:478`).
- Remember the last non-Overview tab for the session so Clean → close returns the user to where they were.

**Files.** `src/ui/stepper.ts`, `src/ui/app.ts` (`buildWorkspace`, `selectStage`, `setStage`, `setView`), `src/styles.css`.
**Acceptance.** B6, B7, B13. Open Clean, press Esc: the selected tab is unchanged.
**Tests.** There is no stepper test today. Add `test/ui-stepper.test.ts` covering rail state from step counts, drawer open/close leaving the tab unchanged, and tab keyboard navigation.

---

### WI-4 · Make the first chart a good one, chart-first · P1 · M

**Problem (measured).** On the Chart tab the plot starts 225px below the card’s top edge, behind 23 visible controls (type, column, Duplicate, PNG, remove, Start, End, Bins, “> Max” bar, KDE, Full range, colour swatches, hex field, title). At 1280×720 only 116 of 234px of the canvas is on screen. The default chart is a histogram of the first numeric column (`defaultCardKind`, `src/ui/chart-utils.ts:51`; `presetFor`, `src/ui/chart-panel.ts:53`). On the test file that is `unit_price`, which has 6 distinct values, so the user sees six spikes with a KDE curve through them. The second card is worse: `presetFor` cycles scatter → correlation → box → heatmap and picked `order_id` against `order_date` (a mis-typed ID against a date, r = 0.00). On the 300,000-row file the default is a flat histogram of the row `id`. Section 6.3 (CH-5, CH-6) has the evidence.

**Spec.**
1. **Pick the default by rule**, replacing the first-card branch of `presetFor`:
   1. A date column with ≥ 8 distinct values → time series of rows per period. Prefer the date column with the most distinct values.
   2. A category or boolean column with 2–12 distinct values → bar of counts. Prefer the highest cardinality ≤ 12.
   3. A numeric column with ≥ 13 distinct values → histogram.
   4. Otherwise keep today’s fallback.
   Skip ID-like columns when choosing: a text column with all-distinct values, or an integer column that is unique and monotonic (the row `id`). Never default a scatter to two date columns, or to a column paired with itself. Time series uses the full date range, not p1–p99.
   Numeric columns with ≤ 12 distinct values are treated as categories for charting (this also handles `quantity`, which is typed Category on the test file already). Put the reason in the card note: “Suggested: rows per month by order_date”. Extract the rule into a pure function `pickDefaultCard(columns)` so it is testable.
2. **Collapse settings.** Each card shows one row: `Type ▾ · Column ▾ · Duplicate · PNG · ✕`. Everything else sits behind a `Settings` disclosure, closed by default. KDE defaults off when the column has fewer than 30 distinct values.
3. **Suggested charts strip.** While the grid has exactly one card, show up to three chips under the toolbar, built from existing kinds:

   | Columns | Chip |
   |---|---|
   | date + count | “Rows over time” (time series) |
   | category ≤ 12 | “Rows by `product`” (bars) |
   | numeric ≥ 13 distinct | “Distribution of `revenue`” (histogram) |
   | two numerics | “`unit_price` vs `revenue`” (scatter) |
   | two categories | “`region` × `product`” (heatmap) |

   Clicking a chip adds that card. The count of chips feeds the tab badge in WI-3.
4. **Chart-mode chrome.** With WI-5 done, the summary band no longer shows on this tab, which is what lets the plot sit inside the first 300px.

**Files.** `src/ui/chart-utils.ts`, `src/ui/chart-panel.ts`, `src/ui/chart-card.ts` (settings disclosure), `src/styles.css`.
**Acceptance.** B10, B11, B12, C7. For the test file the default is a time series on `order_date`. For a file with no date and no category column, the default is a histogram.
**Tests.** `pickDefaultCard` over six column mixes in `test/chart-panel.test.ts`: the sales file, no date, no category, text only, an ID-first file (the 300,000-row case), and one row.

---

### WI-5 · Summary band lives on the Overview only · P1 · M

**Problem.** The 184px summary band (QA block plus column-card strip) is mounted in the workspace for every view. In Chart mode it still takes y 97–281, above the plot.

**Spec.**
- Render `SummaryBand` only on the Overview tab (the column grid in WI-2 reuses its cards).
- On Table and Chart, replace it with a compact **health group** in the results bar: `Duplicates 15`, `Empty cells · 2 cols`, `Outliers 47`, each shown only when above zero, each toggling the same special filters via `onToggleSpecial`. When everything is zero, show nothing.
- `Remove duplicates` appears beside the Duplicates chip only when duplicates exist.
- `Stats Report` becomes a text link on the Overview and an item in a `⋯` menu elsewhere.

**Files.** `src/ui/app.ts` (`openWorkspace`, results bar), `src/ui/summary-band.ts`, `src/styles.css`.
**Acceptance.** B1, B2, B3. No `.summary-band` element is visible on Table or Chart.
**Depends on.** WI-2.

---

### WI-6 · One dataset summary · P1 · S

**Spec.** The top bar shows `sales_demo.csv · 6,015 × 12`. Its tooltip carries the detail: missing-value summary, duplicate groups, encoding, parse time. Remove `.qa-sub` and the QA footer line. The file name is visible on every screen (today it is only in a screen-reader heading).
**Files.** `src/ui/app.ts` (`this.metaEl.textContent`, line 988), `src/ui/summary-band.ts` (`buildQaBlock`, line 276; `.qa-sub` line 290; `.overview-foot` line 398).
**Acceptance.** B8.

---

### WI-7 · Results bar hierarchy · P1 · S

**Spec.** `Export…` becomes the only filled (primary) button. `Process Log` shows its count, `Process Log (3)`, and is hidden at 0 rather than dimmed. `Shuffle all` stays, because it was an explicit request, but takes the same ghost style as `Copy` and loses the icon emphasis.
**Files.** `src/ui/app.ts` (`buildWorkspace`), `src/styles.css` (`.shuffle-button`).
**Acceptance.** Exactly one `.primary` button in the results bar. Shuffle’s border, weight and height match Copy’s.

---

### WI-8 · Collapse a healthy QA block · P2 · S

**Spec.** On the Overview, when every QA count is zero, the Data health block collapses to one line, `✓ No duplicates, no outliers`. Rename “Data QA” to “Data health”. `Remove duplicates` is hidden at zero.
**Files.** `src/ui/summary-band.ts`.

---

### WI-9 · Filters as chips, sidebar collapsible · P2 · M

**Problem.** 38 of 99 first-paint controls are in the sidebar: a type dropdown and ✕ on every column, before any filter exists.

**Spec.**
- Active filters render as removable chips in the results bar, with `+ Add filter` (a column search that opens that column’s card).
- The sidebar collapses to a 48px rail with a toggle. It is collapsed by default when the file has more than 8 columns, and the choice is remembered per session.
- Filter state, the `filters` map and all worker messages stay as they are.

**Files.** `src/ui/filters.ts`, `src/ui/app.ts`, `src/styles.css`.
**Acceptance.** B5. With the sidebar collapsed, at most 12 sidebar controls are visible at 1440×900.

---

### WI-10 · Clean drawer opens where the work is · P2 · S

**Spec.** The initial tab is `Nulls` when any column has empty cells, otherwise `Values` when any column has suggestions, and `Column names` only when header changes exist. `Apply names` is disabled, not filled blue, while the panel reads “No changes.”
**Files.** `src/ui/clean-panel.ts`.
**Tests.** Initial-tab choice for three fixture schemas.

---

### WI-11 · Suggestions with evidence · P2 · S

**Spec.** `2 mergeable` becomes `2 similar pairs`. Its popover lists up to three pairs with counts (`Widget A / Widget B`). The Merge panel gets `Not a duplicate` per cluster, remembered for the session so the chip count falls.
**Files.** `src/ui/table.ts` (`buildQaRow`), `src/ui/merge-panel.ts`.
**Acceptance.** On the test file, dismissing both clusters on `product` removes the chip.

---

### WI-12 · First-run hints · P2 · S

**Spec.** Three one-time hints anchored to the tab bar, the column header (right-click for the column menu) and Process Log. Dismiss with `×` or Esc. Stored under `turbofuzz.hints.seen` (try/catch). Never modal, never shown on later loads, never blocks input.
**Files.** `src/ui/app.ts`, new `src/ui/hints.ts`.
**Acceptance.** Shown once; storage failure does not throw.

---

### WI-13 · Accessibility follow-through · P2 · S

**Spec.** Tab semantics come from WI-3. Add `aria-pressed` to QA chips that toggle filters. Give each chart canvas `role="img"` with a generated label (“Histogram of revenue, 6,015 rows”); this closes CH-12. Update it on every redraw. Verify the Undo toast has `role="status"`.
**Files.** `src/ui/table.ts`, `src/ui/chart-card.ts`, `src/ui/app.ts`.

---

## 6. Chart view

Added on 2026-10-10 after a full review. The first version of this spec rated the chart view from its first-load state only.

### 6.1 What I tested

All eight chart kinds on the 6,015-row sales file; 1, 2, 3 and 4 charts per row at 1440×900, 1280×720 and 390×844; Add, Duplicate and Remove; PNG export of every kind at 1920×1080; filters while the Chart tab is open; deleting a column (a tracked transform); the dark theme; axe-core on the chart pane in both themes; keyboard reach; hover and click; and five edge-case files (text only, one row, constant and all-empty columns, 120 columns, 300,000 rows). Eight of the 21 checks in Appendix A (C1–C8) cover the chart view and can be re-run; the edge-case files are generated by Appendix C.

**Not tested:** Excel-sourced data, touch, screen readers, and small multiples or trend overlays (not shipped on this branch).

### 6.2 What works: keep it

- **Speed.** On 300,000 × 8 rows the first canvas appears in 111ms, each chart kind redraws in 76–125ms, and four cards settle 186ms after a filter click.
- **Filters drive charts.** After excluding one region (Adelaide), the results count read “4,980 of 6,015 rows” and the scatter note “4,965 points”; the other cards redrew without a reload.
- **PNG export.** All eight kinds exported at 1920×1080. File names carry dataset, column and size (`sales_demo-unit_price-1920x1080.png`) and the text is legible.
- **Robustness.** The dark theme repaints, axe-core reports 0 violations on the chart pane in both themes, seven Tab presses reach the first card control, and no console errors were logged in any chart test run.
- **Notes that carry facts**: “top 5 + Other”, “120 values beyond the p1–p99 chart range”, “0 outliers”, Pearson r.

### 6.3 Findings

| ID | Sev | Finding and evidence | Cause | Fix |
|---|---|---|---|---|
| CH-1 | P1 | **Changing “per row” never redraws the canvases.** At 1 per row the canvas stays 496px in a 1,048px card (47% of the width). At 4 per row it stays 496px in a 220px card and scrolls sideways inside the card. | `ChartsPanel.syncLayout()` only sets `data-cols` (`chart-panel.ts:266`). `ChartCard.render()` is driven by the window `resize` and `themechange` listeners (`chart-card.ts:206`, `:549–550`) and by the card’s own setting changes. Nothing observes the card’s own width. | WI-14 |
| CH-2 | P1 | **On-screen chart text is unreadable.** At the default layout the smallest text is 7px, the median 7px, the largest 10.5px. The 1080p PNG of the same chart uses about 22px. | `frame()` scales text by `ui = clamp(height / 540, 0.7, 2.6)` (`chart-card.ts:1170`). A 496px-wide canvas is 279px tall, so `ui` is clamped to 0.7. | WI-14 |
| CH-3 | P1 | **“+ Add chart” presets and Duplicate drop their settings.** From the default histogram of `unit_price`, six clicks added: scatter (`order_id` vs `order_date`), **correlation with 0 columns selected** (note: “Correlation needs at least two numeric columns — select them above.”, while three numeric columns exist), box (`unit_price` by `region`), heatmap (`region` × `product`), then histogram of `unit_price` twice. Duplicating a `revenue` histogram titled “Revenue spread” gave a `unit_price` histogram with an empty title field. Duplicating a correlation card with 3 columns selected gave a card with 0. The copy keeps the colour, which is why it looks like a copy while plotting something else. | The constructor calls `syncOptions()` before any columns exist (`chart-card.ts:546`), which resets `column`, `x`, `y` and filters `correlationColumns` down to nothing. `presetFor`’s “prefer unused columns” logic is therefore overwritten. The title input is never filled from the config (`:517`). | WI-15 |
| CH-4 | P1 | **Any transform wipes the chart grid.** Three customised cards (one titled) became a single default histogram after deleting one column. | `openWorkspace()` disposes and rebuilds the `ChartsPanel` (`app.ts:1014`). | WI-16 |
| CH-5 | P1 | **Settings crowd out the plot.** The plot starts 225px below the card top at the default 2-per-row layout. At 4 per row the scatter card spends 285px on its header row alone. At 1280×720 only 116 of 234px of the default canvas is on screen. | One always-open settings block per card (type, column, range, bins, KDE, colours, hex, title). | WI-4 |
| CH-6 | P2 | **Poor defaults.** Histogram of `unit_price` (6 distinct values) with a KDE curve; time series on `order_id` (mis-typed Date); scatter of `order_id` against `order_date` with r = 0.00; on the 300,000-row file the default is a flat histogram of the row `id`. Time series also trims the first and last ~2% of dates. | `defaultCardKind` and `presetFor` take the first column of the right type. For added cards the preset is then wiped (CH-3) and `syncOptions()` falls back to the first allowed column, which is how a scatter lands on two date-typed columns. | WI-4, WI-15 |
| CH-7 | P2 | **Axis labels are cut off.** All four Y labels on the default scatter lose their first digit (“026-02-02”) on screen and in the 1920×1080 export. The “r = 0.00” note is drawn over the points. | Left margin is a fixed `56 × ui` regardless of label width. | WI-14 |
| CH-8 | P2 | **Charts are pictures.** Hovering changes no pixels, no tooltip element exists, clicking a chart does not change the filter. You cannot read a value off a bar. | Hover, brush and click-to-filter are listed as Phase 3 in `next_steps.md` and not built. | WI-17 |
| CH-9 | P2 | **Dead ends with no explanation.** A text-only file gets a blank card with an empty column dropdown; the only message (“Pick a column to chart.”) is the small note under the plot. A time series with no date column does the same. After removing every chart, changing any column’s type silently adds a default chart back. | `ChartsPanel.setColumns()` re-adds a card whenever the list is empty (`chart-panel.ts:234`). | WI-18 |
| CH-10 | P2 | **Phone width.** At 390px the page scrolls sideways and the chart sits below the summary band and the filter list. “4 per row” stays selectable although the CSS forces one column below 720px. | Same layout as desktop, stacked. | WI-20 |
| CH-11 | P3 | **Pickers do not scale.** With 120 columns the column picker is a flat 120-option select and the correlation picker is a native multi-select 90px tall with no search. | Plain `<select>` elements. | WI-19 |
| CH-12 | P3 | **No text alternative for the canvas.** axe passes only because a bare `<canvas>` has no role. | No `role="img"` or label. | WI-13 |

---

### 6.4 Chart work items

### WI-14 · One render pass: size, text, margins · P1 · M

**Spec.**
- Observe each card’s `.chart-canvas-wrap` with a `ResizeObserver` and re-render on change (coalesce to one `requestAnimationFrame`). This fixes the “per row” selector, sidebar resizing and window resizing with one mechanism.
- Remove the 300px minimum canvas width, or scale the drawing down instead of overflowing.
- Scale text for the screen separately from the export: on screen the smallest label is at least 11px; the export keeps `height / 540`.
- Compute the left margin from the widest tick label (`measureText`) plus 8px, so date labels are never cut.
- Draw the “r = …” note above the plot area, not over the points.

**Files.** `src/ui/chart-card.ts` (`render`, `frame`, constructor), `src/ui/chart-panel.ts`.
**Acceptance.** C1, C2, C3.
**Tests.** Extend `test/ui-charts.test.ts`: `frame()` margins grow with label width, and no label starts below x = 0 for ISO dates.

---

### WI-15 · Presets and Duplicate keep their settings · P1 · S

**Spec.**
- Make `syncOptions()` a no-op until columns exist, or pass the columns into the constructor. A preset’s `column`, `x`, `y` and `correlationColumns` must survive construction.
- On a correlation card with fewer than two selected columns, fill `numeric.slice(0, 6)` the same way `setKind` does.
- Initialise the title input from `config.title`.
- `presetFor` already prefers unused columns. Once presets survive construction, check that a second histogram does not repeat the first card’s column, and that when every numeric column is in use the next card is a different kind.

**Files.** `src/ui/chart-card.ts`, `src/ui/chart-panel.ts`.
**Acceptance.** C4, C5.
**Tests.** `test/chart-panel.test.ts`: a card constructed with a preset and then given columns keeps `x`, `y`, `correlationColumns` and `title`.

---

### WI-16 · Keep the chart grid across transforms · P1 · M

**Spec.**
- Save each card’s config in app state with columns stored by **name**, not index.
- When a `transformed` message rebuilds the workspace, restore the cards and remap names to the new indexes. Drop only the cards whose columns no longer exist and say so in the banner: “1 chart removed because its column was deleted.”
- Reset the grid only when the user loads new data.

**Files.** `src/ui/app.ts` (`openWorkspace`), `src/ui/chart-panel.ts`.
**Acceptance.** C6.
**Tests.** Pure remap function over rename, delete and reorder cases.

---

### WI-17 · Hover values and click-to-filter · P2 · M

**Spec.**
- A `role="tooltip"` element follows the pointer over histogram bins (range and count), bars and heatmap cells (category, count, percent), time series (date and count), box plots (five-number summary) and correlation cells (r and n). Use the payloads the card already holds, so there is no new worker request. Throttle to one update per animation frame.
- Clicking a bar, category or heatmap cell toggles the matching value in the filter list through the existing `onFilter` path. Histogram bins set a range filter.
- Show the tooltip on keyboard focus for bars as a second step.

**Files.** `src/ui/chart-card.ts`, `src/ui/app.ts` (filter hook), `src/styles.css`.
**Acceptance.** C8, plus a click on the `Perth` bar of the region chart changes the row count to 977.
**Tests.** Hit-testing function per chart kind over fixture geometry.

---

### WI-18 · Say why a chart cannot be drawn · P2 · S

**Spec.**
- Show the message inside the plot area, not only in the note. Examples: “This file has no numeric, date or category columns. Change a column’s type in the filter list.” / “No date column in this file.” / “Correlation needs at least two numeric columns; this file has 1.”
- Hide the settings that cannot apply (KDE, Bins, colours) while a card has nothing to draw.
- `ChartsPanel.setColumns()` adds the default card only on the first load of a dataset, never after the user has removed every card.

**Files.** `src/ui/chart-card.ts`, `src/ui/chart-panel.ts`.
**Acceptance.** For `text_only.csv` (Appendix C) the plot area contains the message. Remove all charts, change a column type, and the grid stays empty.

---

### WI-19 · Pickers that scale · P3 · S

**Spec.** Above 12 columns the column pickers become searchable lists grouped by type. The correlation picker gets a search box and “All numeric”, “None” and “First 6” actions.
**Files.** `src/ui/chart-card.ts`, `src/styles.css`.

---

### WI-20 · Chart tab on small screens · P3 · M

**Spec.** At 720px and below, the chart pane comes first; the summary band and filters move behind a sheet; the “per row” selector is hidden.
**Files.** `src/styles.css`, `src/ui/app.ts`.
**Acceptance.** No horizontal page scroll at 390px; the first chart’s plot is visible without scrolling.

---

---

## 7. Suggested order

| Phase | Items | Why together |
|---|---|---|
| A (a day or two) | WI-1, WI-6, WI-7, WI-15 | Small, independent, remove visible mistakes, including the broken presets and Duplicate |
| B | WI-3, WI-2, WI-5 | The structural change; WI-5 needs WI-2, and WI-2 wants WI-3’s tab bar |
| C | WI-14, WI-16, WI-4, WI-8, WI-9 | Chart render pass first (text, size, margins), then keep the grid across transforms, then the chart first run and the remaining density. WI-4’s one-row settings are easier once WI-14 lands |
| D | WI-17, WI-18, WI-10, WI-11, WI-12, WI-13 | Hover and click-to-filter, honest empty states, polish |
| E | WI-19, WI-20 | Scale and small screens |

Expected effect of phase B on the Table tab: first data row at about 224px (57 top bar + 40 tab/rail row + 47 results bar + 80 header), which is what the 230px budget assumes.

---

## 8. Build note and limits

- **`xlsx` dependency.** The branch pins `xlsx` to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. `npm ci` fails with a 403 on any network that blocks that host (it did in my sandbox). I built locally with registry `xlsx@^0.18.5` instead. CSV post-import behaviour is unaffected, but Excel flows on this branch were **not** tested.
- One synthetic sales file (6,000 orders plus 15 rows repeating an order ID) drives most numbers; chart edge cases use the five files from Appendix C. Chromium only. Excel-sourced data, touch and screen readers were not tested. The 390px findings come from a viewport resize, not a phone.
- Budgets B4, B5, B11 and C1 are judgement calls; adjust them if a build lands close and the screen still reads clean. C1 (11px minimum on-screen chart text) is a legibility floor I chose, not a standard.
- C3 and C7 switch the first card to Scatter and read its default X and Y. They assume the sales file’s mix (an ID-like text column plus date columns), so on other data treat them as informational.
- The chart checks depend on class names (`.chart-card`, `.chart-canvas-wrap`, `.chart-host`). If those change, update the selectors at the top of the script.
- This spec targets a moving branch. Re-run Appendix A after each merge.

---

## Appendix A · `measure_post_import.py`

Run against any served build. Current result on `ux-batch` @ 59807c5: 1 pass, 20 fail. Timings vary by run (B12 measured 83–121ms across runs).
Needs `pip install playwright && playwright install chromium`. The script loads the CSV at two viewports and exercises the chart tab; it takes about a minute.

```
python measure_post_import.py http://localhost:4174/ sales_demo.csv
FAIL  B1  first data row top, 1440x900 (px)                      value=408          target <= 230
FAIL  B2  full rows visible, 1440x900                            value=17           target >= 22
FAIL  B3  full rows visible, 1280x720                            value=11           target >= 16
FAIL  B4  controls on landing view, 1440x900                     value=99           target <= 40
FAIL  B5  controls on Table tab, 1440x900                        value=99           target <= 70
FAIL  B6  landing tab is Overview                                value=None         target == Overview
FAIL  B7  stepper contains a View stage                          value=True         target == False
FAIL  B8  'N rows x M cols' stated on landing                    value=2            target <= 1
FAIL  B9  order_id is not typed Date                             value=Date         target != Date
FAIL  B10 chart canvas bottom, 1280x720 (px)                     value=838          target <= 720
FAIL  B11 controls above first plot, 1280x720                    value=23           target <= 8
PASS  B12 time to first chart canvas (ms)                        value=121          target <= 300
FAIL  B13 view switcher is a tablist of 3                        value=(False, 0)   target == (True, 3)
FAIL  C1  smallest on-screen chart text, default layout (px)     value=7            target >= 11
FAIL  C2  canvas width tracks card after layout change (px off)  value=552          target <= 2
FAIL  C3  axis labels clipped by the canvas edge (default scatter) value=4            target == 0
FAIL  C4  columns selected on a preset correlation card          value=0            target >= 2
FAIL  C5  Duplicate keeps column and title                       value=False        target == True
FAIL  C6  chart cards and titles survive a column delete         value=(1, False)   target == (3, True)
FAIL  C7  default scatter plots Date against Date                value=True         target == False
FAIL  C8  hovering a chart shows a tooltip (role=tooltip)        value=0            target >= 1
```

```python
#!/usr/bin/env python3
"""TurboFuzz post-import UX budgets.

Usage:  python measure_post_import.py http://localhost:4174/ sales_demo.csv
Needs:  pip install playwright && playwright install chromium
        a served build (npm run build && npx vite preview --port 4174)

Loads the CSV at two viewports, measures the landing view, the Table tab and
the Chart tab (B1-B13), then exercises the chart cards (C1-C8), and prints
PASS/FAIL per budget. Exit code 1 if any fail.

The C checks assume the sales_demo.csv schema from Appendix B (they use the
unit_price, revenue and customer_email columns). Selectors use aria-labels and
visible text where possible; update them if the markup changes.
"""
import re
import sys
import time

from playwright.sync_api import sync_playwright

URL, CSV = sys.argv[1], sys.argv[2]

# Records every canvas fillText call: font size and horizontal extent in CSS px.
TEXT_PROBE = """(() => { window.__txt = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y, m) {
    try {
      const px = parseFloat((this.font.match(/([\\d.]+)px/) || [])[1]);
      const w = this.measureText(String(t)).width, a = this.textAlign;
      const l = (a === 'right' || a === 'end') ? x - w : (a === 'center' ? x - w / 2 : x);
      window.__txt.push({ px, l, r: l + w, cw: this.canvas.clientWidth });
    } catch (e) {}
    return orig.call(this, t, x, y, m);
  };
})();"""

VISIBLE_CONTROLS = """() => {
  const vh = innerHeight, vw = innerWidth;
  return [...document.querySelectorAll('button,input,select,textarea,a[href],[role=button],summary')]
    .filter(e => { const b = e.getBoundingClientRect(), s = getComputedStyle(e);
      return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && !e.closest('.hidden')
        && b.top < vh && b.bottom > 0 && b.left < vw; }).length;
}"""

TABLE_GEOM = """() => {
  const row = document.querySelector('.table-host .tr');
  const b = row && row.getBoundingClientRect();
  return b ? { firstRowTop: Math.round(b.top), rowH: Math.round(b.height) } : null;
}"""

LANDING = """() => {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const sel = tabs.find(t => t.getAttribute('aria-selected') === 'true');
  const text = document.body.innerText;
  return {
    tablist: !!document.querySelector('[role=tablist]'),
    tabCount: tabs.length,
    selectedTab: sel ? sel.textContent.trim() : null,
    stepperHasView: [...document.querySelectorAll('.stepper-item')].some(e => e.dataset.stage === 'view'),
    summaryMentions: (text.match(/\\d[\\d,]*\\s*rows\\s*×\\s*\\d[\\d,]*\\s*col/gi) || []).length,
  };
}"""

COLUMN_TYPE = """(name) => {
  const th = [...document.querySelectorAll('.table-host .th')].find(e => e.textContent.includes(name));
  const t = th && th.querySelector('.th-type');
  if (!t) return null;
  return t.tagName === 'SELECT' ? t.selectedOptions[0].textContent.trim() : t.textContent.trim();
}"""

CHART_GEOM = """() => {
  const cv = [...document.querySelectorAll('.chart-host canvas')].find(e => e.getBoundingClientRect().width > 0);
  if (!cv) return null;
  const b = cv.getBoundingClientRect();
  const card = cv.closest('.chart-card');
  const above = card ? [...card.querySelectorAll('button,select,input')].filter(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom <= b.top; }).length : null;
  return { canvasBottom: Math.round(b.bottom), controlsAbovePlot: above };
}"""


def click_tab(page, name):
    """Click a view tab by label; works for role=tab and the legacy .view-tabs buttons."""
    tab = page.get_by_role("tab", name=re.compile(f"^{name}", re.I))
    if tab.count():
        tab.first.click()
        return True
    legacy = page.locator(".view-tabs button", has_text=re.compile(f"^{name}", re.I))
    if legacy.count():
        legacy.first.click()
        return True
    return False


def measure(browser, w, h):
    ctx = browser.new_context(viewport={"width": w, "height": h})
    ctx.add_init_script(TEXT_PROBE)
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_selector(".dropzone")
    page.set_input_files("input[type=file]", CSV)
    page.wait_for_selector(".workspace:not(.hidden)", timeout=20000)
    page.wait_for_timeout(1500)
    out = {"landing": page.evaluate(LANDING), "landingControls": page.evaluate(VISIBLE_CONTROLS)}
    click_tab(page, "Table")
    page.wait_for_selector(".table-host .tr", timeout=10000)
    page.wait_for_timeout(500)
    g = page.evaluate(TABLE_GEOM)
    out["firstRowTop"] = g["firstRowTop"]
    out["fullRows"] = (h - g["firstRowTop"]) // g["rowH"]
    out["tableControls"] = page.evaluate(VISIBLE_CONTROLS)
    out["orderIdType"] = page.evaluate(COLUMN_TYPE, "order_id")
    t0 = time.time()
    if click_tab(page, "Chart"):
        try:
            page.wait_for_selector(".chart-host:not(.hidden) canvas", timeout=15000)
            out["chartMs"] = round((time.time() - t0) * 1000)
            page.wait_for_timeout(800)
            out["chart"] = page.evaluate(CHART_GEOM)
        except Exception:
            out["chart"] = None
    ctx.close()
    return out



WRAP_DIFF = """() => Math.max(...[...document.querySelectorAll('.chart-card')].map(c => {
  const w = c.querySelector('.chart-canvas-wrap'), cv = c.querySelector('canvas'), cs = getComputedStyle(w);
  const inner = w.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return Math.abs(parseFloat(cv.style.width) - inner); }))"""

CARD_STATE = """() => [...document.querySelectorAll('.chart-card')].map(c => ({
  kind: c.querySelector('select[aria-label="Chart type"]').value,
  corr: [...c.querySelectorAll('select[multiple] option')].filter(o => o.selected).length,
  picker: (c.querySelector('select.chart-picker')?.selectedOptions[0]?.textContent || ''),
  xy: [...c.querySelectorAll('select.chart-picker')].filter(s => s.getBoundingClientRect().width > 0)
        .map(s => s.selectedOptions[0]?.textContent || ''),
  title: c.querySelector('.chart-title')?.value || '' }))"""


def open_chart_tab(browser, w=1440, h=900):
    ctx = browser.new_context(viewport={"width": w, "height": h})
    ctx.add_init_script(TEXT_PROBE)
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_selector(".dropzone")
    page.set_input_files("input[type=file]", CSV)
    page.wait_for_selector(".workspace:not(.hidden)", timeout=20000)
    page.wait_for_timeout(1200)
    page.evaluate("window.__txt = []")
    click_tab(page, "Chart")
    page.wait_for_selector(".chart-host:not(.hidden) canvas", timeout=15000)
    page.wait_for_timeout(900)
    return ctx, page


def measure_charts(browser):
    r = {}
    # C1, C2, C3, C7, C8 on one page
    ctx, page = open_chart_tab(browser)
    fonts = [t["px"] for t in page.evaluate("window.__txt.slice()") if t["px"]]
    r["minFont"] = min(fonts) if fonts else None
    box = page.locator(".chart-card canvas").first.bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.45, box["y"] + box["height"] * 0.6)
    page.wait_for_timeout(400)
    r["tooltips"] = page.locator("[role=tooltip]").count()
    page.click("text=+ Add chart")
    page.wait_for_timeout(500)
    diffs = []
    for n in ("1", "3"):
        page.select_option("select[aria-label='Charts per row']", n)
        page.wait_for_timeout(700)
        diffs.append(page.evaluate(WRAP_DIFF))
    r["layoutDiff"] = round(max(diffs), 1)
    page.select_option("select[aria-label='Charts per row']", "2")
    page.wait_for_timeout(400)
    page.evaluate("window.__txt = []")
    page.select_option(".chart-card >> nth=0 >> select[aria-label='Chart type']", "scatter")
    page.wait_for_timeout(800)
    txt = page.evaluate("window.__txt.slice()")
    r["clipped"] = sum(1 for t in txt if t["l"] < -0.5 or t["r"] > t["cw"] + 0.5)
    xy = page.evaluate(CARD_STATE)[0]["xy"]
    r["scatterXY"] = xy
    r["scatterBothDates"] = len(xy) >= 2 and all("(Date)" in v for v in xy[:2])
    ctx.close()

    # C4: preset correlation card
    ctx, page = open_chart_tab(browser)
    for _ in range(2):
        page.click("text=+ Add chart")
        page.wait_for_timeout(450)
    corr = [c for c in page.evaluate(CARD_STATE) if c["kind"] == "correlation"]
    r["presetCorr"] = corr[0]["corr"] if corr else None
    ctx.close()

    # C5: duplicate keeps column + title
    ctx, page = open_chart_tab(browser)
    val = page.evaluate("[...document.querySelector('.chart-card select.chart-picker').options].find(o => o.textContent.startsWith('revenue')).value")
    page.select_option(".chart-card >> nth=0 >> select.chart-picker", val)
    page.wait_for_timeout(300)
    page.fill(".chart-card >> nth=0 >> .chart-title", "Revenue spread")
    page.locator(".chart-card").first.locator("button:text-is('Duplicate')").click()
    page.wait_for_timeout(600)
    cards = page.evaluate(CARD_STATE)
    dup = cards[1] if len(cards) > 1 else {"picker": "", "title": ""}
    r["dupKept"] = dup["picker"].startswith("revenue") and dup["title"] == "Revenue spread"
    ctx.close()

    # C6: cards survive a column delete (a tracked transform)
    ctx, page = open_chart_tab(browser)
    for _ in range(2):
        page.click("text=+ Add chart")
        page.wait_for_timeout(400)
    page.fill(".chart-card >> nth=0 >> .chart-title", "Keep me")
    before = len(page.evaluate(CARD_STATE))
    click_tab(page, "Table")
    page.wait_for_selector(".table-host .tr", timeout=10000)
    page.locator(".table-host .th .del-btn").nth(9).click(force=True)
    page.wait_for_timeout(300)
    page.click("text=Delete selected")
    page.wait_for_timeout(400)
    page.locator(".modal button:text-is('Delete')").click()
    page.wait_for_timeout(1500)
    click_tab(page, "Chart")
    page.wait_for_timeout(900)
    after = page.evaluate(CARD_STATE)
    r["cardsBefore"], r["cardsAfter"] = before, len(after)
    r["titleKept"] = bool(after) and after[0]["title"] == "Keep me"
    ctx.close()
    return r

with sync_playwright() as p:
    browser = p.chromium.launch()
    desk = measure(browser, 1440, 900)
    lap = measure(browser, 1280, 720)
    ch = measure_charts(browser)
    browser.close()

chart_l = lap.get("chart") or {}
checks = [
    ("B1  first data row top, 1440x900 (px)", desk["firstRowTop"], "<=", 230),
    ("B2  full rows visible, 1440x900", desk["fullRows"], ">=", 22),
    ("B3  full rows visible, 1280x720", lap["fullRows"], ">=", 16),
    ("B4  controls on landing view, 1440x900", desk["landingControls"], "<=", 40),
    ("B5  controls on Table tab, 1440x900", desk["tableControls"], "<=", 70),
    ("B6  landing tab is Overview", desk["landing"]["selectedTab"], "==", "Overview"),
    ("B7  stepper contains a View stage", desk["landing"]["stepperHasView"], "==", False),
    ("B8  'N rows x M cols' stated on landing", desk["landing"]["summaryMentions"], "<=", 1),
    ("B9  order_id is not typed Date", desk["orderIdType"], "!=", "Date"),
    ("B10 chart canvas bottom, 1280x720 (px)", chart_l.get("canvasBottom"), "<=", 720),
    ("B11 controls above first plot, 1280x720", chart_l.get("controlsAbovePlot"), "<=", 8),
    ("B12 time to first chart canvas (ms)", desk.get("chartMs"), "<=", 300),
    ("B13 view switcher is a tablist of 3", (desk["landing"]["tablist"], desk["landing"]["tabCount"]), "==", (True, 3)),
    ("C1  smallest on-screen chart text, default layout (px)", ch["minFont"], ">=", 11),
    ("C2  canvas width tracks card after layout change (px off)", ch["layoutDiff"], "<=", 2),
    ("C3  axis labels clipped by the canvas edge (default scatter)", ch["clipped"], "==", 0),
    ("C4  columns selected on a preset correlation card", ch["presetCorr"], ">=", 2),
    ("C5  Duplicate keeps column and title", ch["dupKept"], "==", True),
    ("C6  chart cards and titles survive a column delete", (ch["cardsAfter"], ch["titleKept"]), "==", (ch["cardsBefore"], True)),
    ("C7  default scatter plots Date against Date", ch["scatterBothDates"], "==", False),
    ("C8  hovering a chart shows a tooltip (role=tooltip)", ch["tooltips"], ">=", 1),
]
ops = {"<=": lambda a, b: a <= b, ">=": lambda a, b: a >= b, "==": lambda a, b: a == b, "!=": lambda a, b: a != b}
failed = 0
for label, value, op, target in checks:
    ok = value is not None and ops[op](value, target)
    failed += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'}  {label:58s} value={value!s:12s} target {op} {target}")
sys.exit(1 if failed else 0)
```

## Appendix B · `make_sales_demo.py`

Generates the 6,015-row test file used for every number above.

Usage: `python make_sales_demo.py sales_demo.csv`

```python
import csv, random, datetime, sys
random.seed(7)
regions = ["Perth","Sydney","Melbourne","Brisbane","Adelaide","Hobart"]
products = [("Widget A","Hardware",19.9),("Widget B","Hardware",34.5),("Gizmo","Gadgets",89.0),("Gizmo Pro","Gadgets",149.0),("Cable","Accessories",7.5),("Dock","Accessories",59.0)]
out = sys.argv[1]
with open(out,"w",newline="") as f:
    w = csv.writer(f)
    w.writerow(["order_id","order_date","region","product","category","quantity","unit_price","discount_pct","revenue","customer_email","shipped","notes"])
    d0 = datetime.date(2025,1,1)
    for i in range(1,6001):
        p = random.choice(products)
        q = random.randint(1,12)
        disc = random.choice([0,0,0,5,10,15])
        rev = round(q*p[2]*(1-disc/100),2)
        email = f"user{random.randint(1,1800)}@example.com" if random.random()>0.04 else ""
        note = random.choice(["","","","gift","rush","backorder","N/A"])
        w.writerow([f"ORD-{i:05d}",(d0+datetime.timedelta(days=random.randint(0,420))).isoformat(),random.choice(regions),p[0],p[1],q,p[2],disc,rev,email,random.choice(["Y","N","Y","Y"]),note])
        if i%400==0:
            w.writerow([f"ORD-{i:05d}",(d0+datetime.timedelta(days=5)).isoformat(),"Perth",p[0],p[1],q,p[2],disc,rev,email,"Y",note])
```

## Appendix C · `gen_edge.py`

Generates the five edge-case files used in section 6: `text_only.csv` (no numeric, date or category column), `one_row.csv`, `degenerate.csv` (a constant column, an all-empty column), `wide.csv` (120 numeric columns) and `big.csv` (300,000 rows, `id` first).

Usage: save it as `gen_edge.py`, then `mkdir edge && cd edge && python ../gen_edge.py`. It writes the five files into the current directory.

```python
import csv, random, datetime, sys
random.seed(11)
D="."
# 1 text only
with open(f"{D}/text_only.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["full_name","email","comment"])
    for i in range(300): w.writerow([f"Person {i} Name{random.randint(0,99999)}", f"p{i}.{random.randint(0,99999)}@ex.com", f"free text comment number {i} {random.random()}"])
# 2 one row
with open(f"{D}/one_row.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["a","b","c"]); w.writerow([1,2.5,"x"])
# 3 wide
with open(f"{D}/wide.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow([f"metric_{i:03d}" for i in range(120)])
    for r in range(500): w.writerow([round(random.gauss(i,3),3) for i in range(120)])
# 4 degenerate numeric: constant + all-null + sentinel
with open(f"{D}/degenerate.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["const","allnull","val","grp"])
    for r in range(400): w.writerow([5,"",round(random.random()*100,2), random.choice(["a","b"])])
# 5 big
regions=["Perth","Sydney","Melbourne","Brisbane","Adelaide","Hobart"]
with open(f"{D}/big.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["id","ts","region","amount","qty","score","flag","cat"])
    t0=datetime.datetime(2024,1,1)
    for i in range(300000):
        w.writerow([i,(t0+datetime.timedelta(minutes=random.randint(0,600000))).strftime("%Y-%m-%d %H:%M:%S"),random.choice(regions),round(random.lognormvariate(4,1),2),random.randint(1,40),round(random.gauss(50,15),2),random.choice(["Y","N"]),f"c{random.randint(0,40)}"])
print("ok")
```
