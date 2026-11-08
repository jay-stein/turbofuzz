import { test, expect } from "@playwright/test";

/** No date column at all: an age per person, a region and a score that grows with age. */
function people(): string {
  const lines = ["region,age,score"];
  for (let i = 0; i < 400; i++) lines.push(`${["North", "South", "East"][i % 3]},${20 + (i % 40)},${(i % 40) * 2 + (i % 7)}`);
  return lines.join("\n");
}

test("a chart animates by a number column, in numeric order: each value, or steps", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(people()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
  await page.getByRole("button", { name: "Distribution of score" }).click();
  const card = page.locator(".chart-card").first();
  await card.locator(".chart-animate-btn").waitFor();
  await card.locator(".chart-animate-btn").click();

  const over = card.getByRole("combobox", { name: "Animate over" });
  await expect(over.locator("option:checked")).toHaveText("age");
  await expect(over.locator("optgroup")).toHaveAttribute("label", "Numbers");
  const frames = card.getByRole("combobox", { name: "Frame length" });
  // 40 ages: each value is the default, with steps offered beside it.
  await expect(frames).toHaveValue("value");
  await expect(frames.locator("option")).toContainText(["each value", "steps of 5"]);
  await expect(card.getByRole("button", { name: /Play/ })).toBeVisible();
  const label = card.locator(".chart-animation-label");
  await expect(label).toContainText("20");
  await card.locator(".chart-animation-slider").fill("5");
  await expect(label).toContainText("25");

  // Steps of 5 over ages 20–59: 20 – 25, 25 – 30, …
  await frames.selectOption("step:5");
  await expect(label).toContainText("20 – 25");
});
