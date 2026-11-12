import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { Hints, markHintSeen, readSeenHints } from "../src/ui/hints.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.localStorage = window.localStorage;
  return window;
}

test("hint storage failure does not throw", () => {
  setupDom();
  const globals = globalThis as Record<string, unknown>;
  globals.localStorage = {
    getItem(): string | null {
      throw new Error("storage blocked");
    },
    setItem(): void {
      throw new Error("storage blocked");
    },
  };
  assert.equal(readSeenHints().size, 0);
  markHintSeen("tabs");
});

test("a hint shows once, then stays dismissed", () => {
  const window = setupDom();
  const document = window.document;
  const target = document.createElement("button");
  document.body.append(target);
  const rect = {
    x: 10,
    y: 10,
    top: 10,
    left: 10,
    right: 110,
    bottom: 30,
    width: 100,
    height: 20,
    toJSON: () => ({}),
  };
  target.getBoundingClientRect = (() => rect) as unknown as typeof target.getBoundingClientRect;

  const hints = new Hints([
    { id: "tabs", text: "Switch lenses", target: () => target as unknown as HTMLElement },
  ]);
  hints.refresh();
  const callout = document.querySelector(".hint-callout");
  assert.ok(callout !== null, "the hint is anchored");
  assert.match(callout.textContent ?? "", /Switch lenses/);
  assert.ok(readSeenHints().size === 0, "nothing is marked seen before dismissal");

  (callout.querySelector(".hint-callout-close") as unknown as { click(): void }).click();
  assert.equal(document.querySelector(".hint-callout"), null);
  assert.ok(readSeenHints().has("tabs"));

  hints.refresh();
  assert.equal(document.querySelector(".hint-callout"), null, "never shown twice");
  hints.dispose();
});

test("a hidden or missing target defers the hint", () => {
  const window = setupDom();
  const document = window.document;
  const hidden = document.createElement("button");
  hidden.classList.add("hidden");
  document.body.append(hidden);
  const hiddenRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  };
  hidden.getBoundingClientRect = (() =>
    hiddenRect) as unknown as typeof hidden.getBoundingClientRect;

  const hints = new Hints([
    { id: "one", text: "First", target: () => null },
    { id: "two", text: "Second", target: () => hidden as unknown as HTMLElement },
  ]);
  hints.refresh();
  assert.equal(document.querySelector(".hint-callout"), null);
  hints.dispose();
});

test("a hint that times out goes without bringing the next one in", () => {
  const window = setupDom();
  const document = window.document;
  const target = document.createElement("button");
  document.body.append(target);
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 50, bottom: 20, width: 50, height: 20, toJSON: () => ({}) };
  target.getBoundingClientRect = (() => rect) as unknown as typeof target.getBoundingClientRect;
  const pending: Array<{ fn: () => void; ms: number }> = [];
  (window as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void, ms: number) => pending.push({ fn, ms });
  const hints = new Hints([
    { id: "a", text: "First", target: () => target as unknown as HTMLElement },
    { id: "b", text: "Second", target: () => target as unknown as HTMLElement },
  ]);
  hints.refresh();
  assert.match(document.querySelector(".hint-callout")?.textContent ?? "", /First/);
  assert.ok(pending[0]!.ms <= 6000, "a hint goes within a few seconds");
  pending[0]!.fn();
  assert.equal(document.querySelector(".hint-callout"), null, "the next hint waits");
  hints.refresh();
  assert.match(document.querySelector(".hint-callout")?.textContent ?? "", /Second/);
  hints.dispose();
});
