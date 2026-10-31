import { test, expect, type Page } from "@playwright/test";

const RESEARCH_TABS = ["Outliers", "Relationships", "Time Series", "Map"];

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

const modeOption = (page: Page, name: "General" | "Research") =>
  page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name });

test("General is the default, Research adds four tabs, and a new dataset opens in General again", async ({ page }) => {
  await load(page);
  await expect(modeOption(page, "General")).toHaveAttribute("aria-checked", "true");
  for (const name of RESEARCH_TABS) await expect(page.getByRole("tab", { name })).toBeHidden();
  // Number keys follow the visible tabs: 5 is Chart in General mode.
  await page.keyboard.press("5");
  await expect(page.getByRole("tab", { name: "Chart" })).toHaveAttribute("aria-selected", "true");

  await modeOption(page, "Research").click();
  await expect(modeOption(page, "Research")).toHaveAttribute("aria-checked", "true");
  for (const name of RESEARCH_TABS) await expect(page.getByRole("tab", { name })).toBeVisible();
  await page.keyboard.press("9");
  await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute("aria-selected", "true");

  await page.reload();
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  // Every new dataset opens in General; Research is switched on each time.
  await expect(modeOption(page, "General")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("tab", { name: "Outliers" })).toBeHidden();
});

test("leaving Research on a research page returns to the last general page, and Undo brings it back", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Table" }).click();
  await modeOption(page, "Research").click();
  await page.getByRole("tab", { name: "Relationships" }).click();

  await modeOption(page, "General").click();
  await expect(page.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Relationships" })).toBeHidden();

  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(modeOption(page, "Research")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("tab", { name: "Relationships" })).toHaveAttribute("aria-selected", "true");
});

test("asking for a research page from the command bar switches to Research and says so", async ({ page }) => {
  await load(page);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("outliers");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Outliers" })).toHaveAttribute("aria-selected", "true");
  await expect(modeOption(page, "Research")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".toast")).toContainText("Research mode");
});

test("chart line cards only point to Time Series in Research mode", async ({ page }) => {
  await load(page);
  await page.getByRole("tab", { name: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /time series/i }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").first().waitFor();
  const link = page.getByRole("button", { name: "Open in Time Series →" });
  await expect(link).toHaveCount(0);

  await modeOption(page, "Research").click();
  await expect(link.first()).toBeVisible();

  await modeOption(page, "General").click();
  await expect(link).toHaveCount(0);
});
