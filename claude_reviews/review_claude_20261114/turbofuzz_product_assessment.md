# TurboFuzz: product assessment from a Head of Analytics

Assessed 14 November 2026 against the live build at turbofuzz.mrjaystein.workers.dev (bundle `index-Dh-IH6kE.js`). Source was read on the local `agent/research-mode` branch, which is 102 commits ahead of `main`, so code-level explanations may not match the deployed build exactly.

## How this was tested

I used the product in Chrome on Windows 11 (16 cores, 2560×1271 viewport) and did not change any code.

- **Test data.** A synthetic orders file with 30 columns and 23 kinds of planted defect, generated from a seeded script at 10,000, 100,000 and 1,500,000 rows. Because the defects were planted, I could count what TurboFuzz found against what was really there.
- **Independent check.** The same 100,000-row file was regenerated on disk and checked in pandas 2.3.3, including running a line of TurboFuzz's own generated recipe.
- **How files were loaded.** Files were injected through the page's file input by script, not dragged in by hand. Load behaviour should be the same, but drag-and-drop itself was not exercised.

Three labels are used throughout: **observed** (I saw it or measured it), **code** (read in source), **inferred** (my reasoning from the other two).

**Not tested:** Excel, Parquet, JSON and archive import; multi-file stacking; Compare mode; writing an export file to disk; workspace save and replay; the Polars recipe; choropleth maps; Time Series Decompose and Patterns; GIF/MP4 export; other browsers; lower-memory laptops; touch or small screens.

---

## 1. Executive verdict

**I would run a scoped pilot. I would not roll it out to the whole team yet.**

TurboFuzz is the best first-ten-minutes tool for an unfamiliar flat file that I have used. On a 100,000-row file it had a typed, profiled, quality-scored view on screen in about six seconds, and it found most of what I had planted without being asked. Nothing leaves the browser, which removes the usual procurement and privacy argument.

- **Strongest reason to adopt:** it shortens the gap between "someone sent me a CSV" and "I know what is wrong with it" from an hour of Excel filtering or notebook boilerplate to a few minutes, with no install and no data leaving the machine.
- **Biggest reason to hesitate:** I hit three defects in two hours that bear directly on trust. The pivot view dies silently when you remove a measure. "Apply all safe fixes" applies only some of them. The exported pandas recipe silently nulls 1,993 dates that the app itself converted correctly. An analyst who meets any of these in week one will stop trusting the tool, and they would be right to.

The breadth is impressive and the depth is uneven. Fix the trust defects before putting it in front of fifteen people.

---

## 2. Product positioning

**What it is:** a private, single-user, in-browser bench for triaging and cleaning one flat file, with unusually good data-quality diagnosis, fast fuzzy search, a capable pivot, good exploratory charts and a serious time-series page.

**What it is not:**

- Not a reporting platform. There is no refresh, no scheduling, no shared dashboards, no access control.
- Not a spreadsheet. There are calculated columns, but no cell-level modelling, no lookups across tables, no free-form layout.
- Not a data platform client. It reads files you hand it. It cannot query a database or a warehouse, by design.
- Not a pipeline tool. The recipe can be exported, but nothing runs unattended.

**Where it sits:** upstream of everything else. It is the step between receiving a file and deciding what to do with it. The closest comparisons are OpenRefine, ydata-profiling, Tableau Prep's profile pane and Power Query's column-quality view. It is faster to start than all of them and more opinionated about what is wrong with your data.

**Answers to the eight questions**

| Question | Answer |
|---|---|
| Where does it fit? | Intake and triage of flat files, before Excel, Power BI or Python. |
| What could it improve? | First-look profiling, data-quality diagnosis, finding records by approximate name, quick pivots and charts on files too big for comfortable Excel use. |
| Replace Excel for some tasks? | Yes, for inspecting, filtering, de-duplicating and pivoting files of 50,000 to 500,000 rows. No, for modelling, lookups or anything a colleague must open and edit. |
| Replace Power BI? | No, not even partly. It can replace the throwaway chart you would have built in Power BI Desktop just to look at something. |
| First tool for an unfamiliar dataset? | Yes. This is the role it is best at, and where I would pilot it. |
| Intuitive for occasional analysts? | The Overview, Data Quality and Table are. Time Series, Outliers and Relationships assume statistical training. |
| Fundamental limits? | Browser memory (about 4 GB per tab), one file at a time, no persistence across reload, no connections, no collaboration. |
| Needed before wide adoption? | The three trust defects fixed, a visible progress indicator on large loads, Excel export, and a recipe that carries the schema. |

