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
  await page.getByRole("radio", { name: "Heat grid" }).click();
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
  // A category cannot combine into one colour for a place; a number can.
  const colour = card.getByRole("combobox", { name: "Colour column" });
  await expect(colour.locator("option", { hasText: "usertype" })).toHaveAttribute("disabled");
  await colour.selectOption((await colour.locator("option", { hasText: "tripduration" }).getAttribute("value"))!);
  await expect(notes).toContainText("colour = average tripduration");
  await expect(card.getByRole("combobox", { name: "Colour map" })).toHaveValue("Blue to red");
  await expect(card.getByRole("combobox", { name: "Colour of a place" })).toHaveValue("mean");

  // One click: the first date column, by the day, ready to play.
  await card.locator(".chart-animate-btn").click();
  await expect(card.getByRole("combobox", { name: "Animate over" }).locator("option:checked")).toHaveText("starttime");
  await expect(card.getByRole("combobox", { name: "Frame length" })).toHaveValue("day");
  await expect(card.getByRole("button", { name: /Play/ })).toBeVisible();
  await expect(notes).toContainText("12 places");
  const first = await notes.textContent();
  expect(first).toMatch(/2014/);
  await card.locator(".chart-animation-slider").fill("2");
  await expect.poll(() => notes.textContent()).not.toBe(first);
  await expect(notes).toContainText("colour = average tripduration");

  // Another way of showing the data has no frames to step through.
  await page.getByRole("radio", { name: "Heat grid" }).click();
  const grey = card.locator(".chart-animate-btn");
  await expect(grey).toBeVisible();
  await expect(grey).toHaveAttribute("aria-disabled", "true");
  await expect(grey).toHaveAttribute("title", /One dot per place/);
});

test("the Map page has the settings beside the map, dots that say what they are, a size legend and a log colour scale", async ({ page }) => {
  const lines = ["tripduration,starttime,start station name,end station name,start station latitude,start station longitude"];
  for (let i = 0; i < 300; i++) {
    const k = i % 12;
    lines.push(`${100 + k * k * 300},2014-02-0${1 + (i % 5)} 08:00:00,Start ${k},End ${k},${40.7 + (k % 4) * 0.012},${-74 + Math.floor(k / 4) * 0.03}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "t.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Map" }).first().click();
  const card = page.locator(".map-card");
  await expect(card.locator(".chart-note")).toContainText("12 places");
  // Settings beside the plot, with no chart type to wander off to.
  const canvas = (await card.locator("canvas.chart-canvas").boundingBox())!;
  const side = (await card.locator(".chart-sidebar").boundingBox())!;
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(side.x);
  await expect(card.locator(".chart-kind-button")).toBeHidden();
  // The name column that goes with the coordinates is found by itself.
  await expect(card.getByRole("combobox", { name: "Place label" }).locator("option:checked")).toHaveText("start station name");
  const colour = card.getByRole("combobox", { name: "Colour column" });
  await colour.selectOption((await colour.locator("option", { hasText: "tripduration" }).getAttribute("value"))!);
  await expect(card.locator(".chart-note")).toContainText("colour = average tripduration");
  const scale = card.getByRole("combobox", { name: "Colour scale" });
  await scale.selectOption("log");
  await expect(card.locator(".chart-note")).toContainText("logarithmic");
  // Hovering the dots finds a place by name, with its numbers. Big dots, so the search below cannot step over them.
  await card.getByLabel("Smallest dot radius (pixels)").fill("24");
  await card.getByLabel("Largest dot radius (pixels)").fill("30");
  const tooltip = card.locator(".chart-tooltip");
  let found = false;
  const wide = (await card.locator("canvas.chart-canvas").boundingBox())!;
  // The middle column of stations, somewhere across the height.
  for (let fx = 0.42; fx < 0.6 && !found; fx += 0.03) {
    for (let fy = 0.15; fy < 0.85 && !found; fy += 0.03) {
      await page.mouse.move(wide.x + wide.width * fx, wide.y + wide.height * fy);
      await page.waitForTimeout(25);
      found = (await tooltip.isVisible()) && /Start \d+/.test((await tooltip.textContent()) ?? "");
    }
  }
  expect(found).toBe(true);
  await expect(tooltip).toContainText("Rows:");
  await expect(tooltip).toContainText("average tripduration:");
  // The stats carry the names.
  await card.locator(".chart-stats-btn").click();
  await expect(page.getByRole("dialog", { name: "Chart stats" }).locator("th", { hasText: "start station name" })).toBeVisible();
});

