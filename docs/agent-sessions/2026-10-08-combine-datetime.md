# 2026-10-08 - Combine date/time columns with timezone intelligence

## Goal

Add a transform that converts multiple columns into a date or datetime, as
asked: flexible ways of combining, time intelligence (hours), US vs normal
date formats, timezones and many input formats. This closes the parked
"Combine year/month/day columns into a date" backlog item.

Branch: `agent/combine-datetime` (from `agent/chart-polish`).

## Design

One new transform step, `combineDate`. Every selected column gets a **role**:
`auto`, `date`, `datetime`, `time`, `year`, `month`, `day`, `hour`, `minute`,
`second`, `millisecond`, `meridiem` (AM/PM), `offset` (UTC offset) or `epoch`.
The engine assembles the components per row into a canonical ISO value:

- **Auto roles** inspect the column name and up to 200 values (offset shapes
  first, then ISO datetime, date, time, epoch, then integer ranges; name hints
  like Year/Month/Day/Hour/AM-PM break range ties).
- **US vs day-first** is detected per date-like column from values where one
  part exceeds 12 (or forced with the Date order select); ISO/YMD are always
  unambiguous. Two-digit years pivot at 70.
- **Time intelligence**: `14:35`, `14:35:12.250`, `2:35 PM`, `2 PM`, compact
  `1430` and `235959`, plus separate hour/minute/second/AM-PM columns.
- **Dates**: `03/04/2024` (either order), `2024/03/04`, `4 Mar 2023`,
  `March 4, 2023`, `March 2023`, ordinals (`4th June`), ISO datetimes.
- **Epoch**: 10/13/16/19-digit unix values convert (s/ms/µs/ns).
- **Timezones**: UTC (default), local browser zone, any IANA zone (via
  `Intl`, no tz library), fixed `±HH:MM`, or `naive`. DST offsets are looked
  up per instant with an hourly-bucket cache. If the data carries an offset
  (role or embedded in a datetime), it wins over the selected zone.
- **Output**: `YYYY-MM-DD` for date, `YYYY-MM-DDTHH:mm:ss[.SSS]±HH:MM` (or
  `Z`) for datetime, or no suffix for naive. Invalid or incomplete rows
  become blank cells; a missing day defaults to 1.
- Source columns can optionally be dropped; names are de-duplicated.

## Files changed

- `src/parse/date-parts.ts` (new): roles, date/clock/offset/epoch parsers,
  name+value role suggestion, order detection.
- `src/data/timezone.ts` (new): zone spec resolution, `zoneOffsetMinutes`
  (cached), `wallTimeToInstant`, common zone list.
- `src/data/date-combine.ts` (new): `CombineDateOp` + `applyCombineDate`.
- `src/parse/dates.ts`: `parseDate` now keeps time and zone offsets for ISO
  datetimes, so combined datetime columns type as dates and keep sub-day
  precision in `numbers()`.
- `src/data/transform-ops.ts`: op union, apply case, describe/detail,
  schemaAfter.
- `src/data/recipe.ts`: pandas `pd.to_datetime(dict(...))` + `tz_localize`
  (best-effort, with comments for AM/PM and offset columns).
- `src/ui/transform-panel.ts`: "Combine date/time columns" builder — column
  checkbox + role select per schema column, output type, date order,
  timezone input with IANA datalist, name and drop-sources options.
- `src/styles.css`, `src/ui/help-content.ts`, `next_steps.md`.
- Tests: `test/date-parts.test.ts`, `test/timezone.test.ts`,
  `test/date-combine.test.ts`, `test/recipe.test.ts`.

## Commands executed

```
npm run typecheck   # clean
npm test            # 301 tests, 301 pass
npm run build       # tsc + vite build, clean
npx wrangler deploy # v180785e2, 5 assets uploaded
```

## Decisions / notes

- Output keeps the wall clock and appends the resolved offset (e.g.
  `2024-01-15T12:00:00+11:00`) rather than shifting to UTC, so the value is
  both unambiguous and faithful to what the source said. Naive output has no
  suffix and is interpreted as UTC by `parseDate` (pandas-like).
- Timezone conversion uses the platform `Intl` database; no tz package, no
  bundle weight. Invalid zone names fall back to naive.
- `Intl.formatToParts` results are cached per hour bucket per zone, so a
  300k-row combine does not pay a formatter call per row.
- Best-effort pandas recipe: explicit component roles map to a `dict(...)`
  constructor; full date/time/datetime/epoch roles first convert with
  `pd.to_datetime` and then contribute `.dt` fields.

## Deploy

- Commit `5310696` on `agent/combine-datetime`.
- Live: https://turbofuzz.mrjaystein.workers.dev
- Version ID: `180785e2-07d2-4794-af8e-3c6422abde56`.
- Verified the served HTML references `index-ClJTQg2n.js`.

## Still open

- Datetime display: the table shows the canonical ISO string and filters
  label ranges as dates; a datetime-aware cell format/tooltip is a possible
  follow-up.
- Roadmap Phase 3 chart interactions (hover, zoom, brush) and small
  multiples remain open.
