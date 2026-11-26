#!/usr/bin/env node
// Chart UX check: drives the Charts page the way a person does, from picking fields to changing
// the finished chart, over several shapes of data, and reports what broke. One browser, one pass.
//
//   node .claude/skills/chart-ux-check/check.cjs [--only name] [--skip name,name] [--out dir] [--url http://127.0.0.1:4173]
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
const SKIP = arg("skip", "").split(",").filter(Boolean);
const T0 = Date.now();
const log = (...parts) => process.env.CHART_UX_VERBOSE && console.error(`(${((Date.now() - T0) / 1000).toFixed(1)}s)`, ...parts);

// ---------- data shapes (deterministic) ----------
const day = (d) => new Date(Date.UTC(2023, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
/** A small seeded random, so every run sees the same rows. */
const seeded = (seed) => () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
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
    numbers: [{ by: "region", measure: "sales" }, { by: "type" }],
    partsTruth: "sales",
    settings: { by: "region", measure: "sales", group: "type" },
    filter: { by: "region", measure: "sales", column: "type", value: "organic" },
    workspace: true,
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
    numbers: [{ by: "colour" }],
    settings: { by: "colour", group: "size" },
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
    numbers: [{ by: "segment", measure: "metric_03" }],
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
    partsTruth: "sales",
    numbers: [{ by: "shop", measure: "sales" }],
  },
  {
    name: "one-column",
    about: "a single measure",
    csv: () => ["amount", ...Array.from({ length: 300 }, (_, i) => String((i * 37) % 211))],
    picks: [["amount"]],
  },
  {
    name: "dirty-missing",
    about: "blanks, N/A, negatives and zeros, money stored as text, a mostly empty column",
    csv: () => {
      const rand = seeded(7);
      const rows = ["date,category,amount,price_text,qty,notes_rare"];
      const cats = ["Alpha", "Beta", "Gamma", "Delta"];
      // From 1: a nearly blank first row reads as a second header row, and the import stops to ask.
      for (let i = 1; i <= 900; i++) {
        const date = i % 37 === 0 ? "" : i % 53 === 0 ? "N/A" : day(i % 400);
        const category = i % 29 === 0 ? "" : cats[Math.floor(rand() * 4)];
        const amount = i % 31 === 0 ? "" : i % 47 === 0 ? "N/A" : i % 11 === 0 ? "0" : String(Math.round((rand() - 0.3) * 1000) / 10);
        const money = i % 41 === 0 ? "" : `"$${(Math.round(rand() * 250_000) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}"`;
        const qty = i % 19 === 0 ? "-" : String(Math.floor(rand() * 12));
        const rare = i % 25 === 0 ? `note ${i}` : "";
        rows.push([date, category, amount, money, qty, rare].join(","));
      }
      return rows;
    },
    picks: [["category", "amount"], ["date", "amount"], ["category", "price_text"], ["amount", "qty", "category"], ["notes_rare"]],
    dateGrouping: "date",
    numbers: [{ by: "category", measure: "amount" }, { by: "category" }],
    settings: { by: "category", measure: "amount", group: "date" },
    filter: { by: "category", measure: "amount", column: "category", value: "Beta" },
    workspace: true,
  },
  {
    name: "big-high-cardinality",
    about: "200k rows: a 5,000-value category, an order id, speed budgets, top N + Other",
    budgetMs: 4000,
    csv: () => {
      const rand = seeded(11);
      const rows = ["ordered_at,order_id,customer,product,amount,qty"];
      for (let i = 0; i < 200_000; i++) {
        const t = new Date(Date.UTC(2022, 0, 1) + Math.floor(rand() * 3 * 365 * 24) * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
        rows.push(`${t},ORD-${String(i).padStart(7, "0")},Customer ${String(Math.floor(rand() * 5000)).padStart(4, "0")},Product ${String.fromCharCode(65 + Math.floor(rand() * 20))},${(Math.round(rand() * 50_000) / 100).toFixed(2)},${1 + Math.floor(rand() * 9)}`);
      }
      return rows;
    },
    picks: [["customer", "amount"], ["product", "amount"], ["order_id"], ["ordered_at", "amount", "product"]],
    dateGrouping: "ordered_at",
    partsTruth: "amount",
    // 20 products: more than the bars show, so the top N + "Other" is checked against the rows.
    numbers: [{ by: "product", measure: "amount" }],
    // 5,000 customers are too many to group: Bar must say so, not draw bars of another field.
    refuse: [[["customer", "amount"], "Bar"]],
  },
];

// ---------- findings ----------
const findings = [];
const add = (level, dataset, step, detail) => findings.push({ level, dataset, step, detail });

// ---------- source data, worked out independently of the app ----------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) row.push(cell), rows.push(row);
  return rows;
}
const tableOf = (set) => {
  const [head, ...body] = parseCsv(set.csv().join("\n"));
  return { head, body, col: (name) => head.indexOf(name) };
};
const distinctCache = new Map();
/** Distinct values of a column in the source rows. */
const distinctOf = (set, name) => {
  const key = `${set.name}/${name}`;
  if (!distinctCache.has(key)) {
    const table = tableOf(set);
    distinctCache.set(key, new Set(table.body.map((row) => row[table.col(name)])).size);
  }
  return distinctCache.get(key);
};
/** A plain number, or null for a blank, N/A, a dash. */
const num = (cell) => (cell === undefined || cell.trim() === "" || !/^-?\d+(\.\d+)?$/.test(cell.trim()) ? null : Number(cell));
/** { group: {sum, count, values} } over the rows that pass `keep`. */
function groupStats(table, by, measure, keep = () => true, keyOf = (cell) => cell) {
  const out = new Map();
  const b = table.col(by), m = measure === undefined ? -1 : table.col(measure);
  for (const row of table.body) {
    if (!keep(row)) continue;
    const key = keyOf(row[b]);
    if (key === null) continue;
    const entry = out.get(key) ?? { rows: 0, sum: 0, count: 0 };
    entry.rows++;
    if (m >= 0) {
      const value = num(row[m]);
      if (value !== null) (entry.sum += value), entry.count++;
    }
    out.set(key, entry);
  }
  return out;
}
const BLANK_LABEL = /^\(?(blank|missing|empty|null|none|\(none\)|n\/a)\)?$/i;
const OTHER_LABEL = /^\(?other|^all others|^rest/i;
const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) + 0.011;

