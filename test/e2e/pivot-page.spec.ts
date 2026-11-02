import { expect, test, type Page } from "@playwright/test";

const CSV = ["region,type,sales,units"];
for (const region of ["North", "South", "East", "West"]) {
  for (const type of ["a", "b", "c"]) CSV.push(`${region},${type},${region.length * type.charCodeAt(0)},${region.charCodeAt(0)}`);
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(CSV.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
}

const pivotTab = (page: Page) => page.getByRole("tab", { name: "Pivot View" });

test("opening the Pivot View minimises the Filters pane, and leaving puts it back", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Table" }).click();
  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).not.toHaveClass(/collapsed/);
  await pivotTab(page).click();
  await expect(sidebar).toHaveClass(/collapsed/);
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(sidebar).not.toHaveClass(/collapsed/);
  await pivotTab(page).click();
  await expect(sidebar).toHaveClass(/collapsed/);
  // Opened by hand, it stays open on the way out.
  await page.locator(".sidebar-toggle").click();
  await expect(sidebar).not.toHaveClass(/collapsed/);
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(sidebar).not.toHaveClass(/collapsed/);
});

test("the dock stays at the top and + New view goes straight to the new view", async ({ page }) => {
  await open(page);
  await pivotTab(page).click();
  const dock = page.locator(".views-dock");
  await expect(dock).toBeVisible();
  const before = await page.locator(".views-dock-tab").count();
  await page.setViewportSize({ width: 1400, height: 520 });
  await page.locator(".views-dock-add").click();
  await page.keyboard.press("Enter");
  await expect(page.locator(".views-dock-tab")).toHaveCount(before + 1);
  await expect(page.locator(".views-dock-tab").last()).toHaveClass(/active/);
  await expect(page.locator(".views-card.expanded")).toHaveCount(1);
  const card = (await page.locator(".views-card.expanded").boundingBox())!;
  const box = (await dock.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  expect(card.y).toBeLessThan(400);
  // Scrolled to the bottom of the page, the dock is still there.
  await page.locator(".views-actions").last().scrollIntoViewIfNeeded();
  const scrolled = (await dock.boundingBox())!;
  expect(scrolled.y).toBeGreaterThanOrEqual(0);
  expect(scrolled.y).toBeLessThan(200);
  await expect(page.locator(".views-dock-add")).toBeInViewport();
});

async function pivotOf(page: Page): Promise<void> {
  await pivotTab(page).click();
  await page.locator(".views-dock-add").click();
  await page.keyboard.press("Enter");
  // region in rows, type across, sum of sales and of units.
  await page.locator(".views-shelf-chip", { hasText: "type" }).dragTo(page.locator('[data-pivot-well="columns"]'));
  await page.locator(".views-shelf-chip", { hasText: "sales" }).dragTo(page.locator('[data-pivot-well="values"]'));
  await page.locator(".views-pivot").waitFor();
}

const columnHeads = (page: Page) => page.locator(".views-pivot th.views-num-head");
const rowHeads = (page: Page) => page.locator(".views-pivot tbody td.views-dim");

test("dragging a column or row header reorders the pivot, and the cells go with it", async ({ page }) => {
  await open(page);
  await pivotOf(page);
  const heads = await columnHeads(page).allTextContents();
  const rows = await rowHeads(page).allTextContents();
  const cellOf = async (rowName: string, colName: string): Promise<string> => {
    const col = (await columnHeads(page).allTextContents()).indexOf(colName);
    const row = (await rowHeads(page).allTextContents()).indexOf(rowName);
    return page.locator(".views-pivot tbody tr").nth(row).locator("td.views-num").nth(col).innerText();
  };
  const lastCol = heads[heads.length - 1]!;
  const value = await cellOf(rows[0]!, lastCol);

  // The last column dropped on the left half of the first.
  const firstHead = (await columnHeads(page).first().boundingBox())!;
  await columnHeads(page).last().dragTo(columnHeads(page).first(), { targetPosition: { x: 3, y: firstHead.height / 2 } });
  await expect.poll(() => columnHeads(page).allTextContents()).toEqual([lastCol, ...heads.slice(0, -1)]);
  expect(await cellOf(rows[0]!, lastCol)).toBe(value);

  const firstRow = (await rowHeads(page).first().boundingBox())!;
  await rowHeads(page).last().dragTo(rowHeads(page).first(), { targetPosition: { x: 8, y: 2 } });
  await expect.poll(() => rowHeads(page).allTextContents()).toEqual([rows[rows.length - 1]!, ...rows.slice(0, -1)]);
  expect(await cellOf(rows[0]!, lastCol)).toBe(value);
  expect(firstRow.height).toBeGreaterThan(0);

  // The Order box says so, and going back to Label undoes it.
  const order = page.getByRole("combobox", { name: "Pivot key order" });
  await expect(order).toHaveValue("dragged");
  await order.selectOption("label");
  await expect.poll(() => columnHeads(page).allTextContents()).toEqual(heads);
  await expect.poll(() => rowHeads(page).allTextContents()).toEqual(rows);
});
