# TurboFuzz — Aesthetic Polish Spec

**For:** Claude Code, working in `jay-stein/turbofuzz`
**Scope:** visual design only. No change to parsing, cleaning, transform or chart logic. Two small UI-text bugs are included because they are visible (P0-5, P1-5).
**Source of findings:** live review of https://turbofuzz.mrjaystein.workers.dev/ on 2026-10-27 using four datasets (see `turbofuzz-test-data.js`), at a 622px pane, an emulated 1440x900 laptop, an emulated 375px phone, and dark and light themes.

Selectors below come from the live DOM (`header.topbar`, `.nav-row`, `.view-tabs`, `.workspace-body`, `main.results`, `.table-header`, `.table-rows`, `.charts-panel`, `.hint-callout`). I have not read the source, so locate each in the repo before editing.

---

## 1. Design intent

TurboFuzz is a rapid, low-latency, in-browser analysis tool. The interface should feel like a precision instrument: calm, dense, and instant.

1. **Data first.** Chrome (header, tabs, toolbars) stays small so the data gets most of the screen. Target: at 1440x900 the data area is at least 85% of viewport height; at 1024x768 at least 75%.
2. **One primary action per view.** One solid accent button visible at a time. Everything else is secondary or ghost.
3. **Quiet by default, loud when it matters.** Warning amber and error red appear only for real data issues, never as decoration or as the default chart colour.
4. **Zero-cost visuals.** No web fonts, no blur or backdrop-filter, no large shadows, no animation over 120ms. This keeps the "0 network requests, instant" promise visible and measurable.
5. **No layout shift.** Anything that loads or scans reserves its space first.
6. **Laptop first, phone compliant.** Design at 1280-1440px. At narrow widths nothing may overflow or wrap unevenly, and the data area must stay usable.

---

## 2. Findings (evidence)

| ID | Finding | Evidence |
|----|---------|----------|
| F1 | Chrome balloons below ~900px wide | 622px: `topbar` 135 + `.nav-row` 171 = 306px of 691 (44%). 375px: 183 + 188 = 371px of 942 (39%). At 1440x900 it is fine: 57 + 38 = 95px (11%). |
| F2 | Quick-fix chips wrap to 3 rows and sit in the sticky area | Dataset B at 622px: Table view shows only 1-2 data rows; at 375px only a sliver of the grid. Data Quality card is pushed to the bottom third. |
| F3 | Tab bar looks unstyled in dark theme | `.view-tabs button`: bg `rgb(107,107,107)`, white text, `border-radius: 0`, 25px tall. Light theme looks fine; dark is the outlier. |
| F4 | Tabs break on phone | 375px: tab strip is wider than the viewport (layout viewport grows to 435px); "Data Quality" and "Pivot View" wrap to 2 lines (43px) while others are 25px. |
| F5 | Table header is very tall | `.table-header` is 174px (of a 729px table area at 1440x900). It shows an inline type switcher (Text, Category, Integer, Number, Date, Date & time, Time) plus issue badges in every column. |
| F6 | Too many font sizes, some too small | Table view of dataset B uses 9 sizes: 28, 16, 15, 14, 12.5, 12, 11, 10.5, 9.5px. 73 elements at 10.5px and 10 at 9.5px. Contrast is fine (see 3.1); size is the problem. |
| F7 | Primary button used four times | Solid accent on Export, Stats report, Explore the table, + Add chart, Load pasted data. |
| F8 | Button sizes inconsistent and heavy | At 622px: header buttons 40px tall with 12.5px text, "Clear data" 40px with 14px text, "Focus" on the chart card is a larger icon-over-label button, tabs 25px. |
| F9 | Charts default to red | Histogram bars and time-series area render in `--danger` red. Red already means "problem" in the Overview and Quality views. |
| F10 | Chart card is cramped | Time-series plot area is about 100px tall at 622px; card title ("order_date") scrolls under the sticky toolbar; subtitle truncated ("300 disti…"). |
| F11 | Stat tiles leave an orphan | Overview uses a 3-column grid; the 4th tile (A) or 4th and 5th (B) wrap onto a second row. Warning tiles use a full amber fill, which is heavy when four are warnings (dataset B). |
| F12 | Tips toast collides with the UI | `.hint-callout` (320x54, bottom-left) sits over the footer controls and the Data Quality card, stays across tabs and datasets, and shows "Placeholder text like N/A…" on datasets with no placeholders (A, C). |
| F13 | Stale status text | After loading data the footer still reads "Data cleared — load a file to start again" (seen on datasets A and B). |
| F14 | Long column names truncate with end-ellipsis | Dataset D: all 60 `feature_NN_measurement_value` names are truncated on the Overview tiles (3-column grid, fixed ~187px tiles); the suffix is hidden. |
| F15 | Outliers tab loading state | Opens on "Scanning… your results appear here in a moment" with no spinner or reserved space. |
| F16 | Relationships matrix is visually loud | Saturated orange and red cell fills with tiny letter labels. Only lightly reviewed. |

