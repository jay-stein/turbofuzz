import { expect, test } from "@playwright/test";

test("the settings sit beside the plot and can be put away, without covering it either way", async ({ page }) => {
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
  const canvas = page.locator("canvas.chart-canvas").first();
  await canvas.waitFor();
  const toggle = page.locator(".chart-sidebar-toggle").first();
  const panel = page.locator(".chart-sidebar").first();
  await expect(toggle).toHaveText("Hide settings");
  await expect(panel).toBeVisible();
  const open = (await canvas.boundingBox())!;
  const beside = (await panel.boundingBox())!;
  expect(open.x + open.width).toBeLessThanOrEqual(beside.x);
  await toggle.click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveText("Customize");
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(open.width + 100);
  // Escape does not take the panel away from under a person using it.
  await toggle.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
});
