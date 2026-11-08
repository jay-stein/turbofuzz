import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { zipSync } from "fflate";
import { buildXlsx } from "../../src/ui/xlsx-writer.js";

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
  await mode.getByRole("button", { name: "Report", exact: true }).click();
  await expect(mode.getByRole("heading", { name: "What changed" })).toBeVisible();
  await expect(mode.locator(".cmp-tile-value")).toHaveText(["1", "2", "1", "1", "4 → 4"]);
  await expect(mode.locator(".cmp-change-name")).toHaveText(["full_name", "amount"]);
  await expect(mode.locator(".cmp-schema-row")).toHaveText(["Addednew", "Removedold", "Renamedname → full_name"]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const axe = await new AxeBuilder({ page }).include(".compare-mode").analyze();
    expect(axe.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }

  // Exit clears both datasets: back to the start screen.
  await mode.getByRole("button", { name: "Exit compare" }).click();
  await expect(mode).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Compare two datasets…" })).toBeVisible();
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
  await mode.getByRole("button", { name: "Report", exact: true }).click();
  await expect(mode.getByText("Matched on whole rows")).toBeVisible();

  await mode.getByRole("button", { name: "Exit compare" }).click();
  await expect(page.getByRole("button", { name: "Compare two datasets…" })).toBeVisible();
});

