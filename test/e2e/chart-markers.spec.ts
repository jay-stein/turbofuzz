import { test, expect, type Page } from "@playwright/test";

function points(): string {
  const lines = ["dist,price,kind"];
  for (let i = 0; i < 400; i++) {
    const d = ((i * 7919) % 1000) / 10;
    lines.push(`${d},${(d * 3 + ((i * 31) % 40)).toFixed(1)},${i % 3}`);
  }
  return lines.join("\n");
}

async function openScatter(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(points()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /scatter/i }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").waitFor();
}

test("a scatter has shape, size and opacity settings, a dashed best-fit line with R², and reference lines", async ({ page }) => {
  await openScatter(page);

  // Dots are circles unless chosen, with their own size and opacity.
  await expect(page.getByLabel("Dot shape")).toHaveValue("circle");
  await expect(page.getByLabel("Dot shape").locator("option")).toHaveText(["Circle", "Square", "Diamond", "Triangle"]);
  await expect(page.getByLabel("Smallest dot radius (pixels)")).toHaveValue("2.2");
  await expect(page.getByLabel("Dot opacity")).toHaveValue("55");
  await page.getByLabel("Dot shape").selectOption("diamond");
  await page.getByLabel("Smallest dot radius (pixels)").fill("4");

  // The line of best fit and its R² are on by default; R² follows the line.
  await expect(page.getByLabel("Line of best fit")).toBeChecked();
  await expect(page.getByLabel("Show R squared")).toBeChecked();
  await page.getByLabel("Line of best fit").uncheck();
  await expect(page.getByLabel("Show R squared")).toBeDisabled();
  await page.getByLabel("Line of best fit").check();
  await expect(page.getByLabel("Show R squared")).toBeEnabled();

  // A horizontal line at the mean of price, and a vertical one at a typed value.
  await page.getByRole("button", { name: "+ Add a line" }).click();
  const row = page.locator(".chart-ref-row").first();
  await expect(row.getByLabel("Line direction")).toHaveValue("y");
  await row.getByLabel("Where the line sits").selectOption("mean");
  await expect(row.getByLabel("Value of the line")).toBeHidden();
  await page.getByRole("button", { name: "+ Add a line" }).click();
  const second = page.locator(".chart-ref-row").nth(1);
  await second.getByLabel("Line direction").selectOption("x");
  await second.getByLabel("Value of the line").fill("50");
  await expect(page.locator(".chart-ref-row")).toHaveCount(2);
  await second.getByRole("button", { name: "Remove this line" }).click();
  await expect(page.locator(".chart-ref-row")).toHaveCount(1);

  // Style (heat and contour lines) belongs to the heat-map render: greyed out for plain points, live once it is chosen.
  await expect(page.getByLabel("Density style")).toBeDisabled();
  await page.getByLabel("Render mode").selectOption("density");
  await expect(page.getByLabel("Density style")).toBeEnabled();
  await page.getByLabel("Render mode").selectOption("points");
  await expect(page.getByLabel("Density style")).toBeDisabled();

  // The reference-line controls stay inside the settings panel.
  const panel = await page.locator(".chart-sidebar").boundingBox();
  const select = await page.locator(".chart-ref-row").first().getByLabel("Where the line sits").boundingBox();
  expect(select!.x + select!.width).toBeLessThanOrEqual(panel!.x + panel!.width);

  // The palette file loader is gone.
  await expect(page.getByRole("button", { name: /Load JSON/ })).toHaveCount(0);
});
