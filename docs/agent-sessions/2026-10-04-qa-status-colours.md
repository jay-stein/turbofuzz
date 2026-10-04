# 2026-10-04 — QA status colours: white title, green/red flags

## Changes

- `DATA QA` title is now 19px, weight 800, white, sitting on a red gradient
  banner (`.qa-head` bleeds to the block edges with rounded top corners).
  The rows × cols sub-label is white at 78% opacity.
- The four QA flag buttons are status-coloured:
  - **count 0 → light green** with dark green text (`--qa-ok` #9fdfab);
  - **count > 0 → red** (unchanged).
  Toggled-on buttons keep the pressed inset ring and "✓ … on" label, with a
  deeper active shade in either colour.

## Verification

104 tests, typecheck and build clean.
