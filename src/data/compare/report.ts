import type { ColumnType } from "../../types.js";
import { pairFamily } from "./values.js";
import type { ColumnPairing, CompareSide, MatchResult } from "./types.js";

export interface ColumnChange {
  /** Index into pairing.pairs. */
  pair: number;
  name: string;
  /** Matched rows with a different value here. */
  changed: number;
  /** changed as a share of matched rows (0–1). */
  share: number;
  /** The most common old → new changes, most frequent first. */
  top: { from: string; to: string; count: number }[];
}

export interface ColumnTotals {
  pair: number;
  name: string;
  a: { sum: number; mean: number | null; count: number };
  b: { sum: number; mean: number | null; count: number };
  /** Sums over matched rows only, so added and removed rows do not hide a change. */
  matched: { a: number; b: number };
}

export interface CompareReport {
  mode: MatchResult["mode"];
  rows: { a: number; b: number; matched: number; identical: number; changed: number; onlyA: number; onlyB: number };
  duplicateKeys: { a: number; b: number };
  emptyKeys: { a: number; b: number };
  columns: {
    /** Columns in B only, and in A only. */
    added: string[];
    removed: string[];
    /** Pairs made by hand: the name in A and in B. */
    renamed: { a: string; b: string }[];
    retyped: { name: string; a: ColumnType; b: ColumnType }[];
  };
  /** Every paired column with at least one change, most changed first. */
  changes: ColumnChange[];
  /** Sum and mean for each column that holds numbers on both sides. */
  totals: ColumnTotals[];
}

const TOP = 5;
/** Distinct old → new pairs tracked per column; beyond it, new pairs are not counted (the totals stay exact). */
const TRACK_LIMIT = 20_000;

/** The numbers behind the comparison report. */
export function buildReport(a: CompareSide, b: CompareSide, pairing: ColumnPairing, match: MatchResult): CompareReport {
  const matched = match.counts.identical + match.counts.changed;
  const changes: ColumnChange[] = [];
  pairing.pairs.forEach((pair, index) => {
    const bits = match.changed[index];
    const count = bits.count();
    if (count === 0) return;
    const aRaw = a.columns[pair.a].raw;
    const bRaw = b.columns[pair.b].raw;
    const tally = new Map<string, number>();
    const words = bits.words;
    for (let w = 0; w < words.length; w++) {
      let word = words[w];
      while (word !== 0) {
        const bit = 31 - Math.clz32(word & -word);
        word &= word - 1;
        const i = (w << 5) + bit;
        const key = `${aRaw[match.aRow[i]]}\u0001${bRaw[match.bRow[i]]}`;
        const seen = tally.get(key);
        if (seen !== undefined) tally.set(key, seen + 1);
        else if (tally.size < TRACK_LIMIT) tally.set(key, 1);
      }
    }
    const top = [...tally.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, TOP)
      .map(([key, n]) => {
        const cut = key.indexOf("\u0001");
        return { from: key.slice(0, cut), to: key.slice(cut + 1), count: n };
      });
    changes.push({ pair: index, name: b.columns[pair.b].name, changed: count, share: matched === 0 ? 0 : count / matched, top });
  });
  changes.sort((x, y) => y.changed - x.changed || x.pair - y.pair);

  const totals: ColumnTotals[] = [];
  pairing.pairs.forEach((pair, index) => {
    const ca = a.columns[pair.a];
    const cb = b.columns[pair.b];
    if (pairFamily(ca, cb) !== "number") return;
    const sumOf = (values: Float64Array): { sum: number; mean: number | null; count: number } => {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === v) {
          sum += v;
          count++;
        }
      }
      return { sum, mean: count === 0 ? null : sum / count, count };
    };
    const an = ca.numbers();
    const bn = cb.numbers();
    let matchedA = 0;
    let matchedB = 0;
    for (let i = 0; i < match.aRow.length; i++) {
      const ar = match.aRow[i];
      const br = match.bRow[i];
      if (ar < 0 || br < 0) continue;
      const x = an[ar];
      const y = bn[br];
      if (x === x) matchedA += x;
      if (y === y) matchedB += y;
    }
    totals.push({ pair: index, name: cb.name, a: sumOf(an), b: sumOf(bn), matched: { a: matchedA, b: matchedB } });
  });

  return {
    mode: match.mode,
    rows: { a: a.rowCount, b: b.rowCount, matched, ...match.counts },
    duplicateKeys: match.duplicateKeys,
    emptyKeys: match.emptyKeys,
    columns: {
      added: pairing.onlyB.map((index) => b.columns[index].name),
      removed: pairing.onlyA.map((index) => a.columns[index].name),
      renamed: pairing.pairs.filter((pair) => pair.manual).map((pair) => ({ a: a.columns[pair.a].name, b: b.columns[pair.b].name })),
      retyped: pairing.pairs
        .filter((pair) => a.columns[pair.a].type !== b.columns[pair.b].type)
        .map((pair) => ({ name: b.columns[pair.b].name, a: a.columns[pair.a].type, b: b.columns[pair.b].type })),
    },
    changes,
    totals,
  };
}
