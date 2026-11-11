import { test, expect } from "@playwright/test";

const csv = (n: number) => ["id,name,amount", ...Array.from({ length: n }, (_, i) => `${i},name ${i},${i * 3}`)].join("\n");

test("Clear data leaves nothing of the old file: no name, no score, no memory, and the next file loads clean", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "first.csv", mimeType: "text/csv", buffer: Buffer.from(csv(300)) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  const meta = page.locator(".topbar .meta");
  await expect(meta).toContainText("first.csv");
  await expect(page.locator(".score-tile")).toBeVisible();
  await expect(page.locator(".topbar .mem-gauge")).toBeVisible();

  await page.getByRole("button", { name: "Clear data" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear data" }).click();
  // The front page is back, with its Analyse / Compare switch.
  await expect(page.getByText("Compare two tables", { exact: true })).toBeVisible();
  await expect(meta).toHaveText("");
  await expect(meta).not.toHaveAttribute("title", /first\.csv|rows/);
  await expect(page.locator(".score-tile")).toBeHidden();
  await expect(page.locator(".topbar .mem-gauge")).toBeHidden();

  await page.locator('input[type="file"]').first().setInputFiles({ name: "second.csv", mimeType: "text/csv", buffer: Buffer.from(csv(40)) });
  await page.locator(".nav-row").waitFor();
  await expect(meta).toContainText("second.csv");
  await expect(meta).not.toContainText("first.csv");
  await expect(page.locator(".count").first()).toContainText("40 rows");
  await expect(page.locator(".score-tile")).toBeVisible();
});
