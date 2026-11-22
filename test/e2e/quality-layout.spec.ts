import { test, expect, type Page } from "@playwright/test";

function messyCustomers(): string {
  const statuses = ["ACTIVE", "active", "Active", "inactive", "Inactive", "pending", "N/A", "-"];
  const cities = ["Sydney", "sydney", "SYDNEY", "Melbourne", "Perth", "Hobart"];
  const lines = ["customer_id,full_name,email,status,city,age"];
  for (let i = 0; i < 600; i++) {
    const email = i % 14 === 0 ? "" : i % 24 === 0 ? `bad@@host${i}.com` : `user${i}@example.com`;
    const age = i % 80 === 0 ? "999" : String(18 + (i % 60));
    lines.push(
      [`C${100000 + i}`, `Ann Person${i % 400}`, email, statuses[(i * 7) % statuses.length], cities[(i * 5) % cities.length], age].join(","),
    );
  }
  return lines.join(String.fromCharCode(10));
}

async function loadCustomers(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(messyCustomers()),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
}

/** The Clean page with every group open. */
async function openClean(page: Page): Promise<void> {
  await loadCustomers(page);
  await page.getByRole("tab", { name: "Clean" }).click();
  await expect(page.locator(".cl-hero")).toBeVisible();
  // Issues come grouped by the kind of work, each group closed: open them all to see every card.
  await page.locator(".qp-expand-all").click();
}

/** The Data Quality Report. */
async function openQuality(page: Page): Promise<void> {
  await loadCustomers(page);
  await page.getByRole("tab", { name: "Data Quality Report" }).click();
  await expect(page.locator(".qp-hero2")).toBeVisible();
}

test("the report: hero, four tiles, tabs from Columns, and a way to the Clean page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openQuality(page);

  await expect(page.locator(".qp-hero2")).toContainText("Data quality");
  await expect(page.locator(".qp-hero-actions .primary")).toHaveText(/^Clean \d+ issues$/);
  await expect(page.locator(".qp-tile")).toHaveCount(4);
  await expect(page.locator(".tile-fix")).toContainText("Needs fixing");
  await expect(page.locator(".tile-rows")).toContainText(/\d[\d,]* of 600/, { timeout: 15_000 });
  await expect(page.locator(".qp-tab")).toHaveText(["Columns", /^Sensitive/, /^Rules/, "History", "All checks"]);
  await expect(page.locator(".qp-panel .qp-col").first()).toContainText("status");
  await expect(page.locator(".issue-card")).toHaveCount(0);
  await expect(page.locator(".qp-footer")).toContainText("No data leaves this tab");
  await page.locator(".qp-hero-actions .primary").click();
  await expect(page.getByRole("tab", { name: "Clean" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cl-hero")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the Clean page: the score bar, the biggest win next, and the issues in their groups", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openClean(page);

  await expect(page.locator(".cl-title")).toHaveText("Clean");
  await expect(page.locator(".cl-bar")).toHaveAttribute("aria-label", /^Score \d+\.\d, raw load \d+\.\d, up to \d+\.\d if all cleaned$/);
  await expect(page.locator(".cl-next")).toContainText("Biggest win next");
  await expect(page.locator(".cl-next .cl-next-pts")).toContainText("pts");
  await expect(page.locator("[data-qp='fix-all-safe']")).toHaveText(/^Fix all safe \(\d+\)…$/);
  await expect(page.locator(".qp-group").first().locator(".qp-group-gain")).toContainText("pts");

  // The first card is the spelling issue, with NOW and AFTER CLEANING bars.
  const first = page.locator(".issue-card").first();
  await expect(first).toContainText("“status” has");
  await expect(first.locator(".dist-title")).toHaveText(["Now", "After cleaning"]);
  await expect(first.locator(".pts-pill")).toContainText("pts");
  // Exactly one solid button in the whole list.
  await expect(page.locator(".issue-card .btn-primary")).toHaveCount(1);
  await expect(page.locator(".qp-sens-banner")).toContainText("possibly sensitive");
  await expect(page.locator(".qp-footer")).toContainText("Computed locally in your browser");
  expect(errors).toEqual([]);
});

test("Fix all safe previews first, applies as undoable steps, raises the score from the raw load, and undo restores", async ({ page }) => {
  await openClean(page);
  const before = Number(await page.locator("[data-qp='clean-score']").textContent());

  await page.locator("[data-qp='fix-all-safe']").click();
  const dialog = page.locator(".fix-preview-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Nothing changes until you press Apply");
  await expect(dialog.locator(".fix-preview-lines").first()).toContainText("→");
  await dialog.getByRole("button", { name: /^Apply/ }).click();

  await expect(page.locator(".qp-fixed")).toContainText("Fixed this session", { timeout: 15_000 });
  await expect(page.locator(".qp-fixed")).toContainText("status");
  // The score data refreshed: the spelling card is gone from the issue list.
  await expect(page.locator(".issue-card").filter({ hasText: "spellings of" })).toHaveCount(0, { timeout: 15_000 });
  const after = Number(await page.locator("[data-qp='clean-score']").textContent());
  expect(after).toBeGreaterThan(before);
  await expect(page.locator(".cl-legend")).toContainText(/Gained by cleaning \+\d+\.\d/);

  // The Table shows the standardised values.
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator(".table-rows .tr").first()).not.toContainText("active ");

  // Undo from the page brings the issue back.
  await page.getByRole("tab", { name: "Clean" }).click();
  const status = page.locator(".qp-fixed-row").filter({ hasText: "status" }).first();
  await status.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".issue-card").filter({ hasText: "spellings of" })).toHaveCount(1, { timeout: 15_000 });
});

