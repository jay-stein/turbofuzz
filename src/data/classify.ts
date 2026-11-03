/**
 * Colour classes for a choropleth, on the lines of QGIS's graduated renderer: a method proposes the breaks, and the person
 * can overwrite any of them. Breaks run low to high, one more than there are classes. A value belongs to the class whose
 * upper break it does not exceed, and the first class includes its lower break.
 */

export type ClassMethod = "continuous" | "natural" | "quantile" | "equal" | "fixed" | "stddev" | "pretty" | "log" | "manual";

export const CLASS_METHODS: readonly { id: ClassMethod; label: string; hint: string }[] = [
  { id: "natural", label: "Natural breaks (Jenks)", hint: "Puts the breaks where the data has gaps, keeping similar values together. Copes well with skewed data" },
  { id: "quantile", label: "Quantile (equal count)", hint: "Each class holds the same number of regions. Shows rank well, and can make small differences look large" },
  { id: "equal", label: "Equal interval", hint: "Each class spans the same range. Easy to read; a few extremes can leave most regions in one class" },
  { id: "fixed", label: "Fixed interval", hint: "You set the step, such as every 500" },
  { id: "stddev", label: "Standard deviation", hint: "Classes step away from the average. Pair with a diverging palette" },
  { id: "pretty", label: "Pretty breaks", hint: "Round numbers close to equal intervals" },
  { id: "log", label: "Logarithmic", hint: "Each class spans a power of ten or a fraction of one. Positive values only" },
  { id: "continuous", label: "Continuous", hint: "A smooth ramp with no classes" },
  { id: "manual", label: "Manual", hint: "The breaks you typed" },
];

const finiteSorted = (values: ArrayLike<number>): number[] => {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) out.push(values[i]!);
  return out.sort((a, b) => a - b);
};

/** Jenks' cost is the square of the values, so above this many they are thinned evenly, as QGIS does. */
const JENKS_LIMIT = 3000;

/**
 * Fisher-Jenks: the partition of sorted values into k runs that minimises the sum of squared deviations within the runs,
 * by dynamic programming. Exact up to JENKS_LIMIT values.
 */
function jenks(sorted: readonly number[], k: number): number[] {
  const step = sorted.length > JENKS_LIMIT ? sorted.length / JENKS_LIMIT : 1;
  const data: number[] = [];
  for (let i = 0; i < sorted.length; i += step) data.push(sorted[Math.floor(i)]!);
  const n = data.length;
  const prefix = new Float64Array(n + 1);
  const squares = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i]! + data[i]!;
    squares[i + 1] = squares[i]! + data[i]! * data[i]!;
  }
  /** Squared deviation of data[i..j] inclusive. */
  const cost = (i: number, j: number): number => {
    const sum = prefix[j + 1]! - prefix[i]!;
    return squares[j + 1]! - squares[i]! - (sum * sum) / (j - i + 1);
  };
  let previous = new Float64Array(n);
  for (let j = 0; j < n; j++) previous[j] = cost(0, j);
  const starts: Int32Array[] = [];
  for (let c = 1; c < k; c++) {
    const current = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
    const start = new Int32Array(n);
    for (let j = c; j < n; j++) {
      for (let i = c; i <= j; i++) {
        const total = previous[i - 1]! + cost(i, j);
        if (total < current[j]!) {
          current[j] = total;
          start[j] = i;
        }
      }
    }
    previous = current;
    starts.push(start);
  }
  const breaks = new Array<number>(k + 1);
  breaks[k] = data[n - 1]!;
  breaks[0] = data[0]!;
  let end = n - 1;
  for (let c = k - 1; c >= 1; c--) {
    const i = starts[c - 1]![end]!;
    breaks[c] = data[i - 1]!;
    end = i - 1;
  }
  return breaks;
}

const quantileOf = (sorted: readonly number[], q: number): number => {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower]! : sorted[lower]! * (upper - position) + sorted[upper]! * (position - lower);
};

/** A round step of about this size: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const scaled = rough / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
}

/** Repeats merged, in order: a method can land two breaks on one value when the data has few distinct ones. */
const distinct = (breaks: readonly number[]): number[] => breaks.filter((value, index) => index === 0 || value > breaks[index - 1]!);

export interface ClassOptions {
  classes: number;
  /** Fixed interval: the step. */
  interval?: number;
  /** Manual: the breaks themselves. */
  manual?: readonly number[];
}

/**
 * The breaks for these values. Fewer than asked for when the data cannot fill them. Empty when there is nothing to class;
 * a single value gives a single class around it. `continuous` gives just the two ends.
 */
