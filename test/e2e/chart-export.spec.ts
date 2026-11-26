import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/** Four regions of daily sales. */
function sales(): string {
  const lines = ["date,region,sales"];
  for (let d = 0; d < 200; d++) {
    for (let r = 0; r < 4; r++) lines.push(`${new Date(Date.UTC(2024, 0, 1) + d * 86_400_000).toISOString().slice(0, 10)},R${r},${100 + ((d * 7 + r * 13) % 50)}`);
  }
  return lines.join("\n");
}

/** The app in dark colours, with a bar chart of sales by region. */
async function barChart(page: Page): Promise<void> {
  await chart(page, ["region", "sales"], "Bar");
}

async function chart(page: Page, fields: string[], type: string): Promise<void> {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
  for (const name of fields) {
    await page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) }).click();
  }
  await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type", { hasText: type }).click();
  await page.locator(".chart-card:not(.hidden) .chart-canvas").waitFor();
}

/** Hovers across the middle of the plot until a tooltip shows; returns its text. */
async function hoverPlot(page: Page): Promise<string> {
  const box = (await page.locator(".chart-card:not(.hidden) canvas.chart-canvas").boundingBox())!;
  const tip = page.locator(".chart-card:not(.hidden) .chart-tooltip:not(.hidden)");
  for (let fx = 0.3; fx < 0.9; fx += 0.05) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.5);
    if (await tip.isVisible()) return tip.innerText();
  }
  return "";
}

async function openExports(page: Page): Promise<void> {
  await page.locator(".chart-card:not(.hidden) .chart-more").click();
  await page.getByRole("menuitem", { name: "Download PNG" }).click();
}

/** The colour of one pixel of a PNG, read in the page. */
async function pixel(page: Page, png: Buffer, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    async ({ data, x, y }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return [...ctx.getImageData(x, y, 1, 1).data];
    },
    { data: png.toString("base64"), x, y },
  );
}

test("a PNG export is light by default while the app is dark, and Dark draws it dark", async ({ page }) => {
  await barChart(page);
  await openExports(page);
  await expect(page.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
  let download = page.waitForEvent("download");
  await page.getByRole("menuitemradio", { name: "1280 × 720" }).click();
  const light = readFileSync((await (await download).path())!);
  const [r, g, b] = await pixel(page, light, 4, 4);
  expect(Math.min(r!, g!, b!)).toBeGreaterThan(230);
  // The app stays dark: the export borrowed the light colours only while it drew.
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();

  await openExports(page);
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  // Picking colours reopens the menu, with the choice ticked.
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  download = page.waitForEvent("download");
  await page.getByRole("menuitemradio", { name: "1280 × 720" }).click();
  const dark = readFileSync((await (await download).path())!);
  const [dr, dg, db] = await pixel(page, dark, 4, 4);
  expect(Math.max(dr!, dg!, db!)).toBeLessThan(80);
});

test("a web page export shows each bar's details on hover, with the lines the analyst chose", async ({ page, browser }) => {
  await barChart(page);
  await openExports(page);
  await page.getByRole("menuitemradio", { name: /Interactive web page/ }).click();
  const dialog = page.getByRole("dialog", { name: "Interactive web page" });
  await dialog.getByRole("textbox", { name: "Call Name of the mark" }).fill("Region");
  await dialog.getByRole("textbox", { name: "Call Sum of sales" }).fill("Revenue");
  await dialog.getByRole("textbox", { name: "Your own line under every hover" }).fill("Source: test ledger");
  await dialog.getByRole("checkbox", { name: /Show the chart's facts/ }).uncheck();
  await expect(dialog.locator(".chart-html-preview")).toHaveText(/Region: R\dRevenue: [\d,]+Source: test ledger/);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download .html" }).click();
  const file = test.info().outputPath("chart.html");
  await (await download).saveAs(file);
  await expect(dialog).toBeHidden();

  const view = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors: string[] = [];
  view.on("pageerror", (error) => errors.push(error.message));
  await view.goto(pathToFileURL(file).href);
  await expect(view.locator("h1")).toHaveText("Bar: Sum of sales by region");
  const box = (await view.locator(".chart img").boundingBox())!;
  await view.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.6);
  await expect(view.locator(".tip")).toBeVisible();
  await expect(view.locator(".tip")).toHaveText(/^Region: R1Revenue: [\d,]+Source: test ledger$/);
  await view.mouse.move(box.x + 2, box.y + 2);
  await expect(view.locator(".tip")).toBeHidden();
  expect(errors).toEqual([]);
  await view.close();
});

test("a line split by group hovers every line's value on screen and in the web page", async ({ page, browser }) => {
  await chart(page, ["date", "sales", "region"], "Line");
  await page.waitForTimeout(300);
  // One line at a time: the nearest one, its colour beside its name, and a ring on its point.
  const onScreen = await hoverPlot(page);
  expect(onScreen).toMatch(/^R\d\ndate[^:\n]*: .+\n(Sum|Average) of sales: [\d,.]+/);
  expect(onScreen.match(/\bR\d\b/g)).toHaveLength(1);
  const swatch = page.locator(".chart-card:not(.hidden) .chart-tooltip .chart-tooltip-swatch");
  await expect(swatch).toBeVisible();
  const dot = page.locator(".chart-card:not(.hidden) .chart-hover-dot");
  await expect(dot).toBeVisible();
  const ring = await dot.evaluate((node) => getComputedStyle(node).borderTopColor);
  expect(ring).toBe(await swatch.evaluate((node) => getComputedStyle(node).backgroundColor));
  await page.mouse.move(0, 0);
  await expect(dot).toBeHidden();

  await openExports(page);
  await page.getByRole("menuitemradio", { name: /Interactive web page/ }).click();
  const dialog = page.getByRole("dialog", { name: "Interactive web page" });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download .html" }).click();
  const file = test.info().outputPath("lines.html");
  await (await download).saveAs(file);
  const view = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await view.goto(pathToFileURL(file).href);
  const box = (await view.locator(".chart img").boundingBox())!;
  await view.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(view.locator(".tip")).toBeVisible();
  const inPage = await view.locator(".tip").innerText();
  expect(inPage).toMatch(/^R\d\ndate[^:\n]*: .+\n(Sum|Average) of sales: [\d,.]+/);
  expect(inPage.match(/\bR\d\b/g)).toHaveLength(1);
  await expect(view.locator(".tip .swatch")).toBeVisible();
  await expect(view.locator(".hl.ring")).toBeVisible();
  await view.close();
});

test("a histogram split by group hovers each group's share of its rows in the bin", async ({ page }) => {
  await chart(page, ["sales", "region"], "Histogram");
  await page.waitForTimeout(300);
  const text = await hoverPlot(page);
  expect(text).toMatch(/^R\d\nsales: .+ – .+\nShare of its rows: [\d.]+%\nRows: [\d,]+/);
  expect(text.match(/\bR\d\b/g)).toHaveLength(1);
});
