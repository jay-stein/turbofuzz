import { expect, test } from "@playwright/test";

/** A birth-year column with a few values outside 1900 to the present (Roman emperors, say). */
function csv(): string {
  const rows = ["name,birth year"];
  for (let i = 0; i < 40; i++) rows.push(`Person ${i},${1950 + (i % 40)}`);
  rows.push("Augustus,-63", "Nero,37", "Trajan,53");
  return rows.join("\n");
}

test("Show rows on an out-of-range value filters to those rows, and 'Not a problem' sets it aside until more rows are affected", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Data Quality" }).first().click();
  const issue = page.locator(".issue-card", { hasText: "birth year" }).first();
  await expect(issue).toContainText("outside 1900");
  await issue.getByRole("button", { name: "Show rows" }).click();
  // The Table shows exactly the three flagged rows, not a page of ordinary values.
  await expect(page.getByText(/3 of 43 rows/)).toBeVisible();
  await expect(page.getByText(/birth year · outside/)).toBeVisible();
  await expect(page.getByText("Augustus", { exact: true })).toBeVisible();
  await expect(page.getByText("Person 7", { exact: true })).toHaveCount(0);
  // Back on Data Quality: it is a Roman emperor, so it is fine.
  await page.locator(".view-tabs button", { hasText: "Data Quality" }).first().click();
  await issue.getByRole("button", { name: "Not a problem" }).click();
  await expect(page.locator(".issue-card", { hasText: "birth year" })).toHaveCount(0);
  await expect(page.locator(".qp-reviewed")).toContainText("birth year");
  // Put it back.
  await page.locator(".qp-reviewed").getByRole("button", { name: "Put back" }).click();
  await expect(page.locator(".issue-card", { hasText: "birth year" }).first()).toBeVisible();
});
