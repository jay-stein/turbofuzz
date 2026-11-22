import { test, expect } from "@playwright/test";

const CSV = "id,region,amount\n1,North,10\n2,South,20\n3,North,30\n";

test("resting on a column name shows its inspector; moving away closes it and a click keeps it", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  const label = page.locator(".th-label", { hasText: /^region$/ });
  const panel = page.locator(".column-inspector");

  await label.hover();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/hover/);
  await expect(panel).toContainText("region");
  // With one open, the next header's panel swaps in at once.
  await page.locator(".th-label", { hasText: /^amount$/ }).hover();
  await expect(panel).toHaveAttribute("aria-label", "About column “amount”", { timeout: 60 });
  await page.mouse.move(5, 5);
  await expect(panel).toBeHidden();

  await label.hover();
  await expect(panel).toBeVisible();
  await label.click();
  await expect(panel).not.toHaveClass(/hover/);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400); // longer than the hover grace period
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("double-clicking a column name renames it in place; Escape keeps the old name", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  await page.locator(".th-label", { hasText: /^region$/ }).dblclick();
  const box = page.locator(".th-rename");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("region");
  // The inspector the first click opened gets out of the way.
  await expect(page.locator(".column-inspector")).toBeHidden();
  await box.fill("area");
  await box.press("Enter");
  await expect(page.locator(".th-label", { hasText: /^area$/ })).toBeVisible();
  await expect(page.locator(".th-label", { hasText: /^region$/ })).toHaveCount(0);

  await page.locator(".th-label", { hasText: /^amount$/ }).dblclick();
  await page.locator(".th-rename").fill("nope");
  await page.locator(".th-rename").press("Escape");
  await expect(page.locator(".th-label", { hasText: /^amount$/ })).toBeVisible();
});

test("every column name to snake_case from the header menu, and Undo puts them back", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from("Order ID,Ship Region,amount\n1,North,10\n2,South,20\n") });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  await page.locator(".th-label", { hasText: /^amount$/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /All column names/ }).click();
  await page.getByRole("menuitem", { name: /^snake_case/ }).click();
  await expect(page.locator(".th-label", { hasText: /^order_id$/ })).toBeVisible();
  await expect(page.locator(".th-label", { hasText: /^ship_region$/ })).toBeVisible();
  await expect(page.locator(".toast")).toContainText("Renamed 2 columns to snake_case");
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".th-label", { hasText: /^Order ID$/ })).toBeVisible();
});
