import { ColumnData } from "./column.js";
import { formatNumber } from "./format.js";

const DEFAULT_MAX_DONORS = 20_000;
const EPSILON = 1e-9;

/**
 * k-NN imputation.
 *
 * `fill` columns are the cells to impute; `predictors` are the numeric columns
 * used to measure similarity (they are not modified). Donors are rows complete
 * across both sets, so every donor can supply a value for every fill column.
 * Distances are computed in standardised predictor space over the predictor
 * dimensions a query row actually has, scaled by dims/present (nan-euclidean).
 * Missing cells take the distance weighted mean of the k nearest donors, with a
 * median fallback when donors are scarce or a row has no observed predictor.
 */
export function knnImpute(
  columns: readonly ColumnData[],
  fill: readonly number[],
  predictors: readonly number[],
  k: number,
  maxDonors = DEFAULT_MAX_DONORS,
): ColumnData[] {
  const next = columns.slice();
  const targets = unique(fill).filter((index) => isNumeric(columns[index]));
  if (targets.length === 0) return next;
  let features = unique(predictors).filter((index) => isNumeric(columns[index]));
  if (features.length === 0) features = targets.slice();

  const rowCount = columns.length > 0 ? columns[0].raw.length : 0;
  const numbers = new Map<number, Float64Array>();
  const numberFor = (index: number): Float64Array => {
    let values = numbers.get(index);
    if (values === undefined) {
      values = columns[index].numbers();
      numbers.set(index, values);
    }
    return values;
  };

  const featureValues = features.map(numberFor);
  const targetValues = targets.map(numberFor);
  const dims = features.length;

  const means = new Float64Array(dims);
  const scales = new Float64Array(dims);
  for (let d = 0; d < dims; d++) {
    const feature = featureValues[d];
    let sum = 0;
    let count = 0;
    for (let i = 0; i < rowCount; i++) {
      if (Number.isFinite(feature[i])) {
        sum += feature[i];
        count++;
      }
    }
    const mean = count > 0 ? sum / count : 0;
    let variance = 0;
    for (let i = 0; i < rowCount; i++) {
      if (Number.isFinite(feature[i])) variance += (feature[i] - mean) ** 2;
    }
    means[d] = mean;
    scales[d] = count > 0 ? Math.sqrt(variance / count) || 1 : 1;
  }

  const involved = [...new Set([...features, ...targets])];
  const involvedValues = involved.map(numberFor);
  const donorPool: number[] = [];
  for (let row = 0; row < rowCount; row++) {
    let complete = true;
    for (let i = 0; i < involved.length; i++) {
      if (!Number.isFinite(involvedValues[i][row])) {
        complete = false;
        break;
      }
    }
    if (complete) donorPool.push(row);
  }

  let tree: KdTree | null = null;
  let donorRows = new Int32Array(0);
  if (donorPool.length >= 1) {
    const stride = donorPool.length > maxDonors ? donorPool.length / maxDonors : 1;
    const count = stride > 1 ? Math.max(1, Math.floor(donorPool.length / stride)) : donorPool.length;
    const points = new Float64Array(count * dims);
    donorRows = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const row = donorPool[Math.min(donorPool.length - 1, Math.floor(i * stride))];
      donorRows[i] = row;
      for (let d = 0; d < dims; d++) {
        points[i * dims + d] = (featureValues[d][row] - means[d]) / scales[d];
      }
    }
    tree = new KdTree(points, dims, count);
  }

  const raw = targets.map((index) => columns[index].raw.slice());
  const filled = targets.map(() => new Uint8Array(rowCount));
  const neighbourLimit = Math.max(1, Math.min(Math.floor(k) || 1, donorRows.length));

  for (let row = 0; row < rowCount; row++) {
    let missing = false;
    for (let t = 0; t < targets.length; t++) {
      if (!Number.isFinite(targetValues[t][row])) {
        missing = true;
        break;
      }
    }
    if (!missing || tree === null) continue;

    const query = new Float64Array(dims);
    const mask = new Uint8Array(dims);
    let observed = 0;
    for (let d = 0; d < dims; d++) {
      const value = featureValues[d][row];
      if (Number.isFinite(value)) {
        query[d] = (value - means[d]) / scales[d];
        mask[d] = 1;
        observed++;
      }
    }
    if (observed === 0) continue;

    const neighbours = tree.knn(query, mask, neighbourLimit);
    if (neighbours.size === 0) continue;

    const sums = new Float64Array(targets.length);
    let exactCount = 0;
    neighbours.forEach((_index, distance) => {
      if (distance <= EPSILON) exactCount++;
    });
    if (exactCount > 0) {
      // Rows identical on the observed predictors win outright.
      neighbours.forEach((index, distance) => {
        if (distance > EPSILON) return;
        const donorRow = donorRows[index];
        for (let t = 0; t < targets.length; t++) sums[t] += targetValues[t][donorRow];
      });
      for (let t = 0; t < targets.length; t++) sums[t] /= exactCount;
    } else {
      let weightSum = 0;
      neighbours.forEach((index, distance) => {
        const weight = 1 / distance;
        weightSum += weight;
        const donorRow = donorRows[index];
        for (let t = 0; t < targets.length; t++) sums[t] += weight * targetValues[t][donorRow];
      });
      for (let t = 0; t < targets.length; t++) sums[t] /= weightSum;
    }

    for (let t = 0; t < targets.length; t++) {
      if (Number.isFinite(targetValues[t][row])) continue;
      raw[t][row] = formatNumber(sums[t]);
      filled[t][row] = 1;
    }
  }

  // Anything KNN could not fill falls back to the column median.
  for (let t = 0; t < targets.length; t++) {
    const fallback = median(targetValues[t]);
    if (fallback === null) continue;
    const formatted = formatNumber(fallback);
    for (let row = 0; row < rowCount; row++) {
      if (!Number.isFinite(targetValues[t][row]) && filled[t][row] === 0) raw[t][row] = formatted;
    }
  }

  targets.forEach((columnIndex, t) => {
    const rebuilt = ColumnData.create(columns[columnIndex].name, raw[t]);
    rebuilt.setType(columns[columnIndex].type);
    next[columnIndex] = rebuilt;
  });
  return next;
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)];
}

function isNumeric(column: ColumnData | undefined): boolean {
  return column !== undefined && (column.type === "integer" || column.type === "number");
}

function median(values: Float64Array): number | null {
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
