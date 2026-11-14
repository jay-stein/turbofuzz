import { expect, test } from "@playwright/test";

/** Four columns with case variants and one with placeholder text: at least four safe fixes. */
function messy(): string {
  const city = ["Sydney", "sydney", "SYDNEY", "Melbourne", "Perth", "Hobart"];
  const state = ["Victoria", "victoria", "VICTORIA", "Queensland", "Tasmania", "Western Australia"];
  const segment = ["Consumer", "consumer", "CONSUMER", "Corporate", "Home Office", "Small Business"];
  const colour = ["Green", "green", "GREEN", "Red", "Blue", "Yellow"];
  const rep = ["Ann", "Bob", "Cy", "N/A", "Dee", "Eve"];
  const lines = ["id,city,state,segment,colour,sales_rep"];
  for (let i = 0; i < 300; i++) {
    const k = (i * 5) % 6;
    lines.push(`${i},${city[k]},${state[(k + 1) % 6]},${segment[(k + 2) % 6]},${colour[(k + 3) % 6]},${rep[k]}`);
  }
  return lines.join("\n");
}

test("Apply all safe fixes applies every ticked fix, each as its own Recipe step, and says so", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(messy()) });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  const recipe = page.locator(".nav-actions button", { hasText: /^Recipe/ });

  await page.getByRole("tab", { name: "Data Quality" }).click();
  const all = page.locator(".qp-apply-all");
  await expect(all).toHaveText(/Apply all \d+ safe fixes/);
  const count = Number(/Apply all (\d+)/.exec((await all.textContent()) ?? "")?.[1] ?? "0");
  expect(count).toBeGreaterThanOrEqual(4);

  await all.click();
  const dialog = page.locator(".fix-preview-modal");
  await dialog.getByRole("button", { name: `Apply ${count} fixes` }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });

  await expect(page.locator(".toast")).toContainText(`${count} fixes applied`);
  // One Recipe step per fix, as the dialog promised: none folded into a batch.
  await expect(recipe).toHaveText(`Recipe (${count})`);
  // Nothing safe is left to apply.
  await expect(page.locator(".qp-apply-all")).toHaveCount(0);
  await expect(page.locator(".qp-hero-actions .primary")).toHaveText("Nothing to fix automatically");

  // The Recipe lists each fix on its own row, one per cleaned column plus the placeholder change.
  await recipe.click();
  const rows = page.locator(".clean-op-list > .clean-op");
  await expect(rows).toHaveCount(count);
  await expect(page.locator(".clean-op-list .step-group")).toHaveCount(0);
  for (const name of ["city", "state", "segment", "colour"]) {
    await expect(page.locator(".clean-op-list")).toContainText(`${name}: Standardise`);
  }
  await page.keyboard.press("Escape");

  // The data itself: each cleaned column now has one spelling per value (4 distinct, was 6).
  await page.getByRole("tab", { name: "Table" }).click();
  for (const name of ["city", "state", "segment", "colour"]) {
    const head = page.locator(".th").filter({ has: page.locator(".th-label", { hasText: new RegExp(`^${name}$`) }) });
    await expect(head.first()).toContainText("4 distinct");
  }
  await page.getByRole("tab", { name: "Data Quality" }).click();

  // One Undo takes back only the last fix.
  await page.locator(".nav-actions button", { hasText: /^Undo$/ }).click();
  await expect(recipe).toHaveText(`Recipe (${count - 1})`);
});
