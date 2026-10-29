/**
 * State behind the one-by-one spelling review. Each group starts with its most
 * common spelling as the standard and approved; the user can pick another spelling
 * (or type their own) as the standard, or leave the group alone.
 */
export interface Spelling {
  value: string;
  count: number;
}

export interface ReviewGroup {
  spellings: Spelling[];
  /** The value every other spelling becomes. May be typed text not in `spellings`. */
  standard: string;
  approved: boolean;
}

export function initGroups(groups: readonly { spellings: readonly Spelling[] }[]): ReviewGroup[] {
  return groups
    .filter((group) => group.spellings.length >= 2)
    .map((group) => ({
      spellings: group.spellings.map((s) => ({ ...s })),
      standard: group.spellings[0]!.value,
      approved: true,
    }));
}

/** from -> to for every approved group's spellings that differ from the standard. */
export function pairsFor(groups: readonly ReviewGroup[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (const group of groups) {
    if (!group.approved || group.standard.trim() === "") continue;
    for (const spelling of group.spellings) {
      if (spelling.value !== group.standard) pairs.push([spelling.value, group.standard]);
    }
  }
  return pairs;
}

/** Cells that would change in this group (the rows holding a non-standard spelling). */
export function groupCells(group: ReviewGroup): number {
  return group.spellings.reduce((sum, s) => sum + (s.value === group.standard ? 0 : s.count), 0);
}

export function cellsChanged(groups: readonly ReviewGroup[]): number {
  return groups.reduce((sum, group) => sum + (group.approved ? groupCells(group) : 0), 0);
}

export function approvedCount(groups: readonly ReviewGroup[]): number {
  return groups.filter((group) => group.approved && groupCells(group) > 0).length;
}

/** Two spellings: make the other one the standard. Otherwise unchanged. */
export function swapStandard(group: ReviewGroup): void {
  if (group.spellings.length !== 2) return;
  const other = group.spellings.find((s) => s.value !== group.standard);
  if (other !== undefined) group.standard = other.value;
}

export function resetToMostCommon(groups: ReviewGroup[]): void {
  for (const group of groups) {
    group.standard = group.spellings[0]!.value;
    group.approved = true;
  }
}
