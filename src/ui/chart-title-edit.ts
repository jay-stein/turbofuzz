/**
 * Rename a chart where its name is shown: double-click the headline above the plot (or the title
 * drawn at the top of the plot) and type. Enter or leaving the box keeps it, Escape puts it back,
 * and an empty name goes back to the automatic one.
 */
import type { ChartCard } from "./chart-card.js";
import { el } from "./dom.js";

export function beginTitleEdit(card: ChartCard): void {
  const summary = card.summaryEl;
  const host = summary.parentElement;
  if (host === null || host.querySelector(".chart-title-edit") !== null) return;
  const input = el("input", {
    class: "text-input chart-title-edit",
    type: "text",
    placeholder: card.displayTitle(),
    "aria-label": "Chart name",
    spellcheck: "false",
  }) as HTMLInputElement;
  input.value = card.getConfig().title;
  let done = false;
  const finish = (keep: boolean): void => {
    if (done) return;
    done = true;
    input.remove();
    summary.classList.remove("hidden");
    if (keep && input.value.trim() !== card.getConfig().title) card.setTitle(input.value.trim());
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") finish(true);
    else if (event.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  summary.classList.add("hidden");
  summary.before(input);
  input.focus();
  input.select();
}

/** Double-click on the headline renames the chart. */
export function bindTitleEdit(card: ChartCard): void {
  card.summaryEl.title = "Double-click to rename this chart";
  card.summaryEl.addEventListener("dblclick", (event) => {
    event.preventDefault();
    beginTitleEdit(card);
  });
}
