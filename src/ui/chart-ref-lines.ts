/**
 * Reference lines: the sidebar rows that set them, the value parser, and the drawing.
 *
 * Each draw path that draws a numeric value axis records it with setRefAxis (and raises the
 * axis top with refAxisTop so a line above the data is in view); drawReferenceLines then maps a
 * line's value through that record, so a line lands on the axis the person sees whatever drew it.
 * Charts that record nothing fall back to the brush space and value scale they already set.
 */

import { symlog } from "../data/symlog.js";
import { formatChartNumber, plainMeasureName } from "./chart-utils.js";
import { el } from "./dom.js";
import type { ChartCard } from "./chart-card.js";
import type { RefLine } from "./chart-card-types.js";

/** A numeric axis as drawn: value `min` sits at canvas pixel `from`, `max` at `to`. */
export interface RefScale {
  min: number;
  max: number;
  from: number;
  to: number;
}

/**
 * A chart's value axis for reference lines. `across`: a line on it runs across the plot (a
 * vertical value axis); false when the bars lie on their side and the line runs up the plot.
 * `values`: what the marks show, for "Average of the bars". `fixed`: the person zoomed, so the
 * axis was not stretched to take in a line.
 */
export interface RefAxis {
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  y: RefScale & { across: boolean };
  /** A numeric X axis that has no brush space (grouped histograms and lines); `log` for a signed-log bin scale. */
  x?: RefScale & { log: boolean };
  values?: ArrayLike<number>;
  fixed?: boolean;
}

/** Aggregates whose result is in the column's own units, so the column's mean sits on the same axis. */
const ROW_UNIT_AGGS: ReadonlySet<string> = new Set(["mean", "median", "min", "max", "p25", "p75", "p90", "p95", "first", "last", "mode"]);

/**
 * Reads what the person typed for a line: `1,000`, `2.5k`, `3M`, `1.2B`, `5%` (0.05), `-3`.
 * A comma is accepted only as a thousands separator in its right places; `1,5` is refused,
 * never read as 1.5 or 15. Dates on a date axis: `2021-03-01` or anything Date.parse reads.
 */
export function parseRefValue(text: string, isDate: boolean): { value: number | undefined; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: undefined, error: null };
  if (isDate) {
    const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed);
    return Number.isFinite(time) ? { value: time, error: null } : { value: undefined, error: "Not a date: type it as 2021-03-01." };
  }
  const match = /^([+-]?)(\d[\d,]*(?:\.\d*)?|\.\d+)\s*([kKmMbB%]?)$/.exec(trimmed.replace(/[\s_]/g, ""));
  if (match === null) return { value: undefined, error: "Not a number: type it as 1500, 1,500, 1.5k or 15%." };
  const [, sign, digits, suffix] = match as unknown as [string, string, string, string];
  if (digits.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(digits)) {
    return { value: undefined, error: "A comma here only separates thousands (1,500). For a decimal use a point: 1.5." };
  }
  const scale = { k: 1e3, m: 1e6, b: 1e9, "%": 0.01, "": 1 }[suffix.toLowerCase()] ?? 1;
  const value = Number(digits.replace(/,/g, "")) * scale * (sign === "-" ? -1 : 1);
  return Number.isFinite(value) ? { value, error: null } : { value: undefined, error: "Not a number." };
}

/** Whether a line at the plotted column's mean is in the same units as the value axis. */
export function refMeanFits(card: ChartCard): boolean {
  const c = card.config;
  if (c.kind !== "line" && c.kind !== "bar" && c.kind !== "barplot") return true;
  return (c.valueCalc ?? "") === "" && ROW_UNIT_AGGS.has(c.valueAgg ?? "mean");
}

/** Whether this chart offers a line at the average of what its marks show. */
function offersAverage(card: ChartCard, axis: "x" | "y"): boolean {
  const kind = card.config.kind;
  return axis === "y" && (kind === "line" || kind === "bar" || kind === "barplot" || kind === "histogram");
}

