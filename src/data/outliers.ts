import type { ColumnData } from "./column.js";

/**
 * Multivariate outlier analysis for the Outliers lens.
 *
 * Everything here is deterministic: the same rows, columns, seed and mode
 * produce the same scores. The three methods share one prepared numeric
 * matrix (robust scaling, log1p for skewed positives, complete-case rows) so
 * Isolation Forest and PCA can reuse the same work.
 */

export type OutlierMethod = "isolationForest" | "pca" | "lof";
export type OutlierMode = "quick" | "deep";

export interface OutlierOptions {
  method: OutlierMethod;
  /** Numeric column indexes to include (2+ for multivariate methods). */
  columns: number[];
  /** Share of scored rows to flag (0.01 = top 1%). */
  contamination: number;
  mode: OutlierMode;
  trees?: number;
  sampleSize?: number;
  neighbors?: number;
  components?: number;
  seed?: number;
}

export interface OutlierContribution {
  column: number;
  label: string;
  /** Raw numeric value for the row. */
  value: number;
  /** Relative share of this row's anomaly explanation (0-1). */
  contribution: number;
}

export interface OutlierRowDetail {
  row: number;
  score: number;
  contributions: OutlierContribution[];
  /** Raw display values for the analysed columns, in `labels` order. */
  values: string[];
}

export interface OutlierFeatureImportance {
  column: number;
  label: string;
  /** Normalized 0-1, comparable within one analysis only. */
  weight: number;
}

export interface OutlierResult {
  method: OutlierMethod;
  mode: OutlierMode;
  labels: string[];
  columns: number[];
  /** The analysed rows, ascending. Excluded rows are not present. */
  rowIndices: Uint32Array;
  /** One score per analysed row; higher = more anomalous. */
  scores: Float32Array;
  threshold: number;
  flagged: number;
  analyzed: number;
  /** Rows dropped because a selected value was missing. */
  excluded: number;
  /** Rows dropped by the deterministic latency cap. */
  sampled: boolean;
  totalRows: number;
  /** LOF ran on a PCA projection (more features than the cap allows). */
  projected: boolean;
  projectionComponents: number;
  /** Selected features omitted by the quick/deep feature cap. */
  omittedFeatures: number;
  details: OutlierRowDetail[];
  featureImportance: OutlierFeatureImportance[];
  /** A small, deterministic 2-D sample for the anomaly landscape. */
  visualRows: Uint32Array;
  visualX: Float32Array;
  visualY: Float32Array;
  visualFlagged: Uint8Array;
  ms: number;
}

interface PreparedMatrix {
  columns: number[];
  labels: string[];
  rowIndices: Uint32Array;
  matrix: Float32Array;
  rows: number;
  dims: number;
  means: Float64Array;
  scales: Float64Array;
  excluded: number;
  sampled: boolean;
  totalRows: number;
  omittedFeatures: number;
  /** Raw numeric values per analysed column (row aligned). */
  raw: Float64Array[];
  /** Display text per analysed column (the source raw strings, no copy). */
  text: readonly string[][];
}

