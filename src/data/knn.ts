import { ColumnData } from "./column.js";
import { formatNumber } from "./format.js";
import { parseNumber } from "../parse/numbers.js";

const DEFAULT_MAX_DONORS = 20_000;
/** With category predictors every comparison is brute force, so fewer donors keep a fill quick. */
const MIXED_MAX_DONORS = 6_000;
const MAX_CATEGORIES = 40;
const EPSILON = 1e-9;

/** How a column can take part in a fill: as numbers, as categories, or not at all. */
export type KnnKind = "number" | "category";

const textNumbers = new WeakMap<ColumnData, Float64Array | null>();

/**
 * A text or category column whose values are really numbers (Rooms: 1, 2, 3),
 * as numbers; null when it is not. Counting rooms as unrelated labels would
 * make 2 rooms as far from 3 as from 5.
 */
function numericText(column: ColumnData): Float64Array | null {
  if (textNumbers.has(column)) return textNumbers.get(column) ?? null;
  let parsed: Float64Array | null = null;
  if (column.type === "string" || column.type === "category") {
    const out = new Float64Array(column.raw.length);
    let present = 0;
    let numeric = 0;
    for (let row = 0; row < column.raw.length; row++) {
      const value = column.raw[row];
      if (column.isNull(value)) {
        out[row] = NaN;
        continue;
      }
      present++;
      const number = parseNumber(value, column.numberLocale);
      out[row] = Number.isFinite(number) ? number : NaN;
      if (Number.isFinite(number)) numeric++;
    }
    if (present >= 10 && numeric >= present * 0.98) parsed = out;
  }
  textNumbers.set(column, parsed);
  return parsed;
}

/** The values of a column that takes part as numbers (NaN where empty). */
function valuesOf(column: ColumnData): Float64Array {
  return column.type === "integer" || column.type === "number" ? column.numbers() : (numericText(column) ?? column.numbers());
}

export function knnKindOf(column: ColumnData | undefined): KnnKind | null {
  if (column === undefined) return null;
  if (column.type === "integer" || column.type === "number") return "number";
  if (column.type === "string" || column.type === "category") return numericText(column) !== null ? "number" : "category";
  if (column.type === "boolean") return "category";
  return null;
}

interface Feature {
  index: number;
  kind: KnnKind;
  /** Standardised values (NaN when missing), for numbers. */
  nums: Float64Array;
  /** Category codes (-1 when missing), for categories. */
  codes: Int32Array;
}

interface CategoryCodes {
  codes: Int32Array;
  labels: string[];
  counts: number[];
}

/** Codes for a text column's values, or null when it has too many different values to compare as categories. */
function categoryCodes(column: ColumnData, limit = MAX_CATEGORIES): CategoryCodes | null {
  const lookup = new Map<string, number>();
  const labels: string[] = [];
  const counts: number[] = [];
  const codes = new Int32Array(column.raw.length);
  for (let row = 0; row < column.raw.length; row++) {
    const value = column.raw[row];
    if (column.isNull(value)) {
      codes[row] = -1;
      continue;
    }
    const key = value.trim();
    let code = lookup.get(key);
    if (code === undefined) {
      if (labels.length >= limit) return null;
      code = labels.length;
      lookup.set(key, code);
      labels.push(key);
      counts.push(0);
    }
    codes[row] = code;
    counts[code]++;
  }
  return { codes, labels, counts };
}

function buildFeature(column: ColumnData, index: number): Feature | null {
  const kind = knnKindOf(column);
  if (kind === "number") {
    const values = valuesOf(column);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      if (Number.isFinite(values[i])) {
        sum += values[i];
        count++;
      }
    }
    if (count === 0) return null;
    const mean = sum / count;
    let variance = 0;
    for (let i = 0; i < values.length; i++) {
      if (Number.isFinite(values[i])) variance += (values[i] - mean) ** 2;
    }
    const scale = Math.sqrt(variance / count) || 1;
    const nums = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) nums[i] = Number.isFinite(values[i]) ? (values[i] - mean) / scale : NaN;
    return { index, kind, nums, codes: new Int32Array(0) };
  }
  if (kind === "category") {
    const coded = categoryCodes(column);
    if (coded === null) return null;
    return { index, kind, nums: new Float64Array(0), codes: coded.codes };
  }
  return null;
}

export interface Neighbours {
  /** Dataset rows of the nearest donors, nearest first. */
  rows: number[];
  distances: number[];
}

