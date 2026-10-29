# UX Change Log

Record shipped or attempted UX changes and what was verified.

## Entry template

### CHG-YYYY-MM-DD-NN — Short title

- **Status:** Planned / In progress / Verified / Rolled back
- **Related issue / decision:**
- **Git commit / PR:**
- **Problem addressed:**
- **Scope:**
- **Explicit non-goals:**
- **Acceptance criteria:**
- **Files / components changed:**
- **Tests run and results:**
- **Manual browser verification:**
- **Regression findings:**
- **Feature inventory / baseline updates:**
- **Known limitations:**
- **Decision:** Ship / revise / roll back
- **Date:**

---

## Recent changes

Add entries here. Keep unsuccessful attempts too if they reveal useful constraints or recurring failure modes.

### CHG-2026-10-29-01 — Band caps and optional columns

- **Status:** Verified (unit tests, corpus run); not yet checked in a browser by the owner
- **Related issue / decision:** DEC-2026-10-29-01, plan tasks BAND and OPT
- **Problem addressed:** A good average hid mostly-empty or mostly-invalid columns; blank-by-design columns led the fix list.
- **Files / components changed:** src/data/score.ts, src/data/optional-columns.ts, src/data/name-hints.ts, src/data/dq-issues.ts, src/ui/quality-layout.ts, src/ui/quality-page.ts, src/ui/optional-marks.ts, src/ui/app.ts
- **Tests run and results:** test/band-optional.test.ts (7), full unit suite 1002 pass.
- **Known limitations:** Optional marks are session-only.
- **Decision:** Ship. Thresholds accepted by the owner as a starting point.
- **Date:** 2026-10-29

### CHG-2026-10-29-02 — Mixed formats and plausible ranges in Validity

- **Status:** Verified (unit tests, corpus run, e2e); not yet checked in a browser by the owner
- **Related issue / decision:** plan tasks T7 and T9
- **Problem addressed:** A date column written several ways, a numeric column with currency symbols on some values, and impossible values (age 999) did not lower Validity.
- **Scope:** Exact counts at load: `dateFormats`, `numberSymbols`, `rangeViolation` on each column. Three new Validity checks, three new fix-list issues, rows-affected includes them. Fixes: date standardise (toDate op), strip symbols (toNumber op), both undoable Recipe steps. Plausible ranges: age 0-120, percent 0-100, year 1900 to next year, gated by whole-word name hints and by the values looking like that thing.
- **Explicit non-goals:** Auto-fix for ambiguous day/month order or dates with times (review only); editable range rules; Show rows filter for these three checks (the column is flashed instead); negative quantities (stay with the existing non-negative finding).
- **Files / components changed:** src/data/date-formats.ts, number-symbols.ts, plausibility.ts, score.ts, dq-issues.ts, dq-rows.ts, column.ts, name-hints.ts, src/worker/protocol.ts, search.worker.ts, src/ui/app.ts, scripts/lib/profile.ts
- **Tests run and results:** date-formats, number-symbols, plausibility, dq-rows-formats; unit suite 1017 pass; e2e 38 pass, 1 flaky setInputFiles timeout that passes alone.
- **Regression findings:** Thousands separators beside short numbers (UCS "35,793" vs "950") were a false positive; grouping now only counts as a second style when a plain 4+ digit value shows the column is not written that way throughout.
- **Known limitations:** Real corpus mixes found: Ask A Manager salary (221 grouped vs 77 plain).
- **Decision:** Ship.
- **Date:** 2026-10-29

### CHG-2026-10-29-03 — Exceptions export (E1) and Apply all safe fixes (T12)

- **Status:** Verified by unit tests; not yet checked in a browser by the owner
- **Related issue / decision:** plan tasks E1 and the apply-all part of T12
- **Problem addressed:** Findings could not be handed to someone who fixes the source system, and the Issues tab had no one-step way to apply every safe fix.
- **Scope:** "Download exceptions CSV" on the Quality hero: one row per failing cell (row, column, check, dimension, severity, value, reason), built in the worker with the same predicates as the scored checks. Values in sensitive-flagged columns are masked unless "Include raw values" is ticked. Values that start like a formula are neutralised. Optional columns do not list their empty cells. "Apply all N safe fixes…" on the Issues tab opens the existing combined preview; each fix stays its own undoable step.
- **Explicit non-goals:** Per-check download buttons on the cards (the worker request already takes a check id); true streaming (the file is built in one message; a confirm appears above 100k rows); a 250k-row timing benchmark.
- **Files / components changed:** src/data/dq-exceptions.ts, src/worker/protocol.ts, search.worker.ts, src/ui/worker-client.ts, app.ts, quality-layout.ts, quality-page.ts
- **Tests run and results:** test/dq-exceptions.test.ts (4).
- **Known limitations:** The exception count can differ slightly from a check's "fail" count where one cell trips several checks; each cell is listed once, under its first reason.
- **Decision:** Ship.
- **Date:** 2026-10-29

