import type { CompareReport, ColumnTotals } from "../../data/compare/report.js";
import type { CompareRules } from "../../data/compare/types.js";
import { looksLikeIdName } from "../../data/identifier.js";
import { TYPE_LABELS } from "../../types.js";
import type { CompareSetupMessage } from "../../worker/protocol.js";
import { el } from "../dom.js";
import type { KeyChoice } from "./compare-setup.js";

export interface ReportInput {
  setup: CompareSetupMessage;
  report: CompareReport;
  ms: number;
  key: KeyChoice;
  rules: CompareRules;
}

export interface ReportActions {
  setup(): void;
}

const nf = new Intl.NumberFormat("en");
const num = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

/** "(empty)" stands in for a blank cell, so a value that appeared or vanished still reads. */
function shown(value: string): string {
  return value === "" ? "(empty)" : value;
}

function signed(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${num.format(Math.abs(value))}`;
}

function percent(part: number, whole: number): string {
  if (whole === 0) return "";
  const pct = (part / whole) * 100;
  return pct > 0 && pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`;
}

/** What the comparison matched on and how strictly, in one line. */
export function describeRun(input: ReportInput): string {
  const { setup, key, rules, ms } = input;
  const parts = [
    key.kind === "content"
      ? "Matched on whole rows"
      : `Matched on key ${key.pairs.map((i) => setup.a.columns[setup.pairing.pairs[i]?.a ?? -1]?.name ?? "?").join(" + ")}`,
  ];
  if (rules.numberAbs > 0) parts.push(`numbers ±${num.format(rules.numberAbs)}`);
  if (rules.numberRel > 0) parts.push(`numbers ±${num.format(rules.numberRel * 100)}%`);
  if (rules.ignoreCase) parts.push("case ignored");
  if (rules.trimSpaces) parts.push("extra spaces ignored");
  if (!rules.emptyEqualsEmpty) parts.push("empty ≠ empty");
  parts.push(`compared in ${ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`}`);
  return parts.join(" · ");
}

function tile(label: string, value: string, sub: string, tone: string): HTMLElement {
  return el("div", { class: `cmp-tile ${tone}` }, [
    el("span", { class: "cmp-tile-label" }, [el("span", { class: "cmp-dot", "aria-hidden": "true" }), label]),
    el("span", { class: "cmp-tile-value" }, [value]),
    el("span", { class: "cmp-tile-sub" }, [sub]),
  ]);
}

/** One bar for every aligned row: identical, changed, only in A, only in B. */
function composition(report: CompareReport): HTMLElement {
  const { identical, changed, onlyA, onlyB } = report.rows;
  const total = identical + changed + onlyA + onlyB;
  const parts = [
    ["same", identical, "identical"],
    ["changed", changed, "changed"],
    ["only-a", onlyA, "only in A"],
    ["only-b", onlyB, "only in B"],
  ] as const;
  const label = parts.map(([, n, name]) => `${percent(n, total) || "0%"} ${name}`).join(", ");
  const bar = el("div", { class: "cmp-bar", role: "img", "aria-label": `Of ${nf.format(total)} rows: ${label}` });
  for (const [tone, n] of parts) {
    if (n > 0) bar.append(el("span", { class: `cmp-bar-part ${tone}`, style: `flex-grow: ${n}` }));
  }
  return bar;
}

function warnings(report: CompareReport): HTMLElement | null {
  const lines: string[] = [];
  const dup = report.duplicateKeys;
  const empty = report.emptyKeys;
  for (const [side, d, e] of [["A", dup.a, empty.a], ["B", dup.b, empty.b]] as const) {
    if (d > 0) lines.push(`${nf.format(d)} row${d === 1 ? "" : "s"} in ${side} repeat a key; repeats pair in file order.`);
    if (e > 0) lines.push(`${nf.format(e)} row${e === 1 ? "" : "s"} in ${side} have no key, so they can't be matched.`);
  }
  if (lines.length === 0) return null;
  return el("section", { class: "cmp-warn", "aria-label": "Key problems" }, [
    el("h2", {}, ["Check the key before trusting the numbers"]),
    el("ul", {}, lines.map((text) => el("li", {}, [text]))),
  ]);
}

