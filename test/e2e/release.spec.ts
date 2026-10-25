import { test, expect } from "@playwright/test";

function collectErrors(page: import("@playwright/test").Page): {
  consoleErrors: string[];
  pageErrors: string[];
} {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

test("multi-file preflight appends aligned files with provenance", async ({ page }) => {
  const { consoleErrors, pageErrors } = collectErrors(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "jan.csv", mimeType: "text/csv", buffer: Buffer.from("id,value\n1,10\n2,20\n") },
    { name: "feb.csv", mimeType: "text/csv", buffer: Buffer.from("id,value\n3,30\n") },
  ]);

  await expect(page.locator(".multi-file-modal")).toBeVisible();
  await expect(page.locator(".multi-file-modal")).toContainText("jan.csv");
  await expect(page.locator(".multi-file-modal")).toContainText("feb.csv");
  await expect(page.locator(".multi-file-modal")).toContainText("Align columns");
  await page.locator(".multi-file-modal .primary").click();

  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".meta")).toContainText("2 files");
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator(".th-label")).toHaveText(["id", "value", "_input_filename"]);
  await expect(page.locator(".table-rows .tr")).toHaveCount(3);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("batch type conversion updates the column type", async ({ page }) => {
  const { consoleErrors, pageErrors } = collectErrors(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "types.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("flag\n1\n0\n1\n"),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Table" }).click();

  await page.getByRole("button", { name: "Types" }).click();
  await expect(page.locator(".batch-cast-modal")).toBeVisible();
  const row = page.locator(".batch-cast-row").filter({ hasText: "flag" });
  await row.locator("select").selectOption("boolean");
  await expect(page.locator(".batch-cast-summary")).not.toContainText("Select one or more columns");
  await page.getByRole("button", { name: /Convert \d+ column/ }).click();
  await expect(page.locator(".th-type").first()).toHaveValue("boolean");

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("outliers lens runs a quick scan and shows the anomaly landscape", async ({ page }) => {
  const { consoleErrors, pageErrors } = collectErrors(page);
  const lines = ["a,b,c"];
  for (let row = 0; row < 120; row++) {
    lines.push(
      row === 61
        ? "900,1500,-700"
        : `${row * 0.5},${row * 1.2 + 2},${row * -0.4 + 3}`,
    );
  }
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "outliers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n")),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Outliers" }).click();
  await expect(page.locator(".outliers-panel")).toBeVisible();
  await page.getByRole("button", { name: "Run quick scan" }).click();
  await expect(page.locator(".outliers-landscape-canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".outliers-recipe")).toContainText("Isolation Forest");
  await expect(page.locator(".outliers-row").first()).toBeVisible();
  await page.locator(".outliers-insight.clickable").first().click();
  await expect(page.getByRole("tab", { name: "Table" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("chart builder adds a barplot and exposes its summary", async ({ page }) => {
  const { consoleErrors, pageErrors } = collectErrors(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "chart.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("region,amount\nNorth,10\nSouth,20\nNorth,30\n"),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Chart" }).click();
  const before = await page.locator(".chart-card").count();

  await page.getByRole("button", { name: "+ Add chart" }).click();
  await expect(page.locator(".chart-gallery")).toBeVisible();
  await page.locator(".chart-tile").filter({ hasText: "Barplot" }).first().click();
  await expect(page.locator(".chart-setup-modal")).toBeVisible();
  await page.locator(".chart-setup-modal .primary").click();

  await expect(page.locator(".chart-card")).toHaveCount(before + 1);
  await expect(page.locator(".chart-summary").last()).toContainText("Barplot");
  await expect(page.locator(".chart-note").last()).not.toContainText("could not");

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});