/**
 * Time Series page: findings and the words around the chart, read from one engine
 * snapshot. Pure functions (no DOM), so they are tested on their own.
 */

import { cadenceNoun, cadenceText, DAY, GRAIN_ORDER, GRAINS, openAt, weekdayAt, type Grain, type GrainId } from "../data/timeseries/base.js";
import type { TsAgg, TsMode } from "../data/timeseries/aggregate.js";
import { holidaysBetween } from "../data/timeseries/holidays.js";
import { circularSmooth, phaseIndex, type Decomposition, type SeasonOption } from "../data/timeseries/decompose.js";
import type { TsSnapshot } from "../data/timeseries/engine.js";
import {
  aNoun, cap, compact, dfDM, dfMonShort, dfTime, dfWd, fmtInstant, MONTHS, nf, nounFor, pct, periodLabel, rateK, rateText,
  shortPeriod, signed, WEEKDAYS,
} from "../data/timeseries/format.js";
import { grade, METRIC_KEYS, MODEL_INFO, type Future, type MetricKey, type ModelKey, type ModelRun } from "../data/timeseries/models.js";
import { METRIC_INFO, metricText } from "./timeseries-metrics.js";

/** What a finding's button does; the page carries it out. */
export type TsAction =
  | { kind: "fullView" }
  | { kind: "focus"; i: number }
  | { kind: "showChange"; k: number }
  | { kind: "mode"; mode: TsMode }
  | { kind: "forecastView" }
  | { kind: "grain"; grain: GrainId }
  | { kind: "agg"; agg: TsAgg }
  | { kind: "addDriver"; col: string }
  | { kind: "pickGroup"; index: number };

export type TsTone = "accent" | "forecast" | "danger" | "warn" | "dim";
export interface TsFinding {
  kind: string;
  tone: TsTone;
  /** HTML; every value in it comes from the engine or a column name the page escapes. */
  html: string;
  meter?: number;
  meterLabel?: string;
  acts: { label: string; act: TsAction }[];
}

/** UI choices that change words but not numbers. */
export interface TsView {
  mode: TsMode;
  model: ModelKey | "auto";
  showShift: boolean;
  /** What the board ranks by, and Auto picks the best of. */
  metric?: MetricKey;
}

export const escapeHtml = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function measureWord(s: TsSnapshot): string { return s.cfg.agg === "count" ? "the row count" : escapeHtml(s.cfg.measure ?? "value"); }
export function measureLead(s: TsSnapshot): string { return s.cfg.agg === "count" ? "The row count" : escapeHtml(s.cfg.measure ?? "Value"); }

/**
 * Change from b to a. A percentage only when the series is positive throughout;
 * otherwise in the series' own units (percentages mean nothing across zero).
 */
export function chg(s: TsSnapshot, a: number, b: number): { v: number; text: string } | null {
  if (!(a === a) || !(b === b)) return null;
  if (s.A.allPositive && b > 0) return { v: a / b - 1, text: pct(a / b - 1, 1) };
  return { v: a - b, text: signed(a - b) };
}
function monthlyParts(s: TsSnapshot, slope: number, mean: number): [number, boolean] {
  const perMonth = slope * (s.A.g.perYear / 12);
  return s.A.allPositive && mean > 0 ? [perMonth / mean, true] : [perMonth, false];
}
/** Months the one trend rate looks back over, when the series is that long. */
export const TREND_WINDOW_MONTHS = 12;
/**
 * The one trend rate the page states, wherever it states it: how fast the decomposed trend moved over the last year of the
 * series (or all of it when shorter), as a compound rate when every value is positive and a plain change otherwise. The window
 * is named beside the number so two places can never quote different formulas.
 */
export function trendRate(s: TsSnapshot, trend: ArrayLike<number>): { text: string; window: string; months: number } | null {
  const A = s.A, N = A.modelN;
  if (N < 3) return null;
  const spanMonths = (A.t[N - 1] - A.t[0]) / (30.44 * DAY);
  const back = Math.min(TREND_WINDOW_MONTHS, spanMonths);
  let j = N - 1;
  while (j > 0 && (A.t[N - 1] - A.t[j - 1]) / (30.44 * DAY) <= back + 1e-9) j--;
  const months = (A.t[N - 1] - A.t[j]) / (30.44 * DAY);
  if (!(months >= 1) || !Number.isFinite(trend[j]) || !Number.isFinite(trend[N - 1])) return null;
  const asPct = A.allPositive && trend[j] > 0 && trend[N - 1] > 0;
  const perMonth = asPct ? Math.pow(trend[N - 1] / trend[j], 1 / months) - 1 : (trend[N - 1] - trend[j]) / months;
  const whole = Math.abs(months - spanMonths) < 0.5;
  const window = whole ? "the whole series" : `the last ${Math.round(months)} months`;
  return { text: rateText(perMonth, asPct), window, months };
}
export function monthlyRate(s: TsSnapshot, slope: number, mean: number, k?: number): string {
  const [r, asPct] = monthlyParts(s, slope, mean);
  return rateText(r, asPct, k);
}

export function periodName(g: Grain, m: number): string {
  if (!m) return "none";
  return g.seasons[m] ?? `${m}-${g.noun.split(" ").pop()} cycle`;
}
/** "daily + weekly" for the two-season split, else the period's own name. */
export function seasonName(g: Grain, d: Pick<Decomposition, "m"> & { parts?: unknown; also?: number | { m: number } } | SeasonOption): string {
  if (("multi" in d ? d.multi : !!d.parts)) return "daily + weekly";
  const also = typeof d.also === "number" ? d.also : d.also?.m;
  return also ? `${periodName(g, d.m)} + ${periodName(g, also)}` : periodName(g, d.m);
}

export function selectedModel(s: TsSnapshot, view: TsView): ModelKey | null {
  if ("error" in s.models) return null;
  return view.model === "auto" ? s.models.auto?.[view.metric ?? "mase"]?.pick ?? s.models.best : view.model;
}
/** Error relative to repeating the last cycle: on held-out actuals when there are some. */
export function ratioOf(s: TsSnapshot, key: ModelKey): number {
  const held = s.futures?.[key].held;
  if (held && held.ratio != null) return held.ratio;
  return "error" in s.models ? NaN : s.models.models[key].ratio;
}

export interface TrendShift { k: number; segs: { i0: number; i1: number; at: (i: number) => number }[]; text: string }
/**
 * The trend's one clear break, when the decomposition found one and the person has not
 * switched it off: a straight line fitted to the trend on each side, and the rate before
 * and after in words.
 */
