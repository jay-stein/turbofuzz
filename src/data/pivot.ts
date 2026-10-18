import {
  computeAggregate,
  type DimensionSpec,
  type MeasureSpec,
  type PivotLambdaSpec,
  type ViewDef,
} from "./aggregate.js";
import type { ColumnData } from "./column.js";
import { compilePivotLambda } from "./pivot-lambda.js";

export interface PivotDef {
  id: string;
  name: string;
  /** Ordered row index fields (0-3 in the UI). */
  index: DimensionSpec[];
  /** Ordered column fields (0-3 in the UI). */
  columns: DimensionSpec[];
  /** One entry per value/aggregation pair. */
  values: MeasureSpec[];
  respectFilters: boolean;
  margins?: boolean;
  marginsName?: string;
  fillValue?: number | null;
  dropna?: boolean;
  /** Key ordering: label ascending or first-seen source order. */
  sort?: "label" | "source";
  /** Safe custom lambda values, appended after ordinary values. */
  lambdas?: PivotLambdaSpec[];
  marginPct?: "none" | "row" | "column";
  valueFilters?: { column: number; values: string[] }[];
}

export interface PivotMeasureResult {
  name: string;
  /** Row-major matrix: rowLabels.length * colLabels.length cells. */
  values: Float64Array;
  /** Margins over raw rows; null entries when margins are disabled. */
  rowTotals: Float64Array;
  colTotals: Float64Array;
  grandTotal: number;
}

export interface PivotResult {
  rowLabels: string[][];
  colLabels: string[][];
  rowNames: string[];
  colNames: string[];
  rowIsTime: boolean[];
  colIsTime: boolean[];
  rowTimes: Float64Array[];
  colTimes: Float64Array[];
  measures: PivotMeasureResult[];
  groupCount: number;
  totalGroups: number;
  truncated: boolean;
  ms: number;
}

const PIVOT_LIMIT = 250_000;
const SEP = "\u001f";

interface KeyedParts {
  key: string;
  parts: string[];
  times: Float64Array;
}

function baseView(
  def: PivotDef,
  dimensions: DimensionSpec[],
  suffix: string,
  measures: MeasureSpec[] = def.values,
): ViewDef {
  return {
    id: `${def.id}-${suffix}`,
    name: def.name,
    dimensions,
    measures,
    fill: "none",
    sort: { key: def.sort === "source" ? "source" : "dim0", dir: "asc" },
    limit: PIVOT_LIMIT + 1,
    respectFilters: def.respectFilters,
    partial: "show",
  };
}

function addKey(
  map: Map<string, number>,
  keys: KeyedParts[],
  parts: string[],
  times: Float64Array,
): void {
  const key = parts.join(SEP);
  if (map.has(key)) return;
  map.set(key, keys.length);
  keys.push({ key, parts, times });
}

