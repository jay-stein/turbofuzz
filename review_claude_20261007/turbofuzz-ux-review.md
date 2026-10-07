# TurboFuzz — UX review

**Build tested:** `jay-stein/turbofuzz`, branch `agent/pipeline-wiring` @ `6e045f2`, built and served with `vite preview`, driven in headless Chromium (desktop 1440×900, mobile 390×844) plus an axe-core scan.
**Data:** Titanic, Chipotle orders (TSV), Perth/AU rainfall (12 MB, 179k rows), UFO sightings, Spotify tracks (32.8k × 23), vega `movies.json`, FiveThirtyEight recent-grads, and four deliberately messy files (`make_test_data.py`: Windows-1252 European CSV, ragged CSV, messy Excel report, messy values CSV).
**Not tested:** the deployed Worker, URL/scrape loading, Parquet/zip/gz/bz2, real touch devices, screen readers.

---

## Verdict

The engine is genuinely good: fast, forgiving on ingest, and the non-destructive clean model is the right architecture. The UX hasn't caught up to it in three ways:

1. **Silent wrong numbers.** Two ingest paths corrupt data with no warning (European decimals, Excel dates). For a cleaning tool this outranks every design issue.
2. **The product still presents as a search box.** Clean and Transform, your actual differentiators, are modals hiding the data, and the output of cleaning doesn't survive export.
3. **Desktop-only, with accessibility gaps.**

---

## What works (keep it)

- **Speed:** 179k × 11 and 32.8k × 23 reach a usable workspace in under 3 s (including a ~0.8 s settle in my harness). Filters respond in <1 ms.
- **Ingest intelligence:** detected `windows-1252` and `;`; kept `009151` / `00630` / `00001` as IDs; parsed `$3,655.10`, `44%`, `1,832`; treated `NULL`, `N/A`, `-` as empty; skipped Excel title rows and merged a two-row header; offered a worksheet picker.
- **Dedupe** is correct (Chipotle 4,622 → 4,563 = the 59 redundant rows) with a clear "Applied 1 transform step" confirmation.
- **Clean ops are non-destructive**: they persist when you reopen the dialog, with "Revert all". The preview on category columns shows distinct values and "2 would change".
- Privacy line on the first screen; `Esc` closes dialogs; no console errors in any run.

---

## Findings

### P0 — Silent data corruption

**1. Decimal commas are read as thousands separators (100× error).**
Repro: `euro_win1252.csv`. `Umsatz` is 1.00–999.99; app reports **123 – 99,381, mean 47,930**. The file is semicolon-delimited and Windows-1252, which are strong "European locale" signals.
Cause: `src/parse/numbers.ts` does `s.replace(/,/g, "")` unconditionally, so `198,72` → `19872`.
Fix: infer number locale **per column** (a comma followed by 1–2 or 4+ digits cannot be a thousands separator), use delimiter/encoding as a prior, and show the decision where the user can change it ("Read as 1.234,56 · change"). Sketch:
```ts
// decide once per column from a sample, not per cell
const commaDecimal = (s: string) => /\d,\d{1,2}$/.test(s) || /\d\.\d{3},\d+$/.test(s);
const dotDecimal   = (s: string) => /\d\.\d{1,2}$/.test(s) && !/^\d{1,3}(\.\d{3})+$/.test(s);
// vote across ~500 non-empty values; ties fall back to delimiter === ";" ? "," : "."
```

**2. Excel dates arrive as serial numbers.**
Repro: `messy_report.xlsx` (Q3 Report sheet). `Date` is typed **Integer, 45,474 – 45,513**; it should be 2024-07-01 → 2024-08-09. Most real-world Excel files have date columns, so this will hit most Excel users.
Fix: read with cell dates enabled / honour the cell number format, then type the column as Date.

