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
  await expect(page.locator(".ts-insight", { hasText: /never have rows/ })).toContainText(/Saturdays and Sundays never have rows/);

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
  // AutoARIMA starts by itself and adds a row of its own, searching or finished.
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeGreaterThanOrEqual(12);
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeLessThanOrEqual(13);
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
  // The banner and the findings sit above the chart, so it starts below the fold: bring it into view first.
  const overlay = page.locator(".ts-page canvas[data-ref=heroOverlay]");
  await overlay.scrollIntoViewIfNeeded();
  const box = await overlay.boundingBox();
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

  await page.locator(".ts-fold[data-fold=hood]").click();
  await page.getByRole("button", { name: "Rolling window" }).click();
  await expect(page.getByRole("button", { name: "Rolling window" })).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText(/each trained on the \d+ days before it \(rolling window\)/);

  await page.getByLabel("Rank by").selectOption("wape");
  await expect(page.locator("[data-ref=board] thead th").nth(1)).toContainText("WAPE");
  await expect(page.locator("[data-ref=board] tbody tr").first().locator("td").nth(1)).toHaveText(/%$/);
  await expect(page.locator("[data-ref=board] thead")).toContainText("Folds beaten");

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
  // AutoARIMA starts by itself and adds a row of its own, searching or finished.
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeGreaterThanOrEqual(12);
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeLessThanOrEqual(13);
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
  expect(models.trim().split("\n")).toHaveLength(13);
  expect(models).toContain("ETS(A,");
  const backtest = await grab("Backtest detail: every fold, step and model");
  expect(backtest.split("\n")[0]).toContain("model,fold,fold_origin,step_ahead,period_start,actual,forecast,error");
  expect(backtest.trim().split("\n").length).toBeGreaterThan(100);
});

test("the data table says which rows are actual, filled or forecast", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  // AutoARIMA starts by itself and adds a row of its own, searching or finished.
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeGreaterThanOrEqual(12);
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeLessThanOrEqual(13);
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

test("the mode bar stays in view while the page scrolls", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  const host = page.locator(".timeseries-host");
  const top = (await host.boundingBox())!.y;
  await host.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300);
  const bar = (await page.locator(".ts-modes").boundingBox())!;
  expect(bar.y).toBeGreaterThanOrEqual(top - 1);
  expect(bar.y).toBeLessThan(top + 70);
  // The bar is a whole row, not squashed, and opaque, so what scrolls under it does not show through.
  const row = (await page.locator(".ts-modebar").boundingBox())!;
  expect(row.height).toBeGreaterThan(bar.height);
  expect(await page.locator(".ts-modebar").evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  // And it still works from down there.
  await page.locator(".ts-modes [data-mode=explore]").click();
  await expect(page.locator(".ts-modes [data-mode=explore]")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".ts-modebar")).toBeVisible();
});

test("the simple method a forecast is judged against is named in the badge, tagged on the board, and one click away", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  const badge = page.locator(".ts-page [data-ref=heroBadge]");
  const yard = badge.locator(".ts-yard");
  await expect(yard).toContainText("Compared with");
  const name = ((await yard.locator("b").textContent()) ?? "").trim();
  expect(name.length).toBeGreaterThan(2);
  // The board marks the same method, so the analyst can see where it ranks.
  await expect(page.locator("[data-ref=boardCompact] tr", { hasText: name }).first().locator(".ts-yardtag, .ts-simpletag")).toHaveCount(1);
  // One click makes it the forecast.
  await yard.getByRole("button", { name: "Use it instead" }).click();
  await expect(badge).toContainText("picked by you");
  await expect(badge.locator(".ts-badge-top b").first()).toHaveText(name);
});

