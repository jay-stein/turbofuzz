# Time Series evaluation on real series

Runs the Time Series engine (all models, the lockbox fold, the Deep check and the
Trend flexibility curve) on a folder of CSVs. It reports, per series:
- the Auto pick and its rank on the unseen lockbox fold;
- Diebold–Mariano verdicts against each rival;
- what three "prefer a simpler model" rules would have picked;
- the best trend flexibility;
- residual tests and band coverage.

    npx tsx tools/ts-eval/run.ts <folder>

The data is not kept in the repo. Download into one folder:

| File | Source |
|---|---|
| `airline-passengers.csv`, `monthly-car-sales.csv`, `shampoo.csv`, `monthly-sunspots.csv`, `daily-min-temperatures.csv`, `daily-total-female-births.csv` | https://github.com/jbrownlee/Datasets (raw files) |
| `parking.csv` | https://github.com/jay-stein/chaddy-parking-scraper/blob/master/data/parking.csv (Chadstone car parks; `car_park` column) |
| `gym_stats.csv` | the owner's gym crowdedness file (10-minute counts, 2015-2017) |

Findings of the first run (2026-10-31) are in `next_steps.md`, "Evaluation on 13 real series".

## Benchmark against the Monash archive and R's forecast package

`monash.ts` follows the protocol of the Monash Time Series Forecasting Archive
(https://forecastingdata.org/; Godahewa et al., 2021, NeurIPS Datasets & Benchmarks):
- train on each series minus its last *h* points and forecast *h*;
- score MASE against the training data's seasonal naive (seasonality 12 monthly, 4 quarterly, 7 daily, 24 hourly, 48 half-hourly, 1 otherwise);
- average over series and print beside the archive's published results for SES, Theta, TBATS, ETS and ARIMA, which were made with Rob Hyndman's R `forecast` package.

    npx tsx tools/ts-eval/monash.ts <folder of .tsf files> [max series per dataset, default 300] [file-name filter]

Download the `.tsf` zips from each dataset's Zenodo record (linked from forecastingdata.org) into one folder and unzip them. Missing values are carried forward, as in the archive's "without missing values" versions. Series too short for our backtest are skipped and counted, so a dataset's mean can be over a longer-series subset; the output says how many ran.

## Accuracy gate (`npm run bench:accuracy`, part of `npm run gate`)

`bench/accuracy.ts` runs the fixed series in `test/fixtures/accuracy` (see its SOURCE.md) on the same protocol in about a second and compares each dataset's mean MASE with `baseline.json`. The Auto forecast and the ETS + Theta + damped combination may not get more than 2% worse on any dataset. A change that is meant to move the numbers is accepted with `npm run bench:accuracy -- --update`, and the changelog says why. `make-fixture.ts` rebuilds the fixture from the downloaded `.tsf` files. `lib.ts` holds the protocol both scripts share.