function card(title: string, aside?: string): HTMLElement {
  const head = el("div", { class: "cmp-section-head" }, [el("h2", { class: "cmp-section-title" }, [title])]);
  if (aside !== undefined) head.append(el("span", { class: "cmp-section-aside" }, [aside]));
  return el("section", { class: "cmp-card" }, [head]);
}

/** Each changed column: how many rows, the share as a bar, and its most common old → new values. */
function changesCard(input: ReportInput): HTMLElement {
  const { report, setup, key } = input;
  const box = card("Changes by column", report.rows.matched > 0 ? `share of the ${nf.format(report.rows.matched)} matched rows` : undefined);
  if (key.kind === "content") {
    box.append(
      el("p", { class: "cmp-note" }, [
        "Rows were matched on their whole content, so a changed row counts as one removed and one added: there are no cell changes to list. Match on a key to see them.",
      ]),
    );
    return box;
  }
  const peak = Math.max(...report.changes.map((change) => change.share), 0);
  for (const change of report.changes) {
    const top = el("div", { class: "cmp-pairs" });
    for (const pair of change.top.slice(0, 3)) {
      top.append(
        el("span", { class: "cmp-pair" }, [
          el("span", { class: `cmp-old${pair.from === "" ? " cmp-blank" : ""}` }, [shown(pair.from)]),
          el("span", { class: "cmp-to", "aria-label": "becomes" }, ["→"]),
          el("span", { class: `cmp-new${pair.to === "" ? " cmp-blank" : ""}` }, [shown(pair.to)]),
          el("span", { class: "cmp-times" }, [`×${nf.format(pair.count)}`]),
        ]),
      );
    }
    box.append(
      el("div", { class: "cmp-change" }, [
        el("span", { class: "cmp-change-name", title: change.name }, [change.name]),
        el("div", { class: "cmp-change-measure" }, [
          el("span", { class: "cmp-change-count" }, [nf.format(change.changed), el("span", { class: "cmp-change-share" }, [` · ${percent(change.changed, report.rows.matched)}`])]),
          el("span", { class: "cmp-meter", "aria-hidden": "true" }, [
            el("span", { class: "cmp-meter-fill", style: `width: ${peak === 0 ? 0 : Math.max(2, (change.share / peak) * 100)}%` }),
          ]),
        ]),
        top,
      ]),
    );
  }
  const changed = new Set(report.changes.map((change) => change.pair));
  const quiet = setup.pairing.pairs.map((pair, index) => (changed.has(index) ? null : setup.b.columns[pair.b]?.name ?? null)).filter((name): name is string => name !== null);
  if (report.changes.length === 0) {
    box.append(el("p", { class: "cmp-note" }, [report.rows.matched > 0 ? "No cell changed in the matched rows." : "No rows matched, so there are no cell changes."]));
  } else if (quiet.length > 0) {
    box.append(el("p", { class: "cmp-note cmp-quiet" }, [`No changes in ${quiet.join(", ")}.`]));
  }
  return box;
}

/** Columns added, removed, renamed or retyped between A and B. */
function columnsCard(report: CompareReport): HTMLElement {
  const box = card("Columns");
  const { added, removed, renamed, retyped } = report.columns;
  const row = (kind: string, tone: string, text: string): HTMLElement =>
    el("div", { class: "cmp-schema-row" }, [el("span", { class: `cmp-tag ${tone}` }, [kind]), el("span", { class: "cmp-schema-text" }, [text])]);
  for (const name of added) box.append(row("Added", "added", name));
  for (const name of removed) box.append(row("Removed", "gone", name));
  for (const pair of renamed) box.append(row("Renamed", "renamed", `${pair.a} → ${pair.b}`));
  for (const change of retyped) box.append(row("Retyped", "retyped", `${change.name}: ${TYPE_LABELS[change.a]} → ${TYPE_LABELS[change.b]}`));
  if (added.length + removed.length + renamed.length + retyped.length === 0) {
    box.append(el("p", { class: "cmp-note" }, ["The same columns, with the same types, on both sides."]));
  }
  return box;
}

