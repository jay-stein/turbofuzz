# TurboFuzz — screenshot-based UX review (2026-10-08)

Supersedes the confidence ratings in the two earlier files wherever they conflict (§1 lists the corrections).

**Evidence:** your four screenshots of the live app with `torture_utf8_bom.csv` loaded: `fuzz_firstscreen.png`, `fuzz_loadscreen_1.png` (full view), `fuzz_loadscreen_2.png` (right-hand scroll), `fuzz_clean_panel.png`. Pixel positions and contrast ratios are estimated by eye from the images. Severity: Nielsen 0–4.

## 1. Corrections to my earlier reviews

| I said | Screenshots show |
|---|---|
| Add a "Try sample data" button | It exists, but as the smallest element on the first screen (small blue link at the bottom) |
| Add a privacy line | Exists: "0 bytes uploaded — files are parsed in this browser" (static text) |
| Show timings | Load time (263 ms) and filter time (<1 ms) already shown; step-commit time unverified |
| Add "N cells changed" + before/after | Clean panel already has "Preview of 5 sample values · 0 of 21,000 cells change" with old → new |
| No triage/profiling | Per-column profile cards exist (top values, histograms, distinct, mean, length, empties). What's missing is ranking and actions |
| Find & replace, exact dedupe, clipboard copy marked missing/unconfirmed | All exist: Find & replace, Duplicates filter + Remove duplicates + Stats Report, Copy, Shuffle-N sample |
| Red × on every row is noisy | They are small muted grey circles. Downgraded |
| Left-rail stepper | Horizontal top stepper: Load · Clean · Transform · View · Export |
| Leading zeros and 17-digit IDs at risk | Handled: `Postcode` and `long_id` are typed **ID / Exact**; `0800` and the 17-digit IDs are intact |
| Locale support missing | Per-column number-format selector ("1,234.56") exists. Detection of conflicting formats is what's missing |

## 2. What's working (keep)

- Profile cards: top values with counts surface problems instantly (`TBC`, `=1+1`, `Actve`).
- **ID / Exact** typing; explicit **Convert to date** instead of silent guessing.
- Inline chips that filter on click, plus `N mergeable` and `constant value`.
- Duplicate detection is accurate: 599 groups / 599 redundant rows against 600 injected. The one-row gap is plausibly one duplicate hit by my ragged-row edit.
- Load speed: 21,000 × 17 in 263 ms. Row numbers and column indices; consistent dark theme.

## 3. Findings

### 3A. Correctness and trust (fix first)

| ID | Finding | Evidence | Sev | Fix |
|---|---|---|---|---|
| A1 | **Silent column drop.** The fixture has 18 columns (last has a blank header and `x` in all 21,000 rows). App reports "17 columns"; sidebar ends at `17 legacy_code`. No notice visible. | loadscreen_1 top bar, sidebar | 4 | Keep as "Column 18 (unnamed)" or ask. **Import summary** listing every dropped, renamed or padded item |
| A2 | **Ragged rows invisible.** `Country` shows "5 empty cells", exactly my 5 short rows, so they were padded silently. The 5 long rows' extra fields appear nowhere. | loadscreen_2 | 3 | Import summary with row numbers and *Show rows* |
| A3 | **Decimal comma likely read as thousands.** Row 11 `Amount` = `613,26` is flagged a value outlier, which implies it parsed as 61,326. Format selector defaults to 1,234.56; mixed formats in one column go undetected. Column typed NUMBER while showing `(4,752.34)`, `$703.70`, `1.157e+04`, `613,26` raw. | loadscreen_1 rows 4–11 | 3 | Per-column format conformance: "653 values look like 1.234,56" → convert or switch. Never parse ambiguous values silently. Show parsed value on hover |
| A4 | **Missing-value sentinels not suggested.** `Date` top values: `TBC` 206 and `00/00/0000` 245 treated as real values; only `n/a` and blanks counted (409). `-999` (row 22, `Amount`) not flagged. | loadscreen_1/2 | 3 | "Suggested missing tokens" under the Nulls tab: frequent values that don't fit the column type or match known placeholders |
| A5 | **Type conflicts silent** (verify). `Score` typed INTEGER; fixture has `n/a`/`high` in ~3%. No chip type for "doesn't parse as integer". | loadscreen_2 | 2–3 | "N don't parse as <type>" chip |
| A6 | **Privacy copy vs scrape.** First screen says "nothing leaves this page" and offers "Load from a URL or scrape a table". Browsers can't fetch most third-party pages directly (CORS), so scraping very likely goes through your Worker; repo has `table_scraper.md` (I couldn't read it). If so, the URL leaves the page. | firstscreen | 3 | Disclose inside that section. Test: DevTools → Network, expand it, load a URL, see where the request goes. If same-origin, set CSP `connect-src 'self'` (stronger than the `https:` in my `_headers`) |
| A7 | **Formula-like cells unflagged.** `Email` top values `=1+1` (108), `@SUM(1,1)` (101), no warning, though export to Excel is the risk. | loadscreen_2 | 2 | "N formula-like cells" chip + export option |

