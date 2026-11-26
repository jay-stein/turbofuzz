import { expect, test } from "@playwright/test";

/** Opens a bar chart of sales by region on the Chart page. */
async function salesChart(page: import("@playwright/test").Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  const lines = ["day,region,sales"];
  for (let i = 0; i < 90; i++) lines.push(`2024-${String(1 + Math.floor(i / 30)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")},${["N", "S", "E"][i % 3]},${10 + i}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  const field = (name: string) => page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) });
  await field("region").click();
  await field("sales").click();
  await page.locator(".chart-add-recs .chart-add-tile").first().click();
}

test("a reference line is drawn at its value, stretches the axis, and stays through a chart type change", async ({ page }) => {
  await salesChart(page);
  const card = page.locator(".chart-card:not(.hidden)");
  const canvas = card.locator("canvas.chart-canvas");
  await card.locator(".chart-side-group", { has: page.locator(".chart-side-group-name", { hasText: "Refine" }) }).locator("summary").click();
  await card.getByRole("button", { name: "+ Add a line" }).click();
  const value = card.getByLabel("Value of the line");
  await value.fill("1,000");
  // Above every bar: the axis stretches so the line is in view.
  await expect(canvas).toHaveAttribute("data-ref-lines", /^y:1000@/);
  await value.fill("1,5");
  await expect(card.locator(".chart-ref-error")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-ref-lines", /^y:1000@/, { timeout: 2000 });
  await value.fill("500");
  await expect(card.locator(".chart-ref-error")).toBeHidden();
  await expect(canvas).toHaveAttribute("data-ref-lines", /^y:500@/);

  await card.getByRole("button", { name: "Chart type", exact: true }).click();
  await page.locator(".chart-kind-option:not([disabled])", { hasText: "Line" }).first().click();
  await expect(canvas).toHaveAttribute("data-ref-lines", /y:500@/);
});
