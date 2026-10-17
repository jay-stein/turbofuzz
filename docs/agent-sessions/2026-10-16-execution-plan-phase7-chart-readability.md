# 2026-10-16 — Execution plan Phase 7: chart readability and temporal axes

Branch `agent/execution-plan`, commit `94edbb4`. Checkpoint G (chart half):
axes follow the logical type, temporal ticks are span-aware, titles are
configurable, and focus mode keeps configuration.

## What changed

- **Type-driven, span-aware ticks** (`formatTick(value, kind, spanMs)`):
  - datetime: `HH:MM` for spans ≤ 2 days, `MM-DD HH:MM` ≤ 120 days,
    ISO dates ≤ 3 years, `YYYY-MM` beyond;
  - date axes drop to months on multi-year spans;
  - no span (tooltips, exports, other callers) keeps the full canonical
    form, so existing behaviour is unchanged.
  - Axis formatting was already keyed to `ColumnType` (`axisKindFor`); no
    name heuristics are used for tick choice.
- **Timezone clarity**: datetime line charts from zone-aware sources append
  "source offsets shown in UTC" to the unit note.
- **Axis title options**: `xTitle`, `yTitle` and `yUnit` config fields with
  Settings inputs (empty = automatic column name); the unit is appended to
  the Y title, e.g. `Rows (kWh)`. Truncated titles register hit regions so
  hovering shows the full text in the card tooltip.
- **Width-aware density**: X tick count in scatter/density/bubble axes is
  computed from the measured plot width (2–6), and the midpoint min/mid/max
  label on series charts drops below ~220px so narrow cards never overlap.
- **Focus mode**: a frame button moves the same card element into a
  near-fullscreen overlay; Escape or × restores it to its grid slot. All
  config, data and the chosen width survive because it is the same instance;
  `dispose()` closes the overlay.
- **Audit (task 6)**: legends are `<button>` entries with `aria-pressed` and
  toggle by click or keyboard; empty charts render explanatory messages;
  long category labels are fitted with ellipses; contrast comes from the
  theme variables already validated in the review pass.

## Tests

- `test/temporal.test.ts`: span-aware datetime/date tick formatting.
- `test/ui-charts.test.ts`: focus open → Escape → restore with config
  intact; axis title override + unit drawn; long title truncated with an
  ellipsis and hover reveals the full text.

## Commands and results

```
npm test             # 579 pass, 0 fail
npm run typecheck    # clean
npm run build        # clean
```

## Deferred (logged, not silently dropped)

- A plain (non-compact) number-format toggle for axes: the unit field plus
  span-aware date formats cover the readability intent; the toggle needs a
  config field and call-site threading that did not justify itself without
  user feedback.
- Per-element canvas tooltips exist only for truncated titles; tick labels
  keep their compact form by design.
