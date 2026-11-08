import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const CSV = ["id,name,amount", ...Array.from({ length: 500 }, (_, i) => `${i},name ${i},${i * 3}`)].join("\n");

test("the memory gauge shows what the data holds, opens its details, and sits in compare mode too", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(page.locator(".topbar .mem-gauge")).toBeHidden();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "m.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");

  const gauge = page.locator(".topbar .mem-gauge");
  await expect(gauge).toBeVisible();
  await expect(gauge).toHaveAttribute("aria-label", /^Memory: \d+ KB of about [\d.]+ GB \(\d+%\)\. Plenty of room\.$/);
  await expect(gauge).toHaveAttribute("data-tone", "ok");

  await gauge.click();
  const panel = page.getByRole("dialog", { name: "Memory" });
  await expect(panel).toContainText("Plenty of room");
  await expect(panel).toContainText("Limit for one tab");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const axe = await new AxeBuilder({ page }).include(".mem-panel").analyze();
    expect(axe.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(gauge).toBeFocused();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles({ name: "n.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await expect(mode.locator(".cmp-key").first()).toBeVisible();
  await expect(mode.locator(".mem-gauge")).toBeVisible();
  await mode.locator(".mem-gauge").click();
  await expect(page.getByRole("dialog", { name: "Memory" })).toContainText("Compare (B)");
});