/** The value of a line: typed, the plotted column's mean, or the average of the drawn marks. Null when it has none. */
export function refValue(card: ChartCard, line: RefLine): number | null {
  if (line.source === "value") return line.value !== undefined && Number.isFinite(line.value) ? line.value : null;
  if (line.source === "average") {
    const values = card.refAxis?.values;
    if (values === undefined) return null;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!;
      if (Number.isFinite(value)) {
        sum += value;
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  }
  if (line.axis === "y" && !refMeanFits(card)) return null;
  const value = card.meta(card.refAxisColumn(line.axis))?.stats.mean;
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/** The values of the lines on one axis that can be known before the chart is drawn (not averages of the marks). */
function knownValues(card: ChartCard, axis: "x" | "y"): number[] {
  const out: number[] = [];
  for (const line of card.config.refLines ?? []) {
    if (line.axis !== axis || line.source === "average") continue;
    const value = refValue(card, line);
    if (value !== null) out.push(value);
  }
  return out;
}

/** The top of a value axis that starts at zero, raised so a line above the data is in view, with a little air over it. */
export function refAxisTop(card: ChartCard, top: number): number {
  // A top the person set wins over the data, the reference lines and the other panels.
  card.axisYUsed = true;
  const fixedTop = card.config.axes?.yMax;
  const fixedLo = card.config.axes?.yMin ?? 0;
  if (typeof fixedTop === "number" && Number.isFinite(fixedTop) && fixedTop > fixedLo) return fixedTop;
  let highest = top;
  for (const value of knownValues(card, "y")) if (value > highest) highest = value * 1.06;
  // A small-multiples panel: report its own top, draw on the one all panels share.
  if (card.panelUi === null) return highest;
  card.panelNatural.top = highest;
  return Math.max(highest, card.panelShared?.top ?? 0);
}

/** A value axis that need not start at zero (box plots, scatter Y): widened to take in every line, unless the person fixed it. */
export function refAxisRange(card: ChartCard, axis: "x" | "y", min: number, max: number): { min: number; max: number } {
  if (axis === "y") card.axisYUsed = true;
  else card.axisXKind = "number";
  // Ends the person set win; an unset end stays automatic.
  const axes = card.config.axes;
  const setLo = axis === "x" ? axes?.xMin : axes?.yMin;
  const setHi = axis === "x" ? axes?.xMax : axes?.yMax;
  const lo = typeof setLo === "number" && Number.isFinite(setLo) ? setLo : null;
  const hi = typeof setHi === "number" && Number.isFinite(setHi) ? setHi : null;
  if (lo !== null || hi !== null) {
    const auto = lo === null || hi === null ? refAxisRangeAuto(card, axis, min, max) : { min, max };
    const range = { min: lo ?? auto.min, max: hi ?? auto.max };
    if (range.max > range.min) return range;
  }
  return refAxisRangeAuto(card, axis, min, max);
}

function refAxisRangeAuto(card: ChartCard, axis: "x" | "y", min: number, max: number): { min: number; max: number } {
  if (axis === "y" && card.panelUi !== null) {
    card.panelNatural.lo = min;
    card.panelNatural.hi = max;
    const shared = card.panelShared;
    if (shared?.lo !== undefined && shared.hi !== undefined) {
      min = Math.min(min, shared.lo);
      max = Math.max(max, shared.hi);
    }
  }
  let lo = min;
  let hi = max;
  for (const value of knownValues(card, axis)) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  if (lo === min && hi === max) return { min, max };
  const pad = (hi - lo) * 0.04;
  return { min: lo < min ? lo - pad : min, max: hi > max ? hi + pad : max };
}

/** Records the value axis just drawn: `min` at the bottom of the plot and `max` at its top. */
export function setRefAxis(card: ChartCard, box: { left: number; top: number; plotW: number; plotH: number }, min: number, max: number, values?: ArrayLike<number>, fixed = false): void {
  card.refAxis = {
    left: box.left,
    top: box.top,
    plotW: box.plotW,
    plotH: box.plotH,
    y: { min, max, from: box.top + box.plotH, to: box.top, across: true },
    ...(values === undefined ? {} : { values }),
    ...(fixed ? { fixed } : {}),
  };
}

/** Records the numeric X axis of a chart that has no brush space, after setRefAxis. */
export function setRefX(card: ChartCard, box: { left: number; plotW: number }, min: number, max: number, log: boolean): void {
  if (card.refAxis !== null && max > min) card.refAxis.x = { min, max, from: box.left, to: box.left + box.plotW, log };
}

/** Whether this chart can draw a line on the axis at all; the control is hidden where it cannot. */
export function refLinesSupported(card: ChartCard): boolean {
  return card.config.kind !== "map" && card.hasValueAxis();
}

/** The reference lines' rows in the sidebar, rebuilt only when the chart's columns or the lines themselves change. */
export function syncRefLines(card: ChartCard): void {
  const lines = card.config.refLines ?? [];
  const supported = refLinesSupported(card);
  card.refSection.parentElement?.classList.toggle("hidden", !supported);
  if (!supported) return;
  const c = card.config;
  const key = JSON.stringify([c.kind, c.source, c.x, c.y, c.column, c.valueColumn, c.valueAgg, c.valueCalc, lines.map((line) => [line.axis, line.source])]);
  if (key === card.refKey) {
    // Undo or an applied spec can change only a value: show it, unless the person is typing in that field.
    card.refRows.querySelectorAll<HTMLInputElement>(".chart-ref-value").forEach((input, index) => {
      const line = lines[index];
      if (line !== undefined && input !== input.ownerDocument.activeElement && line.value !== undefined) {
        input.value = input.dataset.date === "true" ? new Date(line.value).toISOString().slice(0, 10) : String(line.value);
      }
    });
    return;
  }
  card.refKey = key;
  card.refRows.replaceChildren();
  lines.forEach((line, index) => {
    const axisSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Line direction" }) as HTMLSelectElement;
    const options: [string, string][] = [];
    // The value axis lies across the plot except for many bars, which lie on their side: then its line runs up.
    options.push(["y", card.config.kind === "scatter" || card.config.kind === "density" || card.config.kind === "bubble" ? "Horizontal (Y value)" : "On the value axis"]);
    if (card.hasNumericX()) options.push(["x", "Vertical (X value)"]);
    else if (line.axis === "x") options.push(["x", "Vertical (this chart's X is not numeric)"]);
    for (const [value, label] of options) axisSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    axisSelect.value = line.axis;
    const sourceSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Where the line sits" }) as HTMLSelectElement;
    const column = card.refAxisColumn(line.axis);
    const name = card.meta(column)?.name ?? "";
    sourceSelect.append(el("option", { value: "value" }, ["At a value"]) as HTMLOptionElement);
    if (offersAverage(card, line.axis)) {
      sourceSelect.append(el("option", { value: "average" }, [card.config.kind === "line" ? "Average of the points" : "Average of the bars"]) as HTMLOptionElement);
    }
    if (column >= 0) {
      const fits = line.axis === "x" || refMeanFits(card);
      const option = el("option", { value: "mean" }, [fits ? `Mean of ${name} (all rows)` : `Mean of ${name}: not on a ${plainMeasureName(`${card.config.valueAgg ?? "mean"}(x)`).replace(/ of x$/, "")} axis`]) as HTMLOptionElement;
      option.disabled = !fits;
      sourceSelect.append(option);
    } else if (line.source === "mean") {
      sourceSelect.append(el("option", { value: "mean", disabled: "" }, ["Mean: this axis has no column"]) as HTMLOptionElement);
    }
    sourceSelect.value = line.source;
    const isDate = card.meta(column)?.type === "date" || card.meta(column)?.type === "datetime";
    const input = el("input", {
      class: "chart-number chart-ref-value",
      type: "text",
      inputmode: "decimal",
      placeholder: isDate ? "e.g. 2021-03-01" : "e.g. 1,500 or 1.5k or 15%",
      "aria-label": "Value of the line",
      spellcheck: "false",
    }) as HTMLInputElement;
    input.dataset.date = String(isDate);
    if (line.value !== undefined) input.value = isDate ? new Date(line.value).toISOString().slice(0, 10) : String(line.value);
    input.classList.toggle("hidden", line.source !== "value");
    const error = el("span", { class: "map-region-warning chart-ref-error hidden", role: "status" });
    const remove = el("button", { class: "icon-btn", type: "button", title: "Remove this line", "aria-label": "Remove this line" }, ["×"]) as HTMLButtonElement;
    const update = (patch: Partial<RefLine>): void => {
      const next = [...(card.config.refLines ?? [])];
      next[index] = { ...next[index]!, ...patch };
      card.config.refLines = next;
    };
    axisSelect.addEventListener("change", () => {
      update({ axis: axisSelect.value as "x" | "y", source: "value" });
      card.refKey = "";
      card.syncRefLines();
      card.render();
    });
    sourceSelect.addEventListener("change", () => {
      update({ source: sourceSelect.value as RefLine["source"] });
      card.refKey = "";
      card.syncRefLines();
      card.render();
    });
    input.addEventListener("input", () => {
      const parsed = parseRefValue(input.value, isDate);
      // Text that is not a number keeps the line where it was and says why, rather than dropping it.
      error.textContent = parsed.error ?? "";
      error.classList.toggle("hidden", parsed.error === null);
      input.setAttribute("aria-invalid", String(parsed.error !== null));
      if (parsed.error !== null) return;
      update({ value: parsed.value });
      card.render();
    });
    remove.addEventListener("click", () => {
      card.config.refLines = (card.config.refLines ?? []).filter((_, i) => i !== index);
      card.refKey = "";
      card.syncRefLines();
      card.render();
    });
    card.refRows.append(el("div", { class: "chart-ref-row" }, [axisSelect, sourceSelect, input, error, remove]));
  });
}

/** The value axis to draw on: the one the chart recorded, else what its brush space or value scale says. */
function valueAxisOf(card: ChartCard): RefAxis | null {
  if (card.refAxis !== null) return card.refAxis;
  const space = card.brushSpace;
  if (space !== null && space.yMin !== undefined && space.yMax !== undefined && space.yMax > space.yMin) {
    return { left: space.left, top: space.top, plotW: space.plotW, plotH: space.plotH, y: { min: space.yMin, max: space.yMax, from: space.top + space.plotH, to: space.top, across: true }, fixed: card.plotView !== null };
  }
  const scale = card.valueScale;
  const box = space ?? card.lastFrame;
  if (scale !== null && scale.yMax > 0 && box !== null) {
    return { left: box.left, top: scale.top, plotW: box.plotW, plotH: scale.plotH, y: { min: 0, max: scale.yMax, from: scale.top + scale.plotH, to: scale.top, across: true } };
  }
  return null;
}

/** The numeric X axis, from the brush space; histograms on a signed-log scale map through it. */
function xAxisOf(card: ChartCard): { scale: RefScale; top: number; plotH: number; left: number; plotW: number; log: boolean } | null {
  const own = card.refAxis;
  if (own?.x !== undefined) return { scale: own.x, top: own.top, plotH: own.plotH, left: own.left, plotW: own.plotW, log: own.x.log };
  const space = card.brushSpace;
  if (space === null || !(space.xMax > space.xMin)) return null;
  const log = card.config.kind === "histogram" && card.groupResult === null && card.drawnBins()?.symlog === true;
  return {
    scale: { min: space.xMin, max: space.xMax, from: space.left, to: space.left + space.plotW * space.xFraction },
    top: space.top,
    plotH: space.plotH,
    left: space.left,
    plotW: space.plotW,
    log,
  };
}

const at = (scale: RefScale, value: number, log = false): number => {
  const t = log ? (symlog(value) - symlog(scale.min)) / (symlog(scale.max) - symlog(scale.min)) : (value - scale.min) / (scale.max - scale.min);
  return scale.from + t * (scale.to - scale.from);
};

/**
 * Draws the reference lines over the plot (after the marks, so no series hides them), and says
 * in the chart's note when one cannot be drawn: off the scale, on an axis this chart lacks, or
 * a mean in the wrong units.
 */
export function drawReferenceLines(card: ChartCard, ctx: CanvasRenderingContext2D): void {
  const lines = card.config.refLines ?? [];
  // Which lines landed where, for the browser tests: "y:7@123.5" per line drawn.
  const drawn: string[] = [];
  card.canvas.dataset.refLines = "";
  if (lines.length === 0 || card.plotMessageDrawn || !refLinesSupported(card)) return;
  const valueAxis = valueAxisOf(card);
  const xAxis = xAxisOf(card);
  const isDateAxis = (axis: "x" | "y"): boolean => {
    const type = card.meta(card.refAxisColumn(axis))?.type;
    return type === "date" || type === "datetime";
  };
  const frame = card.lastFrame;
  const ui = frame?.ui ?? 1;
  const ink = frame?.text ?? "#1f2328";
  const notes: string[] = [];
  const range = (scale: RefScale, date: boolean): string => {
    const show = (value: number): string => (date ? new Date(value).toISOString().slice(0, 10) : formatChartNumber(value));
    return `${show(Math.min(scale.min, scale.max))} to ${show(Math.max(scale.min, scale.max))}`;
  };
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.round(11 * ui)}px system-ui, sans-serif`;
  for (const line of lines) {
    const value = refValue(card, line);
    if (value === null) {
      if (line.source === "mean" && line.axis === "y" && !refMeanFits(card)) notes.push("A line at the column mean is not drawn: the axis shows an aggregate in other units (use Average of the bars)");
      else if (line.source === "average") notes.push("An average line is not drawn: this chart has more than one series to average");
      continue;
    }
    const date = isDateAxis(line.axis);
    const shown = date ? new Date(value).toISOString().slice(0, 10) : formatChartNumber(value);
    const label = `${line.source === "value" ? "" : `${line.source} `}${shown}`;
    const lo = (scale: RefScale): number => Math.min(scale.min, scale.max);
    const hi = (scale: RefScale): number => Math.max(scale.min, scale.max);
    // A rounding hair outside the axis still sits on its edge.
    const inside = (scale: RefScale): boolean => value >= lo(scale) - (hi(scale) - lo(scale)) * 1e-9 && value <= hi(scale) + (hi(scale) - lo(scale)) * 1e-9;
    const onValueAxis = line.axis === "y";
    if (onValueAxis && valueAxis === null) {
      notes.push(`Line at ${shown} not drawn: this chart has no value axis yet`);
      continue;
    }
    if (!onValueAxis && xAxis === null) {
      notes.push(`Vertical line at ${shown} not drawn: this chart's X axis is not numeric`);
      continue;
    }
    const scale = onValueAxis ? valueAxis!.y : xAxis!.scale;
    if (!inside(scale)) {
      const fixed = onValueAxis ? valueAxis!.fixed === true : card.plotView !== null || card.chartXZoom !== null;
      notes.push(`Line at ${shown} is off the scale (the axis shows ${range(scale, date)}${fixed ? " while zoomed in" : ""})`);
      continue;
    }
    const across = onValueAxis ? valueAxis!.y.across : false;
    const box = onValueAxis ? valueAxis! : xAxis!;
    const pixel = Math.round(at(scale, value, !onValueAxis && xAxis!.log)) + 0.5;
    drawn.push(`${line.axis}:${value}@${pixel}`);
    ctx.beginPath();
    if (across) {
      ctx.moveTo(box.left, pixel);
      ctx.lineTo(box.left + box.plotW, pixel);
      ctx.stroke();
      ctx.textAlign = "right";
      // Above the line, or under it when it runs along the top of the plot.
      ctx.fillText(label, box.left + box.plotW - 4 * ui, pixel - 4 * ui < box.top + 10 * ui ? pixel + 12 * ui : pixel - 4 * ui);
    } else {
      ctx.moveTo(pixel, box.top);
      ctx.lineTo(pixel, box.top + box.plotH);
      ctx.stroke();
      ctx.textAlign = pixel > box.left + box.plotW * 0.8 ? "right" : "left";
      ctx.fillText(label, pixel + (ctx.textAlign === "right" ? -4 : 4) * ui, box.top + 12 * ui);
    }
  }
  ctx.restore();
  card.canvas.dataset.refLines = drawn.join(" ");
  if (notes.length > 0) {
    const existing = card.noteEl.textContent ?? "";
    card.noteEl.append(`${existing === "" ? "" : " · "}${notes.join(" · ")}`);
  }
}