export function trendShift(s: TsSnapshot, view: TsView): TrendShift | null {
  const cp = s.dec.cp;
  if (!view.showShift || !cp || cp.gain <= 0.5) return null;
  const N = s.A.modelN, k = cp.k;
  const line = (i0: number, i1: number, sg: { mean: number; slope: number }) => { const xm = (i0 + i1) / 2; return { i0, i1, at: (i: number) => sg.mean + sg.slope * (i - xm) }; };
  const kk = Math.max(rateK(...monthlyParts(s, cp.before.slope, cp.before.mean)), rateK(...monthlyParts(s, cp.after.slope, cp.after.mean)));
  const short = (t: string): string => t.replace(" a month", "/mo").replace(" a year", "/yr").replace(" a decade", "/decade").replace(" a century", "/century");
  return {
    k, segs: [line(0, k - 1, cp.before), line(k, N - 1, cp.after)],
    text: `${short(monthlyRate(s, cp.before.slope, cp.before.mean, kk))} → ${short(monthlyRate(s, cp.after.slope, cp.after.mean, kk))}`,
  };
}

/** A cycle's length in a bigger unit when that reads better: " (2.5 years)", " (1.5 days)". */
function cycleSpan(g: Grain, m: number): string {
  const yrs = m / g.perYear, days = m * g.days;
  if (yrs >= 1) return ` (${yrs.toFixed(1)} years)`;
  if (g.unit === "min" && days >= 1) return ` (${days.toFixed(1)} days)`;
  return "";
}
function phaseLabel(s: TsSnapshot, m: number, k: number): string {
  const g = s.A.g, A = s.A;
  if (g.unit === "day" && m === 7) return WEEKDAYS[(k + weekdayAt(s.table, A.t[0])) % 7];
  let idx = -1;
  for (let i = A.modelN - 1; i >= 0; i--) if (phaseIndex(i, m) === k) { idx = i; break; }
  const dt = new Date(A.t[idx]);
  if (g.unit === "min") return m === 7 * (g.perDay ?? 24) ? `${dfWd.format(dt)} ${dfTime.format(dt)}` : m === g.perDay ? dfTime.format(dt) : shortPeriod(g, A.t[idx]);
  if (g.unit === "month" && g.n === 1) return MONTHS[dt.getUTCMonth()];
  if (g.unit === "month") return "Q" + (Math.floor(dt.getUTCMonth() / 3) + 1);
  if (g.unit === "day") return dfDM.format(dt);
  return (g.n === 1 ? "the week of " : `the ${g.n} weeks from `) + dfDM.format(dt);
}
/** The daily + weekly split in words: the hour that peaks, then the weekday that adds most. */
function seasonPartsFinding(s: TsSnapshot, d: Decomposition): TsFinding {
  const A = s.A, g = A.g, parts = d.parts;
  if (!parts) throw new Error("no parts");
  const { daily, weekly, pd } = parts;
  const amt = (v: number): string => (A.allPositive && d.level > 0 ? Math.abs((v / d.level) * 100).toFixed(0) + "%" : compact(Math.abs(v)));
  let hi = 0, lo = 0;
  for (let k = 0; k < pd; k++) { if (daily[k] > daily[hi]) hi = k; if (daily[k] < daily[lo]) lo = k; }
  // What each weekday adds: the weekly part averaged over that day's periods.
  const add = new Float64Array(7), cnt = new Float64Array(7);
  for (let k = 0; k < 7 * pd; k++) { const wd = weekdayAt(s.table, A.t[k]); add[wd] += weekly[k]; cnt[wd]++; }
  for (let k = 0; k < 7; k++) add[k] /= cnt[k] || 1;
  let dh = 0, dl = 0;
  for (let k = 0; k < 7; k++) { if (add[k] > add[dh]) dh = k; if (add[k] < add[dl]) dl = k; }
  const at = (k: number): string => dfTime.format(new Date(A.t[k]));
  return {
    kind: "Season · daily + weekly", tone: "forecast", meter: d.fs, meterLabel: "seasonal strength",
    html: `Within a day, <b>${at(hi)}</b> runs <b>${amt(daily[hi])}</b> above the average ${g.noun}; <b>${at(lo)}</b> <b>${amt(daily[lo])}</b> below. Across the week, ${WEEKDAYS[dh]} add <b>${amt(add[dh])}</b> on top of that and ${WEEKDAYS[dl]} take off <b>${amt(add[dl])}</b>.`,
    acts: [{ label: "Decompose", act: { kind: "mode", mode: "decompose" } }],
  };
}

/**
 * Problems the total hides, found by looking at each group of a split column on its own: one store falling while the others
 * rise, one stretch where a group has nothing at all. Both vanish in the summed line. Runs only on the combined series, for sums
 * and counts (where the groups add up to the line shown).
 */
