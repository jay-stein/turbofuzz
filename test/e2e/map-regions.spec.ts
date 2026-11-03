import { expect, test, type Locator, type Page } from "@playwright/test";

/** Three square counties in a row, as a GeoJSON. */
const counties = (crs?: string, scale = 1, shift: [number, number] = [0, 0]): string =>
  JSON.stringify({
    type: "FeatureCollection",
    ...(crs === undefined ? {} : { crs: { type: "name", properties: { name: crs } } }),
    features: ["Carlow", "Cavan", "Clare"].map((name, index) => ({
      type: "Feature",
      properties: { ID_1: index + 1, COUNTRY: "Ireland", NAME_1: name, POP: (index + 1) * 1000 },
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(([x, y]) => [(x! + index - 8) * scale + shift[0], (y! + 52) * scale + shift[1]])],
      },
    })),
  });

async function openMap(page: Page, csv: string): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "t.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Map" }).first().click();
  const card = page.locator(".map-card");
  await card.locator(".chart-note").waitFor();
  return card;
}

const load = async (card: Locator, geojson: string, name = "c.geojson"): Promise<void> => {
  await card.locator('input[aria-label="Boundary file"]').setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(geojson) });
};

// "No" runs 1, 2, 3 just as ID_1 does: the words must win.
const WIND = ["No,County,MW", "1,Carlow,10", "2,Carlow,20", "3,Clare,500", "4,Dublin,7"].join("\n");

test("the map's kinds are pictures: Markers, Heat grid and Choropleth, and Choropleth asks for boundaries", async ({ page }) => {
  const card = await openMap(page, "lat,lon,v\n" + Array.from({ length: 30 }, (_, i) => `${52 + (i % 3)},${-8 + (i % 3)},${i}`).join("\n"));
  await expect(page.getByRole("radio", { name: "Markers" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".map-type-icon")).toHaveCount(3);
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await expect(page.getByRole("radio", { name: "Choropleth" })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("button", { name: "Load boundaries…" })).toBeVisible();
  await expect(card.locator(".chart-note")).toContainText("Load a boundary file");
  await page.getByRole("radio", { name: "Markers" }).click();
  await expect(card.getByRole("button", { name: "Load boundaries…" })).toBeHidden();
  await expect(card.locator(".chart-note")).toContainText("places from");
});

test("matching by name finds the right fields by itself, and says what did not match", async ({ page }) => {
  const card = await openMap(page, WIND);
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await load(card, counties());
  await expect(card.locator(".map-region-status")).toContainText("3 regions");
  await expect(card.getByRole("combobox", { name: "Boundary field" })).toHaveValue("NAME_1");
  await expect(card.getByRole("combobox", { name: "Table column to match" }).locator("option:checked")).toHaveText("County");
  await expect(card.getByRole("combobox", { name: "Region name field" })).toHaveValue("NAME_1");
  await expect(card.locator(".map-region-report")).toContainText("2 of 3 regions have rows");
  await expect(card.locator(".map-region-report")).toContainText("Dublin (1)");
  await expect(card.locator(".map-region-report")).toContainText("Regions with no rows: Cavan");
  // The numbers: a total by county, in the stats.
  const value = card.getByRole("combobox", { name: "Region value" });
  await value.selectOption((await value.locator("option", { hasText: "MW" }).getAttribute("value"))!);
  await expect(card.locator(".chart-note")).toContainText("Total MW");
  await card.locator(".chart-stats-btn").click();
  const stats = page.getByRole("dialog", { name: "Chart stats" });
  const rows = await stats.locator(".chart-stats-section", { has: page.locator("h3", { hasText: /^Regions$/ }) }).locator("tbody tr").allTextContents();
  expect(rows.find((row) => row.startsWith("Carlow"))).toContain("30");
  expect(rows.find((row) => row.startsWith("Clare"))).toContain("500");
  await page.keyboard.press("Escape");
});

test("classes are configurable: method, fixed interval, and editing a break makes them manual", async ({ page }) => {
  const rows = ["County,MW", ...["Carlow", "Cavan", "Clare"].map((name, i) => `${name},${(i + 1) * 300}`)];
  const card = await openMap(page, rows.join("\n"));
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await load(card, counties());
  const value = card.getByRole("combobox", { name: "Region value" });
  await value.selectOption((await value.locator("option", { hasText: "MW" }).getAttribute("value"))!);
  await expect(card.getByRole("combobox", { name: "Classification method" })).toHaveValue("natural");
  await expect(card.locator(".map-region-class:not(.head)")).toHaveCount(3);
  await card.getByRole("combobox", { name: "Classification method" }).selectOption("fixed");
  await card.getByRole("spinbutton", { name: "Class interval" }).fill("200");
  await expect(card.locator(".map-region-class:not(.head)")).toHaveCount(4);
  await expect(card.getByRole("textbox", { name: "End of class 1" })).toHaveValue("400");
  await card.getByRole("textbox", { name: "End of class 1" }).fill("350");
  await card.getByRole("textbox", { name: "End of class 1" }).blur();
  await expect(card.getByRole("combobox", { name: "Classification method" })).toHaveValue("manual");
  await expect(card.getByRole("textbox", { name: "End of class 1" })).toHaveValue("350");
});

test("with coordinates and no name in common, rows go by where they are", async ({ page }) => {
  // Two rows in Carlow (-8 to -7), one in Clare (-6 to -5), one in the sea.
  const card = await openMap(page, ["lat,lon,gender", "52.5,-7.5,1", "52.2,-7.2,2", "52.5,-5.5,1", "60,0,3"].join("\n"));
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await load(card, counties());
  await expect(card.getByRole("radio", { name: "Match by location" })).toBeChecked();
  await expect(card.locator(".map-region-report")).toContainText("2 of 3 regions have rows");
  await expect(card.locator(".map-region-report")).toContainText("3 rows matched");
  await expect(card.locator(".map-region-report")).toContainText("1 did not");
});

test("a file that does not say what its numbers are asks, and an override places it; hover names the region", async ({ page }) => {
  const card = await openMap(page, WIND);
  await page.getByRole("radio", { name: "Choropleth" }).click();
  // Web Mercator metres, with no statement.
  await load(card, counties(undefined, 111319.49, [0, 0]), "m.geojson");
  await expect(card.locator(".map-region-warning")).toContainText("Choose the coordinate system");
  await card.getByRole("combobox", { name: "Coordinate system", exact: true }).selectOption("EPSG:3857");
  await card.getByRole("button", { name: "Use this" }).click();
  await expect(card.locator(".map-region-crs")).toContainText("Web Mercator");
  await expect(card.locator(".map-region-crs")).toContainText("as you chose");
  await expect(card.locator(".map-region-status")).toContainText("3 regions");
  await expect(page.locator(".map-empty")).toBeHidden();
  const box = (await card.locator("canvas.chart-canvas").boundingBox())!;
  const tooltip = card.locator(".chart-tooltip");
  let text = "";
  for (let fy = 0.3; fy < 0.75 && text === ""; fy += 0.05) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * fy);
    await page.waitForTimeout(40);
    if (await tooltip.isVisible()) text = (await tooltip.textContent()) ?? "";
  }
  expect(text).toContain("Cavan");
});
