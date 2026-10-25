import { test, expect } from "@playwright/test";

test("core surfaces expose accessible names and focusable controls", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "a11y.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("region,amount\nNorth,10\nSouth,20\n"),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });

  await expect(page.getByRole("tab", { name: "Table" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Pivot View" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Data Quality" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Outliers" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Relationships" })).toBeVisible();

  await page.getByRole("tab", { name: "Table" }).click();
  await page.getByRole("button", { name: "Types" }).click();
  const dialog = page.getByRole("dialog", { name: "Convert column types" });
  await expect(dialog).toBeVisible();
  const target = dialog.getByRole("combobox", { name: "Target type for region" });
  await target.selectOption("number");
  await expect(target).toHaveAttribute("aria-description", /re-parsed/);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("tab", { name: "Chart" }).click();
  await page.locator('.charts-rail-tile[aria-disabled="false"]').first().click();
  await page.locator(".chart-setup-modal .primary").click();
  const canvas = page.locator(".chart-card canvas").first();
  await expect(canvas).toHaveAttribute("role", "img");
  await expect(canvas).toHaveAttribute("aria-label", /rows shown/);
});

test("reduced-motion preference disables long transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const duration = await page
    .locator("button")
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  const seconds = duration
    .split(",")
    .map((value) => Number.parseFloat(value));
  expect(Math.max(...seconds)).toBeLessThan(0.02);
});