### 3B. Information design

| ID | Finding | Sev | Fix |
|---|---|---|---|
| B1 | **Chrome before data.** First data row starts ≈480 px down a 1,361 px window (~35%): top bar, stepper, Data QA + profile strip (~175 px), toolbar, three chip rows, header. On a ~950 px laptop viewport that's about half the screen | 3 | Profile strip collapsed by default (toggle); one chip row; zero-state chips hidden |
| B2 | "no empty cells / no value outliers / no long values" repeated under most columns is noise | 2 | Show chips only when non-zero |
| B3 | **Each column appears three times:** profile card, sidebar row (type dropdown + ×), table header (+ ×) | 2 | Sidebar = filters for selected columns only; type dropdown in header; profile card opens from header |
| B4 | **"10.8% empty" headline** is about half from `legacy_code` (21,000 of ≈38,500 empty cells) and shown twice (top bar and Data QA) | 2 | Column-based headline ("9 of 17 columns have missing values; 1 entirely empty") + *Drop empty column* |
| B5 | **Outliers and histogram on skewed data.** `Amount` flags 2,531 (12%) as outliers; the histogram is a lone spike because the range runs −52k to 19.8M; mean shown (21,541) is inflated | 3 | Robust fences (MAD, or log scale), show the fences and method; clip histogram to p1–p99 with "N beyond range"; show median beside mean |
| B6 | **Merge only for categories.** `Customer Name` (TEXT) has Smith/Smyth/Smiths and case variants but no mergeable chip | 2 | Enable for text via blocking (phonetic key or n-gram) |
| B7 | **Stepper looks linear but isn't.** View is "step 4" yet is home; Clean opens a drawer; Export is both a step and a toolbar button; Steps button looks disabled | 2 | Tabs: Data · Clean · Transform · Export, with a persistent Steps badge showing the count |

### 3C. Visual design

| ID | Finding | Fix |
|---|---|---|
| C1 | Empties use a saturated salmon fill, outliers a dusty rose: same hue family. Whole-column blocks (`legacy_code`, `Tags`) dominate the screen. White text on the rose is ≈4:1 | Empties: faint hatch or 12–15% tint with ∅. Outliers: amber left-border. Reserve red for destructive |
| C2 | Numbers left-aligned (`Amount`, `Total`, `Score`) | Right-align + `tabular-nums` |
| C3 | "Apply to column": white on pale blue ≈2.5–3:1 | Use `#2f6fe0` (≈4.7:1 with white) |
| C4 | Unlabelled controls: number box beside "Shuffle 100"; the "1,234.56" format dropdown | Label them: "Sample rows", "Number format" |
| C5 | Row height ≈31 px | Density toggle (24/28/36) |

### 3D. Flows and first run