test("B can be a workbook: the worksheets are asked, and the chosen one is compared", async ({ page }) => {
  await loadA(page);
  const bytes = await buildXlsx([
    { name: "Contents", headers: ["About"], rows: [["after file"]] },
    { name: "Data", headers: ["id", "full_name", "amount", "Region", "new"], rows: [["1", "Ada", "10", "North", "p"], ["3", "Grace", "31", "East", "q"], ["4", "Edsger W.", "40", "West", "r"], ["5", "Barbara", "50", "North", "s"]] },
  ]);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles({ name: "after.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });
  const picker = page.getByRole("group", { name: "Worksheets" });
  await page.getByRole("button", { name: "None" }).click();
  await picker.getByLabel("Data", { exact: true }).check();
  await page.locator(".sheet-go").click();
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await expect(mode.locator(".cmp-side-b")).toContainText("after — Data");
  await expect(mode.locator(".cmp-side-b")).toContainText("4 rows");
});

test("Append from a zip with one workbook inside: pick the sheets, rows stack under the data", async ({ page }) => {
  await loadA(page);
  const book = await buildXlsx([{ name: "Jan", headers: ["id", "name", "amount"], rows: [["9", "Zed", "5"]] }]);
  const zip = Buffer.from(zipSync({ "extra/jan.xlsx": book }));
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Append rows from a file…" }).click();
  await (await chooser).setFiles({ name: "more.zip", mimeType: "application/zip", buffer: zip });
  await expect(page.locator(".count").first()).toContainText("5 rows");
});

test("Load more → Append rows stacks a file under the data, columns lined up by name, with _input_filename", async ({ page }) => {
  await loadA(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Append rows from a file…" }).click();
  await (await chooser).setFiles(file("after.csv", B));
  await expect(page.locator(".count").first()).toContainText("8 rows");
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator(".table-header .th-label")).toHaveText(["id", "name", "amount", "region", "old", "full_name", "new", "_input_filename"]);
  const column = (index: number) => page.locator(`.tr .td[data-col="${index}"]`).allInnerTexts();
  await expect.poll(() => column(7)).toEqual(["before.csv", "before.csv", "before.csv", "before.csv", "after.csv", "after.csv", "after.csv", "after.csv"]);
  await expect.poll(() => column(3)).toEqual(["North", "South", "East", "West", "North", "East", "West", "North"]);
});

test("two files dropped on the empty compare screen fill both sides, the earlier name as A", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Compare two datasets…" }).click();
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await expect(mode.getByText("Drop the before file here")).toBeVisible();
  await expect(mode.getByText("Drop the after file here")).toBeVisible();
  const drop = await page.evaluateHandle(([a, b]) => {
    const data = new DataTransfer();
    data.items.add(new File([b], "orders_2026-10.csv", { type: "text/csv" }));
    data.items.add(new File([a], "orders_2026-09.csv", { type: "text/csv" }));
    return data;
  }, [A, B]);
  await mode.locator(".cmp-page").dispatchEvent("drop", { dataTransfer: drop });
  await expect(mode.locator(".cmp-side-a")).toContainText("orders_2026-09.csv");
  await expect(mode.locator(".cmp-side-b")).toContainText("orders_2026-10.csv");
  await expect(mode.getByRole("button", { name: "Compare", exact: true })).toBeVisible();
});

test("side by side: counts open their rows, the panes line up with gaps, n finds differences, and one grid shows old under new", async ({ page }) => {
  await loadA(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles(file("after.csv", B));
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await mode.getByRole("button", { name: "Compare", exact: true }).click();

  // The app behind compare mode is inert: its controls cannot take focus.
  const stats = page.locator(".stats-report-button");
  expect(await stats.evaluate((node) => node.closest("[inert]") !== null)).toBe(true);
  expect(await stats.evaluate((node) => { (node as HTMLElement).focus(); return document.activeElement === node; })).toBe(false);

  const ids = (side: "a" | "b") => mode.locator(`.cmp-pane.cmp-side-${side} .cmp-row`).evaluateAll((rows) => rows.map((row) => (row.classList.contains("gap") ? "gap" : row.children[1]?.textContent ?? "")));
  // The tab opens on Differences: every row that is not identical (2 only in A, 3 changed, 5 only in B).
  await mode.getByRole("button", { name: "Spot the difference" }).click();
  await expect(mode.getByRole("button", { name: /^Differences/ })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => ids("a")).toEqual(["2", "3", "gap"]);
  await expect.poll(() => ids("b")).toEqual(["gap", "3", "5"]);
  await mode.getByRole("button", { name: "Report", exact: true }).click();

  // The Rows tile opens every aligned row: 1/1, 2/gap, 3/2, 4/3, gap/5.
  await mode.locator(".cmp-tile.rows").click();
  await expect(mode.getByRole("button", { name: "Spot the difference" })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => ids("a")).toEqual(["1", "2", "3", "4", "gap"]);
  await expect.poll(() => ids("b")).toEqual(["1", "gap", "3", "4", "5"]);
  await expect(mode.locator(".cmp-pane.cmp-side-b .cmp-cell.diff")).toHaveText(["31"]);

  // n goes to the first difference (row 2, only in A), then the next (row 3, changed).
  await page.keyboard.press("n");
  await expect(mode.locator(".cmp-position")).toHaveText("row 2 of 5");
  await page.keyboard.press("n");
  await expect(mode.locator(".cmp-position")).toHaveText("row 3 of 5");

  await mode.getByRole("button", { name: /^Only in B/ }).click();
  await expect.poll(() => ids("b")).toEqual(["5"]);

  await mode.getByRole("button", { name: /^Changed/ }).click();
  await mode.getByRole("button", { name: "One grid" }).click();
  await expect(mode.locator(".cmp-cell.diff .cmp-cell-main")).toHaveText(["31"]);
  await expect(mode.locator(".cmp-cell.diff .cmp-cell-old")).toHaveText(["30"]);

  // A column in the report opens the rows where it changed.
  await mode.getByRole("button", { name: "Report", exact: true }).click();
  await mode.getByRole("button", { name: "amount", exact: true }).click();
  await expect(mode.getByRole("group", { name: "Changed in" }).getByRole("button", { name: /^amount/ })).toHaveAttribute("aria-pressed", "true");
  await expect(mode.locator(".cmp-rows-status")).toHaveText("Rows 1–1 of 1");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const axe = await new AxeBuilder({ page }).include(".compare-mode").analyze();
    expect(axe.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
  await mode.getByRole("button", { name: "Exit compare" }).click();
  await expect.poll(() => stats.evaluate((node) => node.closest("[inert]") !== null)).toBe(false);
});

test("what shifted: no key needed, columns ranked by how far they moved, and a measure per group", async ({ page }) => {
  const survey = (year: number): string => {
    const lines = ["region,score,channel,household"];
    for (let i = 0; i < 80; i++) {
      const region = year === 2025 ? ["North", "South"][i % 2] : i % 4 === 0 ? "South" : "North";
      const score = year === 2025 ? 50 + (i % 10) : (region === "North" ? 70 : 50) + (i % 10);
      const channel = year === 2025 ? ["Web", "Phone"][i % 2] : ["Web", "App"][i % 2];
      lines.push(`${region},${score},${channel},${["1", "2", "3"][i % 3]}`);
    }
    return lines.join("\n");
  };
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Compare two datasets…" }).click();
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await mode.getByLabel("Choose the file for A").setInputFiles(file("survey_2025.csv", survey(2025)));
  await expect(mode.locator(".cmp-side-a")).toContainText("80 rows");
  await mode.getByLabel("Choose the file for B").setInputFiles(file("survey_2026.csv", survey(2026)));
  await expect(mode.getByRole("radio", { name: /No key: match whole rows/ })).toBeChecked();
  await mode.getByRole("button", { name: "Compare", exact: true }).click();
  await mode.getByRole("button", { name: "Big Picture" }).click();

  await expect(mode.getByRole("heading", { name: "Big Picture" })).toBeVisible();
  await expect(mode.locator(".cmp-shift-page > .cmp-shift .cmp-shift-name")).toHaveText(["score", "channel", "region"]);
  await expect(mode.locator(".cmp-still summary")).toContainText("household");
  await expect(mode.locator(".cmp-shift", { hasText: "channel" }).first()).toContainText("New in B: App (40)");

  await mode.getByLabel("Group by").selectOption({ label: "region" });
  await mode.getByLabel("Measure").selectOption({ label: "score" });
  const north = mode.locator(".cmp-group-table tbody tr", { hasText: "North" });
  await expect(north).toContainText("54n 40");
  await expect(north).toContainText("74.67n 60");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const axe = await new AxeBuilder({ page }).include(".compare-mode").analyze();
    expect(axe.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
});

test("Export saves the HTML report, the changes as CSV and a workbook with every table", async ({ page }) => {
  await loadA(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles(file("after.csv", B));
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await mode.getByRole("button", { name: "Compare", exact: true }).click();
  const save = async (label: string) => {
    const wait = page.waitForEvent("download");
    await mode.getByRole("button", { name: "Export ▾" }).click();
    await page.getByRole("menuitem", { name: label }).click();
    const download = await wait;
    const path = await download.path();
    return { name: download.suggestedFilename(), bytes: (await import("node:fs")).readFileSync(path!) };
  };
  const html = await save("Report (HTML page)");
  expect(html.name).toBe("compare_before_vs_after_report.html");
  expect(html.bytes.toString("utf8")).toContain("<h1>before.csv → after.csv</h1>");
  const csv = await save("Changes (CSV)");
  expect(csv.name).toBe("compare_before_vs_after_changes.csv");
  expect(csv.bytes.toString("utf8").replace(/^﻿/, "").split("\r\n").slice(0, 4)).toEqual([
    "id,A row,B row,status,column,value in A,value in B",
    "2,2,,only in A,,,",
    "3,3,2,changed,amount,30,31",
    "5,,4,only in B,,,",
  ]);
  const xlsx = await save("Changes and rows (Excel)");
  expect(xlsx.name).toBe("compare_before_vs_after.xlsx");
  expect(xlsx.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
});

test("leaving compare asks first when the data had Recipe steps, then clears both datasets", async ({ page }) => {
  await loadA(page);
  await page.getByRole("tab", { name: "Table" }).click();
  await page.locator(".table-header .th-label", { hasText: "name" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Change case" }).click();
  await page.getByRole("menuitem", { name: "UPPERCASE" }).click();
  await expect(page.locator(".tr .td[data-col=\"1\"]").first()).toHaveText("ADA");
  await expect(page.locator(".nav-actions button", { hasText: /^Recipe/ })).toHaveText(/Recipe \(1\)/);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles(file("after.csv", B));
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await expect(mode.locator(".cmp-key").first()).toBeVisible();

  await mode.getByRole("button", { name: "Exit compare" }).click();
  const confirm = page.getByRole("dialog", { name: "Exit compare and clear the data?" });
  await expect(confirm).toContainText("1 Recipe step");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(mode).toBeVisible();

  await mode.getByRole("button", { name: "Exit compare" }).click();
  await page.getByRole("button", { name: "Exit and clear" }).click();
  await expect(mode).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Compare two datasets…" })).toBeVisible();
});

test("Changed in: column chips narrow the changed rows to the columns ticked", async ({ page }) => {
  const a = ["id,amount,status,city", "1,10,open,Oslo", "2,20,open,Rome", "3,30,open,Lima", "4,40,open,Pune"].join("\n");
  const b = ["id,amount,status,city", "1,11,open,Oslo", "2,20,shut,Rome", "3,30,open,Kiev", "4,41,shut,Pune"].join("\n");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(file("a.csv", a));
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles(file("b.csv", b));
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await mode.getByRole("button", { name: "Compare", exact: true }).click();
  await mode.getByRole("button", { name: "Spot the difference" }).click();
  const ids = () => mode.locator(".cmp-pane.cmp-side-a .cmp-row").evaluateAll((rows) => rows.map((row) => row.children[1]?.textContent ?? ""));
  await expect.poll(ids).toEqual(["1", "2", "3", "4"]);

  const chips = mode.getByRole("group", { name: "Changed in" });
  await chips.getByRole("button", { name: /^amount/ }).click();
  await expect.poll(ids).toEqual(["1", "4"]);
  await chips.getByRole("button", { name: /^status/ }).click();
  await expect.poll(ids).toEqual(["1", "2", "4"]);
  await expect(mode.locator(".cmp-rows-status")).toHaveText("Rows 1–3 of 3");
  await chips.getByRole("button", { name: "Any column" }).click();
  await expect.poll(ids).toEqual(["1", "2", "3", "4"]);
});

test("columns can be ignored: a row-number column differing everywhere stops mattering, and it can be put back", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  const before = ["n,name,amount", "1,Ada,10", "2,Alan,20", "3,Grace,30"].join("\n");
  const after = ["n,name,amount", "7,Ada,10", "8,Alan,20", "9,Grace,30"].join("\n");
  await page.locator('input[type="file"]').first().setInputFiles(file("before.csv", before));
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles(file("after.csv", after));
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  // Every column starts ticked; unticking n leaves it in the list, dimmed, and ticking it again brings it back.
  for (const name of ["n", "name", "amount"]) await expect(mode.getByRole("checkbox", { name: `Compare ${name}`, exact: true })).toBeChecked();
  await mode.getByRole("checkbox", { name: "Compare n", exact: true }).uncheck();
  await expect(mode.getByRole("checkbox", { name: "Compare n", exact: true })).not.toBeChecked();
  await expect(mode.getByRole("checkbox", { name: "Compare name", exact: true })).toBeChecked();
  await expect(mode.getByRole("checkbox", { name: "Compare amount", exact: true })).toBeChecked();
  await expect(mode.locator(".cmp-off")).toContainText("Not compared");
  // With n left out the rows agree, and the report says what was ignored.
  await mode.getByRole("button", { name: "Compare", exact: true }).click();
  await mode.getByRole("button", { name: "Report", exact: true }).click();
  await expect(mode.getByRole("heading", { name: "What changed" })).toBeVisible();
  await expect(mode.locator(".cmp-change-name")).toHaveCount(0);
  await expect(mode.locator(".cmp-schema-row")).toHaveText(["Ignoredn"]);
  // Spot the difference still shows n, greyed and struck through, and never as a change.
  await mode.getByRole("button", { name: "Spot the difference" }).click();
  await mode.getByRole("button", { name: /^All/ }).click();
  await expect(mode.locator(".cmp-ignored-col").first()).toHaveText(/^n/);
  await expect(mode.locator(".cmp-cell.ignored").first()).toHaveCSS("text-decoration-line", "line-through");
  await expect(mode.locator(".cmp-cell.diff")).toHaveCount(0);
});

test("steps run setup, spot the difference, value differences, report, big picture; a column only A has is tinted on every row", async ({ page }) => {
  await loadA(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles(file("after.csv", B));
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  const steps = mode.getByRole("navigation", { name: "Comparison steps" });
  await expect(steps.locator(".cmp-step")).toHaveText([/Comparison setup/, /Spot the difference/, /Value differences/, /Report/, /Big Picture/]);
  await expect(steps.getByRole("button", { name: "Comparison setup" })).toHaveAttribute("aria-current", "page");
  // Nothing to show until Compare is pressed.
  await expect(steps.getByRole("button", { name: "Report" })).toHaveAttribute("aria-disabled", "true");
  await mode.getByRole("button", { name: "Compare", exact: true }).click();
  // The result opens on Spot the difference, the second step.
  await expect(steps.getByRole("button", { name: "Spot the difference" })).toHaveAttribute("aria-current", "page");
  await mode.getByRole("button", { name: /^All/ }).click();
  // "old" is only in A: tinted on the rows that are otherwise identical too.
  await expect(mode.locator(".cmp-cell.only-a").first()).toBeVisible();
  await expect(mode.locator(".cmp-only-col.only-a", { hasText: "old" }).first()).toBeVisible();
  // Back to setup and a change there makes the result steps wait for another Compare.
  await steps.getByRole("button", { name: "Comparison setup" }).click();
  await mode.getByRole("checkbox", { name: "Compare amount", exact: true }).uncheck();
  await expect(steps.getByRole("button", { name: "Report" })).toHaveAttribute("aria-disabled", "true");
});

test("matching on row position, then Value differences: B minus A, % change, and a cool-warm colour that is not A's red or B's green", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(file("before.csv", ["n,amount,qty", "1,100,10", "2,200,20", "3,400,40"].join("\n")));
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load more/ }).click();
  await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
  await (await chooser).setFiles(file("after.csv", ["n,amount,qty", "1,110,10", "2,150,25", "3,400,20"].join("\n")));
  const mode = page.getByRole("region", { name: "Compare two datasets" });
  await mode.getByRole("radio", { name: /Match rows on position/ }).check();
  await mode.getByRole("button", { name: "Compare", exact: true }).click();
  await mode.getByRole("button", { name: "Value differences" }).click();
  const cells = mode.locator(".cmp-vd-cell");
  // n, amount and qty are numbers on both sides: B - A by default.
  await expect(mode.locator(".cmp-vd-name")).toHaveText(["n", "amount", "qty"]);
  await expect(cells).toHaveText(["0", "+10", "0", "0", "−50", "+5", "0", "0", "−20"].map((t) => t.replace("−", "-")).map((t) => t));
  // Coloured from a diverging map: the rise is warm (red-ish), the fall cool (blue-ish).
  const rise = await cells.nth(1).evaluate((node) => getComputedStyle(node).backgroundColor);
  const fall = await cells.nth(4).evaluate((node) => getComputedStyle(node).backgroundColor);
  const [rr, , rb] = rise.match(/\d+/g)!.map(Number);
  const [fr, , fb] = fall.match(/\d+/g)!.map(Number);
  expect(rr!).toBeGreaterThan(rb!);
  expect(fb!).toBeGreaterThan(fr!);
  await mode.getByRole("combobox", { name: "Difference" }).selectOption({ label: "% change (B vs A)" });
  await expect(cells.nth(1)).toHaveText("+10%");
  await expect(cells.nth(4)).toHaveText("-25%");
  await mode.getByRole("combobox", { name: "Colour map" }).selectOption("none");
  await expect(cells.nth(1)).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("Deep dive: from a comparison, analyse A or B on its own with all the tools", async ({ page }) => {
  for (const side of ["A", "B"] as const) {
    await loadA(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /Load more/ }).click();
    await page.getByRole("menuitem", { name: "Compare with a file…" }).click();
    await (await chooser).setFiles(file("after.csv", B));
    const mode = page.getByRole("region", { name: "Compare two datasets" });
    await expect(mode.locator(".cmp-side-b")).toContainText("after.csv");
    await mode.getByRole("button", { name: "Deep dive" }).click();
    await page.getByRole("menuitem", { name: new RegExp(`^Analyse ${side}:`) }).click();
    await expect(mode).toHaveCount(0);
    await page.getByRole("tab", { name: "Table" }).click();
    // A has a column "old", B has "new": the dataset that opened is the one chosen, with the whole workspace.
    await expect.poll(() => page.locator(".table-header .th-label").allInnerTexts()).toContain(side === "A" ? "old" : "new");
    await expect(page.locator(".count").first()).toContainText("4 rows");
    await expect(page.locator("body")).not.toHaveClass(/compare-active/);
  }
});
