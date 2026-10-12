import type { ColumnData } from "./column.js";

/** Dimension transform: raw value, a time bucket, a date part or a numeric bin. */
export type TimeGrain = "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
export type DatePart = "dow" | "hour" | "month" | "dom" | "week";

export type DimensionSpec =
  | { column: number; by: "value" }
  | { column: number; by: { time: TimeGrain; weekStart?: 0 | 1 } }
  | { column: number; by: { datePart: DatePart } };

/** Basic aggregates plus `pN` percentiles, `distinct` counts and `expr`. */
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
  | "expr"
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
  /**
   * For agg === "expr": a small arithmetic expression over aggregates, e.g.
   * `sum(revenue) / count(*)` or `sum(weight * x)` is not supported — use
   * `sum(weight) / count(*)` style terms. Operators: + - * / ( ).
   */
  expr?: string;
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

const EXPR_FUNCS = new Set([
  "count",
  "distinct",
  "sum",
  "mean",
  "min",
  "max",
  "median",
  "stddev",
  "first",
  "last",
  "mode",
]);

export interface ExprTerm {
  agg: Aggregate;
  column: number | null;
  /** Printed form as written, e.g. "sum(amount)". */
  text: string;
}

export interface CompiledExpression {
  terms: ExprTerm[];
  evaluate(values: readonly number[]): number;
}

export type CompileResult =
  | { ok: true; compiled: CompiledExpression }
  | { ok: false; error: string };

type Evaluator = (values: readonly number[]) => number;

/**
 * Compiles a small arithmetic expression over aggregate terms, e.g.
 * `sum(revenue) / count(*)` or `(sum(amount) - sum(cost)) / sum(amount)`.
 * Supported: + - * / and parentheses; functions count(*) / count(col) /
 * sum / mean / min / max / median / stddev / first / last / mode / distinct /
 * pN (percentile). Column names are matched exactly first, then folded.
 */
