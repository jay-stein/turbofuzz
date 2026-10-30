/**
 * Time Series page, layer 0: the time base and the grains.
 *
 * Rows sit in slots: a day for daily data, down to a minute for finer data, chosen
 * from the spacing of the dates alone. Every grain (5-minute up to yearly) buckets
 * slots, so nothing downstream knows what any column means. Ported from
 * prototypes/time-series/time-series-workbench.html.
 */

export const DAY = 86_400_000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;

export type GrainId = "min5" | "min15" | "min30" | "hour" | "day" | "week" | "week2" | "week4" | "month" | "quarter" | "year";
export type GrainUnit = "min" | "day" | "week" | "month";

export interface Grain {
  id: GrainId;
  unit: GrainUnit;
  /** Minutes per period for "min", days for "day", weeks for "week", months for "month". */
  n: number;
  /** Length in days (approximate for months), compared with the data's spacing. */
  days: number;
  adj: string;
  noun: string;
  nouns: string;
  perYear: number;
  /** Periods per day, for grains finer than a day. */
  perDay?: number;
  /** Default forecast length, in periods. */
  horizon: number;
  /** Shortcut forecast lengths: label and periods. */
  hPresets: readonly (readonly [string, number])[];
  /** Calendar seasons to try, preferred first. */
  periods: readonly number[];
  /**
   * Season lengths for decomposition when the calendar's is not a whole number of
   * periods: a year is 365.25 days and 52.18 weeks (fpp3). Models keep `periods`.
   */
  decPeriods?: readonly number[];
  seasons: Readonly<Record<number, string>>;
  smooth: number;
  smoothMax: number;
  /** Periods back for "same time last year / week". */
  ly: number;
  /** Periods that make a readable context window around a point. */
  ctx: number;
  /** Window for driver step and level checks; derived from perYear when absent. */
  evWin?: number;
  lyText: string;
  lyShort: string;
  lyAgo: string;
  /** Range shortcuts for the chart, in days. */
  presets: readonly (readonly [string, number])[];
}

const YEARLY = {
  lyText: "Same period last year",
  lyShort: "Last year",
  lyAgo: "a year earlier",
  presets: [["3M", 91], ["6M", 182], ["1Y", 365], ["2Y", 730]] as const,
};

/**
 * A grain finer than a day. Seasons are the week (first, it holds the day) and the day;
 * views and windows are sized in days, since a year of 5-minute periods is unreadable.
 */
function minuteGrain(id: GrainId, n: number, adj: string, noun: string, nouns: string): Grain {
  const pd = 1440 / n;
  return {
    id, unit: "min", n, days: n / 1440, adj, noun, nouns, perYear: 365.25 * pd, perDay: pd,
    horizon: Math.min(2 * pd, 192),
    hPresets: [["1 day", pd], ["1 week", 7 * pd], ["1 month", 30 * pd], ["3 months", 91 * pd], ["6 months", 182 * pd], ["1 year", 365 * pd]],
    periods: [7 * pd, pd], seasons: { [7 * pd]: "weekly", [pd]: "daily" },
    smooth: pd, smoothMax: 7 * pd, ly: 7 * pd, ctx: 14 * pd, evWin: 2 * pd,
    lyText: "Same time last week", lyShort: "Last week", lyAgo: "a week earlier",
    presets: [["1D", 1], ["1W", 7], ["1M", 30], ["3M", 91]],
  };
}

