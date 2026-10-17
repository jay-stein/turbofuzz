/**
 * The recipe contract shared by every code generator (pandas now, Polars
 * next): one status vocabulary and one report shape, so the exporters can
 * never silently drop an applied step.
 */

export type RecipeTarget = "pandas" | "polars";

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
  if (entries.length === 0) return `No steps to export as ${target}.`;
  const parts = [`${supported + warnings} of ${entries.length} steps export as executable ${target}`];
  if (warnings > 0) parts.push(`${warnings} with a documented limitation`);
  if (manual > 0) parts.push(`${manual} need manual translation`);
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
