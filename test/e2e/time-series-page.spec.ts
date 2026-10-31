import { test, expect, type Page } from "@playwright/test";

// Outliers, Relationships, Time Series and Map are Research-mode tabs, and every new
// dataset opens in General: switch Research on whenever the switch shows General.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const research = document.querySelector<HTMLElement>('.mode-switch-option[data-mode="research"][aria-checked="false"]');
      if (research !== null && !document.querySelector(".workspace.hidden")) research.click();
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-checked", "class"] });
  });
});

/** Two years of weekday readings with a six-week hole in the middle, for three players. */
function games(): string {
  const lines = ["order_date,region,player,points"];
  let d = new Date(Date.UTC(2022, 0, 1));
  for (let i = 0; i < 700; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !(i > 300 && i < 340)) {
      for (const p of ["MJ", "Shaq", "LeBron"]) {
        lines.push(`${d.toISOString().slice(0, 10)},${["East", "West"][i % 2]},${p},${20 + Math.round(10 * Math.sin(i / 30)) + (p === "MJ" ? 8 : p === "Shaq" ? 3 : 0) + (i % 7)}`);
      }
    }
    d = new Date(d.getTime() + 86_400_000);
  }
  return lines.join("\n");
}

async function openPage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "games.csv", mimeType: "text/csv", buffer: Buffer.from(games()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Time Series" }).click();
  await expect(page.locator(".ts-page .ts-strip")).toContainText("Periods");
}

test("the Time Series tab reads the loaded table and says what it plots", async ({ page }) => {
  await openPage(page);
  const sentence = page.locator(".ts-page [data-ref=sentence]");
  await expect(sentence).toContainText(/Daily sum of points/);
  await expect(page.locator(".ts-page [data-ref=subline]")).toContainText("order_date");
  // Weekends never have rows here: that is said, not counted as missing.
  await expect(page.locator(".ts-insight", { hasText: "Data" })).toContainText(/Saturdays and Sundays never have rows/);

  // Split by a category column, then pick one value.
  await page.locator(".ts-tok[data-tok=groupBy]").click();
  await page.locator(".ts-popover button", { hasText: "player" }).click();
  await expect(sentence).toContainText("for player");
  await page.locator(".ts-tok[data-tok=group]").click();
  await page.locator(".ts-popover button", { hasText: "MJ" }).click();
  await expect(sentence).toContainText("MJ");
});

test("forecast, decompose and patterns each draw from the worker", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  await expect(page.locator(".ts-board tbody tr")).toHaveCount(6);
  await page.locator(".ts-page [data-ref=hNum]").fill("30");
  await page.locator(".ts-page [data-ref=hNum]").press("Enter");
  await expect(page.locator(".ts-page [data-ref=hUnit]")).toHaveText("days");
  await expect(page.locator(".ts-page [data-ref=modelCard]")).toContainText("30 days each");

  await page.locator(".ts-modes [data-mode=decompose]").click();
  await expect(page.locator(".ts-page [data-ref=periodSeg] button").first()).toContainText(/Weekly|Yearly/);

  await page.locator(".ts-modes [data-mode=patterns]").click();
  await expect(page.locator(".ts-page [data-ref=patFacts]")).toContainText("Peak day");
  await expect(page.locator(".ts-page [data-ref=patGrid]")).toContainText("no time of day to profile");
});

test("clicking a period filters the Table to it, shown as dates", async ({ page }) => {
  await openPage(page);
  const box = await page.locator(".ts-page canvas[data-ref=heroOverlay]").boundingBox();
  if (!box) throw new Error("no chart");
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect(page.locator(".view-tabs [aria-selected=true]")).toHaveText("Table");
  await expect(page.locator(".filter-chip-label")).toContainText(/order_date · \d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}/);
});