export const GRAINS: Readonly<Record<GrainId, Grain>> = {
  min5: minuteGrain("min5", 5, "5-minute", "5-minute period", "5-minute periods"),
  min15: minuteGrain("min15", 15, "15-minute", "15-minute period", "15-minute periods"),
  min30: minuteGrain("min30", 30, "30-minute", "half-hour", "half-hours"),
  hour: minuteGrain("hour", 60, "Hourly", "hour", "hours"),
  day: {
    id: "day", unit: "day", n: 1, days: 1, adj: "Daily", noun: "day", nouns: "days", perYear: 365.25, horizon: 42,
    hPresets: [["1 month", 30], ["3 months", 91], ["6 months", 182], ["1 year", 365], ["2 years", 730]],
    periods: [7, 365], decPeriods: [7, 365.25], seasons: { 7: "weekly", 365: "yearly", 365.25: "yearly" }, smooth: 7, smoothMax: 60, ly: 364, ctx: 365.25, ...YEARLY,
  },
  week: {
    id: "week", unit: "week", n: 1, days: 7, adj: "Weekly", noun: "week", nouns: "weeks", perYear: 365.25 / 7, horizon: 26,
    hPresets: [["3 months", 13], ["6 months", 26], ["1 year", 52], ["2 years", 104], ["5 years", 261]],
    periods: [52], decPeriods: [365.25 / 7], seasons: { 52: "yearly", [365.25 / 7]: "yearly" }, smooth: 4, smoothMax: 52, ly: 52, ctx: 365.25 / 7, ...YEARLY,
  },
  week2: {
    id: "week2", unit: "week", n: 2, days: 14, adj: "2-weekly", noun: "2-week period", nouns: "2-week periods", perYear: 365.25 / 14, horizon: 13,
    hPresets: [["6 months", 13], ["1 year", 26], ["2 years", 52], ["5 years", 130]],
    periods: [26], seasons: { 26: "yearly" }, smooth: 3, smoothMax: 26, ly: 26, ctx: 365.25 / 14, ...YEARLY,
  },
  week4: {
    id: "week4", unit: "week", n: 4, days: 28, adj: "4-weekly", noun: "4-week period", nouns: "4-week periods", perYear: 365.25 / 28, horizon: 13,
    hPresets: [["6 months", 7], ["1 year", 13], ["2 years", 26], ["5 years", 65]],
    periods: [13], seasons: { 13: "yearly" }, smooth: 3, smoothMax: 13, ly: 13, ctx: 365.25 / 28, ...YEARLY,
  },
  month: {
    id: "month", unit: "month", n: 1, days: 30.44, adj: "Monthly", noun: "month", nouns: "months", perYear: 12, horizon: 12,
    hPresets: [["6 months", 6], ["1 year", 12], ["2 years", 24], ["5 years", 60], ["10 years", 120]],
    periods: [12], seasons: { 12: "yearly" }, smooth: 3, smoothMax: 24, ly: 12, ctx: 12, ...YEARLY,
  },
  quarter: {
    id: "quarter", unit: "month", n: 3, days: 91.3, adj: "Quarterly", noun: "quarter", nouns: "quarters", perYear: 4, horizon: 4,
    hPresets: [["1 year", 4], ["2 years", 8], ["5 years", 20], ["10 years", 40]],
    periods: [4], seasons: { 4: "yearly" }, smooth: 2, smoothMax: 8, ly: 4, ctx: 4, ...YEARLY,
  },
  year: {
    id: "year", unit: "month", n: 12, days: 365.25, adj: "Yearly", noun: "year", nouns: "years", perYear: 1, horizon: 5,
    hPresets: [["5 years", 5], ["10 years", 10], ["20 years", 20]],
    periods: [], seasons: {}, smooth: 3, smoothMax: 20, ly: 1, ctx: 1, ...YEARLY,
  },
};

export const GRAIN_ORDER: readonly GrainId[] = ["min5", "min15", "min30", "hour", "day", "week", "week2", "week4", "month", "quarter", "year"];

/** Rows as the worker hands them over: one entry per row with a readable date. */
export interface TsInput {
  /** UTC milliseconds per row. */
  times: Float64Array;
  /** Numeric columns by name, aligned with times. */
  cols: Record<string, Float64Array>;
  /** 0/1 columns among cols (drivers that switch on and off). */
  flags: Record<string, boolean>;
  /** Group labels; ["all"] when there is no group column. */
  groups: string[];
  rowGroup: Uint16Array;
  groupCol: string | null;
  dateCol: string;
  /** Rows left out because their date did not read. */
  dropped: number;
  /** Columns are a Pivot View's measures: never read as time counters or date parts. */
  aggregated?: boolean;
  /** The source knows its first or last period is incomplete (a view period cut by the data's edge). */
  partialEdge?: { first: boolean; last: boolean };
}