/**
 * Finds the rows most like a given row, measured on the predictors the row
 * actually has. Numbers are standardised; two categories differ by one
 * standard deviation. Donors are rows where the filled column is known and
 * every predictor is present.
 */
class KnnModel {
  readonly features: Feature[];
  readonly donorRows: Int32Array;
  private readonly tree: KdTree | null;
  private readonly dims: number;

  constructor(
    columns: readonly ColumnData[],
    target: number,
    predictors: readonly number[],
    known: (row: number) => boolean,
    exclude: Uint8Array | null,
    maxDonors: number | null = null,
  ) {
    const features: Feature[] = [];
    for (const index of unique(predictors)) {
      if (index === target) continue;
      const feature = buildFeature(columns[index], index);
      if (feature !== null) features.push(feature);
    }
    this.features = features;
    this.dims = features.length;
    const mixed = features.some((feature) => feature.kind === "category");
    const limit = maxDonors ?? (mixed ? MIXED_MAX_DONORS : DEFAULT_MAX_DONORS);
    const rowCount = columns[target].raw.length;
    const pool: number[] = [];
    for (let row = 0; row < rowCount; row++) {
      if (exclude !== null && exclude[row] === 1) continue;
      if (!known(row)) continue;
      let complete = true;
      for (const feature of features) {
        if (feature.kind === "number" ? Number.isNaN(feature.nums[row]) : feature.codes[row] < 0) {
          complete = false;
          break;
        }
      }
      if (complete) pool.push(row);
    }
    const stride = pool.length > limit ? pool.length / limit : 1;
    const count = stride > 1 ? Math.max(1, Math.floor(pool.length / stride)) : pool.length;
    const donors = new Int32Array(count);
    for (let i = 0; i < count; i++) donors[i] = pool[Math.min(pool.length - 1, Math.floor(i * stride))];
    this.donorRows = donors;
    if (!mixed && this.dims > 0 && count > 0) {
      const points = new Float64Array(count * this.dims);
      for (let i = 0; i < count; i++) {
        for (let d = 0; d < this.dims; d++) points[i * this.dims + d] = features[d].nums[donors[i]];
      }
      this.tree = new KdTree(points, this.dims, count);
    } else {
      this.tree = null;
    }
  }

  get donors(): number {
    return this.donorRows.length;
  }

  /** The nearest donors to a row, or null when the row has no observed predictor or there are no donors. */
  neighbours(row: number, k: number): Neighbours | null {
    if (this.donorRows.length === 0 || this.dims === 0) return null;
    const limit = Math.max(1, Math.min(Math.floor(k), this.donorRows.length));
    let observed = 0;
    for (const feature of this.features) {
      if (feature.kind === "number" ? !Number.isNaN(feature.nums[row]) : feature.codes[row] >= 0) observed++;
    }
    if (observed === 0) return null;
    const rows: number[] = [];
    const distances: number[] = [];
    if (this.tree !== null) {
      const query = new Float64Array(this.dims);
      const mask = new Uint8Array(this.dims);
      for (let d = 0; d < this.dims; d++) {
        const value = this.features[d].nums[row];
        if (!Number.isNaN(value)) {
          query[d] = value;
          mask[d] = 1;
        }
      }
      this.tree.knn(query, mask, limit).forEach((index, distance) => {
        rows.push(this.donorRows[index]);
        distances.push(distance);
      });
      return rows.length === 0 ? null : { rows, distances };
    }
    const found = new NeighborList(limit);
    const scale = this.dims / observed;
    for (let i = 0; i < this.donorRows.length; i++) {
      const donor = this.donorRows[i];
      let sum = 0;
      for (const feature of this.features) {
        if (feature.kind === "number") {
          const query = feature.nums[row];
          if (Number.isNaN(query)) continue;
          const diff = query - feature.nums[donor];
          sum += diff * diff;
        } else {
          const query = feature.codes[row];
          if (query < 0) continue;
          if (query !== feature.codes[donor]) sum += 1;
        }
      }
      found.push(i, Math.sqrt(sum * scale));
    }
    found.forEach((index, distance) => {
      rows.push(this.donorRows[index]);
      distances.push(distance);
    });
    return rows.length === 0 ? null : { rows, distances };
  }
}

