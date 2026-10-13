# 2026-10-12 — UX review 2026-10-12: full roadmap pass

Goal: address every phase of
`claude_reviews/review_claude_20261012/turbofuzz_ux_review_20261012.md`
(Phase 0, 0b, 1, 2, 2b, 2c, 3, 4, 4b, 4c, 5) step by step, one conventional
commit per phase on `agent/ux-review-20261012`.

## Commits (branch `agent/ux-review-20261012`)

| Commit | Phase | Summary |
|---|---|---|
| `ae86dcc` | docs | add the 2026-10-12 review spec |
| `891b5bf` | 0 | retire the stepper; nav row gets Recipe (N) + Export; Process Log renamed Recipe; 1–3 shortcuts (Views/Reports tabs later take 3/5) |
| `1c5d12f` | 0b | section 10 findings: clean tab/staging/strikethrough/red select/empty box; merged QA chips + numeric headers + hover ×; Overview order, missingness collapse, amber rules, card type; box ticks/empty groups; correlation IDs/rect cells/abbrev labels; chart card ⋯ menu + titles + axis label; filters sidebar search-only |
| `d84c738` | 1 | question-grouped chart type gallery with live suggestion previews; source selector on every card; titles drop the file name |
| `33908e5` | 2 (+2b) | `getAggregate` engine (value/time/date-part dimensions, 12 measures, gap fill, rolling/cumulative/diff/%change/%total/rank), Views lens with starter views, pill builder, inline bars + Total, drill-down, Chart this, pandas recipe, multi-dim aggregate transform |
| `99470a9` | 2c | archetype detection (9 types + general) with evidence, Overview line + override, next-step re-ranking, starter grain |
| `ef3b372` | 3 | Ctrl/Cmd+K command bar (~16 verbs, live suggestions, friendly errors); worker-tracked changed cells with row flags, Show changes toggle, cells-changed/row-delta reporting |
| `4f889bb` | 4 | triage queue behind “N issues found — Review all” |
| `cc7ad8a` | 4b/4c | Reports lens: shared Finding shape, Quality / Relationships / Anomalies tabs |
| `932aea1` | 5 | recipe save + replay (name matching, skip reporting) and Slick table PNG/HTML from a view |
| `72ed25a` | follow-up | measure picker chooses the aggregate up front; custom expression measures (+ − × ÷ over aggregates, ratios, percentiles) in the view, totals, Use-as-dataset and pandas recipe |
| `bd27309` | 3 cont. | column inspector on header click (profile, issues, verbs, display format); per-column fixed-decimal display; reports gain unit inconsistency, join-readiness keys and Explain [column] |
| `fb1c6db` | perf | `bench/latency.ts` + aggregate optimisations (civil-date math, deferred time labels, scratch arrays, pre-resolved slots, top-N heap, precomputed sort ranks); results in `bench/results-latency.md` |
| `e7d7b38` | 3/4 cont. | inspector applies Round, Fill missing, Split and Remove duplicates in place; panels remain for KNN/melt/combine/split options |

## Latency (review §7 budgets, `npm run bench:latency`)

Measured on the dev machine (i5-12500H, Node 24), p50/p95 over 20 iterations
at 100k rows:

| Operation | Budget | p50 | p95 |
|---|---|---|---|
| Active view: count + sum + mean by category | 50 ms | 26 ms | 35 ms |
| Time view: rows + sum by month (gap fill) | 50 ms | 35 ms | 40 ms |
| High cardinality: top 500 of 100k groups | 100 ms | 78 ms | 78 ms |
| Expression measure: sum / count | 50 ms | 25 ms | 30 ms |
| Clean commit: trim + dataset rebuild | 500 ms | 144 ms | 150 ms |
| Filter keystroke: contains + sort | 50 ms | 3.3 ms | 4.3 ms |

At 300k rows (paste-limit ceiling) everything scales linearly: views 77–264 ms,
clean commit 307 ms, filter keystroke 11 ms. The 50 ms view budget is stated
for 100k rows; 300k remains interactive but is over that budget by design.

## Deploy

