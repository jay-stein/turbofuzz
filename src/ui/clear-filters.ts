/**
 * The one obvious way out of a filtered table: a button at the start of the
 * results bar, shown only while something narrows the rows (a filter, an
 * Issues view, a First/Last N limit or a shuffle).
 */

import { el, svgIcon } from "./dom.js";

/** A funnel with a cross: "stop filtering". */
const ICON = '<path d="M2 4h16l-6 7v7l-4-2v-5z"/><path d="M16 14l6 6"/><path d="M22 14l-6 6"/>';

export function buildClearFiltersButton(onClear: () => void): HTMLButtonElement {
  const button = el(
    "button",
    { class: "clear-filters-btn hidden", type: "button", title: "Remove every filter and show all the rows again" },
    [svgIcon(ICON, "clear-filters-icon"), "Clear all filters"],
  ) as HTMLButtonElement;
  button.addEventListener("click", onClear);
  return button;
}
