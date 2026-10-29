// Screenshots the Data Quality page for a messy customers file at several sizes/themes.
// Usage: npx vite build && npx tsx scripts/shoot-quality.ts <outDir>
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "shots";
mkdirSync(outDir, { recursive: true });

function messyCustomers(): string {
  const statuses = ["ACTIVE", "active", "Active", "inactive", "Inactive", "pending", "N/A", "-"];
  const cities = ["Sydney", "sydney", "SYDNEY", "Melbourne", "Perth", "Hobart"];
  const lines = ["customer_id,full_name,email,phone,status,city,signup_date,age,balance"];
  for (let i = 0; i < 1240; i++) {
    const email = i % 14 === 0 ? "" : i % 24 === 0 ? `bad@@host${i}.com` : `user${i}@example.com`;
    const date = i % 3 === 0 ? `${(i % 28) + 1}/${(i % 12) + 1}/2023` : `2023-0${(i % 9) + 1}-${10 + (i % 18)}`;
    const age = i % 80 === 0 ? 999 : i % 57 === 0 ? "" : 18 + (i % 60);
    const balance = i % 22 === 0 ? `$${1000 + i}` : i % 9 === 0 ? "" : (100 + (i % 977) * 1.5).toFixed(2);
    lines.push(
      [`C${100000 + i}`, `Ann Person${i % 400}`, email, `04${String(10000000 + i * 13).slice(0, 8)}`, statuses[(i * 7) % statuses.length], cities[(i * 5) % cities.length], date, age, balance].join(","),
    );
  }
  return lines.join("\n");
}

const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "4179"], { shell: true, stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 3000));
const browser = await chromium.launch();
try {
  for (const [name, width, height, scheme] of [
    ["1440-light", 1440, 900, "light"],
    ["1440-tall", 1440, 2400, "light"],
    ["1440-dark", 1440, 900, "dark"],
    ["1024-light", 1024, 768, "light"],
    ["390-light", 390, 844, "light"],
    ["390-dark", 390, 844, "dark"],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") console.log("console error:", m.text()); });
    page.on("pageerror", (e) => console.log("page error:", e.message));
    await page.goto("http://127.0.0.1:4179/");
    await page.locator('input[type="file"]').setInputFiles({
      name: "customers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(messyCustomers()),
    });
    await page.locator(".workspace").waitFor({ timeout: 30000 });
    await page.getByRole("tab", { name: "Data Quality" }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false });
    await page.screenshot({ path: join(outDir, `${name}-full.png`), fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
