import type { CompareReport } from "../../data/compare/report.js";
import { ROW_CHANGED, ROW_ONLY_A, ROW_ONLY_B } from "../../data/compare/types.js";
import type { RowFilter, RowWindow } from "../../data/compare/view.js";
import type { CompareSetupMessage } from "../../worker/protocol.js";
import { el } from "../dom.js";
import type { SearchWorkerClient } from "../worker-client.js";
import type { KeyChoice } from "./compare-setup.js";

export type GridLayout = "panes" | "grid";

export interface SideBySideOptions {
  client: SearchWorkerClient;
  setup: CompareSetupMessage;
  report: CompareReport;
  key: KeyChoice;
  filter: RowFilter;
  layout: GridLayout;
  changedColumnsOnly: boolean;
  /** Remembers the view so the tab comes back as it was left. */
  onState(state: { filter: RowFilter; layout: GridLayout; changedColumnsOnly: boolean }): void;
}

const nf = new Intl.NumberFormat("en");
const PANE_ROW = 28;
const GRID_ROW = 44;
const OVERSCAN = 12;
/** Rows fetched per request: a few screens, so scrolling rarely waits on the worker. */
const BLOCK = 240;

interface Column {
  /** Index into the window's cells for each side, or -1 when that side has no such column. */
  a: number;
  b: number;
  /** Index into pairing.pairs (for changed flags), or -1 for a column only one side has. */
  pair: number;
  nameA: string;
  nameB: string;
  width: number;
  /** Left out of the comparison: shown greyed and struck through, never marked as changed. */
  ignored?: boolean;
}

function widthFor(name: string): number {
  return Math.max(84, Math.min(240, name.length * 8 + 36));
}

/**
 * The side-by-side screen: A and B in two panes that scroll together (or one
 * grid where a changed cell shows B's value over A's), filtered to all,
 * changed, only-in-A, only-in-B or identical rows, with next and previous
 * difference. Rows come from the worker a block at a time.
 */
