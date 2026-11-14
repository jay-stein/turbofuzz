/**
 * The recipe contract shared by every code generator (pandas now, Polars
 * next): one status vocabulary and one report shape, so the exporters can
 * never silently drop an applied step.
 */

import type { ColumnType } from "../types.js";
import { builtInNullTokens } from "../parse/null-tokens.js";

export type RecipeTarget = "pandas" | "polars";

/**
 * Library versions the generated scripts were run against by the parity harness
 * (tools/recipe-parity). They must equal the pins in tools/recipe-parity/requirements.txt:
 * run_parity.py refuses other versions and test/recipe-versions.test.ts compares the two.
 */
export const TESTED_PANDAS = "3.1.1";
export const TESTED_POLARS = "2.1.0";
/** Oldest versions the harness was also run on and passed. Anything older is untested. */
export const MIN_VERIFIED_PANDAS = "2.3.3";
export const MIN_VERIFIED_POLARS = "1.44.2";

const LIBRARY: Record<RecipeTarget, { name: string; tested: string; min: string }> = {
  pandas: { name: "pandas", tested: TESTED_PANDAS, min: MIN_VERIFIED_PANDAS },
  polars: { name: "Polars", tested: TESTED_POLARS, min: MIN_VERIFIED_POLARS },
};

/** "3.1.1" → "3.1". */
function minor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

/** Script header lines naming the library version the script is written for and was tested with. */
export function versionHeaderLines(target: RecipeTarget): string[] {
  const { name, tested, min } = LIBRARY[target];
  const major = Number(tested.split(".")[0]);
  return [
    `# Written for ${name} ${minor(tested)} (tested with ${name} ${tested}). Install: pip install "${target}>=${minor(tested)},<${major + 1}"`,
    `#   Also passes the same checks on ${name} ${min}; versions older than that are untested.`,
  ];
}

/** "tested with pandas 3.1.1" — shown beside the language picker in the Recipe drawer. */
export function testedVersionLine(target: RecipeTarget): string {
  return `Tested with ${LIBRARY[target].name} ${LIBRARY[target].tested}`;
}

export type SupportStatus = "supported" | "supported_with_warning" | "manual_step_required";

export interface SupportEntry {
  /** Step label in recipe order, e.g. `impute: mean of amount within city`. */
  label: string;
  /** `manual_step_required` names the missing work in `note`. */
  status: SupportStatus;
  note?: string;
}

export interface RecipeScript {
  target: RecipeTarget;
  code: string;
  /** One entry per applied step, in apply order. */
  entries: SupportEntry[];
}

export interface SupportSummary {
  supported: number;
  warnings: number;
  manual: number;
}

export function supportSummary(entries: readonly SupportEntry[]): SupportSummary {
  let supported = 0;
  let warnings = 0;
  let manual = 0;
  for (const entry of entries) {
    if (entry.status === "supported") supported++;
    else if (entry.status === "supported_with_warning") warnings++;
    else manual++;
  }
  return { supported, warnings, manual };
}

/** Human line for the Recipe drawer: what the exporter can and cannot do. */
export function supportHint(target: RecipeTarget, entries: readonly SupportEntry[]): string {
  const { supported, warnings, manual } = supportSummary(entries);
  if (entries.length === 0) return `No steps to export as ${target}. ${testedVersionLine(target)}.`;
  const parts = [`${supported + warnings} of ${entries.length} steps export as executable ${target}`];
  if (warnings > 0) parts.push(`${warnings} with a documented limitation`);
  if (manual > 0) parts.push(`${manual} need manual translation`);
  parts.push(testedVersionLine(target));
  return parts.join(" · ");
}

/** One header comment listing every step the generator cannot fully express. */
export function supportHeaderLines(entries: readonly SupportEntry[]): string[] {
  const manual = entries.filter((entry) => entry.status === "manual_step_required");
  const warnings = entries.filter((entry) => entry.status === "supported_with_warning");
  const lines: string[] = [];
  if (manual.length === 0 && warnings.length === 0) {
    lines.push("# Every applied step is generated below.");
    return lines;
  }
  lines.push("# Non-equivalent steps (review before trusting the output):");
  for (const entry of warnings) {
    lines.push(`#   ~ ${entry.label}${entry.note === undefined ? "" : ` — ${entry.note}`}`);
  }
  for (const entry of manual) {
    lines.push(`#   ! ${entry.label}${entry.note === undefined ? "" : ` — ${entry.note}`}`);
  }
  return lines;
}

/**
 * Report line for a date or datetime type step. The order the app read the column in is
 * passed through `dateOrders`; without it the script reads day first, the app's default.
 */
export function typeDateEntry(name: string, type: "date" | "datetime", order: string | undefined, review: string | null): SupportEntry {
  const label = `type: ${name} → ${type}`;
  if (review !== null) return { label, status: "manual_step_required", note: review };
  if (order === undefined) {
    return { label, status: "supported_with_warning", note: "the day/month order was not recorded; read day first, the app's default" };
  }
  return { label, status: "supported" };
}

/** Types a default CSV reader would wrongly turn into numbers (0800 → 800, 20240315 → 20,240,315). */
const READ_AS_TEXT: ReadonlySet<ColumnType> = new Set(["identifier", "string", "category", "date", "datetime", "time"]);

/**
 * Names of the columns the app holds as text or identifiers (leading zeroes, digit-only
 * dates) so the script's reader can be told not to guess a numeric type for them.
 */
export function readAsTextColumns(schema: readonly { name: string; type?: ColumnType }[]): string[] {
  const names: string[] = [];
  for (const { name, type } of schema) {
    if (type !== undefined && READ_AS_TEXT.has(type) && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The words and symbols the app counts as missing in every column (any case, padded with
 * spaces), as a Python list literal, plus the per-column tokens the user chose to keep as
 * values. A reader's own default list is shorter, so the script blanks these itself.
 */
export function missingTokenSetup(nulls: readonly { name: string; keep: readonly string[] }[]): { tokens: string; keep: string } {
  const tokens = `[${builtInNullTokens().map((token) => JSON.stringify(token)).join(", ")}]`;
  const kept = nulls.filter((entry) => entry.keep.length > 0);
  const keep = `{${kept.map((entry) => `${JSON.stringify(entry.name)}: [${entry.keep.map((token) => JSON.stringify(token)).join(", ")}]`).join(", ")}}`;
  return { tokens, keep };
}
