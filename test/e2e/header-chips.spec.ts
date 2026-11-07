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
