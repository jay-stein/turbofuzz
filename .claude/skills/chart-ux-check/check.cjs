#!/usr/bin/env node
// Chart UX check: drives the Charts page the way a person does, from picking fields to changing
// the finished chart, over several shapes of data, and reports what broke. One browser, one pass.
//
//   node .claude/skills/chart-ux-check/check.cjs [--only name] [--out dir] [--url http://127.0.0.1:4173]
//
// Exit code 0 when nothing FAILs (WARNs are allowed), 1 on any FAIL, 2 when the app is not running.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
};
const URL = arg("url", process.env.CHART_UX_URL ?? "http://127.0.0.1:4173");
const OUT = path.resolve(arg("out", "test-results/chart-ux"));
const ONLY = arg("only", "");
const T0 = Date.now();

// ---------- data shapes (deterministic, small enough to load in a blink) ----------
const day = (d) => new Date(Date.UTC(2023, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
const DATASETS = [
  {
    name: "sales-over-time",
    about: "dates, two categories, two measures",
    csv: () => {
      const rows = ["date,region,type,sales,price"];
      for (let d = 0; d < 720; d += 6) for (let r = 0; r < 12; r++) rows.push(`${day(d)},Region ${r},${r % 2 ? "organic" : "conventional"},${(20 - r) * 100 + (d % 50)},${(1 + (r % 5) * 0.2 + (d % 11) * 0.01).toFixed(2)}`);
      return rows;
    },
    picks: [["date", "sales"], ["date", "sales", "type"], ["region", "type", "sales"], ["sales", "price", "type"], ["type", "sales"], ["date", "type"]],
    dateGrouping: "date",
  },
  {
    name: "categories-only",
    about: "no numbers, no dates: counts only",
    csv: () => {
      const rows = ["colour,size,shape"];
      for (let i = 0; i < 600; i++) rows.push(`${["red", "green", "blue", "amber"][i % 4]},${["S", "M", "L"][i % 3]},${["round", "square"][(i >> 2) % 2]}`);
      return rows;
    },
    picks: [["colour"], ["colour", "size"]],
  },
  {
    name: "wide",
    about: "30 columns: grouping and the field search matter",
    csv: () => {
      const head = ["order_date", "customer_id", "segment", "country", "channel"];
      for (let k = 0; k < 25; k++) head.push(`metric_${String(k).padStart(2, "0")}`);
      const rows = [head.join(",")];
      for (let i = 0; i < 400; i++) rows.push([day(i % 300), `C${1000 + i}`, ["Retail", "Trade", "Online"][i % 3], ["UK", "FR", "DE", "ES"][i % 4], ["web", "store"][i % 2], ...Array.from({ length: 25 }, (_, k) => ((i * (k + 3)) % 97) + k)].join(","));
      return rows;
    },
    picks: [["order_date", "metric_07"], ["segment", "metric_03", "country"]],
    search: { typo: "metrc_07", expect: "metric_07" },
    dateGrouping: "order_date",
  },
  {
    name: "messy-datetimes",
    about: "irregular timestamps: periods and repeating parts (weekday, hour)",
    csv: () => {
      const rows = ["when,shop,sales"];
      for (let i = 0; i < 2500; i++) {
        const t = Date.UTC(2023, 0, 1) + ((i * 7919) % (730 * 24)) * 3_600_000 + (i % 59) * 60_000;
        rows.push(`${new Date(t).toISOString().slice(0, 16).replace("T", " ")},${["North", "South"][i % 2]},${100 + (i % 13)}`);
      }
      return rows;
    },
    picks: [["when", "sales"], ["when", "sales", "shop"]],
    dateGrouping: "when",
    parts: [["part:dow", 7], ["part:hour", 24], ["part:month", 12]],
  },
  {
    name: "one-column",
    about: "a single measure",
    csv: () => ["amount", ...Array.from({ length: 300 }, (_, i) => String((i * 37) % 211))],
    picks: [["amount"]],
  },
];

// ---------- findings ----------
const findings = [];
const add = (level, dataset, step, detail) => findings.push({ level, dataset, step, detail });

// ---------- page helpers ----------
async function load(page, set) {
  await page.goto(URL);
  await page.locator('input[type="file"]').setInputFiles({ name: `${set.name}.csv`, mimeType: "text/csv", buffer: Buffer.from(set.csv().join("\n")) });
  await page.locator(".nav-row").waitFor({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
}
const openAdd = async (page) => {
  if ((await page.locator(".chart-add-panel:not(.hidden)").count()) === 0) await page.getByRole("button", { name: "+ Add chart" }).click();
  await page.locator(".chart-add-panel:not(.hidden)").waitFor();
};
const fieldButton = (page, name) => page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
const card = (page) => page.locator(".chart-card:not(.hidden)");
/** Fields on the open chart, from the rail: { name: role }. */
const usedFields = (page) =>
  page.locator(".chart-rail-field.used").evaluateAll((nodes) => Object.fromEntries(nodes.map((n) => [n.querySelector(".chart-rail-name")?.textContent ?? "", n.querySelector(".chart-rail-role")?.textContent ?? ""])));
/** What a click on a rail field would do now (its tooltip, filled on focus). */
async function railHint(page, name) {
  const field = page.locator(".chart-rail-field").filter({ has: page.locator(".chart-rail-name", { hasText: new RegExp(`^${name}$`) }) }).first();
  if ((await field.count()) === 0) return "";
  await field.dispatchEvent("focus");
  return (await field.getAttribute("title")) ?? "";
}
/** True when the chart canvas has drawn something: more than a handful of distinct colours. */
const canvasDrawn = (page) =>
  card(page).locator("canvas.chart-canvas").first().evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    if (ctx === null || canvas.width === 0) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size > 6;
  }).catch(() => false);
const noteText = async (page) => ((await card(page).locator(".chart-note").allTextContents())[0] ?? "").trim();
const BAD_NOTE = /no groups|could not|has no measures|nothing to draw|failed/i;

/** Picks fields, clicks a chart type; returns what happened. */
async function makeChart(page, picks, type) {
  await openAdd(page);
  if ((await page.locator(".chart-add-chip").count()) > 0) return { error: "shelf not empty when a new chart starts" };
  for (const name of picks) await fieldButton(page, name).click();
  const tabs = await page.locator(".charts-tab").count();
  await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type", { hasText: type }).click();
  await page.waitForTimeout(400);
  // Read only what is there now: a locator read waits 30s for an element that never comes.
  const messages = await page.locator(".chart-add-message").allTextContents();
  const message = (messages[0] ?? "").trim();
  if (message !== "") {
    if ((await page.locator(".chart-add-clear").count()) > 0) await page.locator(".chart-add-clear").click();
    return { refused: message };
  }
  if ((await page.locator(".charts-tab").count()) <= tabs - 1) return { error: "no chart tab appeared" };
  await card(page).locator(".chart-canvas").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  return { used: await usedFields(page) };
}

async function checkChart(page, set, step, picks) {
  const used = await usedFields(page);
  /** Picked fields left off a chart that had a place for them. */
  const dropped = [];
  for (const name of picks) {
    if (name in used) continue;
    const hint = await railHint(page, name);
    // A field with an empty place on this chart that was not put there is the "fields vanish" bug.
    // A place another picked field already fills (one Colour, two categories) is not; nor is a
    // histogram's weighting Value, which nobody expects a second number to take.
    const slot = /Click to use it as the (.+) of this chart/.exec(hint)?.[1];
    const holder = Object.entries(used).find(([, role]) => role === slot)?.[0];
    if (slot !== undefined) dropped.push(name);
    if (slot === undefined) add("INFO", set.name, step, `picked "${name}" has no place on this chart type`);
    else if (holder !== undefined) add("INFO", set.name, step, `picked "${name}" could take the ${slot}, which "${holder}" holds`);
    else if (slot === "Value" && Object.values(used).includes("Values")) add("INFO", set.name, step, `picked "${name}" could weight the histogram (Value)`);
    else add("FAIL", set.name, step, `picked "${name}" was dropped though the chart's ${slot} is free`);
  }
  // A field nobody picked is expected when the picks cannot fill a required slot (a scatter needs
  // two numbers); it is worth a look when it sits on the chart while a picked field does not.
  const extra = Object.keys(used).filter((name) => !picks.includes(name));
  if (extra.length > 0) add(dropped.length > 0 ? "WARN" : "INFO", set.name, step, `chart also uses fields nobody picked: ${extra.join(", ")}${dropped.length > 0 ? ` while ${dropped.join(", ")} is off it` : " (to fill a required slot)"}`);
  if (!(await canvasDrawn(page))) add("FAIL", set.name, step, "the chart canvas is blank");
  const note = await noteText(page);
  if (BAD_NOTE.test(note)) add("FAIL", set.name, step, `chart note: "${note}"`);
  return used;
}

async function checkLayout(page, set, size) {
  await page.setViewportSize(size);
  await page.waitForTimeout(300);
  const plot = await card(page).locator("canvas.chart-canvas").first().boundingBox();
  if (plot === null) return add("FAIL", set.name, `layout ${size.width}x${size.height}`, "no plot on screen");
  if (plot.y + plot.height > size.height + 1) add("WARN", set.name, `layout ${size.width}x${size.height}`, `plot runs ${Math.round(plot.y + plot.height - size.height)}px below the window`);
  if (plot.height < 240) add("WARN", set.name, `layout ${size.width}x${size.height}`, `plot only ${Math.round(plot.height)}px tall`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) add("FAIL", set.name, `layout ${size.width}x${size.height}`, `page scrolls sideways by ${overflow}px`);
}

async function runDataset(browser, set) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(String(err)));
  await load(page, set);
  const columns = set.csv()[0].split(",");

  // 1. Field list: every column once, under a kind heading.
  const listed = await page.locator(".chart-add-field-name").allTextContents();
  for (const name of columns) {
    const count = listed.filter((x) => x === name).length;
    if (count !== 1) add("FAIL", set.name, "field list", `"${name}" is listed ${count} times`);
  }
  if ((await page.locator(".chart-add-field-group-title").count()) === 0) add("FAIL", set.name, "field list", "fields are not grouped by kind");

  // 2. Fuzzy find: a typo finds the field and Enter puts it on the shelf.
  if (set.search !== undefined) {
    const find = page.getByRole("searchbox", { name: "Find a field" }).first();
    await find.fill(set.search.typo);
    const top = (await page.locator(".chart-add-field-name").first().textContent()) ?? "";
    if (top !== set.search.expect) add("FAIL", set.name, "field search", `"${set.search.typo}" lists "${top}" first, not "${set.search.expect}"`);
    await find.press("Enter");
    const chips = await page.locator(".chart-add-chip").count();
    if (chips !== 1) add("FAIL", set.name, "field search", `Enter put ${chips} fields on the shelf, not 1`);
    if ((await find.inputValue()) !== "") add("WARN", set.name, "field search", "the search box keeps its text after Enter");
    if ((await page.locator(".chart-add-clear").count()) > 0) await page.locator(".chart-add-clear").click();
  }

  // 3. Every pick set × every common chart type.
  const types = await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type:not([aria-disabled='true']) .chart-add-type-name").allTextContents();
  let first = true;
  for (const picks of set.picks) {
    for (const type of types) {
      const step = `${picks.join("+")} → ${type}`;
      if (process.env.CHART_UX_VERBOSE) console.error(`[${set.name}] ${step} (${((Date.now() - T0) / 1000).toFixed(1)}s)`);
      const result = await makeChart(page, picks, type);
      if (result.error !== undefined) {
        add("FAIL", set.name, step, result.error);
        continue;
      }
      if (result.refused !== undefined) {
        add("INFO", set.name, step, `refused: ${result.refused}`);
        continue;
      }
      await checkChart(page, set, step, picks);
      if (first) {
        first = false;
        await page.screenshot({ path: path.join(OUT, `${set.name}-first-chart.png`) });
        await checkLayout(page, set, { width: 1280, height: 720 });
        await checkLayout(page, set, { width: 1440, height: 900 });
      }
    }
  }

  // 4. Change the type of a finished chart: fields with a place on the new type stay.
  const richest = set.picks[set.picks.length > 1 ? 1 : 0];
  const made = await makeChart(page, richest, types[0]);
  if (made.used !== undefined) {
    // Through the chart's own type picker, as a person would: types that cannot fit are greyed out there.
    for (const label of ["Line", "Bar", "Scatter", "Histogram", "Box plot"]) {
      const button = card(page).locator(".chart-kind-button");
      if ((await button.count()) === 0 || !(await button.first().isVisible())) {
        add("WARN", set.name, "change type", "no chart type button on the finished chart");
        break;
      }
      await button.first().click();
      const option = page.locator(".chart-kind-pop .chart-kind-option").filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) }).first();
      if ((await option.count()) === 0 || (await option.isDisabled())) {
        await page.keyboard.press("Escape");
        continue;
      }
      await option.click();
      await page.waitForTimeout(400);
      await checkChart(page, set, `${richest.join("+")} → change type to ${label}`, richest);
    }
  }

  // 5. Bars of a date: periods and repeating parts.
  if (set.dateGrouping !== undefined) {
    const measure = set.picks.flat().find((name) => /sales|metric|amount/.test(name)) ?? set.picks[0][1];
    const done = await makeChart(page, [set.dateGrouping, measure], "Bar");
    const grain = card(page).locator("select").filter({ has: page.locator('option[value="part:dow"]') });
    if (done.used === undefined || (await grain.count()) === 0) add("FAIL", set.name, "date bars", "no Time resolution on bars of a date");
    else {
      for (const [value, bars] of [["month", null], ...(set.parts ?? [["part:dow", 7]])]) {
        await grain.selectOption(value);
        await page.waitForTimeout(600);
        const note = await noteText(page);
        const step = `bars by ${value}`;
        if (!(await canvasDrawn(page))) add("FAIL", set.name, step, "blank chart");
        if (bars !== null && !new RegExp(`^${bars} groups`).test(note)) add("FAIL", set.name, step, `expected ${bars} bars, note says "${note}"`);
        if (value === "part:dow") await page.screenshot({ path: path.join(OUT, `${set.name}-weekday-bars.png`) });
      }
    }
  }

  // 6. Dark mode: the last chart still draws.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  if (!(await canvasDrawn(page))) add("FAIL", set.name, "dark mode", "blank chart in dark mode");
  await page.screenshot({ path: path.join(OUT, `${set.name}-dark.png`) });

  for (const error of [...new Set(errors)]) add("FAIL", set.name, "console", error.slice(0, 200));
  await page.close();
}