function groupFindings(s: TsSnapshot): TsFinding[] {
  const A = s.A, N = A.modelN, groups = s.table.groups;
  if (s.cfg.group >= 0 || groups.length < 2 || groups.length > 60 || (s.cfg.agg !== "sum" && s.cfg.agg !== "count")) return [];
  if (N < 24 || (A.groupVal[0]?.length ?? 0) < N) return [];
  const out: TsFinding[] = [];
  const ly = Math.round(A.g.ly || 0);
  // Compare the latest stretch with the one before it: a year when there is one, else a third of the history.
  const w = ly >= 2 && N >= 2 * ly ? ly : Math.floor(N / 3);
  if (w >= 4) {
    const sum = (r: number, a: number, b: number): number => { let t = 0; for (let k = a; k < b; k++) t += A.groupVal[r]![k]!; return t; };
    const grand = (a: number, b: number): number => { let t = 0; for (let r = 0; r < groups.length; r++) t += sum(r, a, b); return t; };
    const found: { r: number; own: number; rest: number }[] = [];
    for (let r = 0; r < groups.length; r++) {
      const before = sum(r, N - 2 * w, N - w), now = sum(r, N - w, N);
      const restBefore = grand(N - 2 * w, N - w) - before, restNow = grand(N - w, N) - now;
      if (!(before > 0) || !(restBefore > 0) || before < 0.02 * grand(N - 2 * w, N - w)) continue;
      const own = now / before - 1, rest = restNow / restBefore - 1;
      if ((own <= -0.1 && rest >= 0.03) || (own >= 0.1 && rest <= -0.03) || Math.abs(own - rest) >= 0.3) found.push({ r, own, rest });
    }
    found.sort((a, b) => Math.abs(b.own - b.rest) - Math.abs(a.own - a.rest));
    if (found.length) {
      const f = found[0]!, pc = (x: number): string => `${x < 0 ? "−" : "+"}${Math.abs(x * 100).toFixed(0)}%`;
      const span = ly >= 2 && N >= 2 * ly ? "the last year against the year before" : `the latest ${w} ${A.g.nouns} against the ${w} before`;
      out.push({
        kind: "A group moves against the rest", tone: "warn",
        html: `<b>${escapeHtml(groups[f.r]!)}</b> is <b>${pc(f.own)}</b> over ${span}, while all the others together are <b>${pc(f.rest)}</b>. The summed line hides it.${found.length > 1 ? ` ${found.length - 1} more ${found.length === 2 ? "group does" : "groups do"} the same.` : ""}`,
        acts: [{ label: `Look at ${groups[f.r]!}`, act: { kind: "pickGroup", index: f.r } }],
      });
    }
  }
  // A stretch where one group has nothing while the rest carry on: a missing feed, not a quiet spell.
  let worst: { r: number; start: number; len: number } | null = null;
  const need = Math.max(3, Math.ceil(N * 0.01));
  for (let r = 0; r < groups.length; r++) {
    let first = -1, last = -1, total = 0;
    for (let k = 0; k < N; k++) if (A.groupVal[r]![k]! !== 0) { if (first < 0) first = k; last = k; total++; }
    if (total < 0.5 * N * 0.3) continue;
    let run = 0, start = 0;
    for (let k = first; k <= last + 1; k++) {
      if (k <= last && A.groupVal[r]![k] === 0) { if (run === 0) start = k; run++; continue; }
      if (run >= need && (!worst || run > worst.len)) worst = { r, start, len: run };
      run = 0;
    }
  }
  if (worst) {
    const w2 = worst;
    out.push({
      kind: "A group has a gap", tone: "warn",
      html: `<b>${escapeHtml(groups[w2.r]!)}</b> has nothing for <b>${w2.len} ${nounFor(A.g, w2.len)}</b> from ${shortPeriod(A.g, A.t[w2.start]!)}, while the other groups carry on. That looks like missing data, and it pulls the total down there.`,
      acts: [{ label: "Show it", act: { kind: "focus", i: w2.start } }, { label: `Look at ${groups[w2.r]!}`, act: { kind: "pickGroup", index: w2.r } }],
    });
  }
  return out;
}

/**
 * A continuous reading that sits on one exact value for a long stretch is a stuck sensor, not a quiet period: real readings of a
 * continuous quantity do not repeat to the last digit for days. Counts and small whole numbers repeat legitimately, so they are
 * not tested.
 */
function stuckFinding(s: TsSnapshot): TsFinding | null {
  const A = s.A, n = A.modelN;
  if (n < 24 || s.cfg.agg === "count") return null;
  const distinct = new Set<number>();
  for (let i = 0; i < n; i++) if (A.y[i] === A.y[i]) distinct.add(A.y[i]!);
  if (distinct.size < Math.max(20, n / 20)) return null;
  const need = Math.max(6, Math.ceil(n * 0.02));
  let bestStart = -1, bestLen = 0, runStart = 0, runLen = 0;
  for (let i = 0; i <= n; i++) {
    const same = i < n && i > 0 && A.y[i] === A.y[i - 1] && A.y[i] === A.y[i] && !A.made[i] && !A.filled[i];
    if (same) { runLen++; continue; }
    if (runLen + 1 > bestLen && runLen + 1 >= need) { bestLen = runLen + 1; bestStart = runStart; }
    runStart = i; runLen = 0;
  }
  if (bestStart < 0) return null;
  const v = A.y[bestStart]!;
  return {
    kind: "Stuck readings", tone: "warn",
    html: `<b>${nf.format(bestLen)} ${A.g.nouns} in a row</b> read exactly <b>${compact(v)}</b>, from ${shortPeriod(A.g, A.t[bestStart]!)}. A continuous reading does not repeat to the last digit for that long: this looks like a stuck sensor or a value carried forward, and it flattens the trend and season through that stretch.`,
    acts: [{ label: "Show it", act: { kind: "focus", i: bestStart } }],
  };
}

/**
 * A lasting change of level by a factor that is a power of ten (or 60) looks like a change of unit, not of the thing measured:
 * µg/m³ to mg/m³ is 1,000×, minutes to hours 60×. The finding says so and where to look; the fix is to convert one side.
 */
function unitFinding(s: TsSnapshot): TsFinding | null {
  const cp = s.dec.cp, A = s.A;
  if (!cp || cp.gain < 0.5 || !A.allPositive) return null;
  // The trend is smoothed across the step, so the two levels are read from the readings themselves (medians, a few periods back
  // from the break so the ramp does not count).
  const med = (a: number, b: number): number => {
    const v: number[] = [];
    for (let i = a; i < b; i++) if (A.y[i] === A.y[i] && !A.made[i]) v.push(A.y[i]!);
    v.sort((x, y) => x - y);
    return v.length ? v[v.length >> 1]! : NaN;
  };
  const gap = Math.max(2, Math.round(A.modelN * 0.03));
  const before = med(Math.max(0, cp.k - Math.round(A.modelN * 0.2)), cp.k - gap), after = med(cp.k + gap, Math.min(A.modelN, cp.k + Math.round(A.modelN * 0.2)));
  if (!(before > 0) || !(after > 0)) return null;
  const ratio = after / before, big = ratio > 1 ? ratio : 1 / ratio;
  if (big < 8) return null;
  const near = [10, 100, 1000, 10000, 60, 3600, 1e6].find((f) => Math.abs(Math.log(big / f)) < 0.2);
  if (near === undefined) return null;
  return {
    kind: "Possible unit change", tone: "warn",
    html: `From <b>${shortPeriod(A.g, A.t[cp.k]!)}</b> the typical value is about <b>${nf.format(near)}× ${ratio > 1 ? "higher" : "lower"}</b>. A jump by exactly that factor usually means the unit changed (µg/m³ to mg/m³, minutes to hours), not the thing measured. Check any unit column, convert one side, and the forecast stops chasing a step that is not real.`,
    acts: [{ label: "Show the change", act: { kind: "showChange", k: cp.k } }],
  };
}

/**
 * Whether the series holds a steady level, in plain words: the test, what it found, and what that means for the models. A steady
 * trend alone also fails the test (the level moves), so the sentence says the failure is drift, not necessarily randomness.
 */
