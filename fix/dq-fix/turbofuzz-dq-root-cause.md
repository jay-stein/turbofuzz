# TurboFuzz data quality: where the problem actually lives

**Verdict: it is neither the parser nor the Data Quality page. It is the middle layer: type inference and column profiling, plus the way their results are (or are not) wired into the score.**

The parser reads files correctly. The page faithfully shows what the score gives it. Between the two, the app decides what each column *is* and then lets that decision choose which checks run. Messy values change that decision, so messiness can switch the checks off. Separately, several detectors already find problems but never reach the score.

## How I established this
- Read the pipeline end to end: `parse/` (delimiter, encoding, header, null tokens, numbers, dates) → `parse/infer.ts` (type) → `data/column.ts`, `suggestions.ts`, `mask-profile.ts`, `text-profile.ts`, `identifier.ts`, `search/similar.ts` (profiling) → `data/score.ts` (Quality page score) and `data/findings.ts` → `ui/quality-page.ts`.
- Ran those modules directly in Node on 8 of the test files. The resulting scores match the browser exactly (95.8, 100.0, 97.6, 96.7, 91.9, 97.1, 99.7, 99.2), so this is the app's real pipeline, not an approximation.
- Probed individual functions on the problem values, and ran a controlled experiment injecting 0–12% junk into a clean column.

## Layer by layer

### 1. Parsing: sound, three local bugs
Evidence it works: 71 files (11 tested + 60 pilot) loaded with 0 crashes. Rows and columns matched pandas on every file pandas could read, and the app read 3 encoding-broken files pandas could not. Placeholders such as NA, NULL, Unknown and "-" are recognised (50+ forms). "$2.39 " and "$100,000" parse as numbers, and "April 4th, 2015" parses as a date.

Local bugs (each a small fix):
- **No "header-less" outcome.** `header-detect.ts` falls back to "first row is the header" when no row scores as a header. An all-numeric file (Pima) loses its first record. Confirmed: `detectTable` returns headers `6, 148, 72…`.
- **`ERROR` is not a missing-value token** (`isNullToken("ERROR") = false`; `#error!` is). "UNKNOWN" is.
- **`18-Jun-1996` is not a recognised date form** (`classifyDateValue` fails; ISO and d/m/y pass).

### 2. Type inference: the root cause
`inferColumnType` picks one type from a 1,000-value sample using cut-offs (95% integer, 95% number, 95% date, ≤12 distinct values = category, else text). **The chosen type then decides which quality checks exist.** That makes the score unstable and sometimes backwards.

Controlled experiment, 5,000 rows, junk value `ERROR` injected:

| Junk share | Quantity (values 1–5) | Price (decimals) |
|---|---|---|
| 1–5% | integer; validity counts 21–101 failures | number; validity counts 20–90 |
| **6%+** | **becomes category; 0 failures, score 100.0** | becomes text; switches to a different "stored as Text" check |
| 12% (619 junk cells) | **still 100.0 "good"** | 98.5 "good" |

- **More junk can mean a better score.** Past about 6%, junk becomes a "category" and disappears from validity. This is why the cafe file's `Item`, `Payment Method` and `Location` columns (about 400 ERROR cells each) raise no issue at all.
- **Counts are sampled but presented as exact.** Suggestions (type conflicts) are counted on a 2,000-value sample and scored against all rows. Cafe `Price Per Unit` has **420** ERROR cells and the page reports **59**. The checks table says "exact pass / fail / n-a counts".
- **Double counting.** The same 411 ERROR cells in cafe `Transaction Date` fail two checks ("parses cleanly" 411 and "stored as Text" 467).

The fix is a contract change, not a tweak: **decide the intended type from the majority, then measure conformance exactly against it.** A Quantity column with 12% "ERROR" is still a number column with 619 invalid cells.

### 3. Profiling: no shared idea of what a column means
Each detector has its own rules, and none share a semantic type (id, phone, email, person name, address, URL, free text, code, money, date, category, measure):

- **Identifier knowledge exists but is isolated.** `identifier.ts` correctly says `mobile` is an identifier. Only outliers and charts use it. The "Convert to Number" offer in `score.ts` never asks, so it proposes stripping phone numbers' leading zeros. Titanic `Ticket` isn't recognised by any rule.
- **PII shape order bug** (`text-profile.ts`): the phone pattern is tested before the date pattern and accepts digits with dashes. So `2023-01-24`, `1950-2200`, census `22079011700` and `03-0-0067` all count as phones. Dates such as `1996-06-18` also pass the TFN checksum about 1 time in 11 once separators are stripped.
- **PII is whole-value only.** "Visa 4111 1111 1111 1111 on file" and "Contact me on 0412345678" are not found. There is no column-name signal, so name, address, DOB and lat/long columns are never flagged.
- **Format masks run on everything** (`mask-profile.ts`): URLs and personal names get "off-format" failures (GDPR `picture`, police `name`).
- **A security check is scored as data quality.** The CSV-injection guard `looksLikeFormula` flags `-P1D` (an ISO duration), and `score.ts` counts it as a validity failure worth +40 pts.
- **Similarity runs where it makes no sense:** 25 "near-duplicate" clusters of birth dates (`22/08/1976` vs `22/02/1974`).

