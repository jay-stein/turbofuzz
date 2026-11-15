# TurboFuzz stress test: interim findings (2026-11-15)

Status: 8 of 20 tests done (S09-S12 by agent C, S17-S20 by agent E). S01-S08 and S13-S16 (agents A, B, D) were cut off by the usage limit and are not run. All results are headless, through the app's own parser and engines, checked against pandas 3.1.1, DuckDB and planted truth. No browser pass yet. Timings were taken while other jobs ran, so they are indicative only. Harnesses, inputs and oracles are in the session scratchpad under `stress/`.

## Scores
| Test | Data | Score | Worst issue |
|---|---|---|---|
| S09 UTF-16/UTF-32 | real Wikidata + synthetic | 4/5 | UTF-32 decoded as NUL garbage, no warning |
| S10 Latin-1 / mojibake | real French/German + synthetic | 2/5 | One stray byte makes the whole UTF-8 file mojibake, scored "good" |
| S11 decimal-comma European CSV | real INE Spain + synthetic | **1/5** | Three-decimal numbers read x1000 in both directions; a real 139,860-row file loads as 1 row |
| S12 pipe / fixed width / gz / bz2 | real Census, FEC, NOAA, DWD | 3/5 | Header-less pipe file loses 23-303 real records to a wrong header guess |
| S17 dates and time series | synthetic with truth | 3/5 | CSV export of a time column drops seconds, wraps 23:59:45 to 00:00 |
| S18 people near-duplicates | synthetic, 50k rows | 3/5 | Default fuzzy precision 42%; merge rewrites addresses |
| S19 geo / map | real GeoNames + damage | 2/5 | No coordinate range check; swapped and (0,0) points land in wrong countries |
| S20 NYC restaurants | real, 295k rows | 3/5 | Relationships headlines lat~lon r = -1.000 (true +0.36 without 3,049 placeholder zeros) |

Issue counts so far: Critical 6, Major about 25, Minor about 24.

## Critical (silently wrong or lost data)
1. **S11-02** `119,942` (3-decimal comma) read as 119942: sums x1000, score 100 "good". Real INE CPI file. Cause: `detectNumberLocale` (`src/parse/infer.ts` ~224) votes "dot" on `\d(,\d{3})+$`; the semicolon prior only applies on a tie.
2. **S11-03** `124.665` (3-decimal dot) in a `;` or windows-1252 file read as thousands: x1000, score 100. Cause: file prior "comma" applied on ties (`src/worker/ingest.ts` ~150, `infer.ts` ~232). One accented character anywhere flips the prior.
3. **S11-01** A real file whose every row starts `Total Nacional;` loads as **1 row of 139,860**. Cause: `totalRowsStart` (`src/parse/header-detect.ts` ~255) drops every trailing row matching `/^(grand\s+|sub-?\s*)?totals?\b/i`; the "rows left out" note only prints for the preview.
4. **S11-04** Exported Recipe turns `(1,234.50)` into +1234.5 (app: -1234.5). Cause: recipe `toNumber` strips `(` `)` (`src/data/recipe.ts:608-612`). 167 of 500 cells.
5. **S10-01** One invalid byte in a UTF-8 file makes the whole file windows-1252 mojibake (108 cells), band "good" 99.85. Cause: strict-UTF-8 failure falls back wholesale (`src/parse/encoding.ts:67-79`).
6. **S17-01** CSV export of time columns drops seconds and rounds to the minute (23:59:45 becomes 00:00). 300/300 cells. Cause: `toTimeInputValue` (`src/parse/dates.ts:431`) used by `src/worker/csv.ts:54`.

