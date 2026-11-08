import { DIFF_OPS, diffCenter, type DiffColumn, type DiffOp, type DiffSummary } from "../../data/compare/diffs.js";
import type { CompareDiffsMessage } from "../../worker/protocol.js";
import { el } from "../dom.js";
import type { SearchWorkerClient } from "../worker-client.js";

/** How the differences are coloured. Coolwarm is blue (below) to red (above), so it is never mistaken for A's red and B's green. */
export type ColourMap = "coolwarm" | "greenred" | "none";
/** Whether each column is coloured on its own range, or all share the widest. */
export type ColourScope = "column" | "all";

export interface ValueDiffsState {
  op: DiffOp;
  colour: ColourMap;
  scope: ColourScope;
}

export interface ValueDiffsOptions {
  client: SearchWorkerClient;
  state: ValueDiffsState;
  /** Remembers the choices so the sheet comes back as it was left. */
  onState(state: ValueDiffsState): void;
}

const nf = new Intl.NumberFormat("en");
const ROW = 28;
const OVERSCAN = 12;
const BLOCK = 200;
const LABEL_WIDTH = 170;
const COLUMN_WIDTH = 124;

type Rgb = [number, number, number];
const STOPS: Record<Exclude<ColourMap, "none">, Rgb[]> = {
  // Moreland's cool-warm diverging map: blue, light grey in the middle, red.
  coolwarm: [[59, 76, 192], [141, 176, 254], [221, 221, 221], [244, 154, 123], [180, 4, 38]],
  greenred: [[192, 57, 43], [226, 142, 128], [221, 221, 221], [129, 199, 132], [39, 150, 80]],
};

/** The colour for t from -1 (lowest) through 0 (neutral) to 1 (highest). */
export function colourAt(map: Exclude<ColourMap, "none">, t: number): Rgb {
  const stops = STOPS[map];
  const x = (Math.max(-1, Math.min(1, t)) + 1) * 2;
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const [p, q] = [stops[i]!, stops[i + 1]!];
  return [Math.round(p[0] + (q[0] - p[0]) * f), Math.round(p[1] + (q[1] - p[1]) * f), Math.round(p[2] + (q[2] - p[2]) * f)];
}

/** Black or white, whichever reads better on the colour. */
function inkFor([r, g, b]: Rgb): string {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.179 ? "#111" : "#fff";
}

const signed = new Intl.NumberFormat("en", { maximumSignificantDigits: 4, signDisplay: "exceptZero" });
const plain = new Intl.NumberFormat("en", { maximumSignificantDigits: 4 });
const percent = new Intl.NumberFormat("en", { maximumFractionDigits: 1, signDisplay: "exceptZero" });

/** A difference as a cell reads it: signed for changes in direction, a percentage for % change, ×n for a ratio. */
export function formatDiff(op: DiffOp, value: number): string {
  if (!(value === value)) return "";
  switch (op) {
    case "sub":
    case "rsub":
      return signed.format(value);
    case "abs":
      return plain.format(value);
    case "pct":
      return `${percent.format(value)}%`;
    case "ratio":
      return `×${plain.format(value)}`;
  }
}

/**
 * Value differences: for every row present in both files, the number columns
 * they share, combined as B − A (or another operation) and coloured on a
 * diverging scale so rises and falls are visible at a glance.
 */
export class ValueDiffs {
  readonly element: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly view: HTMLElement;
  private state: ValueDiffsState;
  private meta: { columns: DiffColumn[]; summary: DiffSummary[]; labelName: string; total: number } | null = null;
  private block: CompareDiffsMessage | null = null;
  private pending = 0;
  private seq = 0;
  private frame = 0;
  private scroller: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private disposed = false;

  constructor(private readonly options: ValueDiffsOptions) {
    this.state = { ...options.state };
    this.toolbar = el("div", { class: "cmp-vd-toolbar" });
    this.view = el("div", { class: "cmp-view" });
    this.element = el("div", { class: "cmp-vd" }, [this.toolbar, this.view]);
    void this.load();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
  }

  private choose(next: Partial<ValueDiffsState>): void {
    this.state = { ...this.state, ...next };
    this.options.onState(this.state);
  }

