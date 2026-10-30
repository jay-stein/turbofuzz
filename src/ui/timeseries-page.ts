/**
 * Time Series page: one series from the loaded table (date column, measure, optional
 * group), explored, decomposed, forecast and profiled. The engine runs in the worker
 * (src/data/timeseries); this module draws its snapshots and turns clicks and drags
 * into new choices. Ported from prototypes/time-series/time-series-workbench.html.
 */

import { bucketStart, DAY, GRAIN_ORDER, GRAINS, type GrainId } from "../data/timeseries/base.js";
import type { TsAgg, TsConfig, TsGaps, TsMode } from "../data/timeseries/aggregate.js";
import type { TsSnapshot } from "../data/timeseries/engine.js";
import {
  compact, dfDate, dfDM, dfMonShort, dfTime, fmtNum, full, nf, nounFor, pct, periodLabel, shortPeriod, signed,
} from "../data/timeseries/format.js";
import { grade, MODEL_INFO, MODEL_KEYS, type Future, type ModelKey, type ModelRun } from "../data/timeseries/models.js";
import type { ColumnMeta, TimeSeriesMessage } from "../worker/protocol.js";
import { downloadCsv } from "./chart-export.js";
import {
  buildInsights, chg, escapeHtml, measureWord, modelRows, ratioOf, seasonName, selectedModel, trendShift,
  type TsAction, type TsFinding, type TsTone, type TsView,
} from "./timeseries-findings.js";
import { niceTicks, patternsHtml } from "./timeseries-patterns.js";

export interface TimeSeriesPageOptions {
  request: (input: { dateColumn: number; groupColumn: number; config: TsConfig | null; mode: TsMode }) => Promise<TimeSeriesMessage | null>;
  /** Filter the table to one period of the date column (UTC ms, inclusive) and show it. */
  onShowRows: (dateColumn: number, min: number, max: number) => void;
  onAction: (message: string) => void;
  datasetName: () => string;
}
export interface TimeSeriesPageHandle {
  /** The table, its columns or its filters changed: read the series again. */
  setData(metas: readonly ColumnMeta[], resultCount: number): void;
  /** The page became visible: size the canvases, catch up on changes and draw. */
  shown(): void;
  /** The page is out of sight: stop drawing and fetching until shown again. */
  hide(): void;
  /** Open on a given date column, split and series, e.g. from a Chart line card. */
  open(preset: TsPreset): void;
}
/** What another view knows about a series; anything it leaves out keeps the defaults. */
export interface TsPreset {
  dateColumn: number;
  groupColumn?: number;
  /** Column name to measure; null counts rows. Undefined keeps the default. */
  measure?: string | null;
  agg?: TsAgg;
  grain?: GrainId;
}

type Level = "80" | "fan";
interface UiState { mode: TsMode; showSmooth: boolean; lastYear: boolean; showShift: boolean; level: Level; model: ModelKey | "auto" }
type TokenKey = "grain" | "agg" | "measure" | "group" | "gaps" | "partial" | "date" | "groupBy";
interface Colors { bg: string; panel: string; panel2: string; border: string; text: string; dim: string; accent: string; forecast: string; season2: string; raw: string; danger: string; warn: string; grid: string }
interface Proj { T: number; H: number; f: Future; key: ModelKey }
interface DecRow { name: string; get: (i: number) => number; color: string; kind: "line" | "bars"; zero?: boolean; yy?: (v: number) => number }
type DragKind = "pan" | "box" | "split" | "horizon";

const GROUP_LIMIT = 50;
const AGG_OPTS: [TsAgg, string][] = [["sum", "sum"], ["mean", "mean"], ["twmean", "time-weighted mean"], ["median", "median"], ["min", "min"], ["max", "max"], ["first", "first"], ["last", "last"], ["count", "count of rows"]];
const GAP_OPTS: [TsGaps, string, string][] = [
  ["seasonal", "filled with the usual pattern", "the typical shape for those periods, on a line between the levels either side"],
  ["interp", "interpolated", "a straight line between the periods either side"],
  ["zero", "filled with zero", "an empty period counts as 0, as for sales"],
  ["leave", "left empty", "a break in the line; models still bridge it with the usual pattern"],
];
const MODES: TsMode[] = ["explore", "decompose", "forecast", "patterns"];
const MODE_LABEL: Record<TsMode, string> = { explore: "Explore", decompose: "Decompose", forecast: "Forecast", patterns: "Patterns" };

const TEMPLATE = `
<div class="ts-empty" data-ref="empty" hidden></div>
<div class="ts-body" data-ref="body" hidden>
  <header class="ts-top">
    <section class="ts-sentence" aria-label="Series">
      <h2 data-ref="sentence"></h2>
      <p class="ts-sub" data-ref="subline"></p>
      <p class="ts-why" data-ref="why"></p>
    </section>
    <div class="ts-top-actions">
      <div class="ts-modes" role="tablist" aria-label="Analysis">${MODES.map((m, k) => `<button role="tab" type="button" data-mode="${m}" aria-selected="${k === 0}" tabindex="${k === 0 ? 0 : -1}">${MODE_LABEL[m]}</button>`).join("")}</div>
      <button class="ts-ghost" type="button" data-ref="exportBtn" title="The series, its trend, season and forecast as CSV">Export CSV</button>
    </div>
  </header>
  <dl class="ts-strip" data-ref="strip"></dl>
  <div class="ts-work">
    <div class="ts-stage">
      <section class="ts-card" aria-label="Series chart">
        <div class="ts-toolbar" role="toolbar" aria-label="Mode settings">
          <div class="ts-tb" data-for="explore">
            <div class="ts-ctl"><label>Rolling window</label><input type="range" data-ref="smoothW" min="2" max="52" step="1" aria-label="Rolling window (slider)"><input type="number" class="ts-num" data-ref="smoothWNum" min="2" step="1" aria-label="Rolling window"><span class="ts-numunit" data-ref="smoothWUnit"></span></div>
            <div class="ts-seg" role="group" aria-label="Rolling statistic" data-ref="statSeg"><button type="button" data-stat="mean">Mean</button><button type="button" data-stat="median">Median</button><button type="button" data-stat="min">Min</button><button type="button" data-stat="max">Max</button></div>
            <label class="ts-check"><input type="checkbox" data-ref="smoothCentred"> Centred</label>
            <label class="ts-check"><input type="checkbox" data-ref="lastYear"> <span data-ref="lastYearText">Same period last year</span></label>
            <label class="ts-check" data-ref="shiftWrap"><input type="checkbox" data-ref="showShift"> Trend shift</label>
          </div>
          <div class="ts-tb" data-for="decompose" hidden>
            <div class="ts-ctl"><span>Season</span><div class="ts-seg" data-ref="periodSeg" role="group" aria-label="Seasonal period"></div></div>
            <div class="ts-ctl"><label>Flag unusual</label><input type="range" data-ref="sens" min="2.5" max="6" step="0.25" aria-label="How unusual a period must be to flag"><output data-ref="sensOut"></output></div>
          </div>
          <div class="ts-tb" data-for="forecast" hidden>
            <div class="ts-ctl"><span>Forecast ahead</span><div class="ts-stepper"><button type="button" data-ref="hMinus" aria-label="Forecast less far ahead">&minus;</button><span class="ts-stepnum"><input type="number" class="ts-num" data-ref="hNum" min="1" step="1" aria-label="How far ahead to forecast"><span class="ts-numunit" data-ref="hUnit"></span></span><button type="button" data-ref="hPlus" aria-label="Forecast further ahead">+</button></div><div class="ts-seg" data-ref="hPresets" role="group" aria-label="How far ahead"></div><span class="ts-note" data-ref="hMax"></span></div>
            <div class="ts-ctl"><span>Band</span><div class="ts-seg" data-ref="levelSeg" role="group" aria-label="Interval"><button type="button" data-level="80">80%</button><button type="button" data-level="fan">80% + 95%</button></div></div>
            <div class="ts-ctl"><span>Drivers</span><div class="ts-drivers" data-ref="drivers"></div></div>
            <span class="ts-note" data-ref="trainNote"></span>
            <button class="ts-ghost" type="button" data-ref="splitReset">Forecast from latest</button>
          </div>
          <div class="ts-tb" data-for="patterns" hidden>
            <span class="ts-note">Built from every complete hour and day in the data, whatever the grain above.</span>
          </div>
        </div>
        <div class="ts-card-head">
          <div class="ts-legend" data-ref="legend"></div>
          <div class="ts-head-actions">
            <span class="ts-zoomhint">Scroll to zoom · drag to pan · Shift-drag a range to zoom in · double-click to reset</span>
            <button class="ts-ghost" type="button" data-ref="tableBtn" aria-expanded="false">Periods</button>
          </div>
        </div>
        <div class="ts-hero" data-ref="hero">
          <canvas data-ref="heroCanvas" aria-hidden="true"></canvas>
          <canvas data-ref="heroOverlay" tabindex="0" role="img" aria-label="Series chart"></canvas>
          <div class="ts-readout" data-ref="readout" hidden aria-live="polite"></div>
        </div>
        <div class="ts-navrow">
          <div class="ts-nav"><canvas data-ref="navCanvas" role="img" aria-label="Overview. Drag the window to pan, drag its edges to zoom."></canvas></div>
          <div class="ts-zoom" role="group" aria-label="Zoom"><button type="button" data-ref="zoomOut" aria-label="Zoom out" title="Zoom out">&minus;</button><button type="button" data-ref="zoomIn" aria-label="Zoom in" title="Zoom in">+</button></div>
          <div class="ts-presets" data-ref="presets" role="group" aria-label="Range"></div>
        </div>
        <div class="ts-tablewrap" data-ref="tableWrap" hidden></div>
      </section>
      <section class="ts-card ts-panel" data-panel="explore">
        <div class="ts-panel-head"><h3>Pipeline</h3><p>Each step feeds the next. Click a step to change it or switch it off.</p></div>
        <ol class="ts-pipeline" data-ref="pipeline"></ol>
      </section>
      <section class="ts-card ts-panel" data-panel="decompose" hidden>
        <div class="ts-panel-head"><h3>Trend, season and the rest</h3><p>Same time axis as the chart above.</p></div>
        <div class="ts-meters" data-ref="meters"></div>
        <div class="ts-decomp" data-ref="decomp"><canvas data-ref="decCanvas" aria-hidden="true"></canvas><canvas data-ref="decOverlay" aria-hidden="true"></canvas></div>
      </section>
      <section class="ts-card ts-panel" data-panel="forecast" hidden>
        <div class="ts-panel-head"><h3>Models</h3><p>Drag the split line on the chart to backtest from any date, or the handle at the end of the band to change how far ahead it forecasts. Hover a model to compare it.</p></div>
        <div class="ts-boardwrap"><table class="ts-board" data-ref="board"></table></div>
        <div class="ts-ctl"><label>Trend flexibility</label><input type="range" data-ref="flex" min="1" max="10" step="1" aria-label="Trend flexibility"><output data-ref="flexOut"></output><span class="ts-note">for the trend, seasons and drivers model</span></div>
        <dl class="ts-modelcard" data-ref="modelCard"></dl>
      </section>
      <section class="ts-card ts-panel" data-panel="patterns" hidden>
        <div class="ts-panel-head"><h3>Typical patterns</h3><p>What a usual day, week and year look like. Hover any bar, cell or point for its value.</p></div>
        <dl class="ts-patfacts" data-ref="patFacts"></dl>
        <div class="ts-patgrid" data-ref="patGrid"></div>
      </section>
    </div>
    <aside class="ts-rail" aria-label="Findings">
      <h3>Findings</h3>
      <div class="ts-insights" data-ref="insights"></div>
    </aside>
  </div>
</div>
<div class="ts-popover" data-ref="popover" role="menu" hidden></div>`;

