import type { CategoryShift, ColumnShift, GroupMeasure, GroupShift, NumberSummary, NumericShift, ShiftLevel, ShiftReport } from "../../data/compare/shift.js";
import { toDateInputValue } from "../../parse/dates.js";
import type { CompareSetupMessage } from "../../worker/protocol.js";
import { el } from "../dom.js";
import type { SearchWorkerClient } from "../worker-client.js";

export interface GroupChoice {
  group: number;
  measure: number | null;
  agg: GroupMeasure;
}

export interface ShiftViewOptions {
  client: SearchWorkerClient;
  setup: CompareSetupMessage;
  shift: ShiftReport;
  /** The group view as it was last left (null: pick a sensible one). */
  groups: GroupChoice | null;
  onGroups(choice: GroupChoice): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const nf = new Intl.NumberFormat("en");
const num = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const LEVEL_TEXT: Record<ShiftLevel, string> = { large: "Large shift", mild: "Mild shift", none: "No real shift" };

function pct(share: number): string {
  const value = share * 100;
  return value > 0 && value < 0.1 ? "<0.1%" : `${value.toFixed(1)}%`;
}

function signed(value: number, format: (n: number) => string): string {
  if (value === 0 || !Number.isFinite(value)) return "0";
  return `${value > 0 ? "+" : "−"}${format(Math.abs(value))}`;
}

function valueFormat(shift: NumericShift): (value: number) => string {
  return shift.family === "date" ? (value) => (Number.isFinite(value) ? toDateInputValue(value) : "—") : (value) => (Number.isFinite(value) ? num.format(value) : "—");
}

function levelPill(level: ShiftLevel): HTMLElement {
  return el("span", { class: `cmp-level ${level}` }, [LEVEL_TEXT[level]]);
}

/** Two overlaid histograms: A as outlined bars, B filled, over the same bins. */
function overlay(shift: NumericShift): HTMLElement {
  const width = 360;
  const height = 96;
  const bins = shift.hist.a.length;
  const peak = Math.max(...shift.hist.a, ...shift.hist.b, 1e-9);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "cmp-hist");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Distribution of ${shift.name}: A outlined, B filled`);
  const step = width / bins;
  const bar = (share: number, index: number, cls: string): void => {
    if (share <= 0) return;
    const h = Math.max(1, (share / peak) * (height - 2));
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(index * step + 1));
    rect.setAttribute("y", String(height - h));
    rect.setAttribute("width", String(Math.max(1, step - 2)));
    rect.setAttribute("height", String(h));
    rect.setAttribute("class", cls);
    svg.append(rect);
  };
  shift.hist.b.forEach((share, i) => bar(share, i, "b"));
  shift.hist.a.forEach((share, i) => bar(share, i, "a"));
  const format = valueFormat(shift);
  return el("div", { class: "cmp-hist-wrap" }, [
    el("div", { class: "cmp-share-legend" }, [
      el("span", {}, [el("span", { class: "cmp-key-swatch a outline", "aria-hidden": "true" }), "A"]),
      el("span", {}, [el("span", { class: "cmp-key-swatch b", "aria-hidden": "true" }), "B"]),
    ]),
    svg,
    el("div", { class: "cmp-hist-axis" }, [el("span", {}, [format(shift.hist.from)]), el("span", {}, [format(shift.hist.to)])]),
  ]);
}

function numericCard(shift: NumericShift): HTMLElement {
  const format = valueFormat(shift);
  const row = (label: string, pick: (s: NumberSummary) => number, change = true): HTMLElement[] => {
    const a = pick(shift.a);
    const b = pick(shift.b);
    const diff = shift.family === "date" ? null : b - a;
    return [
      el("span", { class: "cmp-stat-label" }, [label]),
      el("span", {}, [format(a)]),
      el("span", {}, [format(b)]),
      el("span", { class: diff !== null && diff !== 0 && change ? "cmp-stat-diff" : "cmp-dim" }, [diff === null || !change ? "" : signed(diff, (n) => num.format(n))]),
    ];
  };
  const stats = el("div", { class: "cmp-stats" }, [
    el("span", {}),
    el("span", { class: "cmp-dim" }, ["A"]),
    el("span", { class: "cmp-dim" }, ["B"]),
    el("span", { class: "cmp-dim" }, ["B − A"]),
    ...row("Mean", (s) => s.mean),
    ...row("Median", (s) => s.median),
    ...row("10th pct", (s) => s.p10),
    ...row("90th pct", (s) => s.p90),
    ...(shift.family === "date" ? [] : row("Std dev", (s) => s.sd)),
    el("span", { class: "cmp-stat-label" }, ["Empty"]),
    el("span", {}, [pct(shift.a.empty)]),
    el("span", {}, [pct(shift.b.empty)]),
    el("span", { class: "cmp-dim" }, [shift.a.empty === shift.b.empty ? "" : `${signed((shift.b.empty - shift.a.empty) * 100, (n) => n.toFixed(1))} pts`]),
  ]);
  const measures = [`PSI ${shift.psi.toFixed(2)}`];
  if (shift.smd !== null && shift.family === "number") measures.push(`mean ${signed(shift.smd, (n) => n.toFixed(2))} SD`);
  return el("article", { class: "cmp-card cmp-shift" }, [
    el("div", { class: "cmp-shift-head" }, [
      el("h3", { class: "cmp-shift-name" }, [shift.name]),
      el("span", { class: "cmp-shift-kind" }, [shift.family === "date" ? "dates" : "numbers"]),
      levelPill(shift.level),
      el("span", { class: "cmp-shift-measure" }, [measures.join(" · ")]),
    ]),
    el("div", { class: "cmp-shift-body" }, [stats, overlay(shift)]),
    shift.sampled ? el("p", { class: "cmp-note" }, ["Percentiles and the median are estimated from 100,000 evenly spaced values; means and PSI use every value."]) : "",
  ]);
}

function categoryCard(shift: CategoryShift): HTMLElement {
  const peak = Math.max(...shift.values.map((v) => Math.max(v.a, v.b)), shift.other.a, shift.other.b, 1e-9);
  const rows = el("div", { class: "cmp-shares" });
  const shareRow = (label: string, a: number, b: number, note?: string): void => {
    const delta = (b - a) * 100;
    rows.append(
      el("div", { class: "cmp-share" }, [
        el("span", { class: "cmp-share-label", title: label }, [label === "" ? "(blank)" : label]),
        el("div", { class: "cmp-share-bars" }, [
          el("span", { class: "cmp-share-bar a", style: `width: ${(a / peak) * 100}%` }),
          el("span", { class: "cmp-share-bar b", style: `width: ${(b / peak) * 100}%` }),
        ]),
        el("span", { class: "cmp-share-values" }, [`${pct(a)} → ${pct(b)}`]),
        el("span", { class: Math.abs(delta) >= 1 ? "cmp-stat-diff" : "cmp-dim" }, [note ?? `${signed(delta, (n) => n.toFixed(1))} pts`]),
      ]),
    );
  };
  for (const value of shift.values) shareRow(value.label, value.a, value.b, value.aCount === 0 ? "new" : value.bCount === 0 ? "gone" : undefined);
  if (shift.other.a > 0 || shift.other.b > 0) shareRow("Other values", shift.other.a, shift.other.b);
  const notes: string[] = [];
  if (shift.appeared.length > 0) notes.push(`New in B: ${shift.appeared.map((v) => `${v.label} (${nf.format(v.count)})`).join(", ")}`);
  if (shift.vanished.length > 0) notes.push(`Gone from B: ${shift.vanished.map((v) => `${v.label} (${nf.format(v.count)})`).join(", ")}`);
  if (Math.abs(shift.empty.b - shift.empty.a) >= 0.001) notes.push(`Empty cells ${pct(shift.empty.a)} → ${pct(shift.empty.b)}`);
  return el("article", { class: "cmp-card cmp-shift" }, [
    el("div", { class: "cmp-shift-head" }, [
      el("h3", { class: "cmp-shift-name" }, [shift.name]),
      el("span", { class: "cmp-shift-kind" }, [`${shift.distinct.a} → ${shift.distinct.b} values`]),
      levelPill(shift.level),
      el("span", { class: "cmp-shift-measure" }, [`Cramér's V ${shift.v.toFixed(2)}`]),
    ]),
    el("div", { class: "cmp-share-legend" }, [
      el("span", {}, [el("span", { class: "cmp-key-swatch a", "aria-hidden": "true" }), "A share"]),
      el("span", {}, [el("span", { class: "cmp-key-swatch b", "aria-hidden": "true" }), "B share"]),
    ]),
    rows,
    ...notes.map((text) => el("p", { class: "cmp-note" }, [text])),
  ]);
}

