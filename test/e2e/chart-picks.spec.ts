import { expect, test, type Page } from "@playwright/test";

/** Two years of sales in 20 regions, in two types. */
function sales(): string {
  const lines = ["date,region,type,sales,price"];
  for (let d = 0; d < 720; d += 6) {
    const when = new Date(Date.UTC(2023, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
    for (let r = 0; r < 20; r++) lines.push(`${when},Region ${String(r).padStart(2, "0")},${r % 2 ? "organic" : "conventional"},${(20 - r) * 100 + (d % 50)},${1 + (r % 5) * 0.2 + (d % 11) * 0.01}`);
  }
  return lines.join("\n");
}

/** 150 customers: too many values to group a chart by. */
function customers(): string {
  const lines = ["customer,product,amount"];
  for (let i = 0; i < 600; i++) lines.push(`Customer ${String(i % 150).padStart(3, "0")},P${i % 3},${(i * 37) % 500}`);
  return lines.join("\n");
}

async function open(page: Page, csv = sales()): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
}

const field = (page: Page, name: string) =>
  page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) });

/** Clears the shelf, picks these fields, then a chart type from the common row. */
async function make(page: Page, names: readonly string[], type: string): Promise<void> {
  if ((await page.locator(".chart-add-panel:not(.hidden)").count()) === 0) await page.getByRole("button", { name: "+ Add chart" }).click();
  if ((await page.locator(".chart-add-clear").count()) > 0) await page.locator(".chart-add-clear").click();
  for (const name of names) await field(page, name).click();
  await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type", { hasText: type }).click();
  await page.locator(".chart-card:not(.hidden) .chart-canvas").waitFor();
}

/** "name=Role" for every field the open chart uses, from the field rail. */
const used = (page: Page): Promise<string[]> =>
  page.locator(".chart-rail-field.used").evaluateAll((nodes) =>
    nodes.map((node) => `${node.querySelector(".chart-rail-name")?.textContent}=${node.querySelector(".chart-rail-role")?.textContent ?? ""}`).sort(),
  );

test("fields picked before a chart type stay on the chart, in every slot the type has", async ({ page }) => {
  await open(page);
  await make(page, ["date", "sales"], "Bar");
  expect(await used(page)).toEqual(["date=Category", "sales=Value"]);
  await make(page, ["date", "sales", "type"], "Bar");
  expect(await used(page)).toEqual(["date=Category", "sales=Value", "type=Group by"]);
  await make(page, ["region", "type", "sales"], "Bar");
  expect(await used(page)).toEqual(["region=Category", "sales=Value", "type=Group by"]);
  await make(page, ["sales", "price", "type"], "Scatter");
  expect(await used(page)).toEqual(["price=Y", "sales=X", "type=Colour"]);
  await make(page, ["type", "sales"], "Histogram");
  expect(await used(page)).toEqual(["sales=Values", "type=Group by"]);
  // Nothing picked fits a heatmap of counts: it says so instead of charting fields nobody picked.
  await page.getByRole("button", { name: "+ Add chart" }).click();
  // A new chart starts with an empty shelf.
  await expect(page.locator(".chart-add-chip")).toHaveCount(0);
  const before = await page.locator(".charts-tab").count();
  for (const name of ["date", "sales"]) await field(page, name).click();
  await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type", { hasText: "Heatmap" }).click();
  await expect(page.locator(".chart-add-message")).toContainText("do not fit a heatmap");
  expect(await page.locator(".charts-tab").count()).toBe(before);
});

test("changing a finished chart's type keeps its second field: the group, the colour, a box plot's groups", async ({ page }) => {
  await open(page);
  await make(page, ["region", "type", "sales"], "Bar");
  const changeTo = async (label: string): Promise<void> => {
    await page.locator(".chart-card:not(.hidden) .chart-kind-button").click();
    await page.locator(".chart-kind-pop .chart-kind-option").filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) }).first().click();
    await page.waitForTimeout(300);
  };
  await changeTo("Line");
  // No date among the fields: the line runs over the category it had, still grouped.
  expect(await used(page)).toEqual(["region=X", "sales=Value", "type=Group by"]);
  await changeTo("Scatter");
  expect(await used(page)).toContain("region=Colour");
  // The axis no pick fits borrows a number, never the date nobody picked.
  expect(await used(page)).not.toContain("date=X");
  expect(await used(page)).toContain("price=X");
  // One of the picked categories splits it; the values stay the values.
  await changeTo("Histogram");
  expect(await used(page)).toContain("sales=Values");
  expect((await used(page)).some((entry) => /^(region|type)=Group by$/.test(entry))).toBe(true);
  // A box plot's Groups take a category, never the values column.
  await changeTo("Box plot");
  expect(await used(page)).toContain("sales=Value");
  expect((await used(page)).some((entry) => /^(region|type)=Groups$/.test(entry))).toBe(true);
});

