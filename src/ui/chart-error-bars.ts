/**
 * Error bars on a chart: working them out in the worker, the progress note, whiskers and the notes they add.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import { INTERVAL_KINDS, intervalBlock, statisticBlock, type IntervalKind } from "../data/error-bars.js";
import { errorBarKey } from "../data/error-bar-key.js";
import { num } from "../data/chart-extract.js";
import type { ErrorBarsProgressMessage } from "../worker/protocol.js";
import type { AggregateMessage } from "../worker/protocol.js";
import { el } from "./dom.js";
import type { ChartCard } from "./chart-card.js";
import type { Frame } from "./chart-card-types.js";
import { ERROR_BAR_KINDS, ERROR_BARS_ASK_CERTAINTY, TIME_SERIES_WARNING } from "./chart-card-types.js";

/** The bars' numbers and how they were made, so a chart's uncertainty can leave with it. */
export function errorBarExtract(card: ChartCard, aggregate: AggregateMessage, facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
  if (!card.errorBarsOn()) return;
  const message = card.errorBarResult;
  if (message === null) {
    facts.push(["Error bars", "Still being worked out; open this again when the chart has them"]);
    return;
  }
  const kind = card.errorBarKind();
  const method: Record<IntervalKind, string> = {
    ci: (card.config.valueAgg ?? "mean") === "median"
      ? "95% confidence interval for the median: exact binomial ranks, approximated by a normal above 1,000 rows; none below 6 rows"
      : "95% confidence interval for the average: Student's t, the average ± t × standard error",
    bootstrap: `95% percentile bootstrap: ${message.resamples.toLocaleString()} resamples with replacement of each group's rows, seed ${message.seed}. The same data gives the same bars`,
    se: "The average ± 1 standard error (standard deviation ÷ √rows): about 68% coverage if the rows are roughly normal",
    sd: "The average ± 1 sample standard deviation: how varied the rows are, not how well the average is known",
    pi: "The 2.5th to 97.5th percentile of the rows: how varied they are, not how well the statistic is known",
  };
  facts.push(["Error bars", method[kind]]);
  facts.push(["Error bars took", `${(message.ms / 1000).toFixed(2)} seconds`]);
  if (aggregate.dimensionIsTime[0] === true && ERROR_BARS_ASK_CERTAINTY.has(kind)) facts.push(["Warning", TIME_SERIES_WARNING]);
  const names = aggregate.dimensionNames;
  const rows: string[][] = [[...names, "statistic", "low", "high", "minus", "plus", "rows", ...(message.bootSe === null ? [] : ["bootstrap_se"])]];
  message.keys.forEach((_, index) => {
    const center = message.center[index]!;
    const low = message.low[index]!;
    const high = message.high[index]!;
    rows.push([
      ...(message.labels[index] ?? []),
      num(center),
      num(low),
      num(high),
      num(center - low),
      num(high - center),
      String(message.n[index]!),
      ...(message.bootSe === null ? [] : [num(message.bootSe[index])]),
    ]);
  });
  table("Error bars", rows);
}

/** Why this chart cannot have error bars; null when it can. */
export function errorBarBlock(card: ChartCard): string | null {
  if (card.config.source !== "") return "Set Source to Table: a Pivot View's rows are already rolled up";
  if ((card.config.valueColumn ?? -1) < 0) return "Choose a Value column and a statistic such as Average";
  const block = statisticBlock(card.config.valueAgg ?? "mean");
  if (block !== null) return block;
  if ((card.config.valueCalc ?? "") !== "") return "Turn off the calculation first: bars describe the plain statistic";
  if ((card.config.groupColumn ?? -1) >= 0) return "Not available with Group by yet: Extract stats and the single-series chart have them";
  return null;
}

export function syncErrorBarControls(card: ChartCard): void {
  const relevant = ERROR_BAR_KINDS.has(card.config.kind);
  card.errorBarRow.classList.toggle("hidden", !relevant);
  if (!relevant) return;
  const block = card.errorBarBlock();
  const agg = card.config.valueAgg ?? "mean";
  card.errorBarInput.disabled = block !== null;
  card.errorBarInput.checked = card.config.errorBars === true && block === null;
  card.errorBarInput.parentElement!.title = block ?? "Show how uncertain or how varied each value is";
  const on = card.errorBarInput.checked;
  card.errorBarSelect.classList.toggle("hidden", !on);
  for (const option of card.errorBarSelect.options) {
    const why = intervalBlock(option.value as IntervalKind, agg);
    option.disabled = why !== null;
    const entry = INTERVAL_KINDS.find((item) => item.id === option.value);
    option.title = why ?? entry?.asks ?? "";
  }
  const kind = card.errorBarKind();
  card.errorBarSelect.value = kind;
  card.errorBarHint.textContent = block ?? (on ? (INTERVAL_KINDS.find((item) => item.id === kind)?.asks ?? "") : "");
  card.errorBarHint.classList.toggle("hidden", card.errorBarHint.textContent === "");
}

