import { test, expect } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every corpus file must load in the real page without console or page errors,
// and the Data Quality tab must render a score for it.
const root = join("test", "fixtures", "real-world");
const folders = existsSync(root)
  ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "data.csv")))
  : [];

for (const folder of folders) {
  test(`real-world file loads cleanly: ${folder.name}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({
      name: `${folder.name}.csv`,
      mimeType: "text/csv",
      buffer: readFileSync(join(root, folder.name, "data.csv")),
    });
    // A file that is not a plain table is checked before it loads: accept the reading.
    const check = page.locator(".header-row-modal");
    const workspace = page.locator(".workspace");
    await expect.poll(async () => (await check.isVisible()) || (await workspace.isVisible()), { timeout: 30_000 }).toBe(true);
    if (await check.isVisible()) await check.getByRole("button", { name: "Load with these settings" }).click();
    await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Data Quality" }).click();
    await expect(page.locator(".quality-page")).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
