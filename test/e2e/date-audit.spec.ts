import { test, expect, type Page } from "@playwright/test";

const CSV = [
  "pet,born,seen",
  "Tom,2014-07-07 00:00:00,03/04/2020",
  "Kit,2014-06-16 00:00:00,13/04/2020",
  "Bo,2013-12-16 00:00:00,soon",
  "Ivy,2012-01-02 00:00:00,20/05/2020",
].join("\n");

async function load(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "pets.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Table" }).click();
}

test("date & time to date says what happens, shows it, and asks for no format", async ({ page }) => {
  await load(page);
  await expect(page.locator("select.th-type").nth(1)).toHaveValue("datetime");
  await page.locator("select.th-type").nth(1).selectOption("date");
  const dialog = page.locator(".cast-modal");
  await expect(dialog).toContainText("already read as dates");
  await expect(dialog.getByLabel("Date format", { exact: true })).toBeHidden();
  await expect(dialog.getByLabel("Invalid value policy")).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Reinterpret only" })).toBeHidden();
  const table = dialog.locator(".cast-already-table");
  await expect(table.locator("tbody tr").first()).toContainText("2014-07-07 00:00:00");
  await expect(table.locator("tbody tr").first()).toContainText("2014-07-07");
  await expect(dialog.locator(".cast-already-note")).toContainText("every time is 00:00:00");
  await dialog.getByRole("button", { name: "Convert to Date" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("select.th-type").nth(1)).toHaveValue("date");
});

test("a date column's inspector shows the file's text beside what it was read as, and what to check", async ({ page }) => {
  await load(page);
  await page.locator(".th-label", { hasText: /^born$/ }).click();
  await page.locator(".inspector-check-dates").click();
  const audit = page.locator(".date-audit-modal");
  await expect(audit).toContainText("4 of 4");
  await expect(audit).toContainText("Every time of day is 00:00:00");
  await expect(audit.locator(".date-audit-shapes")).toContainText("9999-99-99 99:99:99");
  await expect(audit.locator(".date-audit-table tbody tr").first()).toContainText("Mon, 7 Jul 2014");
  await audit.getByRole("button", { name: "Close" }).last().click();
  await expect(audit).toBeHidden();
});
