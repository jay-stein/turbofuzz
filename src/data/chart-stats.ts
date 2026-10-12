export interface BoxGroupStats {
  label: string;
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: Float64Array;
  other: boolean;
}

export interface BoxStatsResult {
  groups: BoxGroupStats[];
  total: number;
  missing: number;
}

export interface BoxStatsOptions {
  topN: number;
  groupOther: boolean;
  outlierCap?: number;
}

export interface CrossTabResult {
  xLabels: string[];
  yLabels: string[];
  counts: Uint32Array;
  total: number;
}

export interface CrossTabOptions {
  topX: number;
  topY: number;
  groupOther: boolean;
}

export interface CorrelationResult {
  values: Float64Array;
  counts: Uint32Array;
}

const DEFAULT_OUTLIER_CAP = 400;

function percentile(sorted: Float64Array, q: number): number {
  const length = sorted.length;
  if (length === 1) return sorted[0];
  const position = (length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function sampleOutliers(sorted: Float64Array, low: number, high: number, cap: number): Float64Array {
  const count = low + (sorted.length - 1 - high);
  if (count === 0) return new Float64Array(0);
  if (count <= cap) {
    const out = new Float64Array(count);
    let index = 0;
    for (let i = 0; i < low; i++) out[index++] = sorted[i];
    for (let i = high + 1; i < sorted.length; i++) out[index++] = sorted[i];
    return out;
  }
  const out = new Float64Array(cap);
  const step = count / cap;
  for (let index = 0; index < cap; index++) {
    const position = Math.min(count - 1, Math.floor(index * step));
    out[index] = position < low ? sorted[position] : sorted[high + 1 + (position - low)];
  }
  return out;
}

/**
 * Five-number summaries (Tukey box: q1-q3 box, 1.5×IQR whiskers, sampled
 * outliers) for the top N categories by volume plus an optional Other bucket.
 */
export function computeBoxStats(
  values: Float64Array,
  codes: Uint16Array,
  labels: readonly string[],
  ids: Uint32Array,
  options: BoxStatsOptions,
): BoxStatsResult {
  const topN = Math.max(1, Math.floor(options.topN) || 5);
  const cap = Math.max(0, Math.floor(options.outlierCap ?? DEFAULT_OUTLIER_CAP));
  const labelCount = labels.length;
  const counts = new Uint32Array(labelCount);
  let total = 0;
  let missing = 0;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const value = values[id];
    if (!Number.isFinite(value)) {
      missing++;
      continue;
    }
    const code = codes[id];
    if (code < labelCount) counts[code]++;
    total++;
  }

  const order: number[] = [];
  for (let code = 0; code < labelCount; code++) {
    if (counts[code] > 0) order.push(code);
  }
  order.sort((a, b) => counts[b] - counts[a]);

  const selected = order.slice(0, topN);
  const rest = order.slice(topN);
  const definitions: { codes: number[]; label: string; other: boolean }[] = selected.map((code) => ({
    codes: [code],
    label: labels[code] ?? "(empty)",
    other: false,
  }));
  if (options.groupOther && rest.length > 0) {
    definitions.push({ codes: rest, label: "Other", other: true });
  }

  const buffers = definitions.map(
    (definition) => new Float64Array(definition.codes.reduce((sum, code) => sum + counts[code], 0)),
  );
  const fills = new Uint32Array(definitions.length);
  const codeToGroup = new Map<number, number>();
  definitions.forEach((definition, index) => {
    for (const code of definition.codes) codeToGroup.set(code, index);
  });

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const value = values[id];
    if (!Number.isFinite(value)) continue;
    const group = codeToGroup.get(codes[id]);
    if (group === undefined) continue;
    buffers[group][fills[group]++] = value;
  }

  const groups: BoxGroupStats[] = definitions.map((definition, index) => {
    const sorted = buffers[index];
    sorted.sort();
    const q1 = percentile(sorted, 0.25);
    const median = percentile(sorted, 0.5);
    const q3 = percentile(sorted, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;
    let low = 0;
    while (low < sorted.length && sorted[low] < lowFence) low++;
    let high = sorted.length - 1;
    while (high >= 0 && sorted[high] > highFence) high--;
    return {
      label: definition.label,
      count: sorted.length,
      min: sorted[0] ?? 0,
      q1,
      median,
      q3,
      max: sorted[sorted.length - 1] ?? 0,
      whiskerLow: low < sorted.length ? sorted[low] : sorted[0] ?? 0,
      whiskerHigh: high >= 0 ? sorted[high] : sorted[sorted.length - 1] ?? 0,
      outliers: sampleOutliers(sorted, low, high, cap),
      other: definition.other,
    };
  });

  return { groups, total, missing };
}

/** Counts of every x-category × y-category pair, top N each plus Other. */
export function computeCrossTab(
  xCodes: Uint16Array,
  yCodes: Uint16Array,
  xLabels: readonly string[],
  yLabels: readonly string[],
  ids: Uint32Array,
  options: CrossTabOptions,
): CrossTabResult {
  const topX = Math.max(1, Math.floor(options.topX) || 8);
  const topY = Math.max(1, Math.floor(options.topY) || 8);
  const xCounts = new Uint32Array(xLabels.length);
  const yCounts = new Uint32Array(yLabels.length);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const x = xCodes[id];
    const y = yCodes[id];
    if (x < xCounts.length) xCounts[x]++;
    if (y < yCounts.length) yCounts[y]++;
  }

  const xOrder: number[] = [];
  for (let code = 0; code < xCounts.length; code++) if (xCounts[code] > 0) xOrder.push(code);
  xOrder.sort((a, b) => xCounts[b] - xCounts[a]);
  const yOrder: number[] = [];
  for (let code = 0; code < yCounts.length; code++) if (yCounts[code] > 0) yOrder.push(code);
  yOrder.sort((a, b) => yCounts[b] - yCounts[a]);

  const xSelected = xOrder.slice(0, topX);
  const ySelected = yOrder.slice(0, topY);
  const xOther = options.groupOther && xOrder.length > xSelected.length;
  const yOther = options.groupOther && yOrder.length > ySelected.length;

  const xIndex = new Map<number, number>();
  xSelected.forEach((code, index) => xIndex.set(code, index));
  if (xOther) for (const code of xOrder.slice(topX)) xIndex.set(code, xSelected.length);
  const yIndex = new Map<number, number>();
  ySelected.forEach((code, index) => yIndex.set(code, index));
  if (yOther) for (const code of yOrder.slice(topY)) yIndex.set(code, ySelected.length);

  const xTotal = xSelected.length + (xOther ? 1 : 0);
  const yTotal = ySelected.length + (yOther ? 1 : 0);
  const counts = new Uint32Array(Math.max(1, xTotal) * Math.max(1, yTotal));

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const x = xIndex.get(xCodes[id]);
    const y = yIndex.get(yCodes[id]);
    if (x === undefined || y === undefined) continue;
    counts[y * xTotal + x]++;
  }

  const xLabelsOut = xSelected.map((code) => xLabels[code] ?? "(empty)");
  if (xOther) xLabelsOut.push("Other");
  const yLabelsOut = ySelected.map((code) => yLabels[code] ?? "(empty)");
  if (yOther) yLabelsOut.push("Other");

  return { xLabels: xLabelsOut, yLabels: yLabelsOut, counts, total: ids.length };
}