(async () => {
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    console.error(`The app is not running at ${URL}. Start it with: npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`);
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const started = Date.now();
  try {
    for (const set of DATASETS) {
      if (ONLY !== "" && set.name !== ONLY) continue;
      try {
        await runDataset(browser, set);
      } catch (error) {
        add("FAIL", set.name, "run", `the check itself stopped: ${String(error).split("\n")[0]}`);
      }
    }
  } finally {
    await browser.close();
  }
  const count = (level) => findings.filter((f) => f.level === level).length;
  const lines = [
    `# Chart UX check`,
    ``,
    `${new Date().toISOString()} · ${URL} · ${((Date.now() - started) / 1000).toFixed(0)}s · ${count("FAIL")} fail · ${count("WARN")} warn · ${count("INFO")} info`,
    ``,
    `| Level | Data | Step | Detail |`,
    `|---|---|---|---|`,
    ...findings
      .sort((a, b) => ["FAIL", "WARN", "INFO"].indexOf(a.level) - ["FAIL", "WARN", "INFO"].indexOf(b.level))
      .map((f) => `| ${f.level} | ${f.dataset} | ${f.step} | ${f.detail.replace(/\|/g, "\\|")} |`),
    ``,
    `Screenshots: ${OUT}`,
  ];
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  console.log(lines.filter((line) => !line.startsWith("| INFO")).join("\n"));
  process.exit(count("FAIL") > 0 ? 1 : 0);
})();
