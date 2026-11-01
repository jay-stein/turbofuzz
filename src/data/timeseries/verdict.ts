/**
 * The trust verdict on the Forecast tab: one badge and one plain sentence, worked out only from
 * results the page already has (how the model ranked on the lockbox fold it was never chosen on,
 * how often it beat the seasonal naive, whether its band held the real value as often as promised).
 * A pure function so each verdict, and the sentence that explains it, can be tested.
 *
 * The idea of holding a test back (the lockbox) and of judging a forecast against the naive
 * benchmark is Hyndman and Athanasopoulos, Forecasting: Principles and Practice (3rd ed.), 5.8 and 5.10.
 */

export type VerdictLevel = "holds" | "middling" | "doubtful" | "baseline" | "untested";

export interface VerdictInput {
  /** The model is the benchmark itself (repeat the last cycle). */
  baseline: boolean;
  /** Error against the seasonal naive at the same horizons: below 1 is better. */
  ratio: number;
  /** Rank (1 = best) on the lockbox fold, or null when no fold could be held back. */
  lockRank: number | null;
  /** How many models were ranked. */
  models: number;
  foldsWon: number;
  foldsOf: number;
  /** Real values inside the 80% band on the latest fold or held-out run, and the share the band aims for. */
  band: { hit: number; tot: number; aim: number } | null;
  /** Fewer than three backtest folds. */
  rough: boolean;
  /** Periods of history behind the forecast. */
  periods: number;
  /** What the seasonal naive repeats, in a word: "year", "week", "day", or "cycle". */
  cycle: string;
  /** Names of simple benchmarks that did better than this model on the lockbox fold. */
  beatenBy?: string[];
  /** The series is mostly zeros with now and then a sale. */
  intermittent?: boolean;
}

/** How far the shaded range can be trusted, said apart from how good the forecast line is. */
export interface RangeNote {
  cls: "good" | "okay";
  /** A short badge: "Reliable", "Too narrow", "Wider than needed". */
  label: string;
  text: string;
}

export interface Verdict {
  level: VerdictLevel;
  /** The badge text. */
  label: string;
  /** The pill colour class the page already styles. */
  cls: "good" | "okay" | "poor" | "base";
  /** One plain sentence about the forecast line itself: where it ranked on data it never saw, and what beat it. */
  sentence: string;
  /** The shaded range, judged on its own by how often past ranges held the real value; null when there is too little to say. */
  range: RangeNote | null;
  /** Other things to act on, each one sentence: only what is true of this forecast. */
  headsUp: string[];
}

