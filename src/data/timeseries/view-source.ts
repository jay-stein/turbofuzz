/**
 * A Pivot View's result as a Time Series source. The view has already aggregated the
 * rows (group by a time grain, a measure, filters), so the page reads its periods as
 * they are: the time dimension becomes the date, each measure a column, and any other
 * dimension a column the series can be split by.
 */

import type { AggregateResult, ViewDef } from "../aggregate.js";
import type { TsInput } from "./base.js";
import type { ShapeCandidate } from "./shape.js";

/** What the page needs to offer a view as a source. */
export interface TsViewSource {
  id: string;
  name: string;
  /** Name of the view's time dimension, and its dataset column (clicking a period filters it). */
  timeName: string;
  timeColumn: number;
  /** Other dimensions, by their index in the view: the split choices. */
  splits: { index: number; name: string }[];
}

/** A view the page can read: complete, with a time dimension and at least one measure. */
export function timeDimension(view: ViewDef): number {
  return view.dimensions.findIndex((d) => typeof d.by === "object" && "time" in d.by);
}

/**
 * The view's periods as engine input. `split` is the index of a non-time dimension to
 * split by (-1 for none). Null when the result has no time dimension or too few periods.
 * The candidates let the shape check name a dimension behind repeated periods.
 */
export function viewSeriesInput(
  result: Pick<AggregateResult, "dimensions" | "dimensionNames" | "dimensionIsTime" | "dimensionTimes" | "measures" | "measureNames" | "partials">,
  split: number,
  /** Where the raw rows start and stop, and their usual spacing (ms): judges cut-short edge periods. */
  raw?: { min: number; max: number; step: number },
): { input: TsInput; candidates: ShapeCandidate[] } | null {
  const t = result.dimensionIsTime.indexOf(true);
  if (t < 0) return null;
  const times = result.dimensionTimes[t]!;
  const keep: number[] = [];
  for (let i = 0; i < times.length; i++) if (Number.isFinite(times[i])) keep.push(i);
  if (keep.length < 3) return null;

  const cols: Record<string, Float64Array> = {};
  result.measureNames.forEach((name, m) => {
    let key = name;
    for (let k = 2; key in cols; k++) key = `${name} (${k})`;
    cols[key] = Float64Array.from(keep, (i) => result.measures[m]![i]!);
  });

  let groups = ["all"];
  const rowGroup = new Uint16Array(keep.length);
  let groupCol: string | null = null;
  if (split >= 0 && split !== t && split < result.dimensions.length) {
    const labels = result.dimensions[split]!;
    groups = [...new Set(keep.map((i) => labels[i]!))].sort((a, b) => a.localeCompare(b));
    const code = new Map(groups.map((label, k) => [label, k]));
    keep.forEach((i, r) => { rowGroup[r] = code.get(labels[i]!) ?? 0; });
    groupCol = result.dimensionNames[split] ?? null;
  }

  // Only the first and last period can be cut short. The view flags a period that has not
  // ended yet; the raw rows also show a period the data stops (or starts) inside, as the
  // Table source does: covered less than 95% of its length, counting one usual row step.
  const starts = [...new Set(keep.map((i) => times[i]!))].sort((a, b) => a - b);
  const tMin = starts[0]!, tMax = starts[starts.length - 1]!;
  const partialAt = (edge: number): boolean => keep.some((i) => times[i] === edge && result.partials?.[i] === true);
  let cutFirst = false, cutLast = false;
  if (raw !== undefined && starts.length >= 2) {
    const firstLen = starts[1]! - tMin, lastLen = tMax - starts[starts.length - 2]!;
    cutFirst = firstLen > 0 && (tMin + firstLen - raw.min) / firstLen < 0.95;
    cutLast = lastLen > 0 && (raw.max + raw.step - tMax) / lastLen < 0.95;
  }
  const partialEdge = { first: partialAt(tMin) || cutFirst, last: partialAt(tMax) || cutLast };

  const candidates: ShapeCandidate[] = [];
  result.dimensions.forEach((labels, d) => {
    if (d === t) return;
    const code = new Map<string, number>();
    const codes = Int32Array.from(keep, (i) => {
      const label = labels[i]!;
      let c = code.get(label);
      if (c === undefined) { c = code.size; code.set(label, c); }
      return c;
    });
    candidates.push({ column: d, name: result.dimensionNames[d] ?? `Dimension ${d + 1}`, codes });
  });

  return {
    input: {
      times: Float64Array.from(keep, (i) => times[i]!),
      cols,
      flags: {},
      groups,
      rowGroup,
      groupCol,
      dateCol: result.dimensionNames[t] ?? "Period",
      dropped: times.length - keep.length,
      aggregated: true,
      partialEdge,
    },
    candidates,
  };
}
