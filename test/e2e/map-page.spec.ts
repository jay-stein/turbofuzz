import { test, expect, type Page } from "@playwright/test";

// Outliers, Relationships, Time Series and Map are Research-mode tabs, and every new
// dataset opens in General: switch Research on whenever the switch shows General.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const research = document.querySelector<HTMLElement>('.mode-switch-option[data-mode="research"][aria-checked="false"]');
      if (research !== null && !document.querySelector(".workspace.hidden")) research.click();
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-checked", "class"] });
  });
});


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

  await page.locator(".map-dock").getByLabel("Size of your markers").fill("20");
  await expect.poll(() => values(page, ".map-cell-size")).toEqual(["20", "20"]);
  await expect(page.locator(".map-dock-group .map-size-out")).toHaveText("20px");
});

test("an uploaded SVG becomes a symbol; its scripts are never run", async ({ page }) => {
  await openMap(page);
  await page.getByRole("button", { name: "+ Row" }).click();
  await page.getByRole("button", { name: "Symbol for row 1" }).click();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>window.__svgRan = true</script><rect x="1" y="1" width="8" height="8" onload="window.__svgRan = true"/></svg>`;
  await page.locator('input[aria-label="SVG symbol file"]').setInputFiles({ name: "box.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(page.getByRole("button", { name: "Symbol for row 1" }).locator("svg path")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __svgRan?: boolean }).__svgRan)).toBeUndefined();
});

test("the markers panel starts open, a pasted column layout is understood, and Fit all covers the markers and what is plotted", async ({ page }) => {
  await openMap(page);
  await expect(page.locator("details.map-markers")).toHaveAttribute("open", "");
  // Paste anywhere on the page, not into a field.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "label    lat    long\npony    -33    151\nunicorn    -40    121\nrandom    -42    110.5");
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const dialog = page.getByRole("dialog", { name: "Add markers" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".map-add-text")).toHaveValue(/pony/);
  await expect(dialog).toContainText("3 markers");
  await dialog.getByRole("button", { name: /^Add 3 markers/ }).click();
  await expect(page.locator(".map-mk-table tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Fit all" }).first().click();
});

test("the heat grid setting only shows for the heat view, and says how big each cell is", async ({ page }) => {
  await openMap(page);
  const grid = page.locator(".map-page .chart-field", { hasText: "Heat cells" });
  await expect(grid).toBeHidden();
  await page.getByRole("radio", { name: "Heat grid" }).click();
  await expect(grid).toBeVisible();
  await expect(grid).toContainText(/each cell ≈ [\d.]+° × [\d.]+°/);
});

test("many markers can be clustered into numbered circles, which split when the cluster is clicked", async ({ page }) => {
  const lines = ["site,lat,lon"];
  let seed = 5;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  for (let i = 0; i < 400; i++) {
    const city = i % 3 === 0 ? [-33.87, 151.2] : i % 3 === 1 ? [-37.81, 144.96] : [-31.95, 115.86];
    lines.push(`s${i},${(city[0]! + rnd() * 0.3).toFixed(4)},${(city[1]! + rnd() * 0.3).toFixed(4)}`);
  }
  lines.push("lone,-12.46,130.84");
  await openMap(page, lines.join("\n"), "many.csv");
  const show = page.getByLabel("Map display mode");
  await expect(show).toBeVisible();
  await show.selectOption("cluster");
  const card = page.locator(".map-card");
  await expect(card).toContainText(/\d+ clusters? and \d+ single markers? in view/, { timeout: 15_000 });
  await expect(card).toContainText("click a cluster to zoom in");
  await show.selectOption("points");
  await expect(card).not.toContainText("click a cluster to zoom in");
});

test("columns not named like coordinates can be chosen by hand as latitude and longitude", async ({ page }) => {
  await openMap(page, "x,y,price\n-0.1,51.5,120\n2.3,48.9,150\n-3.7,40.4,90\n", "grid.csv");
  // Nothing is named lat or lon, so nothing is guessed: not even from price, whose values would fit.
  await expect(page.locator(".map-empty")).toContainText("choose them with Latitude and Longitude");
  await expect(page.locator(".map-sub")).toHaveText("");
  await expect(page.getByLabel("Latitude column")).toHaveValue("-1");

  // One alone waits for the other.
  await page.getByLabel("Latitude column").selectOption({ label: "y" });
  await expect(page.locator(".map-empty")).toBeVisible();
  await page.getByLabel("Longitude column").selectOption({ label: "x" });
  await expect(page.locator(".map-empty")).toBeHidden();
  await expect(page.locator(".map-sub")).toHaveText("y / x");
  await expect(page.getByLabel("Latitude column")).toHaveValue("1");
  await expect(page.getByLabel("Longitude column")).toHaveValue("0");

  // Both back to none returns to the plain map.
  await page.getByLabel("Latitude column").selectOption({ label: "— none —" });
  await page.getByLabel("Longitude column").selectOption({ label: "— none —" });
  await expect(page.locator(".map-empty")).toBeVisible();
});