const EULER = 0.5772156649015329;
const SAMPLE_STATS = 20_000;
const PCA_COVARIANCE_SAMPLE = 200_000;
const DETAIL_ROWS = 25;
const CONTRIBUTION_ROWS = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(values: Float64Array, q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = Float64Array.from(values);
  sorted.sort();
  const position = (sorted.length - 1) * clamp(q, 0, 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? Number.NaN;
  const weight = position - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

/** Robust location/scale: median and 1.4826×MAD, IQR and stddev fallbacks. */
function robustStats(values: Float64Array): { median: number; scale: number } {
  const finite: number[] = [];
  for (const value of values) if (Number.isFinite(value)) finite.push(value);
  if (finite.length === 0) return { median: 0, scale: 1 };
  finite.sort((a, b) => a - b);
  const mid = finite.length >>> 1;
  const median =
    finite.length % 2 === 1
      ? (finite[mid] ?? 0)
      : ((finite[mid - 1] ?? 0) + (finite[mid] ?? 0)) / 2;
  const deviations = new Float64Array(finite.length);
  for (let i = 0; i < finite.length; i++) deviations[i] = Math.abs((finite[i] ?? 0) - median);
  const mad = quantile(deviations, 0.5);
  if (Number.isFinite(mad) && mad > 1e-12) {
    return { median, scale: 1.4826 * mad };
  }
  const q1 = quantile(Float64Array.from(finite), 0.25);
  const q3 = quantile(Float64Array.from(finite), 0.75);
  const iqr = q3 - q1;
  if (Number.isFinite(iqr) && iqr > 1e-12) {
    return { median, scale: iqr / 1.349 };
  }
  let mean = 0;
  for (const value of finite) mean += value;
  mean /= finite.length;
  let variance = 0;
  for (const value of finite) variance += (value - mean) ** 2;
  const stddev = Math.sqrt(variance / Math.max(1, finite.length - 1));
  return { median, scale: stddev > 1e-12 ? stddev : 1 };
}

/** Right-skewed non-negative columns benefit from a log1p transform. */
function prefersLog(values: Float64Array): boolean {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const sample: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? Number.NaN;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    if (sample.length < SAMPLE_STATS && i % Math.max(1, Math.floor(values.length / SAMPLE_STATS)) === 0) {
      sample.push(value);
    }
  }
  if (!(min >= 0) || sample.length < 20) return false;
  sample.sort((a, b) => a - b);
  const median = sample[sample.length >>> 1] ?? 0;
  return median > 0 && max > median * 12;
}

function finiteValues(column: ColumnData, ids: Uint32Array, limit = SAMPLE_STATS): Float64Array {
  const numbers = column.numbers();
  const stride = Math.max(1, Math.floor(ids.length / limit));
  const out: number[] = [];
  for (let i = 0; i < ids.length && out.length < limit; i += stride) {
    const value = numbers[ids[i] ?? 0];
    if (Number.isFinite(value)) out.push(value);
  }
  return Float64Array.from(out);
}

function selectFeatures(
  columns: readonly ColumnData[],
  indexes: readonly number[],
  ids: Uint32Array,
  maxFeatures: number,
): { columns: number[]; omitted: number } {
  const unique: number[] = [];
  const seen = new Set<number>();
  for (const index of indexes) {
    if (index < 0 || index >= columns.length || seen.has(index)) continue;
    const column = columns[index];
    if (column === undefined || column.role === "provenance") continue;
    if (column.type !== "integer" && column.type !== "number" && column.type !== "duration") {
      continue;
    }
    if (column.stats.distinct <= 1) continue;
    seen.add(index);
    unique.push(index);
  }
  if (unique.length <= maxFeatures) return { columns: unique, omitted: 0 };
  const ranked = unique.map((index) => {
    const column = columns[index];
    const values = column === undefined ? new Float64Array(0) : finiteValues(column, ids);
    const stats = robustStats(values);
    return { index, score: stats.scale };
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    columns: ranked.slice(0, maxFeatures).map((entry) => entry.index).sort((a, b) => a - b),
    omitted: unique.length - maxFeatures,
  };
}

function sampleRows(valid: Uint32Array, cap: number, random: () => number): {
  rows: Uint32Array;
  sampled: boolean;
} {
  if (valid.length <= cap) return { rows: valid, sampled: false };
  const step = valid.length / cap;
  const offset = Math.floor(random() * step);
  const out = new Uint32Array(cap);
  for (let i = 0; i < cap; i++) {
    out[i] = valid[Math.min(valid.length - 1, Math.floor(offset + i * step))] ?? 0;
  }
  return { rows: out, sampled: true };
}

function prepareMatrix(
  columns: readonly ColumnData[],
  ids: Uint32Array,
  selected: number[],
  cap: number,
  random: () => number,
): PreparedMatrix | { error: string } {
  if (selected.length < 2) {
    return { error: "Pick at least two numeric columns with data." };
  }
  const numbers = selected.map((index) => columns[index]?.numbers() ?? new Float64Array(0));
  const valid: number[] = [];
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position] ?? 0;
    let complete = true;
    for (let feature = 0; feature < selected.length; feature++) {
      if (!Number.isFinite(numbers[feature]?.[row] ?? Number.NaN)) {
        complete = false;
        break;
      }
    }
    if (complete) valid.push(row);
  }
  const validRows = Uint32Array.from(valid);
  const sampled = sampleRows(validRows, cap, random);
  const rows = sampled.rows;
  const dims = selected.length;

  const transforms: ((value: number) => number)[] = [];
  const means = new Float64Array(dims);
  const scales = new Float64Array(dims);
  const raw: Float64Array[] = new Array(dims);
  const text: string[][] = new Array(dims);
  const labels: string[] = [];
  for (let feature = 0; feature < dims; feature++) {
    const index = selected[feature] ?? -1;
    const column = columns[index];
    labels.push(column?.name ?? `column ${index + 1}`);
    const values = finiteValues(column as ColumnData, rows);
    const log = prefersLog(values);
    const transform = log ? (value: number): number => Math.log1p(Math.max(0, value)) : (value: number): number => value;
    transforms.push(transform);
    const transformed = Float64Array.from(values, transform);
    const stats = robustStats(transformed);
    means[feature] = stats.median;
    scales[feature] = stats.scale;
    raw[feature] = numbers[feature] ?? new Float64Array(0);
    text[feature] = column?.raw ?? [];
  }

  const matrix = new Float32Array(rows.length * dims);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? 0;
    for (let feature = 0; feature < dims; feature++) {
      const value = transforms[feature]?.(numbers[feature]?.[row] ?? Number.NaN) ?? Number.NaN;
      matrix[r * dims + feature] = (value - means[feature]!) / scales[feature]!;
    }
  }

  return {
    columns: selected,
    labels,
    rowIndices: rows,
    matrix,
    rows: rows.length,
    dims,
    means,
    scales,
    excluded: ids.length - valid.length,
    sampled: sampled.sampled,
    totalRows: ids.length,
    omittedFeatures: 0,
    raw,
    text,
  };
}