/** Sums of each number column, over all rows and over matched rows only; key and id columns are left out (their sum means nothing). */
function totalsCard(input: ReportInput): HTMLElement | null {
  const { report, key } = input;
  const keyPairs = new Set(key.kind === "pairs" ? key.pairs : []);
  const totals = report.totals.filter((total) => !keyPairs.has(total.pair) && !looksLikeIdName(total.name));
  if (totals.length === 0) return null;
  const box = card("Totals check", "sum");
  const block = (total: ColumnTotals): HTMLElement => {
    const all = total.b.sum - total.a.sum;
    const matched = total.matched.b - total.matched.a;
    const pct = (diff: number, base: number): string => (base === 0 || diff === 0 ? "" : ` (${diff > 0 ? "+" : "−"}${Math.abs((diff / base) * 100).toFixed(2)}%)`);
    // Rows A, B and the difference; columns all rows and matched rows only.
    const grid = el("div", { class: "cmp-totals-grid" }, [
      el("span", {}),
      el("span", { class: "cmp-dim" }, ["All rows"]),
      el("span", { class: "cmp-dim" }, ["Matched"]),
      el("span", { class: "cmp-totals-label" }, ["A"]),
      el("span", {}, [num.format(total.a.sum)]),
      el("span", {}, [num.format(total.matched.a)]),
      el("span", { class: "cmp-totals-label" }, ["B"]),
      el("span", {}, [num.format(total.b.sum)]),
      el("span", {}, [num.format(total.matched.b)]),
      el("span", { class: "cmp-totals-label" }, ["B − A"]),
      el("span", { class: all === 0 ? "" : "cmp-diff" }, [signed(all), el("span", { class: "cmp-pct" }, [pct(all, total.a.sum)])]),
      el("span", { class: matched === 0 ? "" : "cmp-diff" }, [signed(matched), el("span", { class: "cmp-pct" }, [pct(matched, total.matched.a)])]),
    ]);
    return el("div", { class: "cmp-totals" }, [el("span", { class: "cmp-totals-name" }, [total.name]), grid]);
  };
  for (const total of totals) box.append(block(total));
  // Say where a change in a total comes from when the two rows of the check tell different stories.
  const largest = totals.reduce<ColumnTotals | null>((best, total) => {
    const swing = Math.abs(total.b.sum - total.a.sum);
    return best === null || swing > Math.abs(best.b.sum - best.a.sum) ? total : best;
  }, null);
  if (largest !== null) {
    const all = largest.b.sum - largest.a.sum;
    const matched = largest.matched.b - largest.matched.a;
    if (all !== 0 && Math.abs(matched) < Math.abs(all) / 2 && report.rows.onlyA + report.rows.onlyB > 0) {
      box.append(
        el("p", { class: "cmp-note" }, [
          `Most of the change in ${largest.name} comes from rows added or removed; on matched rows its total moved ${signed(matched)}.`,
        ]),
      );
    }
  }
  return box;
}

/** The comparison report: rows, key problems, changes by column, columns, totals. */
export function renderReport(host: HTMLElement, input: ReportInput, actions: ReportActions): void {
  const { report } = input;
  const rows = report.rows;
  const back = el("button", { class: "ghost small", type: "button" }, ["← Setup"]);
  back.addEventListener("click", () => actions.setup());
  const share = (n: number): string => (rows.matched === 0 ? "" : `${percent(n, rows.matched)} of matched rows`);
  const page = el("div", { class: "cmp-page cmp-report" });
  page.append(
    el("div", { class: "cmp-intro cmp-intro-row" }, [
      el("div", {}, [el("h1", { tabindex: "-1" }, ["What changed"]), el("p", {}, [describeRun(input)])]),
      back,
    ]),
    el("div", { class: "cmp-tiles" }, [
      tile("Identical", nf.format(rows.identical), share(rows.identical), "same"),
      tile("Changed", nf.format(rows.changed), share(rows.changed), "changed"),
      tile("Only in A (removed)", nf.format(rows.onlyA), "not in B", "only-a"),
      tile("Only in B (added)", nf.format(rows.onlyB), "new in B", "only-b"),
      tile("Rows", `${nf.format(rows.a)} → ${nf.format(rows.b)}`, `${signed(rows.b - rows.a)} · ${nf.format(rows.matched)} matched`, "rows"),
    ]),
    composition(report),
  );
  const warn = warnings(report);
  if (warn !== null) page.append(warn);
  const side = el("div", { class: "cmp-report-side" }, [columnsCard(report)]);
  const totals = totalsCard(input);
  if (totals !== null) side.append(totals);
  page.append(el("div", { class: "cmp-columns-layout" }, [el("div", { class: "cmp-main" }, [changesCard(input)]), side]));
  host.replaceChildren(page);
}
