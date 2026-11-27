export type Delimiter = "," | "\t" | ";" | "|";

export const DELIMITERS: readonly Delimiter[] = [",", "\t", ";", "|"];

export const DELIMITER_LABELS: Record<string, string> = {
  auto: "Auto-detect",
  ",": "Comma",
  "\t": "Tab",
  ";": "Semicolon",
  "|": "Pipe",
};

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      count++;
    }
  }
  return count;
}

interface DelimiterFit {
  delimiter: Delimiter;
  /** The most common count of this delimiter per line (lines without it ignored). */
  mode: number;
  /** Share of the sampled lines that have exactly `mode` of it. */
  consistency: number;
}

/** How well each delimiter splits the first non-blank lines; delimiters that never appear are left out. */
function delimiterFits(text: string): DelimiterFit[] {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, 10);
  if (lines.length === 0) return [];
  const fits: DelimiterFit[] = [];
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const histogram = new Map<number, number>();
    for (const count of counts) {
      if (count === 0) continue;
      histogram.set(count, (histogram.get(count) ?? 0) + 1);
    }
    if (histogram.size === 0) continue;
    let mode = 0;
    let modeFrequency = 0;
    for (const [count, frequency] of histogram) {
      if (frequency > modeFrequency || (frequency === modeFrequency && count > mode)) {
        mode = count;
        modeFrequency = frequency;
      }
    }
    fits.push({ delimiter, mode, consistency: modeFrequency / counts.length });
  }
  return fits;
}

/**
 * A close call: another delimiter that splits nearly every sampled line the same
 * way too ("Smith, J|1,200" splits evenly on commas and on pipes). Detection still
 * picks one; this names the other so the person is told and can switch. Null when
 * nothing else fits.
 */
export function rivalDelimiter(text: string, used: Delimiter): Delimiter | null {
  const rivals = delimiterFits(text)
    .filter((fit) => fit.delimiter !== used && fit.consistency >= RIVAL_CONSISTENCY)
    .sort((a, b) => b.consistency - a.consistency || b.mode - a.mode);
  return rivals[0]?.delimiter ?? null;
}

/** Share of lines a second delimiter must split identically to count as a close call. */
const RIVAL_CONSISTENCY = 0.9;

/**
 * Picks the delimiter with the most consistent per-line field count across
 * the first lines. Lines without any candidate delimiter (titles, blank
 * preambles) are ignored, so a junk first row does not veto the real one.
 */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const { delimiter, mode, consistency } of delimiterFits(text)) {
    const score = mode * 10 + consistency;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}