test("the chart names the forecast model and how it did; Trend flexibility explains itself and draws its validation curve", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  const badge = page.locator(".ts-page [data-ref=heroBadge]");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/Auto · /);
  // One verdict, in the words people ask in, and the three questions answered in order.
  await expect(badge.locator(".ts-verdict")).toHaveText(/^(Reliable|Use with care|Can't judge yet)$/);
  await expect(badge.locator(".ts-qa-q")).toContainText(["Does it beat a simple method?", "Is it the best available?", "Can you trust the shaded band?"]);
  await expect(badge.locator(".ts-qa-row").first()).toContainText(/less error than|no better than|too little history|did better on data it never saw|beats repeating|beat repeating the last year in only|did poorly/);
  // The strip and the findings say the same word as the badge, not a second grade.
  const word = (await badge.locator(".ts-verdict").textContent()) ?? "";
  await expect(page.locator(".ts-page [data-ref=strip]")).toContainText(word);
  await expect(page.locator(".ts-page [data-ref=insights]")).toContainText(`Forecast · ${word}`);
  await expect(page.locator(".ts-page")).not.toContainText(/Heads up:|error vs naive|Holds up|Middling|Doubtful/);
  await expect(badge).not.toContainText("lead");
  // Details opens the numbers under the hood.
  await badge.getByRole("button", { name: "Details" }).click();
  await expect(page.locator(".ts-fold[data-fold=hood]")).toHaveAttribute("aria-expanded", "true");
  await page.locator(".ts-fold[data-fold=hood]").click();
  await expect(page.locator(".ts-fold[data-fold=compare]")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".ts-page [data-ref=foldHood]")).toBeHidden();
  // The numbers behind the verdict are under the hood.
  const detail = page.locator(".ts-page [data-ref=heroDetail]");
  await expect(detail).toContainText(/repeating the last cycle at the same horizons, over \d+ backtest folds · MASE \d\.\d\d/);
  await expect(detail).toContainText(/Lockbox check: picked on folds 1–\d+; on fold \d+, which the choice never saw, it ranked #\d of 8/);
  // The three answers on top, then every model in one list, lowest error first, the pick marked Auto.
  await expect(page.locator("[data-ref=answer] .ts-ans")).toHaveCount(2);
  await expect(page.locator("[data-ref=answer]")).toContainText(/Best simple model/);
  await expect(page.locator("[data-ref=answer]")).toContainText(/less error|Also the best simple model/);
  const compact = page.locator("[data-ref=boardCompact]");
  await expect(compact.locator("thead th")).toHaveCount(4);
  await expect(compact.locator("tr[data-model]")).toHaveCount(12, { timeout: 30_000 });
  await expect(compact.locator(".ts-group")).toHaveCount(0);
  const ratios = (await compact.locator("tr[data-model] .ts-ratio").allTextContents()).map((t) => parseFloat(t));
  expect(ratios).toEqual([...ratios].sort((p, q) => p - q));
  await expect(compact.locator("tr[data-model] .ts-autotag")).toHaveCount(1);
  await expect(page.locator("[data-ref=board] thead")).toContainText("Unseen fold");
  await expect(page.locator(".ts-page [data-ref=flexNote]")).toContainText(/ridge \(L2\) penalty of λ = /);
  await page.locator(".ts-fold[data-fold=hood]").click();
  await page.getByRole("button", { name: "Check every setting" }).click();
  const curve = page.locator(".ts-page [data-ref=flexCurve]");
  await expect(curve.locator("svg circle")).toHaveCount(10, { timeout: 30_000 });
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
  // AutoARIMA starts by itself and adds a row of its own, searching or finished.
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeGreaterThanOrEqual(12);
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeLessThanOrEqual(13);
  await page.locator(".ts-fold[data-fold=hood]").click();
  await page.getByRole("button", { name: "Deep check" }).click();
  const box = page.locator(".ts-page [data-ref=deepBox]");
  await expect(box).toBeVisible();
  await expect(box.locator("section").first().locator("tbody tr")).toHaveCount(11);
  await expect(box).toContainText("Diebold–Mariano");
  await expect(box).toContainText("Error by steps ahead");
  await expect(box).toContainText("Are the bands honest?");
  await expect(box).toContainText(/Ljung–Box: Q = [\d.]+ on \d+ lags, p = /);
  await expect(page.getByRole("button", { name: "Run deep check again" })).toBeVisible();
});