function card(shift: ColumnShift): HTMLElement {
  return shift.kind === "numeric" ? numericCard(shift) : categoryCard(shift);
}

/** "Drift": the by-group comparison, then every column ranked by how far it moved. */
export class ShiftView {
  readonly element: HTMLElement;
  private readonly groupHost: HTMLElement;
  private choice: GroupChoice | null;
  private seq = 0;

  constructor(private readonly options: ShiftViewOptions) {
    const { shift } = options;
    const counts = { large: 0, mild: 0, none: 0 };
    for (const column of shift.columns) counts[column.level]++;
    this.choice = options.groups ?? this.defaultChoice();
    this.groupHost = el("div", { class: "cmp-groups-body" });

    const page = el("div", { class: "cmp-page cmp-shift-page" });
    page.append(
      el("div", { class: "cmp-intro" }, [
        el("h1", { tabindex: "-1" }, ["Drift"]),
        el("p", {}, [
          "A and B compared as a whole, so no rows need to match. Columns are ranked by how far their values moved.",
        ]),
      ]),
      el("div", { class: "cmp-shift-summary" }, [
        el("span", { class: "cmp-level large" }, [`${counts.large} large`]),
        el("span", { class: "cmp-level mild" }, [`${counts.mild} mild`]),
        el("span", { class: "cmp-level none" }, [`${counts.none} no real shift`]),
        shift.skipped.length > 0 ? el("span", { class: "cmp-dim" }, [`Not compared: ${shift.skipped.map((s) => `${s.name} (${s.why})`).join("; ")}`]) : "",
      ]),
      this.method(),
    );
    if (this.choice !== null) page.append(this.groupsCard());
    const moved = shift.columns.filter((column) => column.level !== "none");
    const still = shift.columns.filter((column) => column.level === "none");
    if (moved.length === 0) page.append(el("p", { class: "cmp-note" }, ["No column's values moved enough to count as a shift."]));
    page.append(...moved.map(card));
    if (still.length > 0) {
      const details = el("details", { class: "cmp-still" }, [
        el("summary", {}, [`${still.length} column${still.length === 1 ? "" : "s"} with no real shift: ${still.map((s) => s.name).join(", ")}`]),
        ...still.map(card),
      ]);
      page.append(details);
    }
    this.element = page;
    if (this.choice !== null) void this.loadGroups();
  }