/**
 * Pearson correlation for every pair of the given numeric columns over the
 * filtered row order, using pairwise-complete observations. NaN marks a pair
 * whose variance is zero, so the renderer can show it as undefined.
 */
export function computeCorrelation(
  columns: readonly Float64Array[],
  ids: Uint32Array,
): CorrelationResult {
  const count = columns.length;
  const values = new Float64Array(count * count);
  const counts = new Uint32Array(count * count);

  for (let i = 0; i < count; i++) {
    let seen = 0;
    const valuesI = columns[i];
    for (let r = 0; r < ids.length; r++) {
      if (Number.isFinite(valuesI[ids[r]])) seen++;
    }
    values[i * count + i] = 1;
    counts[i * count + i] = seen;
  }

  for (let i = 0; i < count; i++) {
    const valuesI = columns[i];
    for (let j = i + 1; j < count; j++) {
      const valuesJ = columns[j];
      let seen = 0;
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumXX = 0;
      let sumYY = 0;
      for (let r = 0; r < ids.length; r++) {
        const id = ids[r];
        const x = valuesI[id];
        const y = valuesJ[id];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        seen++;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
        sumYY += y * y;
      }
      const numerator = seen * sumXY - sumX * sumY;
      const denominator = Math.sqrt((seen * sumXX - sumX * sumX) * (seen * sumYY - sumY * sumY));
      const r = seen > 1 && denominator > 0 ? numerator / denominator : Number.NaN;
      values[i * count + j] = r;
      values[j * count + i] = r;
      counts[i * count + j] = seen;
      counts[j * count + i] = seen;
    }
  }

  return { values, counts };
}
