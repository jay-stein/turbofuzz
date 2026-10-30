import { test, expect, type Page } from "@playwright/test";

async function load(page: Page, csv: string): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "sunspots.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Table" }).click();
}

function sunspots(): string {
  const lines = ['"Month","Sunspots"'];
  for (let i = 0; i < 240; i++) lines.push(`"${1749 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}",${(50 + 40 * Math.sin(i / 20)).toFixed(1)}`);
  return lines.join("\n");
}

test("year-month text converts to dates with the format that fits, picked for you", async ({ page }) => {
  await load(page, sunspots());
  await page.locator("select.th-type").first().selectOption("date");
  const dialog = page.locator(".cast-modal");
  await expect(dialog).toBeVisible();
  const format = dialog.getByLabel("Date format", { exact: true });
  await expect(format).toHaveValue("fmt:YYYY-MM");
  await expect(dialog.locator(".date-format-status")).toContainText("reads as 1749");
  await expect(dialog.locator(".cast-summary")).toContainText("240 of 240 values will be converted");
  await dialog.getByRole("button", { name: "Convert to Date" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("select.th-type").first()).toHaveValue("date");
});

test("a custom format can be typed and is checked as you type", async ({ page }) => {
  await load(page, "when,value\n15h 03/2024,1\n16h 04/2024,2\n17h 05/2024,3\n");
  await page.locator("select.th-type").first().selectOption("datetime");
  const dialog = page.locator(".cast-modal");
  await dialog.getByLabel("Date format", { exact: true }).selectOption("custom");
  const custom = dialog.getByLabel("Custom date format");
  await custom.fill("MM/YYYY");
  await expect(dialog.locator(".date-format-status")).toContainText("Reads 0 of 3");
  await custom.fill("HH[h] MM/YYYY");
  await expect(dialog.locator(".date-format-status")).toContainText("Reads 3 of 3");
  await expect(dialog.locator(".cast-summary")).toContainText("3 of 3 values will be converted");
  await custom.fill("MM/DD");
  await expect(dialog.locator(".date-format-status")).toContainText("needs a year");
  await expect(dialog.getByRole("button", { name: "Convert to Date & time" })).toBeDisabled();
});

test("Clean's convert-to-date step offers the same formats, fitted to the column", async ({ page }) => {
  await load(page, sunspots());
  await page.locator(".th", { hasText: "Month" }).first().click({ button: "right", position: { x: 40, y: 10 } });
  await page.getByRole("menuitem", { name: "Clean values…" }).click();
  await page.getByLabel("Operation").selectOption("toDate");
  await expect(page.locator(".clean-modal").getByLabel("Date format", { exact: true })).toHaveValue("fmt:YYYY-MM");
});