// ---------- canvas text log: every label a chart draws, with its box on the canvas ----------
const TEXT_HOOK = () => {
  const logs = new WeakMap();
  const isChart = (canvas) => canvas !== null && canvas !== undefined && canvas.classList !== undefined && canvas.classList.contains("chart-canvas");
  const proto = CanvasRenderingContext2D.prototype;
  const covers = (ctx, x, y, w, h) => {
    const m = ctx.getTransform();
    return Math.abs(w * m.a) >= ctx.canvas.width * 0.98 && Math.abs(h * m.d) >= ctx.canvas.height * 0.98;
  };
  for (const name of ["clearRect", "fillRect"]) {
    const original = proto[name];
    proto[name] = function (x, y, w, h) {
      if (isChart(this.canvas) && covers(this, x, y, w, h)) logs.set(this.canvas, []);
      return original.call(this, x, y, w, h);
    };
  }
  const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
  Object.defineProperty(HTMLCanvasElement.prototype, "width", {
    ...width,
    set(value) {
      if (isChart(this)) logs.set(this, []);
      width.set.call(this, value);
    },
  });
  const fill = proto.fillText;
  proto.fillText = function (text, x, y, maxWidth) {
    try {
      if (isChart(this.canvas) && String(text).trim() !== "") {
        const t = this.measureText(String(text));
        const left = x - (t.actualBoundingBoxLeft ?? 0), right = x + (t.actualBoundingBoxRight ?? t.width);
        const top = y - (t.actualBoundingBoxAscent ?? 8), bottom = y + (t.actualBoundingBoxDescent ?? 2);
        const m = this.getTransform();
        const pts = [[left, top], [right, top], [left, bottom], [right, bottom]].map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const list = logs.get(this.canvas) ?? [];
        list.push({ text: String(text), l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys), rotated: Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6, w: this.canvas.width, h: this.canvas.height, clipped: maxWidth !== undefined && t.width > maxWidth });
        logs.set(this.canvas, list);
      }
    } catch {
      // The check must never break the page it watches.
    }
    return fill.call(this, text, x, y, maxWidth);
  };
  window.__chartTexts = (canvas) => logs.get(canvas) ?? [];
  // Dot centres (arcs), so the hover check can point at a mark a coarse sweep would miss.
  const dots = new WeakMap();
  for (const name of ["clearRect", "fillRect"]) {
    const original = proto[name];
    proto[name] = function (x, y, w, h) {
      if (isChart(this.canvas) && covers(this, x, y, w, h)) dots.set(this.canvas, []);
      return original.call(this, x, y, w, h);
    };
  }
  const arc = proto.arc;
  proto.arc = function (x, y, ...rest) {
    try {
      if (isChart(this.canvas)) {
        const list = dots.get(this.canvas) ?? [];
        if (list.length < 400) {
          const m = this.getTransform();
          list.push({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, w: this.canvas.width, h: this.canvas.height });
          dots.set(this.canvas, list);
        }
      }
    } catch {
      // never break the page
    }
    return arc.call(this, x, y, ...rest);
  };
  window.__chartDots = (canvas) => dots.get(canvas) ?? [];
};

