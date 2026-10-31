/**
 * Time Series page: the engine the worker keeps per series table. It caches each stage
 * (aggregate, smooth, decompose, models, patterns) on the choices that feed it, so a
 * drag of the forecast handle reruns the models and nothing else, and returns one
 * snapshot the page draws from.
 */

import { defaultGrain, GRAIN_ORDER, GRAINS, tooFine, type GrainId, type TsTable } from "./base.js";
import { aggregate, rolling, type Aggregated, type TsConfig, type TsMode } from "./aggregate.js";
import { computeDecomposition, type DecompResult } from "./decompose.js";
import { computeFutures, deepCheck, driverRecent, flexCurve, type DeepCheck, horizonOf, maxHorizon, runModels, type Futures, type HwWarm, type ModelKey, type ModelRun } from "./models.js";
import { computePatterns, type Patterns } from "./patterns.js";

/** The series as the page draws it: Aggregated without the per-column means. */
export type TsSeries = Omit<Aggregated, "colMean">;

/** What the page knows about the table behind the series. */
export interface TsTableInfo {
  dateCol: string;
  groupCol: string | null;
  groups: string[];
  start: number;
  end: number;
  /** Monday-0 weekday of the start, and its year * 12 + month (see TimeBase). */
  woff: number;
  m0: number;
  slot: number;
  spd: number;
  cadence: number;
  cadSlots: number;
  subDay: boolean;
  eventLike: boolean;
  structural: number[];
  closedHours: number[];
  rows: number;
  dropped: number;
  firstMs: number;
  lastMs: number;
  /** Numeric columns, with how each reads. */
  columns: { name: string; flag: boolean; timeLike: "time" | "part" | null; repeated: boolean }[];
  defMeasure: string | null;
  defGrain: GrainId;
  tooFine: Record<GrainId, boolean>;
}

/** Every model's backtest forecasts: fold k, step h at forecasts[key][k * H + h]. Only sent when asked for (exports). */
export interface TsBacktest { origins: number[]; H: number; forecasts: Record<ModelKey, Float64Array> }

export interface TsSnapshot {
  table: TsTableInfo;
  cfg: TsConfig;
  A: TsSeries;
  smooth: Float64Array;
  dec: DecompResult;
  models: ModelRun | { error: string };
  futures: Futures | null;
  maxH: number;
  H: number;
  /** Recent typical value of every numeric column (driver rules start from it). */
  driverRecent: Record<string, number>;
  /** Per-period means of the chosen driver columns. */
  driverSeries: Record<string, Float64Array>;
  patterns: Patterns | null;
  backtest?: TsBacktest;
  /** Backtest MASE of the trend, seasons and drivers model at flexibility 1 to 10 (only when asked). */
  flexCurve?: { flex: number; mase: number }[];
  /** Significance, error by horizon, calibration and residual checks for one model (only when asked). */
  deep?: DeepCheck;
  ms: { agg: number; dec: number; mod: number; pat: number };
}

export class TsEngine {
  private A: Aggregated | null = null;
  private SM: Float64Array | null = null;
  private DEC: DecompResult | null = null;
  private MOD: ReturnType<typeof runModels> | null = null;
  private FUT: Futures | null = null;
  private PAT: Patterns | null = null;
  private readonly keys = { agg: "", sm: "", dec: "", mod: "", pat: "" };
  private readonly warm: HwWarm = new Map();

  constructor(readonly table: TsTable) {}

  info(): TsTableInfo {
    const t = this.table;
    let firstMs = Infinity, lastMs = -Infinity;
    for (const v of t.times) { if (v < firstMs) firstMs = v; if (v > lastMs) lastMs = v; }
    return {
      dateCol: t.dateCol, groupCol: t.groupCol, groups: t.groups, start: t.start, end: t.end, woff: t.woff, m0: t.m0, slot: t.slot, spd: t.spd,
      cadence: t.cadence, cadSlots: t.cadSlots, subDay: t.subDay, eventLike: t.eventLike, structural: Array.from(t.structural), closedHours: Array.from(t.closedHours),
      rows: t.times.length, dropped: t.dropped, firstMs, lastMs,
      columns: Object.keys(t.cols).map((name) => ({ name, flag: !!t.flags[name], timeLike: t.timeLike[name] ?? null, repeated: !!t.repeated[name] })),
      defMeasure: t.defMeasure, defGrain: defaultGrain(t),
      tooFine: Object.fromEntries(GRAIN_ORDER.map((id) => [id, tooFine(t, id)])) as Record<GrainId, boolean>,
    };
  }

