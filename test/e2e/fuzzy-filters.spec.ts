import { test, expect, type Page } from "@playwright/test";

const CITIES = ["London", "Lisbon", "Leeds", "Lyon", "Lima", "Lagos", "Lahore", "Lusaka", "Luanda", "Lviv", "Lille", "Leipzig", "Liverpool", "Ljubljana", "Lodz", "Lome"];

/** city is free text (every row a little different); region repeats 20 values, so it is a pick-list. */
function data(): string {
  const lines = ["order_id,customer_name,region,city"];
  for (let i = 0; i < 400; i++) lines.push(`${i + 1},c${i},Region ${String.fromCharCode(65 + (i % 20))},${CITIES[i % CITIES.length]}${i < 16 ? "" : ` ${i}`}`);
  return lines.join("\n");
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "d.csv", mimeType: "text/csv", buffer: Buffer.from(data()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Table" }).click();
}

const visibleCards = (page: Page) => page.locator(".filter-list > *:not(.hidden)");

test("the column search finds columns from a few letters or a small typo", async ({ page }) => {
  await open(page);
  const search = page.getByPlaceholder("Find a column…").first();
  await search.fill("custmer");
  await expect(visibleCards(page).first()).toContainText("customer_name");
  await search.fill("ordid");
  await expect(visibleCards(page).first()).toContainText("order_id");
  await search.fill("");
  await expect(visibleCards(page)).toHaveCount(4);
});

test("a pick-list's value search forgives a misspelling and puts the best match first", async ({ page }) => {
  await open(page);
  await page.getByPlaceholder("Find a column…").first().fill("region");
  const values = page.getByLabel("Find a value in region");
  await values.fill("regon c");
  await expect(page.locator(".value-row:not([hidden])").first()).toContainText("Region C");
  await values.fill("");
  await expect(page.locator(".value-row:not([hidden])")).toHaveCount(20);
});

test("a free-text filter suggests the values that fit as you type, and a pick filters to it", async ({ page }) => {
  await open(page);
  await page.getByPlaceholder("Find a column…").first().fill("city");
  const box = page.getByLabel("Filter city");
  await box.fill("lodnon");
  const suggest = page.locator(".filter-suggest-item");
  await expect(suggest.first()).toContainText("London");
  await box.press("ArrowDown");
  await box.press("Enter");
  await expect(box).toHaveValue("London");
  await expect(page.locator(".results-row, .nav-row, body").first()).toContainText(/\d+ rows/);
  await expect(page.locator(".filter-card:not(.collapsed) .filter-suggest")).toBeHidden();
});
