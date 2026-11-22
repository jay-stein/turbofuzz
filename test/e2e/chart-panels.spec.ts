import { test, expect, type Page } from "@playwright/test";

function rows(): string {
  const lines = ["score,team,stage"];
  for (let i = 0; i < 300; i++) lines.push(`${(i * 37) % 100},${["red", "blue", "green"][i % 3]},${["one", "two"][(i >> 2) % 2]}`);
  return lines.join("\n");
}

async function openChart(page: Page, kind: RegExp): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "t.csv", mimeType: "text/csv", buffer: Buffer.from(rows()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: kind }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").waitFor();
}

async function splitBy(page: Page, name: string): Promise<void> {
  const panels = page.getByLabel("Split into panels by").first();
  await expect(panels).toBeVisible();
  const value = await panels.locator("option").evaluateAll((options, n) => (options as HTMLOptionElement[]).find((o) => o.textContent?.startsWith(n))?.value ?? "", name);
  expect(value).not.toBe("");
  await panels.selectOption(value);
}

test("a bar chart splits into panels, one per value, on one value axis", async ({ page }) => {
  await openChart(page, /^Bar$/);
  await splitBy(page, "stage");
  await expect(page.locator(".chart-note").first()).toContainText("2 panels by stage, on one value axis");
  // Back to one chart.
  await page.getByLabel("Split into panels by").first().selectOption("-1");
  await expect(page.locator(".chart-note").first()).not.toContainText("panels by");
});

test("a histogram splits into panels too", async ({ page }) => {
  await openChart(page, /^Histogram$/);
  await splitBy(page, "team");
  await expect(page.locator(".chart-note").first()).toContainText("3 panels by team, on one value axis");
});
