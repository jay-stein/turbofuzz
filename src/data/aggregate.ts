import type { ColumnData } from "./column.js";
import { resolveZoneSpec, zoneOffsetMinutes } from "./timezone.js";

/** Dimension transform: raw value, a time bucket, a date part or a numeric bin. */
export type TimeGrain = "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
export type DatePart = "dow" | "hour" | "month" | "dom" | "week";

/** Numeric binning: equal width, N quantile groups, or explicit edges. */
export type BinSpec =
  | { width: number }
  | { n: number }
  | { edges: number[] };

export interface TimeOptions {
  time: TimeGrain;
  /** Week starts Sunday (0) or Monday (1, default). */
  weekStart?: 0 | 1;
  /** 1–12: fiscal year starts this month; affects year/quarter buckets and labels. */
  fiscalStartMonth?: number;
  /** Zone to bucket in: "UTC", "local", "±HH:MM" or an IANA name. */
  tz?: string;
}

/** First-period cohort of an entity: retention analysis over time. */
export interface CohortSpec {
  /** Column holding the entity whose first period defines the cohort. */
  entity: number;
  grain: TimeGrain;
  weekStart?: 0 | 1;
  fiscalStartMonth?: number;
  tz?: string;
}

export type DimensionSpec =
  | { column: number; by: "value" }
  | { column: number; by: TimeOptions }
  | { column: number; by: { datePart: DatePart } }
  | { column: number; by: { bin: BinSpec } }
  | { column: number; by: { cohort: CohortSpec } }
  | { column: number; by: { since: CohortSpec } };

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
  | { op: "rank" }
  | { op: "yoy" };

/** Rows counted by a measure: value list, numeric range or missing-test. */
export interface MeasureCondition {
  column: number;
  /** Raw (trimmed) value match — usually a category multi-select. */
  values?: string[];
  /** Inclusive numeric bounds. */
  min?: number;
  max?: number;
  /** Only count blank cells. */
  isNull?: boolean;
}

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
  /** Optional weight column: mean becomes Σ(v·w)/Σw, sum becomes Σ(v·w). */
  weight?: number;
  /** Restricts the measure to rows matching the condition. */
  where?: MeasureCondition;
  post?: PostOp[];
}

export interface PivotLambdaSpec {
  /** Value column bound to the lambda variable x. */
  column: number;
  /** Source text, including the `lambda x:` prefix. */
  source: string;
  label?: string;
}