/** The series table: rows in slots, plus what the dates alone say about them. */
export interface TsTable extends TsInput {
  start: number;
  slot: number;
  /** Slots per day. */
  spd: number;
  nslots: number;
  /** Start of the last slot. */
  end: number;
  m0: number;
  /** Monday-0 weekday of the start. */
  woff: number;
  /** Weekday of each slot. */
  swd: Uint8Array;
  rowSlot: Int32Array;
  /** Typical spacing in days (1/24 is hourly). */
  cadence: number;
  cadSlots: number;
  subDay: boolean;
  /** Weekdays that (almost) never have rows: not gaps. */
  structural: Uint8Array;
  /** Hours of the day (UTC clock, 0-23) that (almost) never have rows: not gaps. */
  closedHours: Uint8Array;
  eventLike: boolean;
  /** Numeric columns that only count time or name a date part. */
  timeLike: Record<string, "time" | "part">;
  /**
   * Numeric columns that repeat one value on every group's row at the same moment
   * (a total copied onto each row): a sum across groups counts it once per group.
   */
  repeated: Record<string, true>;
  /** Slots with at least one row. */
  observed: number[];
  defMeasure: string | null;
  bucketCache: Map<GrainId, Int32Array>;
}

const SLOT_LADDER = [1, 5, 15, 30, 60].map((m) => m * MINUTE);

/**
 * The base slot, from the spacing of the distinct times: a day unless rows come more
 * than once a day, else the coarsest step on the minute ladder the typical gap fills
 * (jittered 30-minute readings get 30 minutes). Very long fine tables get a coarser slot.
 */
export function pickSlot(times: Float64Array, start: number, tMax: number): number {
  const ts = Float64Array.from(times).sort();
  const gaps: number[] = [];
  let clock = false;
  for (let k = 0; k < ts.length; k++) {
    if (ts[k] % DAY !== 0) clock = true;
    if (k && ts[k] > ts[k - 1]) gaps.push(ts[k] - ts[k - 1]);
  }
  if (!clock || !gaps.length) return DAY;
  gaps.sort((a, b) => a - b);
  const med = gaps[gaps.length >> 1];
  if (med >= 0.75 * DAY) return DAY;
  let k = 0;
  while (k + 1 < SLOT_LADDER.length && SLOT_LADDER[k + 1] <= med * 1.1) k++;
  while (k < SLOT_LADDER.length && (tMax - start) / SLOT_LADDER[k] > 1.5e6) k++;
  return SLOT_LADDER[k] ?? DAY;
}

/**
 * Shape of the table, read from the numbers only: spacing of the dates, weekdays that
 * never have rows, whether rows look like irregular events, which numeric columns are
 * just time counters or date parts. Sets the defaults for the series sentence.
 */
