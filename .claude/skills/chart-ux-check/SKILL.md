---
name: chart-ux-check
description: Walk the Charts page end to end the way a person does (pick fields, choose a type, change the finished chart, group dates by month or weekday, change settings and undo, filter, export, save and reopen the workspace) over seven shapes of data, check the drawn numbers against the source rows, and report what broke. Use after any change to chart code (src/ui/chart-*.ts, chart-builder, the add panel, the field rail, aggregate drawing), when the owner asks to test charts or chart UX, or before committing chart work.
---

# Chart UX check

The Charts page matters most from start to finish: picking fields, choosing a chart, and changing it
afterwards must never lose what the analyst picked, never draw blank, never chart fields nobody
picked, and never draw a wrong number. This skill runs a scripted walkthrough and reports
FAIL / WARN / INFO findings.

## Run it

1. The app must be running at http://127.0.0.1:4173. Check with a quick fetch; if it is not up,
   start it in the background: `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`.
   Never run `npm ci` while it runs.
2. Run the check (one headless browser, one pass, about three minutes):
   `node .claude/skills/chart-ux-check/check.cjs`
   - `--only <dataset>` runs one data shape; `--skip a,b` leaves some out. Shapes:
     sales-over-time, categories-only, wide, messy-datetimes, one-column, dirty-missing,
     big-high-cardinality (200k rows, about 25 s on its own).
   - `--out <dir>` changes where the report and screenshots go (default `test-results/chart-ux`,
     which git ignores).
   - `CHART_UX_VERBOSE=1` prints each step as it runs (find where a run stalls).
3. Read `test-results/chart-ux/report.md` and look at the screenshots it names, especially the
   first chart and the weekday bars, in light and dark. A run that stops on its own saves
   `<dataset>-stopped.png`.

Exit code: 0 when there are no FAILs, 1 on any FAIL, 2 when the app is not running.

## What it checks, per data shape

- **Field list.** Every column is listed once, grouped by kind (dates, categories, numbers, text,
  identifiers).
- **Field search.** A typo finds the field, and Enter puts it on the shelf and clears the box.
- **Every pick set × every chart type** in Add a chart:
  - each picked field lands on the chart wherever the type has a free slot for it (the "fields
    vanish" bug); a field with over 100 values is not expected to colour or group;
  - fields nobody picked are flagged, with the slot they took;
  - the canvas actually draws, and the note has no "no groups", "could not", "Pick a numeric
    measure", NaN or undefined; more than 500 groups is flagged;
  - a type that fits none of the picks says so instead of drawing (`refuse` lists cases that must);
  - each chart draws inside a time budget (1.5 s, 4 s for the 200k-row shape).
- **Labels on the canvas.** Every `fillText` on a chart canvas is recorded with its box: a label
  cut off at the canvas edge FAILs; labels drawn over each other WARN.
- **A new chart starts with an empty shelf.**
- **Changing the type** of a finished chart (line, bar, scatter, histogram, box) keeps the fields
  that have a place.
- **The numbers.** Bars of a category, through "Download data (CSV)", against sum, mean and count
  worked out from the CSV rows themselves; counts for categories alone; a top N's "Other" against
  the groups it left out; groups the data does not have.
- **Bars of a date** by month and by repeating parts (weekday = 7 bars, hour = 24, month of year
  = 12; one more for rows without a date), with the weekday/hour/month sums checked against the
  rows, and no engine code ("dow") in the note.
- **Settings and Undo.** Aggregate → Median, Sort → Label Z-A (labels read Z to A), Group by,
  Calc → Cumulative, Value → Count of rows: each changes the chart, then Undo puts back the
  setting, the note and the fields.
- **Filters.** A value ticked in the Filters sidebar changes the chart's numbers to the filtered
  rows; "Also respect table filters" off shows every row again; All clears it.
- **Exports.** The PNG (through its size menu) is a real image of a sensible size; the data CSV
  has no NaN or undefined.
- **Workspace.** Save workspace, reload, open it, load the same data: the same chart tabs come
  back, with the same numbers.
- **Layout.** At 1280×720 and 1440×900 the plot is on screen and tall enough, the page never
  scrolls sideways, and the label check read the canvas.
- **Axes**: on a bar chart, a Y range of 0 to 1 with a tick every 0.25 draws those ticks; on a line
  over dates, the X range takes dates and an X min in the middle of the data changes the chart.
  Each must change the chart, be accepted without an error message, and come back exactly with
  Reset axes.
- **Hover** on every chart drawn: a pointer sweep over the plot (then the drawn dots, for a sparse
  scatter) must show a tooltip, with no NaN or undefined in it.
- **Top bars stay in view**: the app's tabs, the chart tabs and the chart's own bar (title, Undo,
  type, settings, export) are on screen, not hidden and not covered, both as drawn and after
  scrolling the page to the bottom; checked on every chart and at 1280×720 and 1440×900.
- **Dark mode** still draws.
- **Console errors** on any step.

## After a run

- Every FAIL is a bug: fix it, then add the case as a permanent Playwright test (the
  `test/e2e/chart-picks.spec.ts` style), so it never comes back.
- WARNs are judgement calls: mention them to the owner with the screenshot. The known ones: a
  scatter with one number picked borrows another (or a date across), and a second category has
  no place once the single Colour is taken.
- INFO lines (a field with no place on that type, a refused type, timings, PNG size) are expected
  behaviour; read them only when something looks off.
- A FAIL can be the check's own mistake (a selector that moved): confirm in the screenshot before
  changing the app.
- When a new chart type, slot, setting or data shape is added, add it to `DATASETS` or the checks
  in `check.cjs`, so the walkthrough keeps covering the whole page.
