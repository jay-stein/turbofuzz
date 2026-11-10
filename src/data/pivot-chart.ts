import type { AggregateResult, ViewDef } from "./aggregate.js";
import type { PivotDef, PivotResult } from "./pivot.js";

/**
 * A chart of a Pivot View: which of the pivot's fields runs along the axis, which one (if any)
 * splits it into series, and which value is drawn. Indexes point into the view's own
 * `dimensions` and `measures`, so the chart never keeps a copy of the pivot.
 */
export interface PivotChartShape {
  axis: number;
  /** -1: one series. */
  series: number;
  measure: number;
}

/** A pivot's field as the chart's pickers name it. */
export interface PivotChartField {
  name: string;
  zone: "rows" | "columns";
  time: boolean;
}

/** The view's dimensions laid out across the top (Columns), in order. */
export function pivotColumnIndexes(view: ViewDef): number[] {
  const valid = (index: number): boolean => Number.isInteger(index) && index >= 0 && index < view.dimensions.length;
  const columns = [...new Set((view.pivotColumns ?? []).filter(valid))].sort((a, b) => a - b);
  if (columns.length > 0) return columns;
  return view.pivot !== undefined && valid(view.pivot) ? [view.pivot] : [];
}

/**
 * Rows go along the axis and Columns become the series, the way the pivot is read. With no
 * Columns field a second Rows field is the series; a pivot with only Columns runs them along the axis.
 */
export function defaultPivotShape(view: ViewDef): PivotChartShape {
  const columns = pivotColumnIndexes(view);
  const rows = view.dimensions.map((_, index) => index).filter((index) => !columns.includes(index));
  const axis = rows[0] ?? columns[0] ?? 0;
  const series = columns.find((index) => index !== axis) ?? rows.find((index) => index !== axis) ?? -1;
  const measure = view.pivotMeasure ?? 0;
  return { axis, series, measure: measure >= 0 && measure < view.measures.length ? measure : 0 };
}

/** A shape made valid for the view as it is now: the pivot may have lost or gained fields since. */
export function fitPivotShape(view: ViewDef, shape: Partial<PivotChartShape> | undefined): PivotChartShape {
  const fallback = defaultPivotShape(view);
  const inRange = (index: number | undefined): index is number =>
    index !== undefined && Number.isInteger(index) && index >= 0 && index < view.dimensions.length;
  const axis = inRange(shape?.axis) ? shape.axis : fallback.axis;
  let series = shape?.series === -1 ? -1 : inRange(shape?.series) ? shape.series : fallback.series;
  if (series === axis) series = fallback.series === axis ? -1 : fallback.series;
  const measure =
    shape?.measure !== undefined && shape.measure >= 0 && shape.measure < view.measures.length
      ? shape.measure
      : fallback.measure;
  return { axis, series, measure };
}

/**
 * The pivot the chart needs, asked of the same computation the Pivot View uses: the axis field
 * as rows, the series field as columns, one value. Fields the chart does not use are left out and
 * so are worked out again from the rows, which is the only correct way to collapse an average or
 * a median. The pivot's own filters and its "respects filters" choice carry over; totals do not.
 */
export function pivotChartDef(view: ViewDef, shape: PivotChartShape): PivotDef | null {
  const axis = view.dimensions[shape.axis];
  const measure = view.measures[shape.measure];
  if (axis === undefined || measure === undefined) return null;
  const series = shape.series >= 0 ? view.dimensions[shape.series] : undefined;
  return {
    id: `${view.id}-chart`,
    name: view.name,
    index: [axis],
    columns: series === undefined ? [] : [series],
    values: [measure],
    respectFilters: view.respectFilters,
    margins: false,
    sort: view.pivotSort,
    valueFilters: view.pivotValueFilters,
  };
}

/**
 * The pivot's cells as the long list a chart draws: one entry per (axis value, series value) that
 * has a number. A category axis is ordered by its largest total first, a date axis in date order.
 */
export function pivotToAggregate(pivot: PivotResult): AggregateResult {
  const measure = pivot.measures[0];
  const rowCount = pivot.rowLabels.length;
  const colCount = Math.max(1, pivot.colLabels.length);
  const split = pivot.colNames.length > 0;
  const isTime = pivot.rowIsTime[0] === true;
  const rowTimes = pivot.rowTimes[0];
  const cell = (r: number, c: number): number => measure?.values[r * colCount + c] ?? Number.NaN;

  const order = Array.from({ length: rowCount }, (_, r) => r);
  if (!isTime) {
    const size = order.map((r) => {
      let total = 0;
      for (let c = 0; c < colCount; c++) {
        const value = cell(r, c);
        if (Number.isFinite(value)) total += Math.abs(value);
      }
      return total;
    });
    order.sort((a, b) => size[b] - size[a] || a - b);
  }

  const axis: string[] = [];
  const series: string[] = [];
  const times: number[] = [];
  const values: number[] = [];
  for (const r of order) {
    for (let c = 0; c < colCount; c++) {
      const value = cell(r, c);
      if (!Number.isFinite(value)) continue;
      axis.push(pivot.rowLabels[r]?.join(" · ") ?? "");
      series.push(pivot.colLabels[c]?.join(" · ") ?? "");
      times.push(rowTimes?.[r] ?? Number.NaN);
      values.push(value);
    }
  }
  const n = values.length;
  return {
    labels: split ? axis.map((label, i) => `${label} · ${series[i]}`) : axis,
    dimensions: split ? [axis, series] : [axis],
    dimensionNames: split ? [pivot.rowNames[0] ?? "", pivot.colNames.join(" · ")] : [pivot.rowNames[0] ?? ""],
    dimensionIsTime: split ? [isTime, false] : [isTime],
    dimensionTimes: split ? [Float64Array.from(times), new Float64Array(n).fill(Number.NaN)] : [Float64Array.from(times)],
    measures: [Float64Array.from(values)],
    measureNames: [measure?.name ?? ""],
    totals: Float64Array.of(measure?.grandTotal ?? Number.NaN),
    groupCount: n,
    totalGroups: n,
    truncated: pivot.truncated || pivot.truncatedColumns === true,
    partials: null,
  };
}

/**
 * A result with one dimension and several measures, as the long list a chart draws: each measure
 * becomes a series named `names[m]`, along the same axis. Two numbers over time are then two lines.
 */
export function measuresToSeries<T extends AggregateResult>(result: T, names: readonly string[]): T {
  const n = result.groupCount;
  const count = result.measures.length;
  const axis: string[] = [];
  const series: string[] = [];
  const times = new Float64Array(n * count);
  const values = new Float64Array(n * count);
  const axisLabels = result.dimensions[0] ?? [];
  const axisTimes = result.dimensionTimes[0];
  for (let i = 0; i < n; i++) {
    for (let m = 0; m < count; m++) {
      const at = i * count + m;
      axis.push(axisLabels[i] ?? "");
      series.push(names[m] ?? result.measureNames[m] ?? "");
      times[at] = axisTimes?.[i] ?? Number.NaN;
      values[at] = result.measures[m]?.[i] ?? Number.NaN;
    }
  }
  return {
    ...result,
    labels: axis.map((label, i) => `${label} · ${series[i]}`),
    dimensions: [axis, series],
    dimensionNames: [result.dimensionNames[0] ?? "", "value"],
    dimensionIsTime: [result.dimensionIsTime[0] === true, false],
    dimensionTimes: [times, new Float64Array(n * count).fill(Number.NaN)],
    measures: [values],
    measureNames: [result.measureNames[0] ?? ""],
    groupCount: n * count,
    totalGroups: n * count,
    partials: null,
  };
}