export function createTimeSeriesPage(host: HTMLElement, options: TimeSeriesPageOptions): TimeSeriesPageHandle {
  host.classList.add("ts-page");
  host.innerHTML = TEMPLATE;
  const ref = <T extends HTMLElement = HTMLElement>(name: string): T => {
    const el = host.querySelector<T>(`[data-ref="${name}"]`);
    if (!el) throw new Error(`time series page: missing ${name}`);
    return el;
  };
  const heroEl = ref("hero"), heroCanvas = ref<HTMLCanvasElement>("heroCanvas"), heroOverlay = ref<HTMLCanvasElement>("heroOverlay");
  const readoutEl = ref("readout"), navCanvas = ref<HTMLCanvasElement>("navCanvas"), decCanvas = ref<HTMLCanvasElement>("decCanvas"), decOverlay = ref<HTMLCanvasElement>("decOverlay");
  const POP = ref("popover");
  const heroBuf = document.createElement("canvas");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---------------------------------------------------------------- state
  let metas: readonly ColumnMeta[] = [];
  let dateColumn = -1, groupColumn = -1;
  let cfg: TsConfig | null = null;
  let snap: TsSnapshot | null = null;
  const ui: UiState = { mode: "explore", showSmooth: true, lastYear: false, showShift: true, level: "fan", model: "auto" };
  let INS: TsFinding[] = [];
  let view: [number, number] | null = null;
  let hoverIdx = -1, ghostModel: ModelKey | null = null;
  let pulse: { indices: number[]; rule: number | null; start: number } | null = null;
  let reveal = 1, revealStart = 0;
  let fade: { canvas: HTMLCanvasElement; start: number } | null = null;
  let viewAnim: { from: [number, number]; to: [number, number]; start: number; dur: number } | null = null;
  let allT: Float64Array | null = null;
  let tableOpen = false;
  let visible = false;
  // The table changed while the page was hidden: fetch when it is shown again.
  let stale = false;
  let inFlight = false, again = false, seq = 0;
  let afterFetch: (() => void) | null = null;

  // ---------------------------------------------------------------- data from the worker
  function dateColumns(): number[] { return metas.flatMap((m, i) => ((m.type === "date" || m.type === "datetime") && m.role !== "provenance" ? [i] : [])); }
  function groupColumns(): number[] {
    return metas.flatMap((m, i) => (m.role !== "provenance" && (m.type === "category" || m.type === "string" || m.type === "boolean") && m.stats.distinct >= 2 && m.stats.distinct <= GROUP_LIMIT ? [i] : []));
  }
  function fetchSeries(): void {
    if (dateColumn < 0) return;
    if (inFlight) { again = true; return; }
    inFlight = true;
    const mine = ++seq;
    const sentDate = dateColumn, sentGroup = groupColumn;
    options.request({ dateColumn, groupColumn, config: cfg, mode: ui.mode }).then((msg) => {
      inFlight = false;
      if (mine !== seq || sentDate !== dateColumn || sentGroup !== groupColumn) { if (again || mine !== seq) { again = false; fetchSeries(); } return; }
      if (!msg || !msg.snapshot) {
        snap = null;
        showEmpty(msg?.error ?? "This column has too few readable dates to make a series.");
      } else {
        const first = snap === null || cfg === null;
        snap = msg.snapshot;
        cfg = msg.snapshot.cfg;
        allT = null;
        INS = buildInsights(snap, ui);
        ref("empty").hidden = true;
        ref("body").hidden = false;
        if (first || !view) { layout(); view = clampView(ui.mode === "forecast" ? forecastView() : fullView()); }
        else view = clampView(view);
        const done = afterFetch;
        afterFetch = null;
        done?.();
        invalidate("ui", "stat", "nav", "panel", "ov");
      }
      if (again) { again = false; fetchSeries(); }
    }).catch(() => { inFlight = false; if (again) { again = false; fetchSeries(); } });
  }
  function showEmpty(html: string): void {
    ref("body").hidden = true;
    const empty = ref("empty");
    empty.hidden = false;
    empty.innerHTML = html;
  }
  function setData(next: readonly ColumnMeta[], _resultCount: number): void {
    const prevName = dateColumn >= 0 ? metas[dateColumn]?.name : null;
    metas = next;
    const dates = dateColumns();
    if (!dates.length) {
      dateColumn = -1;
      snap = null;
      showEmpty(`<h3>No date column</h3><p>The Time Series page needs a column of dates or date-times. If the dates are split over Year, Month and Day columns, type <b>combine</b> in the command bar to build one; if a date column reads as text, change its type to Date. Then come back here.</p>`);
      return;
    }
    const sameName = prevName === null ? -1 : dates.find((i) => metas[i].name === prevName) ?? -1;
    if (sameName < 0) { dateColumn = dates[0]; cfg = null; view = null; }
    else dateColumn = sameName;
    if (groupColumn >= 0 && !groupColumns().includes(groupColumn)) { groupColumn = -1; if (cfg) cfg = { ...cfg, group: -1 }; }
    if (visible) fetchSeries();
    else stale = true;
  }

  // ---------------------------------------------------------------- derived
  const A = () => (snap as TsSnapshot).A;
  const g = () => A().g;
  function proj(): Proj | null {
    if (!snap || ui.mode !== "forecast" || "error" in snap.models || !snap.futures) return null;
    const key = selectedModel(snap, ui);
    return key ? { T: snap.models.T, H: snap.models.H, f: snap.futures[key], key } : null;
  }
  const models = (): ModelRun | null => (snap && !("error" in snap.models) ? snap.models : null);

  // ---------------------------------------------------------------- time positions
  function lastIndex(): number {
    const M = models();
    if (ui.mode === "forecast" && M) return Math.max(A().n - 1, M.T + M.H - 1);
    return A().n - 1;
  }
  function times(): Float64Array {
    const M = models(), a = A();
    const last = Math.max(a.n - 1, M ? M.T + M.H - 1 : 0);
    if (!allT || allT.length !== last + 1) {
      allT = new Float64Array(last + 1);
      for (let i = 0; i <= last; i++) allT[i] = i < a.n ? a.t[i] : bucketStart((snap as TsSnapshot).table, a.g, i);
    }
    return allT;
  }
  function domain(): [number, number] { const T = times(); return [T[0], T[lastIndex()]]; }
  function nearestIndex(ms: number): number {
    const T = times(), last = lastIndex();
    let lo = 0, hi = last;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] < ms) lo = mid + 1; else hi = mid; }
    if (lo > 0 && Math.abs(T[lo - 1] - ms) < Math.abs(T[lo] - ms)) lo--;
    return lo;
  }
  function minSpan(): number { const a = A(); return (a.t[Math.min(a.n - 1, 8)] - a.t[0]) || DAY * 7; }
  function clampView(v: [number, number]): [number, number] {
    const [d0, d1] = domain();
    const pad = (d1 - d0) * 0.015;
    const lo = d0 - pad, hi = d1 + pad;
    let span = Math.max(v[1] - v[0], minSpan());
    span = Math.min(span, hi - lo);
    let a = v[0];
    if (a < lo) a = lo;
    if (a + span > hi) a = hi - span;
    return [a, a + span];
  }
  function fullView(): [number, number] { const [d0, d1] = domain(); const pad = (d1 - d0) * 0.015; return [d0 - pad, d1 + pad]; }
  function forecastView(): [number, number] {
    const M = models();
    if (!M) return fullView();
    const T = times();
    const back = Math.round(Math.max(M.H * 2.5, g().ctx * 1.5));
    return [T[Math.max(0, M.T - back)], T[M.T + M.H - 1] + (T[1] - T[0]) * 2];
  }

  // ---------------------------------------------------------------- colours
  let C: Colors = { bg: "#fff", panel: "#fff", panel2: "#eee", border: "#ccc", text: "#000", dim: "#666", accent: "#25e", forecast: "#73e", season2: "#08b", raw: "#789", danger: "#b22", warn: "#b50", grid: "#eee" };
  let FONT = "system-ui";
  const probe = document.createElement("span");
  probe.style.display = "none";
  host.append(probe);
  /** A token as rgb(), with var() chains resolved, so the canvas can fade it. */
  function token(name: string): string { probe.style.color = `var(${name})`; return getComputedStyle(probe).color || "#000"; }
  function readColors(): void {
    C = {
      bg: token("--bg"), panel: token("--panel"), panel2: token("--panel-2"), border: token("--border"), text: token("--text"), dim: token("--ts-dim"),
      accent: token("--accent"), forecast: token("--ts-forecast"), season2: token("--ts-season2"), raw: token("--ts-raw"), danger: token("--danger"), warn: token("--ts-warn"), grid: token("--ts-grid"),
    };
    FONT = getComputedStyle(host).fontFamily;
  }
  function rgba(color: string, a: number): string {
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(color);
    if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
    const h = color.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const font = (px: number, weight = 400): string => `${weight} ${px}px ${FONT}`;
  const toneColor = (t: TsTone): string => ({ accent: C.accent, forecast: C.forecast, danger: C.danger, warn: C.warn, dim: C.dim })[t];

  // ---------------------------------------------------------------- geometry
  let geo = { w: 0, h: 0, L: 56, R: 130, T: 26, B: 44, pw: 0, ph: 0, dpr: 1, wide: true };
  let yScale = { min: 0, max: 1 };
  function sizeCanvas(cv: HTMLCanvasElement, w: number, h: number, dpr: number): void {
    const W = Math.max(1, Math.round(w * dpr)), Hh = Math.max(1, Math.round(h * dpr));
    if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
  }
  function layout(): void {
    const r = heroEl.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const wide = r.width >= 620;
    geo = { w: r.width, h: r.height, L: wide ? 58 : 44, R: wide ? 132 : 12, T: 30, B: 44, pw: 0, ph: 0, dpr, wide };
    geo.pw = Math.max(10, geo.w - geo.L - geo.R);
    geo.ph = Math.max(10, geo.h - geo.T - geo.B);
    for (const cv of [heroCanvas, heroOverlay, heroBuf]) sizeCanvas(cv, r.width, r.height, dpr);
    const n = (navCanvas.parentElement as HTMLElement).getBoundingClientRect();
    sizeCanvas(navCanvas, n.width, n.height, dpr);
    const d = (decCanvas.parentElement as HTMLElement).getBoundingClientRect();
    if (d.width > 0) { sizeCanvas(decCanvas, d.width, d.height, dpr); sizeCanvas(decOverlay, d.width, d.height, dpr); }
  }
  const V = (): [number, number] => view ?? [0, 1];
  const X = (ms: number): number => geo.L + ((ms - V()[0]) / (V()[1] - V()[0])) * geo.pw;
  const Y = (v: number): number => geo.T + geo.ph - ((v - yScale.min) / (yScale.max - yScale.min || 1)) * geo.ph;
  const invX = (px: number): number => V()[0] + ((px - geo.L) / geo.pw) * (V()[1] - V()[0]);

  function timeTicks(v0: number, v1: number, width: number): { ticks: { ms: number; label: string }[]; majors: { ms: number; label: string }[]; ctx: string } {
    const start = (snap as TsSnapshot).table.start;
    const spanDays = (v1 - v0) / DAY;
    const max = Math.max(3, Math.floor(width / 64));
    const units: [number, "h" | "d" | "m" | "y", number][] = [[1, "h", 1 / 24], [2, "h", 2 / 24], [3, "h", 3 / 24], [6, "h", 6 / 24], [12, "h", 12 / 24], [1, "d", 1], [2, "d", 2], [7, "d", 7], [14, "d", 14], [1, "m", 30.4], [2, "m", 61], [3, "m", 91], [6, "m", 182], [1, "y", 365], [2, "y", 730], [5, "y", 1826], [10, "y", 3652], [25, "y", 9131], [50, "y", 18262], [100, "y", 36525]];
    let u = units[units.length - 1];
    for (const cand of units) if (spanDays / cand[2] <= max) { u = cand; break; }
    const ticks: { ms: number; label: string }[] = [], majors: { ms: number; label: string }[] = [];
    const d0 = new Date(v0);
    if (u[1] === "h") {
      const st = u[0] * 3_600_000;
      for (let ms = Math.ceil(v0 / st) * st; ms <= v1; ms += st) if (ms % DAY) ticks.push({ ms, label: dfTime.format(new Date(ms)) });
      for (let ms = Math.ceil(v0 / DAY) * DAY; ms <= v1; ms += DAY) majors.push({ ms, label: dfDM.format(new Date(ms)) });
      return { ticks, majors, ctx: dfDM.format(new Date(Math.max(v0, start))) };
    }
    if (u[1] === "d") {
      for (let ms = Math.ceil((v0 - start) / (DAY * u[0])) * DAY * u[0] + start; ms <= v1; ms += DAY * u[0]) ticks.push({ ms, label: String(new Date(ms).getUTCDate()) });
      for (let mm = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1); mm <= v1; mm = Date.UTC(new Date(mm).getUTCFullYear(), new Date(mm).getUTCMonth() + 1, 1)) majors.push({ ms: mm, label: dfMonShort.format(new Date(mm)) });
      return { ticks, majors, ctx: dfMonShort.format(new Date(Math.max(v0, start))) };
    }
    if (u[1] === "m") {
      const mo = Math.ceil((d0.getUTCMonth() + 1) / u[0]) * u[0];
      for (let ms = Date.UTC(d0.getUTCFullYear(), mo, 1); ms <= v1; ) {
        const dt = new Date(ms);
        ticks.push({ ms, label: dt.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }) });
        ms = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + u[0], 1);
      }
      for (let yy = d0.getUTCFullYear() + 1; Date.UTC(yy, 0, 1) <= v1; yy++) majors.push({ ms: Date.UTC(yy, 0, 1), label: String(yy) });
      return { ticks, majors, ctx: String(new Date(Math.max(v0, start)).getUTCFullYear()) };
    }
    const k = u[0];
    for (let yy = Math.ceil((d0.getUTCFullYear() + 1) / k) * k; Date.UTC(yy, 0, 1) <= v1; yy += k) ticks.push({ ms: Date.UTC(yy, 0, 1), label: String(yy) });
    return { ticks, majors: [], ctx: "" };
  }

  // ---------------------------------------------------------------- hero (static layer)
  function visibleRange(): [number, number] {
    const T = times(), last = lastIndex(), v = V();
    let a = 0, b = last;
    while (a < last && T[a + 1] < v[0]) a++;
    while (b > 0 && T[b - 1] > v[1]) b--;
    return [a, b];
  }
  function linePath(ctx: CanvasRenderingContext2D, i0: number, i1: number, get: (i: number) => number): void {
    const T = times();
    let open = false;
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const v = get(i);
      if (!(v === v)) { open = false; continue; }
      const x = X(T[i]), y = Y(v);
      if (open) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      open = true;
    }
  }
  function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, align: "center" | "left" | "right", border?: string): void {
    ctx.font = font(11, 600);
    const w = ctx.measureText(text).width + 14, h = 18;
    let left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    left = Math.max(2, Math.min(geo.w - w - 2, left));
    ctx.beginPath(); ctx.roundRect(left, y - h / 2, w, h, 9);
    ctx.fillStyle = bg; ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1.25; ctx.stroke(); }
    ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(text, left + 7, y + 0.5);
    ctx.textBaseline = "alphabetic";
  }
  function renderHero(): void {
    const ctx = heroBuf.getContext("2d");
    if (!ctx || !snap) return;
    ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    ctx.clearRect(0, 0, geo.w, geo.h);
    const s = snap, a = s.A, SM = s.smooth, D = s.dec, T = times(), M = models();
    const [i0, i1] = visibleRange();
    const N = a.modelN, n = a.n, mode = ui.mode;
    const P = proj();
    const split = P ? P.T : -1;
    let lo = Infinity, hi = -Infinity;
    const take = (v: number): void => { if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    for (let i = i0; i <= Math.min(i1, n - 1); i++) {
      if (P && i >= split && i >= N) continue;
      take(a.y[i]);
      if (mode === "explore" && ui.showSmooth && i < N) take(SM[i]);
      if (mode === "explore" && ui.lastYear && i - a.g.ly >= 0) take(a.y[i - a.g.ly]);
      if (mode === "decompose" && D.dec && i < N) take(D.dec.trend[i]);
    }
    if (P) for (let h = 0; h < P.H; h++) {
      const i = split + h;
      if (i < i0 || i > i1) continue;
      take(P.f.F[h]);
      take(ui.level === "fan" ? P.f.hi95[h] : P.f.hi80[h]);
      take(ui.level === "fan" ? P.f.lo95[h] : P.f.lo80[h]);
    }
    if (lo === Infinity) { lo = 0; hi = 1; }
    if (lo >= 0 && lo < 0.45 * hi) lo = 0;
    const pad = (hi - lo) * 0.08 || 1;
    yScale = { min: lo === 0 ? 0 : lo - pad, max: hi + pad };

    ctx.font = font(11);
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const v of niceTicks(yScale.min, yScale.max, geo.ph > 240 ? 5 : 4)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? C.border : C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(geo.L, y); ctx.lineTo(geo.L + geo.pw, y); ctx.stroke();
      ctx.fillStyle = C.dim; ctx.fillText(compact(v), geo.L - 8, y);
    }
    const tt = timeTicks(V()[0], V()[1], geo.pw);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    const axisY = geo.T + geo.ph;
    ctx.strokeStyle = C.border;
    ctx.beginPath(); ctx.moveTo(geo.L, axisY + 0.5); ctx.lineTo(geo.L + geo.pw, axisY + 0.5); ctx.stroke();
    ctx.fillStyle = C.dim;
    for (const tk of tt.ticks) {
      const x = X(tk.ms);
      if (x < geo.L - 1 || x > geo.L + geo.pw + 1) continue;
      ctx.fillRect(Math.round(x), axisY, 1, 4);
      ctx.fillText(tk.label, x, axisY + 16);
    }
    ctx.font = font(11, 600); ctx.fillStyle = C.text;
    let ctxShown = false;
    for (const mj of tt.majors) {
      const x = X(mj.ms);
      if (x < geo.L || x > geo.L + geo.pw) continue;
      ctx.strokeStyle = C.border;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, axisY); ctx.lineTo(Math.round(x) + 0.5, axisY + 34); ctx.stroke();
      ctx.textAlign = "left"; ctx.fillText(mj.label, x + 4, axisY + 33);
      if (x - geo.L < 70) ctxShown = true;
    }
    if (tt.ctx && !ctxShown) { ctx.textAlign = "left"; ctx.fillText(tt.ctx, geo.L, axisY + 33); }
    ctx.font = font(11);

    ctx.save();
    ctx.beginPath(); ctx.rect(geo.L, geo.T - 6, geo.pw, geo.ph + 6); ctx.clip();
    if (P) {
      const xs = X(T[split - 1]);
      ctx.fillStyle = rgba(C.forecast, 0.05);
      ctx.fillRect(xs, geo.T - 6, geo.L + geo.pw - xs, geo.ph + 6);
    }
    if (a.partial[n - 1]) {
      const xa = X(T[n - 1]), xb = X(bucketStart(s.table, a.g, n));
      ctx.save();
      ctx.beginPath(); ctx.rect(xa, geo.T, xb - xa, geo.ph); ctx.clip();
      ctx.strokeStyle = rgba(C.raw, 0.25);
      for (let x = xa - geo.ph; x < xb; x += 6) { ctx.beginPath(); ctx.moveTo(x, geo.T + geo.ph); ctx.lineTo(x + geo.ph, geo.T); ctx.stroke(); }
      ctx.restore();
    }
    const shift = mode === "explore" || mode === "decompose" ? trendShift(s, ui) : null;
    if (shift) {
      const x = Math.round(X(T[shift.k])) + 0.5;
      ctx.strokeStyle = rgba(C.warn, 0.7); ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, geo.T - 4); ctx.lineTo(x, geo.T + geo.ph); ctx.stroke(); ctx.setLineDash([]);
    }
    const rawEnd = Math.min(n - 1, N - 1);
    const histEnd = P ? split - 1 : N - 1;
    const raw = (i: number): number => a.y[i];
    const emphasis = mode !== "explore" || !ui.showSmooth || (a.g.unit !== "day" && a.g.unit !== "min");
    if (mode === "explore" && ui.lastYear) {
      ctx.strokeStyle = rgba(C.dim, 0.75); ctx.setLineDash([4, 3]); ctx.lineWidth = 1.25;
      linePath(ctx, Math.max(i0, a.g.ly), Math.min(i1, n - 1), (i) => a.y[i - a.g.ly]);
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    // The estimated shift: a straight trend on each side of the break, over the data.
    if (shift) {
      ctx.strokeStyle = C.warn; ctx.lineWidth = 2.5; ctx.setLineDash([7, 4]);
      for (const sg of shift.segs) { ctx.beginPath(); ctx.moveTo(X(T[sg.i0]), Y(sg.at(sg.i0))); ctx.lineTo(X(T[sg.i1]), Y(sg.at(sg.i1))); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = emphasis ? C.text : rgba(C.raw, 0.75);
    ctx.globalAlpha = mode === "explore" && ui.showSmooth && emphasis ? 0.5 : emphasis ? 0.85 : 1;
    ctx.lineWidth = emphasis ? 1.5 : 1;
    linePath(ctx, i0, Math.min(i1, histEnd), raw);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (a.partial[n - 1] && N === n - 1 && !P) {
      ctx.setLineDash([2, 3]); ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(T[n - 2]), Y(a.y[n - 2])); ctx.lineTo(X(T[n - 1]), Y(a.y[n - 1])); ctx.stroke(); ctx.setLineDash([]);
    }
    if (P && split < rawEnd + 1) {
      ctx.strokeStyle = rgba(C.text, 0.45); ctx.lineWidth = 1.25;
      linePath(ctx, Math.max(i0, split - 1), Math.min(i1, rawEnd), raw);
      ctx.stroke();
    }
    if (mode === "explore" && ui.showSmooth) {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2.5;
      linePath(ctx, i0, Math.min(i1, N - 1), (i) => SM[i]);
      ctx.stroke();
    }
    const dec = D.dec;
    if (mode === "decompose" && dec) {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2.5;
      linePath(ctx, i0, Math.min(i1, N - 1), (i) => dec.trend[i]);
      ctx.stroke();
    }
    if (P && s.futures) {
      const xs0 = X(T[split - 1]), y0 = a.yModel[split - 1];
      const xEnd = X(T[split + P.H - 1]);
      const clipX = xs0 + (xEnd - xs0) * reveal;
      ctx.save();
      ctx.beginPath(); ctx.rect(geo.L, geo.T - 6, clipX - geo.L, geo.ph + 6); ctx.clip();
      const band = (blo: Float64Array, bhi: Float64Array, alpha: number): void => {
        const grad = ctx.createLinearGradient(xs0, 0, xEnd, 0);
        grad.addColorStop(0, rgba(C.forecast, alpha));
        grad.addColorStop(1, rgba(C.forecast, alpha * 0.45));
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.moveTo(xs0, Y(y0));
        for (let h = 0; h < P.H; h++) ctx.lineTo(X(T[split + h]), Y(bhi[h]));
        for (let h = P.H - 1; h >= 0; h--) ctx.lineTo(X(T[split + h]), Y(blo[h]));
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(C.forecast, 0.45); ctx.lineWidth = 0.75;
        for (const arr of [bhi, blo]) { ctx.beginPath(); ctx.moveTo(xs0, Y(y0)); for (let h = 0; h < P.H; h++) ctx.lineTo(X(T[split + h]), Y(arr[h])); ctx.stroke(); }
      };
      if (ui.level === "fan") band(P.f.lo95, P.f.hi95, 0.13);
      band(P.f.lo80, P.f.hi80, 0.26);
      if (ghostModel && ghostModel !== P.key) {
        const gf = s.futures[ghostModel];
        ctx.strokeStyle = C.dim; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(xs0, Y(y0)); for (let h = 0; h < P.H; h++) ctx.lineTo(X(T[split + h]), Y(gf.F[h])); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.strokeStyle = C.forecast; ctx.lineWidth = 2.25; ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(xs0, Y(y0)); for (let h = 0; h < P.H; h++) ctx.lineTo(X(T[split + h]), Y(P.f.F[h])); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      if (split < N) {
        for (let h = 0; h < P.H && split + h < N; h++) {
          const v = a.y[split + h];
          if (!(v === v)) continue;
          const out = v < P.f.lo80[h] || v > P.f.hi80[h];
          ctx.beginPath(); ctx.arc(X(T[split + h]), Y(v), out ? 3.6 : 2.4, 0, Math.PI * 2);
          if (out) { ctx.strokeStyle = C.danger; ctx.lineWidth = 1.5; ctx.stroke(); }
          else { ctx.fillStyle = rgba(C.text, 0.6); ctx.fill(); }
        }
      }
    }
    if (i1 - i0 + 1 <= 90) {
      ctx.fillStyle = emphasis ? C.text : C.raw;
      for (let i = i0; i <= Math.min(i1, histEnd); i++) if (a.y[i] === a.y[i] && !a.filled[i]) { ctx.beginPath(); ctx.arc(X(T[i]), Y(a.y[i]), 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
    for (let i = i0; i <= Math.min(i1, n - 1); i++) {
      if (!(a.filled[i] || (a.partial[i] && i === n - 1))) continue;
      if (!(a.y[i] === a.y[i])) continue;
      ctx.beginPath(); ctx.arc(X(T[i]), Y(a.y[i]), 3.4, 0, Math.PI * 2);
      ctx.fillStyle = C.panel; ctx.fill(); ctx.strokeStyle = C.dim; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if ((mode === "explore" || mode === "decompose") && dec) {
      ctx.strokeStyle = C.danger; ctx.lineWidth = 1.75;
      for (const i of D.anomalies) {
        if (i < i0 || i > i1) continue;
        ctx.beginPath(); ctx.arc(X(T[i]), Y(a.y[i]), 6.5, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();

    if (P && M) {
      const xs = X(T[P.T - 1]);
      if (xs >= geo.L && xs <= geo.L + geo.pw) {
        ctx.strokeStyle = C.forecast; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(Math.round(xs) + 0.5, geo.T - 8); ctx.lineTo(Math.round(xs) + 0.5, geo.T + geo.ph); ctx.stroke();
        const label = M.T < a.modelN ? "Backtest from " + shortPeriod(a.g, T[split]) : "Forecast";
        pill(ctx, xs, geo.T - 18, label + "  ⇆", C.forecast, C.panel, "center");
      }
      const xe = X(T[split + P.H - 1]);
      if (xe >= geo.L - 2 && xe <= geo.L + geo.pw + 2) pill(ctx, xe, geo.T + geo.ph - 14, `${P.H} ${P.H === 1 ? a.g.noun : a.g.nouns.split(" ").pop()}  ⇆`, C.panel, C.forecast, "center", C.forecast);
    }
    if (shift) {
      const xs = X(T[shift.k]);
      if (xs >= geo.L && xs <= geo.L + geo.pw) pill(ctx, xs, geo.T - 18, `Trend shift ${shortPeriod(a.g, T[shift.k])}: ${shift.text}`, C.warn, C.panel, xs > geo.L + geo.pw * 0.7 ? "right" : "left");
    }
    if (geo.wide) {
      const labels: { y: number; color: string; text: string; val: string }[] = [];
      const lastIn = (get: (i: number) => number, end: number): { i: number; v: number } | null => { for (let i = Math.min(i1, end); i >= i0; i--) { const v = get(i); if (v === v) return { i, v }; } return null; };
      const word = s.cfg.agg === "count" ? "rows" : s.cfg.measure ?? "";
      const r = lastIn(raw, histEnd);
      if (r) labels.push({ y: Y(r.v), color: emphasis ? C.text : C.dim, text: word.length > 18 ? word.slice(0, 17) + "…" : word, val: compact(r.v) });
      if (mode === "explore" && ui.showSmooth) { const sm = lastIn((i) => SM[i], N - 1); if (sm) labels.push({ y: Y(sm.v), color: C.accent, text: `${s.cfg.smoothW}-${a.g.noun.split(" ").pop()} ${s.cfg.smoothStat}`, val: compact(sm.v) }); }
      if (mode === "decompose" && dec) { const tr = lastIn((i) => dec.trend[i], N - 1); if (tr) labels.push({ y: Y(tr.v), color: C.accent, text: "Trend", val: compact(tr.v) }); }
      if (P) {
        const h = Math.min(P.H - 1, Math.max(0, i1 - split));
        if (split + h >= i0) labels.push({ y: Y(P.f.F[h]), color: C.forecast, text: "Forecast " + shortPeriod(a.g, T[split + h]), val: compact(P.f.F[h]) });
      }
      labels.sort((p, q) => p.y - q.y);
      for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 30) labels[k].y = labels[k - 1].y + 30;
      const x = geo.L + geo.pw + 10;
      for (const lb of labels) {
        ctx.textAlign = "left"; ctx.fillStyle = lb.color;
        ctx.font = font(11); ctx.fillText(lb.text, x, lb.y - 3);
        ctx.font = font(13, 600); ctx.fillText(lb.val, x, lb.y + 12);
      }
    }
  }
  function compose(now: number): void {
    const ctx = heroCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, heroCanvas.width, heroCanvas.height);
    if (fade) {
      const t = Math.min(1, (now - fade.start) / 200);
      ctx.globalAlpha = t; ctx.drawImage(heroBuf, 0, 0);
      ctx.globalAlpha = 1 - t; ctx.drawImage(fade.canvas, 0, 0);
      ctx.globalAlpha = 1;
      if (t >= 1) fade = null;
    } else ctx.drawImage(heroBuf, 0, 0);
  }
  function startFade(): void {
    if (reduceMotion.matches || !heroCanvas.width) return;
    const c = document.createElement("canvas");
    c.width = heroCanvas.width; c.height = heroCanvas.height;
    c.getContext("2d")?.drawImage(heroCanvas, 0, 0);
    fade = { canvas: c, start: performance.now() };
  }

  // ---------------------------------------------------------------- hero overlay and readout
  function renderOverlay(now: number): void {
    const ctx = heroOverlay.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    ctx.clearRect(0, 0, geo.w, geo.h);
    if (!snap) return;
    const a = snap.A, T = times();
    if (drag && drag.kind === "box" && drag.x1 != null) {
      const left = Math.min(drag.x0, drag.x1), w = Math.abs(drag.x1 - drag.x0);
      ctx.fillStyle = rgba(C.accent, 0.12); ctx.fillRect(left, geo.T, w, geo.ph);
      ctx.strokeStyle = rgba(C.accent, 0.6); ctx.lineWidth = 1; ctx.strokeRect(Math.round(left) + 0.5, geo.T + 0.5, Math.round(w), geo.ph - 1);
    }
    if (pulse) {
      const t = Math.max(0, (now - pulse.start) / 1600);
      if (t >= 1) pulse = null;
      else {
        const ph = (t * 2) % 1;
        ctx.strokeStyle = rgba(C.danger, 1 - ph); ctx.lineWidth = 2;
        for (const i of pulse.indices) {
          const x = X(T[i]); if (x < geo.L || x > geo.L + geo.pw) continue;
          ctx.beginPath(); ctx.arc(x, Y(a.y[i]), 8 + 10 * ph, 0, Math.PI * 2); ctx.stroke();
        }
        if (pulse.rule != null) { const x = X(T[pulse.rule]); ctx.fillStyle = rgba(C.accent, 0.18 * (1 - t)); ctx.fillRect(x - 10, geo.T, 20, geo.ph); }
      }
    }
    if (ui.mode === "decompose") renderDecOverlay();
    if (hoverIdx < 0) { readoutEl.hidden = true; return; }
    const i = hoverIdx, x = X(T[i]);
    if (x < geo.L - 1 || x > geo.L + geo.pw + 1) { readoutEl.hidden = true; return; }
    ctx.strokeStyle = rgba(C.text, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, geo.T - 4); ctx.lineTo(Math.round(x) + 0.5, geo.T + geo.ph); ctx.stroke();
    const dot = (v: number, color: string): void => { if (!(v === v)) return; ctx.beginPath(); ctx.arc(x, Y(v), 4.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = C.panel; ctx.lineWidth = 2; ctx.stroke(); };
    const P = proj();
    const h = P ? i - P.T : -1;
    if (i < a.n) dot(a.y[i], C.text);
    if (ui.mode === "explore" && ui.showSmooth && i < a.modelN) dot(snap.smooth[i], C.accent);
    if (ui.mode === "decompose" && snap.dec.dec && i < a.modelN) dot(snap.dec.dec.trend[i], C.accent);
    if (P && h >= 0 && h < P.H) dot(P.f.F[h], C.forecast);
    renderReadout(i, x);
  }
  function renderReadout(i: number, x: number): void {
    const s = snap as TsSnapshot, a = s.A, gr = a.g, T = times(), cfgNow = s.cfg;
    const rows: [string | null, string, string][] = [];
    const P = proj();
    const h = P ? i - P.T : -1;
    const inP = !!P && h >= 0 && h < P.H;
    let note = "";
    if (i < a.n) {
      const v = a.y[i];
      rows.push([C.text, measureWord(s), full(v)]);
      if (ui.mode === "explore" && ui.showSmooth && i < a.modelN) rows.push([C.accent, `${cfgNow.smoothW}-${gr.noun.split(" ").pop()} ${cfgNow.smoothStat}`, full(s.smooth[i])]);
      const cp1 = i > 0 ? chg(s, v, a.y[i - 1]) : null, cpy = i - gr.ly >= 0 ? chg(s, v, a.y[i - gr.ly]) : null;
      if (!inP && cp1) rows.push([null, "vs previous", cp1.text]);
      if (!inP && cpy) rows.push([null, `vs ${gr.lyAgo}`, cpy.text]);
      const dec = s.dec.dec;
      if (ui.mode === "decompose" && dec && i < a.modelN) {
        rows.push([C.accent, "Trend", full(dec.trend[i])]);
        rows.push([null, "Seasonal", signed(dec.seasonal[i])]);
        rows.push([null, "Remainder", signed(dec.rem[i])]);
      }
      const fill = cfgNow.gaps === "zero" ? "filled with zero" : cfgNow.gaps === "seasonal" ? "filled with the usual pattern" : "interpolated";
      if (a.filled[i]) note = `No rows in this ${gr.noun}; ${fill}.`;
      else if (!(a.y[i] === a.y[i])) note = `No rows in this ${gr.noun}.`;
      else if (a.partial[i]) note = `Partial ${gr.noun}: the data covers about ${Math.round(a.partShare[i] * 100)}% of it.`;
      else if (a.coverage[i] < 0.9) note = `${a.missing[i]} of ${Math.round(a.expected[i])} expected slots have no rows.`;
      if ((ui.mode === "explore" || ui.mode === "decompose") && dec && s.dec.anomalies.includes(i)) note = (note ? note + " " : "") + `<span class="ts-flag">Unusual: ${chg(s, a.y[i], dec.trend[i] + dec.seasonal[i])?.text ?? "–"} vs expected.</span>`;
    }
    if (inP && P) {
      rows.push([C.forecast, "Forecast", full(P.f.F[h])]);
      rows.push([null, "80% range", `${compact(P.f.lo80[h])} to ${compact(P.f.hi80[h])}`]);
      if (ui.level === "fan") rows.push([null, "95% range", `${compact(P.f.lo95[h])} to ${compact(P.f.hi95[h])}`]);
      if (i < a.modelN && a.y[i] === a.y[i]) note = `Held out: actual ${full(a.y[i])}, ${a.y[i] >= P.f.lo80[h] && a.y[i] <= P.f.hi80[h] ? "inside" : "outside"} the 80% band.`;
    }
    const rowsHtml = rows.map(([c, k, v]) => `<div class="ts-row"><span>${c ? `<i class="ts-sw" style="background:${c}"></i>` : ""}${k}</span><span>${v}</span></div>`).join("");
    const click = i < a.n ? `<div class="ts-rnote">Click to show these ${nf.format(a.rows[i])} rows in the Table.</div>` : "";
    readoutEl.innerHTML = `<h4>${periodLabel(gr, T[i])}</h4>${rowsHtml}${note ? `<div class="ts-rnote">${note}</div>` : ""}${click}`;
    readoutEl.hidden = false;
    const rw = readoutEl.offsetWidth;
    let left = x + 14;
    if (left + rw > geo.w - 4) left = x - rw - 14;
    readoutEl.style.transform = `translate(${Math.round(Math.max(4, left))}px, ${Math.round(geo.T)}px)`;
  }

  // ---------------------------------------------------------------- navigator
  function renderNav(): void {
    const r = (navCanvas.parentElement as HTMLElement).getBoundingClientRect();
    const w = r.width, h = r.height;
    const ctx = navCanvas.getContext("2d");
    if (!ctx || !snap) return;
    ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const a = snap.A, T = times();
    const [d0, d1] = fullView();
    const nx = (ms: number): number => ((ms - d0) / (d1 - d0)) * w;
    let hi = -Infinity;
    for (let i = 0; i < a.n; i++) { const v = a.y[i]; if (v === v) hi = Math.max(hi, v); }
    const P = proj();
    if (P) for (let k = 0; k < P.H; k++) hi = Math.max(hi, P.f.F[k]);
    const ny = (v: number): number => h - 3 - (v / (hi || 1)) * (h - 8);
    ctx.fillStyle = C.panel2;
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(nx(T[0]), h);
    for (let i = 0; i < a.n; i++) if (a.y[i] === a.y[i]) ctx.lineTo(nx(T[i]), ny(a.y[i]));
    ctx.lineTo(nx(T[a.n - 1]), h); ctx.closePath();
    ctx.fillStyle = rgba(C.accent, 0.22); ctx.fill();
    if (P) {
      ctx.strokeStyle = C.forecast; ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.moveTo(nx(T[P.T - 1]), ny(a.yModel[P.T - 1]));
      for (let k = 0; k < P.H; k++) ctx.lineTo(nx(T[P.T + k]), ny(P.f.F[k]));
      ctx.stroke(); ctx.setLineDash([]);
    }
    const v = V(), left = Math.max(0, nx(v[0])), right = Math.min(w, nx(v[1]));
    ctx.fillStyle = rgba(C.bg, 0.6);
    ctx.fillRect(0, 0, left, h); ctx.fillRect(right, 0, w - right, h);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(left + 0.75, 0.75, Math.max(4, right - left - 1.5), h - 1.5, 5); ctx.stroke();
    ctx.fillStyle = C.accent;
    for (const x of [left, right]) { ctx.beginPath(); ctx.roundRect(x - 2.5, h / 2 - 9, 5, 18, 2.5); ctx.fill(); }
  }

  // ---------------------------------------------------------------- decomposition rows
  let decRows: DecRow[] | null = null;
  function renderDec(): void {
    if (ui.mode !== "decompose" || !snap) return;
    const r = (decCanvas.parentElement as HTMLElement).getBoundingClientRect();
    if (!r.width) return;
    const ctx = decCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const s = snap, d = s.dec.dec, a = s.A;
    if (!d) { ctx.fillStyle = C.dim; ctx.font = font(13); ctx.fillText(`Needs at least two full seasons of ${a.g.nouns} to separate trend from season.`, 16, 30); return; }
    const T = times(), N = a.modelN;
    const [i0, i1] = visibleRange();
    const parts = d.parts;
    const rowsDef: DecRow[] = [
      { name: "Trend", get: (i) => d.trend[i], color: C.accent, kind: "line" },
      ...(parts
        ? [{ name: "Daily cycle", get: (i: number) => parts.daily[i % parts.pd], color: C.forecast, kind: "line" as const, zero: true },
           { name: "Day of week, on top of the daily cycle", get: (i: number) => parts.weekly[i % (7 * parts.pd)], color: C.season2, kind: "line" as const, zero: true }]
        : [{ name: `Seasonal · ${seasonName(a.g, d)}`, get: (i: number) => d.seasonal[i], color: C.forecast, kind: "line" as const, zero: true }]),
      { name: "Remainder", get: (i) => d.rem[i], color: C.raw, kind: "bars", zero: true },
    ];
    const nr = rowsDef.length, gap = 10, top = 4, rh = (r.height - top - gap * (nr - 1) - 4) / nr;
    const z = s.dec.z;
    rowsDef.forEach((row, k) => {
      const y0 = top + k * (rh + gap);
      let lo = Infinity, hi = -Infinity;
      for (let i = i0; i <= Math.min(i1, N - 1); i++) { const v = row.get(i); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (row.kind === "bars") { const lim = s.cfg.sens * s.dec.mad; lo = Math.min(lo, -lim); hi = Math.max(hi, lim); }
      if (row.zero) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; }
      const padv = (hi - lo) * 0.1 || 1; lo -= padv; hi += padv;
      const yy = (v: number): number => y0 + rh - ((v - lo) / (hi - lo)) * rh;
      ctx.fillStyle = C.panel2; ctx.fillRect(geo.L, y0, geo.pw, rh);
      ctx.fillStyle = C.dim; ctx.font = font(11, 600); ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(row.name, geo.L + 8, y0 + 6);
      ctx.font = font(11); ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(compact(hi - padv), geo.L - 8, yy(hi - padv)); ctx.fillText(compact(lo + padv), geo.L - 8, yy(lo + padv));
      ctx.save(); ctx.beginPath(); ctx.rect(geo.L, y0, geo.pw, rh); ctx.clip();
      if (row.zero) { ctx.strokeStyle = C.border; ctx.beginPath(); ctx.moveTo(geo.L, Math.round(yy(0)) + 0.5); ctx.lineTo(geo.L + geo.pw, Math.round(yy(0)) + 0.5); ctx.stroke(); }
      if (row.kind === "bars") {
        const lim = s.cfg.sens * s.dec.mad;
        ctx.fillStyle = rgba(C.danger, 0.06);
        ctx.fillRect(geo.L, y0, geo.pw, yy(lim) - y0);
        ctx.fillRect(geo.L, yy(-lim), geo.pw, y0 + rh - yy(-lim));
        const bw = Math.max(1, Math.min(6, (geo.pw / (i1 - i0 + 1)) * 0.7));
        for (let i = i0; i <= Math.min(i1, N - 1); i++) {
          const v = row.get(i), x = X(T[i]);
          ctx.fillStyle = z && Math.abs(z[i]) >= s.cfg.sens ? C.danger : rgba(C.raw, 0.8);
          const p = yy(0), q = yy(v);
          ctx.fillRect(x - bw / 2, Math.min(p, q), bw, Math.max(1, Math.abs(q - p)));
        }
      } else {
        ctx.strokeStyle = row.color; ctx.lineWidth = 2;
        let open = false; ctx.beginPath();
        for (let i = i0; i <= Math.min(i1, N - 1); i++) { const x = X(T[i]), y = yy(row.get(i)); if (open) ctx.lineTo(x, y); else ctx.moveTo(x, y); open = true; }
        ctx.stroke();
      }
      ctx.restore();
      row.yy = yy;
    });
    decRows = rowsDef;
    ctx.textBaseline = "alphabetic";
  }
  function renderDecOverlay(): void {
    const r = (decOverlay.parentElement as HTMLElement).getBoundingClientRect();
    const ctx = decOverlay.getContext("2d");
    if (!r.width || !ctx || !snap) return;
    ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    if (hoverIdx < 0 || !decRows || hoverIdx >= snap.A.modelN) return;
    const x = X(times()[hoverIdx]);
    if (x < geo.L || x > geo.L + geo.pw) return;
    ctx.strokeStyle = rgba(C.text, 0.35);
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, r.height); ctx.stroke();
    for (const row of decRows) {
      if (!row.yy) continue;
      ctx.beginPath(); ctx.arc(x, row.yy(row.get(hoverIdx)), 4, 0, Math.PI * 2);
      ctx.fillStyle = row.kind === "bars" ? C.text : row.color; ctx.fill();
      ctx.strokeStyle = C.panel; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- tokens and panels
  function tokenOpts(key: TokenKey): [string, string, string?][] {
    const s = snap as TsSnapshot, info = s.table;
    switch (key) {
      case "grain": return GRAIN_ORDER.map((id) => [id, GRAINS[id].adj]);
      case "agg": return AGG_OPTS;
      case "measure": return info.columns.map((c) => [c.name, c.name, c.timeLike ? "counts time" : c.flag ? "0/1" : ""]);
      case "group": return [["-1", "all"], ...info.groups.map((r, k): [string, string] => [String(k), r])];
      case "gaps": return GAP_OPTS;
      case "partial": return [["exclude", "left out", `${s.A.g.noun} left out of models`], ["include", "kept", "treated as complete"]];
      case "date": return dateColumns().map((i) => [String(i), metas[i].name]);
      case "groupBy": return [["-1", "nothing"], ...groupColumns().map((i): [string, string, string] => [String(i), metas[i].name, `${metas[i].stats.distinct} values`])];
    }
  }
  function tokValue(key: TokenKey): string {
    const c = cfg as TsConfig;
    switch (key) {
      case "grain": return c.grain;
      case "agg": return c.agg;
      case "measure": return c.measure ?? "";
      case "group": return String(c.group);
      case "gaps": return c.gaps;
      case "partial": return c.partial;
      case "date": return String(dateColumn);
      case "groupBy": return String(groupColumn);
    }
  }
  function tokText(key: TokenKey): string { const o = tokenOpts(key).find((x) => x[0] === tokValue(key)); return escapeHtml(o ? o[1] : ""); }
  const tok = (key: TokenKey): string => `<button type="button" class="ts-tok" data-tok="${key}" aria-haspopup="menu">${tokText(key)}</button>`;

  function renderUI(): void {
    if (!snap) return;
    const s = snap, a = s.A, gr = a.g, info = s.table, c = s.cfg;
    host.dataset.mode = ui.mode;
    const count = c.agg === "count";
    ref("sentence").innerHTML = `${tok("grain")} ${tok("agg")}${count ? "" : ` of ${tok("measure")}`}${info.groups.length > 1 ? ` for ${escapeHtml(info.groupCol ?? "")} ${tok("group")}` : ""}`;
    ref("subline").innerHTML = `Dates from ${tok("date")} · split by ${tok("groupBy")} · ${nf.format(info.rows)} rows · ${dfDate.format(new Date(info.firstMs))} to ${dfDate.format(new Date(info.lastMs))} · gaps ${tok("gaps")} · partial last ${gr.noun} ${tok("partial")}`;
    const across = c.group < 0 && info.groups.length > 1 && !count && c.agg === "sum" ? ` That adds all ${info.groups.length} ${escapeHtml(info.groupCol ?? "")} values together; pick one if they measure the same thing.` : "";
    ref("why").innerHTML = `Each ${gr.noun} is ${count ? "the number of rows that fall in it" : c.agg === "twmean" ? "the mean of the readings in it, each counted for as long as it held (until the next reading, at most three usual spacings)" : `the ${c.agg} of the rows that fall in it`}.${across} Click any highlighted word to change it. Uses the rows the Table's filters leave.`;
    heroOverlay.setAttribute("aria-label", `${ref("sentence").textContent ?? ""}. Left and right arrows step through periods, Enter shows the rows.`);

    const N = a.modelN, d = s.dec.dec;
    let li = N - 1;
    while (li > 0 && !(a.y[li] === a.y[li])) li--;
    const v = a.y[li], prev = a.y[li - 1], ly = li - gr.ly >= 0 ? a.y[li - gr.ly] : NaN;
    const chip = (x: { v: number; text: string } | null): string => (x ? `<span class="ts-pill ${x.v > 0 ? "up" : x.v < 0 ? "down" : "flat"}">${x.text}</span>` : "");
    const cells: [string, string][] = [
      ["Periods", `${nf.format(a.n)} <small>${gr.nouns}${a.partial[a.n - 1] ? ", last partial" : ""}</small>`],
      [`Latest full ${gr.noun}`, `${compact(v)} ${chip(chg(s, v, prev))}`],
      [`vs ${gr.lyAgo}`, Number.isFinite(ly) ? `${chip(chg(s, v, ly))} <small>${compact(ly)}</small>` : "<small>not enough history</small>"],
    ];
    const cp = s.dec.cp;
    if (cp && cp.gain > 0.5) {
      const months = (rate: number, mean: number): string => {
        const perMonth = rate * (gr.perYear / 12);
        return a.allPositive && mean > 0 ? `${pct(perMonth / mean, 1)} <small>a month</small>` : `${signed(perMonth)} <small>a month</small>`;
      };
      cells.push(["Trend now", `${months(cp.after.slope, cp.after.mean)} <small>since ${dfMonShort.format(new Date(a.t[cp.k]))}</small>`]);
    } else if (d) {
      const m = Math.max(1, (a.t[N - 1] - a.t[0]) / (30.44 * DAY));
      cells.push(["Trend", `${a.allPositive && d.trend[0] > 0 ? pct(Math.pow(d.trend[N - 1] / d.trend[0], 1 / m) - 1, 1) : signed((d.trend[N - 1] - d.trend[0]) / m)} <small>a month</small>`]);
    }
    if (d) cells.push(["Season", `${seasonName(gr, d).replace(/^./, (ch) => ch.toUpperCase())} <small>strength ${d.fs.toFixed(2)}</small>`]);
    const key = selectedModel(s, ui);
    if (key) {
      const r = ratioOf(s, key), gd = grade(r, key);
      cells.push(["Forecast", `<span class="ts-pill ${gd.cls}">${gd.text}</span> <small>${key === "sn" ? "baseline" : (r - 1 >= 0 ? "+" : "−") + Math.abs((r - 1) * 100).toFixed(0) + "% error vs naive"}</small>`]);
    }
    ref("strip").innerHTML = cells.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join("");

    const lg = [`<span style="color:${C.text}"><i></i>${measureWord(s)}</span>`];
    if (ui.mode === "explore" && ui.showSmooth) lg.push(`<span style="color:${C.accent}"><i></i>Rolling ${c.smoothStat}</span>`);
    if (ui.mode === "explore" && ui.lastYear) lg.push(`<span style="color:${C.dim}"><i class="dash"></i>${gr.lyShort}</span>`);
    if (ui.mode === "decompose") lg.push(`<span style="color:${C.accent}"><i></i>Trend</span>`);
    if ((ui.mode === "explore" || ui.mode === "decompose") && trendShift(s, ui)) lg.push(`<span style="color:${C.warn}"><i class="dash"></i>Trend shift (estimated)</span>`);
    if ((ui.mode === "explore" || ui.mode === "decompose") && s.dec.anomalies.length) lg.push(`<span style="color:${C.danger}">◯ Unusual</span>`);
    if (ui.mode === "forecast" && s.futures) lg.push(`<span style="color:${C.forecast}"><i class="dash"></i>Forecast</span><span style="color:${C.forecast}"><i class="band"></i>${ui.level === "fan" ? "80% and 95%" : "80%"} range</span>`);
    if (a.filled.some((x) => x)) lg.push(`<span style="color:${C.dim}">○ Filled</span>`);
    ref("legend").innerHTML = lg.join("");
    ref("insights").innerHTML = INS.map((it, k) => `
      <article class="ts-insight">
        <div class="ts-kick"><i style="background:${toneColor(it.tone)}"></i>${escapeHtml(it.kind)}</div>
        <p>${it.html}</p>
        ${it.meter != null ? `<div class="ts-mini" title="${it.meterLabel ?? ""} ${it.meter.toFixed(2)}"><i style="width:${(it.meter * 100).toFixed(0)}%;background:${toneColor(it.tone)}"></i></div>` : ""}
        ${it.acts.length ? `<div class="ts-acts">${it.acts.map((x, j) => `<button type="button" data-ins="${k}:${j}">${escapeHtml(x.label)}</button>`).join("")}</div>` : ""}
      </article>`).join("");
    renderModePanel();
    if (tableOpen) renderTable();
  }
  const numUnit = (k: number): string => (snap ? nounFor(snap.A.g, k).split(" ").pop() ?? "" : "");
  function setNum(name: string, v: number, max: number): void {
    const el = ref<HTMLInputElement>(name);
    el.max = String(max);
    if (document.activeElement !== el) el.value = String(v);
  }
  function maxSmooth(): number { const a = A(); return Math.max(a.g.smoothMax, Math.floor(a.modelN / 2)); }
  function renderModePanel(): void {
    const s = snap as TsSnapshot, a = s.A, gr = a.g, c = s.cfg;
    for (const p of host.querySelectorAll<HTMLElement>("[data-panel]")) p.hidden = p.dataset.panel !== ui.mode;
    for (const b of host.querySelectorAll<HTMLButtonElement>(".ts-modes [data-mode]")) { const on = b.dataset.mode === ui.mode; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
    for (const tb of host.querySelectorAll<HTMLElement>(".ts-tb")) tb.hidden = tb.dataset.for !== ui.mode;
    // Range presets follow the grain: days to months below a day, months to years above.
    const pr = ref("presets");
    if (pr.dataset.grain !== gr.id) {
      pr.dataset.grain = gr.id;
      pr.innerHTML = [...gr.presets, ["All", 0] as const].map(([label, days]) => `<button type="button" data-span="${days}" aria-pressed="${days === 0}">${label}</button>`).join("");
    }
    if (ui.mode === "explore") {
      const w = ref<HTMLInputElement>("smoothW");
      w.max = String(gr.smoothMax); w.value = String(c.smoothW);
      setNum("smoothWNum", c.smoothW, maxSmooth());
      ref("smoothWUnit").textContent = numUnit(c.smoothW);
      ref<HTMLInputElement>("smoothCentred").checked = c.smoothCentred;
      ref<HTMLInputElement>("lastYear").checked = ui.lastYear;
      ref<HTMLInputElement>("showShift").checked = ui.showShift;
      ref("shiftWrap").hidden = !(s.dec.cp && s.dec.cp.gain > 0.5);
      ref("lastYearText").textContent = gr.lyText;
      for (const b of ref("statSeg").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.stat === c.smoothStat));
      const filled = a.filled.reduce((sum, x) => sum + x, 0);
      const steps = [
        { id: "resample", name: "Resample", val: `${gr.adj} ${tokText("agg")}`, on: true },
        { id: "fill", name: "Fill", val: filled ? `${filled} ${nounFor(gr, filled)} ${tokText("gaps")}` : "No missing periods", on: true },
        { id: "smooth", name: "Smooth", val: `${c.smoothW}-${gr.noun.split(" ").pop()} ${c.smoothStat}`, on: ui.showSmooth },
        { id: "compare", name: "Compare", val: gr.lyText, on: ui.lastYear },
      ];
      const ol = ref("pipeline");
      if (ol.children.length !== 4) ol.innerHTML = steps.map((st) => `<li><button type="button" class="ts-step" data-step="${st.id}"><span class="ts-step-name">${st.name}</span><span class="ts-step-val"></span><canvas></canvas></button></li>`).join("");
      steps.forEach((st, k) => {
        const btn = ol.children[k].querySelector("button") as HTMLButtonElement;
        btn.setAttribute("aria-pressed", String(st.on));
        (btn.querySelector(".ts-step-val") as HTMLElement).innerHTML = st.val;
        drawSpark(btn.querySelector("canvas") as HTMLCanvasElement, st.id);
      });
    }
    if (ui.mode === "decompose") {
      const d = s.dec.dec;
      ref("periodSeg").innerHTML = s.dec.options.map((o) => `<button type="button" data-period="${o.m}" aria-pressed="${!!d && o.m === d.m}">${seasonName(gr, o).replace(/^./, (ch) => ch.toUpperCase())} <small>${o.fs.toFixed(2)}</small></button>`).join("") || `<span class="ts-note">No seasonal period fits this series.</span>`;
      ref("meters").innerHTML = d ? ([["Trend strength", d.ft], [`Seasonal strength (${seasonName(gr, d)})`, d.fs], [`Unusual ${gr.nouns}`, null]] as [string, number | null][]).map(([k, val]) => val == null
        ? `<div class="ts-meter"><span>${k} <b>${s.dec.anomalyCount}</b></span><div class="ts-bar"><i style="width:${Math.min(100, s.dec.anomalyCount * 10)}%;background:${C.danger}"></i></div></div>`
        : `<div class="ts-meter"><span>${k} <b>${val.toFixed(2)}</b></span><div class="ts-bar"><i style="width:${(val * 100).toFixed(0)}%"></i></div></div>`).join("") : "";
      ref<HTMLInputElement>("sens").value = String(c.sens);
      ref("sensOut").textContent = c.sens <= 3 ? "More" : c.sens >= 5 ? "Fewer" : "Balanced";
    }
    if (ui.mode === "forecast") {
      const H = s.H, hMax = s.maxH;
      setNum("hNum", H, hMax);
      ref("hMax").textContent = `up to ${nf.format(hMax)} ${numUnit(hMax)}${gr.days < 1 && hMax * gr.days >= 2 ? ` (${Math.floor(hMax * gr.days)} days)` : ""}`;
      ref("hMax").title = "The furthest ahead this history can test: each forecast is checked against what happened after earlier dates, which needs more history than the forecast is long.";
      ref("hUnit").textContent = numUnit(H);
      ref("hPresets").innerHTML = [...gr.hPresets.filter(([, n]) => n < hMax), ["Longest", hMax] as const].map(([label, n]) => `<button type="button" data-h="${n}" aria-pressed="${n === H}">${label}</button>`).join("");
      for (const b of ref("levelSeg").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.level === ui.level));
      ref<HTMLInputElement>("flex").value = String(c.flex);
      ref("flexOut").textContent = c.flex <= 3 ? "Stiff" : c.flex >= 8 ? "Bendy" : "Medium";
      renderDrivers();
      const M = models();
      ref("splitReset").hidden = !(M && M.T < a.modelN);
      // The training period: everything before the split line.
      ref("trainNote").textContent = M ? `Learns from ${shortPeriod(gr, a.t[0])} to ${shortPeriod(gr, a.t[M.T - 1])}${M.T < a.modelN ? " (drag the split line to change)" : ""}` : "";
      renderBoard();
    }
    if (ui.mode === "patterns") renderPatterns();
  }
  function drawSpark(cv: HTMLCanvasElement, id: string): void {
    const r = cv.getBoundingClientRect();
    const ctx = cv.getContext("2d");
    if (!r.width || !ctx || !snap) return;
    sizeCanvas(cv, r.width, r.height, geo.dpr);
    ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const a = snap.A, SM = snap.smooth, n = a.modelN;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const v = a.y[i]; if (v === v) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    const sx = (i: number): number => (i / Math.max(1, n - 1)) * (r.width - 2) + 1, sy = (v: number): number => r.height - 2 - ((v - lo) / (hi - lo || 1)) * (r.height - 4);
    const line = (get: (i: number) => number, color: string, w: number, from = 0): void => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
      let open = false;
      for (let i = from; i < n; i++) { const v = get(i); if (!(v === v)) { open = false; continue; } if (open) ctx.lineTo(sx(i), sy(v)); else ctx.moveTo(sx(i), sy(v)); open = true; }
      ctx.stroke();
    };
    if (id === "resample") line((i) => a.y[i], C.text, 1);
    if (id === "fill") { line((i) => a.y[i], rgba(C.raw, 0.7), 1); ctx.fillStyle = C.danger; for (let i = 0; i < n; i++) if (a.filled[i] || a.coverage[i] < 0.9) { ctx.beginPath(); ctx.arc(sx(i), sy(a.y[i] === a.y[i] ? a.y[i] : lo), 2.2, 0, Math.PI * 2); ctx.fill(); } }
    if (id === "smooth") { line((i) => a.y[i], rgba(C.raw, 0.5), 1); line((i) => SM[i], C.accent, 1.75); }
    if (id === "compare") { line((i) => a.y[i], rgba(C.raw, 0.6), 1, a.g.ly); ctx.setLineDash([3, 2]); line((i) => (i - a.g.ly >= 0 ? a.y[i - a.g.ly] : NaN), C.dim, 1, a.g.ly); ctx.setLineDash([]); }
  }
  function renderBoard(): void {
    const s = snap as TsSnapshot, board = ref("board"), card = ref("modelCard");
    const M = models();
    if (!M || !s.futures) { board.innerHTML = `<tbody><tr><td class="ts-emptycell">${"error" in s.models ? escapeHtml(s.models.error) : ""}</td></tr></tbody>`; card.innerHTML = ""; return; }
    const sel = selectedModel(s, ui) as ModelKey, fut = s.futures;
    const heldMode = M.T < s.A.modelN && fut.sn.held?.ratio != null;
    const maxR = Math.max(...MODEL_KEYS.map((k) => ratioOf(s, k)), 1);
    const keys = [...MODEL_KEYS].sort((p, q) => ratioOf(s, p) - ratioOf(s, q));
    board.innerHTML = `<thead><tr><th>Model</th><th>${heldMode ? "Held-out" : "Backtest"} error vs repeat-last-cycle</th><th>Grade</th><th>${heldMode ? "Held-out check" : "Band check"}</th></tr></thead><tbody>` +
      keys.map((k) => {
        const m = M.models[k], r = ratioOf(s, k), gd = grade(r, k), f = fut[k];
        const chk = f.held ? `${f.held.hit} of ${f.held.tot} inside 80%` : m.check ? `${m.check.hit} of ${m.check.tot} inside 80%` : "–";
        return `<tr data-model="${k}" aria-selected="${k === sel}">
          <td><span class="ts-mname">${MODEL_INFO[k].name}</span>${k === M.best && ui.model === "auto" ? `<span class="ts-auto">Auto</span>` : ""}<span class="ts-mmeth">${MODEL_INFO[k].meth}</span></td>
          <td><span class="ts-errbar" style="width:${Math.max(4, (r / maxR) * 90).toFixed(0)}px;opacity:${k === "sn" ? 0.35 : 0.85}"></span>${r.toFixed(2)}×${heldMode ? ` <small>backtest ${m.ratio.toFixed(2)}×</small>` : ""}</td>
          <td><span class="ts-pill ${gd.cls}">${gd.text}</span></td>
          <td>${chk}</td></tr>`;
      }).join("") + "</tbody>";
    card.innerHTML = modelRows(s, sel).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }
  function renderDrivers(): void {
    const s = snap as TsSnapshot;
    const label = (d: TsConfig["drivers"][number]): string => (d.rule === "lastyear" ? `as ${s.A.g.lyShort.toLowerCase()}` : d.rule === "pct" ? `${d.pct >= 0 ? "+" : "−"}${Math.abs(d.pct)}%` : "held");
    const chips = s.cfg.drivers.map((d, k) => `<button type="button" class="ts-drv" data-drv="${k}" aria-haspopup="menu"><b>${escapeHtml(d.col)}</b> <span>· ${label(d)}</span> ▾</button>`);
    chips.push(`<button type="button" class="ts-drv add" data-drv="add" aria-haspopup="menu">+ Add column</button>`);
    ref("drivers").innerHTML = chips.join("");
  }
  function renderPatterns(): void {
    const s = snap as TsSnapshot;
    const grid = ref("patGrid");
    if (!s.patterns) { grid.innerHTML = `<p class="ts-patempty">Working out the typical day and week…</p>`; ref("patFacts").innerHTML = ""; return; }
    const { facts, figures } = patternsHtml(s.patterns, measureWord(s), grid.clientWidth || 900, s.table.cadence, s.table.end - s.table.start);
    ref("patFacts").innerHTML = facts;
    grid.innerHTML = figures;
  }
  function renderTable(): void {
    const s = snap as TsSnapshot, a = s.A, wrap = ref("tableWrap");
    const T = times(), [i0, i1] = visibleRange();
    const P = proj();
    const lbl = P ? ["Forecast", "80% low", "80% high"] : [];
    const dec = s.dec.dec;
    const head = `<tr><th>Period</th><th>${measureWord(s)}</th>${ui.mode === "explore" ? "<th>Rolling</th>" : ""}${ui.mode === "decompose" ? "<th>Trend</th><th>Seasonal</th><th>Remainder</th>" : ""}${lbl.map((l) => `<th>${l}</th>`).join("")}</tr>`;
    const rows: string[] = [];
    for (let i = i0; i <= i1 && rows.length < 400; i++) {
      const h = P ? i - P.T : -1, inP = !!P && h >= 0 && h < P.H;
      let tail = "";
      if (P) tail = inP ? `<td>${full(P.f.F[h])}</td><td>${full(P.f.lo80[h])}</td><td>${full(P.f.hi80[h])}</td>` : "<td></td><td></td><td></td>";
      rows.push(`<tr><td>${periodLabel(a.g, T[i])}</td><td>${i < a.n ? full(a.y[i]) : ""}</td>` +
        (ui.mode === "explore" ? `<td>${i < a.modelN ? full(s.smooth[i]) : ""}</td>` : "") +
        (ui.mode === "decompose" ? (dec && i < a.modelN ? `<td>${full(dec.trend[i])}</td><td>${full(dec.seasonal[i])}</td><td>${full(dec.rem[i])}</td>` : "<td></td><td></td><td></td>") : "") + tail + "</tr>");
    }
    wrap.innerHTML = `<table><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
  }

  // ---------------------------------------------------------------- frame loop
  const need = { ui: false, stat: false, nav: false, panel: false, ov: false, table: false };
  let raf = 0;
  function invalidate(...keys: (keyof typeof need)[]): void {
    for (const k of keys) need[k] = true;
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }
  function frame(now: number): void {
    raf = 0;
    if (!snap || !visible) return;
    if (viewAnim) {
      const t = Math.min(1, (now - viewAnim.start) / viewAnim.dur);
      const e = 1 - Math.pow(1 - t, 3);
      view = [viewAnim.from[0] + (viewAnim.to[0] - viewAnim.from[0]) * e, viewAnim.from[1] + (viewAnim.to[1] - viewAnim.from[1]) * e];
      if (t >= 1) viewAnim = null;
      need.stat = need.nav = need.panel = need.ov = true;
      if (tableOpen) need.table = true;
    }
    if (reveal < 1) { reveal = reduceMotion.matches ? 1 : Math.min(1, (now - revealStart) / 520); need.stat = true; }
    if (need.ui) { need.ui = false; renderUI(); }
    if (need.stat) { need.stat = false; renderHero(); }
    if (need.nav) { need.nav = false; renderNav(); }
    if (need.panel) { need.panel = false; renderDec(); renderDecOverlay(); }
    if (need.table) { need.table = false; if (tableOpen) renderTable(); }
    compose(now);
    if (need.ov || pulse) { need.ov = false; renderOverlay(now); }
    if (viewAnim || reveal < 1 || fade || pulse) raf = requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- actions
  function change(patch: Partial<TsConfig>, opts: { fade?: boolean } = {}): void {
    if (!cfg) return;
    if (opts.fade !== false) startFade();
    cfg = { ...cfg, ...patch };
    fetchSeries();
  }
  function uiChange(patch: Partial<UiState>): void {
    Object.assign(ui, patch);
    if (snap) INS = buildInsights(snap, ui);
    invalidate("ui", "stat", "nav", "ov");
  }
  function flyTo(target: [number, number]): void {
    const to = clampView(target);
    if (reduceMotion.matches || !view) { view = to; invalidate("stat", "nav", "panel", "ov"); return; }
    viewAnim = { from: [view[0], view[1]], to, start: performance.now(), dur: 380 };
    invalidate();
  }
  function focusIndex(i: number): void {
    const a = A(), w = Math.max(10, Math.round(a.g.ctx * 0.5));
    flyTo([a.t[Math.max(0, i - w)], a.t[Math.min(a.n - 1, i + w)]]);
    pulse = { indices: [i], rule: null, start: performance.now() + 200 };
    hoverIdx = i;
  }
  function setMode(mode: TsMode): void {
    if (ui.mode === mode || !snap) return;
    const v = V();
    const wasAtEnd = view && Math.abs(v[1] - fullView()[1]) < (v[1] - v[0]) * 0.05;
    ui.mode = mode;
    allT = null; hoverIdx = -1; ghostModel = null;
    if (mode === "forecast") { reveal = 0; revealStart = performance.now(); }
    INS = buildInsights(snap, ui);
    if (mode === "forecast") view = clampView(forecastView());
    else if (wasAtEnd || !view) view = clampView([fullView()[1] - (v[1] - v[0]), fullView()[1]]);
    else view = clampView(view);
    // Patterns are computed on demand: ask once the tab is opened.
    if (mode === "patterns" && !snap.patterns) fetchSeries();
    invalidate("ui", "stat", "nav", "panel", "ov");
    requestAnimationFrame(() => { layout(); invalidate("stat", "panel", "ui"); });
  }
  function runAction(act: TsAction): void {
    switch (act.kind) {
      case "fullView": flyTo(fullView()); break;
      case "focus": focusIndex(act.i); break;
      case "showChange": {
        const a = A(), ctxW = a.g.ctx;
        flyTo([a.t[Math.max(0, act.k - Math.round(ctxW * 0.75))], a.t[Math.min(a.modelN - 1, act.k + Math.round(ctxW * 0.6))]]);
        pulse = { indices: [], rule: act.k, start: performance.now() };
        break;
      }
      case "mode": setMode(act.mode); break;
      case "forecastView": setMode("forecast"); flyTo(forecastView()); break;
      case "grain": choose("grain", act.grain); break;
      case "agg": choose("agg", act.agg); break;
    }
  }
  function choose(key: TokenKey, val: string): void {
    if (!cfg) return;
    if (key === "date") {
      const next = Number(val);
      if (next !== dateColumn) { dateColumn = next; cfg = null; view = null; snap = null; fetchSeries(); }
      return;
    }
    if (key === "groupBy") {
      const next = Number(val);
      if (next !== groupColumn) { groupColumn = next; cfg = { ...cfg, group: -1 }; fetchSeries(); }
      return;
    }
    const patch: Partial<TsConfig> = {};
    if (key === "grain") {
      const id = val as GrainId;
      Object.assign(patch, { grain: id, smoothW: GRAINS[id].smooth, split: null, horizon: null, period: null });
      hoverIdx = -1;
      afterFetch = () => { view = clampView(ui.mode === "forecast" ? forecastView() : fullView()); };
    } else if (key === "agg") patch.agg = val as TsAgg;
    else if (key === "measure") { patch.measure = val; patch.drivers = cfg.drivers.filter((d) => d.col !== val); }
    else if (key === "group") patch.group = Number(val);
    else if (key === "gaps") patch.gaps = val as TsGaps;
    else if (key === "partial") patch.partial = val as TsConfig["partial"];
    change(patch);
  }
  function showRows(i: number): void {
    const a = A(), T = times(), s = snap as TsSnapshot;
    const end = (i + 1 < a.n ? a.t[i + 1] : bucketStart(s.table, a.g, i + 1)) - 1;
    options.onShowRows(dateColumn, T[i], end);
  }
  function exportCsv(): void {
    const s = snap;
    if (!s) return;
    const a = s.A, d = s.dec.dec, P = proj() ?? (() => {
      const key = selectedModel(s, { ...ui, mode: "forecast" });
      return key && !("error" in s.models) && s.futures ? { T: s.models.T, H: s.models.H, f: s.futures[key], key } : null;
    })();
    const T = times();
    const iso = (ms: number): string => new Date(ms).toISOString().slice(0, a.g.unit === "min" ? 16 : 10).replace("T", " ");
    const rows: string[][] = [["period_start", "period", "value", "filled", "rolling", "trend", "seasonal", "remainder", "forecast", "forecast_lo80", "forecast_hi80"]];
    const last = P ? Math.max(a.n - 1, P.T + P.H - 1) : a.n - 1;
    for (let i = 0; i <= last; i++) {
      const h = P ? i - P.T : -1, inP = !!P && h >= 0 && h < P.H;
      const num = (v: number | undefined): string => (v === undefined || !(v === v) ? "" : String(Math.round(v * 1e6) / 1e6));
      rows.push([
        iso(T[i]), periodLabel(a.g, T[i]), i < a.n ? num(a.y[i]) : "", i < a.n && a.filled[i] ? "1" : "",
        i < a.modelN ? num(s.smooth[i]) : "", d && i < a.modelN ? num(d.trend[i]) : "", d && i < a.modelN ? num(d.seasonal[i]) : "", d && i < a.modelN ? num(d.rem[i]) : "",
        inP && P ? num(P.f.F[h]) : "", inP && P ? num(P.f.lo80[h]) : "", inP && P ? num(P.f.hi80[h]) : "",
      ]);
    }
    const base = `${options.datasetName() || "series"}-${s.cfg.agg === "count" ? "rows" : s.cfg.measure ?? "value"}-${a.g.id}`.replace(/[^\w.-]+/g, "_");
    if (downloadCsv(`${base}.csv`, rows)) options.onAction(`Exported ${nf.format(rows.length - 1)} ${a.g.nouns} with trend, season and forecast`);
  }

  // ---------------------------------------------------------------- popovers
  let popKey: TokenKey | "driver" | null = null;
  /** Below the anchor when it fits, else above it, else pinned inside the window (and scrolling). */
  function placePop(anchor: Element): void {
    POP.hidden = false;
    const r = anchor.getBoundingClientRect(), h = POP.offsetHeight, vh = window.innerHeight;
    POP.style.left = Math.max(8, Math.min(window.innerWidth - POP.offsetWidth - 8, r.left)) + "px";
    const top = r.bottom + 6 + h <= vh - 8 ? r.bottom + 6 : r.top - 6 - h >= 8 ? r.top - 6 - h : Math.max(8, vh - h - 8);
    POP.style.top = top + "px";
  }
  function openPop(anchor: Element, key: TokenKey): void {
    if (!snap) return;
    popKey = key;
    const cur = tokValue(key), info = snap.table;
    POP.innerHTML = tokenOpts(key).map(([val, label, hint]) => {
      const off = key === "grain" && info.tooFine[val as GrainId];
      return `<button type="button" role="menuitemradio" data-val="${escapeHtml(val)}" aria-checked="${cur === val}"${off ? ` disabled title="Finer than the data: most periods would be empty"` : ""}>${escapeHtml(label)}${hint ? ` <small>${escapeHtml(hint)}</small>` : ""}</button>`;
    }).join("");
    placePop(anchor);
    (POP.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? POP.querySelector<HTMLButtonElement>("button"))?.focus();
  }
  function closePop(): void { POP.hidden = true; popKey = null; }
  function fmtRecent(col: string): string { const v = snap?.driverRecent[col]; return v === undefined ? "–" : fmtNum(v); }
  function openDriverPop(anchor: Element, k: number): void {
    if (!cfg) return;
    popKey = "driver";
    const d = cfg.drivers[k], s = snap as TsSnapshot;
    POP.innerHTML = `<div class="ts-pop-title"><b>${escapeHtml(d.col)}</b> after the data ends</div>` +
      ([["hold", `Hold at its recent level (${fmtRecent(d.col)})`], ["lastyear", `Same as ${s.A.g.lyAgo}`], ["pct", "Change from its recent level"]] as const)
        .map(([r, l]) => `<button type="button" role="menuitemradio" data-drv-act="rule:${k}:${r}" aria-checked="${d.rule === r}">${l}</button>`).join("") +
      `<div class="ts-pop-range"${d.rule === "pct" ? "" : " hidden"}><input type="range" data-ref="drvPct" min="-25" max="25" step="1" value="${d.pct}" aria-label="Change in ${escapeHtml(d.col)}"><output data-ref="drvPctOut">${d.pct >= 0 ? "+" : "−"}${Math.abs(d.pct)}%</output></div>` +
      `<button type="button" data-drv-act="remove:${k}">Remove driver <small>fit without it</small></button>`;
    placePop(anchor);
    POP.querySelector<HTMLInputElement>('[data-ref="drvPct"]')?.addEventListener("input", (e) => {
      const pctNow = Number((e.target as HTMLInputElement).value);
      const out = POP.querySelector('[data-ref="drvPctOut"]');
      if (out) out.textContent = `${pctNow >= 0 ? "+" : "−"}${Math.abs(pctNow)}%`;
      if (cfg) change({ drivers: cfg.drivers.map((x, j) => (j === k ? { ...x, pct: pctNow } : x)) }, { fade: false });
    });
    (POP.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? POP.querySelector<HTMLButtonElement>("button"))?.focus();
  }
  function openAddDriver(anchor: Element): void {
    if (!cfg || !snap) return;
    popKey = "driver";
    const c = cfg;
    const spare = snap.table.columns.filter((col) => !c.drivers.some((d) => d.col === col.name) && (col.name !== c.measure || c.agg === "count"));
    const about = (col: (typeof spare)[number]): string => (col.flag ? "0/1, share of rows per period" : col.timeLike ? "counts time or names a date part" : "numeric, mean per period");
    POP.innerHTML = `<div class="ts-pop-title">Columns that move the series. Trend and seasons are built in.</div>` +
      (spare.length ? spare.map((col) => `<button type="button" data-drv-act="add:${escapeHtml(col.name)}"><b class="ts-mono">${escapeHtml(col.name)}</b> <small>${about(col)}</small></button>`).join("")
        : `<div class="ts-pop-title">Every numeric column in this table is already a driver.</div>`);
    placePop(anchor);
    POP.querySelector<HTMLButtonElement>("button")?.focus();
  }
  function driverAction(act: string): void {
    if (!cfg || !snap) return;
    const [kind, a, ...rest] = act.split(":");
    const b = rest.join(":");
    let drivers = cfg.drivers;
    if (kind === "rule") {
      const k = Number(a), rule = b as TsConfig["drivers"][number]["rule"];
      drivers = drivers.map((d, j) => (j === k ? { ...d, rule } : d));
      if (rule === "pct") {
        cfg = { ...cfg, drivers };
        const anchor = host.querySelector(`[data-drv="${k}"]`);
        fetchSeries();
        if (anchor) openDriverPop(anchor, k);
        return;
      }
    } else if (kind === "remove") drivers = drivers.filter((_, j) => j !== Number(a));
    else if (kind === "add") {
      const col = [a, b].filter(Boolean).join(":");
      const flag = snap.table.columns.find((c) => c.name === col)?.flag;
      drivers = [...drivers, { col, rule: flag ? "lastyear" : "hold", pct: 0 }];
    }
    closePop();
    change({ drivers }, { fade: false });
  }

  // ---------------------------------------------------------------- events
  host.addEventListener("click", (e) => {
    const target = e.target as Element;
    const t = target.closest<HTMLButtonElement>(".ts-tok");
    if (t && !t.disabled) { openPop(t, t.dataset.tok as TokenKey); e.stopPropagation(); return; }
    const da = target.closest<HTMLElement>("[data-drv-act]");
    if (da) { driverAction(da.dataset.drvAct ?? ""); return; }
    const dc = target.closest<HTMLElement>("[data-drv]");
    if (dc) { if (dc.dataset.drv === "add") openAddDriver(dc); else openDriverPop(dc, Number(dc.dataset.drv)); e.stopPropagation(); return; }
    const opt = target.closest<HTMLButtonElement>(".ts-popover button[data-val]");
    if (opt && popKey && popKey !== "driver") { const key = popKey; closePop(); choose(key, opt.dataset.val ?? ""); return; }
    if (!target.closest(".ts-popover")) closePop();
    const ins = target.closest<HTMLElement>("[data-ins]");
    if (ins) { const [k, j] = (ins.dataset.ins ?? "0:0").split(":").map(Number); const act = INS[k]?.acts[j]?.act; if (act) runAction(act); invalidate("ov", "stat", "nav"); }
    const step = target.closest<HTMLElement>("[data-step]");
    if (step) {
      const id = step.dataset.step;
      if (id === "resample") openPop(step, "grain");
      else if (id === "fill") openPop(step, "gaps");
      else if (id === "smooth") uiChange({ showSmooth: !ui.showSmooth });
      else if (id === "compare") uiChange({ lastYear: !ui.lastYear });
    }
    const hp = target.closest<HTMLElement>("[data-h]");
    if (hp) { afterFetch = () => { allT = null; flyTo(forecastView()); }; change({ horizon: Number(hp.dataset.h) }, { fade: false }); }
    const per = target.closest<HTMLElement>("[data-period]");
    if (per) change({ period: Number(per.dataset.period) });
    const lvl = target.closest<HTMLElement>("[data-level]");
    if (lvl) uiChange({ level: lvl.dataset.level as Level });
    const st = target.closest<HTMLElement>("[data-stat]");
    if (st) change({ smoothStat: st.dataset.stat as TsConfig["smoothStat"] }, { fade: false });
    const row = target.closest<HTMLElement>("tr[data-model]");
    if (row && snap) { const M = models(), k = row.dataset.model as ModelKey; uiChange({ model: M && k === M.best && ui.model !== "auto" ? "auto" : k }); }
    const tab = target.closest<HTMLElement>(".ts-modes [data-mode]");
    if (tab) setMode(tab.dataset.mode as TsMode);
    const preset = target.closest<HTMLElement>("[data-span]");
    if (preset && snap) {
      const days = Number(preset.dataset.span);
      for (const b of ref("presets").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === preset));
      const [, d1] = fullView();
      flyTo(days ? [d1 - days * DAY, d1] : fullView());
    }
  });
  document.addEventListener("click", (e) => { if (!host.contains(e.target as Node)) closePop(); });
  POP.addEventListener("keydown", (e) => {
    const items = [...POP.querySelectorAll<HTMLButtonElement>("button")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { items[(i + 1) % items.length]?.focus(); e.preventDefault(); }
    if (e.key === "ArrowUp") { items[(i - 1 + items.length) % items.length]?.focus(); e.preventDefault(); }
    if (e.key === "Escape") closePop();
  });
  const on = (name: string, ev: string, fn: (e: Event) => void): void => ref(name).addEventListener(ev, fn);
  const readNum = (el: HTMLInputElement, lo: number, hi: number): number | null => {
    const v = Math.round(Number(el.value));
    if (el.value.trim() === "" || !Number.isFinite(v)) return null;
    return Math.max(lo, Math.min(hi, v));
  };
  const onNum = (name: string, fn: (el: HTMLInputElement) => void): void => {
    on(name, "change", (e) => { const el = e.target as HTMLInputElement; fn(el); el.blur(); });
    on(name, "keydown", (e) => { const el = e.target as HTMLInputElement; if ((e as KeyboardEvent).key === "Enter") { fn(el); el.select(); } });
  };
  on("smoothW", "input", (e) => { change({ smoothW: Number((e.target as HTMLInputElement).value) }, { fade: false }); ui.showSmooth = true; });
  onNum("smoothWNum", (el) => { const v = snap && readNum(el, 2, maxSmooth()); if (v) { ui.showSmooth = true; change({ smoothW: v }, { fade: false }); } });
  onNum("hNum", (el) => { const v = snap && readNum(el, 1, snap.maxH); if (v) change({ horizon: v }, { fade: false }); });
  const zoomBy = (k: number): void => {
    if (!view) return;
    const c = (view[0] + view[1]) / 2;
    for (const b of ref("presets").querySelectorAll("button")) b.setAttribute("aria-pressed", "false");
    flyTo([c - (c - view[0]) * k, c + (view[1] - c) * k]);
  };
  on("zoomIn", "click", () => zoomBy(1 / 1.6));
  on("zoomOut", "click", () => zoomBy(1.6));
  on("smoothCentred", "change", (e) => change({ smoothCentred: (e.target as HTMLInputElement).checked }, { fade: false }));
  on("lastYear", "change", (e) => uiChange({ lastYear: (e.target as HTMLInputElement).checked }));
  on("showShift", "change", (e) => uiChange({ showShift: (e.target as HTMLInputElement).checked }));
  on("sens", "input", (e) => change({ sens: Number((e.target as HTMLInputElement).value) }, { fade: false }));
  on("flex", "input", (e) => change({ flex: Number((e.target as HTMLInputElement).value) }, { fade: false }));
  on("hMinus", "click", () => { if (snap) change({ horizon: Math.max(1, snap.H - 1) }, { fade: false }); });
  on("hPlus", "click", () => { if (snap) change({ horizon: Math.min(snap.maxH, snap.H + 1) }, { fade: false }); });
  on("splitReset", "click", () => change({ split: null }, { fade: false }));
  on("exportBtn", "click", exportCsv);
  on("board", "pointerover", (e) => { const r = (e.target as Element).closest<HTMLElement>("tr[data-model]"); const k = (r?.dataset.model as ModelKey | undefined) ?? null; if (k !== ghostModel) { ghostModel = k; invalidate("stat"); } });
  on("board", "pointerleave", () => { ghostModel = null; invalidate("stat"); });
  on("tableBtn", "click", (e) => {
    tableOpen = !tableOpen;
    (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(tableOpen));
    ref("tableWrap").hidden = !tableOpen;
    if (tableOpen && snap) renderTable();
  });
  host.querySelector(".ts-modes")?.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== "ArrowRight" && k !== "ArrowLeft") return;
    const i = MODES.indexOf(ui.mode);
    const next = MODES[(i + (k === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length];
    setMode(next);
    host.querySelector<HTMLElement>(`.ts-modes [data-mode="${next}"]`)?.focus();
  });

  let drag: { kind: DragKind; x0: number; x1?: number; view: [number, number]; moved: boolean } | null = null;
  function handleAt(px: number, py: number): DragKind | null {
    const M = models();
    if (ui.mode !== "forecast" || !M) return null;
    const T = times();
    const xs = X(T[M.T - 1]), xe = X(T[M.T + M.H - 1]);
    if (Math.abs(px - xe) < 34 && py > geo.T + geo.ph - 26 && py < geo.T + geo.ph) return "horizon";
    if (Math.abs(px - xs) < 7 || (Math.abs(px - xs) < 50 && py < geo.T)) return "split";
    return null;
  }
  heroOverlay.addEventListener("pointermove", (e) => {
    if (!snap) return;
    const r = heroOverlay.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const M = models();
    if (drag) {
      const dx = px - drag.x0;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.kind === "box") { drag.x1 = Math.max(geo.L, Math.min(geo.L + geo.pw, px)); hoverIdx = -1; invalidate("ov"); return; }
      if (drag.kind === "pan" && drag.moved) {
        const span = drag.view[1] - drag.view[0];
        view = clampView([drag.view[0] - (dx / geo.pw) * span, drag.view[1] - (dx / geo.pw) * span]);
        viewAnim = null; hoverIdx = -1;
        invalidate("stat", "nav", "panel", "ov");
        return;
      }
      const a = A(), step = a.t[1] - a.t[0];
      if (drag.kind === "split" && M) {
        const i = Math.min(a.modelN, nearestIndex(invX(px)) + 1);
        if (i !== M.T) change({ split: i >= a.modelN ? null : i }, { fade: false });
        return;
      }
      if (drag.kind === "horizon" && M) {
        const H = Math.max(1, Math.min(snap.maxH, Math.round((invX(px) - times()[M.T - 1]) / step)));
        if (H !== (cfg?.horizon ?? M.H)) change({ horizon: H }, { fade: false });
        return;
      }
    }
    heroOverlay.classList.toggle("ew", !!handleAt(px, py));
    if (px < geo.L || px > geo.L + geo.pw) { if (hoverIdx !== -1) { hoverIdx = -1; invalidate("ov"); } return; }
    const i = nearestIndex(invX(px));
    if (i !== hoverIdx) { hoverIdx = i; invalidate("ov"); }
  });
  heroOverlay.addEventListener("pointerleave", () => { if (!drag) { hoverIdx = -1; invalidate("ov"); } });
  heroOverlay.addEventListener("pointerdown", (e) => {
    if (!snap || !view) return;
    const r = heroOverlay.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    heroOverlay.setPointerCapture(e.pointerId);
    const hd = handleAt(px, py);
    drag = { kind: hd ?? (e.shiftKey ? "box" : "pan"), x0: px, view: [view[0], view[1]], moved: false };
    if (!hd) heroOverlay.classList.add("grab");
  });
  heroOverlay.addEventListener("pointerup", () => {
    heroOverlay.classList.remove("grab");
    const d = drag;
    drag = null;
    if (!snap) return;
    if (d && d.kind === "pan" && !d.moved && hoverIdx >= 0 && hoverIdx < snap.A.n) showRows(hoverIdx);
    if (d && d.kind === "box") {
      if (d.x1 != null && Math.abs(d.x1 - d.x0) > 8) {
        for (const b of ref("presets").querySelectorAll("button")) b.setAttribute("aria-pressed", "false");
        flyTo([invX(Math.min(d.x0, d.x1)), invX(Math.max(d.x0, d.x1))]);
      }
      invalidate("ov");
    }
    if (d && d.kind !== "pan") invalidate("ui");
  });
  heroOverlay.addEventListener("wheel", (e) => {
    if (!snap || !view) return;
    e.preventDefault();
    const r = heroOverlay.getBoundingClientRect();
    const at = invX(e.clientX - r.left);
    const k = Math.pow(1.0018, e.deltaY);
    viewAnim = null;
    view = clampView([at - (at - view[0]) * k, at + (view[1] - at) * k]);
    for (const b of ref("presets").querySelectorAll("button")) b.setAttribute("aria-pressed", "false");
    invalidate("stat", "nav", "panel", "ov");
  }, { passive: false });
  heroOverlay.addEventListener("dblclick", () => { if (snap) flyTo(ui.mode === "forecast" ? forecastView() : fullView()); });
  heroOverlay.addEventListener("keydown", (e) => {
    if (!snap || !view) return;
    const last = lastIndex();
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      hoverIdx = hoverIdx < 0 ? nearestIndex((view[0] + view[1]) / 2) : Math.max(0, Math.min(last, hoverIdx + (e.key === "ArrowRight" ? 1 : -1)));
      const T = times();
      if (T[hoverIdx] < view[0] || T[hoverIdx] > view[1]) { const span = view[1] - view[0]; view = clampView([T[hoverIdx] - span / 2, T[hoverIdx] + span / 2]); invalidate("stat", "nav", "panel"); }
      invalidate("ov"); e.preventDefault();
    } else if (e.key === "Home" || e.key === "End") { hoverIdx = e.key === "Home" ? 0 : last; invalidate("ov"); e.preventDefault(); }
    else if (e.key === "Enter" && hoverIdx >= 0 && hoverIdx < snap.A.n) showRows(hoverIdx);
    else if (e.key === "Escape") { hoverIdx = -1; invalidate("ov"); }
    else if (e.key === "+" || e.key === "=" || e.key === "-") { const c = (view[0] + view[1]) / 2, k = e.key === "-" ? 1.4 : 1 / 1.4; view = clampView([c - (c - view[0]) * k, c + (view[1] - c) * k]); invalidate("stat", "nav", "panel", "ov"); }
  });
  let navDrag: { kind: "move" | "l" | "r"; x0: number; view: [number, number]; toMs: (px: number) => number } | null = null;
  navCanvas.addEventListener("pointerdown", (e) => {
    if (!snap || !view) return;
    const r = navCanvas.getBoundingClientRect();
    const [d0, d1] = fullView();
    const toMs = (px: number): number => d0 + (px / r.width) * (d1 - d0);
    const px = e.clientX - r.left;
    const a = ((view[0] - d0) / (d1 - d0)) * r.width, b = ((view[1] - d0) / (d1 - d0)) * r.width;
    let kind: "move" | "l" | "r" = "move";
    if (Math.abs(px - a) < 8) kind = "l";
    else if (Math.abs(px - b) < 8) kind = "r";
    else if (px < a || px > b) { const span = view[1] - view[0]; view = clampView([toMs(px) - span / 2, toMs(px) + span / 2]); invalidate("stat", "nav", "panel"); }
    navDrag = { kind, x0: px, view: [view[0], view[1]], toMs };
    navCanvas.setPointerCapture(e.pointerId);
    viewAnim = null;
    for (const bt of ref("presets").querySelectorAll("button")) bt.setAttribute("aria-pressed", "false");
  });
  navCanvas.addEventListener("pointermove", (e) => {
    if (!snap || !view) return;
    const r = navCanvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (!navDrag) {
      const [d0, d1] = fullView();
      const a = ((view[0] - d0) / (d1 - d0)) * r.width, b = ((view[1] - d0) / (d1 - d0)) * r.width;
      navCanvas.style.cursor = Math.abs(px - a) < 8 || Math.abs(px - b) < 8 ? "ew-resize" : px > a && px < b ? "grab" : "pointer";
      return;
    }
    const dms = navDrag.toMs(px) - navDrag.toMs(navDrag.x0);
    const v = navDrag.view;
    if (navDrag.kind === "move") view = clampView([v[0] + dms, v[1] + dms]);
    else if (navDrag.kind === "l") view = clampView([Math.min(v[0] + dms, v[1] - minSpan()), v[1]]);
    else view = clampView([v[0], Math.max(v[1] + dms, v[0] + minSpan())]);
    hoverIdx = -1;
    invalidate("stat", "nav", "panel", "ov");
  });
  navCanvas.addEventListener("pointerup", () => { navDrag = null; if (tableOpen && snap) renderTable(); });

  const themeChanged = (): void => { readColors(); invalidate("ui", "stat", "nav", "panel", "ov"); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeChanged);
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new ResizeObserver(() => { if (!visible) return; layout(); invalidate("stat", "nav", "panel", "ov", "ui"); }).observe(heroEl);
  new ResizeObserver(() => { if (!visible) return; layout(); invalidate("panel"); }).observe(ref("decomp"));
  let patW = 0;
  new ResizeObserver(() => { const w = ref("patGrid").clientWidth; if (visible && ui.mode === "patterns" && snap && Math.abs(w - patW) > 4) { patW = w; renderPatterns(); } }).observe(ref("patGrid"));

  // A preset waiting for the first snapshot of its date column (that one carries the
  // defaults and the column list the preset is checked against).
  function open(preset: TsPreset): void {
    if (!dateColumns().includes(preset.dateColumn)) return;
    dateColumn = preset.dateColumn;
    groupColumn = preset.groupColumn !== undefined && groupColumns().includes(preset.groupColumn) ? preset.groupColumn : -1;
    cfg = null; view = null; snap = null;
    seq++; // a reply already on its way is for the old series
    afterFetch = () => {
      if (!cfg || !snap) return;
      const patch: Partial<TsConfig> = {};
      const names = new Set(snap.table.columns.map((c) => c.name));
      if (preset.measure === null) patch.agg = "count";
      else if (preset.measure !== undefined && names.has(preset.measure)) {
        patch.measure = preset.measure;
        if (preset.agg && preset.agg !== "count") patch.agg = preset.agg;
      }
      if (preset.grain && GRAIN_ORDER.includes(preset.grain)) patch.grain = preset.grain;
      if (Object.keys(patch).length) { cfg = { ...cfg, ...patch }; view = null; fetchSeries(); }
    };
    if (visible) fetchSeries();
    else stale = true;
  }

  readColors();
  return {
    setData,
    open,
    shown(): void {
      visible = true;
      readColors();
      layout();
      if (stale) { stale = false; fetchSeries(); }
      if (snap && view) view = clampView(view);
      invalidate("ui", "stat", "nav", "panel", "ov");
    },
    hide(): void {
      visible = false;
      closePop();
    },
  };
}
