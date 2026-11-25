---
name: chart-ux-check
description: Walk the Charts page end to end the way a person does (pick fields, choose a type, change the finished chart, group dates by month or weekday) over several shapes of data, and report what broke. Use after any change to chart code (src/ui/chart-*.ts, chart-builder, the add panel, the field rail, aggregate drawing), when the owner asks to test charts or chart UX, or before committing chart work.
---

# Chart UX check

The Charts page matters most from start to finish: picking fields, choosing a chart, and changing it
afterwards must never lose what the analyst picked, never draw blank, and never chart fields
nobody picked. This skill runs a scripted walkthrough and reports FAIL / WARN / INFO findings.

## Run it

1. The app must be running at http://127.0.0.1:4173. Check with a quick fetch; if it is not up,
   start it in the background: `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`.
   Never run `npm ci` while it runs.
2. Run the check (one headless browser, one pass, about a minute):
   `node .claude/skills/chart-ux-check/check.cjs`
   - `--only <dataset>` runs one data shape (sales-over-time, categories-only, wide,
     messy-datetimes, one-column).
   - `--out <dir>` changes where the report and screenshots go (default `test-results/chart-ux`,
     which git ignores).
3. Read `test-results/chart-ux/report.md` and look at the screenshots it names, especially the
   first chart and the weekday bars, in light and dark.

Exit code: 0 when there are no FAILs, 1 on any FAIL, 2 when the app is not running.

## What it checks, per data shape

- **Field list.** Every column is listed once, grouped by kind (dates, categories, numbers, text,
  identifiers).
- **Field search.** A typo finds the field, and Enter puts it on the shelf and clears the box.
- **Every pick set × every chart type** in Add a chart:
  - each picked field lands on the chart wherever the type has a free slot for it (the "fields
    vanish" bug);
  - fields nobody picked are flagged;
  - the canvas actually draws, and the note has no "no groups" or "could not" text;
  - a type that fits none of the picks says so instead of drawing.
- **A new chart starts with an empty shelf.**
- **Changing the type** of a finished chart (line, bar, scatter, histogram, box) keeps the fields
  that have a place.
- **Bars of a date** by month and by repeating parts (weekday = 7 bars, hour = 24, month of year
  = 12).
- **Layout.** At 1280×720 and 1440×900 the plot is on screen and tall enough, and the page never
  scrolls sideways.
- **Dark mode** still draws.
- **Console errors** on any step.

## After a run

- Every FAIL is a bug: fix it, then add the case as a permanent Playwright test (the
  `test/e2e/chart-picks.spec.ts` style), so it never comes back.
- WARNs are judgement calls: mention them to the owner with the screenshot.
- INFO lines (a field with no place on that type, a refused type) are expected behaviour; read them
  only when something looks off.
- When a new chart type, slot or data shape is added, add it to `DATASETS` or the checks in
  `check.cjs`, so the walkthrough keeps covering the whole page.