**Passes (do not change):** WCAG contrast is fine everywhere measured (3.1). The Overview column tiles with mini-histograms, the chart-type picture-tile picker, the DQ score ring, the 28px row height (12.5px text), and the light theme are all good.

**Not reviewed:** focus rings and keyboard order, Export dialog, Recipe panel, command palette, Help, Outliers detail view, Relationships network view, chart types other than Histogram and Time series, loading feedback during the 4s parse of dataset C.

---

## 3. Design tokens

Keep the existing palette and `--radius`; add the missing scales. All values go in `:root` (and the dark and light overrides where noted).

### 3.1 Colour (existing, verified contrast on dark theme)

| Role | Token | Value | Contrast |
|------|-------|-------|----------|
| Page | `--bg` | `#10151c` | |
| Panel | `--panel` | `#161d26` | |
| Panel raised | `--panel-2` | `#1d2530` | |
| Border | `--border` / `--border-subtle` | `#2c3745` / `#222b36` | |
| Text | `--text` | `#e7ecf2` | 14.3:1 on panel |
| Text dim | `--text-dim` | `#93a1b1` | 6.4:1 on panel |
| Accent | `--accent` | `#60a5fa` | 6.7:1 on panel |
| On accent | `--on-accent` | `#0b1220` | 7.4:1 on accent |
| Danger | `--danger` | `#f97066` | 6.1:1 on panel |
| Warn | `--qa-warn` | `#fbbf24` | 7.9:1 on `--qa-warn-soft` |
| OK | `--ok` | `#4ade80` | |

Add these (derive light-theme equivalents from the existing light values):

```css
--tab-fg:        var(--text-dim);
--tab-fg-active: var(--text);
--tab-indicator: var(--accent);
--tab-hover-bg:  color-mix(in srgb, var(--text) 6%, transparent);
--chart-1: var(--accent);                 /* default single series */
--chart-2: #a78bfa; --chart-3: #34d399; --chart-4: #f59e0b;
--chart-5: #f472b6; --chart-6: #22d3ee;   /* categorical, validated for dark; check light */
--chart-flag: var(--danger);              /* ONLY for flagged/outlier marks */
--focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
```

### 3.2 Type

Keep the system font stack (zero load cost, matches the "nothing leaves this tab" promise). Revised from my first-pass note, which suggested a custom typeface: a web font would add a network request and a flash on first paint. If you want a brand face later, bundle one subset variable woff2 and use `font-display: swap`.

```css
--font-ui:   system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;

--fs-xs:  11px;   /* captions, badges, minimum anywhere */
--fs-sm:  12px;   /* meta, secondary labels */
--fs-md:  13px;   /* default UI + table cells */
--fs-lg:  14px;   /* section labels, dialog body */
--fs-xl:  16px;   /* card titles, dialog titles */
--fs-2xl: 20px;   /* page/pivot titles (replaces 28px) */
```

Rules:
- Replace 9.5px and 10.5px with `--fs-xs`; 12.5px with `--fs-md`; 15px with `--fs-lg`; 28px with `--fs-2xl`.
- Numerics (table cells, stat tiles, axis labels, DQ score): `font-variant-numeric: tabular-nums;`.
- Weights: 400 body, 600 labels and headings. Nothing heavier.

