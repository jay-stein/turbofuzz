import { expect, test } from "@playwright/test";

test("Settings starts with every convention unset, and a holiday region chosen there reaches the Time Series page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  for (const id of ["dateOrder", "weekStart", "holidays"]) await expect(dialog.locator(`#setting-${id}`)).toHaveValue("");
  await expect(dialog).toContainText("Used by:");
  await dialog.locator("#setting-holidays").selectOption("AU-WA");
  await dialog.getByRole("button", { name: "Done" }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("turbofuzz.settings") ?? "{}"));
  expect(stored.holidays).toBe("AU-WA");

  const rows = ["date,sales"];
  for (let i = 0; i < 120; i++) rows.push(`${new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10)},${100 + (i % 7)}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "s.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  await expect(page.locator(".ts-tok[data-tok=holidays]")).toContainText("Western Australia", { timeout: 20_000 });
});

test("dates that fit both orders are read day-first with a question on the Overview, and the answer is saved and applied", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const csv = ["when,amount", "01/02/2025,10", "03/04/2025,20", "05/06/2025,30", "07/08/2025,40", "09/10/2025,50", "02/01/2025,60"].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "ambiguous.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  const step = page.locator(".next-step-card", { hasText: "could be day-first or month-first" });
  await expect(step).toBeVisible({ timeout: 15_000 });
  await expect(step).toContainText("read day-first");
  await step.getByRole("button", { name: "Choose how to read them" }).click();
  await page.getByRole("menuitem", { name: /Month first/ }).or(page.locator(".context-item", { hasText: /Month first/ })).first().click();
  await expect(page.locator(".next-step-card", { hasText: "could be day-first or month-first" })).toHaveCount(0, { timeout: 20_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("turbofuzz.settings") ?? "{}"));
  expect(stored.dateOrder).toBe("mdy");
});
