import { test, expect, type Page } from "@playwright/test";

const CSV = ["first,last,price,qty,ordered", "Ada,Lovelace,10,3,2024-01-15", "Alan,Turing,2.5,4,2024-02-29", "Grace,Hopper,4,0,2023-12-31"].join("\n");

async function openTable(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Table" }).click();
  await page.locator(".table-rows .tr").first().waitFor();
}

const headers = (page: Page) => page.locator(".table-header .th-label").allInnerTexts();
const columnValues = (page: Page, index: number) =>
  page.locator(".table-rows .tr").evaluateAll((rows, i) => rows.map((r) => (r.children[i + 1] as HTMLElement | undefined)?.innerText.trim() ?? ""), index);

test("a formula column: suggestions, a live preview, and the column added at the end", async ({ page }) => {
  await openTable(page);
  await page.getByRole("button", { name: "Add a column" }).click();
  const dialog = page.getByRole("dialog", { name: "New column" });
  await dialog.getByLabel("Column name").fill("total");
  await dialog.getByLabel("Formula").click();
  await page.keyboard.type("[pri");
  await expect(dialog.locator(".newcol-suggest li").first()).toHaveText("price");
  await page.keyboard.press("Tab");
  await page.keyboard.type(" * [qty]");
  await expect(dialog.getByLabel("Formula")).toHaveValue("[price] * [qty]");
  await expect(dialog.locator(".newcol-summary")).toContainText("Every row has a value (3)");
  await expect(dialog.locator(".newcol-preview tbody td.newcol-out")).toHaveText(["30", "10", "0"]);

  // A mistake is named, and Add waits until it is fixed.
  await dialog.getByLabel("Formula").fill("[price] / [qtty]");
  await expect(dialog.locator(".newcol-problem")).toContainText("Did you mean [qty]?");
  await expect(dialog.getByRole("button", { name: "Add column" })).toBeDisabled();
  await dialog.getByLabel("Formula").fill("[price] / [qty]");
  await expect(dialog.locator(".newcol-summary")).toContainText("1 left empty: divide by zero (1)");
  await dialog.getByLabel("Formula").fill("[price] * [qty]");
  await expect(dialog.locator(".newcol-summary")).toContainText("Every row has a value");
  await dialog.getByRole("button", { name: "Add column" }).click();

  await expect.poll(() => headers(page)).toEqual(["first", "last", "price", "qty", "ordered", "total"]);
  await expect.poll(() => columnValues(page, 5)).toEqual(["30", "10", "0"]);
  await expect(page.getByRole("button", { name: /Recipe \(1\)/ })).toBeVisible();
});

test("the same value for every row, inserted left of a column from its menu", async ({ page }) => {
  await openTable(page);
  await page.locator(".table-header .th-label", { hasText: "price" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert column left…" }).click();
  const dialog = page.getByRole("dialog", { name: "New column" });
  await dialog.getByLabel("Column name").fill("source");
  await dialog.getByRole("tab", { name: "Same value for every row" }).click();
  await dialog.getByLabel("Value for every row").fill("Online");
  await expect(dialog.locator(".newcol-preview tbody td.newcol-out")).toHaveText(["Online", "Online", "Online"]);
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => headers(page)).toEqual(["first", "last", "source", "price", "qty", "ordered"]);
});

test("add column from the command bar opens the window filled in", async ({ page }) => {
  await openTable(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type('add column full name = [first] & " " & [last]');
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New column" });
  await expect(dialog.getByLabel("Column name")).toHaveValue("full name");
  await expect(dialog.locator(".newcol-preview tbody td.newcol-out")).toHaveText(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
  await dialog.getByRole("button", { name: "Add column" }).click();
  await expect.poll(() => headers(page)).toContain("full name");
  await expect(page.locator(".table-nav-pos")).toHaveText("Rows 1–3 of 3");
});
