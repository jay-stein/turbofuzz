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

## Verification (all on this branch)

- `npm run typecheck` — clean.
- `npm test` — 427 passing (added ~38 tests: aggregate, archetype, findings,
  recipe-file, command-bar, views-panel, chart-gallery, plus updated worker and
  UI suites).
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