function percentileThreshold(scores: Float32Array, contamination: number): number {
  if (scores.length === 0) return Number.NaN;
  const share = clamp(contamination, 0.0001, 0.5);
  const sorted = Float32Array.from(scores);
  sorted.sort();
  const index = clamp(Math.ceil((1 - share) * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[index] ?? Number.NaN;
}

function detailsFor(
  prepared: PreparedMatrix,
  scores: Float32Array,
  threshold: number,
  contributions: (row: number) => OutlierContribution[],
): OutlierRowDetail[] {
  const ranked = Array.from({ length: scores.length }, (_, index) => index)
    .filter((index) => (scores[index] ?? Number.NEGATIVE_INFINITY) >= threshold)
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b)
    .slice(0, DETAIL_ROWS);
  return ranked.map((index) => {
    const row = prepared.rowIndices[index] ?? 0;
    return {
      row,
      score: scores[index] ?? 0,
      contributions: contributions(index),
      values: prepared.labels.map((_, feature) => prepared.text[feature]?.[row] ?? ""),
    };
  });
}

function normalizedContributions(
  prepared: PreparedMatrix,
  index: number,
  weights: Float64Array,
): OutlierContribution[] {
  const dims = prepared.dims;
  let total = 0;
  const ranked: { feature: number; weight: number }[] = [];
  for (let feature = 0; feature < dims; feature++) {
    const weight = weights[feature] ?? 0;
    if (!(weight > 0)) continue;
    total += weight;
    ranked.push({ feature, weight });
  }
  ranked.sort((a, b) => b.weight - a.weight);
  if (total <= 0) return [];
  return ranked.slice(0, CONTRIBUTION_ROWS).map((entry) => {
    const feature = entry.feature;
    return {
      column: prepared.columns[feature] ?? -1,
      label: prepared.labels[feature] ?? "",
      value: prepared.raw[feature]?.[prepared.rowIndices[index] ?? 0] ?? Number.NaN,
      contribution: entry.weight / total,
    };
  });
}

function importance(
  prepared: PreparedMatrix,
  weights: Float64Array,
): OutlierFeatureImportance[] {
  let max = 0;
  for (const weight of weights) if (weight > max) max = weight;
  return prepared.labels.map((label, feature) => ({
    column: prepared.columns[feature] ?? -1,
    label,
    weight: max > 0 ? (weights[feature] ?? 0) / max : 0,
  }));
}

// ---------- Isolation Forest ----------

interface IsolationTree {
  feature: Int32Array;
  threshold: Float64Array;
  left: Int32Array;
  right: Int32Array;
  /** Path length contribution of each node (depth + c(size)). */
  path: Float64Array;
  root: number;
}

interface IsolationForest {
  feature: Int32Array;
  threshold: Float64Array;
  left: Int32Array;
  right: Int32Array;
  path: Float64Array;
  roots: Uint32Array;
}

/** Merge the per-tree arrays so scoring avoids an object lookup per tree. */
function flattenForest(trees: readonly IsolationTree[]): IsolationForest {
  let nodes = 0;
  for (const tree of trees) nodes += tree.feature.length;
  const feature = new Int32Array(nodes);
  const threshold = new Float64Array(nodes);
  const left = new Int32Array(nodes);
  const right = new Int32Array(nodes);
  const path = new Float64Array(nodes);
  const roots = new Uint32Array(trees.length);
  let offset = 0;
  trees.forEach((tree, index) => {
    feature.set(tree.feature, offset);
    threshold.set(tree.threshold, offset);
    path.set(tree.path, offset);
    for (let node = 0; node < tree.left.length; node++) {
      const childLeft = tree.left[node] ?? -1;
      const childRight = tree.right[node] ?? -1;
      left[offset + node] = childLeft === -1 ? -1 : childLeft + offset;
      right[offset + node] = childRight === -1 ? -1 : childRight + offset;
    }
    roots[index] = (tree.root ?? 0) + offset;
    offset += tree.feature.length;
  });
  return { feature, threshold, left, right, path, roots };
}

function averagePathLength(size: number): number {
  if (size <= 1) return 0;
  if (size === 2) return 1;
  return 2 * (Math.log(size - 1) + EULER) - (2 * (size - 1)) / size;
}

function buildIsolationTree(
  matrix: Float32Array,
  sample: Uint32Array,
  dims: number,
  random: () => number,
): IsolationTree {
  const feature: number[] = [];
  const threshold: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const size: number[] = [];
  const depth: number[] = [];
  const indices = Uint32Array.from(sample);

  const build = (start: number, end: number, level: number): number => {
    const node = feature.length;
    feature.push(-1);
    threshold.push(0);
    left.push(-1);
    right.push(-1);
    size.push(end - start);
    depth.push(level);
    if (end - start <= 1) return node;
    const varying: number[] = [];
    for (let dim = 0; dim < dims; dim++) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let i = start; i < end; i++) {
        const value = matrix[(indices[i] ?? 0) * dims + dim] ?? 0;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (max - min > 1e-9) varying.push(dim);
    }
    if (varying.length === 0) return node;
    const dim = varying[Math.floor(random() * varying.length)] ?? varying[0] ?? 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = start; i < end; i++) {
      const value = matrix[(indices[i] ?? 0) * dims + dim] ?? 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const split = min + random() * (max - min);
    if (!(split > min) || !(split < max)) return node;
    let middle = start;
    for (let i = start; i < end; i++) {
      const row = indices[i] ?? 0;
      if ((matrix[row * dims + dim] ?? 0) < split) {
        const swap = indices[middle] ?? 0;
        indices[middle] = row;
        indices[i] = swap;
        middle++;
      }
    }
    if (middle === start || middle === end) return node;
    feature[node] = dim;
    threshold[node] = split;
    left[node] = build(start, middle, level + 1);
    right[node] = build(middle, end, level + 1);
    return node;
  };

  const root = build(0, indices.length, 0);
  const path = new Float64Array(feature.length);
  for (let node = 0; node < feature.length; node++) {
    path[node] = (depth[node] ?? 0) + averagePathLength(size[node] ?? 1);
  }
  return {
    feature: Int32Array.from(feature),
    threshold: Float64Array.from(threshold),
    left: Int32Array.from(left),
    right: Int32Array.from(right),
    path,
    root,
  };
}

