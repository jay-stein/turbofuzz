import { test, expect, type Page } from "@playwright/test";

const CSV = ["name,amount,region", "Ada,4500,North", "Alan,120,South", "Grace,77,East"].join("\n");

async function openTable(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "edit.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Table" }).click();
  await page.locator(".table-rows .tr").first().waitFor();
}

const cell = (page: Page, row: number, col: number) => page.locator(`.tr[data-pos="${row}"] .td[data-col="${col}"]`);

test("arrow keys move a cell cursor; Ctrl+arrows jump to the edges", async ({ page }) => {
  await openTable(page);
  await cell(page, 0, 0).click();
  await expect(cell(page, 0, 0)).toHaveClass(/cursor-cell/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, 1, 1)).toHaveClass(/cursor-cell/);
  await page.keyboard.press("Control+ArrowDown");
  await expect(cell(page, 2, 1)).toHaveClass(/cursor-cell/);
  await page.keyboard.press("Control+ArrowRight");
  await expect(cell(page, 2, 2)).toHaveClass(/cursor-cell/);
  // A digit edits the cell; it does not switch tabs.
  await page.keyboard.press("5");
  await expect(page.locator(".cell-editor")).toHaveValue("5");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
});

test("editing a cell asks first, records a Recipe step, and can be turned to not ask", async ({ page }) => {
  await openTable(page);
  await cell(page, 0, 1).dblclick();
  const editor = page.locator(".cell-editor");
  await editor.fill("45000");
  await editor.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: "Confirm the change" });
  await expect(confirm).toContainText("Change amount in row 1 (file row 1) from 4500 to 45000?");
  // Cancel leaves the cell alone.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(cell(page, 0, 1)).toHaveText("4500");

  await cell(page, 0, 1).dblclick();
  await editor.fill("45000");
  await editor.press("Enter");
  await confirm.getByLabel("Don't ask again for this session").check();
  await confirm.getByRole("button", { name: "Change" }).click();
  await expect(cell(page, 0, 1)).toHaveText("45000");
  await expect(page.getByRole("button", { name: /Recipe \(1\)/ })).toBeVisible();

  // No question this time; a second edit in the column joins the same step.
  await cell(page, 1, 1).click();
  await page.keyboard.type("9");
  await page.keyboard.press("Enter");
  await expect(cell(page, 1, 1)).toHaveText("9");
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("button", { name: /Recipe \(1\)/ })).toBeVisible();

});

test("a value that does not fit the column's type is said in the confirm", async ({ page }) => {
  await openTable(page);
  await cell(page, 2, 1).dblclick();
  await page.locator(".cell-editor").fill("lots");
  await page.locator(".cell-editor").press("Enter");
  await expect(page.getByRole("alertdialog", { name: "Confirm the change" })).toContainText("“lots” is not a number");
});
