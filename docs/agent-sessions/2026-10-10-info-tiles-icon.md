# 2026-10-10 - Info Tiles label + hover mini-chart icon

## Goal

Two tweaks to the Table-lens column-tiles toggle:

1. Rename the label from "Tiles" to "Info Tiles".
2. Like the shuffle dice reveals its word, hovering the toggle should change
   the icon into a mini chart.

## What shipped

- **Label** (`src/ui/app.ts`): the toggle now reads `Info Tiles`; the
  one-time hint text was updated to match.
- **Icon states**: the button holds three SVGs — a 2×2 grid (idle), a mini bar
  chart (hover), and a check mark (active). CSS swaps them:
  `.tiles-toggle:not(.active):hover` shows the chart (with a short
  `tiles-rise` scaleY animation from the baseline), the active state always
  shows the check so the pressed state stays readable even while hovered.
- The hint text (`Miss the column summary? “Info Tiles” …`) follows the new
  name.

## Commands executed

```
npm test            # 393 tests, 393 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python check_info_tiles.py http://localhost:4174/ sales_demo.csv
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Results

- `check_info_tiles.py`: label `Info Tiles`; idle `{grid}`, hover `{chart}`,
  active-while-hovered `{check}`, active-after-mouse-away `{check}`.
- **21/21 budgets pass** (B1 222, B5 69/70 despite the wider label; the
  results row does not wrap and the flexible spacer absorbs the width).

## Decisions

- The chart swap is hover/focus-visible only for the inactive state: once the
  strip is on, the check is the more useful signal.
- The mini chart is a 3-bar glyph on a baseline inside the same 15px box, so
  the button width never changes on hover.