  /** Fetches the first block (which also says which columns there are) and builds the sheet. */
  private async load(): Promise<void> {
    this.seq++;
    this.block = null;
    try {
      const first = await this.options.client.compareDiffs(this.state.op, 0, BLOCK);
      if (this.disposed) return;
      this.meta = { columns: first.columns, summary: first.summary, labelName: first.labelName, total: first.total };
      this.block = first;
      this.build();
    } catch (error) {
      this.view.replaceChildren(el("p", { class: "cmp-error", role: "alert" }, [error instanceof Error ? error.message : "Could not work out the differences."]));
    }
  }

  private controls(): HTMLElement[] {
    const op = el("select", { class: "cmp-select", "aria-label": "Difference" }) as HTMLSelectElement;
    for (const entry of DIFF_OPS) op.append(el("option", { value: entry.op, title: entry.hint }, [entry.label]) as HTMLOptionElement);
    op.value = this.state.op;
    op.addEventListener("change", () => {
      this.choose({ op: op.value as DiffOp });
      void this.load();
    });
    const colour = el("select", { class: "cmp-select", "aria-label": "Colour map" }) as HTMLSelectElement;
    for (const [value, label] of [["coolwarm", "Cool–warm (blue below, red above)"], ["greenred", "Green above, red below"], ["none", "No colour"]] as const) {
      colour.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    colour.value = this.state.colour;
    colour.addEventListener("change", () => {
      this.choose({ colour: colour.value as ColourMap });
      this.build();
    });
    const scope = el("select", { class: "cmp-select", "aria-label": "Colour scale" }) as HTMLSelectElement;
    for (const [value, label] of [["column", "Scale each column on its own"], ["all", "One scale for all columns"]] as const) {
      scope.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    scope.value = this.state.scope;
    scope.addEventListener("change", () => {
      this.choose({ scope: scope.value as ColourScope });
      this.build();
    });
    return [
      el("label", { class: "cmp-field" }, [el("span", {}, ["Show"]), op]),
      el("label", { class: "cmp-field" }, [el("span", {}, ["Colour"]), colour]),
      el("label", { class: "cmp-field" }, [el("span", {}, [""]), scope]),
    ];
  }

  /** The strip that says what the colours mean. */
  private legend(): HTMLElement | null {
    if (this.state.colour === "none") return null;
    const map = this.state.colour;
    const centre = diffCenter(this.state.op);
    const stops = Array.from({ length: 9 }, (_, i) => {
      const [r, g, b] = colourAt(map, this.state.op === "abs" ? i / 8 : (i - 4) / 4);
      return `rgb(${r},${g},${b})`;
    });
    const ends = this.state.op === "abs" ? ["none", "larger"] : this.state.op === "ratio" ? ["below 1", "above 1"] : ["falls", "rises"];
    return el("div", { class: "cmp-vd-legend", "aria-hidden": "true" }, [
      el("span", {}, [this.state.op === "abs" ? "no change" : ends[0]!]),
      el("span", { class: "cmp-vd-ramp", style: `background: linear-gradient(to right, ${stops.join(", ")})` }),
      el("span", {}, [this.state.op === "abs" ? ends[1]! : centre === 1 ? `${ends[1]!} (1 = same)` : ends[1]!]),
    ]);
  }

  private build(): void {
    if (this.disposed) return;
    const meta = this.meta;
    const bar = [...this.controls()];
    const legend = this.legend();
    if (legend !== null) bar.push(legend);
    this.toolbar.replaceChildren(...bar);
    if (meta === null) return;
    if (meta.columns.length === 0) {
      this.view.replaceChildren(el("p", { class: "cmp-empty-rows" }, ["A and B share no number columns, so there are no values to subtract. Text and date columns are on Spot the difference."]));
      return;
    }
    if (meta.total === 0) {
      this.view.replaceChildren(el("p", { class: "cmp-empty-rows" }, ["No rows were found in both files, so there is nothing to subtract."]));
      return;
    }
    const template = `${LABEL_WIDTH}px ${meta.columns.map(() => `${COLUMN_WIDTH}px`).join(" ")}`;
    const head = el("div", { class: "cmp-grid-head cmp-vd-head", style: `grid-template-columns: ${template}` }, [
      el("span", { title: meta.labelName }, [meta.labelName]),
      ...meta.columns.map((column, c) => {
        const s = meta.summary[c]!;
        const note = s.n === 0 ? "no values" : `mean ${formatDiff(this.state.op, s.mean)}`;
        return el("span", { class: "cmp-vd-col", title: `${column.name}: ${note}, from ${formatDiff(this.state.op, s.min)} to ${formatDiff(this.state.op, s.max)} over ${nf.format(s.n)} rows` }, [
          el("span", { class: "cmp-vd-name" }, [column.name]),
          el("span", { class: "cmp-vd-mean" }, [note]),
        ]);
      }),
    ]);
    const body = el("div", { class: "cmp-grid-body" });
    body.dataset.template = template;
    const spacer = el("div", { class: "cmp-grid-spacer", style: `height: ${meta.total * ROW}px` }, [body]);
    const scroller = el("div", { class: "cmp-grid-scroll", tabindex: "0", "aria-label": `Differences for ${nf.format(meta.total)} rows` }, [head, spacer]);
    scroller.addEventListener("scroll", () => this.schedule());
    this.scroller = scroller;
    this.body = body;
    this.view.replaceChildren(scroller);
    this.schedule();
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => void this.draw());
  }

  private async draw(): Promise<void> {
    const { scroller, meta } = this;
    if (this.disposed || scroller === null || meta === null) return;
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW) - OVERSCAN);
    const last = Math.min(meta.total, Math.ceil((scroller.scrollTop + (scroller.clientHeight || 600)) / ROW) + OVERSCAN);
    const block = this.block;
    if (block === null || first < block.start || last > block.start + block.labels.length) {
      const start = Math.max(0, first - Math.floor((BLOCK - (last - first)) / 2));
      if (this.pending === start + 1) return;
      this.pending = start + 1;
      const seq = ++this.seq;
      try {
        const next = await this.options.client.compareDiffs(this.state.op, start, start + Math.max(BLOCK, last - first));
        if (seq !== this.seq || this.disposed) return;
        this.block = next;
        this.pending = 0;
      } catch {
        return;
      }
      this.schedule();
      return;
    }
    this.drawRows(block, first, last);
  }

  private drawRows(block: CompareDiffsMessage, first: number, last: number): void {
    const { body, meta } = this;
    if (body === null || meta === null) return;
    const width = meta.columns.length;
    const centre = diffCenter(this.state.op);
    const op = this.state.op;
    const map = this.state.colour === "none" ? null : this.state.colour;
    const widest = Math.max(...meta.summary.map((s) => s.reach), 0);
    const reaches = meta.summary.map((s) => (this.state.scope === "all" ? widest : s.reach));
    const fragment = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const at = i - block.start;
      if (at < 0 || at >= block.labels.length) continue;
      const row = el("div", { class: "cmp-row", style: `grid-template-columns: ${body.dataset.template}` });
      row.append(el("span", { class: "cmp-cell cmp-vd-label", title: block.labels[at]! }, [block.labels[at]!]));
      for (let c = 0; c < width; c++) {
        const value = block.values[at * width + c]!;
        const text = formatDiff(op, value);
        const attrs: Record<string, string> = { class: `cmp-cell cmp-vd-cell${text === "" ? " blank" : ""}`, title: text === "" ? "" : `${meta.columns[c]!.name}: ${text}` };
        if (map !== null && text !== "") {
          const reach = reaches[c]!;
          const t = reach > 0 ? (value - centre) / reach : 0;
          const rgb = colourAt(map, op === "abs" ? Math.max(0, Math.min(1, t)) : t);
          // Absolute size runs from nothing (neutral) up through the warm half of the map.
          const shown = op === "abs" ? colourAt(map, Math.max(0, Math.min(1, t))) : rgb;
          attrs.style = `background: rgb(${shown[0]},${shown[1]},${shown[2]}); color: ${inkFor(shown)}`;
        }
        row.append(el("span", attrs, [text]));
      }
      fragment.append(row);
    }
    body.style.transform = `translateY(${first * ROW}px)`;
    body.replaceChildren(fragment);
  }
}
