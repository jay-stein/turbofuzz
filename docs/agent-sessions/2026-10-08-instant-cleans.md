# 2026-10-08 - Instant fast-path cleans with undo toast

## Goal

Reduce friction in the clean/transform flow. The panel flow required
"Add operation" and then "Apply to column"; the user asked for one-click fast
paths for simple operations while keeping the multi-click flow for involved
ones (e.g. melt). Options A–D were presented; the user picked **C**:
instant one-click fast paths for parameter-free operations.

Branch: `agent/ux-batch`.

## What shipped

- **Instant cleans from the column menu** (no panel):
  Trim whitespace, UPPERCASE, lowercase, Title Case, Convert to number
  (column's detected locale), Convert to date (column's detected order) and
  Escape formula-like cells. Each applies immediately and is logged as a
  normal clean step in the Process Log.
- **Undo toast.** A single transient toast ("Trim whitespace applied to
  'fruit'") with Undo and dismiss; toast auto-hides after 6 s. Undo removes
  the exact op it added (matched by content, last occurrence) and re-applies
  the column.
- **Configurable operations keep the panel flow** with the column and
  operation preselected: Find & replace, Clean values…, Missing values… and
  all Transform entries (round, group by, impute, KNN, melt, split, combine
  date/time, dedupe, transform dataset).
- Menu items that apply instantly are bold with a tooltip noting the Undo
  toast; help and next_steps updated.

## Files changed

- `src/ui/app.ts`: `applyQuickClean` (with content-matched undo),
  `showToast`, instant menu entries, `addItem({ instant })`.
- `src/styles.css`: `.toast`, `.toast-undo`, `.toast-close`,
  `.context-item.instant`.
- `src/ui/help-content.ts`, `next_steps.md`.

## Commands executed

```
npm run typecheck   # clean
npm test            # 318 tests, 318 pass
npm run build       # tsc + vite build, clean
npx wrangler deploy # vd09690af
```

## Decisions / notes

- Instant applies still create ordinary clean steps, so batch grouping,
  reordering and the pandas recipe behave the same.
- Undo matches the appended op by JSON content (last occurrence), so it is
  robust to other ops added after it; clicking Undo before the worker commit
  returns is a harmless no-op.
- Only one toast is shown at a time (a new instant action replaces it).

## Deploy

- Commit `ce11a13` on `agent/ux-batch`.
- Live: https://turbofuzz.mrjaystein.workers.dev
- Version ID: `d09690af-9406-46b0-a54f-518396af26c0`.
- Verified the served HTML references `index-DPSHlFNE.js`.
