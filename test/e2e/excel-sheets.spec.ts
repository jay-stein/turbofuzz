import { test, expect, type Page } from "@playwright/test";
import { buildXlsx, type Sheet } from "../../src/ui/xlsx-writer.js";

async function openWorkbook(page: Page, sheets: Sheet[]): Promise<void> {
  const bytes = await buildXlsx(sheets);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "sales.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
  await expect(page.getByRole("group", { name: "Worksheets" })).toBeVisible();
}

const contents: Sheet = { name: "Contents", headers: ["About this workbook"], rows: [["Sales by month"]] };
const jan: Sheet = { name: "Jan", headers: ["id", "amount", "region"], rows: [["1", "10", "North"], ["2", "20", "South"]] };
const feb: Sheet = { name: "Feb", headers: ["region", "id", "amount"], rows: [["East", "3", "30"]] };
const headers = (page: Page) => page.locator(".table-header .th-label").allInnerTexts();
const sheet = (page: Page, name: string) => page.getByRole("group", { name: "Worksheets" }).getByLabel(name, { exact: true });

async function openTable(page: Page): Promise<void> {
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Table" }).click();
}

test("every worksheet starts ticked; a contents page blocks combining until it is unticked", async ({ page }) => {
  await openWorkbook(page, [contents, jan, feb]);
  for (const name of ["Contents", "Jan", "Feb"]) await expect(sheet(page, name)).toBeChecked();
  const go = page.locator(".sheet-go");
  await expect(go).toBeDisabled();
  await expect(page.locator(".sheet-note")).toHaveText("“Contents” has 1 column and the others have 3: untick it to combine the rest.");

  await sheet(page, "Contents").uncheck();
  await expect(go).toHaveText("Combine 2 worksheets");
  await expect(page.getByLabel(/Add a column excel_worksheetname/)).toBeChecked();
  await go.click();
  await openTable(page);
  await expect(page.locator(".count").first()).toContainText("3 rows");
  await expect.poll(() => headers(page)).toEqual(["id", "amount", "region", "excel_worksheetname"]);
  const column = (i: number) => page.locator(`.tr .td[data-col="${i}"]`).allInnerTexts();
  await expect.poll(() => column(3)).toEqual(["Jan", "Jan", "Feb"]);
  await expect.poll(() => column(2)).toEqual(["North", "South", "East"]);
});

test("None, then tick one: that worksheet loads on its own", async ({ page }) => {
  await openWorkbook(page, [contents, jan, feb]);
  await page.getByRole("button", { name: "None" }).click();
  await expect(page.locator(".sheet-go")).toBeDisabled();
  await expect(page.getByLabel(/Add a column excel_worksheetname/)).toBeHidden();
  await sheet(page, "Feb").check();
  await expect(page.locator(".sheet-go")).toHaveText("Load “Feb”");
  await page.locator(".sheet-go").click();
  await openTable(page);
  await expect(page.locator(".count").first()).toContainText("1 row");
  await expect.poll(() => headers(page)).toEqual(["region", "id", "amount"]);
});

test("combining without the sheet-name column", async ({ page }) => {
  await openWorkbook(page, [jan, feb]);
  await page.getByLabel(/Add a column excel_worksheetname/).uncheck();
  await page.locator(".sheet-go").click();
  await openTable(page);
  await expect.poll(() => headers(page)).toEqual(["id", "amount", "region"]);
});

test("same number of columns but different names: combining explains which sheet differs", async ({ page }) => {
  const staff: Sheet = { name: "Staff", headers: ["id", "name", "team"], rows: [["7", "Ada", "Ops"]] };
  await openWorkbook(page, [jan, staff]);
  await page.locator(".sheet-go").click();
  await expect(page.locator(".status.error, .error").first()).toContainText(
    "These worksheets can't be combined: “Staff” is missing “amount” and “region”, and has “name” and “team”, which “Jan” does not. Load one at a time instead.",
  );
});