/** The weighted mean of the first `k` neighbours' values; rows identical on the predictors win outright. */
function weightedMean(values: Float64Array, found: Neighbours, k: number): number {
  const count = Math.min(k, found.rows.length);
  let exact = 0;
  let exactSum = 0;
  for (let i = 0; i < count; i++) {
    if (found.distances[i] <= EPSILON) {
      exact++;
      exactSum += values[found.rows[i]];
    }
  }
  if (exact > 0) return exactSum / exact;
  let weightSum = 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const weight = 1 / found.distances[i];
    weightSum += weight;
    sum += weight * values[found.rows[i]];
  }
  return sum / weightSum;
}

/** The category with the most weight among the first `k` neighbours; ties go to the nearer neighbour. */
function weightedVote(codes: Int32Array, found: Neighbours, k: number): number {
  const count = Math.min(k, found.rows.length);
  let exact = false;
  for (let i = 0; i < count; i++) if (found.distances[i] <= EPSILON) exact = true;
  const weights = new Map<number, number>();
  let best = -1;
  let bestWeight = -1;
  for (let i = 0; i < count; i++) {
    if (exact && found.distances[i] > EPSILON) continue;
    const code = codes[found.rows[i]];
    const weight = (weights.get(code) ?? 0) + 1 / Math.max(found.distances[i], EPSILON);
    weights.set(code, weight);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = code;
    }
  }
  return best;
}

interface TargetData {
  kind: KnnKind;
  nums: Float64Array;
  coded: CategoryCodes | null;
  known: (row: number) => boolean;
}

function targetData(column: ColumnData): TargetData | null {
  const kind = knnKindOf(column);
  if (kind === "number") {
    const nums = valuesOf(column);
    return { kind, nums, coded: null, known: (row) => Number.isFinite(nums[row]) };
  }
  if (kind === "category") {
    const coded = categoryCodes(column, Number.POSITIVE_INFINITY);
    if (coded === null) return null;
    return { kind, nums: new Float64Array(0), coded, known: (row) => coded.codes[row] >= 0 };
  }
  return null;
}

export interface KnnFillResult {
  columns: ColumnData[];
  /** For each filled column, 1 where this fill wrote a value. */
  filled: Map<number, Uint8Array>;
}

/**
 * k-NN imputation, one filled column at a time. `fill` columns are the ones
 * whose empty cells are written (numbers become a distance weighted mean,
 * text becomes the most heavily weighted category among the k nearest
 * rows); `predictors` measure similarity and are not modified. Cells that
 * cannot be matched (no observed predictor, no donors) take the column's
 * median or most common value, and are still reported as filled.
 */
export function knnImputeDetailed(
  columns: readonly ColumnData[],
  fill: readonly number[],
  predictors: readonly number[],
  k: number,
  maxDonors: number | null = null,
): KnnFillResult {
  const next = columns.slice();
  const filled = new Map<number, Uint8Array>();
  const rowCount = columns.length > 0 ? columns[0].raw.length : 0;
  const limit = Math.max(1, Math.floor(k) || 1);
  const targets = unique(fill);
  // With no predictor given, the filled columns lean on each other (as before).
  const given = unique(predictors);
  for (const index of targets) {
    const column = columns[index];
    const target = column === undefined ? null : targetData(column);
    if (column === undefined || target === null) continue;
    const others = (given.length > 0 ? given : targets).filter((candidate) => candidate !== index);
    const model = new KnnModel(columns, index, others, target.known, null, maxDonors);
    const raw = column.raw.slice();
    const mask = new Uint8Array(rowCount);
    const fallback = target.kind === "number" ? medianOf(target.nums) : modeCode(target.coded as CategoryCodes);
    const places = target.kind === "number" ? (wholeNumbers(target.nums) ? 0 : decimalsOf(column)) : 0;
    for (let row = 0; row < rowCount; row++) {
      if (target.known(row)) continue;
      const found = model.neighbours(row, limit);
      if (target.kind === "number") {
        const value = found !== null ? weightedMean(target.nums, found, limit) : fallback;
        if (value === null || !Number.isFinite(value)) continue;
        raw[row] = formatNumber(roundTo(value, places));
      } else {
        const coded = target.coded as CategoryCodes;
        const code = found !== null ? weightedVote(coded.codes, found, limit) : fallback;
        if (code === null || code < 0) continue;
        raw[row] = coded.labels[code];
      }
      mask[row] = 1;
    }
    const rebuilt = ColumnData.create(column.name, raw, column.nullPolicy);
    rebuilt.setType(column.type);
    next[index] = rebuilt;
    filled.set(index, mask);
  }
  return { columns: next, filled };
}

