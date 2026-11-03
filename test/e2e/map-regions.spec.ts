import { readFileSync } from "node:fs";
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
  await expect(card.locator(".map-drop")).toContainText("Drop a boundary file here");
  await page.getByRole("radio", { name: "Markers" }).click();
  await expect(card.getByRole("button", { name: "Load boundaries…" })).toBeHidden();
  await expect(card.locator(".chart-note")).toContainText("places from");
});

test("a file dropped on the map loads, from any kind of map, and a clear match needs no asking", async ({ page }) => {
  const card = await openMap(page, WIND);
  const canvas = card.locator(".chart-canvas-wrap");
  const data = await page.evaluateHandle((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "counties.geojson", { type: "application/json" }));
    return transfer;
  }, counties());
  await canvas.dispatchEvent("dragenter", { dataTransfer: data });
  await expect(card.locator(".map-drop.dragging")).toBeVisible();
  await canvas.dispatchEvent("drop", { dataTransfer: data });
  await expect(card.locator(".map-region-status").first()).toContainText("counties.geojson · 3 regions");
  await expect(page.getByRole("radio", { name: "Choropleth" })).toHaveAttribute("aria-checked", "true");
  await expect(card.locator(".map-drop")).toBeHidden();
  await expect(page.getByRole("dialog", { name: /Match the boundaries/ })).toHaveCount(0);
  await expect(card.locator(".map-step").nth(1)).toContainText("NAME_1 = County");
  await expect(card.locator(".map-step").nth(1)).toContainText("2 of 3 regions have rows");
});

