# 2026-10-08 - UX batch: shuffle, export subset, split transform, rename/resize, tiles

## Goal

Work through the user's feedback list:

1. Shuffle should only shuffle all rows (drop the row-count input).
2. Export should offer an optional first-N subset (N default 1000), defaulting
   to all rows.
3. Add a column-splitting transform — after clarifying questions, the user
   wanted pandas `str.split` semantics into **new columns** (not row explode),
   to be named "Split a column".
4. Update the user guide and docs for the new function.
5. Rename a column manually via right-click.
6. Reinstate column resizing.
7. Bring back the Data QA profile tiles (mini category/top-value visuals).
8. Log a Great Tables-style custom view ("Slick Tables") as a future idea.

Branch: `agent/ux-batch` (work was initially committed on `agent/combine-datetime`
by mistake and moved with `git branch agent/ux-batch` + `git branch -f
agent/combine-datetime 34bab72`; nothing was pushed in between).

## Explode clarification (asked before implementing)

The questions established:

- Layout: the user expected **new columns** (text-to-columns), not pandas
  explode into rows.
- Arity: auto — the number of new columns follows the largest part count
  across rows (capped at 50).
- Regex: capture groups become the parts; without groups, split on matches.
- One column per step.

Final shape: a **Split a column** transform (`splitColumn`) rather than
"explode".

## What shipped

- **Shuffle all.** The count input and suffix are gone; the button always
  randomises every row. The worker still accepts `limit` (kept for tests and
  future use).
- **Export subset.** The export dialog now has "Rows to include": All rows
  (default) or First N (number input, default 1,000, applies to the chosen
  scope in display order). Chunked streaming stops at N, and the status line
  reports "first N of M" when a subset was written.
- **Split a column** (`src/data/split-column.ts`): pandas
  `str.split(expand=True)` into `prefix_1..prefix_n`; text delimiter or simple
  regex; trim; drop empty parts (default on); remove original (optional);
  unique names; 50-column cap with a clear error; blank cells stay blank; row
  count and other columns unchanged. The transform preview now returns the
  resulting `columnNames`, and the panel uses them so later steps/chained
  pickers see the real columns. Pandas recipe emits `str.split(..., expand=True)`
  + `str.extract` for regex, with optional `df.drop`.
- **Rename via right-click.** New `openPrompt` modal in `dialog.ts`; the column
  context menu gained "Rename column…" which reuses the header-rename path.
- **Column resize.** Widths are now preserved across column reloads by name
  (previously every `setColumns` reset them, which read as "lost resize"), the
  grip is wider with a visible divider and `touch-action: none`, and
  double-click still resets to the default width.
- **Profile tiles.** The Data QA strip starts **expanded** (histograms,
  top-value bars, length stats visible) and remembers the collapsed/expanded
  choice in `localStorage`.
- **Docs.** README features list, in-app Help (shuffle, export subset, split,
  rename/resize, tiles), and `next_steps.md` (Split column + a Great Tables
  "Slick Tables" view idea with Table / Chart / Slick Tables tabs).

## Files changed

- `src/data/split-column.ts` (new), `src/data/transform-ops.ts`,
  `src/data/recipe.ts`.
- `src/ui/app.ts` (shuffle, export limit plumbing, rename menu),
  `src/ui/dialog.ts` (`openPrompt`), `src/ui/export-panel.ts`,
  `src/ui/transform-panel.ts` (Split builder + preview-driven schema),
  `src/ui/table.ts`, `src/ui/summary-band.ts`, `src/ui/help-content.ts`,
  `src/styles.css`.
- `src/worker/protocol.ts` (preview `columnNames`), `src/worker/search.worker.ts`.
- `README.md`, `next_steps.md`.
- Tests: `test/split-column.test.ts` (new), `test/export-panel.test.ts`.

## Commands executed

```
npm run typecheck   # clean
npm test            # 310 tests, 310 pass
npm run build       # tsc + vite build, clean
npx wrangler deploy # v1ab17c0f, 5 assets uploaded
```

## Deploy

- Commit `d8e6712` on `agent/ux-batch`.
- Live: https://turbofuzz.mrjaystein.workers.dev
- Version ID: `1ab17c0f-cbe7-4b7f-8d9e-2ea1776bb084`.
- Verified the served HTML references `index-DDs3fs9e.js`.

## Notes / still open

- The Great Tables view is logged as a future idea, not implemented.
- A combined row-explode (one row per part) remains available as a future op
  if wanted; only the column split shipped in this batch.
