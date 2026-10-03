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
 * Picks the delimiter whose per-line field count is highest and most
 * consistent across the first lines of the input.
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
    const first = counts[0];
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = first * 10 + consistent;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}
