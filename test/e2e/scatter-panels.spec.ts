import { test, expect, type Page } from "@playwright/test";

function points(): string {
  const lines = ["dist,price,kind"];
  for (let i = 0; i < 400; i++) {
    const d = ((i * 7919) % 1000) / 10;
    lines.push(`${d},${(d * 3 + ((i * 31) % 40)).toFixed(1)},${i % 3}`);
  }
  return lines.join("\n");
}

async function openScatter(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  // These tests work the settings under Refine and Format, which are closed until opened.
  await page.addInitScript(() => {
    localStorage.setItem("turbofuzz.charts.refineOpen", "1");
    localStorage.setItem("turbofuzz.charts.formatOpen", "1");
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(points()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /scatter/i }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").waitFor();
}

test("a scatter splits into panels by a category, one small plot per value on shared axes", async ({ page }) => {
  await openScatter(page);
  const panels = page.getByLabel("Split into panels by");
  await expect(panels).toBeVisible();
  await expect(panels.locator("option").first()).toHaveText("None (one plot)");
  const value = await panels.locator("option").evaluateAll((options) => (options as HTMLOptionElement[]).find((o) => o.textContent?.startsWith("kind"))?.value ?? "");
  expect(value).not.toBe("");
  const canvas = page.locator("canvas.chart-canvas").first();
  const pixels = (): Promise<string> => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const single = await pixels();
  await panels.selectOption(value);
  await expect(page.locator(".chart-note").first()).toContainText("400 points in 3 panels by kind, on shared axes");
  await expect.poll(pixels).not.toBe(single);
  // Back to one plot.
  await panels.selectOption("-1");
  await expect(page.locator(".chart-note").first()).not.toContainText("panels by");
});
