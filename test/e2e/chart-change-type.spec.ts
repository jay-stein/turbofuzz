import { expect, test, type Page } from "@playwright/test";

/** A year of daily sales in three regions. */
function sales(): string {
  const lines = ["date,region,sales"];
  for (let d = 0; d < 365; d++) {
    const when = new Date(Date.UTC(2024, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
    for (let r = 0; r < 3; r++) lines.push(`${when},R${r},${100 + ((d * 7 + r * 13) % 50)}`);
  }
  return lines.join("\n");
}

async function lineChart(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
  for (const name of ["date", "sales", "region"]) {
    await page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) }).click();
  }
  await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type", { hasText: "Line" }).first().click();
  await page.locator(".chart-card:not(.hidden) .chart-canvas").waitFor();
}

const card = (page: Page) => page.locator(".chart-card:not(.hidden)");
const typeButton = (page: Page) => card(page).getByRole("button", { name: "Change chart type" });
const option = (page: Page, name: string) => page.locator(".chart-kind-pop .chart-kind-option", { hasText: new RegExp(`^${name}$`) });

test("the chart's type changes from its top bar, Excel-style: hover previews, leaving restores, a click keeps it and says what did not carry", async ({ page }) => {
  await lineChart(page);
  await expect(typeButton(page)).toContainText("Line");
  // A calculation that only a chart over dates can keep.
  await card(page).locator(".chart-side-calc select").selectOption({ label: "Cumulative" });
  await expect(card(page).locator(".chart-side-calc select")).toHaveValue("cumulative");

  await typeButton(page).click();
  await expect(page.locator(".chart-kind-pop")).toBeVisible();
  // Hover is a preview on the chart itself.
  await option(page, "Histogram").hover();
  await expect(typeButton(page)).toContainText("Histogram");
  // Off the types: back as it was, with its calculation.
  await page.locator(".chart-kind-pop-head").hover();
  await expect(typeButton(page)).toContainText("Line");
  await expect(card(page).locator(".chart-side-calc select")).toHaveValue("cumulative");

  await option(page, "Histogram").click();
  await expect(page.locator(".chart-kind-pop")).toHaveCount(0);
  await expect(typeButton(page)).toContainText("Histogram");
  const toast = page.locator(".toast");
  await expect(toast).toContainText("Changed to Histogram");
  await expect(toast).toContainText("“date” has no place on a Histogram");

  // One Undo puts back the line and its calculation.
  await card(page).getByRole("button", { name: "Undo the last change to this chart" }).click();
  await expect(typeButton(page)).toContainText("Line");
  await expect(card(page).locator(".chart-side-calc select")).toHaveValue("cumulative");
});

test("Escape closes the picker with the chart unchanged; a right-click on the chart offers Change chart type", async ({ page }) => {
  await lineChart(page);
  const undo = card(page).getByRole("button", { name: "Undo the last change to this chart" });
  const undoBefore = await undo.isDisabled();
  await typeButton(page).click();
  await option(page, "Scatter").hover();
  await expect(typeButton(page)).toContainText("Scatter");
  await page.keyboard.press("Escape");
  await expect(page.locator(".chart-kind-pop")).toHaveCount(0);
  await expect(typeButton(page)).toContainText("Line");
  // A preview leaves no step to undo.
  expect(await undo.isDisabled()).toBe(undoBefore);
  console.log("undo disabled on a new chart:", undoBefore);

  const canvas = card(page).locator("canvas.chart-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + 8, { button: "right" });
  await page.getByRole("menuitem", { name: "Change chart type…" }).click();
  await expect(page.locator(".chart-kind-pop")).toBeVisible();
  await option(page, "Bar").first().click();
  await expect(typeButton(page)).toContainText("Bar");
});