`npm run build && npx wrangler deploy` from `agent/ux-review-20261012`:
uploaded 5 assets to the `turbofuzz` Worker, version
`0e7d8016-b5bd-4796-a3b5-d6fc123d3345`
(https://turbofuzz.mrjaystein.workers.dev, checked: serves the app shell).
Latest versions: `7a03d8ca-a6c3-4132-a597-45cade6d0b97` (treemap + text
mining), `3b66a62c-0d90-4b90-86a3-1b383bd6a312` (distribution changes),
`c47f9520-5da9-441e-98da-39852854b8ca` (view rename).

## Follow-up fixes after first use

- `bb0e985` YoY + carry fill.
- Triage queue feedback (live update + green tick): the Review issues panel now
  receives fresh metadata on every applied change, ticks items green while the
  fix is pending, logs "✓ Fixed: …" for cleared issues for a few seconds, drops
  the tick when a fix did not resolve, and the Clean → Nulls Apply button is
  disabled when there is nothing to blank (applying was a silent no-op before).
- `84c5fe6` group-relative anomalies (robust z per category, lazy worker
  detector, `groupAnomalies` column filter) and functional-dependency discovery
  (candidate keys → determined columns, conflicts with examples).
- Relationship discovery: Pearson + Spearman + Cramér's V + η² ranked by effect
  size in the Relationships tab (lazy, 46 ms at 100k rows; bench case added).
- Treemap chart cards (squarified layout, count or Σ measure via the aggregate
  engine, click-to-filter tiles) and **top-terms cards** for text mining
  (`getTextProfile`: stopword-filtered token frequencies plus email/URL/phone/
  number/date shape detection; clicking a term filters rows containing it).
  Reports Quality adds text findings per text column (top term, term variety,
  shaped-value mix). Bench: text profile 90 ms at 100k rows.
- Distribution changes: Quality compares the first and second half of the
  current row order — PSI over first-half deciles for numbers, Cramér's V for
  category mixes — and reports shifts with the moving bucket/category. Bench:
  27 ms at 100k rows.
- Views can be renamed by double-clicking their tab (Enter keeps, Escape
  discards; the name flows into Chart-this titles and saved recipes).
- Verification pass (headless-Chrome screenshots at 1440/1280/1100, light and
  dark, all five lenses): no breakage below 1300px — table scrolls with a
  frozen first column, Views builder wraps, chart toolbar and Reports findings
  fit, dark theme renders correctly. Fixed: hint callouts dock bottom-left
  (they covered the Filters header/results bar at 1100px), dark `--null-text`
  was an unreadable 1.31:1 on the null tint (now 6.46:1), and the landing
  formats line dropped 80%-alpha dim text (3.39:1). WCAG text pairs all pass;
  decorative `--border` stays 1.4:1 against panels by design.

## Aggregation v2 and the rest of the backlog (same day, later session)

| Commit | Feature |
|---|---|
| `1e5aa43` | Engine: conditional measures (`where` value list / range / is-empty, applies to expression terms), time options (week start, fiscal year start month, time zone via fixed offsets, local or IANA), cohort/since dimensions (entity → first period, period index since), partial-period flags on time results with `view.partial` exclude |
| `36bbb6d` | Views UI: Other row for truncated summable results (total − shown, em-dash for non-summable), Spread matrix (heat-shaded pivot), “+ Cohort” retention starter, Partial periods selector + ◔ markers + note, Only-where editor with pill marker, week/fiscal/tz options in the grain menu, pandas export for where-masks, cohort/since temp columns, fiscal/tz comments, pivot reshaping |
| `99d0232` | Near-duplicate clusters: primary-metaphone blocking + Jaro-Winkler, capped to the most frequent 2,000 values / 25 clusters, identifier columns skipped, “approximate” label in findings, merge action; time charts bound to a view hatch incomplete edge periods |
| `a13a70b` | Anomaly actions: Flag column (non-destructive Yes/No column from value/length fences) and Winsorise 1% (percentile clamps) as Recipe steps, replayed by name, described and exported to pandas best-effort |
| `a149e48` | Load is a modal dialog (New data reopens it with a close button); recipe replay offers a column mapping step when base names do not match; the archetype override is stored in the recipe and restored on replay |
| `4f3e68a` | Perf guard (100k aggregate fails at 100× p50) + near-duplicate bench case (24 ms at 100k); 300k decision recorded in `bench/results-latency.md` |

Final state: 499 tests, typecheck/build clean, all bench budgets pass
(including text 97 ms, distribution 35 ms, near-duplicates 24 ms at 100k).
Deployed as version `6e7ace8e-76d7-4430-9766-6f22b4ccd224`.
The review's v2 list is now complete (bins, pivot, conditional/weighted/ratio
measures, YoY, cohorts); only the explicitly “later” event-log specifics
(time between events, sessionisation, funnels) remain out of scope.

