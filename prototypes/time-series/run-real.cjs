const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("C:/Users/mrjay/python/Projects/table-fuzzy-search/node_modules/playwright");
const DATA_DIR = process.env.TS_DATA || path.join(__dirname, "..", "ts-data");
const OUT = process.env.TS_OUT || path.join(__dirname, "real");
fs.mkdirSync(OUT, { recursive: true });

// Wikipedia pageviews arrive as JSON; save them as the CSV a person would export.
const wjPath = path.join(DATA_DIR, "christmas.json");
const wj = fs.existsSync(wjPath) ? JSON.parse(fs.readFileSync(wjPath, "utf8")) : { items: [] };
if (wj.items.length) fs.writeFileSync(path.join(DATA_DIR, "christmas-pageviews.csv"), "date,views\n" + wj.items.map((it) => `${it.timestamp.slice(0, 4)}-${it.timestamp.slice(4, 6)}-${it.timestamp.slice(6, 8)},${it.views}`).join("\n"));

const files = process.argv.slice(2).length ? process.argv.slice(2) : [
  "airline-passengers.csv", "daily-min-temperatures.csv", "monthly-sunspots.csv", "daily-total-female-births.csv", "shampoo.csv",
  "co2-mlo.csv", "global-temp.csv", "apple.csv", "quakes.csv", "christmas-pageviews.csv", "fremont-hourly.csv",
  // run 2: sub-daily, irregular, split date parts, semicolon export
  "parking.csv", "pollution-beijing.csv", "airquality.csv", "ETTh1.csv", "ETTm1.csv",
];
const url = pathToFileURL(path.join(__dirname, "time-series-workbench.html")).href;

(async () => {
  const b = await chromium.launch();
  for (const f of files) {
    const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await p.goto(url);
    await p.waitForTimeout(500);
    const t0 = Date.now();
    await p.setInputFiles("#fileIn", path.join(DATA_DIR, f));
    await p.waitForFunction(() => !document.getElementById("toast").hidden, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(600);
    const loadMs = Date.now() - t0;
    const toast = await p.textContent("#toast");
    const r = { file: f, loadMs, toast: toast.replace(/\s+/g, " ").replace("Undo", "") };
    if (/Could not read/.test(toast)) { console.log(JSON.stringify(r)); await p.close(); continue; }
    // Every file at its default grain; files with rows more than once a day again at
    // their finest grain, where the daily cycle lives.
    const pass = async (tag) => {
      await p.click("#tab-explore");
      await p.waitForTimeout(300);
      const bad = new Set();
      for (const mode of ["explore", "decompose", "forecast", "patterns"]) {
        await p.click(`#tab-${mode}`);
        await p.waitForTimeout(700);
        const text = await p.evaluate(() => document.querySelector(".app").innerText);
        for (const w of ["NaN", "Infinity", "undefined", "null", "[object"]) if (text.includes(w)) bad.add(`${mode}:${w}`);
        if (mode !== "decompose") await p.screenshot({ path: path.join(OUT, `${f.replace(/\.csv$/, "")}${tag}-${mode}.png`) });
      }
      Object.assign(r, await p.evaluate(() => ({
        sentence: document.getElementById("sentence").textContent,
        grain: cfg.grain, n: A.n, modelN: A.modelN, cadence: DATA.cadence, groups: GROUPS.length, eventLike: DATA.eventLike,
        season: DEC.dec ? periodName(DEC.dec.m) + " " + DEC.dec.fs.toFixed(2) : "none", anomalies: DEC.anomalyCount,
        forecast: MOD.error ? MOD.error : `${MOD.best} ` + Object.entries(MOD.models).map(([k, v]) => `${k}:${v.ratio.toFixed(2)}`).join(" "),
        range: FUT ? `${compact(Math.min(...FUT[selectedModel()].lo80))}..${compact(Math.max(...FUT[selectedModel()].hi80))} hist ${compact(Math.min(...A.yModel))}..${compact(Math.max(...A.yModel))}` : "",
        patterns: [...document.querySelectorAll("#patFacts div")].map((e) => e.textContent).join(" | "),
        month: (() => { const H = (A.g.hPresets.find(([l]) => /month/.test(l)) || [])[1]; if (!H || H > A.g.maxH) return "n/a"; const M = runModels(null, H); return M.error || `H=${H} best ${M.best} ` + Object.entries(M.models).map(([k, v]) => `${k}:${v.ratio.toFixed(2)}`).join(" "); })(),
        timing: Object.entries(timing).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" · ") + " ms",
        findings: [...document.querySelectorAll(".insight")].map((e) => e.querySelector(".kick").textContent + ": " + e.querySelector("p").textContent).join(" || "),
      })));
      r.bad = [...bad];
      r.errors = errs.splice(0);
      console.log(JSON.stringify(r, null, 1));
    };
    await pass("");
    const fine = await p.evaluate(() => (DATA.subDay ? GRAIN_ORDER.find((id) => GRAINS[id].unit === "min" && !tooFine(id)) : null));
    if (fine && fine !== (await p.evaluate(() => cfg.grain))) {
      await p.evaluate((id) => choose("grain", id), fine);
      await p.waitForTimeout(800);
      r.file = `${f} @${fine}`;
      await pass(`-${fine}`);
    }
    await p.close();
  }
  await b.close();
})();
