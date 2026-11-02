import { expect, test, type Page } from "@playwright/test";

/** Trips between stations: 400 rows on 24 stations, each with a different number of trips. */
function trips(): string {
  const lines = ["tripduration,start station name,start station latitude,start station longitude"];
  for (let i = 0; i < 400; i++) {
    const k = (i * i) % 24;
    lines.push(`${200 + ((i * 37) % 900)},Station ${k},${40.7 + (k % 8) * 0.012},${-74.02 + Math.floor(k / 8) * 0.03 + (k % 3) * 0.008}`);
  }
  return lines.join("\n");
}

async function openMap(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "trips.csv", mimeType: "text/csv", buffer: Buffer.from(trips()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Map" }).first().click();
  await page.locator(".chart-note").first().waitFor();
}

test("the Dots row resizes the data dots: radius, scale and opacity redraw the map", async ({ page }) => {
  await openMap(page);
  const canvas = page.locator(".map-card canvas.chart-canvas");
  const dots = page.locator(".chart-dot-settings");
  await expect(dots).toBeVisible();
  // Rows per place, 1 to many: the data's own range shows as the hint under the values.
  await expect(dots.getByLabel("Value for the smallest dot")).toHaveAttribute("placeholder", /^auto: \d/);
  const drawn = (): Promise<string> => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(600);
  const before = await drawn();
  await dots.getByLabel("Largest dot radius (pixels)").fill("30");
  await page.waitForTimeout(300);
  const bigger = await drawn();
  expect(bigger).not.toBe(before);
  await dots.getByLabel("How value becomes dot radius").selectOption("log");
  await page.waitForTimeout(300);
  const log = await drawn();
  expect(log).not.toBe(bigger);
  await dots.getByLabel("Dot opacity").fill("20");
  await page.waitForTimeout(300);
  expect(await drawn()).not.toBe(log);
  // Colour needs one dot per row: it waits here, and comes back when rows are shown singly.
  await expect(page.getByLabel("Colour column")).toBeDisabled();
  await page.locator("select[aria-label='Map display mode']").selectOption("points");
  await expect(page.getByLabel("Colour column")).toBeEnabled();
  // One dot per row with no Size column: one radius for all, no range to span.
  await expect(dots.getByLabel("Largest dot radius (pixels)")).toBeHidden();
  await page.locator("select[aria-label='Map display mode']").selectOption("heat");
  await expect(dots).toBeHidden();
});
