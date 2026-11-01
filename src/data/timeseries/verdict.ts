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

/**
 * What the labels mean (the codes above are kept; the words are what people see):
 *   holds     "Reliable"       it beats the best simple method comprehensively, on data it never saw
 *   middling  "Use with care"  it beats repeating the last cycle, but not clearly, or not on a test it never saw
 *   doubtful  "Not reliable"   it does no better than repeating the last cycle, or fell apart on data it never saw
 *   untested  "Can't judge yet" too little history to test against anything
 *   baseline  "Baseline"       the yardstick itself
 * "Comprehensively" is a rule of thumb, not a statistical test: at least 10% less error than repeating the last cycle, wins at
 * least two thirds of the backtests, no simple method does better on the held-back test, and it did not fall into the bottom
 * third there. Whether it is also the best of the models is a separate answer (it can be reliable without being first).
 */
export const VERDICT_LABEL: Readonly<Record<VerdictLevel, string>> = {
  holds: "Reliable", middling: "Use with care", doubtful: "Not reliable", untested: "Can't judge yet", baseline: "Baseline",
};

/** Share of the benchmark's error a model must stay under to be called a clear win: 0.9 is 10% less error. */
export const CLEAR_WIN = 0.9;

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
  /**
   * The simple method (other than repeating the last cycle) that did best in the backtests, when it beat repeating the last cycle:
   * the model has to beat that one too, or it has beaten a weak yardstick. Its ratio is against repeating the last cycle, as `ratio` is.
   */
  bestSimple?: { name: string; ratio: number } | null;
  /** Names of simple benchmarks that did better than this model on the lockbox fold. */
  beatenBy?: string[];
  /** The model that ranked first on the lockbox fold and how much less error it had than this one (percent), when this one is not first. */
  leader?: { name: string; gapPct: number } | null;
  /** The series is mostly zeros with now and then a sale. */
  intermittent?: boolean;
}

/** One of the questions the person came with, answered in a word and a sentence. */
export interface Answer {
  q: string;
  /** The answer in a few words: "Yes, clearly", "Only just", "No". */
  a: string;
  cls: "good" | "okay" | "poor" | "base";
  /** One plain sentence saying why. */
  text: string;
}

export interface Verdict {
  level: VerdictLevel;
  /** The badge text. */
  label: string;
  /** The pill colour class the page already styles. */
  cls: "good" | "okay" | "poor" | "base";
  /** The first answer as one sentence, for the compact places that have room for only one. */
  sentence: string;
  /** The same in a few words, for the top strip: "31% less error than repeating the last year". */
  why: string;
  /** The questions answered, in order: does it beat a simple method, is it the best available, can the band be trusted. */
  answers: Answer[];
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
  // The yardstick: repeating the last cycle, unless another simple method did better than that in the backtests.
  const refRatio = v.bestSimple && v.bestSimple.ratio < 1 ? v.bestSimple.ratio : 1;
  const simple = v.bestSimple && v.bestSimple.ratio < 1 ? `the simple "${v.bestSimple.name}" method` : `repeating the last ${v.cycle}`;
  // What the model's error is against that yardstick: below 1 is better.
  const edge = v.ratio / refRatio;
  const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
  const named = (names: string[]): string => (names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(" and "));
  const beatenNames = v.beatenBy ?? [];
  const pct = Math.round(Math.abs(1 - edge) * 100);
  const manyFolds = v.foldsOf >= 3;
  const winsMost = manyFolds ? v.foldsWon * 3 >= v.foldsOf * 2 : v.foldsOf > 0 && v.foldsWon === v.foldsOf;
  const record = v.foldsOf > 0 ? `${v.foldsWon} of ${v.foldsOf} tests` : "";
  const place = v.lockRank !== null ? `${ordinal(v.lockRank)} of ${v.models} models` : "";

  // Can the shaded range be trusted? Judged on its own, by how often past ranges held the real value against the share it aims for.
  const aim = v.band ? Math.round(v.band.aim * 100) : 80;
  const bandIntro = `It should hold the real number about ${aim}% of the time`;
  let band: Answer;
  if (v.band !== null && v.band.tot >= 20) {
    const share = v.band.hit / v.band.tot, off = share - v.band.aim, got = Math.round(share * 100);
    // 5 points off the aim, over at least 20 checks, is more than a flat run of luck would usually show.
    if (Math.abs(off) <= 0.05) band = { q: "Can you trust the shaded band?", a: "Yes", cls: "good", text: `${bandIntro}, and in past tests it held ${got}% of the time.` };
    else if (off < 0) band = { q: "Can you trust the shaded band?", a: "Treat it as a minimum", cls: "okay", text: `${bandIntro}, but in past tests it held only ${got}% of the time. The real number may stray further than the band shows.` };
    else band = { q: "Can you trust the shaded band?", a: "Wider than needed", cls: "okay", text: `${bandIntro}, but in past tests it held ${got}% of the time, so the real number is usually well inside it.` };
  } else {
    band = { q: "Can you trust the shaded band?", a: "Not yet tested", cls: "base", text: `${bandIntro}. There are too few past tests to check that.` };
  }