export function knnImpute(
  columns: readonly ColumnData[],
  fill: readonly number[],
  predictors: readonly number[],
  k: number,
  maxDonors: number | null = null,
): ColumnData[] {
  return knnImputeDetailed(columns, fill, predictors, k, maxDonors).columns;
}

/** Ks tried when looking for a good number of neighbours. */
export const KNN_CANDIDATE_KS = [1, 2, 3, 5, 8, 12, 20, 30, 50] as const;

export interface KnnEvaluation {
  kind: KnnKind;
  /** Empty cells that a fill would write. */
  missing: number;
  /** Rows that can lend a value (known target, every predictor present). */
  donors: number;
  /** Known cells hidden, filled back and compared with the truth. */
  tested: number;
  /** Per k: mean absolute error for numbers, share right for categories. */
  results: { k: number; score: number }[];
  /** The same measure for the plain alternative: the median, or the most common value. */
  baseline: { name: string; score: number };
  /** The smallest k whose score is within 3% of the best: a smaller k is faster and blurs less. */
  bestK: number;
  /** Where the test can say little: too few known values or donors. */
  thin: boolean;
  /** A few cells a fill would write, with the rows they were copied from. */
  preview: { row: number; value: string; neighbours: number[] }[];
}

export interface KnnEvaluateOptions {
  ks?: readonly number[];
  previewK?: number;
  previewRows?: number;
  maxTested?: number;
  holdout?: number;
}

/** A small seeded generator so the same test gives the same answer twice. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tests a fill before it is made: hides some known values of the column,
 * fills them back from the rest with each k, and scores the result against
 * the truth and against the plain median (or most common value).
 */
export function knnEvaluate(
  columns: readonly ColumnData[],
  fill: number,
  predictors: readonly number[],
  options: KnnEvaluateOptions = {},
): KnnEvaluation | null {
  const column = columns[fill];
  const target = column === undefined ? null : targetData(column);
  if (column === undefined || target === null) return null;
  const rowCount = column.raw.length;
  const others = unique(predictors).filter((candidate) => candidate !== fill);
  const holdoutShare = options.holdout ?? 0.2;
  const maxTested = options.maxTested ?? 1500;
  const ks = [...new Set(options.ks ?? KNN_CANDIDATE_KS)].sort((a, b) => a - b);
  const previewK = Math.max(1, Math.floor(options.previewK ?? 5));

  let missing = 0;
  const knownRows: number[] = [];
  for (let row = 0; row < rowCount; row++) {
    if (target.known(row)) knownRows.push(row);
    else missing++;
  }
  const random = mulberry32(20240607);
  const order = knownRows.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const testCount = Math.min(maxTested, Math.floor(order.length * holdoutShare));
  const hidden = order.slice(0, testCount);
  const exclude = new Uint8Array(rowCount);
  for (const row of hidden) exclude[row] = 1;

  const testModel = new KnnModel(columns, fill, others, target.known, exclude, null);
  const kMax = Math.max(...ks, previewK);
  const available = ks.filter((k) => k <= Math.max(1, testModel.donors));
  const sums = new Map<number, number>(available.map((k) => [k, 0]));
  let scored = 0;
  let baseSum = 0;
  let baseName = "median";
  const kept = knownRows.filter((row) => exclude[row] === 0);
  let baselineValue = 0;
  let baselineCode = -1;
  const coded = target.coded;
  if (target.kind === "number") {
    baselineValue = medianOf(Float64Array.from(kept, (row) => target.nums[row])) ?? 0;
  } else if (coded !== null) {
    baseName = "most common value";
    const tally = new Map<number, number>();
    for (const row of kept) tally.set(coded.codes[row], (tally.get(coded.codes[row]) ?? 0) + 1);
    let top = -1;
    for (const [code, count] of tally) {
      if (count > top) {
        top = count;
        baselineCode = code;
      }
    }
  }
  for (const row of hidden) {
    const found = testModel.neighbours(row, kMax);
    if (found === null) continue;
    scored++;
    if (target.kind === "number") {
      const truth = target.nums[row];
      baseSum += Math.abs(truth - baselineValue);
      for (const k of available) sums.set(k, (sums.get(k) ?? 0) + Math.abs(truth - weightedMean(target.nums, found, k)));
    } else if (coded !== null) {
      const truth = coded.codes[row];
      if (baselineCode === truth) baseSum++;
      for (const k of available) if (weightedVote(coded.codes, found, k) === truth) sums.set(k, (sums.get(k) ?? 0) + 1);
    }
  }
  const lowerIsBetter = target.kind === "number";
  const results = available.map((k) => ({ k, score: scored > 0 ? (sums.get(k) ?? 0) / scored : NaN }));
  let best = results[0];
  for (const result of results) {
    if (best === undefined || (lowerIsBetter ? result.score < best.score : result.score > best.score)) best = result;
  }
  let bestK = best?.k ?? previewK;
  if (best !== undefined && Number.isFinite(best.score)) {
    const target1 = best.score;
    const within = results.find((result) => (lowerIsBetter ? result.score <= target1 * 1.03 : result.score >= target1 * 0.97));
    if (within !== undefined) bestK = within.k;
  }

  // The rows a real fill would write, with the donors they were copied from.
  const fullModel = new KnnModel(columns, fill, others, target.known, null, null);
  const preview: KnnEvaluation["preview"] = [];
  const wanted = options.previewRows ?? 6;
  const stride = Math.max(1, Math.floor(missing / Math.max(1, wanted)));
  let seen = 0;
  for (let row = 0; row < rowCount && preview.length < wanted; row++) {
    if (target.known(row)) continue;
    if (seen++ % stride !== 0) continue;
    const found = fullModel.neighbours(row, previewK);
    if (found === null) continue;
    let value: string;
    if (target.kind === "number") {
      const raw = weightedMean(target.nums, found, previewK);
      value = formatNumber(roundTo(raw, wholeNumbers(target.nums) ? 0 : decimalsOf(column)));
    } else if (coded !== null) {
      const code = weightedVote(coded.codes, found, previewK);
      if (code < 0) continue;
      value = coded.labels[code];
    } else {
      continue;
    }
    preview.push({ row, value, neighbours: found.rows.slice(0, previewK) });
  }

  return {
    kind: target.kind,
    missing,
    donors: fullModel.donors,
    tested: scored,
    results,
    baseline: { name: baseName, score: scored > 0 ? baseSum / scored : NaN },
    bestK,
    thin: scored < 30 || fullModel.donors < 30,
    preview,
  };
}

