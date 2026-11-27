import { test, expect } from "@playwright/test";

/** Stray spaces and mixed capitals in two text columns, an id column, and a number column. */
function messy(): string {
  const states = ["NSW", "nsw", " NSW", "Nsw ", "VIC", "vic"];
  const lines = ["customer_id,name,state,amount"];
  for (let i = 0; i < 60; i++) {
    const name = i % 5 === 0 ? `" Person${i % 20} "` : `Person${i % 20}`;
    lines.push([i % 2 === 0 ? `ab${i}` : `AB${i}`, name, `"${states[i % states.length]}"`, String(10 + i)].join(","));
  }
  return lines.join("\n");
}

test("the two big buttons trim spaces and change case in every text column, counted first, with one Undo", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(messy()) });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Clean" }).click();
  // Above the steps (Standardise, Junk data…), so they come first.
  const hammers = page.locator(".cl-hammers");
  await expect(hammers).toBeVisible();
  expect(await hammers.evaluate((node) => node.compareDocumentPosition(document.querySelector(".cl-steps")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();

  // Trim: every text column listed, with exact counts; the number column is not offered.
  await page.locator('[data-qp="hammer-trim"]').click();
  const dialog = page.locator(".hammer-modal");
  await expect(dialog.locator(".hammer-name")).toHaveText(["customer_id", "name", "state"]);
  const row = (name: string) => dialog.locator("label", { has: page.locator(".hammer-name", { hasText: new RegExp(`^${name}$`) }) });
  await expect(row("name").locator(".hammer-count")).toHaveText("12 cells");
  await expect(row("state").locator(".hammer-count")).toHaveText("20 cells");
  await expect(row("customer_id").locator(".hammer-count")).toHaveText("no change");
  await dialog.getByRole("button", { name: "Trim 2 columns" }).click();
  await expect(page.locator(".toast")).toContainText("Trimmed spaces in 2 columns · 32 cells changed");

  // Trimmed: a second run finds nothing left.
  await page.locator('[data-qp="hammer-trim"]').click();
  await expect(dialog.locator(".hammer-summary")).toHaveText("Nothing to change in the ticked columns.");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Case: UPPER first; ids start unticked; lower is one click away.
  await page.locator('[data-qp="hammer-case"]').click();
  await expect(row("customer_id").getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("button", { name: "lower", exact: true }).click();
  await expect(row("state").locator(".hammer-count")).toHaveText("40 cells");
  await dialog.getByRole("button", { name: /Change 2 columns/ }).click();
  await page.getByRole("tab", { name: "Table" }).click();
  const grid = page.locator(".table-host");
  await expect(grid).not.toContainText("NSW", { timeout: 10_000 });
  await expect(grid).toContainText("nsw");
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(grid).toContainText("NSW", { timeout: 10_000 });
});
