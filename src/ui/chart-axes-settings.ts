/**
 * The Axes section of a chart's settings: each axis's range, where its ticks go, and on a date
 * axis how often a tick comes and how it reads. Only the controls this chart's axes can use show;
 * blank is automatic. Changes apply when a box is left or Enter is pressed, and Undo takes them back.
 */
import type { ChartCard } from "./chart-card.js";
import { el } from "./dom.js";
import { DATE_FORMAT_LABELS, axesSet, type ChartAxes, type DateTickFormat, type DateTickUnit } from "./chart-axes.js";

interface AxesControls {
  root: HTMLElement;
  xRow: HTMLElement;
  yRow: HTMLElement;
  none: HTMLElement;
  xMin: HTMLInputElement;
  xMax: HTMLInputElement;
  xStep: HTMLInputElement;
  xEveryN: HTMLInputElement;
  xEveryUnit: HTMLSelectElement;
  xFormat: HTMLSelectElement;
  xNumberTicks: HTMLElement;
  xDateTicks: HTMLElement;
  yMin: HTMLInputElement;
  yMax: HTMLInputElement;
  yStep: HTMLInputElement;
  status: HTMLElement;
  /** Why the date ticks drawn differ from the ones asked for. */
  tickNote: HTMLElement;
  reset: HTMLButtonElement;
  /** Whether the X inputs are dates, as last drawn. */
  xDate: boolean;
}

const controls = new WeakMap<ChartCard, AxesControls>();

const UNITS: readonly [DateTickUnit | "auto", string][] = [
  ["auto", "Auto"],
  ["day", "days"],
  ["week", "weeks"],
  ["month", "months"],
  ["quarter", "quarters"],
  ["year", "years"],
];

