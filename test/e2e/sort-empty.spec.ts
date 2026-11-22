import { test, expect } from "@playwright/test";

const CSV = ["id,amount", "1,", "2,30", "3,NA", "4,10", "5,20"].join("\n");

test("a sort keeps empty cells at the end both ways, and one click hides them", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "a.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  const amounts = page.locator(".table-rows .tr .td[data-col='1']");

  await page.getByRole("button", { name: "Sort “amount” largest first" }).click();
  await expect(amounts.first()).toHaveText("30");
  await page.getByRole("button", { name: "Sort “amount” smallest first" }).click();
  await expect(amounts.first()).toHaveText("10");
  await expect(page.locator(".table-nav-empty")).toContainText("2 empty at the end");

  await page.locator(".table-nav-empty").getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".count")).toContainText("3 of 5 rows");
  await expect(page.locator(".table-nav-empty")).toBeHidden();
  await expect(amounts).toHaveText(["10", "20", "30"]);
});