## Usability round (same day, later still)

| Commit | Feature |
|---|---|
| `3197b5b` | ColorBrewer/matplotlib palettes (qualitative, sequential, diverging, custom hex) defaulting to Pastel1, applied to multi-series bars, grouped lines, treemap and categorical scatter colours (numeric colour scales use ramps as ramps); red × on each chart card with a confirmation (the ⋯ menu also confirms); the add-chart toolbar sticks below the results bar; Views collapse to 20 rows with Show all (Other row appears with the full list); new views default to View_1, View_2 and open in rename mode; Report actions flash the column they jump to |
| `855c307` | ZIP Import all: every delimited entry's first row is checked in one decompression pass (trimmed, case-folded); matching headers enable appending all files through header detection, mismatches disable the option with the reason; the toolbar button is New data when empty and Clear data when loaded, with a confirmation before closing the table |

508 tests, typecheck/build clean. Deployed as version
`70231219-6db9-4f52-a9fd-c84dccff5f3f` (visual checks on the chart card,
palette picker, Clear data dialog via headless Chrome).

## Large-ZIP fix (same day)

A 31-file, 916 MB traffic export took minutes because Import all's header
check inflated and fully parsed every CSV before the picker appeared
(multi-GB string churn). Header checks now read only the first 128 KB of each
entry, four at a time with progress; the row count is estimated from the first
file's bytes-per-row. Measured on the real archive: picker ready in ~3.9 s
(inflate 3.8 s across 31 concurrent-ish prefix reads, prefix parsing 0.13 s,
estimated 3.7M rows × 103 columns). Import all is disabled above 20M estimated
cells with the numbers in the note, and allowed imports stream one file at a
time (no retained tables, no header re-detection, no array copies). Commit
`e6ea5f7`, deployed `56093abc-8b12-4172-8447-c1c5f041f6f8`.

## Chart feedback round (same day)

| Commit | Fix |
|---|---|
| `fce2a73` | Pastel1 now applies immediately: single-series charts draw the palette's first colour until the user picks a swatch/hex, and palette changes re-colour them live (hand-picked colours survive). Histograms gain the Group control — one smoothed share-per-bin curve per category with the shared legend. The Source selector reads “Table” when no filter/special is active (and refreshes as filters change). Axis controls sit in their own bordered “Axes” group (Column for single-axis kinds, X/Y for pairs). |

513 tests; deployed `9af793b4-f6d2-4d6f-a4b8-1f5e61563b0e` (verified the
grouped histogram, pastel colours, Table label and Axes panel with headless
Chrome).

## Bubble charts and animation (same day)

Commit `d8ef27d`, deployed `4ff820cc-3772-4843-a02d-5d227494668c`. 520 tests.

- **Bubble (count)** chart: `getGridCounts` bins two numeric columns into an
  N×N grid worker-side (default 40, adjustable 4–120) and rows per cell drive
  the circle area — the Citi Bike lat/lon-by-trip-count case. Joins the
  gallery under “How are two things related?”.
- **Animation**: bar and bubble charts can step through a date column.
  `getAnimation` returns one aggregate per time bucket in a single pass (top-N
  category counts, or per-frame grids); frame length defaults from the data
  span (hour/day/week/month) and is selectable. A playback bar under the chart
  offers play/pause (2 fps), scrubbing, frame label and looping;
  **Export video** records exactly one loop via `canvas.captureStream` +
  `MediaRecorder` into a dependency-free `.webm` download.
- Aggregation in plots answer: measures (sum/mean/…) per group already exist
  through Views; “Chart this” or the card Source selector binds a card to any
  saved view’s aggregate. Bubble adds the built-in aggregated scatter.

## GIF export fix (same day)