| ID | Finding | Fix |
|---|---|---|
| D1 | **First screen.** Card is ≈240 px right of centre (spans ~1070–1985 of 2576 px), large dead area, minimal header (no theme toggle, help or repo link). "Try sample data" is the weakest element. Archive formats and size limit unstated | Centre the card; make sample a secondary button beside the drop zone; one line of formats and limits |
| D2 | **Clean preview shows the first 5 rows, not changed ones.** With 0 changes it still strikes through identical values, which implies deletion | Sample from changed cells; "No cells change" empty state; no strikethrough when equal |
| D3 | Find & replace has only "Ignore case" | Add regex, whole-cell, live match count |
| D4 | "Apply to all columns" sits under the column picker | Disable the picker when checked; show "affects N columns / M cells" |
| D5 | "Add operation" then "Apply to column": no summary of the queued list | Show the op list and total cells changed above the primary button |

## 4. Fixture results so far (companion §9)

| Check | Result |
|---|---|
| 3 BOM | ✅ first header is `long_id` |
| 4 long_id | ✅ intact on screen (export untested) |
| 5 Postcode | ✅ `0800`, `0200` kept |
| 6 Headers | ❌ blank-header column dropped (A1); ✅ `Total ($)`, `Total (%)`, `Status`/`status` kept distinct |
| 7 Ragged rows | 🟡 padded silently (A2) |
| 9 Amount | 🟡 parens, `$`, scientific handled; ❌ decimal comma (A3); `-999` and `TBC` not treated as missing (A4) |
| 10 Dates | 🟡 typed Text; Convert to date offered; ambiguity handling untested |
| 11 Duplicates | ✅ 599 groups; near-duplicates need fuzzy (expected) |
| 12 Fuzzy merge | ✅ Suburb 9, State 5, Status 2; ❌ none on Customer Name (B6) |
| 13 Export / formula cells | Untested; formula cells unflagged (A7) |
| 14 Scale | 21k loads in 263 ms; 300k untested |
| 1, 2, 8, 15 | Untested |

## 5. Re-ranked urgent list

| Rank | Item | Why |
|---|---|---|
| 1 | A1 silent column drop + A2 Import summary | Data loss with no notice |
| 2 | `xlsx` → 0.20.3 | Known CVEs; 15 minutes |
| 3 | Export scope default (S1 in UX review) | Unverified: send a screenshot of the Export dialog |
| 4 | A3 + A4 format conflicts and sentinel suggestions | Wrong numbers and unrecognised nulls |
| 5 | A6 URL/scrape disclosure + CSP (`connect-src` decision) | Privacy claim accuracy |
| 6 | Quick wins C1–C4, D1, B2 | Half a day; large visible polish |
| 7 | B1/B3/B4 chrome reduction | Data-first layout |
| 8 | Steps spine + single commit model + undo toasts (UX review S2/S5) | Trust and reversibility |
| 9 | B5 robust outliers and histogram | Misleading on skewed data |
| 10 | B6 text merge, fuzzy dedupe and join | Differentiator |

## 6. Quick-win patch list

```css
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.cell-empty { background: repeating-linear-gradient(45deg, rgba(255,140,120,.16) 0 6px, transparent 6px 12px); }
.cell-outlier { box-shadow: inset 3px 0 0 #e3a008; background: transparent; }
.chip[data-count="0"] { display: none; }
.btn-primary { background: #2f6fe0; color: #fff; }   /* ≈4.7:1 */
.first-screen { margin-inline: auto; }               /* centre the card */
.preview-row.same { text-decoration: none; opacity: .6; }
```

## 7. Next evidence that would settle the open items

1. Export dialog (scope default).
2. Steps panel after one operation (e.g., trim on `Customer Name`).
3. DevTools Network after expanding "Load from a URL or scrape a table" and loading a URL.
4. `Date` after **Convert to date** (ambiguous dd/mm vs mm/dd handling).
5. `Score` filtered for non-numeric values; any trace of the 18th column.
6. `torture_cp1252_preamble.csv` load result.
