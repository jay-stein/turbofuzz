import { expect, test } from "@playwright/test";

const csv = ["day;visits;note (n/a);other;gone (n/a)", ...Array.from({ length: 30 }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")};${10 + i};;${i * 2};`)].join("\n");

test("columns that are empty in every row cost points, are flagged to drop, and drop together as one undoable step", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "gaps.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Overview" }).click();

  // The Overview offers to drop both, and no longer calls them columns "with empty cells".
  const step = page.locator(".next-step-card", { hasText: "empty in every row" });
  await expect(step).toBeVisible({ timeout: 15_000 });
  await expect(step).toContainText("“note (n/a)” and “gone (n/a)”");

  // Data Quality no longer says 100: both columns are flagged, with the fix to drop them.
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await expect(page.locator(".qp-hero2")).not.toContainText("100.0");
  await expect(page.getByText("“note (n/a)” is empty in every row").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("“gone (n/a)” is empty in every row").first()).toBeVisible();

  // Back on the Overview, drop both with one click: both go, which needs the later column dropped first.
  await page.getByRole("tab", { name: "Overview" }).click();
  await step.getByRole("button", { name: "Drop them" }).click();
  await expect(page.locator(".workspace")).toContainText("3 columns", { timeout: 15_000 });
  await expect(page.locator(".nav-actions button", { hasText: /^Recipe \(1\)/ })).toBeVisible();

  // One undo brings both back.
  await page.locator(".nav-actions button", { hasText: /^Undo$/ }).click();
  await expect(page.locator(".workspace")).toContainText("5 columns", { timeout: 15_000 });
});

test("Fix automatically on the Data Quality page drops every empty column in one step, and Undo brings them back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "gaps.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await expect(page.getByText("“note (n/a)” is empty in every row").first()).toBeVisible({ timeout: 15_000 });
  await page.locator(".qp-hero-actions .primary").click();
  await page.locator(".fix-preview-modal").getByRole("button", { name: /^Apply/ }).click();
  await expect(page.getByText(/No issues found across/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".nav-actions button", { hasText: /^Recipe \(1\)/ })).toBeVisible();
  await page.locator(".nav-actions button", { hasText: /^Undo$/ }).click();
  await expect(page.getByText(/No issues found across/)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".qp-hero2")).toContainText("2 issues need fixing");
});