**3. Cleaned data does not export as cleaned.**
Repro: Chipotle → Export CSV. The file still contains `NULL` and `$2.39 ` (trailing space) verbatim, even though the app shows the column as Number. There is also no Clean op that converts text to number/date, so the "Clean → Export" path cannot produce a numeric column. The file is always named `<name>-filtered.csv`, even with no filter, and also after transforms.
Fix: export the cleaned/typed values (with a "blank for null" option), name files `<name>-cleaned.csv` when any step is applied, and add *Convert to number / date* ops.

### P1 — Structure and flow

**4. Positioning and information architecture.**
- `<title>`, meta description and H1 all say *search* ("Search tabular data, fast"). Your goal is ingest → clean → transform. This is what the first impression and every link preview say.
- After load the app lands on **View**, the busiest screen; Clean/Transform are small stepper items opening **modals that cover the data**, so users can't watch the effect.
- The stepper says Export is "soon" and disabled, while **Export CSV** is already in the toolbar.
- Empty state: a very large paste box dominates, while the drop zone, which most users want, is a thin dashed strip. The scrape legal disclaimer carries more visual weight than the privacy promise. "New data" in the header is redundant on an empty page.

**5. The Data QA panel alarms on ordinary conditions.**
- A saturated red panel with red "Nulls: 708" and "Value outliers: 47" on Titanic reads as *error*, and the chips are filter toggles that look like badges.
- Units are inconsistent: `Nulls: 708` appears to count **rows with ≥1 empty**, the column cards sum to **866 empty cells**, and the top bar says "8.1% empty". Chipotle shows "Duplicates: 115" but the top bar says "56 groups (59 redundant rows)". Both are right, but nothing explains it.
- The outlier rule isn't stated, and it flags legitimate values (Titanic children aged 2 and 4 are highlighted as outliers).

**6. Clean/Transform dialogs.**
- Transforms show no impact before applying (should read "Removes 59 rows"). Value-op previews on non-category columns show the first 5 rows, which usually show `1 → 1`.
- One column at a time; only Trim / UPPER / lower / Title / Find & replace.
- Undo is "Revert all" per column. There's no step list across the whole dataset and no global undo.

**7. Missing the capabilities your own engine makes cheap.**
- **Cluster similar values.** After Title Case, `Fremantle` (48), `Fremantel` (48), `Freemantle` (59) remain separate and the user must hand-write two find-and-replace rules. You already ship Jaro-Winkler and phonetic matching; an OpenRefine-style "merge similar values" panel is the single highest-value feature.
- **Sentinel detection.** `score` contains `-999` (270 of 400 rows) and the mean shows **-657.9**. Suggest "-999 looks like a missing-value code (270×)" in Nulls.
- **Boolean normalisation** (`Y`/`yes`/`TRUE` stay as 5 categories), **combine year/month/day → date** (the rainfall data), **convert to number/date**.

**8. Type inference and labels.**
- Titanic `Age` is labelled **Integer** (range 0.42–80). Filtering is still correct (14 rows for 0–1, matching ground truth), so this is a label/inference issue, not data loss.
- 0/1 and code columns (`Survived`, `Pclass`, Spotify `key`/`mode`) get numeric range sliders; a toggle or category list is the right default.
- Changing a column's type **silently clears its active filter**.

**9. Workspace density.** Every column gets an open filter card by default (12 on Titanic, 23 on Spotify), so the sidebar is a long scroll with the 7-option type dropdown repeated in both the header and each card. The QA panel plus summary cards take ~320 px, so the table starts in the lower half of the screen.

### P2 — Responsive and accessibility

**10. Mobile is not usable.** At 390 px the layout overflows to ~680 px, the sidebar and table sit side by side, and the table is squeezed to a sliver starting 574 px down. 68 controls are under 32 px.

**11. Accessibility (axe-core).**
- The modal is a plain `<div class="modal clean-modal">`: no `role="dialog"`, `aria-modal` or label.
- 17 `<select>`s labelled only by `title` (serious).
- No landmarks and no `<h1>` in the workspace state.
- Contrast failures: `.disclaimer` text and the inactive stepper labels.

### P3 — Polish

