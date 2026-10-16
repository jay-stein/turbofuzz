# Plan: Datetime Conversion Fixes (bird_tracking case)

> Status: **Step 1 shipped; steps 2–5 proposed**
> Date: 2026-10-16
> Trigger: user report — `bird_tracking.csv` `date_time` (`2013-08-15 00:18:08+00`) could not be converted to a date/datetime; poor discoverability; silent failure.

---

## 1. What was reported

- Convert text → date on `date_time` "didn't work", with **no failure message**.
- The convert feature was **hard to find**; the user suggested a type-ahead toolbar that fuzzy-matches operations.
- The value is "clearly a datetime with maybe a timezone" — the parser felt fragile.

## 2. Investigation (all verified with repros)

**Parser repro (before the fix):**

| Value | Result |
|---|---|
| `2013-08-15 00:18:08+00` (the bird data) | **NaN / null** |
| `2013-08-15 00:18:08+00:00` | parses |
| `2013-08-15 00:18:08+0000` | parses |
| `2013-08-15 00:18:08Z` | parses |
| `2013-08-15 00:18:08z` (lowercase) | **NaN / null** |
| `2013-08-15T00:18:08+02` (hour-only offset) | **NaN / null** |

**Root cause chain:**

1. `ISO_DATETIME` (`src/parse/dates.ts:7`) required the offset minutes: `[+-]\d{2}:?\d{2}` — `+00` fails. Lowercase `z` also failed (uppercase `Z` only).
2. The anti-degradation guard (`dates.ts:230`) then returns null for *any* `YYYY-MM-DD<T| >` that didn't match — so **every cell in the column failed** classification.
3. Inference needs ≥95% parse (`infer.ts:198`) → the column stayed **text** on load. (Datetime *is* a supported type; inference would have produced `datetime` + `timeZoneAware` if parsing worked.)
4. Conversion path: `toDate` clean op parses with `parseDate`; unparseable values are **returned unchanged** (`clean-ops.ts:70`) → zero cells changed.
5. Feedback: `applyQuickClean` (`app.ts:3468`) toasts success unconditionally — "Convert to date … applied" even when nothing changed. Hence the silent failure.
6. The "Convert to date" op outputs **date-only** (`toDateInputValue` → `YYYY-MM-DD`); even a successful conversion truncates the time, and there is **no "Convert to datetime"** op anywhere.
7. A fuzzy command palette already exists (Ctrl/Cmd+K) with a `date` verb (`command-bar.ts:41`, aliases `todate`, `convert date`) — no `datetime` verb, no explanatory failure, and low discoverability.

**Blast radius:** inference, all convert-to-date entry points (column ⋯ menu, column inspector, Clean panel), the "Convert to date" suggestion, plus sort/filter/axis/export behaviour that depends on the column being typed datetime.

## 3. Fix steps

### Step 1 — Parser accepts real-world ISO offsets ✅ (shipped this commit)

- `ISO_DATETIME` now accepts `±HH`, `±HHMM`, `±HH:MM`, `Z` and `z`; offset range validated (±14 h, minutes ≤ 59).
- Verified end-to-end on the real file: `date_time` loads as **`datetime` with `timeZoneAware: true`** — no conversion step needed at all.
- Tests: `test/temporal.test.ts` gains hour-only offsets, lowercase `z`, and the exact bird-tracking format (type, awareness, instant math).

### Step 2 — "Convert to date & time" (`toDateTime`) op (P1)

- New clean op storing the canonical **UTC instant** ISO (`toDateTimeValue`, offset normalised) so the time is never lost; inference then types it `datetime`.
- Surface in: Clean panel op list, column ⋯ menu and inspector quick actions, command verb `datetime` (+ aliases `datetime`, `convert datetime`).
- Rename the existing op label to **"Convert to date (date only)"** so the truncation is explicit.
- Recipes: pandas `pd.to_datetime(col, utc=True)`; polars `pl.col(c).str.to_datetime(time_unit="us", utc=True)` (with support-report notes).

### Step 3 — Truthful feedback for instant cleans (P1)

- Before applying a cast op (`toDate`, `toDateTime`, `toNumber`) from an instant path, run the existing `cleanPreview`:
  - **0 changed** → warning toast: `Nothing changed — 61,920 of 61,920 values don't parse as dates (e.g. “…”). [Open Clean panel]` and do **not** record a step.
  - **Partial** → `Converted 54,000 cells · 7,920 left unchanged` + Undo.
  - **Full** → current success toast.
- Add the changed count to parameter-free ops too (`Trim applied — 12,301 cells changed`), reusing the preview count.

### Step 4 — Discoverable operations toolbar + palette coverage (P2)

- Visible **"Do something… ⌘K"** control in the workspace toolbar that opens the existing fuzzy command palette, placeholder cycling examples (`convert date_time to datetime`, `round amount to 2 dp`, `trim customer_name`).
- Palette: add the `datetime` verb; audit that every clean op has a verb; when a verb matches but nothing can parse, explain: `date_time: 0% of values parse as dates — first problem “2013-08-15 00:18:08+00”`.

### Step 5 — Acceptance (P1/P2 together)

- Live `bird_tracking.csv`: `date_time` auto-types as datetime on load; charting/sorting/filtering work immediately.
- A messy copy (mixed `+00`, `+05:30`, `Z`, no-offset, and a few broken values) converts through all four entry points with identical results and exact counts; partial failures always state counts.
- No conversion path can silently truncate time: date-only is labelled, and zero-change conversions never report success.

## 4. Decisions & notes

- Canonical datetime storage stays a **UTC instant** (existing data model); `timeZoneAware` drives axis/display behaviour.
- Keep `toDate` for genuinely date-only workflows, with the clearer label.
- Audit `parseOffsetMinutes` (date-combine helper) for `±HH` while in the area — it already accepts `+10:30`, `-0500`, `Z`, `UTC+2`.
- Repro artefacts used during investigation live in the temp workspace (not committed): offset matrix and the real-file column check.
