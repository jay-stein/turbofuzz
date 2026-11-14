import { test, expect } from "@playwright/test";

// Closing the chart builder while there are no charts used to leave a page with
// no way to add one. The empty state must always offer a way back.
test("an empty Chart tab can reopen the builder after it is closed", async ({ page }) => {
  await page.goto("/");
  const csv = ["date,store,revenue", "2024-01-01,A,10", "2024-01-02,B,12", "2024-01-03,A,9"].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "s.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Chart" }).click();
  await expect(page.getByText("QUICK STARTS")).toBeVisible();
  await page.getByText("More chart types").click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("QUICK STARTS")).toBeHidden();
  await page.getByRole("button", { name: "+ Add a chart" }).click();
  await expect(page.getByText("QUICK STARTS")).toBeVisible();
});