---

## 3. The everyday analyst experience

### A. Receiving an unfamiliar dataset: excellent

Loading the 100,000-row, 30-column file took 6.4 seconds to a usable table (observed). The Overview then showed, without a click:

- Row and column counts, file size, encoding and delimiter.
- A type for every column, with a small histogram or top-values list.
- 420 duplicate rows, which is exactly the number planted.
- A missing-values map across all columns.
- A guess at what the file is ("Orders & transactions · 95%").
- Three suggested next steps.

Small touches show care: `postcode` and `phone` were typed as identifiers and kept their leading zeros (Darwin stayed `0800`), where pandas' default reader turned the same column into `800`.

This does surface things I would not have known to look for. It is more than a display of facts I could get elsewhere.

Two cautions:

- The file was described as having a "unique key column". It does not: 1,437 rows share an `order_id` with another row (pandas check). The app never raised this.
- The quality score read 99.3 "good" while the same page reported that 10% of rows fail at least one check. A score that barely moves is not telling me much.

### B. Finding and investigating records: very good

- Typing "Katherin Smith" in fuzzy mode returned Katherine Smith, Catherine Smyth, Catherine Smith and Katherine Smyth, with a count beside each suggestion.
- "Sounds like" worked on surnames.
- Adding a numeric range on `revenue` gave a second filter chip. The row count and percentage updated immediately.
- `sort revenue desc` in the command bar worked, and duplicate rows were highlighted in the sorted result.

Friction:

- Fuzzy results come back in file order, with no closeness score and no visible control for how loose the match is. "Catherine Schmitt" matched "Katherin Smith" and I cannot tell why or tune it.
- In the "+ Add filter" column picker, typing a name and pressing Enter does nothing. You must click the single remaining match.
- With 30 columns, scrolling right loses the identifying columns. I found no way to freeze a column (I may have missed it).

### C. Cleaning and diagnosing quality: strong diagnosis, flawed batch fix

Detection against the planted defects, 100,000 rows:

| Planted defect | Planted | TurboFuzz result |
|---|---|---|
| Exact duplicate rows | 420 | Found, 420 |
| Dates written dd/mm/yyyy in an ISO column | 1,993 | Found (reported 2,078, which includes the 85 below) |
| Impossible dates (`00/00/0000`) | 85 | Found, 85 |
| `TBC` in an integer column | 90 | Found, 90 |
| Comma decimals (`562,77`) | 98 | Found, 98; left for the user to decide |
| `N/A` placeholders | 3,914 | Found, one-click fix |
| Malformed emails | 408 | Found, 408 |
| Case variants (`nsw`, `consumer`, `low`, upper-case names) | about 3,500 | Found, with before/after preview |
| Negative quantities | 208 | Found |
| `Y`/`N`/`TRUE`/`FALSE` mixed with Yes/No | about 640 | Partly: only `yes`/`no` case variants merged |
| Long-form states (`New South Wales`, `N.S.W.`) | about 1,500 | Flagged only as "long values", not as variants of NSW |
| Trailing-space `NSW ` | 247 | Missed; shows as a second, identical-looking "NSW" row in pivots |
| Same order ID on different orders | 301 | Missed |
| Ship date before order date | 198 | Missed |
| Discount of 500% to 2,500% | 54 | Missed |
| `-999` sentinel in revenue | 101 | Missed |
| Revenue inflated 1,000× | 26 rows over 100,000 | Not in the top 25 of the default outlier scan |

That is a good hit rate on single-column problems and a weak one on cross-column and key problems. For a serious data-quality tool, key uniqueness and "date A before date B" are table stakes.

The fix flow is well designed: each issue shows now-versus-after bars, the impact in plain words ("a pivot by state shows 19 groups instead of 15"), and every fix becomes its own undoable Recipe step.

It did not work as labelled. "Apply all 7 safe fixes" applied one. Pressing again applied two of six, then two of four, then two of two. Four presses were needed and no message explained why (observed, twice in a row).

Other things to know:

- Suggested rules are learned from the dirty data. The suggestion for `state` was "is one of ACT, N.S.W., NSW…" and for `segment` "Consumer, Corporate, SMB, consumer…". Accepting them enshrines the dirt.
- `lat` and `lon` were each tagged with about 1,000 "value outliers". They are ordinary coordinates for Darwin, Hobart and Cairns.
- `product_name` was flagged as possibly sensitive personal data because of the word "name".

### D. Summarising and aggregating: capable, but it broke

The pivot has Rows, Columns, Values and Filters zones like Excel. Aggregates include median, distinct count, mode and 90th percentile. Post-steps include running total, % of total, rank and year-over-year. A cross-tab of category by segment on 100,000 rows returned in about 150 ms. The grand total matched pandas to the cent (184,850,775.01).

Problems, in order of severity:

1. **Removing a measure kills the view.** With two values in the pivot, clicking × on one left the result area blank with "updating…" forever. No error was shown. Adding and removing fields afterwards did not revive it. I reproduced it in a fresh view. The console shows `TypeError: Cannot read properties of undefined (reading 'post')` in the table renderer. From the code, the old result is drawn against the new, shorter measure list (inferred from `views-panel.ts`, lines 4098 and 4154).
2. **The default pivot is "Sum of lat by state".** Summing latitude is meaningless. The chart panel on the same data correctly offered "Total revenue over time", so the knowledge is there and not shared.
3. **A raw browser error is shown to the user** on creating a new view: "Failed to execute 'removeChild' on 'Node'…".
4. **Column headers are upper-cased**, so `Consumer` and `consumer` appear as two columns both headed CONSUMER.
5. **Small inconsistencies:** the field menu says "Add to Index" where the zone says "Rows"; the view title stayed "Sum of lat by state" after its fields changed; "Waiting for the first result…" stays on screen after results arrive; there is a hard limit of five views.

### E. Creating charts: a real strength

- **Pivot to chart** is one click. Rows go on the axis, Columns become the series, and the settings panel uses the pivot's own words. A link takes you back to the pivot. Changing the value from row count to revenue redrew instantly.
- **Table to chart** opens a panel with quick starts, a field list with roles, and five common chart types with more behind a disclosure. It does not overwhelm.
- **Defaults are honest.** The line chart carried a banner saying 3,035 rows had no ship date, with buttons to see them. Incomplete first and last months were hatched.
- **Context is kept.** Filters apply to charts. The line chart links to the Time Series page and carries its fields across.

Weaknesses:

- A chart built from a pivot can only be Bars or Heatmap. No line, no stacked bars.
- The quick start chose `ship_date` over `order_date` for "revenue over time", though the Overview had suggested `order_date`.
- The default chart title was "View_5" and the value axis had no title.

**Time Series and Map** work as dedicated destinations that the general chart hands off to, which is the right structure. The forecast panel is unusually honest: it stated that its model "did no better than the simple Overall average" in backtests and labelled the forecast "Use with care". Excel and Power BI will both draw you a confident forecast line with no such warning. The page is dense, though, and assumes the reader knows what KPSS and stationarity mean.

### F. Producing something useful: the weakest link

- **Export** offers CSV, semicolon CSV, TSV, JSON and JSON Lines, with gzip or zip, filtered or all rows, formula escaping, and mask or exclude for sensitive columns. There is no Excel export and no Parquet export.
- **The recipe** lists every step in order with undo, and exports as pandas or Polars. The panel said "7 of 7 steps export as executable pandas".
- **The recipe is not faithful.** The generated date line is `pd.to_datetime(df["order_date"], dayfirst=True, errors="coerce")`. On pandas 2.3.3 against the same file, that parsed 97,440 dates and turned 2,560 into nulls. Of the 1,993 dd/mm/yyyy dates, it parsed none. Adding `format="mixed"` parsed 99,433. The recipe's own header mentions `format="mixed"` but the line does not use it.
- **The recipe does not carry the schema.** It starts with a bare `pd.read_csv("input.csv")`, so postcodes and phone numbers lose their leading zeros in Python even though the app preserved them.
- **Nothing persists.** Reloading the page loses the dataset. A workspace file can be saved and reopened (not tested).

A second analyst can read the Recipe and understand what was done. They cannot yet run it and get the same data.

### G. Comparing two versions of a file: a second champion (added after the first pass)

The first pass skipped Compare mode. I went back and tested it with two cases where the true differences were known.

