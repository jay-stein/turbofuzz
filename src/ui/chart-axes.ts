/**
 * Axes the person sets: the range each axis shows, where its ticks go, and how a date axis
 * labels them. Anything left unset stays automatic.
 *
 * The drawing code asks this module, so every chart type reads the same settings:
 * - Y: `axisLo` / `valueTop` / `valueY` for value axes that start at zero (bars, lines over
 *   time, histograms), and `refAxisRange` in chart-ref-lines.ts for axes that need not.
 * - X: `cropToXRange` narrows a chart of periods to the dates asked for; numeric X axes
 *   (scatter, a line over numbers) go through `refAxisRange` too.
 * - Ticks: `axisTicks` (numbers, every N) and `dateTicks` (every N days … years, and a label format).
 */
import type { ChartCard } from "./chart-card.js";
import { calendarTicks, niceTicks, type CalendarTick } from "./chart-utils.js";

export type DateTickUnit = "day" | "week" | "month" | "quarter" | "year";
export type DateTickFormat = "auto" | "year" | "monthYear" | "isoMonth" | "quarter" | "isoDate" | "dayMonth";

export interface ChartAxes {
  /** X range: numbers, or for a date axis ms since 1970 (UTC). */
  xMin?: number | null;
  xMax?: number | null;
  yMin?: number | null;
  yMax?: number | null;
  /** A tick every this much on a numeric axis. */
  xStep?: number | null;
  yStep?: number | null;
  /** A date axis: a tick every N of these. */
  xEvery?: { unit: DateTickUnit; n: number } | null;
  /** A date axis: how each tick reads. */
  xFormat?: DateTickFormat;
}

export const DATE_FORMAT_LABELS: Record<DateTickFormat, string> = {
  auto: "Auto",
  year: "2024",
  quarter: "Q1 2024",
  monthYear: "Jan 2024",
  isoMonth: "2024-01",
  dayMonth: "5 Jan",
  isoDate: "2024-01-05",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function axesOf(card: ChartCard): ChartAxes {
  return card.config.axes ?? {};
}

/** Whether the person has set anything on the axes. */
export function axesSet(axes: ChartAxes | undefined): boolean {
  if (axes === undefined) return false;
  return (
    [axes.xMin, axes.xMax, axes.yMin, axes.yMax, axes.xStep, axes.yStep].some((value) => finite(value) !== null) ||
    (axes.xEvery ?? null) !== null ||
    (axes.xFormat ?? "auto") !== "auto"
  );
}

/** The X range the person set, each end null when automatic (or when the two ends cross). */
export function userXRange(card: ChartCard): { min: number | null; max: number | null } {
  const axes = axesOf(card);
  const min = finite(axes.xMin);
  const max = finite(axes.xMax);
  if (min !== null && max !== null && !(max > min)) return { min: null, max: null };
  return { min, max };
}

/** The bottom of a value axis that otherwise starts at zero: the person's Y min, or 0. */
export function axisLo(card: ChartCard): number {
  card.axisYUsed = true;
  const lo = finite(axesOf(card).yMin);
  return lo ?? 0;
}

/** The top of a value axis: the person's Y max when set above the bottom, else the chart's own. */
export function valueTop(card: ChartCard, natural: number, lo = axisLo(card)): number {
  const hi = finite(axesOf(card).yMax);
  if (hi !== null && hi > lo) return hi;
  return Math.max(natural, lo + 1e-9);
}

/** A value's height on a value axis running from `lo` at the bottom of the plot to `top`. */
export function valueY(frame: { top: number; plotH: number }, value: number, lo: number, top: number): number {
  return frame.top + frame.plotH - ((value - lo) / (top - lo)) * frame.plotH;
}

/** Ticks every `step` from min to max, or null when the step is unset or would draw too many. */
export function stepTicks(min: number, max: number, step: number | null, cap = 60): number[] | null {
  if (step === null || !(step > 0) || !(max >= min)) return null;
  if ((max - min) / step > cap) return null;
  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let k = 0; first + k * step <= max + step * 1e-9; k++) ticks.push(Number((first + k * step).toPrecision(12)));
  return ticks;
}

/** The X tick step the person set, or null. */
export function userXStep(card: ChartCard): number | null {
  return finite(axesOf(card).xStep);
}

/** Ticks on a numeric axis: every N when the person set a step, otherwise round numbers. */
export function axisTicks(card: ChartCard, axis: "x" | "y", min: number, max: number, target = 5): number[] {
  const axes = axesOf(card);
  const step = finite(axis === "x" ? axes.xStep : axes.yStep);
  return stepTicks(min, max, step) ?? niceTicks(min, max, target);
}