### 3.3 Space, size, radius, motion

```css
--sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px;

--control-h:        32px;   /* buttons, inputs, selects on pointer: fine */
--control-h-coarse: 40px;   /* @media (pointer: coarse) */
--tab-h:            36px;

--radius-sm: 6px;   /* chips, badges, inputs */
--radius:   10px;   /* cards, dialogs (existing) */
--radius-lg: 10px;  /* unchanged; do not add a bigger one */

--shadow-pop: 0 8px 24px #00000059;   /* dialogs/popovers only; cards get none */
--ease: cubic-bezier(.2,0,0,1);
--dur-fast: 80ms; --dur: 120ms;       /* max for any transition */
```

---

## 4. Work items

Order is by impact. Each item lists the change and how to verify it.

### P0 — Do first

**P0-1 Replace the tab bar (F3, F4)**
- Underline style: `.view-tabs` is a transparent row on `--panel`; each tab is `--tab-h` (36px) high, `--fs-md`, `--tab-fg`; active tab uses `--tab-fg-active` with a 2px `--tab-indicator` bottom border; hover uses `--tab-hover-bg`. No grey fill, no 0px-radius segmented box.
- Below 900px: `overflow-x: auto; white-space: nowrap; scrollbar-width: none;` with `scroll-snap-type: x proximity`. All tabs the same height, never wrapping. Scroll the active tab into view on change.
- Number hints (1-7) stay in tooltips, not in the label.
- Accept: at 375, 622, 1024 and 1440px all tabs are 36px (40px coarse) tall, no tab text wraps, `document.documentElement.scrollWidth <= innerWidth`.

**P0-2 Compact, single-row app chrome (F1, F8)**
- ≥1024px: `header.topbar` is one 48px row: brand | dataset chip (`Pasted data · 730 × 6`) | command bar (flex-grow, max 520px) | DQ badge | Theme | Help | New data. Move **Clear data** into the dataset chip's menu or rename to a ghost "New data" aligned right. The dataset chip is not a separate row.
- ≥900px: put `Convert types`, `Recipe` and `Export…` on the right end of the tabs row, so topbar + tabs = 84px total.
- <900px: topbar 48px (brand, command-bar icon button, overflow menu with Theme/Help/New data). Tabs row 36px with the three actions collapsed into one `Actions ▾` button at the right.
- All buttons use `--control-h` (32px), `--fs-md`, `--radius-sm`. The Focus button on charts becomes a 32px icon button with tooltip, not icon-over-label.
- Accept (`header.topbar` + `.nav-row` heights): ≤96px at 1440x900 and 1024x768; ≤96px at 622px; ≤100px at 375px. Data area (`.workspace-body`) ≥85% of viewport height at 1440x900, ≥75% at 622px width x 691px.

**P0-3 Chips: one row, never wrap (F2)**
- The quick-fix chip strip (View duplicates · 40, Fix: Remove duplicates…, View placeholders · 382, …) becomes a single 32px row, `overflow-x: auto`, with a fade on the right edge. Each "View X · n" / "Fix: X…" pair collapses to one chip: label = issue and count, click = view, a small `Fix ▾` split segment = fix.
- The strip is not part of the sticky region; it scrolls away with the content. Only the tab row stays sticky.
- Accept: dataset B at 622px: table grid visible height ≥ 250px; at 1440x900 ≥ 640px, which is at least 22 rows at 28px.

**P0-4 Table header diet (F5)**
- Default column header: name + a 12px type glyph, 36px tall, with a quiet issue dot (amber) if the column has issues. Everything else moves behind interaction:
  - Type switcher: click the type glyph, popover with the type list.
  - "View off-pattern · 155", "View empty cells · 92", "Fix: empty cells…": in the column's `⋯` menu, plus a 20px badge strip only when a column has issues (shows count, one line, truncates).
- Header total height ≤ 64px with issues badge, ≤ 40px without.
- Accept: dataset B at 1440x900: `.table-header` ≤ 64px; rows region ≥ 660px (currently 555px).

