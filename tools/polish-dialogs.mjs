// Screenshots the dialogs/panels the main-tab sweep skips. Usage: node tools/polish-dialogs.mjs [outDir]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const out = process.argv[2] ?? "polish-dialogs";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [w, h, scheme] of [[1440, 900, "dark"], [1440, 900, "light"], [375, 812, "dark"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
  const page = await ctx.newPage();
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${w}-${scheme}-${name}.png` }); };
  await page.goto("http://127.0.0.1:4173/");
  await page.addScriptTag({ path: "test/polish/turbofuzz-test-data.js" });
  await page.evaluate(() => window.TF_TEST.load("B"));
  await page.waitForSelector(".nav-row", { state: "visible", timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  const closeAll = async () => { for (let i = 0; i < 3; i++) await page.keyboard.press("Escape"); await page.waitForTimeout(200); };
  const open = async (label, fn) => { try { await fn(); await shot(label); } catch (e) { console.log(w, scheme, label, "FAILED", String(e).split("\n")[0]); } await closeAll(); };

  await open("help", async () => { await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Help" || b.getAttribute("aria-label") === "More")?.click()); if (w < 720) await page.getByRole("menuitem", { name: "Help" }).click(); });
  await page.keyboard.press("Escape");
  await open("palette", async () => { await page.keyboard.press("Control+k"); await page.keyboard.type("upper"); });
  // Apply a change so Recipe has a step.
  await page.keyboard.press("Control+k"); await page.keyboard.type("upper city"); await page.waitForTimeout(400); await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  await shot("confirm");
  await page.getByRole("button", { name: "Apply" }).click(); await page.waitForTimeout(1200);
  const act = async (name) => { if (w < 900) { await page.locator(".nav-actions-menu").click(); await page.getByRole("menuitem", { name }).click(); } else { await page.locator(".nav-actions button", { hasText: name }).first().click(); } };
  await open("export", () => act("Export"));
  await open("recipe", () => act("Recipe"));
  await open("convert-types", () => act("Convert types"));
  await page.locator(".view-tabs button", { hasText: "Outliers" }).click(); await page.waitForTimeout(1500);
  await open("outlier-detail", async () => { await page.getByRole("button", { name: /Inspect the top outlier/ }).click(); await page.waitForTimeout(1500); });
  await page.locator(".view-tabs button", { hasText: "Table" }).click(); await page.waitForTimeout(500);
  await open("column-inspector", async () => { await page.locator(".th-label").first().click(); });
  await open("filter-popover", async () => { await page.locator(".th-filter").first().click(); });
  await ctx.close();
}
await browser.close();
