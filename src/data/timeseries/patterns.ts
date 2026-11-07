/**
 * Time Series page, Patterns tab: a typical day, week and year.
 */

import { DAY, GRAINS, MINUTE, tooFine, weekdayAt, type GrainId, type TsTable } from "./base.js";
import { aggregate, type Aggregated, type TsConfig } from "./aggregate.js";
import { quantile } from "./models.js";

export interface DayPattern {
  /** Periods per day at the profile's grain. */
  pd: number;
  stepMin: number;
  noun: string;
  med: number[];
  p25: number[];
  p75: number[];
  weekday: number[];
  weekend: number[];
  /** Weekday x time of day means, Monday first, row-major. */
  cells: number[];
  days: number;
  /** True when the profile never goes below zero (changes then read as percentages). */
  pos: boolean;
}
export interface WeekPattern { mean: number[]; n: number[]; pos: boolean }
export interface YearPattern {
  mean: number[]; years: number[]; perDay: boolean; pos: boolean;
  /**
   * The seasonal index: each month's level as a percentage of the trend (a centred 12-month average), averaged over the years, so
   * 100 is a typical month and a growing series does not make its later months look strong. Null with under two years of months.
   */
  index: number[] | null;
}
export interface Patterns { day?: DayPattern; week?: WeekPattern; year?: YearPattern }

/**
 * Typical day, week and year, from the series at hourly, daily and monthly grain
 * whatever grain is shown. Only complete periods with their usual rows count, so a
 * half-recorded hour or a data gap cannot fake a quiet spell.
 */
/** Ratio to a centred 12-month average, per calendar month, over the months that have a full year around them. */
function seasonalIndex(S: Aggregated, ok: (S: Aggregated, i: number) => boolean): number[] | null {
  const byMonth = new Map<number, { s: number; n: number }>();
  for (let i = 0; i < S.n; i++) {
    if (!ok(S, i) || !(S.y[i]! > 0)) continue;
    const dt = new Date(S.t[i]!), key = dt.getUTCFullYear() * 12 + dt.getUTCMonth(), e = byMonth.get(key) ?? { s: 0, n: 0 };
    e.s += S.y[i]!; e.n++; byMonth.set(key, e);
  }
  const mean = (k: number): number => { const e = byMonth.get(k); return e ? e.s / e.n : NaN; };
  const sum = new Float64Array(12), cnt = new Float64Array(12);
  for (const k of byMonth.keys()) {
    let ma = 0.5 * (mean(k - 6) + mean(k + 6));
    for (let j = -5; j <= 5; j++) ma += mean(k + j);
    ma /= 12;
    const m = mean(k);
    if (!(ma > 0) || !(m === m)) continue;
    const mo = ((k % 12) + 12) % 12;
    sum[mo] += (m / ma) * 100; cnt[mo]++;
  }
  if (cnt.filter((c) => c > 0).length < 12) return null;
  return Array.from(sum, (s, k) => s / cnt[k]!);
}

export function computePatterns(T: TsTable, cfg: TsConfig): Patterns {
  const ok = (S: Aggregated, i: number): boolean => S.y[i] === S.y[i] && !S.partial[i] && !S.made[i] && S.coverage[i] >= 0.5;
  const out: Patterns = {};
  // Rows that are events (orders, trips) arrive when they arrive, so their typical gap says nothing about which hours can be
  // profiled: only a slot the timestamps cannot be drawn at rules a grain out. Regularly sampled readings keep the cadence rule.
  const fineOk = (id: GrainId): boolean => (T.eventLike ? !(GRAINS[id].unit === "min" && (GRAINS[id].n * MINUTE) % T.slot !== 0) : !tooFine(T, id));
  const fine = T.subDay ? (["hour", "min30", "min15", "min5"] as GrainId[]).find(fineOk) : undefined;
  if (fine) {
    const S = aggregate(T, cfg, fine), gm = GRAINS[fine], pd = gm.perDay ?? 24;
    const vals: number[][] = Array.from({ length: pd }, () => []);
    const cell = new Float64Array(7 * pd), cellN = new Float64Array(7 * pd);
    const wk = [new Float64Array(pd), new Float64Array(pd)], wkN = [new Float64Array(pd), new Float64Array(pd)];
    for (let i = 0; i < S.n; i++) {
      if (!ok(S, i)) continue;
      const ms = S.t[i], k = Math.floor((((ms - T.start) % DAY) + DAY) % DAY / (gm.n * MINUTE)), wd = weekdayAt(T, ms), v = S.y[i];
      vals[k].push(v);
      cell[wd * pd + k] += v; cellN[wd * pd + k]++;
      const we = wd >= 5 ? 1 : 0;
      wk[we][k] += v; wkN[we][k]++;
    }
    const q = (a: number[], p: number): number => (a.length ? quantile(a, p) : NaN);
    for (const a of vals) a.sort((x, y) => x - y);
    out.day = {
      pd, stepMin: gm.n, noun: gm.noun,
      med: vals.map((a) => q(a, 0.5)), p25: vals.map((a) => q(a, 0.25)), p75: vals.map((a) => q(a, 0.75)),
      weekday: Array.from(wk[0], (s, k) => (wkN[0][k] ? s / wkN[0][k] : NaN)),
      weekend: Array.from(wk[1], (s, k) => (wkN[1][k] ? s / wkN[1][k] : NaN)),
      cells: Array.from(cell, (s, k) => (cellN[k] ? s / cellN[k] : NaN)),
      days: vals.reduce((m, a) => Math.max(m, a.length), 0), pos: S.nonNeg,
    };
  }
  const daily = tooFine(T, "day") ? null : aggregate(T, cfg, "day");
  if (daily) {
    const S = daily, sum = new Float64Array(7), n = new Float64Array(7);
    for (let i = 0; i < S.n; i++) if (ok(S, i)) { const wd = weekdayAt(T, S.t[i]); sum[wd] += S.y[i]; n[wd]++; }
    out.week = { mean: Array.from(sum, (s, k) => (n[k] ? s / n[k] : NaN)), n: Array.from(n), pos: S.nonNeg };
  }
  // By month: the average day in each month when there are days (a 31-day month must
  // not beat February just by being longer), else the monthly values themselves.
  if (!tooFine(T, "month") && (T.end - T.start) / DAY >= 330) {
    const S = daily ?? aggregate(T, cfg, "month"), sum = new Float64Array(12), n = new Float64Array(12);
    const yrs = Array.from({ length: 12 }, () => new Set<number>());
    for (let i = 0; i < S.n; i++) if (ok(S, i)) { const dt = new Date(S.t[i]), mo = dt.getUTCMonth(); sum[mo] += S.y[i]; n[mo]++; yrs[mo].add(dt.getUTCFullYear()); }
    if (n.filter((c) => c).length >= 10) out.year = { mean: Array.from(sum, (s, k) => (n[k] ? s / n[k] : NaN)), years: yrs.map((y) => y.size), perDay: daily !== null, pos: S.nonNeg, index: seasonalIndex(S, ok) };
  }
  return out;
}
