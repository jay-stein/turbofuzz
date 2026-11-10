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
