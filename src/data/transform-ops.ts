import { datasetFromColumns } from "./build.js";
import { ColumnData } from "./column.js";
import { formatNumber } from "./format.js";
import { knnImpute } from "./knn.js";
import { hashRows, rowsEqual } from "./stats.js";
import { isNullToken } from "../parse/null-tokens.js";
import { parseNumber } from "../parse/numbers.js";
import type { Dataset } from "./dataset.js";

export type Aggregate = "count" | "sum" | "mean" | "min" | "max" | "median";
export type DedupeKeep = "first" | "last" | "none";

export type ImputeStrategy =
  | { kind: "constant"; value: string }
  | { kind: "mean" }
  | { kind: "median" }
  | { kind: "mode" }
  | { kind: "forward" }
  | { kind: "backward" };

export type TransformOp =
  | { kind: "dedupe"; keep: DedupeKeep }
  | { kind: "round"; column: number; decimals: number }
  | { kind: "groupBy"; dimension: number; measure: number | null; aggregate: Aggregate }
  | { kind: "impute"; column: number; strategy: ImputeStrategy; groupColumn: number | null }
  | { kind: "knn"; fill: number[]; predictors: number[]; k: number }
  | {
      kind: "melt";
      idVars: number[];
      valueVars: number[];
      varName: string;
      valueName: string;
    };

export interface ColumnSchema {
  name: string;
  numeric: boolean;
}

export const AGGREGATES: readonly Aggregate[] = ["count", "sum", "mean", "min", "max", "median"];

export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  count: "Count",
  sum: "Sum",
  mean: "Mean",
  min: "Min",
  max: "Max",
  median: "Median",
};

export const DEDUPE_LABELS: Record<DedupeKeep, string> = {
  first: "Keep first copy",
  last: "Keep last copy",
  none: "Remove all copies",
};

const MAX_DECIMALS = 12;
const MAX_MELT_ROWS = 2_000_000;

interface GroupAccumulator {
  count: number;
  finite: number;
  sum: number;
  min: number;
  max: number;
  values: number[] | null;
}

/** Applies an ordered op list to a base column set and rebuilds the dataset. */
export function applyTransformOps(
  name: string,
  columns: readonly ColumnData[],
  ops: readonly TransformOp[],
): Dataset {
  let current: readonly ColumnData[] = columns;
  for (const op of ops) {
    switch (op.kind) {
      case "dedupe":
        current = dedupeColumns(current, op.keep);
        break;
      case "round":
        current = roundColumn(current, op);
        break;
      case "groupBy":
        current = groupByColumns(current, op);
        break;
      case "impute":
        current = imputeColumns(current, op);
        break;
      case "knn":
        current = knnImpute(current, op.fill, op.predictors, op.k);
        break;
      case "melt":
        current = meltColumns(current, op);
        break;
    }
  }
  return datasetFromColumns(name, current.slice());
}

function rebuildColumn(column: ColumnData, raw: string[]): ColumnData {
  const rebuilt = ColumnData.create(column.name, raw);
  rebuilt.setType(column.type);
  return rebuilt;
}

function replaceColumn(
  columns: readonly ColumnData[],
  index: number,
  column: ColumnData,
  raw: string[],
): ColumnData[] {
  const next = columns.slice();
  next[index] = rebuildColumn(column, raw);
  return next;
}

function filterRaw(raw: readonly string[], mask: Uint8Array): string[] {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) count++;
  }
  const out = new Array<string>(count);
  let k = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) out[k++] = raw[i];
  }
  return out;
}

/**
 * Groups rows by exact content using the same hash-then-compare strategy as
 * duplicate detection, so equality is exact without building row-key strings.
 */
function rowGroups(columns: readonly ColumnData[], rowCount: number): number[][] {
  const hashes = hashRows(columns, rowCount);
  const buckets = new Map<number, { id: number; rep: number }[]>();
  const groups: number[][] = [];
  const columnCount = columns.length;

  for (let row = 0; row < rowCount; row++) {
    const hash = hashes[row];
    let bucket = buckets.get(hash);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(hash, bucket);
    }
    let id = -1;
    for (const entry of bucket) {
      if (rowsEqual(columns, row, entry.rep, columnCount)) {
        id = entry.id;
        break;
      }
    }
    if (id === -1) {
      id = groups.length;
      groups.push([]);
      bucket.push({ id, rep: row });
    }
    groups[id].push(row);
  }
  return groups;
}