**Case 1: 20,000 rows, B derived from A, rows shuffled.**

| Planted difference | Planted | Compare reported |
|---|---|---|
| Rows removed | 150 | Only in A: 150 |
| Rows added | 200 | Only in B: 205 (200 plus the 5 repeated-key rows below) |
| `amount` changed | 300 | 304 (300 plus 4 of the repeated-key rows) |
| `status` changed | 80 | 80 |
| Same number written differently (`100.50` vs `100.5`) | 54 | Correctly not counted |
| Trailing space added to `name` | 40 | Not counted; the report says "extra spaces ignored", and this is a setting |
| Column removed (`score`) and added (`tier`) | 1 each | Both shown |
| Key repeated in B | 5 | Warned: "Check the key before trusting the numbers: 5 rows in B repeat a key" |
| Row order shuffled | all | No effect, as it should be |

It chose `id` as the key by itself, explained why ("99.0% of B's keys are in A"), and reported the comparison took 59 ms. The Report page is the best single screen in the product: counts, a per-column breakdown with the most common before-and-after values, a column list, and a totals check that separates "the sum moved because rows were added" from "the sum moved because values changed".

The setup page judges every candidate key in plain words ("Only 4 different values: a label, not an id") and offers numeric tolerance, case and whitespace handling, matching by position, or whole-row matching.

**Case 2: 300,000 rows × 10 columns, key column renamed from `id` to `customer_id` in B.**

- Time from pressing Compare to the result on screen: 11.6 s, at 235 MB.
- The renamed key was not recognised. The two columns hold identical values, but they were listed as "only in A" and "only in B", and the comparison fell back to matching whole rows.
- The result was internally consistent and misleading: 0 changed, 1,720 only in A, 2,920 only in B. The truth was 1,420 changed, 300 removed, 1,500 added. Every changed row was counted as one removal plus one addition.
- The app does say "Rows matched on: whole rows (no key)" with a link to setup, and setup has a "Pair with…" control that fixes it. It does not suggest the pairing, though the values overlap almost completely.

**Other observations**

- Compare mode is sealed off: "Other tools are locked until you exit". You can open A or B alone in the workbench, but you cannot take "the 384 changed rows" into a pivot or chart without exporting to Excel first.
- The Value differences page opens with every unchanged row showing 0, in no useful order. It should open on the changed rows, largest first.
- Exports: HTML report, changes as CSV, changes and rows as Excel (not opened).

**Where this leaves the verdict.** Month-on-month reconciliation of extracts is a job my team does weekly in Excel with lookups, badly. This does it in seconds and warns about the traps. It is a stronger reason to adopt than anything except the first-look profiling, and I would add "reconcile this month's file against last month's" to the pilot's first workflows. The renamed-key case needs fixing first, because a confident wrong answer in a reconciliation is the worst kind.

---

## 4. Capability assessment

| Capability | Status | Strengths | Limitations |
|---|---|---|---|
| CSV import | Working well | Fast, typed, keeps leading zeros, explains ragged rows | A random binary file named `.pdf` loaded as a table of garbage with no warning |
| Other formats (Excel, Parquet, JSON, archives) | Not verified | Listed on the start screen | Not tested |
| Large-file guard | Working well | Honest estimate ("needs about 2.6 GB of 4.1 GB"), offers a 100,000-row sample | No progress indicator seen during the 89-second full load |
| Profiling and Overview | Working well | Everything on one screen in seconds | "Unique key" claim was wrong for this file |
| Data-quality detection | Working well | Most single-column defects found with exact counts | Misses key duplicates, cross-column rules, trailing spaces, sentinels |
| Data-quality fixes | Working with friction | Previews, plain-language impact, per-step undo | "Apply all" applies only some fixes per press |
| Quality score | Working with friction | Dimensions and weights are visible | 99.3 with 10% of rows failing; not discriminating |
| Search and filter | Working well | Fuzzy and phonetic search, range sliders, chips, command bar | No match score, no column freeze found, Enter does not pick in add-filter |
| Calculated columns | Working well | Excel-style formulas with live preview and result type | Previewed only; not applied |
| Pivot | Working with friction | Rich aggregates and post-steps, fast, correct totals | Crash on removing a measure; poor default; five-view cap |
| Charts | Working well | One-click from pivot, data-issue banners, sensible gallery | Pivot charts limited to Bars and Heatmap |
| Time Series | Working well | Honest forecasting, anomaly flags matched planted spikes | Specialist vocabulary |
| Map | Working well | Auto-detected coordinates, offline base map | Only markers tested |
| Outliers | Working with friction | Five methods, guided steps, 4 s on 100,000 rows | Default scan always flags the top 1% and ranked ordinary large orders above the planted errors |
| Relationships | Working well | Finds dependencies such as phone → customer | Specialist |
| Export | Working with friction | Scope, masking and formula-safety options | No Excel or Parquet; file write not tested |
| pandas recipe | Partially implemented | Readable, ordered, complete on paper | Date step loses data; no schema on read |
| Polars recipe | Not verified | Offered | Not tested |
| Connections, refresh, sharing, permissions | Absent | n/a | By design |

