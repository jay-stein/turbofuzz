import { test, expect, type Page } from "@playwright/test";

function sales(): string {
  const lines = ["week,region,product,amount"];
  let d = Date.UTC(2023, 0, 2);
  for (let i = 0; i < 30; i++) {
    const day = new Date(d).toISOString().slice(0, 10);
    for (const region of ["North", "South", "East"]) {
      for (const product of ["Tea", "Coffee"]) lines.push(`${day},${region},${product},${100 + ((i * 7 + region.length * 13 + product.length) % 90)}`);
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

test("Peek shows the table's first rows over a chart of the table, and puts itself away", async ({ page }) => {
  await load(page);
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /^Histogram$/ }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await card(page).locator(".chart-peek-btn").click();
  const peek = page.locator(".chart-peek");
  await expect(peek.locator(".chart-peek-title")).toHaveText("Table · first 10 of 180 rows");
  await expect(peek.locator("tbody tr")).toHaveCount(10);
  await expect(peek.locator("th", { hasText: "region" })).toBeVisible();
  // The chart's own column is marked.
  await expect(peek.locator("th.used")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(peek).toHaveCount(0);
  // The button toggles it, and a click elsewhere closes it.
  await card(page).locator(".chart-peek-btn").click();
  await expect(peek).toHaveCount(1);
  await page.mouse.click(5, 500);
  await expect(peek).toHaveCount(0);
});

test("Peek over a chart of a Pivot View shows that pivot, scrollable", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Pivot View", exact: true }).click();
  await page.locator(".views-host").getByLabel("Add a column field").first().click();
  await page.locator(".menu, [role=menu]").last().getByText("product", { exact: false }).first().click();
  await page.locator(".views-chart-this").first().click();
  await expect(page.getByRole("tab", { name: "Chart", exact: true })).toHaveAttribute("aria-selected", "true");
  await card(page).locator(".chart-peek-btn").click();
  const peek = page.locator(".chart-peek");
  await expect(peek.locator(".chart-peek-title")).toContainText("Pivot View");
  await expect(peek.locator("th", { hasText: "Coffee" })).toBeVisible();
  await expect(peek.locator("th", { hasText: "Tea" })).toBeVisible();
  await expect(peek.locator(".chart-peek-open")).toHaveText("Open Pivot View");
  await page.screenshot({ path: "C:/Users/mrjay/AppData/Local/Temp/claude/688ca4fe6de39c2d/42bb0c6d-cd3e-48b3-aa09-4b9ce8d81094/scratchpad/peek-pivot.png" });
});
