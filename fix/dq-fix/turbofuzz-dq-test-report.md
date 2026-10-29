# TurboFuzz Data Quality page: test on 8 datasets

Tested the current app (branch `agent/text-column-network`, built locally, page unchanged by the chart patch), loaded through the real file input in Chromium at 1440 wide. Each page output was checked against an independent pandas profile of the same file.

## Verdict
Mechanically solid: all 8 files loaded and rendered with **0 console errors**, load under 1 s (10,000 rows in 0.94 s), Data Quality render under 100 ms, layout held with every column count and name style. Counts it reports are exact (Titanic 687/177/2 empty, airquality 37/7, tips 1 duplicate, chipotle 59 duplicates, penguins 11/2/2/2/2).

It does **not** hold up on messy data: it finds blanks and exact duplicates well and misses or mis-handles most real mess. All eight files scored "good" (91.9 to 100), including five that contain substantial problems (Titanic, Pima, chipotle, cafe, HR).

| Dataset | Rows x cols | Score | Real issues the page caught | Real issues it missed | Wrong or harmful output |
|---|---|---|---|---|---|
| Titanic | 891x12 | 95.8 good | Cabin 77% empty, Age 177, Embarked 2 | Name column (personal names) not flagged sensitive | Offers "Convert Ticket to Integer" (230 values would be lost); flags Ticket as "Phone 431"; 28 multi-cabin values (e.g. "C23 C25") shown as off-format |
| Penguins | 344x7 | 99.7 good | All 11/2/2/2/2 missing, no false alarms | none | none (clean result is correct) |
| Pima diabetes | 768x9, no header | 100.0 "nothing to fix" | n/a | Header row eaten (first record became column names, 767 rows); zeros that mean missing (Insulin 374, SkinThickness 227, BP 35, BMI 11) | Claims every check passes |
| Chipotle | 4,622x5 | 97.6 good | 1,246 empty choices, 59 duplicates | `item_price` is text like "$2.39 " (not numeric, trailing space) | Ranks optional `choice_description` blanks as the top fix |
| Tips | 244x7 | 99.9 good | 1 duplicate | none | none (correct control) |
| Airquality | 153x7 | 98.4 good | Ozone 37, Solar.R 7 | none | none |
| Dirty cafe (synthetic, Kaggle-style) | 10,000x8 | 96.7 good | Blanks plus "UNKNOWN" counted as missing (2,743 placeholders) | "ERROR" in 2,908 cells not recognised as a placeholder; "ERROR" inside numeric columns not flagged | Transaction Date flagged "Phone 8,016, TFN 790" (they are ISO dates) |
| HR with PII (synthetic) | 2,000x10 | 91.9 good | Email, mobile, TFN, card columns found | 102 malformed emails ("x@@example"); department spelled 9 ways (Finance/finance/FINANCE, Eng./Engineering); 575 salaries with "$"; 3 mixed date formats only partly caught; card and phone numbers inside `notes` (777 rows); full_name, date_of_birth and salary not flagged | Top fix is "card_number is populated" (+34.3 pts), which penalises not having a card; "Convert mobile to Number" would strip leading zeros and formats; DOB flagged "Phone 617 / TFN 52"; TFN also reads as ACN 175 |

## Ranked problems
1. **Dangerous fixes offered.** "Convert to Integer/Number" on identifier-like text (Titanic Ticket, HR mobile) ranks as a top fix and would destroy values or leading zeros. Identifiers should never get a type-conversion suggestion.
2. **Score is too forgiving.** 95.8 "good" with a column 77% empty; 91.9 "good" with malformed emails and nine spellings of one department. A column-level floor is needed (a band should cap at "fair" if any column is badly broken).
3. **Optional columns dominate the ranking.** Chipotle `choice_description` and HR `card_number`/`notes` top the fix list. Blank-by-design columns should be recognised (or at least not ranked first).
4. **Sensitive-data false positives.** Dates read as phone/TFN (cafe: 8,016 values; HR DOB), ticket codes read as phones, TFN/ACN checksum collisions. No column-name signal, so personal-name, DOB and salary columns are missed.
5. **Sensitive-data misses in free text.** Card and phone numbers embedded in `notes` are not found.
6. **Hidden missing values.** "ERROR" sentinels and zeros-as-missing are invisible; Pima scores a perfect 100.
7. **Header detection.** An all-numeric file with no header silently loses its first record and names columns after its values.
8. **Text-typed numbers.** "$2.39 " and "$75,000" strings are not flagged as numbers stored as text.
9. **Format mess** (mixed date formats, email shape, spelling variants of one category) is not scored on this page.

