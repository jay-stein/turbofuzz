import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { RESEARCH_VIEWS, VIEW_ORDER, ViewTabs, viewSwitchHint, type ViewId } from "../src/ui/view-tabs.js";

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
    "table",
    "overview",
    "quality",
    "views",
    "chart",
    "timeseries",
    "map",
    "outliers",
    "relationships",
  ]);
  assert.equal(viewSwitchHint(), `switch anytime with 1–${VIEW_ORDER.length}`);
});

test("the research tools are Time Series, Map, Outliers and Relationships, last on the bar", () => {
  assert.deepEqual(RESEARCH_VIEWS, ["timeseries", "map", "outliers", "relationships"]);
  assert.deepEqual(VIEW_ORDER.slice(-RESEARCH_VIEWS.length), RESEARCH_VIEWS);
});

test("every tab is always on the bar; the research ones sit in the green lane and say so on hover", () => {
  const window = setupDom();
  const root = window.document.createElement("div") as unknown as HTMLElement;
  const picked: ViewId[] = [];
  const tabs = new ViewTabs(root, { onChange: (view) => picked.push(view) });
  const lane = root.querySelector(".view-tabs-research")!;
  assert.equal(lane.querySelectorAll("button").length, RESEARCH_VIEWS.length);
  assert.ok(!lane.classList.contains("hidden"));
  assert.deepEqual(tabs.visibleViews(), VIEW_ORDER);
  for (const button of lane.querySelectorAll("button")) assert.match(button.getAttribute("title") ?? "", /^Research · /);
  // ArrowRight from Chart moves on into the research lane.
  tabs.setSelected("chart");
  root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }) as unknown as Event);
  assert.deepEqual(picked, ["timeseries"]);
});
