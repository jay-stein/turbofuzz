import { expect, test, type Page } from "@playwright/test";

/** Two years of sales in 20 regions, in two types. */
function sales(): string {
  const lines = ["date,region,type,sales,price"];
  for (let d = 0; d < 720; d += 6) {
    const when = new Date(Date.UTC(2023, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
    for (let r = 0; r < 20; r++) lines.push(`${when},Region ${String(r).padStart(2, "0")},${r % 2 ? "organic" : "conventional"},${(20 - r) * 100 + (d % 50)},${1 + (r % 5) * 0.2 + (d % 11) * 0.01}`);
  }
  return lines.join("\n");
}

async function open(page: Page, size = { width: 1440, height: 900 }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
}

const pick = async (page: Page, ...names: string[]): Promise<void> => {
  for (const name of names) {
    await page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) }).first().click();
  }
  await page.locator(".chart-add-tile").first().click();
  await page.locator(".chart-card:not(.hidden) .chart-canvas").waitFor();
};

const card = (page: Page) => page.locator(".chart-card:not(.hidden)");

test("the whole chart is in view: legend, plot and note, at desktop and laptop sizes", async ({ page }) => {
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await open(page, size);
    await pick(page, "date", "price", "type");
    await page.waitForTimeout(500);
    const legend = (await card(page).locator(".chart-legend").boundingBox())!;
    const plot = (await card(page).locator("canvas.chart-canvas").boundingBox())!;
    const note = (await card(page).locator(".chart-note").boundingBox())!;
    expect(legend.y + legend.height).toBeLessThanOrEqual(plot.y + 1);
    expect(plot.y + plot.height).toBeLessThanOrEqual(size.height);
    expect(note.y + note.height).toBeLessThanOrEqual(size.height);
    expect(plot.height).toBeGreaterThan(300);
    expect(plot.y).toBeLessThan(size.height * 0.4);
    // One headline says what it is; the tab names it.
    await expect(card(page).locator(".chart-headline")).toContainText("Mean of price");
    await expect(page.locator(".charts-tab.active")).toHaveText("price over date by type");
  }
});

test("the wheel over a chart scrolls the page, and Ctrl+wheel zooms", async ({ page }) => {
  await open(page, { width: 1280, height: 600 });
  await pick(page, "date", "price");
  await page.waitForTimeout(400);
  const body = page.locator(".workspace-body");
  const scrollTop = (): Promise<number> => body.evaluate((node) => node.scrollTop);
  const box = (await card(page).locator("canvas.chart-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.wheel(0, 300);
  await expect.poll(scrollTop).toBeGreaterThan(0);
  await body.evaluate((node) => { node.scrollTop = 0; });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(200);
  expect(await scrollTop()).toBe(0);
});

test("a click marks a bar; only Filter to this filters every page", async ({ page }) => {
  await open(page);
  await pick(page, "region", "sales");
  await page.waitForTimeout(400);
  const chips = page.locator(".filter-chip, .chip").filter({ hasText: "region" });
  const box = (await card(page).locator("canvas.chart-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  const bar = card(page).locator(".chart-selection");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Region");
  await expect(chips).toHaveCount(0);
  await bar.getByRole("button", { name: "Filter to this" }).click();
  await expect(bar).toBeHidden();
  await expect(chips).toHaveCount(1);
});

test("twenty categories lie on their side with Top 10, and the type picker keeps the fields and can be undone", async ({ page }) => {
  await open(page);
  await pick(page, "region", "sales");
  await expect(card(page).locator(".chart-note")).toContainText("Top 10 of 20 region");
  await card(page).locator(".chart-kind-button").click();
  const picker = page.getByRole("dialog", { name: "Chart type" });
  await expect(picker).toContainText("How do groups compare?");
  await picker.getByRole("button", { name: "Scatter", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(card(page).locator(".chart-kind-button")).toContainText("Scatter");
  await expect(card(page).locator(".chart-headline")).toContainText(/Scatter: sales vs/);
  // Undo brings the bars back, by button and by keyboard.
  await card(page).getByRole("button", { name: "Undo the last change to this chart" }).click();
  await expect(card(page).locator(".chart-kind-button")).toContainText("Bar");
  await expect(card(page).locator(".chart-note")).toContainText("Top 10 of 20 region");
  await card(page).locator(".chart-kind-button").click();
  await page.getByRole("dialog", { name: "Chart type" }).getByRole("button", { name: "Dot plot", exact: true }).click();
  await expect(card(page).locator(".chart-kind-button")).toContainText("Dot plot");
  await page.keyboard.press("Control+z");
  await expect(card(page).locator(".chart-kind-button")).toContainText("Bar");
});

test("the field list changes the chart, + Add chart opens a new tab, and PNG asks its size when used", async ({ page }) => {
  await open(page);
  await pick(page, "date", "price");
  await page.locator(".chart-rail-field", { hasText: "type" }).click();
  await page.locator(".context-menu .context-item", { hasText: "Group by" }).click();
  await expect(card(page).locator(".chart-legend")).toContainText("organic");
  await expect(page.locator(".chart-rail-field.used", { hasText: "type" })).toHaveCount(1);

  await page.getByRole("button", { name: "+ Add chart" }).click();
  await expect(page.locator(".charts-tab.draft")).toHaveText("New chart");
  await expect(page.locator(".chart-add-panel")).toBeVisible();
  await expect(page.locator(".charts-grid")).toBeHidden();
  await pick(page, "region", "sales");
  await expect(page.locator(".charts-tab")).toHaveCount(2);
  await expect(page.locator(".chart-add-panel")).toBeHidden();

  await expect(page.getByText("PNG size")).toHaveCount(0);
  await card(page).locator(".chart-png-btn").click();
  await expect(page.locator(".context-menu")).toContainText("Download PNG at");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".context-menu .context-item").first().click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});
