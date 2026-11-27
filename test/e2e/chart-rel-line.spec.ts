import { test, expect, type Page } from "@playwright/test";

/** No date column: dose (a number), score (y), group and site (categories). */
function trial(): string {
  const lines = ["dose,score,group,site"];
  for (let i = 0; i < 240; i++) {
    const dose = (i % 6) * 10;
    const group = i % 2 === 0 ? "drug" : "placebo";
    const score = (group === "drug" ? dose * 0.8 : dose * 0.2) + ((i * 37) % 11) + 0.5;
    lines.push(`${dose},${score.toFixed(1)},${group},${["north", "south"][(i >> 1) % 2]}`);
  }
  return lines.join("\n");
}

async function pick(page: Page, label: string, name: string): Promise<void> {
  const select = page.getByLabel(label, { exact: true }).first();
  const value = await select.locator("option").evaluateAll((options, n) => (options as HTMLOptionElement[]).find((o) => o.textContent?.startsWith(n))?.value ?? "", name);
  await select.selectOption(value);
}

test("a Line without dates draws y at each x with a 95% band and one line per group, as seaborn's lineplot", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.addInitScript(() => {
    localStorage.setItem("turbofuzz.charts.refineOpen", "1");
    localStorage.setItem("turbofuzz.charts.formatOpen", "1");
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "trial.csv", mimeType: "text/csv", buffer: Buffer.from(trial()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  // The Line tile is open without a date column.
  const lineTile = page.locator(".chart-add-type", { has: page.locator(".chart-add-type-name", { hasText: /^Line$/ }) }).first();
  await expect(lineTile).toHaveAttribute("aria-disabled", "false");
  await lineTile.click();
  await page.locator("canvas.chart-canvas").waitFor();
  await pick(page, "Chart column", "dose");
  await pick(page, "Value column", "score");
  await pick(page, "Group by", "group");
  const note = page.locator(".chart-note").first();
  await expect(note).toContainText("Average of score at each dose");
  await expect(note).toContainText("band: 95% CI");
  await expect(page.locator(".chart-legend-item", { hasText: "drug" })).toBeVisible();
  await expect(page.locator(".chart-legend-item", { hasText: "placebo" })).toBeVisible();
  // The x picker says X, and periods are not offered.
  await expect(page.getByLabel("Bucket", { exact: true }).first()).toBeHidden();
  // The band can be turned off or changed; the dots follow the few points.
  const band = page.getByLabel("Error bars", { exact: true }).first();
  await expect(band).toBeChecked();
  await expect(page.getByLabel("Dots at the points")).toBeChecked();
  await page.getByLabel("Error bar type").selectOption("sd");
  await expect(note).toContainText("band: Standard deviation");
  await band.uncheck();
  await expect(note).not.toContainText("band:");
  // Small multiples work here too.
  await pick(page, "Split into panels by", "site");
  await expect(note).toContainText("2 panels by site");
});

test("a Line of one column needs no setup: it draws the values in row order, as Excel does", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.addInitScript(() => localStorage.setItem("turbofuzz.charts.refineOpen", "1"));
  await page.goto("/");
  const lines = ["reading,site"];
  for (let i = 0; i < 300; i++) lines.push(`${(50 + 20 * Math.sin(i / 15) + (i % 7)).toFixed(2)},${["north", "south"][i % 2]}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "readings.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  const lineTile = page.locator(".chart-add-type", { has: page.locator(".chart-add-type-name", { hasText: /^Line$/ }) }).first();
  await lineTile.click();
  await page.locator("canvas.chart-canvas").waitFor();
  const note = page.locator(".chart-note").first();
  await expect(note).toContainText("reading in row order, one point per row");
  await expect(note).toContainText("300 rows");
  const x = page.getByLabel("Chart column", { exact: true }).first();
  await expect(x).toHaveValue("-2");
  await expect(x.locator("option:checked")).toHaveText("Row order (as in the table)");
  // Another x is one choice away, and row order comes back the same way.
  await pick(page, "Chart column", "site");
  await expect(note).toContainText("at each site");
  await x.selectOption("-2");
  await expect(note).toContainText("in row order");
});
