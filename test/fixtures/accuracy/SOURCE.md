# Accuracy gate fixture

`series.json` holds 61 series (13,616 points) taken from 20 datasets of the Monash Time
Series Forecasting Archive (https://forecastingdata.org/), chosen by an even stride and,
for long series, cut to their latest points. `baseline.json` holds the mean MASE of each
dataset for the current engine. Both are used only by `npm run bench:accuracy`, never
shipped in the app.

Licence: every dataset's Zenodo record is CC BY 4.0. Cite:
Godahewa, R., Bergmeir, C., Webb, G. I., Hyndman, R. J., Montero-Manso, P. (2021).
Monash Time Series Forecasting Archive. NeurIPS 2021 Datasets and Benchmarks Track.

Original sources of the datasets: M1 and M3 competitions (Makridakis et al.), tourism
competition (Athanasopoulos et al., 2011), hospital and car parts (Hyndman, 2015), FRED-MD
(McCracken and Ng, 2016), NN5 (Ben Taieb et al.), COVID-19 deaths (Johns Hopkins
University), M4 competition, Melbourne pedestrian counts (City of Melbourne), vehicle
trips (fivethirtyeight), electricity and traffic (UCI, Caltrans).

Rebuild with `npx tsx tools/ts-eval/make-fixture.ts <folder of .tsf files>` (see
tools/ts-eval/README.md), then `npm run bench:accuracy -- --update` and say why in the
changelog.