function scoreIsolationForest(
  prepared: PreparedMatrix,
  options: OutlierOptions,
  random: () => number,
): {
  scores: Float32Array;
  threshold: number;
  featureImportance: OutlierFeatureImportance[];
  forest: IsolationForest;
} {
  const quick = options.mode === "quick";
  const treesCount = clamp(
    Math.round(options.trees ?? (quick ? (prepared.rows <= 250_000 ? 100 : 64) : 200)),
    16,
    quick ? 200 : 400,
  );
  const sampleSize = clamp(
    Math.round(options.sampleSize ?? (quick ? 256 : 1024)),
    16,
    Math.max(16, prepared.rows),
  );
  const treeSample = Math.min(sampleSize, prepared.rows);
  const trees: IsolationTree[] = [];
  for (let tree = 0; tree < treesCount; tree++) {
    const sample = new Uint32Array(treeSample);
    if (treeSample === prepared.rows) {
      for (let i = 0; i < treeSample; i++) sample[i] = i;
    } else {
      const used = new Set<number>();
      while (used.size < treeSample) {
        used.add(Math.floor(random() * prepared.rows));
      }
      let at = 0;
      for (const index of used) sample[at++] = index;
    }
    trees.push(buildIsolationTree(prepared.matrix, sample, prepared.dims, random));
  }

  const forest = flattenForest(trees);
  const scores = new Float32Array(prepared.rows);
  const normalization = averagePathLength(treeSample);
  const splitCounts = new Float64Array(prepared.dims);
  for (let node = 0; node < forest.feature.length; node++) {
    const feature = forest.feature[node] ?? -1;
    if (feature >= 0) splitCounts[feature] = (splitCounts[feature] ?? 0) + 1;
  }
  const { feature, threshold, left, right, path, roots } = forest;
  const dims = prepared.dims;
  const matrix = prepared.matrix;
  for (let row = 0; row < prepared.rows; row++) {
    const offset = row * dims;
    let total = 0;
    for (let tree = 0; tree < roots.length; tree++) {
      let node = roots[tree] ?? 0;
      while ((feature[node] ?? -1) >= 0) {
        const dim = feature[node] ?? 0;
        node =
          (matrix[offset + dim] ?? 0) <= (threshold[node] ?? 0)
            ? (left[node] ?? -1)
            : (right[node] ?? -1);
        if (node < 0) break;
      }
      total += path[node] ?? 0;
    }
    const average = total / Math.max(1, roots.length);
    scores[row] = normalization > 0 ? 2 ** (-average / normalization) : 0.5;
  }
  return {
    scores,
    threshold: percentileThreshold(scores, options.contamination),
    featureImportance: importance(prepared, splitCounts),
    forest,
  };
}

function ifContributions(
  prepared: PreparedMatrix,
  forest: IsolationForest,
  index: number,
): OutlierContribution[] {
  const counts = new Float64Array(prepared.dims);
  const offset = index * prepared.dims;
  const { feature, threshold, left, right, roots } = forest;
  for (let tree = 0; tree < roots.length; tree++) {
    let node = roots[tree] ?? 0;
    while ((feature[node] ?? -1) >= 0) {
      const dim = feature[node] ?? 0;
      counts[dim] = (counts[dim] ?? 0) + 1;
      node =
        (prepared.matrix[offset + dim] ?? 0) <= (threshold[node] ?? 0)
          ? (left[node] ?? -1)
          : (right[node] ?? -1);
      if (node < 0) break;
    }
  }
  return normalizedContributions(prepared, index, counts);
}

// ---------- PCA ----------

interface Components {
  vectors: Float64Array[];
  variances: number[];
  means: Float64Array;
}

function covariance(matrix: Float32Array, rows: number, dims: number): {
  cov: Float64Array;
  means: Float64Array;
} {
  const step = Math.max(1, Math.floor(rows / PCA_COVARIANCE_SAMPLE));
  const sampled = Math.ceil(rows / step);
  const means = new Float64Array(dims);
  for (let r = 0; r < rows; r += step) {
    for (let d = 0; d < dims; d++) means[d] += matrix[r * dims + d] ?? 0;
  }
  for (let d = 0; d < dims; d++) means[d] /= Math.max(1, sampled);
  const cov = new Float64Array(dims * dims);
  for (let r = 0; r < rows; r += step) {
    const offset = r * dims;
    for (let a = 0; a < dims; a++) {
      const va = (matrix[offset + a] ?? 0) - (means[a] ?? 0);
      for (let b = a; b < dims; b++) {
        cov[a * dims + b] += va * ((matrix[offset + b] ?? 0) - (means[b] ?? 0));
      }
    }
  }
  for (let a = 0; a < dims; a++) {
    for (let b = a; b < dims; b++) {
      const value = (cov[a * dims + b] ?? 0) / Math.max(1, sampled);
      cov[a * dims + b] = value;
      cov[b * dims + a] = value;
    }
  }
  return { cov, means };
}

