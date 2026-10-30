import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  GENERAL_VIEWS,
  RESEARCH_VIEWS,
  VIEW_ORDER,
  ViewTabs,
  isResearchView,
  viewSwitchHint,
  type ViewId,
} from "../src/ui/view-tabs.js";
import { ModeSwitch, readMode, writeMode, type AppMode } from "../src/ui/mode.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.localStorage = window.localStorage;
  return window;
}

test("the keyboard hint follows the number of registered tabs", () => {
  assert.equal(VIEW_ORDER.length, 9);
  assert.deepEqual(VIEW_ORDER, [
    "overview",
    "quality",
    "table",
    "views",
    "chart",
    "outliers",
    "relationships",
    "timeseries",
    "map",
  ]);
  assert.equal(viewSwitchHint(), `switch anytime with 1–${VIEW_ORDER.length}`);
  assert.equal(viewSwitchHint(GENERAL_VIEWS.length), "switch anytime with 1–5");
});

test("research views are exactly Outliers, Relationships, Time Series and Map", () => {
  assert.deepEqual(RESEARCH_VIEWS, ["outliers", "relationships", "timeseries", "map"]);
  for (const view of VIEW_ORDER) assert.equal(isResearchView(view), RESEARCH_VIEWS.includes(view));
  assert.deepEqual([...GENERAL_VIEWS, ...RESEARCH_VIEWS], VIEW_ORDER);
});

test("General mode hides the research lane and keyboard moves only over visible tabs", () => {
  const window = setupDom();
  const root = window.document.createElement("div") as unknown as HTMLElement;
  const picked: ViewId[] = [];
  const tabs = new ViewTabs(root, { onChange: (view) => picked.push(view) }, false);
  const lane = root.querySelector(".view-tabs-research")!;
  assert.equal(lane.querySelectorAll("button").length, RESEARCH_VIEWS.length);
  assert.ok(lane.classList.contains("hidden"));
  assert.deepEqual(tabs.visibleViews(), GENERAL_VIEWS);

  // ArrowRight from the last general tab wraps to Overview, never into the lane.
  tabs.setSelected("chart");
  root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }) as unknown as Event);
  assert.deepEqual(picked, ["overview"]);

  tabs.setResearch(true, true);
  assert.ok(!lane.classList.contains("hidden"));
  assert.ok(lane.classList.contains("entering"));
  assert.deepEqual(tabs.visibleViews(), VIEW_ORDER);
  tabs.setSelected("chart");
  root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }) as unknown as Event);
  assert.deepEqual(picked, ["overview", "outliers"]);
});

test("the mode is remembered, defaults to General and survives blocked storage", () => {
  setupDom();
  assert.equal(readMode(), "general");
  writeMode("research");
  assert.equal(readMode(), "research");
  localStorage.setItem("turbofuzz-mode", "bogus");
  assert.equal(readMode(), "general");

  const globals = globalThis as Record<string, unknown>;
  globals.localStorage = {
    getItem(): string | null {
      throw new Error("storage blocked");
    },
    setItem(): void {
      throw new Error("storage blocked");
    },
  };
  assert.equal(readMode(), "general");
  writeMode("research");
});

test("the mode switch is a radio group that reports the user's choice", () => {
  const window = setupDom();
  const changes: AppMode[] = [];
  const control = new ModeSwitch("general", { onChange: (mode) => changes.push(mode) });
  const root = control.element;
  assert.equal(root.getAttribute("role"), "radiogroup");
  const [general, research] = [...root.querySelectorAll<HTMLButtonElement>("[role=radio]")];
  assert.equal(general.getAttribute("aria-checked"), "true");
  assert.equal(research.tabIndex, -1);

  research.click();
  assert.deepEqual(changes, ["research"]);
  assert.equal(root.dataset.mode, "research");
  assert.equal(research.getAttribute("aria-checked"), "true");
  assert.equal(general.tabIndex, -1);

  // Clicking the checked option is not a change.
  research.click();
  assert.deepEqual(changes, ["research"]);

  root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft" }) as unknown as Event);
  assert.deepEqual(changes, ["research", "general"]);

  control.setSelected("research");
  assert.deepEqual(changes, ["research", "general"]);
  assert.equal(root.dataset.mode, "research");
});
