/**
 * Writes docs/time-series-sources.md from src/data/timeseries/references.ts, so the credits
 * in the repository and in the app's "Sources and credits" page are one list.
 *
 *   npx tsx tools/ts-eval/make-sources-doc.ts
 */

import { writeFileSync } from "node:fs";
import { REFERENCES, REFERENCE_ORDER } from "../../src/data/timeseries/references.js";

const lines = [
  "# Time Series: sources and credits",
  "",
  "Generated from `src/data/timeseries/references.ts` by `tools/ts-eval/make-sources-doc.ts`; edit that file, not this one. The same list is the app's *Sources and credits* page (Forecast tab, *How the models work*).",
  "",
  "Everything was reimplemented from the published methods. No code was copied from other projects.",
  "",
  "- **R `forecast` package** (GPL-3, Hyndman et al.): used as a behavioural reference through its published results and documentation only.",
  "- **statsmodels** (BSD-3-Clause): development only; its STL and MSTL are the reference our implementation is checked against (`test/timeseries-stl.test.ts`, `tools/ts-eval/make-stl-reference.py`).",
  "- **statsforecast** (Apache-2.0, Nixtla): installed in the development virtual environment for a later parity check of our ETS; not used by the app.",
  "- **Monash Time Series Forecasting Archive** (CC BY 4.0, Godahewa et al.): benchmark data for `tools/ts-eval/monash.ts` and the 141-series accuracy gate fixture (`test/fixtures/accuracy`, attribution in its `SOURCE.md`); not part of the app.",
  "- **Forecasting: Principles and Practice** (Hyndman and Athanasopoulos, https://otexts.com/fpp3/): the guide this page follows; cited, not reproduced.",
  "",
  "## References",
  "",
];
for (const id of REFERENCE_ORDER) {
  const r = REFERENCES[id]!;
  lines.push(`- **${r.short}.** ${r.full}${r.url ? ` ${r.url}` : ""}`, `  Used for: ${r.used}`);
}
writeFileSync("docs/time-series-sources.md", lines.join("\n") + "\n");
console.log(`docs/time-series-sources.md: ${REFERENCE_ORDER.length} references`);