export interface KnnPredictorScore {
  index: number;
  name: string;
  kind: KnnKind | null;
  /** Why this column cannot be used (null when it can). */
  reason: string | null;
  /** Share of rows where this column is empty. */
  missingShare: number;
  /** How strongly it goes with the column being filled, 0 to 1 (null when it cannot be told). */
  relatedness: number | null;
}

/**
 * Says, for every other column, whether it can help fill `target` and how
 * strongly it moves with it: correlation between two number columns, the
 * correlation ratio between a number and a category, Cramér's V between two
 * categories. Measured on rows where both are present, on up to 20,000 rows.
 */
export function knnPredictorScores(
  columns: readonly ColumnData[],
  target: number,
  maxRows = 20_000,
): KnnPredictorScore[] {
  const source = columns[target];
  const targetInfo = source === undefined ? null : targetData(source);
  const rowCount = source === undefined ? 0 : source.raw.length;
  const stride = Math.max(1, Math.floor(rowCount / maxRows));
  const rows: number[] = [];
  for (let row = 0; row < rowCount; row += stride) rows.push(row);
  const scores: KnnPredictorScore[] = [];
  columns.forEach((column, index) => {
    const base = { index, name: column.name, kind: knnKindOf(column), reason: null as string | null, missingShare: 0, relatedness: null as number | null };
    if (index === target) {
      scores.push({ ...base, reason: "this is the column being filled" });
      return;
    }
    const kind = knnKindOf(column);
    if (column.type === "identifier") {
      scores.push({ ...base, kind: null, reason: "looks like an ID: every row is different" });
      return;
    }
    if (kind === null) {
      scores.push({ ...base, reason: "dates and times cannot be compared yet" });
      return;
    }
    let present = 0;
    if (kind === "number") {
      const values = valuesOf(column);
      for (let row = 0; row < rowCount; row++) if (Number.isFinite(values[row])) present++;
    } else {
      for (let row = 0; row < rowCount; row++) if (!column.isNull(column.raw[row])) present++;
    }
    const missingShare = rowCount === 0 ? 1 : 1 - present / rowCount;
    if (present === 0) {
      scores.push({ ...base, missingShare, reason: "empty in every row" });
      return;
    }
    let coded: CategoryCodes | null = null;
    if (kind === "category") {
      coded = categoryCodes(column);
      if (coded === null) {
        scores.push({ ...base, missingShare, reason: `too many different values (over ${MAX_CATEGORIES})` });
        return;
      }
    }
    let relatedness: number | null = null;
    if (targetInfo !== null) {
      const feature = kind === "number" ? valuesOf(column) : (coded as CategoryCodes).codes;
      relatedness = relation(targetInfo, kind, feature, rows);
    }
    scores.push({ ...base, missingShare, relatedness });
  });
  return scores;
}

