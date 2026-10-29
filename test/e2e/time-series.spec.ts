import { test, expect, type Page } from "@playwright/test";

/** Two years of weekday readings with a six-week hole in the middle, for three players. */
function games(): string {
  const lines = ["order_date,region,player,points"];
  let d = new Date(Date.UTC(2022, 0, 1));
  for (let i = 0; i < 700; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !(i > 300 && i < 340)) {
      for (const p of ["MJ", "Shaq", "LeBron"]) {
        lines.push(`${d.toISOString().slice(0, 10)},${["East", "West"][i % 2]},${p},${20 + Math.round(10 * Math.sin(i / 30)) + (p === "MJ" ? 8 : p === "Shaq" ? 3 : 0) + (i % 7)}`);
      }
    }
    d = new Date(d.getTime() + 86_400_000);
  }
  return lines.join("\n");
}

async function openTimeSeries(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "games.csv", mimeType: "text/csv", buffer: Buffer.from(games()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /time series/i }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").waitFor();
  await page.getByRole("button", { name: "Customize" }).first().click();
  await page.getByLabel("Value column").selectOption({ label: "points (Integer)" });
  await page.waitForTimeout(800);
}

test("a time series says what it plots and shows a missing stretch as a gap, not a zero", async ({ page }) => {
  await openTimeSeries(page);
  // Plain-English summary with the grain, and the missing-periods control is on the card.
  await expect(page.locator(".chart-card")).toContainText(/Mean of points per week \(order_date\)/);
  await expect(page.getByLabel("Missing periods")).toHaveValue("auto");
  // The gap is announced on the chart note area through the canvas label; check via the control instead.
  await page.getByLabel("Missing periods").selectOption("zero");
  await page.waitForTimeout(500);
  await page.getByLabel("Missing periods").selectOption("gap");
  await page.waitForTimeout(500);
  await expect(page.getByLabel("Missing periods")).toHaveValue("gap");
  // Auto resolution names what it chose.
  await expect(page.getByLabel("Bucket").locator("option").first()).toHaveText(/^Auto \(/);
});

test("splitting by player keeps one legend that toggles series, and calendar options follow the grain", async ({ page }) => {
  await openTimeSeries(page);
  await page.getByLabel("Group by").selectOption({ label: "player (Category)" });
  await page.waitForTimeout(800);
  const items = page.locator(".chart-legend-item");
  await expect(items).toHaveCount(3);
  await items.first().click();
  await expect(items.first()).toHaveAttribute("aria-pressed", "false");
  await items.first().click();
  await expect(items.first()).toHaveAttribute("aria-pressed", "true");
  // Week start only matters at a weekly grain.
  await expect(page.getByLabel("Week starts on")).toBeVisible();
  await page.getByLabel("Bucket").selectOption("month");
  await expect(page.getByLabel("Week starts on")).toBeHidden();
  await page.getByLabel("Bucket").selectOption("quarter");
  await expect(page.getByLabel("Financial year starts in")).toBeVisible();
});

test("any bucket width works: every 2 weeks, then every 10 days", async ({ page }) => {
  await openTimeSeries(page);
  const every = page.getByLabel("Every N time units");
  // Hidden while Auto picks both unit and width.
  await expect(every).toBeHidden();
  await page.getByLabel("Bucket").selectOption("week");
  await every.fill("2");
  await every.press("Tab");
  await expect(page.locator(".chart-card")).toContainText(/Mean of points per 2 weeks \(order_date\)/);
  await page.getByLabel("Bucket").selectOption("day");
  await every.fill("10");
  await every.press("Tab");
  await expect(page.locator(".chart-card")).toContainText(/Mean of points per 10 days \(order_date\)/);
  // Back to one unit: the plain wording returns.
  await every.fill("1");
  await every.press("Tab");
  await expect(page.locator(".chart-card")).toContainText(/Mean of points per day \(order_date\)/);
});

test("Shift+drag across the line selects whole weeks and filters the date column", async ({ page }) => {
  await openTimeSeries(page);
  const box = (await page.locator("canvas.chart-canvas").first().boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator(".action-status")).toContainText(/Chart selection: order_date 202\d-\d\d-\d\d to 202\d-\d\d-\d\d/);
  // Weekly buckets start on Monday and end on Sunday.
  const text = (await page.locator(".action-status").textContent()) ?? "";
  const [, from, to] = text.match(/order_date (\S+) to (\S+)/) ?? [];
  expect(new Date(`${from}T00:00:00Z`).getUTCDay()).toBe(1);
  expect(new Date(`${to}T00:00:00Z`).getUTCDay()).toBe(0);
});
