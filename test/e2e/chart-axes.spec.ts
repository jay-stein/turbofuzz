import { expect, test, type Page } from "@playwright/test";

/** Three years of daily sales in four regions, with a price. */
function sales(): string {
  const lines = ["date,region,sales,price"];
  for (let d = 0; d < 3 * 365; d++) {
    const when = new Date(Date.UTC(2021, 0, 1) + d * 86_400_000).toISOString().slice(0, 10);
    for (let r = 0; r < 4; r++) lines.push(`${when},R${r},${100 + ((d * 7 + r * 13) % 50)},${(1 + ((d * 3 + r) % 17) / 10).toFixed(2)}`);
  }
  return lines.join("\n");
}

/** Every label the chart draws on its canvas, read as it draws. */
const TEXT_LOG = (): void => {
  const proto = CanvasRenderingContext2D.prototype;
  const fill = proto.fillText;
  const logs = new WeakMap<HTMLCanvasElement, string[]>();
  const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")!;
  Object.defineProperty(HTMLCanvasElement.prototype, "width", {
    ...width,
    set(value: number) {
      logs.set(this as HTMLCanvasElement, []);
      width.set!.call(this, value);
    },
  });
  proto.fillText = function (text: string, x: number, y: number, maxWidth?: number) {
    const list = logs.get(this.canvas) ?? [];
    list.push(String(text));
    logs.set(this.canvas, list);
    return fill.call(this, text, x, y, maxWidth);
  };
  (window as unknown as { __texts: (canvas: HTMLCanvasElement) => string[] }).__texts = (canvas) => logs.get(canvas) ?? [];
};

async function chart(page: Page, fields: string[], type: string): Promise<void> {
  await page.addInitScript(TEXT_LOG);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(sales()) });
  await page.locator(".nav-row").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".view-tabs button", { hasText: "Chart" }).click();
  await page.locator(".chart-add-panel").waitFor();
  for (const name of fields) {
    await page.locator(".chart-add-field").filter({ has: page.locator(".chart-add-field-name", { hasText: new RegExp(`^${name}$`) }) }).click();
  }
  await page.locator(".chart-add-types > .chart-add-type-group").first().locator(".chart-add-type", { hasText: type }).first().click();
  await page.locator(".chart-card:not(.hidden) .chart-canvas").waitFor();
  await page.waitForTimeout(300);
}

const card = (page: Page) => page.locator(".chart-card:not(.hidden)");
const texts = (page: Page): Promise<string[]> =>
  card(page).locator("canvas.chart-canvas").evaluate((canvas) => (window as unknown as { __texts: (c: HTMLCanvasElement) => string[] }).__texts(canvas as HTMLCanvasElement));

async function openAxes(page: Page) {
  const axes = card(page).locator('.chart-side-group[data-group="axes"]');
  if (!(await axes.evaluate((node) => (node as HTMLDetailsElement).open))) await axes.locator("summary").click();
  return axes;
}

async function set(page: Page, label: string, value: string): Promise<void> {
  const box = card(page).locator(`.chart-axes [aria-label="${label}"]`);
  await box.fill(value);
  await box.press("Enter");
  await box.blur();
}

test("a line over dates: X dates, ticks every year in the chosen format, a Y range with a tick every 20, and Undo", async ({ page }) => {
  await chart(page, ["date", "sales"], "Line");
  const axes = await openAxes(page);
  await expect(axes.locator(".chart-axis-row:not(.hidden) .chart-axis-name")).toHaveText(["X axis", "Y axis"]);
  await expect(axes.locator('[aria-label="X axis minimum"]')).toHaveAttribute("type", "date");
  const rows = card(page).locator(".chart-data-drawer, .chart-data").filter({ hasText: "Data behind this chart" }).first();
  await expect(rows).toContainText("36 rows");

  await set(page, "X axis minimum", "2022-01-01");
  await set(page, "X axis maximum", "2022-12-31");
  // A year of months, from three years.
  await expect(rows).toContainText("12 rows");

  await axes.locator('[aria-label="X axis tick unit"]').selectOption("quarter");
  await axes.locator('[aria-label="X axis date labels"]').selectOption("isoMonth");
  await expect.poll(async () => (await texts(page)).filter((text) => /^2022-(01|04|07|10)$/.test(text)).sort()).toEqual(["2022-01", "2022-04", "2022-07", "2022-10"]);

  await set(page, "Y axis minimum", "100");
  await set(page, "Y axis maximum", "200");
  await set(page, "A tick on the Y axis every", "20");
  await expect.poll(async () => (await texts(page)).filter((text) => /^(100|120|140|160|180|200)$/.test(text))).toEqual(["100", "120", "140", "160", "180", "200"]);

  // A max under the min is refused, and says why.
  await set(page, "Y axis maximum", "50");
  await expect(axes.locator(".chart-axis-status")).toContainText("Y max must be above Y min");
  await set(page, "Y axis maximum", "200");
  await expect(axes.locator(".chart-axis-status")).toHaveText("");

  await card(page).getByRole("button", { name: "Undo the last change to this chart" }).click();
  await expect(axes.locator('[aria-label="A tick on the Y axis every"]')).toHaveValue("");
  await axes.getByRole("button", { name: "Reset axes" }).click();
  await expect(rows).toContainText("36 rows");
  await expect(axes.locator('[aria-label="X axis minimum"]')).toHaveValue("");
});

test("a scatter takes a number range on both axes, and its ticks every N", async ({ page }) => {
  await chart(page, ["sales", "price"], "Scatter");
  const axes = await openAxes(page);
  await expect(axes.locator('[aria-label="X axis minimum"]')).toHaveAttribute("type", "number");
  await set(page, "X axis minimum", "110");
  await set(page, "X axis maximum", "130");
  await set(page, "A tick on the X axis every", "5");
  await expect.poll(async () => (await texts(page)).filter((text) => /^1[123]\d$/.test(text))).toEqual(["110", "115", "120", "125", "130"]);
});
