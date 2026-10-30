/**
 * The Table's status bar, under the rows: where you are ("Rows 41–66 of 12,480"),
 * Top and Bottom, Reverse, the File row column, what the order is, and Go to (Ctrl+G)
 * for a row by position, by its number in the file, a share of the way down, or a
 * column by name.
 */

import { el, svgIcon } from "./dom.js";
import { parseGoTo, type GoTo } from "./table-goto.js";

export interface TableOrder {
  /** Sorted column name, or null for file order. */
  column: string | null;
  dir: 1 | -1;
  reversed: boolean;
  shuffled: boolean;
}

export interface TableNavOptions {
  /** Columns for "go to a column"; rows in the current order. */
  columns(): readonly string[];
  count(): number;
  /** Carries out a parsed Go to. Resolves to an error message to show, or null when done. */
  onGoTo(target: Exclude<GoTo, { kind: "error" }>): Promise<string | null>;
  onTop(): void;
  onBottom(): void;
  onReverse(on: boolean): void;
  /** Back to the file's own order: no sort, no shuffle, not reversed. */
  onFileOrder(): void;
  onShowFileRow(on: boolean): void;
}

const nf = new Intl.NumberFormat("en");
const ICONS = {
  top: '<path d="M5 4h14M12 20V9M7 13l5-5 5 5"/>',
  bottom: '<path d="M5 20h14M12 4v11M7 11l5 5 5-5"/>',
  reverse: '<path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/>',
};

/** "file order", "sorted by Amount ↓", "Amount ↓, reversed", "shuffled". */
export function orderText(order: TableOrder): string {
  if (order.shuffled) return "shuffled";
  const base = order.column === null ? "file order" : `sorted by ${order.column} ${order.dir === 1 ? "↑" : "↓"}`;
  return order.reversed ? `${base}, reversed` : base;
}

export class TableNav {
  readonly element: HTMLElement;
  private readonly position: HTMLButtonElement;
  private readonly reverse: HTMLButtonElement;
  private readonly fileRow: HTMLButtonElement;
  private readonly orderLabel: HTMLElement;
  private readonly fileOrder: HTMLButtonElement;
  private readonly pop: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly message: HTMLElement;
  private order: TableOrder = { column: null, dir: 1, reversed: false, shuffled: false };

