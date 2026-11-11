import { expect, test } from "@playwright/test";

test("a column header shows one chip for what is wrong, which never covers the type control, and its menu does the work", async ({ page }) => {
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
  // One chip is visible, whatever is wrong with the column.
  await expect(th.locator(".th-qa-summary")).toBeVisible();
  await expect(th.locator(".th-qa-chip:visible")).toHaveCount(1);
  await th.locator(".th-qa").hover();
  expect(await covers()).toBe(false);
  // Its menu offers the rows and the fixes; choosing the rows filters the table, and the header stays tidy.
  await th.locator(".th-qa-summary").click();
  await page.getByRole("menuitem", { name: /^View (empty cells|placeholders|outliers)/ }).first().click();
  await page.mouse.move(700, 400);
  expect(await covers()).toBe(false);
  await type.hover();
  expect(await covers()).toBe(false);
});

test("a column with placeholder text shows one chip, and its menu offers to blank them", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/");
  const rows = ["id,city,score"];
  for (let i = 0; i < 60; i++) rows.push(`${i},${i % 5 === 0 ? "unknown" : i % 7 === 0 ? "" : "c" + (i % 4)},${i}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  const th = page.locator(".th").nth(2);
  const chip = th.locator(".th-qa-summary");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/^\d+ missing ▾$/);
  const box = await chip.boundingBox();
  const strip = await th.locator(".th-qa").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 1);
  await chip.click();
  await expect(page.getByRole("menuitem", { name: /Blank \d+ placeholders/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^View placeholders/ })).toBeVisible();
});