const TEEN = new Set([11, 12, 13]);
export function ordinal(n: number): string {
  if (TEEN.has(n % 100)) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

/** Short plain descriptors for the compact board (the technical names stay; see the model docs for the rest). */
export const PLAIN: Readonly<Record<string, string>> = {
  comb: "A steady all-rounder: the average of three smoothing methods",
  ets: "Adapts to trend and season on its own",
  hw: "A trend that flattens out over time",
  reg: "A flexible trend that can use your other columns",
  theta: "Simple smoothing plus half the long-run slope",
  ens: "Smoothing blended with a trend and drivers model",
  sn: "Copies the same point one cycle earlier",
  clim: "The average of the same point in every earlier cycle",
  naive: "Copies the last value forward",
  drift: "The last value plus the average change so far",
  mean: "The average of everything so far",
  ses: "Simple smoothing: a level that follows recent values",
  croston: "For sales that are mostly zero: average size divided by the usual gap between sales",
  sba: "Croston with its upward bias taken out",
  tsb: "For sales that are mostly zero: the chance of a sale this period times its usual size, fading through long gaps",
};

export function trustVerdict(v: VerdictInput): Verdict {
  const headsUp: string[] = [];
  const lucky = !v.baseline && v.foldsOf >= 3 && v.foldsWon * 2 < v.foldsOf;
  const pct = Math.round(Math.abs(1 - v.ratio) * 100);
  const folds = v.foldsOf > 0 ? ` and beat repeating the last ${v.cycle} in ${v.foldsWon} of ${v.foldsOf} tests` : "";
  const named = (names: string[]): string => (names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(" and "));
  // Simple methods that did better on the same unseen data are part of how good the forecast line is, so they ride in its sentence.
  const beaten = !v.baseline && v.beatenBy && v.beatenBy.length > 0 ? ` ${named(v.beatenBy)} did better still, so a simple method is hard to beat here.` : "";

  // The range is judged on its own: how often past ranges held the real value, against the share they aim for.
  let range: RangeNote | null = null;
  if (v.band !== null && v.band.tot >= 20) {
    const share = v.band.hit / v.band.tot, off = share - v.band.aim;
    const got = `${Math.round(share * 100)}%`, aim = `${Math.round(v.band.aim * 100)}%`;
    // 5 points off the aim, over at least 20 checks, is more than a flat run of luck would usually show.
    if (Math.abs(off) <= 0.05) range = { cls: "good", label: "Reliable", text: `In past tests the shaded range caught the real value ${got} of the time (it aims for ${aim}), so it can be taken at face value.` };
    else if (off < 0) range = { cls: "okay", label: "Too narrow", text: `In past tests the shaded range caught the real value only ${got} of the time (it aims for ${aim}). Expect real values to fall outside it more often than the band suggests.` };
    else range = { cls: "okay", label: "Wider than needed", text: `In past tests the shaded range caught the real value ${got} of the time (it aims for ${aim}), so it is wider than it needs to be: real values will usually sit well inside it.` };
  }

  if (v.intermittent && !v.baseline) {
    headsUp.push("most periods have no sales, and error measures such as MASE and MAE reward forecasting zero. Look at RMSE and bias too (Under the hood), and read the range as how many sales to expect, not a typical period.");
  }
  if (v.rough) headsUp.push(`only ${v.periods} periods of history, too few to test forecasts properly. Read the range as a rough guide.`);

  // No backtest at all (a short series): there is no evidence either way, and saying so beats a guess.
  if (!v.baseline && !Number.isFinite(v.ratio)) {
    return { level: "untested", label: "Untested", cls: "okay", range, headsUp: [], sentence: `Only ${v.periods} periods of history: too few to test this forecast on data it has not seen, so there is no evidence yet on how well it works. Read the range as a rough guide.` };
  }

  if (v.baseline) {
    return { level: "baseline", label: "Baseline", cls: "base", range, headsUp, sentence: `The yardstick every other model is measured against: it repeats the last ${v.cycle}.` };
  }

  if (v.lockRank !== null) {
    const place = `${ordinal(v.lockRank)} of ${v.models} models`;
    if (v.ratio >= 1) {
      return { level: "doubtful", label: "Doubtful", cls: "poor", range, headsUp, sentence: `Did no better than simply repeating the last ${v.cycle}, so there is little reason to trust it over that (${place} on data it never saw).${beaten}` };
    }
    if (v.lockRank * 3 > v.models * 2) {
      return { level: "doubtful", label: "Doubtful", cls: "poor", range, headsUp, sentence: `Fell apart on data it never saw (${place}). Its score on the earlier tests is probably too good.${beaten}` };
    }
    if (v.lockRank <= 2 && !lucky) {
      return { level: "holds", label: "Holds up", cls: "good", range, headsUp, sentence: `Did well on data it never saw (${place})${folds}.${beaten}` };
    }
    // Near the top but with a thin record, or in the middle of the pack: say which, without calling a middle place a "lead".
    const sentence = v.lockRank <= 2
      ? `Ranked ${place} on data it never saw, but it beat repeating the last ${v.cycle} in only ${v.foldsWon} of ${v.foldsOf} earlier tests, so its place may be partly luck.`
      : `Ranked ${place} on data it never saw: in line with the others, not clearly better.`;
    return { level: "middling", label: "Middling", cls: "okay", range, headsUp, sentence: `${sentence}${beaten}` };
  }

  // Too little history to hold a fold back: judge on the backtests alone, and say so.
  if (v.ratio < 0.8) {
    return { level: "holds", label: "Holds up", cls: "good", range, headsUp, sentence: `Beat repeating the last ${v.cycle} by ${pct}% in the tests, but there was too little history to hold one back, so this is less certain.` };
  }
  if (v.ratio < 1) {
    return { level: "middling", label: "Middling", cls: "okay", range, headsUp, sentence: `Only slightly better than repeating the last ${v.cycle} (${pct}% less error), and there was too little history to hold a test back.` };
  }
  return { level: "doubtful", label: "Doubtful", cls: "poor", range, headsUp, sentence: `No better than repeating the last ${v.cycle} in the tests.` };
}
