import { expect, test } from "@playwright/test";

test("clicking a bar and picking a colour recolours that bar only, and Reset colours puts it back", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  const lines = ["region,sales"];
  for (let i = 0; i < 30; i++) lines.push(`${["N", "S", "E"][i % 3]},${10 + i}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  const field = (name: string) => page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) });
  await field("region").click();
  await field("sales").click();
  await page.locator(".chart-add-recs .chart-add-tile").first().click();
  const card = page.locator(".chart-card:not(.hidden)");
  const canvas = card.locator("canvas.chart-canvas");
  await canvas.waitFor();
  // The test is about bars, whatever the recommendation was.
  await card.getByRole("button", { name: "Chart type", exact: true }).click();
  await page.locator(".chart-kind-option:not([disabled])", { hasText: "Bar" }).first().click();
  await expect(canvas).toHaveAttribute("aria-label", /^Bar/);
  const box = (await canvas.boundingBox())!;

  // Three bars across the plot: sample low in each slot, just above the baseline.
  const xs = [0.3, 0.55, 0.8].map((f) => box.width * f);
  const y = box.height * 0.78;
  const sample = (): Promise<string[]> =>
    canvas.evaluate((node, points) => {
      const el = node as HTMLCanvasElement;
      const ctx = el.getContext("2d")!;
      const scale = el.width / el.clientWidth;
      return points.map(([px, py]) => Array.from(ctx.getImageData(Math.round(px! * scale), Math.round(py! * scale), 1, 1).data).join(","));
    }, xs.map((x) => [x, y]));
  const before = await sample();

  await canvas.click({ position: { x: xs[0]!, y } });
  const bar = card.locator(".chart-selection");
  await expect(bar).toBeVisible();
  // A clicked bar opens with its colours already showing (Colour… toggles them).
  await expect(bar.getByRole("button", { name: "Colour…" })).toHaveAttribute("aria-expanded", "true");
  await bar.locator(".chart-mark-colors .chart-swatch").nth(3).click();
  // Keyboard: Escape closes the colour row; × clears the selection so the sample has no selection tint.
  await page.keyboard.press("Escape");
  await expect(bar.locator(".chart-mark-colors")).toHaveCount(0);
  await bar.getByRole("button", { name: "Clear the selection" }).click();
  const after = await sample();
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(after[2]).toBe(before[2]);

  // Highlight this, grey the rest; once more gives every bar its colour back.
  await canvas.click({ position: { x: xs[0]!, y } });
  await bar.getByRole("button", { name: "Highlight" }).click();
  await bar.getByRole("button", { name: "Clear the selection" }).click();
  const greyed = await sample();
  expect(greyed[0]).toBe(after[0]);
  expect(greyed[1]).not.toBe(before[1]);
  expect(greyed[2]).toBe(greyed[1]);
  await canvas.click({ position: { x: xs[0]!, y } });
  await bar.getByRole("button", { name: "Show all colours" }).click();
  await bar.getByRole("button", { name: "Clear the selection" }).click();
  expect(await sample()).toEqual(after);

  await card.locator(".chart-side-group", { has: page.locator(".chart-side-group-name", { hasText: "Format" }) }).locator("summary").click();
  await card.getByRole("button", { name: "Reset colours" }).click();
  expect((await sample())[0]).toBe(before[0]);
});