  if (v.intermittent && !v.baseline) {
    headsUp.push("most periods have no sales, and error measures such as MASE and MAE reward forecasting zero. Look at RMSE and bias too (Under the hood), and read the range as how many sales to expect, not a typical period.");
  }
  if (v.rough) headsUp.push(`only ${v.periods} periods of history, too few to test forecasts properly. Read the range as a rough guide.`);

  const wrap = (level: VerdictLevel, cls: Verdict["cls"], answers: Answer[], why: string): Verdict =>
    ({ level, label: VERDICT_LABEL[level], cls, sentence: answers[0]?.text ?? "", why, answers, headsUp });

  if (v.baseline) {
    return wrap("baseline", "base", [{ q: "What is this?", a: "The yardstick", cls: "base", text: `Every other model is measured against it: it repeats the last ${v.cycle}.` }], "the yardstick");
  }

  // No backtest at all (a short series): there is no evidence either way, and saying so beats a guess.
  if (!Number.isFinite(v.ratio)) {
    return wrap("untested", "okay", [
      { q: "Does it beat a simple method?", a: "Can't tell yet", cls: "base", text: `Only ${v.periods} periods of history: too few to test this forecast against ${simple}, so there is no evidence it works.` },
      band,
    ], "too little history to test");
  }

  // Does it beat a simple method?
  let level: VerdictLevel;
  let beats: Answer;
  const q1 = "Does it beat a simple method?";
  if (edge >= 1) {
    level = "doubtful";
    beats = { q: q1, a: "No", cls: "poor", text: `It did no better than ${simple}, so a forecast model adds nothing here. Use that simple method, or add more history.` };
  } else if (v.lockRank !== null && v.lockRank * 3 > v.models * 2) {
    level = "doubtful";
    beats = { q: q1, a: "No", cls: "poor", text: `It did poorly on data it never saw (${place}), so its earlier results are probably too good.` };
  } else if (edge <= CLEAR_WIN && winsMost && v.lockRank !== null && beatenNames.length === 0 && !v.rough) {
    level = "holds";
    beats = { q: q1, a: "Yes, clearly", cls: "good", text: `${pct}% less error than ${simple}${simple === `repeating the last ${v.cycle}` ? `, winning ${record}` : `, and it beat repeating the last ${v.cycle} in ${record}`}, including on data it never saw.` };
  } else {
    level = "middling";
    const reasons: string[] = [];
    if (beatenNames.length) reasons.push(`${named(beatenNames)} did better on data it never saw, so a simple method is hard to beat here`);
    if (edge > CLEAR_WIN) reasons.push(`it beats ${simple} by only ${pct}%`);
    if (!winsMost && v.foldsOf > 0) reasons.push(`it beat repeating the last ${v.cycle} in only ${record}`);
    if (v.lockRank === null) reasons.push("there was too little history to hold a test back");
    if (reasons.length === 0) reasons.push("it did not clear every test");
    beats = { q: q1, a: edge > CLEAR_WIN && beatenNames.length === 0 ? "Only just" : "Not clearly", cls: "okay", text: `${cap(reasons.join("; "))}.` };
  }

  // Is it the best available?
  const q2 = "Is it the best available?";
  let best: Answer;
  if (v.lockRank === null) {
    best = { q: q2, a: "Can't tell yet", cls: "base", text: "There was too little history to hold a test back, so it was chosen from the backtests alone." };
  } else if (v.lockRank === 1) {
    best = { q: q2, a: "Yes", cls: "good", text: `The best of the ${v.models} models tried, on data it never saw.` };
  } else if (v.leader) {
    const gap = Math.round(v.leader.gapPct);
    if (gap < 5) best = { q: q2, a: "About level", cls: "good", text: `Ranked ${place} on data it never saw. ${v.leader.name} did about the same (${gap}% less error), so the choice between them is close.` };
    else if (v.lockRank * 2 <= v.models) best = { q: q2, a: "Close", cls: "okay", text: `Ranked ${place} on data it never saw. ${v.leader.name} had ${gap}% less error, so it is worth a look.` };
    else best = { q: q2, a: "No", cls: "okay", text: `Ranked ${place} on data it never saw. ${v.leader.name} had ${gap}% less error.` };
  } else {
    best = { q: q2, a: v.lockRank * 2 <= v.models ? "Close" : "No", cls: "okay", text: `Ranked ${place} on data it never saw.` };
  }

  const why = edge >= 1 ? `no better than ${simple}` : `${pct}% less error than ${simple}`;
  return wrap(level, level === "holds" ? "good" : level === "middling" ? "okay" : "poor", [beats, best, band], why);
}
