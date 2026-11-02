import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

/** Three regions of very different averages, with repeating values so they read as numbers. Dated, for a time series too. */
function data(rows: number): string {
  const lines = ["date,region,amount"];
  for (let i = 0; i < rows; i++) {
    const day = String(1 + (i % 20)).padStart(2, "0");
    const region = ["North", "South", "East"][i % 3]!;
    lines.push(`2024-03-${day},${region},${(i % 3) * 100 + 50 + (i * 7) % 41}`);
  }
  return lines.join("\n");
}

async function open(page: Page, rows = 600, fields = ["region", "amount"], kind = "Barplot"): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "d.csv", mimeType: "text/csv", buffer: Buffer.from(data(rows)) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
  for (const name of fields) {
    await page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) }).first().click();
  }
  await page.locator(".chart-add-tile").first().click();
  const card = page.locator(".chart-card:not(.hidden)");
  await card.locator("canvas.chart-canvas").waitFor();
  await card.locator(".chart-kind-button").click();
  await page.getByRole("dialog", { name: "Chart type" }).getByRole("button", { name: kind, exact: true }).click();
  await card.getByRole("combobox", { name: "Aggregation" }).selectOption("mean");
  return card;
}

const errorTable = async (page: Page, card: Locator): Promise<string[][]> => {
  await card.locator(".chart-stats-btn").click();
  const dialog = page.getByRole("dialog", { name: "Chart stats" });
  const section = dialog.locator(".chart-stats-section", { has: page.locator("h3", { hasText: /^Error bars$/ }) });
  await section.waitFor();
  const rows = await section.locator("tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((cell) => (cell as HTMLElement).title || (cell.textContent ?? ""))));
  return rows;
};

test("error bars are off until ticked, and a formula needs no dialog", async ({ page }) => {
  const card = await open(page);
  const box = card.getByRole("checkbox", { name: "Error bars" });
  await expect(box).not.toBeChecked();
  await expect(card.getByRole("combobox", { name: "Error bar type" })).toBeHidden();
  await expect(card.locator(".chart-note")).not.toContainText("Error bars:");
  await box.check();
  await expect(card.locator(".chart-note")).toContainText("Error bars: 95% CI");
  await expect(card.locator(".chart-progress")).toHaveCount(0);

  const rows = await errorTable(page, card);
  expect(rows[0]).toEqual(["region", "statistic", "low", "high", "minus", "plus", "rows"]);
  expect(rows).toHaveLength(4);
  const north = rows.find((row) => row[0] === "North")!;
  expect(Number(north[6])).toBe(200);
  expect(Number(north[2])).toBeLessThan(Number(north[1]));
  expect(Number(north[3])).toBeGreaterThan(Number(north[1]));
});

test("a total has no bars, and says why", async ({ page }) => {
  const card = await open(page);
  await card.getByRole("combobox", { name: "Aggregation" }).selectOption("sum");
  const box = card.getByRole("checkbox", { name: "Error bars" });
  await expect(box).toBeDisabled();
  await expect(card.locator(".chart-error-hint")).toContainText("no sampling error");
});

test("the bootstrap shows a donut and its progress, puts its numbers in the stats, and can be cancelled", async ({ page }) => {
  const card = await open(page, 120_000);
  await card.getByRole("combobox", { name: "Aggregation" }).selectOption("median");
  await card.getByRole("checkbox", { name: "Error bars" }).check();
  await expect(card.locator(".chart-note")).toContainText("Error bars: 95% CI");
  await card.getByRole("combobox", { name: "Error bar type" }).selectOption("bootstrap");
  const dialog = card.locator(".chart-progress");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".chart-progress-donut")).toBeVisible();
  await expect(dialog).toContainText("Resampling for error bars");
  await expect(dialog.locator(".chart-progress-detail")).toContainText(/Resample [\d,]+ of 1,000/);
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(card.locator(".chart-note")).toContainText("Error bars: 95% CI (bootstrap)");

  const rows = await errorTable(page, card);
  expect(rows[0]).toContain("bootstrap_se");
  expect(rows).toHaveLength(4);
  const stats = page.getByRole("dialog", { name: "Chart stats" });
  await expect(stats).toContainText("1,000 resamples with replacement");
  await expect(stats).toContainText("seed 20261103");
  const [download] = await Promise.all([page.waitForEvent("download"), stats.getByRole("button", { name: "Download CSV" }).click()]);
  expect(readFileSync((await download.path())!, "utf8")).toContain("bootstrap_se");
  await page.keyboard.press("Escape");

  // Again, and this time stop it: the box is unticked and the chart is left as it was.
  await card.getByRole("combobox", { name: "Error bar type" }).selectOption("ci");
  await expect(card.locator(".chart-progress")).toHaveCount(0);
  await card.getByRole("combobox", { name: "Error bar type" }).selectOption("bootstrap");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByRole("checkbox", { name: "Error bars" })).not.toBeChecked();
  await expect(card.locator(".chart-note")).toContainText("resampling was cancelled");
});

test("a time series gets its bars with the warning, also in the stats", async ({ page }) => {
  const card = await open(page, 600, ["date", "amount"], "Time series");
  await card.getByRole("checkbox", { name: "Error bars" }).check();
  await expect(card.locator(".chart-note")).toContainText("periods in a time series are related");
  await errorTable(page, card);
  await expect(page.getByRole("dialog", { name: "Chart stats" })).toContainText("likely too narrow");
});