### 4. Wiring: detectors exist that never reach the score
There are four separate issue engines reading the same column profile:

| Engine | Where it shows | What it knows that the score ignores |
|---|---|---|
| `score.ts` | Score ring, "What to fix first", checks table | (the score itself) |
| `findings.ts → qualityFindings` | **Nowhere: called only by tests** | placeholders as text, numbers/dates stored as text, near-identical values, keys, constants |
| Advanced signals (`app.ts`) | Bottom of the Quality page (~5,000 px down) | spelling clusters ("FINANCE" vs "finance" vs "Finance", 660 rows), co-missingness, drift, text profiles |
| Toolbar chips | Top toolbar | placeholder and duplicate counts |

So HR `department` spellings are detected, just not where anyone looks and not in the score. The plan's `UNIFY` task assumed Overview and the Quality page already share `qualityFindings`. They don't; that function is unused.

### 5. Scoring policy and page
This is real but downstream. The band is a plain weighted mean, so one 77%-empty column still reads "good". Optional and fully empty columns appear in "What to fix first" (13 of 60 pilot files). The page is very long on wide files. All of this is worth fixing, but it **changes nothing if the inputs are wrong.**

## Tally of the 16 recorded gaps plus 5 new ones
- Parsing: 3 (header, ERROR token, dd-Mon-yyyy)
- Type inference: 3 (type gating and the cliff, sampled counts, double counting). These are the most important.
- Profiling: 9 (identifier isolation, PII order and checksum, PII free text and names, masks on URL/names, formula check, similarity on dates, plausible ranges, mixed forms in harvest_year/altitude, zeros as missing)
- Wiring: 3 (four engines, variants and sentinels not scored, near-duplicates ignoring id)
- Scoring policy and page: 3 (band, optional/empty columns, page length)

## Corrections to my earlier test report
I was wrong on four points, and the report and plan are now corrected:
- **"$" amounts are handled.** Chipotle `item_price` and HR `salary` are typed as numbers. That was not a gap.
- **HR's 102 bad emails are counted** in validity. They were just outside the top-5 fix list.
- **Department spellings are detected** (Advanced signals), but not scored or ranked. "Eng." vs "Engineering" and "HR" vs "Human Resources" are not caught.
- **The GDPR date column is typed as a date** correctly.

## Next steps, in order
1. **Lock in behaviour before changing it** (about a day). Turn the Node probe into the corpus test (`BENCH-REAL`), plus two property tests: *more junk never raises the score*, and *reported counts equal exact counts*. Both fail today, which is the point.
2. **Fix the measurement contract** (`MEASURE`; `parse/infer.ts`, `data/column.ts`, `data/suggestions.ts`, `data/score.ts`). Infer the intended type from the majority, not a 95% cliff. Count conforming and non-conforming cells in one exact pass. Count each bad cell once. Keep "stored as text" as a property of the column, not a second check.
3. **Add one semantic type per column** (`SEM`; new `data/semantic-type.ts` built on `identifier.ts` and the shared name hints, H0). Compute it once. Validity, PII, Convert offers, format masks, similarity and ranking all read it. This single change addresses most of the profiling gaps.
4. **Wire one issue list into the score** (`WIRE`, replacing the old UNIFY premise). Spelling clusters, sentinels, placeholders, type conflicts and patterns become scored or review issues in one list. Either retire `qualityFindings` or make it that list. Advanced signals keep only genuinely advisory items (drift, co-missingness).
5. **Quick local fixes**, which can run alongside 2–4 (`QUICK`): the header-less outcome, the ERROR token, the dd-Mon-yyyy form, the phone/date order and TFN-on-dates fixes, `looksLikeFormula` kept out of validity, and no similarity on date columns.
6. **Then scoring policy** (BAND, OPT), **then the page redesign** (P1, VIS, DIST and so on). The redesign is still right; it is just last, because it presents whatever steps 2–4 produce.

What not to do: don't start with the page, and don't tune thresholds (95%, 12 distinct values) to make the current test files pass. Thresholds are the symptom; the contract in step 2 is the cause.
