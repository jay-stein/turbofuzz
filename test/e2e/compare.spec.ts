import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const A = ["id,name,amount,region,old", "1,Ada,10,North,x", "2,Alan,20,South,y", "3,Grace,30,East,z", "4,Edsger,40,West,w"].join("\n");
const B = ["id,full_name,amount,Region,new", "1,Ada,10,North,p", "3,Grace,31,East,q", "4,Edsger W.,40,West,r", "5,Barbara,50,North,s"].join("\n");
const file = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });

async function loadA(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(file("before.csv", A));
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
}

test("Load more → Compare: the loaded data is A, a key is suggested, a rename is paired by hand, and Exit returns to the data", async ({ page }) => {
  await loadA(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles(file("after.csv", B));

  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await expect(mode.locator(".cmp-side-a")).toContainText("before.csv");
  await expect(mode.locator(".cmp-side-b")).toContainText("after.csv");
  const suggested = mode.locator(".cmp-key").first();
  await expect(suggested).toContainText("id");
  await expect(suggested).toContainText("Suggested");
  await expect(suggested.getByRole("radio")).toBeChecked();
  await expect(mode.locator(".cmp-columns")).toContainText("Name differs only in case or spacing");

  await mode.getByRole("combobox", { name: /Pair name/ }).selectOption({ label: "full_name" });
  await expect(mode.locator(".cmp-col-note", { hasText: "Paired by hand" })).toBeVisible();

  // The rest of the app is out of reach: its shortcuts do nothing.
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: /command/i })).toHaveCount(0);

  await mode.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(mode.getByRole("heading", { name: "What changed" })).toBeVisible();
  await expect(mode.locator(".cmp-tile-value")).toHaveText(["1", "2", "1", "1", "4 → 4"]);
  await expect(mode.locator(".cmp-change-name")).toHaveText(["full_name", "amount"]);

  await mode.getByRole("button", { name: "Exit compare" }).click();
  await expect(mode).toHaveCount(0);
  await expect(page.locator(".count").first()).toContainText("4 rows");
});

test("from the start screen both files are chosen in compare mode, and A stays loaded after Exit", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Compare two datasets…" }).click();
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await mode.getByLabel("Choose the file for A").setInputFiles(file("before.csv", A));
  await expect(mode.locator(".cmp-side-a")).toContainText("4 rows × 5 columns");
  await mode.getByLabel("Choose the file for B").setInputFiles(file("after.csv", B));
  await expect(mode.locator(".cmp-key").first()).toContainText("Suggested");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const axe = await new AxeBuilder({ page }).include(".compare-mode").analyze();
    expect(axe.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }

  await mode.getByRole("radio", { name: /No key: match whole rows/ }).check();
  await mode.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(mode.getByText("Matched on whole rows")).toBeVisible();

  await mode.getByRole("button", { name: "Exit compare" }).click();
  await expect(page.locator(".count").first()).toContainText("4 rows");
});

test("a workbook is explained, not misread", async ({ page }) => {
  await loadA(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles({ name: "after.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("PK") });
  await expect(page.getByRole("alert")).toContainText("save the sheet as CSV");
});
