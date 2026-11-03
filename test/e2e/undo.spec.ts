import { test, expect } from "@playwright/test";

function messy(): string {
  const cities = ["Sydney", "sydney", "SYDNEY", "Melbourne", "Perth", "Hobart"];
  const lines = ["id,city"];
  for (let i = 0; i < 300; i++) lines.push(`${i},${cities[(i * 5) % cities.length]}`);
  return lines.join("\n");
}

test("Undo reverses the latest Recipe step from the toolbar and with Ctrl+Z", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "cities.csv", mimeType: "text/csv", buffer: Buffer.from(messy()) });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  const undo = page.locator(".nav-actions button", { hasText: /^Undo$/ });
  const recipe = page.locator(".nav-actions button", { hasText: /^Recipe/ });
  await expect(undo).toBeDisabled();

  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.locator(".qp-hero-actions .primary").click();
  await page.locator(".fix-preview-modal").getByRole("button", { name: /^Apply/ }).click();
  await expect(recipe).toHaveText(/Recipe \(\d+\)/);
  await expect(undo).toBeEnabled();
  await expect(undo).toHaveAttribute("title", /Undo the last change \(Ctrl\+Z\): city: Standardise/);

  await undo.click();
  await expect(recipe).toHaveText("Recipe");
  await expect(undo).toBeDisabled();
  await expect(page.locator(".toast")).toContainText("Undid: city: Standardise");
});

test("a Data Quality decision (Not a problem) appears in the Recipe and can be put back from there", async ({ page }) => {
  const lines = ["id,age"];
  for (let i = 0; i < 300; i++) lines.push(`${i},${i % 60 === 0 ? 999 : 20 + (i % 50)}`);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "ages.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  const recipe = page.locator(".nav-actions button", { hasText: /^Recipe/ });
  await expect(recipe).toBeDisabled();

  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.getByRole("tab", { name: /^Issues/ }).click();
  await page.locator('[data-qp="dismiss"]').first().click();
  await expect(recipe).toHaveText(/Recipe \(1\)/);
  await recipe.click();
  await expect(page.locator(".clean-op")).toContainText(/Data quality: .* marked as not a problem/);
  await expect(page.locator(".clean-op")).toContainText("the data is unchanged");
  await page.getByTitle("Put this decision back").click();
  await expect(recipe).toBeDisabled();
});
