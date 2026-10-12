import { categoryCodes } from "./chart-series.js";
import type { ColumnData } from "./column.js";

export interface RelationshipData {
  kind: "pearson" | "spearman" | "cramersV" | "eta2";
  aColumn: number;
  bColumn: number;
  aLabel: string;
  bLabel: string;
  /** Signed for correlations; positive for Cramér's V and η². */
  effect: number;
  /** Pairwise complete observations. */
  n: number;
}

export interface RelationshipOptions {
  maxNumeric?: number;
  maxCategorical?: number;
  topCategories?: number;
  minAbs?: number;
  limit?: number;
}

function isNumericType(column: ColumnData): boolean {
  return column.type === "integer" || column.type === "number";
}

function isCategoryType(column: ColumnData): boolean {
  return column.type === "category" || column.type === "boolean";
}

/** Average ranks per column (ties share the mean rank); NaN where missing. */
export function rankColumn(
  numbers: Float64Array,
  ids: Uint32Array,
  rowCount: number,
): Float64Array {
  const ranks = new Float64Array(rowCount).fill(Number.NaN);
  const index: number[] = [];
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    if (row < rowCount && Number.isFinite(numbers[row])) index.push(row);
  }
  index.sort((a, b) => (numbers[a] ?? 0) - (numbers[b] ?? 0));
  let i = 0;
  while (i < index.length) {
    let j = i;
    while (j + 1 < index.length && numbers[index[j + 1] ?? 0] === numbers[index[i] ?? 0]) j++;
    const average = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[index[k] ?? 0] = average;
    i = j + 1;
  }
  return ranks;
}

/** Pearson r over one pair, using finite values in both arrays. */
function pearson(ids: Uint32Array, a: Float64Array, b: Float64Array): { r: number; n: number } {
  let n = 0;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position] ?? 0;
    const va = a[row] ?? Number.NaN;
    const vb = b[row] ?? Number.NaN;
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    n++;
    sumA += va;
    sumB += vb;
    sumAA += va * va;
    sumBB += vb * vb;
    sumAB += va * vb;
  }
  if (n < 20) return { r: Number.NaN, n };
  const covariance = sumAB - (sumA * sumB) / n;
  const varianceA = sumAA - (sumA * sumA) / n;
  const varianceB = sumBB - (sumB * sumB) / n;
  if (!(varianceA > 0) || !(varianceB > 0)) return { r: Number.NaN, n };
  return { r: covariance / Math.sqrt(varianceA * varianceB), n };
}

/**
 * Relationship discovery over the current row set, cheapest methods first:
 * Pearson and Spearman for numeric pairs, Cramér's V for category pairs and
 * the correlation ratio η² for numeric × category. Everything is exploratory
 * and reported by effect size, never by p-value.
 */
