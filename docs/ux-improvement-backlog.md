# TurboFuzz — UX Improvement Backlog: Data Quality & Charts

**Scope:** Data Quality view (`QualityPage`) and Charts (`ChartsPanel`, chart setup, chart cards) only.
**Intent:** Small steps you can ship one at a time, not a redesign. Every item fits the existing local-only, no-server setup (CSP `connect-src 'none'`).
**Context used:** governance docs 01–04, `plan.md`, `plan-data-quality.md`, `src/ui/quality-page.ts`, `src/ui/chart-panel.ts`, `src/ui/chart-setup.ts`.

> **Coverage gaps.** `src/ui/chart-card.ts` came back truncated (only the imports were readable). `src/quality/score.ts` returned 404. `chart-gallery.ts`, `chart-utils.ts`, `chart-bins.ts` and the legacy `quality-panel.ts` were not reviewed. Anything below about how a card renders or how the score is calculated is based on the panel and page code, not on those files. Check before you build.

---

## A. Data Quality: audit summary

**What works**
- The page reads clearly from top to bottom: score ring → facts bar → dimension cards → "What to fix first" → full checks table → column × dimension matrix.
- Six well-known dimensions (Completeness, Validity, Uniqueness, Consistency, Timeliness, Accuracy). Users can change the weights and bands, and the changes are saved.
- "What to fix first" (top 5) is the right idea: it puts priorities ahead of raw detail.

**Friction**
1. **The empty state teaches nothing.** "Load a file to see its data-quality dashboard" doesn't say what is measured or why it matters.
2. **The score can't be explained from the page.** Weights and bands sit in a settings panel that is hidden by default, so a user who sees "72" can't tell what produced it.
3. **Scope is unclear.** Reports mix dataset-level checks with current-rows checks, and no scope label is shown. Users can't tell whether a filter changed the numbers.
4. **"What to fix first" is a dead end.** It names problems but doesn't take the user to the affected column or rows.
5. **The matrix looks complete but isn't.** It shows only Completeness and Validity (hardcoded), yet sits under a six-dimension header.
6. **A small inconsistency hurts trust.** The keyboard hint says "1–5" when there are six tabs.
7. **A hidden capability.** SodaCL / dbt / Great Expectations / Deequ emitters exist in code, but the live page doesn't offer them.

## B. Charts: audit summary

**What works**
- The left rail of chart types uses `fitChartKind` to grey out types that don't fit the current columns and gives a reason. This is good guidance.
- The setup dialog fits each chart kind (multi-select for correlation, X/Y, measure + timeline for KPI, and so on), traps focus properly, and has a confirmation guard.
- Card configs refer to columns by name, so renaming a column doesn't break a chart.
- The layout control (1–4 per row) and the PNG export size control are simple and clear.

**Friction**
1. **Charts disappear without warning.** If a column a card uses is dropped, the card is removed with no message. To the user this looks like lost work.
2. **No source label on cards.** Charts can come from the filtered table or a saved View, but a card doesn't say which, or how many rows it plots.
3. **Validation errors are vague.** "Pick valid columns" doesn't say which field is wrong or why.
4. **The empty state is passive.** "No charts yet — use '+ Add chart'…" ignores the fit information already worked out for the rail.
5. **Disabled-tile reasons may be mouse-only.** If the reason only appears on hover, keyboard and screen-reader users can't see it (not verified, because the card and gallery code wasn't readable).

---

## C. Top 10 improvements (ranked)

Ranked by user value relative to effort and risk. **S** = under a day, **M** = 1–3 days.

| # | Improvement | Area | Effort | Why this rank |
|---|---|---|---|---|
| 1 | Replace silent card removal with an "orphaned" card that offers **Rebind** / **Remove** | Charts | M | Silently losing work does the most damage to trust |
| 2 | Show a scope label ("Whole dataset" vs "Current rows: N of M") on DQ sections and reports | DQ | S | Without it, users can misread the numbers |
| 3 | Add a "How this score is calculated" line under the score ring: weights inline, a link that opens settings | DQ | S | Makes the main number explainable |
| 4 | Make "What to fix first" items clickable: select the column or apply a filter for the failing rows | DQ | M | Turns the diagnosis into a next step |
| 5 | Add a source caption to every chart card ("Table · filtered · 1,240 rows" / "View: Q3 sales") | Charts | S | Tells users where each chart's data comes from |
| 6 | Make setup validation errors specific to the field ("Y must be numeric — 'Region' is text") | Charts | S | Cuts down on trial and error |
| 7 | Rewrite the DQ empty state: one-line purpose plus the six dimensions with one-line definitions | DQ | S | Teaches users at the point they first arrive |
| 8 | Turn the Charts empty state into 2–3 one-click suggestions taken from `fitChartKind` results | Charts | S | Reuses logic that already exists |
| 9 | Label the matrix honestly ("Completeness & Validity by column") or add the remaining column-level dimensions | DQ | S (label) / M (extend) | Removes a misleading impression |
| 10 | Fix the keyboard hint to "1–6"; make disabled-tile reasons focusable and announced (`aria-describedby`) | Both | S | Cheap consistency and accessibility fixes |

