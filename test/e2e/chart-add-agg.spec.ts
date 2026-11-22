import { test, expect } from "@playwright/test";

test("a measure picked in Add a chart is combined through one small menu, not click-to-cycle", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  const csv = ["region,sales", ...Array.from({ length: 40 }, (_, i) => `${["North", "South", "East"][i % 3]},${(100 + ((i * 37) % 9) + 0.5).toFixed(1)}`)].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "s.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  const field = (name: string) => page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) });
  await field("sales").click();
  await field("region").click();
  const menu = page.getByLabel("How sales is combined");
  await expect(menu).toBeVisible();
  await expect(menu.locator("option")).toHaveText(["Sum", "Average", "Median", "Min", "Max"]);
  await menu.selectOption("max");
  await expect(page.getByLabel("How sales is combined")).toHaveValue("max");
  await expect(page.getByLabel("How sales is combined")).toBeFocused();
});
