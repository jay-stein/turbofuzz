import { test, expect, type Page } from "@playwright/test";

// Outliers, Relationships, Time Series and Map are Research-mode tabs.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("turbofuzz-mode", "research"));
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

function sites(): string {
  const lines = ["site,lat,lon,visits"];
  for (let i = 0; i < 60; i++) lines.push(`s${i},${(40 + (i % 12) * 1.5).toFixed(3)},${(-5 + (i % 15) * 1.2).toFixed(3)},${10 + i}`);
  return lines.join("\n");
}

/** The values of every input matching the selector, in order. */
function values(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
}

async function openMap(page: Page, csv = sites(), name = "sites.csv"): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Map" }).click();
  await expect(page.locator(".map-page canvas.chart-canvas")).toBeVisible();
}

test("the Map tab plots the coordinate columns at full width", async ({ page }) => {
  await openMap(page);
  await expect(page.locator(".map-sub")).toHaveText("lat / lon");
  await expect(page.locator(".map-empty")).toBeHidden();
});

test("a background picture is placed, and bad edges are explained", async ({ page }) => {
  await openMap(page);
  await page.locator('.map-page input[aria-label="Background image and world file"]').setInputFiles({ name: "world.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator(".map-bg-name")).toContainText("world.png");
  await expect(page.locator('.map-seg [data-mode="world"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.map-page input[aria-label="West edge in degrees"]')).toHaveValue("-180");
  await page.locator('.map-page input[aria-label="East edge in degrees"]').fill("-200");
  await expect(page.locator(".map-problem")).toContainText("West must be less than east");
  await page.locator('.map-page input[aria-label="East edge in degrees"]').fill("30");
  await expect(page.locator(".map-problem")).toBeEmpty();
  await expect(page.locator('.map-seg [data-mode="edges"]')).toHaveAttribute("aria-pressed", "true");
});

test("markers come from a CSV, the table and clicks on the map", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "+ Add markers…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add markers" });
  await dialog.locator('input[aria-label="Markers CSV file"]').setInputFiles({
    name: "pins.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,lat,lon,shape,colour\nDepot,45.1,2.5,star,blue\nYard,47.2,4.1,x,#00aa00\nBad,north,east,,\n"),
  });
  await expect(dialog.locator(".map-add-skipped")).toContainText("Line 4");
  await dialog.getByRole("button", { name: "Add 2 markers" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".map-mk-count")).toHaveText("2 / 100");
  await expect(page.locator(".map-mk-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".map-cell-label").first()).toHaveValue("Depot");

  // An unreadable latitude is marked and left off the map.
  await page.locator(".map-cell-lat").nth(1).fill("ninety");
  await expect(page.locator(".map-cell-lat").nth(1)).toHaveClass(/invalid/);
  await expect(page.locator(".map-mk-count")).toHaveText("1 / 100");
  await page.locator(".map-cell-lat").nth(1).fill("47.2");

  await page.getByRole("button", { name: "Click map to add" }).click();
  const box = await page.locator(".map-page canvas.chart-canvas").boundingBox();
  if (!box) throw new Error("no map");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".map-mk-count")).toHaveText("3 / 100");
  await expect(page.locator(".view-tabs [aria-selected=true]")).toHaveText("Map");
});

test("a table without coordinates still gets a map for markers", async ({ page }) => {
  await openMap(page, "a,b\nx,1\ny,2\nz,3\n", "plain.csv");
  await expect(page.locator(".map-empty")).toContainText("No latitude and longitude columns found");
});

test("cities: search adds a marker, names alone become markers, and the layer draws offline", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "+ Add markers…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add markers" });
  await dialog.locator(".map-add-text").fill("city\nTokyo\nNairobi\n");
  await dialog.getByLabel("Find a city to add").fill("lond");
  await expect(dialog.locator(".map-city-list li").first()).toContainText("London");
  await dialog.getByLabel("Find a city to add").press("Enter");
  await dialog.getByRole("button", { name: "Add 3 markers" }).click();
  await expect(page.locator(".map-mk-count")).toHaveText("3 / 100");
  await expect.poll(() => values(page, ".map-cell-label")).toEqual(["Tokyo", "Nairobi", "London"]);
  // The cities switch sits on the map, in the dock.
  await page.locator(".map-dock").getByLabel("Show world cities").check();
  await expect(page.getByLabel("Show world cities")).toBeChecked();
});

test("pasted rows need only a latitude and longitude; unlabelled ones are numbered", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "+ Add markers…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add markers" });
  await dialog.locator(".map-add-text").fill("45.1,2.5\n46.2;3.3\nDepot\t47.2\t4.1\nnothing here");
  await expect(dialog.locator(".map-add-summary")).toContainText("3 markers ready");
  await expect(dialog.locator(".map-add-preview tbody tr")).toHaveCount(3);
  await dialog.locator(".map-add-text").press("Control+Enter");
  await expect(dialog).toBeHidden();
  await expect.poll(() => values(page, ".map-cell-label")).toEqual(["Marker 1", "Marker 2", "Depot"]);
});

test("marker size: set in the Add window, per row, and for every marker from the dock", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "+ Add markers…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add markers" });
  await dialog.locator(".map-add-text").fill("label,lat,lon,size\nBig,45,2,16\nPlain,46,3,");
  await dialog.getByLabel("Size for these markers").fill("10");
  await dialog.getByRole("button", { name: "Add 2 markers" }).click();
  await expect.poll(() => values(page, ".map-cell-size")).toEqual(["16", "10"]);

  await page.getByLabel("Size in pixels, row 2").fill("5");
  await expect.poll(() => values(page, ".map-cell-size")).toEqual(["16", "5"]);

  await page.locator(".map-dock").getByLabel("Marker size").fill("20");
  await expect.poll(() => values(page, ".map-cell-size")).toEqual(["20", "20"]);
  await expect(page.locator(".map-dock .map-size-out")).toHaveText("20px");
});

test("an uploaded SVG becomes a symbol; its scripts are never run", async ({ page }) => {
  await openMap(page);
  await page.locator(".map-markers summary").click();
  await page.getByRole("button", { name: "+ Row" }).click();
  await page.getByRole("button", { name: "Symbol for row 1" }).click();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>window.__svgRan = true</script><rect x="1" y="1" width="8" height="8" onload="window.__svgRan = true"/></svg>`;
  await page.locator('input[aria-label="SVG symbol file"]').setInputFiles({ name: "box.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(page.getByRole("button", { name: "Symbol for row 1" }).locator("svg path")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __svgRan?: boolean }).__svgRan)).toBeUndefined();
});