function compareParts(a: KeyedParts, b: KeyedParts, isTime: readonly boolean[]): number {
  const length = Math.max(a.parts.length, b.parts.length);
  for (let level = 0; level < length; level++) {
    const left = a.parts[level] ?? "";
    const right = b.parts[level] ?? "";
    if (left === right) continue;
    if (isTime[level] === true) {
      const leftTime = a.times[level] ?? Number.NaN;
      const rightTime = b.times[level] ?? Number.NaN;
      const leftFinite = Number.isFinite(leftTime);
      const rightFinite = Number.isFinite(rightTime);
      if (leftFinite && rightFinite && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
    }
    return left.localeCompare(right, undefined, { numeric: true });
  }
  return 0;
}

function sortKeys(
  keys: KeyedParts[],
  isTime: readonly boolean[],
  mode: "label" | "source",
): KeyedParts[] {
  if (mode === "source") return keys;
  return [...keys].sort((a, b) => compareParts(a, b, isTime));
}

function timeAt(
  dimensionTimes: Float64Array[],
  dimensionIndex: number,
  group: number,
): number {
  return dimensionTimes[dimensionIndex]?.[group] ?? Number.NaN;
}

function measureValues(
  result: ReturnType<typeof computeAggregate>,
  measureCount: number,
): Float64Array[] {
  return result.measures.slice(0, measureCount);
}

function keyFromValues(
  dimensions: string[][],
  from: number,
  to: number,
  group: number,
): string[] {
  const parts: string[] = [];
  for (let dimension = from; dimension < to; dimension++) {
    parts.push(dimensions[dimension]?.[group] ?? "");
  }
  return parts;
}

function timesFrom(
  dimensionTimes: Float64Array[],
  from: number,
  to: number,
  group: number,
): Float64Array {
  const times = new Float64Array(Math.max(0, to - from));
  for (let dimension = from; dimension < to; dimension++) {
    times[dimension - from] = timeAt(dimensionTimes, dimension, group);
  }
  return times;
}

/**
 * Worker-side pivot assembly. The base aggregation runs over index + column
 * dimensions; row, column and grand margins are separate aggregate passes over
 * raw rows so non-additive measures stay correct.
 */
export function computePivot(
  def: PivotDef,
  columns: readonly ColumnData[],
  rowCount: number,
  ids: Uint32Array,
): PivotResult {
  const started = performance.now();
  const filters = (def.valueFilters ?? []).filter(
    (filter) => columns[filter.column] !== undefined,
  );
  if (filters.length > 0) {
    const sets = filters.map((filter) => ({
      column: filter.column,
      values: new Set(filter.values.map((value) => value.trim().toLowerCase())),
    }));
    ids = ids.filter((id) =>
      sets.every((filter) =>
        filter.values.has((columns[filter.column]?.raw[id] ?? "").trim().toLowerCase()),
      ),
    );
  }
  const indexCount = def.index.length;
  const columnCount = def.columns.length;
  const lambdaValues = (def.lambdas ?? []).map((lambda) => {
    const columnName = columns[lambda.column]?.name;
    if (columnName === undefined) throw new Error("Unknown lambda column.");
    const compiled = compilePivotLambda(lambda.source, columnName);
    if (!compiled.ok) throw new Error(compiled.error);
    return {
      measure: { column: null, agg: "expr", expr: compiled.expression } as MeasureSpec,
      label: lambda.label?.trim() || lambda.source.trim(),
    };
  });
  const measureDefs: MeasureSpec[] = [
    ...def.values,
    ...lambdaValues.map((value) => value.measure),
  ];
  const measureCount = measureDefs.length;
  const base = computeAggregate(
    baseView(def, [...def.index, ...def.columns], "base", measureDefs),
    columns,
    rowCount,
    ids,
  );

  const rowMap = new Map<string, number>();
  const colMap = new Map<string, number>();
  const rowKeys: KeyedParts[] = [];
  const colKeys: KeyedParts[] = [];
  const baseGroups = base.groupCount;
  const groupMeasures = measureValues(base, measureCount);
  const rowTimes: Float64Array[] = Array.from(
    { length: indexCount },
    () => new Float64Array(0),
  );
  const colTimes: Float64Array[] = Array.from(
    { length: columnCount },
    () => new Float64Array(0),
  );

  for (let group = 0; group < baseGroups; group++) {
    const rowParts = keyFromValues(base.dimensions, 0, indexCount, group);
    const colParts = keyFromValues(
      base.dimensions,
      indexCount,
      indexCount + columnCount,
      group,
    );
    addKey(
      rowMap,
      rowKeys,
      rowParts.length === 0 ? [""] : rowParts,
      timesFrom(base.dimensionTimes, 0, indexCount, group),
    );
    addKey(
      colMap,
      colKeys,
      colParts.length === 0 ? [""] : colParts,
      timesFrom(base.dimensionTimes, indexCount, indexCount + columnCount, group),
    );
  }
  if (rowKeys.length === 0) {
    addKey(rowMap, rowKeys, [""], new Float64Array(indexCount));
  }
  if (colKeys.length === 0) {
    addKey(colMap, colKeys, [""], new Float64Array(columnCount));
  }

  const rowIsTime = base.dimensionIsTime.slice(0, indexCount);
  const colIsTime = base.dimensionIsTime.slice(indexCount, indexCount + columnCount);
  const sortedRows = sortKeys(rowKeys, rowIsTime, def.sort ?? "label");
  const sortedCols = sortKeys(colKeys, colIsTime, def.sort ?? "label");
  const rowOrder = new Map(sortedRows.map((entry, index) => [entry.key, index]));
  const colOrder = new Map(sortedCols.map((entry, index) => [entry.key, index]));

  const matrices = Array.from(
    { length: measureCount },
    () => new Float64Array(sortedRows.length * sortedCols.length).fill(Number.NaN),
  );
  for (let group = 0; group < baseGroups; group++) {
    const rowKey = (keyFromValues(base.dimensions, 0, indexCount, group).join(SEP) || "");
    const colKey = (
      keyFromValues(base.dimensions, indexCount, indexCount + columnCount, group).join(SEP) || ""
    );
    const row = rowOrder.get(rowKey) ?? -1;
    const col = colOrder.get(colKey) ?? -1;
    if (row < 0 || col < 0) continue;
    for (let measure = 0; measure < measureCount; measure++) {
      const values = matrices[measure];
      if (values !== undefined) {
        values[row * sortedCols.length + col] =
          groupMeasures[measure]?.[group] ?? Number.NaN;
      }
    }
  }

  const visibleRows =
    def.dropna === true
      ? sortedRows.filter((_, row) =>
          matrices.some((values) =>
            sortedCols.some((_, col) => Number.isFinite(values[row * sortedCols.length + col])),
          ),
        )
      : sortedRows;
  const visibleCols =
    def.dropna === true
      ? sortedCols.filter((_, col) =>
          matrices.some((values) =>
            sortedRows.some((_, row) => Number.isFinite(values[row * sortedCols.length + col])),
          ),
        )
      : sortedCols;
  const margins = def.margins === true;
  const marginsName = def.marginsName?.trim() || "All";
  const addRowMargin = margins && indexCount > 0;
  const addColMargin = margins && columnCount > 0;
  const rowLabels = sortedRows.map((entry) => entry.parts);
  const colLabels = sortedCols.map((entry) => entry.parts);
  if (addRowMargin) rowLabels.push([marginsName]);
  if (addColMargin) colLabels.push([marginsName]);
  const rowCountOut = rowLabels.length;
  const colCountOut = colLabels.length;
  const rowTotalValues = Array.from(
    { length: measureCount },
    () => new Float64Array(rowCountOut).fill(Number.NaN),
  );
  const colTotalValues = Array.from(
    { length: measureCount },
    () => new Float64Array(colCountOut).fill(Number.NaN),
  );
  const grandTotals = new Float64Array(measureCount).fill(Number.NaN);
  const finalMatrices = Array.from(
    { length: measureCount },
    () => new Float64Array(rowCountOut * colCountOut).fill(Number.NaN),
  );
  const sourceRowIndex = new Map(sortedRows.map((entry, index) => [entry.key, index]));
  const sourceColIndex = new Map(sortedCols.map((entry, index) => [entry.key, index]));
  for (let measure = 0; measure < measureCount; measure++) {
    const source = matrices[measure];
    const target = finalMatrices[measure];
    if (source === undefined || target === undefined) continue;
    for (let row = 0; row < visibleRows.length; row++) {
      const sourceRow = sourceRowIndex.get(visibleRows[row]?.key ?? "") ?? -1;
      for (let col = 0; col < visibleCols.length; col++) {
        const sourceCol = sourceColIndex.get(visibleCols[col]?.key ?? "") ?? -1;
        if (sourceRow < 0 || sourceCol < 0) continue;
        target[row * colCountOut + col] =
          source[sourceRow * sortedCols.length + sourceCol] ?? Number.NaN;
      }
    }
  }

  if (margins || (def.marginPct ?? "none") !== "none") {
    const rowMargin = computeAggregate(
      baseView(def, def.index, "margin-rows", measureDefs),
      columns,
      rowCount,
      ids,
    );
    const colMargin = computeAggregate(
      baseView(def, def.columns, "margin-cols", measureDefs),
      columns,
      rowCount,
      ids,
    );
    const total = computeAggregate(
      baseView(def, [], "margin-total", measureDefs),
      columns,
      rowCount,
      ids,
    );
    const rowMarginMeasures = measureValues(rowMargin, measureCount);
    const colMarginMeasures = measureValues(colMargin, measureCount);

    const rowMapMargin = new Map<string, number>();
    for (let group = 0; group < rowMargin.groupCount; group++) {
      rowMapMargin.set(
        keyFromValues(rowMargin.dimensions, 0, indexCount, group).join(SEP) || "",
        group,
      );
    }
    const colMapMargin = new Map<string, number>();
    for (let group = 0; group < colMargin.groupCount; group++) {
      colMapMargin.set(
        keyFromValues(colMargin.dimensions, 0, columnCount, group).join(SEP) || "",
        group,
      );
    }
    for (let measure = 0; measure < measureCount; measure++) {
      const rowValuesMeasure = rowMarginMeasures[measure];
      const colValuesMeasure = colMarginMeasures[measure];

      for (let row = 0; row < sortedRows.length; row++) {
        const group = rowMapMargin.get(sortedRows[row]?.key ?? "");
        rowTotalValues[measure]![row] =
          group === undefined ? Number.NaN : (rowValuesMeasure?.[group] ?? Number.NaN);
      }
      for (let col = 0; col < sortedCols.length; col++) {
        const group = colMapMargin.get(sortedCols[col]?.key ?? "");
        colTotalValues[measure]![col] =
          group === undefined ? Number.NaN : (colValuesMeasure?.[group] ?? Number.NaN);
      }
      const grand = total.totals[measure] ?? Number.NaN;
      grandTotals[measure] = grand;
      if (addRowMargin) {
        rowTotalValues[measure]![sortedRows.length] = grand;
        for (let col = 0; col < sortedCols.length; col++) {
          finalMatrices[measure]![sortedRows.length * colCountOut + col] =
            colTotalValues[measure]?.[col] ?? Number.NaN;
        }
      }
      if (addColMargin) {
        colTotalValues[measure]![sortedCols.length] = grand;
        for (let row = 0; row < sortedRows.length; row++) {
          finalMatrices[measure]![row * colCountOut + sortedCols.length] =
            rowTotalValues[measure]?.[row] ?? Number.NaN;
        }
      }
      if (addRowMargin && addColMargin) {
        finalMatrices[measure]![visibleRows.length * colCountOut + visibleCols.length] =
          grand;
      }
    }
  }

  for (let level = 0; level < indexCount; level++) {
    rowTimes[level] = Float64Array.from(
      rowLabels.slice(0, sortedRows.length).map((_, index) => {
        const time = sortedRows[index]?.times[level] ?? Number.NaN;
        return Number.isFinite(time) ? time : Number.NaN;
      }),
    );
    if (addRowMargin) {
      const extended = new Float64Array(rowTimes[level].length + 1).fill(Number.NaN);
      extended.set(rowTimes[level], 0);
      rowTimes[level] = extended;
    }
  }
  for (let level = 0; level < columnCount; level++) {
    colTimes[level] = Float64Array.from(
      colLabels.slice(0, sortedCols.length).map((_, index) => {
        const time = sortedCols[index]?.times[level] ?? Number.NaN;
        return Number.isFinite(time) ? time : Number.NaN;
      }),
    );
    if (addColMargin) {
      const extended = new Float64Array(colTimes[level].length + 1).fill(Number.NaN);
      extended.set(colTimes[level], 0);
      colTimes[level] = extended;
    }
  }

  const measures: PivotMeasureResult[] = [];
  const names = [...base.measureNames];
  lambdaValues.forEach((value, index) => {
    names[def.values.length + index] = value.label;
  });
  for (let measure = 0; measure < measureCount; measure++) {
    measures.push({
      name: names[measure] ?? `measure ${measure + 1}`,
      values: finalMatrices[measure] ?? new Float64Array(0),
      rowTotals: rowTotalValues[measure] ?? new Float64Array(0),
      colTotals: colTotalValues[measure] ?? new Float64Array(0),
      grandTotal: grandTotals[measure] ?? Number.NaN,
    });
  }

  return {
    rowLabels,
    colLabels,
    rowNames: base.dimensionNames.slice(0, indexCount),
    colNames: base.dimensionNames.slice(indexCount, indexCount + columnCount),
    rowIsTime,
    colIsTime,
    rowTimes,
    colTimes,
    measures,
    groupCount: base.groupCount,
    totalGroups: base.totalGroups,
    truncated: base.truncated,
    ms: performance.now() - started,
  };
}
