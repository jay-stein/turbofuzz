# 2026-10-16 — Execution plan Phase 1: Date/Datetime/Time/Duration

Branch `agent/execution-plan`, commit `c2c8191`. Checkpoint B: typecheck and
build pass, all 558 tests pass, all latency budgets still pass.

## What changed

- `ColumnType` gains `datetime`, `time`, `duration` (`src/types.ts`), with
  `isTemporalType` / `isNumericLikeType` helpers. Dropdowns, badges and the
  type mix pick the new members up from `COLUMN_TYPES` / `TYPE_LABELS`.
- `classifyDateValue()` (`src/parse/dates.ts`) reports `hasTime`/`hasOffset`
  and validates calendar ranges strictly (no more `2026-13-45` rollover).
  New parsers: `parseTimeOfDay`, `parseDuration` (colon form needs two
  colons, hours may exceed 23; unit form `1h 30m`), plus
  `toDateTimeInputValue`, `fromDateTimeInputValue`, `toTimeInputValue`,
  `formatDurationMs`, `toDateTimeValue`.
- Inference: date-only → `date`; any time component (including midnight)
  → `datetime`; zone-aware flagged in `ColumnMeta.timeZoneAware`.
  Time/duration are conservative — ambiguous `HH:MM` stays text with a
  conversion suggestion (applied as a type override); am/pm, clock-named
  columns, unit durations and >23h clock forms infer.
- `ColumnData.numbers()` parses per type (epoch ms / ms since midnight /
  elapsed ms); `setType` re-detects order and zone awareness and clears all
  numeric caches. Sorting, range filters, histograms, chart bins, facets
  path, aggregate menus, stats/profile cards, CSV export and
  `ColumnSchema.type` follow the numeric-like set.
- Charts: datetime draws as a line with date+time ticks (`AxisFormat`
  extended), time/duration as histograms, animation and scatter pools
  accept datetime, hit-region tooltips use the axis temporal format.
- CSV export: datetime → ISO 8601 UTC, time → `HH:MM`, duration →
  `H:MM:SS`; unparseable cells stay blank.
- Help drawer documents the logical types.

## Tests

- New `test/temporal.test.ts` (14 cases): date vs datetime inference,
  midnight timestamps, month-name splits, mixed strings, zone offsets,
  DMY/MDY policy, invalid/null/all-null, conservative time and duration,
  identifier safety, cache invalidation on override, filtering/sorting by
  instant, axis formatting, CSV canonicalisation.
- Updated 5 existing expectations where behaviour intentionally changed
  (datetime output type from combine, gallery/message wording, worker
  baseSchema now carries the logical type).

## Known limitations (logged)

- Naive timestamps are interpreted as UTC end-to-end (documented); the
  original offset is preserved only through the instant and `timeZoneAware`,
  not as per-value metadata.
- Time-of-day is excluded from scatter/box/correlation axes (histogram and
  filters only); duration participates as a numeric-like measure.
- Conversion suggestions for time/duration switch the column type; they do
  not rewrite cell text.

## Next

Phase 2: make the clean/transform operation history the shared recipe
contract, audit pandas output per operation (support matrix), add golden
tests, and surface every non-equivalent step before export.
