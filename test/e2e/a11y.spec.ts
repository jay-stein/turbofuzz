import { test, expect } from "@playwright/test";

test("core surfaces expose accessible names and focusable controls", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "a11y.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("region,amount\nNorth,10\nSouth,20\n"),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });

  await expect(page.getByRole("tab", { name: "Table" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Pivot View" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Data Quality" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Outliers" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Relationships" })).toBeVisible();

  await page.getByRole("tab", { name: "Table" }).click();
  await page.getByRole("button", { name: "Convert column types" }).click();
  const dialog = page.getByRole("dialog", { name: "Convert column types" });
  await expect(dialog).toBeVisible();
  const target = dialog.getByRole("combobox", { name: "Target type for region" });
  await target.selectOption("number");
  await expect(target).toHaveAttribute("aria-description", /re-parsed/);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("tab", { name: "Chart" }).click();
  await page.locator('.chart-add-type[aria-disabled="false"]').first().click();
  const canvas = page.locator(".chart-card canvas").first();
  await expect(canvas).toHaveAttribute("role", "img");
  await expect(canvas).toHaveAttribute("aria-label", /rows shown/);
});

test("reduced-motion preference disables long transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const duration = await page
    .locator("button")
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  const seconds = duration
    .split(",")
    .map((value) => Number.parseFloat(value));
  expect(Math.max(...seconds)).toBeLessThan(0.02);
});
import AxeBuilder from "@axe-core/playwright";

function messy(): string {
  const lines = ["id,name,email,status,age,joined,country"];
  for (let i = 0; i < 120; i++) {
    lines.push(`${i + 1},Person ${i % 40},user${i}@example.com,${["active", "Active", "inactive"][i % 3]},${i % 30 === 0 ? 999 : 20 + (i % 40)},${i % 7 === 0 ? "03/02/2023" : "2023-02-03"},${["Australia", "Austrlia", "France"][i % 3]}`);
  }
  return lines.join(String.fromCharCode(10));
}

for (const scheme of ["light", "dark"] as const) {
  test(`the Quality page has no serious accessibility violations on any tab (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles({ name: "a11y.csv", mimeType: "text/csv", buffer: Buffer.from(messy()) });
    await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Data Quality" }).click();
    await expect(page.locator(".qp-hero2")).toBeVisible();
    for (const name of [/^Issues/, /^Columns/, /^Sensitive/, /^Rules/, "History", "All checks"]) {
      await page.locator(".qp-tabs").getByRole("tab", { name }).click();
      await page.waitForTimeout(250);
      const result = await new AxeBuilder({ page }).include(".quality-host").withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`),
        `tab ${String(name)} in ${scheme}`,
      ).toEqual([]);
    }
  });
}