test("each model has a technical page with its equations, this series' fit and its sources", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  // AutoARIMA starts by itself and adds a row of its own, searching or finished.
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeGreaterThanOrEqual(12);
  await expect.poll(async () => page.locator("[data-ref=board] tbody tr").count()).toBeLessThanOrEqual(13);
  await page.getByRole("button", { name: "How Best smoothing works" }).click();
  const win = page.getByRole("dialog", { name: "How the forecasts work" });
  await expect(win.locator("h2").nth(1)).toContainText("Best smoothing");
  await expect(win).toContainText("On this series");
  await expect(win).toContainText("AICc = −2 ln L + 2k");
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
  await page.locator(".ts-fold[data-fold=hood]").click();
  await page.getByRole("button", { name: "How the models work" }).click();
  await expect(page.getByRole("dialog", { name: "How the forecasts work" })).toBeVisible();
});

test("a slow calculation shows a Calculating pill with a spinner, and quick ones show nothing", async ({ page }) => {
  // Hold the worker's answer for a series for 700 ms so the wait is long enough to notice.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    (window as unknown as { __slowTs: boolean }).__slowTs = false;
    Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      const m = message as { type?: string } | null;
      if (m?.type === "getTimeSeries" && (window as unknown as { __slowTs: boolean }).__slowTs) {
        window.setTimeout(() => (post as (...a: unknown[]) => void).call(this, message, ...rest), 700);
        return;
      }
      (post as (...a: unknown[]) => void).call(this, message, ...rest);
    } as typeof Worker.prototype.postMessage;
  });
  await openPage(page);
  const busy = page.locator(".ts-page [data-ref=busy]");
  await expect(busy).toBeHidden();
  await page.evaluate(() => { (window as unknown as { __slowTs: boolean }).__slowTs = true; });
  await page.locator(".ts-modes [data-mode=forecast]").click();
  await page.locator(".ts-page [data-ref=hPresets] button").first().click();
  await expect(busy).toBeVisible();
  await expect(busy).toContainText("Calculating");
  await expect(busy.locator(".ts-spinner")).toBeVisible();
  await expect(busy).toBeHidden({ timeout: 5000 });
  // Without the delay a change answers in milliseconds and the pill never appears.
  await page.evaluate(() => { (window as unknown as { __slowTs: boolean }).__slowTs = false; });
  await page.locator(".ts-page [data-ref=hPresets] button").nth(1).click();
  await page.waitForTimeout(400);
  await expect(busy).toBeHidden();
});

test("Transform under the hood asks for a power transformation and the model card says what happened", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  await page.locator(".ts-fold[data-fold=hood]").click();
  const seg = page.locator("[data-ref=trSeg]");
  await expect(seg.locator("button[data-tr=none]")).toHaveAttribute("aria-pressed", "true");
  await seg.locator("button[data-tr=log]").click();
  await expect(seg.locator("button[data-tr=log]")).toHaveAttribute("aria-pressed", "true");
  // Applied (the series is above zero) or declined with the reason: either way the card says so.
  await expect(page.locator("[data-ref=modelCard]")).toContainText(/Transform\s*(Box-Cox with λ = 0\.00 \(the log, as you chose\)|Asked for, but not applied)/);
  await seg.locator("button[data-tr=none]").click();
  await expect(page.locator("[data-ref=modelCard]")).not.toContainText("Transform");
});

