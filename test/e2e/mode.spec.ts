import { test, expect, type Page } from "@playwright/test";

const RESEARCH_TABS = ["Time Series", "Map", "Outliers", "Relationships"];

/** A small dated table, so Chart can offer a line card with a Time Series link. */
function sales(): string {
  const lines = ["day,region,amount"];
  let d = Date.UTC(2024, 0, 1);
  for (let i = 0; i < 120; i++) {
    lines.push(`${new Date(d).toISOString().slice(0, 10)},${["North", "South"][i % 2]},${10 + (i % 9)}`);
    d += 86_400_000;
  }
  return lines.join("\n");
}

async function load(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
}

test("every tab is always on the bar: there is no General or Research switch", async ({ page }) => {
  await load(page);
  await expect(page.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("radiogroup", { name: "Mode" })).toHaveCount(0);
  for (const name of RESEARCH_TABS) await expect(page.getByRole("tab", { name })).toBeVisible();
  // Number keys run over all nine tabs: 9 is Relationships.
  await page.keyboard.press("9");
  await expect(page.getByRole("tab", { name: "Relationships" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("5");
  await expect(page.getByRole("tab", { name: "Chart" })).toHaveAttribute("aria-selected", "true");
});

test("the green lane names itself on hover as the research tools", async ({ page }) => {
  await load(page);
  for (const name of RESEARCH_TABS) await expect(page.getByRole("tab", { name })).toHaveAttribute("title", /^Research · /);
  await page.getByRole("tab", { name: "Map" }).hover();
  await expect(page.locator(".research-lane-tip")).toHaveText("Research tools");
  await page.mouse.move(700, 600);
  await expect(page.locator(".research-lane-tip")).toHaveCount(0);
});

test("the command bar opens a research page directly", async ({ page }) => {
  await load(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("outliers");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Outliers" })).toHaveAttribute("aria-selected", "true");
});

test("chart line cards point to Time Series: chart tools are never held back", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /^Line/ }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").first().waitFor();
  await expect(page.getByRole("button", { name: "Open in Time Series →" }).first()).toBeVisible();
});