export function computeRelationships(
  columns: readonly ColumnData[],
  rowCount: number,
  ids: Uint32Array,
  options: RelationshipOptions = {},
): RelationshipData[] {
  const maxNumeric = Math.max(1, Math.floor(options.maxNumeric ?? 8));
  const maxCategorical = Math.max(1, Math.floor(options.maxCategorical ?? 6));
  const topCategories = Math.max(2, Math.floor(options.topCategories ?? 20));
  const minAbs = options.minAbs ?? 0.3;
  const limit = Math.max(1, Math.floor(options.limit ?? 40));

  const numeric: number[] = [];
  const categorical: number[] = [];
  columns.forEach((column, index) => {
    if (
      isNumericType(column) &&
      numeric.length < maxNumeric &&
      column.stats.distinct >= 2
    ) {
      numeric.push(index);
      return;
    }
    const categories = column.categories();
    if (
      isCategoryType(column) &&
      categorical.length < maxCategorical &&
      categories.labels.length >= 2 &&
      categories.labels.length <= topCategories
    ) {
      categorical.push(index);
    }
  });

  const numbers = numeric.map((index) => columns[index]?.numbers() ?? new Float64Array(0));
  const ranks = numbers.map((values) => rankColumn(values, ids, rowCount));
  const findings: RelationshipData[] = [];

  // Numeric × numeric: Pearson and Spearman.
  for (let a = 0; a < numeric.length; a++) {
    for (let b = a + 1; b < numeric.length; b++) {
      const valuesA = numbers[a] ?? new Float64Array(0);
      const valuesB = numbers[b] ?? new Float64Array(0);
      const p = pearson(ids, valuesA, valuesB);
      if (Number.isFinite(p.r) && Math.abs(p.r) >= minAbs) {
        findings.push({
          kind: "pearson",
          aColumn: numeric[a] ?? -1,
          bColumn: numeric[b] ?? -1,
          aLabel: columns[numeric[a] ?? 0]?.name ?? "?",
          bLabel: columns[numeric[b] ?? 0]?.name ?? "?",
          effect: p.r,
          n: p.n,
        });
      }
      const s = pearson(ids, ranks[a] ?? new Float64Array(0), ranks[b] ?? new Float64Array(0));
      if (Number.isFinite(s.r) && Math.abs(s.r) >= minAbs) {
        findings.push({
          kind: "spearman",
          aColumn: numeric[a] ?? -1,
          bColumn: numeric[b] ?? -1,
          aLabel: columns[numeric[a] ?? 0]?.name ?? "?",
          bLabel: columns[numeric[b] ?? 0]?.name ?? "?",
          effect: s.r,
          n: s.n,
        });
      }
    }
  }

  // Category × category: Cramér's V from a contingency table.
  const codeCache = new Map<number, Uint16Array>();
  const codesFor = (index: number): Uint16Array => {
    let codes = codeCache.get(index);
    if (codes === undefined) {
      const categories = columns[index]?.categories();
      codes =
        categories === null || categories === undefined
          ? new Uint16Array(0)
          : categoryCodes(categories.bits, rowCount);
      codeCache.set(index, codes);
    }
    return codes;
  };
  for (let a = 0; a < categorical.length; a++) {
    for (let b = a + 1; b < categorical.length; b++) {
      const indexA = categorical[a] ?? -1;
      const indexB = categorical[b] ?? -1;
      const labelsA = columns[indexA]?.categories()?.labels ?? [];
      const labelsB = columns[indexB]?.categories()?.labels ?? [];
      const codesA = codesFor(indexA);
      const codesB = codesFor(indexB);
      const kA = labelsA.length;
      const kB = labelsB.length;
      if (kA < 2 || kB < 2) continue;
      const table = new Uint32Array(kA * kB);
      const rowTotals = new Uint32Array(kA);
      const colTotals = new Uint32Array(kB);
      let n = 0;
      for (let position = 0; position < ids.length; position++) {
        const row = ids[position] ?? 0;
        const ca = codesA[row] ?? 0;
        const cb = codesB[row] ?? 0;
        if (ca >= kA || cb >= kB) continue;
        table[ca * kB + cb]++;
        rowTotals[ca]++;
        colTotals[cb]++;
        n++;
      }
      if (n < 20) continue;
      let chiSquare = 0;
      for (let ca = 0; ca < kA; ca++) {
        for (let cb = 0; cb < kB; cb++) {
          const expected = (rowTotals[ca] * colTotals[cb]) / n;
          const observed = table[ca * kB + cb] ?? 0;
          if (expected > 0) chiSquare += ((observed - expected) * (observed - expected)) / expected;
        }
      }
      const denominator = n * Math.min(kA - 1, kB - 1);
      const v = denominator > 0 ? Math.sqrt(chiSquare / denominator) : Number.NaN;
      if (Number.isFinite(v) && v >= minAbs) {
        findings.push({
          kind: "cramersV",
          aColumn: indexA,
          bColumn: indexB,
          aLabel: columns[indexA]?.name ?? "?",
          bLabel: columns[indexB]?.name ?? "?",
          effect: v,
          n,
        });
      }
    }
  }

  // Numeric × category: correlation ratio η² (between-group variance share).
  for (const valueIndex of numeric) {
    const values = columns[valueIndex]?.numbers() ?? new Float64Array(0);
    for (const groupIndex of categorical) {
      const labels = columns[groupIndex]?.categories()?.labels ?? [];
      const codes = codesFor(groupIndex);
      const k = labels.length;
      if (k < 2) continue;
      const sums = new Float64Array(k);
      const counts = new Uint32Array(k);
      let n = 0;
      let total = 0;
      let totalSquares = 0;
      for (let position = 0; position < ids.length; position++) {
        const row = ids[position] ?? 0;
        const value = values[row] ?? Number.NaN;
        const code = codes[row] ?? 0;
        if (!Number.isFinite(value) || code >= k) continue;
        sums[code] += value;
        counts[code]++;
        total += value;
        totalSquares += value * value;
        n++;
      }
      if (n < 20 || k < 2) continue;
      const grandMean = total / n;
      let between = 0;
      for (let code = 0; code < k; code++) {
        const count = counts[code] ?? 0;
        if (count === 0) continue;
        const mean = (sums[code] ?? 0) / count;
        between += count * (mean - grandMean) * (mean - grandMean);
      }
      const totalVariation = totalSquares - (total * total) / n;
      const eta = totalVariation > 0 ? between / totalVariation : Number.NaN;
      if (Number.isFinite(eta) && eta >= minAbs) {
        findings.push({
          kind: "eta2",
          aColumn: valueIndex,
          bColumn: groupIndex,
          aLabel: columns[valueIndex]?.name ?? "?",
          bLabel: columns[groupIndex]?.name ?? "?",
          effect: eta,
          n,
        });
      }
    }
  }

  return findings
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, limit);
}