test("Bar of categories alone counts rows, a group splits the counts, and nothing borrows a field nobody picked", async ({ page }) => {
  await open(page);
  const note = page.locator(".chart-card:not(.hidden) .chart-note").first();
  // One category: a count per type, never the average of a measure nobody picked.
  await make(page, ["type"], "Bar");
  expect(await used(page)).toEqual(["type=Category"]);
  await expect(note).toContainText(/^2 groups · Rows by type/i);
  // Two categories: counts split by the second.
  await make(page, ["region", "type"], "Bar");
  expect(await used(page)).toEqual(["region=Category", "type=Group by"]);
  await expect(note).toContainText("series");
  await expect(note).not.toContainText("Pick a numeric measure");
  // One number on a scatter: Y borrows another number, not the date.
  await make(page, ["region", "sales"], "Scatter");
  expect(await used(page)).toEqual(["price=Y", "region=Colour", "sales=X"]);
});

test("a field with too many values to group by is refused on Bar, not swapped for another", async ({ page }) => {
  await open(page, customers());
  for (const name of ["customer", "amount"]) await field(page, name).click();
  const before = await page.locator(".charts-tab").count();
  await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type", { hasText: "Bar" }).click();
  await expect(page.locator(".chart-add-message")).toContainText("do not fit a bar");
  expect(await page.locator(".charts-tab").count()).toBe(before);
});

test("bars of a date group by period or by a repeating part (every weekday together)", async ({ page }) => {
  await open(page);
  await make(page, ["date", "sales"], "Bar");
  const grain = page.locator(".chart-card:not(.hidden) select").filter({ has: page.locator('option[value="part:dow"]') });
  await expect(grain).toBeVisible();
  await grain.selectOption("month");
  await expect(page.locator(".chart-card:not(.hidden) .chart-headline")).toBeVisible();
  await grain.selectOption("part:dow");
  await expect(grain).toHaveValue("part:dow");
  // Period settings (width, gaps, week start) say nothing about a repeating part.
  await expect(page.locator(".chart-card:not(.hidden) .chart-every-input")).toBeHidden();
  // The note names the part in words, not the engine's code.
  await expect(page.locator(".chart-card:not(.hidden) .chart-note")).toContainText("date (day of week)");
  // A line asked for a weekday becomes bars of weekdays.
  await make(page, ["date", "sales"], "Line");
  await grain.selectOption("part:month");
  await expect(grain).toHaveValue("part:month");
  expect(await used(page)).toEqual(["date=Category", "sales=Value"]);
});

test("fields are grouped by kind, and a fuzzy find picks one with Enter", async ({ page }) => {
  await open(page);
  await expect(page.locator(".chart-add-field-group-title")).toHaveText(["Dates and times", "Categories", "Numbers"]);
  const groups = page.locator(".chart-add-field-group");
  await expect(groups.nth(0).locator(".chart-add-field-name")).toHaveText(["date"]);
  await expect(groups.nth(2).locator(".chart-add-field-name")).toHaveText(["sales", "price"]);
  const find = page.getByRole("searchbox", { name: "Find a field" });
  await find.fill("prce");
  await expect(page.locator(".chart-add-field-name")).toHaveText(["price"]);
  await find.press("Enter");
  await expect(page.locator(".chart-add-chip")).toHaveCount(1);
  await expect(page.locator(".chart-add-chip")).toContainText("price");
  await expect(find).toHaveValue("");
  await expect(find).toBeFocused();
  // The rail beside a chart groups the same way.
  await make(page, ["date", "sales"], "Line");
  await expect(page.locator(".chart-rail-group")).toHaveText(["Dates and times", "Categories", "Numbers"]);
});
