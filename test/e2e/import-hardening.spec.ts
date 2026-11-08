import { test, expect, type Page } from "@playwright/test";

async function load(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "text/csv", buffer });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Table" }).click();
}

test("a UTF-16 file (Excel's Unicode Text) reads as text, accents and all", async ({ page }) => {
  const text = "name\tcity\nZoë\tMünchen\nJosé\tSão Paulo\n";
  await load(page, "people.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
  await expect(page.locator(".count").first()).toContainText("2 rows");
  await expect.poll(() => page.locator(".table-header .th-label").allInnerTexts()).toEqual(["name", "city"]);
  await expect(page.locator(".tr .td", { hasText: "München" })).toBeVisible();
});

test("a quote that never closes is dropped, the rows after it load, and the Import check names the line", async ({ page }) => {
  await load(page, "orders.csv", Buffer.from('id,note\n1,"fine, really"\n2,"oops\n3,plain\n4,"also, fine"\n'));
  await expect(page.locator(".count").first()).toContainText("4 rows");
  await expect(page.locator(".banner-text")).toContainText("a quote that never closed on line 3");
});