function dedupeColumns(columns: readonly ColumnData[], keep: DedupeKeep): ColumnData[] {
  const rowCount = columns.length > 0 ? columns[0].raw.length : 0;
  if (rowCount === 0) return columns.slice();
  const groups = rowGroups(columns, rowCount);
  const mask = new Uint8Array(rowCount);
  for (const group of groups) {
    if (keep === "none") {
      if (group.length === 1) mask[group[0]] = 1;
    } else if (keep === "first") {
      mask[group[0]] = 1;
    } else {
      mask[group[group.length - 1]] = 1;
    }
  }
  return columns.map((column) => rebuildColumn(column, filterRaw(column.raw, mask)));
}

function roundColumn(
  columns: readonly ColumnData[],
  op: TransformOp & { kind: "round" },
): ColumnData[] {
  const column = columns[op.column];
  if (column === undefined) return columns.slice();
  const decimals = Math.max(-MAX_DECIMALS, Math.min(MAX_DECIMALS, Math.round(op.decimals)));
  const factor = 10 ** -decimals;
  const raw = new Array<string>(column.raw.length);
  for (let i = 0; i < column.raw.length; i++) {
    const value = column.raw[i];
    const parsed = parseNumber(value);
    if (!Number.isFinite(parsed)) {
      raw[i] = value;
      continue;
    }
    // Negative decimals round to the left (e.g. -1 -> nearest 10).
    raw[i] =
      decimals >= 0 ? parsed.toFixed(decimals) : String(Math.round(parsed / factor) * factor);
  }
  return replaceColumn(columns, op.column, column, raw);
}

function groupByColumns(
  columns: readonly ColumnData[],
  op: TransformOp & { kind: "groupBy" },
): ColumnData[] {
  const dimension = columns[op.dimension];
  if (dimension === undefined) return columns.slice();
  const measure = op.measure === null ? null : columns[op.measure];
  const measureNumbers = measure === null ? null : measure.numbers();

  const groups = new Map<string, GroupAccumulator>();
  const order: string[] = [];
  for (let row = 0; row < dimension.raw.length; row++) {
    const key = dimension.raw[row];
    let acc = groups.get(key);
    if (acc === undefined) {
      acc = {
        count: 0,
        finite: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        values: op.aggregate === "median" ? [] : null,
      };
      groups.set(key, acc);
      order.push(key);
    }
    acc.count++;
    if (measureNumbers !== null) {
      const value = measureNumbers[row];
      if (Number.isFinite(value)) {
        acc.finite++;
        acc.sum += value;
        if (value < acc.min) acc.min = value;
        if (value > acc.max) acc.max = value;
        acc.values?.push(value);
      }
    }
  }

  const keys = order.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const groupRaw = new Array<string>(keys.length);
  const aggregateRaw = new Array<string>(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const acc = groups.get(keys[i]) as GroupAccumulator;
    groupRaw[i] = keys[i];
    aggregateRaw[i] = aggregateValue(op.aggregate, acc);
  }

  const measureName = measure === null ? null : measure.name;
  return [
    ColumnData.create(dimension.name, groupRaw),
    ColumnData.create(aggregateHeader(op.aggregate, measureName), aggregateRaw),
  ];
}

function aggregateValue(aggregate: Aggregate, acc: GroupAccumulator): string {
  if (aggregate === "count") return String(acc.count);
  if (acc.finite === 0) return "";
  switch (aggregate) {
    case "sum":
      return formatNumber(acc.sum);
    case "mean":
      return formatNumber(acc.sum / acc.finite);
    case "min":
      return formatNumber(acc.min);
    case "max":
      return formatNumber(acc.max);
    case "median": {
      const values = acc.values ?? [];
      if (values.length === 0) return "";
      values.sort((a, b) => a - b);
      const mid = values.length >>> 1;
      const median = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
      return formatNumber(median);
    }
  }
}

function aggregateHeader(aggregate: Aggregate, measureName: string | null): string {
  if (measureName === null) return AGGREGATE_LABELS[aggregate];
  return `${AGGREGATE_LABELS[aggregate]}(${measureName})`;
}

