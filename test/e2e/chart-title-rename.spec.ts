import { test, expect } from "@playwright/test";

test("double-clicking a chart's headline renames it, and the tab follows", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  const csv = ["score,team", ...Array.from({ length: 60 }, (_, i) => `${(i * 37) % 100},${["red", "blue"][i % 2]}`)].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "t.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /^Histogram$/ }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  const card = page.locator(".chart-card:not(.hidden)");
  await card.locator(".chart-headline .chart-summary").dblclick();
  const box = card.locator(".chart-title-edit");
  await expect(box).toBeFocused();
  await box.fill("Score spread");
  await box.press("Enter");
  await expect(box).toHaveCount(0);
  await expect(page.locator(".charts-tab.active")).toContainText("Score spread");
  // Escape leaves the name as it was.
  await card.locator(".chart-headline .chart-summary").dblclick();
  await card.locator(".chart-title-edit").fill("Something else");
  await card.locator(".chart-title-edit").press("Escape");
  await expect(page.locator(".charts-tab.active")).toContainText("Score spread");
});
