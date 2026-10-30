/**
 * Time Series page: findings and the words around the chart, read from one engine
 * snapshot. Pure functions (no DOM), so they are tested on their own.
 */

import { cadenceNoun, cadenceText, DAY, GRAIN_ORDER, GRAINS, openAt, weekdayAt, type Grain, type GrainId } from "../data/timeseries/base.js";
import type { TsAgg, TsMode } from "../data/timeseries/aggregate.js";
import { circularSmooth, phaseIndex, type Decomposition, type SeasonOption } from "../data/timeseries/decompose.js";
import type { TsSnapshot } from "../data/timeseries/engine.js";
import {
  aNoun, cap, compact, dfDM, dfMonShort, dfTime, dfWd, fmtInstant, MONTHS, nf, nounFor, pct, periodLabel, rateK, rateText,
  shortPeriod, signed, WEEKDAYS,
} from "../data/timeseries/format.js";
import { grade, MODEL_INFO, type Future, type ModelKey, type ModelRun } from "../data/timeseries/models.js";

/** What a finding's button does; the page carries it out. */
export type TsAction =
  | { kind: "fullView" }
  | { kind: "focus"; i: number }
  | { kind: "showChange"; k: number }
  | { kind: "mode"; mode: TsMode }
  | { kind: "forecastView" }
  | { kind: "grain"; grain: GrainId }
  | { kind: "agg"; agg: TsAgg };

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
export function monthlyRate(s: TsSnapshot, slope: number, mean: number, k?: number): string {
  const [r, asPct] = monthlyParts(s, slope, mean);
  return rateText(r, asPct, k);
}

export function periodName(g: Grain, m: number): string {
  if (!m) return "none";
  return g.seasons[m] ?? `${m}-${g.noun.split(" ").pop()} cycle`;
}
/** "daily + weekly" for the two-season split, else the period's own name. */
export function seasonName(g: Grain, d: Pick<Decomposition, "m"> & { parts?: unknown } | SeasonOption): string {
  return ("multi" in d ? d.multi : !!d.parts) ? "daily + weekly" : periodName(g, d.m);
}

