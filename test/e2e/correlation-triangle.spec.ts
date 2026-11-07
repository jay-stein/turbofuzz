import { expect, test } from "@playwright/test";

test("the correlation chart shows each pair once, as a lower triangle", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const rows = ["a,b,c,d"];
  for (let i = 0; i < 80; i++) {
    const a = ((i * 7919) % 41) * 3;
    rows.push(`${a},${a * 2 + (i % 7)},${100 - a + ((i * 31) % 5)},${(i * 37) % 11}`);
  }
  await page.locator('input[type="file"]').setInputFiles({ name: "nums.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
  await page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: /^a$/ }) }).first().click();
  await page.locator(".chart-add-tile").first().click();
  const card = page.locator(".chart-card:not(.hidden)");
  await card.locator(".chart-canvas").waitFor();
  await card.locator(".chart-kind-button").click();
  const picker = page.getByRole("dialog", { name: "Chart type" });
  await picker.getByRole("button", { name: "Correlation", exact: true }).click();
  await expect(card.locator(".chart-note")).toContainText(/\d+ columns, each pair once/, { timeout: 15_000 });
  await card.screenshot({ path: "corr.png" });
});