## Coverage by the current plan (turbofuzz-dq-pii-plan.yaml v3)
Covered: 2 (partly, C1), 4 (T1, T2, H0, BENCH-PII), 6 (partly, T9), 8, 9 (T6, T7, T8).
**Not yet in the plan** (suggested additions): identifier-safe conversion rules (1), band cap / column floor (2), optional-column handling in ranking (3), free-text PII scan (5), sentinel list including ERROR/N/A/#N/A/null and zero-as-missing check (6), numeric-header detection (7), and explicit hard negatives in BENCH-PII (ISO dates, ticket codes, order numbers).

## What worked well (keep)
Exact counts and drill-down filters, fast render, clean datasets correctly left alone (penguins, tips, airquality: no false alarms), the score-breakdown line, and the existing "Sensitive data" section identifying email, phone, TFN and card shapes accurately when the column really holds them.

## Method and limits
Titanic, penguins, Pima, chipotle, tips and airquality are public files fetched from GitHub. Dirty cafe and HR files are synthetic (seeded generators, so reproducible); the cafe file imitates a well-known Kaggle dataset and the HR file has deliberately planted problems, so scores on them show detection, not a real-world average. Not tested: the 250,000-row and 71-column files (covered by the repo's own bench), phone and dark-theme layouts, the Fix buttons' behaviour after clicking (only what they offer was assessed).

## Round 2: three more real-world messy datasets (coffee ratings, US police killings, GDPR fines)
Same method. All three loaded with 0 console errors (coffee 43 columns in 0.99 s) and all three scored "good" (97.1, 99.7, 99.2).

| Dataset | Rows x cols | Score | Caught | Missed | Wrong or noisy |
|---|---|---|---|---|---|
| Coffee ratings (tidytuesday) | 1,339x43 | 97.1 good | "NA" placeholders counted as missing (4,086); latest grading and expiry dates in Freshness | harvest_year mixed forms (2014, 2014/2015, Spring 2011-2012, TEST); altitude ranges and units; altitude_mean_meters up to 190,164 m (4 rows over 9,000 m); total_cup_points = 0; moisture 0 in 264 rows; producer case and space variants (691 vs 665) | lot_number (optional) is the top fix at +31.8 pts; altitude flagged "Phone 39 / TFN 5", ico_number "Phone 470 / TFN 9 / ACN 3"; page is 6,860 px tall with Sensitive at 4,806 px and the ranking showing 5 of 21 |
| US police killings (FiveThirtyEight) | 467x34 | 99.7 good | "Unknown" and "-" counted as missing (83 placeholders); ISO-8859 file read without crashing | victim name, street address and latitude/longitude not flagged as sensitive; month/day/year stay as three separate columns | top fix is "name parses cleanly: 55 off-format" (legitimate 3-part names); geo_id flagged "Phone 464 / ABN 3" |
| GDPR fines (tidytuesday) | 250x11 | 99.2 good | blanks in controller (21), summary (7) | 15 rows dated 1970-01-01 (epoch placeholder); 11 fines of 0; 16 repeated (name, date, price) rows hidden by the unique id | top fix is "picture parses cleanly: 27 off-format" on a URL column (all .svg); date M/D/YYYY text not offered for conversion |

New gap patterns from round 2: format-mask checks firing on URL and name columns (G8), near-duplicates hidden by an id column (G9), sentinel dates and zeros (G6), plausible-range misses (G11), and wide-file page length (G13). All are now tasks in plan v3.1 (`FMT`, `DUPK`, `SENT`, T8/T9 bench cases, STATES/P1).

Observation to keep: the app genuinely handles placeholders like NA, Unknown and "-" and reads long-form dates such as "April 4th, 2016" for Freshness; these should be preserved.

## Corrections after code-level investigation (see turbofuzz-dq-root-cause.md)
- **Currency text is handled.** Chipotle `item_price` ("$2.39 ") and HR `salary` ("$100,000") are typed as numbers. Problem 8 above was wrong.
- **HR's 102 malformed emails are counted** in the validity checks; they were outside the top-5 fix list, not missed.
- **Department spellings are detected** (Advanced signals, bottom of the page: FINANCE/finance/Finance, 660 rows) but are not scored or ranked. Abbreviations ("Eng.", "HR") are not caught.
- **The GDPR date column is typed as a date.** The "not offered for conversion" note was a non-issue.
- **New, more serious finding:** cafe `Price Per Unit` has 420 ERROR cells but the page reports 59, because counts come from a 2,000-value sample. Columns with 6% or more junk can become categories that hide the junk entirely.
