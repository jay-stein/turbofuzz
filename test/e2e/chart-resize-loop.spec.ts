import { expect, test } from "@playwright/test";

// Real (non-overlay) scrollbars: the canvas height follows its width, so a
// workspace scrollbar that toggles with the chart height used to make the first
// chart repaint every frame, flipping between two widths.
test.use({
  viewport: { width: 1100, height: 650 },
  launchOptions: {
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--disable-features=OverlayScrollbar,FluentOverlayScrollbar"],
  },
});

test("the first time-series chart settles instead of resizing in a loop", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ path: "test/polish/turbofuzz-test-data.js" });
  await page.evaluate(() => (window as any).TF_TEST.load("A"));
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type").first().waitFor();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const w = window as any;
    w.__paints = 0;
    const orig = CanvasRenderingContext2D.prototype.setTransform;
    CanvasRenderingContext2D.prototype.setTransform = function (this: CanvasRenderingContext2D, ...a: any[]) {
      if (this.canvas.classList.contains("chart-canvas")) w.__paints++;
      return (orig as any).apply(this, a);
    };
  });
  await page.locator(".chart-add-type", { hasText: /time series/i }).first().click();
  await page.waitForTimeout(1200);
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  await page.locator("canvas.chart-canvas").waitFor();
  await page.waitForTimeout(3500);
  const paints = await page.evaluate(() => (window as any).__paints as number);
  expect(paints).toBeGreaterThan(0);
  expect(paints).toBeLessThan(12);
});