  /** The measure's method in a sentence, for people who want to know what "shift" means here. */
  private method(): HTMLElement {
    return el("details", { class: "cmp-method" }, [
      el("summary", {}, ["How shift is measured"]),
      el("p", {}, [
        "Numbers and dates: Population Stability Index over A's deciles (under 0.1 no real shift, 0.1–0.25 mild, above 0.25 large). For numbers the mean difference in pooled standard deviations counts too (0.2 mild, 0.5 large); the larger verdict wins, because PSI can miss a moderate move of the mean in a wide, skewed column. Categories: Cramér's V between side and value (under 0.1 negligible, 0.1–0.3 mild, 0.3 and above large). These measure how big a shift is, not whether it is statistically significant: with thousands of rows almost any difference is significant, so a p-value would say little.",
      ]),
    ]);
  }

  /** A category with 2–40 values to group by, and the first number column (not an id) to measure. */
  private defaultChoice(): GroupChoice | null {
    const { shift } = this.options;
    const group = shift.columns.find((c): c is CategoryShift => c.kind === "category" && Math.max(c.distinct.a, c.distinct.b) >= 2 && Math.max(c.distinct.a, c.distinct.b) <= 40);
    if (group === undefined) return null;
    const measure = shift.columns.find((c): c is NumericShift => c.kind === "numeric" && c.family === "number");
    return { group: group.pair, measure: measure?.pair ?? null, agg: measure === undefined ? "count" : "mean" };
  }

  private groupsCard(): HTMLElement {
    const { shift, setup } = this.options;
    const choice = this.choice!;
    const name = (pair: number): string => setup.b.columns[setup.pairing.pairs[pair]?.b ?? -1]?.name ?? "?";
    const select = (label: string, options: { value: string; text: string }[], value: string, change: (value: string) => void): HTMLElement => {
      const input = el("select", { class: "cmp-select" }) as HTMLSelectElement;
      for (const option of options) input.append(el("option", { value: option.value }, [option.text]) as HTMLOptionElement);
      input.value = value;
      input.addEventListener("change", () => change(input.value));
      return el("label", { class: "cmp-field cmp-field-inline" }, [el("span", {}, [label]), input]);
    };
    const groups = shift.columns.filter((c): c is CategoryShift => c.kind === "category").map((c) => ({ value: String(c.pair), text: c.name }));
    const measures = [
      { value: "", text: "Row count" },
      ...shift.columns
        .filter((c) => (c.kind === "numeric" && c.family === "number") || (c.kind === "category" && c.numeric))
        .map((c) => ({ value: String(c.pair), text: c.name })),
    ];
    const controls = el("div", { class: "cmp-groups-controls" }, [
      select("Group by", groups, String(choice.group), (value) => this.setChoice({ ...choice, group: Number(value) })),
      select("Measure", measures, choice.measure === null ? "" : String(choice.measure), (value) =>
        this.setChoice(value === "" ? { ...choice, measure: null, agg: "count" } : { ...choice, measure: Number(value), agg: choice.agg === "count" ? "mean" : choice.agg }),
      ),
    ]);
    if (choice.measure !== null) {
      controls.append(
        select(
          "As",
          [
            { value: "mean", text: "Mean" },
            { value: "sum", text: "Sum" },
          ],
          choice.agg,
          (value) => this.setChoice({ ...choice, agg: value as GroupMeasure }),
        ),
      );
    }
    const title = choice.measure === null ? `Rows per ${name(choice.group)}` : `${choice.agg === "sum" ? "Sum" : "Mean"} of ${name(choice.measure)} per ${name(choice.group)}`;
    return el("section", { class: "cmp-card cmp-groups", "aria-label": "By group" }, [
      el("div", { class: "cmp-section-head" }, [el("h2", { class: "cmp-section-title" }, ["By group"]), el("span", { class: "cmp-section-aside" }, [title])]),
      controls,
      this.groupHost,
    ]);
  }

