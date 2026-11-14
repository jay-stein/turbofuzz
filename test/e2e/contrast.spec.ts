import { expect, test } from "@playwright/test";

// Every visible text colour reaches WCAG AA (4.5:1, or 3:1 for large text) on its own background,
// on the main pages, in both themes (DEC-2026-11-01-02, phase 4 of the analyst console look).

function csv(): string {
  const regions = ["North", "South", "East", "West"];
  const rows = ["order_date,region,units,price,lat,lon"];
  for (let d = 0; d < 300; d++) {
    const t = new Date(Date.UTC(2023, 0, 1 + d));
    const units = 20 + ((d * 7) % 17) + (d % 97 === 0 ? 80 : 0);
    rows.push([t.toISOString().slice(0, 10), regions[d % 4], d % 17 === 0 ? "" : units, (9.99 + (d % 5)).toFixed(2), (40 + (d % 12)).toFixed(2), (-5 + (d % 15)).toFixed(2)].join(","));
  }
  return rows.join("\n");
}

/** Runs in the page: the text that fails AA, one entry per element class and colour. */
const audit = (): { ratio: number; text: string; where: string }[] => {
  const parse = (c: string): number[] | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
  };
  const lum = (c: number[]): number => {
    const f = (v: number): number => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
  };
  const over = (top: number[], bottom: number[]): number[] => [0, 1, 2].map((i) => top[i]! * top[3]! + bottom[i]! * (1 - top[3]!)).concat([1]);
  const backdrop = (el: Element): number[] => {
    const chain: number[][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3]! > 0) { chain.push(c); if (c[3] === 1) break; }
    }
    let base = [255, 255, 255, 1];
    for (const c of chain.reverse()) base = over(c, base);
    return base;
  };
  const found: Record<string, { ratio: number; text: string; where: string }> = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? "").trim();
    if (text.length < 2) continue;
    const el = n.parentElement!;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (box.width === 0 || box.height === 0 || style.visibility === "hidden" || box.bottom < 0 || box.top > innerHeight) continue;
    if ((el as HTMLButtonElement).disabled || el.closest("[disabled]")) continue;
    const ink = parse(style.color);
    if (!ink) continue;
    const bg = backdrop(el);
    const fg = over(ink, bg);
    const hi = Math.max(lum(fg), lum(bg)), lo = Math.min(lum(fg), lum(bg));
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(style.fontSize), bold = parseInt(style.fontWeight) >= 700;
    if (ratio < (size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5)) {
      const where = `${el.tagName.toLowerCase()}.${el.className?.toString?.() ?? ""} ${style.color}`;
      if (!found[where] || found[where]!.ratio > ratio) found[where] = { ratio: Math.round(ratio * 100) / 100, text: text.slice(0, 40), where };
    }
  }
  return Object.values(found);
};

for (const theme of ["light", "dark"] as const) {
  test(`text keeps AA contrast on the main pages in the ${theme} theme`, async ({ page }) => {
    test.setTimeout(180000);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(csv()) });
    await page.locator(".nav-row").waitFor();
    await page.keyboard.press("Escape");
    const failures: string[] = [];
    for (const view of ["Overview", "Data Quality", "Table", "Pivot View", "Outliers", "Relationships", "Time Series"]) {
      await page.locator(".view-tabs button", { hasText: view }).first().click();
      await page.waitForTimeout(1500);
      await page.locator(".hint-callout, .toast").evaluateAll((els) => els.forEach((e) => (e as HTMLElement).remove()));
      for (const f of await page.evaluate(audit)) failures.push(`${view}: ${f.ratio}:1 “${f.text}” (${f.where})`);
    }
    expect(failures).toEqual([]);
  });
}
