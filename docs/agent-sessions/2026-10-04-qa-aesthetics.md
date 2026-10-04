# 2026-10-04 — QA block aesthetics

## Changes

- QA toggle buttons now read as solid red controls with white text
  (`--qa-btn` = 20% salmon + 80% danger red; dark-mode overrides keep white
  text legible). Hover brightens, press translates down.
- Active state is a pressed/deeper red with an inset white ring and the label
  switches to `✓ Duplicates: on` (etc.), so the toggle affordance is obvious;
  `aria-pressed` is set for assistive tech.
- `Details` is now **Stats Report** with a small document-chart SVG icon.
- `svgIcon` moved from `app.ts` into `src/ui/dom.ts` so both app and
  summary band share it.

## Verification

103 tests, typecheck and build clean.
