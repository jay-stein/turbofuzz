import { expect, test } from "@playwright/test";

// Visual-polish budgets from test/polish/turbofuzz-polish-spec.md.
const VIEWPORTS = [
  { width: 1440, height: 900, chrome: 96 },
  { width: 622, height: 691, chrome: 96 },
  { width: 375, height: 812, chrome: 100 },
];

for (const { width, height, chrome } of VIEWPORTS) {
  test(`chrome stays compact and nothing overflows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.addScriptTag({ path: "test/polish/turbofuzz-test-data.js" });
    await page.evaluate(() => (window as any).TF_TEST.load("B"));
    await page.locator(".view-tabs button").first().waitFor();
    await page.waitForTimeout(1200);

    const m = await page.evaluate(() => {
      const h = (s: string) => Math.round(document.querySelector(s)!.getBoundingClientRect().height);
      return {
        chrome: h("header.topbar") + h(".nav-row"),
        tabs: [...document.querySelectorAll(".view-tabs button")].map((b) =>
          Math.round(b.getBoundingClientRect().height),
        ),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    expect(m.chrome).toBeLessThanOrEqual(chrome);
    expect(new Set(m.tabs).size).toBe(1);
    expect(m.overflow).toBe(false);

    // Table view: a compact header and a one-row toolbar leave room for data.
    await page.locator(".view-tabs button", { hasText: "Table" }).click();
    await page.waitForSelector(".table-header");
    const table = await page.evaluate(() => ({
      header: Math.round(document.querySelector(".table-header")!.getBoundingClientRect().height),
      bar: Math.round(document.querySelector(".results-bar")!.getBoundingClientRect().height),
    }));
    expect(table.header).toBeLessThanOrEqual(64);
    // Phones get 40px tap targets, so their one-row toolbar is taller.
    expect(table.bar).toBeLessThanOrEqual(width < 720 ? 60 : 56);
  });
}

test("no visible text is smaller than 11px", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ path: "test/polish/turbofuzz-test-data.js" });
  await page.evaluate(() => (window as any).TF_TEST.load("B"));
  await page.waitForTimeout(1200);
  for (const tab of ["Overview", "Table", "Data Quality", "Pivot View"]) {
    await page.locator(".view-tabs button", { hasText: tab }).click();
    await page.waitForTimeout(500);
    const min = await page.evaluate(() => {
      let smallest = 99;
      for (const e of document.querySelectorAll("body *")) {
        if (!e.getBoundingClientRect().height) continue;
        if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) continue;
        smallest = Math.min(smallest, parseFloat(getComputedStyle(e).fontSize));
      }
      return smallest;
    });
    expect(min, tab).toBeGreaterThanOrEqual(11);
  }
});
