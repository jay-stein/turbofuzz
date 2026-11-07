import { expect, test } from "@playwright/test";

test("boundaries load from a button beside Cities, labels switch off, and the boundaries can be cleared", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "r.csv", mimeType: "text/csv", buffer: Buffer.from("region,sales\nAlpha,10\nBeta,20\nGamma,30\nAlpha,5\n") });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Map" }).first().click();
  await expect(page.getByRole("button", { name: "Clear boundaries" })).toBeHidden();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Boundaries…" }).click()]);
  await chooser.setFiles("test/fixtures/three-regions.geojson");
  await expect(page.getByRole("button", { name: "Clear boundaries" })).toBeVisible({ timeout: 15_000 });
  const labels = page.getByRole("switch", { name: "Show labels on the regions" });
  await expect(labels).toBeChecked();
  await labels.evaluate((e: HTMLInputElement) => e.click());
  await expect(labels).not.toBeChecked();
  await expect(page.getByLabel("Label regions with")).toHaveValue("");
  await labels.evaluate((e: HTMLInputElement) => e.click());
  await expect(labels).toBeChecked();
  await page.getByRole("button", { name: "Clear boundaries" }).click();
  await expect(page.getByRole("button", { name: "Clear boundaries" })).toBeHidden();
});
