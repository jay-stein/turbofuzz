import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

/** A small Titanic: spelling variants in Sex and Embarked, empty ages, fares to sort by. */
function titanic(): string {
  const sexes = ["male", "Male", "MALE", "female", "Female"];
  const ports = ["S", "s", "C", "Q"];
  const lines = ["PassengerId,Name,Pclass,Sex,Age,Fare,Embarked,Survived"];
  for (let i = 1; i <= 240; i++) {
    lines.push([i, `Passenger ${i}`, 1 + (i % 3), sexes[(i * 7) % sexes.length], i % 6 === 0 ? "" : 18 + (i % 50), ((i * 37) % 300) + 5, ports[(i * 3) % ports.length], i % 3 === 0 ? 1 : 0].join(","));
  }
  return lines.join("\n");
}

async function load(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "titanic.csv", mimeType: "text/csv", buffer: Buffer.from(titanic()) });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
}

test("a workspace file brings a cleaned, transformed, pivoted and charted table back as it was", async ({ page, browser }) => {
  await load(page);
  const recipe = page.locator(".nav-actions button", { hasText: /^Recipe/ });

  // Clean: fix the spelling variants (steps before a transform).
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.locator(".qp-hero-actions .primary").click();
  await page.locator(".fix-preview-modal").getByRole("button", { name: /^Apply/ }).click();
  await expect(recipe).toHaveText(/Recipe \(\d+\)/);

  // Transform: fill the empty ages with the median.
  await page.getByRole("tab", { name: "Table" }).click();
  await page.locator('button[title^="Fill the empty cells in one click"]').click();
  await page.locator(".context-item", { hasText: /Fill with median/ }).first().click();
  const confirm = page.locator(".modal-overlay").getByRole("button", { name: /^Fill/ });
  if (await confirm.count()) await confirm.first().click();
  await expect(page.locator(".action-status")).toContainText(/Applied d+ transform|Filled|Fill/i, { timeout: 15_000 });

  // Clean again, after the transform.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("upper Name");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: /Apply this step/ }).getByRole("button", { name: "Apply" }).click();
  await page.waitForTimeout(800);

  // A chart, and a visit to the pivot views.
  await page.getByRole("tab", { name: "Chart" }).click();
  await page.locator(".chart-add-type", { hasText: /Histogram/i }).first().click();
  await page.locator("canvas.chart-canvas").waitFor();
  await page.getByRole("tab", { name: "Pivot View" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("tab", { name: "Table" }).click();

  const readRecipe = async (target: Page): Promise<string[]> => {
    await target.locator(".nav-actions button", { hasText: /^Recipe/ }).click();
    await target.locator(".drawer .clean-op-list").waitFor();
    for (const toggle of await target.locator(".drawer .step-toggle").all()) await toggle.click();
    const lines = await target.locator(".drawer .clean-op-desc").allInnerTexts();
    await target.locator(".drawer .modal-head .icon-btn").click();
    return lines;
  };
  const before = {
    recipe: await recipe.innerText(),
    steps: await readRecipe(page),
  };
  await page.getByRole("tab", { name: "Pivot View" }).click();
  const viewsBefore = await page.locator(".views-dock button").count();

  // Save the workspace.
  // Saved from the Recipe tab.
  await page.locator(".nav-actions button", { hasText: /^Recipe/ }).click();
  const download = page.waitForEvent("download");
  await page.locator(".drawer").getByRole("button", { name: "Save workspace…" }).click();
  const path = await (await download).path();
  const saved = JSON.parse(fs.readFileSync(path!, "utf8"));
  expect(saved.kind).toBe("turbofuzz-workspace");
  // Clean, transform, then clean again: two phases, then the steps after.
  expect(saved.pipeline.phases.length).toBe(1);
  expect(saved.pipeline.phases[0].cleans.length).toBeGreaterThan(0);
  expect(saved.pipeline.phases[0].transforms.length).toBeGreaterThan(0);
  expect(saved.pipeline.after.cleans.length).toBeGreaterThan(0);
  expect(saved.charts.length).toBe(1);

  // A fresh page: load the same data, open the workspace.
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await load(fresh);
  await fresh.getByRole("button", { name: "Workspace ▾" }).click();
  const chooser = fresh.waitForEvent("filechooser");
  await fresh.getByText("Open workspace…").first().click();
  await (await chooser).setFiles(path!);
  // However long the replay, nothing flashes by: a progress panel covers the page, then it lands on the Table.
  await expect(fresh.locator(".workspace-progress")).toHaveCount(0, { timeout: 30_000 });
  await expect(fresh.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
  await expect(fresh.locator(".nav-actions button", { hasText: /^Recipe/ })).toHaveText(before.recipe, { timeout: 30_000 });
  await expect(fresh.locator(".action-status")).toContainText(/Opened the workspace/, { timeout: 30_000 });
  // The same steps in the Recipe, the same pivot views, the same chart.
  expect(await readRecipe(fresh)).toEqual(before.steps);
  await fresh.getByRole("tab", { name: "Pivot View" }).click();
  await expect(fresh.locator(".views-dock button")).toHaveCount(viewsBefore);
  await fresh.getByRole("tab", { name: "Chart" }).click();
  await expect(fresh.locator("canvas.chart-canvas")).toHaveCount(1, { timeout: 15_000 });
  await context.close();
});