function relation(target: TargetData, kind: KnnKind, feature: Float64Array | Int32Array, rows: readonly number[]): number | null {
  const present = (row: number): boolean => (kind === "number" ? Number.isFinite(feature[row]) : feature[row] >= 0);
  const usable = rows.filter((row) => target.known(row) && present(row));
  if (usable.length < 30) return null;
  if (target.kind === "number" && kind === "number") {
    // Rank correlation: a few huge values must not hide a clear relationship.
    const rx = ranksOf(usable.map((row) => feature[row]));
    const ry = ranksOf(usable.map((row) => target.nums[row]));
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < usable.length; i++) {
      const x = rx[i];
      const y = ry[i];
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    const n = usable.length;
    const cov = sxy - (sx * sy) / n;
    const vx = sxx - (sx * sx) / n;
    const vy = syy - (sy * sy) / n;
    return vx > 0 && vy > 0 ? Math.min(1, Math.abs(cov) / Math.sqrt(vx * vy)) : 0;
  }
  if (target.kind === "category" && kind === "category") {
    const codes = (target.coded as CategoryCodes).codes;
    const table = new Map<number, Map<number, number>>();
    const rowTotals = new Map<number, number>();
    const colTotals = new Map<number, number>();
    for (const row of usable) {
      const a = codes[row];
      const b = feature[row];
      let inner = table.get(a);
      if (inner === undefined) {
        inner = new Map();
        table.set(a, inner);
      }
      inner.set(b, (inner.get(b) ?? 0) + 1);
      rowTotals.set(a, (rowTotals.get(a) ?? 0) + 1);
      colTotals.set(b, (colTotals.get(b) ?? 0) + 1);
    }
    const n = usable.length;
    let chi = 0;
    for (const [a, rowTotal] of rowTotals) {
      const inner = table.get(a) as Map<number, number>;
      for (const [b, colTotal] of colTotals) {
        const expected = (rowTotal * colTotal) / n;
        chi += ((inner.get(b) ?? 0) - expected) ** 2 / expected;
      }
    }
    const dof = Math.min(rowTotals.size, colTotals.size) - 1;
    return dof > 0 ? Math.min(1, Math.sqrt(chi / (n * dof))) : 0;
  }
  // One number, one category: how much of the number's spread the categories explain.
  const values = new Float64Array(usable.length);
  const groups = new Int32Array(usable.length);
  usable.forEach((row, i) => {
    if (target.kind === "number") {
      values[i] = target.nums[row];
      groups[i] = feature[row];
    } else {
      values[i] = feature[row];
      groups[i] = (target.coded as CategoryCodes).codes[row];
    }
  });
  const sums = new Map<number, { n: number; sum: number }>();
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i];
    const entry = sums.get(groups[i]) ?? { n: 0, sum: 0 };
    entry.n++;
    entry.sum += values[i];
    sums.set(groups[i], entry);
  }
  const mean = total / values.length;
  let between = 0;
  for (const { n, sum } of sums.values()) between += n * (sum / n - mean) ** 2;
  let whole = 0;
  for (let i = 0; i < values.length; i++) whole += (values[i] - mean) ** 2;
  return whole > 0 ? Math.sqrt(Math.min(1, between / whole)) : 0;
}

/** The most decimal places the column's own values show (capped), so a fill is not written to nine places. */
function decimalsOf(column: ColumnData): number {
  if (column.type === "integer") return 0;
  let places = 0;
  let seen = 0;
  for (let row = 0; row < column.raw.length && seen < 5000; row++) {
    const value = column.raw[row];
    if (column.isNull(value)) continue;
    seen++;
    const dot = value.indexOf(".");
    if (dot >= 0) places = Math.max(places, value.trim().length - dot - 1);
  }
  return Math.min(places, 6);
}