/** Fetches the bars; only one job runs at a time, and a new one stops the last. */
export function refreshErrorBars(card: ChartCard): void {
  card.errorBarRun++;
  card.errorBarJob?.cancel();
  card.errorBarJob = null;
  card.hideErrorBarProgress();
  card.errorBarResult = null;
  card.errorBarIndex = new Map();
  const request = card.options.requestErrorBars;
  const view = card.valueViewDef();
  if (!card.errorBarsOn() || request === undefined || view === null) return;
  const run = card.errorBarRun;
  const kind = card.errorBarKind();
  const job = request({ view, kind }, (progress) => {
    if (run === card.errorBarRun) card.showErrorBarProgress(progress);
  });
  card.errorBarJob = job;
  // A quick job should not flash a dialog at anyone.
  if (kind === "bootstrap") {
    card.errorBarProgressTimer = window.setTimeout(() => {
      if (run === card.errorBarRun && card.errorBarJob !== null) card.showErrorBarProgress(null);
    }, 200);
  }
  void job.done
    .then((message) => {
      if (run !== card.errorBarRun || card.disposed) return;
      card.errorBarJob = null;
      card.hideErrorBarProgress();
      if (message.cancelled) return;
      card.errorBarResult = message;
      card.errorBarIndex = new Map(message.keys.map((key, index) => [key, index]));
      card.render();
    })
    .catch(() => {
      if (run !== card.errorBarRun) return;
      card.errorBarJob = null;
      card.hideErrorBarProgress();
    });
}

export function cancelErrorBars(card: ChartCard): void {
  card.errorBarRun++;
  card.errorBarJob?.cancel();
  card.errorBarJob = null;
  card.hideErrorBarProgress();
  card.config.errorBars = false;
  card.syncErrorBarControls();
  card.render();
  card.noteEl.append(" · Error bars turned off: resampling was cancelled");
}

/** The dialog over the chart while resampling: a donut, how far, how long, and a way out. */
export function showErrorBarProgress(card: ChartCard, progress: ErrorBarsProgressMessage | null): void {
  if (card.errorBarProgressTimer !== null && progress !== null) {
    window.clearTimeout(card.errorBarProgressTimer);
    card.errorBarProgressTimer = null;
  }
  let box = card.errorBarProgress;
  if (box === null) {
    const cancel = el("button", { class: "ghost small", type: "button" }, ["Cancel"]) as HTMLButtonElement;
    cancel.addEventListener("click", () => card.cancelErrorBars());
    box = el("div", { class: "chart-progress", role: "status", "aria-live": "polite" }, [
      el("div", { class: "chart-progress-donut", "aria-hidden": "true" }, [el("span", { class: "chart-progress-percent" }, ["0%"])]),
      el("div", { class: "chart-progress-text" }, [
        el("strong", {}, ["Resampling for error bars"]),
        el("span", { class: "chart-progress-detail" }, ["Starting…"]),
        el("span", { class: "chart-progress-time" }, [""]),
      ]),
      cancel,
    ]);
    box.dataset.started = String(performance.now());
    card.canvasWrap.append(box);
    card.errorBarProgress = box;
  }
  if (progress === null) return;
  const share = progress.total === 0 ? 0 : progress.done / progress.total;
  (box.querySelector(".chart-progress-percent") as HTMLElement).textContent = `${Math.round(share * 100)}%`;
  (box.querySelector(".chart-progress-donut") as HTMLElement).style.setProperty("--done", `${share * 360}deg`);
  (box.querySelector(".chart-progress-detail") as HTMLElement).textContent =
    `Resample ${progress.resample.toLocaleString()} of ${progress.resamples.toLocaleString()}${progress.groups > 1 ? `, group ${progress.group.toLocaleString()} of ${progress.groups.toLocaleString()}` : ""}`;
  const elapsed = (performance.now() - Number(box.dataset.started)) / 1000;
  const left = share > 0.02 ? (elapsed / share) * (1 - share) : Number.NaN;
  (box.querySelector(".chart-progress-time") as HTMLElement).textContent = Number.isFinite(left) ? `About ${left < 1 ? "a second" : `${Math.ceil(left)} seconds`} left` : "";
}

export function hideErrorBarProgress(card: ChartCard): void {
  if (card.errorBarProgressTimer !== null) {
    window.clearTimeout(card.errorBarProgressTimer);
    card.errorBarProgressTimer = null;
  }
  card.errorBarProgress?.remove();
  card.errorBarProgress = null;
}

/** A mark's bars, by its labels rather than its place, since the chart can sort its groups. */
export function errorBarAt(card: ChartCard, result: AggregateMessage, index: number): { low: number; high: number; n: number } | null {
  if (card.errorBarResult === null) return null;
  const at = card.errorBarIndex.get(errorBarKey(result.dimensions.map((values) => values[index] ?? "")));
  if (at === undefined) return null;
  const low = card.errorBarResult.low[at]!;
  const high = card.errorBarResult.high[at]!;
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high, n: card.errorBarResult.n[at]! } : null;
}

export function drawWhisker(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, x0: number, y0: number, x1: number, y1: number): void {
  const cap = 3.5 * frame.ui;
  const across = x0 === x1;
  ctx.strokeStyle = frame.text;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(1, 1.3 * frame.ui);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  for (const [x, y] of [[x0, y0], [x1, y1]] as const) {
    ctx.moveTo(across ? x - cap : x, across ? y : y - cap);
    ctx.lineTo(across ? x + cap : x, across ? y : y + cap);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** What the bars are, in the note under the chart, with the warning a time series needs. */
export function appendErrorBarNote(card: ChartCard, result: AggregateMessage | null): void {
  if (!card.errorBarsOn()) return;
  if (card.errorBarResult === null) {
    if (card.errorBarJob !== null) card.noteEl.append(" · Working out the error bars…");
    return;
  }
  const message = card.errorBarResult;
  const missing = message.low.filter((value) => !Number.isFinite(value)).length;
  const parts = [`Error bars: ${card.errorBarName()}`];
  if (missing > 0) parts.push(`${missing.toLocaleString()} ${missing === 1 ? "group has" : "groups have"} too few rows for a bar`);
  if (result?.dimensionIsTime[0] === true && ERROR_BARS_ASK_CERTAINTY.has(card.errorBarKind())) parts.push(TIME_SERIES_WARNING);
  card.noteEl.append(` · ${parts.join(" · ")}`);
}
