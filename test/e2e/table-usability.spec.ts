import { test, expect, type Page } from "@playwright/test";

const CSV = ["name,amount,region,notes", "Ada,4500,North,first", "Alan,120,South,second", "Grace,77,East,third"].join("\n");

async function openTable(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "u.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Table" }).click();
  await page.locator(".table-rows .tr").first().waitFor();
}
const headers = (page: Page) => page.locator(".table-header .th-label").allInnerTexts();
const cell = (page: Page, row: number, col: number) => page.locator(`.tr[data-pos="${row}"] .td[data-col="${col}"]`);

test("hide a column from its menu (found by typing), then show all again", async ({ page }) => {
  await openTable(page);
  await page.locator(".table-header .th-label", { hasText: "region" }).click({ button: "right" });
  await page.getByRole("searchbox", { name: "Find an action" }).fill("hide");
  await expect(page.locator(".context-item:not(.hidden)")).toHaveText(["Hide column"]);
  await page.keyboard.press("Enter");
  await expect.poll(() => headers(page)).toEqual(["name", "amount", "notes"]);
  await page.getByRole("button", { name: "1 hidden column · Show all" }).click();
  await expect.poll(() => headers(page)).toEqual(["name", "amount", "region", "notes"]);
});

test("frozen columns stay in place, and the peek shows the cell under the cursor", async ({ page }) => {
  await openTable(page);
  await page.locator(".table-header .th-label", { hasText: "amount" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Freeze columns up to here" }).click();
  await expect(cell(page, 0, 1)).toHaveClass(/frozen/);
  await expect(cell(page, 0, 2)).not.toHaveClass(/frozen/);
  await cell(page, 1, 3).click();
  await expect(page.locator(".table-nav-peek")).toHaveText("notes · row 2: second");
});

test("a block pasted at the cursor changes those cells after one confirm", async ({ page }) => {
  await openTable(page);
  await cell(page, 0, 2).click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "West\tnew one\nMiddle\tnew two\n");
    document.querySelector(".table-scroller")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });
  await page.getByRole("button", { name: "Paste" }).click();
  await expect(cell(page, 0, 2)).toHaveText("West");
  await expect(cell(page, 1, 3)).toHaveText("new two");
  await expect(cell(page, 2, 2)).toHaveText("East");
});

test("an empty result offers to clear the filters", async ({ page }) => {
  await openTable(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("filter region Nowhere");
  await page.keyboard.press("Enter");
  await page.locator(".table-rows .empty").getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".table-nav-pos")).toHaveText("Rows 1–3 of 3");
});
