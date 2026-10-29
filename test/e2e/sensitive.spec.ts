import { test, expect } from "@playwright/test";

test("possibly sensitive columns appear, mask their examples and can be dismissed", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  const lines = ["customer_id,full_name,email,city"];
  for (let row = 0; row < 150; row++) {
    lines.push(
      `C${1000 + row},Ann Person${row % 60},user${row}@example.com,${["Sydney", "Perth", "Hobart"][row % 3]}`,
    );
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: "customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join(String.fromCharCode(10))),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.getByRole("tab", { name: /^Sensitive/ }).click();

  const section = page.locator(".qp-sensitive");
  await expect(section).toContainText("Possibly sensitive columns");
  await expect(section).toContainText("not counted against your score");
  const card = section.locator(".qp-sensitive-card").filter({ hasText: "email" });
  await expect(card).toContainText("Contact details");
  await expect(card).toContainText("look like email addresses");
  const example = card.locator(".qp-sensitive-example").first();
  await expect(example).toHaveText(/^u\*\*\*@example\.com$/);
  await example.click();
  await expect(example).toHaveText(/^user\d+@example\.com$/);
  await expect(
    section.locator(".qp-sensitive-card").filter({ hasText: "customer_id" }),
  ).toHaveCount(0);

  // The table header shows a small dot for the flagged column.
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator(".th-sensitive-dot").first()).toBeVisible();

  // Dismissing hides the card and the dot.
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.getByRole("tab", { name: /^Sensitive/ }).click();
  await section
    .locator(".qp-sensitive-card")
    .filter({ hasText: "email" })
    .getByRole("button", { name: "Not sensitive" })
    .click();
  await expect(section.locator(".qp-sensitive-card").filter({ hasText: "email" })).toHaveCount(0);
  await expect(section).toContainText("marked not sensitive");

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the export dialog mentions sensitive columns without adding a click", async ({ page }) => {
  await page.goto("/");
  const lines = ["id,email,city"];
  for (let row = 0; row < 120; row++) lines.push(`${row},user${row}@example.com,Perth`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join(String.fromCharCode(10))),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.getByRole("tab", { name: /^Sensitive/ }).click();
  await expect(page.locator(".qp-sensitive-card").filter({ hasText: "email" })).toBeVisible();

  await page.getByRole("button", { name: "Export…" }).first().click();
  const notice = page.locator(".export-sensitive");
  await expect(notice).toContainText("This export includes 1 column that may contain sensitive data: email");
  await expect(notice.locator("input:checked")).toHaveAttribute("value", "include");
  await expect(page.locator(".export-modal .primary")).toBeEnabled();
});

test("a flagged column can be masked from the card", async ({ page }) => {
  await page.goto("/");
  const lines = ["id,email"];
  for (let row = 0; row < 120; row++) lines.push(`${row},user${row}@example.com`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join(String.fromCharCode(10))),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.getByRole("tab", { name: /^Sensitive/ }).click();
  const card = page.locator(".qp-sensitive-card").filter({ hasText: "email" });
  await card.getByRole("button", { name: /Protect/ }).click();
  await page.getByRole("menuitem", { name: /Mask values/ }).click();

  const dialog = page.locator(".protect-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".cast-summary")).toContainText("120 non-empty cells");
  await expect(dialog.locator(".protect-row").nth(1)).toContainText("u***@example.com");
  await dialog.getByRole("button", { name: "Apply" }).click();

  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator(".table-rows .tr").first()).toContainText("u***@example.com");
  await expect(page.locator(".table-rows .tr").first()).not.toContainText("user0@");
});