function principalComponents(
  cov: Float64Array,
  dims: number,
  maxComponents: number,
  random: () => number,
  targetVariance = 0.9,
): Components {
  const vectors: Float64Array[] = [];
  const variances: number[] = [];
  let trace = 0;
  for (let d = 0; d < dims; d++) trace += cov[d * dims + d] ?? 0;
  const means = new Float64Array(dims);
  for (let component = 0; component < maxComponents; component++) {
    let vector = new Float64Array(dims);
    for (let d = 0; d < dims; d++) vector[d] = random() - 0.5;
    let norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm <= 1e-12) break;
    for (let d = 0; d < dims; d++) vector[d] = (vector[d] ?? 0) / norm;
    for (let iteration = 0; iteration < 80; iteration++) {
      const next = new Float64Array(dims);
      for (let a = 0; a < dims; a++) {
        let sum = 0;
        for (let b = 0; b < dims; b++) sum += (cov[a * dims + b] ?? 0) * (vector[b] ?? 0);
        next[a] = sum;
      }
      for (const previous of vectors) {
        let dot = 0;
        for (let d = 0; d < dims; d++) dot += (next[d] ?? 0) * (previous[d] ?? 0);
        for (let d = 0; d < dims; d++) next[d] = (next[d] ?? 0) - dot * (previous[d] ?? 0);
      }
      norm = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0));
      if (norm <= 1e-12) break;
      for (let d = 0; d < dims; d++) next[d] = (next[d] ?? 0) / norm;
      let delta = 0;
      for (let d = 0; d < dims; d++) delta += Math.abs((next[d] ?? 0) - (vector[d] ?? 0));
      vector = next;
      if (delta < 1e-9) break;
    }
    let variance = 0;
    for (let a = 0; a < dims; a++) {
      for (let b = 0; b < dims; b++) {
        variance += (vector[a] ?? 0) * (cov[a * dims + b] ?? 0) * (vector[b] ?? 0);
      }
    }
    if (!(variance > 1e-12)) break;
    vectors.push(vector);
    variances.push(variance);
    const captured = variances.reduce((sum, value) => sum + value, 0);
    if (trace > 0 && captured / trace >= targetVariance) break;
  }
  return { vectors, variances, means };
}

function scorePca(
  prepared: PreparedMatrix,
  options: OutlierOptions,
  random: () => number,
): {
  scores: Float32Array;
  threshold: number;
  featureImportance: OutlierFeatureImportance[];
  components: Components;
} {
  const { cov, means } = covariance(prepared.matrix, prepared.rows, prepared.dims);
  const maxComponents = clamp(Math.round(options.components ?? 8), 1, Math.min(8, prepared.dims));
  const components = principalComponents(cov, prepared.dims, maxComponents, random);
  components.means = means;
  if (components.vectors.length === 0) {
    throw new Error("PCA needs at least two numeric columns with variance.");
  }
  const scores = new Float32Array(prepared.rows);
  const componentCount = components.vectors.length;
  for (let row = 0; row < prepared.rows; row++) {
    const offset = row * prepared.dims;
    let norm = 0;
    for (let d = 0; d < prepared.dims; d++) {
      const value = (prepared.matrix[offset + d] ?? 0) - (means[d] ?? 0);
      norm += value * value;
    }
    let captured = 0;
    for (let component = 0; component < componentCount; component++) {
      const vector = components.vectors[component];
      if (vector === undefined) continue;
      let projection = 0;
      for (let d = 0; d < prepared.dims; d++) {
        projection +=
          ((prepared.matrix[offset + d] ?? 0) - (means[d] ?? 0)) * (vector[d] ?? 0);
      }
      captured += projection * projection;
    }
    scores[row] = Math.sqrt(Math.max(0, norm - captured));
  }
  const weights = new Float64Array(prepared.dims);
  for (const vector of components.vectors) {
    for (let d = 0; d < prepared.dims; d++) weights[d] += (vector[d] ?? 0) ** 2;
  }
  return {
    scores,
    threshold: percentileThreshold(scores, options.contamination),
    featureImportance: importance(prepared, weights),
    components,
  };
}

function pcaContributions(
  prepared: PreparedMatrix,
  components: Components,
  index: number,
): OutlierContribution[] {
  const dims = prepared.dims;
  const offset = index * dims;
  const residual = new Float64Array(dims);
  for (let d = 0; d < dims; d++) {
    residual[d] = (prepared.matrix[offset + d] ?? 0) - (components.means[d] ?? 0);
  }
  for (const vector of components.vectors) {
    let projection = 0;
    for (let d = 0; d < dims; d++) {
      projection +=
        ((prepared.matrix[offset + d] ?? 0) - (components.means[d] ?? 0)) *
        (vector[d] ?? 0);
    }
    for (let d = 0; d < dims; d++) residual[d] = (residual[d] ?? 0) - projection * (vector[d] ?? 0);
  }
  const weights = new Float64Array(dims);
  for (let d = 0; d < dims; d++) weights[d] = (residual[d] ?? 0) ** 2;
  return normalizedContributions(prepared, index, weights);
}

// ---------- LOF ----------

interface KdTree {
  indices: Uint32Array;
  left: Int32Array;
  right: Int32Array;
  axis: Uint8Array;
  split: Float64Array;
  root: number;
}

function nthElement(
  indices: Uint32Array,
  start: number,
  end: number,
  target: number,
  axis: number,
  matrix: Float32Array,
  dims: number,
): number {
  let low = start;
  let high = end - 1;
  while (low < high) {
    const pivot = matrix[(indices[(low + high) >>> 1] ?? 0) * dims + axis] ?? 0;
    let i = low;
    let j = high;
    while (i <= j) {
      while ((matrix[(indices[i] ?? 0) * dims + axis] ?? 0) < pivot) i++;
      while ((matrix[(indices[j] ?? 0) * dims + axis] ?? 0) > pivot) j--;
      if (i <= j) {
        const swap = indices[i] ?? 0;
        indices[i] = indices[j] ?? 0;
        indices[j] = swap;
        i++;
        j--;
      }
    }
    if (target <= j) high = j;
    else if (target >= i) low = i;
    else break;
  }
  return indices[target] ?? 0;
}