- Result count is triple-redundant: "14 of 891 rows · 1.6% shown · 877 filtered out (98.4%)".
- "Shuffle 100" is styled as the primary action of the results bar.
- "1 columns" (plural) on the worksheet picker; the picker also renders below the fold and shows only dimensions (no preview).
- Merged Excel header lost its parent label: `Sales Actual` / `Budget` (should be `Sales Actual` / `Sales Budget`).
- `ragged.csv` (duplicate + blank header names plus a quoted newline in the first data row): the header detector merged row 1 into the header (`id 1`, `name Ann`) and returned 3 rows instead of 4. Realistic variants (blank pandas index header, duplicate names, short/long rows) were handled fine, but worth a regression test.

---

## Recommended backlog

| # | Change | Fixes | Effort |
|---|--------|-------|--------|
| 1 | Per-column number-locale inference + visible override | #1 | S–M |
| 2 | Excel date handling (cell dates / number format) | #2 | S |
| 3 | Export cleaned/typed values; correct filename; null-as-blank option | #3 | S |
| 4 | *Convert to number / date* clean ops (strip currency, `%`, spaces; parse with chosen format) | #3, #7 | M |
| 5 | Rename H1/title/meta to the real job ("Clean and reshape tables in your browser — nothing leaves it"); enable Export or remove "soon" | #4 | S |
| 6 | Landing: drop zone primary; paste and URL secondary; privacy badge ("0 bytes uploaded") beside the drop zone; collapse the scrape disclaimer | #4 | S |
| 7 | Replace modals with a right-hand drawer so the table stays visible; show before/after counts ("removes 59 rows", "converts 4,622 cells") before Apply | #4, #6 | M |
| 8 | Persistent **steps list** (Load → Trim city → Title Case → Remove duplicates) with toggle/reorder/undo, exportable as a pandas or Polars snippet | #6 | M–L |
| 9 | **Merge similar values** panel built on the existing fuzzy/phonetic engine | #7 | M |
| 10 | Inline per-column suggestions on QA chips/headers (sentinel codes, price-like text, Y/N booleans, date parts) | #7 | M |
| 11 | Recolor QA: neutral by default, amber only when actionable; add tooltips defining each metric and its unit; make it a collapsible summary | #5, #9 | S |
| 12 | Default 0/1 and low-cardinality integer columns to Category/Boolean; infer Integer vs Number from the whole column; warn when a type change drops a filter | #8 | S |
| 13 | Collapse filter cards by default; add "add filter" search; keep the table above the fold | #9 | M |
| 14 | Responsive layout (sidebar → bottom sheet / drawer, table full width); 40 px tap targets | #10 | M |
| 15 | `role="dialog"` + `aria-modal` + focus trap; real `<label>`s for selects; landmarks + `<h1>`; fix contrast | #11 | S |

Do 1–3 first (correctness), then 5–6 (cheap, big first-impression gain), then 7–9 (these turn it from a search tool with some cleaning into a cleaning tool).

## Regression fixtures

Run `python make_test_data.py` and assert after load:

| File | Assertion |
|------|-----------|
| `euro_win1252.csv` | `Umsatz` max ≤ 999.99, mean ≈ 500; `Datum` min ≥ 2024-01-01 |
| `messy_report.xlsx` (Q3 Report) | `Date` typed Date, 2024-07-01 → 2024-08-09; `Code` stays ID |
| `messy_values.csv` | `score` suggests `-999` as sentinel; `city` offers 3 `Fremantle` variants as one cluster |
| `ragged.csv` | 4 rows, no header contamination |
| Titanic | `Age` typed Number |
| Chipotle | exported `item_price` is numeric (`2.39`), nulls blank |

Public datasets used: `datasciencedojo/datasets/titanic.csv`, `justmarkham/DAT8/data/chipotle.tsv`, `rfordatascience/tidytuesday/data/2020/2020-01-07/rainfall.csv`, `justmarkham/pandas-videos/data/ufo.csv`, `rfordatascience/tidytuesday/data/2020/2020-01-21/spotify_songs.csv`, `vega/vega-datasets/data/movies.json`, `fivethirtyeight/data/college-majors/recent-grads.csv`.
