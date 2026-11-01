# UX Change Log

Record shipped or attempted UX changes and what was verified.

## Entry template

### CHG-YYYY-MM-DD-NN — Short title

- **Status:** Planned / In progress / Verified / Rolled back
- **Related issue / decision:**
- **Git commit / PR:**
- **Problem addressed:**
- **Scope:**
- **Explicit non-goals:**
- **Acceptance criteria:**
- **Files / components changed:**
- **Tests run and results:**
- **Manual browser verification:**
- **Regression findings:**
- **Feature inventory / baseline updates:**
- **Known limitations:**
- **Decision:** Ship / revise / roll back
- **Date:**

---

## Recent changes

Add entries here. Keep unsuccessful attempts too if they reveal useful constraints or recurring failure modes.

### CHG-2026-11-01-32 — Map: one dot per place, "Aggregate", and no background picture

- **Status:** Verified
- **Scope:**
  - **One dot per place.** Show offers a third option beside "One dot per row" and "Heat grid": rows at the same place (to about a metre) become one dot, sized by how many rows it holds, or by an aggregate of the Size column. It is worked out in the worker over every row, not a sample (the busiest 20,000 places are kept if there are more, and the note says so). When many rows sit on few places, the note says "600 rows sit on 24 places" and offers the switch in one click; with the option on it reads "24 places from 600 rows, the busiest holds 25, dot size = rows".
  - **"Reduce" is "Aggregate"**, the word the chart page already uses, and a greyed-out control now says why on the page ("pick a Size column first") instead of only in a tooltip. The map's title is "Map", not "start station longitude vs start station latitude"; the card's repeated "Map: rows from Table" line is hidden on the Map page, and the card's own Fit all is hidden there because the dock has one (it stays on map cards in the Chart page).
  - **The background picture is removed** (owner: placing it needs a geographic anchor, which is GIS work). The Background image button, the offline-map guide, the placement controls (whole world, world file, edges, projection, opacity, greyscale, credit), their storage and tests, and the helper module are gone. Markers, cities, and the bundled land and water are unchanged, and the markers' database keeps the schema it was created with.
  - **Two fixes found on the way.** The "show all of them as a density map" link on a large scatter never appeared: it had been placed in the map's note routine, and the card also rebuilt the note from its text, which flattened any link in it into plain words. The link is in the scatter's note now, styled as a link, and the note is appended to rather than rewritten.
- **Files / components changed:** src/data/chart-series.ts, src/worker/protocol.ts, search.worker.ts, src/ui/chart-card.ts, map-page.ts, help-content.ts, app.ts, src/styles.css, bench/map.ts; removed src/data/map-background.ts
- **Tests run and results:** groupPlaces unit tests (grouping, a metre apart, aggregates, missing values, the cap, empty); e2e on trip-shaped data for the note, the switch, the Aggregate wording and the single Fit all, and for the scatter link; the picture tests were removed with the feature
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-31 — Forecast verdict, second pass: one verdict, three questions, judged against the best simple method

- **Status:** Verified
- **Scope:** Replaces the wording of CHG-2026-11-01-30. The owner's test: "is the model reliable and is it the best available for the job? It must comprehensively beat a simple model. The bands are a nice to have; anything more is jargon. Details under the hood. A big issue must be clear at the top."
  - **One verdict, one vocabulary.** Five places graded the forecast in two scales (the badge said Middling while the top strip and the findings said Good). All now use the same words from the same function: Reliable, Use with care, Not reliable, Can't judge yet (and Baseline for the yardstick itself). The old "Holds up / Middling / Doubtful" and the separate Good / OK / Poor on the surface are gone; the Grade column stays under the hood.
  - **The badge answers the owner's three questions, in order**, each a bold question, a one-word answer and one sentence: "Does it beat a simple method?", "Is it the best available?", "Can you trust the shaded band?". Numbers and jargon (lockbox, folds, MASE, AICc, naive) are not on the surface and a test keeps it so; Details opens the numbers under the hood.
  - **"Reliable" is one thing: it comprehensively beats the best simple method.** At least 10% less error than the best of the six simple methods in the backtests (not only repeating the last cycle, which is a poor yardstick for noise), winning at least two thirds of the tests, no simple method doing better on the held-back test, and not in the bottom third there. With no test held back it cannot be called reliable. This is a rule of thumb, not a statistical test, and has not been calibrated against real out-of-sample results yet (see the plan note).
  - **Reliable and best are separate answers.** A model can be reliable and rank mid-table; its place and the leader's margin are said without alarm (never red; red is only for failing the simple-method test).
  - **A problem is loud.** Not reliable is a red card and Use with care an amber one; the verdict is also in the top strip on every tab. The shaded band is judged on its own and never changes the verdict on the line.
  - Found on random-looking data: the first version called pure noise "Reliable" because it beat repeating last year by 27%. Against the best simple method (the seasonal average) the margin is 3%, and it now says Use with care, "only just".
- **Files / components changed:** src/data/timeseries/verdict.ts, src/ui/timeseries-page.ts, src/styles.css, test/timeseries-verdict.test.ts, test/e2e/time-series-page.spec.ts, test/e2e/arima.spec.ts
- **Tests run and results:** verdict unit tests (17) pin each answer's wording and the plain-language rule; the Time Series page e2e checks one word across the badge, strip and findings
- **Decision:** Ship; owner to review the labels and the 10% / two-thirds thresholds
- **Date:** 2026-11-01

### CHG-2026-11-01-30 — Forecast verdict: the line and the shaded range are judged apart, in plain words

- **Status:** Verified
- **Scope:** The Forecast badge mixed two questions: how good the forecast line is, and how far the shaded range can be trusted. It also said "its lead may be partly luck" of a model that ranked 3rd. Now the sentence is only about the line ("Ranked 3rd of 8 models on data it never saw: in line with the others, not clearly better", with any simple method that did better named in the same sentence), and the range has its own labelled row: Reliable, Too narrow or Wider than needed, with the share of past ranges that held the real value against the aim. "Heads up" is kept for genuine cautions (too little history, mostly-zero sales). A "lead" is only mentioned for a top-two model with a thin record, with the numbers.
- **Files / components changed:** src/data/timeseries/verdict.ts, src/ui/timeseries-page.ts, src/styles.css, test/timeseries-verdict.test.ts, test/e2e/time-series-page.spec.ts
- **Tests run and results:** verdict unit tests (10) and the Time Series page e2e pass
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-29 — AutoARIMA on seasons longer than 24 periods

