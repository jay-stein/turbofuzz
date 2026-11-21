import { test, expect } from "@playwright/test";

/** Mixed-case spellings and junk text: things Data Quality counts as needing a fix. */
function messyCsv(): string {
  const rows = ["id,region,amount"];
  const regions = ["North", "north", "NORTH", "South", "south"];
  for (let i = 0; i < 80; i++) rows.push(`${i},${regions[i % regions.length]},${i % 9 === 0 ? "N/A" : i * 3}`);
  return rows.join("\n");
}

test("a table with problems gets one bar that leads to Data Quality, and it stays closed", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "messy.csv", mimeType: "text/csv", buffer: Buffer.from(messyCsv()) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  const bar = page.locator(".qa-nudge");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/Data quality \d+\.\d: \d+ things? needs? fixing/);
  await bar.getByRole("button", { name: "Open Data Quality" }).click();
  await expect(page.locator(".quality-page")).toBeVisible();
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(bar).toBeHidden();
});

test("a clean table gets no bar", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "clean.csv", mimeType: "text/csv", buffer: Buffer.from("id,name\n1,Ann\n2,Bo\n3,Cy\n") });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator(".table-host")).toBeVisible();
  await expect(page.locator(".qa-nudge")).toBeHidden();
});