---

## 5. Competitive positioning

### Excel

- **TurboFuzz is better at:** opening 100,000 or more rows without lag; seeing every column's type, spread and gaps at once; fuzzy and phonetic search; finding duplicates and inconsistent spellings; keeping identifiers intact; an undoable record of what was changed.
- **Excel is substantially better at:** formulas across sheets and tables, lookups, what-if modelling, free-form layout, formatting for print, and being a file everyone can open and edit.
- **Workflows that could move:** "open this export and tell me if it is usable", de-duplication, cleaning category spellings, quick pivots on large extracts, finding a customer whose name is spelt three ways.

### Power BI

TurboFuzz cannot replace Power BI for any reporting use. It has no semantic model, no relationships between tables, no scheduled refresh, no workspace, no row-level security and no distribution. It is an upstream exploration tool. Its realistic effect on Power BI work is that analysts arrive with data they already understand and have already cleaned, and stop using Power BI Desktop as a profiler.

### Python, pandas and Polars

- **It replaces code** for the first look and for routine cleaning, which is real time saved even for fluent Python users.
- **It does not yet bridge to code reliably.** The recipe is the right idea and the date defect shows it cannot be trusted unchecked. Until the recipe is verified against the app's own output, treat it as a draft.
- **It cannot replace code** for joins, anything repeatable on a schedule, or data larger than memory.

### SQL and data platforms

Its value today sits entirely with files someone hands you. The strict no-network design is its privacy strength and also means it will never query a warehouse. The one integration that fits that design is Parquet in and out, so that a warehouse extract can round-trip without losing types.

### Other tools

- **OpenRefine:** the closest in purpose. TurboFuzz is far quicker to start and better at profiling. OpenRefine is stronger at clustering variants and at reconciliation.
- **ydata-profiling and similar:** produce a static report. TurboFuzz produces the report and lets you act on it.
- **Tableau Prep and Power Query:** have joins, connections and refresh, which TurboFuzz lacks. Neither diagnoses quality as well.
- **Great Expectations, Soda, dbt tests:** run unattended in pipelines. TurboFuzz is interactive only. Rule export to these formats exists in the code but I did not find it in the interface.

---

## 6. Usability assessment

**Strengths**

- **Plain-language consequences.** "A pivot by state shows 19 groups instead of 15" tells an analyst why they should care.
- **Preview before change, undo after.** Nothing mutates silently.
- **One environment.** Filters, pivots, charts, map and time series share the same rows and hand off to each other with context.
- **Honesty about limits.** The large-file warning, the chart data-issue banner and the forecast caveats all tell the user something uncomfortable at the right moment.

**Significant issues**

