# TurboFuzz — UX, aesthetics and urgency review (2026-10-08)

> **Partly superseded** by `turbofuzz_ux_screenshot_review_20261008.md`, written after seeing the live UI. Several items below (sample data, privacy line, timings, before/after preview, red ×, left-rail stepper) were wrong or already exist; see its §1.

Companion to `turbofuzz_review_20261008.md` (security, performance, missing capabilities, fixture test plan). This file answers the UX half properly and maps every part of your original brief.

## 0. Evidence basis (so you can weigh each finding)

I cannot render or click through the live app (JS single-page app; my fetcher sees only the `<head>`, my sandbox can't reach `workers.dev`). What I have is: live headers (your `curl -I`), your Network-tab check, `index.html`, `package.json`, `plan.md`, and `next_steps.md`, whose section 8 describes the current UI in detail (inline chips, header menu, row/column ×, Steps list, Clean/Transform panels, export dialog).

Each finding carries **confidence**: **H** = stated in your own docs, **M** = follows directly from documented behaviour, **L** = hypothesis to confirm on screen. **Severity** uses Nielsen's 0–4 scale (4 = blocks or corrupts the task).

## 1. Your brief, mapped

| You asked for | Answer | Where |
|---|---|---|
| Very structured critical feedback | Heuristic evaluation, task-flow walkthrough, ranked backlog with severity/confidence/effort | §2, §4 |
| Try out the tool | Partly. Headers and network behaviour verified; UI analysis is document-based (see §0). Three screenshots would convert M/L findings to H (§7) | §0, §7 |
| Clear recommendations to improve UX | 6 structural changes + 14 specific fixes | §2 |
| Aesthetic improvements | Design system, tokens, table and panel specifics | §3 |
| What is urgent | One ranked list across UX, security, correctness, performance; "this week" cut | §4 |
| Missing cleaning/transform abilities | Ranked top 12 here; full tiered table in companion §7 | §5 |
| Aim: lightning fast, low latency, in-browser, totally secure | Scorecard with evidence and how to prove each | §6 |

## 2. UX analysis

### 2.1 What the product is for (design against these jobs)

1. **Clean once:** messy export in → trustworthy file out, fast.
2. **Review:** "what is wrong with this data?" and "is my cleaned version right?" (the *reviewer* half of your pitch).
3. **Repeat:** the same cleanup on next month's file.

Targets worth adopting: first file loaded to first fix applied ≤ 30 s; load → fix whitespace in one column → export ≤ 6 interactions; any mistake recoverable in 1 action.

### 2.2 Six structural findings (the big ones)

| # | Finding | Evidence | Sev | Conf | Recommendation |
|---|---|---|---|---|---|
| S1 | **Export scope trap.** CSV export covers the *filtered result set*. A user who filters to inspect, then exports, silently ships a partial file. | `next_steps.md` §2 Export | 4 | H | Export dialog states scope in numbers ("20,412 rows after steps" / "237 rows match current filters"), defaults to **all rows after steps**, shows a banner when filters are active. |
| S2 | **Four commit models.** Header-menu delete = immediate + "Are you sure?"; row/column × = stage then confirm; Transform = stage then "Apply transforms"; Clean = preview then apply. Users must relearn when a change takes effect and can forget to apply. | §8 | 3 | H | One model: **every change is an immediately applied Step with Undo**. Your engine budget (<500 ms) makes this feasible. Keep preview as a hover/before-after, not a mode. Only >300 ms ops get a progress bar with cancel. Keep staging only for bulk row selection. |
| S3 | **No triage view.** The user hunts column by column through chips. Nothing answers "what's wrong with this file, worst first?" | chips are per column | 3 | M | **Issues panel** (a linter): ranked list ("7 columns have leading/trailing spaces · 3 columns mix numbers and text · 1,000 duplicate rows · 4 columns have mergeable variants"), each with *Show rows* and *Fix…* (preview, then apply). Deterministic rules, no AI needed. This is the reviewer feature. |
| S4 | **Row-count provenance unclear.** There are three counts (loaded, working set after deletes/steps, filter matches). | working-set vs filter described separately | 3 | M | Persistent status bar: `21,000 loaded → 20,412 after steps → 237 match filters · last step 212 ms`. Click a segment to see what removed rows. |
| S5 | **History is not a single spine.** Null-resolution isn't in Steps; index-based row deletions can't replay on a new file; Steps is a "drawer" rather than the primary object. | §8 | 3 | H | Steps panel always visible (right rail); every action from every entry point appears there. Mark each step *replayable* (rule-based) or *manual* (row indices). Recipe save/load excludes manual steps and says so. |
| S6 | **Five entry points to change data** (chips, header menu, ×, Clean, Transform) with no shared discovery. The right-click menu has no visible affordance, touch or keyboard equivalent. | §8 | 3 | M | Add a ⋯ button in each header (same menu), a command palette (Ctrl/Cmd+K), and make every chip open a small popover: *Show rows · Fix…*. |

### 2.3 Heuristic evaluation (Nielsen)

| Heuristic | Finding | Sev | Conf | Fix |
|---|---|---|---|---|
| 1. Visibility of status | Commit time and row provenance not shown; load shows progress only if implemented as planned in `plan.md` §16 | 3 | M | Status bar (S4); show "Applied in 212 ms"; determinate progress with rows/s for load and long ops |
| 2. Match with real world | **Term drift:** "Nulls" (QA toggle, Clean tab), "empties" (chip), "missing" (impute). Also "Duplicates" vs "mergeable" vs "dedupe" | 2 | H | One vocabulary: **Missing**, **Duplicates** (identical), **Similar** (fuzzy). Apply to chips, toggles, panels, Steps |
| 3. User control and freedom | Undo exists via Steps list; null-resolution not undoable; no documented Ctrl+Z; no "reset to source" | 3 | H | Ctrl+Z/Shift+Z, **Reset to source**, undo toast after every action |
| 4. Consistency | Commit models (S2); red used for every × and for staged state; blue only for "Add step" | 3 | H | S2; colour semantics in §3 |
| 5. Error prevention | "Are you sure?" on an *undoable* column delete is friction without protection; real traps are unguarded (type conversion, all-columns apply, export scope) | 3 | H | Replace confirmations on undoable actions with undo toasts; add guards where loss is silent: conversion reports, per-column scope, export scope (S1) |
| 6. Recognition over recall | Right-click menu hidden; chip meaning relies on colour; op semantics (exact-match per-column nulls) unexplained | 2 | M | ⋯ button, chip icons + counts, one-line op descriptions under each control |
| 7. Flexibility and efficiency | Fast engine, but no shortcuts, palette, recipes or "apply to similar columns" | 2 | M | Palette, shortcuts, recipes (companion §7) |
| 8. Minimalist design | Header carries name, type, up to five chips, ×, histogram, filter | 2 | M | Quality bar + detail on demand (§3.3) |
| 9. Recover from errors | HDF5 rejection message is good (documented). Unknown for: bad encodings, ragged rows, oversize files, unparseable cells | 3 | H/M | Every failure states what, where (row/column), and a next action; list unparseable cells instead of blanking them |
| 10. Help and docs | One hint line on Add step; no README; no sample data | 2 | H | **Try sample data**, README, inline op help, "How your data is handled" panel |

### 2.4 Task-flow walkthrough

| Flow | Friction (documented or implied) | Fix |
|---|---|---|
| **First run** | Unknown landing state; value takes effort to see | Landing: drop zone, Paste, Try sample, supported formats and size limits, one privacy line. Sample opens with the Issues panel populated |
| **Load** | Load is "done" but encoding, BOM, header-row, preamble/totals rows, ragged rows, merged cells aren't listed. Worksheet picker shows dimensions only | Post-load **Import summary**: encoding, delimiter, header row, N ragged rows, N rows skipped, type guesses, each editable in place. Sheet preview (5 rows) |
| **Diagnose** | Chip-by-chip hunting | Issues panel (S3) |
| **Clean a column** | chip → filtered rows → right-click → Clean panel → op → preview → apply (≥6 steps) | Chip popover → *Fix…* → preview with "N cells changed + 5 examples" → apply (3 steps) |
| **Dedupe / merge** | Exact duplicates shown as *all copies* (good for comparison) but removal is a separate transform; fuzzy merge is a chip | One **Duplicates** workspace: exact + similar, side-by-side groups, choose survivor, per-field rules, count of rows removed |
| **Reshape** | Structural transforms clear filters and change columns; staged apply | Say so before applying ("filters will be cleared"), restore on undo, apply immediately (S2) |
| **Verify** | No before/after or reconciliation | **Compare mode** (original vs current for a column) and a **reconciliation strip**: rows in/out, sums of numeric columns before/after, missing counts before/after. Standard audit practice for finance-type data |
| **Export** | Scope trap (S1); formats beyond CSV pending | S1, plus BOM/delimiter/null options, clipboard-as-TSV, recipe export |
| **Repeat** | Nothing | Recipe load → column-drift check ("Amount missing, Date now text") → apply → report |

### 2.5 Fourteen specific fixes

1. Chip click opens a popover (*Show rows · Fix…*), not just a filter.
2. Header ⋯ menu mirrors the right-click menu; both list the shortcut.
3. Replace row × with a checkbox column; toolbar "Delete N rows".
4. Remove "Are you sure?" on undoable deletes; add undo toast (6 s).
5. Persistent **Reset to source** with step count.
6. Steps panel entries show op, column, cells changed, time, and *Show rows*.
7. Per-step toggle (disable/enable without deleting) for what-if exploration.
8. "Apply to all columns": default to type-appropriate columns, show counts, per-column exclusion.
9. Conversion reports: per-format counts and unparseable-cell list.
10. Fuzzy results: show *why* it matched (matched tokens, score) and a threshold slider.
11. `beforeunload` guard when Steps exist; recipe save.
12. Search box always visible, `/` to focus, match highlighting.
13. Empty states for each panel say what it does and the first action.
14. Sheet picker preview and import summary (above).

## 3. Aesthetics

All **L–M** confidence: I haven't seen the visuals. Treat as a checklist against the live UI.

### 3.1 Principles for a speed-first data tool
Calm, dense, neutral. Colour is reserved for **meaning**, motion for **continuity only**, and the data is the most prominent thing on screen.

### 3.2 Specific recommendations

| Area | Recommendation |
|---|---|
| Type | One UI sans (system stack); `font-variant-numeric: tabular-nums` in cells; monospace only for ID/code columns; sizes 11/12/13/15 px |
| Density | Row height tokens 24/28/36 px with a toggle; default 28 |
| Table | Sticky header and first column; right-align numbers, left-align text, centre booleans; hairline row borders, no zebra; truncate with ellipsis, full value on focus/hover; column resize and pin |
| Invisible characters | Show space/NBSP/zero-width/newline as faint glyphs in a "Show whitespace" mode and always in the cell editor; this is the signature cleaning feature visually |
| Header | Name, type icon, **quality bar** (valid / flagged / missing segments), ⋯ menu. Chip text moves to hover/popover. Histogram only when column is selected |
| Colour roles | Accent blue = primary action and selection · red = destructive only · amber = flagged data · green = fixed/valid · yellow tint = changed by last step · red tint + strikethrough = staged for deletion. Never colour alone: pair with icon or count |
| Panels | Left: filters. Centre: table. Right: Steps and active op panel. Stage stepper stays slim; panels don't take over the screen |
| Motion | None on data. 100–150 ms fades for panel/popover only. Determinate progress for anything >300 ms |
| Themes | You declare `color-scheme: light dark`; ship tokens for both plus a manual toggle |
| Identity | Name reads "fuzz"; add a one-line tagline in the header ("Clean, reshape and search tables. Nothing leaves this tab.") and a simple mark so the app is recognisable in tabs and screenshots |
| Accessibility | `role="grid"` with `aria-rowcount` for the virtualised body; focus ring ≥ 3:1; live region for result counts; chips are buttons; contrast ≥ 4.5:1 for text |

### 3.3 Header and step anatomy

```
 Amount  #  ⋯            Customer Name  Aa  ⋯
 ██████████▒▒░ 94%        █████████▒░░░ 88%
 valid ▒ flagged ░ missing     (hover: 594 missing · 12 outliers · Fix…)

 Steps                                           Reset to source
 1  Trim + collapse spaces · Customer Name        1,203 cells · 38 ms   ↶  ⏸  Show rows
 2  Treat -999 as missing · Amount                412 cells  · 21 ms   ↶  ⏸  Show rows
 3  Delete 5 rows (manual)                        not replayable        ↶
 Status:  21,000 loaded → 20,412 after steps → 237 match filters
```

### 3.4 Starter tokens (paste into your stylesheet and adjust)

```css
:root {
  --font-ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-data: ui-monospace, "Cascadia Mono", Consolas, monospace;
  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px;
  --row-h: 28px; --radius: 6px;
  --bg: #fafbfc; --surface: #ffffff; --surface-2: #f3f5f7; --border: #d8dee4;
  --text: #1f2328; --text-muted: #59636e;
  --accent: #2563eb; --danger: #c62828; --warn: #b45309; --ok: #15803d;
  --changed: #fff4c2; --staged-delete: #fde8e8;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #13171a; --surface: #1b2024; --surface-2: #232a30; --border: #323a42;
    --text: #e6e9ec; --text-muted: #98a2ad;
    --accent: #6ea0ff; --danger: #ff7b72; --warn: #e3a008; --ok: #4ade80;
    --changed: #3a3410; --staged-delete: #3a1a1a;
  }
}
:root[data-theme="dark"] { /* duplicate the dark block for the manual toggle */ }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
```

## 4. What is urgent — one ranked list

Severity: wrong or lost data / security > trust > friction > polish. Effort estimates are rough.

| Rank | Item | Type | Effort | Do |
|---|---|---|---|---|
| 1 | Upgrade `xlsx` to 0.20.3 (CVE-2023-30533, CVE-2024-22363) | Security | 15 min | This week |
| 2 | **Export scope trap** (S1) | Correctness | 1–2 h | This week |
| 3 | CSP (Report-Only → enforce), `frame-ancestors`, `Permissions-Policy` (attached `_headers`); grep `worker/` for `fetch(` | Security | 1–2 h | This week |
| 4 | Type-conversion guards: leading zeros, 17-digit IDs, ambiguous dates, locale numbers; per-column scope for "Apply to all" | Correctness | 1–2 d | This week |
| 5 | Positioning: GitHub About, `package.json`, README | Trust | 1 h | This week |
| 6 | Run the fixture checklist (companion §9) and fix failures | Verification | 2–3 h | This week |
| 7 | Steps spine incl. null-resolution; `beforeunload` guard; Reset to source | Trust | 1–2 d | Next |
| 8 | Single commit model + undo toasts (S2) | UX | 2–4 d | Next |
| 9 | Status bar with row provenance and timings (S4) | UX | 0.5 d | Next |
| 10 | Issues panel (S3) and chip popovers | UX | 3–5 d | Next |
| 11 | Recipe save/load with replayable/manual marking | Capability | 2–3 d | Next |
| 12 | Dictionary encoding + op fusion | Performance | 3–5 d | Then |
| 13 | Terminology unification, ⋯ header menu, command palette | UX | 1–2 d | Then |
| 14 | Quality-bar header, tokens, whitespace display | Aesthetic | 2–3 d | Then |
| 15 | Fuzzy dedupe workspace; fuzzy lookup/join | Capability | 1–2 wk | Then |

## 5. Missing cleaning and transform abilities (top 12 by value)

Full tiered table with status is in the companion file §7.

1. Fuzzy dedupe with review UI (your engine's edge)
2. Fuzzy lookup/join with match report
3. Recipe save/load and re-apply with drift check
4. Find and replace with regex and live count
5. Split/merge columns; regex extract
6. Calculated columns (safe expression parser, no `eval`)
7. Locale-aware conversion (accounting negatives, %, currency, decimal comma, Excel serials, dd/mm choice)
8. Keep/remove rows by current filter
9. Unicode and whitespace cleanup (zero-width, NBSP, accents, smart quotes, inner collapse)
10. Validation rules (regex, range, allowed set, unique key, cross-column)
11. Pattern/shape profiling and mixed-type breakdown
12. Pivot, window ops, date parts with configurable fiscal year

## 6. Aim scorecard

| Aim | Status | Evidence | Gap | How to prove it |
|---|---|---|---|---|
| **Lightning fast** | 🟡 | Worker, columnar, lazy, cached; self-reported keystroke and facet <50 ms | Clean/Transform commit at 100k rows is "to verify"; per-op rebuilds; string columns not dictionary-encoded | Show timings in the UI; CI thresholds from `bench/`; run 300k fixture |
| **Low latency** | 🟡 | Budget table exists; HTML `no-cache`, edge-cached | Assets' cache headers unconfirmed; full `loaded` payload re-sent after ops | `immutable` assets; send deltas; transferables or `SharedArrayBuffer` (cross-origin isolation is already on) |
| **All in the browser** | ✅ for local files | Your Network tab: nothing after load | URL loader outbound by design; `worker/` unchecked | CSP `connect-src`; grep `worker/`; offline mode |
| **Totally secure** | 🟡 | COOP/COEP, `no-referrer`, `nosniff` | No CSP; vulnerable `xlsx`; export formula injection; decompression bombs unverified | Items 1, 3 and companion §5; add privacy panel; run fixture bomb test |

"Totally" is a strong word; the defensible claim is "your data is never uploaded, and the browser enforces it" once the CSP is on.

## 7. How to convert the M/L findings into H

Send three screenshots (any browser): (1) first screen before loading anything, (2) the table after loading `torture_utf8_bom.csv` with a column header and the filter sidebar visible, (3) the Clean panel mid-operation with a preview showing. Also useful: the result of fixture checks 4, 5 and 10 (long IDs, `0800` postcodes, mixed dates). With those I can grade the visual hierarchy, density and the actual commit flow, and re-rate this document line by line.