function stationarityFinding(s: TsSnapshot): TsFinding | null {
  const st = s.stationarity;
  if (!st) return null;
  const k = st.kpss.toFixed(2), c = st.critical.toFixed(2);
  const season = st.D > 0 ? ` A seasonal difference (${st.m} ${st.m === 1 ? "period" : "periods"}) is also taken, as the season is strong (${st.strength.toFixed(2)}).` : "";
  if (st.stationary && st.D === 0) return { kind: "Stationarity", tone: "dim", html: `<b>Steady level.</b> The series does not drift: the KPSS statistic is ${k}, under the 5% limit of ${c}. Models that need a steady mean can use it as it is.`, acts: [] };
  const how = st.d === 0 ? "no plain difference is needed" : st.d === 1 ? "one difference (each period minus the one before) makes it steady" : `${st.d} differences are needed to make it steady`;
  const tk = st.trendKpss.toFixed(2), tc = st.trendCritical.toFixed(2);
  if (!st.stationary && st.trendStationary) {
    return {
      kind: "Stationarity", tone: "dim",
      html: `<b>Steady around a trend.</b> The level moves over time (KPSS ${k}, over the 5% limit of ${c}), but the series stays close to a straight-line trend (trend KPSS ${tk}, under ${tc}): a trend plus noise, not a random walk. Differencing handles it (AutoARIMA does, and ${how}), and so does a model with a trend term; neither is wrong.${season}`,
      acts: [],
    };
  }
  const lead = st.stationary ? "<b>Steady once the season is removed.</b>" : "<b>Not steady, even around a trend.</b> The level wanders";
  return {
    kind: "Stationarity", tone: "dim",
    html: `${lead} (KPSS ${k}${st.stationary ? "" : `, over ${c}; around a trend ${tk}, over ${tc}`}); ${how}.${season} AutoARIMA does this itself; the smoothing and regression models carry the drift as a trend instead.`,
    acts: [],
  };
}

/**
 * Other columns that would help the forecast, from the walk-forward scan: each is offered with the error it cuts, and the page says
 * so plainly when nothing helps or a column was left out for being the series under another name.
 */
function driverFinding(s: TsSnapshot): TsFinding | null {
  const scan = s.driverScan;
  if (!scan || (scan.tested === 0 && scan.leaked.length === 0)) return null;
  const top = scan.hints.slice(0, 2);
  const lead = (h: (typeof top)[number]): string => `<b>${escapeHtml(h.col)}</b> cuts the error by <b>${Math.round(h.cut * 100)}%</b> on data held back (${h.sign > 0 ? "they rise and fall together" : "it moves the other way"}${h.lag ? `, ${h.lag} ${h.lag === 1 ? "period" : "periods"} ahead` : ""})`;
  const left = scan.leaked.length ? ` ${scan.leaked.map((c) => `<b>${escapeHtml(c)}</b>`).join(", ")} was left out: it follows ${measureWord(s)} so closely that it looks built from it, which would only hand the forecast the answer.` : "";
  if (!top.length) {
    if (s.cfg.drivers.length || scan.tested === 0) return left ? { kind: "Drivers", tone: "dim", html: left.trim(), acts: [] } : null;
    return { kind: "Drivers", tone: "dim", html: `Tried ${scan.tested} other ${scan.tested === 1 ? "column" : "columns"} as drivers; none cut the error by 8% or more on held-back data, so the forecast uses the series alone.${left}`, acts: [] };
  }
  return {
    kind: "Drivers", tone: "accent",
    html: `${top.map(lead).join("; ")}. Adding ${top.length > 1 ? "one" : "it"} as a driver lets the trend, seasons and drivers model use it; the future value is then assumed, so check that rule.${left}`,
    acts: top.map((h) => ({ label: `Add ${h.col}`, act: { kind: "addDriver" as const, col: h.col } })),
  };
}

/** Why a period stands out: a data gap, a driver off its usual level, or one group. */
function explain(s: TsSnapshot, i: number, expected: number): string {
  const A = s.A;
  // Missing rows can only explain a drop in a total; a rise with fewer rows is not a gap, so it falls through to the other causes.
  const low = A.y[i] < expected;
  if (A.filled[i] || (A.coverage[i] < 0.9 && (low || s.cfg.agg !== "sum"))) return `Only about ${Math.round(A.coverage[i] * 100)}% of the usual rows are there, so this is ${low ? "more likely a data gap than a real drop" : "a thin period, not a reliable rise"}.`;
  // A public holiday in the period explains a high or low reading the series' own pattern cannot.
  if (A.holidays && (A.g.unit === "min" || A.g.unit === "day" || A.g.unit === "week")) {
    const t0 = A.t[i]!, hs = holidaysBetween(A.holidays, t0, t0 + A.g.days * DAY);
    if (hs.length) return `<b>${hs.map((h) => escapeHtml(h.name)).join(" and ")}</b> falls ${A.g.days <= 1 ? "on this day" : `in this ${A.g.noun}`}, which usually explains it.`;
  }
  const w = A.g.evWin || Math.max(3, Math.round(A.g.perYear / 6.5));
  for (const d of s.cfg.drivers) {
    const ser = s.driverSeries[d.col];
    if (!ser || s.table.columns.find((c) => c.name === d.col)?.flag) continue;
    const win = Float64Array.from(ser.subarray(Math.max(0, i - w), i + w)).sort();
    const typ = win[win.length >> 1], ch = ser[i] / typ - 1;
    if (Math.abs(ch) > 0.05) return `<b>${escapeHtml(d.col)}</b> was ${Math.abs(ch * 100).toFixed(0)}% ${ch < 0 ? "below" : "above"} its usual level that ${A.g.noun}.`;
  }
  const groups = s.table.groups;
  if (s.cfg.agg !== "sum" || s.cfg.group >= 0 || groups.length < 2 || (A.groupVal[0]?.length ?? 0) < A.modelN) return "";
  const excess = A.y[i] - expected;
  let tot = 0;
  const shares = groups.map((_, r) => { let v = 0; for (let k = 0; k < A.modelN; k++) v += A.groupVal[r][k]; tot += v; return v; });
  let best = -1, bestV = 0;
  groups.forEach((_, r) => { const e = A.groupVal[r][i] - (expected * shares[r]) / tot; if (Math.sign(e) === Math.sign(excess) && Math.abs(e) > Math.abs(bestV)) { bestV = e; best = r; } });
  return best < 0 || !(tot > 0) ? "" : `${escapeHtml(s.table.groupCol ?? "group")} <b>${escapeHtml(groups[best])}</b> accounts for ${Math.min(100, (bestV / excess) * 100).toFixed(0)}% of it.`;
}

