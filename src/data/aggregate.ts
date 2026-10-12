import type { ColumnData } from "./column.js";

/** Dimension transform: raw value, a time bucket, a date part or a numeric bin. */
export type TimeGrain = "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
export type DatePart = "dow" | "hour" | "month" | "dom" | "week";

export type DimensionSpec =
  | { column: number; by: "value" }
  | { column: number; by: { time: TimeGrain; weekStart?: 0 | 1 } }
  | { column: number; by: { datePart: DatePart } };

/** Basic aggregates plus `pN` percentiles and `distinct` value counts. */
export type Aggregate =
  | "count"
  | "distinct"
  | "sum"
  | "mean"
  | "min"
  | "max"
  | "median"
  | "stddev"
  | "first"
  | "last"
  | "mode"
  | `p${number}`;

export type PostOp =
  | { op: "rolling"; window: number }
  | { op: "cumulative" }
  | { op: "diff" }
  | { op: "pctChange" }
  | { op: "pctTotal" }
  | { op: "rank" };

export interface MeasureSpec {
  /** null = COUNT(*) over rows; otherwise the column to aggregate. */
  column: number | null;
  agg: Aggregate;
  post?: PostOp[];
}

export interface ViewDef {
  id: string;
  name: string;
  dimensions: DimensionSpec[];
  measures: MeasureSpec[];
  /** Empty time buckets: dropped (none) or counted as zero. */
  fill: "none" | "zero";
  /** "dim0" | "dim1" | "m0" | "m1" — sort key and direction. */
  sort: { key: string; dir: "asc" | "desc" };
  limit: number;
  respectFilters: boolean;
}