**P0-5 Chart colour and sizing (F9, F10)**
- Default series colour `--chart-1` (accent). `--chart-flag` red only for outlier/flagged marks, with a legend entry.
- Chart card: `min-height: 320px`; plot area ≥ 220px tall at 1440x900. Card title uses `scroll-margin-top` equal to the sticky chrome height so it never hides under the toolbar. Subtitle wraps to two lines max, with the full text in `title`.
- Time-series area: line 2px in `--chart-1`, fill `color-mix(in srgb, var(--chart-1) 14%, transparent)`.
- Accept: no chart on any dataset renders red unless it is a flagged-values series; titles are fully visible after scrolling to a chart.

### P1 — Next

**P1-1 One primary button per view (F7)**
- Primary (solid accent): Overview → `Explore the table →`; Table → none; Pivot → `+ Add view` (or equivalent); Chart → `+ Add chart`; Import → `Load pasted data`.
- `Export…` and `Stats report` become secondary (1px border, transparent). Disabled buttons (e.g. Recipe with no steps) show a tooltip stating why.

**P1-2 Type scale cleanup (F6)** — apply 3.2. Add a CI/lint check or a test that fails if any computed `font-size` below 11px exists.

**P1-3 Stat tiles and warning treatment (F11)**
- Grid: `repeat(auto-fit, minmax(150px, 1fr))` so 4-6 tiles share rows evenly.
- Neutral tile (`--panel`) with a 3px left border in `--qa-warn` / `--danger` and the number coloured to match, instead of a full amber fill. Zero-issue tiles stay neutral with the number in `--text`.

**P1-4 Toasts and hints (F12)**
- At most one visible; bottom-right, 16px inset; never over the footer actions. Show each hint once (persist in `localStorage`, try/catch), auto-dismiss after 6s, and only when relevant (placeholder hint only when placeholders > 0).
- Keep a "Tips" entry in Help to re-read them.

**P1-5 Stale footer status (F13)** — clear or replace the "Data cleared — load a file to start again" message when a dataset loads. Footer shows `730 rows · <1 ms` plus the latest action only.

**P1-6 Column tiles (F14)** — grid `repeat(auto-fill, minmax(200px, 1fr))`; names use middle ellipsis (keep the start and the last 6 characters) with the full name in `title`. Tile height stays uniform.

**P1-7 Outliers loading state (F15)** — reserve the three-step panel height, show a 2px indeterminate progress bar under the tab row, and replace "Scanning…" text with a skeleton block. Never change height when results arrive.

### P2 — Polish

- **P2-1 Relationships matrix (F16):** magnitude on a single-hue sequential ramp from `--chart-1`; diverge (blue to red) only for signed correlation, with a visible legend. Cell labels ≥ 11px.
- **P2-2 Focus and hover states:** every interactive element gets `--focus-ring` on `:focus-visible`, hover = `color-mix(in srgb, var(--text) 6%, transparent)`, pressed = 10%. No outline removal without a replacement.
- **P2-3 Pivot titles:** 28px title ("Sum of units by region") becomes `--fs-2xl`; edit/collapse/close controls become 28px ghost icon buttons aligned on one baseline.
- **P2-4 Empty states:** the import card and each tab's empty state use one illustration-free layout: 16px title, 13px dim body, one primary button.
- **P2-5 Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables the 120ms transitions and the chart highlight pulse.

---

## 5. Responsive rules

| Width | Layout |
|-------|--------|
| ≥1280 | Full topbar (48px) and tabs row (36px) with actions right-aligned; filter panel docked left (collapsible); data area ≥85% of height. |
| 900-1279 | Same, filter panel collapsed to a 36px rail by default. |
| 600-899 | Topbar 48px with overflow menu; tabs row scrollable with `Actions ▾`; filters open as a drawer, not inline. |
| <600 (phone) | Same as 600-899; tab strip scrolls horizontally; chip strip scrolls; dialogs are full-width sheets with 16px gutters; tap targets 40px. |

Do not add a separate mobile layout. These are the same components with the overflow rules above.

---

## 6. Verification

