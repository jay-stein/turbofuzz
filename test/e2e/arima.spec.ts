import { expect, test, type Page } from "@playwright/test";

// AutoARIMA is a deep run the analyst starts by hand: in its own worker, with no time limit, a spinning donut, a Stop
// button, and the parameters it settles on as the result. The classic monthly airline passengers have R's published answer.

const AIR = [
  112, 118, 132, 129, 121, 135, 148, 148, 136, 119, 104, 118, 115, 126, 141, 135, 125, 149, 170, 170, 158, 133, 114, 140,
  145, 150, 178, 163, 172, 178, 199, 199, 184, 162, 146, 166, 171, 180, 193, 181, 183, 218, 230, 242, 209, 191, 172, 194,
  196, 196, 236, 235, 229, 243, 264, 272, 237, 211, 180, 201, 204, 188, 235, 227, 234, 264, 302, 293, 259, 229, 203, 229,
  242, 233, 267, 269, 270, 315, 364, 347, 312, 274, 237, 278, 284, 277, 317, 313, 318, 374, 413, 405, 355, 306, 271, 306,
  315, 301, 356, 348, 355, 422, 465, 467, 404, 347, 305, 336, 340, 318, 362, 348, 363, 435, 491, 505, 404, 359, 310, 337,
  360, 342, 406, 396, 420, 472, 548, 559, 463, 407, 362, 405, 417, 391, 419, 461, 472, 535, 622, 606, 508, 461, 390, 432,
];

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const rows = ["month,passengers"];
  AIR.forEach((v, i) => rows.push(`${1949 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01,${v}`));
  await page.locator('input[type="file"]').setInputFiles({ name: "AirPassengers.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator('.mode-switch-option[data-mode="research"]').click();
  await page.locator(".view-tabs button", { hasText: "Time Series" }).first().click();
  await page.locator(".ts-modes [data-mode=forecast]").click();
  await expect(page.locator(".ts-page [data-ref=heroBadge]")).toBeVisible();
  await page.locator(".ts-fold[data-fold=compute]").click();
}

test("AutoARIMA runs on request and returns the parameters, fit, residual check, backtest and forecast", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const out = page.locator(".ts-page [data-ref=arimaOut]");
  await expect(out).toBeHidden();
  // The deep runs have a section of their own, between Compare models and Under the hood.
  await expect(page.locator(".ts-page .ts-fold b")).toHaveText(["Compare models", "Compute-intense models", "Under the hood"]);
  await expect(page.locator(".ts-page .ts-fold[data-fold=compute]")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".ts-page [data-ref=arimaVoteBtn]")).toHaveText("DV-ARIMA…");
  // Plain auto.arima, to compare with R: the differencing vote is its own button, with its own test below.
  await page.locator(".ts-page [data-ref=arimaBtn]").click();
  await expect(out).toContainText("ARIMA(2,1,1)(0,1,0)[12]", { timeout: 90_000 });
  await expect(out).not.toContainText("How the differencing was chosen");
  // R's auto.arima on these data: ar1 0.5960, ar2 0.2143, ma1 -0.9819; AICc 1018.17.
  const rows = out.locator(".ts-arima-table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("ar1");
  await expect(rows.nth(0)).toContainText("0.5960");
  await expect(rows.nth(1)).toContainText("0.2143");
  await expect(rows.nth(2)).toContainText("-0.9819");
  await expect(out.locator(".ts-arima-fit")).toContainText("1018.17");
  await expect(out).toContainText(/Ljung–Box on the model's errors/);
  await expect(out).toContainText(/Scored on the board's \d+ backtest folds/);
  await expect(out.locator("h5", { hasText: "Forecast" })).toBeVisible();
  await expect(out.locator("tbody tr").filter({ hasText: "January 1961" })).toHaveCount(1);
  await expect(out.locator(".ts-arima-tried summary")).toContainText("Models tried");
  await expect(page.locator(".ts-page [data-ref=arimaBtn]")).toHaveText("Run AutoARIMA again");
  await expect(page.locator(".ts-page [data-ref=arimaRun]")).toBeHidden();
  // Each parameter is read in this series' own numbers, and a glossary explains every figure.
  await expect(rows.nth(0)).toContainText(/Momentum\. About 60% of the last month's change carries into this one/);
  await expect(rows.nth(2)).toContainText(/Echo of a surprise\. 98% of the forecast error/);
  await expect(out.locator(".ts-arima-help")).toContainText("Std. error and z");
  await expect(out.locator(".ts-arima-help")).toContainText("Ljung–Box");
  // It joins the leaderboards as a row of its own, scored on the board's folds.
  await page.locator(".ts-fold[data-fold=compare]").click();
  const lb = page.locator("[data-ref=boardCompact] tr[data-arima]");
  await expect(lb).toHaveCount(1);
  await expect(lb).toContainText("ARIMA(2,1,1)(0,1,0)[12]");
  await expect(lb).toContainText(/\d\.\d\d×/);
  await expect(lb).toContainText(/Holds up|Middling|Doubtful/);
  await expect(page.locator("[data-ref=boardCompact] .ts-group th", { hasText: "Run by you" })).toBeVisible();
  const full = page.locator("[data-ref=board] tr[data-arima]");
  await expect(full).toHaveCount(1);
  await expect(full).toContainText(/Run by you/);
  await expect(full).toContainText(/\d of \d/);
  // Changing what is plotted retires the row: it belongs to the series it was run on (the Transform control is under the hood).
  await page.locator(".ts-fold[data-fold=hood]").click();
  await page.locator(".ts-page [data-ref=trSeg] button[data-tr=log]").click();
  await expect(page.locator("[data-ref=boardCompact] tr[data-arima]")).toHaveCount(0);
});

test("DV-ARIMA: the differencing is voted on, the unit-root test's choice and plain auto.arima's answer are shown, and the forecast is a mixture", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  const out = page.locator(".ts-page [data-ref=arimaOut]");
  await page.locator(".ts-page [data-ref=arimaVoteBtn]").click();
  await expect(out.locator("h4", { hasText: "How the differencing was chosen" })).toBeVisible({ timeout: 150_000 });
  const vote = out.locator(".ts-arima-table").first().locator("tbody tr");
  expect(await vote.count()).toBeGreaterThanOrEqual(2);
  await expect(out.locator(".ts-arima-table").first()).toContainText("the unit-root test's choice");
  await expect(out).toContainText(/plain auto\.arima would have settled on ARIMA\(2,1,1\)\(0,1,0\)\[12\]/);
  const shares = await vote.locator("td:nth-child(3)").allTextContents();
  expect(shares.reduce((a, t) => a + Number(/(\d+)%/.exec(t)?.[1] ?? 0), 0)).toBeGreaterThanOrEqual(98);
  await expect(out).toContainText(/the single most-weighted model/);
  await expect(out.locator(".ts-arima-help")).toBeVisible();
});

test("a long AutoARIMA run shows the donut and its progress, and Stop ends it without a result", async ({ page }) => {
  await open(page);
  await page.locator(".ts-page [data-ref=arimaAll]").check();
  await page.locator(".ts-page [data-ref=arimaBtn]").click();
  const run = page.locator(".ts-page [data-ref=arimaRun]");
  await expect(run).toBeVisible();
  await expect(run.locator(".ts-donut")).toBeVisible();
  await expect(page.locator(".ts-page [data-ref=arimaBtn]")).toBeDisabled();
  await expect(page.locator(".ts-page [data-ref=arimaProg]")).toContainText(/models? tried/, { timeout: 30_000 });
  await run.getByRole("button", { name: "Stop" }).click();
  await expect(run).toBeHidden();
  await expect(page.locator(".ts-page [data-ref=arimaOut]")).toBeHidden();
  await expect(page.locator(".ts-page [data-ref=arimaBtn]")).toHaveText("AutoARIMA…");
});
