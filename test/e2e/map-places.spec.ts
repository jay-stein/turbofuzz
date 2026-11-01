import { expect, test, type Page } from "@playwright/test";

/** Trips between stations, Citi Bike-style: 400 rows on 24 stations. */
function trips(): string {
  const lines = ["tripduration,starttime,start station name,start station latitude,start station longitude,usertype"];
  for (let i = 0; i < 400; i++) {
    const k = (i * 7) % 24;
    lines.push(`${200 + ((i * 37) % 900)},2014-02-${String(1 + (i % 27)).padStart(2, "0")} 08:00:00,Station ${k},${40.7 + (k % 8) * 0.012},${-74.02 + Math.floor(k / 8) * 0.03 + (k % 3) * 0.008},${i % 4 ? "Subscriber" : "Customer"}`);
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

test("the Map says when many rows share a place, offers one dot per place, and the controls say what they are for", async ({ page }) => {
  await openMap(page);
  const note = page.locator(".chart-note").first();
  // Four hundred trips on 24 stations: stacked dots hide that, so the note says it and offers the fix.
  await expect(note).toContainText("400 rows sit on 24 places");
  // The control is "Aggregate", as on the chart page, with the reason it is greyed out on the page, not only in a tooltip.
  const combine = page.locator(".chart-field", { hasText: "Aggregate" });
  await expect(combine).toContainText("pick a Size column first");
  await expect(page.getByText("Reduce", { exact: true })).toHaveCount(0);
  // One Fit all, not two; and the title is not "longitude vs latitude".
  await expect(page.getByRole("button", { name: "Fit all" })).toHaveCount(1);
  await expect(page.locator(".chart-title").first()).not.toHaveValue(/longitude vs/);
  // One click: 24 dots sized by how many trips each station holds.
  await note.locator("button.chart-density-nudge").click();
  await expect(note).toContainText("24 places from 400 rows", { timeout: 10_000 });
  await expect(note).toContainText("dot size = rows");
  await expect(page.locator("select[aria-label='Map display mode']")).toHaveValue("places");
});

test("a scatter of more points than it can draw says so, and offers the density map", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  const rows = ["a,b"];
  for (let i = 0; i < 30000; i++) rows.push(`${(i * 7919) % 1000},${(i * 104729) % 1000}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /scatter/i }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  const note = page.locator(".chart-note").first();
  await expect(note).toContainText("sampled from 30,000", { timeout: 20_000 });
  await note.locator("button.chart-density-nudge").click();
  await expect(page.locator("select[aria-label='Render mode']")).toHaveValue("density");
});
