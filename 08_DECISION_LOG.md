# UX Decision Log

Record significant product and UX decisions so future AI sessions do not repeatedly reopen settled questions.

## Entry template

### DEC-YYYY-MM-DD-NN — Short title

- **Status:** Proposed / Accepted / Rejected / Superseded
- **Context:** What problem or opportunity prompted the decision?
- **Evidence:** Which observation, test or user feedback supports it?
- **Decision:** What will we do?
- **Alternatives considered:** What else was considered?
- **Trade-offs:** What gets better and what might get worse?
- **Features / journeys affected:** IDs from the inventory and journey register.
- **Acceptance criteria:** How will we know the decision worked?
- **Revisit trigger:** What evidence would justify changing this decision?
- **Date / owner:**

---

## Current decisions

Add decisions here. Do not treat AI-generated suggestions as accepted decisions until a human approves them.

### DEC-2026-11-03-03 — A map is a Research page, not a chart type

- **Status:** Accepted (owner, 2026-11-03)
- **Context:** Maps existed twice: a chart type on the Chart page and a Research page built on the same card.
- **Decision:** One place: the Map page in Research. The Chart page says so when a file has coordinates and clicks through. Inside, the map remains the shared chart card, so anything built for charts (colour, size, animation, Extract stats) carries over.
- **Trade-offs:** General mode has no map without a mode switch; the click through makes that switch for you.
- **Date / owner:** 2026-11-03 / owner

### DEC-2026-11-03-02 — Error bars: formulas where they exist, a seeded bootstrap on request, warnings rather than bans

- **Status:** Accepted (owner, 2026-11-03)
- **Context:** Seaborn draws a bootstrapped CI by default. Bootstrapping costs a thousand passes over the rows, against the speed goal.
- **Decision:** Off until ticked. A formula is the default for an average or median; the bootstrap is chosen by hand and is the only option for other statistics. It is seeded, so the same data gives the same bars. Totals, counts, lowest and highest have no bars, with the reason shown. A time series keeps its bars with a warning, by the owner's choice over disabling them. The automatic bars never hide that spread and uncertainty are different questions: the labels and notes say which is showing.
- **Trade-offs:** Rows are treated as independent; with very large groups a CI is narrow and can look more certain than the data deserves.
- **Date / owner:** 2026-11-03 / owner

### DEC-2026-11-03-01 — Extract stats reports what was drawn, and says what was left out

- **Status:** Accepted (owner asked for the feature; the design is the agent's, for the owner's review)
- **Context:** Charting packages rarely hand over the numbers behind a picture: bin counts, box ranges, curve parameters.
- **Decision:** One button on the chart, one window: facts about how it was drawn, then tables, with copy and CSV. Numbers are those the chart drew from, not a recalculation, so they cannot disagree with it. Anything estimated or partial says so: the mean from bins is labelled an estimate, the KDE is described as smoothed bin counts rather than a fit to rows, and rows outside an automatic histogram range are counted.
- **Trade-offs:** The window shows 200 rows of a long table; Copy and Download have them all.
- **Date / owner:** 2026-11-03 / owner

### DEC-2026-11-02-02 — The Chart page is one workspace; a click selects, and filtering is a second step

- **Status:** Accepted (owner, 2026-11-02, after a UX review on real files)
- **Context:** The review found the page clunky, not the charts: the plot started 382 px down a 900 px window, controls lived in three places, the settings drawer covered the data being changed, the builder pushed the chart off screen, the wheel was trapped over charts, and one click on a bar filtered every page and tab.
- **Decision:** Tabs along the top, fields on the left, the plot at window height, one docked settings panel (open until closed, remembered). Adding a chart opens the builder in a new-chart tab. A click on the plot marks and offers Filter to this and Show rows. Plain wheel scrolls the page; Ctrl+wheel zooms; the Map keeps plain wheel zoom, as maps do. The title drawn on the canvas moved to one headline above it, and PNGs still carry it. The Map page keeps the older arrangement.
- **Trade-offs:** Settings take 272 px, so a narrow window loses the field list first, then the settings drop under the plot. Undo covers the settings of one chart, not filters or left-out values.
- **Date / owner:** 2026-11-02 / owner

### DEC-2026-11-02-01 — Formula functions: row-local ones are cheap to add; each needs a Python port and a parity case

