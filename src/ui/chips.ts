/** Shared chip vocabulary: every chip says whether it filters or fixes. */
export type ChipAction = "filter" | "fix";

export const CHIP_PREFIX: Record<ChipAction, string> = {
  filter: "Filter:",
  fix: "Fix:",
};

export function chipText(action: ChipAction, label: string): string {
  return `${CHIP_PREFIX[action]} ${label}`;
}

export function chipTitle(action: ChipAction, detail: string): string {
  return `${CHIP_PREFIX[action]} ${detail}`;
}

export function chipClass(action: ChipAction): string {
  return action === "fix" ? "th-qa-chip fix" : "th-qa-chip warn";
}

export function collapsedFixLabel(count: number): string {
  return `Fix issues (${count})`;
}

/** Sampled counts use "~" so they are never mistaken for exact totals. */
export function chipCountLabel(count: number, sampled = false): string {
  return `${sampled ? "~" : ""}${count.toLocaleString()}`;
}

/** Shared label for suggestions, used by table, filters, inspector and triage. */
export function suggestionChipLabel(shortLabel: string): string {
  return chipText("fix", shortLabel);
}