import { test, expect } from "@playwright/test";

/** Stray spaces and mixed capitals in two text columns; an id column that differs only in case. */
function messy(): string {
  const states = ["NSW", "NSW", "NSW", "nsw", " NSW", "Nsw ", "VIC", "VIC", "vic", "US", "us"];
  const lines = ["code,name,state,amount"];
  for (let i = 0; i < 66; i++) {
    const name = i % 11 === 0 ? `Smith${i % 3} ` : `Person${i % 20}`;
    lines.push([i % 2 === 0 ? `ab${i}` : `AB${i}`, name, `"${states[i % states.length]}"`, String(10 + i)].join(","));
  }
  return lines.join("\n");
}

test("Tidy text lists every change in every text column, applies what is ticked, and undoes in one go", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(messy()) });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Clean" }).click();
  await page.locator('[data-qp="tidy-text"]').click();

  const dialog = page.locator(".tidy-modal");
  await expect(dialog).toBeVisible();
  // Text columns only: the code column is an id and is left alone.
  await expect(dialog.locator(".tidy-col-head")).toHaveText([/name/, /state/]);
  const state = dialog.locator(".tidy-col", { hasText: "state" });
  await expect(state.locator(".tidy-item")).toHaveCount(3);
  await expect(state.locator(".tidy-item").first()).toContainText("NSW");
  // Spaces are shown so the trim can be seen.
  await expect(state).toContainText("␣NSW");
  // "us" is a real word here: untick that one change.
  await state.getByRole("checkbox", { name: "Change to US" }).uncheck();
  await dialog.getByRole("button", { name: /Tidy 2 columns/ }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("tab", { name: "Table" }).click();
  const grid = page.locator(".table-host");
  await expect(grid).not.toContainText("nsw", { timeout: 10_000 });
  await expect(grid).not.toContainText("Nsw");
  await expect(page.locator(".toast")).toContainText("Tidied text in 2 columns");
  // Undo puts every column back.
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(grid).toContainText("nsw", { timeout: 10_000 });
});
