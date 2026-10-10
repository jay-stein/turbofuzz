import type { DatasetStats } from "../data/stats.js";
import type { DedupeKeep } from "../data/transform-ops.js";
import { openMenu } from "./menu.js";

/**
 * Quick menu next to a Duplicates control: keep first, keep last, or remove
 * every copy. Shared by the Overview, the health group and the summary band.
 */
export function openDedupeMenu(
  anchor: HTMLElement,
  stats: DatasetStats,
  onDrop: (keep: DedupeKeep) => void,
): void {
  const options: { keep: DedupeKeep; label: string; removed: number; hint: string }[] = [
    {
      keep: "first",
      label: "Keep first copy",
      removed: stats.duplicateRows,
      hint: "Remove later copies, keeping the earliest row of every duplicate group",
    },
    {
      keep: "last",
      label: "Keep last copy",
      removed: stats.duplicateRows,
      hint: "Remove earlier copies, keeping the latest row of every duplicate group",
    },
    {
      keep: "none",
      label: "Remove all copies",
      removed: stats.rowsInDuplicateGroups,
      hint: "Drop every row that belongs to a duplicate group, including the original",
    },
  ];

  openMenu(
    anchor,
    options.map((option) => ({
      label: `${option.label} — ${option.removed.toLocaleString()} rows`,
      title: option.hint,
      disabled: option.removed === 0,
      action: () => onDrop(option.keep),
    })),
    "context-menu qa-menu",
  );
}
