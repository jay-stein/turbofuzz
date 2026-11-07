/**
 * Time Series page: one series from the loaded table (date column, measure, optional
 * group), explored, decomposed, forecast and profiled. The engine runs in the worker
 * (src/data/timeseries); this module draws its snapshots and turns clicks and drags
 * into new choices. Ported from prototypes/time-series/time-series-workbench.html.
 */

import { bucketStart, cadenceText, DAY, GRAIN_ORDER, GRAINS, type GrainId } from "../data/timeseries/base.js";
import type { SeriesShape } from "../data/timeseries/shape.js";
import type { TsViewSource } from "../data/timeseries/view-source.js";
import type { TsAgg, TsConfig, TsGaps, TsMode } from "../data/timeseries/aggregate.js";
import type { TsSnapshot } from "../data/timeseries/engine.js";
import type { DeepCheck } from "../data/timeseries/models.js";
import {
  compact, dfDate, dfDM, dfMonShort, dfTime, fmtNum, full, nf, nounFor, pct, periodLabel, shortPeriod, signed,
} from "../data/timeseries/format.js";
import { BENCHMARK_KEYS, CORE_KEYS, flexDetail, grade, METRIC_KEYS, MODEL_INFO, MODEL_KEYS, type Future, type MetricKey, type ModelKey, type ModelRun } from "../data/timeseries/models.js";
import { METRIC_INFO, metricText, openModelGuide } from "./timeseries-metrics.js";
import { backtestRows, forecastRows, scorecardRows } from "./timeseries-export.js";
import { cite, openModelDetails } from "./timeseries-model-docs.js";
import { ordinal, PLAIN, trustVerdict, type Verdict } from "../data/timeseries/verdict.js";
import type { ArimaJob, ArimaProgress, ArimaResult } from "../data/timeseries/arima-run.js";
import type { ArimaCoef } from "../data/timeseries/arima.js";
import { startArima, type ArimaRun } from "./timeseries-arima.js";
import { openMenu } from "./menu.js";
import type { ColumnSuggestion } from "../data/suggestions.js";
import type { ColumnMeta, TimeSeriesMessage } from "../worker/protocol.js";
import { downloadCsv } from "./chart-export.js";
import {
  buildInsights, chg, escapeHtml, trendRate, measureWord, modelRows, periodName, ratioOf, seasonName, selectedModel, trendShift,
  type TsAction, type TsFinding, type TsTone, type TsView,
} from "./timeseries-findings.js";
import { rankFormats } from "../parse/date-format.js";
import { niceTicks, patternsHtml } from "./timeseries-patterns.js";

export interface TimeSeriesPageOptions {
  /** source "" reads the Table's rows; a Pivot View id reads that view's periods. */
  request: (input: { dateColumn: number; groupColumn: number; config: TsConfig | null; mode: TsMode; source: string; backtest?: boolean; flexCurve?: boolean; deep?: ModelKey }) => Promise<TimeSeriesMessage | null>;
  /** Pivot Views the page can read: complete, grouped by a time grain, with a measure. */
  viewSources: () => TsViewSource[];
  /** Filter the table to one period of the date column (UTC ms, inclusive) and show it. */
  onShowRows: (dateColumn: number, min: number, max: number) => void;
  onAction: (message: string) => void;
  /** Read a text column of periods ("2024-03", "Mar-24", "2024 Q1") as dates, with the given `fmt:` order. */
  onUseAsDate: (column: number, order: string) => void;
  /** Apply one of a column's cleaning suggestions (treat a code as missing). */
  onApplySuggestion: (column: number, suggestion: ColumnSuggestion) => void;
  /** A sample of one column's values, for spotting a text column of periods. */
  sampleValues: (column: number) => Promise<string[]>;
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
  /** Pivot Views were added, edited or removed: a series read from one follows it. */
  viewsChanged(): void;
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
/** The models that are yardsticks, not recommendations. */
const BENCHMARKS: readonly ModelKey[] = BENCHMARK_KEYS;
interface UiState { mode: TsMode; showSmooth: boolean; lastYear: boolean; showShift: boolean; level: Level; model: ModelKey | "auto"; metric: MetricKey; diff: boolean; diffLag: number }
type TokenKey = "grain" | "agg" | "measure" | "group" | "gaps" | "partial" | "date" | "groupBy" | "source";
interface Colors { bg: string; panel: string; panel2: string; border: string; text: string; dim: string; accent: string; forecast: string; season2: string; raw: string; danger: string; warn: string; grid: string }
interface Proj { T: number; H: number; f: Future; key: ModelKey }
interface DecRow { name: string; get: (i: number) => number; color: string; kind: "line" | "bars"; zero?: boolean; yy?: (v: number) => number }
type DragKind = "pan" | "box" | "split" | "horizon";

const GROUP_LIMIT = 1000;
const AGG_OPTS: [TsAgg, string][] = [["sum", "sum"], ["mean", "mean"], ["twmean", "time-weighted mean"], ["median", "median"], ["min", "min"], ["max", "max"], ["first", "first"], ["last", "last"], ["count", "count of rows"]];
const GAP_OPTS: [TsGaps, string, string][] = [
  ["smart", "filled smartly", "recommended: the usual pattern for short gaps, the nearby typical value for long ones"],
  ["local", "filled with the nearby typical value", "the median of the same time in the nearest cycles either side; follows the local level, best for long gaps"],
  ["lastcycle", "copied from the cycle before", "the same time one cycle earlier, e.g. the same hour last week"],
  ["seasonal", "filled with the usual pattern", "the typical shape on a line between the levels either side; best for gaps of a few periods"],
  ["interp", "interpolated", "a straight line between the periods either side"],
  ["last", "carried forward", "the last known value repeats; for levels that hold, such as prices or settings"],
  ["zero", "filled with zero", "an empty period counts as 0, as for sales"],
  ["leave", "left empty", "a break in the line; models still bridge it with the smart fill"],
];
const MODES: TsMode[] = ["explore", "decompose", "forecast", "patterns"];
const MODE_LABEL: Record<TsMode, string> = { explore: "Explore", decompose: "Decompose", forecast: "Forecast", patterns: "Patterns" };

const TEMPLATE = `
<div class="ts-empty" data-ref="empty" hidden></div>
<div class="ts-body" data-ref="body" hidden>
  <div class="ts-modebar">
  <div class="ts-top-actions">
    <div class="ts-modes" role="tablist" aria-label="Analysis">${MODES.map((m, k) => `<button role="tab" type="button" data-mode="${m}" aria-selected="${k === 0}" tabindex="${k === 0 ? 0 : -1}">${MODE_LABEL[m]}</button>`).join("")}</div>
    <button class="ts-export-btn" type="button" data-ref="exportBtn" aria-haspopup="menu" title="Download the forecast, the series, the model scorecard or the backtest as CSV">Export ▾</button>
  </div>
  </div>
  <header class="ts-top">
    <section class="ts-sentence" aria-label="Series">
      <h2 data-ref="sentence"></h2>
      <p class="ts-sub" data-ref="subline"></p>
      <p class="ts-why" data-ref="why"></p>
    </section>
  </header>
  <div class="ts-mixed" data-ref="mixed" role="status" hidden></div>
  <div class="ts-sentinel" data-ref="sentinel" role="status" hidden></div>
  <dl class="ts-strip" data-ref="strip"></dl>
  <div class="ts-work">
    <div class="ts-stage">
      <section class="ts-card ts-card-main" aria-label="Series chart">
        <div class="ts-busy" data-ref="busy" role="status" hidden><span class="ts-spinner" aria-hidden="true"></span><span>Calculating…</span></div>
        <div class="ts-toolbar" role="toolbar" aria-label="Mode settings">
          <div class="ts-tb" data-for="explore">
            <div class="ts-ctl"><label>Rolling window</label><input type="range" data-ref="smoothW" min="2" max="52" step="1" aria-label="Rolling window (slider)"><input type="number" class="ts-num" data-ref="smoothWNum" min="2" step="1" aria-label="Rolling window"><span class="ts-numunit" data-ref="smoothWUnit"></span></div>
            <div class="ts-seg" role="group" aria-label="Rolling statistic" data-ref="statSeg"><button type="button" data-stat="mean">Mean</button><button type="button" data-stat="median">Median</button><button type="button" data-stat="min">Min</button><button type="button" data-stat="max">Max</button></div>
            <label class="ts-check"><input type="checkbox" data-ref="smoothCentred"> Centred</label>
            <label class="ts-check"><input type="checkbox" data-ref="lastYear"> <span data-ref="lastYearText">Same period last year</span></label>
            <label class="ts-check" data-ref="shiftWrap"><input type="checkbox" data-ref="showShift"> Trend shift</label>
            <div class="ts-ctl"><label class="ts-check" title="Plot y(t) − y(t − lag): the change from the same point a lag earlier. A seasonal lag takes the season out (fpp3 9.1)."><input type="checkbox" data-ref="diffOn"> Difference</label><span class="ts-stepnum"><input type="number" class="ts-num" data-ref="diffLag" min="1" step="1" aria-label="Difference lag"><span class="ts-numunit" data-ref="diffUnit"></span></span><div class="ts-seg" data-ref="diffPresets" role="group" aria-label="Difference lag presets"></div></div>
            <span class="ts-note ts-diffnote" data-ref="diffNote"></span>
          </div>
          <div class="ts-tb" data-for="decompose" hidden>
            <div class="ts-ctl"><span>Season</span><div class="ts-seg" data-ref="periodSeg" role="group" aria-label="Seasonal period"></div></div>
            <div class="ts-ctl"><label>Flag unusual</label><input type="range" data-ref="sens" min="2.5" max="6" step="0.25" aria-label="How unusual a period must be to flag"><output data-ref="sensOut"></output></div>
            <button class="ts-ghost" type="button" data-ref="decGrain" hidden></button>
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
            <button class="ts-ghost" type="button" data-ref="tableBtn" aria-expanded="false" title="The numbers behind the chart, one row per period in view: actuals, filled periods and the forecast">Show data table</button>
          </div>
        </div>
        <div class="ts-hero-badge" data-ref="heroBadge" hidden></div>
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
        <div class="ts-answer" data-ref="answer" aria-live="polite"></div>
        <button class="ts-fold" type="button" data-fold="compare" aria-expanded="false"><span class="ts-fold-chev" aria-hidden="true"></span><b>All models, ranked</b><span class="ts-note">Lowest error first: click a row to see its forecast</span></button>
        <div class="ts-fold-body" data-ref="foldCompare" hidden>
        <div class="ts-boardwrap"><table class="ts-board ts-board-compact" data-ref="boardCompact" aria-label="Models, compared"></table></div>
        </div>
        <button class="ts-fold" type="button" data-fold="compute" aria-expanded="false"><span class="ts-fold-chev" aria-hidden="true"></span><svg class="ts-fold-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5.5A3 3 0 0 0 6.3 4.3 3.5 3.5 0 0 0 4 8a3.5 3.5 0 0 0 .8 2.3A3.6 3.6 0 0 0 4 12.5a3.5 3.5 0 0 0 2 3.2A3.2 3.2 0 0 0 9 19.5a3 3 0 0 0 3-2.2V5.5Z"/><path d="M12 5.5a3 3 0 0 1 5.7-1.2A3.5 3.5 0 0 1 20 8a3.5 3.5 0 0 1-.8 2.3 3.6 3.6 0 0 1 .8 2.2 3.5 3.5 0 0 1-2 3.2 3.2 3.2 0 0 1-3 3.8 3 3 0 0 1-3-2.2V5.5Z"/><path d="M8 9.5a2 2 0 0 1 2-1M16 9.5a2 2 0 0 0-2-1M8 14a2.2 2.2 0 0 0 2.2 1.2M16 14a2.2 2.2 0 0 1-2.2 1.2"/></svg><b>Compute-intense models</b><span class="ts-note">ARIMA runs you start yourself; each joins the ranked list when it finishes</span></button>
        <div class="ts-fold-body" data-ref="foldCompute" hidden>
        <div class="ts-arima">
          <div class="ts-arima-bar">
            <button class="ts-ghost ts-deep-btn" type="button" data-ref="arimaBtn" title="Searches seasonal ARIMA models for this series by the textbook's method (R's auto.arima) and reports the one it settles on, with its parameters. A deep run you start yourself: no time limit.">AutoARIMA…</button>
            <button class="ts-ghost ts-deep-btn" type="button" data-ref="arimaVoteBtn" title="DV-ARIMA: the same search, but the differencing is chosen by a vote on forecasts of your own history, not only by the unit-root test, and the forecast averages the choices. An alternative that may help a little: about 2 to 3% better on archive series, not on every series, and 3 to 5 times slower. Not used with Search every order.">DV-ARIMA…</button>
            <label class="ts-check" title="AutoARIMA normally searches step by step: it starts from a few standard models and only tries the neighbours of the best one so far. This tests every combination instead (up to ARIMA(5,d,5)(2,D,2)). It is much slower and usually lands on the same model, so tick it only if the quick result looks wrong."><input type="checkbox" data-ref="arimaAll"> Search every order (slower, rarely changes the answer)</label>
            <span class="ts-note">AutoARIMA searches for the best-fitting ARIMA model; DV-ARIMA chooses the differencing by a forecast vote instead. They run in the background with no time limit, and the result is ranked with the other models. "Search every order" checks all combinations instead of stepping outward from the best: slower, and it usually finds the same model.</span>
          </div>
          <div class="ts-arima-run" data-ref="arimaRun" hidden role="status" aria-live="polite"><span class="ts-donut" aria-hidden="true"></span><div class="ts-arima-prog" data-ref="arimaProg"></div><button class="ts-ghost" type="button" data-ref="arimaCancel">Stop</button></div>
          <div class="ts-arima-out" data-ref="arimaOut" hidden></div>
        </div>
        </div>
        <button class="ts-fold" type="button" data-fold="hood" aria-expanded="false"><span class="ts-fold-chev" aria-hidden="true"></span><b>Under the hood</b><span class="ts-note">Checks, validation, flexibility and the model card, for analysts</span></button>
        <div class="ts-fold-body" data-ref="foldHood" hidden>
        <div class="ts-hood-controls">
          <div class="ts-ctl ts-ctl-key"><label for="ts-metric">Rank by</label><select id="ts-metric" class="ts-select ts-select-key" data-ref="metricSel" title="Picks the Auto model, the line on the chart">${METRIC_KEYS.map((k) => `<option value="${k}">${METRIC_INFO[k].label} · ${METRIC_INFO[k].short}${k === "mase" ? " (default)" : ""}</option>`).join("")}</select><button type="button" class="ts-help-dot" data-ref="guideBtn2" aria-label="Which model, and why? What each measure means" title="What each measure means">?</button></div>
          <div class="ts-ctl"><span title="A power transformation makes swings that grow with the level steadier before the smoothing and regression models learn. Off by default: on five monthly benchmark sets it did not help.">Transform</span><div class="ts-seg" data-ref="trSeg" role="group" aria-label="Transformation"><button type="button" data-tr="none" title="Models learn from the series as it is">None</button><button type="button" data-tr="auto" title="Box-Cox, with the power chosen by Guerrero's method on the history before the first fold">Box-Cox (auto)</button><button type="button" data-tr="log" title="The natural log: swings that grow in proportion to the level become steady">Log</button></div></div>
          <div class="ts-ctl"><span>Validate</span><div class="ts-seg" data-ref="cvSeg" role="group" aria-label="Validation window"><button type="button" data-cv="expanding" title="Each backtest trains on everything before it">Expanding window</button><button type="button" data-cv="rolling" title="Each backtest trains on a fixed-length window that slides forward">Rolling window</button></div></div>
        </div>
        <div class="ts-boardbar">
          <button class="ts-ghost ts-guide-btn" type="button" data-ref="guideBtn">Which model, and why?</button>
          <button class="ts-ghost" type="button" data-ref="docsBtn" title="Equations, fitting, forecasts, bands, differences from the textbook, and sources for every model">How the models work</button>
          <button class="ts-ghost ts-deep-btn" type="button" data-ref="deepBtn" title="Significance tests, error by steps ahead, band calibration on every fold and residual diagnostics. Slower: runs only when asked.">Deep check</button>
        </div>
        <div class="ts-deep" data-ref="deepBox" hidden></div>
        <div class="ts-hood-detail" data-ref="heroDetail"></div>
        <span class="ts-note" data-ref="boardNote"></span>
        <div class="ts-boardwrap"><table class="ts-board" data-ref="board"></table></div>
        <div class="ts-flexbox">
          <div class="ts-ctl"><label>Trend flexibility</label><input type="range" data-ref="flex" min="1" max="10" step="1" aria-label="Trend flexibility"><output data-ref="flexOut"></output><span class="ts-note">trend, seasons and drivers model (and the Blend)</span><button class="ts-ghost" type="button" data-ref="flexCheck" title="Backtest every setting from 1 to 10 on the same folds: a validation curve">Check every setting</button></div>
          <p class="ts-flexnote" data-ref="flexNote"></p>
          <div class="ts-flexcurve" data-ref="flexCurve" hidden></div>
        </div>
        <dl class="ts-modelcard" data-ref="modelCard"></dl>
        </div>
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
  // "" reads the Table; otherwise the id of the Pivot View whose periods are the series.
  let source = "";
  const viewSource = (): TsViewSource | undefined => (source === "" ? undefined : options.viewSources().find((v) => v.id === source));
  let cfg: TsConfig | null = null;
  let snap: TsSnapshot | null = null;
  let shape: SeriesShape | null = null;
  // Mixed-series warnings the person kept as they are (date|split|group), for this session.
  const keptMixed = new Set<string>();
  const ui: UiState = { mode: "explore", showSmooth: true, lastYear: false, showShift: true, level: "fan", model: "auto", metric: "mase", diff: false, diffLag: 0 };
  let INS: TsFinding[] = [];
  let view: [number, number] | null = null;
  let hoverIdx = -1, ghostModel: ModelKey | null = null, ghostArima = false;
  /** The run-by-you ARIMA forecast is the one on the chart (set by clicking its row or card). */
  let arimaShown = false;
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
  // The worker answers in well under half a second; if a request takes longer than this the
  // page says it is calculating (a pill with a spinning donut) instead of looking stuck.
  // Shorter waits show nothing, so quick changes do not flicker.
  const BUSY_AFTER_MS = 150;
  let busyTimer = 0;
  function setBusy(on: boolean): void {
    window.clearTimeout(busyTimer);
    if (on) busyTimer = window.setTimeout(() => { ref("busy").hidden = false; }, BUSY_AFTER_MS);
    else ref("busy").hidden = true;
  }
  function fetchSeries(): void {
    if (dateColumn < 0 && source === "") return;
    if (inFlight) { again = true; return; }
    inFlight = true;
    if (ref("busy").hidden) setBusy(true);
    const mine = ++seq;
    const sentDate = dateColumn, sentGroup = groupColumn, sentSource = source;
    options.request({ dateColumn, groupColumn, config: cfg, mode: ui.mode, source }).then((msg) => {
      inFlight = false;
      if (mine !== seq || sentDate !== dateColumn || sentGroup !== groupColumn || sentSource !== source) { if (again || mine !== seq) { again = false; fetchSeries(); } if (!inFlight) setBusy(false); return; }
      if (!msg || !msg.snapshot) {
        snap = null;
        showEmpty(msg?.error ?? "This column has too few readable dates to make a series.");
      } else {
        const first = snap === null || cfg === null;
        snap = msg.snapshot;
        shape = msg.shape ?? null;
        cfg = msg.snapshot.cfg;
        allT = null;
        INS = makeInsights();
        ensureArima();
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
      if (!inFlight) setBusy(false);
    }).catch(() => { inFlight = false; if (again) { again = false; fetchSeries(); } if (!inFlight) setBusy(false); });
  }
  function showEmpty(html: string): void {
    ref("body").hidden = true;
    const empty = ref("empty");
    empty.hidden = false;
    empty.innerHTML = html;
  }
  /** A text column whose values are almost all months, quarters or years in one explicit format (the first such column). */
  async function periodColumn(): Promise<{ column: number; order: string; format: string; example: string } | null> {
    for (let i = 0; i < metas.length; i++) {
      const m = metas[i]!;
      if (m.type !== "string" && m.type !== "category") continue;
      const values = (await options.sampleValues(i).catch(() => [])).filter((v) => v.trim() !== "");
      if (values.length < 6) continue;
      const best = rankFormats(values)[0];
      if (!best || best.preset.time || best.hits < Math.min(200, values.length) * 0.9 || !/[MQ]/.test(best.preset.format)) continue;
      return { column: i, order: `fmt:${best.preset.format}`, format: best.preset.format, example: best.preset.example };
    }
    return null;
  }
  function setData(next: readonly ColumnMeta[], _resultCount: number): void {
    const prevName = dateColumn >= 0 ? metas[dateColumn]?.name : null;
    metas = next;
    const dates = dateColumns();
    if (source !== "" && viewSource() === undefined) { source = ""; groupColumn = -1; cfg = null; view = null; }
    if (source !== "") {
      if (visible) fetchSeries();
      else stale = true;
      return;
    }
    if (!dates.length) {
      dateColumn = -1;
      snap = null;
      const base = `<h3>No date column</h3><p>The Time Series page needs a column of dates or date-times. If the dates are split over Year, Month and Day columns, type <b>combine</b> in the command bar to build one; if a date column reads as text, change its type to Date. Then come back here.</p>`;
      showEmpty(base);
      const asked = metas;
      void periodColumn().then((period) => {
        if (!period || metas !== asked || dateColumn >= 0) return;
        showEmpty(`${base}<p><button type="button" class="btn-primary" data-use-date="${period.column}" data-use-order="${escapeHtml(period.order)}">Use ${escapeHtml(metas[period.column]!.name)} as date</button> <span class="muted">reads values like ${escapeHtml(period.example)} as the first day of each period (${escapeHtml(period.format)}).</span></p>`);
      });
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
  /** Most raw markers drawn at once; past this they would only smear, so the chart says to zoom. */
  const RAW_MARKER_CAP = 500;
  /**
   * The rows behind the line as small round markers, a lighter fill inside the outline.
   * Hidden (with a note) while more than RAW_MARKER_CAP sit in the view.
   */
  function drawRawRows(ctx: CanvasRenderingContext2D, raw: { t: Float64Array; v: Float64Array }, fromMs: number, toMs: number, X: (ms: number) => number, Y: (v: number) => number, color: string): void {
    let lo = 0, hi = raw.t.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (raw.t[mid] < fromMs) lo = mid + 1; else hi = mid; }
    const first = lo;
    hi = raw.t.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (raw.t[mid] <= toMs) lo = mid + 1; else hi = mid; }
    const count = lo - first;
    if (count === 0) return;
    if (count > RAW_MARKER_CAP) {
      ctx.save();
      ctx.font = font(11); ctx.fillStyle = C.dim; ctx.textAlign = "left";
      ctx.fillText(`${nf.format(count)} raw rows in view: zoom in to see each one`, geo.L + 8, geo.T + 14);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.fillStyle = rgba(color, 0.3); ctx.strokeStyle = rgba(color, 0.9); ctx.lineWidth = 1;
    for (let k = first; k < lo; k++) {
      ctx.beginPath(); ctx.arc(X(raw.t[k]), Y(raw.v[k]), 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
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
    const dl = diffLag();
    for (let i = i0; i <= Math.min(i1, n - 1); i++) {
      if (P && i >= split && i >= N) continue;
      take(heroVal(i));
      if (mode === "explore" && !dl && ui.showSmooth && i < N) take(SM[i]);
      if (mode === "explore" && !dl && ui.lastYear && i - a.g.ly >= 0) take(a.y[i - a.g.ly]);
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
    if (dl) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
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
    const shift = (mode === "explore" && !dl) || mode === "decompose" ? trendShift(s, ui) : null;
    if (shift) {
      const x = Math.round(X(T[shift.k])) + 0.5;
      ctx.strokeStyle = rgba(C.warn, 0.7); ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, geo.T - 4); ctx.lineTo(x, geo.T + geo.ph); ctx.stroke(); ctx.setLineDash([]);
    }
    const rawEnd = Math.min(n - 1, N - 1);
    const histEnd = P ? split - 1 : N - 1;
    const raw = (i: number): number => heroVal(i);
    const emphasis = mode !== "explore" || !!dl || !ui.showSmooth || (a.g.unit !== "day" && a.g.unit !== "min");
    if (dl) {
      const z = Math.round(Y(0)) + 0.5;
      ctx.strokeStyle = rgba(C.text, 0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(geo.L, z); ctx.lineTo(geo.L + geo.pw, z); ctx.stroke();
    }
    if (mode === "explore" && !dl && ui.lastYear) {
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
    ctx.globalAlpha = mode === "explore" && !dl && ui.showSmooth && emphasis ? 0.5 : emphasis ? 0.85 : 1;
    ctx.lineWidth = emphasis ? 1.5 : 1;
    linePath(ctx, i0, Math.min(i1, histEnd), raw);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (a.raw && !dl) drawRawRows(ctx, a.raw, T[i0], bucketStart(s.table, a.g, Math.min(i1, histEnd) + 1), X, Y, emphasis ? C.text : C.raw);
    if (a.partial[n - 1] && N === n - 1 && !P && !dl) {
      ctx.setLineDash([2, 3]); ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(T[n - 2]), Y(a.y[n - 2])); ctx.lineTo(X(T[n - 1]), Y(a.y[n - 1])); ctx.stroke(); ctx.setLineDash([]);
    }
    if (P && split < rawEnd + 1) {
      ctx.strokeStyle = rgba(C.text, 0.45); ctx.lineWidth = 1.25;
      linePath(ctx, Math.max(i0, split - 1), Math.min(i1, rawEnd), raw);
      ctx.stroke();
    }
    if (mode === "explore" && !dl && ui.showSmooth) {
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
      const FC = shownForecast(P).f;
      const band = (blo: ArrayLike<number>, bhi: ArrayLike<number>, alpha: number): void => {
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
      if (ui.level === "fan") band(FC.lo95, FC.hi95, 0.13);
      band(FC.lo80, FC.hi80, 0.26);
      if (FC !== P.f) {
        // The model Auto would show, kept faint behind the ARIMA run on screen.
        ctx.strokeStyle = C.dim; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(xs0, Y(y0)); for (let h = 0; h < P.H; h++) ctx.lineTo(X(T[split + h]), Y(P.f.F[h])); ctx.stroke(); ctx.setLineDash([]);
      }
      if (ghostModel && ghostModel !== P.key) {
        const gf = s.futures[ghostModel];
        ctx.strokeStyle = C.dim; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(xs0, Y(y0)); for (let h = 0; h < P.H; h++) ctx.lineTo(X(T[split + h]), Y(gf.F[h])); ctx.stroke(); ctx.setLineDash([]);
      }
      if (ghostArima) {
        const ar = arimaLive();
        if (ar && ar.forecast.F.length >= P.H) {
          ctx.strokeStyle = C.dim; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(xs0, Y(y0)); for (let h = 0; h < P.H; h++) ctx.lineTo(X(T[split + h]), Y(ar.forecast.F[h]!)); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      ctx.strokeStyle = C.forecast; ctx.lineWidth = 2.25; ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(xs0, Y(y0)); for (let h = 0; h < P.H; h++) ctx.lineTo(X(T[split + h]), Y(FC.F[h])); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      if (split < N) {
        for (let h = 0; h < P.H && split + h < N; h++) {
          const v = a.y[split + h];
          if (!(v === v)) continue;
          const out = v < FC.lo80[h] || v > FC.hi80[h];
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
        if (split + h >= i0) { const fv = shownForecast(P).f.F[h]; labels.push({ y: Y(fv), color: C.forecast, text: "Forecast " + shortPeriod(a.g, T[split + h]), val: compact(fv) }); }
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
    if (i < a.n) dot(heroVal(i), C.text);
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
      const dl = diffLag();
      if (dl) rows.push([C.accent, `Change vs ${dl} ${nounFor(gr, dl)} earlier`, i - dl >= 0 ? signed(heroVal(i)) : "–"]);
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
      const fill = GAP_OPTS.find((o) => o[0] === cfgNow.gaps)?.[1] ?? "filled";
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
      // A Pivot View's periods are read at its own grain, never aggregated a second time.
      case "grain": return source !== "" ? [[s.cfg.grain, GRAINS[s.cfg.grain].adj, "the Pivot View's grain"]] : GRAIN_ORDER.map((id) => [id, GRAINS[id].adj]);
      case "agg": return source !== "" ? AGG_OPTS.filter((o) => o[0] === "sum" || o[0] === "mean") : AGG_OPTS;
      case "measure": return info.columns.map((c) => [c.name, c.name, c.timeLike ? "counts time" : c.flag ? "0/1" : ""]);
      case "group": return [["-1", "all"], ...info.groups.map((r, k): [string, string] => [String(k), r])];
      case "gaps": return gapOpts(s);
      case "partial": return [["exclude", "left out", `${s.A.g.noun} left out of models`], ["include", "kept", "treated as complete"]];
      case "date": return dateColumns().map((i) => [String(i), metas[i].name]);
      case "groupBy": {
        const vs = viewSource();
        if (vs) return [["-1", "nothing"], ...vs.splits.map((d): [string, string] => [String(d.index), d.name])];
        return [["-1", "nothing"], ...groupColumns().map((i): [string, string, string] => [String(i), metas[i].name, `${metas[i].stats.distinct} values`])];
      }
      case "source": return [["", "Table", "the rows the Table's filters leave"], ...options.viewSources().map((v): [string, string, string] => [v.id, `Pivot View: ${v.name}`, `by ${v.timeName}`])];
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
      case "source": return source;
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
    const vs = viewSource();
    const showSource = vs !== undefined || options.viewSources().length > 0;
    ref("subline").innerHTML = `${showSource ? `Source ${tok("source")} · ` : ""}${vs ? `Periods of <b>${escapeHtml(vs.timeName)}</b>` : `Dates from ${tok("date")}`} · split by ${tok("groupBy")} · ${nf.format(info.rows)} rows · ${dfDate.format(new Date(info.firstMs))} to ${dfDate.format(new Date(info.lastMs))} · gaps ${tok("gaps")} · partial last ${gr.noun} ${tok("partial")}`;
    const mixed = renderMixed();
    renderSentinel();
    const across = !mixed && c.group < 0 && info.groups.length > 1 && !count && c.agg === "sum" ? ` That adds all ${info.groups.length} ${escapeHtml(info.groupCol ?? "")} values together; pick one if they measure the same thing.` : "";
    ref("why").innerHTML = vs
      ? `Each ${gr.noun} is ${escapeHtml(c.measure ?? "the value")} as the Pivot View <b>${escapeHtml(vs.name)}</b> worked it out; its periods are read as they are, not aggregated again. Edit the view and this series follows.${across}`
      : `Each ${gr.noun} is ${count ? "the number of rows that fall in it" : c.agg === "twmean" ? "the mean of the readings in it, each counted for as long as it held (until the next reading, at most three usual spacings)" : `the ${c.agg} of the rows that fall in it`}.${across} Click any highlighted word to change it. Uses the rows the Table's filters leave.`;
    heroOverlay.setAttribute("aria-label", `${ref("sentence").textContent ?? ""}. Left and right arrows step through periods, Enter shows the rows.`);