function unitKey(t: number, unit: DateTickUnit): number {
  const d = new Date(t);
  switch (unit) {
    case "year":
      return d.getUTCFullYear();
    case "quarter":
      return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
    case "month":
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    case "week":
      // Weeks start on Monday, as the buckets do.
      return Math.floor((t - 4 * DAY) / (7 * DAY));
    default:
      return Math.floor(t / DAY);
  }
}

const UNIT_FORMAT: Record<DateTickUnit, Exclude<DateTickFormat, "auto">> = { year: "year", quarter: "quarter", month: "monthYear", week: "dayMonth", day: "dayMonth" };
const UNIT_ORDER: readonly DateTickUnit[] = ["day", "week", "month", "quarter", "year"];
const UNIT_DAYS: Record<DateTickUnit, number> = { day: 1, week: 7, month: 30.44, quarter: 91.31, year: 365.25 };

/** A tick mark hanging from the bottom of the plot at x: longer where it carries a label. */
export function drawTickMark(
  ctx: CanvasRenderingContext2D,
  frame: { top: number; plotH: number; dim: string },
  x: number,
  ui: number,
  labelled: boolean,
): void {
  const y = frame.top + frame.plotH;
  ctx.save();
  ctx.strokeStyle = frame.dim;
  ctx.globalAlpha = labelled ? 0.8 : 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, y);
  ctx.lineTo(Math.round(x) + 0.5, y + (labelled ? 5 : 3) * ui);
  ctx.stroke();
  ctx.restore();
}

/** "every 10 weeks", "every quarter". */
export function everyUnit(n: number, unit: DateTickUnit): string {
  return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
}

/** A tick on a date axis; `mark` draws a small mark on the axis, and a blank label is a mark alone. */
export interface DateTick extends CalendarTick {
  mark?: boolean;
}

/** The start (UTC) of the day, Monday week, month, quarter or year holding `t`. */
export function unitStart(t: number, unit: DateTickUnit): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case "year":
      return Date.UTC(y, 0, 1);
    case "quarter":
      return Date.UTC(y, m - (m % 3), 1);
    case "month":
      return Date.UTC(y, m, 1);
    case "week": {
      const day = Math.floor(t / DAY) * DAY;
      return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;
    }
    default:
      return Math.floor(t / DAY) * DAY;
  }
}

/** The next unit start after the unit start `t`. */
function nextUnit(t: number, unit: DateTickUnit): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case "year":
      return Date.UTC(y + 1, 0, 1);
    case "quarter":
      return Date.UTC(y, m + 3, 1);
    case "month":
      return Date.UTC(y, m + 1, 1);
    case "week":
      return t + 7 * DAY;
    default:
      return t + DAY;
  }
}

/**
 * Whether every N of a unit lines up with the calendar: years always; months 1, 2, 3, 4, 6, or a
 * whole number of years; quarters 1, 2, or a whole number of years.
 */
function calendarAligned(unit: DateTickUnit, n: number): boolean {
  if (unit === "year") return true;
  if (unit === "month") return 12 % n === 0 || n % 12 === 0;
  if (unit === "quarter") return 4 % n === 0 || n % 4 === 0;
  return n === 1;
}

/**
 * Every Nth unit start from `min` to `max`: exact calendar dates (the 1st of a month, a Monday,
 * 1 January). Counted along the calendar where N fits it (years divisible by N, months from
 * January), otherwise from the first one on the axis, so the gaps are always exactly N units.
 */
export function dateBoundaries(min: number, max: number, unit: DateTickUnit, n: number, limit = 40_000): number[] {
  const out: number[] = [];
  let t = unitStart(min, unit);
  if (t < min) t = nextUnit(t, unit);
  let base: number | null = calendarAligned(unit, n) ? 0 : null;
  for (let i = 0; t <= max && i < limit; i++, t = nextUnit(t, unit)) {
    const key = unitKey(t, unit);
    base ??= key;
    if ((((key - base) % n) + n) % n === 0) out.push(t);
  }
  return out;
}

/** The period of a run of period starts (their usual gap), or null when finer than a day. */
export function periodGrain(times: readonly number[]): DateTickUnit | null {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!;
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap / DAY);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)]!;
  if (gap < 0.9) return null;
  if (gap < 3) return "day";
  if (gap < 20) return "week";
  if (gap < 60) return "month";
  if (gap < 200) return "quarter";
  return "year";
}

