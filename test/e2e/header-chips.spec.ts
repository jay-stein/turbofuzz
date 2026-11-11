import { expect, test } from "@playwright/test";

test("the issue chips on a column header open sideways and never cover the type control, even right after a click", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const rows = ["name,amount,city"];
  for (let i = 0; i < 200; i++) rows.push(`n${i},${i === 5 ? 99999999 : i === 7 ? "" : i === 9 ? "NA" : i},${i % 3 === 0 ? "" : "xyyy"}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "c.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  const th = page.locator(".th").nth(2);
  const type = th.locator(".th-type-wrap");
  const covers = async (): Promise<boolean> =>
    type.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit !== null && !node.contains(hit) && !hit.contains(node);
    });
  // With the strip open, every chip is visible and the type control is still on top.
  await th.locator(".th-qa").hover();
  await expect(th.locator(".th-qa-chip").last()).toBeVisible();
  expect(await covers()).toBe(false);
  // A mouse click on a chip applies its filter, and the strip does not stay open over the header afterwards.
  await th.locator(".th-qa button").first().click();
  await page.mouse.move(700, 400);
  expect(await covers()).toBe(false);
  await type.hover();
  expect(await covers()).toBe(false);
});

test("a column with placeholder text keeps a Fix menu in view on its header, however narrow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/");
  const rows = ["id,city,score"];
  for (let i = 0; i < 60; i++) rows.push(`${i},${i % 5 === 0 ? "unknown" : i % 7 === 0 ? "" : "c" + (i % 4)},${i}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  const th = page.locator(".th").nth(2);
  const fix = th.locator(".fix-menu");
  await expect(fix).toBeVisible();
  // The count stays readable beside it: the number, not a clipped word.
  await expect(th.locator(".th-qa-chip.warn").first()).toHaveText(/^\s*View [^·]*· \d+$|^\d+$/);
  const box = await fix.boundingBox();
  const strip = await th.locator(".th-qa").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 1);
  // Pointing at the strip opens it: the fix itself is there to click, in words.
  await th.locator(".th-qa").hover();
  const token = th.locator(".th-qa-chip.token");
  await expect(token).toBeVisible();
  await expect(token).toHaveText(/Blank \d+ placeholders/);
});
