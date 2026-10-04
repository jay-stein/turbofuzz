# 2026-10-04 — QA block polish and Shuffle N

## Changes

- **Data QA title**: 12.5px → 16px, heavier weight — readable at a glance.
- **QA buttons now look clickable**: small filter-funnel icon, cursor pointer,
  hover lift with a red-tinted shadow, press-down state, keyboard focus ring.
  The label span (not the whole button) is updated on toggle so the icon
  survives.
- **Stats Report** is a full-width row under the toggle buttons with a larger
  icon (16px) and 13.5px text.
- **Shuffle N**: the results bar now has a numeric sample input (default 100)
  next to the dice button; the label reads "Shuffle 100" (or "Shuffle all"
  when cleared/0). The worker shuffles the current result ids and truncates to
  N, i.e. a random sample without replacement. One-shot like plain shuffle —
  the next filter/sort recomputes normally. A limit larger than the result set
  leaves it unchanged.

## Verification

103 tests pass, including limited-shuffle count/rows/flags and
limit-larger-than-result-set behavior. Typecheck and build clean.
