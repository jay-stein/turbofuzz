import { expect, test, type Page } from "@playwright/test";

const SMALL = "id,city,qty\n1,keepme-Sydney,10\n2,keepme-Perth,20\n3,keepme-Hobart,30";

/** 200,000 rows by 20 columns, built here: long enough to see and cancel. */
function bigCsv(): Buffer {
  const header = Array.from({ length: 20 }, (_, c) => `col${c}`).join(",");
  const rows: string[] = [header];
  for (let i = 0; i < 200_000; i++) {
    const cells: string[] = [];
    for (let c = 0; c < 20; c++) cells.push(`r${i}c${c}`);
    rows.push(cells.join(","));
  }
  return Buffer.from(rows.join("\n"));
}

async function loadSmall(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "small.csv", mimeType: "text/csv", buffer: Buffer.from(SMALL) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
}

test("a big file replacing the table shows a live indicator over a dimmed table, and Cancel leaves the old data untouched", async ({ page }) => {
  await loadSmall(page);
  await expect(page.locator(".workspace")).toContainText("keepme-Sydney");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Append rows from a file…" }).click();
  await (await chooser).setFiles({ name: "big.csv", mimeType: "text/csv", buffer: bigCsv() });

  const panel = page.locator(".load-progress");
  await expect(panel).toBeVisible({ timeout: 1000 });
  await expect(panel).toContainText("big.csv");
  await expect(panel).toContainText(/\d+ s/);
  await expect(page.locator(".workspace")).toHaveClass(/is-replacing/);
  await expect(panel.getByRole("button", { name: "Cancel" })).toBeEnabled();

  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(".status")).toContainText("Import cancelled — the loaded data is unchanged.");
  await expect(page.locator(".workspace")).not.toHaveClass(/is-replacing/);
  await expect(page.locator(".workspace")).toContainText("keepme-Sydney");
  await expect(page.locator(".workspace")).not.toContainText("r199999c0");
});

test("the first load of a big file shows rows read so far while it works", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: bigCsv() });
  const panel = page.locator(".load-progress");
  await expect(panel).toBeVisible({ timeout: 1000 });
  await expect(panel.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(panel).toContainText(/Reading rows: [\d,]+ so far/, { timeout: 15_000 });
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".status")).toContainText("Import cancelled — nothing was loaded.", { timeout: 15_000 });
});