test("the report sets the raw load against the cleaned data, step by step", async ({ page }) => {
  await openClean(page);
  await page.locator("[data-qp='fix-all-safe']").click();
  await page.locator(".fix-preview-modal").getByRole("button", { name: /^Apply/ }).click();
  await expect(page.locator(".qp-fixed")).toContainText("Fixed this session", { timeout: 15_000 });
  await page.locator("[data-qp='open-report']").click();
  const section = page.locator(".qc");
  await expect(section).toContainText("Before and after cleaning");
  await expect(section.locator(".qc-sub")).toContainText(/\d+ steps? applied since/);
  const before = Number(await section.locator(".qc-before .qc-score-value").textContent());
  const after = Number(await section.locator(".qc-after .qc-score-value").textContent());
  expect(after).toBeGreaterThan(before);
  await expect(section.locator(".qc-delta")).toHaveText(`+${(after - before).toFixed(1)}`);
  await expect(section.locator(".qc-step").first()).toContainText("Raw load");
  await expect(section.locator(".qc-step").last()).toContainText("After cleaning");
  await expect(section.locator(".qc-table")).toContainText("status");
  // Undo everything: before and after are the same again.
  await page.locator(".nav-actions button", { hasText: /^Undo$/ }).click();
  while ((await page.locator(".nav-actions button", { hasText: /^Undo$/ }).isEnabled())) {
    await page.locator(".nav-actions button", { hasText: /^Undo$/ }).click();
  }
  await expect(section.locator(".qc-sub")).toContainText("No cleaning step yet", { timeout: 15_000 });
});

test("clicking Rows affected filters the table to exactly those rows", async ({ page }) => {
  await openQuality(page);
  const tile = page.locator(".tile-rows");
  await expect(tile).toContainText(/of 600/, { timeout: 15_000 });
  const count = Number((await tile.locator(".qp-tile-value").textContent())!.split(" ")[0].replace(/,/g, ""));
  await tile.click();
  await expect(page.locator(".meta, .row-count, .toolbar").first()).toBeVisible();
  await expect(page.getByText(new RegExp(`${count.toLocaleString("en-US")} rows`)).first()).toBeVisible({ timeout: 15_000 });
});

test("the tab list works from the keyboard", async ({ page }) => {
  await openQuality(page);
  const columns = page.getByRole("tab", { name: "Columns" });
  await expect(columns).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".qp-panel .qp-col").first()).toBeVisible();
  await columns.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Sensitive/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "All checks" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".qp-dim").first()).toBeVisible();
});

async function openCsv(page: Page, name: string, text: string): Promise<void> {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Data Quality Report" }).click();
  await expect(page.locator(".qp-hero2")).toBeVisible();
}

function cleanCsv(): string {
  const lines = ["id,team,points,slot"];
  for (let i = 0; i < 200; i++) lines.push(`${i + 1},${["Red", "Blue", "Green"][i % 3]},${(i * 37) % 101},${i % 7}`);
  return lines.join(String.fromCharCode(10));
}

function wideCsv(): string {
  const names = Array.from({ length: 71 }, (_, i) => `col${i}`);
  const lines = [names.join(",")];
  for (let r = 0; r < 100; r++) lines.push(names.map((_, c) => (c === 0 && r % 5 === 0 ? "" : String((r * 7 + c) % 97))).join(","));
  return lines.join(String.fromCharCode(10));
}

