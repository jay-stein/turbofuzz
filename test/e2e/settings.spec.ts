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
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  await expect(page.locator(".ts-tok[data-tok=holidays]")).toContainText("Western Australia", { timeout: 20_000 });
});

test("dates that fit both orders are read day-first with a question on the Overview, and the answer is saved and applied", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const csv = ["when,amount", "01/02/2025,10", "03/04/2025,20", "05/06/2025,30", "07/08/2025,40", "09/10/2025,50", "02/01/2025,60"].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "ambiguous.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Overview" }).click();
  const step = page.locator(".next-step-card", { hasText: "could be day-first or month-first" });
  await expect(step).toBeVisible({ timeout: 15_000 });
  await expect(step).toContainText("read day-first");
  await step.getByRole("button", { name: "Choose how to read them" }).click();
  await page.getByRole("menuitem", { name: /Month first/ }).or(page.locator(".context-item", { hasText: /Month first/ })).first().click();
  await expect(page.locator(".next-step-card", { hasText: "could be day-first or month-first" })).toHaveCount(0, { timeout: 20_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("turbofuzz.settings") ?? "{}"));
  expect(stored.dateOrder).toBe("mdy");
});

test("the number format setting changes the thousands and decimal marks everywhere", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.locator("#setting-numberFormat")).toHaveValue("");
  await dialog.locator("#setting-numberFormat").selectOption("de-DE");
  await dialog.getByRole("button", { name: "Done" }).click();
  const rows = ["item,amount"];
  for (let i = 0; i < 40; i++) rows.push(`a${i},${1234567 + i}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await expect(page.locator(".workspace")).toContainText("40 rows");
  expect(await page.evaluate(() => (1234567.5).toLocaleString("en", { maximumFractionDigits: 1 }))).toBe("1.234.567,5");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("turbofuzz.settings") ?? "{}"));
  expect(stored.numberFormat).toBe("de-DE");
});

test("with a number format chosen, big numbers in the table get its thousands separators, and years and small numbers do not", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /Settings/ }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.locator("#setting-numberFormat").selectOption("en-US");
  await dialog.getByRole("button", { name: "Done" }).click();
  const rows = ["year,attendance,score,ratio"];
  for (let i = 0; i < 30; i++) rows.push(`${2000 + i},${19187 + ((i * 7919) % 13) * 311}.0,${90 + (i % 9)},${(i * 1.25).toFixed(2)}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "att.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  const first = page.locator(".table-rows .tr").first();
  await expect(first).toContainText("19,187");
  await expect(first).toContainText("2000");
  await expect(first).not.toContainText("2,000");
  // Switching the format redraws the same cells.
  await page.getByRole("button", { name: /Settings/ }).click();
  await dialog.locator("#setting-numberFormat").selectOption("de-DE");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(first).toContainText("19.187");
  await expect(page.locator(".table-rows .tr").nth(1)).toContainText("1,25");
});

test("a column that only becomes a number after loading gets thousands separators too, and a person's off stays off", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("turbofuzz.settings", JSON.stringify({ numberFormat: "en-US" })));
  await page.reload();
  // Fixed-width, unround 7-digit numbers under a neutral name are read as an ID, so no separators at first.
  const rows = ["title,amt"];
  for (let i = 0; i < 30; i++) rows.push(`Film ${i},${4_000_001 + i * 7_919}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "films.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  const first = page.locator(".table-rows .tr").first();
  await expect(first).toContainText("4000001");

  await page.keyboard.press("Control+k");
  await page.keyboard.type("type amt integer");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Apply this step?" }).getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Convert to Integer" }).click();
  await expect(first).toContainText("4,000,001", { timeout: 15_000 });

  // Turned off by hand, it stays off.
  await page.locator(".table-header .th-label", { hasText: "amt" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Number display/ }).click();
  await page.getByText("Thousands separators", { exact: true }).click();
  await expect(first).toContainText("4000001");
});
