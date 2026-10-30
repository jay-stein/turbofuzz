import { test, expect, type Page } from "@playwright/test";

/** 1,000 rows whose id is their file row number. */
function rows(): string {
  const lines = ["id,region,amount"];
  for (let i = 1; i <= 1000; i++) lines.push(`${i},${["North", "South", "East", "West"][i % 4]},${(i * 37) % 1000}`);
  return lines.join("\n");
}

async function openTable(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "rows.csv", mimeType: "text/csv", buffer: Buffer.from(rows()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator(".table-nav-pos")).toHaveText(/^Rows 1–\d+ of 1,000$/);
}

const firstId = (page: Page) => page.locator(".table-rows .tr").first().locator(".td").nth(1);
const order = (page: Page) => page.locator(".table-nav-order");

test("the bar says where you are; Go to reaches a row, the end and a column", async ({ page }) => {
  await openTable(page);
  await page.keyboard.press("Control+g");
  const box = page.getByRole("textbox", { name: "Go to a row or column" });
  await box.fill("250");
  await box.press("Enter");
  await expect(page.locator(".tr.flash-row .td").nth(1)).toHaveText("250");
  await expect(page.locator(".table-nav-pos")).toHaveText(/^Rows \d{3}–\d{3} of 1,000$/);

  await page.keyboard.press("Control+End");
  await expect(page.locator(".table-nav-pos")).toHaveText(/–1,000 of 1,000$/);
  await page.getByRole("button", { name: "Top" }).click();
  await expect(page.locator(".table-nav-pos")).toHaveText(/^Rows 1–/);

  // Out of range is explained in the box, which stays open.
  await page.keyboard.press("Control+g");
  await box.fill("2000");
  await box.press("Enter");
  await expect(page.locator(".table-goto-msg")).toContainText("1,000 rows");
  await box.fill("amount");
  await box.press("Enter");
  await expect(page.locator(".table-goto")).toBeHidden();
});

test("reverse, file row numbers that stay with the row, and back to file order", async ({ page }) => {
  await openTable(page);
  await expect(order(page)).toHaveText("file order");

  await page.getByRole("button", { name: "Reverse" }).click();
  await expect(firstId(page)).toHaveText("1000");
  await expect(order(page)).toHaveText("file order, reversed");

  await page.getByRole("button", { name: "File row" }).click();
  await expect(page.locator(".table-rows .tr").first().locator(".td.file-row")).toHaveText("1000");

  // File row 10 is found wherever the order put it.
  await page.keyboard.press("Control+g");
  await page.getByRole("textbox", { name: "Go to a row or column" }).fill("file 10");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tr.flash-row .td.file-row")).toHaveText("10");

  await page.getByRole("button", { name: "Back to file order" }).click();
  await expect(order(page)).toHaveText("file order");
  await expect(firstId(page)).toHaveText("1");
  // The File row column is remembered.
  await page.reload();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "rows.csv", mimeType: "text/csv", buffer: Buffer.from(rows()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.getByRole("button", { name: "File row" })).toHaveAttribute("aria-pressed", "true");
});

test("goto and reverse work from the command bar", async ({ page }) => {
  await openTable(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("goto -1");
  await page.keyboard.press("Enter");
  await expect(page.locator(".table-nav-pos")).toHaveText(/–1,000 of 1,000$/);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("reverse");
  await page.keyboard.press("Enter");
  await expect(order(page)).toHaveText("file order, reversed");
});
