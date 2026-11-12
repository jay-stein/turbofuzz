import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

const CSV = ["id,name,amount", "1,Ada,10", "2,Alan,N/A", "3,Grace,30", "4,Edsger,N/A", "5,Barbara,50"].join("\n") + "\n";

async function openQuality(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
}

async function showQuality(page: Page): Promise<void> {
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.getByRole("button", { name: "Download HTML report" }).waitFor();
}

async function downloadReport(page: Page, button: string): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: button }).click()]);
  return readFileSync((await download.path())!, "utf8");
}

/** The provenance block of the HTML report, row by row. */
const provenanceOf = async (page: Page): Promise<Record<string, string>> => {
  const html = await downloadReport(page, "Download HTML report");
  const block = html.slice(html.indexOf("<h2>Provenance</h2>"));
  const rows: Record<string, string> = {};
  for (const match of block.matchAll(/<th scope="row">([^<]*)<\/th><td>(.*?)<\/td>/g)) {
    rows[match[1]!] ??= match[2]!.replace(/<[^>]+>/g, "");
  }
  return rows;
};

test("a report from a file carries the file's SHA-256, how it was read, and the build", async ({ page }) => {
  await openQuality(page);
  const buffer = Buffer.from(CSV);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer });
  await showQuality(page);
  const p = await provenanceOf(page);
  expect(p["Source"]).toBe("file");
  expect(p["File"]).toMatch(/^orders\.csv · .* · modified \d{4}-\d\d-\d\dT/);
  expect(p["SHA-256"]).toBe(createHash("sha256").update(buffer).digest("hex"));
  expect(p["Read as"]).toBe("UTF-8 · comma-separated (detected) · header: found automatically");
  expect(p["Rows read"]).toBe("5 rows × 3 columns");
  expect(p["Counted as missing"]).toContain("n/a");
  expect(p["Changes since loading"]).toMatch(/^none: this is the table as read \(5 rows/);
  expect(p["Score"]).toContain("(default)");
  expect(p["Computed by"]).toContain(`TurboFuzz ${version}`);
});

test("once the table is changed, the report says it describes the changed table", async ({ page }) => {
  await openQuality(page);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await showQuality(page);
  await page.locator(".health-issues").click();
  await page.locator(".context-item", { hasText: /^Blank 2 placeholders/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Convert to missing" }).click();
  await expect(page.getByRole("button", { name: /^Fix: convert 2 placeholders/ })).toBeHidden();
  const p = await provenanceOf(page);
  expect(p["Changes since loading"]).toMatch(/^\d+ steps?, so this report describes .*missing-value policy/);
  // The file it came from is still the one on record, with the same fingerprint.
  expect(p["SHA-256"]).toBe(createHash("sha256").update(Buffer.from(CSV)).digest("hex"));
  const html = await downloadReport(page, "Download HTML report");
  expect(html).toContain("<h2>Provenance</h2>");
  expect(html).toMatch(/Changes since loading<\/th><td>\d+ steps?, so this report describes/);
});

test("pasted text and the built-in sample say so, and the text's hash is kept without keeping the text", async ({ page }) => {
  await openQuality(page);
  await page.locator(".paste-secondary > summary").click();
  await page.locator(".paste-card textarea").fill(CSV);
  await page.getByRole("button", { name: "Load pasted data" }).click();
  await showQuality(page);
  const pasted = await provenanceOf(page);
  expect(pasted["Source"]).toBe("pasted text");
  expect(pasted["File"]).toMatch(/^Pasted data/);
  expect(pasted["File"]).not.toContain("modified");
  expect(pasted["SHA-256"]).toBe(createHash("sha256").update(CSV).digest("hex"));

  await page.getByRole("button", { name: "Clear data" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear data" }).click();
  await page.getByRole("button", { name: "Try sample data" }).click();
  await showQuality(page);
  const sample = await provenanceOf(page);
  expect(sample["Source"]).toBe("built-in sample");
  expect(sample["File"]).toBeUndefined();
});

test("choosing the header row by hand re-reads the same file: the record keeps the file and notes the choice", async ({ page }) => {
  await openQuality(page);
  const titled = Buffer.from(`Orders export,,\n${CSV}`);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "titled.csv", mimeType: "text/csv", buffer: titled });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Reshape data" }).click();
  await page.getByRole("menuitem", { name: "Import settings…" }).click();
  // Row 2 (id, name, amount) is the header, chosen by hand rather than guessed.
  await page.locator(".header-row-line").nth(1).click();
  await page.getByRole("button", { name: "Apply and reload" }).click();
  await expect(page.locator(".header-row-modal")).toHaveCount(0);
  await showQuality(page);
  const p = await provenanceOf(page);
  expect(p["File"]).toMatch(/^titled\.csv/);
  expect(p["SHA-256"]).toBe(createHash("sha256").update(titled).digest("hex"));
  expect(p["Read as"]).toContain("header: chosen by hand: 1 row skipped, 1 row of header");
  expect(p["Rows read"]).toMatch(/^5 rows/);
});