/** "between 08:00 and 18:00" for the open hours of a timetable, or "" when every hour has rows. */
function openHours(closed: readonly number[]): string {
  if (!closed.some(Boolean)) return "";
  const hh = (h: number): string => `${String(h % 24).padStart(2, "0")}:00`;
  const runs: string[] = [];
  // Start at a closed hour so a run across midnight stays whole.
  const s0 = closed.indexOf(1);
  for (let k = 0; k < 24; k++) {
    const h = (s0 + k) % 24;
    if (closed[h] || !closed[(h + 23) % 24]) continue;
    let e = h;
    while (!closed[(e + 1) % 24]) e++;
    runs.push(`between ${hh(h)} and ${hh(e + 1)}`);
  }
  return runs.join(" and ");
}

const GAP_WORDS: Record<string, string> = {
  smart: "filled smartly (the usual pattern for short gaps, the nearby typical value for long ones)", local: "filled with the nearby typical value",
  lastcycle: "copied from the cycle before", seasonal: "filled with the usual pattern", interp: "interpolated", last: "carried forward", zero: "filled with zero", leave: "left empty",
};

/** Everything the findings rail says, most useful first. */
export function buildInsights(s: TsSnapshot, view: TsView): TsFinding[] {
  const out: TsFinding[] = [];
  const A = s.A, g = A.g, N = A.modelN, d = s.dec.dec, cfg = s.cfg, info = s.table;
  if (d) {
    const ends = Math.max(1, Math.round(N * 0.05));
    let first = 0, lastv = 0;
    for (let i = 0; i < ends; i++) { first += d.trend[i]; lastv += d.trend[N - 1 - i]; }
    first /= ends; lastv /= ends;
    const tr = trendRate(s, d.trend);
    const rate = tr ? ` The trend is moving <b>${tr.text}</b> over ${tr.window}.` : "";
    const html = A.allPositive && first > 0
      ? `${measureLead(s)} ${lastv >= first ? "rose" : "fell"} <b>${Math.abs((lastv / first - 1) * 100).toFixed(0)}%</b> over the period.${rate}`
      : `${measureLead(s)}'s trend went from <b>${compact(first)}</b> to <b>${compact(lastv)}</b> over the period.${rate}`;
    out.push({ kind: "Trend", tone: "accent", meter: d.ft, meterLabel: "trend strength", html, acts: [{ label: "Show all", act: { kind: "fullView" } }] });
    const cp = s.dec.cp;
    if (cp && cp.gain > 0.5) {
      const k = g.perYear / 12;
      let scale = 0;
      for (let i = 0; i < N; i++) scale += Math.abs(A.yModel[i]);
      scale = scale / N || 1;
      const b = (cp.before.slope * k) / scale, a = (cp.after.slope * k) / scale;
      const kk = Math.max(rateK(...monthlyParts(s, cp.before.slope, cp.before.mean)), rateK(...monthlyParts(s, cp.after.slope, cp.after.mean)));
      if (Math.abs(b - a) > 0.006) out.push({
        kind: "Change", tone: "dim",
        html: `The trend ${a < b ? "slowed" : "picked up"} from <b>${dfMonShort.format(new Date(A.t[cp.k]))}</b>: <b>${monthlyRate(s, cp.before.slope, cp.before.mean, kk)}</b> before, <b>${monthlyRate(s, cp.after.slope, cp.after.mean, kk)}</b> after.`,
        acts: [{ label: "Show", act: { kind: "showChange", k: cp.k } }],
      });
    }
    const prof = d.m > 60 ? circularSmooth(d.prof, Math.round(d.m / 24)) : d.prof;
    let hiK = 0, loK = 0;
    for (let k = 0; k < prof.length; k++) { if (prof[k] > prof[hiK]) hiK = k; if (prof[k] < prof[loK]) loK = k; }
    const unit = g.unit === "day" && d.m === 7 ? "day" : g.unit === "month" && g.n === 1 ? "month" : g.noun;
    const calendar = d.m && g.seasons[d.m];
    const toDecompose = { label: "Decompose", act: { kind: "mode", mode: "decompose" } as TsAction };
    if (!d.m && s.dec.cycle) out.push({ kind: "Season · rough cycle", tone: "forecast", html: `A rough cycle of about <b>${s.dec.cycle} ${g.nouns}</b>${cycleSpan(g, s.dec.cycle)} shows up, but its length drifts too much to treat as a season. Trend and leftovers only; pick it under Decompose to try.`, acts: [toDecompose] });
    else if (!d.m) out.push({ kind: "Season · none", tone: "forecast", html: "No repeating cycle at this grain. Trend and leftovers only.", acts: [toDecompose] });
    else if (d.parts) out.push(seasonPartsFinding(s, d));
    else if (!calendar) {
      let lastHi = -1, lastLo = -1;
      for (let i = N - 1; i >= 0 && (lastHi < 0 || lastLo < 0); i--) { const k = phaseIndex(i, d.m); if (lastHi < 0 && k === hiK) lastHi = i; if (lastLo < 0 && k === loK) lastLo = i; }
      out.push({
        kind: `Season · ${periodName(g, d.m)}`, tone: "forecast", meter: d.fs, meterLabel: "seasonal strength",
        html: `Repeats about every <b>${d.m} ${g.nouns}</b>${cycleSpan(g, d.m)}. Latest high phase around <b>${shortPeriod(g, A.t[lastHi])}</b>, latest low around <b>${shortPeriod(g, A.t[lastLo])}</b>; swing about <b>${compact(prof[hiK] - prof[loK])}</b>.`,
        acts: [toDecompose],
      });
    } else {
      const rel = (v: number): string => (A.allPositive && d.level > 0 ? Math.abs((v / d.level) * 100).toFixed(0) + "%" : compact(Math.abs(v)));
      out.push({
        kind: `Season · ${periodName(g, d.m)}`, tone: "forecast", meter: d.fs, meterLabel: "seasonal strength",
        html: `${cap(phaseLabel(s, d.m, hiK))} ${d.m === 7 ? "run" : "runs"} <b>${rel(prof[hiK])}</b> above an average ${unit}; ${phaseLabel(s, d.m, loK)} <b>${rel(prof[loK])}</b> below.`,
        acts: [toDecompose],
      });
    }
    // The season grows with the level: say so on the season finding just added.
    const last = out[out.length - 1];
    if (d.scaled && d.m && last.kind.startsWith("Season")) last.html += " The swing grows and shrinks with the level, so it is fitted as a share of the trend; sizes are at the average level.";
    if (d.also && last.kind.startsWith("Season")) {
      let lo = Infinity, hi = -Infinity;
      for (const v of d.also.prof) { if (v < lo) lo = v; if (v > hi) hi = v; }
      last.kind = `Season · ${seasonName(g, d)}`;
      last.html += ` A ${periodName(g, d.also.m)} season of its own swings by about <b>${compact(hi - lo)}</b> from low to high; it is taken out of the trend too, so the trend is not carrying that wave.`;
    }
    const events = s.dec.events;
    if (events.length) {
      // Unusual periods that run together are one event: the dip is "Mar–Jul 2020, −40% to −46%", not four points.
      const label = (e: (typeof events)[number]): string => (e.a === e.b ? periodLabel(g, A.t[e.a]) : `${shortPeriod(g, A.t[e.a])} – ${shortPeriod(g, A.t[e.b])}`);
      const spread = (e: (typeof events)[number]): string => {
        const parts: number[] = [];
        for (let i = e.a; i <= e.b; i++) {
          if (!(A.y[i] === A.y[i])) continue;
          const exp = d.trend[i] + d.seasonal[i];
          if (exp !== 0) parts.push((A.y[i] - exp) / Math.abs(exp));
        }
        if (!parts.length) return "–";
        const pc = (x: number): string => `${x < 0 ? "−" : "+"}${Math.abs(x * 100).toFixed(0)}%`;
        const a = parts.reduce((m, x) => (Math.abs(x) < Math.abs(m) ? x : m)), b = parts.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m));
        return parts.length === 1 || pc(a) === pc(b) ? pc(b) : `${pc(a)} to ${pc(b)}`;
      };
      const top = events[0]!;
      let peak = top.a;
      for (let i = top.a; i <= top.b; i++) if (Math.abs(s.dec.z?.[i] ?? 0) > Math.abs(s.dec.z?.[peak] ?? 0)) peak = i;
      const lasts = top.b - top.a + 1;
      out.push({
        kind: `Unusual · ${events.length} ${events.length === 1 ? "event" : "events"}`, tone: "danger",
        html: `Largest: <b>${label(top)}</b>${lasts > 1 ? ` (${lasts} ${nounFor(g, lasts)})` : ""}, <b>${spread(top)}</b> against expected. ${explain(s, peak, d.trend[peak] + d.seasonal[peak])}`,
        acts: events.slice(0, 4).map((e) => ({ label: label(e), act: { kind: "focus", i: e.a } as TsAction })),
      });
    }
  }
  const key = selectedModel(s, view);
  if (!("error" in s.models) && s.futures && key) {
    const M: ModelRun = s.models, f: Future = s.futures[key], r = ratioOf(s, key), gr = grade(r, key);
    let avg = 0, l = 0, h = 0;
    for (let k = 0; k < M.H; k++) { avg += f.F[k]; l += f.lo80[k]; h += f.hi80[k]; }
    const beat = key === "sn" ? "Nothing beats repeating the last cycle here." : `<b>${MODEL_INFO[key].name}</b> beats repeating the last cycle by <b>${Math.max(0, (1 - r) * 100).toFixed(0)}%</b>${f.held ? " on the held-out " + g.nouns : ""}.`;
    out.push({
      kind: `Forecast · ${gr.text}`, tone: "forecast",
      html: `${beat} Next ${M.H} ${nounFor(g, M.H)}: <b>${compact(avg / M.H)}</b> ${aNoun(g)} on average (80%: ${compact(l / M.H)} to ${compact(h / M.H)}).`,
      acts: [{ label: view.mode === "forecast" ? "Fit view" : "Open forecast", act: { kind: "forecastView" } }],
    });
  } else if ("error" in s.models) out.push({ kind: "Forecast", tone: "forecast", html: escapeHtml(s.models.error), acts: [] });
  const bits: string[] = [], cn = cadenceNoun(info.cadence);
  const acts: TsFinding["acts"] = [];
  if (A.gapRanges.length) {
    const ms = (slot: number): number => info.start + slot * info.slot;
    const sameDay = (a: number, b: number): boolean => Math.floor(a / info.spd) === Math.floor(b / info.spd);
    const fmt = ([a, b]: [number, number]): string => fmtInstant(ms(a), info.subDay) + (b > a ? " – " + (info.subDay && sameDay(a, b) ? dfTime.format(new Date(ms(b))) : fmtInstant(ms(b), info.subDay)) : "");
    const realSlots = (a: number, b: number): number => { let c = 0; for (let k = a; k <= b; k++) if (openAt(info, ms(k))) c++; return c; };
    const slots = A.gapRanges.reduce((sum, [a, b]) => sum + Math.max(1, Math.round(realSlots(a, b) / Math.max(1, info.cadSlots))), 0);
    bits.push(`<b>${nf.format(slots)} ${slots === 1 ? cn.replace(/s$/, "") : cn}</b> with no rows (${A.gapRanges.slice(0, 3).map(fmt).join(", ")}${A.gapRanges.length > 3 ? `, and ${A.gapRanges.length - 3} more stretches` : ""}). Periods with no rows are ${GAP_WORDS[cfg.gaps]}${cfg.gaps === "zero" ? "" : "; the models bridge them with the smart fill but never learn from them (the smoothing models carry their state across, the regression leaves them out) and never score forecast errors on them"}.`);
    // The period holding the first empty slot.
    const gapMs = ms(A.gapRanges[0][0]);
    let gi = 0;
    while (gi + 1 < A.n && A.t[gi + 1] <= gapMs) gi++;
    acts.push({ label: "Show gap", act: { kind: "focus", i: gi } });
  }
  const struct = [0, 1, 2, 3, 4, 5, 6].filter((k) => info.structural[k]).map((k) => WEEKDAYS[k]);
  if (struct.length) bits.push(`${struct.join(" and ")} never have rows, so they are not counted as missing.`);
  const hours = openHours(info.closedHours);
  if (hours) bits.push(`Rows only come ${hours}; other hours are not counted as missing.`);
  // Finer rows shown at a day or coarser: the cycle within the day is averaged away.
  const finer = info.subDay && g.unit !== "min" ? GRAIN_ORDER.find((id) => GRAINS[id].unit === "min" && !info.tooFine[id]) : undefined;
  if (finer) {
    bits.push(`Rows come about every ${cadenceText(info.cadence)}; ${GRAINS[finer].adj.toLowerCase()} grain shows the pattern within each day.`);
    acts.push({ label: GRAINS[finer].adj, act: { kind: "grain", grain: finer } });
  }
  if (A.naRows > 0) bits.push(`${nf.format(A.naRows)} rows have no ${measureWord(s)} value and are left out.`);
  if (info.dropped) bits.push(`${nf.format(info.dropped)} rows have no readable ${escapeHtml(info.dateCol)} and are left out.`);
  if (A.partial[A.n - 1]) bits.push(`The last ${g.noun} is partial (the data covers about ${Math.round(A.partShare[A.n - 1] * 100)}% of it) and is ${cfg.partial === "exclude" ? "left out of trend and forecast" : "included"}.`);
  const repeated = cfg.agg === "sum" && cfg.group < 0 && info.groups.length > 1 && info.columns.some((c) => c.name === cfg.measure && c.repeated);
  if (repeated) {
    bits.unshift(`<b>${measureWord(s)}</b> has the same value on every ${escapeHtml(info.groupCol ?? "group")} row at the same moment, so it looks like a total already. Summing across the ${info.groups.length} ${escapeHtml(info.groupCol ?? "group")} values counts it ${info.groups.length} times; a mean shows it once.`);
    acts.unshift({ label: "Use mean", act: { kind: "agg", agg: "mean" } });
  } else if (A.spread && cfg.agg === "sum") {
    bits.unshift(`Most ${g.nouns} hold between <b>${nf.format(A.spread[0])}</b> and <b>${nf.format(A.spread[1])}</b> values of ${measureWord(s)}, so a sum rises and falls with how many there were. If each row is a reading at a moment (a level, a temperature, spaces in use), a mean fits, and a time-weighted mean also evens out readings taken at uneven times; if each row is an amount (a sale, a visit), the sum is right.`);
    acts.unshift({ label: "Use mean", act: { kind: "agg", agg: "mean" } }, { label: "Time-weighted mean", act: { kind: "agg", agg: "twmean" } });
  } else if (A.spread && cfg.agg === "mean") {
    bits.unshift(`Readings are uneven: most ${g.nouns} hold between <b>${nf.format(A.spread[0])}</b> and <b>${nf.format(A.spread[1])}</b>, so a plain mean leans toward the stretches with more of them. A time-weighted mean counts each reading for as long as it held, until the next one.`);
    acts.unshift({ label: "Time-weighted mean", act: { kind: "agg", agg: "twmean" } });
  }
  if (bits.length) out.push({ kind: "Data", tone: "warn", html: bits.join(" "), acts });
  for (const f of [...groupFindings(s), stuckFinding(s), unitFinding(s)]) if (f) out.push(f);
  // Stationarity reads best beside the season it qualifies, not at the foot of the list.
  const stat = stationarityFinding(s);
  if (stat) {
    let at = out.length;
    for (let i = out.length - 1; i >= 0; i--) if (out[i]!.kind.startsWith("Season")) { at = i + 1; break; }
    out.splice(at, 0, stat);
  }
  const drv = driverFinding(s);
  if (drv) out.push(drv);
  return out;
}