| # | Trying to | What the app does | Why it matters | Severity | Better |
|---|---|---|---|---|---|
| 1 | Swap a pivot measure | View goes blank, stuck on "updating…", no message | Work is lost and the user cannot tell whether to wait | High | Never render a stale result against a new layout; show an error with a retry |
| 2 | Apply all safe fixes | Applies one or two; the button count drops; no explanation | The user believes the data is clean when it is not | High | Apply all selected, report "7 of 7 applied", or say which were skipped and why |
| 3 | Reproduce cleaning in Python | Recipe runs without error and nulls 1,993 dates | Silent data loss downstream, in the user's name | High | Emit `format="mixed"`; test every recipe step against the app's output |
| 4 | Load a 1.5M-row file | Old data stays on screen for 89 s with no progress bar | Looks like nothing happened; users will click again or leave | Medium | Progress with rows read and a cancel button |
| 5 | Judge overall quality | Score reads 99.3 "good" with 10% of rows failing | The headline number invites false confidence | Medium | Lead with "rows affected"; widen the score's range |
| 6 | Start a pivot | Default is "Sum of lat by state" | First impression is nonsense | Medium | Use the measure and dimension the chart quick-starts already choose |
| 7 | Compare segments in a pivot | Upper-cased headers make `Consumer` and `consumer` identical | Hides the exact problem the tool is good at finding | Medium | Show values as stored; mark near-duplicates |
| 8 | Add a filter by keyboard | Enter does not select the only match | Breaks keyboard flow in a keyboard-first tool | Low | Enter selects the top match |
| 9 | Find outliers | Default scan flags a fixed 1% and ranks ordinary large orders first | The obvious errors are not at the top | Medium | Lead with single-column value checks; exclude coordinates by default |
| 10 | Read the screen | Very dense, small type on a large monitor; nine tabs | Fine for daily users, daunting for occasional ones | Low | A simpler default set of tabs, with the research tabs behind a switch |

---

## 7. Performance and technical limits

All timings observed on one machine, single runs unless stated. "App-reported" is the figure the app prints; "wall" is what I measured from the action to the screen changing.

| Operation | 10,000 rows | 100,000 rows | 1,500,000 rows |
|---|---|---|---|
| File size | 2.3 MB | 23.2 MB | about 365 MB (45.0M cells) |
| Load to usable table | 2.2 s | 6.4 s (app-reported 5.5 s) | 89 s |
| Longest interface stall during load | 1.2 s | 0.9 s | 1.7 s |
| Memory gauge after load | 13 MB | 22 MB to about 100 MB | 3.1 GB of about 4.1 GB |
| First text filter on a column | n/m | 10 ms app-reported | 5.1 to 6.2 s |
| Later text filters | n/m | n/m | 0.12 to 0.21 s app-reported; about 1 s wall |
| Fuzzy search | n/m | 2 ms app-reported | 8 ms app-reported; 2.8 s wall |
| Sounds-like, exact | n/m | n/m | 0.5 s, 0.7 s wall |
| Sort one column | n/m | under 1 s | 3.7 s |
| Pivot, 15 groups | n/m | 130 to 160 ms | not measured (see below) |
| Line chart, 51 monthly groups | n/m | 198 ms | n/m |
| Isolation Forest quick scan | n/m | 4.0 s | n/m |

n/m = not measured.

Other observations:

- **Cold start:** first paint at 1.9 s, 817 KB transferred, seven requests.
- **At or below 100,000 rows** the product feels instant for filtering, pivoting and charting.
- **At 1.5 million rows** it works, and the first interaction with each column costs five to six seconds while it prepares that column. After that it is usable.
- **Pivot at 1.5 million:** a three-field pivot rendered, but the tab then stopped responding for more than 45 seconds while my script was adding fields. I could not isolate which step caused it, so treat high-cardinality pivots at this size as unproven.
- **Memory grows with use.** On the 100,000-row file the gauge rose from about 100 MB to 1.6 GB after I visited Outliers, Relationships and Map and sorted once. I did not establish whether it is released.
- **The app's own timing figure understates the wait.** "8 ms" printed beside a search that took 2.8 seconds to appear will be noticed.
- **Architectural ceiling:** everything lives in one browser tab's memory, about 4 GB in Chrome. The app's own estimate put this 1.5M × 30 file at 2.6 GB. A wider file of the same length, or a second dataset for comparison, will not fit. This is a hard limit of the design.

---

## 8. What makes TurboFuzz special

1. **Diagnosis that explains itself and can be acted on.** Counts, examples, consequence, preview, fix, undo, in one card. Nothing else in the usual toolkit does all six.
2. **Privacy by construction.** The deployed page forbids all outbound connections (`connect-src 'none'`, code). For teams handling customer or patient data, this turns a months-long approval into a short conversation.
3. **Fuzzy and phonetic search at interactive speed.** Finding "Katherine Smyth" from "Katherin Smith" across 1.5 million rows is something Excel cannot do and Python makes you write.
4. **Analytical honesty.** Hatched incomplete periods, data-issue banners on charts, and a forecast that says when it is no better than an average. This is rare and it is the right instinct for an analytics team.