  constructor(private readonly options: TableNavOptions) {
    const button = (cls: string, label: string, title: string, icon?: string): HTMLButtonElement => {
      const b = el("button", { class: `table-nav-btn ${cls}`, type: "button", title }, []) as HTMLButtonElement;
      if (icon !== undefined) b.append(svgIcon(icon, "table-nav-icon"));
      b.append(el("span", {}, [label]));
      return b;
    };
    this.position = el("button", { class: "table-nav-pos", type: "button", title: "Go to a row or column (Ctrl+G)" }, ["No rows"]) as HTMLButtonElement;
    const top = button("", "Top", "First row (Ctrl+Home)", ICONS.top);
    const bottom = button("", "Bottom", "Last row (Ctrl+End)", ICONS.bottom);
    this.reverse = button("", "Reverse", "Reverse the current order: the last row comes first", ICONS.reverse);
    this.reverse.setAttribute("aria-pressed", "false");
    this.fileRow = button("", "File row", "Show each row's number in the loaded data, which stays with the row through sorting and filtering");
    this.fileRow.setAttribute("aria-pressed", "false");
    this.orderLabel = el("span", { class: "table-nav-order", "aria-live": "polite" });
    this.fileOrder = el("button", { class: "table-nav-link", type: "button", title: "Clear the sort, shuffle and reverse" }, ["Back to file order"]) as HTMLButtonElement;
    const goTo = button("table-nav-goto", "Go to…", "Go to a row or column (Ctrl+G)");
    goTo.append(el("span", { class: "kbd" }, ["Ctrl G"]));

    this.input = el("input", {
      class: "text-input table-goto-input",
      type: "text",
      spellcheck: "false",
      autocomplete: "off",
      placeholder: "250, -1, 50%, file 1234 or a column",
      "aria-label": "Go to a row or column",
    }) as HTMLInputElement;
    this.message = el("p", { class: "table-goto-msg", role: "status" });
    this.pop = el("div", { class: "table-goto hidden", role: "dialog", "aria-label": "Go to" }, [
      el("label", { class: "table-goto-title" }, ["Go to"]),
      this.input,
      el("ul", { class: "table-goto-help" }, [
        el("li", {}, [el("code", {}, ["250"]), " row 250 in this order"]),
        el("li", {}, [el("code", {}, ["-1"]), " the last row · ", el("code", {}, ["50%"]), " halfway down"]),
        el("li", {}, [el("code", {}, ["file 1234"]), " row 1,234 of the loaded data, wherever it is now"]),
        el("li", {}, [el("code", {}, ["amount"]), " a column, by name"]),
      ]),
      this.message,
    ]);

    this.element = el("div", { class: "table-nav", role: "toolbar", "aria-label": "Table navigation" }, [
      this.position,
      el("span", { class: "table-nav-sep", "aria-hidden": "true" }),
      top,
      bottom,
      this.reverse,
      this.fileRow,
      el("span", { class: "table-nav-sep", "aria-hidden": "true" }),
      el("span", { class: "table-nav-order-wrap" }, [el("span", { class: "table-nav-dim" }, ["Order:"]), this.orderLabel, this.fileOrder]),
      el("span", { class: "grow" }),
      goTo,
      this.pop,
    ]);

    this.position.addEventListener("click", () => this.openGoTo());
    goTo.addEventListener("click", () => this.openGoTo());
    top.addEventListener("click", () => options.onTop());
    bottom.addEventListener("click", () => options.onBottom());
    this.reverse.addEventListener("click", () => options.onReverse(!this.order.reversed));
    this.fileRow.addEventListener("click", () => {
      const on = this.fileRow.getAttribute("aria-pressed") !== "true";
      this.setShowFileRow(on);
      options.onShowFileRow(on);
    });
    this.fileOrder.addEventListener("click", () => options.onFileOrder());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeGoTo();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void this.go();
      }
    });
    this.input.addEventListener("input", () => {
      this.message.textContent = "";
      this.message.classList.remove("error");
    });
    document.addEventListener("mousedown", (event) => {
      if (!this.pop.classList.contains("hidden") && !this.pop.contains(event.target as Node) && !this.position.contains(event.target as Node) && !goTo.contains(event.target as Node)) this.closeGoTo();
    });
    this.setOrder(this.order);
  }

  /** The rows on screen: "Rows 41–66 of 12,480". */
  setViewport(first: number, last: number, count: number): void {
    this.position.textContent = count === 0 ? "No rows" : `Rows ${nf.format(first + 1)}–${nf.format(last + 1)} of ${nf.format(count)}`;
  }

  setOrder(order: TableOrder): void {
    this.order = order;
    this.orderLabel.textContent = orderText(order);
    this.reverse.setAttribute("aria-pressed", String(order.reversed));
    const plain = order.column === null && !order.reversed && !order.shuffled;
    this.fileOrder.classList.toggle("hidden", plain);
    this.element.classList.toggle("reordered", !plain);
  }

  setShowFileRow(on: boolean): void {
    this.fileRow.setAttribute("aria-pressed", String(on));
  }

  openGoTo(): void {
    // Fixed, so the bar's sideways scroll cannot clip it: just above the bar, at its right.
    const bar = this.element.getBoundingClientRect();
    this.pop.style.right = `${Math.max(8, window.innerWidth - bar.right + 10)}px`;
    this.pop.style.bottom = `${Math.max(8, window.innerHeight - bar.top + 6)}px`;
    this.pop.classList.remove("hidden");
    this.message.textContent = "";
    this.message.classList.remove("error");
    this.input.focus();
    this.input.select();
  }

  closeGoTo(): void {
    this.pop.classList.add("hidden");
  }

  private async go(): Promise<void> {
    const target = parseGoTo(this.input.value, this.options.count(), this.options.columns());
    if (target.kind === "error") {
      this.showMessage(target.message);
      return;
    }
    const problem = await this.options.onGoTo(target);
    if (problem !== null) this.showMessage(problem);
    else this.closeGoTo();
  }

  private showMessage(text: string): void {
    this.message.textContent = text;
    this.message.classList.add("error");
  }
}
