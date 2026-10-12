function gaussianKernel(sigma: number): { weights: Float64Array; radius: number } {
  const s = Math.max(0.3, sigma);
  const radius = Math.max(1, Math.ceil(2 * s));
  const weights = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let d = -radius; d <= radius; d++) {
    const w = Math.exp(-0.5 * (d / s) ** 2);
    weights[d + radius] = w;
    sum += w;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= sum;
  return { weights, radius };
}

/** 1D Gaussian smoothing (KDE-like) of a series; total mass is preserved. */
export function smoothSeries(values: ArrayLike<number>, sigma = 1.5): Float64Array {
  const length = values.length;
  const out = new Float64Array(length);
  if (length === 0) return out;
  const { weights, radius } = gaussianKernel(sigma);
  for (let i = 0; i < length; i++) {
    let acc = 0;
    for (let d = -radius; d <= radius; d++) {
      const j = i + d;
      if (j < 0 || j >= length) continue;
      acc += values[j] * weights[d + radius];
    }
    out[i] = acc;
  }
  return out;
}

/** Separable 2D Gaussian smoothing of a density grid. */
export function smoothGrid(
  counts: ArrayLike<number>,
  cols: number,
  rows: number,
  sigma = 1.5,
): Float64Array {
  const temp = new Float64Array(cols * rows);
  const out = new Float64Array(cols * rows);
  const { weights, radius } = gaussianKernel(sigma);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let acc = 0;
      for (let d = -radius; d <= radius; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= cols) continue;
        acc += counts[y * cols + xx] * weights[d + radius];
      }
      temp[y * cols + x] = acc;
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let acc = 0;
      for (let d = -radius; d <= radius; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= rows) continue;
        acc += temp[yy * cols + x] * weights[d + radius];
      }
      out[y * cols + x] = acc;
    }
  }
  return out;
}

export interface ContourPoint {
  x: number;
  y: number;
}

/** Iso-levels spread below the peak: 5 levels -> 18%, 36%, 55%, 73%, 91%. */
export function contourLevels(max: number, count = 5): number[] {
  const levels: number[] = [];
  if (!(max > 0) || count < 1) return levels;
  for (let index = 1; index <= count; index++) {
    levels.push((index / (count + 0.5)) * max);
  }
  return levels;
}

/**
 * Marching-squares iso-lines for a scalar field (row 0 = low y). Returns flat
 * [x1, y1, x2, y2, ...] segments in grid coordinates where x spans [0, cols]
 * and y spans [0, rows].
 */
export function marchingSquares(
  field: ArrayLike<number>,
  cols: number,
  rows: number,
  level: number,
): number[] {
  const segments: number[] = [];
  if (cols < 2 || rows < 2) return segments;
  const at = (x: number, y: number): number => field[y * cols + x];
  const lerp = (a: number, b: number): number => {
    const span = b - a;
    if (span === 0) return 0.5;
    return Math.min(1, Math.max(0, (level - a) / span));
  };
  const push = (p1: ContourPoint, p2: ContourPoint): void => {
    segments.push(p1.x, p1.y, p2.x, p2.y);
  };

  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const a = at(x, y);
      const b = at(x + 1, y);
      const c = at(x + 1, y + 1);
      const d = at(x, y + 1);
      let mask = 0;
      if (a > level) mask |= 8;
      if (b > level) mask |= 4;
      if (c > level) mask |= 2;
      if (d > level) mask |= 1;
      if (mask === 0 || mask === 15) continue;

      const top: ContourPoint = { x: x + lerp(a, b), y };
      const right: ContourPoint = { x: x + 1, y: y + lerp(b, c) };
      const bottom: ContourPoint = { x: x + lerp(d, c), y: y + 1 };
      const left: ContourPoint = { x, y: y + lerp(a, d) };

      switch (mask) {
        case 1:
        case 14:
          push(bottom, left);
          break;
        case 2:
        case 13:
          push(bottom, right);
          break;
        case 3:
        case 12:
          push(left, right);
          break;
        case 4:
        case 11:
          push(top, right);
          break;
        case 6:
        case 9:
          push(top, bottom);
          break;
        case 7:
        case 8:
          push(top, left);
          break;
        case 5:
          push(top, left);
          push(bottom, right);
          break;
        case 10:
          push(top, right);
          push(bottom, left);
          break;
        default:
          break;
      }
    }
  }
  return segments;
}
