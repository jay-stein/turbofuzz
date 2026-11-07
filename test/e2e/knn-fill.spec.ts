import { test, expect } from "@playwright/test";

/** Area follows rooms (40 a room, plus noise); a quarter of the areas are empty, and so are some regions. */
function houses(): string {
  const lines = ["rooms,price,region,area"];
  for (let i = 0; i < 600; i++) {
    const rooms = 1 + (i % 5);
    const noise = ((i * 7919) % 13) - 6;
    const region = rooms >= 4 ? "North" : rooms >= 2 ? "Central" : "South";
    lines.push(`${rooms},${rooms * 100000 + noise * 1000},${i % 9 === 0 ? "" : region},${i % 4 === 0 ? "" : rooms * 40 + noise}`);
  }
  return lines.join("\n");
}

test("KNN fill: choose columns with the column itself greyed out, test k, preview, fill, inspect, undo", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "houses.csv", mimeType: "text/csv", buffer: Buffer.from(houses()) });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Table" }).click();
  // The fill menu on the empty-cells chip offers it.
  await page.locator('button[title^="Fill the empty cells in one click"]').click();
  await page.getByRole("menuitem", { name: /Fill from similar rows/ }).or(page.locator(".context-item", { hasText: /Fill from similar rows/ })).first().click();

  const dialog = page.getByRole("dialog", { name: "Fill empty cells from similar rows" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Column to fill")).toContainText("area");
  await dialog.getByLabel("Column to fill").selectOption({ label: "area · 150 empty" });

  // The column being filled cannot be used to describe a similar row.
  const own = dialog.locator(".knn-item", { hasText: "area" });
  await expect(own.locator("input")).toBeDisabled();
  await expect(own).toContainText("this is the column being filled");
  // The columns that go with it are ranked and ticked for the person.
  await expect(dialog.locator(".knn-item", { hasText: "rooms" }).locator("input")).toBeChecked();
  await expect(dialog.locator(".knn-rec").first()).toBeVisible();

  // The fill is tested on values it was not shown, and a k is suggested.
  await expect(dialog.locator(".knn-verdict")).toContainText(/Tested by hiding \d+ known values/);
  await expect(dialog.locator(".knn-verdict")).toContainText(/a clear gain/);
  await expect(dialog.locator(".knn-khint")).toContainText(/best in the test|does best/);
  await expect(dialog.locator(".knn-kaxis")).toContainText(/better/);
  await expect(dialog.locator(".knn-kflag", { hasText: /in use/ }).first()).toBeVisible();
  await expect(dialog.locator(".knn-kbar")).not.toHaveCount(0);
  await expect(dialog.locator(".knn-sample tbody tr")).not.toHaveCount(0);

  await dialog.getByRole("button", { name: "Fill 150 cells" }).click();

  // The result says what happened and lets the person inspect it, then undo.
  const result = page.getByRole("dialog", { name: "KNN fill result" });
  await expect(result).toContainText("Filled 150 cells in “area”");
  await expect(result.locator(".knn-sample tbody tr")).not.toHaveCount(0);
  await expect(page.locator(".nav-actions button", { hasText: /^Recipe \(1\)/ })).toBeVisible();
  await result.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".results-bar button", { hasText: /Hide changes|Show changes/ })).toBeVisible();

  await page.locator(".nav-actions button", { hasText: /^Undo$/ }).click();
  await expect(page.locator(".nav-actions button", { hasText: /^Recipe$/ })).toBeVisible();
});

test("a KNN fill adds to the Recipe: earlier steps stay, kept as part of the data", async ({ page }) => {
  const cities = ["Sydney", "sydney", "SYDNEY", "Melbourne", "Perth", "Hobart"];
  const lines = ["city,rooms,area"];
  for (let i = 0; i < 400; i++) {
    const rooms = 1 + (i % 5);
    lines.push(`${cities[(i * 5) % cities.length]},${rooms},${i % 4 === 0 ? "" : rooms * 40 + (i % 7)}`);
  }
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "homes.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.locator(".qp-hero-actions .primary").click();
  await page.locator(".fix-preview-modal").getByRole("button", { name: /^Apply/ }).click();
  const recipe = page.locator(".nav-actions button", { hasText: /^Recipe/ });
  await expect(recipe).toHaveText(/Recipe \(\d+\)/);

  await page.getByRole("tab", { name: "Table" }).click();
  await page.locator('button[title^="Fill the empty cells in one click"]').click();
  await page.locator(".context-item", { hasText: /Fill from similar rows/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Fill empty cells from similar rows" });
  await expect(dialog.locator(".knn-verdict")).toContainText(/Tested by hiding/);
  await dialog.getByRole("button", { name: /^Fill \d+ cells/ }).click();
  await page.getByRole("dialog", { name: "KNN fill result" }).getByRole("button", { name: "Done" }).click();

  await recipe.click();
  const panel = page.locator(".drawer");
  await expect(panel).toContainText(/Recipe \(2\)/);
  await expect(panel).toContainText(/city: Standardise/);
  await expect(panel).toContainText("kept");
  await expect(panel).toContainText(/KNN impute/);
});