export interface AggregateResult {
  labels: string[];
  /** One label array per dimension, aligned with `labels`. */
  dimensions: string[][];
  dimensionNames: string[];
  dimensionIsTime: boolean[];
  /** Bucket start in ms per time dimension (NaN elsewhere). */
  dimensionTimes: Float64Array[];
  measures: Float64Array[];
  measureNames: string[];
  /** Totals computed from rows, never from the grouped output. */
  totals: Float64Array;
  groupCount: number;
  totalGroups: number;
  truncated: boolean;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const PERCENTILE = /^p(\d+(?:\.\d+)?)$/;

/** Parses `p95` into 0.95, or null for non-percentile names. */
export function percentileOf(agg: string): number | null {
  const match = PERCENTILE.exec(agg);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value / 100 : null;
}

export function timeBucket(ms: number, grain: TimeGrain, weekStart: 0 | 1 = 1): number {
  switch (grain) {
    case "minute":
      return Math.floor(ms / MINUTE) * MINUTE;
    case "hour":
      return Math.floor(ms / HOUR) * HOUR;
    case "day":
      return Math.floor(ms / DAY) * DAY;
    case "week": {
      const day = Math.floor(ms / DAY);
      const dow = (((day + 4) % 7) + 7) % 7; // 0 = Sunday, 1 = Monday
      const diff = (dow - weekStart + 7) % 7;
      return (day - diff) * DAY;
    }
    case "month": {
      const date = new Date(ms);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    }
    case "quarter": {
      const date = new Date(ms);
      return Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1);
    }
    case "year": {
      const date = new Date(ms);
      return Date.UTC(date.getUTCFullYear(), 0, 1);
    }
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function timeLabel(ms: number, grain: TimeGrain): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1, 2);
  const day = pad(date.getUTCDate(), 2);
  const hour = pad(date.getUTCHours(), 2);
  const minute = pad(date.getUTCMinutes(), 2);
  switch (grain) {
    case "minute":
      return `${year}-${month}-${day} ${hour}:${minute}`;
    case "hour":
      return `${year}-${month}-${day} ${hour}:00`;
    case "day":
    case "week":
      return `${year}-${month}-${day}`;
    case "month":
      return `${year}-${month}`;
    case "quarter":
      return `${year} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    case "year":
      return String(year);
  }
}

/** ISO-8601 week number, used for the week-of-year date part. */
export function isoWeek(ms: number): number {
  const date = new Date(ms);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - day + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY));
}

export function datePartLabel(ms: number, part: DatePart): string {
  const date = new Date(ms);
  switch (part) {
    case "dow":
      return DOW_LABELS[(date.getUTCDay() + 6) % 7] ?? "?";
    case "hour":
      return pad(date.getUTCHours(), 2);
    case "month":
      return MONTH_LABELS[date.getUTCMonth()] ?? "?";
    case "dom":
      return pad(date.getUTCDate(), 2);
    case "week":
      return `W${pad(isoWeek(ms), 2)}`;
  }
}

interface MeasureAcc {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  m2: number;
  first: number;
  last: number;
  distinct: Set<string> | null;
  samples: number[] | null;
  modes: Map<string, number> | null;
}

function newAcc(): MeasureAcc {
  return {
    count: 0,
    sum: 0,
    min: Infinity,
    max: -Infinity,
    mean: 0,
    m2: 0,
    first: NaN,
    last: NaN,
    distinct: null,
    samples: null,
    modes: null,
  };
}

function accFor(agg: Aggregate): MeasureAcc {
  const acc = newAcc();
  if (agg === "distinct") acc.distinct = new Set();
  if (agg === "median" || percentileOf(agg) !== null) acc.samples = [];
  if (agg === "mode") acc.modes = new Map();
  return acc;
}

function accumulate(acc: MeasureAcc, agg: Aggregate, value: number): void {
  acc.count++;
  acc.sum += value;
  if (value < acc.min) acc.min = value;
  if (value > acc.max) acc.max = value;
  const delta = value - acc.mean;
  acc.mean += delta / acc.count;
  acc.m2 += delta * (value - acc.mean);
  if (Number.isNaN(acc.first)) acc.first = value;
  acc.last = value;
  if (acc.samples !== null) acc.samples.push(value);
}

function finalise(acc: MeasureAcc, agg: Aggregate): number {
  switch (agg) {
    case "count":
      return acc.count;
    case "distinct":
      return acc.distinct?.size ?? 0;
    case "sum":
      return acc.sum;
    case "mean":
      return acc.count === 0 ? NaN : acc.mean;
    case "min":
      return acc.count === 0 ? NaN : acc.min;
    case "max":
      return acc.count === 0 ? NaN : acc.max;
    case "stddev":
      return acc.count < 2 ? NaN : Math.sqrt(acc.m2 / (acc.count - 1));
    case "first":
      return acc.first;
    case "last":
      return acc.last;
    case "median": {
      if (acc.samples === null || acc.samples.length === 0) return NaN;
      const sorted = acc.samples.slice().sort((a, b) => a - b);
      return quantile(sorted, 0.5);
    }
    case "mode": {
      if (acc.modes === null || acc.modes.size === 0) return NaN;
      let best = "";
      let bestCount = -1;
      for (const [label, count] of acc.modes) {
        if (count > bestCount || (count === bestCount && label < best)) {
          best = label;
          bestCount = count;
        }
      }
      const parsed = Number(best);
      return Number.isFinite(parsed) && best.trim() !== "" ? parsed : NaN;
    }
    default: {
      const q = percentileOf(agg);
      if (q === null || acc.samples === null || acc.samples.length === 0) return NaN;
      const sorted = acc.samples.slice().sort((a, b) => a - b);
      return quantile(sorted, q);
    }
  }
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function applyPost(values: Float64Array, post: readonly PostOp[], all: Float64Array, index: number): Float64Array {
  let out = values;
  for (const op of post) {
    const next = new Float64Array(out.length);
    switch (op.op) {
      case "cumulative": {
        let running = 0;
        for (let i = 0; i < out.length; i++) {
          running += Number.isFinite(out[i]) ? out[i] : 0;
          next[i] = running;
        }
        break;
      }
      case "rolling": {
        const window = Math.max(1, Math.floor(op.window));
        let running = 0;
        let count = 0;
        for (let i = 0; i < out.length; i++) {
          if (Number.isFinite(out[i])) {
            running += out[i];
            count++;
          }
          if (i >= window) {
            const drop = out[i - window];
            if (Number.isFinite(drop)) {
              running -= drop;
              count--;
            }
          }
          next[i] = count === 0 ? NaN : running / count;
        }
        break;
      }
      case "diff": {
        for (let i = 0; i < out.length; i++) {
          next[i] = i === 0 ? NaN : out[i] - out[i - 1];
        }
        break;
      }
      case "pctChange": {
        for (let i = 0; i < out.length; i++) {
          if (i === 0) {
            next[i] = NaN;
            continue;
          }
          const previous = out[i - 1];
          next[i] = previous === 0 || !Number.isFinite(previous) ? NaN : (out[i] - previous) / previous;
        }
        break;
      }
      case "pctTotal": {
        const total = all[index];
        for (let i = 0; i < out.length; i++) {
          next[i] = Number.isFinite(total) && total !== 0 ? out[i] / total : NaN;
        }
        break;
      }
      case "rank": {
        const order = Array.from(out.keys())
          .filter((i) => Number.isFinite(out[i]))
          .sort((a, b) => out[b] - out[a]);
        let rank = 0;
        for (const i of order) {
          rank++;
          next[i] = rank;
        }
        for (let i = 0; i < next.length; i++) {
          if (!Number.isFinite(out[i])) next[i] = NaN;
        }
        break;
      }
    }
    out = next;
  }
  return out;
}

/** The dimension label, time bucket and natural sort rank for one row. */
function dimensionInfo(
  column: ColumnData,
  spec: DimensionSpec,
  row: number,
): { label: string; ms: number | null; rank: number | null } {
  const raw = column.raw[row];
  const missing = column.nullMask.get(row) || raw === undefined || raw === "";
  const by = spec.by;
  if (by === "value") {
    return { label: missing ? "(missing)" : raw, ms: null, rank: null };
  }
  if (typeof by === "object" && "time" in by) {
    const value = column.numbers()[row];
    if (!Number.isFinite(value)) return { label: "(missing)", ms: null, rank: null };
    const bucket = timeBucket(value, by.time, by.weekStart ?? 1);
    return { label: timeLabel(bucket, by.time), ms: bucket, rank: bucket };
  }
  if (typeof by === "object" && "datePart" in by) {
    const value = column.numbers()[row];
    if (!Number.isFinite(value)) return { label: "(missing)", ms: null, rank: null };
    const date = new Date(value);
    const rank =
      by.datePart === "dow"
        ? (date.getUTCDay() + 6) % 7
        : by.datePart === "hour"
          ? date.getUTCHours()
          : by.datePart === "month"
            ? date.getUTCMonth()
            : by.datePart === "dom"
              ? date.getUTCDate()
              : isoWeek(value);
    return { label: datePartLabel(value, by.datePart), ms: null, rank };
  }
  return { label: missing ? "(missing)" : raw, ms: null, rank: null };
}

/** Iterates the regular calendar step of a time grain after `ms`. */
function nextBucket(ms: number, grain: TimeGrain): number {
  switch (grain) {
    case "minute":
      return ms + MINUTE;
    case "hour":
      return ms + HOUR;
    case "day":
      return ms + DAY;
    case "week":
      return ms + 7 * DAY;
    case "month": {
      const date = new Date(ms);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    }
    case "quarter": {
      const date = new Date(ms);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1);
    }
    case "year": {
      const date = new Date(ms);
      return Date.UTC(date.getUTCFullYear() + 1, 0, 1);
    }
  }
}

/**
 * Aggregate rows into a view result. One pass builds group accumulators; a
 * second pass fills calendar gaps, finalises measures, sorts the ordered
 * output and applies the post-aggregation ops. Missing dimension values group
 * under "(missing)" and the totals row is always computed from rows, never
 * from the grouped output.
 */
export function computeAggregate(
  view: ViewDef,
  columns: readonly ColumnData[],
  rowCount: number,
  ids: Uint32Array,
): AggregateResult {
  const dimensions = view.dimensions.filter((spec) => columns[spec.column] !== undefined);
  const measures = view.measures;
  const timeGrain =
    dimensions.length === 1 &&
    typeof dimensions[0].by === "object" &&
    "time" in dimensions[0].by
      ? dimensions[0].by.time
      : null;

  const groupIndex = new Map<string, number>();
  const dimValues: string[][] = dimensions.map(() => []);
  const dimRanks: number[][] = dimensions.map(() => []);
  const dimTimes: number[][] = dimensions.map(() => []);
  const groupTimes: number[] = [];
  const accs: MeasureAcc[][] = [];

  const totalAccs = measures.map((measure) => accFor(measure.agg));
  const totalModes: (Map<string, number> | null)[] = measures.map((measure) =>
    measure.agg === "mode" ? new Map() : null,
  );
  const totalDistinct: (Set<string> | null)[] = measures.map((measure) =>
    measure.agg === "distinct" ? new Set() : null,
  );

  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    if (row >= rowCount) continue;
    const labels: string[] = [];
    const ranks: number[] = [];
    const times: number[] = [];
    let bucket: number | null = null;
    for (let d = 0; d < dimensions.length; d++) {
      const info = dimensionInfo(columns[dimensions[d].column], dimensions[d], row);
      labels.push(info.label);
      ranks.push(info.rank ?? Number.NaN);
      times.push(info.ms ?? Number.NaN);
      if (d === 0 && info.ms !== null) bucket = info.ms;
    }
    const key = labels.join("\u0000");
    let index = groupIndex.get(key);
    if (index === undefined) {
      index = dimValues[0]?.length ?? groupIndex.size;
      groupIndex.set(key, index);
      labels.forEach((label, d) => dimValues[d].push(label));
      ranks.forEach((rank, d) => dimRanks[d].push(rank));
      times.forEach((time, d) => dimTimes[d].push(time));
      groupTimes.push(bucket ?? Number.NaN);
      accs.push(measures.map((measure) => accFor(measure.agg)));
    }
    const groups = accs[index];

    for (let m = 0; m < measures.length; m++) {
      const measure = measures[m];
      const column = measure.column === null ? null : columns[measure.column];
      if (measure.column !== null && column === undefined) continue;
      if (measure.agg === "count" && measure.column === null) {
        groups[m].count++;
        totalAccs[m].count++;
        continue;
      }
      if (column === null) continue;
      const raw = column.raw[row];
      const missing = column.nullMask.get(row) || raw === undefined;
      const agg = measure.agg;
      if (agg === "count") {
        if (!missing) {
          groups[m].count++;
          totalAccs[m].count++;
        }
        continue;
      }
      if (agg === "distinct") {
        if (!missing) {
          groups[m].distinct?.add(raw);
          totalDistinct[m]?.add(raw);
        }
        continue;
      }
      if (agg === "mode") {
        if (!missing) {
          groups[m].modes?.set(raw, (groups[m].modes?.get(raw) ?? 0) + 1);
          totalModes[m]?.set(raw, (totalModes[m]?.get(raw) ?? 0) + 1);
        }
        continue;
      }
      const value = column.numbers()[row];
      if (!Number.isFinite(value)) continue;
      accumulate(groups[m], agg, value);
      accumulate(totalAccs[m], agg, value);
    }
  }

  // Calendar gap fill: an empty day/month is a real "0" on a time axis, not a
  // missing row, so insert zero groups for every bucket between the extremes.
  if (view.fill === "zero" && timeGrain !== null && groupTimes.length > 0) {
    const seen = new Set<number>();
    let min = Infinity;
    let max = -Infinity;
    for (const time of groupTimes) {
      if (!Number.isFinite(time)) continue;
      seen.add(time);
      if (time < min) min = time;
      if (time > max) max = time;
    }
    for (let time = min; time <= max; time = nextBucket(time, timeGrain)) {
      if (seen.has(time)) continue;
      seen.add(time);
      dimValues[0].push(timeLabel(time, timeGrain));
      dimRanks[0].push(time);
      dimTimes[0].push(time);
      groupTimes.push(time);
      accs.push(measures.map((measure) => accFor(measure.agg)));
      if (accs.length >= 50_000) break;
    }
  }

  const finalMeasures: Float64Array[] = measures.map((measure, m) =>
    Float64Array.from(accs, (groups) => finalise(groups[m], measure.agg)),
  );

  const totals = Float64Array.from(measures, (measure, m) => {
    if (measure.agg === "mode") {
      const modes = totalModes[m];
      if (modes === null || modes.size === 0) return NaN;
      let best = "";
      let bestCount = -1;
      for (const [label, count] of modes) {
        if (count > bestCount || (count === bestCount && label < best)) {
          best = label;
          bestCount = count;
        }
      }
      const parsed = Number(best);
      return Number.isFinite(parsed) && best.trim() !== "" ? parsed : NaN;
    }
    if (measure.agg === "distinct") {
      return totalDistinct[m]?.size ?? 0;
    }
    return finalise(totalAccs[m], measure.agg);
  });

  const order = Array.from(dimValues[0]?.keys() ?? []);
  const sortKey = view.sort.key;
  const dimIndex = /^dim(\d+)$/.exec(sortKey);
  const measureIndex = /^m(\d+)$/.exec(sortKey);
  order.sort((a, b) => {
    let comparison = 0;
    if (dimIndex !== null) {
      const d = Number(dimIndex[1]);
      const ra = dimRanks[d]?.[a] ?? Number.NaN;
      const rb = dimRanks[d]?.[b] ?? Number.NaN;
      comparison =
        Number.isFinite(ra) && Number.isFinite(rb)
          ? ra - rb
          : (dimValues[d]?.[a] ?? "").localeCompare(dimValues[d]?.[b] ?? "");
    } else if (measureIndex !== null) {
      const m = Number(measureIndex[1]);
      const va = finalMeasures[m]?.[a] ?? NaN;
      const vb = finalMeasures[m]?.[b] ?? NaN;
      comparison = (Number.isFinite(va) ? va : -Infinity) - (Number.isFinite(vb) ? vb : -Infinity);
    }
    return view.sort.dir === "asc" ? comparison : -comparison;
  });

  const limit = Math.max(1, Math.floor(view.limit) || 500);
  const truncated = order.length > limit;
  const shown = truncated ? order.slice(0, limit) : order;
  const limited = finalMeasures.map((values) => {
    const out = new Float64Array(shown.length);
    for (let i = 0; i < shown.length; i++) out[i] = values[shown[i]];
    return out;
  });
  const measuresOut = limited.map((values, m) =>
    applyPost(values, measures[m].post ?? [], totals, m),
  );

  return {
    labels: shown.map((i) => dimensions.map((_, d) => dimValues[d][i]).join(" · ")),
    dimensions: dimensions.map((_, d) => shown.map((i) => dimValues[d][i])),
    dimensionNames: dimensions.map((spec) => {
      const base = columns[spec.column].name;
      const by = spec.by;
      if (typeof by === "object" && "time" in by) return `${base} (${by.time})`;
      if (typeof by === "object" && "datePart" in by) return `${base} (${by.datePart})`;
      return base;
    }),
    dimensionIsTime: dimensions.map(
      (spec) => typeof spec.by === "object" && "time" in spec.by,
    ),
    dimensionTimes: dimTimes.map((values) => Float64Array.from(shown, (i) => values[i])),
    measures: measuresOut,
    measureNames: measures.map((measure) =>
      measure.column === null
        ? "count(*)"
        : `${measure.agg}(${columns[measure.column]?.name ?? "?"})`,
    ),
    totals,
    groupCount: shown.length,
    totalGroups: order.length,
    truncated,
  };
}

/** A view is meaningful when it has at least one dimension and one measure. */
export function isCompleteView(view: ViewDef): boolean {
  return view.dimensions.length > 0 && view.measures.length > 0;
}