test("the match window shows both tables, marks the suggestion, greens the choice, and lists what did not match apart", async ({ page }) => {
  const card = await openMap(page, WIND);
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await load(card, counties());
  await expect(card.locator(".map-step").nth(1)).toContainText("NAME_1 = County");
  await card.getByRole("button", { name: "Match up…" }).click();
  const dialog = page.getByRole("dialog", { name: /Match the boundaries/ });
  const file = dialog.getByRole("table", { name: "Boundary file" });
  const table = dialog.getByRole("table", { name: "Your table" });
  // At first the suggestion is only marked: bold, and asking to be confirmed.
  await expect(file.locator("th.suggested")).toContainText("NAME_1");
  await expect(file.locator("th.suggested")).toContainText("Suggested: click to confirm");
  await expect(file.locator("th.suggested")).toHaveCSS("font-weight", "700");
  await expect(file.locator("th.chosen")).toHaveCount(0);
  await expect(table.locator("th.suggested")).toContainText("County");
  await expect(dialog.locator(".map-pop-result")).toContainText("2 of 3 regions have rows");
  // Confirming turns the whole column green.
  await file.locator("th", { hasText: "NAME_1" }).click();
  await expect(file.locator("th.chosen")).toContainText("Selected");
  await expect(file.locator("td.chosen").first()).toHaveText("Carlow");
  await expect(file.locator("td.chosen").first()).toHaveCSS("background-color", "rgb(201, 239, 207)");
  await table.locator("td", { hasText: /^Carlow$/ }).first().click();
  await expect(table.locator("th.chosen")).toContainText("County");
  // Click a cell in another column: it is the choice now, the suggestion still marked, and the count follows.
  await file.locator("td", { hasText: /^Ireland$/ }).first().click();
  await expect(file.locator("th.chosen")).toContainText("COUNTRY");
  await expect(file.locator("th.suggested")).toContainText("Suggested");
  await expect(file.locator("th.suggested")).toContainText("NAME_1");
  await expect(dialog.locator(".map-pop-result")).toContainText("Nothing matches");
  await file.locator("th", { hasText: "NAME_1" }).click();
  await expect(dialog.locator(".map-pop-result")).toContainText("2 of 3");
  await dialog.getByRole("button", { name: /What did not match/ }).click();
  await expect(dialog.locator(".map-unmatched")).toContainText("Cavan");
  await expect(dialog.locator(".map-unmatched")).toContainText("Dublin (1 row)");
  await dialog.getByRole("button", { name: "Match up", exact: true }).click();
  await dialog.getByRole("button", { name: "Use this match" }).click();
  await expect(dialog).toBeHidden();
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

test("with no clear match, the match window opens by itself", async ({ page }) => {
  const card = await openMap(page, "thing,amount\nalpha,1\nbeta,2");
  await page.getByRole("radio", { name: "Choropleth" }).click();
  // A table with no coordinates still has its filter settings here.
  await expect(card.getByRole("checkbox", { name: "Also respect table filters" })).toBeVisible();
  await load(card, counties());
  await expect(page.getByRole("dialog", { name: /Match the boundaries/ })).toBeVisible();
});

test("classes float beside the map: method, fixed interval, and editing a break makes them manual", async ({ page }) => {
  const rows = ["County,MW", ...["Carlow", "Cavan", "Clare"].map((name, i) => `${name},${(i + 1) * 300}`)];
  const card = await openMap(page, rows.join("\n"));
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await load(card, counties());
  await expect(card.locator(".map-step").nth(1)).toContainText("NAME_1 = County");
  const value = card.getByRole("combobox", { name: "Region value" });
  await value.selectOption((await value.locator("option", { hasText: "MW" }).getAttribute("value"))!);
  await card.getByRole("button", { name: "Classes and colours…" }).click();
  const pop = page.getByRole("dialog", { name: "Classes and colours" });
  await expect(pop.getByRole("combobox", { name: "Classification method" })).toHaveValue("natural");
  await expect(pop.locator(".map-region-class:not(.head)")).toHaveCount(3);
  await pop.getByRole("combobox", { name: "Classification method" }).selectOption("fixed");
  await pop.getByRole("spinbutton", { name: "Class interval" }).fill("200");
  await pop.getByRole("spinbutton", { name: "Class interval" }).blur();
  await expect(pop.locator(".map-region-class:not(.head)")).toHaveCount(4);
  await expect(pop.getByRole("textbox", { name: "End of class 1" })).toHaveValue("400");
  await pop.getByRole("textbox", { name: "End of class 1" }).fill("350");
  await pop.getByRole("textbox", { name: "End of class 1" }).blur();
  await expect(pop.getByRole("combobox", { name: "Classification method" })).toHaveValue("manual");
  await expect(pop.getByRole("textbox", { name: "End of class 1" })).toHaveValue("350");
  await expect(card.locator(".map-step").nth(3)).toContainText("Manual");
});

test("with coordinates and no name in common, rows go by where they are", async ({ page }) => {
  // Two rows in Carlow (-8 to -7), one in Clare (-6 to -5), one in the sea.
  const card = await openMap(page, ["lat,lon,gender", "52.5,-7.5,1", "52.2,-7.2,2", "52.5,-5.5,1", "60,0,3"].join("\n"));
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await load(card, counties());
  await expect(card.locator(".map-step").nth(1)).toContainText("By location: lat and lon");
  await expect(card.locator(".map-step").nth(1)).toContainText("2 of 3 regions have rows");
  await expect(card.locator(".map-step").nth(1)).toContainText("3 rows matched, 1 did not");
});

test("settings that mean nothing for a choropleth are gone, and come back for markers", async ({ page }) => {
  const card = await openMap(page, ["lat,lon,v", "52.5,-7.5,1", "52.2,-7.2,2", "52.5,-5.5,1"].join("\n"));
  const size = card.getByRole("combobox", { name: "Size column" });
  await expect(size).toBeVisible();
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await expect(size).toBeHidden();
  await expect(card.locator(".chart-swatch").first()).toBeHidden();
  await expect(card.getByRole("combobox", { name: "Colour map" })).toBeHidden();
  await expect(card.locator(".chart-side-settings .chart-side-title")).toHaveText("Which rows count");
  await expect(card.getByRole("checkbox", { name: "Also respect table filters" })).toBeVisible();
  await page.getByRole("radio", { name: "Markers" }).click();
  await expect(size).toBeVisible();
  await expect(card.locator(".chart-side-settings .chart-side-title")).toHaveText("Colour, filter and format");
});

test("the marker size is off until there are markers, and city names have their own size", async ({ page }) => {
  await openMap(page, ["lat,lon,v", "52.5,-7.5,1", "52.2,-7.2,2"].join("\n"));
  await expect(page.getByRole("slider", { name: "Size of your markers" })).toBeDisabled();
  await expect(page.getByRole("slider", { name: "Size of city names" })).toBeHidden();
  await page.getByRole("switch", { name: "Show world cities" }).check({ force: true });
  await expect(page.getByRole("slider", { name: "Size of city names" })).toBeVisible();
});

test("a file that does not say what its numbers are asks, with good guesses; hover names the region", async ({ page }) => {
  const card = await openMap(page, WIND);
  await page.getByRole("radio", { name: "Choropleth" }).click();
  // Web Mercator metres, with no statement.
  await load(card, counties(undefined, 111319.49, [0, 0]), "m.geojson");
  const dialog = page.getByRole("dialog", { name: "Coordinate system" });
  await expect(dialog).toContainText("Choose the coordinate system");
  await dialog.getByRole("searchbox", { name: "Search coordinate systems" }).fill("mercator");
  await dialog.getByRole("button", { name: /Web Mercator/ }).click();
  await expect(dialog).toBeHidden();
  await expect(card.locator(".map-globe")).toContainText("Web Mercator");
  await expect(card.locator(".map-region-status").first()).toContainText("3 regions");
  await expect(page.locator(".map-empty")).toBeHidden();
  const box = (await card.locator("canvas.chart-canvas").boundingBox())!;
  const tooltip = card.locator(".chart-tooltip");
  let text = "";
  for (let fy = 0.2; fy < 0.85 && text === ""; fy += 0.04) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * fy);
    await page.waitForTimeout(40);
    if (await tooltip.isVisible()) text = (await tooltip.textContent()) ?? "";
  }
  expect(text).toContain("Cavan");
});