function imputeColumns(
  columns: readonly ColumnData[],
  op: TransformOp & { kind: "impute" },
): ColumnData[] {
  const column = columns[op.column];
  if (column === undefined) return columns.slice();
  const raw = column.raw.slice();
  const strategy = op.strategy;

  if (strategy.kind === "forward" || strategy.kind === "backward") {
    if (strategy.kind === "forward") {
      let last: string | null = null;
      for (let i = 0; i < raw.length; i++) {
        if (isNullToken(raw[i])) {
          if (last !== null) raw[i] = last;
        } else {
          last = raw[i];
        }
      }
    } else {
      let next: string | null = null;
      for (let i = raw.length - 1; i >= 0; i--) {
        if (isNullToken(raw[i])) {
          if (next !== null) raw[i] = next;
        } else {
          next = raw[i];
        }
      }
    }
    return replaceColumn(columns, op.column, column, raw);
  }

  const numbers = column.numbers();
  if (op.groupColumn === null) {
    const fill = computeFill(column, numbers, strategy, null);
    if (fill !== null) {
      for (let i = 0; i < raw.length; i++) {
        if (isNullToken(raw[i])) raw[i] = fill;
      }
    }
  } else {
    const group = columns[op.groupColumn];
    if (group !== undefined) {
      const groups = new Map<string, number[]>();
      for (let i = 0; i < group.raw.length; i++) {
        const key = group.raw[i];
        let rows = groups.get(key);
        if (rows === undefined) {
          rows = [];
          groups.set(key, rows);
        }
        rows.push(i);
      }
      const fallback = computeFill(column, numbers, strategy, null);
      for (const rows of groups.values()) {
        const fill = computeFill(column, numbers, strategy, rows) ?? fallback;
        if (fill === null) continue;
        for (const row of rows) {
          if (isNullToken(raw[row])) raw[row] = fill;
        }
      }
    }
  }
  return replaceColumn(columns, op.column, column, raw);
}

/**
 * pandas-style melt: unpivots value columns into (variable, value) pairs while
 * keeping id columns. Value columns default to every non-id column. Row order
 * is variable-major, matching pandas.
 */
function meltColumns(
  columns: readonly ColumnData[],
  op: TransformOp & { kind: "melt" },
): ColumnData[] {
  const columnCount = columns.length;
  const idVars = op.idVars.filter((index) => index >= 0 && index < columnCount);
  const idSet = new Set(idVars);
  const valueVars = (
    op.valueVars.length > 0
      ? op.valueVars
      : columns.map((_, index) => index).filter((index) => !idSet.has(index))
  ).filter((index) => index >= 0 && index < columnCount);
  if (valueVars.length === 0) return columns.slice();

  const rowCount = columnCount > 0 ? columns[0].raw.length : 0;
  const outRows = rowCount * valueVars.length;
  if (outRows > MAX_MELT_ROWS) {
    throw new Error(
      `Melt would create ${outRows.toLocaleString()} rows (limit ${MAX_MELT_ROWS.toLocaleString()})`,
    );
  }

  const varName = op.varName.trim() === "" ? "variable" : op.varName.trim();
  const valueName = op.valueName.trim() === "" ? "value" : op.valueName.trim();

  const idRaw = idVars.map(() => new Array<string>(outRows));
  const varRaw = new Array<string>(outRows);
  const valueRaw = new Array<string>(outRows);

  let cursor = 0;
  for (const valueIndex of valueVars) {
    const valueColumn = columns[valueIndex];
    const label = valueColumn.name;
    for (let row = 0; row < rowCount; row++) {
      for (let i = 0; i < idVars.length; i++) {
        idRaw[i][cursor] = columns[idVars[i]].raw[row];
      }
      varRaw[cursor] = label;
      valueRaw[cursor] = valueColumn.raw[row];
      cursor++;
    }
  }

  const out: ColumnData[] = idVars.map((index, i) => {
    const rebuilt = ColumnData.create(columns[index].name, idRaw[i]);
    rebuilt.setType(columns[index].type);
    return rebuilt;
  });
  out.push(ColumnData.create(varName, varRaw), ColumnData.create(valueName, valueRaw));
  return out;
}

