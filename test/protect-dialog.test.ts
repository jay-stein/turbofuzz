import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openProtectDialog } from "../src/ui/protect-dialog.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const doc = (): Window["document"] => (globalThis as Record<string, unknown>).document as Window["document"];

test("mask dialog previews before and after, counts the cells and returns the op", async () => {
  const window = setupDom();
  const result = openProtectDialog({
    name: "email",
    mode: "mask",
    samples: ["jane@example.com", "0412345678", "", "bob@site.org"],
    affected: 1240,
  });
  await tick();
  const rows = [...doc().querySelectorAll(".protect-row")].map((row) => row.textContent);
  assert.equal(rows.length, 1 + 3, "header plus the three non-empty samples");
  assert.match(rows[1] ?? "", /j\*\*\*@example\.com/);
  assert.match(doc().querySelector(".cast-summary")?.textContent ?? "", /1,240 non-empty cells/);

  const keep = doc().querySelector("input[aria-label='Characters to keep at the end']") as unknown as { value: string; dispatchEvent(e: unknown): void };
  keep.value = "4";
  keep.dispatchEvent(new window.Event("input"));
  (doc().querySelector(".protect-modal .primary") as unknown as { click(): void }).click();
  assert.deepEqual(await result, { kind: "mask", keepFirst: 1, keepLast: 4 });
});

test("hash dialog warns about low-entropy values and returns a salted op", async () => {
  setupDom();
  const result = openProtectDialog({
    name: "phone",
    mode: "hash",
    samples: ["0412345678"],
    affected: 10,
    newSalt: () => "salt1234",
  });
  await tick();
  assert.match(doc().body.textContent ?? "", /phone numbers, can still be re-identified/);
  const after = doc().querySelectorAll(".protect-row")[1]?.textContent ?? "";
  assert.match(after, /[0-9a-f]{16}$/);
  assert.ok(!after.includes("0412345678"), "the raw value is not shown");
  (doc().querySelector(".protect-modal .primary") as unknown as { click(): void }).click();
  assert.deepEqual(await result, { kind: "hash", salt: "salt1234" });
});

test("cancel changes nothing", async () => {
  setupDom();
  const result = openProtectDialog({ name: "x", mode: "mask", samples: [], affected: 0 });
  await tick();
  (doc().querySelector(".protect-modal .ghost") as unknown as { click(): void }).click();
  assert.equal(await result, null);
});