export class SideBySide {
  readonly element: HTMLElement;
  private filter: RowFilter;
  private layout: GridLayout;
  private changedOnly: boolean;
  private total = 0;
  /** The row (index in the filtered list) Next / Prev last landed on, or -1. */
  private current = -1;
  private block: RowWindow | null = null;
  private pending: { start: number; seq: number } | null = null;
  private seq = 0;
  private readonly scrollers: HTMLElement[] = [];
  private readonly bodies: HTMLElement[] = [];
  private readonly spacers: HTMLElement[] = [];
  private syncing = false;
  private frame = 0;
  private readonly status: HTMLElement;
  private readonly position: HTMLElement;
  private readonly view: HTMLElement;
  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.element.isConnected) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "n" || event.key === "p") {
      event.preventDefault();
      void this.step(event.key === "n" ? 1 : -1);
    }
  };

  constructor(private readonly options: SideBySideOptions) {
    this.filter = options.filter;
    this.layout = options.layout;
    this.changedOnly = options.changedColumnsOnly;
    this.status = el("span", { class: "cmp-rows-status", role: "status" });
    this.position = el("span", { class: "cmp-position" });
    this.view = el("div", { class: "cmp-view" });
    this.element = el("div", { class: "cmp-sbs" }, [this.toolbar(), this.view, this.legend()]);
    document.addEventListener("keydown", this.onKey);
    this.build();
  }

  dispose(): void {
    document.removeEventListener("keydown", this.onKey);
    cancelAnimationFrame(this.frame);
  }

  /** The rows a filter holds, from the report's counts. */
  private count(show: RowFilter["show"]): number {
    const rows = this.options.report.rows;
    switch (show) {
      case "all":
        return rows.identical + rows.changed + rows.onlyA + rows.onlyB;
      case "differences":
        return rows.changed + rows.onlyA + rows.onlyB;
      case "changed":
        return rows.changed;
      case "onlyA":
        return rows.onlyA;
      case "onlyB":
        return rows.onlyB;
      case "identical":
        return rows.identical;
    }
  }

  private toolbar(): HTMLElement {
    const bar = el("div", { class: "cmp-toolbar", role: "toolbar", "aria-label": "Rows to show" });
    const group = el("div", { class: "cmp-segment", role: "group", "aria-label": "Show" });
    const shows: [RowFilter["show"], string, string][] = [
      ["all", "All", ""],
      ["differences", "Differences", "diff"],
      ["changed", "Changed", "changed"],
      ["onlyA", "Only in A", "only-a"],
      ["onlyB", "Only in B", "only-b"],
      ["identical", "Identical", "same"],
    ];
    for (const [show, label, tone] of shows) {
      const button = el("button", { type: "button", class: "cmp-seg", "aria-pressed": String(this.filter.show === show) }, [
        tone === "" ? "" : el("span", { class: `cmp-seg-dot ${tone}`, "aria-hidden": "true" }),
        label,
        el("span", { class: "cmp-seg-count" }, [nf.format(this.count(show))]),
      ]);
      button.addEventListener("click", () => this.setFilter({ show, pairs: [] }));
      group.append(button);
    }
    bar.append(group);
    const wrap = el("div", { class: "cmp-toolbar-wrap" }, [bar]);
    const columns = this.columnChips();
    if (columns !== null) wrap.append(columns);
    return this.withRest(bar, wrap);
  }

  /**
   * Changed in: one chip per changed column, with its count. Ticking some shows
   * only the rows where any of them changed (amount or status, say).
   */
  private columnChips(): HTMLElement | null {
    const { report } = this.options;
    if ((this.filter.show !== "changed" && this.filter.show !== "differences") || report.changes.length === 0) return null;
    const chosen = new Set(this.filter.pairs);
    const row = el("div", { class: "cmp-column-chips", role: "group", "aria-label": "Changed in" }, [el("span", { class: "cmp-chips-label" }, ["Changed in:"])]);
    for (const change of report.changes) {
      const on = chosen.has(change.pair);
      const chip = el("button", { type: "button", class: "cmp-column-chip", "aria-pressed": String(on), title: on ? `Stop narrowing to ${change.name}` : `Show only rows where ${change.name} changed` }, [
        change.name,
        el("span", { class: "cmp-seg-count" }, [nf.format(change.changed)]),
      ]);
      chip.addEventListener("click", () => {
        const next = on ? this.filter.pairs.filter((pair) => pair !== change.pair) : [...this.filter.pairs, change.pair];
        next.sort((x, y) => x - y);
        this.setFilter({ show: next.length > 0 ? "changed" : this.filter.show, pairs: next });
      });
      row.append(chip);
    }
    if (chosen.size > 0) {
      const any = el("button", { type: "button", class: "link cmp-chips-clear" }, ["Any column"]);
      any.addEventListener("click", () => this.setFilter({ show: this.filter.show, pairs: [] }));
      row.append(any);
    }
    return row;
  }

  /** The rest of the toolbar (column focus, steps, layout), appended to the first row. */
  private withRest(bar: HTMLElement, wrap: HTMLElement): HTMLElement {
    const focus = el("input", { type: "checkbox" }) as HTMLInputElement;
    focus.checked = this.changedOnly;
    focus.disabled = this.options.key.kind === "content";
    focus.addEventListener("change", () => {
      this.changedOnly = focus.checked;
      this.save();
      this.build();
    });
    bar.append(el("label", { class: "cmp-check cmp-focus" }, [focus, "Only columns with changes"]), el("span", { class: "grow" }));

    const prev = el("button", { type: "button", class: "ghost small", title: "Previous difference (p)" }, ["↑ Prev"]);
    const next = el("button", { type: "button", class: "ghost small", title: "Next difference (n)" }, ["↓ Next"]);
    prev.setAttribute("aria-keyshortcuts", "p");
    next.setAttribute("aria-keyshortcuts", "n");
    prev.addEventListener("click", () => void this.step(-1));
    next.addEventListener("click", () => void this.step(1));
    bar.append(el("div", { class: "cmp-steps" }, [prev, next, this.position]));

    const layouts = el("div", { class: "cmp-segment", role: "group", "aria-label": "Layout" });
    for (const [layout, label] of [["panes", "Two panes"], ["grid", "One grid"]] as const) {
      const button = el("button", { type: "button", class: "cmp-seg", "aria-pressed": String(this.layout === layout) }, [label]);
      button.addEventListener("click", () => {
        if (this.layout === layout) return;
        this.layout = layout;
        this.save();
        this.rebuild();
      });
      layouts.append(button);
    }
    bar.append(layouts);
    return wrap;
  }

  private legend(): HTMLElement {
    return el("div", { class: "cmp-legend" }, [
      this.status,
      el("span", { class: "cmp-legend-item" }, [el("span", { class: "cmp-swatch changed", "aria-hidden": "true" }), "changed cell"]),
      el("span", { class: "cmp-legend-item" }, [el("span", { class: "cmp-mark only-a" }, ["−"]), "only in A"]),
      el("span", { class: "cmp-legend-item" }, [el("span", { class: "cmp-mark only-b" }, ["+"]), "only in B"]),
      el("span", { class: "cmp-legend-item" }, [el("span", { class: "cmp-swatch gap", "aria-hidden": "true" }), "no row on this side"]),
      el("span", { class: "grow" }),
      el("span", { class: "cmp-legend-item" }, [el("kbd", {}, ["n"]), " / ", el("kbd", {}, ["p"]), " next / previous difference"]),
    ]);
  }

  private save(): void {
    this.options.onState({ filter: this.filter, layout: this.layout, changedColumnsOnly: this.changedOnly });
  }

  private setFilter(filter: RowFilter): void {
    this.filter = filter;
    this.current = -1;
    this.save();
    this.rebuild();
  }

  /** The toolbar shows the filter and layout, so both are drawn again. */
  private rebuild(): void {
    this.element.firstElementChild?.replaceWith(this.toolbar());
    this.build();
  }

  /** Which columns to show, in order: the pairs (or just the changed ones and the key), then each side's own. */
  private columns(): Column[] {
    const { setup, report, key } = this.options;
    const keyPairs = new Set(key.kind === "pairs" ? key.pairs : []);
    const changed = new Set(report.changes.map((change) => change.pair));
    const pairs = setup.pairing.pairs;
    const columns: Column[] = [];
    pairs.forEach((pair, index) => {
      if (this.changedOnly && !changed.has(index) && !keyPairs.has(index)) return;
      const nameA = setup.a.columns[pair.a]?.name ?? "";
      const nameB = setup.b.columns[pair.b]?.name ?? "";
      columns.push({ a: index, b: index, pair: index, nameA, nameB, width: widthFor(nameA.length > nameB.length ? nameA : nameB) });
    });
    if (!this.changedOnly) {
      setup.pairing.onlyA.forEach((column, i) => {
        const name = setup.a.columns[column]?.name ?? "";
        columns.push({ a: pairs.length + i, b: -1, pair: -1, nameA: name, nameB: "", width: widthFor(name) });
      });
      setup.pairing.onlyB.forEach((column, i) => {
        const name = setup.b.columns[column]?.name ?? "";
        columns.push({ a: -1, b: pairs.length + i, pair: -1, nameA: "", nameB: name, width: widthFor(name) });
      });
      // Ignored columns stay in view (after the others, in the order the window holds them), but are not compared.
      let ignoredA = pairs.length + setup.pairing.onlyA.length;
      let ignoredB = pairs.length + setup.pairing.onlyB.length;
      for (const entry of setup.pairing.ignored) {
        const nameA = entry.a < 0 ? "" : setup.a.columns[entry.a]?.name ?? "";
        const nameB = entry.b < 0 ? "" : setup.b.columns[entry.b]?.name ?? "";
        columns.push({
          a: entry.a < 0 ? -1 : ignoredA++,
          b: entry.b < 0 ? -1 : ignoredB++,
          pair: -1,
          nameA,
          nameB,
          width: widthFor(nameA.length > nameB.length ? nameA : nameB),
          ignored: true,
        });
      }
    }
    return columns;
  }

  private build(): void {
    // With one column the report knows the count; with several, a row can change in more than one, so the worker's count settles it.
    const pairs = this.filter.pairs;
    this.total =
      pairs.length === 0
        ? this.count(this.filter.show)
        : pairs.length === 1
          ? this.options.report.changes.find((change) => change.pair === pairs[0])?.changed ?? 0
          : this.count("changed");
    this.block = null;
    this.pending = null;
    this.scrollers.length = 0;
    this.bodies.length = 0;
    this.spacers.length = 0;
    const columns = this.columns();
    const { setup } = this.options;
    if (this.layout === "panes") {
      const sides = [
        { side: "a" as const, letter: "A", info: setup.a, cols: columns.filter((column) => column.a >= 0) },
        { side: "b" as const, letter: "B", info: setup.b, cols: columns.filter((column) => column.b >= 0) },
      ];
      const panes = sides.map(({ side, letter, info, cols }) => {
        const template = `34px ${cols.map((column) => `${column.width}px`).join(" ")}`;
        const head = el("div", { class: "cmp-grid-head", style: `grid-template-columns: ${template}` }, [
          el("span", {}),
          ...cols.map((column) =>
            el("span", { class: column.ignored === true ? "cmp-ignored-col" : "", title: (side === "a" ? column.nameA : column.nameB) + (column.ignored === true ? " (ignored: not compared)" : "") }, [
              side === "a" ? column.nameA : column.nameB,
            ]),
          ),
        ]);
        const body = el("div", { class: "cmp-grid-body" });
        body.dataset.template = template;
        const spacer = el("div", { class: "cmp-grid-spacer", style: `height: ${this.total * PANE_ROW}px` }, [body]);
        const scroller = el("div", { class: "cmp-grid-scroll", tabindex: "0", "aria-label": `Rows of ${letter}, ${info.name}` }, [head, spacer]);
        this.scrollers.push(scroller);
        this.bodies.push(body);
        this.spacers.push(spacer);
        return el("section", { class: `cmp-pane cmp-side-${side}`, "aria-label": `${letter}: ${info.name}` }, [
          el("div", { class: "cmp-pane-head" }, [
            el("span", { class: `cmp-badge ${side}` }, [letter]),
            el("span", { class: "cmp-pane-file", title: info.name }, [info.name]),
            el("span", { class: "cmp-pane-meta" }, [`${nf.format(info.rowCount)} rows`]),
          ]),
          scroller,
        ]);
      });
      this.view.replaceChildren(el("div", { class: "cmp-panes" }, panes));
      // The two panes scroll as one.
      for (const scroller of this.scrollers) {
        scroller.addEventListener("scroll", () => {
          if (!this.syncing) {
            this.syncing = true;
            for (const other of this.scrollers) if (other !== scroller) other.scrollTop = scroller.scrollTop;
            this.syncing = false;
          }
          this.schedule();
        });
      }
    } else {
      const template = `34px ${columns.map((column) => `${column.width}px`).join(" ")}`;
      const head = el("div", { class: "cmp-grid-head", style: `grid-template-columns: ${template}` }, [
        el("span", {}),
        ...columns.map((column) => {
          const name = column.b >= 0 ? column.nameB : column.nameA;
          const renamed = column.pair >= 0 && column.nameA !== column.nameB;
          return el("span", { class: column.ignored === true ? "cmp-ignored-col" : "", title: (renamed ? `${column.nameA} → ${column.nameB}` : name) + (column.ignored === true ? " (ignored: not compared)" : "") }, [
            name,
            column.ignored === true
              ? el("span", { class: "cmp-head-tag" }, [" ignored"])
              : column.pair < 0
                ? el("span", { class: "cmp-head-tag" }, [column.a >= 0 ? " A only" : " B only"])
                : "",
          ]);
        }),
      ]);
      const body = el("div", { class: "cmp-grid-body tall" });
      body.dataset.template = template;
      const spacer = el("div", { class: "cmp-grid-spacer", style: `height: ${this.total * GRID_ROW}px` }, [body]);
      const scroller = el("div", { class: "cmp-grid-scroll", tabindex: "0", "aria-label": "Rows of A and B in one grid" }, [head, spacer]);
      this.scrollers.push(scroller);
      this.bodies.push(body);
      this.spacers.push(spacer);
      scroller.addEventListener("scroll", () => this.schedule());
      this.view.replaceChildren(scroller);
    }
    this.cols = columns;
    if (this.total === 0) {
      this.view.append(el("p", { class: "cmp-empty-rows" }, ["No rows here."]));
    }
    this.updatePosition();
    this.schedule();
  }

  private cols: Column[] = [];

  private rowHeight(): number {
    return this.layout === "panes" ? PANE_ROW : GRID_ROW;
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => void this.draw());
  }

  /** Draws the rows on screen, fetching the block that holds them when it is not here yet. */
  private async draw(): Promise<void> {
    const scroller = this.scrollers[0];
    if (scroller === undefined) return;
    const height = this.rowHeight();
    const viewport = scroller.clientHeight || 600;
    const first = Math.max(0, Math.floor(scroller.scrollTop / height) - OVERSCAN);
    const last = Math.min(this.total, Math.ceil((scroller.scrollTop + viewport) / height) + OVERSCAN);
    const block = this.block;
    if (block === null || first < block.start || last > block.start + block.status.length) {
      const start = Math.max(0, first - Math.floor((BLOCK - (last - first)) / 2));
      if (this.pending !== null && this.pending.start === start) return;
      const seq = ++this.seq;
      this.pending = { start, seq };
      try {
        const message = await this.options.client.compareRows(this.filter, start, start + Math.max(BLOCK, last - first));
        if (seq !== this.seq) return;
        this.block = message.window;
        this.pending = null;
        if (message.window.total !== this.total) this.setTotal(message.window.total);
      } catch (error) {
        this.status.textContent = error instanceof Error ? error.message : "Could not read the rows.";
        return;
      }
      this.schedule();
      return;
    }
    if (this.layout === "panes") {
      this.drawSide(0, "a", first, last);
      this.drawSide(1, "b", first, last);
    } else {
      this.drawGrid(first, last);
    }
    this.status.textContent = this.total === 0 ? "No rows" : `Rows ${nf.format(first + 1)}–${nf.format(Math.min(this.total, last))} of ${nf.format(this.total)}`;
  }

  private markFor(status: number): { mark: string; tone: string } {
    if (status === ROW_ONLY_A) return { mark: "−", tone: "only-a" };
    if (status === ROW_ONLY_B) return { mark: "+", tone: "only-b" };
    if (status === ROW_CHANGED) return { mark: "•", tone: "changed" };
    return { mark: "", tone: "same" };
  }

  private drawSide(index: number, side: "a" | "b", first: number, last: number): void {
    const block = this.block!;
    const body = this.bodies[index]!;
    const pairs = this.options.setup.pairing.pairs.length;
    const cols = this.cols.filter((column) => (side === "a" ? column.a : column.b) >= 0);
    const fragment = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const at = i - block.start;
      const status = block.status[at]!;
      const cells = side === "a" ? block.a[at] : block.b[at];
      const { mark, tone } = this.markFor(status);
      const row = el("div", { class: `cmp-row ${tone}${cells === null ? " gap" : ""}${i === this.current ? " current" : ""}`, style: `grid-template-columns: ${body.dataset.template}` });
      row.append(el("span", { class: `cmp-mark ${tone}` }, [cells === null ? "" : mark]));
      for (const column of cols) {
        const cellIndex = side === "a" ? column.a : column.b;
        const value = cells === null ? "" : cells[cellIndex] ?? "";
        const diff = cells !== null && column.pair >= 0 && block.changed[at * pairs + column.pair] === 1;
        row.append(el("span", { class: `cmp-cell${diff ? " diff" : ""}${value === "" ? " blank" : ""}${column.ignored === true ? " ignored" : ""}`, title: value }, [value]));
      }
      fragment.append(row);
    }
    body.style.transform = `translateY(${first * PANE_ROW}px)`;
    body.replaceChildren(fragment);
  }

  private drawGrid(first: number, last: number): void {
    const block = this.block!;
    const body = this.bodies[0]!;
    const pairs = this.options.setup.pairing.pairs.length;
    const fragment = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const at = i - block.start;
      const status = block.status[at]!;
      const a = block.a[at] ?? null;
      const b = block.b[at] ?? null;
      const { mark, tone } = this.markFor(status);
      const row = el("div", { class: `cmp-row tall ${tone}${i === this.current ? " current" : ""}`, style: `grid-template-columns: ${body.dataset.template}` });
      row.append(el("span", { class: `cmp-mark ${tone}` }, [mark]));
      for (const column of this.cols) {
        const newValue = b !== null && column.b >= 0 ? b[column.b] ?? "" : null;
        const oldValue = a !== null && column.a >= 0 ? a[column.a] ?? "" : null;
        const diff = column.pair >= 0 && block.changed[at * pairs + column.pair] === 1;
        const cell = el("span", { class: `cmp-cell${diff ? " diff" : ""}${column.ignored === true ? " ignored" : ""}` });
        if (newValue !== null) cell.append(el("span", { class: `cmp-cell-main${newValue === "" ? " blank" : ""}`, title: newValue }, [newValue === "" && diff ? "(empty)" : newValue]));
        else if (oldValue !== null) cell.append(el("span", { class: `cmp-cell-main gone${oldValue === "" ? " blank" : ""}`, title: oldValue }, [oldValue]));
        if (diff && oldValue !== null) cell.append(el("span", { class: `cmp-cell-old${oldValue === "" ? " blank" : ""}`, title: oldValue }, [oldValue === "" ? "(empty)" : oldValue]));
        row.append(cell);
      }
      fragment.append(row);
    }
    body.style.transform = `translateY(${first * GRID_ROW}px)`;
    body.replaceChildren(fragment);
  }

  /** The worker's count of the filtered rows, when it differs from the estimate the view was built with. */
  private setTotal(total: number): void {
    this.total = total;
    const height = this.rowHeight();
    for (const spacer of this.spacers) spacer.style.height = `${total * height}px`;
    this.view.querySelector(".cmp-empty-rows")?.remove();
    if (total === 0) this.view.append(el("p", { class: "cmp-empty-rows" }, ["No rows here."]));
    this.updatePosition();
  }

  private updatePosition(): void {
    this.position.textContent = this.current < 0 ? `${nf.format(this.total)} rows` : `row ${nf.format(this.current + 1)} of ${nf.format(this.total)}`;
  }

  /** Next or previous difference: scrolls it into the middle of the view and marks it. */
  private async step(dir: 1 | -1): Promise<void> {
    if (this.total === 0) return;
    const from = this.current < 0 ? (dir === 1 ? -1 : this.total) : this.current;
    const found = await this.options.client.compareFind(this.filter, from, dir);
    if (found.index < 0) {
      this.status.textContent = dir === 1 ? "No more differences below" : "No more differences above";
      return;
    }
    this.current = found.index;
    this.updatePosition();
    const scroller = this.scrollers[0];
    if (scroller !== undefined) {
      const height = this.rowHeight();
      scroller.scrollTop = Math.max(0, found.index * height - scroller.clientHeight / 2 + height);
    }
    this.schedule();
  }

  /** Focus the rows so the arrow keys scroll them. */
  focus(): void {
    this.scrollers[0]?.focus({ preventScroll: true });
  }
}
