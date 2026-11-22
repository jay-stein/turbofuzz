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

test("clicking a bar offers Delete, this bar's colours and colour maps for all bars", async ({ page }) => {
  await open(page);
  await pick(page, "region", "sales");
  await page.waitForTimeout(400);
  const canvas = card(page).locator("canvas.chart-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  const strip = card(page).locator(".chart-selection");
  await expect(strip).toBeVisible();
  const name = (await strip.locator(".chart-selection-name").textContent()) ?? "";
  // The colours are there at once: this bar's swatches and the maps for all bars.
  await expect(strip.locator(".chart-mark-colors .chart-swatch").first()).toBeVisible();
  await expect(strip.locator(".chart-map-row")).toContainText("All bars");
  const pixels = (): Promise<string> => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const before = await pixels();
  await strip.getByRole("button", { name: /rocket/ }).click();
  await expect.poll(pixels).not.toBe(before);
  if (process.env.SHOT_DIR) await card(page).screenshot({ path: `${process.env.SHOT_DIR}/bar-strip.png` });

  await strip.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(strip).toBeHidden();
  await expect(card(page)).toContainText(name.trim());
  // Right-click says Delete and Recolour in plain words.
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3, { button: "right" });
  await expect(page.locator(".context-menu")).toContainText(/Recolour “.+”…/);
  await expect(page.locator(".context-menu")).toContainText(/Delete “.+” from this chart/);
  await expect(page.locator(".context-menu")).toContainText(/Bring back everything deleted from this chart \(1\)/);
});

test("right-click on a chart's tab renames it", async ({ page }) => {
  await open(page);
  await pick(page, "region", "sales");
  await page.locator(".charts-tab.active").click({ button: "right" });
  await page.locator(".context-menu").getByText("Rename chart").click();
  const input = page.locator(".charts-tab-rename");
  await expect(input).toBeFocused();
  await input.fill("Sales by region");
  await input.press("Enter");
  await expect(page.locator(".charts-tab.active")).toHaveText("Sales by region");
});