export function buildTable(input: TsInput): TsTable | null {
  const keep = input.times.length;
  if (keep < 3) return null;
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0; i < keep; i++) { const t = input.times[i]; if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
  const d0 = new Date(tMin), start = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
  const slot = pickSlot(input.times, start, tMax);
  const rowSlot = new Int32Array(keep);
  let lastSlot = 0;
  for (let i = 0; i < keep; i++) { rowSlot[i] = Math.floor((input.times[i] - start) / slot); if (rowSlot[i] > lastSlot) lastSlot = rowSlot[i]; }
  const has = new Uint8Array(lastSlot + 1);
  for (let i = 0; i < keep; i++) has[rowSlot[i]] = 1;
  const obs: number[] = [];
  for (let d = 0; d <= lastSlot; d++) if (has[d]) obs.push(d);
  const gaps: number[] = [];
  for (let k = 1; k < obs.length; k++) gaps.push(obs[k] - obs[k - 1]);
  gaps.sort((a, b) => a - b);
  const cadSlots = gaps.length ? gaps[gaps.length >> 1] : 1;
  // Spacing in days throughout (1/24 for hourly), so grains compare to it directly.
  const cadence = (cadSlots * slot) / DAY;
  const s = new Date(start);
  const woff = (s.getUTCDay() + 6) % 7;
  const spd = Math.round(DAY / slot);
  // Weekdays that (almost) never have rows are structural, not gaps.
  const structural = new Uint8Array(7);
  if (cadence <= 1.5) {
    const cnt = new Array<number>(7).fill(0);
    for (const d of obs) cnt[(Math.floor(d / spd) + woff) % 7]++;
    const mx = Math.max(...cnt);
    for (let k = 0; k < 7; k++) if (cnt[k] < 0.1 * mx) structural[k] = 1;
  }
  // Hours that (almost) never have rows, as in a table of business hours: hourly or
  // finer rows over at least a week, judged like the weekdays above.
  const closedHours = new Uint8Array(24);
  if (slot < DAY && cadence <= 1.5 / 24 && lastSlot >= 7 * spd) {
    const cnt = new Array<number>(24).fill(0);
    for (const d of obs) cnt[Math.floor(((d % spd) * slot) / HOUR)]++;
    const mx = Math.max(...cnt);
    for (let k = 0; k < 24; k++) if (cnt[k] < 0.1 * mx) closedHours[k] = 1;
    // Fewer than four open hours is not a timetable, it is sparse data.
    if (closedHours.reduce((a, b) => a + b, 0) > 20) closedHours.fill(0);
  }
  // Irregular event rows: most gaps between consecutive rows differ from each other.
  let eventLike = false;
  if (keep > 50) {
    const ts = Float64Array.from(input.times).sort();
    const distinct = new Set<number>();
    for (let k = 1; k < ts.length; k++) distinct.add(ts[k] - ts[k - 1]);
    eventLike = distinct.size / ts.length > 0.5;
  }
  // Numeric columns that only count time (a running year or index) or name a date part.
  const order = Array.from({ length: keep }, (_, i) => i).sort((a, b) => input.times[a] - input.times[b]);
  const timeLike: Record<string, "time" | "part"> = {};
  for (const [c, arr] of Object.entries(input.aggregated ? {} : input.cols)) {
    let up = 0, steps = 0, ints = true;
    const distinct = new Set<number>();
    for (let k = 0; k < keep; k++) { const v = arr[order[k]]; if (v === v) { distinct.add(v); if (v !== Math.round(v)) ints = false; } }
    for (let k = 1; k < keep; k++) { const a = arr[order[k - 1]], b = arr[order[k]]; if (a === a && b === b) { steps++; if (b >= a) up++; } }
    if (distinct.size > 10 && steps && up / steps >= 0.99) timeLike[c] = "time";
    else if (ints && distinct.size <= 31 && distinct.size < keep / 4 && !input.flags[c]) timeLike[c] = "part";
  }
  // Columns that are the same on every group's row at a moment, checked over the
  // moments that have rows from two or more groups.
  const repeated: Record<string, true> = {};
  if (input.groups.length > 1) {
    const runs: [number, number][] = [];
    for (let a = 0; a < keep; ) {
      let b = a + 1;
      while (b < keep && input.times[order[b]] === input.times[order[a]]) b++;
      if (b - a > 1) {
        const g0 = input.rowGroup[order[a]];
        for (let k = a + 1; k < b; k++) if (input.rowGroup[order[k]] !== g0) { runs.push([a, b]); break; }
      }
      a = b;
    }
    if (runs.length >= 5) {
      for (const [c, arr] of Object.entries(input.cols)) {
        let same = 0, seen = 0;
        for (const [a, b] of runs) {
          const v0 = arr[order[a]];
          if (!(v0 === v0)) continue;
          seen++;
          let eq = true;
          for (let k = a + 1; k < b && eq; k++) if (arr[order[k]] !== v0) eq = false;
          if (eq) same++;
        }
        if (seen >= 5 && same >= 0.95 * seen) repeated[c] = true;
      }
    }
  }
  const measures = Object.keys(input.cols);
  const plain = (c: string): boolean => !timeLike[c] && !input.flags[c];
  const defMeasure = measures.find((c) => plain(c) && !repeated[c]) ?? measures.find(plain) ?? null;
  const nslots = lastSlot + Math.max(1, Math.round(cadSlots));
  const swd = new Uint8Array(nslots);
  for (let d = 0; d < nslots; d++) swd[d] = (Math.floor(d / spd) + woff) % 7;
  return {
    ...input, start, slot, spd, nslots, end: start + (nslots - 1) * slot, m0: s.getUTCFullYear() * 12 + s.getUTCMonth(), woff, swd,
    rowSlot, cadence, cadSlots, subDay: slot < DAY, structural, closedHours, eventLike: eventLike || defMeasure === null, timeLike, repeated,
    observed: obs, defMeasure: defMeasure ?? measures[0] ?? null, bucketCache: new Map(),
  };
}

/** A grain finer than the data's own spacing would be mostly empty periods; one finer than the slot cannot be drawn at all. */
export function tooFine(t: TsTable, id: GrainId): boolean {
  const g = GRAINS[id];
  return g.days < t.cadence * 0.97 || (g.unit === "min" && (g.n * MINUTE) % t.slot !== 0);
}

