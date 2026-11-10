import { expect, test } from "@playwright/test";

test("the settings sit beside the plot and can be put away, without covering it either way", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  const csv = "region,sales\n" + Array.from({ length: 30 }, (_, i) => `${["N", "S", "E"][i % 3]},${10 + i}`).join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-type").first().click();
  const dialog = page.locator(".modal-overlay");
  if (await dialog.count()) await dialog.getByRole("button", { name: /^(Add|Create|OK)/ }).last().click();
  const canvas = page.locator("canvas.chart-canvas").first();
  await canvas.waitFor();
  const toggle = page.locator(".chart-sidebar-toggle").first();
  const panel = page.locator(".chart-sidebar").first();
  await expect(toggle).toHaveText("Hide settings");
  await expect(panel).toBeVisible();
  const open = (await canvas.boundingBox())!;
  const beside = (await panel.boundingBox())!;
  expect(open.x + open.width).toBeLessThanOrEqual(beside.x);
  await toggle.click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveText("Customize");
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(open.width + 100);
  // Escape does not take the panel away from under a person using it.
  await toggle.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
});

test("a new chart shows its data settings; Refine and Format open on a click and stay as they were left", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  const lines = ["day,region,sales"];
  for (let i = 0; i < 90; i++) lines.push(`2024-${String(1 + Math.floor(i / 30)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")},${["N", "S", "E"][i % 3]},${10 + i}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  const field = (name: string) => page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) });
  await field("day").click();
  await field("sales").click();
  await page.locator(".chart-add-recs .chart-add-tile").first().click();
  const card = page.locator(".chart-card:not(.hidden)");
  const control = (label: string) => card.locator(`select[aria-label="${label}"]`);
  const section = (name: string) => card.locator(".chart-side-group", { has: page.locator(".chart-side-group-name", { hasText: name }) });

  // What every chart needs is in view; the rest waits behind two headings.
  await expect(control("Value column")).toBeVisible();
  await expect(control("Group by")).toBeVisible();
  await expect(card.getByRole("button", { name: "+ Add a line" })).toBeHidden();
  await expect(card.getByLabel("Chart title")).toBeHidden();
  const visible = await card.locator(".chart-sidebar").locator("select, input, button").evaluateAll((all) => all.filter((node) => (node as HTMLElement).checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })).length);
  expect(visible).toBeLessThanOrEqual(12);

  await section("Refine").locator("summary").click();
  await expect(card.getByRole("button", { name: "+ Add a line" })).toBeVisible();
  await expect(card.getByLabel("Chart title")).toBeHidden();

  // The next chart opens with Refine as it was left.
  await page.getByRole("button", { name: "+ Add chart" }).click();
  await page.locator(".chart-add-quick-btn").first().click();
  await expect(page.locator(".charts-tabs [role=tab]")).toHaveCount(2);
  await expect(section("Refine")).toHaveAttribute("open", "");
  await expect(section("Format")).not.toHaveAttribute("open", "");
});
