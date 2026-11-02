import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/** 300 rows: `value` is 2 × `x` + 1 exactly, in three groups. Repeating values, so they read as numbers, not ids. */
function data(): string {
  const lines = ["x,value,group"];
  for (let i = 0; i < 300; i++) {
    const x = (i % 40) * 0.5;
    lines.push(`${x},${2 * x + 1},${["a", "b", "c"][i % 3]}`);
  }
  return lines.join("\n");
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "d.csv", mimeType: "text/csv", buffer: Buffer.from(data()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
}

const pickType = async (page: Page, name: RegExp): Promise<void> => {
  await page.locator(".chart-add-type", { hasText: name }).first().click();
  await page.locator(".chart-card:not(.hidden) canvas.chart-canvas").waitFor();
  await page.waitForTimeout(400);
};

const stats = async (page: Page) => {
  await page.locator(".chart-card:not(.hidden) .chart-stats-btn").click();
  const dialog = page.getByRole("dialog", { name: "Chart stats" });
  await dialog.waitFor();
  return dialog;
};

test("a histogram gives its bins, and the counts add up to the rows", async ({ page }) => {
  await open(page);
  await pickType(page, /^Histogram/);
  const dialog = await stats(page);
  await expect(dialog).toContainText("Bin width");
  await expect(dialog).toContainText("Rows in the bins");
  const counts = await dialog.locator(".chart-stats-table tbody tr td:nth-child(3)").allTextContents();
  const inBins = counts.reduce((sum, count) => sum + Number(count.replace(/,/g, "")), 0);
  // What the automatic range leaves out is said, so the rows are all accounted for.
  const left = await dialog.locator("dd", { hasText: "below the first" }).allTextContents();
  const [, below = "0", above = "0"] = /^(\d+) below the first, (\d+) above/.exec(left[0] ?? "") ?? [];
  expect(inBins + Number(below) + Number(above)).toBe(300);
  // Download carries the same numbers; Esc closes.
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/-stats\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv).toContain("bin_start,bin_end,count,share,cumulative_share");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a scatter gives r and the straight line; a box plot its ranges", async ({ page }) => {
  await open(page);
  for (const name of ["x", "value"]) {
    await page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) }).first().click();
  }
  await page.locator(".chart-add-tile").first().click();
  const card = page.locator(".chart-card:not(.hidden)");
  await card.locator("canvas.chart-canvas").waitFor();
  await card.locator(".chart-kind-button").click();
  await page.getByRole("dialog", { name: "Chart type" }).getByRole("button", { name: "Scatter", exact: true }).click();
  await page.waitForTimeout(400);
  let dialog = await stats(page);
  await expect(dialog).toContainText("Pearson r");
  await expect(dialog).toContainText("b = 2");
  await page.keyboard.press("Escape");
  await card.locator(".chart-kind-button").click();
  await page.getByRole("dialog", { name: "Chart type" }).getByRole("button", { name: "Box plot", exact: true }).click();
  await page.waitForTimeout(400);
  dialog = await stats(page);
  await expect(dialog).toContainText("Tukey");
  await expect(dialog.locator(".chart-stats-table thead")).toContainText("iqr");
});