function input(label: string, placeholder: string, type = "number"): HTMLInputElement {
  return el("input", { class: "text-input chart-axis-input", type, placeholder, "aria-label": label, title: label, step: "any" }) as HTMLInputElement;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el("label", { class: "chart-tag chart-axis-field" }, [el("span", { class: "chart-tag-label" }, [label]), control]);
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A box's value: a number, a date (as ms), blank (null), or undefined when it does not read. */
function readValue(box: HTMLInputElement, date: boolean): number | null | undefined {
  const text = box.value.trim();
  if (text === "") return null;
  if (date) {
    const ms = Date.parse(`${text}T00:00:00Z`);
    return Number.isFinite(ms) ? ms : undefined;
  }
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

export function buildAxesSettings(card: ChartCard): HTMLElement {
  const c: AxesControls = {
    root: el("div", { class: "chart-side-section chart-axes" }),
    xRow: el("div", { class: "chart-axis-row" }),
    yRow: el("div", { class: "chart-axis-row" }),
    none: el("p", { class: "chart-axis-none hidden" }, ["This chart has no axes to set."]),
    xMin: input("X axis minimum", "auto"),
    xMax: input("X axis maximum", "auto"),
    xStep: input("A tick on the X axis every", "auto"),
    xEveryN: input("A tick on the X axis every this many", "1"),
    xEveryUnit: el("select", { class: "chart-axis-select", "aria-label": "X axis tick unit" }) as HTMLSelectElement,
    xFormat: el("select", { class: "chart-axis-select", "aria-label": "X axis date labels" }) as HTMLSelectElement,
    xNumberTicks: el("div", { class: "chart-axis-ticks" }),
    xDateTicks: el("div", { class: "chart-axis-ticks" }),
    yMin: input("Y axis minimum", "auto"),
    yMax: input("Y axis maximum", "auto"),
    yStep: input("A tick on the Y axis every", "auto"),
    status: el("span", { class: "chart-axis-status", role: "status" }),
    tickNote: el("p", { class: "chart-axis-note hidden", role: "note" }),
    reset: el("button", { class: "ghost small chart-axis-reset", type: "button", title: "Put every axis back to automatic" }, ["Reset axes"]) as HTMLButtonElement,
    xDate: false,
  };
  c.xEveryN.min = "1";
  c.xEveryN.step = "1";
  c.xEveryN.classList.add("chart-axis-every");
  for (const [value, label] of UNITS) c.xEveryUnit.append(el("option", { value }, [label]));
  for (const [value, label] of Object.entries(DATE_FORMAT_LABELS)) c.xFormat.append(el("option", { value }, [label]));
  c.xNumberTicks.append(field("Tick every", c.xStep));
  c.xDateTicks.append(
    el("div", { class: "chart-tag chart-axis-field", role: "group", "aria-label": "X axis tick interval" }, [el("span", { class: "chart-tag-label" }, ["Tick every"]), c.xEveryN, c.xEveryUnit]),
    field("Labels", c.xFormat),
  );
  c.xRow.append(
    el("div", { class: "chart-axis-name" }, ["X axis"]),
    el("div", { class: "chart-axis-range" }, [field("Min", c.xMin), field("Max", c.xMax)]),
    c.xNumberTicks,
    c.xDateTicks,
    c.tickNote,
  );
  c.yRow.append(
    el("div", { class: "chart-axis-name" }, ["Y axis"]),
    el("div", { class: "chart-axis-range" }, [field("Min", c.yMin), field("Max", c.yMax)]),
    el("div", { class: "chart-axis-ticks" }, [field("Tick every", c.yStep)]),
  );
  c.root.append(c.xRow, c.yRow, c.none, el("div", { class: "chart-axis-foot" }, [c.reset, c.status]));
  controls.set(card, c);

  const apply = (): void => {
    const next: ChartAxes = {};
    const problems: string[] = [];
    const read = (box: HTMLInputElement, date: boolean, name: string): number | null => {
      const value = readValue(box, date);
      if (value === undefined) {
        problems.push(`${name} is not a ${date ? "date" : "number"}`);
        return null;
      }
      return value;
    };
    const xMin = read(c.xMin, c.xDate, "X min");
    const xMax = read(c.xMax, c.xDate, "X max");
    const yMin = read(c.yMin, false, "Y min");
    const yMax = read(c.yMax, false, "Y max");
    const xStep = c.xDate ? null : read(c.xStep, false, "X tick");
    const yStep = read(c.yStep, false, "Y tick");
    if (xMin !== null && xMax !== null && !(xMax > xMin)) problems.push("X max must be after X min");
    if (yMin !== null && yMax !== null && !(yMax > yMin)) problems.push("Y max must be above Y min");
    if ((xStep !== null && xStep <= 0) || (yStep !== null && yStep <= 0)) problems.push("A tick step must be above 0");
    if (xMin !== null) next.xMin = xMin;
    if (xMax !== null) next.xMax = xMax;
    if (yMin !== null) next.yMin = yMin;
    if (yMax !== null) next.yMax = yMax;
    if (xStep !== null && xStep > 0) next.xStep = xStep;
    if (yStep !== null && yStep > 0) next.yStep = yStep;
    // Date settings stay as they were while the X axis shows numbers, and the other way round.
    const before = card.config.axes ?? {};
    if (c.xDate) {
      const unit = c.xEveryUnit.value as DateTickUnit | "auto";
      const n = Math.max(1, Math.floor(Number(c.xEveryN.value) || 1));
      if (unit !== "auto") next.xEvery = { unit, n };
      if (c.xFormat.value !== "auto") next.xFormat = c.xFormat.value as DateTickFormat;
      if (before.xStep !== undefined && before.xStep !== null) next.xStep = before.xStep;
    } else {
      if (before.xEvery !== undefined && before.xEvery !== null) next.xEvery = before.xEvery;
      if (before.xFormat !== undefined) next.xFormat = before.xFormat;
    }
    c.status.textContent = problems.join(" · ");
    if (problems.length > 0) return;
    card.config.axes = axesSet(next) ? next : undefined;
    card.refreshBins();
    card.render();
  };
  for (const box of [c.xMin, c.xMax, c.xStep, c.xEveryN, c.yMin, c.yMax, c.yStep]) box.addEventListener("change", apply);
  c.xEveryUnit.addEventListener("change", apply);
  c.xFormat.addEventListener("change", apply);
  c.reset.addEventListener("click", () => {
    c.status.textContent = "";
    card.config.axes = undefined;
    card.refreshBins();
    card.render();
  });
  return c.root;
}

/** Shows the controls this chart's axes take, filled from its settings. Runs after each draw. */
export function syncAxesSettings(card: ChartCard): void {
  const c = controls.get(card);
  if (c === undefined) return;
  const axes = card.config.axes ?? {};
  const kind = card.config.kind;
  const xColumn = kind === "scatter" || kind === "bubble" || kind === "density" ? card.config.x : card.config.column;
  const xType = card.meta(xColumn)?.type;
  const xShown = card.axisXKind !== null;
  c.xDate = card.axisXKind === "date" || (xShown && (xType === "date" || xType === "datetime"));
  c.xRow.classList.toggle("hidden", !xShown);
  c.yRow.classList.toggle("hidden", !card.axisYUsed);
  c.none.classList.toggle("hidden", xShown || card.axisYUsed);
  c.xNumberTicks.classList.toggle("hidden", c.xDate);
  c.xDateTicks.classList.toggle("hidden", !c.xDate);
  c.reset.disabled = !axesSet(card.config.axes);
  const type = c.xDate ? "date" : "number";
  for (const box of [c.xMin, c.xMax]) {
    if (box.type !== type) {
      box.type = type;
      box.placeholder = c.xDate ? "" : "auto";
    }
  }
  // A box being typed in keeps what is in it.
  const fill = (box: HTMLInputElement | HTMLSelectElement, value: string): void => {
    if (document.activeElement !== box && box.value !== value) box.value = value;
  };
  const show = (value: number | null | undefined, date: boolean): string =>
    typeof value === "number" && Number.isFinite(value) ? (date ? isoDay(value) : String(value)) : "";
  fill(c.xMin, show(axes.xMin, c.xDate));
  fill(c.xMax, show(axes.xMax, c.xDate));
  fill(c.xStep, show(axes.xStep, false));
  fill(c.yMin, show(axes.yMin, false));
  fill(c.yMax, show(axes.yMax, false));
  fill(c.yStep, show(axes.yStep, false));
  fill(c.xEveryUnit, axes.xEvery?.unit ?? "auto");
  fill(c.xEveryN, String(axes.xEvery?.n ?? 1));
  fill(c.xFormat, axes.xFormat ?? "auto");
  // A chart of periods can only tick on a period: units finer than it are offered greyed out.
  const finest = card.axisXGrain === null ? 0 : UNITS.findIndex(([unit]) => unit === card.axisXGrain);
  UNITS.forEach(([unit], index) => {
    const option = c.xEveryUnit.options[index];
    if (option === undefined) return;
    const tooFine = unit !== "auto" && index < finest;
    option.disabled = tooFine && option.value !== c.xEveryUnit.value;
    option.title = tooFine ? `This chart is by ${card.axisXGrain}: a tick cannot fall between them` : "";
  });
  const note = c.xDate ? card.axisXTickNote : "";
  c.tickNote.textContent = note;
  c.tickNote.classList.toggle("hidden", note === "");
}