test("a text column of months is offered as the date, and one click makes the page usable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const rows = ["month,sales"];
  for (let i = 0; i < 36; i++) rows.push(`${2022 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")},${100 + i * 3 + (i % 12)}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "monthly.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  const offer = page.locator(".ts-page [data-use-date]");
  await expect(offer).toBeVisible({ timeout: 20_000 });
  await expect(offer).toContainText("Use month as date");
  await offer.click();
  await expect(page.locator(".ts-page [data-ref=empty]")).toBeHidden({ timeout: 20_000 });
});

test("an error code in the measure is called out, and one click treats it as missing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const rows = ["date,pm25"];
  for (let i = 0; i < 120; i++) rows.push(`${new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)},${i % 9 === 4 ? -999 : 12 + (i % 7) * 2}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "sensor.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  const banner = page.locator(".ts-page [data-ref=sentinel]");
  await page.locator(".ts-tok[data-tok=agg]").click();
  await page.locator(".ts-popover button[data-val=mean]").click();
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("-999");
  await banner.locator("button[data-sentinel]").click();
  await expect(banner).toBeHidden({ timeout: 20_000 });
});

test("a column that moves the series is offered as a driver with the error it cuts, and one click adds it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  let seed = 9;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  const rows = ["date,demand,temp_c,pressure"];
  for (let i = 0; i < 400; i++) {
    const temp = 20 + 6 * Math.sin((2 * Math.PI * i) / 365) + 9 * rnd();
    const demand = 500 + 40 * Math.sin((2 * Math.PI * i) / 7) + 12 * (temp - 20) + 40 * rnd();
    rows.push(`${new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10)},${demand.toFixed(1)},${temp.toFixed(1)},${(1000 + 30 * rnd()).toFixed(1)}`);
  }
  await page.locator('input[type="file"]').setInputFiles({ name: "demand.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  await page.locator(".ts-tok[data-tok=agg]").click();
  await page.locator(".ts-popover button", { hasText: "mean" }).first().click();
  await page.locator(".ts-page button", { hasText: "Show all" }).first().click();
  const finding = page.locator(".ts-page").getByText("cuts the error by").first();
  await expect(finding).toBeVisible({ timeout: 30_000 });
  await expect(finding).toContainText("temp_c");
  await page.locator(".ts-page button", { hasText: "Add temp_c" }).first().click();
  await expect(page.locator(".ts-page .ts-drv:not(.add)").first()).toContainText("temp_c", { timeout: 20_000 });
});

test("a holiday region can be chosen on the page, and the calendar is then offered as a driver", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const { holidaysBetween } = await import("../../src/data/timeseries/holidays");
  const start = Date.UTC(2023, 0, 1), n = 365 * 3;
  const hol = new Set(holidaysBetween("AU-WA", start, start + n * 86_400_000).map((h) => h.ms));
  let seed = 4;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  const rows = ["date,sales"];
  for (let i = 0; i < n; i++) {
    const t = start + i * 86_400_000;
    rows.push(`${new Date(t).toISOString().slice(0, 10)},${(hol.has(t) ? 40 : 100 + 20 * Math.sin((2 * Math.PI * i) / 7) + 3 * rnd()).toFixed(1)}`);
  }
  await page.locator('input[type="file"]').setInputFiles({ name: "shop.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  await page.locator(".ts-tok[data-tok=agg]").click();
  await page.locator(".ts-popover button", { hasText: "mean" }).first().click();
  const chip = page.locator(".ts-tok[data-tok=holidays]");
  await expect(chip).toHaveText("not set", { timeout: 20_000 });
  await chip.click();
  await page.locator(".ts-popover button", { hasText: "Western Australia" }).first().click();
  await expect(chip).toContainText("Western Australia");
  await page.locator(".ts-page button", { hasText: "Show all" }).first().click();
  await expect(page.locator(".ts-page").getByText("Public holiday cuts the error by").first()).toBeVisible({ timeout: 30_000 });
});

test("the forecast verdict says the typical miss in the series' own units and as a share of the total, by name", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  const miss = page.locator(".ts-page .ts-miss").first();
  await expect(miss).toBeVisible({ timeout: 30_000 });
  await expect(miss).toContainText("(MAE)");
  await expect(miss).toContainText("(WAPE)");
  await expect(miss).toContainText("per day");
});

test("on a seasonal series the latest change is shown with the season taken out, and says so", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const rows = ["date,units"];
  for (let i = 0; i < 400; i++) rows.push(`${new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10)},${(100 + 40 * Math.sin((2 * Math.PI * i) / 7) + (i % 5) * 0.2).toFixed(1)}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "weekly.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  await page.locator(".ts-tok[data-tok=agg]").click();
  await page.locator(".ts-popover button", { hasText: "mean" }).first().click();
  await expect(page.locator(".ts-strip")).toContainText("seasonally adjusted", { timeout: 20_000 });
});

test("Decompose shows a typical week and a typical year, not just the wave laid end to end", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  const rows = ["date,sales"];
  for (let i = 0; i < 365 * 4; i++) rows.push(`${new Date(Date.UTC(2022, 0, 1 + i)).toISOString().slice(0, 10)},${(200 + 25 * Math.sin((2 * Math.PI * i) / 7) + 40 * Math.sin((2 * Math.PI * i) / 365.25) + (i % 9) * 0.3).toFixed(1)}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "d.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  await page.locator(".ts-tok[data-tok=agg]").click();
  await page.locator(".ts-popover button", { hasText: "mean" }).first().click();
  await page.locator(".ts-modes [data-mode=decompose]").click();
  const figs = page.locator("[data-ref=seasonFigs]");
  await expect(figs).toContainText("A typical week", { timeout: 20_000 });
  await expect(figs).toContainText("A typical year");
  await expect(figs.locator("figure").first().locator("text", { hasText: "Mon" })).toBeVisible();
});

test("Patterns shows the full series chart, and a click folds it to a strip", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=patterns]").click();
  const fold = page.locator(".ts-page [data-ref=heroFold]");
  const hero = page.locator(".ts-page [data-ref=hero]");
  await expect(fold).toContainText("Fold the series chart");
  await expect.poll(async () => (await hero.boundingBox())!.height).toBeGreaterThan(200);
  await fold.click();
  await expect(fold).toContainText("Show the full series chart");
  await expect.poll(async () => (await hero.boundingBox())!.height).toBeLessThan(90);
});