The pivot, the map, the outlier methods and the relationship matrix are useful, and none of them is a reason to choose TurboFuzz over what a team already has.

---

## 9. Biggest weaknesses, ranked

1. **Exported recipe silently loses data.** It undermines the reproducibility claim, and the damage lands downstream where nobody is watching.
2. **Pivot view dies on removing a measure.** Pivoting is the most common thing an Excel user will try first.
3. **"Apply all safe fixes" does not apply all.** A cleaning tool that under-delivers without saying so cannot be trusted with cleaning.
4. **No cross-column or key checks by default.** Duplicate keys and impossible date orders are the defects that cause real reporting errors.
5. **A quality score that reads 99 on dirty data.** It will be quoted in emails.
6. **Single file, single user, no persistence.** This caps it as a personal tool. It is a design choice, and it means the product cannot become a team's system of record for anything.
7. **Breadth outrunning polish.** Nine tabs, with raw error text, stale titles and inconsistent wording visible in the busiest one. Each is small. Together they tell a careful analyst that the product has not been used hard by people other than its author.
8. **No Excel or Parquet export.** The two formats my team would most want to hand on.

---

## 10. Prioritised roadmap

### P0: fundamental

| Recommendation | User problem | Now | Proposed | Benefit | Effort | Why P0 |
|---|---|---|---|---|---|---|
| Make every recipe step reproduce the app's result | Python output differs from what the analyst saw | Date step nulls mixed-format dates; no schema on read | Emit `format="mixed"`; emit `dtype=` for identifier columns; run each generated step against the app's own output in the parity suite, including mixed-format columns | Recipe can be trusted | Low for the two fixes, medium for the test coverage | Silent data loss |
| Fix the pivot crash on removing a measure | View dies, work lost | Stale result drawn against new measures | Clear or ignore the old result when the layout changes; catch render errors and show a retry | Pivot is safe to explore | Low | Reproducible in a core workflow |
| Make "Apply all" apply all | Data believed clean when it is not | One or two of N applied per press | Apply sequentially against refreshed issue IDs; report applied and skipped | Cleaning is trustworthy | Low to medium | Mislabelled action on the product's main promise |

### P1: high value

| Recommendation | User problem | Now | Proposed | Benefit | Effort | Why P1 |
|---|---|---|---|---|---|---|
| Key and cross-column checks on by default | Worst real-world defects go unreported | Duplicate IDs, date order and out-of-range percentages missed | When a column looks like a key, test uniqueness and report it; auto-suggest date-order checks for date pairs; range checks for `_pct` columns | Catches the defects that break reports | Medium | Biggest gap in the strongest feature |
| Catch whitespace and long-form variants | Two identical-looking groups in a pivot | `NSW ` and `New South Wales` not merged | Treat trimmed-equal values as variants; use the existing reference lists to map long forms | Cleaner grouping | Low to medium | Directly visible in pivots |
| Progress and cancel on every large load | Looks frozen for 89 s | No indicator seen when replacing loaded data | Rows-read progress on all load paths | Confidence at scale | Low | Cheap, high perceived benefit |
| Sensible pivot default, real values in headers | Nonsense first pivot; hidden case differences | "Sum of lat"; upper-cased headers | Reuse the chart recommender's measure; show values as stored | Better first impression, fewer misreadings | Low | Makes two existing features agree |
| Rebalance the quality score | False confidence | 99.3 with 10% of rows failing | Lead with rows affected; rescale so common defects move the number | Honest headline | Medium | It will be quoted |
| Print the time the user waited | "8 ms" beside a 3 s wait | Internal time only | Show end-to-end time | Credibility | Low | The product sells speed |

### P2: strategic

| Recommendation | User problem | Now | Proposed | Benefit | Effort | Why P2 |
|---|---|---|---|---|---|---|
| Excel and Parquet export | Cannot hand results on in the formats teams use | CSV and JSON only | Add both | Fits existing workflows | Medium | Widens who can use the output |
| Join or look up against a second file | Most real questions involve two tables | Append and compare only | A simple keyed lookup | Covers the most common Excel job it lacks | High | Expands the addressable work |
| Expose rule export (dbt, Soda, Great Expectations) | Findings do not reach pipelines | In code, not in the interface | Surface it, after fixing rules learned from dirty values | Bridges to engineering | Low to medium | Makes it part of a governed process |
| A shareable, self-contained findings page | Nothing to send a manager | HTML quality report only | Charts and pivots in one static page | A real output | Medium | Closest it should come to reporting |

