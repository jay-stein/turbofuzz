/**
 * Error bars for a statistic of each group. Formulas where they exist, because they take one pass over the rows; a seeded
 * bootstrap where they do not, or where the data's shape makes a formula doubtful, because it costs a thousand passes.
 * Two different questions are on offer and must not be confused: how varied the rows are (standard deviation, percentile
 * range) and how well the statistic is known (confidence interval, standard error).
 */

export type IntervalKind = "ci" | "bootstrap" | "se" | "sd" | "pi";

export const INTERVAL_KINDS: readonly { id: IntervalKind; label: string; asks: string }[] = [
  { id: "ci", label: "95% CI (formula)", asks: "How well is it known? A t-interval for an average, an exact rank interval for a median" },
  { id: "bootstrap", label: "95% CI (bootstrap)", asks: "How well is it known? Resamples the rows 1,000 times: no assumption about their shape, but slower" },
  { id: "se", label: "Standard error", asks: "How well is it known? The average, plus and minus one standard error" },
  { id: "sd", label: "Standard deviation", asks: "How varied are the rows? The average, plus and minus one standard deviation" },
  { id: "pi", label: "Percentile range (95%)", asks: "How varied are the rows? The middle 95% of them" },
];

export const BOOTSTRAP_RESAMPLES = 1000;
export const BOOTSTRAP_SEED = 20_261_103;

const BOOTSTRAPPABLE: ReadonlySet<string> = new Set(["mean", "median", "stddev", "variance", "p25", "p75", "p90", "p95"]);

/** Why this statistic can have no error bars of any kind; null when it can. */
export function statisticBlock(agg: string): string | null {
  if (BOOTSTRAPPABLE.has(agg)) return null;
  if (agg === "min" || agg === "max") return "A lowest or highest value has no reliable interval: choose Average or Median";
  return "Totals and counts describe the rows you have, with no sampling error to show: choose Average or Median";
}

/** Why this kind of bar does not suit this statistic; null when it does. */
export function intervalBlock(kind: IntervalKind, agg: string): string | null {
  const block = statisticBlock(agg);
  if (block !== null) return block;
  if (kind === "bootstrap") return null;
  if (kind === "ci") return agg === "mean" || agg === "median" ? null : "No formula for this statistic: use the bootstrap";
  if (kind === "pi") return agg === "mean" || agg === "median" ? null : "Only for an average or median";
  return agg === "mean" ? null : "Only for an average";
}

export function defaultInterval(agg: string): IntervalKind {
  return agg === "mean" || agg === "median" ? "ci" : "bootstrap";
}

export interface GroupInterval {
  n: number;
  center: number;
  low: number;
  high: number;
  /** Spread of the resampled statistic; bootstrap only. */
  bootSe: number;
}

const NONE = (n: number, center = Number.NaN): GroupInterval => ({ n, center, low: Number.NaN, high: Number.NaN, bootSe: Number.NaN });

/** Two-sided 97.5% point of Student's t. */
const T_975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

export function t975(df: number): number {
  if (df < 1) return Number.NaN;
  if (df <= T_975.length) return T_975[df - 1]!;
  // Cornish-Fisher expansion about the normal point; better than three decimals beyond the table.
  const z = 1.959964;
  const z3 = z * z * z;
  const z5 = z3 * z * z;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df);
}

function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const position = (n - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower]! : sorted[lower]! * (upper - position) + sorted[upper]! * (position - lower);
}

/**
 * Ranks (0-based) of the distribution-free 95% interval for a median: the order statistics a sample's median falls between
 * at least 95% of the time. Exact binomial up to a thousand rows, the normal approximation beyond. Null below six rows,
 * where no pair of ranks reaches 95%.
 */
export function medianRanks(n: number): [number, number] | null {
  if (n < 6) return null;
  if (n > 1000) {
    const half = 0.5 * 1.959964 * Math.sqrt(n);
    return [Math.max(0, Math.floor(n / 2 - half) - 1), Math.min(n - 1, Math.ceil(n / 2 + half))];
  }
  let pmf = 0.5 ** n;
  let cumulative = pmf;
  let lowerRank = 0; // X <= lowerRank has probability `cumulative`
  let best = -1;
  while (2 * cumulative <= 0.05) {
    best = lowerRank;
    pmf *= (n - lowerRank) / (lowerRank + 1);
    lowerRank++;
    cumulative += pmf;
  }
  if (best < 0) return null;
  // With L = best + 1 (1-based), the interval is [x(L), x(n-L+1)], which leaves 2·P(X <= best) outside.
  return [best + 1 - 1, n - (best + 1)];
}

function meanAndSd(values: ArrayLike<number>): { mean: number; sd: number } {
  const n = values.length;
  let mean = 0;
  let m2 = 0;
  for (let i = 0; i < n; i++) {
    const delta = values[i]! - mean;
    mean += delta / (i + 1);
    m2 += delta * (values[i]! - mean);
  }
  return { mean, sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : Number.NaN };
}