/**
 * The ticks for "every N units", from `first` to `end`: a mark at every one, and a label on as
 * many as fit (`room`), on a calendar-friendly multiple of N (every year, not every 3 quarters).
 * A unit finer than the chart's periods becomes the nearest whole number of periods (10 weeks on
 * a chart by month → every 2 months). Marks closer than a few pixels apart thin too. The Axes
 * settings say whenever what is drawn differs from what was asked.
 */
function userTicks(
  card: ChartCard,
  asked: { unit: DateTickUnit; n: number },
  grain: DateTickUnit | null,
  first: number,
  end: number,
  room: number,
): { time: number; label: string }[] {
  let unit = asked.unit;
  let n = Math.max(1, Math.floor(asked.n));
  const notes: string[] = [];
  if (grain !== null && UNIT_ORDER.indexOf(unit) < UNIT_ORDER.indexOf(grain)) {
    const periods = Math.max(1, Math.round((n * UNIT_DAYS[unit]) / UNIT_DAYS[grain]));
    notes.push(`This chart is by ${grain}, so a tick falls on a ${grain}: ${everyUnit(n, unit)} is drawn as ${everyUnit(periods, grain)}.`);
    unit = grain;
    n = periods;
  }
  // The smallest multiple of n, at least `k`, that keeps to the calendar when n does.
  const multiple = (k: number): number => {
    if (k <= 1) return 1;
    if (!calendarAligned(unit, n)) return k;
    for (let m = k; m < k * 24; m++) if (calendarAligned(unit, n * m)) return m;
    return k;
  };
  let marks = dateBoundaries(first, end, unit, n);
  // Marks under about 4 px apart are a smear: thin them as well.
  const markRoom = room * 12;
  if (marks.length > markRoom) {
    const wider = n * multiple(Math.ceil(marks.length / markRoom));
    notes.push(`${everyUnit(n, unit)[0]!.toUpperCase()}${everyUnit(n, unit).slice(1)} is too dense to mark: marks ${everyUnit(wider, unit)}.`);
    n = wider;
    marks = dateBoundaries(first, end, unit, n);
  }
  const format = labelFormat(card, unit);
  let labelled = new Set(marks);
  if (marks.length > room) {
    const every = n * multiple(Math.ceil(marks.length / room));
    labelled = new Set(dateBoundaries(first, end, unit, every));
    notes.push(`A tick ${everyUnit(n, unit)}; labelled ${everyUnit(every, unit)} so the labels do not overlap.`);
  }
  card.axisXTickNote = notes.join(" ");
  return [...new Set([...marks, ...labelled])]
    .sort((a, b) => a - b)
    .map((time) => ({ time, label: labelled.has(time) ? formatDateTick(time, format) : "" }));
}

/** The label format for ticks every `unit`: the person's, or one that suits the unit. */
function labelFormat(card: ChartCard, unit: DateTickUnit): Exclude<DateTickFormat, "auto"> {
  const format = axesOf(card).xFormat ?? "auto";
  return format === "auto" ? UNIT_FORMAT[unit] : format;
}

/**
 * Ticks the person set on a continuous date axis (a line over raw dates): exact calendar dates
 * from `min` to `max`, as times with labels. Null when the interval is automatic.
 */
export function userDateTicks(card: ChartCard, min: number, max: number, maxTicks: number): { time: number; label: string }[] | null {
  card.axisXKind = "date";
  const asked = axesOf(card).xEvery ?? null;
  if (asked === null) return null;
  return userTicks(card, asked, null, min, max, Math.max(2, Math.floor(maxTicks * 1.5)));
}

/** One date as a tick label in the given format. */
export function formatDateTick(t: number, format: Exclude<DateTickFormat, "auto">): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const two = (n: number): string => String(n).padStart(2, "0");
  switch (format) {
    case "year":
      return String(y);
    case "quarter":
      return `Q${Math.floor(m / 3) + 1} ${y}`;
    case "monthYear":
      return `${MONTHS[m]} ${y}`;
    case "isoMonth":
      return `${y}-${two(m + 1)}`;
    case "dayMonth":
      return `${d.getUTCDate()} ${MONTHS[m]}`;
    default:
      return `${y}-${two(m + 1)}-${two(d.getUTCDate())}`;
  }
}

/**
 * Ticks on a date axis of periods (`times` are period starts, one per slot). Automatic unless the
 * person chose an interval or a label format. A tick set by the person sits at every Nth exact
 * calendar date (see `dateBoundaries`), on the period holding it; a unit finer than the periods,
 * or a step too dense to label, is widened and the Axes settings say so (`axisXTickNote`).
 */
