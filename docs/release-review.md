# Release Review: Security, Accessibility and Browser Quality

**Date:** 2026-10-19

## Security and privacy

- CSP: `default-src 'none'`, `script-src 'self'`, `worker-src 'self'`, `connect-src 'none'`, `object-src 'none'`.
- No `eval`, `new Function` or network `fetch` in `src/`; enforced by `test/security.test.ts`.
- Files are parsed in the Web Worker; no upload route exists.
- GeoJSON/Shapefile and archive parsing stay local.
- Formula-like cells remain escaped on export.

## Accessibility

- Tabs, dialogs and chart canvases expose accessible names.
- Dialogs use role/name, focus trap and focus restoration.
- Chart canvases expose `role="img"` and generated descriptions.
- Fix/filter chips expose `aria-pressed` where they toggle state.
- Global `:focus-visible` ring added for controls without a surface-specific style.
- `prefers-reduced-motion` now disables long transitions and animations.
- Browser checks: `test/e2e/a11y.spec.ts`.
- No blocking findings remain from this pass.

## Browser coverage

Playwright covers:

- small CSV load, table, command bar, quality and chart smoke;
- sort/filter/melt commands;
- multi-file preflight and provenance;
- batch type conversion;
- chart builder and summary;
- accessible names and reduced motion.

Run with `npm run test:e2e`.

## Performance gates

- `bench:clean` - 100k/300k/10-column clean and undo budgets.
- `bench:pivot` - 100k pivot with two index fields, one column field and margins.
- `bench:multifile` - four-file append.
- `bench:chartspec` - 100-column spec round-trip.
- `bench:quick`, `bench:real`, `bench:latency`, `bench:ingest` remain available.

## Known follow-ups

- W2.6 deferred dataset metrics and W2.7 progress/cancel polish remain post-release.
- E2E covers representative flows, not every chart kind or geo join.