test("a clean file shows a calm empty state, never a blank panel", async ({ page }) => {
  await openCsv(page, "clean.csv", cleanCsv());
  await expect(page.locator(".qp-ring")).toHaveClass(/band-good/);
  await expect(page.locator(".qp-hero-actions .primary")).toHaveText("Open Clean");
  await page.getByRole("tab", { name: "Clean" }).click();
  await expect(page.locator(".qp-empty-state")).toContainText("No issues found across");
  await expect(page.locator(".qp-empty-state")).toContainText("nothing needs fixing");
  await expect(page.locator(".cl-sub")).toHaveText("Nothing left to fix or review.");
});

test("a wide file lists every column on the report's Columns tab", async ({ page }) => {
  await openCsv(page, "wide.csv", wideCsv());
  await expect(page.locator(".qp-panel .qp-col")).toHaveCount(71);
});

test("at phone width the page does not scroll sideways, and dark theme keeps the hero readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openQuality(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.emulateMedia({ colorScheme: "dark" });
  const color = await page.locator(".qp-hero-title").evaluate((node) => getComputedStyle(node).color);
  const background = await page.locator(".qp-hero2").evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(color).not.toBe(background);
  await page.getByRole("tab", { name: "Clean" }).click();
  await expect(page.locator(".cl-hero")).toBeVisible();
  const cleanOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(cleanOverflow).toBeLessThanOrEqual(1);
});

test("the exceptions CSV downloads with the header and the planted bad value", async ({ page }) => {
  await openQuality(page);
  const download = page.waitForEvent("download");
  await page.locator('[data-qp="exceptions"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-exceptions\.csv$/);
  const path = await file.path();
  const text = (await import("node:fs")).readFileSync(path, "utf8");
  expect(text.split("\n")[0]).toBe("row,column,check,dimension,severity,value,reason");
  expect(text).toContain("999");
});

test("the Overview issue count is the Quality page's own count", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(messyCustomers()),
  });
  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  // The issue count is on the Overview, which is no longer the tab a file opens on.
  await page.getByRole("tab", { name: "Overview" }).click();
  const button = page.locator(".triage-open");
  await expect(button).toContainText("fixing");
  const label = (await button.textContent()) ?? "";
  const fix = Number(/^(\d+)/.exec(label)?.[1]);
  const review = Number(/· (\d+) worth/.exec(label)?.[1]);
  await button.click();
  await expect(page.locator(".cl-hero")).toBeVisible();
  await expect(page.locator(".cl-sub")).toContainText(`${fix} issue${fix === 1 ? "" : "s"} to fix and ${review} to review`);
});

test("rows that repeat once the id is ignored appear as a review item", async ({ page }) => {
  const lines = ["id,name,city"];
  for (let i = 0; i < 60; i++) lines.push(`${i + 1},Person ${i % 40},City ${i % 4}`);
  await openCsv(page, "dupes.csv", lines.join(String.fromCharCode(10)));
  await page.getByRole("tab", { name: "Clean" }).click();
  await expect(page.locator(".cl-hero")).toBeVisible();
  // A lone group starts open; with more, open them all.
  if ((await page.locator(".qp-expand-all").count()) > 0) await page.locator(".qp-expand-all").click();
  await expect(page.locator(".issue-card", { hasText: "is ignored" })).toBeVisible({ timeout: 15_000 });
});

