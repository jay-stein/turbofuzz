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

/**
 * Picks the delimiter with the most consistent per-line field count across
 * the first lines. Lines without any candidate delimiter (titles, blank
 * preambles) are ignored, so a junk first row does not veto the real one.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, 10);
  if (lines.length === 0) return ",";

  let best: Delimiter = ",";
  let bestScore = -1;

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

    const consistency = modeFrequency / counts.length;
    const score = mode * 10 + consistency;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}