export function dayOf(t: TsTable, d: number): number { return Math.floor(d / t.spd); }
function monthIndex(t: TsTable, d: number): number { const dt = new Date(t.start + dayOf(t, d) * DAY); return dt.getUTCFullYear() * 12 + dt.getUTCMonth(); }
export function bucketOfSlot(t: TsTable, g: Grain, d: number): number {
  if (g.unit === "min") return Math.floor((d * t.slot) / (g.n * MINUTE));
  if (g.unit === "day") return Math.floor(dayOf(t, d) / g.n);
  if (g.unit === "week") return Math.floor((dayOf(t, d) + t.woff) / (7 * g.n));
  return Math.floor(monthIndex(t, d) / g.n) - Math.floor(t.m0 / g.n);
}
/** What placing periods on the calendar needs: the start, its weekday and its month. */
export type TimeBase = Pick<TsTable, "start" | "woff" | "m0">;
/** Whether rows are expected at this instant: not a weekday or an hour that never has rows. */
export function openAt(t: TimeBase & { structural: ArrayLike<number>; closedHours: ArrayLike<number> }, ms: number): boolean {
  if (t.structural[weekdayAt(t, ms)]) return false;
  const h = Math.floor((((ms - t.start) % DAY) + DAY) % DAY / HOUR);
  return !t.closedHours[h];
}
/** Whether rows are expected in slot d (see openAt). */
export function slotOpen(t: TsTable, d: number): boolean {
  return !t.structural[t.swd[d]] && !t.closedHours[Math.floor(((d % t.spd) * t.slot) / HOUR)];
}
/** Monday-0 weekday of any instant, from the table start (no Date per call). */
export function weekdayAt(t: TimeBase, ms: number): number { return (((Math.floor((ms - t.start) / DAY) + t.woff) % 7) + 7) % 7; }
export function bucketStart(t: TimeBase, g: Grain, b: number): number {
  if (g.unit === "min") return t.start + b * g.n * MINUTE;
  if (g.unit === "day") return t.start + b * g.n * DAY;
  if (g.unit === "week") return t.start + (b * 7 * g.n - t.woff) * DAY;
  const mi = (Math.floor(t.m0 / g.n) + b) * g.n;
  return Date.UTC(Math.floor(mi / 12), mi % 12, 1);
}
/** Bucket of every slot, cached per grain. */
export function slotBuckets(t: TsTable, g: Grain): Int32Array {
  let arr = t.bucketCache.get(g.id);
  if (!arr) {
    arr = new Int32Array(t.nslots);
    for (let d = 0; d < t.nslots; d++) arr[d] = bucketOfSlot(t, g, d);
    t.bucketCache.set(g.id, arr);
  }
  return arr;
}
export function eventWindowLen(g: Grain): number { return g.evWin || Math.max(3, Math.round(g.perYear / 6.5)); }

/** Plain words for the data's native spacing (in days; 1/24 is hourly). */
export function cadenceNoun(c: number): string {
  if (c < 0.75) { const m = Math.round(c * 1440); return m === 60 ? "hours" : m === 30 ? "half-hours" : m % 60 === 0 ? `${m / 60}-hour slots` : `${m}-minute slots`; }
  return c <= 1.5 ? "days" : c <= 10 ? "weeks" : c <= 40 ? "months" : c <= 120 ? "quarters" : c <= 400 ? "years" : "observations";
}
/** "day", "3 days", "week", "2 weeks", "month", "quarter", "6 months", "year", "5 years". */
export function cadenceText(c: number): string {
  if (c < 0.75) {
    const m = Math.round(c * 1440);
    return m === 1 ? "minute" : m < 60 ? `${m} minutes` : m === 60 ? "hour" : m % 60 ? `${(m / 60).toFixed(1)} hours` : `${m / 60} hours`;
  }
  if (c <= 1.5) return "day";
  if (c < 6) return `${Math.round(c)} days`;
  if (c <= 10) return "week";
  if (c < 26) return `${Math.round(c / 7)} weeks`;
  if (c <= 40) return "month";
  if (c >= 80 && c <= 100) return "quarter";
  if (c < 330) return `${Math.round(c / 30.44)} months`;
  if (c <= 400) return "year";
  return `${Math.round(c / 365.25)} years`;
}

/** The finest grain that keeps the default view quick: about 4,000 periods at most. */
export function defaultGrain(t: TsTable): GrainId {
  for (const id of GRAIN_ORDER) {
    if (tooFine(t, id)) continue;
    const buckets = (t.nslots * t.slot) / DAY / GRAINS[id].days;
    if (buckets > 4000) continue;
    if (t.eventLike && t.times.length / buckets < 3) continue;
    return id;
  }
  return "year";
}