test("a start/end column pair gets a suggested consistency check that can be turned off", async ({ page }) => {
  const lines = ["id,start_date,end_date"];
  for (let i = 0; i < 40; i++) lines.push(`${i + 1},2024-01-${String((i % 27) + 1).padStart(2, "0")},2024-02-${String((i % 27) + 1).padStart(2, "0")}`);
  lines.push("41,2024-03-10,2024-03-01");
  await openCsv(page, "pairs.csv", lines.join(String.fromCharCode(10)));
  await page.getByRole("tab", { name: "All checks" }).click();
  const row = page.locator(".qp-check-row, .qp-check", { hasText: "(suggested)" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByText("(suggested)")).toHaveCount(0);
});

test("rules: accept a suggestion, see it scored, download the file; history is empty on a first load and can be cleared", async ({ page }) => {
  await openQuality(page);
  await page.getByRole("tab", { name: /^Rules/ }).click();
  await expect(page.locator(".rule-suggested").first()).toBeVisible();
  await page.locator(".rule-suggested").first().getByRole("button", { name: "Accept" }).click();
  await expect(page.locator(".qp-rule[data-rule]")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: /^Rules 1/ })).toBeVisible();
  await expect(page.locator(".qp-rule[data-rule]")).not.toContainText("checking", { timeout: 10_000 });

  // A rule the data breaks: age must be at most 100 (the file has 999s).
  await page.locator(".qp-rule-form select").first().selectOption("age");
  await page.locator(".qp-rule-form select").nth(1).selectOption("range");
  await page.locator(".qp-rule-form input").nth(1).fill("100");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.locator(".rule-fail")).toContainText("fail", { timeout: 10_000 });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download rules file" }).click();
  expect((await download).suggestedFilename()).toBe("turbofuzz-rules.json");

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".qp-history")).toContainText(/first time|Compared with/);
  await page.locator('[data-qp="clear-history"]').click();
  await expect(page.locator(".qp-history")).toContainText("first time");
});

test("a country column is checked against the bundled list with no network request", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["data:", "blob:", "about:"].includes(url.protocol)) requests.push(request.url());
  });
  const lines = ["id,country"];
  for (let i = 0; i < 60; i++) lines.push(`${i + 1},${["Australia", "France", "Austrlia", "Peru"][i % 4]}`);
  await openCsv(page, "countries.csv", lines.join(String.fromCharCode(10)));
  await page.getByRole("tab", { name: "All checks" }).click();
  await expect(page.getByText("did you mean Australia")).toBeVisible({ timeout: 15_000 });
  expect(requests).toEqual([]);
});

test("no network request leaves the machine while loading, scanning, opening every tab and exporting", async ({ page }) => {
  const outside: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["data:", "blob:", "about:"].includes(url.protocol)) outside.push(request.url());
  });
  await openQuality(page);
  for (const name of [/^Columns/, /^Sensitive/, /^Rules/, "History", "All checks", "Clean"]) {
    await page.getByRole("tab", { name }).click();
  }
  await page.getByRole("tab", { name: "Data Quality Report" }).click();
  const download = page.waitForEvent("download");
  await page.locator('[data-qp="exceptions"]').click();
  await download;
  expect(outside).toEqual([]);
});

test("the HTML report downloads and carries the score", async ({ page }) => {
  await openQuality(page);
  const download = page.waitForEvent("download");
  await page.locator('[data-qp="html-report"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-dq-report\.html$/);
  const text = (await import("node:fs")).readFileSync((await file.path())!, "utf8");
  expect(text).toContain("Data quality report");
  expect(text).not.toMatch(/<script/);
});

test("spellings can be reviewed one by one: the suggested option is ticked, another can be chosen, a group can be skipped, apply and undo", async ({ page }) => {
  await openClean(page);
  await page.locator('[data-qp="review-spellings"]').first().click();
  const dialog = page.getByRole("dialog", { name: "Choose spellings" });
  await expect(dialog).toBeVisible();
  const first = dialog.locator(".std-group").first();
  // Option 1 is the most frequent spelling: highlighted, labelled and ticked.
  const suggested = first.locator(".std-option.is-suggested");
  await expect(suggested).toContainText("Option 1");
  await expect(suggested).toContainText("Suggested");
  await expect(suggested.locator('input[type="checkbox"]')).toBeChecked();
  const before = await suggested.locator(".std-to").textContent();
  // Tick Option 2: the standard moves, and only one option stays ticked.
  await first.locator(".std-option").nth(1).locator('input[type="checkbox"]').check();
  await expect(first.locator('.std-option input[type="checkbox"]:checked')).toHaveCount(1);
  await expect(suggested.locator('input[type="checkbox"]')).not.toBeChecked();
  expect(await first.locator(".std-option.is-chosen .std-to").textContent()).not.toBe(before);
  // Untick everything in the second group to leave it alone.
  if ((await dialog.locator(".std-group").count()) > 1) {
    const second = dialog.locator(".std-group").nth(1);
    await second.locator('.std-option input[type="checkbox"]:checked').first().uncheck();
    await expect(second).toHaveClass(/is-skipped/);
    await expect(second.locator(".std-cells")).toContainText("left as it is");
  }
  await dialog.getByRole("button", { name: /^Apply \d+ group/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".qp-fixed-row").first()).toBeVisible();
  await page.locator(".qp-fixed-row").first().getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".qp-fixed-row")).toHaveCount(0);
});