Load the datasets with `turbofuzz-test-data.js` (`TF_TEST.load('A'|'B'|'C'|'D')`), then check at each viewport in dark and light.

**Measurement checks (run in the page console or Playwright):**

```js
const h = s => { const e = document.querySelector(s); return e && Math.round(e.getBoundingClientRect().height); };
({ topbar: h('header.topbar'), navRow: h('.nav-row'), body: h('.workspace-body'),
   tableHeader: h('.table-header'), vh: innerHeight,
   hOverflow: document.documentElement.scrollWidth > innerWidth,
   minFont: Math.min(...[...document.querySelectorAll('body *')]
     .filter(e => e.getBoundingClientRect().height && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
     .map(e => parseFloat(getComputedStyle(e).fontSize))),
   tabHeights: [...document.querySelectorAll('.view-tabs button')].map(b => Math.round(b.getBoundingClientRect().height)) });
```

**Targets**

| Check | Viewport | Dataset | Target (baseline today) |
|-------|----------|---------|-------------------------|
| topbar + nav-row | 1440x900 | any | ≤ 96px (95) |
| topbar + nav-row | 622x691 | any | ≤ 96px (306) |
| topbar + nav-row | 375x812 | any | ≤ 100px (371) |
| `.workspace-body` share of height | 1440x900 | B | ≥ 85% (90%) |
| `.table-header` | 1440x900 | B | ≤ 64px (174) |
| Data rows visible | 1440x900 | B | ≥ 23 rows at 28px (about 19 today, limited by the 174px header) |
| Visible table rows | 622x691 | B | ≥ 8 rows (1-2) |
| Smallest font | any | any | ≥ 11px (9.5) |
| Distinct font sizes | any | any | ≤ 6 (9) |
| Tab heights | 375 / 622 / 1440 | any | all equal, 36px (25 or 43 on phone) |
| Horizontal page scroll | 375 | B | none (present) |
| Red chart series | 1440x900 | A: Histogram of `revenue`, Time series | none unless flagged series |
| Parse-and-render time | 1440x900 | C | no regression from 4007 ms; UI shows loading feedback |

**Reference dataset results** (regression baseline; all measured 2026-10-27):

| Dataset | Rows x cols | Size | Reported time | Observed |
|---------|-------------|------|---------------|----------|
| A time series | 730 x 6 | 25.6 KB | 24 ms | Orders & transactions 70%, DQ 100.0, 2 outlier rows |
| B messy customers | 1,240 x 9 | 102.8 KB | 42 ms | DQ 95.4, 40 duplicates, 382 placeholders, 15 outlier rows, 6 of 9 columns with empties, 11 issues |
| C 250k trips | 250,000 x 9 | 12.1 MB | 4007 ms | Event / activity log 95%, DQ 100.0 |
| D wide ML | 3,000 x 71 | 1.5 MB | 954 ms | ML dataset 95%, DQ 99.0, 60 of 71 columns with empties, 61 issues |

Screenshot each tab (Overview, Data Quality, Table, Pivot View, Outliers, Relationships, Chart) per dataset at 1440x900 dark, 1440x900 light and 375x812 dark before and after, and compare.

---

## 7. Non-aesthetic observations (for a separate pass)

These are not part of this spec but surfaced during testing:

1. **Inconsistent outlier messaging.** On the 300-row sample, Overview said "No duplicates, no empty cells, no outliers" while the Outliers tab reported "4 unusual rows found".
2. **Dataset B classification.** A customer table (`customer_id`, `full_name`, `email`, `signup_date`, `phone`) was labelled "Event / activity log · 80%" because 43% of timestamps were distinct; "Customer records" would be the better label.
3. **Time-series chart default.** It plots "Rows per week" (a count) and does not ask for a measure such as `revenue`.
4. **Parse speed.** 12 MB took 4.0s and 1.5 MB at 71 columns took 0.95s; the wide case is slower per byte. Worth profiling against the low-latency goal.
5. **Case-variant categories.** `ACTIVE`, `Active` and `active` (and `Sydney`, `sydney`, `SYDNEY`, `Melb.`) show as separate categories on the Overview tiles; a "merge case variants" suggestion would help.
