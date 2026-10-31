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
