import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import * as XLSX from "xlsx";

const CSV = [
  "qty,price,day,active,postcode,note,name",
  ...Array.from({ length: 40 }, (_, i) =>
    [
      i + 1,
      `${i + 1}.25`,
      `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
      i % 2 === 0 ? "true" : "false",
      i === 0 ? "0800" : `0${801 + i}`,
      i === 0 ? "=1+1" : `note ${i}`,
      i === 0 ? "Zoë" : `Name ${i}`,
    ].join(","),
  ),
].join("\n");

test("Export as Excel writes typed cells, text ids and no formulas", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  // No save picker: the file arrives as an ordinary download.
  await page.addInitScript(() => {
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
  });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Export/ }).first().click();
  const dialog = page.locator(".export-modal");
  await dialog.locator("select[aria-label='Export format']").selectOption("xlsx");
  await expect(dialog.locator(".export-compression")).toBeHidden();
  await expect(dialog.locator(".export-preview")).toContainText(/\.xlsx$/);
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.locator(".primary").click()]);
  expect(download.suggestedFilename()).toMatch(/orders\.xlsx$/);

  const book = XLSX.read(readFileSync((await download.path())!), { type: "buffer", cellNF: true });
  expect(book.SheetNames).toEqual(["orders"]);
  const sheet = book.Sheets["orders"];
  expect(sheet["!ref"]).toBe("A1:G41");
  expect(sheet["A1"].v).toBe("qty");
  expect(sheet["B2"].t).toBe("n");
  expect(sheet["B2"].v).toBe(1.25);
  expect(sheet["C2"].t).toBe("n");
  expect(sheet["C2"].z).toBe("yyyy-mm-dd");
  expect(sheet["D2"].t).toBe("b");
  expect(sheet["E2"].t).toBe("s");
  expect(sheet["E2"].v).toBe("0800");
  expect(sheet["F2"].v).toBe("=1+1");
  expect(sheet["F2"].f).toBeUndefined();
  expect(sheet["G2"].v).toBe("Zoë");
});
