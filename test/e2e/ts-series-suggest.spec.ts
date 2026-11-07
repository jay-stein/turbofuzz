import { expect, test } from "@playwright/test";

/** Trips like Citi Bike's: a trip a minute, each at its own moment, 60 stations of 50 trips each. */
function trips(): string {
  const rows = ["tripduration,starttime,start station name,usertype"];
  const base = Date.UTC(2014, 1, 1, 0, 0, 0);
  for (let i = 0; i < 3000; i++) {
    const t = new Date(base + i * 60_000).toISOString().slice(0, 19).replace("T", " ");
    rows.push(`${200 + ((i * 37) % 900)},${t},W ${20 + (i % 60)} St & 6 Ave,${i % 4 ? "Subscriber" : "Customer"}`);
  }
  return rows.join("\n");
}

test("rows from many places in one line: the page says so, suggests the column and its largest values, and one click gives a single series", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "2014-02 - Citi Bike trip data.csv", mimeType: "text/csv", buffer: Buffer.from(trips()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  const banner = page.locator(".ts-page [data-ref=mixed]");
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("Several series in one line");
  await expect(banner).toContainText("start station name");
  await expect(banner).toContainText("60 different");
  // The suggested values are buttons, with their row counts; the two-way flag is offered as another column to pick by.
  const picks = banner.locator("button[data-mixed=pick]");
  await expect(picks).toHaveCount(3);
  await expect(picks.first()).toContainText("50");
  await expect(banner).toContainText("usertype");
  // One click: the page splits by the column and shows that station alone, and the banner goes away.
  const label = (await picks.first().getAttribute("data-label")) ?? "";
  await picks.first().click();
  await expect(page.locator(".ts-page [data-ref=sentence]")).toContainText("start station name", { timeout: 20_000 });
  await expect(page.locator(".ts-page [data-ref=sentence]")).toContainText(label);
  await expect(banner).toBeHidden();
});

test("All N… opens a searchable list of every value", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "trips.csv", mimeType: "text/csv", buffer: Buffer.from(trips()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  const banner = page.locator(".ts-page [data-ref=mixed]");
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await banner.locator("button[data-mixed=more]").first().click();
  const search = page.locator(".ts-popover .ts-pop-search");
  await expect(search).toBeVisible({ timeout: 10_000 });
  await search.fill("W 33 St");
  await expect(page.locator(".ts-popover button[data-val]:not([hidden])")).toHaveCount(await page.locator(".ts-popover button[data-val]:not([hidden])").count());
  const visible = await page.locator(".ts-popover button[data-val]:not([hidden])").allTextContents();
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.every((t) => t.toLowerCase().includes("w 33 st"))).toBe(true);
});

test("the mixed-series notice is full size on Explore and a slim line on the other tabs, which opens it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "2014-02 - Citi Bike trip data.csv", mimeType: "text/csv", buffer: Buffer.from(trips()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  const banner = page.locator(".ts-page [data-ref=mixed]");
  await expect(banner).toContainText("Several series in one line", { timeout: 20_000 });
  await expect(banner).not.toHaveClass(/ts-mixed-slim/);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  await expect(banner).toHaveClass(/ts-mixed-slim/);
  await banner.getByRole("button", { name: "Choose one…" }).click();
  await expect(banner).not.toHaveClass(/ts-mixed-slim/);
  await expect(banner.locator("button[data-mixed=pick]").first()).toBeVisible();
});