export function dateTicks(card: ChartCard, times: readonly number[], maxTicks: number): DateTick[] {
  card.axisXKind = "date";
  const axes = axesOf(card);
  const every = axes.xEvery ?? null;
  const format = axes.xFormat ?? "auto";
  const finiteTimes = times.filter((t) => Number.isFinite(t));
  const grain = periodGrain(finiteTimes);
  card.axisXGrain = grain;
  if (every === null || finiteTimes.length === 0) {
    const ticks = calendarTicks(times, maxTicks);
    if (format === "auto") return ticks;
    const chosen: Exclude<DateTickFormat, "auto"> = format;
    return ticks.map((tick) => ({ index: tick.index, label: formatDateTick(times[tick.index]!, chosen) }));
  }
  const first = finiteTimes.reduce((a, b) => Math.min(a, b));
  // The last period runs to its own end, so a boundary inside it still gets a tick.
  const end = finiteTimes.reduce((a, b) => Math.max(a, b)) +(grain === null ? DAY : UNIT_DAYS[grain] * DAY) - 1;
  const inOrder = finiteTimes.length === times.length && finiteTimes.every((t, i) => i === 0 || t >= finiteTimes[i - 1]!);
  const slotOf = (t: number): number => {
    // The period holding t: the latest start at or before it.
    if (!inOrder) {
      let found = -1;
      times.forEach((at, i) => {
        if (Number.isFinite(at) && at <= t && (found < 0 || at > times[found]!)) found = i;
      });
      return found;
    }
    let lo = 0;
    let hi = times.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = times[mid]!;
      if (Number.isFinite(at) && at <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  const ticks: DateTick[] = [];
  const at = new Map<number, DateTick>();
  for (const { time, label } of userTicks(card, every, grain, first, end, Math.max(2, Math.floor(maxTicks * 1.5)))) {
    const index = slotOf(time);
    if (index < 0) continue;
    const existing = at.get(index);
    if (existing !== undefined) {
      if (existing.label === "") existing.label = label;
      continue;
    }
    const tick: DateTick = { index, label, mark: true };
    at.set(index, tick);
    ticks.push(tick);
  }
  return ticks;
}

/** Rows of a grouped result, kept in their order: the ones at `keep`. */
interface Grouped {
  labels: string[];
  dimensions: string[][];
  dimensionTimes: Float64Array[];
  dimensionIsTime: boolean[];
  measures: Float64Array[];
  partials: boolean[] | null;
  groupCount: number;
}

/**
 * A chart of periods narrowed to the X range asked for: the periods from the one holding X min
 * to the one holding X max. A view of the result, not a filter: a running total keeps counting
 * from the start of the data.
 */
export function cropToXRange<T extends Grouped>(card: ChartCard, result: T): T {
  const axes = axesOf(card);
  const lo = finite(axes.xMin);
  const hi = finite(axes.xMax);
  const times = result.dimensionTimes[0];
  if ((lo === null && hi === null) || result.dimensionIsTime[0] !== true || times === undefined) return result;
  // The period holding X min starts at or before it: the latest period start not after it.
  let from = -Infinity;
  if (lo !== null) {
    let holding = -Infinity;
    for (const t of times) if (Number.isFinite(t) && t <= lo && t > holding) holding = t;
    from = holding === -Infinity ? lo : holding;
  }
  const keep: number[] = [];
  for (let i = 0; i < result.groupCount; i++) {
    const t = times[i] ?? Number.NaN;
    if (!Number.isFinite(t) || (t >= from && (hi === null || t <= hi))) keep.push(i);
  }
  if (keep.length === result.groupCount) return result;
  return {
    ...result,
    labels: keep.map((i) => result.labels[i] ?? ""),
    dimensions: result.dimensions.map((values) => keep.map((i) => values[i] ?? "")),
    dimensionTimes: result.dimensionTimes.map((values) => Float64Array.from(keep, (i) => values[i] ?? Number.NaN)),
    measures: result.measures.map((values) => Float64Array.from(keep, (i) => values[i] ?? Number.NaN)),
    partials: result.partials === null ? null : keep.map((i) => result.partials![i] === true),
    groupCount: keep.length,
  };
}

/** Clips drawing to the plot, so marks past a range the person set stop at its edge. */
export function clipToPlot(ctx: CanvasRenderingContext2D, frame: { left: number; top: number; plotW: number; plotH: number }): void {
  ctx.beginPath();
  ctx.rect(frame.left, frame.top - 1, frame.plotW, frame.plotH + 2);
  ctx.clip();
}
