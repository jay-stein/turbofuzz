import { expect, test, type Page } from "@playwright/test";

async function load(page: Page, name: string, csv: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
}

function longFile(): string {
  const rows = ["id,deaths,speed"];
  for (let i = 1; i <= 900; i++) rows.push(`${i},${i % 7 === 0 ? -9 : i % 5},${40 + (i % 60)}`);
  rows.push("", "Source: road authority", "Note: -9 means not known");
  return rows.join("\n");
}

test("the Overview says which row was taken as the header, and the import dialog shows both ends of the file", async ({ page }) => {
  await load(page, "roads.csv", longFile());
  const note = page.locator(".overview-header-note");
  await expect(note).toContainText("Header: row 1 (assumed)", { timeout: 10_000 });
  await note.getByRole("button", { name: /Change how it was read/ }).click();
  const dialog = page.locator(".header-row-modal");
  await expect(dialog).toBeVisible();
  // Rows are not all numbered in a big file, so the bottom is shown as it ends, after a gap.
  await expect(dialog.locator(".header-row-gap")).toBeVisible();
  await expect(dialog.locator(".header-row-tail").last()).toContainText("-9 means not known");
});

test("a warning tile on the Overview opens the tool that fixes it, and a code like -9 can be turned into blanks everywhere", async ({ page }) => {
  const rows = ["id,deaths,speed"];
  for (let i = 1; i <= 60; i++) rows.push(`${i},${i % 6 === 0 ? -9 : i % 5},${i % 10 === 0 ? -9 : 40 + (i % 60)}`);
  rows.push("5,,50");
  rows.push("1,1,41");
  await load(page, "codes.csv", rows.join("\n"));
  const dup = page.locator('.health-tile[data-kind="duplicates"]');
  await expect(dup).toHaveClass(/health-tile-fix/);
  const empties = page.locator('.health-tile[data-kind="empties"]');
  await expect(empties).toContainText("1 of 3");
  await empties.click();
  const input = page.getByLabel("Add a value to treat as null");
  await expect(input).toBeVisible();
  await input.fill("-9");
  await input.press("Enter");
  await page.getByRole("button", { name: "Apply nulls" }).click();
  await expect(page.locator('.health-tile[data-kind="empties"]')).toContainText("2 of 3", { timeout: 15_000 });
});

test("a few -9 cells in several columns are named as a missing-value code, with one click to blank them everywhere", async ({ page }) => {
  const rows = ["id,age,speed,state"];
  for (let i = 1; i <= 900; i++) rows.push(`${i},${i === 10 || i === 400 || i === 800 ? -9 : 18 + (i % 60)},${i === 55 || i === 56 || i === 700 ? -9 : 40 + (i % 8) * 10},${["NSW", "VIC", "QLD"][i % 3]}`);
  await load(page, "codes-few.csv", rows.join("\n"));
  const step = page.locator(".next-step-card", { hasText: "-9 looks like a missing-value code" });
  await expect(step).toBeVisible({ timeout: 10_000 });
  await expect(step).toContainText("age, speed");
  await step.getByRole("button", { name: "Blank -9" }).click();
  await page.getByRole("button", { name: "Blank placeholders" }).click();
  await expect(page.locator(".next-step-card", { hasText: "-9 looks like a missing-value code" })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.health-tile[data-kind="empties"]')).toContainText("2 of 4", { timeout: 15_000 });
});

test("Import settings can leave columns out, and the Overview note says so", async ({ page }) => {
  const rows = ["id,name,notes,score"];
  for (let i = 1; i <= 30; i++) rows.push(`${i},n${i},remark ${i},${i * 3}`);
  await load(page, "wide.csv", rows.join("\n"));
  await page.getByRole("button", { name: /Change how it was read/ }).click();
  const dialog = page.locator(".header-row-modal");
  await expect(dialog.locator(".header-row-columns")).toContainText("4 of 4");
  await dialog.getByRole("checkbox", { name: "notes" }).uncheck();
  await expect(dialog.locator(".header-row-columns")).toContainText("3 of 4");
  await dialog.getByRole("button", { name: "Apply and reload" }).click();
  await expect(page.locator(".overview-facts")).toContainText("30 rows × 3 columns", { timeout: 15_000 });
  await expect(page.locator(".overview-header-note")).toContainText("1 column left out");
});
