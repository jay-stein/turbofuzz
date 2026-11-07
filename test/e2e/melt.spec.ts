import { expect, test } from "@playwright/test";

test("the Melt button opens a dialog: keep some columns, stack the others, see the result, apply", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const csv = ["region,2019,2020,2021", "North,10,12,", "South,20,22,24", "East,30,32,34"].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "wide.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();

  await page.getByRole("button", { name: "Melt…" }).click();
  const dialog = page.getByRole("dialog", { name: "Melt: wide to long" });
  await expect(dialog).toBeVisible();
  // The years are stacked and the region kept without being asked; the new column is named for what the headers are.
  await expect(dialog.getByLabel("Name of the column for the old headers")).toHaveValue("year");
  await expect(dialog.locator(".melt-row.role-keep")).toHaveCount(1);
  await expect(dialog.locator(".melt-row.role-unpivot")).toHaveCount(3);
  await expect(dialog.locator(".melt-shape")).toContainText("region");
  await expect(dialog.getByRole("button", { name: /Melt into 9 rows/ })).toBeEnabled();

  // Skipping empty cells leaves out the one missing value.
  await dialog.getByLabel("Skip empty cells").check();
  await expect(dialog.getByRole("button", { name: /Melt into 8 rows/ })).toBeVisible({ timeout: 10_000 });

  // The two new columns cannot share a name.
  await dialog.getByLabel("Name of the column for the cells").fill("year");
  await expect(dialog.locator(".melt-problem")).toContainText("different names");
  await expect(dialog.getByRole("button", { name: /^Melt/ }).last()).toBeDisabled();
  await dialog.getByLabel("Name of the column for the cells").fill("sales");

  await dialog.getByRole("button", { name: /Melt into 8 rows/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".results-bar, .workspace").first()).toContainText("8", { timeout: 15_000 });
  await expect(page.locator(".nav-actions button", { hasText: /^Recipe \(1\)/ })).toBeVisible();
});