    const N = a.modelN, d = s.dec.dec;
    let li = N - 1;
    while (li > 0 && !(a.y[li] === a.y[li])) li--;
    // Only with more than a year behind it: exactly one year back is the first period, often a holiday or a part-recorded one.
    const v = a.y[li], prev = a.y[li - 1], ly = li - gr.ly >= 1 ? a.y[li - gr.ly] : NaN;
    const chip = (x: { v: number; text: string } | null): string => (x ? `<span class="ts-pill ${x.v > 0 ? "up" : x.v < 0 ? "down" : "flat"}">${x.text}</span>` : "");
    const cells: [string, string][] = [
      ...frequencyCell(),
      ["Periods", `${nf.format(a.n)} <small>${gr.nouns}${a.partial[a.n - 1] ? ", last partial" : ""}</small>`],
      [`Latest full ${gr.noun}`, `${compact(v)} ${chip(chg(s, v, prev))}`],
      [`vs ${gr.lyAgo}`, Number.isFinite(ly) ? `${chip(chg(s, v, ly))} <small>${compact(ly)}</small>` : "<small>not enough history</small>"],
    ];
    // One trend rate, with its window named; the same number the Trend finding quotes.
    const tr = d ? trendRate(s, d.trend) : null;
    if (tr) cells.push(["Trend", `${tr.text} <small>over ${tr.window}</small>`]);
    if (d) cells.push(["Season", `${seasonName(gr, d).replace(/^./, (ch) => ch.toUpperCase())} <small>strength ${d.fs.toFixed(2)}</small>`]);
    const key = selectedModel(s, ui);
    if (key) {
      const r = ratioOf(s, key), M0 = models();
      if (M0 && s.futures) {
        const v = verdictFor(s, M0, key);
        cells.push(["Forecast", `${MODEL_INFO[key].name} <span class="ts-pill ts-verdict ${v.cls}">${v.label}</span> <small>${escapeHtml(v.why)}</small>`]);
      } else {
        const gd = grade(r, key);
        cells.push(["Forecast", `${MODEL_INFO[key].name} <span class="ts-pill ${gd.cls}">${gd.text}</span>`]);
      }
    }
    ref("strip").innerHTML = cells.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join("");