/** One group's interval by formula. `values` holds only that group's finite values, in any order. */
export function formulaInterval(values: Float64Array, kind: Exclude<IntervalKind, "bootstrap">, agg: string): GroupInterval {
  const n = values.length;
  if (n === 0) return NONE(0);
  if (agg === "median" || kind === "pi") {
    const sorted = Float64Array.from(values).sort();
    const center = agg === "median" ? quantileSorted(sorted, 0.5) : meanAndSd(values).mean;
    if (kind === "pi") {
      return n < 2 ? NONE(n, center) : { n, center, low: quantileSorted(sorted, 0.025), high: quantileSorted(sorted, 0.975), bootSe: Number.NaN };
    }
    const ranks = medianRanks(n);
    return ranks === null ? NONE(n, center) : { n, center, low: sorted[ranks[0]]!, high: sorted[ranks[1]]!, bootSe: Number.NaN };
  }
  const { mean, sd } = meanAndSd(values);
  if (n < 2) return NONE(n, mean);
  const margin = kind === "sd" ? sd : kind === "se" ? sd / Math.sqrt(n) : (t975(n - 1) * sd) / Math.sqrt(n);
  return { n, center: mean, low: mean - margin, high: mean + margin, bootSe: Number.NaN };
}

/** Small, fast and seedable, so the same chart always shows the same bars. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A group's own stream of random numbers, so it does not change when other groups come and go. */
export function groupSeed(label: string, seed = BOOTSTRAP_SEED): number {
  let hash = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < label.length; i++) hash = Math.imul(hash ^ label.charCodeAt(i), 16_777_619) >>> 0;
  return hash;
}

const QUANTILES: Readonly<Record<string, number>> = { median: 0.5, p25: 0.25, p75: 0.75, p90: 0.9, p95: 0.95 };

/**
 * One resample's statistic, as a function. A quantile needs no sort per resample: with the values sorted once, counting how
 * often each is drawn and walking the counts gives the same order statistics in linear time, which is what makes a thousand
 * medians of a big group affordable.
 */
function resampler(values: Float64Array, agg: string, random: () => number): () => number {
  const n = values.length;
  const q = QUANTILES[agg];
  if (q !== undefined) {
    const sorted = Float64Array.from(values).sort();
    const counts = new Uint32Array(n);
    const position = (n - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return () => {
      counts.fill(0);
      for (let draw = 0; draw < n; draw++) counts[(random() * n) | 0]!++;
      let cumulative = 0;
      let low = Number.NaN;
      for (let i = 0; i < n; i++) {
        cumulative += counts[i]!;
        if (Number.isNaN(low) && cumulative > lower) low = sorted[i]!;
        if (cumulative > upper) return lower === upper ? low : low * (upper - position) + sorted[i]! * (position - lower);
      }
      return low;
    };
  }
  if (agg === "mean") {
    return () => {
      let sum = 0;
      for (let draw = 0; draw < n; draw++) sum += values[(random() * n) | 0]!;
      return sum / n;
    };
  }
  const squareRoot = agg === "stddev";
  return () => {
    let sum = 0;
    let squares = 0;
    for (let draw = 0; draw < n; draw++) {
      const value = values[(random() * n) | 0]!;
      sum += value;
      squares += value * value;
    }
    const variance = Math.max(0, (squares - (sum * sum) / n) / (n - 1));
    return squareRoot ? Math.sqrt(variance) : variance;
  };
}

export interface BootstrapProgress {
  /** Rows drawn so far, of all there are to draw. */
  done: number;
  total: number;
  /** Which group, counting from one, and which resample within it. */
  group: number;
  groups: number;
  resample: number;
  resamples: number;
}

/**
 * Percentile bootstrap of `agg` for each group. Calls `pulse` every so often, about 20 times a second; it should let other
 * work run and return false to stop, in which case the result is null.
 */
export async function bootstrapIntervals(
  groups: readonly { label: string; values: Float64Array }[],
  agg: string,
  pulse: (progress: BootstrapProgress) => Promise<boolean>,
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
  sliceMs = 50,
): Promise<GroupInterval[] | null> {
  const total = groups.reduce((sum, group) => sum + group.values.length * resamples, 0);
  const out: GroupInterval[] = [];
  let done = 0;
  let last = performance.now();
  for (let g = 0; g < groups.length; g++) {
    const { label, values } = groups[g]!;
    const n = values.length;
    if (n < 2) {
      out.push(NONE(n));
      done += n * resamples;
      continue;
    }
    const center = (() => {
      const q = QUANTILES[agg];
      if (q !== undefined) return quantileSorted(Float64Array.from(values).sort(), q);
      const { mean, sd } = meanAndSd(values);
      return agg === "mean" ? mean : agg === "stddev" ? sd : sd * sd;
    })();
    const draw = resampler(values, agg, seededRandom(groupSeed(label, seed)));
    const stats = new Float64Array(resamples);
    for (let r = 0; r < resamples; r++) {
      stats[r] = draw();
      done += n;
      if (performance.now() - last >= sliceMs) {
        const go = await pulse({ done, total, group: g + 1, groups: groups.length, resample: r + 1, resamples });
        if (!go) return null;
        last = performance.now();
      }
    }
    stats.sort();
    out.push({ n, center, low: quantileSorted(stats, 0.025), high: quantileSorted(stats, 0.975), bootSe: meanAndSd(stats).sd });
  }
  return out;
}
