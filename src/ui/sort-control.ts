/**
 * One-click sorting in the Table's header. Each column name has an up and a down chevron, always there
 * (muted until wanted): up sorts ascending, down descending, and clicking the lit one again goes back to
 * the file's order. The words say what the order means for the column's kind: A → Z, smallest first,
 * oldest first. Above File row, one chevron puts the rows back in the file's own order.
 */

import type { ColumnType } from "../types.js";
import { el, svgIcon } from "./dom.js";
import { TYPE_FAMILY } from "./type-glyphs.js";

const UP = '<path d="M6 15l6-6 6 6"/>';
const DOWN = '<path d="M6 9l6 6 6-6"/>';

/** What ascending and descending mean for this kind of column. */
export function sortWords(type: ColumnType): { up: string; down: string } {
  switch (TYPE_FAMILY[type]) {
    case "number":
      return { up: "smallest first", down: "largest first" };
    case "time":
      return { up: "oldest first", down: "newest first" };
    case "boolean":
      return { up: "false first", down: "true first" };
    default:
      return { up: "A → Z", down: "Z → A" };
  }
}

/** The chevron pair beside a column name. `dir` is the order on screen: 1 up, -1 down, 0 not sorted by this column. */
export function buildSortControl(name: string, type: ColumnType, dir: 1 | -1 | 0, onSort: (dir: 1 | -1 | 0) => void): HTMLElement {
  const words = sortWords(type);
  const button = (to: 1 | -1): HTMLButtonElement => {
    const on = dir === to;
    const what = `Sort “${name}” ${to === 1 ? words.up : words.down}`;
    const b = el(
      "button",
      {
        class: `th-sort-btn ${to === 1 ? "up" : "down"}${on ? " on" : ""}`,
        type: "button",
        "aria-pressed": on ? "true" : "false",
        "aria-label": what,
        title: on ? `Sorted ${to === 1 ? words.up : words.down}: click to go back to the file's order` : what,
      },
      [svgIcon(to === 1 ? UP : DOWN, "th-sort-icon")],
    ) as HTMLButtonElement;
    b.addEventListener("click", (event) => {
      event.stopPropagation();
      onSort(on ? 0 : to);
    });
    return b;
  };
  return el("span", { class: `th-sort${dir !== 0 ? " sorted" : ""}`, role: "group", "aria-label": `Sort “${name}”` }, [button(1), button(-1)]);
}

/** The chevron above File row: back to the file's own order (File row ascending). Lit when the rows are already in it. */
export function buildFileOrderSort(inFileOrder: boolean, onFileOrder: () => void): HTMLButtonElement {
  const b = el(
    "button",
    {
      class: `th-sort-btn file-order${inFileOrder ? " on" : ""}`,
      type: "button",
      "aria-pressed": inFileOrder ? "true" : "false",
      "aria-label": "Back to the file's own order (ascending by the file's row numbers)",
      title: inFileOrder ? "The rows are in the file's own order" : "Sort by file row: puts the rows back in the file's own order",
    },
    [svgIcon(UP, "th-sort-icon")],
  ) as HTMLButtonElement;
  b.addEventListener("click", () => {
    if (!inFileOrder) onFileOrder();
  });
  return b;
}
