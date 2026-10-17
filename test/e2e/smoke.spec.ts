import { test, expect } from "@playwright/test";

test("loads a small CSV and shows columns and rows", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Clean and reshape tables in your browser" }),
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "smoke.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,amount\nAlice,10\nBob,20\nCara,30\n"),
  });

  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".meta")).toContainText("smoke.csv");

  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator(".table-host")).toBeVisible();
  await expect(page.locator(".th-label")).toHaveText(["name", "amount"]);

  const rows = page.locator(".table-rows .tr");
  await expect(rows).toHaveCount(3);

  await expect(rows.nth(0).locator(".td").nth(1)).toHaveText("Alice");
  await expect(rows.nth(0).locator(".td").nth(2)).toHaveText("10");
  await expect(rows.nth(2).locator(".td").nth(1)).toHaveText("Cara");
  await expect(rows.nth(2).locator(".td").nth(2)).toHaveText("30");

  const screenshot = testInfo.outputPath("turbofuzz-smoke-table.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("table screenshot", {
    path: screenshot,
    contentType: "image/png",
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
