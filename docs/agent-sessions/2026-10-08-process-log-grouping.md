# 2026-10-08 - Process Log batch grouping

## Goal

A single action can produce many Process Log entries (e.g. "Apply to all
columns" over 20 columns, or a multi-step Transform commit). Group them so the
log reads as one step, auto-condensed, expandable via a + icon.

Branch: `agent/ux-batch`.

## Design

- **`groupSteps(entries)`** (exported, pure, in `src/ui/steps-panel.ts`)
  converts the flat entry list into display groups:
  - explicit batch groups (consecutive entries sharing `entry.group.id`)
    collapse into one;
  - consecutive clean entries with identical operation sequences across
    **3 or more distinct columns** are recognised as one "apply to all
    columns" action (labels like "Trim · 20 columns" or
    "2 operations · 12 columns", with the op chain as detail);
  - everything else stays a single row.
- **Transform commit tracking** in `app.ts`: `transformCommitSizes` records how
  many ops each Apply produced (`syncTransformBatches` grows on new applies and
  trims on undo/reset, rebuilding from the op list length). Batches larger than
  one op mark their entries with `group: { id: "transform-batch-N", label:
  "Transform batch (N steps)" }`.
- **Panel**: group rows render as a compact header (number, label, detail,
  "N steps" and a `+`/`−` toggle); sub-steps are hidden by default, shown
  indented with their original per-entry undo (and clean reorder) buttons.
  Sub-steps are numbered `3.1, 3.2, …`.
- **Counts**: the panel header and the Process Log button badge now count
  groups/actions instead of raw substeps.

## Files changed

- `src/ui/steps-panel.ts`: `StepsPanelEntry.group`, `StepsGroup`, `groupSteps`,
  grouped rendering with toggle and sub-numbering.
- `src/ui/app.ts`: `transformCommitSizes`, `syncTransformBatches`, batch
  metadata in `stepEntries`, badge count via `groupSteps`.
- `src/styles.css`: `.step-group`, `.step-toggle`, `.step-count`,
  `.step-group-children`, `.step-substep`.
- `src/ui/help-content.ts`, `next_steps.md`.
- `test/steps-group.test.ts` (new): clean runs (3+ columns, multi-op,
  same-column safety), explicit batches, flat fallbacks.

## Commands executed

```
npm run typecheck   # clean
npm test            # 317 tests, 317 pass
npm run build       # tsc + vite build, clean
npx wrangler deploy # vefb39a4b, assets uploaded
```

## Decisions / notes

- Clean auto-grouping deliberately requires ≥3 columns with identical op
  sequences and distinct columns, so single-column logs never collapse by
  accident. Two-column runs stay flat.
- Undo remains per sub-step (a group-level undo is a possible follow-up; the
  underlying undo paths rewrite whole op lists, so a transactional undo would
  need an explicit batch-undo path).
- The badge count change is global (button and panel header), so the number
  matches what the user perceives as actions.

## Deploy

- Commit `8611e2d` on `agent/ux-batch`.
- Live: https://turbofuzz.mrjaystein.workers.dev
- Version ID: `efb39a4b-0698-4c1a-a0e6-69a033ed871a`.
- Verified the served HTML references `index-Di0x7sl1.js`.