  compute(cfg: TsConfig, mode: TsMode, opts: { backtest?: boolean; flexCurve?: boolean; deep?: ModelKey } = {}): TsSnapshot {
    const t0 = performance.now();
    const aggKey = [cfg.grain, cfg.agg, cfg.measure, cfg.group, cfg.gaps, cfg.partial].join("|");
    if (aggKey !== this.keys.agg || !this.A) {
      this.A = aggregate(this.table, cfg);
      this.keys.agg = aggKey;
      this.keys.sm = this.keys.dec = this.keys.mod = "";
    }
    const A = this.A;
    const smKey = aggKey + [cfg.smoothW, cfg.smoothStat, cfg.smoothCentred].join("|");
    if (smKey !== this.keys.sm || !this.SM) { this.SM = rolling(A.y, A.modelN, cfg.smoothW, cfg.smoothCentred, cfg.smoothStat); this.keys.sm = smKey; }
    const t1 = performance.now();
    const decKey = aggKey + "|" + cfg.period + "|" + cfg.sens;
    if (decKey !== this.keys.dec || !this.DEC) { this.DEC = computeDecomposition(A, cfg); this.keys.dec = decKey; }
    const t2 = performance.now();
    const H = horizonOf(A, cfg);
    const drvKey = cfg.drivers.map((d) => `${d.col}:${d.rule}:${d.pct}`).join(",");
    const modKey = aggKey + "|" + [cfg.split, H, cfg.flex, cfg.cv, drvKey].join("|");
    if (modKey !== this.keys.mod || !this.MOD) {
      this.MOD = runModels(A, this.table, cfg, cfg.split, H, this.warm);
      this.FUT = "error" in this.MOD ? null : computeFutures(A, this.MOD.internal);
      this.keys.mod = modKey;
    }
    const t3 = performance.now();
    // Profiles do not depend on the grain shown, only on what is measured and how.
    const patKey = [cfg.agg, cfg.measure, cfg.group, cfg.gaps].join("|");
    if (mode === "patterns" && (patKey !== this.keys.pat || !this.PAT)) { this.PAT = computePatterns(this.table, cfg); this.keys.pat = patKey; }
    const t4 = performance.now();
    const { colMean, ...series } = A;
    const recent: Record<string, number> = {};
    for (const c of Object.keys(colMean)) recent[c] = driverRecent(A, c);
    const mod = this.MOD;
    const models: TsSnapshot["models"] = "error" in mod ? { error: mod.error } : stripInternal(mod);
    return {
      table: this.info(), cfg, A: series, smooth: this.SM, dec: this.DEC, models, futures: this.FUT, maxH: maxHorizon(A), H,
      driverRecent: recent, driverSeries: Object.fromEntries(cfg.drivers.filter((d) => colMean[d.col]).map((d) => [d.col, colMean[d.col]])), patterns: mode === "patterns" ? this.PAT : null,
      ms: { agg: t1 - t0, dec: t2 - t1, mod: t3 - t2, pat: t4 - t3 },
      ...(opts.deep && !("error" in mod) ? { deep: deepCheck(A, mod.internal, opts.deep) } : {}),
      ...(opts.flexCurve ? { flexCurve: flexCurve(A, this.table, cfg, H) } : {}),
      ...(opts.backtest && !("error" in mod) ? { backtest: { origins: mod.origins, H: mod.H, forecasts: mod.internal.oc } } : {}),
    };
  }
}

function stripInternal(run: ModelRun & { internal: unknown }): ModelRun {
  const { internal: _internal, ...rest } = run;
  return rest;
}

/**
 * Keeps saved choices that still fit the table and swaps the rest for its defaults:
 * a measure or driver column that has gone, a group past the end, a grain finer than
 * the data now is.
 */
export function sanitizeTsConfig(cfg: TsConfig, info: TsTableInfo): TsConfig {
  const names = new Set(info.columns.map((c) => c.name));
  const measure = cfg.measure !== null && names.has(cfg.measure) ? cfg.measure : info.defMeasure;
  return {
    ...cfg,
    grain: info.tooFine[cfg.grain] ? info.defGrain : cfg.grain,
    measure,
    agg: measure === null ? "count" : cfg.agg,
    group: cfg.group >= 0 && cfg.group < info.groups.length && info.groupCol !== null ? cfg.group : -1,
    smoothW: Math.max(2, Math.round(cfg.smoothW)),
    flex: Math.min(10, Math.max(1, cfg.flex)),
    cv: cfg.cv === "rolling" ? "rolling" : "expanding",
    drivers: cfg.drivers.filter((d) => names.has(d.col) && d.col !== measure),
  };
}

/** Choices for a freshly opened series: the table's own defaults. */
export function defaultConfig(info: TsTableInfo): TsConfig {
  const grain = info.defGrain;
  return {
    grain, agg: info.eventLike ? "count" : "sum", measure: info.defMeasure, group: -1, gaps: "leave", partial: "exclude",
    smoothW: GRAINS[grain].smooth, smoothStat: "mean", smoothCentred: false, period: null, sens: 4.5,
    split: null, horizon: null, flex: 5, drivers: [], cv: "expanding",
  };
}
