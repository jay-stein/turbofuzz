import { test, expect, type Page } from "@playwright/test";

/** Weekly sales for two regions and two products: a date, two categories and two numbers. */
function sales(): string {
  const lines = ["week,region,product,amount,units"];
  let d = Date.UTC(2023, 0, 2);
  for (let i = 0; i < 80; i++) {
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
  // These tests work the settings under Refine and Format, which are closed until opened.
  await page.addInitScript(() => {
    localStorage.setItem("turbofuzz.charts.refineOpen", "1");
    localStorage.setItem("turbofuzz.charts.formatOpen", "1");
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
}

const card = (page: Page) => page.locator(".chart-card:not(.hidden)");
const select = (page: Page, label: string) => card(page).locator(`select[aria-label="${label}"]`);
const field = (page: Page, name: string) =>
  page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) });

/** Pixels of the plot that are not its most common colour: zero on a chart that drew nothing. */
async function ink(page: Page): Promise<number> {
  return card(page).locator("canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let saturated = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (data[i + 3] > 0 && max - min > 60) saturated++;
    }
    return saturated;
  });
}

async function barChart(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  await field(page, "region").click();
  await field(page, "amount").click();
  await page.locator(".chart-add-recs .chart-add-tile").first().click();
  await expect(card(page)).toContainText("amount by region");
}

test("a bar chart split by a second field shows no X or Y pickers, and keeps the split when the value changes", async ({ page }) => {
  await load(page);
  await barChart(page);
  await select(page, "Group by").selectOption({ label: "product (Category)" });
  await expect(card(page)).toContainText("grouped by product");
  await expect(select(page, "X column")).toBeHidden();
  await expect(select(page, "Y column")).toBeHidden();

  await select(page, "Value column").selectOption({ label: "units (Integer)" });
  await expect(card(page)).toContainText("units by region grouped by product");
  await expect(select(page, "Group by")).toHaveValue(await select(page, "Group by").locator("option", { hasText: "product" }).getAttribute("value") ?? "");
});

test("weekly data drawn by day and split into series still draws its lines, with and without a running total", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  await field(page, "week").click();
  await field(page, "amount").click();
  await page.locator(".chart-add-recs .chart-add-tile").first().click();
  await select(page, "Bucket").selectOption({ label: "Day" });
  await select(page, "Group by").selectOption({ label: "region (Category)" });
  await expect(card(page)).toContainText("grouped by region");
  await expect.poll(() => ink(page)).toBeGreaterThan(200);
  await expect(select(page, "X column")).toBeHidden();

  await select(page, "Chart calculation").selectOption({ label: "Cumulative" });
  await expect(card(page)).toContainText("Cumulative");
  await expect.poll(() => ink(page)).toBeGreaterThan(200);
});

test("changing the chart type never leaves a chart split by the field it is laid out by", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  await field(page, "week").click();
  await field(page, "amount").click();
  await page.locator(".chart-add-recs .chart-add-tile").first().click();
  await select(page, "Group by").selectOption({ label: "region (Category)" });
  await card(page).locator("button.chart-kind-button").click();
  await page.locator("button:visible", { hasText: /^Barplot$/ }).last().click();
  await expect(card(page)).toContainText("Barplot:");
  // Lay the bars out by region, the field they are already split by: the split has to go.
  await select(page, "Chart column").selectOption({ label: "region (Category)" });
  await expect(card(page)).toContainText("amount by region");
  await expect(card(page)).not.toContainText("by region grouped by region");
});

test("Pivot heatmap on a pivot with a column field opens a heatmap chart of it", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Pivot View", exact: true }).click();
  const host = page.locator(".views-host");
  await host.getByLabel("Add a column field").first().click();
  await page.locator(".menu, [role=menu]").last().getByText("product", { exact: false }).first().click();
  const heatmap = host.locator("button", { hasText: /^Pivot heatmap$/ }).first();
  await expect(heatmap).toBeEnabled();
  await heatmap.click();
  await expect(page.getByRole("tab", { name: "Chart", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(card(page)).toContainText("Pivot heatmap");
});
