import { TYPE_LABELS, type ColumnType } from "../types.js";
import type { CastTarget } from "./cast-ops.js";

export interface TypeJoin {
  type: ColumnType;
  /** Stable explanation shown in cast dialogs and reconciliation notes. */
  reason: string;
  inputs: ColumnType[];
  /** True when no typed supertype fits and the column falls back to text. */
  conflict: boolean;
}

const unique = (types: readonly ColumnType[]): ColumnType[] => [...new Set(types)];

const labels = (types: readonly ColumnType[]): string =>
  types.map((type) => TYPE_LABELS[type]).join(" + ");

/**
 * Common type for a set of inferred types. Only genuinely lossless promotions
 * are accepted; everything else falls back to text with an explicit reason.
 */
export function commonType(types: readonly ColumnType[]): TypeJoin {
  const inputs = unique(types);
  if (inputs.length === 0) {
    return { type: "string", reason: "No values to type.", inputs, conflict: false };
  }
  if (inputs.length === 1) {
    const type = inputs[0];
    return { type, reason: `All values are ${TYPE_LABELS[type]}.`, inputs, conflict: false };
  }
  const set = new Set(inputs);
  if (set.has("string")) {
    return {
      type: "string",
      reason: `${labels(inputs)} mix with text, so the column stays text.`,
      inputs,
      conflict: true,
    };
  }
  if (set.has("integer") && set.has("number")) {
    return { type: "number", reason: "Integer and decimal values share Number.", inputs, conflict: false };
  }
  if (set.has("date") && set.has("datetime") && set.size === 2) {
    return {
      type: "datetime",
      reason: "Date and date-time values share Date & time.",
      inputs,
      conflict: false,
    };
  }
  if (set.has("boolean") && set.has("category") && set.size === 2) {
    return {
      type: "category",
      reason: "Boolean values can be shown as a category.",
      inputs,
      conflict: false,
    };
  }
  return {
    type: "string",
    reason: `${labels(inputs)} cannot share one typed column; values stay as text.`,
    inputs,
    conflict: true,
  };
}

/** Convenience wrapper for column metadata. */
export function commonTypeForColumns(
  columns: readonly { type: ColumnType }[],
): TypeJoin {
  return commonType(columns.map((column) => column.type));
}

export type CastRisk = "safe" | "lossy" | "invalid";

export interface CastCompatibility {
  risk: CastRisk;
  reason: string;
}

/** Explain what a cast can do before the user applies it. */
export function castCompatibility(from: ColumnType, target: CastTarget): CastCompatibility {
  if (from === target) return { risk: "safe", reason: "The column already has this type." };
  if (target === "number" && from === "integer") {
    return { risk: "safe", reason: "Integers are valid numbers." };
  }
  if (target === "integer" && from === "number") {
    return { risk: "lossy", reason: "Decimal values will fail or be blanked." };
  }
  if (target === "datetime" && from === "date") {
    return { risk: "safe", reason: "Dates can be stored as date & time at midnight." };
  }
  if (target === "date" && from === "datetime") {
    return { risk: "lossy", reason: "The time-of-day part will be dropped." };
  }
  if (!Number.isFinite(0)) return { risk: "invalid", reason: "" };
  const numeric: ColumnType[] = ["integer", "number"];
  const temporal: ColumnType[] = ["date", "datetime", "time", "duration"];
  if (numeric.includes(from) && temporal.includes(target)) {
    return { risk: "lossy", reason: "Only values that parse in the chosen format will survive." };
  }
  if (temporal.includes(from) && numeric.includes(target)) {
    return { risk: "lossy", reason: "Dates and durations are converted through their numeric form." };
  }
  if (target === "boolean") {
    return { risk: "invalid", reason: "Only true/false-like spellings become Boolean; other values follow the failure policy." };
  }
  return { risk: "invalid", reason: "Values are re-parsed; invalid cells follow the failure policy." };
}