export function classBreaks(values: ArrayLike<number>, method: ClassMethod, options: ClassOptions): number[] {
  const sorted = finiteSorted(values);
  if (sorted.length === 0) return [];
  const low = sorted[0]!;
  const high = sorted[sorted.length - 1]!;
  if (high === low) return [low, low];
  const k = Math.max(1, Math.min(32, Math.floor(options.classes)));
  switch (method) {
    case "continuous":
      return [low, high];
    case "manual": {
      const manual = [...(options.manual ?? [])].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
      return manual.length >= 2 ? distinct(manual) : classBreaks(values, "natural", options);
    }
    case "natural": {
      // As few values as classes: each its own. A first class can hold just the lowest value, so its edges may meet.
      const unique = new Set(sorted).size;
      const breaks = jenks(sorted, Math.min(k, unique));
      return [breaks[0]!, ...distinct(breaks.slice(1))];
    }
    case "quantile":
      return distinct(Array.from({ length: k + 1 }, (_, index) => quantileOf(sorted, index / k)));
    case "equal":
      return Array.from({ length: k + 1 }, (_, index) => (index === k ? high : low + ((high - low) * index) / k));
    case "fixed": {
      const step = options.interval !== undefined && options.interval > 0 ? options.interval : niceStep((high - low) / k);
      const first = Math.floor(low / step) * step;
      const count = Math.ceil((high - first) / step);
      // A step far too small for the range would make a class per pixel: a colour scale tops out well before that.
      if (count > 64) return classBreaks(values, "fixed", { ...options, interval: niceStep((high - low) / 64) });
      return Array.from({ length: Math.max(1, count) + 1 }, (_, index) => first + index * step);
    }
    case "pretty": {
      const step = niceStep((high - low) / k);
      const first = Math.floor(low / step) * step;
      const count = Math.max(1, Math.ceil((high - first) / step));
      return Array.from({ length: count + 1 }, (_, index) => first + index * step);
    }
    case "stddev": {
      let sum = 0;
      for (const value of sorted) sum += value;
      const mean = sum / sorted.length;
      let squares = 0;
      for (const value of sorted) squares += (value - mean) ** 2;
      const sd = Math.sqrt(squares / sorted.length);
      if (sd === 0) return [low, high];
      // Steps of one deviation either side of the average, out to the data; the ends are the data's own.
      const inner: number[] = [];
      for (let n = Math.ceil((low - mean) / sd); n <= Math.floor((high - mean) / sd); n++) {
        const at = mean + n * sd;
        if (at > low && at < high) inner.push(at);
      }
      return [low, ...inner, high];
    }
    case "log": {
      const positive = sorted.filter((value) => value > 0);
      if (positive.length === 0) return classBreaks(values, "equal", options);
      const logLow = Math.log10(positive[0]!);
      const logHigh = Math.log10(high);
      if (logHigh === logLow) return [low, high];
      const inner = Array.from({ length: k - 1 }, (_, index) => 10 ** (logLow + ((logHigh - logLow) * (index + 1)) / k));
      return distinct([low, ...inner, high]);
    }
  }
}

/** Which class a value is in; -1 for no value, or one outside manual breaks. */
export function classOf(value: number, breaks: readonly number[]): number {
  if (!Number.isFinite(value) || breaks.length < 2) return -1;
  if (value < breaks[0]! || value > breaks[breaks.length - 1]!) return -1;
  for (let i = 1; i < breaks.length; i++) if (value <= breaks[i]!) return i - 1;
  return breaks.length - 2;
}

/** How many values fall in each class, with those in none. */
export function classCounts(values: ArrayLike<number>, breaks: readonly number[]): { counts: number[]; outside: number; missing: number } {
  const counts = new Array<number>(Math.max(0, breaks.length - 1)).fill(0);
  let outside = 0;
  let missing = 0;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]!)) {
      missing++;
      continue;
    }
    const at = classOf(values[i]!, breaks);
    if (at < 0) outside++;
    else counts[at]!++;
  }
  return { counts, outside, missing };
}

/**
 * How far apart the classes are, on 0 to 1: Jenks' goodness of variance fit, the share of the variance the classes
 * explain. Worth showing, since it is what the methods compete on.
 */
export function varianceFit(values: ArrayLike<number>, breaks: readonly number[]): number {
  const sorted = finiteSorted(values);
  if (sorted.length < 2 || breaks.length < 2) return Number.NaN;
  let sum = 0;
  for (const value of sorted) sum += value;
  const mean = sum / sorted.length;
  let total = 0;
  for (const value of sorted) total += (value - mean) ** 2;
  if (total === 0) return 1;
  const k = breaks.length - 1;
  const sums = new Array<number>(k).fill(0);
  const counts = new Array<number>(k).fill(0);
  for (const value of sorted) {
    const at = classOf(value, breaks);
    if (at < 0) continue;
    sums[at]! += value;
    counts[at]!++;
  }
  let within = 0;
  for (const value of sorted) {
    const at = classOf(value, breaks);
    if (at < 0) continue;
    within += (value - sums[at]! / counts[at]!) ** 2;
  }
  return 1 - within / total;
}
