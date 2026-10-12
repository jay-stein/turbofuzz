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
  `ViewDef`; bins/quantiles, pivot, conditional/weighted/ratio measures and YoY
  are the documented v2 remainder.
- Truncation at > `limit` groups shows “top N of M groups” instead of an Other
  row, because averaging medians/percentiles of merged groups would be wrong.
- Changed-cell masks are keyed by original row id and reset on load/transform;
  flags ship with row pages (row-major `Uint8Array`).
- `opencode export` is interactive-only in this environment (see the 2026-10-10
  handoff note); these markdown records remain the session log.

## Deliberately not done (scoped out of this pass, logged for follow-ups)

- **Full column inspector (§5.1)**: header right-click already carries the
  verbs in context, so the Clean/Transform drawers were **not retired** — doing
  so needs the click-to-open inspector first.
- **One commit model (§5.3)**: parameter-free ops are instant with Undo
  toasts; configurable ops still use panel + Apply.
- **Reports depth**: no co-missingness, join readiness, distribution-change or
  near-duplicate-cluster reports; Relationships has Pearson only (no Spearman,
  MI, Cramér's V, confounding); Anomalies has univariate only (no
  group-relative, kNN joint-rare or time-aware detectors).
- **Recipe replay transforms** remap only when the saved base schema matches by
  name; ops whose shapes depend on data (split, melt, combine, KNN) are skipped
  by design.
- Latency budget items (<50 ms active-view recompute etc.) were not benchmarked
  in this pass.

## Commands executed (high level)

```
git checkout -b agent/ux-review-20261012
npm run typecheck / npm test / npm run build   # after every phase
git add -A && git commit -m "<conventional message>"   # once per phase
```
