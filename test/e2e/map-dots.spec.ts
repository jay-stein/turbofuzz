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

test("the map is about twice as wide as tall, and the dock keeps your markers together", async ({ page }) => {
  await openMap(page);
  const box = (await page.locator(".map-card canvas.chart-canvas").boundingBox())!;
  const ratio = box.width / box.height;
  expect(ratio).toBeGreaterThan(1.6);
  expect(ratio).toBeLessThan(2.4);
  // Marker tools are one labelled group; the data dots are sized in the Dots row, not by that slider.
  const group = page.getByRole("group", { name: "Your markers" });
  await expect(group.getByLabel("Size of your markers")).toBeVisible();
  await expect(group.getByRole("button", { name: "Click map to add" })).toBeVisible();
  await expect(group.getByRole("button", { name: "+ Add markers…" })).toBeVisible();
  await expect(group.getByRole("button", { name: "Fit all" })).toHaveCount(0);
});

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
  await page.locator("select[aria-label='Map display mode']").selectOption("points");
  // One dot per row with no Size column: one radius for all, no range to span.
  await expect(dots.getByLabel("Largest dot radius (pixels)")).toBeHidden();
  await page.locator("select[aria-label='Map display mode']").selectOption("heat");
  await expect(dots).toBeHidden();
});

test("Clear asks first, and a cancelled Clear keeps every marker", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "+ Row" }).click();
  await page.getByRole("button", { name: "+ Row" }).click();
  const rows = page.locator(".map-cell-label");
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clear all 2 markers?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("dialog", { name: "Clear all 2 markers?" }).getByRole("button", { name: "Clear 2 markers" }).click();
  await expect(rows).toHaveCount(0);
});

test("one dot per place can be coloured by the average of a number, blue to red, and stepped through the days", async ({ page }) => {
  const lines = ["tripduration,starttime,usertype,start station latitude,start station longitude"];
  for (let i = 0; i < 300; i++) {
    const k = i % 12;
    const day = String(1 + (i % 5)).padStart(2, "0");
    lines.push(`${200 + (k * 40) + (i % 5) * 100},2014-02-${day} 08:00:00,${i % 2 ? "Subscriber" : "Customer"},${40.7 + (k % 4) * 0.012},${-74 + Math.floor(k / 4) * 0.03}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "trips.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Map" }).first().click();
  const card = page.locator(".map-card");
  const notes = card.locator(".chart-note");
  await expect(notes).toContainText("places from");
  await card.locator(".chart-sidebar-toggle").click();

  // A category cannot combine into one colour for a place; a number can.
  const colour = card.getByRole("combobox", { name: "Colour column" });
  await expect(colour.locator("option", { hasText: "usertype" })).toHaveAttribute("disabled");
  await colour.selectOption((await colour.locator("option", { hasText: "tripduration" }).getAttribute("value"))!);
  await expect(notes).toContainText("colour = average tripduration");
  await expect(card.getByRole("combobox", { name: "Colour map" })).toHaveValue("Blue to red");
  await expect(card.getByRole("combobox", { name: "Colour of a place" })).toHaveValue("mean");

  await card.locator(".chart-animate-btn").click();
  const time = card.getByRole("combobox", { name: "Animate over time" });
  await time.selectOption((await time.locator("option", { hasText: "starttime" }).getAttribute("value"))!);
  await card.getByRole("combobox", { name: "Frame length" }).selectOption("day");
  await expect(card.getByRole("button", { name: /Play/ })).toBeVisible();
  await expect(notes).toContainText("12 places");
  const first = await notes.textContent();
  expect(first).toMatch(/2014/);
  await card.locator(".chart-animation-slider").fill("2");
  await expect.poll(() => notes.textContent()).not.toBe(first);
  await expect(notes).toContainText("colour = average tripduration");

  // Another way of showing the data has no frames to step through.
  await card.getByRole("combobox", { name: "Map display mode" }).selectOption("heat");
  await expect(card.locator(".chart-animate-btn")).toBeHidden();
});