/** The model card: how the chosen model works and how far to trust it. */
export function modelRows(s: TsSnapshot, sel: ModelKey, metric: MetricKey = "mase"): [string, string][] {
  if ("error" in s.models || !s.futures) return [];
  const M = s.models, g = s.A.g, m = M.models[sel], A = s.A, word = measureWord(s);
  const rows: [string, string][] = [["Model set", M.profile]];
  if (s.cfg.transform !== "none") {
    rows.push(["Transform", M.transform
      ? `Box-Cox with λ = ${M.transform.lambda.toFixed(2)}${M.transform.method === "log" ? " (the log, as you chose)" : " (Guerrero's method on the history before the first fold)"}. Best smoothing, Smooth and damp, Steady trend and the regression learn on the transformed series; their forecasts are mapped back, so they are medians, not means. The benchmarks, Repeat last cycle and Seasonal average stay on the original scale.`
      : "Asked for, but not applied: a power transformation needs every value above zero, and enough history to choose a power."]);
  }
  if (M.auto) rows.push(["Auto", `${escapeHtml(M.auto[metric].why)}${sel !== M.auto[metric].pick ? ` You have picked ${MODEL_INFO[sel].name} instead.` : ""}`]);
  if (M.season && sel !== "sn" && sel !== "clim" && sel !== "reg") rows.push(["Season", escapeHtml(M.season.why)]);
  if (sel === "comb") rows.push(["Combination", `the plain average of the ${M.m <= 1 ? "Best smoothing and Smooth and damp forecasts (Steady trend is left out when there is no season)" : "Best smoothing, Steady trend and Smooth and damp forecasts"} (fpp3 13.4). Each is an imperfect view of the same series, and their misses partly cancel; the average has no parameters of its own to overfit`]);
  const hw = M.models.hw.hw;
  if ((sel === "hw" || sel === "ens") && hw) {
    const [a, b, gm, ph] = hw.params;
    rows.push(["Smooth and damp", M.season?.mode === "native" || !M.season
      ? `level ${a.toFixed(2)}, trend ${b.toFixed(3)}, season ${gm.toFixed(2)}, damping ${ph.toFixed(2)} (season of ${M.m} ${g.nouns})`
      : `a damped trend with level ${a.toFixed(2)}, trend ${b.toFixed(3)} and damping ${ph.toFixed(2)}${M.season.mode === "mstl" ? ", run on the seasonally adjusted series with the season added back" : ", with no season"}`]);
  }
  const ets = M.models.ets.ets;
  if ((sel === "ets" || sel === "ens") && ets) {
    const [err, trend, season] = ets.spec.split(",");
    const errWord = err === "M" ? "multiplicative errors (the noise grows with the level)" : "additive errors";
    const trendWord = trend === "N" ? "no trend" : trend === "A" ? "a straight-line trend" : "a trend that flattens out (damped)";
    const seasonWord = season === "N" ? "no season" : season === "A" ? "a season of fixed size" : "a season that grows with the level (multiplicative)";
    rows.push(["Best smoothing", `ETS(${escapeHtml(ets.spec)}): ${errWord}, ${trendWord} and ${seasonWord}, the lowest AICc of ${ets.tried} forms tried; level ${ets.alpha.toFixed(2)}${trend !== "N" ? `, trend ${ets.beta.toFixed(3)}` : ""}${season !== "N" ? `, season ${ets.gamma.toFixed(2)}` : ""}${trend === "Ad" ? `, damping ${ets.phi.toFixed(2)}` : ""}. AICc rewards a close fit but charges for every extra part, so a richer form only wins when it earns its keep.`]);
  }
  const reg = M.models.reg.reg;
  if ((sel === "reg" || sel === "ens") && reg) {
    const waves = [[reg.Ky, "yearly"], [reg.Kw, "weekly"], [reg.Kd, "daily"]].filter(([k]) => k).map(([k, w]) => `${k} ${w}`).join(", ") || "no";
    rows.push(["Trend, seasons and drivers", `${reg.K} possible trend bends, ${waves} wave pairs${reg.drivers.length ? ", drivers " + reg.drivers.map((v) => `<b>${escapeHtml(v.col)}</b>`).join(", ") : ", no drivers"}`]);
    for (const v of reg.drivers) {
      const col = escapeHtml(v.col), b = v.beta;
      const unit = v.flag ? `${col} at 1 rather than 0` : `each +1 in ${col}`;
      rows.push([`Effect of ${col}`, v.log
        ? `a 1% higher ${col} goes with ${Math.abs(b).toFixed(1)}% ${b < 0 ? "lower" : "higher"} ${word} (elasticity ${b.toFixed(2)})`
        : reg.logY ? `${unit} goes with ${pct(Math.exp(b) - 1)} ${word}` : `${unit} goes with ${b >= 0 ? "+" : "−"}${Math.abs(b).toFixed(Math.abs(b) < 10 ? 2 : 0)} in ${word}`]);
    }
    if (reg.drivers.length) rows.push(["Driver values ahead", driverStory(s)]);
  }
  const th = M.models.theta.theta;
  if ((sel === "theta" || sel === "ens") && th) rows.push(["Steady trend", `simple smoothing (α ${th.alpha.toFixed(2)}) plus half the long-run slope (${signed(th.b0 / 2)} ${aNoun(g)})${th.seasonal ? "; seasonal pattern taken out first and added back" : ""}`]);
  const climM = M.models.clim.clim?.m ?? 1;
  if (sel === "clim") rows.push(["Seasonal average", climM > 1 ? `each ${g.noun} is the mean of the same point in every earlier cycle of ${climM} ${g.nouns}; strong when there is a season but no trend` : `the mean of all earlier ${g.nouns}; there is no season at this grain`]);
  if (sel === "sn") rows.push(["Repeat last cycle", M.m > 1 ? `each ${g.noun} copies the same ${g.noun} one season (${M.m} ${g.nouns}) earlier` : `each ${g.noun} repeats the last one; there is no season at this grain`]);
  rows.push(["Fitted on", `${shortPeriod(g, A.t[0])} to ${shortPeriod(g, A.t[M.T - 1])} (${M.T} ${g.nouns})`]);
  rows.push(["Backtest", `${M.origins.length} forecasts from earlier dates, ${M.H} ${g.nouns} each, ${M.cv === "rolling" && M.trainLen ? `each trained on the ${M.trainLen} ${g.nouns} before it (rolling window)` : "each trained on all the history before it (expanding window)"}; settings chosen before the first one, so nothing is scored on data it was tuned on. Error ${m.ratio.toFixed(2)}× repeating the last cycle`]);
  if (m.metrics) rows.push([M.lockbox ? "Scores (selection folds)" : "Scores", METRIC_KEYS.map((k) => `${METRIC_INFO[k].label} ${metricText(k, m.metrics[k])}`).join(" · ")]);
  if (M.lockbox && m.lock) rows.push(["Scores (lockbox fold)", `${METRIC_KEYS.map((k) => `${METRIC_INFO[k].label} ${metricText(k, m.lock![k])}`).join(" · ")}. The last fold is held back: models are ranked and Auto picks on the other folds, then scored once here, so this score carries no selection bias`]);
  if (sel !== "sn" && m.folds?.of) {
    const luck = m.folds.won * 2 < m.folds.of && sel === (M.auto?.[metric]?.pick ?? M.best);
    rows.push(["Folds beaten", `beat repeating the last cycle in ${m.folds.won} of ${m.folds.of} folds${luck ? `. <span class="ts-warn">Best overall but wins under half the folds: its lead may come from one lucky stretch.</span>` : ""}`]);
  }
  if (m.metrics) {
    const size = (k: ModelKey): number => { const v = M.models[k].metrics?.[metric] ?? NaN; return metric === "bias" ? Math.abs(v) : v; };
    const others = (Object.keys(M.models) as ModelKey[]).filter((k) => k !== sel && k !== "sn" && size(k) === size(k)).sort((a, b) => size(a) - size(b));
    const next = others[0], mine = size(sel);
    if (next && mine === mine && mine > 0 && Math.abs(size(next) - mine) / mine < 0.05) rows.push(["Close call", `${MODEL_INFO[next].name} scores within 5% on ${METRIC_INFO[metric].label}; when scores are this close, the simpler model is the safer bet (less room to have learned noise)`]);
  }
  const f = s.futures[sel];
  if (f.held) rows.push(["Held-out check", `${f.held.hit} of ${f.held.tot} actual ${g.nouns} after the split fell inside the 80% band (${f.held.tot ? ((f.held.hit / f.held.tot) * 100).toFixed(0) : 0}%)${f.held.tot && f.held.hit / f.held.tot < 0.6 ? `. <span class="ts-warn">The band was too narrow here: the series changed after the backtest stretch.</span>` : ""}`]);
  else if (m.check) rows.push(["Band check", `on the latest backtest, ${m.check.hit} of ${m.check.tot} ${g.nouns} fell inside the 80% band built from the others`]);
  if (M.rough) rows.push(["Note", `<span class="ts-warn">Under three backtests fit in this history, so the range is wide and rough.</span>`]);
  rows.push(["Band", `a normal band (1.28 and 1.96 times the spread of this model's backtest errors at each step ahead); it widens the further ahead it goes${A.nonNeg ? " and stays at or above zero, as the series does" : ""}`]);
  return rows;
}
function fmtNum(v: number): string { return Math.abs(v - Math.round(v)) < 1e-9 ? nf.format(v) : v.toFixed(2); }
export function driverStory(s: TsSnapshot): string {
  const parts = s.cfg.drivers.map((d) => {
    const recent = fmtNum(s.driverRecent[d.col] ?? NaN);
    return `<b>${escapeHtml(d.col)}</b> ${d.rule === "lastyear" ? `same as ${s.A.g.lyAgo}` : d.rule === "pct" ? `${d.pct >= 0 ? "+" : "−"}${Math.abs(d.pct)}% on its recent level of ${recent}` : `held at its recent level of ${recent}`}`;
  });
  return parts.join("; ") + ". These are assumptions; the band does not include doubt about them.";
}
export { fmtNum };
