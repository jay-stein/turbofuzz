# 2026-10-08 - Panel apply includes the configured step

## Goal

The panel flow required "Add operation" and then "Apply to column"; clicking
Add gave no strong feedback that nothing had been applied yet. Options were
presented; the user chose **option 1: Apply includes the builder** for both
Clean and Transform.

Branch: `agent/ux-batch`.

## What shipped

- **Clean panel (Values tab).** The footer button is now contextual and
  always states what one click commits:
  - nothing to do -> `Apply to column`, disabled;
  - builder configured and nothing staged -> `Apply “Trim whitespace”`;
  - otherwise -> `Apply 3 operations` (plus `to all columns` when the bulk
    checkbox is on).
  Clicking commits pending + the configured builder op (only when the builder
  was actually touched, so Apply can never add a default op by surprise).
- **Add becomes "Add another"** — staging for multi-op pipelines. After
  staging, the builder op is in the list, touched resets, and the button
  counts the full list.
- **Live preview includes the builder op**, and editing its parameters
  (find/replace, locale, date order) refreshes the preview (debounced 250 ms).
  Previously parameter edits did not update the preview at all.
- **Transform panel.** Same model: `Apply “Round a column”` when only the
  builder is configured, `Apply 3 steps` otherwise; `Add another` stages.
  Builder input/change events mark it touched (event delegation on the input
  host), and applying from the column menu opens the panel with the step
  preset and ready to commit.
- Help updated for both panels; tests updated/added for the new button labels,
  preset apply and the disabled-until-touched rule.

## Files changed

- `src/ui/clean-panel.ts`: `builderTouched`, `currentBuilderOp`, `nextOps`,
  dynamic `updateApply`, debounced param preview, "Add another".
- `src/ui/transform-panel.ts`: hoisted `readOp`/`builderType`, touched
  tracking, `nextOps`, `updateApply`, "Add another", preset counts as touched.
- `src/ui/help-content.ts`, `test/ui-transform.test.ts`.

## Commands executed

```
npm run typecheck   # clean
npm test            # 320 tests, 320 pass
npm run build       # tsc + vite build, clean
npx wrangler deploy # va2e64d23
```

## Decisions / notes

- The "touched" rule is what makes this safe: the builder always has a
  default selection, so including it unconditionally would have made a bare
  Apply click commit an unintended op. Choosing a step type or editing any
  parameter counts as intent.
- Staging ("Add another") still exists for multi-operation pipelines and the
  Process Log batch grouping is unchanged.
- Optionally, a future close-guard could warn about staged-but-unapplied ops;
  not needed with this flow because Apply is the obvious primary action.

## Deploy

- Commit `f4f9bcc` on `agent/ux-batch`.
- Live: https://turbofuzz.mrjaystein.workers.dev
- Version ID: `a2e64d23-d3a3-4f7b-9c4d-fe2d807ce690`.
- Verified the served HTML references `index-CTOR_Zlz.js`.
