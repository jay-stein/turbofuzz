import type { CleanOp } from "./clean-ops.js";
import type { ColumnSchema, TransformOp } from "./transform-ops.js";
import type { ColumnType } from "../types.js";

export interface RecipeFileNullPolicy {
  name: string;
  extra: string[];
  keep: string[];
}

export interface RecipeFileType {
  name: string;
  type: ColumnType;
}

export interface RecipeFile {
  kind: "turbofuzz-recipe";
  version: 1;
  name: string;
  savedAt: string;
  /** Column names at save time, for reference and mapping. */
  columns: string[];
  cleans: { name: string; ops: CleanOp[] }[];
  nulls: RecipeFileNullPolicy[];
  types: RecipeFileType[];
  /** Transforms run against the pre-transform schema captured here. */
  baseSchema: ColumnSchema[];
  transforms: TransformOp[];
  /** Archetype override chosen at save time, restored on replay. */
  archetype?: string;
}

export interface ReplayPlan {
  cleans: { column: number; ops: CleanOp[] }[];
  nulls: { column: number; extra: string[]; keep: string[] }[];
  types: { column: number; type: ColumnType }[];
  transforms: TransformOp[];
  /** Column names that could not be matched in the current file. */
  skipped: string[];
  /** Transforms are only replayed when the base schema matches by name. */
  transformsSkipped: boolean;
}

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Maps saved column names onto current indexes: exact, folded, then none. */
export function matchColumns(
  names: readonly string[],
  current: readonly string[],
): (number | null)[] {
  const exact = new Map(current.map((name, index) => [name, index]));
  const folded = new Map(current.map((name, index) => [normalise(name), index]));
  return names.map((name) => {
    const direct = exact.get(name);
    if (direct !== undefined) return direct;
    const loose = folded.get(normalise(name));
    return loose === undefined ? null : loose;
  });
}

function remapTransform(
  op: TransformOp,
  indexOf: (column: number) => number | null,
): TransformOp | null {
  const map = (column: number): number | null => indexOf(column);
  switch (op.kind) {
    case "dedupe":
    case "melt":
      return null;
    case "drop":
    case "round":
    case "flagAnomalies":
    case "winsorize":
    case "clip": {
      const column = map(op.column);
      return column === null ? null : { ...op, column };
    }
    case "groupBy": {
      const dimension = map(op.dimension);
      const measure = op.measure === null ? null : map(op.measure);
      if (dimension === null || (op.measure !== null && measure === null)) return null;
      return { kind: "groupBy", dimension, measure, aggregate: op.aggregate };
    }
    case "impute": {
      const column = map(op.column);
      const group = op.groupColumn === null ? null : map(op.groupColumn);
      if (column === null || (op.groupColumn !== null && group === null)) return null;
      return { ...op, column, groupColumn: group };
    }
    case "aggregate": {
      const dimensions = op.dimensions
        .map((spec) => {
          const column = map(spec.column);
          return column === null ? null : { ...spec, column };
        })
        .filter((spec): spec is NonNullable<typeof spec> => spec !== null);
      const measures = op.measures
        .map((measure) => {
          if (measure.column === null) return measure;
          const column = map(measure.column);
          return column === null ? null : { ...measure, column };
        })
        .filter((measure): measure is NonNullable<typeof measure> => measure !== null);
      if (dimensions.length !== op.dimensions.length || measures.length !== op.measures.length) {
        return null;
      }
      return { kind: "aggregate", dimensions, measures, fill: op.fill };
    }
    default:
      // Ops with shapes that depend on data (split, combine, knn) are not
      // replayable without a full mapping step; skip them explicitly.
      return null;
  }
}

/**
 * Builds a replay plan against the current column names. Cleans, null policies
 * and type changes match by name; transforms replay only when the saved base
 * schema maps name-for-name (or the caller supplies explicit mappings), and
 * any op that cannot be remapped is skipped.
 */
export function planReplay(
  file: RecipeFile,
  currentColumns: readonly string[],
  overrides?: ReadonlyMap<string, number | null>,
): ReplayPlan {
  const plan: ReplayPlan = {
    cleans: [],
    nulls: [],
    types: [],
    transforms: [],
    skipped: [],
    transformsSkipped: false,
  };

  for (const clean of file.cleans) {
    const [column] = matchColumns([clean.name], currentColumns);
    if (column === null || column === undefined) plan.skipped.push(clean.name);
    else plan.cleans.push({ column, ops: clean.ops });
  }
  for (const entry of file.nulls) {
    const [column] = matchColumns([entry.name], currentColumns);
    if (column === null || column === undefined) plan.skipped.push(entry.name);
    else plan.nulls.push({ column, extra: entry.extra, keep: entry.keep });
  }
  for (const entry of file.types) {
    const [column] = matchColumns([entry.name], currentColumns);
    if (column === null || column === undefined) plan.skipped.push(entry.name);
    else plan.types.push({ column, type: entry.type });
  }

  if (file.transforms.length > 0) {
    const baseNames = file.baseSchema.map((entry) => entry.name);
    const mapped = matchColumns(baseNames, currentColumns).map((value, index) => {
      const name = baseNames[index];
      if (name !== undefined && overrides?.has(name) === true) {
        return overrides.get(name) ?? null;
      }
      return value;
    });
    const missing = baseNames.filter((_, index) => mapped[index] === null);
    if (missing.length > 0) {
      plan.transformsSkipped = true;
      plan.skipped.push(...missing);
    } else {
      const remapped: TransformOp[] = [];
      for (const op of file.transforms) {
        const step = remapTransform(op, (column) => mapped[column] ?? null);
        if (step === null) {
          plan.transformsSkipped = true;
          break;
        }
        remapped.push(step);
      }
      if (!plan.transformsSkipped) plan.transforms = remapped;
    }
  }

  plan.skipped = [...new Set(plan.skipped)];
  return plan;
}

/** Parses and validates a saved recipe file. */
export function parseRecipeFile(text: string): RecipeFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { kind?: unknown }).kind !== "turbofuzz-recipe"
  ) {
    throw new Error("That file is not a TurboFuzz recipe.");
  }
  const file = data as RecipeFile;
  if (!Array.isArray(file.cleans) || !Array.isArray(file.transforms)) {
    throw new Error("The recipe file is missing its steps.");
  }
  return file;
}
