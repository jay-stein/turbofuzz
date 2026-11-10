import { test, expect, type Page } from "@playwright/test";
import { buildXlsx, type Sheet } from "../../src/ui/xlsx-writer.js";

const SHOTS = process.env.FRONT_SHOTS;

const q1: Sheet = { name: "Q1", headers: ["id", "region", "amount"], rows: [["1", "North", "10"], ["2", "South", "20"], ["3", "East", "30"]] };
const q2: Sheet = { name: "Q2", headers: ["id", "region", "amount"], rows: [["1", "North", "10"], ["2", "South", "25"], ["4", "West", "40"]] };
const summary: Sheet = { name: "Summary", headers: ["note"], rows: [["totals"]] };

const choice = (page: Page, name: RegExp) => page.getByRole("radiogroup", { name: "What do you want to do?" }).getByRole("radio", { name });

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Clicks A's drop area and answers the file chooser. */
async function dropOnA(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Drop the first table/ }).click();
  await (await chooser).setFiles({ name, mimeType: XLSX, buffer: Buffer.from(bytes) });
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
  await expect(choice(page, /Analyse one table/)).toHaveAttribute("aria-checked", "true");
}

test("the front page opens on one table, explains stacking, and keeps the Swiss Army knife beneath", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "Dropping several files?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "An analyst's Swiss Army knife for tables" })).toBeAttached();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/front-single.png`, fullPage: true });

  await choice(page, /Compare two tables/).click();
  await expect(choice(page, /Compare two tables/)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: /Drop the first table/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Drop the second table/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dropping several files?" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Compare", exact: true })).toBeDisabled();
});

test("two sheets of one workbook: pick A's sheet, drag another onto B, and Compare lands on Spot the difference", async ({ page }) => {
  await open(page);
  await choice(page, /Compare two tables/).click();
  const bytes = await buildXlsx([q1, q2, summary]);
  await dropOnA(page, "sales_2026.xlsx", bytes);

  const sheetsA = page.getByRole("radiogroup", { name: "Sheet for A" });
  await expect(sheetsA.getByRole("radio", { name: /Q1/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Comparing two sheets of this workbook? Drag one onto B.")).toBeVisible();

  await page.locator(".fc-sheet", { hasText: "Q2" }).dragTo(page.locator('.fc-drop[data-side="b"]'));
  const sheetsB = page.getByRole("radiogroup", { name: "Sheet for B" });
  await expect(sheetsB.getByRole("radio", { name: /Q2/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("same workbook as A")).toBeVisible();
  // A's own sheet cannot be B too.
  await expect(sheetsB.getByRole("radio", { name: /Q1/ })).toBeDisabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/front-compare.png`, fullPage: true });

  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.locator(".cmp-step[aria-current=page]")).toContainText("Spot the difference", { timeout: 20_000 });
  await expect(page.locator(".cmp-files")).toContainText("sales_2026 — Q1.csv");
  await expect(page.locator(".cmp-files")).toContainText("sales_2026 — Q2.csv");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/front-compare-result.png` });
});

test("Use as B sends a sheet without dragging, and Swap trades A and B", async ({ page }) => {
  await open(page);
  await choice(page, /Compare two tables/).click();
  const bytes = await buildXlsx([q1, q2]);
  await dropOnA(page, "book.xlsx", bytes);
  await page.getByRole("button", { name: "Use Q2 as B" }).click();
  await expect(page.locator(".fc-summary")).toContainText("book.xlsx › Q1");
  await expect(page.locator(".fc-summary")).toContainText("book.xlsx › Q2");
  await page.getByRole("button", { name: "Swap A and B" }).click();
  await expect(page.getByRole("radiogroup", { name: "Sheet for A" }).getByRole("radio", { name: /Q2/ })).toHaveAttribute("aria-checked", "true");
});

test("two dropped files that share few columns are offered to Compare instead, which opens on Spot the difference", async ({ page }) => {
  await open(page);
  const sales = ["order_id,date,region,amount,rep", "1,2026-01-02,North,10,Ann", "2,2026-01-03,South,20,Bo"].join("\n");
  const returns = ["order_id,date,reason,refund", "1,2026-01-09,damaged,10"].join("\n");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "a_sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales) },
    { name: "b_returns.csv", mimeType: "text/csv", buffer: Buffer.from(returns) },
  ]);
  const dialog = page.locator(".multi-file-modal");
  await expect(dialog).toContainText("These look like two different tables");
  await expect(dialog.getByRole("button", { name: "Stack anyway" })).toBeVisible();
  await dialog.getByRole("button", { name: /Compare them instead/ }).click();
  await expect(page.locator(".cmp-step[aria-current=page]")).toContainText("Spot the difference", { timeout: 20_000 });
  await expect(page.locator(".cmp-files")).toContainText("a_sales.csv");
  await expect(page.locator(".cmp-files")).toContainText("b_returns.csv");
});
