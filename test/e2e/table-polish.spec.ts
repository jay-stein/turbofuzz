import { expect, test, type Page } from "@playwright/test";

/** A small listings table: an id, text with gaps and placeholders, small integers and large prices. */
function listings(): string {
  const rows = ["listing_id,agent_name,neighbourhood,property_type,bedrooms,bathrooms,price,sqft,review_score,review_summary,status"];
  const hoods = ["Riverside", "Old Town", "Harbour", "Northgate", "Elm Park", "Westfield", "Hillcrest"];
  const types = ["Flat", "House", "Studio", "Loft", "Cottage"];
  for (let i = 0; i < 200; i++) {
    const price = i === 3 ? 98000000 : 451000 + ((i * 7919) % 900) * 1300;
    rows.push(
      [
        100000 + i * 13,
        i % 9 === 0 ? "" : `Agent ${String.fromCharCode(65 + (i % 20))} Smith`,
        i % 8 === 0 ? "N/A" : hoods[i % 7],
        types[i % 5],
        1 + (i % 5),
        1 + (i % 3),
        price,
        i % 10 === 0 ? "" : 600 + ((i * 37) % 2400),
        (3 + (i % 20) / 10).toFixed(1),
        i % 11 === 0 ? "" : "Lovely place with garden and parking near station",
        i % 4 ? "active" : "sold",
      ].join(","),
    );
  }
  return rows.join("\n");
}

async function openListings(page: Page, width = 1280, height = 720): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "homes.csv", mimeType: "text/csv", buffer: Buffer.from(listings()) });
  await page.locator(".nav-row").waitFor();
  await page.getByRole("tab", { name: "Table" }).click();
  await page.locator(".th").first().waitFor();
}

const th = (page: Page, name: string) => page.locator(".th").filter({ has: page.locator(".th-label", { hasText: new RegExp(`^${name}$`) }) });

test("the header filter popover uses the grid's type size, is narrow, and opens by its column", async ({ page }) => {
  await openListings(page);
  for (const name of ["neighbourhood", "price"]) {
    const header = th(page, name);
    await header.locator(".th-filter").click();
    const popover = page.locator(".th-filter-popover");
    await expect(popover).toBeVisible();
    const box = (await popover.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(300);
    const anchor = (await header.boundingBox())!;
    expect(Math.abs(box.y - (anchor.y + anchor.height))).toBeLessThan(40);
    const biggest = await popover.evaluate((node) =>
      Math.max(...[...node.querySelectorAll("*")].map((child) => parseFloat(getComputedStyle(child).fontSize))),
    );
    expect(biggest).toBeLessThanOrEqual(14);
    await page.keyboard.press("Escape");
  }
});

test("big numbers get thousands separators by default, and ID-like columns stay plain", async ({ page }) => {
  await openListings(page);
  const firstRow = page.locator('.tr[data-pos="3"]');
  const cell = async (name: string): Promise<string> => {
    const col = await th(page, name).getAttribute("data-col");
    return (await firstRow.locator(`.td[data-col="${col}"]`).textContent()) ?? "";
  };
  expect(await cell("price")).toBe("98,000,000");
  expect(await cell("listing_id")).toBe("100039");
  expect(await cell("bedrooms")).toBe("4");
});

test("a fade on the right edge says more columns lie off to the side, and goes at the last column", async ({ page }) => {
  await openListings(page);
  const fade = page.locator(".table-edge-fade");
  await expect(fade).toHaveClass(/\bon\b/);
  await page.locator(".table-scroller").evaluate((node) => (node.scrollLeft = node.scrollWidth));
  await expect(fade).not.toHaveClass(/\bon\b/);
  await page.locator(".table-scroller").evaluate((node) => (node.scrollLeft = 0));
  await expect(fade).toHaveClass(/\bon\b/);
});

test("header chips use one word for missing cells and one colour", async ({ page }) => {
  await openListings(page);
  const blanks = th(page, "agent_name").locator(".th-qa-summary");
  const placeholders = th(page, "neighbourhood").locator(".th-qa-summary");
  await expect(blanks).toHaveText(/^\d+ missing ▾$/);
  await expect(placeholders).toHaveText(/^\d+ missing ▾$/);
  const colours = await page.locator(".th-qa-summary:visible").evaluateAll((chips) => [...new Set(chips.map((c) => getComputedStyle(c).color))]);
  expect(colours).toHaveLength(1);
});

test("the toolbar folds its issues into one Issues menu: the rows first, then the fixes", async ({ page }) => {
  await openListings(page);
  const issues = page.locator(".health-issues");
  await expect(issues).toHaveText(/^Issues · 2 ▾$/);
  await expect(page.locator(".health-host button")).toHaveCount(1);
  await issues.click();
  await page.locator(".context-item", { hasText: /^View outliers · 1/ }).click();
  await expect(page.locator(".table-rows .tr")).toHaveCount(1);
  await expect(issues).toHaveClass(/\bactive\b/);
  await issues.click();
  await expect(page.locator(".context-item", { hasText: /^Blank \d+ placeholders/ })).toBeVisible();
  await page.locator(".context-item", { hasText: "Fill missing cells…" }).click();
  await expect(page.locator(".context-menu")).toBeVisible();
});

test("a collapsed Filters pane gives its width to the grid, and the toolbar brings it back", async ({ page }) => {
  await openListings(page);
  const sidebar = page.locator("aside.sidebar");
  const show = page.locator(".filters-show");
  // A narrow window opens with the pane collapsed: the toolbar button is how it comes back.
  if (await show.isVisible()) await show.click();
  await expect(sidebar).toBeVisible();
  await expect(show).toBeHidden();
  await page.locator(".sidebar-toggle").click();
  await expect(sidebar).toBeHidden();
  await expect(show).toBeFocused();
  expect((await page.locator(".table-scroller").boundingBox())!.x).toBeLessThan(2);
  await show.click();
  await expect(sidebar).toBeVisible();
  await expect(show).toBeHidden();
});

test("the cursor cell marks its row number and column header, and a hovered row is tinted", async ({ page }) => {
  await openListings(page);
  const col = await th(page, "neighbourhood").getAttribute("data-col");
  await page.locator(`.tr[data-pos="4"] .td[data-col="${col}"]`).click();
  await expect(page.locator('.tr[data-pos="4"]')).toHaveClass(/\bcursor-row\b/);
  await expect(th(page, "neighbourhood")).toHaveClass(/\bcursor-col\b/);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('.tr[data-pos="5"]')).toHaveClass(/\bcursor-row\b/);
  await expect(page.locator(".tr.cursor-row")).toHaveCount(1);
  const row = page.locator('.tr[data-pos="9"]');
  const before = await row.evaluate((node) => getComputedStyle(node).backgroundColor);
  await row.hover();
  await expect.poll(() => row.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(before);
});

test("a disabled toolbar icon says why in its hover label", async ({ page }) => {
  await openListings(page);
  const undo = page.locator(".nav-actions button", { has: page.locator(".xbtn-label", { hasText: /^Undo/ }) });
  await expect(undo).toBeDisabled();
  await expect(undo.locator(".xbtn-label")).toHaveAttribute("data-why", "Nothing to undo yet");
  await expect(page.locator(".nav-actions button:not(:disabled) .xbtn-label[data-why]")).toHaveCount(0);
});