### CHG-2026-10-29-04 — Per-column score (part of C1)

- **Status:** Verified by unit test; not yet checked in a browser by the owner
- **Related issue / decision:** plan task C1
- **Scope:** `columnScore(score, column)` applies the dataset formula to one column's checks (pass rate per dimension, optional blanks at reduced weight, weighted by the dimension weights over the dimensions that apply). Shown as a number on each column card in the health strip, with the working in the tooltip.
- **Explicit non-goals:** The profile drawer additions (percentiles, top-10 values, dominant format in words, recommended rules) and virtualised cards for 71+ columns; the existing column inspector is unchanged. Dataset-level checks (duplicate rows) have no column, so they are not in any column score and the column scores do not average to the dataset score.
- **Files / components changed:** src/data/score.ts, src/data/dq-issues.ts, src/ui/quality-layout.ts, src/ui/app.ts, src/styles.css
- **Tests run and results:** test/band-optional.test.ts (8); unit suite 1022 pass.
- **Decision:** Ship.
- **Date:** 2026-10-29

### CHG-2026-10-29-05 — Quality page states (STATES), tests only

- **Status:** Verified (4 new browser tests); screenshot baselines not captured
- **Related issue / decision:** plan task STATES
- **Scope:** The clean-file empty state, the 71-column strip collapse, the post-fix "Fixed this session" group, dark theme and the exceptions download already existed; tests now cover a clean file, a wide file, 390px width with no sideways scroll, a dark-theme contrast sanity check, and the exceptions download.
- **Explicit non-goals:** Screenshot baselines for B/D in both themes; axe run; designed loading and error states beyond the skeleton; score animation.
- **Files / components changed:** test/e2e/quality-layout.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-29-06 — Overview shows the Quality page's issue count (UNIFY, part)

- **Status:** Verified (browser test); not yet checked by the owner
- **Related issue / decision:** plan task UNIFY
- **Scope:** The Overview's "N issues found — Review all" button used its own rough count. It now reads the same issue list as the Quality page ("X issues need fixing · Y worth reviewing") and opens the Quality page. The old count remains only as a fallback before a score exists.
- **Explicit non-goals:** Showing the full issue cards on the Overview; Reports (no separate Reports view was found); retiring the old triage panel, which is still in the code but no longer reached from the Overview button.
- **Files / components changed:** src/ui/overview.ts, src/ui/app.ts, test/e2e/quality-layout.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-29-07 — Near duplicates, suggested pair checks, rules, history, reference accuracy, reports, accessibility

- **Status:** Verified by unit and browser tests; not yet checked in a browser by the owner
- **Related issue / decision:** plan tasks DUPK, T10, R1, R2, S1, REF, REP, SEC, A11Y, DOCS, BENCH-PII, BENCH-PERF; DEC-2026-10-29-02, -03, -04
- **Scope:** Rows equal once an id column is ignored appear as a review item. Name pairs (start/end, created/updated, min/max) become scored consistency checks that can be turned off. Rules tab with recommender, editor, scored checks, a versioned rules file and emitters. History tab with trend and drift. Offline reference lists give Accuracy. HTML report and a message for the data supplier. Help text rewritten for the new page. Axe checks on every Quality tab in both themes (two contrast bugs fixed). A labelled PII benchmark in `npm test` (it found, and this change fixes, version strings read as IP addresses and `1950-2200` ranges read as phone numbers; numeric phone and card columns are now scanned). `npm run bench:dq` in the gate.
- **Also in this change:** Fitness profiles (src/data/fitness.ts; a picker in Score & weights; Sharing starts exports on Mask) and a headless check (`npm run check -- data.csv --rules=rules.json --min-score=80 --exceptions=out.csv`, scripts/lib/check.ts) with a parity test.
- **Explicit non-goals:** Screenshot baselines; saving optional marks or rules across browser restarts; "sharing" raising sensitive flags to review; leakage/constant-column checks for the machine-learning profile; user-overridable semantic types.
- **Files / components changed:** src/data/{near-duplicates,rules,history,reference}.ts, reference/*, pair-checks.ts, dq-report.ts, sensitivity.ts, text-profile.ts, semantic-type.ts; src/ui/{rules-panel,history-panel}.ts, app.ts, quality-page.ts, quality-layout.ts; bench/dq.ts; tests.
- **Date:** 2026-10-29