export function selectedModel(s: TsSnapshot, view: TsView): ModelKey | null {
  if ("error" in s.models) return null;
  return view.model === "auto" ? s.models.best : view.model;
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

/** Why a period stands out: a data gap, a driver off its usual level, or one group. */
function explain(s: TsSnapshot, i: number, expected: number): string {
  const A = s.A;
  if (A.coverage[i] < 0.9 || A.filled[i]) return `Only about ${Math.round(A.coverage[i] * 100)}% of the usual rows are there, so this is a data gap, not a real ${A.y[i] < expected ? "drop" : "rise"}.`;
  const w = A.g.evWin || Math.max(3, Math.round(A.g.perYear / 6.5));
  for (const d of s.cfg.drivers) {
    const ser = s.driverSeries[d.col];
    if (!ser || s.table.columns.find((c) => c.name === d.col)?.flag) continue;
    const win = Float64Array.from(ser.subarray(Math.max(0, i - w), i + w)).sort();
    const typ = win[win.length >> 1], ch = ser[i] / typ - 1;
    if (Math.abs(ch) > 0.05) return `<b>${escapeHtml(d.col)}</b> was ${Math.abs(ch * 100).toFixed(0)}% ${ch < 0 ? "below" : "above"} its usual level that ${A.g.noun}.`;
  }
  const groups = s.table.groups;
  if (s.cfg.agg !== "sum" || s.cfg.group >= 0 || groups.length < 2) return "";
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

const GAP_WORDS: Record<string, string> = { zero: "filled with zero", interp: "interpolated", seasonal: "filled with the usual pattern", leave: "left empty" };

/** Everything the findings rail says, most useful first. */
export function buildInsights(s: TsSnapshot, view: TsView): TsFinding[] {
  const out: TsFinding[] = [];
  const A = s.A, g = A.g, N = A.modelN, d = s.dec.dec, cfg = s.cfg, info = s.table;
  if (d) {
    const ends = Math.max(1, Math.round(N * 0.05));
    let first = 0, lastv = 0;
    for (let i = 0; i < ends; i++) { first += d.trend[i]; lastv += d.trend[N - 1 - i]; }
    first /= ends; lastv /= ends;
    const mid = (ends - 1) >> 1;
    const months = (A.t[N - 1 - mid] - A.t[mid]) / (30.44 * DAY);
    const html = A.allPositive && first > 0
      ? `${measureLead(s)} ${lastv >= first ? "rose" : "fell"} <b>${Math.abs((lastv / first - 1) * 100).toFixed(0)}%</b> over the period, about <b>${rateText(Math.pow(lastv / first, 1 / Math.max(1, months)) - 1, true)}</b>.`
      : `${measureLead(s)}'s trend went from <b>${compact(first)}</b> to <b>${compact(lastv)}</b> over the period, about <b>${rateText((lastv - first) / Math.max(1, months), false)}</b>.`;
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
    if (s.dec.anomalies.length) {
      const i = s.dec.anomalies[0];
      const exp = d.trend[i] + d.seasonal[i];
      out.push({
        kind: `Unusual · ${s.dec.anomalyCount} ${nounFor(g, s.dec.anomalyCount)}`, tone: "danger",
        html: `Largest: <b>${periodLabel(g, A.t[i])}</b>, <b>${chg(s, A.y[i], exp)?.text ?? "–"}</b> against expected. ${explain(s, i, exp)}`,
        acts: s.dec.anomalies.slice(0, 4).map((j) => ({ label: shortPeriod(g, A.t[j]), act: { kind: "focus", i: j } as TsAction })),
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
    bits.push(`<b>${nf.format(slots)} ${slots === 1 ? cn.replace(/s$/, "") : cn}</b> with no rows (${A.gapRanges.slice(0, 3).map(fmt).join(", ")}${A.gapRanges.length > 3 ? `, and ${A.gapRanges.length - 3} more stretches` : ""}). Periods with no rows are ${GAP_WORDS[cfg.gaps]}${cfg.gaps === "zero" ? "" : "; the models bridge them with the usual pattern and never learn from or score them"}.`);
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
  return out;
}

/** The model card: how the chosen model works and how far to trust it. */
export function modelRows(s: TsSnapshot, sel: ModelKey): [string, string][] {
  if ("error" in s.models || !s.futures) return [];
  const M = s.models, g = s.A.g, m = M.models[sel], A = s.A, word = measureWord(s);
  const rows: [string, string][] = [["Model set", M.profile]];
  const hw = M.models.hw.hw;
  if ((sel === "hw" || sel === "ens") && hw) {
    const [a, b, gm, ph] = hw.params;
    rows.push(["Smooth and damp", `level ${a.toFixed(2)}, trend ${b.toFixed(3)}, season ${gm.toFixed(2)}, damping ${ph.toFixed(2)} (season of ${M.m} ${g.nouns})`]);
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
  rows.push(["Backtest", `${M.origins.length} forecasts from earlier dates, ${M.H} ${g.nouns} each; error ${m.ratio.toFixed(2)}× repeating the last cycle`]);
  const f = s.futures[sel];
  if (f.held) rows.push(["Held-out check", `${f.held.hit} of ${f.held.tot} actual ${g.nouns} after the split fell inside the 80% band (${f.held.tot ? ((f.held.hit / f.held.tot) * 100).toFixed(0) : 0}%)${f.held.tot && f.held.hit / f.held.tot < 0.6 ? `. <span class="ts-warn">The band was too narrow here: the series changed after the backtest stretch.</span>` : ""}`]);
  else if (m.check) rows.push(["Band check", `on the latest backtest, ${m.check.hit} of ${m.check.tot} ${g.nouns} fell inside the 80% band built from the others`]);
  if (M.rough) rows.push(["Note", `<span class="ts-warn">Under three backtests fit in this history, so the range is wide and rough.</span>`]);
  rows.push(["Band", `built from the backtest errors at each step ahead, not from a formula; it widens the further ahead it goes${A.nonNeg ? " and stays at or above zero, as the series does" : ""}`]);
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