// ---------- page helpers ----------
async function load(page, set) {
  await page.goto(URL);
  await loadData(page, set);
}
async function loadData(page, set) {
  await page.locator('input[type="file"]').first().setInputFiles({ name: `${set.name}.csv`, mimeType: "text/csv", buffer: Buffer.from(set.csv().join("\n")) });
  await page.locator(".nav-row").waitFor({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel, .chart-card").first().waitFor();
}
const openAdd = async (page) => {
  if ((await page.locator(".chart-add-panel:not(.hidden)").count()) === 0) await page.getByRole("button", { name: "+ Add chart" }).click();
  await page.locator(".chart-add-panel:not(.hidden)").waitFor();
};
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fieldButton = (page, name) => page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${escapeRe(name)}$`) }) });
const card = (page) => page.locator(".chart-card:not(.hidden)");
const canvasOf = (page) => card(page).locator("canvas.chart-canvas").first();
/** Fields on the open chart, from the rail: { name: role }. */
const usedFields = (page) =>
  page.locator(".chart-rail-field.used").evaluateAll((nodes) => Object.fromEntries(nodes.map((n) => [n.querySelector(".chart-rail-name")?.textContent ?? "", n.querySelector(".chart-rail-role")?.textContent ?? ""])));
/** What a click on a rail field would do now (its tooltip, filled on focus). */
async function railHint(page, name) {
  const field = page.locator(".chart-rail-field").filter({ has: page.locator(".chart-rail-name", { hasText: new RegExp(`^${escapeRe(name)}$`) }) }).first();
  if ((await field.count()) === 0) return "";
  await field.dispatchEvent("focus");
  return (await field.getAttribute("title")) ?? "";
}
/** Distinct colours on the canvas (sampled), and a hash of what is drawn. */
const canvasLook = (page) =>
  canvasOf(page).evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    if (ctx === null || canvas.width === 0) return { colours: 0, hash: 0 };
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set();
    let hash = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      seen.add(rgb);
      hash = (hash * 31 + rgb) | 0;
    }
    return { colours: seen.size, hash };
  }).catch(() => ({ colours: 0, hash: 0 }));
const canvasDrawn = async (page) => (await canvasLook(page)).colours > 6;
const noteText = async (page) => ((await card(page).locator(".chart-note").allTextContents())[0] ?? "").trim();
const stableNote = (note) => note.replace(/·\s*[<\d.,]+\s*ms/g, "").trim();
const BAD_NOTE = /no groups|could not|has no measures|nothing to draw|failed|NaN|undefined|Infinity|pick a numeric measure/i;

/** Picks fields, clicks a chart type; returns what happened and how long the chart took to draw. */
async function makeChart(page, picks, type) {
  await openAdd(page);
  if ((await page.locator(".chart-add-chip").count()) > 0) return { error: "shelf not empty when a new chart starts" };
  for (const name of picks) await fieldButton(page, name).click();
  const tabs = await page.locator(".charts-tab").count();
  const started = Date.now();
  await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type", { hasText: type }).click();
  // Poll for the outcome: a refusal, or a new chart whose canvas has drawn and whose note is in.
  for (;;) {
    // Read only what is there now: a locator read waits 30s for an element that never comes.
    const message = ((await page.locator(".chart-add-message").allTextContents())[0] ?? "").trim();
    if (message !== "") {
      if ((await page.locator(".chart-add-clear").count()) > 0) await page.locator(".chart-add-clear").click();
      return { refused: message };
    }
    const added = (await page.locator(".charts-tab").count()) > tabs - 1 && (await page.locator(".chart-add-panel:not(.hidden)").count()) === 0;
    if (added && (await card(page).locator(".chart-canvas").count()) > 0 && (await canvasDrawn(page)) && (await noteText(page)) !== "") break;
    if (Date.now() - started > 20_000) {
      if ((await page.locator(".charts-tab").count()) <= tabs - 1) return { error: "no chart tab appeared" };
      break;
    }
    await page.waitForTimeout(50);
  }
  const ms = Date.now() - started;
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  return { used: await usedFields(page), ms };
}

/** Labels drawn outside the canvas (cut off) or on top of each other (unreadable). */
async function checkLabels(page, set, step) {
  const texts = await canvasOf(page).evaluate((canvas) => window.__chartTexts?.(canvas) ?? []).catch(() => []);
  if (texts.length === 0) return;
  const { w, h } = texts[texts.length - 1];
  const cut = texts.filter((t) => t.l < -2 || t.t < -2 || t.r > w + 2 || t.b > h + 2);
  if (cut.length > 0) add("FAIL", set.name, step, `${cut.length} label(s) cut off at the canvas edge: ${cut.slice(0, 3).map((t) => `"${t.text}"`).join(", ")}`);
  const flat = texts.filter((t) => !t.rotated);
  const clashes = [];
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i], b = flat[j];
      if (a.text === b.text && Math.abs(a.l - b.l) < 2 && Math.abs(a.t - b.t) < 2) continue; // a halo drawn twice
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox <= 1 || oy <= 1) continue;
      const smaller = Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t));
      if (ox * oy > 0.3 * smaller) clashes.push(`"${a.text}" / "${b.text}"`);
    }
  }
  if (clashes.length > 0) add("WARN", set.name, step, `${clashes.length} pair(s) of labels overlap: ${clashes.slice(0, 3).join(", ")}`);
  return texts;
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
    else if (/Colour|Group/.test(slot) && distinctOf(set, name) > 100) add("INFO", set.name, step, `picked "${name}" has ${distinctOf(set, name).toLocaleString()} values: too many to colour or group by`);
    else add("FAIL", set.name, step, `picked "${name}" was dropped though the chart's ${slot} is free`);
  }
  // A field nobody picked is expected when the picks cannot fill a required slot (a scatter needs
  // two numbers); it is worth a look when it sits on the chart while a picked field does not.
  const extra = Object.keys(used).filter((name) => !picks.includes(name));
  if (extra.length > 0) add(dropped.length > 0 ? "WARN" : "INFO", set.name, step, `chart also uses fields nobody picked: ${extra.map((name) => `${name} (${used[name]})`).join(", ")}${dropped.length > 0 ? ` while ${dropped.join(", ")} is off it` : " (to fill a required slot)"}`);
  if (!(await canvasDrawn(page))) add("FAIL", set.name, step, "the chart canvas is blank");
  const note = await noteText(page);
  if (BAD_NOTE.test(note)) add("FAIL", set.name, step, `chart note: "${note}"`);
  // Hundreds of bars or lines nobody can read (an id charted as categories).
  const groups = Number((/^([\d,]+) groups/.exec(note)?.[1] ?? "0").replace(/,/g, ""));
  if (groups > 500) add("WARN", set.name, step, `draws ${groups.toLocaleString()} groups: "${note}"`);
  await checkLabels(page, set, step);
  await checkHover(page, set, step);
  await checkTopBars(page, set, step);
  return used;
}

/** Sweeps the plot with the pointer: some mark must show a tooltip with its details. */
async function checkHover(page, set, step) {
  const box = await canvasOf(page).boundingBox();
  if (box === null) return;
  const tip = card(page).locator(".chart-tooltip:not(.hidden)");
  let found = "";
  outer: for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    for (let fx = 0.1; fx <= 0.92; fx += 0.04) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      if ((await tip.count()) > 0 && (await tip.first().isVisible())) {
        found = ((await tip.first().innerText()) ?? "").replace(/\s+/g, " ").trim();
        break outer;
      }
    }
  }
  // A sparse scatter's dots slip between the sweep's steps: point at drawn dots instead.
  if (found === "") {
    const dots = await canvasOf(page).evaluate((canvas) => window.__chartDots?.(canvas) ?? []).catch(() => []);
    const step = Math.max(1, Math.floor(dots.length / 12));
    for (let i = 0; i < dots.length && found === ""; i += step) {
      const dot = dots[i];
      await page.mouse.move(box.x + (dot.x / dot.w) * box.width, box.y + (dot.y / dot.h) * box.height);
      if ((await tip.count()) > 0 && (await tip.first().isVisible())) found = ((await tip.first().innerText()) ?? "").replace(/\s+/g, " ").trim();
    }
  }
  await page.mouse.move(0, 0);
  if (found === "") add("FAIL", set.name, step, "no hover: sweeping the plot showed no tooltip");
  else if (/NaN|undefined|Infinity|\[object/.test(found)) add("FAIL", set.name, step, `hover text is broken: "${found.slice(0, 120)}"`);
}

/**
 * The top bars stay in view: the app's tabs, the chart tabs, and the chart's own bar (title, Undo,
 * type, settings, export). Checked as drawn, then with the page scrolled to the bottom, since a bar
 * that is not pinned slides under the pinned ones and vanishes. Each must be on screen, not hidden,
 * and not covered by something else.
 */
