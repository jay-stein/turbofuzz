import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

// Blanks, a spelling variant ("italy "), a duplicate row and a value that is not a number.
const CSV =
  [
    "id,country,points,price,taster",
    "1,Italy,87,15,Kerin O'Keefe",
    "2,Portugal,87,15,Roger Voss",
    "3,US,87,14,Paul Gregutt",
    "4,US,87,13,Alexander Peartree",
    "5,italy ,87,65,Paul Gregutt",
    "6,Spain,87,15,Michael Schachner",
    "7,Italy,87,16,Kerin O'Keefe",
    "8,,88,abc,Roger Voss",
    "9,France,87,24,Roger Voss",
    "9,France,87,24,Roger Voss",
    "10,US,87,12,Paul Gregutt",
    "11,Italy,87,27,Kerin O'Keefe",
  ].join("\n") + "\n";

async function loadAndShowQuality(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "wine.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.getByRole("button", { name: "Excel report ↓" }).waitFor();
}

async function workbookFrom(page: Page, click: () => Promise<void>): Promise<{ book: XLSX.WorkBook; name: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]);
  return { book: XLSX.read(readFileSync((await download.path())!), { type: "buffer" }), name: download.suggestedFilename() };
}

const text = (book: XLSX.WorkBook, sheet: string): string =>
  XLSX.utils
    .sheet_to_json<unknown[]>(book.Sheets[sheet]!, { header: 1, blankrows: false })
    .flat()
    .map(String)
    .join("\n");

test("the Quality page's Excel button downloads the whole-file workbook with every sheet", async ({ page }) => {
  await loadAndShowQuality(page);
  const { book, name } = await workbookFrom(page, () => page.getByRole("button", { name: "Excel report ↓" }).click());
  expect(name).toBe("wine-dq-report.xlsx");
  expect(book.SheetNames).toEqual(["Summary", "Columns", "Findings", "Checks & rules", "Exceptions", "Relationships", "Sensitive", "About"]);
  expect(text(book, "Summary")).toContain("Scope: the whole file, 12 rows × 5 columns");
  const columns = text(book, "Columns");
  for (const column of ["id", "country", "points", "price", "taster"]) expect(columns).toContain(column);
  expect(text(book, "Exceptions")).toContain("abc");
});

test("the big box at the foot of the Quality page builds the same report", async ({ page }) => {
  await loadAndShowQuality(page);
  const box = page.getByRole("button", { name: /Get the Excel data-quality report/ });
  await box.scrollIntoViewIfNeeded();
  const { book } = await workbookFrom(page, () => box.click());
  expect(book.SheetNames[0]).toBe("Summary");
  await expect(page.locator(".cmp-excel-note")).not.toHaveText("Building the workbook…");
});
