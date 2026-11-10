import { test, expect, type Page } from "@playwright/test";

/** Weekly sales for three regions and two products. */
function sales(): string {
  const lines = ["week,region,product,amount,units"];
  let d = Date.UTC(2023, 0, 2);
  for (let i = 0; i < 60; i++) {
    const day = new Date(d).toISOString().slice(0, 10);
    for (const region of ["North", "South", "East"]) {
      for (const product of ["Tea", "Coffee"]) {
        lines.push(`${day},${region},${product},${100 + ((i * 7 + region.length * 13 + product.length) % 90)},${5 + (i % 11)}`);
      }
    }
    d += 7 * 86_400_000;
  }
  return lines.join("\n");
}

async function load(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
}

const card = (page: Page) => page.locator(".chart-card:not(.hidden)");
const picker = (page: Page, label: string) => card(page).locator(`select[aria-label="${label}"]`);

async function addField(page: Page, zone: "row" | "column", name: string): Promise<void> {
  await page.locator(".views-host").getByLabel(`Add a ${zone} field`).first().click();
  await page.locator(".menu, [role=menu]").last().getByText(name, { exact: false }).first().click();
}

test("Chart this pivot puts Rows on the axis and Columns in the legend, and the chart can be reshaped and left for the pivot again", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Pivot View", exact: true }).click();
  await addField(page, "column", "product");
  const chartThis = page.locator(".views-chart-this").first();
  await expect(chartThis).toBeInViewport();
  await chartThis.click();

  await expect(page.getByRole("tab", { name: "Chart", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(card(page).locator(".chart-summary")).toContainText("one series per product");
  await expect(picker(page, "Pivot field for the series")).toHaveValue(/^\d+$/);
  await expect(card(page).locator(".chart-legend-item", { hasText: "Tea" })).toBeVisible();
  await expect(card(page).locator(".chart-legend-item", { hasText: "Coffee" })).toBeVisible();
  // The table's column pickers have no place on a chart of a pivot.
  await expect(picker(page, "Value column")).toBeHidden();
  await expect(picker(page, "X column")).toBeHidden();

  // One series: the pivot's rows alone.
  await picker(page, "Pivot field for the series").selectOption("-1");
  await expect(card(page).locator(".chart-summary")).not.toContainText("one series per");
  await expect(card(page).locator(".chart-legend-item")).toHaveCount(0);

  // The same pivot as a heatmap, then back to it with its layout as it was.
  await picker(page, "Chart type for this pivot").selectOption("pivotHeatmap");
  await expect(card(page).locator(".chart-summary")).toContainText("Pivot heatmap");
  await card(page).locator(".chart-back-to-source").click();
  await expect(page.getByRole("tab", { name: "Pivot View", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".views-host")).toContainText("product");
});

test("a chart of a pivot follows the pivot when its fields change", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Pivot View", exact: true }).click();
  await addField(page, "column", "product");
  await page.locator(".views-chart-this").first().click();
  await expect(card(page).locator(".chart-summary")).toContainText("one series per product");

  await page.getByRole("tab", { name: "Pivot View", exact: true }).click();
  await addField(page, "column", "region");
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  // The pivot gained a field: the chart's Series list offers it without the chart being rebuilt.
  await expect(picker(page, "Pivot field for the series").locator("option", { hasText: "region" })).toHaveCount(1);
});

test("Data behind this chart is closed until opened, then shows the pivot's numbers one column per series", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Pivot View", exact: true }).click();
  await addField(page, "column", "product");
  await page.locator(".views-chart-this").first().click();
  const drawer = card(page).locator(".chart-data-drawer");
  await expect(drawer.locator(".chart-data-name")).toHaveText("Data behind this chart");
  await expect(drawer.locator("table")).toHaveCount(0);

  await drawer.locator("summary").click();
  const head = drawer.locator("thead th");
  await expect(head.filter({ hasText: "Tea" })).toHaveCount(1);
  await expect(head.filter({ hasText: "Coffee" })).toHaveCount(1);
  // Every number in the drawer is a number the pivot shows.
  const cells = await drawer.locator("tbody td.num").allInnerTexts();
  expect(cells.length).toBeGreaterThan(1);
  await page.getByRole("tab", { name: "Pivot View", exact: true }).click();
  const pivotText = await page.locator(".views-host").innerText();
  for (const cell of cells.slice(0, 4)) expect(pivotText).toContain(cell);

  // The next chart opens with the drawer as it was left.
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  await expect(card(page).locator(".chart-data-drawer")).toHaveAttribute("open", "");
});

test("beside a chart of a pivot the field list shows the pivot's fields, a click moves one, and the chip returns to the pivot", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Pivot View", exact: true }).click();
  await addField(page, "column", "product");
  await page.locator(".views-chart-this").first().click();
  await expect(card(page).locator(".chart-summary")).toContainText("one series per product");

  const rail = page.locator(".chart-rail");
  await expect(rail.locator(".chart-rail-title")).toHaveText("Pivot fields");
  // The pivot's fields, not the table's columns: units is not in it.
  await expect(rail.locator(".chart-rail-field", { hasText: "units" })).toHaveCount(0);
  await expect(rail.locator(".chart-rail-field.used", { hasText: "product" })).toContainText("Series");
  await expect(rail.locator(".chart-rail-field.used").first()).toContainText("Axis");

  // The series field comes off with one click, and the legend goes.
  await rail.locator(".chart-rail-field", { hasText: "product" }).click();
  await expect(card(page).locator(".chart-legend-item")).toHaveCount(0);
  await rail.locator(".chart-rail-field", { hasText: "product" }).click();
  await expect(card(page).locator(".chart-legend-item", { hasText: "Tea" })).toBeVisible();

  // Where the chart came from is on it, and one click goes back.
  await expect(card(page).locator(".chart-source-chip")).toContainText("Pivot");
  await card(page).locator(".chart-source-chip").click();
  await expect(page.getByRole("tab", { name: "Pivot View", exact: true })).toHaveAttribute("aria-selected", "true");
});
