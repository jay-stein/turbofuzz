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

  await page.getByRole("button", { name: "Convert column types" }).click();
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
  await page.getByRole("tab", { name: "Relationships" }).click();
  await expect(page.locator(".outliers-heatmap")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Outliers" }).click();
  await page.locator(".outliers-insight.clickable").first().click();
  await expect(page.getByRole("tab", { name: "Table" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("an outlier quick fix clips the contributing column and stays on the Outliers page", async ({
  page,
}) => {
  const { consoleErrors, pageErrors } = collectErrors(page);
  const lines = ["tripduration,fare"];
  for (let row = 0; row < 120; row++) {
    lines.push(row === 61 ? "18000,900" : `${300 + (row % 17)},${8 + (row % 5)}`);
  }
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "quick-fix.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n")),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Outliers" }).click();
  await page.getByRole("button", { name: "Run quick scan" }).click();
  await expect(page.locator(".outliers-row").first()).toBeVisible({ timeout: 15_000 });
  await page.locator(".outliers-row").first().click();
  await expect(page.locator(".outliers-detail-likely")).toContainText("Likely:");
  await page.getByRole("button", { name: /^Clip “/ }).click();
  const confirm = page.locator(".confirm-modal");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Clip values" }).click();
  // The review continues where it was: still on Outliers, and the data is re-scanned.
  await expect(page.getByRole("tab", { name: "Outliers" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".outliers-journey")).toBeVisible();
  await expect(page.locator(".outliers-status")).toContainText("scan finished", { timeout: 20_000 });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("a view chip ignores other filters", async ({ page }) => {
  const { consoleErrors, pageErrors } = collectErrors(page);
  const lines = ["amount"];
  for (let row = 0; row < 40; row++) {
    lines.push(row === 20 ? "18000" : `${10 + (row % 9)}`);
  }
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "isolated-view.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n")),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Enter a command/ }).click();
  const input = page.getByRole("textbox", { name: "Command" });
  await input.fill("filter amount 10..15");
  await input.press("Enter");

  const rows = page.locator(".table-rows .tr");
  await expect(rows).toHaveCount(27);
  await expect(page.locator(".filter-chip")).toHaveCount(1);

  await page.locator(".health-chip", { hasText: "View outliers" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("18000");
  await expect(page.locator(".filter-chip")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("relationships compare text columns with other columns", async ({ page }) => {
  const { consoleErrors, pageErrors } = collectErrors(page);
  const lines = ["customer_id,amount,region,notes,message"];
  for (let row = 0; row < 120; row++) {
    const first = row < 60;
    lines.push(
      `${row + 1},${first ? 10 + (row % 5) : 100 + (row % 5)},${first ? "A" : "B"},${
        first ? `urgent delivery ref ${row}` : `routine pickup ref ${row}`
      },${first ? `delivery customer ${row}` : `pickup customer ${row}`}`,
    );
  }
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "text-network.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n")),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Relationships" }).click();

  await expect(page.locator(".column-matrix")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".column-matrix-label.role-text").first()).toContainText("notes");
  const notesCard = page.locator(".text-link-card").filter({
    has: page.getByRole("button", { name: "notes", exact: true }),
  });
  await notesCard.locator(".text-link", { hasText: "amount" }).click();
  await expect(page.locator(".column-network-detail")).toContainText("η²");
  await expect(page.locator(".column-network-detail")).toContainText("Strongest token");

  await page.locator(".column-matrix-label.role-text").first().click();
  await expect(page.locator(".column-network-canvas")).toBeVisible();
  await expect(page.locator(".column-network-focus")).toContainText("notes");
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