/** Computes the fill value for a strategy, optionally over a row subset. */
function computeFill(
  column: ColumnData,
  numbers: Float64Array,
  strategy: ImputeStrategy,
  rows: readonly number[] | null,
): string | null {
  switch (strategy.kind) {
    case "constant":
      return strategy.value;
    case "mean":
    case "median": {
      const values: number[] = [];
      const collect = (row: number): void => {
        const value = numbers[row];
        if (Number.isFinite(value)) values.push(value);
      };
      if (rows === null) {
        for (let i = 0; i < numbers.length; i++) collect(i);
      } else {
        for (const row of rows) collect(row);
      }
      if (values.length === 0) return null;
      if (strategy.kind === "mean") {
        let sum = 0;
        for (const value of values) sum += value;
        return formatNumber(sum / values.length);
      }
      values.sort((a, b) => a - b);
      const mid = values.length >>> 1;
      const median = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
      return formatNumber(median);
    }
    case "mode": {
      const counts = new Map<string, number>();
      const collect = (row: number): void => {
        const value = column.raw[row];
        if (!isNullToken(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
      };
      if (rows === null) {
        for (let i = 0; i < column.raw.length; i++) collect(i);
      } else {
        for (const row of rows) collect(row);
      }
      let best: string | null = null;
      let bestCount = 0;
      for (const [label, count] of counts) {
        if (best === null || count > bestCount || (count === bestCount && label < best)) {
          best = label;
          bestCount = count;
        }
      }
      return best;
    }
    default:
      return null;
  }
}

function strategyLabel(strategy: ImputeStrategy): string {
  switch (strategy.kind) {
    case "constant":
      return `“${strategy.value}”`;
    case "mean":
      return "mean";
    case "median":
      return "median";
    case "mode":
      return "mode";
    case "forward":
      return "previous value";
    case "backward":
      return "next value";
  }
}

export function describeTransformOp(op: TransformOp, headers: readonly string[]): string {
  switch (op.kind) {
    case "dedupe":
      return DEDUPE_LABELS[op.keep];
    case "round": {
      const name = headers[op.column] ?? `#${op.column + 1}`;
      return `Round ${name} to ${op.decimals} decimal place${op.decimals === 1 ? "" : "s"}`;
    }
    case "groupBy": {
      const dimension = headers[op.dimension] ?? `#${op.dimension + 1}`;
      const measure = op.measure === null ? null : headers[op.measure] ?? `#${op.measure + 1}`;
      const label = AGGREGATE_LABELS[op.aggregate];
      return measure === null
        ? `${label} per ${dimension}`
        : `${label} of ${measure} by ${dimension}`;
    }
    case "impute": {
      const name = headers[op.column] ?? `#${op.column + 1}`;
      const group =
        op.groupColumn === null ? "" : ` by ${headers[op.groupColumn] ?? `#${op.groupColumn + 1}`}`;
      return `Fill ${name} with ${strategyLabel(op.strategy)}${group}`;
    }
    case "knn": {
      const count = op.fill.length;
      return `KNN impute ${count} column${count === 1 ? "" : "s"} (k=${op.k})`;
    }
    case "melt": {
      const idNames = op.idVars.map((index) => headers[index] ?? `#${index + 1}`);
      const valueCount =
        op.valueVars.length > 0 ? op.valueVars.length : Math.max(0, headers.length - op.idVars.length);
      return `Melt ${valueCount} column${valueCount === 1 ? "" : "s"} to long (id: ${idNames.join(", ") || "none"})`;
    }
  }
}

/** Schema produced by applying an op, used by the UI to chain steps. */
export function schemaAfter(schema: readonly ColumnSchema[], op: TransformOp): ColumnSchema[] {
  switch (op.kind) {
    case "dedupe":
    case "round":
    case "impute":
    case "knn":
      return schema.slice();
    case "groupBy": {
      const dimension = schema[op.dimension];
      const measure = op.measure === null ? null : schema[op.measure];
      return [
        {
          name: dimension?.name ?? `Column ${op.dimension + 1}`,
          numeric: dimension?.numeric ?? false,
        },
        { name: aggregateHeader(op.aggregate, measure?.name ?? null), numeric: true },
      ];
    }
    case "melt": {
      const idSet = new Set(op.idVars);
      const valueVars = (
        op.valueVars.length > 0
          ? op.valueVars
          : schema.map((_, index) => index).filter((index) => !idSet.has(index))
      ).filter((index) => index >= 0 && index < schema.length);
      const numeric =
        valueVars.length > 0 && valueVars.every((index) => schema[index]?.numeric === true);
      const idSchema = op.idVars
        .filter((index) => index >= 0 && index < schema.length)
        .map((index) => ({ name: schema[index].name, numeric: schema[index].numeric }));
      return [
        ...idSchema,
        { name: op.varName.trim() || "variable", numeric: false },
        { name: op.valueName.trim() || "value", numeric },
      ];
    }
  }
}