**Deferred on purpose:** exposing the SodaCL/dbt/GX/Deequ emitters. It's valuable, but it adds a new feature area rather than fixing friction, and it needs its own scope decision. Handle it as a separate epic once items 1–10 have shipped.

---

## D. Implementation increments

Each increment can ship and be reverted on its own. Order: trust fixes first, then explainability, then guidance.

### Increment 1: Quick consistency fixes *(items 10, 9-label)*
- Change the keyboard hint to "1–6".
- Rename the matrix heading to say which dimensions it shows.
- Make disabled rail tiles keyboard-focusable and link each one to its reason text.

**Acceptance criteria**
- The hint text matches the number of tabs actually rendered (work it out from the tab list, don't hardcode it).
- The matrix heading names exactly the dimensions present in the matrix data.
- Tabbing to a disabled tile exposes its `fitChartKind` reason through `aria-describedby`. Activating it doesn't open setup.

### Increment 2: No silent chart loss *(item 1)*
- When a card's saved column no longer resolves, render an orphaned state: "Column 'X' is no longer in this table" with **Rebind** (opens setup with the other fields pre-filled) and **Remove**.

**Acceptance criteria**
- Dropping a column used by a card never reduces the card count by itself.
- Rebind keeps the card's position, chart kind and the columns that still resolve.
- Remove is the only way an orphaned card leaves the grid.
- Reloading the file with the column restored brings the card back automatically.

### Increment 3: Scope and source labels *(items 2, 5)*
- Shared helper: `describeScope({ total, visible, filtered, viewName })` returns a short string.
- Use it in DQ section headers, reports and chart card captions.

**Acceptance criteria**
- With no filter, DQ and charts show "Whole dataset (M rows)".
- With a filter, the label shows "Current rows: N of M", and it updates when the filter changes.
- Cards sourced from a View show the View name.
- Every report section is labelled with one of the two scopes. None is unlabelled.

### Increment 4: Explainable score *(item 3)*
- Under the ring, add one line listing each dimension's weight and its contribution, plus a "Adjust weights" link that opens the existing settings panel.

**Acceptance criteria**
- The contributions shown add up to the displayed score (to within rounding).
- Changing a weight in settings updates the line immediately and still saves.
- The settings panel stays hidden by default. The link is the only new way to open it.

### Increment 5: Actionable fix list *(item 4)*
- Each "What to fix first" item becomes a button. Column-level issues select or scroll to the column. Row-level issues apply a filter that isolates the failing rows.

**Acceptance criteria**
- Every item does at least one visible thing when clicked. None is inert.
- Filters applied this way are ordinary filters: visible, and removable with the existing controls.
- After the filter is applied, the scope label (Increment 3) reads "Current rows".

### Increment 6: Guidance in empty states and setup *(items 6, 7, 8)*
- DQ empty state: purpose sentence plus the six dimension definitions.
- Charts empty state (when data is loaded): up to 3 suggested chart kinds, ranked by `fitChartKind` result, each opening setup pre-filled.
- Setup: replace "Pick valid columns" with one error per field.

**Acceptance criteria**
- Suggestions only include kinds that `fitChartKind` rates as fitting the current columns.
- Every setup validation failure names the field and the reason. The generic message is gone.
- The empty-state text is static and needs no data, so it renders before a file is loaded.

---

## E. Test protection per increment

The current suite has 650 tests (~12s), with no browser E2E, visual regression, accessibility automation or CI. **Test file names weren't checked during this audit.** Map each line below to the matching suite in `tests/` before you start.

| Increment | Existing tests that should keep passing | Tests to add (unit-level, same runner) |
|---|---|---|
| 1 | Tests for tab registration / keyboard shortcuts; `fitChartKind` tests | Hint text derived from tab count; disabled tile has `aria-describedby` and doesn't open setup |
| 2 | Chart config persistence and column-rename survival tests | Dropping a column keeps the card count; rebind keeps kind and position; the restored column revives the card |
| 3 | Filter / result-set tests; View source tests; report generation tests | `describeScope` truth table (no filter / filtered / view); every report section carries a scope |
| 4 | DQ scoring, weight and band tests; settings persistence tests | Contributions add up to the score; a weight change recomputes the line |
| 5 | Filter application tests; DQ check output tests | Each fix-list item type maps to a defined action; the generated filter matches exactly the failing rows |
| 6 | Chart setup dialog tests (cancel/escape/confirm, focus trap); `fitChartKind` tests | Per-field error messages for each setup branch (correlation, X/Y, KPI, box, heatmap, single); suggestions ⊆ fitting kinds |

**Cross-cutting recommendation:** before Increment 2, add a small DOM-level smoke test for `QualityPage` and `ChartsPanel` mount and render, using the runner's existing DOM environment if there is one. Increments 2–6 change what is rendered, and today nothing checks rendered output end to end. A lint step and a minimal CI job that runs the 650 tests would protect every increment cheaply.

---

## Assumptions to verify before Increment 2 and Increment 4
- Where card removal actually happens: `chart-panel.ts` or `chart-card.ts` (the card file wasn't readable).
- Whether the score is a plain weighted mean of dimension scores (`score.ts` wasn't readable). Increment 4's "contributions add up" criterion assumes it is.
- Whether disabled-tile reasons are already exposed to assistive technology (Increment 1 may already be partly done).