async function checkTopBars(page, set, step) {
  const bars = [
    ["app tabs", ".view-tabs"],
    ["chart tabs", ".charts-tabs"],
    ["chart's own bar", ".chart-card:not(.hidden) .chart-card-head"],
  ];
  const look = (when) =>
    page.evaluate(
      ({ bars, when }) =>
        bars.map(([name, selector]) => {
          const node = document.querySelector(selector);
          if (node === null) return `the ${name} ${name.endsWith("bar") ? "is" : "are"} gone from the page ${when}`;
          const r = node.getBoundingClientRect();
          const s = getComputedStyle(node);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0 || r.height < 4) return `the ${name} hidden ${when}`;
          if (r.bottom <= 0 || r.top >= innerHeight) return `the ${name} scrolled out of view ${when} (top ${Math.round(r.top)}px)`;
          // Something drawn on top, even partly: its top edge or middle belongs to another element.
          const x = Math.min(r.left + 40, r.right - 2);
          for (const y of [r.top + 3, r.top + r.height / 2]) {
            const hit = document.elementFromPoint(x, y);
            if (hit !== null && !node.contains(hit) && !hit.contains(node) && !hit.closest(".chart-tooltip, .context-menu"))
              return `the ${name} is ${y < r.top + 4 ? "partly " : ""}covered by .${String(hit.className).split(" ")[0] || hit.tagName} ${when}`;
          }
          return null;
        }),
      { bars, when },
    );
  const problems = [...(await look("as drawn"))];
  // Scroll the chart page to the bottom, as a person reading the data below the chart does.
  const scrolled = await page.evaluate(() => {
    const body = document.querySelector(".workspace-body");
    if (body === null || body.scrollHeight <= body.clientHeight + 8) return false;
    body.scrollTop = body.scrollHeight;
    return true;
  });
  if (scrolled) {
    await page.waitForTimeout(80);
    problems.push(...(await look("after scrolling down")));
    await page.evaluate(() => {
      const body = document.querySelector(".workspace-body");
      if (body !== null) body.scrollTop = 0;
    });
  }
  for (const problem of problems) if (problem !== null) add("FAIL", set.name, step, problem);
}

async function checkLayout(page, set, size) {
  await page.setViewportSize(size);
  await page.waitForTimeout(300);
  const plot = await canvasOf(page).boundingBox();
  if (plot === null) return add("FAIL", set.name, `layout ${size.width}x${size.height}`, "no plot on screen");
  if (plot.y + plot.height > size.height + 1) add("WARN", set.name, `layout ${size.width}x${size.height}`, `plot runs ${Math.round(plot.y + plot.height - size.height)}px below the window`);
  if (plot.height < 240) add("WARN", set.name, `layout ${size.width}x${size.height}`, `plot only ${Math.round(plot.height)}px tall`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) add("FAIL", set.name, `layout ${size.width}x${size.height}`, `page scrolls sideways by ${overflow}px`);
  await checkTopBars(page, set, `top bars at ${size.width}x${size.height}`);
  const texts = await checkLabels(page, set, `labels at ${size.width}x${size.height}`);
  if (texts === undefined) add("WARN", set.name, `labels at ${size.width}x${size.height}`, "the label check read no text on the canvas, so it checked nothing");
  else add("INFO", set.name, `labels at ${size.width}x${size.height}`, `${texts.length} labels read`);
}

// ---------- settings, exports ----------
/** The open chart's setting control whose label starts with `name` (a select or input), if shown. */
async function setting(page, name) {
  const control = card(page).locator("label").filter({ hasText: new RegExp(`^${escapeRe(name)}`) }).locator("select, input").first();
  if ((await control.count()) === 0) return null;
  if (!(await control.isVisible())) {
    // A setting under a closed "Refine" or "Format" fold.
    await control.evaluate((node) => {
      for (let d = node.closest("details"); d !== null; d = d.parentElement?.closest("details") ?? null) d.open = true;
    });
    if (!(await control.isVisible())) return null;
  }
  return control;
}
/** Chooses the option of a setting select whose text starts with `text`; false when there is none. */
async function choose(page, name, text) {
  const select = await setting(page, name);
  if (select === null) return false;
  const value = await select.evaluate((node, wanted) => [...node.options].find((o) => o.textContent.trim().startsWith(wanted))?.value ?? null, text);
  if (value === null) return false;
  // A person reaches for the control first; the card takes its undo point then.
  await select.focus();
  await select.selectOption(value);
  await waitForRedraw(page);
  return true;
}
async function waitForRedraw(page) {
  await page.waitForTimeout(250);
  const until = Date.now() + 8000;
  let last = "";
  while (Date.now() < until) {
    const note = stableNote(await noteText(page));
    if (note !== "" && note === last && !/loading|working|counting/i.test(note)) break;
    last = note;
    await page.waitForTimeout(150);
  }
}
async function download(page, trigger, timeout = 8000) {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout }), trigger()]);
  const at = await file.path();
  return { name: file.suggestedFilename(), bytes: fs.readFileSync(at) };
}
/** The open chart's numbers, through "Download data (CSV)" in its ⋯ menu: [[label, value], ...]. */
async function chartCsv(page) {
  await card(page).locator(".chart-more").first().click();
  const { bytes } = await download(page, () => page.getByText("Download data (CSV)", { exact: true }).first().click());
  const rows = parseCsv(bytes.toString("utf8")).filter((row) => row.length > 1 || row[0] !== "");
  return { head: rows[0] ?? [], rows: rows.slice(1), text: bytes.toString("utf8") };
}
const signature = async (page) => ({ note: stableNote(await noteText(page)), hash: (await canvasLook(page)).hash, used: JSON.stringify(await usedFields(page)) });