test("several rows per date are called out as several series, with one-click fixes", async ({ page }) => {
  await openPage(page);
  const banner = page.locator(".ts-mixed");
  await expect(banner).toContainText("Several series in one line");
  await expect(banner).toContainText("holds 3 rows");
  await expect(banner).toContainText("one per player");
  await expect(page.locator(".ts-strip")).toContainText("Frequency");

  // Keeping the sum hides the banner for this choice only.
  await banner.getByRole("button", { name: "Keep the sum" }).click();
  await expect(banner).toBeHidden();
  await page.locator(".ts-tok[data-tok=agg]").click();
  await page.locator(".ts-popover button", { hasText: "mean" }).first().click();
  await expect(banner).toBeHidden();

  // A fresh page: one player at a time makes one series, and the banner goes.
  await openPage(page);
  await page.locator(".ts-mixed").getByRole("button", { name: "One player at a time" }).click();
  await expect(page.locator(".ts-page [data-ref=sentence]")).toContainText("for player");
  await expect(page.locator(".ts-mixed")).toBeHidden();
});

test("a Pivot View can be the source: its periods are read at its own grain, not aggregated again", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "games.csv", mimeType: "text/csv", buffer: Buffer.from(games()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  // Pivot View starts with a "Rows by order_date month" view.
  await page.locator(".view-tabs button", { hasText: "Pivot View" }).click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).click();
  await expect(page.locator(".ts-page .ts-strip")).toContainText("Periods");

  await page.locator(".ts-tok[data-tok=source]").click();
  await page.locator(".ts-popover button", { hasText: "Pivot View: Rows by order_date month" }).click();
  const sentence = page.locator(".ts-page [data-ref=sentence]");
  await expect(sentence).toContainText("Monthly");
  await expect(page.locator(".ts-page [data-ref=subline]")).toContainText("Periods of order_date (month)");
  await expect(page.locator(".ts-page [data-ref=why]")).toContainText("not aggregated again");
  await expect(page.locator(".ts-strip")).toContainText("Every month");
  // The grain is the view's own.
  await page.locator(".ts-tok[data-tok=grain]").click();
  await expect(page.locator(".ts-popover button")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Back to the Table's rows.
  await page.locator(".ts-tok[data-tok=source]").click();
  await page.locator(".ts-popover button", { hasText: "Table" }).click();
  await expect(page.locator(".ts-page [data-ref=subline]")).toContainText("Dates from");
});

test("decompose: half-hourly data splits into daily + weekly, and one click reads it at daily grain", async ({ page }) => {
  const lines = ["snapshot_time,occupied"];
  let t = Date.UTC(2026, 3, 1);
  for (let i = 0; i < 90 * 48; i++) {
    const d = new Date(t), hour = d.getUTCHours() + d.getUTCMinutes() / 60, wd = (d.getUTCDay() + 6) % 7;
    lines.push(`${d.toISOString().slice(0, 16).replace("T", " ")},${Math.round(50 + 30 * Math.sin(((hour - 6) / 24) * 2 * Math.PI) + (wd >= 5 ? -15 : 0) + (i % 5))}`);
    t += 30 * 60_000;
  }
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "park.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Time Series" }).click();
  await page.locator(".ts-modes [data-mode=decompose]").click();
  const seasons = page.locator(".ts-page [data-ref=periodSeg]");
  await expect(seasons).toContainText("Daily + weekly");

  const regrain = page.locator(".ts-page [data-ref=decGrain]");
  await expect(regrain).toHaveText(/Daily view/);
  await regrain.click();
  await expect(page.locator(".ts-page [data-ref=sentence]")).toContainText("Daily");
  await expect(page.locator(".ts-modes [data-mode=decompose]")).toHaveAttribute("aria-selected", "true");
  // Ninety days fit a weekly season; a yearly one is shown greyed, with what it needs.
  await expect(seasons.locator("button:not([disabled])")).toContainText(["Weekly"]);
  const yearly = seasons.locator("button[disabled]");
  await expect(yearly).toContainText("needs 733");
  await expect(yearly).toHaveAttribute("title", /This series has 90/);

  await expect(regrain).toHaveText(/Back to/);
  await regrain.click();
  await expect(seasons).toContainText("Daily + weekly");
});