test("the globe says what the file is in, and a depth system is explained rather than refused blankly", async ({ page }) => {
  const card = await openMap(page, WIND);
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await load(card, counties("EPSG:4326"));
  await card.locator(".map-globe").click();
  const dialog = page.getByRole("dialog", { name: "Coordinate system" });
  await expect(dialog).toContainText("This is what the file itself states");
  await expect(dialog).toContainText("there is nothing to do");
  await dialog.getByRole("searchbox", { name: "Search coordinate systems" }).fill("10151");
  await dialog.getByRole("button", { name: "Try EPSG:10151" }).click();
  await expect(dialog.locator(".map-region-warning")).toContainText("height or depth");
});

test("the map exports as one interactive web page that works with nothing else", async ({ page, context }) => {
  const rows = ["County,MW", ...["Carlow", "Cavan", "Clare"].map((name, i) => `${name},${(i + 1) * 300}`)];
  const card = await openMap(page, rows.join("\n"));
  await page.getByRole("radio", { name: "Choropleth" }).click();
  await load(card, counties());
  await expect(card.locator(".map-step").nth(1)).toContainText("NAME_1 = County");
  const value = card.getByRole("combobox", { name: "Region value" });
  await value.selectOption((await value.locator("option", { hasText: "MW" }).getAttribute("value"))!);
  await expect(card.locator(".chart-note")).toContainText("Total MW");
  await card.locator(".chart-png-btn").click();
  await expect(page.locator(".context-menu")).toContainText("Download PNG at");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".context-menu .context-item", { hasText: "Interactive web page" }).click()]);
  expect(download.suggestedFilename()).toMatch(/-map\.html$/);
  const html = readFileSync((await download.path())!, "utf8");
  expect(html).not.toMatch(/https?:\/\//);

  // Offline, as it would be from an email: anything it tried to fetch would fail here.
  const viewer = await context.newPage();
  const asked: string[] = [];
  viewer.on("request", (request) => {
    if (!request.url().startsWith("about:") && !request.url().startsWith("data:")) asked.push(request.url());
  });
  const errors: string[] = [];
  viewer.on("pageerror", (error) => errors.push(error.message));
  await viewer.setViewportSize({ width: 1000, height: 700 });
  await viewer.setContent(html);
  await expect(viewer.locator(".legend")).toContainText("Total MW");
  await expect(viewer.locator(".player")).toBeHidden();
  const box = (await viewer.locator("canvas").boundingBox())!;
  let text = "";
  for (let fy = 0.2; fy < 0.85 && text === ""; fy += 0.05) {
    await viewer.mouse.move(box.x + box.width * 0.5, box.y + box.height * fy);
    await viewer.waitForTimeout(30);
    if (await viewer.locator(".tip").isVisible()) text = (await viewer.locator(".tip").textContent()) ?? "";
  }
  expect(text).toContain("Cavan");
  expect(text).toContain("600");
  await viewer.locator("[data-zoom=in]").click();
  await viewer.locator("[data-zoom=fit]").click();
  expect(errors).toEqual([]);
  expect(asked).toEqual([]);
});

test("exported dots step through time on the slider, and a table value cannot break out of the page", async ({ page, context }) => {
  const lines = ["lat,lon,when,minutes,place"];
  for (let i = 0; i < 60; i++) lines.push(`${52 + (i % 3) * 0.2},${-8 + (i % 3) * 0.2},2024-03-0${1 + (i % 4)},${10 + (i % 3) * 5 + (i % 4)},"Town ${i % 3}</script><b>x"`);
  const card = await openMap(page, lines.join("\n"));
  await expect(card.locator(".chart-note")).toContainText("3 places");
  const colour = card.getByRole("combobox", { name: "Colour column" });
  await colour.selectOption((await colour.locator("option", { hasText: "minutes" }).getAttribute("value"))!);
  await card.locator(".chart-animate-btn").click();
  await expect(card.getByRole("button", { name: /Play/ })).toBeVisible();
  await card.locator(".chart-png-btn").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".context-menu .context-item", { hasText: "Interactive web page" }).click()]);
  const html = readFileSync((await download.path())!, "utf8");
  expect(html).not.toContain("</script><b>x");
  const viewer = await context.newPage();
  const errors: string[] = [];
  viewer.on("pageerror", (error) => errors.push(error.message));
  await viewer.setContent(html);
  await expect(viewer.locator(".player")).toBeVisible();
  await expect(viewer.locator(".period")).toHaveText(/2024-03-01/);
  await viewer.locator(".player input").fill("2");
  await expect(viewer.locator(".period")).toHaveText(/2024-03-03/);
  await expect(viewer.locator(".legend")).toContainText("average minutes");
  await viewer.locator(".player button").click();
  await expect(viewer.locator(".player button")).toHaveText("Pause");
  await viewer.locator(".player button").click();
  expect(errors).toEqual([]);
  // Heat grids go out as a PNG only.
  await page.getByRole("radio", { name: "Heat grid" }).click();
  await card.locator(".chart-png-btn").click();
  await expect(page.locator(".context-menu")).not.toContainText("Interactive web page");
});

