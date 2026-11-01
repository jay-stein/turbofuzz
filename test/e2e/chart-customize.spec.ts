import { expect, test } from "@playwright/test";

test("the Customize drawer has a visible Done, the toggle says so, and Escape closes it from anywhere in the card", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  const csv = "region,sales\n" + Array.from({ length: 30 }, (_, i) => `${["N", "S", "E"][i % 3]},${10 + i}`).join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type").first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").first().waitFor();
  const toggle = page.locator(".chart-sidebar-toggle").first();
  const drawer = page.locator(".chart-sidebar").first();
  await expect(toggle).toHaveText("Customize");
  await toggle.click();
  await expect(drawer).toBeVisible();
  await expect(toggle).toHaveText("Done");
  // The drawer's own Done closes it.
  await drawer.getByRole("button", { name: "Close the settings drawer" }).click();
  await expect(drawer).toBeHidden();
  await expect(toggle).toHaveText("Customize");
  // Escape closes it even when focus is on the chart, not in the drawer.
  await toggle.click();
  await expect(drawer).toBeVisible();
  await page.locator("canvas.chart-canvas").first().focus();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
