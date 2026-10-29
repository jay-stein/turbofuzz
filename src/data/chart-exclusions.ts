import type { ColumnData } from "./column.js";

/**
 * A chart-scoped "leave this out": the card stops counting the rows matching
 * it, without touching the table or any other card. Each shape on a chart
 * already knows what it stands for, so the three kinds mirror the three things
 * a click can select: a category value, a numeric/time range, a text term.
 */
export type ChartExclusion =
  | { kind: "values"; column: number; labels: string[]; invert?: boolean }
  | { kind: "range"; column: number; min: number | null; max: number | null; invert?: boolean }
  | { kind: "text"; column: number; query: string; invert?: boolean };

/** One removable chip in the card: a label plus how to take it back out. */
export interface ExclusionChip {
  /** Index of the exclusion this chip belongs to. */
  index: number;
  /** For value exclusions, the single label this chip stands for. */
  label?: string;
  text: string;
}

export function sameExclusion(a: ChartExclusion, b: ChartExclusion): boolean {
  if (a.kind !== b.kind || a.column !== b.column) return false;
  if (a.kind === "range" && b.kind === "range") return a.min === b.min && a.max === b.max;
  if (a.kind === "text" && b.kind === "text") return a.query === b.query;
  return false;
}

/** Adds an exclusion, merging value labels per column and ignoring repeats. */
export function addExclusion(
  list: readonly ChartExclusion[],
  next: ChartExclusion,
): ChartExclusion[] {
  if (next.kind === "values") {
    const existing = list.findIndex((entry) => entry.kind === "values" && entry.column === next.column);
    if (existing >= 0) {
      const current = list[existing] as Extract<ChartExclusion, { kind: "values" }>;
      const labels = [...new Set([...current.labels, ...next.labels])];
      return list.map((entry, index) => (index === existing ? { ...current, labels } : entry));
    }
    return [...list, { ...next, labels: [...new Set(next.labels)] }];
  }
  return list.some((entry) => sameExclusion(entry, next)) ? [...list] : [...list, next];
}

/** Removes one chip: a single value label, or a whole range/text exclusion. */
export function removeChip(
  list: readonly ChartExclusion[],
  chip: ExclusionChip,
): ChartExclusion[] {
  const entry = list[chip.index];
  if (entry === undefined) return [...list];
  if (entry.kind === "values" && chip.label !== undefined) {
    const labels = entry.labels.filter((label) => label !== chip.label);
    if (labels.length > 0) {
      return list.map((value, index) => (index === chip.index ? { ...entry, labels } : value));
    }
  }
  return list.filter((_, index) => index !== chip.index);
}

function formatBound(value: number): string {
  return Number(value.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function describeRange(
  min: number | null,
  max: number | null,
  format: (value: number) => string = formatBound,
): string {
  if (min !== null && max !== null) return `${format(min)} – ${format(max)}`;
  if (min !== null) return `≥ ${format(min)}`;
  if (max !== null) return `≤ ${format(max)}`;
  return "any value";
}

/** Chips for the card header, one per excluded value/range/term. */
export function exclusionChips(
  list: readonly ChartExclusion[],
  columnName: (column: number) => string,
  formatFor?: (column: number) => (value: number) => string,
): ExclusionChip[] {
  const chips: ExclusionChip[] = [];
  list.forEach((entry, index) => {
    const name = columnName(entry.column);
    if (entry.kind === "values") {
      for (const label of entry.labels) {
        chips.push({ index, label, text: `${name}: ${label === "" ? "(empty)" : label}` });
      }
    } else if (entry.kind === "range") {
      chips.push({
        index,
        text: `${name}: ${describeRange(entry.min, entry.max, formatFor?.(entry.column))}`,
      });
    } else {
      chips.push({ index, text: `${name} contains “${entry.query}”` });
    }
  });
  return chips;
}

/** Drops exclusions whose column no longer exists. */
export function sanitizeExclusions(
  list: readonly ChartExclusion[] | undefined,
  columnCount: number,
): ChartExclusion[] {
  return (list ?? []).filter((entry) => entry.column >= 0 && entry.column < columnCount);
}

/**
 * Applies the exclusions to a set of row ids (worker side). Rows that cannot
 * be judged (non-numeric text under a range exclusion) are kept, so an
 * exclusion only ever removes rows it positively matches.
 */
export function keepRows(
  ids: Uint32Array,
  exclusions: readonly ChartExclusion[] | undefined,
  columns: readonly ColumnData[],
): Uint32Array {
  if (exclusions === undefined || exclusions.length === 0) return ids;
  // Compile each exclusion to "is this row left out?", then filter in one pass.
  // An inverted entry leaves out the rows that do NOT match it, i.e. it keeps
  // only the matching slice (used to highlight one slice of the data).
  const tests: ((id: number) => boolean)[] = [];
  for (const entry of exclusions) {
    const column = columns[entry.column];
    if (column === undefined) continue;
    const before = tests.length;
    if (entry.kind === "values") {
      const categories = column.categories();
      const sets = entry.labels
        .map((label) => categories.labels.indexOf(label))
        .filter((code) => code >= 0)
        .map((code) => categories.bits[code]!);
      if (sets.length === 1) {
        const only = sets[0]!;
        tests.push((id) => only.get(id));
      } else if (sets.length > 1) {
        tests.push((id) => {
          for (const set of sets) if (set.get(id)) return true;
          return false;
        });
      }
    } else if (entry.kind === "range") {
      const numbers = column.numbers();
      const { min, max } = entry;
      tests.push((id) => {
        const value = numbers[id] as number;
        if (!Number.isFinite(value)) return false;
        return (min === null || value >= min) && (max === null || value <= max);
      });
    } else {
      const query = entry.query.trim().toLowerCase();
      if (query === "") continue;
      const raw = column.raw;
      tests.push((id) => (raw[id] ?? "").toLowerCase().includes(query));
    }
    if (entry.invert === true) {
      // An unmatched slice (unknown label) keeps nothing; otherwise flip the test.
      const matches = tests.length > before ? tests.pop()! : () => false;
      tests.push((id) => !matches(id));
    }
  }
  if (tests.length === 0) return ids;
  if (tests.length === 1) {
    const only = tests[0]!;
    return ids.filter((id) => !only(id));
  }
  return ids.filter((id) => {
    for (const test of tests) if (test(id)) return false;
    return true;
  });
}

/** An exclusion with its column stored by name, so saved charts survive column changes. */
export type NamedExclusion = ChartExclusion extends infer E
  ? E extends { column: number }
    ? Omit<E, "column"> & { column: string }
    : never
  : never;

export function exclusionsToNames(
  list: readonly ChartExclusion[] | undefined,
  nameOf: (column: number) => string | null,
): NamedExclusion[] | undefined {
  if (list === undefined || list.length === 0) return undefined;
  const out: NamedExclusion[] = [];
  for (const entry of list) {
    const name = nameOf(entry.column);
    if (name !== null) out.push({ ...entry, column: name } as NamedExclusion);
  }
  return out.length > 0 ? out : undefined;
}

export function exclusionsFromNames(
  list: readonly NamedExclusion[] | undefined,
  indexOfName: ReadonlyMap<string, number>,
): ChartExclusion[] | undefined {
  if (list === undefined) return undefined;
  const out: ChartExclusion[] = [];
  for (const entry of list) {
    const column = indexOfName.get(entry.column);
    if (column !== undefined) out.push({ ...entry, column } as ChartExclusion);
  }
  return out.length > 0 ? out : undefined;
}