  private setChoice(choice: GroupChoice): void {
    this.choice = choice;
    this.options.onGroups(choice);
    this.element.querySelector(".cmp-groups")?.replaceWith(this.groupsCard());
    void this.loadGroups();
  }

  private async loadGroups(): Promise<void> {
    const choice = this.choice;
    if (choice === null) return;
    const seq = ++this.seq;
    this.groupHost.replaceChildren(el("p", { class: "cmp-note" }, ["Working…"]));
    try {
      const result = await this.options.client.compareGroups(choice.group, choice.measure, choice.agg);
      if (seq === this.seq) this.drawGroups(result.groups, choice);
    } catch (error) {
      this.groupHost.replaceChildren(el("p", { class: "cmp-error" }, [error instanceof Error ? error.message : "Could not group the rows."]));
    }
  }

  private drawGroups(result: GroupShift, choice: GroupChoice): void {
    const rows = result.groups.map((row) => {
      const a = row.a.value;
      const b = row.b.value;
      const diff = a !== null && b !== null ? b - a : null;
      const rel = diff !== null && a !== null && a !== 0 ? diff / Math.abs(a) : null;
      return { row, a, b, diff, rel };
    });
    // Biggest relative moves first; groups only one side has go last.
    rows.sort((x, y) => (y.rel === null ? -1 : 0) - (x.rel === null ? -1 : 0) || Math.abs(y.rel ?? 0) - Math.abs(x.rel ?? 0));
    // A fixed scale (±10% fills half the bar, more when a group moved further), so a tiny change never looks big.
    const peak = Math.max(...rows.map((r) => Math.abs(r.rel ?? 0)), 0.1);
    const value = (v: number | null): string => (v === null ? "—" : choice.agg === "count" || choice.measure === null ? nf.format(v) : Math.abs(v) >= 100_000 ? compact.format(v) : num.format(v));
    const table = el("table", { class: "cmp-group-table" });
    table.append(
      el("thead", {}, [
        el("tr", {}, [
          el("th", { scope: "col" }, ["Group"]),
          el("th", { scope: "col", class: "num" }, ["A"]),
          el("th", { scope: "col", class: "num" }, ["B"]),
          el("th", { scope: "col", class: "num" }, ["B − A"]),
          el("th", { scope: "col" }, ["Change"]),
        ]),
      ]),
    );
    const body = el("tbody");
    for (const r of rows) {
      const rel = r.rel;
      const bar = el("span", { class: "cmp-diverge", "aria-hidden": "true" });
      if (rel !== null && rel !== 0) {
        const width = (Math.abs(rel) / peak) * 50;
        bar.append(el("span", { class: `cmp-diverge-fill ${rel > 0 ? "up" : "down"}`, style: rel > 0 ? `left: 50%; width: ${width}%` : `left: ${50 - width}%; width: ${width}%` }));
      }
      body.append(
        el("tr", {}, [
          el("td", { class: "cmp-group-name", title: r.row.group }, [r.row.group === "" ? "(empty)" : r.row.group]),
          el("td", { class: "num" }, [value(r.a), el("span", { class: "cmp-group-n" }, [`n ${nf.format(r.row.a.rows)}`])]),
          el("td", { class: "num" }, [value(r.b), el("span", { class: "cmp-group-n" }, [`n ${nf.format(r.row.b.rows)}`])]),
          el("td", { class: `num${r.diff !== null && r.diff !== 0 ? " cmp-stat-diff" : ""}` }, [r.diff === null ? (r.a === null ? "new in B" : "gone in B") : signed(r.diff, (n) => num.format(n))]),
          el("td", { class: "cmp-group-change" }, [bar, el("span", { class: "cmp-group-pct" }, [rel === null ? "" : `${signed(Math.round(rel * 1000) / 10, (n) => n.toFixed(1))}%`])]),
        ]),
      );
    }
    table.append(body);
    const parts: HTMLElement[] = [el("div", { class: "cmp-table-wrap" }, [table])];
    if (result.more > 0) parts.push(el("p", { class: "cmp-note" }, [`${nf.format(result.more)} smaller groups not shown.`]));
    this.groupHost.replaceChildren(...parts);
  }
}
