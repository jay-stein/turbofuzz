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