function roundTo(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function wholeNumbers(values: Float64Array): boolean {
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]) && !Number.isInteger(values[i])) return false;
  return true;
}

/** Ranks (ties share their average rank), for rank correlation. */
function ranksOf(values: readonly number[]): Float64Array {
  const order = values.map((_, index) => index).sort((a, b) => values[a] - values[b]);
  const ranks = new Float64Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = rank;
    i = j + 1;
  }
  return ranks;
}

function modeCode(coded: CategoryCodes): number | null {
  let best = -1;
  let top = 0;
  coded.counts.forEach((count, code) => {
    if (count > top) {
      top = count;
      best = code;
    }
  });
  return best < 0 ? null : best;
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)];
}

function medianOf(values: Float64Array): number | null {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) finite.push(values[i]);
  }
  if (finite.length === 0) return null;
  finite.sort((a, b) => a - b);
  const mid = finite.length >>> 1;
  return finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
}

interface KdNode {
  index: number;
  axis: number;
  left: KdNode | null;
  right: KdNode | null;
}

class NeighborList {
  private readonly indices: number[] = [];
  private readonly distances: number[] = [];

  constructor(private readonly capacity: number) {}

  get limit(): number {
    const count = this.distances.length;
    return count < this.capacity ? Infinity : this.distances[count - 1];
  }

  get size(): number {
    return this.indices.length;
  }

  push(index: number, distance: number): void {
    const count = this.distances.length;
    if (count === this.capacity && distance >= this.distances[count - 1]) return;
    let position = count;
    while (position > 0 && this.distances[position - 1] > distance) position--;
    this.distances.splice(position, 0, distance);
    this.indices.splice(position, 0, index);
    if (this.distances.length > this.capacity) {
      this.distances.pop();
      this.indices.pop();
    }
  }

  forEach(callback: (index: number, distance: number) => void): void {
    for (let i = 0; i < this.indices.length; i++) callback(this.indices[i], this.distances[i]);
  }
}

/** Small k-d tree (points are flattened, dims per point). */
class KdTree {
  private readonly root: KdNode | null;

  constructor(
    private readonly points: Float64Array,
    private readonly dims: number,
    count: number,
  ) {
    const indices = new Array<number>(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    this.root = this.build(indices, 0);
  }

  knn(query: Float64Array, mask: Uint8Array, k: number): NeighborList {
    const neighbours = new NeighborList(Math.max(1, k));
    let present = 0;
    for (let d = 0; d < this.dims; d++) {
      if (mask[d] === 1) present++;
    }
    if (this.root !== null && present > 0) {
      this.search(this.root, query, mask, this.dims / present, neighbours);
    }
    return neighbours;
  }

  private build(indices: number[], depth: number): KdNode | null {
    if (indices.length === 0) return null;
    const axis = depth % this.dims;
    indices.sort((a, b) => this.points[a * this.dims + axis] - this.points[b * this.dims + axis]);
    const mid = indices.length >>> 1;
    return {
      index: indices[mid],
      axis,
      left: this.build(indices.slice(0, mid), depth + 1),
      right: this.build(indices.slice(mid + 1), depth + 1),
    };
  }

  private search(
    node: KdNode,
    query: Float64Array,
    mask: Uint8Array,
    scale: number,
    neighbours: NeighborList,
  ): void {
    const base = node.index * this.dims;
    let sum = 0;
    for (let d = 0; d < this.dims; d++) {
      if (mask[d] === 0) continue;
      const diff = query[d] - this.points[base + d];
      sum += diff * diff;
    }
    neighbours.push(node.index, Math.sqrt(sum * scale));

    const axis = node.axis;
    const diff = mask[axis] === 1 ? query[axis] - this.points[base + axis] : 0;
    if (diff < 0) {
      if (node.left !== null) this.search(node.left, query, mask, scale, neighbours);
    } else if (node.right !== null) {
      this.search(node.right, query, mask, scale, neighbours);
    }
    const limit = neighbours.limit;
    if (mask[axis] === 0 || diff * diff * scale <= limit * limit) {
      if (diff < 0) {
        if (node.right !== null) this.search(node.right, query, mask, scale, neighbours);
      } else if (node.left !== null) {
        this.search(node.left, query, mask, scale, neighbours);
      }
    }
  }
}