### P3: nice to have

- Enter selects in the add-filter picker (low).
- Match score and a looseness control for fuzzy search (low to medium).
- Freeze columns (low).
- Line and stacked options for pivot charts (medium).
- Reject or warn on files that are plainly not tables (low).
- Stop flagging `product_name` as personal data and coordinates as outliers (low).
- Raise the five-view limit (low).

I would add no new analytical tabs until the P0 and P1 items are done.

---

## 11. Adoption recommendation

**Who benefits most**

- Analysts who receive extracts from other teams or vendors and must judge them quickly.
- Anyone doing reconciliation or customer matching by name.
- Junior analysts, who get a structured checklist of what to look for.
- Python-fluent analysts for the first look, as long as they check the recipe.

**Poor fit**

- Dashboard and reporting developers.
- Work that depends on joining tables or querying the warehouse.
- Anything that must run on a schedule or be audited.
- Files beyond roughly a million wide rows on standard laptops.

**Trial first**

1. Intake review of incoming CSV and Excel extracts.
2. Cleaning category spellings and duplicates before a Power BI load.
3. Ad hoc "find this customer" searches.

**Keep where it is**

- Modelling and anything shared for editing: Excel.
- Dashboards, refresh, distribution, security: Power BI.
- Joins, pipelines, anything repeatable: SQL and Python.

**Scorecard**

| Area | Score | Basis |
|---|---|---|
| Data import and accessibility | 4 | Fast, typed, forgiving CSV import with an honest size guard; other formats not verified |
| Data understanding and profiling | 4 | Whole file understood in seconds; one wrong claim about the key |
| Data quality investigation | 4 | Excellent single-column detection and explanation; misses key and cross-column defects |
| Search and filtering | 4 | Fuzzy and phonetic search are standout; small keyboard and transparency gaps |
| Manipulation and aggregation | 3 | Capable and correct, with a reproducible crash and a poor default |
| Charting and visualisation | 4 | Clean handoff, honest defaults; limited types from pivots |
| Usability and learnability | 3 | Core is learnable in an hour; density and rough edges elsewhere |
| Workflow continuity | 4 | Filters and context carry across every view |
| Performance and scalability | 3 | Instant to 100,000 rows; workable but heavy at 1.5 million; hard memory ceiling |
| Reporting and export | 3 | Thoughtful CSV export; no Excel or Parquet; file write not tested |
| Integration and interoperability | 2 | Files only; recipe is the one bridge and it is flawed |
| Reproducibility, governance, collaboration | 2 | Good step history; unfaithful recipe; no persistence, sharing or audit |

**Success after 30 days**

- Five or six analysts use it unprompted for intake at least weekly.
- Median time from receiving a file to a written quality note falls by half.
- At least three defects are caught that would otherwise have reached a report.
- No incident where exported data or a recipe differed from what the analyst saw.
- Analysts can say in one sentence when they reach for it and when they do not.

---

## 12. Final assessment

**Would I put TurboFuzz in front of fifteen analysts and encourage them to use it?**

Today I would put it in front of five, with a one-page note saying what it is for and three things not to trust yet: batch fixes, the pivot when changing measures, and the exported recipe without checking it. I would not push it to all fifteen.

The idea is sound and the best parts are better than anything else we have for the same job. The first ten minutes with an unknown file are faster and more informative than in Excel, Power BI or a notebook. The privacy model makes the security conversation easy. The honesty about incomplete periods and weak forecasts is what I want my team to learn from their tools.

What holds me back is specific. In two hours I found one place where the tool does less than its button says, one where it stops working without telling me, and one where it hands me code that quietly destroys data. All three sit on the main path of clean, summarise and reproduce. An analytics team runs on being able to say "I checked", and a tool that is sometimes wrong without saying so costs more than it saves.

The product also shows signs of being built outward faster than it has been hardened. Forecasting, isolation forests and dependency matrices sit beside a pivot that crashes on a basic edit. If the choice is between another research feature and making the first four tabs unbreakable, the first four tabs are the product my team would use every day.

Fix the three trust defects, add key and cross-column checks, and I would expand the pilot to the whole team as the standard first step for any file we are sent.
