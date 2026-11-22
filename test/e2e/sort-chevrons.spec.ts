import { test, expect } from "@playwright/test";

const CSV = ["id,name", "2,Bo", "3,Cy", "1,Al"].join("\n");

test("the chevrons beside a column name sort it, the lit one again goes back, and File row's chevron restores file order", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  const firstId = page.locator(".table-rows .tr").first().locator(".td[data-col='0']");
  await expect(firstId).toHaveText("2");

  await page.getByRole("button", { name: "Sort “id” largest first" }).click();
  await expect(firstId).toHaveText("3");
  await page.getByRole("button", { name: "Sort “id” smallest first" }).click();
  await expect(firstId).toHaveText("1");
  await expect(page.getByRole("button", { name: "Sort “id” smallest first" })).toHaveAttribute("aria-pressed", "true");
  // Clicking the lit chevron again goes back to the file's order.
  await page.getByRole("button", { name: "Sort “id” smallest first" }).click();
  await expect(firstId).toHaveText("2");

  await page.getByRole("button", { name: "Sort “name” Z → A" }).click();
  await expect(firstId).toHaveText("3");
  await page.getByRole("button", { name: "File row" }).click();
  const fileOrder = page.getByRole("button", { name: "Back to the file's own order (ascending by the file's row numbers)" });
  await expect(fileOrder).toHaveAttribute("aria-pressed", "false");
  await fileOrder.click();
  await expect(firstId).toHaveText("2");
  await expect(fileOrder).toHaveAttribute("aria-pressed", "true");
});