/** The chart's numbers per group against the source rows. */
function compareGroups(set, step, csv, expected, statName, pick) {
  if (/NaN|Infinity|undefined/.test(csv.text)) add("FAIL", set.name, step, "the chart's data has NaN, Infinity or undefined in it");
  if (csv.rows.length === 0) return add("FAIL", set.name, step, "the chart's data (CSV) has no rows");
  const want = (key) => {
    const entry = expected.get(key);
    return entry === undefined ? undefined : pick(entry);
  };
  let checked = 0;
  const wrong = [];
  const unknown = [];
  let other = null;
  for (const row of csv.rows) {
    const label = row[0];
    const got = Number(row[1]);
    if (OTHER_LABEL.test(label)) {
      other = got;
      continue;
    }
    const key = expected.has(label) ? label : BLANK_LABEL.test(label) || label === "" ? "" : label;
    const value = want(key);
    if (value === undefined) {
      unknown.push(label);
      continue;
    }
    checked++;
    if (!close(got, value)) wrong.push(`${label}: chart ${got}, data ${Math.round(value * 1000) / 1000}`);
  }
  if (wrong.length > 0) add("FAIL", set.name, step, `${statName} is wrong for ${wrong.length} of ${checked} groups: ${wrong.slice(0, 3).join("; ")}`);
  if (unknown.length > 0) {
    const zeros = unknown.every((label) => Number(csv.rows.find((row) => row[0] === label)?.[1] ?? 0) === 0);
    add("WARN", set.name, step, zeros ? `shows ${unknown.length} group(s) with no rows as 0 (${unknown.slice(0, 3).map((l) => `"${l}"`).join(", ")}): an empty group reads as a real zero` : `the chart has groups the data does not: ${unknown.slice(0, 4).map((l) => `"${l}"`).join(", ")}`);
  }
  if (other !== null && statName === "sum") {
    const shown = new Set(csv.rows.map((row) => row[0]));
    const rest = [...expected.entries()].filter(([key]) => !shown.has(key) && key !== "").reduce((sum, [, entry]) => sum + pick(entry), 0);
    if (!close(other, rest)) add("FAIL", set.name, step, `"Other" is ${other}, but the groups left out add up to ${Math.round(rest * 100) / 100}`);
  }
  if (checked === 0 && unknown.length === 0) add("FAIL", set.name, step, "no group in the chart's data could be checked");
  return checked;
}

/** Bars of a category: sum, mean and count per group against the source data. */
async function checkNumbers(page, set, table, spec) {
  const step = `numbers: ${spec.by}${spec.measure ? ` × ${spec.measure}` : " (count)"}`;
  const made = await makeChart(page, spec.measure ? [spec.by, spec.measure] : [spec.by], "Bar");
  if (made.used === undefined) return add("FAIL", set.name, step, `could not make the chart: ${made.refused ?? made.error}`);
  const expected = groupStats(table, spec.by, spec.measure, () => true, (cell) => (cell === undefined ? null : cell.trim()));
  if (spec.measure === undefined) {
    compareGroups(set, `${step}, count`, await chartCsv(page), expected, "count", (e) => e.rows);
    return;
  }
  const stats = [["Sum", "sum", (e) => e.sum], ["Average", "mean", (e) => (e.count === 0 ? NaN : e.sum / e.count)], ["Count of values", "count", (e) => e.count]];
  for (const [label, statName, pick] of stats) {
    if (!(await choose(page, "Aggregate", label))) {
      add("WARN", set.name, step, `no "${label}" in the Aggregate setting`);
      continue;
    }
    compareGroups(set, `${step}, ${statName}`, await chartCsv(page), expected, statName, pick);
  }
}

