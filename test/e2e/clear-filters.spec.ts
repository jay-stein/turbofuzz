import { test, expect } from "@playwright/test";

function csv(): string {
  const rows = ["id,region,amount"];
  for (let i = 0; i < 40; i++) rows.push(`${i},${i % 2 === 0 ? "North" : "South"},${i % 8 === 0 ? "N/A" : i * 3}`);
  return rows.join("\n");
}

test("narrowing the rows shows one Clear all filters button that brings every row back", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(csv()) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  const clear = page.getByRole("button", { name: "Clear all filters" });
  await expect(clear).toBeHidden();
  await page.locator(".health-issues").click();
  await page.locator(".context-item", { hasText: /^View empty cells and junk text/ }).click();
  await expect(page.locator(".count")).toContainText("5 of 40 rows");
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(page.locator(".count")).toContainText(/^40 rows/);
  await expect(clear).toBeHidden();
});