Commit `edc8e6f`, deployed `eddd8156-cd94-4d77-a9ab-63e58d85277b`. 523 tests.
The WebM export recorded the live canvas through MediaRecorder/captureStream
in real time and sampled the same frame, producing a static video. Export now
draws every frame to an offscreen canvas (2× the card size) and encodes a
looping GIF89a directly with `gifenc` — no real-time capture. Verified in
headless Chrome: a 9-frame animation downloads a 46 KB GIF with 0.5 s frame
delays, the loop extension, and nine distinct frame data blocks; the encoding
is covered by structural tests (`test/gif.test.ts`) and a UI test that
captures the blob.






Drawers kept intentionally: the inspector and command bar cover the common
verbs, but melt, KNN, combine-date roles and regex split still need the
configurable panels, so Clean/Transform stay as the advanced surface.

## Verification (all on this branch)

- `npm run typecheck` — clean.
- `npm test` — 474 passing (aggregate, archetype, findings, distribution,
  text-profile, treemap, recipe-file, command-bar, views-panel, chart-gallery,
  plus updated worker and UI suites).
- `npm run build` — clean (Vite bundle grew by ~83 KB raw / ~23 KB gzip on
  index; worker +10 KB).

## Decisions and notes

- §3.5 supersedes §3.1, so the engine was built once with the generalised
  `ViewDef`. The v2 list is now delivered (bins/quantiles, pivot, conditional/
  weighted/ratio measures, YoY, cohorts, fiscal/zone time, partial periods).
- Truncation folds the hidden groups into an Other row when every shown measure
  is summable (total minus shown); non-summable measures keep “top N of M”
  because averaging medians/percentiles of merged groups would be wrong.
- Changed-cell masks are keyed by original row id and reset on load/transform;
  flags ship with row pages (row-major `Uint8Array`).
- `opencode export` is interactive-only in this environment (see the 2026-10-10
  handoff note); these markdown records remain the session log.

## Deliberately not done (scoped out, logged for follow-ups)

- **Full column inspector (§5.1)**: header right-click and the inspector cover
  the verbs; the Clean/Transform drawers are **not retired** because melt, KNN,
  combine-date roles and regex split still need configurable panels.
- **One commit model (§5.3)**: parameter-free ops are instant with Undo
  toasts; configurable ops still use panel + Apply.
- **Recipe replay transforms**: name matching now has a mapping step, but ops
  whose shapes depend on data (split, melt, combine, KNN) are still skipped
  when the mapping cannot cover them.
