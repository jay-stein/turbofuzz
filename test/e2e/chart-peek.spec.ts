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

const shot = (name: string): string => `C:/Users/mrjay/AppData/Local/Temp/claude/688ca4fe6de39c2d/42bb0c6d-cd3e-48b3-aa09-4b9ce8d81094/scratchpad/${name}.png`;

test("Peek shows the table's first 100 rows under the chart tabs, before any chart is made, and folds away", async ({ page }) => {
  await load(page);
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  const peek = page.locator(".charts-peek");
  await expect(peek.locator(".charts-peek-summary")).toHaveText("Table · first 100 of 180 rows");
  await expect(peek.locator("tbody tr")).toHaveCount(100);
  await expect(peek.locator("th", { hasText: "region" })).toBeVisible();
  // The eye sits in the tab row; the rows open below it. Short: it scrolls inside itself.
  await expect(page.locator(".charts-toolbar .charts-peek-toggle")).toBeVisible();
  const body = peek.locator(".charts-peek-body");
  expect((await body.boundingBox())!.height).toBeLessThan(200);
  await page.screenshot({ path: shot("peek-strip") });
  // Folds away (no room taken), and stays folded next time.
  await page.locator(".charts-peek-toggle").click();
  await expect(peek).toBeHidden();
  await expect(page.locator(".charts-peek-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await expect(page.locator(".charts-peek")).toBeHidden();
  await page.locator(".charts-peek-toggle").click();
  await expect(page.locator(".charts-peek tbody tr")).toHaveCount(100);
});

test("With a chart of a Pivot View open, Peek shows that pivot", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Pivot View", exact: true }).click();
  await page.locator(".views-host").getByLabel("Add a column field").first().click();
  await page.locator(".menu, [role=menu]").last().getByText("product", { exact: false }).first().click();
  await page.locator(".views-chart-this").first().click();
  await expect(page.getByRole("tab", { name: "Chart", exact: true })).toHaveAttribute("aria-selected", "true");
  // Looking at a chart, the peek starts folded so the chart has the room; the eye opens it.
  const peek = page.locator(".charts-peek");
  await expect(peek).toBeHidden();
  await page.locator(".charts-peek-toggle").click();
  await expect(peek.locator(".charts-peek-summary")).toContainText("Pivot View");
  await expect(peek.locator("th", { hasText: "Coffee" })).toBeVisible();
  await expect(peek.locator(".charts-peek-open")).toHaveText("Open Pivot View");
  await page.screenshot({ path: shot("peek-pivot") });
});
