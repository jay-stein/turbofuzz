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
  await expect(page.locator(".ts-board tbody tr")).toHaveCount(8);
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

test("the board validates on an expanding or rolling window, ranks by any measure, and explains them", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  const card = page.locator(".ts-page [data-ref=modelCard]");
  await expect(card).toContainText("expanding window");
  await expect(card).toContainText(/MASE \d.*WAPE \d.*sMAPE \d/);

  await page.getByRole("button", { name: "Rolling window" }).click();
  await expect(page.getByRole("button", { name: "Rolling window" })).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText(/each trained on the \d+ days before it \(rolling window\)/);

  await page.getByLabel("Rank by").selectOption("wape");
  await expect(page.locator(".ts-board thead th").nth(1)).toContainText("WAPE");
  await expect(page.locator(".ts-board tbody tr").first().locator("td").nth(1)).toHaveText(/%$/);
  await expect(page.locator(".ts-board thead")).toContainText("Folds beaten");

  await expect(page.locator(".ts-page [data-ref=legend]")).toContainText(/Auto · /);
  await expect(page.locator(".ts-page [data-ref=boardNote]")).toContainText("Ranked by WAPE");
  await page.getByRole("button", { name: "Which model, and why?", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Which model, and why?" });
  await expect(guide.locator(".ts-metric-table").last().locator("thead th")).toHaveText(["Metric", "Why it's good (strengths)", "When to use it", "Math (formula)"]);
  await expect(guide.locator(".ts-metric-table").last().locator("tbody tr")).toHaveCount(7);
  await expect(guide).toContainText("Overfitting");
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
});

test("Export offers the forecast, the series, the model scorecard and the backtest", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  await expect(page.locator(".ts-board tbody tr")).toHaveCount(8);
  const grab = async (item: string): Promise<string> => {
    await page.getByRole("button", { name: "Export ▾" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: item }).click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  };
  const forecast = await grab("Forecast: future periods and bands");
  expect(forecast.split("\n")[0]).toContain("forecast,lo80,hi80,lo95,hi95");
  const series = await grab("Series and forecast: every period");
  expect(series).toContain("row_type");
  expect(series).toMatch(/,forecast,/);
  const models = await grab("Model scorecard: measures and parameters");
  expect(models.trim().split("\n")).toHaveLength(9);
  expect(models).toContain("ETS(A,");
  const backtest = await grab("Backtest detail: every fold, step and model");
  expect(backtest.split("\n")[0]).toContain("model,fold,fold_origin,step_ahead,period_start,actual,forecast,error");
  expect(backtest.trim().split("\n").length).toBeGreaterThan(100);
});

test("the data table says which rows are actual, filled or forecast", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  await expect(page.locator(".ts-board tbody tr")).toHaveCount(8);
  await page.getByRole("button", { name: "Show data table" }).click();
  await expect(page.getByRole("button", { name: "Hide data table" })).toHaveAttribute("aria-expanded", "true");
  const table = page.locator(".ts-page [data-ref=tableWrap]");
  await expect(table.locator("thead th").nth(1)).toHaveText("Status");
  await expect(table.locator("thead th").nth(2)).toContainText("Actual");
  await expect(table.locator("thead")).toContainText(/Forecast\s*\S/);
  await expect(table.locator("tr.ts-row-forecast").first()).toContainText("Forecast");
  await expect(table.locator("tr.ts-row-actual").first()).toContainText("Actual");
  await expect(table.locator(".ts-table-note")).toContainText("in view");
});

test("the chart names the forecast model and how it did; Trend flexibility explains itself and draws its validation curve", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  const badge = page.locator(".ts-page [data-ref=heroBadge]");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/Auto · /);
  await expect(badge).toContainText(/repeating the last cycle at the same horizons, over \d+ backtest folds · MASE \d\.\d\d/);
  await expect(badge).toContainText(/Lockbox check: picked on folds 1–\d+; on fold \d+, which the choice never saw, it ranked #\d of 8/);
  await expect(page.locator(".ts-board thead")).toContainText("Unseen fold");
  await expect(page.locator(".ts-page [data-ref=flexNote]")).toContainText(/ridge \(L2\) penalty of λ = /);
  await page.getByRole("button", { name: "Check every setting" }).click();
  const curve = page.locator(".ts-page [data-ref=flexCurve]");
  await expect(curve.locator("svg circle")).toHaveCount(10);
  await expect(curve).toContainText(/Lowest at \d+/);
  await expect(curve).toContainText(/Suggested: \d+/);
});

