import type { ColumnData } from "./column.js";

export interface DependencyExample {
  determinant: string;
  values: string[];
}

export interface DependencyPair {
  determinantColumn: number;
  dependentColumn: number;
  determinantLabel: string;
  dependentLabel: string;
  /** Rows where the determinant is present. */
  rows: number;
  /** Rows whose determinant maps to more than one dependent value. */
  violations: number;
  examples: DependencyExample[];
}

export interface DependencyOptions {
  /** Determinants analysed (highest cardinality first). */
  maxDeterminants?: number;
  /** Dependents analysed per determinant. */
  maxDependents?: number;
  /** Keep pairs at or below this violation share (0.02 = 98% functional). */
  maxViolationRatio?: number;
  /** Overall cap on reported pairs. */
  maxPairs?: number;
}

/**
 * Functional-dependency discovery: candidate keys and the columns they
 * determine ("station id → station name/lat/lon"). One Map pass per candidate
 * pair, capped and aborting early once a pair is clearly not functional, so a
 * 100k-row file stays in the low tens of milliseconds.
 */
export function computeDependencies(
  columns: readonly ColumnData[],
  rowCount: number,
  options: DependencyOptions = {},
): DependencyPair[] {
  const maxDeterminants = Math.max(1, Math.floor(options.maxDeterminants ?? 4));
  const maxDependents = Math.max(1, Math.floor(options.maxDependents ?? 8));
  const maxRatio = options.maxViolationRatio ?? 0.02;
  const maxPairs = Math.max(1, Math.floor(options.maxPairs ?? 6));
  const maxViolations = Math.max(1, Math.ceil(rowCount * maxRatio));

  const typeRank = (column: ColumnData): number =>
    column.type === "identifier" ? 0 : column.type === "category" ? 1 : 2;

  const determinants = columns
    .map((column, index) => ({ column, index }))
    .filter(
      (entry) =>
        entry.column.stats.distinct >= 2 &&
        entry.column.stats.distinct <= Math.max(2, Math.min(5000, rowCount - 1)),
    )
    .sort(
      (a, b) =>
        typeRank(a.column) - typeRank(b.column) ||
        // Repeating keys first: a unique row id "determines" everything, but
        // that is not an interesting dependency.
        Number(a.column.stats.distinct === rowCount) -
          Number(b.column.stats.distinct === rowCount) ||
        b.column.stats.distinct - a.column.stats.distinct,
    )
    .slice(0, maxDeterminants);

  const pairs: DependencyPair[] = [];
  for (const determinant of determinants) {
    if (pairs.length >= maxPairs) break;
    const dependents = columns
      .map((column, index) => ({ column, index }))
      .filter(
        (entry) =>
          entry.index !== determinant.index &&
          entry.column.stats.distinct >= 2 &&
          entry.column.stats.distinct <= determinant.column.stats.distinct * 2 &&
          !(entry.column.stats.distinct === rowCount && determinant.column.stats.distinct === rowCount),
      )
      .sort((a, b) => b.column.stats.distinct - a.column.stats.distinct)
      .slice(0, maxDependents);

    for (const dependent of dependents) {
      const mapping = new Map<string, string>();
      const examples: DependencyExample[] = [];
      let rows = 0;
      let violations = 0;
      let aborted = false;

      const determinantRaw = determinant.column.raw;
      const dependentRaw = dependent.column.raw;
      for (let row = 0; row < rowCount; row++) {
        if (determinant.column.nullMask.get(row) || dependent.column.nullMask.get(row)) continue;
        const key = determinantRaw[row] ?? "";
        const value = dependentRaw[row] ?? "";
        if (key === "" || value === "") continue;
        rows++;
        const previous = mapping.get(key);
        if (previous === undefined) {
          mapping.set(key, value);
          continue;
        }
        if (previous === value) continue;
        violations++;
        if (examples.length < 3 && !examples.some((example) => example.determinant === key)) {
          examples.push({
            determinant: key,
            values: [...new Set([previous, value])].slice(0, 3),
          });
        }
        if (violations > maxViolations) {
          aborted = true;
          break;
        }
      }

      if (aborted || rows === 0 || violations > maxViolations) continue;
      pairs.push({
        determinantColumn: determinant.index,
        dependentColumn: dependent.index,
        determinantLabel: determinant.column.name,
        dependentLabel: dependent.column.name,
        rows,
        violations,
        examples,
      });
      if (pairs.length >= maxPairs) break;
    }
  }

  return pairs.sort(
    (a, b) => b.rows - a.rows || a.violations - b.violations,
  );
}
