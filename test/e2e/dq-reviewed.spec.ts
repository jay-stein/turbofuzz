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
  await page.getByRole("tab", { name: "Clean" }).click();
  const issue = page.locator(".issue-card", { hasText: "birth year" }).first();
  await expect(issue).toContainText("outside 1900");
  await issue.getByRole("button", { name: "Show rows" }).click();
  // The Table shows exactly the three flagged rows, not a page of ordinary values.
  await expect(page.getByText(/3 of 43 rows/)).toBeVisible();
  await expect(page.getByText(/birth year · outside/)).toBeVisible();
  await expect(page.getByText("Augustus", { exact: true })).toBeVisible();
  await expect(page.getByText("Person 7", { exact: true })).toHaveCount(0);
  // Back on Clean: it is a Roman emperor, so it is fine.
  await page.getByRole("tab", { name: "Clean" }).click();
  const before = Number(await page.locator("[data-qp='clean-score']").textContent());
  await issue.getByRole("button", { name: "Not a problem" }).click();
  await expect(page.locator(".issue-card", { hasText: "birth year" })).toHaveCount(0);
  await expect(page.locator(".qp-reviewed")).toContainText("birth year");
  // The rows count as fine now: the score rises, and setting it aside counts as cleaning.
  await expect.poll(async () => Number(await page.locator("[data-qp='clean-score']").textContent())).toBeGreaterThan(before);
  await expect(page.locator(".cl-legend")).toContainText(/Gained by cleaning \+\d+\.\d/);
  // Put it back.
  await page.locator(".qp-reviewed").getByRole("button", { name: "Put back" }).click();
  await expect(page.locator(".issue-card", { hasText: "birth year" }).first()).toBeVisible();
});

test("'Not a problem' on a suggested pair (end latitude below start) sets it aside, lifts the score and ticks the step off", async ({ page }) => {
  const rows = ["trip,start_lat,end_lat"];
  for (let i = 0; i < 40; i++) rows.push(`T${i},${-33.8 + i * 0.01},${i % 3 === 0 ? -34.5 : -33.1 + i * 0.01}`);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "trips.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Clean" }).click();
  const issue = page.locator(".issue-card", { hasText: "end_lat" }).first();
  await expect(issue).toContainText("start_lat", { timeout: 15_000 });
  const before = Number(await page.locator("[data-qp='clean-score']").textContent());
  // A review item says what setting it aside is worth.
  await expect(issue.getByRole("button", { name: "Not a problem" })).toHaveText(/^Not a problem \(\+\d+(\.\d)? pts?\)$/);
  await issue.getByRole("button", { name: "Not a problem" }).click();
  await expect(page.locator(".issue-card", { hasText: "end_lat" })).toHaveCount(0);
  await expect.poll(async () => Number(await page.locator("[data-qp='clean-score']").textContent())).toBeGreaterThan(before);
  await expect(page.locator(".cl-step[data-step='dates']")).toHaveClass(/done/);
});