    const dlg = diffLag();
    // The line is drawn in the text colour, or in grey when a rolling mean sits over a daily or finer series (see the draw's `emphasis`).
    const rawGrey = ui.mode === "explore" && !dlg && ui.showSmooth && (a.g.unit === "day" || a.g.unit === "min");
    // The swatch takes the line's own colour; the words stay in the text colour so they remain readable.
    // The swatch matches the stroke: grey over a daily rolling mean, otherwise the text colour at the half strength the draw fades it to.
    const faded = ui.mode === "explore" && !dlg && ui.showSmooth && !rawGrey;
    const lg = [`<span style="color:${C.text}"><i${rawGrey ? ` style="border-top-color:${C.raw}"` : faded ? ` style="opacity:0.5"` : ""}></i>${dlg ? `${measureWord(s)} − ${measureWord(s)} ${dlg} ${nounFor(gr, dlg)} earlier` : measureWord(s)}</span>`];
    if (ui.mode === "explore" && !dlg && ui.showSmooth) lg.push(`<span style="color:${C.accent}"><i></i>Rolling ${c.smoothStat} - ${c.smoothW} ${c.smoothW === 1 ? gr.noun : gr.nouns.split(" ").pop()}${c.smoothCentred ? ", centred" : ""}</span>`);
    if (a.raw && !dlg) lg.push(`<span style="color:${C.dim}"><svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><circle cx="4.5" cy="4.5" r="3.5" fill="${C.raw}" fill-opacity="0.3" stroke="${C.raw}"/></svg>Raw rows</span>`);
    if (ui.mode === "explore" && !dlg && ui.lastYear) lg.push(`<span style="color:${C.dim}"><i class="dash"></i>${gr.lyShort}</span>`);
    if (ui.mode === "decompose") lg.push(`<span style="color:${C.accent}"><i></i>Trend</span>`);
    if ((ui.mode === "explore" || ui.mode === "decompose") && trendShift(s, ui)) lg.push(`<span style="color:${C.warn}"><i class="dash"></i>Trend shift (estimated)</span>`);
    if ((ui.mode === "explore" || ui.mode === "decompose") && s.dec.anomalies.length) lg.push(`<span style="color:${C.danger}">◯ Unusual</span>`);
    const fk = selectedModel(s, ui);
    const arShown = ui.mode === "forecast" && arimaShown ? arimaLive() : null;
    if (ui.mode === "forecast" && s.futures) lg.push(arShown
      ? `<span style="color:${C.forecast}"><i class="dash"></i>Forecast: <b class="ts-mono">${escapeHtml(arShown.label)}</b> <small>run by you</small></span>`
      : `<span style="color:${C.forecast}"><i class="dash"></i>Forecast: <b>${fk ? MODEL_INFO[fk].name : ""}</b> <small>${ui.model === "auto" ? autoLabel() : "picked"}</small></span>`);
    renderHeroBadge(s, fk);
    if (ui.mode === "forecast" && s.futures) lg.push(`<span style="color:${C.forecast}"><span style="color:${C.forecast}"><i class="band"></i>${ui.level === "fan" ? "80% and 95%" : "80%"} range</span>`);
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
  /**
   * The banner for a line made of several series: the rows at one moment are one per
   * store, car park or sensor, and the page would otherwise add or average them silently.
   * Returns whether it is showing.
   */
  /**
   * An error code in the measure (-999, 9999) is not a reading: left in, it drags the line, the trend and the forecast range to
   * values the quantity could never take. The column's own cleaning suggestion is offered here, where the damage shows.
   */
  function renderSentinel(): void {
    const box = ref("sentinel");
    const name = cfg?.measure ?? null;
    const col = name === null ? -1 : metas.findIndex((m) => m.name === name);
    const hit = col < 0 || cfg?.agg === "count" ? undefined : metas[col]!.suggestions.find((x): x is Extract<ColumnSuggestion, { kind: "sentinel" }> => x.kind === "sentinel" && Number.isFinite(Number(x.value)));
    if (!hit) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="ts-mixed-icon" aria-hidden="true">!</div><div class="ts-mixed-body"><b class="ts-mixed-title">An error code in ${escapeHtml(name ?? "the measure")}</b><p><b>${escapeHtml(hit.value)}</b> appears ${nf.format(hit.count)} times. It looks like an error code, not a reading, and it pulls the line, the trend and the forecast range toward values the measure cannot take.${hit.hint ? " " + escapeHtml(hit.hint) : ""}</p><div class="ts-mixed-acts"><button type="button" class="primary" data-sentinel="${col}">Treat ${escapeHtml(hit.value)} as missing</button></div></div>`;
    box.dataset.value = hit.value;
    box.dataset.sentinelCol = String(col);
  }
  function renderMixed(): boolean {
    const box = ref("mixed");
    const s = snap, c = cfg;
    const keepKey = `${dateColumn}|${groupColumn}|${c?.group ?? -1}`;
    const repeats = !!shape && (shape.typical >= 2 || shape.repeatShare >= 0.5);
    // Event rows (trips, orders) rarely share a timestamp, but a period can still add up hundreds of them from many places.
    const crowded = !!shape && s !== null && c !== null && c.group < 0 && shape.suggest.length > 0 && s.A.n > 0 && shape.rows / s.A.n >= 3;
    if (!s || !c || !shape || !(repeats || crowded) || c.agg === "count" || keptMixed.has(keepKey)) {
      box.hidden = true;
      return false;
    }
    const key = shape.keys[0];
    const sug = shape.suggest[0];
    const date = escapeHtml(s.table.dateCol);
    const usual = Math.max(2, shape.typical);
    const perPeriod = Math.round(shape.rows / Math.max(1, s.A.n));
    const where = !repeats
      ? `Each ${escapeHtml(s.A.g.noun)} holds about <b>${nf.format(perPeriod)} rows</b>${sug ? `, from <b>${nf.format(sug.distinct)} different ${escapeHtml(sug.name)}</b> values` : ""}`
      : shape.repeatShare >= 0.9
        ? `Each moment in <b>${date}</b> holds <b>${nf.format(usual)} rows</b>`
        : `<b>${Math.round(shape.repeatShare * 100)}%</b> of moments in <b>${date}</b> hold more than one row (usually ${nf.format(usual)})`;
    const verb = c.agg === "sum" ? "adds" : c.agg === "mean" || c.agg === "twmean" ? "averages" : c.agg === "median" ? "takes the median of" : "combines";
    const series = key ? `${nf.format(key.distinct)} ${escapeHtml(key.name)} series` : sug && !repeats ? `${nf.format(sug.distinct)} ${escapeHtml(sug.name)} series` : `${nf.format(usual)} different series`;
    const name = key ? escapeHtml(key.name) : "";
    const lead = `${where}${key ? `, one per <b>${name}</b>` : ""}${shape.most > usual ? ` (up to ${nf.format(shape.most)})` : ""}. This line ${verb} ${series} together, and trend, seasons and forecasts need one series.`;
    const tail = key ? "" : sug ? ` Pick one <b>${escapeHtml(sug.name)}</b> to see a single series:` : " No single column tells these rows apart, so filter the Table to one series first.";
    const acts: string[] = [];
    if (key) acts.push(`<button type="button" class="primary" data-mixed="one" data-col="${key.column}">One ${name} at a time</button>`);
    else if (sug) {
      const short = (t: string): string => (t.length > 28 ? `${t.slice(0, 27)}…` : t);
      for (const v of sug.values.slice(0, 3)) acts.push(`<button type="button" class="primary" data-mixed="pick" data-col="${sug.column}" data-label="${escapeHtml(v.label)}" title="${nf.format(v.rows)} rows">${escapeHtml(short(v.label))} <small>${nf.format(v.rows)}</small></button>`);
      acts.push(`<button type="button" data-mixed="more" data-col="${sug.column}">All ${nf.format(sug.distinct)}…</button>`);
    }
    const others = shape.suggest.slice(1).map((o) => `<button type="button" class="link" data-mixed="more" data-col="${o.column}">${escapeHtml(o.name)} (${nf.format(o.distinct)})</button>`).join(" ");
    const alt = !key && sug && others ? `<p class="ts-mixed-alt">Or pick by ${others}</p>` : "";
    if (c.agg === "sum") acts.push(`<button type="button" data-mixed="mean">Average them instead</button>`);
    acts.push(`<button type="button" data-mixed="keep">Keep the ${escapeHtml(c.agg === "twmean" ? "time-weighted mean" : c.agg)}</button>`);
    box.innerHTML = `<div class="ts-mixed-icon" aria-hidden="true">!</div><div class="ts-mixed-body"><b class="ts-mixed-title">Several series in one line</b><p>${lead}${tail}</p><div class="ts-mixed-acts">${acts.join("")}</div>${alt}</div>`;
    box.dataset.keep = keepKey;
    box.hidden = false;
    return true;
  }
  /** "Every 30 minutes, regular" or "Irregular, usually every 12 minutes", from the moments' spacing. */
  function frequencyCell(): [string, string][] {
    const sp = shape?.spacing;
    if (!sp) return [];
    const every = cadenceText(sp.typicalMs / DAY);
    const lo = cadenceText(sp.p10Ms / DAY), hi = cadenceText(sp.p90Ms / DAY);
    // "26 to 34 minutes", not "26 minutes to 34 minutes".
    const unit = hi.split(" ").pop() ?? "";
    const range = lo === hi ? hi : lo.endsWith(` ${unit}`) && /^\d/.test(lo) ? `${lo.slice(0, -unit.length - 1)} to ${hi}` : `${lo} to ${hi}`;
    const title = `${Math.round(sp.onBeat * 100)}% of gaps are one ${every}; ${Math.round(sp.onGrid * 100)}% are a whole number of them. Most gaps run ${range}.`;
    const value = sp.kind === "irregular"
      ? `Irregular <small>usually every ${every}, most ${range}</small>`
      : `Every ${every} <small>${sp.kind === "regular" ? "regular" : "regular, some missing"}</small>`;
    return [[`<span title="${escapeHtml(title)}">Frequency</span>`, value]];
  }
  const numUnit = (k: number): string => (snap ? nounFor(snap.A.g, k).split(" ").pop() ?? "" : "");
  function setNum(name: string, v: number, max: number): void {
    const el = ref<HTMLInputElement>(name);
    el.max = String(max);
    if (document.activeElement !== el) el.value = String(v);
  }
  function maxSmooth(): number { const a = A(); return Math.max(a.g.smoothMax, Math.floor(a.modelN / 2)); }
  function renderModePanel(): void {
    const s = snap as TsSnapshot, a = s.A, gr = a.g, c = s.cfg, info = s.table;
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
      syncDiff();
      ref("shiftWrap").hidden = !(s.dec.cp && s.dec.cp.gain > 0.5);
      ref("lastYearText").textContent = gr.lyText;
      for (const b of ref("statSeg").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.stat === c.smoothStat));
      const filled = a.filled.reduce((sum, x) => sum + x, 0);
      const steps = [
        { id: "resample", name: "Resample", val: `${gr.adj} ${tokText("agg")}`, on: true },
        { id: "fill", name: "Fill", val: filled ? `${filled} ${nounFor(gr, filled)} ${tokText("gaps")}` : "No missing periods", on: true },
        { id: "smooth", name: "Smooth", val: `${c.smoothW}-${gr.noun.split(" ").pop()} ${c.smoothStat}`, on: ui.showSmooth },
        { id: "compare", name: "Compare", val: gr.lyText, on: ui.lastYear },
        { id: "diff", name: "Difference", val: diffLag() ? `lag ${lagLabel(diffLag())}` : "off", on: !!diffLag() },
      ];
      const ol = ref("pipeline");
      if (ol.children.length !== steps.length) ol.innerHTML = steps.map((st) => `<li><button type="button" class="ts-step" data-step="${st.id}"><span class="ts-step-name">${st.name}</span><span class="ts-step-val"></span><canvas></canvas></button></li>`).join("");
      steps.forEach((st, k) => {
        const btn = ol.children[k].querySelector("button") as HTMLButtonElement;
        btn.setAttribute("aria-pressed", String(st.on));
        (btn.querySelector(".ts-step-val") as HTMLElement).innerHTML = st.val;
        drawSpark(btn.querySelector("canvas") as HTMLCanvasElement, st.id);
      });
    }
    if (ui.mode === "decompose") {
      const d = s.dec.dec;
      const cap1 = (t: string): string => t.replace(/^./, (ch) => ch.toUpperCase());
      // Seasons the series is too short for stay visible, greyed, with what they would need.
      const short = s.dec.tooShort.map(({ m, need }) => {
        const why = `Needs ${nf.format(need)} ${gr.nouns}: two full cycles plus two, so the season can be told apart from the trend. This series has ${nf.format(s.A.modelN)}. That minimum is this page's rule; fpp3 (Hyndman and Athanasopoulos) sets none.`;
        return `<button type="button" disabled title="${escapeHtml(why)}">${cap1(periodName(gr, m))} <small>needs ${nf.format(need)}</small></button>`;
      }).join("");
      const fits = s.dec.options.map((o) => `<button type="button" data-period="${o.m}" aria-pressed="${!!d && o.m === d.m}">${cap1(seasonName(gr, o))} <small>${o.fs.toFixed(2)}</small></button>`).join("");
      ref("periodSeg").innerHTML = (fits || `<span class="ts-note">No seasonal period fits this series.</span>`) + short;
      // Below a day the cycles are the day and the week; the week and year read better from daily totals.
      const decGrain = ref("decGrain");
      const fine = (["hour", "min30", "min15", "min5"] as GrainId[]).find((id) => !info.tooFine[id]);
      if (source === "" && gr.unit === "min" && !info.tooFine.day) {
        decGrain.hidden = false;
        decGrain.dataset.grain = "day";
        decGrain.textContent = "Daily view: weekly and yearly season →";
        decGrain.title = "Combines each day first, so the week and the year show without the swings within a day. Data read more than once a day usually has a daily and a weekly cycle; a yearly one needs two years of days.";
      } else if (source === "" && gr.id === "day" && info.subDay && fine) {
        decGrain.hidden = false;
        decGrain.dataset.grain = fine;
        decGrain.textContent = `Back to ${GRAINS[fine].adj.toLowerCase()}: daily and weekly cycle`;
        decGrain.title = "The data is read more than once a day: at that grain the season splits into the cycle within a day and what each weekday adds.";
      } else decGrain.hidden = true;
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
      ref("flexOut").textContent = `${c.flex} · ${c.flex <= 3 ? "Stiff" : c.flex >= 8 ? "Bendy" : "Medium"}`;
      renderFlex();
      renderDrivers();
      const M = models();
      ref("splitReset").hidden = !(M && M.T < a.modelN);
      // The training period: everything before the split line.
      ref("trainNote").textContent = M ? `Learns from ${shortPeriod(gr, a.t[0])} to ${shortPeriod(gr, a.t[M.T - 1])}${M.T < a.modelN ? " (drag the split line to change)" : ""}` : "";
      renderBoard();
      renderDeep();
      renderArima();
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
    if (id === "diff") {
      const lag = ui.diffLag || defaultLag();
      const d = (i: number): number => (i - lag >= 0 ? a.y[i] - a.y[i - lag] : NaN);
      lo = 0; hi = 0;
      for (let i = lag; i < n; i++) { const v = d(i); if (v === v) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      ctx.strokeStyle = rgba(C.dim, 0.6); ctx.lineWidth = 0.75; ctx.beginPath(); ctx.moveTo(0, sy(0)); ctx.lineTo(r.width, sy(0)); ctx.stroke();
      line(d, ui.diff ? C.accent : rgba(C.raw, 0.7), 1, lag);
    }
    if (id === "compare") { line((i) => a.y[i], rgba(C.raw, 0.6), 1, a.g.ly); ctx.setLineDash([3, 2]); line((i) => (i - a.g.ly >= 0 ? a.y[i - a.g.ly] : NaN), C.dim, 1, a.g.ly); ctx.setLineDash([]); }
  }
  /** A model's rank among the seven on the lockbox fold, by the chosen measure. */
  /** A model's score on the lockbox fold (bias by its size); Infinity when it has none. */
  function lockValue(M: ModelRun, key: ModelKey, mk: MetricKey): number { const x = M.models[key].lock?.[mk] ?? NaN; return x === x ? (mk === "bias" ? Math.abs(x) : x) : Infinity; }
  /** Place on the lockbox fold among the core models (the four extra yardsticks are not counted). */
  function lockRank(M: ModelRun, key: ModelKey, mk: MetricKey): number {
    return 1 + CORE_KEYS.filter((k) => lockValue(M, k, mk) < lockValue(M, key, mk)).length;
  }

  // ---------------------------------------------------------------- difference (Explore)
  /** The lag in use: 0 when the difference is off or not in Explore. */
  function diffLag(): number { return ui.mode === "explore" && ui.diff && snap ? Math.max(1, Math.min(ui.diffLag || defaultLag(), snap.A.n - 2)) : 0; }
  /** The shortest season that fits, else 1: the lag most worth looking at first. */
  function defaultLag(): number {
    const a = snap?.A;
    if (!a) return 1;
    const fit = a.g.periods.filter((p) => a.modelN >= 2 * p + 2);
    return fit.length ? Math.min(...fit) : 1;
  }
  function lagLabel(lag: number): string {
    const g = snap?.A.g, name = g?.seasons[lag];
    return name ? `${lag} (${name})` : String(lag);
  }
  /** What the chart plots: the value, or its change from `lag` periods earlier. */
  function heroVal(i: number): number {
    const a = (snap as TsSnapshot).A, dl = diffLag();
    if (!dl) return a.y[i];
    return i - dl >= 0 ? a.y[i] - a.y[i - dl] : NaN;
  }
  function syncDiff(): void {
    const s = snap as TsSnapshot, g = s.A.g, lag = ui.diffLag || defaultLag();
    ref<HTMLInputElement>("diffOn").checked = ui.diff;
    setNum("diffLag", lag, Math.max(1, s.A.n - 2));
    ref("diffUnit").textContent = nounFor(g, lag).split(" ").pop() ?? "";
    const presets = [1, ...g.periods.filter((p) => s.A.modelN >= 2 * p + 2), g.ly].filter((v, k, arr) => v >= 1 && arr.indexOf(v) === k).sort((p, q) => p - q);
    ref("diffPresets").innerHTML = presets.map((p) => `<button type="button" data-lag="${p}" aria-pressed="${ui.diff && p === lag}">${p === 1 ? "1 (previous)" : lagLabel(p)}</button>`).join("");
    const note = ref("diffNote");
    const dl = diffLag();
    if (!dl) { note.textContent = ""; return; }
    const a = s.A;
    let sum = 0, sq = 0, k = 0, ss = 0, sk = 0;
    for (let i = dl; i < a.modelN; i++) {
      if (a.filled[i] || a.filled[i - dl]) continue;
      const v = a.y[i] - a.y[i - dl], u = a.y[i];
      if (v === v) { sum += v; sq += v * v; k++; }
      if (u === u) { ss += u; sk++; }
    }
    if (!k) { note.textContent = ""; return; }
    const mean = sum / k, sd = Math.sqrt(Math.max(0, sq / k - mean * mean));
    let vy = 0; const my = ss / (sk || 1);
    for (let i = 0; i < a.modelN; i++) { const u = a.y[i]; if (u === u && !a.filled[i]) vy += (u - my) * (u - my); }
    const sdy = Math.sqrt(vy / (sk || 1));
    note.innerHTML = `Mean change <b>${signed(mean)}</b>, SD <b>${full(sd)}</b> (the series' own SD is ${full(sdy)}; ${sd < sdy ? `differencing removes ${Math.round((1 - (sd * sd) / (sdy * sdy)) * 100)}% of the variance` : "differencing adds variance: this lag is not a cycle of the series"}). Filled periods are left out.`;
  }

  // ---------------------------------------------------------------- forecast badge and trend flexibility
  /** The cycle the seasonal naive repeats, in a word ("year", "week"). */
  /** The cycle "repeat the last cycle" really copies: the season the models used at this grain, not always a year. */
  const cycleWord = (s: TsSnapshot): string => {
    const m = "error" in s.models ? 0 : s.models.m;
    const name = m > 0 ? s.A.g.seasons[m] : undefined;
    const word = name === "weekly" ? "week" : name === "daily" ? "day" : name === "yearly" ? "year" : name === "monthly" ? "month" : name === "quarterly" ? "quarter" : "";
    if (word) return word;
    if (m > 0) return `${m} ${m === 1 ? s.A.g.noun : s.A.g.nouns}`;
    return s.A.g.lyShort.replace(/^last /i, "").toLowerCase() || "cycle";
  };
  /**
   * The simple method a model is judged against: the best of the simple methods in the backtests, or repeating the last cycle when
   * none of them beat that. An analyst may well choose it, so the page names it, tags it on the board and offers it.
   */
  function yardstickOf(s: TsSnapshot, M: ModelRun, key: ModelKey): { key: ModelKey; name: string; ratio: number } {
    const simples = BENCHMARK_KEYS.filter((k) => k !== "sn" && k !== key && M.shown.includes(k)).map((k) => ({ key: k, name: MODEL_INFO[k].name, ratio: ratioOf(s, k) })).filter((x) => Number.isFinite(x.ratio) && x.ratio < 1);
    return simples.length ? simples.reduce((p, q) => (q.ratio < p.ratio ? q : p)) : { key: "sn", name: MODEL_INFO.sn.name, ratio: 1 };
  }
  /** The one definition of "lowest error": the least backtest error against repeating the last cycle, across every model, AutoARIMA included once it has finished. */
  function lowestError(s: TsSnapshot, M: ModelRun): { key: ModelKey | "arima"; name: string; ratio: number } {
    let best: { key: ModelKey | "arima"; name: string; ratio: number } = { key: "sn", name: MODEL_INFO.sn.name, ratio: Infinity };
    for (const k of M.shown) {
      const r = ratioOf(s, k);
      if (Number.isFinite(r) && r < best.ratio) best = { key: k, name: MODEL_INFO[k].name, ratio: r };
    }
    const ar = arimaRow(s, M);
    if (ar && ar.ratio < best.ratio) best = { key: "arima", name: ar.label, ratio: ar.ratio };
    return best;
  }
  /** Everything the trust verdict needs about one model, from results the page already holds. */
  function verdictFor(s: TsSnapshot, M: ModelRun, key: ModelKey): Verdict {
    const m = M.models[key], f = s.futures![key];
    const band = f.held ? { hit: f.held.hit, tot: f.held.tot, aim: 0.8 } : m.check ? { hit: m.check.hit, tot: m.check.tot, aim: 0.8 } : null;
    // The lowest-error model (the same one the answer cards and the ranked list mark), and how much less error it had than this one.
    const own = ratioOf(s, key);
    const low = lowestError(s, M);
    const leader = low.key !== key && Number.isFinite(own) && own > 0 && Number.isFinite(low.ratio) ? { name: low.name, gapPct: Math.max(0, ((own - low.ratio) / own) * 100) } : null;
    // The simple method that did best in the backtests (other than repeating the last cycle): the model has to beat that too.
    const yard = yardstickOf(s, M, key);
    const bestSimple = yard.key === "sn" ? null : { name: yard.name, ratio: yard.ratio };
    return trustVerdict({
      baseline: key === "sn", ratio: ratioOf(s, key), lockRank: M.lockbox && m.lock ? lockRank(M, key, ui.metric) : null, models: CORE_KEYS.length,
      intermittent: M.intermittent, leader, bestSimple,
      beatenBy: M.lockbox && m.lock && !BENCHMARK_KEYS.includes(key) ? BENCHMARK_KEYS.filter((b) => !CORE_KEYS.includes(b) && lockValue(M, b, ui.metric) < lockValue(M, key, ui.metric)).map((b) => MODEL_INFO[b].name) : [],
      foldsWon: m.folds.won, foldsOf: m.folds.of, band, rough: M.rough, periods: s.A.modelN, cycle: cycleWord(s),
    });
  }
  /** The findings, with the forecast card worded by the same verdict as the badge and the strip. */
  function makeInsights(): TsFinding[] {
    const s = snap as TsSnapshot, list = buildInsights(s, ui), M = models(), key = M && s.futures ? selectedModel(s, ui) : null;
    if (!M || !s.futures || !key) return list;
    const at = list.findIndex((f) => f.tone === "forecast" && f.kind.startsWith("Forecast"));
    if (at < 0) return list;
    const v = verdictFor(s, M, key), f = s.futures[key];
    let avg = 0, lo = 0, hi = 0;
    for (let k = 0; k < M.H; k++) { avg += f.F[k]; lo += f.lo80[k]; hi += f.hi80[k]; }
    const tone: TsTone = v.level === "holds" ? "forecast" : v.level === "middling" ? "warn" : "dim";
    list[at] = {
      ...list[at]!, tone, kind: `Forecast · ${v.label}`,
      html: `<b>${MODEL_INFO[key].name}</b>: ${escapeHtml(v.sentence)} Next ${M.H} ${nounFor(s.A.g, M.H)}: <b>${compact(avg / M.H)}</b> on average, most likely between ${compact(lo / M.H)} and ${compact(hi / M.H)}.`,
    };
    return list;
  }
  function renderHeroBadge(s: TsSnapshot, key: ModelKey | null): void {
    const badge = ref("heroBadge"), M = models();
    if (ui.mode !== "forecast" || !M || !s.futures || !key) { badge.hidden = true; return; }
    const arRow = arimaShown ? arimaRow(s, M) : null;
    if (arRow) {
      badge.dataset.level = arRow.verdict.level;
      badge.innerHTML = `<div class="ts-badge-top"><span class="ts-badge-label">Forecast</span><b class="ts-mono">${escapeHtml(arRow.label)}</b><span class="ts-autotag">${arRow.dv ? "DV-ARIMA" : "AutoARIMA"}</span>${arimaChip()}<span class="ts-pill ts-verdict ${arRow.verdict.cls}">${arRow.verdict.label}</span><small>${arimaWho()} · error ${arRow.ratio.toFixed(2)}× repeating the last ${cycleWord(s)}</small><button type="button" class="ts-link" data-arima-params="1" data-arima-open="1" title="The fitted terms, their meaning and the models tried">Parameters</button><button type="button" class="ts-link" data-ans-show="${key}" title="Back to ${escapeHtml(MODEL_INFO[key].name)}">Show ${escapeHtml(MODEL_INFO[key].name)} instead</button></div>
        <div class="ts-qa"><div class="ts-qa-row"><span class="ts-qa-q">Is it better than the simple method?</span><span class="ts-qa-a"><span class="ts-pill ${arRow.ratio < 1 ? "good" : "poor"}">${arRow.ratio < 1 ? "Yes" : "No"}</span></span><span class="ts-qa-t">${arRow.ratio < 1 ? `${Math.round((1 - arRow.ratio) * 100)}% less error` : `${Math.round((arRow.ratio - 1) * 100)}% more error`} than repeating the last ${cycleWord(s)} in the backtests. ${escapeHtml(arRow.verdict.sentence)}</span></div></div>`;
      badge.hidden = false;
      return;
    }
    const v = verdictFor(s, M, key);
    badge.dataset.level = v.level;
    badge.innerHTML = `<div class="ts-badge-top"><span class="ts-badge-label">Forecast</span><b>${MODEL_INFO[key].name}</b><span class="ts-pill ts-verdict ${v.cls}">${v.label}</span><small>${ui.model === "auto" ? autoLabel() : "picked by you"}</small>${arimaChip()}<button type="button" class="ts-link" data-hood="1" title="The numbers behind this verdict, and how each model did">Details</button><button type="button" class="ts-link" data-info="verdict" title="What Reliable and Use with care mean, and how they were checked">How this is decided</button></div>
      <div class="ts-qa">${v.answers.map((a) => `<div class="ts-qa-row"><span class="ts-qa-q">${escapeHtml(a.q)}</span><span class="ts-qa-a"><span class="ts-pill ${a.cls}">${escapeHtml(a.a)}</span></span><span class="ts-qa-t">${escapeHtml(a.text)}</span></div>`).join("")}</div>
      ${(() => {
        if (key === "sn" || v.level === "baseline" || v.level === "untested") return "";
        const y = yardstickOf(s, M, key);
        return `<div class="ts-yard" data-yard="${y.key}">Compared with <b>${escapeHtml(y.name)}</b>, ${y.key === "sn" ? "the simplest yardstick" : "the best simple method in the backtests"}. <button type="button" class="ts-link" data-yard-use="${y.key}" title="Show ${escapeHtml(y.name)} as the forecast. Hover to see it on the chart.">Use it instead</button></div>`;
      })()}
      ${v.headsUp.map((h) => `<div class="ts-headsup"><b>Also:</b> ${escapeHtml(h)}</div>`).join("")}`;
    badge.hidden = false;
    // The numbers behind the verdict, for analysts, at the top of Under the hood.
    const m = M.models[key], r = ratioOf(s, key), f = s.futures[key];
    const heldMode = M.T < s.A.modelN && f.held?.ratio != null;
    const better = key === "sn" ? "the baseline every other model is measured against" : !Number.isFinite(r) ? "no backtest was possible with this little history, so there is nothing to compare it with" : r < 1 ? `${Math.round((1 - r) * 100)}% less error than repeating the last cycle` : `${Math.round((r - 1) * 100)}% <b>more</b> error than repeating the last cycle`;
    const lucky = key !== "sn" && m.folds.of > 0 && m.folds.won * 2 < m.folds.of;
    const band = f.held ? `${f.held.hit} of ${f.held.tot} held-out actuals inside the 80% band` : m.check ? `${m.check.hit} of ${m.check.tot} inside the 80% band on the latest fold` : "";
    ref("heroDetail").innerHTML = `<div class="ts-badge-body"><b>${MODEL_INFO[key].name}</b>: ${better} at the same horizons, ${heldMode ? "on the held-out actuals" : `over ${M.origins.length} backtest folds`} · ${METRIC_INFO[ui.metric].label} ${metricText(ui.metric, m.metrics[ui.metric])}${ui.metric === "mase" ? " (scaled by the in-sample one-cycle naive error, so multi-step forecasts often sit above 1)" : ""}${key !== "sn" ? ` · beat it in ${m.folds.won} of ${m.folds.of} folds` : ""}${band ? ` · ${band}` : ""}${lucky ? ` · <span class="ts-warn">wins under half its folds: may be luck</span>` : ""}${M.rough ? ` · <span class="ts-warn">under 3 folds: rough</span>` : ""}</div>${lockLine(M, key)}`;
  }
  function openDocs(open: string): void { openModelDetails({ snap, open, metric: ui.metric }); }
  /** What Auto did, in a few words for the legend and the strip. */
  function autoLabel(): string {
    const M = models();
    if (!M) return "Auto";
    const a = M.auto[ui.metric];
    if (M.autoPolicy === "backtest") return `Auto · backtest winner on ${METRIC_INFO[ui.metric].label}`;
    return a.pick === "comb" ? "Auto · the combination (default)" : `Auto · beat the combination on folds, lockbox and significance`;
  }
  /** How the pick did on the lockbox fold, which the choice never saw. */
  function lockLine(M: ModelRun, key: ModelKey): string {
    const m = M.models[key], mk = ui.metric;
    if (!M.lockbox || !m.lock) return "";
    const R = M.origins.length, rank = lockRank(M, key, mk), base = M.models.sn.lock?.[mk] ?? NaN, v = m.lock[mk];
    const beats = key === "sn" ? "" : v === v && base === base ? (Math.abs(v) < Math.abs(base) ? " and beat repeating the last cycle" : `, <span class="ts-warn">but did not beat repeating the last cycle (${metricText(mk, base)})</span>`) : "";
    const vd = snap ? verdictFor(snap, M, key) : null;
    const level = vd ? vd.level : "middling";
    const verdict = level === "holds" ? "Reliable: it beats the simple methods on data it never saw and its range held up" : level === "middling" ? `Use with care: ${vd?.why ?? "its edge over the simple methods is not clear"}` : level === "baseline" ? "The baseline every other model is measured against" : "Can't judge yet: too little history to hold a test back";
    return `<div class="ts-badge-lock"><b>Lockbox check</b>: picked on folds 1–${R - 1}; on fold ${R}, which the choice never saw, it ranked <b>#${rank} of ${CORE_KEYS.length}</b> (${METRIC_INFO[mk].label} ${metricText(mk, v)})${beats}. ${verdict}.</div>`;
  }
  let curve: { key: string; points: { flex: number; mase: number }[] } | null = null;
  let curveBusy = false;
  const curveKey = (s: TsSnapshot): string => JSON.stringify({ ...s.cfg, flex: 0, h: s.H, src: source, d: dateColumn, gb: groupColumn });
  function renderFlex(): void {
    const s = snap as TsSnapshot, M = models(), c = s.cfg;
    const d = flexDetail(M ? M.T : s.A.modelN, c.flex);
    const lam = d.lambda >= 1 ? d.lambda.toFixed(1) : d.lambda >= 0.01 ? d.lambda.toFixed(2) : d.lambda.toExponential(0);
    ref("flexNote").innerHTML = `A piecewise-linear trend with <b>${d.hinges} hinges</b> (possible changepoints) spread over the first 85% of the history, as in Prophet. Each hinge's change in slope carries a ridge (L2) penalty of <b>λ = ${lam}</b> × its own scale (λ runs from 12 at 1 to 0.003 at 10). `
      + `<b>Stiff</b>: close to one straight line. High bias, low variance; it misses real turns but extrapolates calmly. <b>Bendy</b>: the trend can turn at every hinge. Low bias, high variance; it follows recent wiggles and extrapolates the last slope, which is how this model overfits. `
      + `Judge it by the backtest, never by how well the line hugs the history: <b>Check every setting</b> draws the validation curve.`;
    const box = ref("flexCurve");
    if (!curve || curve.key !== curveKey(s) || !curve.points.length) { box.hidden = true; ref("flexCheck").textContent = curveBusy ? "Checking…" : "Check every setting"; return; }
    ref("flexCheck").textContent = "Check again";
    const pts = curve.points, best = pts.reduce((p, q) => (q.mase < p.mase ? q : p));
    const pick = pts.find((p) => p.mase <= best.mase * 1.05) ?? best; // the stiffest within 5% of the best
    const ref0 = M ? Math.min(...M.shown.filter((k) => k !== "reg" && k !== "ens" && k !== "sn").map((k) => M.models[k].mase)) : NaN;
    const refKey = M ? M.shown.filter((k) => k !== "reg" && k !== "ens" && k !== "sn").find((k) => M.models[k].mase === ref0) : undefined;
    const W = 360, Hh = 120, L = 34, B = 20, top = 8;
    const vals = [...pts.map((p) => p.mase), ...(ref0 === ref0 ? [ref0] : [])];
    const lo = Math.min(...vals) * 0.95, hi = Math.max(...vals) * 1.05 || 1;
    const sx = (f: number): number => L + ((f - 1) / 9) * (W - L - 8), sy = (v: number): number => top + (1 - (v - lo) / (hi - lo || 1)) * (Hh - top - B);
    const path = pts.map((p, k) => `${k ? "L" : "M"}${sx(p.flex).toFixed(1)},${sy(p.mase).toFixed(1)}`).join("");
    const dots = pts.map((p) => `<circle cx="${sx(p.flex).toFixed(1)}" cy="${sy(p.mase).toFixed(1)}" r="${p.flex === c.flex ? 5 : 3}" class="${p.flex === c.flex ? "cur" : p === pick ? "pick" : ""}"><title>Flexibility ${p.flex}: MASE ${p.mase.toFixed(3)}</title></circle>`).join("");
    const refLine = ref0 === ref0 && refKey ? `<line x1="${L}" x2="${W - 8}" y1="${sy(ref0).toFixed(1)}" y2="${sy(ref0).toFixed(1)}" class="ref"/><text x="${W - 10}" y="${(sy(ref0) - 4).toFixed(1)}" text-anchor="end" class="reft">${MODEL_INFO[refKey].name} ${ref0.toFixed(2)}</text>` : "";
    const axis = `<text x="${L - 4}" y="${sy(hi / 1.05) + 4}" text-anchor="end">${(hi / 1.05).toFixed(2)}</text><text x="${L - 4}" y="${sy(lo / 0.95) + 4}" text-anchor="end">${(lo / 0.95).toFixed(2)}</text>`
      + [1, 5, 10].map((f) => `<text x="${sx(f)}" y="${Hh - 4}" text-anchor="${f === 1 ? "start" : f === 10 ? "end" : "middle"}">${f === 1 ? "1 stiff" : f === 10 ? "10 bendy" : "5"}</text>`).join("");
    const rising = pts[9]!.mase > best.mase * 1.05 && best.flex < 10;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Backtest MASE at each trend flexibility">${refLine}<path d="${path}"/>${dots}${axis}</svg>
      <div class="ts-flexread"><p>Backtest MASE of the trend, seasons and drivers model at each setting, on the board's ${M?.origins.length ?? ""} folds (lower is better). Lowest at <b>${best.flex}</b> (${best.mase.toFixed(3)}); you are on <b>${c.flex}</b> (${pts[c.flex - 1]!.mase.toFixed(3)}).</p>
      <p>${rising ? "The error rises again as the trend gets bendier: past the lowest point the trend is <b>fitting noise</b>. " : best.flex >= 9 ? "The error keeps falling as the trend bends: the series has real turns the stiff trend misses. " : ""}Suggested: <b>${pick.flex}</b>, the stiffest setting within 5% of the lowest. When scores are this close, the simpler trend has less room to have learned noise (a one-standard-error style rule).</p>
      ${pick.flex !== c.flex ? `<button class="ts-ghost" type="button" data-flexpick="${pick.flex}">Use ${pick.flex}</button>` : ""}</div>`;
    box.hidden = false;
  }
  function checkFlex(): void {
    const s = snap;
    if (!s || !cfg || curveBusy) return;
    curveBusy = true;
    ref("flexCheck").textContent = "Checking…";
    const key = curveKey(s);
    void options.request({ dateColumn, groupColumn, config: cfg, mode: "forecast", source, flexCurve: true }).then((msg) => {
      curveBusy = false;
      curve = { key, points: msg?.snapshot?.flexCurve ?? [] };
      invalidate("ui", "panel");
    });
  }
  // ---------------------------------------------------------------- Deep check
  let deep: { key: string; result: DeepCheck | null } | null = null;
  let deepBusy = false;
  /** Rough complexity, for "prefer the simpler model when it is not significantly worse". */
  const COMPLEXITY: Record<ModelKey, number> = { croston: 1, sba: 1, tsb: 1, sn: 0, naive: 0, mean: 0, drift: 1, ses: 1, clim: 1, theta: 2, hw: 3, ets: 3, comb: 4, reg: 4, ens: 5 };
  const deepKey = (s: TsSnapshot, pick: ModelKey): string => `${curveKey(s)}|${s.cfg.flex}|${pick}`;
  function runDeep(): void {
    const s = snap, pick = s ? selectedModel(s, ui) : null;
    if (!s || !cfg || !pick || deepBusy) return;
    deepBusy = true;
    ref("deepBtn").textContent = "Checking…";
    const key = deepKey(s, pick);
    void options.request({ dateColumn, groupColumn, config: cfg, mode: "forecast", source, deep: pick }).then((msg) => {
      deepBusy = false;
      deep = { key, result: msg?.snapshot?.deep ?? null };
      invalidate("ui", "panel");
    });
  }
  // ---------------------------------------------------------------- AutoARIMA (a deep run, started by hand)
  let arima: { key: string; result: ArimaResult | null; running: ArimaRun | null; progress: ArimaProgress | null; started: number; vote: boolean; auto: boolean } | null = null;
  /** Finished standard searches by series and settings, so going back to an earlier grain or split does not search again. */
  const arimaCache = new Map<string, ArimaResult>();
  const ARIMA_CACHE_LIMIT = 24;
  /** The series whose search the user stopped, so it is not started again behind their back. */
  let arimaStopped = "";
  /** One line saying the forecast changed over because AutoARIMA finished, shown until the next change. */
  let arimaNote = "";
  let arimaTimer = 0;
  const arimaKey = (s: TsSnapshot): string => curveKey(s);
  type ArimaOk = Extract<ArimaResult, { ok: true }>;
  /** The finished run, when it still belongs to the series on screen. */
  function arimaLive(): ArimaOk | null {
    const s = snap;
    if (!s || !arima || arima.running || !arima.result || !arima.result.ok || arima.key !== arimaKey(s)) return null;
    return arima.result;
  }
  type Fc = { F: ArrayLike<number>; lo80: ArrayLike<number>; hi80: ArrayLike<number>; lo95: ArrayLike<number>; hi95: ArrayLike<number> };
  /** The forecast the chart shows: the ARIMA run when it was picked, else the selected model's. */
  function shownForecast(P: Proj): { f: Fc; arima: boolean } {
    const ar = arimaShown ? arimaLive() : null;
    return ar && ar.forecast.F.length >= P.H ? { f: ar.forecast, arima: true } : { f: P.f, arima: false };
  }
  type ArimaRow = { dv: boolean; label: string; ratio: number; mase: number; lockMase: number | null; rank: number | null; verdict: Verdict; won: number; of: number };
  /** What the leaderboards show for the AutoARIMA run: the same numbers as any other model, from its own backtest on the same folds. */
  function arimaRow(s: TsSnapshot, M: ModelRun): ArimaRow | null {
    const r = arimaLive();
    if (!r || !r.backtest || !Number.isFinite(r.backtest.ratio)) return null;
    const bt = r.backtest;
    const lock = bt.lockMase;
    const rank = M.lockbox && lock !== null ? 1 + CORE_KEYS.filter((k) => (M.models[k].lock?.mase ?? Infinity) < lock).length : null;
    const verdict = trustVerdict({ baseline: false, ratio: bt.ratio, lockRank: rank, models: CORE_KEYS.length, foldsWon: bt.foldsWon, foldsOf: bt.foldsOf, band: null, rough: M.rough, periods: s.A.modelN, cycle: cycleWord(s) });
    return { dv: r.vote !== null, label: r.label, ratio: bt.ratio, mase: bt.mase, lockMase: lock, rank, verdict, won: bt.foldsWon, of: bt.foldsOf };
  }
  /** Puts the ARIMA run's forecast on the chart, like picking any other model. */
  function showArima(): void {
    if (!arimaLive()) return;
    arimaShown = true;
    if (snap) INS = makeInsights();
    invalidate("ui", "stat", "nav", "ov", "panel");
    ref("hero").scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function arimaProgressText(): string {
    if (!arima) return "";
    const p = arima.progress, secs = Math.round((performance.now() - arima.started) / 1000);
    if (!p) return `Starting… ${secs} s`;
    return `<b>${escapeHtml(p.stage)}</b>${p.tried ? ` · ${p.tried} model${p.tried === 1 ? "" : "s"} tried` : ""}${p.best ? ` · best so far <span class="ts-mono">${escapeHtml(p.best)}</span> (AICc ${Number.isFinite(p.bestAicc) ? p.bestAicc.toFixed(1) : "–"})` : ""}${p.current ? `<br><small>trying <span class="ts-mono">${escapeHtml(p.current)}</span></small>` : ""} · ${secs} s`;
  }
  function runArima(vote: boolean, auto = false): void {
    const s = snap;
    if (!s || "error" in s.models || arima?.running) return;
    const M = s.models as ModelRun, a = s.A;
    const y = a.yModel.slice(0, a.modelN);
    for (let t = 0; t < y.length; t++) if (a.made[t]) y[t] = NaN;
    const job: ArimaJob = {
      y, T: M.T, H: M.H, m: M.m, seasonMode: M.season.mode, periods: M.season.periods, origins: M.origins, rolling: M.cv === "rolling", trainLen: M.trainLen, lockbox: M.lockbox,
      lambda: M.transform ? M.transform.lambda : null, nonNeg: a.nonNeg, exhaustive: auto ? false : ref<HTMLInputElement>("arimaAll").checked, vote,
    };
    const run = startArima(job, (p) => { if (arima) { arima.progress = p; ref("arimaProg").innerHTML = arimaProgressText(); } });
    arima = { key: arimaKey(s), result: null, running: run, progress: null, started: performance.now(), vote, auto };
    ref("arimaProg").innerHTML = arimaProgressText();
    invalidate("ui", "panel");
    void run.done.then((result) => {
      if (arima && arima.running === run) {
        arima.result = result;
        arima.running = null;
        if (!vote && auto) {
          arimaCache.set(arima.key, result);
          if (arimaCache.size > ARIMA_CACHE_LIMIT) arimaCache.delete(arimaCache.keys().next().value as string);
        }
        if (auto) switchToArima();
        invalidate("ui", "stat", "nav", "ov", "panel");
      }
    });
    // The elapsed seconds keep ticking while the search is quiet.
    const tick = window.setInterval(() => { if (!arima?.running) window.clearInterval(tick); else ref("arimaProg").innerHTML = arimaProgressText(); }, 1000);
  }
  /**
   * AutoARIMA is a core method, so it starts by itself whenever the series changes (load, grain, measure, split, gaps, date range):
   * the fast models show straight away and it joins the ranking when it finishes. A search for a series that is no longer on
   * screen is stopped, so only the latest series is ever being searched; a finished one is kept per series and settings.
   */
  function ensureArima(): void {
    const s = snap;
    if (!s || "error" in s.models) return;
    const key = arimaKey(s);
    if (arima && arima.key === key) return;
    window.clearTimeout(arimaTimer);
    if (arima?.running) { arima.running.cancel(); arima = null; }
    arimaNote = "";
    const cached = arimaCache.get(key);
    if (cached) { arima = { key, result: cached, running: null, progress: null, started: 0, vote: false, auto: true }; return; }
    if (arimaStopped === key) return;
    // Dragging a slider changes the series many times a second; wait for it to settle before searching.
    arimaTimer = window.setTimeout(() => { if (snap && arimaKey(snap) === key && !arima?.running) runArima(false, true); }, 400);
  }
  /** The lowest-error core model's ratio against repeating the last cycle, and its name. */
  function bestCoreRatio(s: TsSnapshot, M: ModelRun): { ratio: number; name: string } {
    const low = lowestError(s, M);
    return { ratio: low.ratio, name: low.name };
  }
  /** When AutoARIMA finishes with the lowest error, the forecast changes over to it and says so, so the chart never jumps unexplained. */
  function switchToArima(): void {
    const s = snap, M = models();
    if (!s || !M || !s.futures || ui.model !== "auto" || arimaShown) return;
    const row = arimaRow(s, M);
    if (!row) return;
    const best = bestCoreRatio(s, M);
    if (!(row.ratio < best.ratio)) return;
    const less = Math.round((1 - row.ratio / best.ratio) * 100);
    arimaNote = `AutoARIMA finished and now has the lowest error${less >= 1 ? `, ${less}% below ${best.name}` : ""}.`;
    arimaShown = true;
    INS = makeInsights();
  }
  /** What the page shows while AutoARIMA is searching, or when it could not fit. */
  function arimaStatus(): { kind: "running" | "failed" | "note"; text: string } | null {
    const s = snap;
    if (!s) return null;
    if (arima && arima.auto && arima.key === arimaKey(s)) {
      if (arima.running) {
        const p = arima.progress;
        return { kind: "running", text: `AutoARIMA: searching models…${p && p.tried ? ` ${p.tried} tried` : ""}` };
      }
      if (arima.result && !arima.result.ok) return { kind: "failed", text: `AutoARIMA could not be fitted: ${arima.result.reason}` };
    }
    return arimaNote ? { kind: "note", text: arimaNote } : null;
  }
  const arimaChip = (): string => {
    const st = arimaStatus();
    if (!st) return "";
    return `<span class="ts-arima-chip ${st.kind}" role="status" title="${escapeHtml(st.text)}">${st.kind === "running" ? '<span class="ts-donut ts-donut-sm" aria-hidden="true"></span>' : ""}${escapeHtml(st.text)}</span>`;
  };
  const arimaWho = (): string => (arima?.auto === false ? "run by you" : "runs automatically");
  /** What one coefficient says about this series, in its own numbers. */
  function arimaReading(c: ArimaCoef, r: ArimaOk, s: TsSnapshot): string {
    const sp = r.spec, g = s.A.g, unit = measureWord(s), m = sp.m, v = c.value;
    const diffd = sp.d + sp.D > 0, what = diffd ? "change" : "departure from the average";
    const fmt = (x: number): string => full(x);
    const z = c.se !== null && c.se > 0 ? Math.abs(v / c.se) : NaN;
    const sure = !Number.isFinite(z) ? "" : z >= 2 ? ` Clearly not zero (z ${z.toFixed(1)}).` : ` Could be zero (z ${z.toFixed(1)}, under 2): it stays because dropping it did not lower the AICc.`;
    const k = /^(sar|sma|ar|ma)(\d+)$/.exec(c.name);
    if (k) {
      const n = Number(k[2]), seasonal = k[1]!.startsWith("s"), isAr = k[1]!.endsWith("ar");
      const when = seasonal ? (n === 1 ? `one season earlier (${m} ${g.nouns})` : `${n} seasons earlier`) : n === 1 ? `the ${g.noun} before` : `${n} ${g.nouns} earlier`;
      if (isAr) {
        const lead = n === 1 && !seasonal
          ? v > 0 ? `<b>Momentum.</b> About ${Math.round(v * 100)}% of the last ${g.noun}'s ${what} carries into this one${Math.abs(v) < 1 && Math.abs(v) > 0.05 ? `, and an effect fades to half in about ${(Math.log(0.5) / Math.log(Math.abs(v))).toFixed(1)} ${g.nouns}` : ""}.`
          : `<b>Bounce-back.</b> A rise in the ${what} tends to be followed by a fall (${Math.round(-v * 100)}% of it reverses).`
          : `<b>${seasonal ? "The same time last season." : "Longer memory."}</b> The ${what} ${when} counts ${v >= 0 ? "for" : "against"} this one with weight ${v.toFixed(2)}${seasonal && v > 0 ? ": a pattern that repeats from season to season carries on" : ""}.`;
        return lead + sure;
      }
      const lead = seasonal
        ? `<b>Seasonal shock.</b> ${Math.round(Math.abs(v) * 100)}% of the surprise ${when} is ${v >= 0 ? "added again" : "taken back"} now${v <= -0.7 && sp.D > 0 ? ". Near −1 with a seasonal difference means a stable seasonal shape: the model averages many past seasons instead of copying only the last one" : ""}.`
        : `<b>Echo of a surprise.</b> ${Math.round(Math.abs(v) * 100)}% of the forecast error from ${when} is ${v >= 0 ? "carried into" : "reversed in"} this ${g.noun}${v <= -0.9 && diffd ? `. Near −1 beside a difference, the model is largely undoing it: the series sits closer to a steady level or trend than to a wandering path, so forecasts lean on the long-run level and not on the last value` : ""}.`;
      return lead + sure;
    }
    if (c.name === "drift") return `<b>Trend.</b> The forecast climbs ${v >= 0 ? "" : "(falls) "}by ${fmt(Math.abs(v))} ${unit} each ${g.noun}${m > 1 ? `, about ${fmt(Math.abs(v) * m)} per season` : ""}: the average change over the whole history.${sure}`;
    if (c.name === "mean") return `<b>Level.</b> The series settles around ${fmt(v)} ${unit}; forecasts pull towards it.${sure}`;
    return "";
  }
  function arimaHtml(r: Extract<ArimaResult, { ok: true }>, s: TsSnapshot, M: ModelRun): string {
    const sp = r.spec, d = r.differences, m = sp.m;
    const diffd = sp.d + sp.D > 0;
    const diffWords = [
      d.d ? `differenced ${d.d === 1 ? "once" : "twice"} (the KPSS test found the series wandering: statistic ${d.kpss.map((v) => v.toFixed(2)).join(" then ")} against 0.46)` : `not differenced (the KPSS test found it steady: statistic ${d.kpss[0]?.toFixed(2) ?? "–"}, under 0.46)`,
      m > 1 ? (d.D ? `seasonally differenced once (seasonal strength ${d.strength.toFixed(2)}, above 0.64)` : `not seasonally differenced (seasonal strength ${d.strength.toFixed(2)}, under 0.64)`) : "",
    ].filter(Boolean).join("; ");
    const terms = [sp.p ? `${sp.p} autoregressive` : "", sp.q ? `${sp.q} moving-average` : "", sp.P ? `${sp.P} seasonal autoregressive` : "", sp.Q ? `${sp.Q} seasonal moving-average` : ""].filter(Boolean);
    const coefRows = r.coefs.map((c) => {
      const z = c.se !== null && c.se > 0 ? c.value / c.se : NaN;
      return `<tr><td class="ts-mono">${c.name}</td><td class="ts-mono">${c.value.toFixed(4)}</td><td class="ts-mono">${c.se !== null ? c.se.toFixed(4) : "–"}</td><td class="ts-mono">${Number.isFinite(z) ? z.toFixed(1) : "–"}</td><td>${arimaReading(c, r, s)}</td></tr>`;
    }).join("");
    const rc = r.resid;
    const resid = rc
      ? `<p>Ljung–Box on the model's errors (${rc.lag} lags, ${rc.n} errors): Q = ${rc.q.toFixed(1)}, p = ${rc.p < 0.001 ? "< 0.001" : rc.p.toFixed(3)}. ${rc.p >= 0.05 ? `<span class="ts-ok">The errors look like noise: no pattern the model left behind.</span>` : `<span class="ts-warn">The errors still show a pattern (p under 0.05): the model has missed something.</span>`}</p>`
      : "";
    const bt = r.backtest;
    const comb = M.models.comb, pickKey = M.auto[ui.metric].pick, pickM = M.models[pickKey];
    const boardRatio = (k: ModelKey): number => ratioOf(s, k);
    const backtest = bt
      ? `<p>Scored on the board's ${bt.folds} backtest fold${bt.folds === 1 ? "" : "s"}, the order held and the coefficients refitted on each fold's history: error <b>${bt.ratio.toFixed(2)}×</b> that of repeating the last cycle (the board's ${MODEL_INFO[pickKey].name}: ${Number.isFinite(boardRatio(pickKey)) ? boardRatio(pickKey).toFixed(2) + "×" : "–"}; the Combination: ${Number.isFinite(boardRatio("comb")) ? boardRatio("comb").toFixed(2) + "×" : "–"}).${bt.lockRatio !== null ? ` On the lockbox fold, which nothing was chosen on: ${bt.lockRatio.toFixed(2)}×.` : ""}</p>`
      : `<p class="ts-note">Too little history for a backtest, so there is no score for this model beyond how well it fits.</p>`;
    void comb; void pickM;
    const T = times(), P = M.T;
    const fcRows = r.forecast.F.map((f, h) => `<tr><td>${periodLabel(s.A.g, T[P + h] ?? NaN)}</td><td>${full(f)}</td><td>${full(r.forecast.lo80[h]!)} to ${full(r.forecast.hi80[h]!)}</td><td>${full(r.forecast.lo95[h]!)} to ${full(r.forecast.hi95[h]!)}</td></tr>`).join("");
    const voteHtml = r.vote
      ? `<h4>How the differencing was chosen <small>DV-ARIMA</small></h4>
      <p>The unit-root test (KPSS) chose <b>${r.differences.d ? `d = ${r.differences.d}` : "no plain difference"}${m > 1 ? `, D = ${r.differences.D}` : ""}</b>, and plain <code>auto.arima</code> would have settled on <b>${escapeHtml(r.plainLabel)}</b>. A test is only a guess about whether the series wanders, so the search was run again at the neighbouring choices, and each was scored on forecasts of the last stretch of your history (three starting points, orders held, coefficients refitted). The forecast below is the weighted average of every model from every choice; the share is each choice's weight, from its error.</p>
      <table class="ts-board ts-arima-table"><thead><tr><th>Differencing</th><th>Forecast error</th><th>Share of the forecast</th></tr></thead><tbody>${(() => {
        const lo = Math.min(...r.vote.map((v) => v.err));
        return r.vote.map((v) => `<tr><td class="ts-mono">${v.label}</td><td>${(v.err / lo).toFixed(2)}× the best${v.err === lo ? " (lowest)" : ""}</td><td>${Math.round(v.weight * 100)}%${v.unitRoot ? " <small>the unit-root test's choice</small>" : ""}</td></tr>`).join("");
      })()}</tbody></table>
      <p class="ts-note">The parameters below are those of the single most-weighted model, ${escapeHtml(r.label)}.</p>`
      : "";
    const tried = r.tried.slice(0, 12).map((t) => `<tr><td class="ts-mono">${escapeHtml(t.label.replace(/^ARIMA/, ""))}</td><td class="ts-mono">${t.ok && Number.isFinite(t.aicc) ? t.aicc.toFixed(2) : "no fit"}</td></tr>`).join("");
    return `
      ${r.adjusted ? `<p class="ts-note"><b>The season was taken out first.</b> This series repeats every ${r.adjusted.periods.map((p) => nf.format(p)).join(" and ")} periods, longer than ARIMA handles directly, so, as the textbook advises [ref:fpp3] (12.1) and R's <code>stlf</code> does, that season was removed with STL, ARIMA was fitted to what was left (the last ${nf.format(r.adjusted.used)} readings), and the seasonal pattern was added back to the forecast and its ranges.</p>` : ""}
      <h4>${escapeHtml(r.label)} <small>${r.searched === "stepwise" ? "stepwise search" : "every order tried"}: ${r.tried.length} model${r.tried.length === 1 ? "" : "s"} in ${r.seconds < 10 ? r.seconds.toFixed(1) : Math.round(r.seconds)} s</small></h4>
      ${voteHtml}
      <p>${diffWords && !r.vote ? `The series is ${diffWords}. ` : ""}${terms.length ? `The model adds ${terms.join(", ")} term${sp.p + sp.q + sp.P + sp.Q === 1 ? "" : "s"}` : "The model has no autoregressive or moving-average terms"}${sp.constant ? `, with a ${sp.d + sp.D === 0 ? "constant mean" : "drift"}` : ""}.${r.lambda !== null ? ` Fitted on the Box-Cox transformed series (λ = ${r.lambda.toFixed(2)}) and mapped back.` : ""}</p>
      <h5>Parameters</h5>
      <table class="ts-board ts-arima-table"><thead><tr><th>Term</th><th>Estimate</th><th>Std. error</th><th>z</th><th>What it says about this series</th></tr></thead><tbody>${coefRows || `<tr><td colspan="5">None: a random walk${sp.constant ? " with drift" : ""}.</td></tr>`}</tbody></table>
      <dl class="ts-modelcard ts-arima-fit">
        <dt>Error variance σ²</dt><dd class="ts-mono">${r.sigma2.toPrecision(5)}</dd>
        <dt>Log-likelihood</dt><dd class="ts-mono">${r.loglik.toFixed(2)}</dd>
        <dt>AIC · AICc · BIC</dt><dd class="ts-mono">${r.aic.toFixed(2)} · ${r.aicc.toFixed(2)} · ${r.bic.toFixed(2)}</dd>
        <dt>Observations · parameters</dt><dd class="ts-mono">${r.nUsed} · ${r.k} (the variance included)</dd>
        ${r.converged ? "" : `<dt>Note</dt><dd><span class="ts-warn">The optimiser stopped before it fully converged; treat the estimates as approximate.</span></dd>`}
      </dl>
      ${resid}
      ${backtest}
      <details class="ts-arima-help" open><summary>What every number here means</summary>
        <dl>
          <dt>${escapeHtml(r.label.replace(/ with .*$/, ""))}</dt><dd>The shape of the model: <b>p</b> = ${sp.p} autoregressive terms (this period depends on recent values), <b>d</b> = ${sp.d} ordinary difference${sp.d === 1 ? "" : "s"}, <b>q</b> = ${sp.q} moving-average terms (it depends on recent forecast errors)${m > 1 ? `; in the second bracket the same three letters for the season: <b>P</b> = ${sp.P}, <b>D</b> = ${sp.D}, <b>Q</b> = ${sp.Q}, and <b>[${m}]</b> is the season's length in ${s.A.g.nouns}` : ""}. Differencing replaces the series by its changes (or, by the season, its change from the same time last season), so the model describes how the changes behave.</dd>
          <dt>Estimate</dt><dd>The best-fitting weight for each term. The model says: today's ${diffd ? "change" : "departure from the average"} = (weights × recent ${diffd ? "changes" : "departures"}) + (weights × recent errors) + a new random error.</dd>
          <dt>Std. error and z</dt><dd>How precisely the data pin the weight down. <b>z</b> is the estimate over its standard error: above about 2 in size the term is clearly not zero; below 2 it could be (the search still keeps it if it lowers the AICc).</dd>
          <dt>Error variance σ²</dt><dd>The size of the model's typical one-step surprise, squared: its square root, ${Math.sqrt(r.sigma2).toPrecision(3)}, is the usual miss in the units of the ${diffd ? "differenced" : ""} series${r.lambda !== null ? " (transformed)" : ""}. Smaller is a tighter fit, but it is only comparable between models that difference the same way.</dd>
          <dt>Log-likelihood</dt><dd>How probable the model finds the data: higher is better.</dd>
          <dt>AIC, AICc, BIC</dt><dd>The log-likelihood with a price for each parameter, so a model cannot win just by having more. <b>Lower is better.</b> AICc adds a correction for short series and is what the search uses; BIC charges more per parameter. Gaps under about 2 are ties. Only compare them across models fitted to the same differenced series.</dd>
          <dt>Observations · parameters</dt><dd>${r.nUsed} points were scored: differencing uses up ${sp.d + sp.D * m} at the start. The parameter count includes the error variance.</dd>
          <dt>Ljung–Box</dt><dd>Asks whether the model's errors still contain a pattern. A p-value above 0.05 means they look like noise (good); below, the model has left something on the table.</dd>
          <dt>The ranges</dt><dd>Computed from the model's own formulas, so they assume it is right. They are narrower than the board's, which come from its backtest errors; take them as the best case.</dd>
        </dl>
      </details>
      <h5>Forecast <small>${M.H} ${s.A.g.nouns}, analytic ranges</small></h5>
      <div class="ts-boardwrap"><table class="ts-board"><thead><tr><th>Period</th><th>Forecast</th><th>80% range</th><th>95% range</th></tr></thead><tbody>${fcRows}</tbody></table></div>
      <details class="ts-arima-tried"><summary>Models tried, best first</summary><table class="ts-board"><thead><tr><th>Model</th><th>AICc</th></tr></thead><tbody>${tried}</tbody></table></details>
      <p class="ts-note">Method: Hyndman and Khandakar 2008 [auto.arima]; the likelihood is exact, by Kalman filter; ranges from the model's own formulas. Not part of Auto: it is here to be read and compared, and joins the board once run.</p>
      ${r.averaged.length > 1 ? `<p class="ts-note"><b>The forecast averages ${r.averaged.length} models.</b> The search tried many orders and several were nearly as good as the winner, so the forecast below is their average, weighted by how well each fitted (Akaike weights: ${r.averaged.slice(0, 4).map((a) => `${escapeHtml(a.label)} ${Math.round(a.weight * 100)}%`).join(", ")}${r.averaged.length > 4 ? ", …" : ""}). On 250 series the archive was not tuned on, this beat the single lowest-AICc model by about 2%. The ranges include the models' disagreement. The parameters above are the top model's.</p>` : ""}
      <div class="ts-boardbar"><button type="button" class="ts-ghost" data-ref="arimaCsv">Download parameters and forecast (CSV)</button></div>`;
  }
  /** The ranked table's AutoARIMA row while it searches, or why it has no result. */
  function arimaStatusRow(span: number): string {
    const st = arimaStatus();
    if (!st || st.kind === "note") return "";
    const lead = st.kind === "running" ? '<span class="ts-donut ts-donut-sm" aria-hidden="true"></span> ' : "";
    return `<tr class="ts-arima-pending" data-arima-status="${st.kind}"><td><span class="ts-mname">AutoARIMA</span><button type="button" class="ts-info" data-info="autoarima" aria-label="How AutoARIMA works" title="How AutoARIMA works">ⓘ</button><span class="ts-auto">Automatic</span></td><td colspan="${span}" role="status">${lead}${escapeHtml(st.text.replace(/^AutoARIMA:? ?/, ""))}</td></tr>`;
  }
  function renderArima(): void {
    const s = snap as TsSnapshot, M = models(), btn = ref("arimaBtn"), vbtn = ref("arimaVoteBtn"), run = ref("arimaRun"), out = ref("arimaOut");
    if (!M) { run.hidden = true; out.hidden = true; return; }
    const running = !!arima?.running;
    run.hidden = !running;
    const label = (voted: boolean, name: string): string => (running && arima!.vote === voted ? "Searching…" : arima?.result && arima.vote === voted ? `Run ${name} again` : `${name}…`);
    btn.textContent = label(false, "AutoARIMA");
    vbtn.textContent = label(true, "DV-ARIMA");
    (btn as HTMLButtonElement).disabled = running;
    (vbtn as HTMLButtonElement).disabled = running;
    if (running) ref("arimaProg").innerHTML = arimaProgressText();
    const res = arima && !arima.running && arima.key === arimaKey(s) ? arima.result : null;
    if (!res) { out.hidden = true; return; }
    out.hidden = false;
    out.innerHTML = res.ok ? cite(arimaHtml(res, s, M).replace("[auto.arima]", "[ref:forecastpkg]")) : `<p class="ts-warn">${escapeHtml(res.reason)}</p>`;
    renderCompact();
  }
  function downloadArima(): void {
    const s = snap, M = models(), res = arima?.result;
    if (!s || !M || !res || !res.ok) return;
    const rows: string[][] = [["section", "name", "value", "std_error", "extra"]];
    rows.push(["model", res.label, "", "", `${res.searched}; ${res.tried.length} tried`]);
    for (const c of res.coefs) rows.push(["parameter", c.name, String(c.value), c.se === null ? "" : String(c.se), ""]);
    rows.push(["fit", "sigma2", String(res.sigma2), "", ""], ["fit", "loglik", String(res.loglik), "", ""], ["fit", "aic", String(res.aic), "", ""], ["fit", "aicc", String(res.aicc), "", ""], ["fit", "bic", String(res.bic), "", ""]);
    const T = times();
    res.forecast.F.forEach((f, h) => rows.push(["forecast", new Date(T[M.T + h] ?? NaN).toISOString().slice(0, 10), String(f), "", `lo80 ${res.forecast.lo80[h]}; hi80 ${res.forecast.hi80[h]}; lo95 ${res.forecast.lo95[h]}; hi95 ${res.forecast.hi95[h]}`]));
    if (downloadCsv(`${csvBase(s)}-autoarima.csv`, rows)) options.onAction(`Exported the AutoARIMA parameters and ${res.forecast.F.length}-${s.A.g.noun} forecast`);
  }
  function renderDeep(): void {
    const s = snap as TsSnapshot, M = models(), box = ref("deepBox"), pick = selectedModel(s, ui);
    const btn = ref("deepBtn");
    if (!M || !pick || !deep || deep.key !== deepKey(s, pick) || !deep.result) { box.hidden = true; btn.textContent = deepBusy ? "Checking…" : "Deep check"; return; }
    btn.textContent = "Run deep check again";
    const d = deep.result, name = (k: ModelKey): string => MODEL_INFO[k].name, gr = s.A.g;
    const pv = (p: number): string => (!(p === p) ? "–" : p < 0.001 ? "< 0.001" : p.toFixed(3));
    // 1. Significance.
    const dmRows = [...d.dm].sort((a, b) => a.p - b.p).map((t) => {
      let verdict: string;
      if (!(t.p === t.p)) verdict = "too few folds";
      else if (t.p < 0.05) verdict = t.diff < 0 ? `<span class="ts-ok">significantly better</span>` : `<span class="ts-warn">significantly worse</span>`;
      else verdict = COMPLEXITY[t.other] < COMPLEXITY[pick] ? `no significant difference: <b>prefer ${name(t.other)}</b>, the simpler model` : "no significant difference";
      return `<tr><td>${name(t.other)}</td><td>${t.diff === t.diff ? signed(t.diff) : "–"}</td><td>${t.stat === t.stat ? t.stat.toFixed(2) : "–"}</td><td>${pv(t.p)}</td><td>${verdict}</td></tr>`;
    }).join("");
    const nF = d.dm[0]?.n ?? 0;
    const sig = `<section><h4>Is ${name(pick)} really better? <small>Diebold–Mariano tests</small></h4>
      <table class="ts-deep-table"><thead><tr><th>Against</th><th>Mean |error| difference <small>${escapeHtml(measureWord(s))}, negative = ${name(pick)} better</small></th><th>DM statistic</th><th>p-value</th><th>Verdict at 5%</th></tr></thead><tbody>${dmRows}</tbody></table>
      <p class="ts-note">Loss: absolute error, averaged per fold over the ${nF} selection folds (the lockbox is left out). Overlapping folds are dependent, so the variance is Newey–West with lag ${d.dmLag}, with the Harvey–Leybourne–Newbold small-sample correction and a t distribution on ${Math.max(0, nF - 1)} degrees of freedom. ${nF < 10 ? `With only ${nF} folds the test has little power: "no significant difference" is common, and it means the data cannot separate the two, so the simpler one is the safer choice.` : ""}</p></section>`;
    // 2. Error by horizon: the pick, the runner-up and the baseline.
    const ranked = [...MODEL_KEYS].filter((k) => k !== pick && k !== "sn").sort((a, b) => M.models[a].mase - M.models[b].mase);
    const show: [ModelKey, string][] = [[pick, "var(--ts-forecast)"], ...(ranked[0] ? [[ranked[0], "var(--ts-season2)"] as [ModelKey, string]] : []), ["sn", "var(--ts-dim)"]];
    const W = 420, Hh = 150, L = 46, B = 22, top = 8, steps = d.horizon.steps;
    const allV = show.flatMap(([k]) => d.horizon.mae[k]).filter((v) => v === v);
    const hi = Math.max(...allV, 1e-9) * 1.05;
    const sx = (i: number): number => L + (steps.length > 1 ? (i / (steps.length - 1)) * (W - L - 8) : 0), sy = (v: number): number => top + (1 - v / hi) * (Hh - top - B);
    // Steps with no scored actual (e.g. weekends with no rows) are skipped; the line joins across them.
    const pathOf = (vals: number[]): string => { let started = false; return vals.map((v, i) => { if (!(v === v)) return ""; const c = `${started ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`; started = true; return c; }).join(""); };
    const lines = show.map(([k, col]) => `<path d="${pathOf(d.horizon.mae[k])}" style="stroke:${col}"/>`).join("");
    const hz = `<section><h4>Error by steps ahead <small>MAE on the selection folds</small></h4>
      <div class="ts-deep-row"><svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" class="ts-deep-svg" role="img" aria-label="Error by steps ahead">${lines}<text x="${L - 4}" y="${sy(hi / 1.05) + 4}" text-anchor="end">${compact(hi / 1.05)}</text><text x="${L - 4}" y="${sy(0) + 4}" text-anchor="end">0</text><text x="${L}" y="${Hh - 6}">1 ${gr.noun}</text><text x="${W - 8}" y="${Hh - 6}" text-anchor="end">${steps[steps.length - 1]} ${nounFor(gr, steps[steps.length - 1] ?? 1)} ahead</text></svg>
      <div class="ts-deep-legend">${show.map(([k, col]) => `<span><i style="background:${col}"></i>${name(k)}</span>`).join("")}<p class="ts-note">One average hides where a model wins: a model can lead a few ${gr.nouns} ahead and fall behind further out. If you care about a particular horizon, judge the models there.</p></div></div></section>`;
    // 3. Calibration.
    const cRows = [...(models()?.shown ?? MODEL_KEYS)].map((k) => {
      const c = d.calib[k], bad80 = c.cov80 < 0.7 || c.cov80 > 0.9, bad95 = c.cov95 < 0.88;
      return `<tr${k === pick ? ' class="ts-deep-pick"' : ""}><td>${name(k)}</td><td${bad80 ? ' class="ts-warn"' : ""}>${c.n ? `${Math.round(c.cov80 * 100)}%` : "–"}</td><td${bad95 ? ' class="ts-warn"' : ""}>${c.n ? `${Math.round(c.cov95 * 100)}%` : "–"}</td><td>${c.winkler === c.winkler ? c.winkler.toFixed(2) : "–"}</td></tr>`;
    }).join("");
    const cal = `<section><h4>Are the bands honest? <small>coverage on every fold</small></h4>
      <table class="ts-deep-table"><thead><tr><th>Model</th><th>Inside 80% band <small>aim 80%</small></th><th>Inside 95% band <small>aim 95%</small></th><th>Winkler score (80%) <small>scaled like MASE, lower is better</small></th></tr></thead><tbody>${cRows}</tbody></table>
      <p class="ts-note">Each fold's actuals are checked against bands built from the other folds' errors (leave one fold out), so no fold judges a band it helped build. Too low means the band is overconfident; well above means it is too wide to be useful. The Winkler score (fpp3 §5.9) is the band's width plus a penalty of 2/α (10 for 80%) times any miss, so it rewards bands that are narrow <i>and</i> right.</p></section>`;
    // 4. Residuals.
    let res = `<section><h4>Residuals of ${name(pick)}</h4><p class="ts-note">Too few residuals to test.</p></section>`;
    if (d.resid) {
      const r = d.resid, n = r.acf.length, RW = 420, RH = 130, rl = 30, rb = 18;
      const amax = Math.max(r.crit * 1.6, ...r.acf.map(Math.abs)) * 1.05;
      const bx = (k: number): number => rl + ((k - 0.5) / n) * (RW - rl - 6), by = (v: number): number => (RH - rb) / 2 - (v / amax) * ((RH - rb) / 2 - 4);
      const bw = Math.max(1, (RW - rl - 6) / n - 1);
      const bars = r.acf.map((v, i) => { const k = i + 1, y0 = by(0), y1 = by(v); return `<rect x="${(bx(k) - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(y1 - y0).toFixed(1)}" class="${Math.abs(v) > r.crit ? "out" : ""}${r.m > 1 && k % r.m === 0 ? " season" : ""}"><title>Lag ${k}: ${v.toFixed(3)}</title></rect>`; }).join("");
      const crit = [r.crit, -r.crit].map((c) => `<line x1="${rl}" x2="${RW - 6}" y1="${by(c).toFixed(1)}" y2="${by(c).toFixed(1)}" class="crit"/>`).join("");
      const outside = r.acf.filter((v) => Math.abs(v) > r.crit).length, expected = Math.round(0.05 * n);
      const white = r.lb.p >= 0.05;
      res = `<section><h4>Residuals of ${name(pick)} <small>${escapeHtml(r.kind)} errors on the training data</small></h4>
        <div class="ts-deep-row"><svg viewBox="0 0 ${RW} ${RH}" width="${RW}" height="${RH}" class="ts-deep-svg ts-acf" role="img" aria-label="Autocorrelation of residuals"><line x1="${rl}" x2="${RW - 6}" y1="${by(0)}" y2="${by(0)}" class="zero"/>${crit}${bars}<text x="${rl - 4}" y="${by(r.crit) + 3}" text-anchor="end">${r.crit.toFixed(2)}</text><text x="${rl}" y="${RH - 4}">lag 1</text><text x="${RW - 6}" y="${RH - 4}" text-anchor="end">lag ${n}</text></svg>
        <div class="ts-deep-read"><p><b>Ljung–Box</b>: Q = ${r.lb.q.toFixed(1)} on ${r.lb.lag} lags, p = ${pv(r.lb.p)}. ${white ? `<span class="ts-ok">Consistent with white noise</span>: no pattern left that the model missed.` : `<span class="ts-warn">Structure left in the residuals</span>: the model misses some autocorrelation${r.m > 1 && r.acf[r.m - 1]! > r.crit ? `, notably at the seasonal lag ${r.m}` : ""}, so a better model may exist and the bands may be too narrow.`}</p>
        <p>${outside} of ${n} lags fall outside ±${r.crit.toFixed(2)} (about ${expected} would by chance). Mean residual ${signed(r.mean)}${Math.abs(r.mean) > 0 ? " (a mean far from 0 means bias)" : ""}. Seasonal lags are outlined.</p>
        <p class="ts-note">fpp3 §5.4: good residuals are uncorrelated with mean zero. Clean residuals do not prove the model is right: an overfitted model can have very clean in-sample residuals and still forecast badly, which is why the backtest and the lockbox, not the residuals, rank the models. ${r.kind !== "one-step" ? "For this model the residuals are fitted values, not one-step forecasts, so they flatter it." : ""}</p></div></div></section>`;
    }
    box.innerHTML = `<div class="ts-deep-head"><h3>Deep check of ${name(pick)}</h3><span class="ts-note">took ${Math.round(d.ms)} ms</span></div>${sig}${hz}${cal}${res}`;
    box.hidden = false;
  }

  /** Technical notes for each gap choice, with this series' own numbers. */
  function gapOpts(s: TsSnapshot): [TsGaps, string, string][] {
    const a = s.A, g = a.g, m = a.modelM, fit = g.periods.filter((p) => a.modelN >= 2 * p + 2);
    const shortM = fit.length ? Math.min(...fit) : m, short = Math.max(2, Math.round(shortM / 4)), K = m >= 100 ? 4 : 7;
    const u = (k: number): string => nounFor(g, k);
    const notes: Record<TsGaps, string> = m > 1 ? {
      smart: `Recommended. Gaps of up to ${short} ${u(short)} (a quarter of the shortest season, ${shortM}) take the usual pattern; longer gaps take the nearby typical value. On real hourly data with stretches hidden, each was the more accurate at its gap lengths.`,
      local: `For each empty t: the median of y at t ± k·${m} (the same phase, season ${m}) over the nearest ${2 * K} known values (k = 1, 2, …). Robust to outliers and follows the local level, so a semester or holiday shift is respected. Assumes no trend across the gap.`,
      lastcycle: `Seasonal naive: y(t) = y(t − ${m}). Copies the cycle before exactly, noise included; one odd cycle becomes two.`,
      seasonal: `A straight line through the deseasonalised level from one edge of the gap to the other, plus the robust phase profile (the median, per phase of ${m}, of each value minus its moving average). It hangs on the two edge readings, so it is best for gaps of a few ${g.nouns}.`,
      interp: "A straight line between the two edge values. It ignores the season, so a gap across a daily peak comes out flat.",
      last: "Last observation carried forward. Right for levels that hold until changed (prices, settings); wrong for anything seasonal.",
      zero: "y(t) = 0. Right when no row means nothing happened (sales, counts). These periods then count as real data in the models.",
      leave: "Shown as a break. The models still need an unbroken series, so they bridge gaps with the smart fill. No model learns from filled periods (ETS, Holt-Winters and Theta carry their state across them; the regression leaves them out) and forecast errors are never scored on them.",
    } : {
      smart: "With no season at this grain: a straight line between the levels either side.",
      local: "No season at this grain, so this is the same as the usual pattern: a straight line between the edges.",
      lastcycle: "No season at this grain, so this carries the last value forward.",
      seasonal: "With no season at this grain: a straight line between the levels either side.",
      interp: "A straight line between the two edge values.",
      last: "Last observation carried forward. Right for levels that hold until changed (prices, settings).",
      zero: "y(t) = 0. Right when no row means nothing happened (sales, counts).",
      leave: "Shown as a break. The models bridge it with the smart fill and never score forecast errors on it.",
    };
    return GAP_OPTS.map(([k, label]) => [k, label, notes[k]]);
  }

  /**
   * The answer to what a forecaster asks: what simple model can I use, what high-performing model can I use, and how much better is it.
   * One ranked list below it, lowest error first, with every ARIMA run you started mixed in.
   */
  type Cand = { id: string; key: ModelKey | null; name: string; plain: string; ratio: number; held: number | null; simple: boolean; arima: boolean; tag: string; verdict: Verdict | null };
  function candidates(s: TsSnapshot, M: ModelRun): Cand[] {
    const mk = ui.metric, snLock = lockValue(M, "sn", mk), pick = M.auto[mk].pick;
    const heldOf = (k: ModelKey): number | null => {
      const v = lockValue(M, k, mk);
      return M.lockbox && M.models[k].lock && Number.isFinite(v) && Number.isFinite(snLock) && snLock > 0 ? v / snLock : null;
    };
    const list: Cand[] = M.shown.filter((k) => Number.isFinite(ratioOf(s, k))).map((k) => ({
      id: k, key: k, name: MODEL_INFO[k].name, plain: PLAIN[k] ?? "", ratio: ratioOf(s, k), held: heldOf(k), simple: BENCHMARKS.includes(k), arima: false,
      tag: k === pick ? "Auto" : "", verdict: CORE_KEYS.includes(k) ? verdictFor(s, M, k) : null,
    }));
    const ar = arimaRow(s, M);
    if (ar) {
      const lock = arimaLive()?.backtest?.lockMase ?? null, sn = M.models.sn.lock?.mase ?? NaN;
      list.push({ id: "arima", key: null, name: ar.label, plain: ar.dv ? `AutoARIMA with the differencing chosen by a forecast vote, ${arimaWho()}` : `The textbook's automatic ARIMA search, ${arimaWho()}`, ratio: ar.ratio, held: lock !== null && sn > 0 ? lock / sn : null, simple: false, arima: true, tag: ar.dv ? "DV-ARIMA" : "AutoARIMA", verdict: ar.verdict });
    }
    // Lowest error first; on a tie the simpler method leads.
    return list.sort((p, q) => p.ratio - q.ratio || Number(q.simple) - Number(p.simple));
  }
  function renderAnswer(s: TsSnapshot, M: ModelRun, list: Cand[]): void {
    const box = ref("answer");
    if (list.length === 0) { box.innerHTML = ""; return; }
    const simple = list.find((c) => c.simple) ?? list[0]!, best = list[0]!;
    const same = best.id === simple.id;
    const cycle = cycleWord(s);
    const times = (x: number): string => `${x.toFixed(2)}×`;
    const gain = same ? 0 : 1 - best.ratio / simple.ratio;
    const heldGain = !same && best.held !== null && simple.held !== null && simple.held > 0 ? 1 - best.held / simple.held : null;
    const show = (c: Cand): string => `<button type="button" class="ts-ghost" data-ans-show="${c.arima ? "arima" : c.key}">Show on the chart</button>`;
    const card = (cls: string, kick: string, name: string, line: string, extra: string, c: Cand | null): string => `<article class="ts-ans ${cls}"><div class="ts-ans-kick">${kick}</div><div class="ts-ans-name${c?.arima ? " ts-mono" : ""}">${escapeHtml(name)}</div><p>${line}</p>${extra}${c ? show(c) : ""}</article>`;
    const errLine = (c: Cand): string => `<span class="ts-ans-num">${times(c.ratio)}</span> the error of repeating the last ${cycle}${c.held !== null && c.id !== "sn" ? `; <span class="ts-ans-num">${times(c.held)}</span> on the held-back data` : ""}`;
    const gainCard = same
      ? `<article class="ts-ans gain none"><div class="ts-ans-kick">How much better?</div><div class="ts-ans-name">No gain</div><p>A more complex model is not worth using for this series: none of them forecast it better than <b>${escapeHtml(simple.name)}</b>.</p></article>`
      : `<article class="ts-ans gain ${gain >= 0.1 ? "good" : "small"}"><div class="ts-ans-kick">How much better?</div><div class="ts-ans-name">${Math.round(gain * 100)}% less error</div>
          <p><b>${escapeHtml(best.name)}</b> against <b>${escapeHtml(simple.name)}</b>, in the backtests (${M.origins.length} folds).${heldGain === null ? "" : heldGain > 0 ? ` On the held-back data it also wins, by ${Math.round(heldGain * 100)}%.` : ` <span class="ts-warn">On the held-back data it does not win: treat the gain with care.</span>`}${gain < 0.05 ? " A small gain: the simple model is nearly as good." : ""}</p></article>`;
    box.innerHTML = `<div class="ts-answer-grid">
      ${card("simple", "Best simple model", simple.name, simple.plain ? escapeHtml(simple.plain) + "." : "", `<p class="ts-ans-sub">${errLine(simple)}</p>`, simple)}
      ${same
        ? `<article class="ts-ans best"><div class="ts-ans-kick">Lowest error</div><div class="ts-ans-name">Also the best simple model</div><p>Every other model${list.some((c) => c.arima) ? ", your ARIMA run included," : ""} had more error than <b>${escapeHtml(simple.name)}</b> in the backtests.${list.some((c) => c.arima) ? "" : " Run AutoARIMA or DV-ARIMA under Compute-intense models to give it a harder opponent."}</p></article>`
        : card("best", "Lowest error", best.name, best.plain ? escapeHtml(best.plain) + "." : "", `<p class="ts-ans-sub">${errLine(best)}</p>`, best)}
      ${gainCard}
    </div><p class="ts-note ts-answer-note">Errors are compared with repeating the last ${cycle}, which is 1.00×; lower is better. They come from forecasting ${M.origins.length} earlier stretches of your own history the model had not seen.${M.lockbox ? " The held-back data is one more stretch kept aside, never used to rank or pick." : ""}</p>`;
    const st = arimaStatus();
    if (st?.kind === "running") box.insertAdjacentHTML("beforeend", `<p class="ts-note ts-answer-note ts-provisional" role="status"><span class="ts-donut ts-donut-sm" aria-hidden="true"></span> Provisional: AutoARIMA is still searching. It joins this ranking when it finishes, and if it has the lowest error the forecast changes over to it with a note.</p>`);
    else if (st?.kind === "note") box.insertAdjacentHTML("beforeend", `<p class="ts-note ts-answer-note" role="status">${escapeHtml(st.text)}</p>`);
  }
  /** Compare models: every model in one list, lowest error first. */
  function renderCompact(): void {
    const s = snap as TsSnapshot, table = ref("boardCompact"), M = models();
    if (!M || !s.futures) { table.innerHTML = ""; ref("answer").innerHTML = ""; return; }
    const sel = selectedModel(s, ui) as ModelKey;
    const yardKey = sel === "sn" ? null : yardstickOf(s, M, sel).key;
    const list = candidates(s, M);
    renderAnswer(s, M, list);
    const simple = list.find((c) => c.simple) ?? list[0], best = list[0];
    // A full bar is 1.5x the error of repeating the last cycle: one wild model must not squash the rest into dots.
    const top = 1.5;
    const dot = { good: "var(--ok)", okay: "var(--qa-warn)", poor: "var(--danger)", base: "var(--text-dim)" } as const;
    const heldCell = (c: Cand): string => {
      if (c.id === "sn") return `<span class="ts-dot" style="background:${dot.base}"></span>Baseline`;
      if (c.held === null) return `<span class="ts-dot" style="background:${dot.base}"></span>Not tested`;
      const better = c.held < 1;
      return `<span class="ts-dot" style="background:${better ? dot.good : dot.poor}"></span>${c.held.toFixed(2)}× <small>${better ? "beat" : "behind"} repeating the last ${cycleWord(s)}</small>`;
    };
    const rows = list.map((c, i) => {
      const tags = [c === best && c !== simple ? '<span class="ts-besttag" title="The model with the least backtest error of all, AutoARIMA included">Lowest error</span>' : "", c === simple ? '<span class="ts-simpletag" title="The simple method with the least backtest error here">Best simple</span>' : c.key === yardKey ? '<span class="ts-yardtag" title="The simple method the verdict compares the forecast with">Yardstick</span>' : "", c.tag ? `<span class="ts-autotag" title="${c.arima ? (arimaWho() === "run by you" ? "Run by you" : "Runs automatically") : "What the chart shows by default: a steady all-rounder unless another model clearly wins"}">${c.tag}</span>` : "", c.arima ? '<button type="button" class="ts-link" data-arima-params="1" title="The fitted terms, their meaning and the models tried">Parameters</button>' : ""].join("");
      const info = c.arima ? "autoarima" : c.key;
      const selected = c.arima ? arimaShown : !arimaShown && c.key === sel;
      return `<tr ${c.arima ? 'data-arima="1"' : `data-model="${c.key}"`} aria-selected="${selected}">
        <td class="ts-rank">${i + 1}</td>
        <td><span class="ts-mname${c.arima ? " ts-mono" : ""}">${escapeHtml(c.name)}</span>${tags}<button type="button" class="ts-info" data-info="${info}" aria-label="How ${escapeHtml(c.name)} works" title="How it works: equations, fitting, sources">ⓘ</button><div class="ts-plain">${escapeHtml(c.plain)}</div></td>
        <td><span class="ts-errtrack"><span class="ts-errbar" style="width:${Math.min(100, Math.max(3, (c.ratio / top) * 100)).toFixed(0)}%;opacity:${c.simple ? 0.45 : 0.85}"></span></span><span class="ts-ratio">${c.ratio.toFixed(2)}×</span></td>
        <td>${heldCell(c)}</td></tr>`;
    }).join("");
    table.innerHTML = `<thead><tr><th>#</th><th>Model <small>click a row to see its forecast</small></th><th title="Error divided by the error of repeating the last ${cycleWord(s)}: below 1× is better">Error vs repeating the last ${cycleWord(s)}</th><th title="One more stretch of history, kept aside and never used to rank or pick">On held-back data</th></tr></thead><tbody>${rows}</tbody>`;
  }
  function renderBoard(): void {
    const s = snap as TsSnapshot, board = ref("board"), card = ref("modelCard");
    const M = models();
    if (!M || !s.futures) { board.innerHTML = `<tbody><tr><td class="ts-emptycell">${"error" in s.models ? escapeHtml(s.models.error) : ""}</td></tr></tbody>`; card.innerHTML = ""; ref("boardCompact").innerHTML = ""; return; }
    const sel = selectedModel(s, ui) as ModelKey, fut = s.futures;
    const fullYard = sel === "sn" ? null : yardstickOf(s, M, sel).key;
    const heldMode = M.T < s.A.modelN && fut.sn.held?.ratio != null;
    const mk = ui.metric, best = M.auto[mk].pick;
    const size = (k: ModelKey): number => { const v = M.models[k].metrics[mk]; return v === v ? (mk === "bias" ? Math.abs(v) : v) : Infinity; };
    const maxV = Math.max(...M.shown.map(size).filter(Number.isFinite), 1e-12);
    const keys = [...M.shown].sort((p, q) => size(p) - size(q));
    const info = METRIC_INFO[mk];
    for (const b of ref("cvSeg").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.cv === M.cv));
    for (const b of ref("trSeg").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.tr === s.cfg.transform));
    ref<HTMLSelectElement>("metricSel").value = mk;
    ref("boardNote").innerHTML = `Ranked by <b>${info.label}</b> (${info.short.toLowerCase()}), ${M.cv} window, ${M.origins.length} folds. Change both in the toolbar above the chart.`;
    board.innerHTML = `<thead><tr><th>Model</th><th title="${info.short}: ${mk === "bias" ? "nearer zero is better" : "lower is better"}">${info.label} <small>${mk === "bias" ? "nearer 0 is better" : "lower is better"}</small></th><th>${heldMode ? "Held-out" : "Backtest"} error vs repeat-last-cycle</th><th>Grade</th><th title="Selection folds where it beat repeating the last cycle">Folds beaten</th>${M.lockbox ? `<th title="The last fold, held back: never used to rank or pick, so its score is not flattered by the choice">Unseen fold <small>${info.label}, rank</small></th>` : ""}<th>${heldMode ? "Held-out check" : "Band check"}</th></tr></thead><tbody>` +
      keys.map((k) => {
        const m = M.models[k], r = ratioOf(s, k), gd = grade(r, k), f = fut[k], v = size(k);
        const chk = f.held ? `${f.held.hit} of ${f.held.tot} inside 80%` : m.check ? `${m.check.hit} of ${m.check.tot} inside 80%` : "–";
        return `<tr data-model="${k}" aria-selected="${k === sel}">
          <td><span class="ts-mname">${MODEL_INFO[k].name}</span>${k === fullYard ? '<span class="ts-yardtag" title="The simple method the verdict compares the forecast with">Yardstick</span>' : ""}<button type="button" class="ts-info" data-info="${k}" aria-label="How ${MODEL_INFO[k].name} works" title="How ${MODEL_INFO[k].name} works: equations, fitting, sources">ⓘ</button>${k === best && ui.model === "auto" ? `<span class="ts-auto">Auto</span>` : ""}<span class="ts-mmeth">${MODEL_INFO[k].meth}</span></td>
          <td><span class="ts-errbar" style="width:${Number.isFinite(v) ? Math.max(4, (v / maxV) * 90).toFixed(0) : 0}px;opacity:${k === "sn" ? 0.35 : 0.85}"></span>${metricText(mk, m.metrics[mk])}</td>
          <td>${r.toFixed(2)}×${heldMode ? ` <small>backtest ${m.ratio.toFixed(2)}×</small>` : ""}</td>
          <td><span class="ts-pill ${gd.cls}">${gd.text}</span></td>
          <td>${k === "sn" ? "–" : `${m.folds.won} of ${m.folds.of}`}</td>${M.lockbox ? `<td>${m.lock ? `${metricText(mk, m.lock[mk])} <small>#${lockRank(M, k, mk)}</small>` : "–"}</td>` : ""}
          <td>${chk}</td></tr>`;
      }).join("") + (() => {
        const ar = arimaRow(s, M);
        if (!ar) return arimaStatusRow(M.lockbox ? 6 : 5);
        const gd = grade(ar.ratio, "ets");
        return `<tr data-arima="1" title="Click for the parameters"><td><span class="ts-mname ts-mono">${escapeHtml(ar.label)}</span><button type="button" class="ts-info" data-info="autoarima" aria-label="How AutoARIMA works" title="How AutoARIMA works">ⓘ</button><span class="ts-auto">${arimaWho() === "run by you" ? "Run by you" : "Automatic"}</span><span class="ts-mmeth">${ar.dv ? "DV-ARIMA, AutoARIMA with the differencing chosen by a forecast vote" : "AutoARIMA, the textbook's automatic search"}; scored on these folds with its order held</span></td>
          <td>${mk === "mase" ? ar.mase.toFixed(2) : "<small>MASE only</small>"}</td><td>${ar.ratio.toFixed(2)}×</td><td><span class="ts-pill ${gd.cls}">${gd.text}</span></td><td>${ar.won} of ${ar.of}</td>${M.lockbox ? `<td>${ar.lockMase !== null ? `${ar.lockMase.toFixed(2)}${ar.rank !== null ? ` <small>#${ar.rank}</small>` : ""}` : "–"}</td>` : ""}<td>–</td></tr>`;
      })() + "</tbody>";
    card.innerHTML = modelRows(s, sel, mk).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    renderCompact();
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
    const lbl = P ? [`Forecast <small>${MODEL_INFO[P.key].name}</small>`, "80% low", "80% high"] : [];
    const dec = s.dec.dec;
    const head = `<tr><th>Period</th><th>Status</th><th>Actual <small>${measureWord(s)}</small></th>${ui.mode === "explore" ? `<th>Rolling ${escapeHtml(s.cfg.smoothStat)}</th>` : ""}${ui.mode === "decompose" ? "<th>Trend</th><th>Seasonal</th><th>Remainder</th>" : ""}${lbl.map((l) => `<th>${l}</th>`).join("")}</tr>`;
    const rows: string[] = [];
    const fillWord = GAP_OPTS.find((o) => o[0] === s.cfg.gaps)?.[1] ?? "filled";
    // At most 400 rows: the latest in view, so the forecast is never cut off.
    const from = Math.max(i0, i1 - 399);
    for (let i = from; i <= i1; i++) {
      const h = P ? i - P.T : -1, inP = !!P && h >= 0 && h < P.H;
      const status = i >= a.n ? ["forecast", "Forecast"] : a.filled[i] ? ["filled", `No rows; ${fillWord}`] : !(a.y[i] === a.y[i]) ? ["empty", "No rows"]
        : inP ? ["heldout", "Actual, held out"] : a.partial[i] ? ["partial", "Actual, partial"] : ["actual", "Actual"];
      let tail = "";
      if (P) tail = inP ? `<td>${full(P.f.F[h])}</td><td>${full(P.f.lo80[h])}</td><td>${full(P.f.hi80[h])}</td>` : "<td></td><td></td><td></td>";
      rows.push(`<tr class="ts-row-${status[0]}"><td>${periodLabel(a.g, T[i])}</td><td class="ts-status">${status[1]}</td><td>${i < a.n ? full(a.y[i]) : ""}</td>` +
        (ui.mode === "explore" ? `<td>${i < a.modelN ? full(s.smooth[i]) : ""}</td>` : "") +
        (ui.mode === "decompose" ? (dec && i < a.modelN ? `<td>${full(dec.trend[i])}</td><td>${full(dec.seasonal[i])}</td><td>${full(dec.rem[i])}</td>` : "<td></td><td></td><td></td>") : "") + tail + "</tr>");
    }
    const shown = rows.length, inView = i1 - i0 + 1;
    wrap.innerHTML = `<p class="ts-table-note">${nf.format(shown)} ${nounFor(a.g, shown)} in view${inView > shown ? ` (the latest ${nf.format(shown)} of ${nf.format(inView)}; zoom in for earlier ones)` : ""}. Pan or zoom the chart to change them; Export ▾ downloads every period.</p><table><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
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
    if ("model" in patch) { arimaShown = false; arimaNote = ""; }
    Object.assign(ui, patch);
    if (snap) INS = makeInsights();
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
    INS = makeInsights();
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
      case "addDriver": driverAction(`add:${act.col}`); setMode("forecast"); break;
    }
  }
  /** Split by this column and show the one value: the rows of a single station, store or sensor. */
  function pickSeries(col: number, label: string): void {
    if (!cfg) return;
    const apply = (): void => { const i = snap?.table.groups.indexOf(label) ?? -1; if (i >= 0) change({ group: i }); };
    if (col !== groupColumn) { groupColumn = col; cfg = { ...cfg, group: -1 }; afterFetch = apply; fetchSeries(); } else apply();
  }
  /** Split by this column and open the list of its values, searchable. */
  function openSeriesPicker(col: number): void {
    if (!cfg) return;
    const open = (): void => { window.setTimeout(() => { const b = host.querySelector<HTMLElement>('.ts-tok[data-tok="group"]'); if (b) openPop(b, "group"); }, 80); };
    if (col !== groupColumn) { groupColumn = col; cfg = { ...cfg, group: -1 }; afterFetch = open; fetchSeries(); } else open();
  }
  function choose(key: TokenKey, val: string): void {
    if (!cfg) return;
    if (key === "date") {
      const next = Number(val);
      if (next !== dateColumn) { dateColumn = next; cfg = null; view = null; snap = null; fetchSeries(); }
      return;
    }
    if (key === "source") {
      if (val !== source) { source = val; groupColumn = -1; cfg = null; view = null; snap = null; shape = null; fetchSeries(); }
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
    options.onShowRows(viewSource()?.timeColumn ?? dateColumn, T[i], end);
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
    const rows: string[][] = [["period_start", "period", "row_type", "value", "filled", "rolling", "trend", "seasonal", "remainder", "model", "forecast", "forecast_lo80", "forecast_hi80", "forecast_lo95", "forecast_hi95"]];
    const last = P ? Math.max(a.n - 1, P.T + P.H - 1) : a.n - 1;
    for (let i = 0; i <= last; i++) {
      const h = P ? i - P.T : -1, inP = !!P && h >= 0 && h < P.H;
      const num = (v: number | undefined): string => (v === undefined || !(v === v) ? "" : String(Math.round(v * 1e6) / 1e6));
      rows.push([
        iso(T[i]), periodLabel(a.g, T[i]), i >= a.n ? "forecast" : a.filled[i] ? "filled" : !(a.y[i] === a.y[i]) ? "empty" : inP ? "actual (held out)" : "actual",
        i < a.n ? num(a.y[i]) : "", i < a.n && a.filled[i] ? "1" : "",
        i < a.modelN ? num(s.smooth[i]) : "", d && i < a.modelN ? num(d.trend[i]) : "", d && i < a.modelN ? num(d.seasonal[i]) : "", d && i < a.modelN ? num(d.rem[i]) : "",
        inP && P ? MODEL_INFO[P.key].name : "", inP && P ? num(P.f.F[h]) : "", inP && P ? num(P.f.lo80[h]) : "", inP && P ? num(P.f.hi80[h]) : "", inP && P ? num(P.f.lo95[h]) : "", inP && P ? num(P.f.hi95[h]) : "",
      ]);
    }
    const base = `${options.datasetName() || "series"}-${s.cfg.agg === "count" ? "rows" : s.cfg.measure ?? "value"}-${a.g.id}`.replace(/[^\w.-]+/g, "_");
    if (downloadCsv(`${base}.csv`, rows)) options.onAction(`Exported ${nf.format(rows.length - 1)} ${a.g.nouns} with trend, season and forecast`);
  }
  const csvIso = (s: TsSnapshot) => (ms: number): string => new Date(ms).toISOString().slice(0, s.A.g.unit === "min" ? 16 : 10).replace("T", " ");
  const csvBase = (s: TsSnapshot): string => `${options.datasetName() || "series"}-${s.cfg.agg === "count" ? "rows" : s.cfg.measure ?? "value"}-${s.A.g.id}`.replace(/[^\w.-]+/g, "_");
  function exportForecast(): void {
    const s = snap, key = s ? selectedModel(s, { ...ui, mode: "forecast" }) : null;
    if (!s || !key) return;
    const rows = forecastRows(s, key, times(), csvIso(s), (ms) => periodLabel(s.A.g, ms));
    if (downloadCsv(`${csvBase(s)}-forecast.csv`, rows)) options.onAction(`Exported the ${nf.format(rows.length - 1)}-${s.A.g.noun} forecast (${MODEL_INFO[key].name}) with 80% and 95% bands`);
  }
  function exportScorecard(): void {
    const s = snap;
    if (!s) return;
    const rows = scorecardRows(s, ui.metric, selectedModel(s, { ...ui, mode: "forecast" }), csvIso(s));
    if (downloadCsv(`${csvBase(s)}-models.csv`, rows)) options.onAction(`Exported the scorecard for ${rows.length - 1} models: every measure, check and parameter`);
  }
  async function exportBacktest(): Promise<void> {
    const s = snap;
    if (!s || !cfg) return;
    const msg = await options.request({ dateColumn, groupColumn, config: cfg, mode: "forecast", source, backtest: true });
    const bt = msg?.snapshot?.backtest;
    if (!bt) { options.onAction("The backtest could not be read for export"); return; }
    const rows = backtestRows(msg!.snapshot!, bt, times(), csvIso(s));
    if (downloadCsv(`${csvBase(s)}-backtest.csv`, rows)) options.onAction(`Exported ${nf.format(rows.length - 1)} backtest rows: each model, fold and step ahead, with the actual`);
  }
  function openExportMenu(anchor: HTMLElement): void {
    const ok = !!snap && !("error" in snap.models) && !!snap.futures;
    openMenu(anchor, [
      { label: "Forecast: future periods and bands", disabled: !ok, title: "The shown model's forecast with 80% and 95% bands", action: exportForecast },
      { label: "Series and forecast: every period", title: "Actuals, filled periods, rolling, trend, season and the forecast, one row per period", action: exportCsv },
      { label: "Model scorecard: measures and parameters", disabled: !ok, title: "One row per model: MASE, MAE, RMSE, WAPE, sMAPE, MAPE, bias, checks, validation and fitted parameters", action: exportScorecard },
      { label: "Backtest detail: every fold, step and model", disabled: !ok, title: "Actual vs forecast for each model, fold and step ahead, to recompute any measure", action: () => void exportBacktest() },
    ]);
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
    POP.dataset.key = key;
    POP.innerHTML = tokenOpts(key).map(([val, label, hint]) => {
      const off = key === "grain" && info.tooFine[val as GrainId];
      return `<button type="button" role="menuitemradio" data-val="${escapeHtml(val)}" aria-checked="${cur === val}"${off ? ` disabled title="Finer than the data: most periods would be empty"` : ""}>${escapeHtml(label)}${hint ? ` <small>${escapeHtml(hint)}</small>` : ""}</button>`;
    }).join("");
    // Hundreds of stations or stores: a search box above the list, filtering as you type.
    const options = POP.querySelectorAll<HTMLButtonElement>("button[data-val]");
    if (options.length > 12) {
      const search = document.createElement("input");
      search.type = "search"; search.placeholder = `Find among ${options.length}…`; search.className = "ts-pop-search"; search.setAttribute("aria-label", "Find a value");
      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        options.forEach((b) => { b.hidden = q !== "" && !(b.textContent ?? "").toLowerCase().includes(q); });
      });
      search.addEventListener("keydown", (e) => { if (e.key === "Enter") POP.querySelector<HTMLButtonElement>("button[data-val]:not([hidden])")?.click(); });
      POP.prepend(search);
      placePop(anchor);
      search.focus();
      return;
    }
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
    const sb = target.closest<HTMLElement>("[data-sentinel]");
    if (sb) {
      const col = Number(sb.dataset.sentinel);
      const hit = metas[col]?.suggestions.find((x) => x.kind === "sentinel" && x.value === ref("sentinel").dataset.value);
      if (hit) options.onApplySuggestion(col, hit);
      return;
    }
    const ud = target.closest<HTMLElement>("[data-use-date]");
    if (ud) { options.onUseAsDate(Number(ud.dataset.useDate), ud.dataset.useOrder ?? ""); return; }
    const t = target.closest<HTMLButtonElement>(".ts-tok");
    if (t && !t.disabled) { openPop(t, t.dataset.tok as TokenKey); e.stopPropagation(); return; }
    const da = target.closest<HTMLElement>("[data-drv-act]");
    if (da) { driverAction(da.dataset.drvAct ?? ""); return; }
    const dc = target.closest<HTMLElement>("[data-drv]");
    if (dc) { if (dc.dataset.drv === "add") openAddDriver(dc); else openDriverPop(dc, Number(dc.dataset.drv)); e.stopPropagation(); return; }
    const opt = target.closest<HTMLButtonElement>(".ts-popover button[data-val]");
    if (opt && popKey && popKey !== "driver") { const key = popKey; closePop(); choose(key, opt.dataset.val ?? ""); return; }
    if (!target.closest(".ts-popover")) closePop();
    const mixedAct = target.closest<HTMLElement>("[data-mixed]");
    if (mixedAct && cfg) {
      const what = mixedAct.dataset.mixed;
      if (what === "one") {
        const col = Number(mixedAct.dataset.col);
        if (col !== groupColumn) { groupColumn = col; cfg = { ...cfg, group: 0 }; fetchSeries(); }
        else change({ group: 0 });
      } else if (what === "pick") pickSeries(Number(mixedAct.dataset.col), mixedAct.dataset.label ?? "");
      else if (what === "more") openSeriesPicker(Number(mixedAct.dataset.col));
      else if (what === "mean") change({ agg: "mean" });
      else if (what === "keep") {
        keptMixed.add(ref("mixed").dataset.keep ?? "");
        renderUI();
      }
      return;
    }
    const ins = target.closest<HTMLElement>("[data-ins]");
    if (ins) { const [k, j] = (ins.dataset.ins ?? "0:0").split(":").map(Number); const act = INS[k]?.acts[j]?.act; if (act) runAction(act); invalidate("ov", "stat", "nav"); }
    const step = target.closest<HTMLElement>("[data-step]");
    if (step) {
      const id = step.dataset.step;
      if (id === "resample") openPop(step, "grain");
      else if (id === "fill") openPop(step, "gaps");
      else if (id === "smooth") uiChange({ showSmooth: !ui.showSmooth });
      else if (id === "compare") uiChange({ lastYear: !ui.lastYear });
      else if (id === "diff") uiChange({ diff: !ui.diff, diffLag: ui.diffLag || defaultLag() });
    }
    const hp = target.closest<HTMLElement>("[data-h]");
    if (hp) { afterFetch = () => { allT = null; flyTo(forecastView()); }; change({ horizon: Number(hp.dataset.h) }, { fade: false }); }
    const per = target.closest<HTMLElement>("[data-period]");
    if (per) change({ period: Number(per.dataset.period) });
    const regrain = target.closest<HTMLElement>("[data-ref=decGrain]");
    if (regrain?.dataset.grain) choose("grain", regrain.dataset.grain);
    const lvl = target.closest<HTMLElement>("[data-level]");
    if (lvl) uiChange({ level: lvl.dataset.level as Level });
    const st = target.closest<HTMLElement>("[data-stat]");
    if (st) change({ smoothStat: st.dataset.stat as TsConfig["smoothStat"] }, { fade: false });
    const info = target.closest<HTMLElement>("[data-info]");
    if (info) { openDocs(info.dataset.info!); return; }
    const yardUse = target.closest<HTMLElement>("[data-yard-use]");
    if (yardUse) { uiChange({ model: yardUse.dataset.yardUse as ModelKey }); return; }
    if (target.closest("[data-hood]")) { folds.hood = true; applyFolds(); try { localStorage.setItem("ts.forecast.folds.v2", JSON.stringify(folds)); } catch { /* ignore */ } ref("heroDetail").scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    if (target.closest("[data-arima-open]")) { folds.compute = true; applyFolds(); ref("arimaOut").scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    const arimaRowEl = target.closest<HTMLElement>("tr[data-arima]");
    if (arimaRowEl && !info) {
      if (target.closest("[data-arima-params]")) { folds.compute = true; applyFolds(); ref("arimaOut").scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      showArima();
      return;
    }
    const ansShow = target.closest<HTMLElement>("[data-ans-show]");
    if (ansShow) { const k = ansShow.dataset.ansShow!; if (k === "arima") showArima(); else uiChange({ model: k as ModelKey }); ref("hero").scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    const row = target.closest<HTMLElement>("tr[data-model]");
    if (row && snap) { const M = models(), k = row.dataset.model as ModelKey; uiChange({ model: M && k === M.auto[ui.metric].pick && ui.model !== "auto" ? "auto" : k }); }
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
  on("flexCheck", "click", () => checkFlex());
  /** Compute-intense models and Under the hood start closed (Compare models starts open); a person's choice is remembered in this browser. */
  const folds: Record<string, boolean> = { compare: true, compute: false, hood: false };
  try { Object.assign(folds, JSON.parse(localStorage.getItem("ts.forecast.folds.v2") || "{}")); } catch { /* storage unavailable */ }
  function applyFolds(): void {
    for (const b of host.querySelectorAll<HTMLButtonElement>(".ts-fold")) {
      const k = b.dataset.fold ?? "", open = !!folds[k];
      b.setAttribute("aria-expanded", String(open));
      ref(k === "hood" ? "foldHood" : k === "compute" ? "foldCompute" : "foldCompare").hidden = !open;
    }
  }
  for (const b of host.querySelectorAll<HTMLButtonElement>(".ts-fold")) b.addEventListener("click", () => {
    const k = b.dataset.fold ?? "";
    folds[k] = !folds[k];
    try { localStorage.setItem("ts.forecast.folds.v2", JSON.stringify(folds)); } catch { /* ignore */ }
    applyFolds();
  });
  applyFolds();
  on("deepBtn", "click", () => runDeep());
  on("arimaBtn", "click", () => { arimaStopped = ""; runArima(false); });
  on("arimaVoteBtn", "click", () => runArima(true));
  on("arimaCancel", "click", () => { if (arima) arimaStopped = arima.key; arima?.running?.cancel(); arima = null; invalidate("ui", "panel"); });
  on("arimaAll", "change", () => invalidate("ui", "panel"));
  ref("arimaOut").addEventListener("click", (e) => { if ((e.target as Element).closest("[data-ref=arimaCsv]")) downloadArima(); });
  on("flexCurve", "click", (e) => { const b = (e.target as Element).closest<HTMLElement>("[data-flexpick]"); if (b) change({ flex: Number(b.dataset.flexpick) }, { fade: false }); });
  on("diffOn", "change", (e) => uiChange({ diff: (e.target as HTMLInputElement).checked, diffLag: ui.diffLag || defaultLag() }));
  on("diffLag", "change", (e) => { const v = Math.round(Number((e.target as HTMLInputElement).value)); if (v >= 1) uiChange({ diff: true, diffLag: v }); });
  on("diffPresets", "click", (e) => { const b = (e.target as Element).closest<HTMLElement>("[data-lag]"); if (b) uiChange({ diff: true, diffLag: Number(b.dataset.lag) }); });
  on("trSeg", "click", (e) => { const b = (e.target as Element).closest<HTMLButtonElement>("button[data-tr]"); if (b) change({ transform: b.dataset.tr as TsConfig["transform"] }); });
  on("cvSeg", "click", (e) => { const b = (e.target as Element).closest<HTMLButtonElement>("button[data-cv]"); if (b) change({ cv: b.dataset.cv as TsConfig["cv"] }, { fade: false }); });
  on("metricSel", "change", (e) => { uiChange({ metric: (e.target as HTMLSelectElement).value as MetricKey }); invalidate("panel"); });
  on("guideBtn2", "click", () => openModelGuide(Object.fromEntries(MODEL_KEYS.map((k) => [k, MODEL_INFO[k].name])) as Record<ModelKey, string>));
  on("docsBtn", "click", () => openDocs(snap && selectedModel(snap, ui) || "auto"));
  on("guideBtn", "click", () => openModelGuide(Object.fromEntries(MODEL_KEYS.map((k) => [k, MODEL_INFO[k].name])) as Record<ModelKey, string>));
  on("hMinus", "click", () => { if (snap) change({ horizon: Math.max(1, snap.H - 1) }, { fade: false }); });
  on("hPlus", "click", () => { if (snap) change({ horizon: Math.min(snap.maxH, snap.H + 1) }, { fade: false }); });
  on("splitReset", "click", () => change({ split: null }, { fade: false }));
  on("exportBtn", "click", () => openExportMenu(ref("exportBtn")));
  const hoverRow = (e: Event): void => {
    const t = e.target as Element, r = t.closest<HTMLElement>("tr[data-model], [data-yard]");
    const k = ((r?.dataset.model ?? r?.dataset.yard) as ModelKey | undefined) ?? null, ar = !!t.closest("tr[data-arima]");
    if (k !== ghostModel || ar !== ghostArima) { ghostModel = k; ghostArima = ar; invalidate("stat"); }
  };
  const hoverEnd = (): void => { ghostModel = null; ghostArima = false; invalidate("stat"); };
  on("board", "pointerover", hoverRow); on("board", "pointerleave", hoverEnd);
  on("boardCompact", "pointerover", hoverRow); on("boardCompact", "pointerleave", hoverEnd);
  on("heroBadge", "pointerover", hoverRow); on("heroBadge", "pointerleave", hoverEnd);
  on("tableBtn", "click", (e) => {
    tableOpen = !tableOpen;
    (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(tableOpen));
    (e.currentTarget as HTMLElement).textContent = tableOpen ? "Hide data table" : "Show data table";
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
    source = "";
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
    viewsChanged(): void {
      // The view list changed: the Source menu offers it, and a series read from a view follows it.
      if (source === "") { if (snap) renderUI(); return; }
      if (viewSource() === undefined) { source = ""; groupColumn = -1; cfg = null; view = null; snap = null; }
      if (visible) fetchSeries();
      else stale = true;
    },
  };
}