- **Status:** Verified
- **Scope:** A series with a season ARIMA cannot hold (a week of half-hours is 336) was refused with "R's advice is to remove the season first ... (stlf); that is not built yet". It is built now: the season is removed with STL (MSTL, up to about six cycles of history, as the board's models do), ARIMA is fitted to what is left, and the seasonal pattern is added back to the forecast and its ranges. The backtest does the same on each fold's own history. The page says the season was taken out first. With under two full cycles of history the run now says what is missing and what to change, in plain words.
- **Files / components changed:** src/data/timeseries/arima-run.ts, src/ui/timeseries-page.ts, src/ui/timeseries-model-docs.ts, test/timeseries-arima.test.ts, next_steps.md
- **Tests run and results:** a synthetic daily-shaped series (period 48 forced down the long-season path): the forecast follows the true shape (error under 3 against a swing of 28, much better than flat), ranges surround it, backtest scored; the short-history message is tested
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-28 — Time Series: when rows from many places share a line, suggest the column and the values to pick

- **Status:** Verified
- **Scope:** The page only noticed several series when one column told rows at the same moment apart, and only for columns with up to 50 values. Citi Bike-style data (one row per trip, each at its own second, 330 stations) was summed silently. Now the page also notices when a period holds many rows (three or more) and a column could name the series. The detector ranks columns whose values each appear at 24 or more moments (a station or a store before a two-way flag), with their largest values and row counts. The banner offers the three largest values as buttons, "All N…" for a searchable list, and the other columns to pick by. One click splits by that column and shows that station alone. The split limit rises from 50 to 1,000 values; per-group totals (used only for one finding) are skipped when groups times periods would be very large, so memory stays bounded.
- **Files / components changed:** src/data/timeseries/shape.ts, aggregate.ts, src/worker/search.worker.ts, src/ui/timeseries-page.ts, timeseries-findings.ts, src/styles.css, test/timeseries-shape.test.ts, test/e2e/ts-series-suggest.spec.ts
- **Tests run and results:** detector unit test (ranking, coverage, largest values); e2e on trip-shaped data: banner, three value buttons, one click to a single series, searchable list
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-27 — Chart: scatter plots points by default; density is offered, not chosen

- **Status:** Verified
- **Scope:** A scatter used "Auto", which silently switched to a density grid on large data. It now draws points, thinned to a sample when there are too many (the note says "5,000 of 224,000 points (sampled)"), with a "Show all of them as a density map" link beside the note. The Render menu offers Points and Density (heat map); older charts saved with Auto draw points.
- **Files / components changed:** src/ui/chart-builder.ts, src/ui/chart-card.ts
- **Tests run and results:** chart UI tests (80) pass
- **Decision:** Ship (owner: "it should default to points and then offer something more fancy; the auto render isn't helpful")
- **Date:** 2026-11-01

### CHG-2026-11-01-26 — Chart: the Customize drawer has a way out

- **Status:** Verified
- **Scope:** The settings drawer overlays the chart and closed only by pressing the same Customize button, whose label never changed, and Escape worked only with focus inside it. The button now reads Done while open, the drawer has its own Done at the top (always in view), and Escape closes it wherever focus is.
- **Files / components changed:** src/ui/chart-card.ts, src/styles.css, test/e2e/chart-customize.spec.ts
- **Tests run and results:** e2e: Customize, Done, Escape with focus on the chart
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-25 — Time Series legend swatches match the line

- **Status:** Verified
- **Scope:** With a rolling mean over daily or finer data the chart draws the raw series in grey, but the legend swatch was always the text colour (white in dark, black in light). The swatch now takes the line's own colour; the words stay in the text colour so they stay readable (the first attempt, grey words, failed the contrast test at 3.5:1).
- **Files / components changed:** src/ui/timeseries-page.ts
- **Tests run and results:** contrast e2e passes in both themes
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-24 — Data Quality: Show rows shows the flagged rows, and a reviewed issue can be set aside

- **Status:** Verified
- **Scope:**
  - **Bug.** For "birth year has 9 values outside 1900 to 2027", Show rows opened the Table filtered to 1,900 and up: the 40 good rows, with the 3 bad ones filtered out. The sidebar number card did not know an "outside" operator and rewrote the filter. Now a new "Outside" operator (below the first bound or above the second) exists in the filter engine, the sidebar card, the filter chips and the column header, and Show rows uses it, so only the flagged rows appear.
  - **Not a problem.** Each check-based issue has a "Not a problem" button: the analyst looked, the rows are fine (a Roman emperor's birth year). It leaves the issue out of the score and the list, remembers the count it reviewed, brings the issue back if more rows are affected, and lists it under "Reviewed and set aside" with "Put back". Session-only, like the optional marks, keyed by file name and check.
- **Files / components changed:** src/search/query-engine.ts, src/data/score.ts, src/ui/reviewed-issues.ts (new), quality-layout.ts, quality-page.ts, filters.ts, table.ts, app.ts, test/score.test.ts, test/e2e/dq-reviewed.spec.ts
- **Tests run and results:** score unit test (reviewed, fewer rows, more rows); e2e: Show rows gives exactly the three flagged rows, Not a problem removes and lists it, Put back restores it
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-23 — Opening a filter from another page focuses its box and says where you went

- **Status:** Verified
- **Scope:** "+ Add filter" on the Time Series page (or any non-Table page) silently opened the Table's left pane, with focus on the column card rather than its filter box, so typing went nowhere. The box is now focused, and a message says filters live on the Table and apply to every page.
- **Files / components changed:** src/ui/filters.ts, src/ui/app.ts
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-22 — Time Series: "Compute-intense models" section; plus and minus on the section bars

- **Status:** Verified
- **Scope:** AutoARIMA was hidden inside "Under the hood". It now has a section of its own between Compare models and Under the hood, "Compute-intense models" (brain icon), with two run buttons: AutoARIMA and DV-ARIMA, plus "Try every order". The leaderboard row says which one ran. The rotated tick on the section bars (and the in-page disclosures) becomes a plus in a small box when closed and a minus when open.
- **Files / components changed:** src/ui/timeseries-page.ts, src/styles.css, test/e2e/arima.spec.ts
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-21 — Table header: the column type is a coloured chip

- **Status:** Verified
- **Scope:** The type ("Aa", "123", "Date") was a small grey glyph in the same style as the stats beside it. It is now a chip tinted by family (text and ID slate, category violet, numbers blue, date and time teal, true/false green), larger and bolder, with the glyph still the label so colour is never the only cue. Tuned for both themes and checked by the contrast test.
- **Files / components changed:** src/ui/table.ts, src/styles.css
- **Tests run and results:** contrast e2e passes in light and dark
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-20 — AutoARIMA: DV-ARIMA, the differencing chosen by a forecast vote (opt-in)

- **Status:** Verified
- **Scope:**
  - **The vote.** Besides the unit-root test's differencing, the search runs at its neighbours (one plain difference more or fewer, the seasonal difference switched). Each choice's best three models forecast the last stretch of the history from three origins; the choices are weighted by inverse squared error, Akaike weights decide inside a choice, and the forecast and its ranges are the mixture over up to twelve models. Off by default, ticked on by the analyst ("Try the differencing vote"); not used with "Try every order".
  - **On the page.** A "How the differencing was chosen" table (error against the best choice, share of the forecast, the unit-root test's choice marked), plain auto.arima's own answer stated beside it, and the parameters of the single most-weighted model. The model docs gain a section that says what it is, that it is not new in its parts and was not found in R's forecast, statsforecast or pmdarima, how much it gains (2 to 3% on average) and what was tried and dropped. Sources added: Diebold and Kilian (2000), Hansen (2010).
  - **Evidence and tooling.** tools/ts-eval/arima-dv.ts (the vote and its variants), arima-vm.ts (variogram-matched coefficients), arima-rev.ts (revision-corrected forecast), arima-invent.ts (damping, shrinkage, averaging, blending): seeded random series from the Monash archive, scored on its protocol. Decision in DEC-2026-11-01-03.
- **Files / components changed:** src/data/timeseries/arima.ts, arima-run.ts, references.ts, src/ui/timeseries-page.ts, timeseries-model-docs.ts, test/timeseries-arima.test.ts, test/e2e/arima.spec.ts, tools/ts-eval/arima-*.ts
- **Tests run and results:** typecheck clean; ARIMA unit tests (16) and e2e (3) pass, the R-parity e2e on the default (plain) run; full suites in the commit
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-19 — AutoARIMA: forecast averaged over the models the search tried; quick search for long series

- **Status:** Verified
- **Scope:**
  - **Tested on random series.** 20 random Monash series (seed 1), then 100 (seed 2) and 150 (seed 3) the earlier choices never saw, scored on the archive's protocol (last h held out, MASE), beside the board's Auto. Plain auto.arima: about 6.5% worse than the board's Auto by geometric mean on seeds 2 and 3 (1.069, 1.066), best on monthly seasonal series, worst on short yearly ones where a fitted drift runs away.
  - **What helped, on both unseen sets:** averaging the models the search fitted, weighted by Akaike weights (exp(-delta AICc / 2)), beat the lowest-AICc model by 2.3% on each (wins 59 of 100 and 82 of 150). The shipped forecast is that average, with ranges from the mixture variance (each model's variance plus the spread of the forecasts); the best model's parameters are shown unchanged, and the backtest scores the average. An equal average of the best three did the same (0.983, 0.980), so the gain is from averaging, not the weights.
  - **What did not:** dropping the drift helped on seed 3 (0.953) and hurt on seed 2 (1.032), so it is not shipped. Blending ARIMA with the board's Combination gave 0.919 against the base alone, but Combination by itself scored 0.919 and 0.980 of Auto, so ARIMA adds nothing to it: ARIMA stays out of Auto and the Combination.
  - **Speed:** as R does for long series (over 150 readings or a season over 12), the search fits each model by conditional sum of squares and refits the best three exactly. On the reference series 4-13 times faster, the same model on four of five (the fifth within 0.5 AICc).
  - **Tooling:** tools/ts-eval/arima-eval.ts (random draw, repeatable by seed), arima-variants.ts (variants from one search per series).
- **Files / components changed:** src/data/timeseries/arima.ts, arima-run.ts, src/ui/timeseries-page.ts, test/timeseries-arima.test.ts, tools/ts-eval/arima-eval.ts, arima-variants.ts
- **Tests run and results:** typecheck clean; ARIMA unit (14) and e2e (2) pass; full suites in the commit
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-18 — AutoARIMA: every parameter explained in the series' own numbers, and a place on the leaderboards

- **Status:** Verified
- **Scope:**
  - **Each coefficient is read for this series**, in a column of its own: a weight on the last period's change becomes "Momentum. About 60% of the last month's change carries into this one, and an effect fades to half in about 1.3 months"; a negative one is "Bounce-back"; a seasonal weight is "the same time last season"; a moving-average weight is an "Echo of a surprise" (98% of last month's forecast error reversed), with a plain note when it sits near -1 beside a difference (the model is largely undoing it, so forecasts lean on the long-run level); a drift becomes a change per period and per season, a mean the level it settles around. Each says whether the term is clearly not zero (z of 2 or more) or could be, and why it stays.
  - **A glossary under the table**, open by default: what the letters of ARIMA(p,d,q)(P,D,Q)[m] mean for this series, estimate, standard error and z, the error variance (and its square root as the usual miss), log-likelihood, AIC, AICc and BIC (lower is better, ties under about 2, only comparable across the same differencing), the observations used and why differencing loses some, the Ljung-Box check, and why the ranges are the best case.
  - **A "Run by you" row** on the Compare models board and on the full board once the run has finished: its error against repeating the last cycle (the same quantity as every model's), its folds beaten, its MASE and its place on the unseen lockbox fold among the eight core models, with the same Holds up, Middling or Doubtful verdict. Hovering the row draws its forecast on the chart; clicking it opens the parameters. The row belongs to the series it was run on and disappears when the series, forecast length or transformation changes, not when the tick box is toggled.
- **Files / components changed:** src/data/timeseries/arima-run.ts (MASE, folds beaten), src/ui/timeseries-page.ts, timeseries-model-docs.ts, src/styles.css, test/e2e/arima.spec.ts
- **Tests run and results:** typecheck clean; AutoARIMA e2e covers the readings, the glossary, the leaderboard rows and their removal; full suites in the commit
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-17 — Time Series: AutoARIMA as a deep run the analyst starts by hand

- **Status:** Verified
- **Scope:**
  - **A new "AutoARIMA…" button under the hood** starts a search for a seasonal ARIMA model, by the method of Hyndman and Khandakar (R's `auto.arima`), in its own worker: **no time limit**, a spinning donut with the live count of models tried and the best so far, and a **Stop** button that ends it. A tick box tries every order instead of the stepwise neighbourhood (far slower). It is not on the board, not part of Auto and not in the exports: it is there to be read.
  - **The result is the parameters:** the model as ARIMA(p,d,q)(P,D,Q)[m] with a plain-words reading; a table of every coefficient with its estimate, standard error, z and what it does (autoregressive weight on the value one period earlier, and so on, a drift or mean); the error variance, log-likelihood, AIC, AICc and BIC; why it differenced (the KPSS and seasonal-strength numbers); the Ljung-Box check on its errors; its score on the board's own backtest folds (order held, coefficients refitted on each fold) beside the board's Auto pick and the Combination; the forecast table with the model's own analytic 80% and 95% ranges; the models tried, best first; and a CSV of the parameters and forecast.
  - **Seasonality:** yes, seasonal ARIMA (the (P,D,Q)[m] part) for seasons up to 24 periods. A longer season (hourly data with a week) is declined with an explanation, as R advises removing the season first, which is not built. Box-Cox, when switched on, is applied and mapped back.
- **The engine** (`src/data/timeseries/arima.ts`, written from the published method, no code copied): exact Gaussian likelihood by Kalman filter on the state-space form with missing values skipped; CSS then ML by BFGS; stationary autoregression through partial autocorrelations, free moving average with roots reflected afterwards; KPSS and seasonal-strength tests for the differences; the four starting models and the neighbour rules of `auto.arima`; AICc; psi-weight ranges; standard errors from the numerical Hessian.
- **Checks against independent references:** the airline model on the logged passengers gives theta -0.4018, Theta -0.5570, sigma^2 0.001348, loglik 244.70, AIC -483.39 and standard errors 0.0896 and 0.0731, as published; the search on the raw passengers returns R's ARIMA(2,1,1)(0,1,0)[12], coefficients 0.5960, 0.2143, -0.9819, loglik -504.92, AICc 1018.17. On ten fixed models the likelihood agrees with statsmodels' SARIMAX to 0.02 and the estimates to 0.02. Against Nixtla's statsforecast AutoARIMA on six series it chose the same differences every time and never a higher AICc (it found a lower one on three; statsforecast's optimiser stops a little short, e.g. theta -0.377 against -0.4018 on the airline model).
- **Two things the references taught:** statsmodels' `trend="t"` handles the differencing states differently, so drift models are compared on the differenced series; and R's KPSS lag is floor(3 sqrt(n) / 13), not the 4 (n/100)^0.25 first used, which changed the differencing of the logged passengers.
- **Speed:** a monthly series takes 1 to 3 seconds, daily or weekly a few seconds, a 24-period season on 600 points about 40 seconds; the worker keeps the page and the table responsive throughout.
- **Not done:** seasons over 24 periods, exogenous regressors, R's approximate search on long series (every model here is fitted exactly), ARIMA on the board or in the Combination (on the Monash sets the published ARIMA is rarely better than the Combination).
- **Files / components changed:** src/data/timeseries/arima.ts, arima-run.ts, references.ts; src/worker/arima.worker.ts; src/ui/timeseries-arima.ts, timeseries-page.ts, timeseries-model-docs.ts; src/styles.css; tools/ts-eval/make-arima-reference.py; test/fixtures/arima-reference.json; tests (12 unit, 2 e2e)
- **Tests run and results:** typecheck clean; 1230 unit tests pass; AutoARIMA e2e (a full run to R's answer, and a long run stopped) pass
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-16 — Time Series: bridging unusual periods in the fit: tried, not shipped

- **Status:** Attempted, not shipped (recorded so it is not repeated)
- **What was tried:** the periods the page flags as unusual (robust z at or above its 4.5 default) were treated like filled ones in what the models learn from (bridged, not learned), while every score stayed on the real values: the idea of R's `tsclean` (fpp3 13.9).
- **Result (Auto's mean MASE, with against without):** tourism yearly 2.912 to 2.207 (-24%), M3 quarterly 1.098 to 1.090, tourism quarterly 1.523 to 1.497, tourism monthly 1.453 to 1.444, M3 yearly 2.520 to 2.502, NN5 weekly 0.847 to 0.854, **covid 4.493 to 5.266 (+17%), FRED-MD 0.457 to 0.681 (+49%)**. On the 141-series gate fixture 7 checks went more than 2% worse.
- **Why not:** the one large gain is probably leakage (the flags come from a decomposition that has seen the held-out end of the series, so a point just before the split can be flagged because of where the series goes next), and where the series has level shifts or steady growth the flagged points are real structure, which bridging removes. A fair test needs flags from the history before each fold only; that costs a decomposition per fold, and FRED-MD and covid must be in it.
- **Files / components changed:** none (the experiment was reverted)
- **Decision:** Do not ship
- **Date:** 2026-11-01

### CHG-2026-11-01-15 — Time Series: the ranges are a normal band from the spread of the backtest errors, and they now hold the real value about as often as promised

- **Status:** Verified
- **Scope:** The 80% and 95% ranges were quantiles of the backtest errors (the 10%, 90%, 2.5% and 97.5% points); they are now a **normal band**: the forecast plus or minus 1.28 (80%) or 1.96 (95%) times the root mean square of this model's own backtest errors at that step, pooled over the folds and the neighbouring steps. That is fpp3 5.5's construction, with sigma estimated from the backtest instead of from in-sample residuals. With under three folds, or ten scored errors, the band still comes from the fitted model's own one-step error (CHG-2026-11-01-11). The Deep check's calibration test, the model card, the model pages and the "How far to trust the ranges" topic are updated.
- **Why the old band was too narrow:** a quantile of a handful of errors sits inside the true spread (the tails of the error distribution are exactly where few folds say least), and a miss only counts as far as the quantile. The root mean square counts every miss at full size.
- **Evidence (`tools/ts-eval/coverage.ts`, Winkler score as fpp3 5.9, scaled by the training data's seasonal naive error):**
  - 141 gate series, 2,370 points: 80% band 68.3% to **83.5%**, 95% band 83.4% to **93.5%**, Winkler 7.04 to **6.42**.
  - Checked on 60 further series from each of 11 datasets that the choice was not made on: 80% coverage 81-83% on M3 monthly and quarterly, tourism, hospital, FRED-MD, NN5 and pedestrian counts; 76% M1 monthly; 72% M4 weekly; 65% M3 yearly. The Winkler score improved on ten of eleven (FRED-MD 2.52 to 2.70 was the exception).
  - Tried and **rejected**: scaling errors by the series' level (no gain, Winkler 7.09); a small-sample t correction (coverage 86.2% against an aim of 80%, Winkler 6.51, worse than plain normal 6.42).
  - **Still too narrow** on short yearly series and weekly ones; the topic says so and tells the reader to take the range as a minimum there.
- **Files / components changed:** src/data/timeseries/models.ts, src/ui/timeseries-model-docs.ts, timeseries-findings.ts, tools/ts-eval/lib.ts and coverage.ts (Winkler score, series offset)
- **Tests run and results:** typecheck clean; 1218 unit tests pass; Time Series e2e 20 pass; accuracy gate passes (the band does not enter the point forecast); latency unchanged
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-14 — Time Series: with no season, Auto is the two-way Combination and no rival replaces it

- **Status:** Verified
- **Scope:** For a series with no season at its grain (yearly data, and any grain with a period of 1) the Combination is the average of **Best smoothing and Smooth and damp** (Theta is left out), and **Auto keeps it: no rival can replace it**. Seasonal series are unchanged.
- **Why:** on every non-seasonal Monash set we have, Smooth and damp beat Auto and Theta was the weakest member. Theta is built for a deseasonalised series [Assimakopoulos and Nikolopoulos 2000], and on short yearly series (M1 yearly Theta 4.19, ETS 3.85) it dragged the three-way average down. The second change comes from the same numbers: on M3 Other the three-way Combination with the usual rival test scored 1.973, the two-way average with rivals allowed 1.951 and without them 1.836, because a winner picked from the few short folds of such a series was worse than keeping the average (Cawley and Talbot 2010).
- **Evidence (Auto's mean MASE, all series offered, Monash protocol):** M1 yearly 3.810 to 3.715 (-2.5%), M3 yearly 2.577 to 2.582 (+0.2%), tourism yearly 3.057 to 2.974 (-2.7%), M3 Other 1.973 to 1.836 (-6.9%). On the accuracy gate's 141 series: M3 yearly -3.7%, M3 Other -2.2%, tourism yearly -3.2%, nothing worse.
- **Caution:** the rule was found by looking at these four sets (about 950 series) and tried on no other, since we hold no other non-seasonal data. Four independent sets all moved the same way or stood still, which is the evidence; a new non-seasonal set that went the other way would be reason to revisit it. It is documented on the Combination's page.
- **Files / components changed:** src/data/timeseries/models.ts, src/ui/timeseries-model-docs.ts, timeseries-findings.ts, timeseries-metrics.ts, tools/ts-eval/lib.ts (`forecastsAll`), test/fixtures/accuracy/baseline.json
- **Tests run and results:** typecheck clean; 1218 unit tests pass; accuracy gate passes, baseline updated; latency unchanged
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-13 — Time Series: week start from the data, and an honest note on the ranges (fundamentals plan, Phase 5b)

- **Status:** Verified
- **Scope:**
  - **Week start:** weekly rows stamped on one weekday (90% or more of them, at a 7-day spacing, at least 8 rows) start their weeks on that weekday: Sunday-ending weeks, Friday closes. A period then runs from stamp to stamp and is labelled with the stamp, with no empty lead period and no partial tail. Anything else, including daily rows grouped into weeks, keeps Monday weeks. Accuracy is unchanged (the gate is identical on the four weekly datasets): only the periods and the dates shown change.
  - **How far to trust the ranges:** a new docs topic and a line in each model's band note. On 141 series the 80% band held the real value 69% of the time and the 95% band 84%, as fpp3 5.5 warns ranges usually do; by frequency: monthly 69-83%, quarterly and yearly 38-67%, weekly 53-85%, hourly and daily 70-86%, mostly-zero sales 28%. The ranges are not stretched by one fixed amount: a factor that fixes the average (about 1.6) would make monthly ranges too wide (92%) and still leave quarterly ones too narrow (50%).
  - **Month-length adjustment: tried, not built.** Dividing monthly values by the days in the month and multiplying the forecasts back changed Auto's MASE by +0.012 (M3 monthly), 0.000 (M1 monthly), -0.009 (tourism monthly) and 0.000 (hospital): no gain.
- **Files / components changed:** src/data/timeseries/base.ts, engine.ts, src/ui/timeseries-model-docs.ts, next_steps.md, tests (new: timeseries-weekstart)
- **Tests run and results:** typecheck clean; 1218 unit tests pass; accuracy gate unchanged
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-12 — Time Series: Box-Cox transformation (opt-in) and a band-coverage tool (fundamentals plan, Phase 5a)

- **Status:** Verified
- **Scope:**
  - **Transform** under the hood: None, Box-Cox (auto) or Log. Auto takes Guerrero's power (Guerrero 1993) on the history before the first backtest fold, once, so every fold and the forecast share it; it reproduces R's `BoxCox.lambda` on the airline passengers (-0.29). Best smoothing, Smooth and damp, Steady trend and the regression learn on the transformed series and are mapped back before they are combined, scored or banded (medians, not means: no bias adjustment, because the measures are absolute errors); the benchmarks, Repeat last cycle and Seasonal average stay on the original scale. A series with any value at or below zero is never transformed, and the model card says so. The Deep check's residuals and the Trend-flexibility curve follow the same transformation. A docs topic and two sources (Box and Cox 1964, Guerrero 1993) explain it.
  - **Off by default, on evidence.** Auto's mean MASE with and without the automatic transformation, 200 series per dataset: M3 monthly 0.834 / 0.853, M1 monthly 1.037 / 1.045, tourism monthly 1.453 / 1.481, hospital 0.742 / 0.743, FRED-MD 0.457 / 0.646: worse on all five. A first run on the 141-series gate fixture looked better on monthly data (-3% to -7%) and worse on yearly, quarterly and pedestrian data (up to +35%); the larger runs showed that to be noise, which is why the default stays off.
  - **A bug found and fixed on the way:** the engine's model cache key left out the transformation, so switching it would have shown the previous result.
  - **`tools/ts-eval/coverage.ts`** reports how often the held-out actuals fall inside the Auto forecast's 80% and 95% bands, on the accuracy gate's series or a folder of Monash files.
- **Finding, not yet acted on:** on the 141-series fixture the 80% band holds the real value 69.0% of the time and the 95% band 84.4% (monthly series near 83% and 94%; quarterly 38% and 72%; yearly 60% and 77%; car parts 28% and 38%). The bands are too narrow, as fpp3 5.5 warns prediction intervals usually are.
- **Files / components changed:** src/data/timeseries/boxcox.ts (new), models.ts, aggregate.ts, engine.ts, references.ts, src/ui/timeseries-page.ts, timeseries-findings.ts, timeseries-model-docs.ts, tools/ts-eval/lib.ts and coverage.ts (new), tests
- **Tests run and results:** typecheck clean; 1214 unit tests pass (new: Box-Cox and Guerrero including the airline series against R, the engine's transformation, the cache); e2e for the Transform control passes; accuracy gate unchanged
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-11 — Time Series: short series are forecast, not refused (fundamentals plan, Phase 4c)

- **Status:** Verified
- **Scope:**
  - **A series too short for several backtest folds is forecast anyway.** Before, a forecast needed room for the training stretch, the horizon and two more folds, and the page refused or cut the horizon. Now it needs only the training stretch (at least 8 periods, more for a seasonal series) plus the horizon. With room for one or two folds the backtest is marked rough; with none, nothing can be compared and the verdict says **Untested**.
  - **Bands with no backtest to read them from:** under three folds, or ten scored errors, the empirical band (quantiles of backtest errors) is replaced by one from the fitted model's own one-step error over its history, widened like a random walk (sigma times the square root of the steps ahead). Two folds can both miss the same way and leave the band to one side of the forecast, which the old code did; this is why it is not used under three folds. The page and the Auto note both call it a rough guide.
  - **Auto** uses the Combination when there is no backtest, and says why. A requested backtest split is honoured down to the shortest training stretch, so the held-out actuals are still scored against the forecast. The longest horizon offered is up to half the history (leaving the minimum to train on), longer than what a full backtest allows.
  - The trust verdict gains **Untested** (the plain sentence says how little history there is); a model with no backtest ratio is graded Untested, not Poor.
- **Evidence (Monash protocol, series forecast of those offered):** M1 yearly 81 of 181 before, 181 of 181 now; M3 yearly 152 of 300 sampled before, 300 of 300; tourism yearly 242 of 300 before, 291 of 291 offered. Mean MASE on the newly covered sets (Auto): M1 yearly 3.810 (published: ETS 3.771, Theta 4.191, ARIMA 4.479), M3 yearly 2.577 (Theta 2.774, ETS 2.860), tourism yearly 3.057 (Theta 3.015, ETS 3.395). The plan's target (forecast all of M1, M3 and tourism yearly) is met.
- **Files / components changed:** src/data/timeseries/models.ts, verdict.ts, src/ui/timeseries-page.ts, tests (new: timeseries-short)
- **Tests run and results:** typecheck clean; 1206 unit tests pass (new: a 16-year series, a 10-year split with no fold, the refusal below the minimum); e2e 116 pass and one unrelated map test that passes alone; accuracy gate passes
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-10 — Time Series: intermittent demand (Croston, SBA, TSB) (fundamentals plan, Phase 4b)

- **Status:** Verified
- **Scope:**
  - **Detection:** a series with no negative values and an average demand interval above 1.32 (demand in fewer than three of every four periods; Syntetos, Boylan and Croston 2005) is intermittent. Periods before the first sale are not counted (a product not yet launched, an outbreak not yet begun). The cut is made once on the history the forecast is fitted on, so every fold uses the same methods.
  - **Three methods**, shown only for such a series: **Croston** (size and gap smoothed separately, forecast = size / gap), **Croston, corrected** (SBA: times 1 - alpha/2) and **Fading demand** (TSB: the chance of a sale is smoothed every period, so it fades through a long gap). Smoothing is fixed at 0.1 (the default of R's forecast::croston), not tuned. Each has a technical page with equations and sources, and a "when it shines / when to doubt it" entry; four sources added (Croston 1972, Syntetos and Boylan 2005, Teunter, Syntetos and Babai 2011, Kolassa 2016).
  - **Auto uses TSB** for an intermittent series (policy "intermittent"), and says why. The verdict adds a plain heads-up: most periods have no sales, MASE and MAE reward forecasting zero, so look at RMSE and bias too.
  - **The list of models is now per series** (`ModelRun.shown`): the board, the Deep check, the exports and the model pages list only the models that apply.
- **Evidence (Monash car parts, 489 intermittent series, MASE):** TSB 1.113, SES 1.116, the Combination 1.127, ETS 1.104, Croston 1.401, Croston corrected 1.370, naive 1.270. TSB tied the Combination on MASE and led on RMSE (0.997 against 1.038 on the first 368 series), so Auto's change costs nothing on the main measure. **The plan's target (0.93 on car parts) is not met on this protocol, and the target itself is unsound:** a flat forecast of zero scored 0.763 on 889 car-parts series, better than every method here, because the median of such a series is zero and MASE is absolute error (Kolassa 2016). We do not chase it. Our SES does not reproduce the archive's published 0.897 either (1.062 by maximum likelihood, 0.999 by least squares over the same 889 series); the cause is not established.
  - **Choice of Auto's method:** TSB was picked after seeing these numbers, from the two candidates the literature recommends (SBA and TSB), on one dataset, with a tie on MASE. That is a thin basis, and it is stated on the method's page. Covid deaths (daily counts) and car parts are the only intermittent sets in our corpus.
- **Accuracy gate:** car parts Auto 0.443 to 0.410 (-7.3%) and covid deaths 1.522 to 1.464 (-3.8%): both better; every other dataset unchanged. Baseline updated.
- **Files / components changed:** src/data/timeseries/benchmarks.ts, models.ts, verdict.ts, references.ts, src/ui/timeseries-page.ts, timeseries-model-docs.ts, timeseries-metrics.ts, timeseries-export.ts, tools/ts-eval/monash.ts, test/fixtures/accuracy/baseline.json, tests
- **Tests run and results:** typecheck clean; 1203 unit tests pass (new: classification, the three methods, the engine's choice); e2e 117 pass; gate passes; latency inside the ceiling
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-09 — Time Series: four benchmark models (naive, drift, mean, simple smoothing) (fundamentals plan, Phase 4a)

- **Status:** Verified
- **Scope:** The textbook benchmarks (fpp3 5.2, 8.1) join the board as yardsticks: **Repeat last value** (naive), **Straight line on** (drift), **Overall average** (mean) and **Simple smoothing** (SES, fitted by maximum likelihood in the same code as Best smoothing). Each is backtested on every fold, forecast, banded and exported like the others, has its own technical page with equations and a "when it shines / when to doubt it" entry, and is a rival in the Deep check. They are benchmarks: Auto never picks them and the Combination does not use them, so the accuracy gate is unchanged. The trust verdict still ranks a model among the original eight, and now adds a heads-up when one of these simple methods beat the pick on the unseen lockbox fold ("Repeat last value did better than this forecast on data it never saw, so a simple method is hard to beat here"). On the Compare board each shows "Benchmark", or "Beat the pick on unseen data" in red when it did.
- **Evidence (Monash protocol, our flat, unadjusted SES):** M3 monthly naive 1.367, drift 1.360, mean 2.249, SES 1.259; tourism yearly naive 2.959, drift 2.673, mean 8.189, SES 2.918; car parts naive 1.265, mean 1.224, SES 1.189. The archive's published SES (forecast package) is lower on M3 monthly (1.091) and car parts (0.897); the cause is not established (our Theta, which contains an SES, matches the archive on M3 monthly: 0.865 against 0.864), so the SES row is a yardstick and not a claim of parity.
- **Files / components changed:** src/data/timeseries/benchmarks.ts (new), models.ts, verdict.ts, src/ui/timeseries-page.ts, timeseries-model-docs.ts, timeseries-metrics.ts, tools/ts-eval/monash.ts, tests
- **Tests run and results:** typecheck clean; 1200 unit tests pass (new: benchmarks on worked examples, the beaten-by heads-up); e2e 117 pass; accuracy gate unchanged ("passed"); latency bench inside the 500 ms ceiling
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-08 — Forecast tab: the trust verdict, compact Compare board, and scoring controls under the hood

- **Status:** Verified
- **Scope:** The rest of the layered Forecast tab (DEC-2026-11-01-01).
  - **Trust verdict as a pure function** (`src/data/timeseries/verdict.ts`, 8 tests): *Holds up* (top two on the lockbox fold the choice never saw, and not a lucky lead), *Middling*, *Doubtful* (bottom third on unseen data, or no better than repeating the last cycle), *Baseline* for the benchmark. It writes one plain sentence ("Did well on data it never saw (2nd of 8 models) and beat repeating the last year in 8 of 9 tests") and a "Heads up" note only when true: the band held the real value more than 5 points away from its aim over at least 20 checks, a lead from under half the folds, or too little history. With no fold to hold back it judges on the backtests and says it is less certain.
  - **The badge above the chart is that verdict**; the old technical line (MASE, folds, lockbox text) moved to the top of Under the hood.
  - **Compare models is a compact three-column board**: model with a one-line plain descriptor, error against repeating the last cycle as a bar and a ratio, and how it did on unseen data (a dot and its place). Grouped Recommended, Alternatives and Benchmarks; the pick is marked Auto; clicking a row shows it on the chart; hover still compares; the (i) opens its technical page. A full bar is capped at 1.5x so one wild model cannot squash the rest.
  - **Under the hood** now holds Rank by and Validate (moved from the toolbar), the full seven-measure board with its note, the guide and docs buttons, Deep check, Trend flexibility and the model card. The toolbar keeps Forecast ahead, Band and Drivers.
- **Files / components changed:** src/data/timeseries/verdict.ts (new), src/ui/timeseries-page.ts, src/styles.css, test/timeseries-verdict.test.ts (new), test/e2e/time-series-page.spec.ts
- **Tests run and results:** typecheck clean; 1194 unit tests pass; e2e 117 pass; checked by screenshot (closed, Compare open, Under the hood open)
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-07 — Analyst console look, phase 4: contrast, focus and overlays

- **Status:** Verified
- **Scope:** An automated audit of every visible text colour against its own background, on Overview, Data Quality, Table, Pivot View, Chart, Outliers, Relationships, Time Series and Map in both themes, found 14 groups under WCAG AA (4.5:1). All are fixed: muted text is darker in the light theme and lighter in the dark one (`--text-dim` `#62707f` to `#556170`, `#93a1b1` to `#a1aebd`); the dim text on the dark top bar and status bar is lighter (`--chrome-faint`); the active Outliers chips use a darker blue in the light theme; the Relationships column labels (text, category, numeric) have lighter dark-theme colours, which were as low as 2.4:1. The top bar's keyboard focus ring is one clear ring, not two. Menus, the command palette, the Help drawer and the header filter popover were checked by screenshot in both themes and needed no change.
- **New test:** `test/e2e/contrast.spec.ts` runs the same audit on seven pages in both themes and fails on any text under AA, so the look cannot slip back.
- **Files / components changed:** src/styles.css, test/e2e/contrast.spec.ts
- **Tests run and results:** typecheck clean; unit pass; e2e pass including the new contrast test
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-06 — Analyst console look, phase 3: every other page

- **Status:** Verified
- **Scope:** Shared styling for Overview, Data Quality, Pivot View, Chart, Outliers, Relationships, Time Series and Map: big numbers (tile values, the quality score, the Time Series strip, view counts) are monospace and tabular; section labels are small spaced capitals; cards are flat with hairline borders; corner radii and shadows are tighter and lighter (`--radius` 10 to 8, `--radius-sm` 6 to 5). The tab names now show only when they all fit (five tabs from 1100px, nine with Research on from 1760px), which fixes "Relationships" being cut off. Page layouts are unchanged.
- **Files / components changed:** src/styles.css
- **Tests run and results:** typecheck clean; 1186 unit tests pass; e2e 115 pass; checked by screenshot in both themes: Overview, Data Quality, Pivot View, Outliers, Time Series
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-05 — Map: sandy land and light-blue water, Fit all, open Markers panel, pasted column layouts, a clearer heat grid

- **Status:** Verified
- **Scope:**
  - **Colours:** the world map has light-blue water and sandy-yellow land with a soft tan coastline (a deep blue-grey and muted tan in the dark theme). Over a loaded background picture it keeps the old faint tint so the picture shows.
  - **The automatic view covers what is plotted and the page's own markers.** A marker inside the plotted area changes nothing; one outside widens the view to take it in (25% room, undistorted), and markers alone get a regional view of at least a few degrees. The dock gets **Fit all** and the card's "Fit data" is now "Fit all"; both return to that view and ignore the Cities layer, which would span the world.
  - **Markers panel starts open**, so Add markers, + Row, Download and Clear are in view.
  - **Paste anywhere on the page** (not into a field) opens Add markers with the rows. Rows can now be separated by runs of spaces as well as tabs, commas or semicolons; `label lat long` headers work, and a label of several words ("Sydney Opera House -33.85 151.21") is kept whole.
  - **Grid is explained:** on the map it is now "Heat cells", shown only in the Heat grid view (the dots view has no cells), with a tooltip saying what small and large values do (10 to 20 broad and smooth, 80 to 120 fine but patchy, 30 to 60 suits most data) and a live note of each cell's size in degrees.
- **Files / components changed:** src/ui/chart-card.ts, src/ui/map-page.ts, src/ui/map-markers-panel.ts, src/data/map-markers.ts, src/styles.css, test/map-page.test.ts, test/ui-charts.test.ts, test/e2e/map-page.spec.ts
- **Tests run and results:** typecheck clean; 1186 unit tests pass (new parser test uses the owner's sample); e2e 115 pass (new tests cover the open panel, page paste, Fit all and the heat cells field); checked by screenshot
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-04 — Analyst console look, phase 2: the Table

- **Status:** Verified
- **Scope:**
  - Column headers show the full name on its own line, then a second monospace line: the type glyph, the column's facts (`13–58` for numbers, `730 distinct` otherwise; the tooltip adds the empty count) and the filter. Default column widths now allow for that line, so names and facts are not cut short ("orde…", "r…" before).
  - Numbers, dates, times, durations and identifiers are monospace in the grid; row and file-row numbers are small monospace; names are semibold.
  - The position and navigation bar under the grid is the dark status bar (monospace, in both themes); collapsed filter cards in the sidebar are slimmer.
  - The header-height budget in the compact-chrome test goes from 64 to 84 px: the second header line is the point of this phase.
- **Files / components changed:** src/ui/table.ts, src/styles.css, test/e2e/polish.spec.ts
- **Tests run and results:** typecheck clean; 1185 unit tests pass; e2e 113 pass; checked by screenshot, light and dark
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-03 — Overview: the Missing values map is readable

- **Status:** Verified
- **Scope:** Present data is a quiet grey and gaps are orange, so they stand out in both themes (before: bright blue data with grey gaps that were hard to see). Any missing cell in a row block now shows clearly (`gapIntensity`: 1% of a block already reads as about 55% strength), so scattered gaps appear as streaks instead of vanishing. Column names move to a header above each strip, in monospace, with each column's share missing beneath (`0%`, `5.9%`, `<0.1%`); hovering the header still names the column. Caption now reads "grey = data · orange = missing" (DEC-2026-11-01-02).
- **Files / components changed:** src/ui/missingness.ts, test/missingness.test.ts, test/ui-overview.test.ts
- **Tests run and results:** typecheck clean; unit tests pass (new gapIntensity test); e2e pass; checked by screenshot, light and dark, on a file with a missing block, patchy values and scattered gaps
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-02 — Analyst console look, phase 1: fonts, tokens, dark top bar, numbered tabs

- **Status:** Verified
- **Scope:** Inter and JetBrains Mono bundled (113 KB, SIL OFL 1.1, licences in src/assets/fonts); font and chrome tokens; the top bar is dark in both themes with the file as a monospace path (`~/data/…`), a monospace command box and a dark quality score; primary buttons are dark (light in the dark theme); page tabs show their number key (drawn by CSS, so names and tests are unchanged) and, from 1280 px, every tab shows its name (DEC-2026-11-01-02).
- **Files / components changed:** src/styles.css, src/ui/view-tabs.ts, src/assets/fonts/*
- **Tests run and results:** typecheck clean; 1184 unit tests pass; e2e 113 pass; build includes the four font files
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-11-01-01 — Time Series Forecast tab: answer first, Compare models and Under the hood on demand

- **Status:** Verified
- **Scope:**
  - The Forecast tab opens with the chart, the forecast badge and the controls. The model board is behind a **Compare models** bar; the analyst tools (guide, How the models work, Deep check, Trend flexibility, model card) are behind **Under the hood**. Both start closed and a person's choice is remembered in the browser (DEC-2026-11-01-01).
  - The badge's Good / OK / Poor grade is now a trust verdict: **Holds up**, **Middling** or **Doubtful** (red), from the model's rank on the fold the choice never saw (bottom third or worse than repeating the last cycle: Doubtful; top two and winning at least half the folds: Holds up). Series without a lockbox fall back to the ratio to the baseline.
  - Not yet done from the mock-up: the plain-language verdict sentence, the single "Heads up" chip, compact board rows, and moving Rank by / Validate under the hood. The Simple / Detailed switch is undecided.
- **Files / components changed:** src/ui/timeseries-page.ts, src/styles.css, test/e2e/time-series-page.spec.ts
- **Tests run and results:** typecheck clean; 1184 unit tests pass; e2e 112 pass (one unrelated map test flaked, passes alone); e2e now asserts the folds start closed and opens them before using their buttons
- **Decision:** Ship
- **Date:** 2026-11-01

### CHG-2026-10-31-35 — Time Series: Theta on maximum-likelihood smoothing, and on the adjusted series for long seasons (fundamentals plan, Phase 3)

- **Status:** Verified
- **Scope:**
  - **Theta now follows thetaf():** simple exponential smoothing with the parameter and starting level estimated by maximum likelihood (the same fit as ETS(A,N,N)), and the classical decomposition (multiplicative for a positive series) for the season, behind the Theta method's seasonality test. It had used a 0.05 grid for the parameter and this app's own decomposition.
  - **Long seasons:** like ETS and Holt-Winters, Theta runs on the MSTL-adjusted series with the season added back (stlf with Theta). A first version that deseasonalised a 168-hour season with the classical decomposition (about five cycles) made hourly Theta 40% worse (1.681 -> 2.350); on the adjusted series it is 1.206 on M4 hourly (was 1.681), 0.296 on pedestrians (was 1.367) and 1.403 on KDD (was 1.719).
- **Parity with statsforecast's Theta (620 series):** median forecast difference 0.0-0.4% on every dataset, mean error within 0.4% of the reference (1.329 vs 1.323).
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-34 — Time Series: ETS in the state-space form, fitted by maximum likelihood (fundamentals plan, Phase 3)

- **Status:** Verified
- **Related issue:** next_steps.md "BIG TODO: get the forecasting fundamentals right", weak point 4: starting states were heuristic and never estimated, errors were additive only, parameter bounds were a box, and the optimiser was a short coordinate search.
- **Scope:**
  - `src/data/timeseries/ets.ts`: the innovations form of fpp3 ch. 8 for error A or M, trend N, A or damped, season N, A or M; 15 forms for a positive series (6 otherwise); additive errors never with a multiplicative season, as in R. Parameters and starting states are estimated together by Nelder-Mead (`optimize.ts`) on -2 ln L from forecast::ets's heuristic start (classical decomposition of the first cycles; a straight line through the first max(10, 2m) adjusted points), inside the usual region (0 < beta < alpha, 0 < gamma < 1 - alpha, 0.8 < phi < 0.98), selected by AICc. Fitting every form with every state free took about 1.1 s per monthly series, so the search is two-stage: all forms with the seasonal starting states held at the heuristic, then the best three with every state free (about 0.13 s, same choice, no worse likelihood).
  - The window is the latest max(300, 6m) periods (was 800), and a rolling-window or per-fold decomposition recomputes the starting state at its own start.
  - The model card says when the errors are multiplicative; the model pages describe the new ETS and Theta and what they still differ in.
- **Checked against references:**
  - Equations vs statsmodels' ETSModel (innovations form) with identical parameters and starting states: one-step forecasts agree to 1e-13 for all seven non-seasonal and additive-season forms. For a multiplicative season statsmodels updates the season with the current level where fpp3 8.3 and R's code use the previous level; those forms are tested against the textbook's component form.
  - Fit vs statsforecast's AutoETS (a port of R's ets) on 620 series: same form on 53-88% of series (85-88% on quarterly and yearly), median forecast difference 0.0-2.6%, mean error +2.0% overall (M3 monthly -0.2%, quarterly +2.2%, yearly +10.3%, tourism monthly +0.9%, tourism quarterly +0.1%, hospital -1.8%, M1 monthly -1.5%); the M3 yearly gap is a handful of short, trending series where the two optimisers land in different places. Where both choose the same form, our AICc equals the reference's (median difference 0.000; on a 150-series subset ours was better by more than 0.5 on 23 of 108 same-form series and worse on 6). More optimiser effort did not help.
  - An early calibration of the AICc constant by regression gave a misleading "reference is better" reading; the raw difference is exactly 0, so the likelihood conventions are identical. Recorded because it nearly led to a wrong conclusion.
- **Result** (Monash, mean MASE over up to 200 series, Phase 2 -> Phase 3; Auto):
  - Better on 14 of 29 datasets, level on 2, worse on 12 (mostly under 2%).
  - Gains: M3 yearly 2.616 -> 2.471 (-5.5%), M3 other -4.5%, M1 quarterly -4.0%, FRED-MD -3.2%, covid -2.8%, sunspot 0.227 -> 0.170 (-25%; the target was 0.15), M3 monthly -1.4%, M3 quarterly -1.4%.
  - Losses: tourism yearly +6.3% (2.503 -> 2.661), M1 yearly +3.9%, nn5 daily +2.2%, tourism monthly +1.5%, tourism quarterly +1.0%, hospital +1.2%.
  - Long seasons, re-run with the final code: electricity weekly 0.759 -> 0.742, M4 hourly 1.269 -> 1.223 (the Combination, 1.204, is now slightly better than the backtest winner there), KDD 1.217 -> 1.221, pedestrians 0.232 -> 0.233, NN5 weekly and traffic weekly unchanged; M4 weekly 0.496 -> 0.522 (still better than published ETS 0.575 and Theta 0.546) and Australian electricity (5 series) 1.222 -> 1.399.
  - ETS alone is not more accurate for being more faithful: it matches the reference but our earlier cruder ETS scored better than the reference on several datasets (tourism yearly 2.465 vs R's published 3.395; now 3.000). The textbook method is weaker on short, trending yearly series; the Combination (Auto's default) limits the cost.
- **Speed:** the two-stage search keeps every case inside the 500 ms ceiling: daily open 114-140 ms, hourly open about 181 ms, horizon drag 93-118 ms (flagged "slow" against the old soft targets, as intended). The accuracy gate takes about 15 s (was 2 s).
- **Not done:** the admissibility check on top of the usual region; the model's own analytic prediction intervals (the bands stay empirical); optimising every starting state in every form.
- **Gate:** baseline accepted. 12 small-sample checks moved by more than 2%, e.g. one weekly-traffic series where Auto let the historical mean replace the Combination after passing the folds, the lockbox and the significance test, then missed a level shift (MASE 2.87 vs 0.42): the winner's curse in one series. On the full 200-series weekly traffic set Auto (1.300) is slightly better than the Combination (1.316), so the override rule is unchanged.
- **Tests run and results:** `test/timeseries-ets-form.test.ts` (5: statsmodels agreement for seven forms, textbook component form for multiplicative seasons, selection finds the generating form, non-positive series, maximum-likelihood SES); the ETS and export tests updated; 1,184 unit and 112 end-to-end pass; build clean.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-33 — Time Series: 500 ms latency ceiling, with a "Calculating..." spinner

- **Status:** Verified
- **Related issue:** Owner, 2026-10-31: loosen the Time Series latency budget to 0.5 s or less, show a spinning donut, and keep a deep-analysis button for anything heavier (DEC-2026-10-31-03).
- **Scope:**
  - **Budgets:** `bench/timeseries.ts` allows 500 ms for open, horizon drag, Patterns and the aggregation switch; the rolling-window change keeps 8 ms (daily) and 15 ms (hourly). The old figures are now soft targets: over one prints "slow" without failing.
  - **Spinner:** a pill with a spinning donut and "Calculating..." at the top right of the chart card appears when a request passes 150 ms and disappears when the answer arrives (also on a stale or failed response); it respects reduced motion (a slow pulse instead of a spin).
  - Heavier analyses stay behind buttons: the Deep check and the Trend flexibility check already work this way.
- **Measured now:** daily open 97 ms, hourly open 205 ms, hourly horizon drag 122 ms (flagged "slow" against its old 110 ms target), Patterns 249 ms.
- **Tests run and results:** an end-to-end test delays the worker's answer by 700 ms and checks the pill and spinner appear and clear, and that a fast change shows no pill; Time Series suite and the benchmark pass.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-32 — Time Series: "How the models work" window, with sources and credits (fundamentals plan, Phase 2)

- **Status:** Verified
- **Related issue:** Owner, 2026-10-31: users should be able to click for more information on the models, in a pop-out with a great level of technical detail, and anything learnt from elsewhere (Hyndman, Monash University and others) must be attributed.
- **Scope:**
  - **Window:** an ⓘ on every model row, a "How the models work" button beside the guide and a "How it works" link on the forecast strip open a window with a page per model and per topic. A model page shows, in order: what it is; this series' own fit (parameters, season handling, scores, folds, Auto's reasoning); the equations as implemented; how it is fitted; how its forecast and band are made; when it shines and when to doubt it; and where this implementation differs from the textbook, said plainly. Topics: How Auto chooses, Seasons: testing and removing them, Backtest, lockbox, scores and bands, Gaps and filled periods, Evidence, Sources and credits.
  - **Sources:** `src/data/timeseries/references.ts` holds 35 sources, each with what this project took from it; the documentation cites them by id and every citation links to the Sources list. `docs/time-series-sources.md` is generated from the same list (`tools/ts-eval/make-sources-doc.ts`). The page states that everything was reimplemented from the published methods, that no code was copied (R's forecast package is GPL-3), that statsmodels (BSD-3-Clause) and statsforecast (Apache-2.0) are development-only references, and that the Monash data (CC BY 4.0) is test data only.
  - **Attribution fixes found in an audit of the existing code:** the Combination was called "the M4 Comb benchmark" but M4's Comb averages simple, Holt and damped smoothing, so it is now described as in the spirit of it; the Diebold-Mariano test was credited to fpp3 but is Diebold and Mariano (1995), with the Harvey-Leybourne-Newbold correction and a Newey-West variance, so it now cites those; the regression model credits Prophet (Taylor and Letham 2018), ridge regression, Fourier terms and Duan's smearing; "fpp3 5.10" was removed as the source of the claim that selecting among models on few folds is noisy (it is cited to Cawley and Talbot 2010 and Varma and Simon 2006).
  - Honest notes in the model pages: the ETS and Holt-Winters recursions are the classical smoothing form, not ETS's innovations form; ETS starting states are heuristic yet counted in AICc; Theta's alpha comes from a grid; the regression is Prophet's design, not Prophet.
- **Tests run and results:** `test/timeseries-docs.test.ts` (every model documented; every citation resolves; the Sources list is complete and each entry says what it was used for); an end-to-end test that opens a model page, follows a citation to the Sources list, visits two topics and closes with Escape; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-31 — Time Series: long seasons are removed with MSTL before smoothing; the weekly MASE scale is corrected (fundamentals plan, Phase 2)

- **Status:** Verified
- **Related issue:** next_steps.md "BIG TODO: get the forecasting fundamentals right", weak points 2 and 3: ETS and Holt-Winters learned 52 or 168 seasonal states from a few cycles; R's ets() refuses seasons over 24 and says to use stlf().
- **Scope:**
  - **Season handling,** decided once on the history before the first backtest fold: *native* (seasons of 24 periods or less: seasonal ETS and Holt-Winters states, as before), *mstl* (longer seasons: the season or seasons that fit, e.g. 24 and 168 hours, are removed with MSTL; Best smoothing, trend forms only, and a damped trend run on the seasonally adjusted series; each seasonal component's last cycle is added back, as forecast::stlf does) or *none* (the seasonality test finds nothing at a long season).
  - **The test** is the Theta method's, as in forecast::thetaf. It decides for Theta, and for seasons over 24 periods, where it is made at the shortest period that fits (at 168 hours its error bar sums 167 squared autocorrelations and sees nothing). At seasons of 24 or less it does not decide for ETS and Holt-Winters: letting it switch the season off cost 1-4% on several monthly and quarterly datasets, because a trend inflates its error bar. It also can call a trending or smooth series seasonal; that is harmless.
  - **MSTL path details:** one pass over the periods (R and statsmodels make two) and a window of about six cycles; measured as accurate (slightly better on M4 hourly, ETS 1.329 vs 1.355) at half the cost, while a window of 840 hours was worse. The decomposition is redone on each fold's own history; the Deep check's residuals use the adjusted fit; filled periods are decomposed as filled values and masked out of the smoothing.
  - The model card gains a Season row and the Smooth and damp row says what ran.
  - **MASE scale corrected.** The archive scales weekly MASE by the 52-week seasonal naive; the benchmark protocol had used 1. The earlier finding that weekly data was 2-4.5x worse than published was this error, not a modelling failure: with the right scale our ETS on M4 weekly is 0.506 against the published 0.575 (Theta 0.566 vs 0.546; Auto 0.496, TBATS 0.504), and NN5 weekly matches (ETS 0.899, Theta 0.893 vs 0.911 and 0.885). The gate fixture's baseline is rescaled.
  - Speed: STL was made 3.5x faster without changing its output (powers replaced by products, no per-call allocation).
- **Result** (Monash, Auto mean MASE, 200 series per dataset, Phase 1 -> Phase 2, same scale): M4 hourly 1.564 -> 1.269 (-19%), pedestrians 0.239 -> 0.232, Aus. electricity half-hourly 1.251 -> 1.222, KDD 1.220 -> 1.217; weekly, on the corrected scale and the old code against the new: M4 weekly 0.512 -> 0.496, electricity weekly 0.818 -> 0.759 (the best published classical is TBATS 0.792), NN5 weekly 0.855 -> 0.848, traffic weekly unchanged. The ETS alone improves most where the season is long: hourly 3.086 -> 1.246, pedestrians 0.705 -> 0.317, electricity weekly 1.017 -> 0.826, M4 weekly 0.550 -> 0.506. Low-frequency data moves by under 1% except M1 monthly, which is 3.9% worse (0.956 -> 0.993) from Theta's seasonality test, against small gains on M3 monthly (-0.9%), hospital (-1.1%) and car parts (-1.5%).
- **Not achieved:** sunspot (0.227; the target was 0.15: Theta alone gets 0.120, but Auto's default Combination includes an ETS that keeps a weekly season the daily sunspot series does not have; the autocorrelation test calls a smooth series seasonal, so it cannot fix this); Fourier terms for the non-integer 52.18-week year (weekly data uses a season of 52); the regression model is kept, because it is the only model that uses drivers and Auto never picks it unless it earns it (it wins on some hourly data).
- **Speed:** hourly open 182-212 ms (budget 220) and horizon drag 95-101 ms (budget 110) after the extra decompositions; daily unchanged.
- **Tests run and results:** `test/timeseries-season.test.ts` (5: the test, MSTL path on a daily and weekly cycle, no season, 24-or-less keeps the season, Deep check on the adjusted fit); gate rebaselined (M1 monthly +2%, pedestrians +3% on 8 and 3 series, both explained above); 1,179 unit and 112 end-to-end pass.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-30 — Time Series: STL and MSTL decomposition, and the Theta seasonality test

- **Status:** Verified
- **Scope:** `src/data/timeseries/stl.ts` implements STL (Cleveland, Cleveland, McRae and Terpenning 1990) and MSTL (Bandara, Hyndman and Bergmeir 2021) from the published algorithms, with the defaults of R's stl() and forecast::mstl(). `seasonality.ts` implements the Theta method's autocorrelation test of seasonality (as in forecast::thetaf). No code was copied.
- **Checked against** Python statsmodels (BSD-3-Clause) with the settings of R's stl(): STL agrees to machine precision (0 to 1.7e-13) on monthly, outlier-robust, weekly and hourly series, so the loess, subseries extension, low-pass filter and bisquare robustness loops are the published ones; MSTL agrees to within 2% of the series' spread (statsmodels uses jumps of 1 where R uses ceil(window / 10)). Reference output is stored in `test/fixtures/stl-reference.json` (`tools/ts-eval/make-stl-reference.py`).
- **Tests run and results:** `test/timeseries-stl.test.ts` (4: reference match, MSTL, components add back, robust fit resists an outlier).
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-29 — Time Series: Auto defaults to the Combination (fundamentals plan, Phase 1)

- **Status:** Verified
- **Related issue:** next_steps.md "BIG TODO: get the forecasting fundamentals right", weak point 1. The Monash benchmark showed that "pick the backtest winner of 7 models" (Auto) was worse than always using ETS on 15 of 19 low-frequency datasets: selection from about 10 short, overlapping folds is noisy.
- **Scope:**
  - **New model "Combination":** the plain average of best smoothing, steady trend and smooth and damp (fpp3 13.4; the M4 "Comb" benchmark). The old Blend is renamed "Blend with regression" (it still adds the drivers model).
  - **Auto policy:** with a season of 24 periods or less (what seasonal ETS handles), Auto is the Combination; a rival replaces it only if it beats it on the selection folds, then on the unseen lockbox fold, then in a Diebold-Mariano test at 5% (`dmTest`, shared with the Deep check). With a longer season (weekly, hourly) Auto still picks the backtest winner, and the Combination is not a candidate. `ModelRun.auto` records the pick and the reason per measure; the model card, forecast strip, legend and guide explain it.
  - Also fixed: the Deep check's damped Holt-Winters one-step residuals no longer learn from filled periods.
  - Gate fixture enlarged to 141 series (220 KB) so small datasets no longer swing the gate; baseline rewritten.
- **Result** (Monash, mean MASE, Auto before -> after; up to 200 series per dataset): M3 monthly 0.900 -> 0.854, M3 quarterly 1.333 -> 1.103, M3 yearly 3.465 -> 2.616, M1 monthly 1.053 -> 0.956, M1 yearly 4.493 -> 3.628, tourism monthly 1.565 -> 1.432, tourism quarterly 1.747 -> 1.508, tourism yearly 3.195 -> 2.503, hospital 0.771 -> 0.741, FRED-MD 0.500 -> 0.472, sunspot 0.301 -> 0.227. Better on 19 of 29 datasets, level on 7, worse on 2: car parts +1.9% (the sporadic-demand gap, Phase 4) and traffic weekly +1.1% (its series are 104 weeks, too short for a 52-week season, so they take the Combination policy). Weekly electricity and NN5 are unchanged and M4 weekly is 2.502 (was 2.519), re-run with the final long-season policy; the other numbers come from the full run just before the Combination was kept out of the long-season pool, which touches only datasets with seasons over 24. Auto now beats every published `forecast` classical method on M3 monthly and quarterly, tourism monthly and quarterly, M1 monthly, hospital and NN5 daily.
- **Tests run and results:** new `test/timeseries-auto.test.ts` (3: policy and reasons, long-season policy, Diebold-Mariano); the Deep check, export and validation tests updated; Time Series e2e (17) and full e2e (111) pass; gate passes on the new baseline; bench:timeseries within budget on most runs (the daily open case sits at its budget, +1 ms from this change).
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-28 — Accuracy gate for the Time Series forecasts (fundamentals plan, Phase 0)

- **Status:** Verified
- **Related issue:** next_steps.md "BIG TODO: get the forecasting fundamentals right", weak point 12: speed had budgets in the gate, accuracy had none, so a model change could silently make forecasts worse.
- **Scope:**
  - `bench/accuracy.ts` (`npm run bench:accuracy`, in `npm run gate`): 61 series from 20 Monash archive datasets (`test/fixtures/accuracy`, CC BY 4.0, attributed in SOURCE.md) run through the engine on the archive's protocol; about 1 s. The Auto forecast and the ETS + Theta + damped combination fail the gate when any dataset's mean MASE is more than 2% worse than `baseline.json`; the other models are printed. `--update` accepts an intended change.
  - `tools/ts-eval/lib.ts` holds the protocol shared with `monash.ts`; `make-fixture.ts` rebuilds the fixture.
  - Departure from the plan: the fixture is committed (107 KB, test-only) rather than downloaded on demand, so the gate is deterministic and offline.
- **Tests run and results:** gate passes on its baseline; fails (exit 1, "OVER") when one baseline entry is tightened by 5%; typecheck; monash.ts still runs on the shared code.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-27 — Monash benchmark against R's forecast package; fundamentals plan

- **Status:** Verified (tooling and plan)
- **Scope:**
  - **`tools/ts-eval/monash.ts`:** the Monash archive protocol (train on all but the last h, mean MASE against the training seasonal naive) on 29 datasets, with the published SES, Theta, TBATS, ETS and ARIMA results of R's forecast package alongside. It also scores fixed combinations (ETS + Theta, ETS + Theta + damped).
  - **Plan:** the results and a phased fundamentals plan are in next_steps.md ("BIG TODO: get the forecasting fundamentals right").
- **Findings:**
  - Our ETS is on par with `forecast::ets` on monthly, quarterly and yearly data, and our combination beats every published classical method on M3 monthly and quarterly and tourism monthly and quarterly.
  - Auto (pick the backtest winner) is worse than always-ETS on 15 of 19 low-frequency datasets.
  - Weekly data looked 2-4.5x worse than published. That was a protocol error, corrected in CHG-2026-10-31-31: the archive scales weekly MASE by the 52-week seasonal naive, and the protocol had used 1.
  - Intermittent and noisy daily counts are about 35% worse than SES.
  - Short series (about half of M3 and M1 yearly) cannot be forecast.
- **Decision:** Ship (tooling and plan; no behaviour change)
- **Date:** 2026-10-31

### CHG-2026-10-31-26 — Fix: an empty extra period after monthly, quarterly and yearly series

- **Status:** Verified
- **Related issue:** Found by the Monash benchmark (M3 monthly): a monthly series ending in a 30-day month (or February) got an empty extra period after its last reading, because the last reading was taken to cover the median gap (31 days) after it. With "partial last period: kept" the models even forecast from the empty period.
- **Scope:** Monthly, quarterly and yearly readings now cover their calendar period and end with it.
- **Tests run and results:** `test/timeseries-calendar-end.test.ts` (fails before the fix, passes after); Time Series unit tests pass.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-25 — Time Series evaluation harness and findings on 13 real series

- **Status:** Verified
- **Scope:** `tools/ts-eval/run.ts` (+ README with data sources) runs the engine on a folder of CSVs and reports, per series:
  - the Auto pick and its lockbox rank;
  - Diebold–Mariano verdicts;
  - three "prefer simpler" rules;
  - the best flexibility, residual tests and band coverage.
- **Findings** (next_steps.md, "Evaluation on 13 real series"):
  - Auto ranks #1.92 of 7 on unseen data, and every "prefer simpler" rule did worse (#2.08-2.38), so Auto is unchanged.
  - The Chadstone parking timestamps ignore daylight saving (the pattern shifts an hour on 4 Oct 2026); that is why repeat-last-week wins there.
  - 80% bands cover about 75%.
  - Flexibility 5 stays the default.
- **Tests run and results:** harness run on 13 series; typecheck.
- **Decision:** Ship (tooling and docs)
- **Date:** 2026-10-31

### CHG-2026-10-31-24 — Time Series: no model learns from filled periods

- **Status:** Verified
- **Related issue:** next_steps.md "Review against fpp3", item 6. ETS, Holt-Winters and Theta used to run through filled values and learn from them; only the regression skipped them.
- **Scope:**
  - **ETS and Holt-Winters:** a filled period is missing. The state carries through it like a forecast (level + damped trend, season unchanged) and adds nothing to the fitting error. Starting values still come from the filled series, so a gap at the very start cannot break initialisation.
  - **Theta:** its level smoothing skips filled periods.
  - The gap notes, the Data finding and the help text say so.
- **Tests run and results:** a test with a 15-month gap (every model gives finite scores and forecasts); Time Series unit (38) and e2e (17) pass; bench:timeseries within budgets on two runs.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-23 — Time Series: Deep check (significance, horizon, calibration, residuals)

- **Status:** Verified
- **Related issue:** next_steps.md "Review against fpp3", items 2-5. The owner is happy for an on-demand button to break the latency budgets.
- **Scope:** **Deep check** on the Models panel, run only when asked, for the shown model:
  - **Diebold–Mariano** against each of the six rivals, on per-fold mean absolute-error differences over the selection folds. It uses a Newey–West variance (lag = fold overlap − 1), the Harvey–Leybourne–Newbold correction and a t distribution on n − 1 df. Each rival gets a verdict at 5%. "No significant difference" from a simpler rival says to prefer it, with a warning on low power when there are few folds.
  - **Error by steps ahead:** MAE per step for the pick, the runner-up and repeating the last cycle.
  - **Band calibration on every fold**, leave one fold out: 80% and 95% coverage and the 80% Winkler score (scaled like MASE), with off-target coverage flagged.
  - **The pick's residuals:** ACF with ±1.96/√n, seasonal lags outlined, and a Ljung–Box test (lag 2m, or 10 when not seasonal; at most n/5), with a verdict. It also states which models' residuals are fitted rather than one-step, and that clean residuals do not prove a model is not overfitted.
- **How:** `src/data/timeseries/stats.ts` adds the t and chi-square tails (incomplete beta and gamma), checked against tables. The check travels only when asked (`deep` on getTimeSeries); about 45 ms on the test series.
- **Tests run and results:** `test/timeseries-deep.test.ts` (2); a Time Series e2e case; Time Series e2e (17) pass.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-22 — Time Series: a lockbox fold against selection bias

- **Status:** Verified
- **Related issue:** next_steps.md "Review against fpp3", item 1. The Auto pick was the best of 7 models on the same folds it was scored on, so its score was optimistic (the winner's curse).
- **Scope:**
  - **Lockbox:** with 4 or more folds, the last fold is held back. Ranking, Auto, folds beaten, grades and the "vs repeat-last-cycle" ratio use the other folds only; every model is then scored once on the held-back fold.
  - **Board:** a new "Unseen fold" column shows each model's score and rank there.
  - **Forecast strip:** adds a "Lockbox check" line: where the pick ranked on unseen data, whether it beat repeating the last cycle, and a verdict (holds up / partly luck / fell apart).
  - **Elsewhere:** the model card lists both score sets; the guide explains the lockbox; the scorecard CSV gains lockbox_* columns.
- **Tests run and results:** Time Series unit tests (35, incl. a lockbox test) and e2e (16) pass.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-21 — Time Series: technical notes, the forecast named on the chart, difference plots

- **Status:** Verified
- **Related issue:** Owner, 2026-10-31: the gap fill and Trend flexibility descriptions were too thin for a technical audience; the forecast model should be prominent with a comment on its performance; Explore should plot the difference from n periods earlier.
- **Scope:**
  - **Gap choices:** each states its exact rule, with this series' numbers (season, smart threshold, nearby-cycle count), stacked under the name in a wider popover. The models' use of filled periods is now stated exactly: errors are never scored on them, and the regression leaves them out of its fit (the smoothing models run through them).
  - **Trend flexibility:** explains the piecewise-linear trend, its hinge count and the ridge λ at the current setting, and the bias/variance trade-off. **Check every setting** draws the validation curve: backtest MASE at 1-10 on the board's folds, with the best other model as a reference line. It suggests the stiffest setting within 5% of the lowest, offers "Use n", and says when the error turns back up (fitting noise).
  - **Forecast strip:** above the chart, it names the model (Auto / picked) with its grade, the like-for-like error against repeating the last cycle, folds beaten, the band check, and warnings for a lead won in under half the folds or under 3 folds.
  - **MASE wording fixed:** below 1 means beating the *in-sample one-step* naive, not repeating the last cycle at the same horizon.
  - **Explore → Difference:** plots y(t) − y(t − lag), with presets (1, each season that fits, a year) or any lag. The legend says what is drawn, the zero line is marked, the hover read-out gives the change, and a note gives the mean and SD of the change and the share of variance differencing removes. It is also a Difference step in the pipeline strip.
- **Tests run and results:** two Time Series e2e cases; full suite and bench:timeseries.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-20 — Time Series engine: validation curve for Trend flexibility; MASE scaled on training data only

- **Status:** Verified
- **Scope:**
  - **Backtest setup:** factored into `backtestPlan`, shared by the models and the new `flexCurve`, which gives backtest MASE of the trend, seasons and drivers model at flexibility 1-10 (computed only on request).
  - **MASE scale:** now from the training data before the first origin (fpp3 §5.8), no longer the whole history up to the split, so test periods no longer leak into the denominator. Rankings are unchanged (every model shares the scale); absolute MASE values shift slightly.
- **Tests run and results:** Time Series unit tests (35) pass.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-19 — Time Series: "Periods" becomes a clear data table

- **Status:** Verified
- **Related issue:** Owner: "what is the Periods button - is that the table of the numbers? is it actuals or forecast? that is vague".
- **Scope:**
  - **Button:** "Show data table" / "Hide data table", with a tooltip.
  - **Caption:** says the table lists the periods in view, how many, and that Export downloads them all.
  - **Status column:** Actual / Actual, held out / Actual, partial / No rows; *how filled* / No rows / Forecast. Forecast rows are shaded; filled and empty rows are dimmed.
  - **Headers:** "Actual (measure)" and "Forecast (model name)".
  - **Row limit:** past 400 rows in view it keeps the latest 400, so the forecast is never cut off.
  - The help text describes the Export menu and the data table.
- **Tests run and results:** a Time Series e2e case; full suite 1160 unit and 108 e2e pass; build OK.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-18 — Time Series: an Export menu for analysts

- **Status:** Verified
- **Related issue:** Owner: no visible way to export the forecast; wanted the model details and performance as CSV.
- **Scope:** The faint "Export CSV" became a clear **Export ▾** menu with four CSVs:
  - **Forecast:** future periods, model, forecast and the 80% and 95% bands.
  - **Series and forecast:** the old export, plus a row_type column (actual / filled / empty / actual held out / forecast), the model name and the 95% band.
  - **Model scorecard:** one row per model, ranked by the chosen measure: all seven measures, vs repeat-last-cycle, grade, folds beaten, band and held-out checks, the validation window, train length, horizon and fold step, the fitted range, and parameters (e.g. `ETS(A,Ad,M) alpha=… beta=… gamma=… phi=… AICc=…`).
  - **Backtest detail:** long form (model, fold, fold origin, step ahead, period, actual, forecast, error, abs error, filled), so any measure can be recomputed; MAE recomputed from it matches the board.
- **How:** The fold forecasts stay in the worker and are only sent when this export asks (`backtest: true` on getTimeSeries), so normal page updates carry no extra data.
- **Tests run and results:** `test/timeseries-export.test.ts` (2); an e2e downloading all four; Time Series e2e green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-17 — Time Series: Rank by up front

- **Status:** Verified
- **Related issue:** Owner: "Rank by" was hard to see, though it drives the page (it picks the Auto model, the line on the chart).
- **Scope:**
  - **Rank by** (default MASE, marked "(default)") and **Validate** moved from the Models panel into the Forecast toolbar beside Forecast ahead. Rank by is highlighted, with a "?" that opens Which model, and why?.
  - The chart legend names the forecast's model: "Forecast: Best smoothing · Auto, best on MASE", or "picked".
  - The summary strip's Forecast cell names the model.
  - The Models panel says what it is ranked by, the window and the number of folds.
- **Tests run and results:** Time Series e2e (12) pass.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-16 — Time Series: better gap fills, and a smart one for the models

- **Status:** Verified
- **Related issue:** Owner, testing on `gym_stats.csv` (10-minute gym counts, 2,334 of 13,971 hours empty, gaps up to 25 days): "filled with the usual pattern" performed poorly.
- **Evidence:** Real stretches of the hourly series were hidden and refilled, 60 per gap length, scored by mean absolute error in people:
  - The usual pattern is best up to about 6 hours (3.7 at 3 h).
  - From 12 hours up, the median of the same hour-of-week in the nearest 4 cycles either side misses 20-40% less (24 h: 7.5 vs 9.3; 72 h: 5.5 vs 9.3; 240 h: 7.3 vs 10.0).
  - Carry-forward and linear are 2-3× worse on long gaps.
- **Scope:**
  - New gap choices: *filled smartly* (the usual pattern for gaps up to a quarter of the shortest season, the nearby typical value beyond), *nearby typical value*, *copied from the cycle before*, *carried forward*, alongside the usual pattern, interpolated, zero and left empty.
  - The models now bridge gaps with the smart fill instead of the usual pattern; they still never learn from or score filled periods.
  - Series with no gaps skip the fill work.
- **Tests run and results:** `test/timeseries-fill.test.ts` (2); Time Series unit and e2e; bench:timeseries within budgets (one noisy run over on the daily drag, which does not touch the fill).
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-15 — Time Series: validation window, seven accuracy measures, "Which model, and why?"

- **Status:** Verified
- **Related issue / decision:** next_steps.md "Time Series (owner, 2026-10-31): why one model over another, overfitting, AutoARIMA".
- **Scope:**
  - **Validate** on the Forecast board: an *Expanding window* (default; each fold trains on all history before it) or a *Rolling window* (each fold trains on the first fold's length, sliding forward). It applies to every model; repeat-last-cycle needs no training.
  - **Measures:** every model gets MAE, RMSE, MASE, WAPE, sMAPE, MAPE and bias from the same backtest errors, with no extra fitting. **Rank by** picks the measure, and the Auto pick follows it (bias by its size).
  - **Board:** new columns for the chosen measure and **Folds beaten** (folds where the model beat repeating the last cycle).
  - **Model card:** says how the folds trained, lists all the scores, warns when the best model wins under half its folds (a possible lucky lead), and flags a close call (within 5%; prefer the simpler model).
  - **"Which model, and why?" window:** how the scores avoid overfitting, the two windows with fold diagrams, when each model shines and when to doubt it, and the measures table: Metric | Why it's good (strengths) | When to use it | Math (formula).
- **Not done:** the in-sample "fit gap" from the plan. One-step in-sample errors are not comparable with multi-step backtests, so fold wins and the expanding-vs-rolling comparison carry that signal instead.
- **Tests run and results:** `test/timeseries-validation.test.ts` (2), a Time Series e2e case; bench:timeseries within budgets; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-14 — Time Series: auto-ETS, and backtests that never test on tuned data

- **Status:** Verified
- **Scope:** A new model "Best smoothing": ETS with additive errors over trend none / additive / damped and season none / additive / multiplicative (positive series), each fitted by least squares and the lowest AICc kept (Hyndman & Athanasopoulos, fpp3 ch. 8). The model card names the form, e.g. ETS(A,Ad,M), and its parameters. The Blend now averages best smoothing, steady trend and drivers. Overfitting fix: the backtest's smoothing parameters (ETS and Holt-Winters) are now fitted on data before the first backtest origin only; before, Holt-Winters was tuned on all the history including the stretches it was scored on. ETS fits the latest ~800 periods (or six seasons), the backtest cut is rounded down to a coarse step and fits are cached, so a horizon drag refits nothing.
- **Tests run and results:** `test/timeseries-ets.test.ts` (a growing seasonal series picks a multiplicative season and beats additive Holt-Winters); bench:timeseries within budgets; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-13 — New column from examples

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 6 (Power Query Column From Examples, Excel Flash Fill).
- **Scope:** A From examples mode in the New column window: the first six rows with a "You want" box each; as results are typed, the worker tries an ordered set of rules (`src/data/formula-examples.ts`: the column, case, trim, length, text before/after a separator, first/last N characters, date parts, rounding, two columns joined or combined) on just those rows and offers the formulas that give every typed result, simplest first; the preview then shows them on more rows. The answer is an ordinary editable formula.
- **Tests run and results:** `test/formula-examples.test.ts` (2, incl. a 40-column speed check), a New column e2e case; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-12 — Table usability: headers, menu search, hide and freeze columns, cell peek, paste a block

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 5 (and pasting a block from step 6).
- **Scope:** Columns start wide enough for their name and typical value (110-360 px) and the column number shows on hover only, so names stop being cut. The header menu has a search box (type, Enter runs the first match). Hide column (display only; a "N hidden · Show all" note in the Table bar; the cursor skips hidden columns). Freeze columns up to here (sticky, with the row numbers and File row). The Table bar shows the cell under the cursor in full. Paste a block of cells at the cursor: one confirm, a setCells step per column on file rows (up to 5,000 cells). An empty result offers Clear filters.
- **Not done:** row density (the virtual grid's row height is fixed), moving first-run hints off the rows.
- **Tests run and results:** `test/e2e/table-usability.spec.ts` (4); full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-11 — New column: If / then builder and quick columns

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 4.
- **Scope:** The New column window gains If / then (column, test, value → result rows, Else if, Otherwise, Show as formula; numbers and dates compare as such) and Quick column (copy, row number, text length, join two columns, year/month/day/weekday, rank, % of total, running total, change from the row above, equal-width bands; the name follows the pick). Both write formulas, so preview, Recipe, export and parity are unchanged. New whole-column formula functions ROWNUMBER, RANK (ties share the best rank), PERCENTOFTOTAL, RUNNINGSUM, PREVIOUS, BIN, worked out once per column in the stored order and ported exactly to the pandas/Polars helpers.
- **Tests run and results:** `test/new-column-builders.test.ts` (2), whole-column unit test, a new New column e2e case, parity case `formulas` extended (pandas PASS, Polars PASS); full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-10 — Table: cell cursor and editing a cell in place

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 3; DEC-2026-10-31-02 (confirm on by default).
- **Scope:** A cell cursor in the grid (click; arrows, Page Up/Down, Ctrl+arrows to the edges, Home/End, Ctrl+C copies, Esc clears; the grid's keys no longer reach the 1-9 tab shortcuts). Editing in place: double-click, Enter, F2 or typing; Enter commits and moves down, Tab right, Esc cancels. A confirm next to the cell (`src/ui/cell-edit-confirm.ts`) shows old and new value with the file row, warns when the value does not fit a number or date column, and offers Don't ask again for this session. Each edit is a `setCells` clean step keyed by the row's file number (cleans see the current rows), so it stays with the row; consecutive edits on one column merge into one step keeping each cell's first value; after the edit the cursor returns to that cell wherever the row now is. pandas (`df.iloc[...]`) and Polars (`pl.when(pl.int_range(...))`) write it.
- **Tests run and results:** `test/e2e/cell-edit.spec.ts` (3), a setCells unit test, parity case `cell-edits` (pandas PASS, Polars PASS); full suite green.
- **Known limitations:** an edit clears that column's own filter (as any clean does) and the sort returns to file order; pasting a block of cells is a later step.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-09 — Formula columns in the pandas and Polars recipes

- **Status:** Verified
- **Related issue / decision:** DEC-2026-10-31-01 acceptance: every function has a parity case.
- **Scope:** `src/data/formula-export.ts` writes each formula as a small Python function over one row, with one shared helper block (written once per script) that ports the app's rules and all 28 functions; pandas inserts the column with `df.insert`, Polars with `insert_column`, both as the app's text. A formula that no longer reads against the tracked columns is marked for manual work. Row by row is slower than vectorised code, by choice: the recipe must agree with the app cell for cell. Fixed in the app: a formula writing a word that usually means missing ("Unknown", "N/A") showed an empty cell; a new column now keeps its own output.
- **Tests run and results:** recipe parity harness (`tools/recipe-parity`, new `formulas` case: 47 formula columns over blanks, errors and dates): pandas PASS, Polars PASS, every other case PASS; codegen unit test; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-08 — Table: New column window (formula or one value)

- **Status:** Verified
- **Related issue / decision:** next_steps.md "BIG TODO: the Table view" step 2; DEC-2026-10-31-01 (Excel style), DEC-2026-10-31-02 (computed once).
- **Scope:** `src/data/column-formula.ts`: Excel-style formulas (`[Column]`, + - * / ^ &, comparisons, 28 functions), checked against column types with errors that point at the place and suggest a fix, compiled to closures (no eval). Rules: blank in, blank out; comparisons with a blank FALSE except `<>`; text compares case-insensitively; date - date is days. A `derive` transform step inserts the column (typed from the result) at a chosen place; it carries over in recipe files and survives renames via `renameInFormula`. A `previewFormula` worker request shows the first 20 rows with the inputs and counts empties and errors by reason (all rows up to 200k, else an even sample). The window (`src/ui/new-column-dialog.ts`): name, place, Formula or Same value for every row, column suggestions after `[`, function help at the caret, column and function lists. Ways in: + after the last header, Insert column left/right, Add column in the Table bar, `add column name = formula`. Fixed: the Table bar showed "No rows" after a transform rebuilt the table.
- **Known limitations:** pandas/Polars export of formulas is the next step (until then the recipe marks the step for manual work).
- **Tests run and results:** `test/column-formula.test.ts` (8), `test/e2e/new-column.spec.ts` (3); full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-07 — Table: first / last N rows

- **Status:** Verified
- **Related issue / decision:** next_steps.md, "BIG TODO: the Table view", section 2; DEC-2026-10-31-02 (it is a filter Copy, Chart and Export respect).
- **Scope:** A First / last N menu in the Table bar (10, 100, 1,000 or a number you type, from the top or the bottom of the current order; All rows), a filter chip ("Last 10 rows ×") that Clear all also removes, and `head 100` / `tail 50` / `head all` in the command bar. The worker applies it where the current rows are built, so the count, the row read-out, chart cards, Pivot View, Time Series, Copy and Export all use the same rows; after a shuffle the first N are a random N; a new dataset clears it.
- **Tests run and results:** a new `test/e2e/table-nav.spec.ts` case; full suite green.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-06 — Table navigation: where you are, Go to, Top/Bottom, Reverse, file row numbers

- **Status:** Verified
- **Related issue / decision:** next_steps.md, "BIG TODO: the Table view", order of work step 1.
- **Problem addressed:** The Table did not say which rows were on screen or how they were ordered, had no way to jump to a row, the end or a column, could not reverse, and lost the file's own row number once rows were sorted. Past 9,999 rows the # column cut its numbers off.
- **Scope:** A bar under the Table (`src/ui/table-nav.ts`): "Rows 41–66 of 12,480" (click to Go to), Top and Bottom (Ctrl+Home, Ctrl+End), Reverse, File row, the order in words ("file order", "sorted by Amount ↓, reversed", "shuffled") with Back to file order, and Go to (Ctrl+G; `src/ui/table-goto.ts`): a position, -1, 50%, `file 1234`, top/bottom, or a column name (fuzzy). The worker reverses in `computeSortedIds`, so reversal holds through every filter and re-sort; a header sort or a shuffle clears it. New worker requests: `getRowIds` (File row numbers for the rows on screen, only while the column is shown), `findRow` (where a file row sits now, or that filters hide it), `getOrder`. The File row column is remembered in this browser; the # column widens to fit five or more digits. Command bar: `goto …`, `reverse`.
- **Tests run and results:** `test/table-goto.test.ts` (5), command-bar cases, `test/e2e/table-nav.spec.ts` (3); full suite green.
- **Known limitations:** First N / last N, keyboard cell movement and frozen columns are later steps of the plan.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-05 — Time Series: which seasons to decompose, said plainly

- **Status:** Verified
- **Related issue / decision:** next_steps.md, owner TODO 2026-10-30 item 4.
- **Problem addressed:** Seasons the series was too short for disappeared without a word; sub-daily data offered no way to see the week and year without the swings within a day; a yearly season in weekly data used 52 weeks and drifted about a week every five and a half years.
- **Scope:** Decomposition season lengths follow fpp3: a year is 365.25 days and 52.18 weeks (`Grain.decPeriods`; models keep whole-number `periods`). `phaseIndex`/`phaseCount` place each period by its share of the way through a calendar cycle, so all 52 weekly phases are used evenly; whole lengths are unchanged (i % m). The engine returns the grain's seasons the series is too short for (`tooShort`, with the periods needed: 2 cycles + 2); the page shows them greyed with the rule, named as this page's own (fpp3 sets none). Decompose gains Daily view (sub-daily grain to day, for the weekly and yearly season) and Back to hourly. Help credits Hyndman and Athanasopoulos.
- **Tests run and results:** `test/timeseries-seasons.test.ts` (3; ten years of weekly data: yearly strength 0.955 with 52.18 weeks against 0.872 with 52), a new Time Series page e2e test; full suite green; bench:timeseries within budgets.
- **Known limitations:** Closed hours still count in the period length (plan: open slots only). STL/MSTL and Box-Cox from item 5 are not done.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-04 — Time Series reads a Pivot View as its source

- **Status:** Verified
- **Related issue / decision:** next_steps.md, owner TODO 2026-10-30 item 3; D1 (view-sourced charts stay linked).
- **Problem addressed:** Someone who had already aggregated in Pivot View (monthly sum of sales, filtered) had to rebuild the same series from raw rows on the Time Series page.
- **Scope:** A Source word in the subline: Table, or any complete Pivot View with a time-grain dimension and a measure. The worker runs the view's own aggregation (its filters and scope, every group, partial periods kept and flagged) and `src/data/timeseries/view-source.ts` turns the result into engine input: the time dimension is the date, each measure a column (never read as a date part or time counter), other dimensions the split-by choices and the shape check's candidates. The grain is the view's own and only sum or mean (across split rows) are offered; the page says the periods are read as they are, not aggregated again. Edge periods the raw rows only partly cover are marked partial, as for the Table. Linked: editing, renaming or removing the view, or changing the filters, updates the series; a removed view falls back to the Table. Clicking a period filters the Table on the view's date column.
- **Tests run and results:** `test/timeseries-view-source.test.ts` (4), a new Time Series page e2e test; full suite green.
- **Known limitations:** Views are only offered once Pivot View has been opened (its panel creates the starter views). The banner's "Open in Pivot View" button is still to do.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-03 — Time Series: several series in one line, and the data's frequency

- **Status:** Verified
- **Related issue / decision:** next_steps.md, owner TODO 2026-10-30 items 1 and 2.
- **Problem addressed:** Rows with several values per timestamp (one per car park, store, sensor) were summed or averaged into one line without a word, so trend, seasons and forecasts were fitted to a mix of series. The page did not say how often or how regularly rows come.
- **Scope:** `src/data/timeseries/shape.ts` reads the rows behind the series shown: rows per moment, share of repeated moments, the category column whose values differ within (almost) every repeated moment (fewest values first, so a row id loses to the series name), and the spacing (typical gap, share on the beat, share on a whole number of beats, p10/p90). The worker works it out once per data, filter or group change and sends it with the snapshot. The page shows an amber banner ("Each moment in snapshot_time holds 5 rows, one per car_park. This line adds 5 car_park series together…") with One car_park at a time, Average them instead (for a sum) and Keep the sum, and a Frequency cell in the strip ("Every day, regular", "Every 30 minutes, regular, some missing", "Irregular, usually every 30 minutes, most 26 to 34 minutes"). Count series never get the banner.
- **Tests run and results:** `test/timeseries-shape.test.ts` (4) and a new Time Series page e2e test; full suite 1125 unit, 87 e2e. 1M rows: 50 to 90 ms, once per data change. bench:timeseries within budgets.
- **Known limitations:** Open in Pivot View (item 2) and Pivot View as a source (item 3) are not done. A pair of columns that only together tell rows apart is reported as "no single column".
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-02 — Map page: dock on the map, Add markers window, marker size

- **Status:** Verified
- **Problem addressed:** The Cities box sat in the page header away from the map; adding markers was a row of buttons above the map that pushed it down; markers had one fixed size.
- **Scope:** A floating dock on the map (Cities switch, Marker size slider, Click map to add, + Add markers…), on top of the map from 860px, above it on narrower screens. Add markers window (`src/ui/map-add-dialog.ts`): paste box, CSV, city search, live preview with skipped lines, style row (symbol, colour, size), Ctrl+Enter adds. Only latitude and longitude are required; unlabelled rows become Marker N, numbered on from the markers already there. A bare `lat,lon` row under a `label,lat,lon` header still reads, and each line may use its own separator. Markers carry a size (3 to 24 px; `size`/`radius` column; per-row field; saved and in the CSV). The marker table moved under the map. Zoom buttons moved to the bottom left so they no longer cover the map title. City and marker labels use the theme's ink and halo (they were dark-on-white in dark mode), and city names keep clear of markers and their labels. Fixed: map page sections shrank under each other in the scrolling page.
- **Tests run and results:** map-page unit tests (12) and e2e (8, two new: paste with numbering, sizes three ways). bench:map within budgets.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-31-01 — General and Research modes

- **Status:** Verified
- **Problem addressed:** Nine tabs put specialist views in front of every user.
- **Scope:** A `General | Research` switch at the left of the tab row (`src/ui/mode.ts`). General shows Overview, Data Quality, Table, Pivot View and Chart. Research adds Outliers, Relationships, Time Series and Map in a teal lane after a divider; they slide in when switched on. The mode is remembered (`turbofuzz-mode`, default General). Number keys follow the visible tabs, so Chart is now 5 and the research tabs are 6–9. Switching to General on a research page returns to the last general page, with Undo. In General the chart cards' "Open in Time Series / Map" links and the "Review the outliers first…" menu item are hidden. The command bar's outliers, relationships, forecast and map commands switch to Research, and new `research`, `general` and `mode …` commands were added.
- **Tokens:** `--research`, `--research-soft`, `--research-border`, `--research-text`, `--research-lane`, each with dark values. Teal is used for Research mode only.
- **Tests run and results:** `npm test` 1119/1119; Playwright 83/84 in the full run, with the a11y light-theme test timing out under load (8/8 when rerun on its own). New `test/e2e/mode.spec.ts`; research-page specs start in Research mode.
- **Manual browser verification:** Screenshots at 1440, 622 and 375px in light and dark. Below 480px the switch shows icons only.
- **Known limitations:** Already present before this change: clicking a line card's "Open in Time Series →" right after the card first draws freezes the page under Playwright tracing (reproduced on the previous commit). Relationships overflows horizontally below about 700px, also unchanged.
- **Decision:** Ship
- **Date:** 2026-10-31

### CHG-2026-10-29-01 — Band caps and optional columns

- **Status:** Verified (unit tests, corpus run); not yet checked in a browser by the owner
- **Related issue / decision:** DEC-2026-10-29-01, plan tasks BAND and OPT
- **Problem addressed:** A good average hid mostly-empty or mostly-invalid columns; blank-by-design columns led the fix list.
- **Files / components changed:** src/data/score.ts, src/data/optional-columns.ts, src/data/name-hints.ts, src/data/dq-issues.ts, src/ui/quality-layout.ts, src/ui/quality-page.ts, src/ui/optional-marks.ts, src/ui/app.ts
- **Tests run and results:** test/band-optional.test.ts (7), full unit suite 1002 pass.
- **Known limitations:** Optional marks are session-only.
- **Decision:** Ship. Thresholds accepted by the owner as a starting point.
- **Date:** 2026-10-29

### CHG-2026-10-29-02 — Mixed formats and plausible ranges in Validity

- **Status:** Verified (unit tests, corpus run, e2e); not yet checked in a browser by the owner
- **Related issue / decision:** plan tasks T7 and T9
- **Problem addressed:** A date column written several ways, a numeric column with currency symbols on some values, and impossible values (age 999) did not lower Validity.
- **Scope:** Exact counts at load: `dateFormats`, `numberSymbols`, `rangeViolation` on each column. Three new Validity checks, three new fix-list issues, rows-affected includes them. Fixes: date standardise (toDate op), strip symbols (toNumber op), both undoable Recipe steps. Plausible ranges: age 0-120, percent 0-100, year 1900 to next year, gated by whole-word name hints and by the values looking like that thing.
- **Explicit non-goals:** Auto-fix for ambiguous day/month order or dates with times (review only); editable range rules; Show rows filter for these three checks (the column is flashed instead); negative quantities (stay with the existing non-negative finding).
- **Files / components changed:** src/data/date-formats.ts, number-symbols.ts, plausibility.ts, score.ts, dq-issues.ts, dq-rows.ts, column.ts, name-hints.ts, src/worker/protocol.ts, search.worker.ts, src/ui/app.ts, scripts/lib/profile.ts
- **Tests run and results:** date-formats, number-symbols, plausibility, dq-rows-formats; unit suite 1017 pass; e2e 38 pass, 1 flaky setInputFiles timeout that passes alone.
- **Regression findings:** Thousands separators beside short numbers (UCS "35,793" vs "950") were a false positive; grouping now only counts as a second style when a plain 4+ digit value shows the column is not written that way throughout.
- **Known limitations:** Real corpus mixes found: Ask A Manager salary (221 grouped vs 77 plain).
- **Decision:** Ship.
- **Date:** 2026-10-29

### CHG-2026-10-29-03 — Exceptions export (E1) and Apply all safe fixes (T12)

- **Status:** Verified by unit tests; not yet checked in a browser by the owner
- **Related issue / decision:** plan tasks E1 and the apply-all part of T12
- **Problem addressed:** Findings could not be handed to someone who fixes the source system, and the Issues tab had no one-step way to apply every safe fix.
- **Scope:** "Download exceptions CSV" on the Quality hero: one row per failing cell (row, column, check, dimension, severity, value, reason), built in the worker with the same predicates as the scored checks. Values in sensitive-flagged columns are masked unless "Include raw values" is ticked. Values that start like a formula are neutralised. Optional columns do not list their empty cells. "Apply all N safe fixes…" on the Issues tab opens the existing combined preview; each fix stays its own undoable step.
- **Explicit non-goals:** Per-check download buttons on the cards (the worker request already takes a check id); true streaming (the file is built in one message; a confirm appears above 100k rows); a 250k-row timing benchmark.
- **Files / components changed:** src/data/dq-exceptions.ts, src/worker/protocol.ts, search.worker.ts, src/ui/worker-client.ts, app.ts, quality-layout.ts, quality-page.ts
- **Tests run and results:** test/dq-exceptions.test.ts (4).
- **Known limitations:** The exception count can differ slightly from a check's "fail" count where one cell trips several checks; each cell is listed once, under its first reason.
- **Decision:** Ship.
- **Date:** 2026-10-29

### CHG-2026-10-29-04 — Per-column score (part of C1)

- **Status:** Verified by unit test; not yet checked in a browser by the owner
- **Related issue / decision:** plan task C1
- **Scope:** `columnScore(score, column)` applies the dataset formula to one column's checks (pass rate per dimension, optional blanks at reduced weight, weighted by the dimension weights over the dimensions that apply). Shown as a number on each column card in the health strip, with the working in the tooltip.
- **Explicit non-goals:** The profile drawer additions (percentiles, top-10 values, dominant format in words, recommended rules) and virtualised cards for 71+ columns; the existing column inspector is unchanged. Dataset-level checks (duplicate rows) have no column, so they are not in any column score and the column scores do not average to the dataset score.
- **Files / components changed:** src/data/score.ts, src/data/dq-issues.ts, src/ui/quality-layout.ts, src/ui/app.ts, src/styles.css
- **Tests run and results:** test/band-optional.test.ts (8); unit suite 1022 pass.
- **Decision:** Ship.
- **Date:** 2026-10-29

### CHG-2026-10-29-05 — Quality page states (STATES), tests only

- **Status:** Verified (4 new browser tests); screenshot baselines not captured
- **Related issue / decision:** plan task STATES
- **Scope:** The clean-file empty state, the 71-column strip collapse, the post-fix "Fixed this session" group, dark theme and the exceptions download already existed; tests now cover a clean file, a wide file, 390px width with no sideways scroll, a dark-theme contrast sanity check, and the exceptions download.
- **Explicit non-goals:** Screenshot baselines for B/D in both themes; axe run; designed loading and error states beyond the skeleton; score animation.
- **Files / components changed:** test/e2e/quality-layout.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-29-06 — Overview shows the Quality page's issue count (UNIFY, part)

- **Status:** Verified (browser test); not yet checked by the owner
- **Related issue / decision:** plan task UNIFY
- **Scope:** The Overview's "N issues found — Review all" button used its own rough count. It now reads the same issue list as the Quality page ("X issues need fixing · Y worth reviewing") and opens the Quality page. The old count remains only as a fallback before a score exists.
- **Explicit non-goals:** Showing the full issue cards on the Overview; Reports (no separate Reports view was found); retiring the old triage panel, which is still in the code but no longer reached from the Overview button.
- **Files / components changed:** src/ui/overview.ts, src/ui/app.ts, test/e2e/quality-layout.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-29-07 — Near duplicates, suggested pair checks, rules, history, reference accuracy, reports, accessibility

- **Status:** Verified by unit and browser tests; not yet checked in a browser by the owner
- **Related issue / decision:** plan tasks DUPK, T10, R1, R2, S1, REF, REP, SEC, A11Y, DOCS, BENCH-PII, BENCH-PERF; DEC-2026-10-29-02, -03, -04
- **Scope:** Rows equal once an id column is ignored appear as a review item. Name pairs (start/end, created/updated, min/max) become scored consistency checks that can be turned off. Rules tab with recommender, editor, scored checks, a versioned rules file and emitters. History tab with trend and drift. Offline reference lists give Accuracy. HTML report and a message for the data supplier. Help text rewritten for the new page. Axe checks on every Quality tab in both themes (two contrast bugs fixed). A labelled PII benchmark in `npm test` (it found, and this change fixes, version strings read as IP addresses and `1950-2200` ranges read as phone numbers; numeric phone and card columns are now scanned). `npm run bench:dq` in the gate.
- **Also in this change:** Fitness profiles (src/data/fitness.ts; a picker in Score & weights; Sharing starts exports on Mask) and a headless check (`npm run check -- data.csv --rules=rules.json --min-score=80 --exceptions=out.csv`, scripts/lib/check.ts) with a parity test.
- **Explicit non-goals:** Screenshot baselines; saving optional marks or rules across browser restarts; "sharing" raising sensitive flags to review; leakage/constant-column checks for the machine-learning profile; user-overridable semantic types.
- **Files / components changed:** src/data/{near-duplicates,rules,history,reference}.ts, reference/*, pair-checks.ts, dq-report.ts, sensitivity.ts, text-profile.ts, semantic-type.ts; src/ui/{rules-panel,history-panel}.ts, app.ts, quality-page.ts, quality-layout.ts; bench/dq.ts; tests.
- **Date:** 2026-10-29

### CHG-2026-10-29-08 — Review spellings one by one

- **Status:** Verified (unit tests, browser test, screenshot); owner has not tried it
- **Problem addressed:** "Standardise" applied the most common spelling everywhere, with no way to approve groups individually or to pick a different standard when the most common one is the wrong one.
- **Scope:** Spelling issue cards keep the one-click fix and gain "Review one by one…". The dialog lists each group of spellings with counts. The most common is preselected; click any spelling to make it the standard, use Swap on a pair, or type your own. Untick a group to leave it alone; find a spelling; approve or skip all; reset to most common. Optional "also treat placeholders as empty". Applies as one undoable Recipe step and shows under Fixed this session. Ties between equally common spellings now prefer Title Case or lower case over capitals.
- **Files / components changed:** src/data/standardise-review.ts, src/data/variants.ts (all groups, capped at 300), src/data/dq-issues.ts, src/ui/standardise-review-dialog.ts, quality-layout.ts, quality-page.ts, app.ts (fix steps now applied by `applyFixStep`)
- **Explicit non-goals:** The same review for fuzzy matches (Melb. vs Melbourne), which have their own merge panel; remembering a chosen standard across loads.
- **Date:** 2026-10-29

### CHG-2026-10-29-09 — Explicit options in the spelling review; readable column cards

- **Status:** Verified (browser tests incl. axe and the 11px text rule, screenshots in both themes); owner has not tried it
- **Scope:** The spelling review now lists each group as numbered options, each showing exactly what changes and what it becomes ("Option 2: Perth 60, PERTH 60 → perth · 120 cells"). The most frequent spelling is Option 1, highlighted, labelled "Suggested · most frequent" and ticked. Ticking another option moves the choice (one option per group); unticking all leaves the group alone; a last option takes your own typed standard. Swap is no longer a separate control, since Option 2 of a pair is the swap. Column cards in the Data Quality strip no longer clip: the fixed 92px height is gone, the score sits beside the name, text is 12 to 13px and chips wrap.
- **Files / components changed:** src/ui/standardise-review-dialog.ts, quality-layout.ts, src/styles.css, test/e2e/quality-layout.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-29-10 — Time-series charts: honest gaps, calendar axis, one legend, calendar options

- **Status:** Verified (unit tests, 2 browser tests, before/after screenshots); owner has not tried it
- **Related issue / decision:** TODO "time-series chart review" against charting_aggregation_ux_spec.md section 6
- **Audit finding:** The engine already supported grains, financial year, week start, time zone and fill policy; the chart card exposed almost none of it and drew several things wrongly.
- **Fixed:**
  1. A missing stretch of time was drawn as a drop to 0 for averages (a false "0 points"). Empty periods are now gaps: the line breaks, the empty period is shaded and the chart says "N periods have no data" (spec 6.4). A new "Missing periods" control: Automatic (zero for sums and counts, gap otherwise), Show gaps, Count as zero, Carry last value.
  2. Split-by charts closed up over missing periods and spaced buckets by index. They now keep a continuous time axis.
  3. A split chart showed two legends with different colours. There is one now, under the chart, with the colours the lines use; click a name to hide or show that line.
  4. X-axis ticks were three raw dates or arbitrary bucket labels. They now sit on calendar boundaries (years, quarters, months, weeks).
  5. Headline said "mean(points) by order_date (week) · 100 groups"; it now says "Mean of points per week · 100 weeks".
  6. "Time resolution: Auto" now says what it chose ("Auto (week)") and hour and minute are hidden for date-only columns.
  7. Calendar options (spec 6.3): "Week starts" (Monday or Sunday) at a weekly grain and "Financial year starts in" at quarter or year grain. All three new settings save in the chart spec.
- **Engine:** ViewDef.showGaps keeps empty periods as missing values (test/aggregate-gaps.test.ts).
- **Explicit non-goals:** 15- and 30-minute grains, time-zone conversion (dates are used as stored; the Time resolution tooltip says so), interpolation, daylight-saving handling, a trend overlay.
- **Files / components changed:** src/data/aggregate.ts, src/ui/chart-card.ts, chart-utils.ts, chart-spec.ts, test/calendar-ticks.test.ts, test/aggregate-gaps.test.ts, test/e2e/time-series.spec.ts
- **Date:** 2026-10-29

### CHG-2026-10-30-01 — Any time-bucket width; XLSX export removed

- **Status:** Verified (unit tests, 2 browser tests); owner has not tried it
- **Problem addressed:** Time series could only bucket by one second, minute, hour, day, week, month, quarter or year. "Every 15 minutes", "every 2 weeks" or "every 10 days" were impossible, and a day of timestamped readings defaulted to hourly buckets.
- **Scope:** A new **Every N** box appears beside Time resolution once a unit is chosen: 15 + Minute, 2 + Week, 10 + Day, 3 + Month, 2 + Quarter all work, with any whole number. Fixed units (second to day) align from the epoch, weeks to the chosen weekday, months/quarters/years to the calendar or financial year. Missing-period filling, the axis, the headline ("Mean of points per 15 minutes"), the saved chart spec and the pandas/Polars code (`15min`, `2W`, `15m`) all follow the width. Auto now picks a round step for short spans (a morning of readings is minutes, a day is half-hours) instead of a single hour bucket; date-only columns get days. "Second" is now offered.
- **Also fixed:** The generated pandas/Polars code for a minute or second grain fell back to monthly.
- **Removed:** XLSX export (and its test, bench entry and docs). It is a poor interchange format. Reading Excel files on import is unchanged.
- **Decision recorded:** Time-zone conversion is out of scope.
- **Files / components changed:** src/data/aggregate.ts (`TimeOptions.every`, `timeBucket`, next-bucket stepping), src/ui/chart-card.ts, chart-utils.ts, chart-spec.ts, src/data/recipe.ts, recipe-polars.ts, src/ui/export-formats.ts, test/time-step.test.ts, test/e2e/time-series.spec.ts, test/export-*.test.ts, bench/groups-export.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-02 — Shift+drag brush on charts

- **Status:** Verified (4 browser tests on scatter, histogram, count time series; 1 on a measure time series); owner has not tried it
- **Problem addressed:** Only the map could be drag-selected. On every other chart you could click one bar or bin, but not "this region" or "this period".
- **Scope:** Hold Shift and drag on a scatter, density, bubble, histogram or time series. Scatter-style charts filter both columns to the rectangle; histograms and time series filter their own column over the dragged span. A time series that plots a measure (with or without Split by) snaps to whole periods, so a weekly chart selects Monday to Sunday. Whole-number columns round outward so edge rows stay in. The result is an ordinary range filter chip with a status line ("Chart selection: x 12 to 18, y 4 to 9"). Drags under 6 px are ignored; plain drag still pans and the wheel still zooms. Charts that support it say "Shift+drag to filter" in the note.
- **Explicit non-goals:** Lasso, a brush that survives as a movable selection, brushing category bars/box/heatmap (click already filters those), cross-chart highlighting.
- **Files / components changed:** src/ui/chart-card.ts (brush space recorded by each draw routine, overlay, `finishBrush`), chart-panel.ts, app.ts (`filterToBrush`), help-content.ts, test/e2e/chart-brush.spec.ts, test/e2e/time-series.spec.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-03 — Linked highlight between chart cards

- **Status:** Verified (5 unit tests, 1 browser test, screenshot); owner has not tried it
- **Problem addressed:** Charts in the grid were islands. Hovering a bar in one gave no sign of where that slice sits in the others.
- **Scope:** Hovering a mark (bar, bin, heatmap cell, term, aggregated period) in one card outlines the marks that show the same slice in every other card plotting the same column: the same category, or a date/number range that overlaps (a month lights the weeks inside it, neighbouring bins that only share an edge do not). It is client-side only: the card sends its hovered click-actions to the panel, the panel passes them to the other cards, and each card outlines matching hit regions on its next paint. No worker request, nothing filtered or stored; the pointer leaving clears it. A card with nothing matching does not repaint at all.
- **Explicit non-goals / known limit:** Charts of different columns do not link (hovering East in a region chart does not mark East points in a scatter). That needs each card to re-run its query for the hovered slice through the existing per-card scope; logged as the next step in next_steps.md.
- **Files / components changed:** src/ui/chart-card.ts (`actionsOverlap`, `setLinkedHighlight`, `drawLinkedOverlay`), chart-panel.ts, help-content.ts, test/linked-highlight.test.ts, test/e2e/chart-brush.spec.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-04 — Linked highlight across columns

- **Status:** Verified (5 unit tests, 1 browser test, screenshot); owner has not tried it
- **Problem addressed:** Linked highlight only linked charts over the same column. Hovering East in a region chart told you nothing about East in the time series or the sales histogram.
- **Scope:** Hover a mark in one chart and every count plot, histogram, count time series and aggregated bar/line over a different column draws the hovered slice's share of each mark in orange, with a "Highlighted: East" caption. A new worker request (`getSliceBreakdown`) reduces the rows in the slice into each mark's bar, bin or period: a row count, or the sum/mean/min/max of the chart's own measure. It runs under the chart's own scope (table filters, chart filter, exclusions) and is debounced 70 ms with stale answers dropped, so sweeping across bars never queues work. Charts with calculations (percent of rows, running totals), split-by or animation do not overlay.
- **Engine:** `ChartExclusion` gains `invert` (leave out the rows that do NOT match), which turns any existing per-chart exclusion path into "keep only this slice". Unknown labels keep nothing; rows missing the sliced value are not in a range slice. Adjacent histogram bins sharing an edge never double count.
- **Explicit non-goals / known limits:** Scatter, density, bubble, box and heatmap charts do not overlay yet (they need a per-point or per-cell version of the same request); slices of text columns only link by the "contains" action.
- **Files / components changed:** src/data/slice-breakdown.ts, chart-exclusions.ts, src/worker/protocol.ts, search.worker.ts, src/ui/worker-client.ts, chart-card.ts, chart-panel.ts, app.ts, help-content.ts, test/slice-breakdown.test.ts, test/e2e/chart-brush.spec.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-05 — Linked highlight on scatter

- **Status:** Verified (1 browser test); owner has not tried it
- **Problem addressed:** Hovering a slice in one chart (a region, a histogram bin) lit up bars and lines elsewhere, but a scatter over other columns stayed silent.
- **Scope:** A scatter card now answers a hovered slice by asking for the slice's own points: its normal sample request with the slice kept (an inverted exclusion) under the card's own scope, unclipped, after the usual 70 ms pause with stale answers dropped. The points are drawn in orange over the plot, clipped to the axes the card already shows (so zoom and pan still line up), with the "Highlighted: East" caption. No new worker message and no change to the card's own sample.
- **Explicit non-goals / known limits:** Density, bubble, box and heatmap charts and split-by series still do not overlay. A slice of more than 20,000 rows is a sample, like the scatter itself.
- **Files / components changed:** src/ui/chart-card.ts (`scheduleSlicePoints`, `drawSlicePoints`, `SeriesRequestInput.chartExclude`), help-content.ts, test/e2e/chart-brush.spec.ts
- **Date:** 2026-10-30

### CHG-2026-10-30-06 — Time Series page in the app

- **Status:** Verified (unit, e2e and bench); owner has used the prototype, not yet the in-app page
- **Related issue / decision:** next_steps.md "BIG TODO: a dedicated Time Series page"; owner chose the full port before the Map page
- **Problem addressed:** The Time Series deep dive lived only as a standalone prototype with its own CSV loader and styles, so it could not see the loaded, cleaned and filtered table.
- **Scope:** A new "Time Series" tab (keyboard 8, command `forecast`). The prototype's engine is now typed modules in src/data/timeseries (base, aggregate, decompose, models, patterns, engine) run by the worker through a `getTimeSeries` request on the current rows, with each stage cached so a drag reruns only the models. The page (src/ui/timeseries-page.ts, -findings.ts, -patterns.ts) draws the snapshots in the app's design tokens: Explore, Decompose, Forecast and Patterns, the trend-shift overlay, history-limited forecast length, seasonal gap fill, Export CSV. Clicking a period filters the Table to it; date range filter chips now read as dates instead of milliseconds.
- **Explicit non-goals:** Impact/what-if (dropped by the owner), the Chart time series card stays until its retirement step, no time zones.
- **Acceptance criteria:** loads any table with a date column, respects filters, all four modes draw, forecast length capped by the testable history, clicking a period filters the Table.
- **Files / components changed:** src/data/timeseries/*, src/ui/timeseries-page.ts, timeseries-findings.ts, timeseries-patterns.ts, src/worker/protocol.ts, search.worker.ts, src/ui/worker-client.ts, app.ts (tab, host, filter chip dates), view-tabs.ts, command-bar.ts, help-content.ts, styles.css, bench/timeseries.ts, package.json (gate)
- **Tests run and results:** test/timeseries.test.ts (11) and the full unit suite (1089 pass); test/e2e/time-series-page.spec.ts (3 pass); bench:timeseries all within budget (daily open 53 ms of 110, hourly open 101 ms of 220, hourly horizon drag 52 ms of 110).
- **Manual browser verification:** parking.csv (29k irregular half-hourly rows) in the dev server: Hourly default, daily + weekly season, 1-month forecast, Patterns, click-to-filter.
- **Known limitations:** Phase labels and season names are English only. Very long hourly tables (100k+ periods) open at a coarser grain to stay fast. Python reference check of the decomposition and models is still to do.
- **Decision:** Ship
- **Date:** 2026-10-30

### CHG-2026-10-30-07 — Time Series: close-out (Chart link, levels, totals, timetables, scaled seasons, Python check)

- **Status:** Verified (unit, e2e, bench, gate)
- **Related issue / decision:** next_steps.md "Remaining for the Time Series page" and "Still to do"; owner chose to keep the Chart line card and link it to the page instead of retiring it
- **Problem addressed:** The Chart line card and the Time Series page did not know about each other; levels read at uneven times (parking) had no right aggregate; a total copied onto every group row was summed once per group; business-hours tables counted every night as a gap; seasons that grow with the level sat in the remainder; no reference check of the maths.
- **Scope:**
  - Chart line cards show "Open in Time Series →" (and a ⋯ menu item) that opens the page on the same date column, measure, aggregate, split column and bucket (week, 2 weeks, month…).
  - New aggregate **time-weighted mean**: each reading holds until the next one of its group, at most three usual spacings. The Data finding offers it when buckets hold uneven numbers of readings.
  - **Repeated totals**: numeric columns equal on every group's row at the same moment are detected; summing one across groups gets a warning with "Use mean", and such a column is never the default measure.
  - **Structural hours**: hours of the day that (almost) never have rows, on hourly or finer data over a week or more, are not gaps or missing coverage; the Data finding names the open hours.
  - **Scaled seasons**: on positive series, a season fitted as a share of the trend replaces the fixed-amount one when it leaves at least 15% less unexplained. Written back as amounts so trend + season + remainder still equals the series. Theta deseasonalises the same way.
  - **Python reference** (prototypes/time-series/reference): trend and seasonal profile match statsmodels' centred moving average and a per-phase median to 1e-13 on five public series; forecast errors are in line with statsmodels Holt-Winters and Theta (results.txt).
- **Explicit non-goals:** retiring the Chart line card (owner: keep it, link through); multiplicative Holt-Winters (statsmodels' beats ours on airline passengers, 36.5 vs 50.7 MAE; logged).
- **Files / components changed:** src/data/timeseries/base.ts, aggregate.ts, decompose.ts, models.ts, engine.ts; src/ui/timeseries-page.ts (open preset), timeseries-findings.ts, chart-card.ts, chart-panel.ts, app.ts, help-content.ts, styles.css; bench/timeseries.ts; test/timeseries.test.ts (+4), test/e2e/time-series.spec.ts (+1); prototypes/time-series/reference/*
- **Tests run and results:** unit 1093 pass; e2e 68 pass; bench:timeseries within budget (hourly switch to time-weighted mean 80 ms of 220); npm run gate exit 0.
- **Manual verification:** engine on parking.csv: total_occupied and total_vacant flagged as repeated, default measure occupied, time-weighted mean offered under sum and mean.
- **Decision:** Ship
- **Date:** 2026-10-30

### CHG-2026-10-30-08 — Map page: background pictures, markers, world cities

- **Status:** Verified (unit, e2e, bench, gate)
- **Related issue / decision:** next_steps.md "Owner requests: 1. Maps get their own page"; offline base maps (owner, 2026-10-30); owner asked for up to 100 markers (editable table, paste, CSV, symbols incl. SVG, colour) and a bundled list of world cities (name, lat, lon only)
- **Problem addressed:** The map lived only as a Chart card: no room, no way to put a real map underneath without the network, no way to add a few points of your own.
- **Scope:**
  - New **Map** tab (keyboard 9, command `map`). It hosts the Chart view's map card at full width through `ChartsPanel.createDetachedCard`, so points, heat grid, boundary files, zoom and the area brush all carry over and follow filters. Chart map cards get "Open in Map →"; the card stays in Chart (as with the line card).
  - **Background picture** (src/data/map-background.ts): local JPG/PNG/WebP via `createImageBitmap` (no CSP change), downscaled past 8k px. Placed as the whole world, from a world file (degrees → plate carrée, metres → Web Mercator), or typed edges with a live check. Mercator pictures are drawn in latitude strips under the lon/lat plot. Opacity, greyscale copy, coastline outline on top, credit line drawn on the map (and in PNG exports).
  - **Markers** (src/data/map-markers.ts, src/ui/map-markers-panel.ts, map-symbols.ts): up to 100 in an editable table; paste cells from a spreadsheet (header by name or none; decimal or DMS), CSV upload/download, find a city, click the map to add. Shapes: ring, dot, cross, plus, square, triangle, diamond, star, pin, or an uploaded SVG of which only shape geometry is read (scripts, styles, links and images in the file are dropped). Colour per marker. Unreadable coordinates are marked and left off the map.
  - **World cities** (src/data/cities.ts, tools/vendor-cities.mjs → src/data/reference/world-cities.ts): Natural Earth populated places, public domain, 7,342 names with coordinates to 0.01°, largest first; 146 KB / 74 KB gzip as a lazy chunk, ~0.4 MB decoded. A "Cities" layer labels the largest in view without overlaps; a list of city names pasted or uploaded becomes markers.
  - Picture and markers are kept per dataset in IndexedDB (`turbofuzz.map`), never uploaded.
  - Fix: `detectGeoPair` skipped decimal coordinate columns unique on every row (taken for row ids); the id rule now applies to whole-number columns only.
- **Explicit non-goals:** network tiles (no-go stands); moving saved map cards out of Chart; label collision between cities and markers.
- **Files / components changed:** src/data/map-background.ts, map-markers.ts, cities.ts, reference/world-cities.ts, geo.ts; src/ui/map-page.ts, map-markers-panel.ts, map-symbols.ts, map-cities.ts, chart-card.ts (background, markers, overlay, click-to-pick, keepEmptyMap, Open in Map), chart-panel.ts (detached cards), app.ts, view-tabs.ts, command-bar.ts, help-content.ts (Map topic with "Get an offline map"), styles.css; tools/vendor-cities.mjs; bench/map.ts, package.json (gate); test/map-page.test.ts, test/geo.test.ts, test/view-tabs.test.ts, test/e2e/map-page.spec.ts
- **Tests run and results:** unit 1104 pass; e2e 74 pass (6 new Map specs, and the existing no-network sweep now opens the Map tab too); bench:map: decode cities 2.8 ms (budget 40), search keystroke 0.25 ms (4), paste 100 city names 0.5 ms (15), mercator strips 0.03 ms (0.5).
- **Manual verification:** screenshot of 300 sites with Cities on and four markers (star, cross, pin, triangle) over Europe.
- **Decision:** Ship
- **Date:** 2026-10-30

### CHG-2026-10-30-09 — Date formats when converting to date / date & time

- **Status:** Verified (unit, e2e, gate)
- **Related issue / decision:** owner, loading monthly-sunspots.csv: "1749-01" stays text (fine), but converting offered only day-first or month-first; wants the common formats listed plus a custom one, for dates and date-times.
- **Problem addressed:** Year-month, year-only, quarter, compact (YYYYMMDD), month-name and custom date-time layouts could not be converted.
- **Scope:** src/parse/date-format.ts reads explicit formats (YYYY, YY, Q, MMMM/MMM, MM/M, DD/D, ddd(d), HH/H, hh/h + A, mm, ss, S..SSS, Z, [literal]; strftime %Y-%m also accepted). A format rides on the existing date order as "fmt:<pattern>", so the cast, Clean, data-quality and worker paths read it unchanged. Missing parts start at 1 (1749-01 → 1749-01-01). After converting, the column reads its rewritten ISO values normally again. One picker (src/ui/date-format-picker.ts) in the change-type dialog and Clean's convert step: automatic day/month first, the common formats that fit a sample of the column first (with how many they read), the rest, and Custom with live checking and a token guide; it starts on the best fit when automatic reading would miss values. New worker request getColumnSample. Recipes: pandas gets format="%Y-%m"; Polars gets a strptime format with "|01" day/month pieces appended when the format has none; quarter formats are flagged for review.
- **Files / components changed:** src/parse/date-format.ts (new), dates.ts; src/ui/date-format-picker.ts (new), cast-dialog.ts, clean-panel.ts, app.ts, help-content.ts, styles.css, worker-client.ts; src/worker/protocol.ts, search.worker.ts; src/data/recipe.ts, recipe-polars.ts, clean-ops.ts, dq-issues.ts; test/date-format.test.ts (7), test/e2e/date-format.spec.ts (3)
- **Tests run and results:** unit 1111 pass; e2e 77 pass; gate exit 0.
- **Decision:** Ship
- **Date:** 2026-10-30

### CHG-2026-10-30-10 — Forgiving search in filters and pickers

- **Status:** Verified (unit, e2e, bench, gate)
- **Related issue / decision:** owner: filters on the left (and others) match exact substrings only; wants to start typing and have it almost know what is meant.
- **Problem addressed:** the sidebar column search, a pick-list's "Find value…", the Add filter column list and the Pivot View value search were `includes()` only, and a free-text filter had no suggestions.
- **Scope:** src/search/fuzzy-match.ts: exact, prefix, word start, contains, every word, letters in order ("ctry" → country, "ordid" → order_id) and one slipped/missing/extra/swapped letter ("lodnon" → London; two for long queries); case, accents and separators ignored. Used in all four pickers, best match first (clearing restores the original order). The sidebar search opens the card when one column is left. Free-text filters (sidebar and header popover) show the column's own values that best fit, with counts; arrow keys and Enter or a click filter to that exact value. New worker request getValueSuggestions (distinct values and match keys built once per column, up to 200k distinct; cheap tiers first, near-miss tier only when too few fit).
- **Explicit non-goals:** the command bar's column lookup (its words are verbs and columns, so guessing there could misfire); changing the filter's Contains default.
- **Files / components changed:** src/search/fuzzy-match.ts (new), src/ui/filters.ts, table.ts, app.ts, views-panel.ts, worker-client.ts, src/worker/protocol.ts, search.worker.ts, styles.css; bench/fuzzy-suggest.ts, package.json (gate); test/fuzzy-match.test.ts, test/e2e/fuzzy-filters.spec.ts
- **Tests run and results:** unit and e2e pass; bench:fuzzy-suggest per keystroke: a few letters 10 ms and a misspelling 21 ms over 100k distinct values (budget 40), 10 and 40 ms over 200k (budget 80).
- **Decision:** Ship
- **Date:** 2026-10-30

