import type {
  OutlierAnalysisMessage,
  OutlierContributionMessage,
  OutlierMethod,
} from "../worker/protocol.js";

/** One method's opinion about one row. */
export interface Voter {
  id: OutlierMethod | "extreme";
  label: string;
  /** False when the method has no result for this row (not run, or row excluded). */
  ran: boolean;
  flagged: boolean;
  score: number | null;
  threshold: number | null;
  why: string;
}

export type Confidence = "high" | "medium" | "low" | "unknown";

export interface RowVotes {
  voters: Voter[];
  /** Voters that could judge this row. */
  ran: number;
  flagged: number;
  confidence: Confidence;
  headline: string;
  advice: string;
}

export const VOTER_LABELS: Record<OutlierMethod | "extreme", string> = {
  isolationForest: "Isolation Forest",
  pca: "PCA reconstruction",
  lof: "LOF",
  extreme: "Extreme single value",
};

const METHOD_WHY: Record<OutlierMethod, string> = {
  isolationForest: "was isolated unusually quickly by random splits across the features",
  pca: "doesn’t follow the correlation pattern the other rows share",
  lof: "sits much further from its nearest neighbours than they do from theirs",
};

/** Robust z beyond this counts as an extreme single value. */
export const EXTREME_Z = 3.5;

const ascendingCache = new WeakMap<OutlierAnalysisMessage, boolean>();

function isAscending(result: OutlierAnalysisMessage): boolean {
  let known = ascendingCache.get(result);
  if (known === undefined) {
    known = true;
    const rows = result.rowIndices;
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i] as number) <= (rows[i - 1] as number)) {
        known = false;
        break;
      }
    }
    ascendingCache.set(result, known);
  }
  return known;
}

/** The method's score for a dataset row, or null when it was not analysed. */
export function scoreOfRow(result: OutlierAnalysisMessage, row: number): number | null {
  const rows = result.rowIndices;
  if (isAscending(result)) {
    let low = 0;
    let high = rows.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const value = rows[mid] as number;
      if (value === row) return result.scores[mid] ?? null;
      if (value < row) low = mid + 1;
      else high = mid - 1;
    }
    return null;
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] === row) return result.scores[i] ?? null;
  }
  return null;
}

/**
 * Counts how many methods consider a row unusual, and why. The three
 * multivariate methods vote with their scores; a fourth "extreme single value"
 * voter reads the row's robust z-scores when a detail record exists for it.
 */
export function votesForRow(
  row: number,
  results: Partial<Record<OutlierMethod, OutlierAnalysisMessage | null>>,
  describe: (contribution: OutlierContributionMessage) => string,
): RowVotes {
  const voters: Voter[] = [];
  let contributions: OutlierContributionMessage[] | null = null;
  for (const id of ["isolationForest", "pca", "lof"] as const) {
    const result = results[id] ?? null;
    if (result === null) {
      voters.push({
        id,
        label: VOTER_LABELS[id],
        ran: false,
        flagged: false,
        score: null,
        threshold: null,
        why: "Not run yet",
      });
      continue;
    }
    const detail = result.details.find((entry) => entry.row === row);
    if (detail !== undefined && contributions === null) contributions = detail.contributions;
    const score = scoreOfRow(result, row);
    if (score === null) {
      voters.push({
        id,
        label: VOTER_LABELS[id],
        ran: false,
        flagged: false,
        score: null,
        threshold: result.threshold,
        why: "This row has missing values in the selected features, so it can’t be scored",
      });
      continue;
    }
    const flagged = score >= result.threshold;
    const top = detail?.contributions[0];
    voters.push({
      id,
      label: VOTER_LABELS[id],
      ran: true,
      flagged,
      score,
      threshold: result.threshold,
      why: flagged
        ? `This row ${METHOD_WHY[id]}${top === undefined ? "" : ` — mostly ${describe(top)}`}.`
        : "Looks normal to this method.",
    });
  }

  if (contributions !== null) {
    const worst = [...contributions].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
    const flagged = worst !== undefined && Math.abs(worst.z) >= EXTREME_Z;
    voters.push({
      id: "extreme",
      label: VOTER_LABELS.extreme,
      ran: true,
      flagged,
      score: worst === undefined ? null : Math.abs(worst.z),
      threshold: EXTREME_Z,
      why: flagged && worst !== undefined
        ? `${describe(worst)}.`
        : "No single column is far from its typical value; any oddness is in the combination.",
    });
  } else {
    voters.push({
      id: "extreme",
      label: VOTER_LABELS.extreme,
      ran: false,
      flagged: false,
      score: null,
      threshold: EXTREME_Z,
      why: "Needs a flagged row’s detail",
    });
  }

  const ran = voters.filter((voter) => voter.ran).length;
  const flagged = voters.filter((voter) => voter.ran && voter.flagged).length;
  let confidence: Confidence = "unknown";
  if (ran >= 2) {
    if (flagged === ran || flagged >= 3) confidence = "high";
    else if (flagged >= 2 && flagged * 2 >= ran) confidence = "medium";
    else confidence = "low";
  }
  const headline =
    ran === 0
      ? "Not enough information yet"
      : `${flagged} of ${ran} method${ran === 1 ? "" : "s"} flag this row`;
  const advice =
    confidence === "high"
      ? "Very likely a real outlier. Fix it, or remove the row if it is a data error."
      : confidence === "medium"
        ? "Probably unusual. Look at the values below before deciding."
        : confidence === "low"
          ? "Only one method flags this row, so it may be a genuine, rare case. Keep it unless the values look wrong."
          : "Checking the other methods…";
  return { voters, ran, flagged, confidence, headline, advice };
}
