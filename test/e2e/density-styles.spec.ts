import { test, expect } from "@playwright/test";

/** Two clusters, so the contours have shape. Deterministic. */
function clusters(): string {
  const lines = ["x,y"];
  let seed = 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const normal = (): number => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
  for (let i = 0; i < 3000; i++) {
    const a = i % 3 !== 0;
    lines.push(`${((a ? 30 : 70) + normal() * (a ? 8 : 6)).toFixed(2)},${((a ? 40 : 65) + normal() * (a ? 10 : 5)).toFixed(2)}`);
  }
  return lines.join("\n");
}

test("density styles: heat, filled contours, contour lines and heat + contour lines", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem("turbofuzz.charts.refineOpen", "1");
    localStorage.setItem("turbofuzz.charts.formatOpen", "1");
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "c.csv", mimeType: "text/csv", buffer: Buffer.from(clusters()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /scatter/i }).first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").waitFor();
  await page.getByLabel("Render mode").selectOption("density");

  const style = page.getByLabel("Density style");
  await expect(style.locator("option")).toHaveText(["Heat", "Filled contours", "Contour lines", "Heat + contour lines"]);
  const note = page.locator(".chart-note").first();
  for (const [value, words] of [["heat", "· heat ·"], ["contours", "filled contour levels"], ["lines", "contour lines labelled in rows per grid cell"], ["both", "heat + contour lines labelled"]] as const) {
    await style.selectOption(value);
    await expect(note).toContainText(words);
    if (process.env.SHOT_DIR) await page.locator("canvas.chart-canvas").first().screenshot({ path: `${process.env.SHOT_DIR}/density-${value}.png` });
  }
});