export function compileExpression(
  expr: string,
  columnNames: readonly string[],
): CompileResult {
  const text = expr.trim();
  if (text === "") return { ok: false, error: "The expression is empty." };
  if (text.length > 240) return { ok: false, error: "Keep the expression under 240 characters." };

  const terms: ExprTerm[] = [];
  const folded = new Map(columnNames.map((name, index) => [name.trim().toLowerCase(), index]));
  let pos = 0;

  function fail(message: string): never {
    throw new Error(message);
  }
  const skipSpace = (): void => {
    while (pos < text.length && /\s/.test(text[pos] ?? "")) pos++;
  };
  const expect = (char: string): void => {
    skipSpace();
    if (text[pos] !== char) fail(`Expected “${char}”${text[pos] === undefined ? "" : ` before “${text[pos]}”`}.`);
    pos++;
  };

  const parsePrimary = (): Evaluator => {
    skipSpace();
    const char = text[pos];
    if (char === undefined) fail("The expression ends early.");
    if (char === "(") {
      pos++;
      const inner = parseSum();
      expect(")");
      return inner;
    }
    if (char === "-") {
      pos++;
      const operand = parsePrimary();
      return (values) => -operand(values);
    }
    if (/\d|\./.test(char)) {
      const match = /^\d*\.?\d+/.exec(text.slice(pos));
      if (match === null) fail("Invalid number.");
      pos += match[0].length;
      const value = Number(match[0]);
      return () => value;
    }
    if (/[a-zA-Z_]/.test(char)) {
      const nameMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text.slice(pos));
      if (nameMatch === null) fail("Invalid function name.");
      const name = nameMatch[0].toLowerCase();
      pos += nameMatch[0].length;
      skipSpace();
      if (text[pos] !== "(") fail(`“${name}” must be called with a column, e.g. ${name}(amount).`);
      pos++;
      const end = text.indexOf(")", pos);
      if (end < 0) fail(`Missing “)” after ${name}(.`);
      const arg = text.slice(pos, end).trim();
      pos = end + 1;

      const percentile = /^p(\d+(?:\.\d+)?)$/.exec(name);
      let agg: Aggregate;
      if (percentile !== null) {
        const pct = Number(percentile[1]);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          fail(`Percentile ${name} must be between p0 and p100.`);
        }
        agg = `p${pct}` as Aggregate;
      } else if (EXPR_FUNCS.has(name)) {
        agg = name as Aggregate;
      } else {
        fail(`Unknown function “${name}”. Try sum, mean, median, count, distinct or p90.`);
      }

      if (arg === "*" || arg === "") {
        if (agg !== "count") fail(`Only count(*) may omit the column.`);
        terms.push({ agg: "count", column: null, text: "count(*)" });
      } else {
        const index = columnNames.indexOf(arg);
        const resolved =
          index >= 0 ? index : (folded.get(arg.trim().toLowerCase()) ?? -1);
        if (resolved < 0) fail(`Unknown column “${arg}” in ${name}(…).`);
        terms.push({ agg, column: resolved, text: `${name}(${arg})` });
      }
      const termIndex = terms.length - 1;
      return (values) => values[termIndex] ?? Number.NaN;
    }
    fail(`Unexpected “${char}”.`);
  };

  const parseProduct = (): Evaluator => {
    let left = parsePrimary();
    for (;;) {
      skipSpace();
      const op = text[pos];
      if (op !== "*" && op !== "/") return left;
      pos++;
      const right = parsePrimary();
      const previous = left;
      left =
        op === "*"
          ? (values) => previous(values) * right(values)
          : (values) => previous(values) / right(values);
    }
  };

  const parseSum = (): Evaluator => {
    let left = parseProduct();
    for (;;) {
      skipSpace();
      const op = text[pos];
      if (op !== "+" && op !== "-") return left;
      pos++;
      const right = parseProduct();
      const previous = left;
      left =
        op === "+"
          ? (values) => previous(values) + right(values)
          : (values) => previous(values) - right(values);
    }
  };

  try {
    const evaluate = parseSum();
    skipSpace();
    if (pos < text.length) fail(`Unexpected “${text.slice(pos, pos + 8)}”.`);
    if (terms.length === 0) fail("Add at least one aggregate, e.g. sum(amount).");
    if (terms.length > 8) fail("Use at most 8 aggregates per expression.");
    return { ok: true, compiled: { terms, evaluate } };
  } catch (thrown) {
    return { ok: false, error: thrown instanceof Error ? thrown.message : String(thrown) };
  }
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
      const [year, month] = civilFromDays(Math.floor(ms / DAY));
      return daysFromCivil(year, month, 1) * DAY;
    }
    case "quarter": {
      const [year, month] = civilFromDays(Math.floor(ms / DAY));
      return daysFromCivil(year, month - ((month - 1) % 3), 1) * DAY;
    }
    case "year": {
      const [year] = civilFromDays(Math.floor(ms / DAY));
      return daysFromCivil(year, 1, 1) * DAY;
    }
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Civil date from a day number (Howard Hinnant's algorithm), so time bucketing
 * never allocates a Date per row.
 */
function civilFromDays(z: number): [year: number, month: number, day: number] {
  z += 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [month <= 2 ? y + 1 : y, month, day];
}

function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
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
  const day = Math.floor(ms / DAY);
  switch (part) {
    case "dow":
      return DOW_LABELS[(((day + 3) % 7) + 7) % 7] ?? "?";
    case "hour":
      return pad(Math.floor((ms - day * DAY) / HOUR), 2);
    case "month": {
      const [, month] = civilFromDays(day);
      return MONTH_LABELS[month - 1] ?? "?";
    }
    case "dom": {
      const [, , dom] = civilFromDays(day);
      return pad(dom, 2);
    }
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

function accumulateInto(acc: MeasureAcc, value: number): void {
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

/** Slot kind: 0 rows-count, 1 col-count, 2 distinct, 3 mode, 4 numeric, 5 noop. */
function kindOf(
  agg: Aggregate,
  column: number | null,
  data: ColumnData | null,
): 0 | 1 | 2 | 3 | 4 | 5 {
  if (agg === "count") {
    if (column === null) return 0;
    return data === null ? 5 : 1;
  }
  if (data === null) return 5;
  if (agg === "distinct") return 2;
  if (agg === "mode") return 3;
  return 4;
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

/**
 * Writes the dimension key, deferred label and natural sort rank for one row
 * into the scratch arrays (no per-row allocation).
 */
function dimensionInto(
  column: ColumnData,
  spec: DimensionSpec,
  row: number,
  keys: string[],
  labels: string[],
  ranks: number[],
  times: number[],
): void {
  const raw = column.raw[row];
  const missing = column.nullMask.get(row) || raw === undefined || raw === "";
  const by = spec.by;
  if (by === "value") {
    const text = missing ? "(missing)" : raw;
    keys.push(text);
    labels.push(text);
    ranks.push(Number.NaN);
    times.push(Number.NaN);
    return;
  }
  if (typeof by === "object" && "time" in by) {
    const value = column.numbers()[row];
    if (!Number.isFinite(value)) {
      keys.push("(missing)");
      labels.push("(missing)");
      ranks.push(Number.NaN);
      times.push(Number.NaN);
      return;
    }
    const bucket = timeBucket(value, by.time, by.weekStart ?? 1);
    // Labels are formatted only when a new group appears, not per row.
    keys.push(String(bucket));
    labels.push("");
    ranks.push(bucket);
    times.push(bucket);
    return;
  }
  if (typeof by === "object" && "datePart" in by) {
    const value = column.numbers()[row];
    if (!Number.isFinite(value)) {
      keys.push("(missing)");
      labels.push("(missing)");
      ranks.push(Number.NaN);
      times.push(Number.NaN);
      return;
    }
    const day = Math.floor(value / DAY);
    const rank =
      by.datePart === "dow"
        ? (((day + 3) % 7) + 7) % 7
        : by.datePart === "hour"
          ? Math.floor((value - day * DAY) / HOUR)
          : by.datePart === "month"
            ? civilFromDays(day)[1] - 1
            : by.datePart === "dom"
              ? civilFromDays(day)[2]
              : isoWeek(value);
    const label = datePartLabel(value, by.datePart);
    keys.push(label);
    labels.push(label);
    ranks.push(rank);
    times.push(Number.NaN);
    return;
  }
  const text = missing ? "(missing)" : raw;
  keys.push(text);
  labels.push(text);
  ranks.push(Number.NaN);
  times.push(Number.NaN);
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

/** Partially sorts `order`, keeping only the best `limit` by `compare`. */
function selectTopIndices(
  order: readonly number[],
  compare: (a: number, b: number) => number,
  limit: number,
): number[] {
  const heap: number[] = [];
  const siftUp = (start: number): void => {
    let index = start;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compare(heap[index] ?? 0, heap[parent] ?? 0) <= 0) break;
      [heap[index], heap[parent]] = [heap[parent] ?? 0, heap[index] ?? 0];
      index = parent;
    }
  };
  const siftDown = (): void => {
    let index = 0;
    const size = heap.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let largest = index;
      if (left < size && compare(heap[left] ?? 0, heap[largest] ?? 0) > 0) largest = left;
      if (right < size && compare(heap[right] ?? 0, heap[largest] ?? 0) > 0) largest = right;
      if (largest === index) break;
      [heap[index], heap[largest]] = [heap[largest] ?? 0, heap[index] ?? 0];
      index = largest;
    }
  };
  for (const item of order) {
    if (heap.length < limit) {
      heap.push(item);
      siftUp(heap.length - 1);
    } else if (compare(item, heap[0] ?? 0) < 0) {
      heap[0] = item;
      siftDown();
    }
  }
  return heap.sort(compare);
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
  const dimGrains: (TimeGrain | null)[] = dimensions.map((spec) =>
    typeof spec.by === "object" && "time" in spec.by ? spec.by.time : null,
  );

  const groupIndex = new Map<string, number>();
  const dimValues: string[][] = dimensions.map(() => []);
  const dimRanks: number[][] = dimensions.map(() => []);
  const dimTimes: number[][] = dimensions.map(() => []);
  const groupTimes: number[] = [];
  const accs: MeasureAcc[][] = [];

  // One accumulator slot per aggregate term; expression measures get one slot
  // per term and are evaluated from the term values after the row loop. Slots
  // are pre-resolved (kind, column arrays, mask) so the row loop stays flat.
  type SlotKind = 0 | 1 | 2 | 3 | 4 | 5; // rows-count, col-count, distinct, mode, numeric, noop
  interface Slot {
    agg: Aggregate;
    column: number | null;
    kind: SlotKind;
    numbers: Float64Array | null;
    raw: readonly string[] | null;
    mask: ColumnData["nullMask"] | null;
  }
  const slots: Slot[] = [];
  const pushSlot = (agg: Aggregate, column: number | null, exists: boolean): void => {
    const data = column === null || !exists ? null : (columns[column] ?? null);
    const kind: SlotKind =
      kindOf(agg, column, data);
    slots.push({
      agg,
      column,
      kind,
      numbers: kind === 4 ? data?.numbers() ?? null : null,
      raw: data?.raw ?? null,
      mask: data?.nullMask ?? null,
    });
  };
  const measureSlotOffset: number[] = [];
  const measureTerms: ExprTerm[][] = [];
  const measureCompiled: (CompiledExpression | null)[] = [];
  const columnNames = columns.map((column) => column.name);
  for (const measure of measures) {
    measureSlotOffset.push(slots.length);
    if (measure.agg === "expr") {
      const compiled = compileExpression(measure.expr ?? "", columnNames);
      if (compiled.ok) {
        measureCompiled.push(compiled.compiled);
        measureTerms.push(compiled.compiled.terms);
        for (const term of compiled.compiled.terms) {
          pushSlot(term.agg, term.column, term.column === null || columns[term.column] !== undefined);
        }
      } else {
        measureCompiled.push(null);
        measureTerms.push([]);
      }
    } else {
      measureCompiled.push(null);
      measureTerms.push([{ agg: measure.agg, column: measure.column, text: "" }]);
      pushSlot(measure.agg, measure.column, measure.column === null || columns[measure.column] !== undefined);
    }
  }
  const newSlotAccs = (): MeasureAcc[] => slots.map((slot) => accFor(slot.agg));
  const totalAccs = newSlotAccs();

  // Scratch arrays reused across rows: the row loop allocates nothing.
  const keys: string[] = [];
  const labels: string[] = [];
  const ranks: number[] = [];
  const times: number[] = [];

  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    if (row >= rowCount) continue;
    keys.length = 0;
    labels.length = 0;
    ranks.length = 0;
    times.length = 0;
    let bucket: number | null = null;
    for (let d = 0; d < dimensions.length; d++) {
      dimensionInto(columns[dimensions[d].column], dimensions[d], row, keys, labels, ranks, times);
      if (d === 0) {
        const ms = times[0] ?? Number.NaN;
        if (Number.isFinite(ms)) bucket = ms;
      }
    }
    const key = dimensions.length === 1 ? (keys[0] ?? "") : keys.join("\u0000");
    let index = groupIndex.get(key);
    if (index === undefined) {
      index = dimValues[0]?.length ?? groupIndex.size;
      groupIndex.set(key, index);
      for (let d = 0; d < dimensions.length; d++) {
        const grain = dimGrains[d];
        const label = labels[d] ?? "";
        dimValues[d].push(
          label !== ""
            ? label
            : grain !== null
              ? timeLabel(times[d] ?? Number.NaN, grain)
              : "(missing)",
        );
        dimRanks[d].push(ranks[d] ?? Number.NaN);
        dimTimes[d].push(times[d] ?? Number.NaN);
      }
      groupTimes.push(bucket ?? Number.NaN);
      accs.push(newSlotAccs());
    }
    const groups = accs[index];

    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      const acc = groups[s];
      const total = totalAccs[s];
      switch (slot.kind) {
        case 0:
          acc.count++;
          total.count++;
          break;
        case 5:
          break;
        case 1: {
          if (slot.mask?.get(row) === true || slot.raw?.[row] === undefined) break;
          acc.count++;
          total.count++;
          break;
        }
        case 2: {
          if (slot.mask?.get(row) === true || slot.raw?.[row] === undefined) break;
          const value = slot.raw[row];
          acc.distinct?.add(value);
          total.distinct?.add(value);
          break;
        }
        case 3: {
          if (slot.mask?.get(row) === true || slot.raw?.[row] === undefined) break;
          const value = slot.raw[row];
          acc.modes?.set(value, (acc.modes?.get(value) ?? 0) + 1);
          total.modes?.set(value, (total.modes?.get(value) ?? 0) + 1);
          break;
        }
        default: {
          const value = slot.numbers?.[row] ?? Number.NaN;
          if (!Number.isFinite(value)) break;
          accumulateInto(acc, value);
          accumulateInto(total, value);
          break;
        }
      }
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
      accs.push(newSlotAccs());
      if (accs.length >= 50_000) break;
    }
  }

  const finalMeasures: Float64Array[] = measures.map((measure, m) => {
    const offset = measureSlotOffset[m];
    const terms = measureTerms[m];
    const compiled = measureCompiled[m];
    if (measure.agg === "expr") {
      if (compiled === null) return new Float64Array(accs.length).fill(Number.NaN);
      return Float64Array.from(accs, (group) => {
        const values = new Array<number>(terms.length);
        for (let i = 0; i < terms.length; i++) {
          values[i] = finalise(group[offset + i], terms[i].agg);
        }
        const value = compiled.evaluate(values);
        return Number.isFinite(value) ? value : Number.NaN;
      });
    }
    return Float64Array.from(accs, (group) => finalise(group[offset], measure.agg));
  });

  const totals = Float64Array.from(measures, (measure, m) => {
    const offset = measureSlotOffset[m];
    if (measure.agg === "expr") {
      const terms = measureTerms[m];
      const compiled = measureCompiled[m];
      if (compiled === null) return Number.NaN;
      const values = new Array<number>(terms.length);
      for (let i = 0; i < terms.length; i++) {
        values[i] = finalise(totalAccs[offset + i], terms[i].agg);
      }
      const value = compiled.evaluate(values);
      return Number.isFinite(value) ? value : Number.NaN;
    }
    return finalise(totalAccs[offset], measure.agg);
  });

  const order = Array.from(dimValues[0]?.keys() ?? []);
  const sortKey = view.sort.key;
  const dimIndex = /^dim(\d+)$/.exec(sortKey);
  const measureIndex = /^m(\d+)$/.exec(sortKey);
  const direction = view.sort.dir === "asc" ? 1 : -1;
  // Decorate the sort key once so each comparison is plain arithmetic.
  let measureRanks: Float64Array | null = null;
  let dimensionRanks: Float64Array | null = null;
  if (measureIndex !== null) {
    const values = finalMeasures[Number(measureIndex[1])];
    if (values !== undefined) {
      measureRanks = new Float64Array(values.length);
      const missing = direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      for (let i = 0; i < values.length; i++) {
        measureRanks[i] = Number.isFinite(values[i]) ? values[i] : missing;
      }
    }
  } else if (dimIndex !== null) {
    const ranks = dimRanks[Number(dimIndex[1])];
    if (ranks !== undefined && ranks.every((rank) => Number.isFinite(rank))) {
      dimensionRanks = Float64Array.from(ranks);
    }
  }
  const compare = (a: number, b: number): number => {
    if (measureRanks !== null) return (measureRanks[a] - measureRanks[b]) * direction;
    if (dimensionRanks !== null) return (dimensionRanks[a] - dimensionRanks[b]) * direction;
    let comparison = 0;
    if (dimIndex !== null) {
      const d = Number(dimIndex[1]);
      comparison = (dimValues[d]?.[a] ?? "").localeCompare(dimValues[d]?.[b] ?? "");
    }
    return comparison * direction;
  };

  const limit = Math.max(1, Math.floor(view.limit) || 500);
  const truncated = order.length > limit;
  // Above the limit only the top N are needed: a bounded heap beats a full
  // sort of every group (matters at 100k+ high-cardinality dimensions).
  const shown = truncated ? selectTopIndices(order, compare, limit) : order.sort(compare);
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
    measureNames: measures.map((measure) => {
      if (measure.agg === "expr") return measure.expr ?? "expr";
      return measure.column === null
        ? "count(*)"
        : `${measure.agg}(${columns[measure.column]?.name ?? "?"})`;
    }),
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