- **Status:** Accepted (owner, 2026-11-02)
- **Context:** TEXT([date], "dddd") did not exist, and the owner asked how much more of Excel could be supported without slowing the app.
- **Evidence:** Formulas compile once to closures and run row by row in the worker: 80 to 750 ns per row on the existing functions, so a million rows takes 0.1 to 0.7 s, and a new row-local function costs about as much as YEAR or CONCAT. What each function really costs is its port into the pandas and Polars recipes (the cell must match) and its test.
- **Decision:** 38 functions added. Text: TEXT, VALUE, SUBSTITUTE, REPLACE, PROPER, SEARCH, EXACT, TEXTBEFORE, TEXTAFTER, TEXTJOIN. Numbers: INT, TRUNC, MOD, SQRT, POWER, LN, ROUNDUP, ROUNDDOWN, CEILING, FLOOR, SUM, AVERAGE (SUM and AVERAGE read the values on the row, as MIN and MAX do). Logic: IFS, SWITCH, IFERROR, ISNUMBER, ISTEXT. Dates: HOUR, MINUTE, SECOND, EDATE, EOMONTH, WEEKNUM, DAYS, NOW. Whole column, the same value on every row: COLUMNMEAN, COLUMNMEDIAN, COLUMNSTDEV (named apart from SUM and AVERAGE so a row-wise AVERAGE is never read as a column mean). TEXT supports a documented subset of Excel formats (dates: y m d h s, AM/PM, quoted and escaped text; numbers: 0 # , . %, a currency sign or text around the digits, up to three sections) and refuses scientific, fraction, thousands-scaling, fractional-second and text-between-digits formats instead of guessing.
- **Not added:** lookups across ranges (VLOOKUP, XLOOKUP, INDEX/MATCH: there are no cell addresses, and a second table is another feature), array and dynamic functions (FILTER, SORT, UNIQUE, LET), RAND and other volatile ones (a recipe could not reproduce them), regular expressions (a pattern from the user can run for ever on a long cell).
- **Acceptance criteria:** test/formula-python-parity.test.ts runs every formula in the app and in the exported Python over the same cells and compares each one; it is skipped only where Python is not installed. A new function is not done until it is in that list.
- **Date / owner:** 2026-11-02 / owner

### DEC-2026-11-01-05 — The forecast is judged by one verdict that means "comprehensively beats a simple method"

- **Status:** Accepted, after calibration (CHG-2026-11-02-01)
- **Context:** Owner: the user wants to know whether the model is reliable, whether it is the best available, and whether the shaded band is the likely upper and lower limit. It must comprehensively beat a simple model; everything else is jargon for under the hood; a big issue must be at the top. The page had five places grading the forecast in two scales.
- **Decision:** One function gives the verdict everywhere. Reliable: at least 10% less error than the best simple method in the backtests, wins at least two thirds of the tests, no simple method better on the held-back test, not bottom third there, and a held-back test exists. Use with care: everything else that has a backtest, with the reason said (a thin margin, a short record, or no evidence it beats a simple method). Can't judge yet: too little history. The badge answers three questions (beats a simple method, best available, band) and keeps numbers under the hood. There is no "Not reliable".
- **Evidence:** 497 random Monash series, not used to set the rules: Reliable beat the simple method on the real future 87% of the time (60 series, about 31% less error); the rest 59% (414 series, about 13% less). No backtest signal found a group where the model usually loses, so a red label would have been wrong about as often as right.
- **Trade-offs:** Reliable is precise but uncommon (about one series in eight). The thresholds are rules of thumb. The archive's series are steady business data; sudden breaks may behave differently. Short series are never Reliable.
- **Revisit trigger:** A calibration on the owner's own kinds of series, or a rule that does pick out series where the model loses (then a red label can come back, with its evidence).
- **Date / owner:** 2026-11-01 / owner

### DEC-2026-11-01-04 — A scatter draws points; density is something the analyst chooses

- **Status:** Accepted (owner: "default to points and then offer something more fancy; the auto render isn't helpful")
- **Decision:** The scatter's Render menu is Points or Density. Points are thinned to a sample when there are too many, said in the note, with a one-click link to the density map. Charts saved with "Auto" draw points.
- **Trade-offs:** A very large scatter shows a sample of its points until density is chosen; the note and the link say so.
- **Date / owner:** 2026-11-01 / owner

### DEC-2026-11-01-03 — AutoARIMA's differencing can be chosen by a forecast vote (DV-ARIMA), an opt-in alternative in the deep run

- **Status:** Accepted (owner: "ship DV-ARIMA and explain it is not novel but can't find it implemented anywhere before; small gain in performance")
- **Context:** The owner asked for a genuinely new derivative of auto.arima. Four candidate ideas were developed on one set of random Monash series and judged on others never used for choosing (seeds fixed in advance, bar set before testing: at least 1% better on both fresh sets, more wins than losses).
- **Decision:** Ship the differencing vote. The search runs at the unit-root test's choice and its neighbours; each choice's best three models forecast the last stretch of the history from three origins; choices are weighted by inverse squared error, Akaike weights decide within a choice; the forecast and ranges are the mixture. It is off by default (owner: offer it as an alternative that may boost performance): a small gain, 3 to 5 times slower, and a headline model that can differ from R's. A tick box turns it on, and the page then shows plain auto.arima's choice beside it.
- **Evidence:** Mean MASE against the AutoARIMA already shipped, four unseen sets of 150 series: 5.9% and 3.8% lower (seeds 12, 13), 0.0% and 0.5% lower (seeds 42, 43); 275 wins to 193 losses. A fair estimate is 2 to 3%, and the first two sets flattered it. It does not beat the board's Combination.
- **Not shipped, and why:** variogram-matched coefficients (0.8% and 1.2% better, short of the bar, ranges unchanged; p about 0.08 pooled); revision-corrected forecast (under 1% even on the development set: AutoARIMA's revisions have a median persistence of -0.01, so there is nothing to correct); drift vote (7% better on the development set, 0.4% better and 1.0% worse on the fresh sets); forecast damping or shrinking of the drift (mixed); blending ARIMA with the Combination (the Combination alone is as good).
- **Novelty, stated honestly:** the parts are old (forecast averaging; the econometric argument between unit-root pretesting and averaging over the restriction, Diebold and Kilian 2000, Hansen 2010, in autoregressions). We found it applied to the differencing order of an automatic ARIMA, scored by forecast error, in none of R's forecast, statsforecast or pmdarima; that is weaker than "nobody has done it" and the page says so.
- **Trade-offs:** 3 to 5 times slower than the plain search (about 4 s against 1 s on the airline passengers; 11 to 15 s on monthly series of 150 to 330 points); the headline model can differ from R's on the same data. The knobs (three origins, top three models, inverse squared error) were fixed before the fresh sets were seen.
- **Revisit trigger:** A larger run (all series, not 150) that moves the estimate outside 1 to 4%, or a variant that clears the bar on two fresh sets.
- **Date / owner:** 2026-11-01 / owner

### DEC-2026-11-01-02 — The whole app takes the "analyst console" look

- **Status:** Accepted (owner, 2026-11-01)
- **Context:** The Forecast tab looked better than the Table and the other pages. A canvas ("Table page: three looks") compared a calm workspace, an analyst console, a report style and today's page; the owner picked the analyst console for every page.
- **Decision:**
  - Sans serif (Inter) for all labels and prose; a monospace face (JetBrains Mono) for the file path, file facts, counts, timings, row numbers, column facts, numbers and dates in the grid, formulas and pandas code.
  - A dark top bar and a dark status bar frame every page in both themes; the content area stays light in the light theme.
  - Dense, hairline grid lines; column headers show the full name with a second monospace line of facts (`int · 13–58`); compact controls with small radii; one dark primary button per area.
  - Page tabs show their number key.
  - Both fonts are bundled (SIL Open Font License 1.1, licence files shipped beside them) so the app stays offline.
- **Trade-offs:** More monospace makes the app look technical and can feel colder; denser rows suit analysts more than casual users. Fonts add roughly 150 KB to the bundle.
- **Features / journeys affected:** every page.
- **Acceptance criteria:** every page uses the shared tokens; no column name is cut short at the default width when it fits; contrast passes 4.5:1 in both themes; e2e passes; the latency benches are unchanged.
- **Date / owner:** 2026-11-01 / owner

### DEC-2026-11-01-01 — Forecast tab: three layers, Compare models closed by default, "Doubtful" in red

- **Status:** Accepted (owner, 2026-11-01)
- **Context:** Eight models, seven measures and many diagnostics made the Forecast tab overwhelming (next_steps.md, "Forecast tab UX"). A mock-up (canvas "Forecast tab: three layouts") compared today's page with a layered one.
- **Decision:**
  - The tab shows **one answer first** (the chosen forecast, a trust verdict, forecast ahead, band and Export), with **Compare models** and **Under the hood** as two bars that open on demand. **Both are closed on first view**, and a person's choice is remembered in the browser.
  - The trust verdict may say **"Doubtful", in red**, when a model fell apart on data it never saw.
  - Still open: whether to add a single Simple / Detailed switch on top. The two bars are built so the switch could be added later without rework.
- **Trade-offs:** The model board and the measures are one click further away; in return a first-time viewer sees a forecast and how far to trust it, not a statistics workbench. The red verdict is unmistakable and can alarm someone who wanted a quick forecast.
- **Features / journeys affected:** Time Series, Forecast mode.
- **Acceptance criteria:** the page opens with both layers closed; the verdict, the compare board and the analyst tools are each reachable in one click; end-to-end tests cover all three.
- **Date / owner:** 2026-11-01 / owner

### DEC-2026-10-31-03 — Time Series view: up to 500 ms with a spinner; heavier work behind a button

- **Status:** Accepted (owner, 2026-10-31)
- **Context:** Accuracy work on the Time Series forecasts (long seasons removed with MSTL, textbook ETS to come) costs compute, and the old budgets (110 ms daily, 220 ms hourly to open) left no room for it. Speed remains the project's core ethos.
- **Decision:**
  - Anything on the Time Series view that recomputes models may take **up to 500 ms**. A **"Calculating..." pill with a spinning donut** appears once a request passes 150 ms, so nothing looks stuck; quicker answers show nothing.
  - Work that would take longer than that does not run automatically: it sits **behind a button** (as the **Deep check** and the Trend flexibility check do today).
  - Cheap interactions keep their tight budgets (moving the rolling window: 8 ms daily, 15 ms hourly).
  - The earlier tight figures stay as **soft targets** in `bench/timeseries.ts`: going over one prints "slow" but passes, so a creeping slowdown stays visible.
- **Trade-offs:** A slower open on large hourly series in return for better forecasts (hourly Auto error -19% from MSTL). The ceiling can be used up gradually; the soft targets are there to make that visible.
- **Features / journeys affected:** Time Series page (open, horizon drag, Patterns, aggregation switch), `bench:timeseries`.
- **Acceptance criteria:** `npm run bench:timeseries` passes with every model-heavy case under 500 ms; the e2e test shows the pill for a 700 ms wait and not for a fast one.
- **Revisit trigger:** A model-heavy case approaches 500 ms, or users report the wait.
- **Date / owner:** 2026-10-31 / owner

### DEC-2026-10-31-02 — Table plan: computed-once columns, first/last N filters, edit confirm on

- **Status:** Accepted (owner, 2026-10-31)
- **Context:** Open questions in next_steps.md, "BIG TODO: the Table view".
- **Decision:**
  - New columns are **computed once** when their step runs and replayed by the Recipe; they do not recompute when a cell they read is edited later. Editing the formula step recomputes the column.
  - **First N / last N** is a filter like any other: Copy, Chart and Export see the same rows, and its chip says so.
  - Editing a cell asks **"are you sure"** by default, next to the cell, with "Don't ask again for this session"; every edit is an undoable Recipe step tied to the file row.
- **Trade-offs:** A formula column can disagree with a later hand edit to a cell it reads, until the formula step is edited; editing a formula column's own cells is refused ("edit the formula instead").
- **Date / owner:** 2026-10-31 / owner

### DEC-2026-10-31-01 — New-column formulas are Excel style

- **Status:** Accepted (owner, 2026-10-31)
- **Context:** The Table's New column window needs a formula language (next_steps.md, "BIG TODO: the Table view", section 1). Compared side by side: Excel style (`IF([Status] = "Closed", "Done", "Open")`, `UPPER([First] & " " & [Last])`, `YEAR([Order date])`) against pandas style (`np.where(Status == "Closed", …)`, `(First + " " + Last).str.upper()`, `` `Order date`.dt.year ``).
- **Decision:** Excel style. Columns are `[Column]` (any name, spaces included; `[` opens column suggestions). Spreadsheet function names: `IF`, `AND`, `OR`, `NOT`, `ROUND`, `ABS`, `MIN`, `MAX`, `LEN`, `LEFT`, `RIGHT`, `MID`, `FIND`, `UPPER`, `LOWER`, `TRIM`, `CONCAT` and `&`, `YEAR`, `MONTH`, `DAY`, `WEEKDAY`, `DATEDIF`, `TODAY`, `ISBLANK`, `COALESCE`/`IFBLANK`. The window shows the matching pandas line under the preview, and Recipe export writes pandas and Polars as for every step.
- **Trade-offs:** Python users write a syntax they use less, softened by the pandas line shown and the export; deep nesting of `IF` is offset by the Conditional builder.
- **Acceptance criteria:** every function has a parity case (pandas and Polars give the app's result); unknown columns and functions are reported at their place in the formula with a suggestion.
- **Date / owner:** 2026-10-31 / owner

### DEC-2026-10-29-01 — Score band caps and optional columns (plan D7)

- **Status:** Accepted 2026-10-29 by the owner as the starting thresholds (50%/75% empty, 20%/50% invalid); revisit after real use
- **Context:** A weighted mean can read "good" while one column is mostly unusable (Titanic Cabin 77% empty scored 96.8).
- **Evidence:** Corpus run: ARDD and UCS satellites read "poor" at 94 and 91 under the caps because several columns are 75%+ empty.
- **Decision:** Keep the weighted mean as the number. Cap the band at fair when a required column is more than 50% empty or a column has more than 20% invalid values; cap at poor above 75% empty or 50% invalid. The hero says why. Optional columns (name hint, or the only incomplete column in an otherwise complete table, or user-marked) count 25% towards Completeness and never cap the band. Empty columns stay excluded and reported once.
- **Alternatives considered:** Leave the band as the number only; cap by the worst column score.
- **Trade-offs:** Honest about unusable columns; may read harsh for sparse-by-nature data (government tables filled only for some regions). The user can mark such columns optional.
- **Features / journeys affected:** Data Quality hero, issue list (empty-cell cards), score tile.
- **Acceptance criteria:** Titanic reads fair with the Cabin reason; clean datasets stay good (test/band-optional.test.ts and the corpus).
- **Revisit trigger:** Owner finds the thresholds too strict or too lax on their own data.
- **Date / owner:** 2026-10-29 / owner approval pending
- **Known gap:** Optional marks are session-only; saving them in the Recipe and rules file waits on M3.

### DEC-2026-10-29-02 — Local history stores rates and counts only (plan D5)

- **Status:** Accepted (implemented as planned)
- **Context:** Users want to see change between loads without the app keeping their data.
- **Decision:** One snapshot per load in IndexedDB on this device: scores, row counts, per-column fill rate and distinct count, rule pass rates, schema. Category labels only for columns with 12 or fewer values that are not flagged sensitive, and none until the sensitive scan has run. Never cell values or examples. Snapshots are matched by file name; at most 30 are kept. A switch turns recording off and a button clears it.
- **Trade-offs:** A renamed file starts a new history. The same file reloaded within a minute is not recorded twice.
- **Acceptance criteria:** test/history.test.ts (sensitive columns never store labels, diff, cap, clear); the tab hides its content when IndexedDB is blocked.
- **Date / owner:** 2026-10-29 / owner

### DEC-2026-10-29-03 — Rules are data, never code (plan R1/R2)

- **Status:** Accepted
- **Decision:** A rule is a plain object (not empty, unique, range, one of a list, regex, length, compare columns) run by a pure evaluator. No eval and no `new Function`. Regex patterns are capped at 200 characters and nested repeats such as (a+)+ are refused. Rules reference columns by name and live in the session and in `turbofuzz-rules.json`, which carries a schema fingerprint.
- **Trade-offs:** Rules are remembered for the session only, not across browser restarts; a rules file is the durable form.
- **Date / owner:** 2026-10-29 / owner

### DEC-2026-10-29-04 — Accuracy is offline and carries no weight by default (plan REF)

- **Status:** Accepted
- **Decision:** Bundled lists (countries, currencies, AU and US states, weekdays, months) load by dynamic import only when a column's name and values point at one. A column needs 60% of its distinct values on the list before it is checked. Accuracy weight stays 0, so it is applicable but does not move the score unless the owner changes the weights.
- **Date / owner:** 2026-10-29 / owner
