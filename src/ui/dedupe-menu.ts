import type { DatasetStats } from "../data/stats.js";
import type { DedupeKeep } from "../data/transform-ops.js";
import { el } from "./dom.js";

/**
 * Quick menu next to a Duplicates control: keep first, keep last, or remove
 * every copy. Shared by the Overview, the health group and the summary band.
 */
export function openDedupeMenu(
  anchor: HTMLElement,
  stats: DatasetStats,
  onDrop: (keep: DedupeKeep) => void,
): void {
  const menu = el("div", { class: "context-menu qa-menu", role: "menu" });
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

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };

  for (const option of options) {
    const item = el(
      "button",
      { class: "context-item", type: "button", role: "menuitem", title: option.hint },
      [`${option.label} — ${option.removed.toLocaleString()} rows`],
    ) as HTMLButtonElement;
    item.disabled = option.removed === 0;
    item.addEventListener("click", () => {
      close();
      onDrop(option.keep);
    });
    menu.append(item);
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey);
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
}
