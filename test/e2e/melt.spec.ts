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

test("Melt picks columns by what they contain and tidies the old headers; Spread brings them back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const csv = ["site,kwh_2019,kwh_2020,cost,kwh_2021", "A,1,2,9,3", "B,4,5,8,6"].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "energy.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();

  await page.getByRole("button", { name: "Melt…" }).click();
  const melt = page.getByRole("dialog", { name: "Melt: wide to long" });
  await melt.getByRole("button", { name: "Keep all" }).click();
  await melt.getByLabel("Select columns by name").fill("kwh");
  await expect(melt.locator(".melt-matchnote").first()).toContainText("3 columns match");
  await melt.getByRole("button", { name: "Select", exact: true }).click();
  await expect(melt.locator(".melt-row.role-unpivot")).toHaveCount(3);
  await expect(melt.locator(".melt-row.role-keep")).toHaveCount(2);
  await melt.getByLabel("Text to remove from the old headers").fill("kwh_");
  await expect(melt.locator(".melt-shape")).toContainText("2019");
  await expect(melt.getByLabel("Name of the column for the old headers")).toHaveValue("year");
  await melt.getByRole("button", { name: /Melt into 6 rows/ }).click();
  await expect(page.locator(".nav-actions button", { hasText: /^Recipe \(1\)/ })).toBeVisible();

  await page.getByRole("button", { name: "Spread…" }).click();
  const spread = page.getByRole("dialog", { name: "Spread: long to wide" });
  await expect(spread).toBeVisible();
  await expect(spread.getByLabel("Column whose values become the new headers")).toHaveValue("2");
  await expect(spread.locator(".melt-count")).toContainText("New columns: 2019, 2020, 2021", { timeout: 10_000 });
  await spread.getByRole("button", { name: /Spread into 3 columns/ }).click();
  await expect(page.locator(".nav-actions button", { hasText: /^Recipe \(2\)/ })).toBeVisible({ timeout: 15_000 });
});