function buildKdTree(matrix: Float32Array, rows: number, dims: number): KdTree {
  const indices = new Uint32Array(rows);
  for (let i = 0; i < rows; i++) indices[i] = i;
  const left = new Int32Array(rows).fill(-1);
  const right = new Int32Array(rows).fill(-1);
  const axis = new Uint8Array(rows);
  const split = new Float64Array(rows);
  const build = (start: number, end: number, depth: number): number => {
    if (start >= end) return -1;
    const dim = depth % dims;
    const middle = (start + end) >>> 1;
    nthElement(indices, start, end, middle, dim, matrix, dims);
    const node = indices[middle] ?? start;
    axis[node] = dim;
    split[node] = matrix[node * dims + dim] ?? 0;
    left[node] = build(start, middle, depth + 1);
    right[node] = build(middle + 1, end, depth + 1);
    return node;
  };
  const root = build(0, rows, 0);
  return { indices, left, right, axis, split, root };
}

function nearestNeighbors(
  tree: KdTree,
  matrix: Float32Array,
  dims: number,
  query: number,
  k: number,
): { indices: Uint32Array; distances: Float64Array } {
  const foundIndex = new Uint32Array(k);
  const foundDist = new Float64Array(k).fill(Number.POSITIVE_INFINITY);
  let count = 0;
  const stack: number[] = [tree.root];
  while (stack.length > 0) {
    const node = stack.pop() ?? -1;
    if (node < 0) continue;
    const distance = distanceTo(matrix, dims, query, node);
    if (count < k) {
      foundIndex[count] = node;
      foundDist[count] = distance;
      count++;
      // Keep the worst distance at the end for cheap pruning.
      for (let i = count - 1; i > 0; i--) {
        if ((foundDist[i] ?? 0) > (foundDist[i - 1] ?? 0)) {
          const ti = foundIndex[i] ?? 0;
          foundIndex[i] = foundIndex[i - 1] ?? 0;
          foundIndex[i - 1] = ti;
          const td = foundDist[i] ?? 0;
          foundDist[i] = foundDist[i - 1] ?? 0;
          foundDist[i - 1] = td;
        }
      }
    } else if (distance < (foundDist[k - 1] ?? Number.POSITIVE_INFINITY)) {
      foundIndex[k - 1] = node;
      foundDist[k - 1] = distance;
      for (let i = k - 1; i > 0; i--) {
        if ((foundDist[i] ?? 0) > (foundDist[i - 1] ?? 0)) {
          const ti = foundIndex[i] ?? 0;
          foundIndex[i] = foundIndex[i - 1] ?? 0;
          foundIndex[i - 1] = ti;
          const td = foundDist[i] ?? 0;
          foundDist[i] = foundDist[i - 1] ?? 0;
          foundDist[i - 1] = td;
        }
      }
    }
    const dim = tree.axis[node] ?? 0;
    const delta = (matrix[query * dims + dim] ?? 0) - (tree.split[node] ?? 0);
    const near = delta < 0 ? (tree.left[node] ?? -1) : (tree.right[node] ?? -1);
    const far = delta < 0 ? (tree.right[node] ?? -1) : (tree.left[node] ?? -1);
    if (delta * delta <= (foundDist[k - 1] ?? Number.POSITIVE_INFINITY) || count < k) {
      if (far >= 0) stack.push(far);
    }
    if (near >= 0) stack.push(near);
  }
  const indices = new Uint32Array(count);
  const distances = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    indices[i] = foundIndex[i] ?? 0;
    distances[i] = Math.sqrt(foundDist[i] ?? 0);
  }
  return { indices, distances };
}

function distanceTo(matrix: Float32Array, dims: number, a: number, b: number): number {
  let sum = 0;
  for (let d = 0; d < dims; d++) {
    const delta = (matrix[a * dims + d] ?? 0) - (matrix[b * dims + d] ?? 0);
    sum += delta * delta;
  }
  return sum;
}

function scoreLof(
  prepared: PreparedMatrix,
  options: OutlierOptions,
): {
  scores: Float32Array;
  threshold: number;
  featureImportance: OutlierFeatureImportance[];
  neighbors: Uint32Array;
  neighborDistances: Float64Array;
  k: number;
} {
  const k = clamp(Math.round(options.neighbors ?? 20), 2, 50);
  if (prepared.rows <= k + 1) {
    throw new Error("LOF needs more rows than neighbours.");
  }
  const tree = buildKdTree(prepared.matrix, prepared.rows, prepared.dims);
  const n = prepared.rows;
  const neighborIndices = new Uint32Array(n * k);
  const neighborDistances = new Float64Array(n * k);
  const kDistance = new Float64Array(n);
  for (let row = 0; row < n; row++) {
    const neighbors = nearestNeighbors(tree, prepared.matrix, prepared.dims, row, k + 1);
    const offset = row * k;
    let used = 0;
    for (let i = 0; i < neighbors.indices.length && used < k; i++) {
      const neighbor = neighbors.indices[i] ?? -1;
      if (neighbor < 0 || neighbor === row) continue;
      neighborIndices[offset + used] = neighbor;
      neighborDistances[offset + used] = neighbors.distances[i] ?? 0;
      used++;
    }
    kDistance[row] = used === 0 ? 0 : (neighborDistances[offset + used - 1] ?? 0);
  }
  const lrd = new Float64Array(n);
  for (let row = 0; row < n; row++) {
    const offset = row * k;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < k; i++) {
      const neighbor = neighborIndices[offset + i] ?? 0;
      const distance = neighborDistances[offset + i] ?? 0;
      sum += Math.max(kDistance[neighbor] ?? 0, distance);
      count++;
    }
    lrd[row] = sum > 0 ? count / sum : 0;
  }
  const scores = new Float32Array(n);
  for (let row = 0; row < n; row++) {
    const offset = row * k;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < k; i++) {
      const neighbor = neighborIndices[offset + i] ?? 0;
      sum += lrd[neighbor] ?? 0;
      count++;
    }
    const neighborMean = count > 0 ? sum / count : 0;
    scores[row] = (lrd[row] ?? 0) > 0 ? neighborMean / (lrd[row] ?? 1) : 0;
  }
  const weights = new Float64Array(prepared.dims);
  for (let d = 0; d < prepared.dims; d++) {
    let mean = 0;
    for (let row = 0; row < n; row++) mean += prepared.matrix[row * prepared.dims + d] ?? 0;
    mean /= Math.max(1, n);
    let variance = 0;
    for (let row = 0; row < n; row++) {
      variance += ((prepared.matrix[row * prepared.dims + d] ?? 0) - mean) ** 2;
    }
    weights[d] = Math.sqrt(variance / Math.max(1, n));
  }
  return {
    scores,
    threshold: percentileThreshold(scores, options.contamination),
    featureImportance: importance(prepared, weights),
    neighbors: neighborIndices,
    neighborDistances,
    k,
  };
}

