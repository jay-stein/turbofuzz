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

  await page.getByRole("button", { name: /Enter a command/ }).click();
  const command = page.getByRole("textbox", { name: "Command" });
  await expect(command).toBeVisible();
  await command.fill("melt keep name");
  await expect(page.locator(".command-usage").first()).toContainText("melt keep name");
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Data Quality" }).click();
  await expect(page.locator(".qp-hero")).toBeVisible();
  await expect(page.locator(".qp-scope")).toContainText("Whole dataset");
  await expect(page.locator(".qp-sensitive-empty")).toContainText(
    "No obvious email",
  );
  await expect(page.locator(".qp-explain")).toContainText("Adjust weights");

  await page.getByRole("tab", { name: "Chart" }).click();
  await expect(page.locator(".charts-panel")).toBeVisible();
  await expect(page.locator(".charts-empty-title")).toContainText("No charts yet");
  await expect(page.locator(".chart-card")).toHaveCount(0);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("runs sort, filter and melt commands end to end", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "commands.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,amount\nAlice,10\nBob,20\nCara,30\n"),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });

  const runCommand = async (text: string): Promise<void> => {
    await page.getByRole("button", { name: /Enter a command/ }).click();
    const input = page.getByRole("textbox", { name: "Command" });
    await input.fill(text);
    await input.press("Enter");
  };

  await runCommand("sort amount desc");
  const rows = page.locator(".table-rows .tr");
  await expect(rows.nth(0).locator(".td").nth(1)).toHaveText("Cara");

  await runCommand("filter amount 10..20");
  await expect(rows).toHaveCount(2);

  await runCommand("melt keep name");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".th-label")).toHaveText(["name", "variable", "value"]);
  await expect(rows).toHaveCount(3);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