test("Explore can plot the difference from n periods earlier, and gap choices state their rule", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-page [data-ref=diffPresets] button", { hasText: "weekly" }).click();
  await expect(page.locator(".ts-page [data-ref=diffOn]")).toBeChecked();
  await expect(page.locator(".ts-page [data-ref=legend]")).toContainText("points − points 7 days earlier");
  await expect(page.locator(".ts-page [data-ref=diffNote]")).toContainText(/Mean change .* SD/);
  await page.locator(".ts-page [data-ref=diffLag]").fill("1");
  await page.locator(".ts-page [data-ref=diffLag]").press("Enter");
  await expect(page.locator(".ts-page [data-ref=legend]")).toContainText("1 day earlier");
  await page.locator(".ts-page [data-ref=diffOn]").uncheck();
  await expect(page.locator(".ts-page [data-ref=legend]")).not.toContainText("earlier");

  await page.locator(".ts-tok[data-tok=gaps]").click();
  const smart = page.locator(".ts-popover button", { hasText: "filled smartly" });
  await expect(smart).toContainText(/Gaps of up to \d+ days? \(a quarter of the shortest season, 7\)/);
  await expect(page.locator(".ts-popover button", { hasText: /^filled with the nearby typical value/ })).toContainText("t ± k·");
});

test("Deep check tests the pick against every rival, by horizon, for calibration and in its residuals", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  await expect(page.locator(".ts-board tbody tr")).toHaveCount(8);
  await page.getByRole("button", { name: "Deep check" }).click();
  const box = page.locator(".ts-page [data-ref=deepBox]");
  await expect(box).toBeVisible();
  await expect(box.locator("section").first().locator("tbody tr")).toHaveCount(7);
  await expect(box).toContainText("Diebold–Mariano");
  await expect(box).toContainText("Error by steps ahead");
  await expect(box).toContainText("Are the bands honest?");
  await expect(box).toContainText(/Ljung–Box: Q = [\d.]+ on \d+ lags, p = /);
  await expect(page.getByRole("button", { name: "Run deep check again" })).toBeVisible();
});

test("each model has a technical page with its equations, this series' fit and its sources", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  await expect(page.locator(".ts-board tbody tr")).toHaveCount(8);
  await page.getByRole("button", { name: "How Best smoothing works" }).click();
  const win = page.getByRole("dialog", { name: "How the forecasts work" });
  await expect(win.locator("h2").nth(1)).toContainText("Best smoothing");
  await expect(win).toContainText("On this series");
  await expect(win).toContainText("AICc = n ln(SSE / n)");
  await expect(win).toContainText("Where this differs from the textbook");
  // A citation jumps to the Sources list and shows what it was used for.
  await win.locator("a.ts-cite", { hasText: "Hyndman & Khandakar (2008)" }).first().click();
  await expect(win.locator("h2").nth(1)).toContainText("Sources and credits");
  await expect(win.locator("#src-forecastpkg")).toContainText("Journal of Statistical Software, 27(3)");
  await expect(win).toContainText("no code was copied from other projects");
  // Topics.
  await win.getByRole("button", { name: "How Auto chooses" }).click();
  await expect(win).toContainText("Diebold–Mariano test");
  await win.getByRole("button", { name: "Seasons: testing and removing them" }).click();
  await expect(win).toContainText("Cleveland");
  await page.keyboard.press("Escape");
  await expect(win).toHaveCount(0);
  // The same window opens from the button beside the guide.
  await page.getByRole("button", { name: "How the models work" }).click();
  await expect(page.getByRole("dialog", { name: "How the forecasts work" })).toBeVisible();
});
