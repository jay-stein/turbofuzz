/**
 * A one-off bar above the table when a freshly loaded table has problems:
 * the score, how many things need fixing or reviewing, and a way into Data
 * Quality. It counts the same issues the Data Quality page lists, shows once
 * per loaded table, and stays closed once closed or followed. The Table view
 * keeps its quiet look the rest of the time.
 */

import { el } from "./dom.js";

export interface QaNudgeInput {
  /** Identifies one loaded table: the bar shows once per key. */
  key: string;
  score: number;
  fix: number;
  review: number;
}

const nf = new Intl.NumberFormat("en");

/** The bar's words, or null when there is nothing worth a nudge (no fixes; reviews alone are not pushed). */
export function nudgeText(input: Pick<QaNudgeInput, "score" | "fix" | "review">): string | null {
  if (input.fix <= 0) return null;
  const things = (count: number): string => `${nf.format(count)} ${count === 1 ? "thing" : "things"}`;
  const review = input.review > 0 ? ` and ${things(input.review)} worth a look` : "";
  return `Data quality ${input.score.toFixed(1)}: ${things(input.fix)} ${input.fix === 1 ? "needs" : "need"} fixing${review}. Data Quality shows you how to fix these issues in a single click.`;
}

export class QaNudge {
  readonly element: HTMLElement;
  private readonly text = el("span", { class: "qa-nudge-text" });
  private readonly closed = new Set<string>();
  private key: string | null = null;

  constructor(onOpen: () => void) {
    const open = el("button", { class: "primary small", type: "button" }, ["Open Data Quality"]);
    open.addEventListener("click", () => {
      this.close();
      onOpen();
    });
    const dismiss = el("button", { class: "icon-btn qa-nudge-close", type: "button", "aria-label": "Close", title: "Close: it will not come back for this table" }, ["×"]);
    dismiss.addEventListener("click", () => this.close());
    this.element = el("div", { class: "qa-nudge hidden", role: "status" }, [
      el("span", { class: "qa-nudge-dot", "aria-hidden": "true" }),
      this.text,
      el("span", { class: "grow" }),
      open,
      dismiss,
    ]);
  }

  /** The latest Data Quality counts; the bar opens the first time a table has something to fix. */
  update(input: QaNudgeInput | null): void {
    const words = input === null ? null : nudgeText(input);
    if (input === null || words === null || this.closed.has(input.key)) {
      // Nothing to fix (yet: deferred statistics can arrive later), or closed for this table.
      this.element.classList.add("hidden");
      return;
    }
    this.key = input.key;
    this.text.textContent = words;
    this.element.classList.remove("hidden");
  }

  private close(): void {
    if (this.key !== null) this.closed.add(this.key);
    this.element.classList.add("hidden");
  }
}