test("each finding shows two lines, and More opens the rest", async ({ page }) => {
  await openPage(page);
  const more = page.locator(".ts-insights .ts-more").first();
  await expect(more).toBeVisible({ timeout: 20_000 });
  const p = more.locator("xpath=preceding-sibling::p[1]");
  const closed = (await p.boundingBox())!.height;
  await more.click();
  await expect(more).toContainText("Less");
  expect((await p.boundingBox())!.height).toBeGreaterThan(closed);
});

test("the simplest yardstick is named for the cycle it copies on this series", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  const compact = page.locator("[data-ref=boardCompact]");
  await page.locator(".ts-fold[data-fold=compare]").click();
  await expect(compact).toContainText(/Same day last week/, { timeout: 20_000 });
  await expect(compact).not.toContainText("Repeat last cycle");
});

test("the band levels can be set, are remembered, and the outer band can be turned off", async ({ page }) => {
  await openPage(page);
  await page.locator(".ts-modes [data-mode=forecast]").click();
  const inner = page.locator(".ts-page [data-ref=bandInner]");
  const outer = page.locator(".ts-page [data-ref=bandOuter]");
  await expect(inner).toHaveValue("80");
  await expect(outer).toHaveValue("95");
  await expect(page.locator(".ts-page [data-ref=legend]")).toContainText("80% and 95% range");
  await inner.fill("90");
  await inner.press("Tab");
  await outer.fill("99");
  await outer.press("Tab");
  await expect(page.locator(".ts-page [data-ref=legend]")).toContainText("90% and 99% range");
  // An outer band that is not wider than the inner one is the same as none.
  await outer.fill("85");
  await outer.press("Tab");
  await expect(page.locator(".ts-page [data-ref=legend]")).toContainText("90% range");
  await expect(page.locator(".ts-page [data-ref=legend]")).not.toContainText("% and");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("turbofuzz.timeseries.bands") ?? "{}"));
  expect(stored).toEqual({ inner: 90, outer: 0 });
});
