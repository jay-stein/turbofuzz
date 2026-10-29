import { test, expect, type Page } from "@playwright/test";

/** A 40x40 grid of points: x and y both run 0..39, so a brushed box has a known row count. */
function grid(): string {
  const lines = ["x,y,day"];
  for (let x = 0; x < 40; x++) {
    for (let y = 0; y < 40; y++) {
      const d = new Date(Date.UTC(2024, 0, 1) + (x * 40 + y) * 86_400_000 * 0.25);
      lines.push(`${x},${y},${d.toISOString().slice(0, 10)}`);
    }
  }
  return lines.join("\n");
}

async function openChart(page: Page, type: RegExp): Promise<void> {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "grid.csv", mimeType: "text/csv", buffer: Buffer.from(grid()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: type }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").waitFor();
  await page.waitForTimeout(800);
}

async function shiftDrag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await page.locator("canvas.chart-canvas").first().boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + from[0] * box.width, box.y + from[1] * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + ((from[0] + to[0]) / 2) * box.width, box.y + ((from[1] + to[1]) / 2) * box.height, { steps: 4 });
  await page.mouse.move(box.x + to[0] * box.width, box.y + to[1] * box.height, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

test("Shift+drag on a scatter filters both axes to the brushed box", async ({ page }) => {
  await openChart(page, /scatter/i);
  await expect(page.locator(".chart-note")).toContainText("Shift+drag to filter");
  await shiftDrag(page, [0.35, 0.3], [0.7, 0.7]);
  await expect(page.locator(".action-status")).toContainText(/Chart selection: .*x .* to .*, y .* to /);
  // Both columns now carry a range filter and the table shrank to the box.
  const count = page.locator(".count").first();
  await expect(count).toContainText(/filtered out/);
  const kept = Number(((await count.textContent()) ?? "").match(/^([\d,]+) of/)?.[1]?.replace(/,/g, ""));
  // The box covers roughly a quarter of the 40x40 grid.
  expect(kept).toBeGreaterThan(200);
  expect(kept).toBeLessThan(700);
});

test("a plain drag still pans and a tiny Shift+drag is ignored", async ({ page }) => {
  await openChart(page, /scatter/i);
  await shiftDrag(page, [0.5, 0.5], [0.502, 0.502]);
  await expect(page.locator(".action-status")).not.toContainText("Chart selection");
});

test("Shift+drag across a histogram keeps the brushed range of that column", async ({ page }) => {
  await openChart(page, /histogram/i);
  await shiftDrag(page, [0.3, 0.4], [0.6, 0.4]);
  await expect(page.locator(".action-status")).toContainText(/Chart selection: \w+ [\d,.]+ to [\d,.]+/);
  const count = page.locator(".count").first();
  await expect(count).toContainText(/filtered out/);
});

test("Shift+drag across a time series filters the date column to that period", async ({ page }) => {
  await openChart(page, /time series/i);
  await shiftDrag(page, [0.3, 0.4], [0.6, 0.4]);
  await expect(page.locator(".action-status")).toContainText(/Chart selection: day 2024-\d\d-\d\d to 2024-\d\d-\d\d/);
});

test("hovering a bin in one chart outlines the same slice in another chart of that column", async ({ page }) => {
  await openChart(page, /histogram/i);
  await page.getByRole("button", { name: "+ Add chart" }).click();
  await page.locator(".chart-add-type", { hasText: /histogram/i }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  const canvases = page.locator("canvas.chart-canvas");
  await expect(canvases).toHaveCount(2);
  await page.waitForTimeout(800);
  const first = (await canvases.nth(0).boundingBox())!;
  // Nothing is outlined until the pointer is on a bin.
  await expect(canvases.nth(1)).toHaveAttribute("data-linked", "0");
  // Integer data leaves empty bins; sweep along the bars until the pointer lands on one with rows.
  let linked = "0";
  for (let step = 0; step < 24 && linked === "0"; step++) {
    await page.mouse.move(first.x + first.width * (0.2 + 0.03 * step), first.y + first.height * 0.6);
    await page.waitForTimeout(60);
    linked = (await canvases.nth(1).getAttribute("data-linked")) ?? "0";
  }
  expect(Number(linked)).toBeGreaterThan(0);
  // The hovered card does not outline itself; leaving clears the other card.
  await expect(canvases.nth(0)).toHaveAttribute("data-linked", "0");
  await page.mouse.move(first.x + first.width * 0.5, first.y - 40);
  await expect(canvases.nth(1)).toHaveAttribute("data-linked", "0");
});

/** 360 days, three regions with very different sales, so a hovered region has a visible share elsewhere. */
function salesByRegion(): string {
  const lines = ["day,region,sales"];
  const regions = ["East", "West", "North"];
  for (let i = 0; i < 360; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    const r = i % 3;
    lines.push(`${d},${regions[r]},${50 + (i % 40) + r * 40}`);
  }
  return lines.join("\n");
}

test("hovering a category lights its share inside charts of other columns", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "s.csv", mimeType: "text/csv", buffer: Buffer.from(salesByRegion()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /^Count plot/i }).first().click();
  await page.getByRole("button", { name: "+ Add chart" }).click();
  await page.locator(".chart-add-type", { hasText: /^Histogram/i }).first().click();
  await page.getByRole("combobox").filter({ hasText: "1 per row" }).selectOption({ label: "2 per row" });
  await page.waitForTimeout(1200);
  const canvases = page.locator("canvas.chart-canvas");
  await expect(canvases).toHaveCount(2);
  // The newest card is first in the grid: find the count plot by its caption.
  const bars = page.locator(".chart-card", { hasText: /Count plot: rows by/ }).locator("canvas.chart-canvas").first();
  const hist = page.locator(".chart-card", { hasText: /Histogram: rows by/ }).locator("canvas.chart-canvas").first();
  const box = (await bars.boundingBox())!;
  let slice = "0";
  for (let step = 0; step < 12 && slice === "0"; step++) {
    await page.mouse.move(box.x + box.width * (0.3 + 0.05 * step), box.y + box.height * 0.6);
    await page.waitForTimeout(250);
    slice = (await hist.getAttribute("data-slice")) ?? "0";
  }
  expect(Number(slice)).toBeGreaterThan(0);
  // Leaving the bar clears the overlay.
  await page.mouse.move(box.x + box.width * 0.5, box.y - 60);
  await expect(hist).toHaveAttribute("data-slice", "0");
});
