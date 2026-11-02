import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

const CSV = ["id,name,amount", "1,Ada,10", "2,Alan,N/A", "3,Grace,30", "4,Edsger,N/A", "5,Barbara,50"].join("\n") + "\n";

interface Provenance {
  source: { kind: string; files: { name: string; bytes: number | null; modified: string | null; sha256: string | null; hashNote: string | null }[]; inside: string | null };
  read: { encoding: string | null; delimiter: string | null; header: string; rows: number; columns: number; missingWords: string[] };
  changes: { steps: number; labels: string[]; rows: number };
  scoring: { scoreVersion: number; weightsAreDefault: boolean };
  tool: { name: string; version: string; build: string | null };
}

async function openQuality(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/");
}

async function showQuality(page: Page): Promise<void> {
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await page.getByRole("button", { name: "Download JSON" }).waitFor();
}

async function downloadReport(page: Page, button: string): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: button }).click()]);
  return readFileSync((await download.path())!, "utf8");
}

const provenanceOf = async (page: Page): Promise<Provenance> =>
  (JSON.parse(await downloadReport(page, "Download JSON")) as { provenance: Provenance }).provenance;

test("a report from a file carries the file's SHA-256, how it was read, and the build", async ({ page }) => {
  await openQuality(page);
  const buffer = Buffer.from(CSV);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer });
  await showQuality(page);
  const p = await provenanceOf(page);
  expect(p.source.kind).toBe("file");
  expect(p.source.files).toHaveLength(1);
  const file = p.source.files[0]!;
  expect(file.name).toBe("orders.csv");
  expect(file.bytes).toBe(buffer.length);
  expect(file.sha256).toBe(createHash("sha256").update(buffer).digest("hex"));
  expect(file.hashNote).toBeNull();
  expect(file.modified).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(p.read).toMatchObject({ encoding: "UTF-8", delimiter: "comma", header: "found automatically", rows: 5, columns: 3 });
  expect(p.read.missingWords).toContain("n/a");
  expect(p.changes).toMatchObject({ steps: 0, rows: 5 });
  expect(p.scoring.weightsAreDefault).toBe(true);
  expect(p.tool).toMatchObject({ name: "TurboFuzz", version });
});

test("once the table is changed, the report says it describes the changed table", async ({ page }) => {
  await openQuality(page);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await showQuality(page);
  await page.getByRole("button", { name: /^Fix: convert 2 placeholders to missing/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Convert to missing" }).click();
  await expect(page.getByRole("button", { name: /^Fix: convert 2 placeholders/ })).toBeHidden();
  const p = await provenanceOf(page);
  expect(p.changes.steps).toBeGreaterThanOrEqual(1);
  expect(p.changes.labels.join(" ")).toMatch(/missing-value policy/);
  // The file it came from is still the one on record, with the same fingerprint.
  expect(p.source.files[0]!.sha256).toBe(createHash("sha256").update(Buffer.from(CSV)).digest("hex"));
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
  expect(pasted.source.kind).toBe("pasted text");
  expect(pasted.source.files[0]).toMatchObject({ name: "Pasted data", bytes: Buffer.byteLength(CSV), modified: null, sha256: createHash("sha256").update(CSV).digest("hex") });

  await page.getByRole("button", { name: "Clear data" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear data" }).click();
  await page.getByRole("button", { name: "Try sample data" }).click();
  await showQuality(page);
  const sample = await provenanceOf(page);
  expect(sample.source.kind).toBe("built-in sample");
  expect(sample.source.files).toHaveLength(0);
});

test("choosing the header row by hand re-reads the same file: the record keeps the file and notes the choice", async ({ page }) => {
  await openQuality(page);
  const titled = Buffer.from(`Orders export,,\n${CSV}`);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "titled.csv", mimeType: "text/csv", buffer: titled });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Set header row" }).click();
  // Row 2 (id, name, amount) is the header, chosen by hand rather than guessed.
  await page.locator(".header-row-line").nth(1).click();
  await page.getByRole("button", { name: "Apply and reload" }).click();
  await expect(page.locator(".header-row-modal")).toHaveCount(0);
  await showQuality(page);
  const p = await provenanceOf(page);
  expect(p.source.files[0]!.name).toBe("titled.csv");
  expect(p.source.files[0]!.sha256).toBe(createHash("sha256").update(titled).digest("hex"));
  expect(p.read.header).toBe("chosen by hand: 1 row skipped, 1 row of header");
  expect(p.read.rows).toBe(5);
});