- **Event-log specifics** (the review's “later” phase): time between events,
  sessionisation and funnels are out of scope; cohorts cover the v2 need.
- **300k latency**: deliberately stays over the 50 ms view budget (soft
  ceiling); WebAssembly kernels or incremental aggregation are the logged
  remediation path — see `bench/results-latency.md`.

## Commands executed (high level)

```
git checkout -b agent/ux-review-20261012
npm run typecheck / npm test / npm run build   # after every phase
git add -A && git commit -m "<conventional message>"   # once per phase
```

## Anthropic feedback: GIF quality and Animate prominence (same day)

Commit `640072c`, deployed `647ecb29-04af-4bd1-b12b-f1e45070381b`. 525 tests.
The GIF *was* animating (frames differ frame-to-frame) but looked static and
poor because: frames were captured on a transparent canvas (many viewers show
that as black), the demo data had identical bar heights per frame, and small
range y-axes repeated formatted ticks (`1,1,1,0,0,0`). Fixes: paint the panel
colour with `destination-over` after drawing each frame; dedupe tick labels
after formatting for counts, shares and numeric axes; verified by decoding an
exported GIF frame-by-frame (panel background, unique ticks, different bars
per month). The Animate control now lives in the chart toolbar with a movie
camera icon and expands a visible setup row (outside Settings), disabled with
a reason when the file has no date column; the GIF export button shares the
icon. GIF remains the default (universal in chat/docs/readmes); APNG or
WebCodecs WebM are documented options if full-colour quality is needed.

## Play speed and MP4 export (same day)

Commit `3df2e99`, deployed `bf44464c-290c-485a-8fd4-08640518cf80`. 526 tests.
The "static GIF" report was the Windows Photos viewer, which shows only the
first frame of an animated GIF; the file itself animates (decode of an
exported GIF shows distinct frames). To fix the experience regardless of
viewer: (1) a play-speed selector (0.5x/1x/2x/4x) drives the live interval
and the exported frame rate; (2) Export is now a menu - Animated GIF or
Video (.mp4) via WebCodecs H.264 (VP9-in-MP4 fallback) muxed with
mp4-muxer, which plays in every desktop player and PowerPoint; (3) frames
carry a time + counter label ("2024-03 3/3") so motion is unambiguous.
Both formats share one async frame renderer with progress feedback.
Verified in headless Chrome: GIF at 2x = 3 frames,25-hundredths delays,
loop extension; MP4 = valid ftyp/mvhd, 0.75 s for 3 frames.

## Animation round 2 (same day)

Commit `9c2dee6`, deployed `2ec39d9c-3078-4f31-890c-45fdbe323f22`. 527 tests.
Root cause of the "static" GIF finally pinned down: animated bars scaled to
each frame's own maximum, so every frame refilled the plot and only the date
changed; MP4 looked livelier mainly because VLC animates. Bars now scale to
the global maximum across all frames (verified visually: Jan 1/5 height,
Mar 2/5). Histograms, treemaps and density charts animate too - a new worker
histogram-frame mode, animated treemap tiles from frame counts, and density
reusing the bubble grids through the normal density renderer. Play speed
presets are 0.5/0.75/1/1.5/2x plus Custom (0.05-20x), driving live playback
and export frame delay. Frame counters were removed; the date is the label.

## Bubble measures and speed presets (same day)

Commit `d981292`, deployed `63b5b10e-6faa-4750-ae7f-017cfd0d5b30`. 530 tests.
The "static GIF" turned out to be VLC not animating it - a false alarm; the
file was fine. Bubble charts can now size by Count (rows) or sum/mean/min/max
of any numeric column, aggregated per grid cell worker-side (and per frame
for animated bubbles), with area/radius/log scale modes and an exact note
("size: mean(Annual Usage) per cell (log scale)"). Play speed gains 1.25x.

## Bubble controls visibility fix (same day)

Commit `229be57`, deployed `67346b4e-c594-4a28-9882-d6c90c326524`. 531 tests.
The bubble Size-by and Scale selects were inside the collapsed Settings panel,
and choosing a Size column while the measure stayed Count had no visible
effect. The Grid/Size-by/Scale controls now sit in their own dashed "Bubbles"
row directly under the toolbar whenever the chart is a bubble, and picking a
Size column switches the measure to Sum automatically. Verified visually:
the row appears with Grid 40, Size by Count (rows), Scale Area proportional to
value.

## Chart feedback round 3 (same day)

Commit `4dca4fa`, deployed `34b66c73-27c8-4e4b-b403-043c2a9fa7a0`. 535 tests.
Five issues plus a rail: the kind is now "Bubble" (not "Bubble (count)");
a left chart-type rail lists every kind as an icon tile (one-click add,
collapsible to icons only, remembered across sessions), with the Help drawer
documenting Grid/Size by/Scale/Group/animation/GIF-vs-MP4; axes tags are
kind-aware (Values/Date/Category/Text/Column) and empty selects say why;
bubbles can be grouped by a category column (one overlaid grid per group,
shared bounds, capped Other bucket, legend toggles, works with animation);
the Bubbles row carries the Size by column select directly and picking a
column switches the measure to Sum. Regression fixed: X/Y controls were
leaking onto single-axis kinds after filter updates because
syncSourceControls and renderControls disagreed.

## Chart feedback round 4 (same day)

Commit `67b0a26`, deployed `a9ca66d6-024b-4eb0-a6c3-4805d35c42d2`. 536 tests.
The rail now sits in an explicit flex wrapper beside the toolbar and grid for
the full panel height (it previously rendered above the grid because the
wrapper class depended on the host element's display). Cards gained a Wide
toggle (expand icon + card menu item) so any chart can span the whole row.
Bubble sizing follows seaborn's model: Size = the variable (Count of rows or
a numeric column), Reduce = how rows in one area combine (shown only when a
column is chosen), Mapping = how values become radius (Area/Radius/Log).
