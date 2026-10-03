# 2026-10-03 — Always-visible stats band

## Goal

Show dataset and per-column statistics at the top of the workspace without a
button, while keeping the band compact and aesthetic.

## Design

`src/ui/summary-band.ts` renders below the top bar (above the sidebar/results
split):

- **Overview card** (left, fixed 250px): rows and columns as large mono
  numbers, the Duplicate rows and Null rows toggle pills (with counts and an
  active state), a ghost "Details" pill opening the full stats modal, and a
  foot line with empty %, detected encoding and ingest time.
- **Column cards** (horizontally scrollable): one per column with name and
  type pill. Numeric/date columns get a sparkline built from the cached
  histogram plus `min – max`; category/boolean columns get the top three
  values as mini bars; text columns show `N distinct`. The foot line carries
  `distinct / mean / len avg` and the empty count.
- Clicking a column card scrolls the matching filter card into view and
  flashes it (`FilterPanel.focusColumn`).

All data comes from `LoadedMessage` metadata already held on the main thread —
no extra worker requests, no latency cost. The old top-bar Stats button is
removed; the modal remains reachable via "Details".

## Verification

- 63 tests pass; typecheck and production build clean.
- Main bundle 12.9 kB gzip (was 12.0), CSS 3.2 kB gzip.