function lofContributions(
  prepared: PreparedMatrix,
  neighborIndices: Uint32Array,
  k: number,
  index: number,
): OutlierContribution[] {
  const dims = prepared.dims;
  const offset = index * k;
  const weights = new Float64Array(dims);
  for (let d = 0; d < dims; d++) {
    let mean = 0;
    for (let i = 0; i < k; i++) {
      const neighbor = neighborIndices[offset + i] ?? 0;
      mean += prepared.matrix[neighbor * dims + d] ?? 0;
    }
    mean /= Math.max(1, k);
    const own = prepared.matrix[index * dims + d] ?? 0;
    weights[d] = (own - mean) ** 2;
  }
  return normalizedContributions(prepared, index, weights);
}

// ---------- public entry ----------

function capsFor(method: OutlierMethod, mode: OutlierMode): {
  rows: number;
  features: number;
} {
  const quick = mode === "quick";
  switch (method) {
    case "isolationForest":
      // 300k keeps the measured 500k-row worst case inside the 5s/30s gates
      // with headroom for slower machines; larger tables are sampled.
      return { rows: 300_000, features: quick ? 20 : 40 };
    case "pca":
      return { rows: 1_000_000, features: quick ? 20 : 40 };
    case "lof":
      return { rows: quick ? 50_000 : 100_000, features: quick ? 8 : 10 };
  }
}

/**
 * Compute one multivariate outlier method. The caller supplies the current
 * row order (`ids`) so the analysis respects table filters.
 */
function visualProjection(
  prepared: PreparedMatrix,
  scores: Float32Array,
  threshold: number,
  seed: number,
): { rows: Uint32Array; x: Float32Array; y: Float32Array; flagged: Uint8Array } {
  const cap = 5_000;
  const stride = Math.max(1, Math.ceil(prepared.rows / cap));
  const count = Math.ceil(prepared.rows / stride);
  const rows = new Uint32Array(count);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const flagged = new Uint8Array(count);
  if (prepared.dims >= 2) {
    // Fit the display projection on the sampled points only; scoring already
    // touched every analysed row, so the landscape never pays a second full
    // covariance pass.
    const sampleMatrix = new Float32Array(count * prepared.dims);
    for (let i = 0; i < count; i++) {
      const index = Math.min(prepared.rows - 1, i * stride);
      sampleMatrix.set(
        prepared.matrix.subarray(
          index * prepared.dims,
          index * prepared.dims + prepared.dims,
        ),
        i * prepared.dims,
      );
    }
    const { cov, means } = covariance(sampleMatrix, count, prepared.dims);
    const model = principalComponents(
      cov,
      prepared.dims,
      2,
      mulberry32(seed ^ 0x27d4eb2f),
      1,
    );
    for (let i = 0; i < count; i++) {
      const index = Math.min(prepared.rows - 1, i * stride);
      rows[i] = prepared.rowIndices[index] ?? 0;
      flagged[i] = (scores[index] ?? 0) >= threshold ? 1 : 0;
      for (let component = 0; component < 2; component++) {
        const vector = model.vectors[component];
        let value = 0;
        if (vector !== undefined) {
          for (let d = 0; d < prepared.dims; d++) {
            value +=
              ((sampleMatrix[i * prepared.dims + d] ?? 0) - (means[d] ?? 0)) *
              (vector[d] ?? 0);
          }
        } else {
          value = sampleMatrix[i * prepared.dims + component] ?? 0;
        }
        if (component === 0) x[i] = value;
        else y[i] = value;
      }
    }
  } else {
    for (let i = 0; i < count; i++) {
      const index = Math.min(prepared.rows - 1, i * stride);
      rows[i] = prepared.rowIndices[index] ?? 0;
      flagged[i] = (scores[index] ?? 0) >= threshold ? 1 : 0;
      x[i] = prepared.matrix[index * prepared.dims] ?? 0;
      y[i] = 0;
    }
  }
  return { rows, x, y, flagged };
}

