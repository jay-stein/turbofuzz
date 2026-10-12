# 2026-10-10 - Column tiles toggle + dice shuffle

## Goal

Two UX requests before the next deploy:

1. A toggle for the column-tile infographic, default off, placed above the
   table in the Table view. The chosen behaviour: the tiles appear as a strip
   between the results bar and the table when enabled; the Overview keeps its
   own All columns grid.
2. Shuffle shown as a big dice icon that reveals the words "Shuffle data" on
   hover.

## What shipped

- **Tiles toggle** (`src/ui/app.ts`, `src/styles.css`): a "Column tiles"
  button in the results bar, visible on the Table lens only, `aria-pressed`
  and an active style. Turning it on shows a horizontally scrollable strip of
  the same stat cards used by the Overview (`buildColumnCard`), between the
  results bar and the table. Each card opens the Filter · Chart · Clean menu
  (plus Drop empty column when the column is all null). The preference lives
  in `sessionStorage` under `turbofuzz.table.tiles`, defaults off, and the
  strip is hidden on other lenses without losing the preference.
- **Freshness**: the strip rebuilds when shown, after dataset stats updates
  (cleans, null policies, type changes) and after header renames; new loads
  and transforms go through `setView`, which re-syncs it.
- **Dice shuffle** (`src/ui/app.ts`, `src/styles.css`): the shuffle button is
  now a 19px dice SVG with the label "Shuffle data" collapsed to zero width;
  hovering or focusing reveals it with a slide/fade. It keeps the ghost style
  and its `aria-label`, and clicking still shuffles in place.

## Commands executed

```
npm test            # 388 tests, 388 pass
npm run typecheck   # clean
npm run build       # clean
npx vite preview --port 4174
python check_tiles_shuffle.py http://localhost:4174/ sales_demo.csv
python measure_post_import.py http://localhost:4174/ sales_demo.csv
```

## Results

- `check_tiles_shuffle.py`: the toggle is absent on Overview, present on
  Table; the strip is hidden by default and shows all 12 cards when toggled
  (`aria-pressed="true"`); switching lenses hides/restores it; the shuffle
  label goes from opacity 0 to 1 on hover with one dice icon; clicking
  changes the first row while the count stays 6,015.
- **21/21 budgets pass**: B5 (Table controls) 68 → 69, still inside the ≤ 70
  budget — one more visible control would break it, worth remembering.

## Decisions

- The toggle is table-only and session-scoped, matching the sidebar
  collapse preference behaviour.
- The strip reuses the Overview's card builder and menu actions so there is
  one tile design and one set of interactions.
- The dice label uses max-width/opacity rather than `display: none` so the
  reveal animates and the button keeps its hit area stable.

## Next

Deploy (`agent/table-tiles-shuffle` also contains the placeholder-null CTA,
one-click date combining, sparkline line chart, load progress and grouped
lines).