/** A weekday, hour or month-of-year from a cell (dates without a zone read as UTC). */
const PART_KEY = {
  "part:dow": [(d) => d.getUTCDay(), (label) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(label.slice(0, 3).toLowerCase())],
  "part:month": [(d) => d.getUTCMonth(), (label) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(label.slice(0, 3).toLowerCase())],
  "part:hour": [(d) => d.getUTCHours(), (label) => (/^\d+/.test(label) ? Number(/^\d+/.exec(label)[0]) : -1)],
};
const parseWhen = (cell) => {
  if (cell === undefined || !/^\d{4}-\d\d-\d\d/.test(cell.trim())) return null;
  const date = new Date(`${cell.trim().replace(" ", "T")}${cell.trim().length > 10 ? "" : "T00:00"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

// ---------- one data shape ----------
async function runDataset(browser, set) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(TEXT_HOOK);
  try {
    await walk(page, set);
  } catch (error) {
    // Where the check stopped, for a look at what the page showed.
    await page.screenshot({ path: path.join(OUT, `${set.name}-stopped.png`) }).catch(() => {});
    throw error;
  } finally {
    await page.close();
  }
}

async function walk(page, set) {
  const errors = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(String(err)));
  const loadStart = Date.now();
  await load(page, set);
  log(set.name, `loaded in ${Date.now() - loadStart} ms`);
  const table = tableOf(set);
  const columns = table.head;
  const budget = set.budgetMs ?? 1500;
  const timings = [];

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
      log(set.name, step);
      const result = await makeChart(page, picks, type);
      if (result.error !== undefined) {
        add("FAIL", set.name, step, result.error);
        continue;
      }
      if (result.refused !== undefined) {
        add("INFO", set.name, step, `refused: ${result.refused}`);
        continue;
      }
      timings.push([step, result.ms]);
      if (result.ms > budget * 4) add("FAIL", set.name, step, `took ${(result.ms / 1000).toFixed(1)}s to draw (budget ${budget} ms)`);
      else if (result.ms > budget) add("WARN", set.name, step, `took ${result.ms} ms to draw (budget ${budget} ms)`);
      await checkChart(page, set, step, picks);
      if (first) {
        first = false;
        await page.screenshot({ path: path.join(OUT, `${set.name}-first-chart.png`) });
        await checkLayout(page, set, { width: 1280, height: 720 });
        await checkLayout(page, set, { width: 1440, height: 900 });
      }
    }
  }
  if (timings.length > 0) {
    const slowest = timings.reduce((a, b) => (b[1] > a[1] ? b : a));
    add("INFO", set.name, "speed", `slowest chart: ${slowest[0]} in ${slowest[1]} ms (budget ${budget} ms)`);
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
      await waitForRedraw(page);
      await page.mouse.move(0, 0);
      await checkChart(page, set, `${richest.join("+")} → change type to ${label}`, richest);
    }
  }

  // 4b. Picks a type cannot use are refused in words, never charted with something else.
  for (const [picks, type] of set.refuse ?? []) {
    const result = await makeChart(page, picks, type);
    if (result.refused === undefined) add("FAIL", set.name, `${picks.join("+")} → ${type}`, `expected a "do not fit" message, got a chart of ${JSON.stringify(result.used ?? result.error)}`);
  }

  // 5. The numbers: each chart's data against sums, means and counts worked out from the rows.
  for (const spec of set.numbers ?? []) {
    log(set.name, "numbers", spec.by, spec.measure ?? "count");
    await checkNumbers(page, set, table, spec).catch((error) => add("FAIL", set.name, `numbers: ${spec.by}`, `the check stopped: ${String(error).split("\n")[0]}`));
  }

  // 6. Bars of a date: periods and repeating parts, with the parts' numbers checked.
  if (set.dateGrouping !== undefined) {
    log(set.name, "date bars");
    const measure = set.partsTruth ?? set.picks.flat().find((name) => /sales|metric|amount/.test(name)) ?? set.picks[0][1];
    const done = await makeChart(page, [set.dateGrouping, measure], "Bar");
    const grain = card(page).locator("select").filter({ has: page.locator('option[value="part:dow"]') });
    if (done.used === undefined || (await grain.count()) === 0) add("FAIL", set.name, "date bars", "no Time resolution on bars of a date");
    else {
      if (set.partsTruth !== undefined) await choose(page, "Aggregate", "Sum");
      for (const [value, bars] of [["month", null], ...(set.parts ?? [["part:dow", 7]])]) {
        await grain.selectOption(value);
        await waitForRedraw(page);
        await page.mouse.move(0, 0);
        const note = await noteText(page);
        const step = `bars by ${value}`;
        if (!(await canvasDrawn(page))) add("FAIL", set.name, step, "blank chart");
        // Rows with no date may add one bar of their own.
        const blankDates = table.body.some((row) => parseWhen(row[table.col(set.dateGrouping)]) === null);
        const drawn = Number(/^(\d+) groups/.exec(note)?.[1] ?? NaN);
        if (bars !== null && drawn !== bars && !(blankDates && drawn === bars + 1)) add("FAIL", set.name, step, `expected ${bars} bars, note says "${note}"`);
        if (/\((dow|dom|hour|month|quarter|week)\)/.test(note) && value.startsWith("part:")) add("FAIL", set.name, step, `the note shows an engine code: "${note}"`);
        await checkLabels(page, set, step);
        if (set.partsTruth !== undefined && PART_KEY[value] !== undefined) {
          const [keyOfDate, keyOfLabel] = PART_KEY[value];
          const d = table.col(set.dateGrouping);
          const expected = groupStats(table, set.dateGrouping, set.partsTruth, () => true, (cell) => {
            const when = parseWhen(cell);
            return when === null || (d < 0) ? null : String(keyOfDate(when));
          });
          const csv = await chartCsv(page);
          const relabelled = { ...csv, rows: csv.rows.map((row) => [String(keyOfLabel(row[0])), row[1]]) };
          compareGroups(set, `${step}, sum`, relabelled, expected, "sum", (e) => e.sum);
        }
        if (value === "part:dow") await page.screenshot({ path: path.join(OUT, `${set.name}-weekday-bars.png`) });
      }
    }
  }

  // 7. Settings: each change redraws, a sort sorts, Undo puts back exactly what was there.
  if (set.settings !== undefined) {
    log(set.name, "settings");
    const s = set.settings;
    const step = `settings on ${s.by}${s.measure ? ` × ${s.measure}` : ""}`;
    const done = await makeChart(page, s.measure ? [s.by, s.measure] : [s.by], "Bar");
    if (done.used === undefined) add("FAIL", set.name, step, `could not make the chart: ${done.refused ?? done.error}`);
    else {
      const changes = [
        ["Aggregate", "Median"],
        // Z-A: an automatic order may already read A-Z, so only Z-A must change something.
        ["Sort", "Label Z-A"],
        ["Group by", s.group],
        ["Calc", "Cumulative"],
        ...(s.measure ? [["Value", "Count of rows"]] : []),
      ];
      for (const [name, option] of changes) {
        await changeAndUndo(name, option).catch((error) => add("FAIL", set.name, step, `${name} → ${option} stopped: ${String(error).split("\n")[0]}`));
      }
    }
    async function changeAndUndo(name, option) {
      {
        const select = await setting(page, name);
        if (select === null) return;
        const before = await signature(page);
        const beforeShot = await canvasOf(page).screenshot().catch(() => null);
        const was = await select.inputValue();
        if (!(await choose(page, name, option))) {
          add("INFO", set.name, step, `no "${option}" in ${name}`);
          return;
        }
        await page.mouse.move(0, 0);
        const after = await signature(page);
        if (after.note === before.note && after.hash === before.hash) add("FAIL", set.name, step, `${name} → ${option} changed nothing on the chart`);
        if (BAD_NOTE.test(after.note)) add("FAIL", set.name, step, `${name} → ${option}: note "${after.note}"`);
        if (!(await canvasDrawn(page))) add("FAIL", set.name, step, `${name} → ${option}: blank chart`);
        await checkLabels(page, set, `${step}, ${name} → ${option}`);
        if (name === "Sort") {
          // Category labels along the axis, left to right (or top to bottom), read Z to A.
          const texts = await canvasOf(page).evaluate((canvas) => window.__chartTexts?.(canvas) ?? []);
          const values = new Set(table.body.map((row) => row[table.col(s.by)]?.trim()).filter(Boolean));
          const along = texts.filter((t) => values.has(t.text)).sort((a, b) => a.l - b.l || a.t - b.t).map((t) => t.text);
          const unique = along.filter((t, i) => along.indexOf(t) === i);
          const sorted = [...unique].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          if (unique.length > 1 && unique.join("|") !== sorted.join("|")) add("FAIL", set.name, step, `Sort Label Z-A draws ${unique.slice(0, 6).join(", ")}`);
        }
        // Undo puts back the setting and the chart.
        const undo = card(page).locator(".chart-undo-btn").first();
        if (!(await undo.isEnabled()) || !(await undo.isVisible())) return add("FAIL", set.name, step, `after ${name} → ${option} there is no Undo to press`);
        await undo.click({ timeout: 5000 });
        await waitForRedraw(page);
        await page.mouse.move(0, 0);
        const undone = await signature(page);
        const now = await (await setting(page, name))?.inputValue();
        if (now !== was) add("FAIL", set.name, step, `Undo after ${name} → ${option} left ${name} at "${now}", not "${was}"`);
        if (undone.note !== before.note) add("FAIL", set.name, step, `Undo after ${name} → ${option}: note "${undone.note}", was "${before.note}"`);
        else if (undone.used !== before.used) add("FAIL", set.name, step, `Undo after ${name} → ${option} changed the fields: ${undone.used}`);
        else if (undone.hash !== before.hash) {
          const shot = `${set.name}-undo-${name.toLowerCase().replace(/\W+/g, "-")}`;
          if (beforeShot !== null) fs.writeFileSync(path.join(OUT, `${shot}-before.png`), beforeShot);
          await canvasOf(page).screenshot({ path: path.join(OUT, `${shot}-after.png`) }).catch(() => {});
          // Pixels shift with hover and the drawer edge; same note and fields is the real test.
          add("INFO", set.name, step, `Undo after ${name} → ${option}: same note and fields, pixels differ (${shot}-before/after.png)`);
        }
      }
    }
  }

  // 7b. Axes: a Y range and tick step on a bar chart, a date range on a line over dates. Each
  // changes the chart, and Reset axes brings back exactly what was there.
  if (set.settings !== undefined) {
    log(set.name, "axes");
    const s = set.settings;
    await axesCheck(`axes on a bar of ${s.by}`, s.measure ? [s.by, s.measure] : [s.by], "Bar", async (axes) => {
      if (!(await axes.locator(".chart-axis-row:not(.hidden) .chart-axis-name", { hasText: "Y axis" }).count())) return "no Y axis row on a bar chart";
      await axisSet(axes, "Y axis minimum", "0");
      await axisSet(axes, "Y axis maximum", "1");
      await axisSet(axes, "A tick on the Y axis every", "0.25");
      const texts = (await canvasOf(page).evaluate((canvas) => window.__chartTexts?.(canvas) ?? [])).map((t) => t.text);
      return ["0.25", "0.5", "0.75"].every((tick) => texts.includes(tick)) ? null : `Y ticks every 0.25 from 0 to 1 not drawn (saw ${texts.slice(0, 12).join(", ")})`;
    });
  }
  if (set.dateGrouping !== undefined) {
    const d = table.col(set.dateGrouping);
    const dates = table.body.map((row) => parseWhen(row[d])).filter((when) => when !== null).sort((a, b) => a - b);
    const middle = dates[Math.floor(dates.length / 2)];
    if (middle !== undefined) {
      log(set.name, "axes on dates");
      await axesCheck(`axes on a line over ${set.dateGrouping}`, [set.dateGrouping], "Line", async (axes) => {
        const row = axes.locator(".chart-axis-row:not(.hidden)", { hasText: "X axis" });
        if ((await row.count()) === 0) return "no X axis row on a line over dates";
        if ((await axes.locator('[aria-label="X axis minimum"]').getAttribute("type")) !== "date") return "the X range of a date axis does not take dates";
        await axisSet(axes, "X axis minimum", new Date(middle).toISOString().slice(0, 10));
        return null;
      });
    }
  }
  async function axisSet(axes, label, value) {
    const box = axes.locator(`[aria-label="${label}"]`);
    await box.fill(value);
    await box.press("Enter");
    await box.blur();
    await waitForRedraw(page);
  }
  async function axesCheck(step, picks, type, change) {
    const made = await makeChart(page, picks, type);
    if (made.used === undefined) return add("INFO", set.name, step, `no chart to set axes on: ${made.refused ?? made.error}`);
    const axes = card(page).locator('.chart-side-group[data-group="axes"]');
    if ((await axes.count()) === 0) return add("FAIL", set.name, step, "no Axes section in the settings");
    if (!(await axes.evaluate((node) => node.open))) await axes.locator("summary").click();
    await page.mouse.move(0, 0);
    const before = await signature(page);
    const problem = await change(axes).catch((error) => `stopped: ${String(error).split("\n")[0]}`);
    if (problem !== null) return add("FAIL", set.name, step, problem);
    await page.mouse.move(0, 0);
    const after = await signature(page);
    if (after.note === before.note && after.hash === before.hash) add("FAIL", set.name, step, "setting the axes changed nothing on the chart");
    if (BAD_NOTE.test(after.note)) add("FAIL", set.name, step, `note "${after.note}"`);
    if (!(await canvasDrawn(page))) add("FAIL", set.name, step, "blank chart after setting the axes");
    const status = (await axes.locator(".chart-axis-status").textContent()) ?? "";
    if (status.trim() !== "") add("FAIL", set.name, step, `the Axes settings refused a valid value: "${status}"`);
    await axes.getByRole("button", { name: "Reset axes" }).click();
    await waitForRedraw(page);
    await page.mouse.move(0, 0);
    const reset = await signature(page);
    if (reset.note !== before.note) add("FAIL", set.name, step, `Reset axes left the note "${reset.note}", was "${before.note}"`);
    else if (reset.hash !== before.hash) add("INFO", set.name, step, "Reset axes: same note, pixels differ");
  }

  // 8. A table filter changes the chart; "Also respect table filters" off ignores it.
  if (set.filter !== undefined) {
    log(set.name, "filter");
    const f = set.filter;
    const step = `filter ${f.column} = ${f.value}`;
    const done = await makeChart(page, [f.by, f.measure], "Bar");
    const filterCard = page.locator(`.filter-card`).filter({ has: page.locator(".filter-name", { hasText: new RegExp(`^${escapeRe(f.column)}$`) }) }).first();
    if (done.used === undefined) add("FAIL", set.name, step, `could not make the chart: ${done.refused ?? done.error}`);
    else if ((await filterCard.count()) === 0) add("WARN", set.name, step, `no "${f.column}" in the Filters sidebar`);
    else {
      await choose(page, "Aggregate", "Sum");
      if ((await filterCard.getAttribute("class"))?.includes("collapsed")) await filterCard.locator(".filter-caret").click();
      const box = filterCard.locator(`.value-row[data-label="${f.value}"] input`);
      if ((await box.count()) === 0) add("WARN", set.name, step, `no "${f.value}" to tick in the ${f.column} filter`);
      else {
        // Every value starts ticked (no filter): None, then the one value, keeps only it.
        await filterCard.locator(".value-actions button", { hasText: "None" }).click();
        await box.check();
        await waitForRedraw(page);
        const kept = (row) => row[table.col(f.column)]?.trim() === f.value;
        const filtered = groupStats(table, f.by, f.measure, kept, (cell) => cell?.trim() ?? null);
        const all = groupStats(table, f.by, f.measure, () => true, (cell) => cell?.trim() ?? null);
        const csvFiltered = await chartCsv(page);
        log(set.name, "filtered csv", csvFiltered.text.slice(0, 400));
        compareGroups(set, `${step}, sum`, csvFiltered, filtered, "sum", (e) => e.sum);
        const respect = await setting(page, "Also respect table filters");
        if (respect === null) add("WARN", set.name, step, `no "Also respect table filters" setting`);
        else {
          await respect.uncheck();
          await waitForRedraw(page);
          compareGroups(set, `${step}, ignored by the chart`, await chartCsv(page), all, "sum", (e) => e.sum);
          await respect.check();
          await waitForRedraw(page);
        }
        await filterCard.locator(".value-actions button", { hasText: "All" }).click();
        await waitForRedraw(page);
        compareGroups(set, `${step} cleared`, await chartCsv(page), all, "sum", (e) => e.sum);
      }
    }
  }

  // 9. Exports: the PNG is a real image of a sensible size; the CSV has rows.
  {
    const step = "export";
    try {
      // PNG asks for a size in a menu: take the first size.
      await card(page).locator(".chart-png-btn").first().click();
      const size = page.getByRole("menuitemradio", { name: /1280/ }).or(page.getByRole("menuitem", { name: /1280/ })).first();
      const png = await download(page, () => size.click({ timeout: 5000 }));
      const isPng = png.bytes.subarray(1, 4).toString() === "PNG";
      const w = isPng ? png.bytes.readUInt32BE(16) : 0, h = isPng ? png.bytes.readUInt32BE(20) : 0;
      if (!isPng) add("FAIL", set.name, step, `the PNG download is not a PNG (${png.name})`);
      else if (w < 400 || h < 250 || png.bytes.length < 5000) add("FAIL", set.name, step, `the PNG is ${w}×${h}, ${png.bytes.length} bytes: too small to be the chart`);
      else add("INFO", set.name, step, `PNG ${w}×${h}, ${Math.round(png.bytes.length / 1024)} KB`);
    } catch (error) {
      add("FAIL", set.name, step, `no PNG download: ${String(error).split("\n")[0]}`);
    }
    await page.keyboard.press("Escape");
  }

  // 10. Save the workspace, reload, open it beside the same data: the charts come back the same.
  if (set.workspace === true) {
    log(set.name, "workspace");
    const step = "workspace round trip";
    try {
      const tabsBefore = await page.locator(".charts-tab").allTextContents();
      const activeBefore = await page.locator(".charts-tab.active, .charts-tab[aria-selected='true']").first().textContent().catch(() => null);
      const csvBefore = await chartCsv(page);
      await page.locator('button[title^="Save everything on this page"]').click();
      const saved = await download(page, () => page.getByText("Save workspace…", { exact: true }).first().click());
      const file = path.join(OUT, `${set.name}.workspace.json`);
      fs.writeFileSync(file, saved.bytes);
      await page.reload();
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Open a saved workspace…" }).click()]);
      await chooser.setFiles(file);
      await page.waitForTimeout(300);
      await page.locator('input[type="file"]').first().setInputFiles({ name: `${set.name}.csv`, mimeType: "text/csv", buffer: Buffer.from(set.csv().join("\n")) });
      await page.locator(".nav-row").waitFor({ timeout: 60_000 });
      // The workspace replays a moment after the data is in, and opens the view it was saved on.
      await page.waitForTimeout(2000);
      await page.keyboard.press("Escape");
      await page.locator(".view-tabs button", { hasText: "Chart" }).click();
      await page.locator(".chart-card:not(.hidden)").first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1000);
      const tabsAfter = await page.locator(".charts-tab").allTextContents();
      if (tabsAfter.length !== tabsBefore.length) add("FAIL", set.name, step, `${tabsBefore.length} chart tabs saved, ${tabsAfter.length} came back`);
      if (activeBefore !== null) {
        const index = tabsBefore.lastIndexOf(activeBefore);
        if (index >= 0 && index < tabsAfter.length) await page.locator(".charts-tab").nth(index).click();
        await waitForRedraw(page);
        const csvAfter = await chartCsv(page);
        if (csvAfter.text !== csvBefore.text) add("FAIL", set.name, step, `the reopened chart's numbers differ: ${csvAfter.rows.slice(0, 2).join(" / ")} vs ${csvBefore.rows.slice(0, 2).join(" / ")}`);
      }
      if (!(await canvasDrawn(page))) add("FAIL", set.name, step, "the reopened chart is blank");
    } catch (error) {
      add("FAIL", set.name, step, `the round trip stopped: ${String(error).split("\n")[0]}`);
    }
  }

  // 11. Dark mode: the last chart still draws.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  if (!(await canvasDrawn(page))) add("FAIL", set.name, "dark mode", "blank chart in dark mode");
  await page.screenshot({ path: path.join(OUT, `${set.name}-dark.png`) });

  for (const error of [...new Set(errors)]) add("FAIL", set.name, "console", error.slice(0, 200));
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
      if ((ONLY !== "" && set.name !== ONLY) || SKIP.includes(set.name)) continue;
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