export interface ViewDef {
  id: string;
  name: string;
  dimensions: DimensionSpec[];
  measures: MeasureSpec[];
  /** Empty time buckets: dropped, counted as zero, or carried forward. */
  fill: "none" | "zero" | "carry";
  /** "dim0" | "dim1" | "m0" | "m1" — sort key and direction. */
  sort: { key: string; dir: "asc" | "desc" };
  limit: number;
  respectFilters: boolean;
  /** Optional chart-scoped category filter, applied after the table scope. */
  filterColumn?: number;
  filterCode?: number;
  /** Incomplete first/last periods: shown (hatched) or excluded. */
  partial?: "show" | "exclude";
  /** Dimension index spread across columns when rendered as a matrix. */
  pivot?: number;
  /** Multiple dimensions spread across nested column headers (preferred over pivot). */
  pivotColumns?: number[];
  /** Measure shown in the pivot matrix (0 = first measure). */
  pivotMeasure?: number;
  /** Pivot key ordering: label ascending (default) or first-seen source order. */
  pivotSort?: "label" | "source";
  /** Safe custom lambda values shown after the ordinary measures. */
  pivotLambdas?: PivotLambdaSpec[];
  /** Pivot CSV headers: flat for Excel, or pandas-style repeated multi-row. */
  pivotCsvHeaders?: "flat" | "multi";
  /** Pivot margin display: raw, % of row total, or % of column total. */
  pivotMarginPct?: "none" | "row" | "column";
  /** Coolwarm pivot cell shading, optionally reversed. */
  pivotHeatmap?: "none" | "coolwarm" | "coolwarm-reversed";
  /** Exact raw-value filters on pivot dimension columns. */
  pivotValueFilters?: { column: number; values: string[] }[];
  /** Value used for pivot cells with no rows (null/undefined = blank). */
  fillValue?: number | null;
  /** Drop pivot rows and columns that contain no finite values. */
  dropna?: boolean;
  /** Add an "All" row and column to a pivot, computed from raw rows. */
  margins?: boolean;
  /** Label used for the margin row/column. */
  marginsName?: string;
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
  /** Per shown group: its period is incomplete at a data edge. */
  partials: boolean[] | null;
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

export interface BucketOptions {
  weekStart?: 0 | 1;
  fiscalStartMonth?: number;
}

/**
 * Zone bucketing for time dimensions: shifts an instant by the zone offset so
 * civil-date math sees wall-clock time. Returns null when no shift is needed.
 */
export function zoneShift(tz: string | undefined): ((ms: number) => number) | null {
  if (tz === undefined || tz.trim() === "") return null;
  const spec = resolveZoneSpec(tz);
  switch (spec.kind) {
    case "naive":
    case "utc":
      return null;
    case "fixed":
      return (ms) => ms + spec.offsetMinutes * 60_000;
    case "local":
      return (ms) => ms - new Date(ms).getTimezoneOffset() * 60_000;
    case "iana":
      return (ms) => ms + zoneOffsetMinutes(ms, spec.zone) * 60_000;
  }
}

function addMonths(year: number, month: number, add: number): [number, number] {
  const total = year * 12 + (month - 1) + add;
  return [Math.floor(total / 12), ((total % 12) + 12) % 12 + 1];
}

/** Start year of the fiscal year containing a civil month. */
function fiscalYearOf(year: number, month: number, fiscalStartMonth: number): number {
  return month >= fiscalStartMonth ? year : year - 1;
}

export function timeBucket(ms: number, grain: TimeGrain, options: BucketOptions = {}): number {
  const fiscalStartMonth =
    options.fiscalStartMonth !== undefined &&
    options.fiscalStartMonth >= 1 &&
    options.fiscalStartMonth <= 12
      ? options.fiscalStartMonth
      : 1;
  switch (grain) {
    case "minute":
      return Math.floor(ms / MINUTE) * MINUTE;
    case "hour":
      return Math.floor(ms / HOUR) * HOUR;
    case "day":
      return Math.floor(ms / DAY) * DAY;
    case "week": {
      const weekStart = options.weekStart ?? 1;
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
      if (fiscalStartMonth !== 1) {
        const startYear = fiscalYearOf(year, month, fiscalStartMonth);
        const monthsIn = (month - fiscalStartMonth + 12) % 12;
        const [qy, qm] = addMonths(startYear, fiscalStartMonth, Math.floor(monthsIn / 3) * 3);
        return daysFromCivil(qy, qm, 1) * DAY;
      }
      return daysFromCivil(year, month - ((month - 1) % 3), 1) * DAY;
    }
    case "year": {
      const [year, month] = civilFromDays(Math.floor(ms / DAY));
      if (fiscalStartMonth !== 1) {
        return daysFromCivil(fiscalYearOf(year, month, fiscalStartMonth), fiscalStartMonth, 1) * DAY;
      }
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

export function timeLabel(ms: number, grain: TimeGrain, options: BucketOptions = {}): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1, 2);
  const day = pad(date.getUTCDate(), 2);
  const hour = pad(date.getUTCHours(), 2);
  const minute = pad(date.getUTCMinutes(), 2);
  const fiscalStartMonth =
    options.fiscalStartMonth !== undefined &&
    options.fiscalStartMonth >= 1 &&
    options.fiscalStartMonth <= 12
      ? options.fiscalStartMonth
      : 1;
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
    case "quarter": {
      if (fiscalStartMonth !== 1) {
        const monthsIn =
          (date.getUTCMonth() + 1 - fiscalStartMonth + 12) % 12;
        const startYear = fiscalYearOf(
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          fiscalStartMonth,
        );
        return `FY${startYear} Q${Math.floor(monthsIn / 3) + 1}`;
      }
      return `${year} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    }
    case "year": {
      if (fiscalStartMonth !== 1) {
        return `FY${fiscalYearOf(date.getUTCFullYear(), date.getUTCMonth() + 1, fiscalStartMonth)}`;
      }
      return String(year);
    }
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
  /** Sum of weights for weighted mean/sum slots. */
  weight: number;
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
    weight: 0,
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

function finalise(acc: MeasureAcc, agg: Aggregate, weighted = false): number {
  if (weighted) {
    if (agg === "mean") return acc.weight > 0 ? acc.sum / acc.weight : Number.NaN;
    if (agg === "sum") return acc.sum;
  }
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

/** Bucket start exactly one calendar year earlier (Feb 29 clamps to Feb 28). */
function previousYear(ms: number): number {
  const day = Math.floor(ms / DAY);
  const [year, month, dom] = civilFromDays(day);
  let target = daysFromCivil(year - 1, month, dom);
  const [, targetMonth, targetDay] = civilFromDays(target);
  if (targetMonth !== month || targetDay !== dom) {
    target = daysFromCivil(year - 1, 2, 28);
  }
  return target * DAY;
}

function applyPost(
  values: Float64Array,
  post: readonly PostOp[],
  all: Float64Array,
  index: number,
  times: readonly number[] | null,
): Float64Array {
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
      case "yoy": {
        // Calendar-aligned comparison: the same bucket one year earlier, not
        // "N rows back" when periods are missing.
        const timeIndex = new Map<number, number>();
        if (times !== null) {
          times.forEach((time, i) => {
            if (Number.isFinite(time)) timeIndex.set(time, i);
          });
        }
        for (let i = 0; i < out.length; i++) {
          const time = times?.[i];
          if (time === undefined || !Number.isFinite(time)) {
            next[i] = NaN;
            continue;
          }
          const previous = timeIndex.get(previousYear(time));
          const base = previous === undefined ? NaN : out[previous];
          next[i] =
            Number.isFinite(base) && base !== 0 && Number.isFinite(out[i])
              ? (out[i] - base) / base
              : NaN;
        }
        break;
      }
    }
    out = next;
  }
  return out;
}

/** Edges (n+1) for a bin dimension over the current filtered values. */
function computeBinEdges(
  spec: BinSpec,
  column: ColumnData,
  ids: Uint32Array,
  rowCount: number,
): number[] | null {
  if ("edges" in spec) {
    const edges = spec.edges
      .filter((value) => Number.isFinite(value))
      .slice()
      .sort((a, b) => a - b);
    return edges.length >= 2 ? edges : null;
  }
  const numbers = column.numbers();
  if ("width" in spec) {
    const width = Math.abs(spec.width);
    if (!(width > 0)) return null;
    let min = Infinity;
    let max = -Infinity;
    for (let position = 0; position < ids.length; position++) {
      const row = ids[position];
      if (row >= rowCount) continue;
      const value = numbers[row];
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min)) return null;
    const lo = Math.floor(min / width) * width;
    const edges: number[] = [];
    for (let index = 0; index < 1024; index++) {
      const value = lo + index * width;
      if (value > max + width) break;
      edges.push(value);
    }
    return edges.length >= 2 ? edges : null;
  }
  // Quantile bins over the filtered values.
  const values: number[] = [];
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    if (row >= rowCount) continue;
    const value = numbers[row];
    if (Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const n = Math.max(2, Math.min(100, Math.floor(spec.n) || 10));
  const edges: number[] = [];
  for (let i = 0; i <= n; i++) {
    const position = ((values.length - 1) * i) / n;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    edges.push(values[lower] * (1 - weight) + values[upper] * weight);
  }
  return edges;
}

/** Bin index for a value under ascending edges (clamped to the outer bins). */
function binIndex(edges: readonly number[], value: number): number {
  const last = edges.length - 2;
  if (last < 0) return 0;
  if (value < (edges[0] ?? 0)) return 0;
  if (value >= (edges[edges.length - 1] ?? 0)) return last;
  let lo = 0;
  let hi = edges.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((edges[mid] ?? 0) <= value) lo = mid;
    else hi = mid;
  }
  return Math.max(0, Math.min(last, lo));
}

/** "10 – 20" style label for one bin. */
function binLabel(edges: readonly number[], index: number): string {
  const format = (value: number): string =>
    Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${format(edges[index] ?? Number.NaN)} – ${format(edges[index + 1] ?? Number.NaN)}`;
}

/** Pre-resolved per-dimension state (zone shift, fiscal week, cohort map). */
interface DimRuntime {
  shift: ((ms: number) => number) | null;
  weekStart: 0 | 1;
  fiscalStartMonth: number | undefined;
  cohort: Map<string, number> | null;
  entityRaw: readonly string[] | null;
  entityMask: ColumnData["nullMask"] | null;
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
  binEdges: readonly number[] | null,
  runtime: DimRuntime,
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
    const shifted = runtime.shift === null ? value : runtime.shift(value);
    const bucket = timeBucket(shifted, by.time, {
      weekStart: by.weekStart,
      fiscalStartMonth: by.fiscalStartMonth,
    });
    // Labels are formatted only when a new group appears, not per row.
    keys.push(String(bucket));
    labels.push("");
    ranks.push(bucket);
    times.push(bucket);
    return;
  }
  if (typeof by === "object" && ("cohort" in by || "since" in by)) {
    const cohortSpec = "cohort" in by ? by.cohort : by.since;
    const entity = runtime.entityRaw;
    const entityKey =
      entity === null || runtime.entityMask?.get(row) === true || entity[row] === undefined
        ? "(missing)"
        : entity[row].trim();
    const cohortBucket = runtime.cohort?.get(entityKey);
    if (cohortBucket === undefined) {
      keys.push("(missing)");
      labels.push("(missing)");
      ranks.push(Number.NaN);
      times.push(Number.NaN);
      return;
    }
    if ("cohort" in by) {
      keys.push(String(cohortBucket));
      labels.push("");
      ranks.push(cohortBucket);
      times.push(cohortBucket);
      return;
    }
    const value = column.numbers()[row];
    if (!Number.isFinite(value)) {
      keys.push("(missing)");
      labels.push("(missing)");
      ranks.push(Number.NaN);
      times.push(Number.NaN);
      return;
    }
    const shifted = runtime.shift === null ? value : runtime.shift(value);
    const bucket = timeBucket(shifted, cohortSpec.grain, {
      weekStart: cohortSpec.weekStart,
      fiscalStartMonth: cohortSpec.fiscalStartMonth,
    });
    const index = periodIndex(cohortBucket, bucket, cohortSpec.grain);
    keys.push(String(index));
    labels.push(`P${index}`);
    ranks.push(index);
    times.push(Number.NaN);
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
  if (typeof by === "object" && "bin" in by) {
    const value = column.numbers()[row];
    if (!Number.isFinite(value) || binEdges === null || binEdges.length < 2) {
      keys.push("(missing)");
      labels.push("(missing)");
      ranks.push(Number.NaN);
      times.push(Number.NaN);
      return;
    }
    const index = binIndex(binEdges, value);
    const lo = binEdges[index] ?? Number.NaN;
    // Labels are formatted only when a new group appears.
    keys.push(String(index));
    labels.push("");
    ranks.push(lo);
    times.push(lo);
    return;
  }
  const text = missing ? "(missing)" : raw;
  keys.push(text);
  labels.push(text);
  ranks.push(Number.NaN);
  times.push(Number.NaN);
}

/** Iterates the regular calendar step of a time grain after `ms`. */
function nextBucket(ms: number, grain: TimeGrain, options: BucketOptions = {}): number {
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
      return Date.UTC(date.getUTCFullYear() + 1, date.getUTCMonth(), 1);
    }
  }
}

/** Periods between two bucket starts at the same grain (0 when equal). */
export function periodIndex(from: number, to: number, grain: TimeGrain): number {
  switch (grain) {
    case "minute":
      return Math.round((to - from) / MINUTE);
    case "hour":
      return Math.round((to - from) / HOUR);
    case "day":
      return Math.round((to - from) / DAY);
    case "week":
      return Math.round((to - from) / (7 * DAY));
    default: {
      const [y1, m1] = civilFromDays(Math.floor(from / DAY));
      const [y2, m2] = civilFromDays(Math.floor(to / DAY));
      const months = (y2 - y1) * 12 + (m2 - m1);
      if (grain === "month") return months;
      if (grain === "quarter") return Math.round(months / 3);
      return Math.round(months / 12);
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
  const dimGrains: (TimeGrain | null)[] = dimensions.map((spec) => {
    const by = spec.by;
    if (typeof by !== "object") return null;
    if ("time" in by) return by.time;
    if ("cohort" in by) return by.cohort.grain;
    return null;
  });
  const dimBinEdges: (number[] | null)[] = dimensions.map((spec) =>
    typeof spec.by === "object" && "bin" in spec.by
      ? computeBinEdges(spec.by.bin, columns[spec.column], ids, rowCount)
      : null,
  );
  // Per-dimension runtime: zone shift + fiscal/week options, and the
  // entity -> first-period map cohort dimensions need (built once).
  const dimRuntime: DimRuntime[] = dimensions.map((spec) => {
    const by = spec.by;
    const entity: DimRuntime["entityRaw"] =
      typeof by === "object" && ("cohort" in by || "since" in by)
        ? columns[("cohort" in by ? by.cohort : by.since).entity]?.raw ?? null
        : null;
    const entityMask: DimRuntime["entityMask"] =
      typeof by === "object" && ("cohort" in by || "since" in by)
        ? columns[("cohort" in by ? by.cohort : by.since).entity]?.nullMask ?? null
        : null;
    return {
      shift:
        typeof by === "object" && "time" in by
          ? zoneShift(by.tz)
          : typeof by === "object" && ("cohort" in by || "since" in by)
            ? zoneShift(("cohort" in by ? by.cohort : by.since).tz)
            : null,
      weekStart:
        (typeof by === "object" && "time" in by ? by.weekStart : undefined) ??
        (typeof by === "object" && ("cohort" in by || "since" in by)
          ? ("cohort" in by ? by.cohort : by.since).weekStart
          : undefined) ??
        1,
      fiscalStartMonth:
        (typeof by === "object" && "time" in by ? by.fiscalStartMonth : undefined) ??
        (typeof by === "object" && ("cohort" in by || "since" in by)
          ? ("cohort" in by ? by.cohort : by.since).fiscalStartMonth
          : undefined),
      cohort: null,
      entityRaw: entity,
      entityMask,
    };
  });
  for (let d = 0; d < dimensions.length; d++) {
    const spec = dimensions[d];
    if (typeof spec.by !== "object" || !("cohort" in spec.by || "since" in spec.by)) continue;
    const cohortSpec = "cohort" in spec.by ? spec.by.cohort : spec.by.since;
    const runtime = dimRuntime[d];
    if (runtime.cohort !== null || runtime.entityRaw === null) continue;
    const dateColumn = columns[spec.column];
    const dates = dateColumn?.numbers() ?? null;
    const map = new Map<string, number>();
    if (dates !== null) {
      for (let position = 0; position < ids.length; position++) {
        const row = ids[position];
        if (row >= rowCount) continue;
        if (runtime.entityMask?.get(row) === true) continue;
        const entity = runtime.entityRaw[row];
        if (entity === undefined) continue;
        const value = dates[row];
        if (!Number.isFinite(value)) continue;
        const shifted = runtime.shift === null ? value : runtime.shift(value);
        const bucket = timeBucket(shifted, cohortSpec.grain, {
          weekStart: cohortSpec.weekStart,
          fiscalStartMonth: cohortSpec.fiscalStartMonth,
        });
        const key = entity.trim();
        const existing = map.get(key);
        if (existing === undefined || bucket < existing) map.set(key, bucket);
      }
    }
    runtime.cohort = map;
  }

  const groupIndex = new Map<string, number>();
  const dimValues: string[][] = dimensions.map(() => []);
  const dimRanks: number[][] = dimensions.map(() => []);
  const dimTimes: number[][] = dimensions.map(() => []);
  const groupTimes: number[] = [];
  const accs: MeasureAcc[][] = [];
  /** True for calendar gap groups (used by the carry fill). */
  const filled: boolean[] = [];

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
    /** Weighted mean/sum: the weight column's values. */
    weighted: boolean;
    weights: Float64Array | null;
    /** Rows counted by this measure (null = every row). */
    condition: Uint8Array | null;
  }
  const slots: Slot[] = [];
  const pushSlot = (
    agg: Aggregate,
    column: number | null,
    exists: boolean,
    weightColumn: number | null = null,
    condition: Uint8Array | null = null,
  ): void => {
    const data = column === null || !exists ? null : (columns[column] ?? null);
    const kind: SlotKind = kindOf(agg, column, data);
    const weighted =
      weightColumn !== null &&
      columns[weightColumn] !== undefined &&
      (agg === "sum" || agg === "mean");
    const weights = weighted ? columns[weightColumn]?.numbers() ?? null : null;
    slots.push({
      agg,
      column,
      kind,
      numbers: kind === 4 ? data?.numbers() ?? null : null,
      raw: data?.raw ?? null,
      mask: data?.nullMask ?? null,
      weighted: weighted && weights !== null,
      weights: weighted && weights !== null ? weights : null,
      condition,
    });
  };
  const compileCondition = (where: MeasureCondition | undefined): Uint8Array | null => {
    if (where === undefined) return null;
    const column = columns[where.column];
    if (column === undefined) return null;
    const mask = new Uint8Array(rowCount);
    if (where.isNull === true) {
      for (let row = 0; row < rowCount; row++) {
        if (column.nullMask.get(row)) mask[row] = 1;
      }
      return mask;
    }
    if (where.values !== undefined) {
      const wanted = new Set(where.values.map((value) => value.trim()));
      for (let row = 0; row < rowCount; row++) {
        if (column.nullMask.get(row)) continue;
        const value = column.raw[row];
        if (value !== undefined && wanted.has(value.trim())) mask[row] = 1;
      }
      return mask;
    }
    const numbers = column.numbers();
    for (let row = 0; row < rowCount; row++) {
      const value = numbers[row];
      if (!Number.isFinite(value)) continue;
      if (where.min !== undefined && value < where.min) continue;
      if (where.max !== undefined && value > where.max) continue;
      mask[row] = 1;
    }
    return mask;
  };
  const measureSlotOffset: number[] = [];
  const measureTerms: ExprTerm[][] = [];
  const measureCompiled: (CompiledExpression | null)[] = [];
  const columnNames = columns.map((column) => column.name);
  for (const measure of measures) {
    measureSlotOffset.push(slots.length);
    const condition = compileCondition(measure.where);
    if (measure.agg === "expr") {
      const compiled = compileExpression(measure.expr ?? "", columnNames);
      if (compiled.ok) {
        measureCompiled.push(compiled.compiled);
        measureTerms.push(compiled.compiled.terms);
        for (const term of compiled.compiled.terms) {
          pushSlot(
            term.agg,
            term.column,
            term.column === null || columns[term.column] !== undefined,
            null,
            condition,
          );
        }
      } else {
        measureCompiled.push(null);
        measureTerms.push([]);
      }
    } else {
      measureCompiled.push(null);
      measureTerms.push([{ agg: measure.agg, column: measure.column, text: "" }]);
      pushSlot(
        measure.agg,
        measure.column,
        measure.column === null || columns[measure.column] !== undefined,
        measure.weight ?? null,
        condition,
      );
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
      dimensionInto(
        columns[dimensions[d].column],
        dimensions[d],
        row,
        keys,
        labels,
        ranks,
        times,
        dimBinEdges[d],
        dimRuntime[d],
      );
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
        const edges = dimBinEdges[d];
        const label = labels[d] ?? "";
        dimValues[d].push(
          label !== ""
            ? label
            : grain !== null
              ? timeLabel(times[d] ?? Number.NaN, grain, {
                  fiscalStartMonth: dimRuntime[d]?.fiscalStartMonth,
                })
              : edges !== null
                ? binLabel(edges, Number(keys[d] ?? "0"))
                : "(missing)",
        );
        dimRanks[d].push(ranks[d] ?? Number.NaN);
        dimTimes[d].push(times[d] ?? Number.NaN);
      }
      groupTimes.push(bucket ?? Number.NaN);
      accs.push(newSlotAccs());
      filled.push(false);
    }
    const groups = accs[index];

    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      if (slot.condition !== null && slot.condition[row] !== 1) continue;
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
          if (slot.weighted && slot.weights !== null) {
            const weight = slot.weights[row];
            if (!Number.isFinite(weight)) break;
            acc.sum += value * weight;
            acc.weight += weight;
            acc.count++;
            total.sum += value * weight;
            total.weight += weight;
            total.count++;
            break;
          }
          accumulateInto(acc, value);
          accumulateInto(total, value);
          break;
        }
      }
    }
  }

  // Calendar gap fill: an empty day/month is a real "0" on a time axis, not a
  // missing row, so insert groups for every bucket between the extremes. With
  // "carry" the inserted buckets keep the previous period's values instead.
  if (
    (view.fill === "zero" || view.fill === "carry") &&
    timeGrain !== null &&
    groupTimes.length > 0
  ) {
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
      dimValues[0].push(
        timeLabel(time, timeGrain, { fiscalStartMonth: dimRuntime[0]?.fiscalStartMonth }),
      );
      dimRanks[0].push(time);
      dimTimes[0].push(time);
      groupTimes.push(time);
      accs.push(newSlotAccs());
      filled.push(true);
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
    return Float64Array.from(accs, (group) =>
      finalise(group[offset], measure.agg, slots[offset]?.weighted ?? false),
    );
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
    return finalise(totalAccs[offset], measure.agg, slots[offset]?.weighted ?? false);
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
    if (view.sort.key === "source") return 0;
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
  // Incomplete edge periods: the first bucket is partial when the data starts
  // after the period did; the last when the period has not ended yet.
  const bucketOptions: BucketOptions = {
    weekStart: dimRuntime[0]?.weekStart,
    fiscalStartMonth: dimRuntime[0]?.fiscalStartMonth,
  };
  let finalShown = shown;
  let partials: boolean[] | null = null;
  if (timeGrain !== null && shown.length > 0) {
    // Edge partiality is judged from the raw timestamps, not the bucket starts.
    const numbers = columns[dimensions[0].column]?.numbers() ?? null;
    const shift = dimRuntime[0]?.shift ?? null;
    let rawMin = Infinity;
    let rawMax = -Infinity;
    if (numbers !== null) {
      for (let position = 0; position < ids.length; position++) {
        const row = ids[position];
        const value = numbers[row];
        if (!Number.isFinite(value)) continue;
        const shifted = shift === null ? value : shift(value);
        if (shifted < rawMin) rawMin = shifted;
        if (shifted > rawMax) rawMax = shifted;
      }
    }
    const firstBucket = Number.isFinite(rawMin)
      ? timeBucket(rawMin, timeGrain, bucketOptions)
      : Number.NaN;
    const lastBucket = Number.isFinite(rawMax)
      ? timeBucket(rawMax, timeGrain, bucketOptions)
      : Number.NaN;
    const lastEnd = nextBucket(lastBucket, timeGrain);
    const firstPartial = Number.isFinite(rawMin) && rawMin > firstBucket;
    const now = Date.now();
    const flagsFor = (indexes: readonly number[]): boolean[] =>
      indexes.map((index) => {
        const time = groupTimes[index] ?? Number.NaN;
        if (!Number.isFinite(time)) return false;
        if (firstPartial && time === firstBucket) return true;
        if (time === lastBucket && now < lastEnd) return true;
        return false;
      });
    partials = flagsFor(shown);
    if (view.partial === "exclude" && partials.some(Boolean)) {
      finalShown = shown.filter((_, position) => partials?.[position] !== true);
      partials = flagsFor(finalShown);
    }
  }
  const limited = finalMeasures.map((values) => {
    const out = new Float64Array(finalShown.length);
    for (let i = 0; i < finalShown.length; i++) out[i] = values[finalShown[i]];
    return out;
  });
  const shownTimes =
    timeGrain !== null ? finalShown.map((i) => groupTimes[i] ?? Number.NaN) : null;
  // Carry fill: inserted (empty) periods repeat the previous period's value.
  if (view.fill === "carry" && timeGrain !== null) {
    for (const values of limited) {
      let carried = Number.NaN;
      for (let i = 0; i < values.length; i++) {
        if (filled[finalShown[i] ?? 0] === true) {
          if (Number.isFinite(carried)) values[i] = carried;
        } else {
          carried = values[i];
        }
      }
    }
  }
  const measuresOut = limited.map((values, m) =>
    applyPost(values, measures[m].post ?? [], totals, m, shownTimes),
  );

  return {
    labels: finalShown.map((i) => dimensions.map((_, d) => dimValues[d][i]).join(" · ")),
    dimensions: dimensions.map((_, d) => finalShown.map((i) => dimValues[d][i])),
    dimensionNames: dimensions.map((spec) => {
      const base = columns[spec.column].name;
      const by = spec.by;
      if (typeof by === "object" && "time" in by) {
        const extras = [
          by.weekStart === 0 ? "Sun" : undefined,
          by.fiscalStartMonth !== undefined && by.fiscalStartMonth !== 1
            ? `FY from ${MONTH_LABELS[by.fiscalStartMonth - 1] ?? by.fiscalStartMonth}`
            : undefined,
          by.tz !== undefined && by.tz.trim() !== "" ? by.tz : undefined,
        ].filter((part): part is string => part !== undefined);
        return extras.length === 0
          ? `${base} (${by.time})`
          : `${base} (${by.time}, ${extras.join(", ")})`;
      }
      if (typeof by === "object" && "datePart" in by) return `${base} (${by.datePart})`;
      if (typeof by === "object" && "bin" in by) {
        const bin = by.bin;
        const suffix =
          "width" in bin ? `bin ${bin.width}` : "n" in bin ? `${bin.n} bins` : "bins";
        return `${base} (${suffix})`;
      }
      if (typeof by === "object" && "cohort" in by) {
        const entity = columns[by.cohort.entity]?.name ?? "?";
        return `${base} · cohort by ${entity} (${by.cohort.grain})`;
      }
      if (typeof by === "object" && "since" in by) {
        const entity = columns[by.since.entity]?.name ?? "?";
        return `periods since first ${entity} (${by.since.grain})`;
      }
      return base;
    }),
    dimensionIsTime: dimensions.map(
      (spec) => typeof spec.by === "object" && "time" in spec.by,
    ),
    dimensionTimes: dimTimes.map((values) =>
      Float64Array.from(finalShown, (i) => values[i]),
    ),
    measures: measuresOut,
    measureNames: measures.map((measure) => {
      const base =
        measure.agg === "expr"
          ? measure.expr ?? "expr"
          : measure.column === null
            ? "count(*)"
            : `${measure.agg}(${columns[measure.column]?.name ?? "?"})`;
      const weightName =
        measure.weight === undefined ? undefined : columns[measure.weight]?.name;
      const withWeight = weightName === undefined ? base : `${base} · weighted by ${weightName}`;
      const where = measure.where;
      if (where === undefined) return withWeight;
      const whereColumn = columns[where.column]?.name ?? "?";
      if (where.isNull === true) return `${withWeight} · where ${whereColumn} is empty`;
      if (where.values !== undefined) {
        const preview = where.values.slice(0, 3).join(", ");
        const suffix = where.values.length > 3 ? ` +${where.values.length - 3}` : "";
        return `${withWeight} · where ${whereColumn} in (${preview}${suffix})`;
      }
      const bounds = [
        where.min !== undefined ? `≥ ${where.min}` : undefined,
        where.max !== undefined ? `≤ ${where.max}` : undefined,
      ]
        .filter((part): part is string => part !== undefined)
        .join(" and ");
      return `${withWeight} · where ${whereColumn} ${bounds}`;
    }),
    totals,
    groupCount: finalShown.length,
    totalGroups: order.length,
    truncated,
    partials,
  };
}

/** A view is meaningful when it has at least one dimension and one measure. */
export function isCompleteView(view: ViewDef): boolean {
  return view.dimensions.length > 0 && view.measures.length > 0;
}
