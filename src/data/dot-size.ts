/**
 * Dot radius from a value, the way a GIS sizes proportional symbols (QGIS's size assistant):
 * the smallest value maps to the smallest radius and the largest to the largest, with a scale
 * method between. Values outside a chosen range are clamped to its ends, so one extreme value
 * cannot shrink every other dot.
 */

export type DotScale = "linear" | "area" | "flannery" | "log";

export const DOT_SCALES: readonly { id: DotScale; label: string; hint: string }[] = [
  { id: "linear", label: "Linear", hint: "Radius grows in step with the value" },
  { id: "area", label: "Area (square root)", hint: "Area, not radius, grows in step with the value: the honest size for counts" },
  { id: "flannery", label: "Flannery", hint: "Radius grows as value^0.57, a cartographer's correction for how big circles look" },
  { id: "log", label: "Logarithmic", hint: "Compresses a long tail so small values stay visible next to huge ones" },
];

export interface DotSizeSpec {
  /** Radius of the smallest value and of the largest, in pixels. */
  minRadius: number;
  maxRadius: number;
  /** The value range the radii span; null takes the data's own end. */
  valueMin: number | null;
  valueMax: number | null;
  scale: DotScale;
}

/** 0 to 1 along the value range under a scale method. `t` is already 0 to 1 on a straight line. */
export function scaleFraction(t: number, scale: DotScale, span: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  switch (scale) {
    case "area":
      return Math.sqrt(clamped);
    case "flannery":
      return Math.pow(clamped, 0.57);
    case "log":
      // log(1 + distance from the low end): fine for zero and negative lows, and 0 → 0, high end → 1.
      return span > 0 ? Math.log1p(clamped * span) / Math.log1p(span) : clamped;
    default:
      return clamped;
  }
}

/** The value range actually used: the chosen ends where they make sense, else the data's. */
export function dotDomain(
  dataMin: number,
  dataMax: number,
  valueMin: number | null,
  valueMax: number | null,
): { lo: number; hi: number } {
  let lo = valueMin !== null && Number.isFinite(valueMin) ? valueMin : dataMin;
  let hi = valueMax !== null && Number.isFinite(valueMax) ? valueMax : dataMax;
  // A range that points backwards is a slip, not a request: fall back to the data's own.
  if (lo >= hi) {
    lo = dataMin;
    hi = dataMax;
  }
  return { lo, hi };
}

/**
 * Radii (already multiplied by `ui`, the drawing scale) for the first `shown` values, or null
 * when none is a number. A value that is not a number gets the smallest radius.
 */
export function dotRadii(values: ArrayLike<number>, shown: number, spec: DotSizeSpec, ui: number): Float64Array | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < shown; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Infinity) return null;
  const { lo, hi } = dotDomain(min, max, spec.valueMin, spec.valueMax);
  const span = hi - lo;
  const rMin = Math.max(0.5, spec.minRadius) * ui;
  const rMax = Math.max(rMin / ui, spec.maxRadius) * ui;
  const out = new Float64Array(shown);
  for (let i = 0; i < shown; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) {
      out[i] = rMin;
      continue;
    }
    // Everything the same size: the middle, as the other size charts do.
    const t = span > 0 ? (value - lo) / span : 0.5;
    out[i] = rMin + (rMax - rMin) * scaleFraction(t, spec.scale, span);
  }
  return out;
}

/** The smallest and largest value that are numbers, for showing the data's own range. */
export function dataRange(values: ArrayLike<number>, shown: number): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < shown; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : { min, max };
}
