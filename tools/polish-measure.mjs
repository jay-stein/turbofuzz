// Visual-polish measurement + screenshots. Usage: node tools/polish-measure.mjs [outDir] [dataset=B]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const out = process.argv[2] ?? "polish-shots";
const ds = process.argv[3] ?? "B";
mkdirSync(out, { recursive: true });
const views = [
  [1440, 900, "dark"], [1440, 900, "light"], [622, 691, "dark"], [375, 812, "dark"],
];
const browser = await chromium.launch();
for (const [w, h, scheme] of views) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4173/");
  await page.addScriptTag({ path: "test/polish/turbofuzz-test-data.js" });
  await page.evaluate((d) => window.TF_TEST.load(d), ds);
  await page.waitForTimeout(2500);
  const tabs = await page.$$eval(".view-tabs button", (b) => b.map((x) => x.innerText.trim()));
  const m = await page.evaluate(() => {
    const hh = (s) => { const e = document.querySelector(s); return e && Math.round(e.getBoundingClientRect().height); };
    const sizes = new Set();
    let min = 99;
    for (const e of document.querySelectorAll("body *")) {
      if (!e.getBoundingClientRect().height) continue;
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const f = parseFloat(getComputedStyle(e).fontSize); sizes.add(f); min = Math.min(min, f);
    }
    return { topbar: hh("header.topbar"), nav: hh(".nav-row"), body: hh(".workspace-body"), tableHeader: hh(".table-header"),
      hOverflow: document.documentElement.scrollWidth > innerWidth, minFont: min, sizes: [...sizes].sort((a, b) => a - b),
      tabH: [...document.querySelectorAll(".view-tabs button")].map((b) => Math.round(b.getBoundingClientRect().height)) };
  });
  console.log(`${w}x${h} ${scheme}`, JSON.stringify(m));
  for (let i = 0; i < tabs.length; i++) {
    await page.locator(".view-tabs button").nth(i).click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${ds}-${w}-${scheme}-${i}-${tabs[i].replace(/\W+/g, "_")}.png` });
  }
  await ctx.close();
}
await browser.close();
