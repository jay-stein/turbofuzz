import { test, expect, type Page } from "@playwright/test";
import { buildXlsx, type Sheet } from "../../src/ui/xlsx-writer.js";

async function openWorkbook(page: Page, sheets: Sheet[]): Promise<void> {
  const bytes = await buildXlsx(sheets);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "sales.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
  await expect(page.locator(".table-option").first()).toBeVisible();
}

const jan: Sheet = { name: "Jan", headers: ["id", "amount", "region"], rows: [["1", "10", "North"], ["2", "20", "South"]] };
const feb: Sheet = { name: "Feb", headers: ["region", "id", "amount"], rows: [["East", "3", "30"]] };
const headers = (page: Page) => page.locator(".table-header .th-label").allInnerTexts();

test("worksheets with the same columns combine into one table, with excel_worksheetname by default", async ({ page }) => {
  await openWorkbook(page, [jan, feb]);
  const combine = page.getByRole("button", { name: /Combine all 2 worksheets/ });
  await expect(combine).toBeEnabled();
  await expect(page.getByLabel(/Add a column excel_worksheetname/)).toBeChecked();
  await combine.click();
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await expect(page.locator(".count").first()).toContainText("3 rows");
  await page.getByRole("tab", { name: "Table" }).click();
  await expect.poll(() => headers(page)).toEqual(["id", "amount", "region", "excel_worksheetname"]);
  const column = (i: number) => page.locator(`.tr .td[data-col="${i}"]`).allInnerTexts();
  await expect.poll(() => column(3)).toEqual(["Jan", "Jan", "Feb"]);
  await expect.poll(() => column(2)).toEqual(["North", "South", "East"]);
});

test("unticking the box combines without the sheet-name column", async ({ page }) => {
  await openWorkbook(page, [jan, feb]);
  await page.getByLabel(/Add a column excel_worksheetname/).uncheck();
  await page.getByRole("button", { name: /Combine all 2 worksheets/ }).click();
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Table" }).click();
  await expect.poll(() => headers(page)).toEqual(["id", "amount", "region"]);
});

test("worksheets with different columns cannot be combined, and one sheet still loads", async ({ page }) => {
  const notes: Sheet = { name: "Notes", headers: ["note"], rows: [["hello"]] };
  await openWorkbook(page, [jan, notes]);
  const combine = page.getByRole("button", { name: /Combine all 2 worksheets/ });
  await expect(combine).toBeDisabled();
  await expect(combine).toContainText("the worksheets have different columns");
  await page.locator(".table-option", { hasText: "Jan" }).click();
  await page.locator(".nav-row").waitFor();
  await expect(page.locator(".count").first()).toContainText("2 rows");
});

test("same number of columns but different names: combining explains which sheet differs", async ({ page }) => {
  const other: Sheet = { name: "Staff", headers: ["id", "name", "team"], rows: [["7", "Ada", "Ops"]] };
  await openWorkbook(page, [jan, other]);
  await page.getByRole("button", { name: /Combine all 2 worksheets/ }).click();
  await expect(page.locator(".status.error, .error").first()).toContainText(
    "These worksheets can't be combined: “Staff” is missing “amount” and “region”, and has “name” and “team”, which “Jan” does not. Load one at a time instead.",
  );
});
