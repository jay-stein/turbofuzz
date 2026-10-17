# Minimum Viable Playwright Smoke Test — Implementation Plan

> Status: Plan only. No Playwright test, dependency, configuration, or application change has been implemented.

No files were modified during reconnaissance. Repository evidence unless marked **assumption**.

## 1. Local runtime

TurboFuzz is a static Vite app with no backend or runtime configuration. It can run locally.

| Purpose | Command |
|---|---|
| Development server | `npm run dev` |
| Fixed port for Playwright | `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort` |
| Production-like assets | `npm run build && npm run preview -- --host 127.0.0.1 --port 4174 --strictPort` |

Evidence: `package.json:8-19`, `vite.config.ts`, `wrangler.jsonc`. Node is 24.13.0; README requires Node 22+.

Use the **dev server** for the first smoke test. Use **preview** later if testing the built worker bundle is important. `vite preview` does not serve `public/_headers`, so production CSP behaviour is only exercised on the deployed Cloudflare site.

## 2. Playwright status

- **Not installed as a Node project dependency.** No `@playwright/test`, config, spec, or `test:e2e` script exists.
- A global **Python Playwright 1.63.0** install and Chromium builds exist on this machine, but they are not reproducible for the project or CI.
- Recommend adding `@playwright/test` as a **devDependency** during implementation:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- Add a future script: `"test:e2e": "playwright test"`.
- No application dependency or production bundle change is needed.

## 3. Minimal test

Proposed file: `test/e2e/smoke.spec.ts`.

Synthetic CSV:

```csv
name,amount
Alice,10
Bob,20
Cara,30
```

Test outline:

```ts
import { test, expect } from "@playwright/test";

test("loads a small CSV and shows columns and rows", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Clean and reshape tables in your browser" }),
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "smoke.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,amount\nAlice,10\nBob,20\nCara,30\n"),
  });

  await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".meta")).toContainText("smoke.csv");

  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.locator(".table-host")).toBeVisible();
  await expect(page.locator(".th-label")).toHaveText(["name", "amount"]);

  const rows = page.locator(".table-rows .tr");
  await expect(rows).toHaveCount(3);

  // .td[0] is the row-index cell; data columns start at .td[1].
  await expect(rows.nth(0).locator(".td").nth(1)).toHaveText("Alice");
  await expect(rows.nth(0).locator(".td").nth(2)).toHaveText("10");
  await expect(rows.nth(2).locator(".td").nth(1)).toHaveText("Cara");
  await expect(rows.nth(2).locator(".td").nth(2)).toHaveText("30");

  const screenshot = testInfo.outputPath("turbofuzz-smoke-table.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("table screenshot", {
    path: screenshot,
    contentType: "image/png",
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
```

This is **source-verified** for selectors and flow. Whether the hidden file input accepts `setInputFiles`, how quickly the workspace appears, and whether row cells are populated with the expected text require **browser verification**.

## 4. Waiting without sleeps

Use UI state, not arbitrary timeouts:

1. `setInputFiles` triggers the existing `change` handler (`src/ui/app.ts:665-667`).
2. Wait for `.workspace` to become visible. `openWorkspace()` hides the paste view and reveals the workspace only after the worker's load promise resolves (`src/ui/app.ts:1074-1075`, `1740-1741`).
3. Wait for `.meta` to contain the file name/row count.
4. Click the ARIA `Table` tab and wait for `.table-host`.
5. Wait for `.th-label` column names.
6. Wait for `.table-rows .tr` count and cell text using Playwright's auto-retrying assertions.

The table requests rows asynchronously via `client.getRows(...)` (`src/ui/app.ts:1824-1830`); waiting on the actual cell text handles that without coupling to worker message timing. Do not use `waitForTimeout`.

## 5. Console and page errors

Attach listeners **before** `page.goto`:

```ts
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));
```

Assert both arrays are empty at the end. The app source currently has no `console.error`/`warn` calls, so strict emptiness is reasonable. If the first real run reveals a benign browser message, allowlist it explicitly rather than dropping the check. Optionally add `page.on("requestfailed", ...)` later; not needed for the minimum test.

## 6. Local and deployed runs

Proposed `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

Commands:

```powershell
# Local, with Playwright starting Vite
npx playwright test test/e2e/smoke.spec.ts

# Deployed app, no local web server
$env:PLAYWRIGHT_BASE_URL = "https://turbofuzz.mrjaystein.workers.dev"
npx playwright test test/e2e/smoke.spec.ts

# Optional production-like local build
npm run build
npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:4174"
npx playwright test test/e2e/smoke.spec.ts
```

The deployed URL returned **HTTP 200** with no Cloudflare Access redirect. It serves the expected security headers, including `connect-src 'none'`, `worker-src 'self'`, and COOP/COEP. Playwright's own CDP connection is outside page CSP, so it should not be blocked. **Assumption requiring browser verification:** Cloudflare bot protection may treat automated browsers differently from the HEAD request.

The deployed site is whatever build is currently published; it is not necessarily the current working tree. Use local preview when validating uncommitted source changes.

## 7. Obstacles and selector notes

- **Hidden file input:** the repository has one `input[type="file"]` inside the start card (`src/ui/app.ts:652-687`). `setInputFiles` normally works on hidden inputs; if it fails, use `page.waitForEvent("filechooser")` with a click on `.dropzone`.
- **No stable test IDs:** the app has no `data-testid` attributes. The test uses roles/headings where possible and internal classes (`.workspace`, `.meta`, `.th-label`, `.table-rows`, `.td`) for table state.
- **Table indexing:** `.td[0]` is the row-index cell, so `name` is `.td[1]` and `amount` is `.td[2]`.
- **Virtualization:** only visible rows render. A 3-row fixture keeps all rows visible; assertions should still auto-retry because the first paint may be skeleton rows.
- **Default view:** a fresh context starts in Overview. The test explicitly clicks the `Table` tab; do not assume Table is the initial lens.
- **No route/loading event:** completion is signalled by workspace visibility and table content, not a URL change.
- **Screenshot output:** use `testInfo.outputPath()` under `test-results/`. Add `test-results/` and `playwright-report/` to `.gitignore` during implementation. This is an artifact, not visual regression.
- **Local vs deployed headers:** `npm run dev` and `npm run preview` do not apply Cloudflare `_headers`; only the deployed site exercises production CSP/COEP.
- **Cloudflare:** the live site is publicly reachable now, but automation policy could change. If a challenge appears, keep CI on local preview and run deployed checks manually.

## Proposed implementation footprint (later)

Only these additions would be needed:

1. `test/e2e/smoke.spec.ts`
2. `playwright.config.ts`
3. `package.json` — devDependency and `test:e2e` script
4. `.gitignore` — Playwright output directories

No app code, UI changes, dependency upgrades, or visual-diff infrastructure.
