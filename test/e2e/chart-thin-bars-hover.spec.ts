import { test, expect } from "@playwright/test";

/** Two years of dates, two types: a Bar of date by type is about a hundred weeks of two thin bars. */
function sales(): string {
  const day = (d: number): string => new Date(Date.UTC(2023, 0, 1 + d)).toISOString().slice(0, 10);
  const rows = ["date,region,type,sales"];
  for (let d = 0; d < 720; d += 6) for (let r = 0; r < 12; r++) rows.push(`${day(d)},Region ${r},${r % 2 ? "organic" : "conventional"},${(20 - r) * 100 + (d % 50)}`);
  return rows.join("\n");
}

test("bars too thin to aim at still answer the pointer: the week's column names every series there", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  if ((await page.locator(".chart-add-panel:not(.hidden)").count()) === 0) await page.getByRole("button", { name: "+ Add chart" }).click();
  for (const name of ["date", "type"]) await page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) }).click();
  await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type", { hasText: "Bar" }).click();
  const card = page.locator(".chart-card:not(.hidden)");
  await expect(card.locator(".chart-note")).toContainText("advances left to right");
  const box = (await card.locator("canvas.chart-canvas").first().boundingBox())!;
  // Anywhere up the column, not only on a pixel-wide bar.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
  const tip = card.locator(".chart-tooltip:not(.hidden)");
  await expect(tip).toBeVisible();
  await expect(tip.locator(".chart-tooltip-title")).toContainText("Rows");
  await expect(tip.locator(".chart-tooltip-row")).toHaveText([/^conventional: \d+$/, /^organic: \d+$/]);
});