export function computeOutlierAnalysis(
  columns: readonly ColumnData[],
  ids: Uint32Array,
  options: OutlierOptions,
): OutlierResult {
  const started = performance.now();
  const seed = options.seed ?? 42;
  const random = mulberry32(seed);
  const caps = capsFor(options.method, options.mode);
  const selected = selectFeatures(columns, options.columns, ids, caps.features);
  if (selected.columns.length < 2) {
    throw new Error("Select at least two numeric columns with data.");
  }
  // LOF with more than ten features projects to six PCA components, so its
  // row cap can stay at the generous end of the budget.
  const prepareCaps = { ...caps };
  if (options.method === "lof" && selected.columns.length > 10) {
    prepareCaps.rows = options.mode === "quick" ? 50_000 : 100_000;
  } else if (options.method === "lof" && selected.columns.length > 8) {
    prepareCaps.rows = options.mode === "quick" ? 20_000 : 50_000;
  }
  const prepared = prepareMatrix(columns, ids, selected.columns, prepareCaps.rows, random);
  if ("error" in prepared) throw new Error(prepared.error);
  if (prepared.rows < 10) {
    throw new Error(
      "Not enough complete rows for a multivariate analysis. Pick columns with fewer missing values.",
    );
  }
  prepared.omittedFeatures = selected.omitted;

  let scores: Float32Array;
  let threshold: number;
  let featureImportance: OutlierFeatureImportance[];
  let projected = false;
  let projectionComponents = 0;
  let ifForest: IsolationForest | null = null;
  let pcaModel: Components | null = null;
  let lofNeighbors: Uint32Array | null = null;
  let lofK = 0;
  let lofFallback: Float64Array | null = null;

  if (options.method === "isolationForest") {
    const result = scoreIsolationForest(prepared, options, random);
    scores = result.scores;
    threshold = result.threshold;
    featureImportance = result.featureImportance;
    ifForest = result.forest;
  } else if (options.method === "pca") {
    const result = scorePca(prepared, options, random);
    scores = result.scores;
    threshold = result.threshold;
    featureImportance = result.featureImportance;
    pcaModel = result.components;
  } else {
    let lofPrepared = prepared;
    if (prepared.dims > 10) {
      const { cov, means } = covariance(prepared.matrix, prepared.rows, prepared.dims);
      const model = principalComponents(
        cov,
        prepared.dims,
        Math.min(6, prepared.dims),
        mulberry32(seed ^ 0x85ebca6b),
      );
      model.means = means;
      if (model.vectors.length === 0) {
        throw new Error("LOF could not project the features.");
      }
      const projection = new Float32Array(prepared.rows * model.vectors.length);
      for (let row = 0; row < prepared.rows; row++) {
        for (let component = 0; component < model.vectors.length; component++) {
          const vector = model.vectors[component];
          if (vector === undefined) continue;
          let value = 0;
          for (let d = 0; d < prepared.dims; d++) {
            value +=
              ((prepared.matrix[row * prepared.dims + d] ?? 0) - (means[d] ?? 0)) *
              (vector[d] ?? 0);
          }
          projection[row * model.vectors.length + component] = value;
        }
      }
      lofPrepared = {
        ...prepared,
        matrix: projection,
        dims: model.vectors.length,
        columns: prepared.columns.slice(0, model.vectors.length),
        labels: prepared.labels.slice(0, model.vectors.length),
        text: prepared.text.slice(0, model.vectors.length),
      };
      projected = true;
      projectionComponents = model.vectors.length;
    }
    const result = scoreLof(lofPrepared, options);
    scores = result.scores;
    threshold = result.threshold;
    lofNeighbors = result.neighbors;
    lofK = result.k;
    if (projected) {
      // The projection is an implementation detail; explain the original
      // columns with their spread instead of exposing PCA components.
      const weights = new Float64Array(prepared.dims);
      for (let d = 0; d < prepared.dims; d++) {
        let mean = 0;
        for (let row = 0; row < prepared.rows; row++) {
          mean += prepared.matrix[row * prepared.dims + d] ?? 0;
        }
        mean /= Math.max(1, prepared.rows);
        let variance = 0;
        for (let row = 0; row < prepared.rows; row++) {
          variance += ((prepared.matrix[row * prepared.dims + d] ?? 0) - mean) ** 2;
        }
        weights[d] = Math.sqrt(variance / Math.max(1, prepared.rows));
      }
      featureImportance = importance(prepared, weights);
      lofFallback = weights;
    } else {
      featureImportance = result.featureImportance;
    }
  }

  const details = detailsFor(prepared, scores, threshold, (index) => {
    if (options.method === "isolationForest" && ifForest !== null) {
      return ifContributions(prepared, ifForest, index);
    }
    if (options.method === "pca" && pcaModel !== null) {
      return pcaContributions(prepared, pcaModel, index);
    }
    if (options.method === "lof" && !projected && lofNeighbors !== null) {
      return lofContributions(prepared, lofNeighbors, lofK, index);
    }
    const fallback = new Float64Array(prepared.dims);
    for (let d = 0; d < prepared.dims; d++) {
      if (lofFallback !== null) {
        fallback[d] = Math.abs(prepared.matrix[index * prepared.dims + d] ?? 0) * (lofFallback[d] ?? 0);
      } else {
        fallback[d] = Math.abs(prepared.matrix[index * prepared.dims + d] ?? 0);
      }
    }
    return normalizedContributions(prepared, index, fallback);
  });

  let flagged = 0;
  for (const score of scores) if (score >= threshold) flagged++;
  const visual = visualProjection(prepared, scores, threshold, seed);

  return {
    method: options.method,
    mode: options.mode,
    labels: prepared.labels,
    columns: prepared.columns,
    rowIndices: prepared.rowIndices,
    scores,
    threshold,
    flagged,
    analyzed: prepared.rows,
    excluded: prepared.excluded,
    sampled: prepared.sampled,
    totalRows: prepared.totalRows,
    projected,
    projectionComponents,
    omittedFeatures: prepared.omittedFeatures,
    details,
    featureImportance,
    visualRows: visual.rows,
    visualX: visual.x,
    visualY: visual.y,
    visualFlagged: visual.flagged,
    ms: performance.now() - started,
  };
}