## Major
- **S11-05** Dot values with 4+ decimals (lat/lon) in `;` or windows-1252 files: all 300 unparsed, score 0, right fix not offered.
- **S11-06/07** The "user decides, app never assumes" decimal policy is only partly implemented (whole columns set by majority vote or prior, no chip); score stays "good" (92.2) while a conflict is open, contrary to the decision text.
- **S10-02/03/04** No mojibake detection (double-encoded `Ã©` accepted as clean); mixed per-row encodings not noticed; cp1250, Shift_JIS, GBK, MacRoman, ISO-8859-15 silently read as windows-1252 with no override (Polish scored 100).
- **S09-01/02** UTF-32 and BOM-less CJK UTF-16 decoded as confident garbage. **S09-05** app and Recipe disagree on title case (`People's` vs `People'S`).
- **S12-01** Header-less pipe file (normal for FEC): first rows treated as title rows, a data row becomes the header, 23 / 303 records lost, DQ then judges nonsense.
- **S12-02** Fixed-width files load as one column scoring 100; rows with a comma lose the rest. **S12-03** The Recipe ignores everything the importer did (skipped rows, footers, delimiter, encoding): crash or extra rows.
- **S17-02** Mixed-date-format detection only runs for type `date`; add one datetime and a column scoring 11 jumps to 100. **S17-03** A column mixing dd/mm and mm/dd becomes plain text with no message.
- **S18-01** Default fuzzy "normal" threshold 0.72: 42% precision (Cook for Cox, Long for Young). Strict is usable (95.6% / 98.6%). **S18-02** Unicode fold misses ø, ł, ß, ue/oe: `Orsted` finds 40 rows, `Ørsted` 260. **S18-03** Merge-similar rewrites addresses with different house numbers (296 of 753 rows wrong) and first names (`Angel` to `Angela`). **S18-04** Merge defaults reach only 9.8% of rows needing a fix.
- **S19-01** No coordinate range or plausibility checks: 331 rows |lat|>90, 171 at (0,0), 342 swapped all pass; 106 of the swapped rows land in the wrong country. **S19-02** Decimal-comma coordinates converted silently (conflicts with the owner's decision; behaviour depends on decimal count). **S19-03** `Lat`/`Long` header pair not auto-detected. **S19-04** Location-mode region join 3.9 s for 34k points.
- **S20-01/02** Relationships treats code columns (community_board, bin, zipcode, phone) as quantities; headline r = -1.000 is an artefact of placeholder zeros. **S20-03** `contains "mcdonalds"` finds 82 of 1,478 rows (tokenizer splits at the apostrophe).

## Minor (selection)
UTF-16 never shown as the encoding; truncated UTF-16 gives U+FFFD silently; "Trim" also collapses inner whitespace; Recipe does not carry delimiter/encoding/decimal mark; Polars recipe cannot read non-UTF-8; trailing-minus numbers unsupported; one bad cell counted twice; legitimate multi-value cells (`A~~~B`) fail "parses cleanly" so a clean Census file scores "fair"; serial/epoch/yyyymmdd date columns never offered as dates; CSV export appends `Z` to naive datetimes; DST handling; `contains "Critical"` also matches "Not Critical"; placeholder zeros unflagged while 1900-01-01 is flagged.

## What held up (verified)
- UTF-16 with BOM, pipe-delimited files, trailing delimiters, footers, quoted pipes, gz and bz2: oracle-exact.
- Date parsing to the millisecond for 9 single formats; 8/8 impossible dates caught; ambiguity declared in the Overview.
- Time-series engine: 18/18 gaps, 20/20 duplicates, planted season and outliers recovered, forecast bands conservative (89-94% coverage for 80% nominal).
- Seven analytic questions on the real 295k-row file matched DuckDB to the last digit (263-573 ms); 169 MB load works.
- Strict fuzzy search on 50k people under 1 ms per query; choropleth join lists unmatched values honestly and ranked the ISO2 join first with 0 wrong.

## Not yet tested
S01-S04 (XLSX, legacy XLS, 120k-row synthetic xlsx, zips), S05-S08 (3M-row Parquet, synthetic Parquet, JSON, JSONL), S13-S16 (broken-CSV zoo, hostile values, extreme shapes, large gzip), and the whole browser pass (UI wording, badges, banners, real timings).
