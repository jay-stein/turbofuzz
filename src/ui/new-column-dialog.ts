/**
 * The New column window: an Excel-style formula over the other columns, or the same
 * value on every row, with a live preview of the first rows and of what comes out
 * empty, before anything changes. The result is one Recipe step (`derive`).
 */

import { FUNCTIONS } from "../data/column-formula.js";
import { fuzzyRank } from "../search/fuzzy-match.js";
import type { ColumnType } from "../types.js";
import type { FormulaPreviewMessage } from "../worker/protocol.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface NewColumnOptions {
  columns: readonly { name: string; type: ColumnType }[];
  /** Where the column goes (0 = first); columns.length = at the end. */
  at: number;
  preview(formula: string): Promise<FormulaPreviewMessage>;
  formula?: string;
  name?: string;
  /** The first rows of the table, for From examples. */
  sampleRows?(): Promise<{ columns: string[]; rows: string[][] }>;
  /** Formulas that give the typed results on those rows. */
  suggest?(examples: { position: number; output: string }[]): Promise<string[]>;
}

export interface NewColumnResult {
  name: string;
  at: number;
  formula: string;
}

type Mode = "formula" | "ifthen" | "quick" | "examples" | "value";
type ValueType = "text" | "number" | "date" | "bool";

const TYPE_LABEL: Partial<Record<string, string>> = {
  integer: "Whole number", number: "Number", string: "Text", category: "Category", date: "Date", datetime: "Date & time",
  boolean: "Yes/No", identifier: "ID", time: "Time", duration: "Duration",
};
const FUNCTION_GROUPS: [string, string[]][] = [
  ["Logic", ["IF", "AND", "OR", "NOT", "ISBLANK", "COALESCE", "IFBLANK"]],
  ["Numbers", ["ROUND", "ABS", "MIN", "MAX"]],
  ["Text", ["CONCAT", "UPPER", "LOWER", "TRIM", "LEN", "LEFT", "RIGHT", "MID", "FIND", "CONTAINS"]],
  ["Dates", ["YEAR", "MONTH", "DAY", "WEEKDAY", "DATEDIF", "DATE", "TODAY"]],
];
const nf = new Intl.NumberFormat("en");

export type IfOp = "is" | "isnot" | "gt" | "ge" | "lt" | "le" | "contains" | "empty" | "notempty";
export interface IfRule { column: string; op: IfOp; value: string; then: string }
const IF_OPS: [IfOp, string][] = [
  ["is", "is"], ["isnot", "is not"], ["gt", ">"], ["ge", "≥"], ["lt", "<"], ["le", "≤"],
  ["contains", "contains"], ["empty", "is empty"], ["notempty", "is not empty"],
];
const isNum = (v: string): boolean => v.trim() !== "" && Number.isFinite(Number(v.trim()));
const quote = (v: string): string => `"${v.replace(/"/g, '""')}"`;
const ref = (name: string): string => `[${name.replace(/]/g, "]]")}]`;

/**
 * The If / then builder as a formula: IF(test1, then1, IF(test2, then2, otherwise)).
 * Values compare as numbers or dates when the column is one; outputs are numbers when
 * every output is a number. Null until each rule names a column.
 */
export function ifThenFormula(rules: readonly IfRule[], otherwise: string, types: ReadonlyMap<string, ColumnType>): string | null {
  if (rules.length === 0 || rules.some((r) => r.column === "")) return null;
  const outputs = [...rules.map((r) => r.then), otherwise].filter((v) => v.trim() !== "");
  const numeric = outputs.length > 0 && outputs.every(isNum);
  const out = (v: string): string => (v.trim() === "" ? '""' : numeric ? String(Number(v.trim())) : quote(v));
  const lit = (r: IfRule): string => {
    const type = types.get(r.column);
    if ((type === "integer" || type === "number") && isNum(r.value)) return String(Number(r.value.trim()));
    const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(r.value.trim());
    if ((type === "date" || type === "datetime") && d) return `DATE(${Number(d[1])}, ${Number(d[2])}, ${Number(d[3])})`;
    return quote(r.value);
  };
  const test = (r: IfRule): string => {
    const c = ref(r.column);
    switch (r.op) {
      case "empty": return `ISBLANK(${c})`;
      case "notempty": return `NOT(ISBLANK(${c}))`;
      case "contains": return `CONTAINS(${c}, ${quote(r.value)})`;
      default: return `${c} ${{ is: "=", isnot: "<>", gt: ">", ge: ">=", lt: "<", le: "<=" }[r.op]} ${lit(r)}`;
    }
  };
  return rules.reduceRight((acc, r) => `IF(${test(r)}, ${out(r.then)}, ${acc})`, out(otherwise));
}

/** One-click columns: each writes a formula (and a name) from a column. */
export interface QuickPick { id: string; label: string; group: string; needs: "none" | "any" | "number" | "date" | "two"; name(a: string, b: string): string; formula(a: string, b: string, n: number, sep: string): string }
export const QUICK_PICKS: readonly QuickPick[] = [
  { id: "copy", group: "Copy and count", label: "Copy of a column", needs: "any", name: (a) => `${a} (copy)`, formula: (a) => ref(a) },
  { id: "index", group: "Copy and count", label: "Row number (1, 2, 3…)", needs: "none", name: () => "Row number", formula: () => "ROWNUMBER()" },
  { id: "len", group: "Copy and count", label: "Text length", needs: "any", name: (a) => `${a} length`, formula: (a) => `LEN(${ref(a)})` },
  { id: "join", group: "Copy and count", label: "Join two columns", needs: "two", name: (a, b) => `${a} ${b}`, formula: (a, b, _n, sep) => `CONCAT(${ref(a)}, ${quote(sep)}, ${ref(b)})` },
  { id: "year", group: "Date parts", label: "Year", needs: "date", name: (a) => `${a} year`, formula: (a) => `YEAR(${ref(a)})` },
  { id: "month", group: "Date parts", label: "Month (1-12)", needs: "date", name: (a) => `${a} month`, formula: (a) => `MONTH(${ref(a)})` },
  { id: "day", group: "Date parts", label: "Day of the month", needs: "date", name: (a) => `${a} day`, formula: (a) => `DAY(${ref(a)})` },
  { id: "weekday", group: "Date parts", label: "Weekday (Monday = 1)", needs: "date", name: (a) => `${a} weekday`, formula: (a) => `WEEKDAY(${ref(a)}, 2)` },
  { id: "rank", group: "Across the column", label: "Rank (1 = largest)", needs: "number", name: (a) => `${a} rank`, formula: (a) => `RANK(${ref(a)})` },
  { id: "pct", group: "Across the column", label: "% of total", needs: "number", name: (a) => `${a} % of total`, formula: (a) => `PERCENTOFTOTAL(${ref(a)})` },
  { id: "running", group: "Across the column", label: "Running total", needs: "number", name: (a) => `${a} running total`, formula: (a) => `RUNNINGSUM(${ref(a)})` },
  { id: "change", group: "Across the column", label: "Change from the row above", needs: "number", name: (a) => `${a} change`, formula: (a) => `${ref(a)} - PREVIOUS(${ref(a)})` },
  { id: "bins", group: "Across the column", label: "Equal-width bands", needs: "number", name: (a) => `${a} band`, formula: (a, _b, n) => `BIN(${ref(a)}, ${n})` },
];

/** The formula a "same value for every row" stands for. Null when the value does not read. */
export function constantFormula(value: string, type: ValueType): string | null {
  const v = value.trim();
  if (type === "text") return `"${value.replace(/"/g, '""')}"`;
  if (type === "number") {
    const n = Number(v.replace(/,/g, ""));
    return v !== "" && Number.isFinite(n) ? String(n) : null;
  }
  if (type === "bool") return /^(true|yes|y|1)$/i.test(v) ? "TRUE" : /^(false|no|n|0)$/i.test(v) ? "FALSE" : null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  return m ? `DATE(${Number(m[1])}, ${Number(m[2])}, ${Number(m[3])})` : null;
}

/** The [partial column name being typed at the caret, or null. */
export function columnAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf("[");
  if (open < 0 || before.lastIndexOf("]") > open) return null;
  // Not inside a quoted text: an even number of quotes before the [.
  if ((before.slice(0, open).match(/"/g)?.length ?? 0) % 2 === 1) return null;
  return { start: open, query: before.slice(open + 1) };
}

/** The function whose brackets the caret is inside (the nearest one), or null. */
export function functionAtCaret(text: string, caret: number): string | null {
  let depth = 0;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      if (depth === 0) {
        const m = /([A-Za-z_]+)\s*$/.exec(text.slice(0, i));
        return m && FUNCTIONS[m[1]!.toUpperCase()] ? m[1]!.toUpperCase() : null;
      }
      depth--;
    }
  }
  const word = /([A-Za-z_]+)$/.exec(text.slice(0, caret));
  return word && FUNCTIONS[word[1]!.toUpperCase()] ? word[1]!.toUpperCase() : null;
}

export function openNewColumn(options: NewColumnOptions): Promise<NewColumnResult | null> {
  return new Promise((resolve) => {
    let mode: Mode = "formula";
    let valueType: ValueType = "text";
    let last: FormulaPreviewMessage | null = null;
    let seq = 0;

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal newcol-modal" });
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close", "aria-label": "Close" }, ["×"]);

    // ---------------------------------------------------------------- name, place, mode
    const nameInput = el("input", { class: "text-input newcol-name", type: "text", value: options.name ?? "New column", "aria-label": "Column name", spellcheck: "false" }) as HTMLInputElement;
    const place = el("select", { class: "newcol-place", "aria-label": "Where the column goes" }) as HTMLSelectElement;
    place.append(el("option", { value: "0" }, ["First"]) as HTMLOptionElement);
    options.columns.forEach((c, i) => place.append(el("option", { value: String(i + 1) }, [`After ${c.name}`]) as HTMLOptionElement));
    place.value = String(Math.max(0, Math.min(options.at, options.columns.length)));
    if (options.at >= options.columns.length) place.options[place.options.length - 1]!.textContent = `At the end (after ${options.columns[options.columns.length - 1]?.name ?? "the last column"})`;
    const modeSeg = el("div", { class: "newcol-modes", role: "tablist", "aria-label": "What goes in the column" });
    const modeButtons: Record<Mode, HTMLButtonElement> = {
      formula: el("button", { type: "button", role: "tab", "data-mode": "formula" }, ["Formula"]) as HTMLButtonElement,
      ifthen: el("button", { type: "button", role: "tab", "data-mode": "ifthen" }, ["If / then"]) as HTMLButtonElement,
      quick: el("button", { type: "button", role: "tab", "data-mode": "quick" }, ["Quick column"]) as HTMLButtonElement,
      examples: el("button", { type: "button", role: "tab", "data-mode": "examples" }, ["From examples"]) as HTMLButtonElement,
      value: el("button", { type: "button", role: "tab", "data-mode": "value" }, ["Same value for every row"]) as HTMLButtonElement,
    };
    modeSeg.append(modeButtons.formula, modeButtons.ifthen, modeButtons.quick, modeButtons.examples, modeButtons.value);
    if (options.suggest === undefined) modeButtons.examples.remove();
    // The name follows the choice until the person types their own.
    let autoName = options.name === undefined;
    const setAutoName = (name: string): void => { if (autoName) nameInput.value = name; };
    const types = new Map(options.columns.map((c) => [c.name, c.type] as const));
    const columnSelect = (label: string, filter: (t: ColumnType) => boolean = () => true): HTMLSelectElement => {
      const s = el("select", { "aria-label": label }) as HTMLSelectElement;
      for (const c of options.columns) if (filter(c.type)) s.append(el("option", { value: c.name }, [c.name]) as HTMLOptionElement);
      return s;
    };

    // ---------------------------------------------------------------- from examples
    const exampleTable = el("table", { class: "newcol-preview newcol-examples" });
    const exampleFound = el("div", { class: "newcol-found" });
    let exampleFormula: string | null = null;
    let exampleInputs: HTMLInputElement[] = [];
    let examplesLoaded = false;
    let exampleSeq = 0;
    async function loadExamples(): Promise<void> {
      if (examplesLoaded || options.sampleRows === undefined) return;
      examplesLoaded = true;
      const sample = await options.sampleRows().catch(() => null);
      if (sample === null) return;
      exampleInputs = sample.rows.map((_, i) => el("input", { class: "text-input", type: "text", "aria-label": `Result for row ${i + 1}`, placeholder: i < 2 ? "type the result" : "" }) as HTMLInputElement);
      exampleTable.replaceChildren(
        el("thead", {}, [el("tr", {}, [...sample.columns.map((c) => el("th", { class: "newcol-in" }, [c])), el("th", { class: "newcol-out" }, ["You want"])])]),
        el("tbody", {}, sample.rows.map((row, i) => el("tr", {}, [...row.map((v) => el("td", { class: "newcol-in" }, [v])), el("td", { class: "newcol-out" }, [exampleInputs[i]!])]))),
      );
      for (const input of exampleInputs) input.addEventListener("input", findExamples);
      exampleInputs[0]?.focus();
    }
    let exampleTimer = 0;
    function findExamples(): void {
      window.clearTimeout(exampleTimer);
      exampleTimer = window.setTimeout(async () => {
        const examples = exampleInputs.map((input, position) => ({ position, output: input.value })).filter((e) => e.output.trim() !== "");
        const mine = ++exampleSeq;
        if (examples.length === 0) { exampleFound.replaceChildren(); exampleFormula = null; schedule(); return; }
        const found = await options.suggest?.(examples).catch(() => []) ?? [];
        if (mine !== exampleSeq) return;
        exampleFormula = found[0] ?? null;
        const chooser = (f: string): HTMLElement => {
          const b = el("button", { type: "button", class: "newcol-chip fn", "aria-pressed": String(f === exampleFormula) }, [f]);
          b.addEventListener("click", () => { exampleFormula = f; for (const x of exampleFound.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b)); schedule(); });
          return b;
        };
        exampleFound.replaceChildren(
          found.length === 0
            ? el("span", { class: "newcol-warn" }, ["No rule gives all of those. Try another example, or write a formula."])
            : el("span", { class: "newcol-note" }, [found.length === 1 ? "This rule fits:" : `${found.length} rules fit; the first is picked (check the preview on more rows):`]),
          ...found.map(chooser),
        );
        schedule();
      }, 200);
    }
    const examplesEdit = el("button", { type: "button", class: "ghost small" }, ["Edit as formula"]);
    examplesEdit.addEventListener("click", () => { if (exampleFormula) { formula.value = exampleFormula; setMode("formula"); } });
    const examplesPane = el("div", { class: "newcol-pane hidden" }, [
      el("p", { class: "newcol-note" }, ["Type what the new column should say for a row or two; the rule that gives exactly that is found for you."]),
      el("div", { class: "newcol-examples-wrap" }, [exampleTable]),
      exampleFound,
      el("div", { class: "newcol-rule" }, [examplesEdit]),
    ]);

    // ---------------------------------------------------------------- if / then
    const rulesHost = el("div", { class: "newcol-rules" });
    const otherwiseInput = el("input", { class: "text-input", type: "text", "aria-label": "Otherwise", placeholder: "(empty)" }) as HTMLInputElement;
    const addRule = el("button", { type: "button", class: "ghost small" }, ["+ Another if"]);
    const asFormula = el("button", { type: "button", class: "ghost small" }, ["Show as formula"]);
    const rules: { row: HTMLElement; read(): IfRule }[] = [];
    function addRuleRow(): void {
      const column = columnSelect("If column");
      const op = el("select", { "aria-label": "Test" }) as HTMLSelectElement;
      for (const [v, label] of IF_OPS) op.append(el("option", { value: v }, [label]) as HTMLOptionElement);
      const value = el("input", { class: "text-input", type: "text", "aria-label": "Value", placeholder: "value" }) as HTMLInputElement;
      const then = el("input", { class: "text-input", type: "text", "aria-label": "Then", placeholder: "result" }) as HTMLInputElement;
      const remove = el("button", { type: "button", class: "icon-btn", "aria-label": "Remove this if", title: "Remove" }, ["×"]);
      const row = el("div", { class: "newcol-rule" }, [el("span", { class: "newcol-rule-word" }, [rules.length ? "Else if" : "If"]), column, op, value, el("span", { class: "newcol-rule-word" }, ["then"]), then, remove]);
      const entry = { row, read: (): IfRule => ({ column: column.value, op: op.value as IfOp, value: value.value, then: then.value }) };
      op.addEventListener("change", () => { value.classList.toggle("hidden", op.value === "empty" || op.value === "notempty"); schedule(); });
      for (const input of [column, value, then]) input.addEventListener("input", schedule);
      column.addEventListener("change", schedule);
      remove.addEventListener("click", () => {
        if (rules.length === 1) return;
        rules.splice(rules.indexOf(entry), 1);
        row.remove();
        rules.forEach((r, k) => { (r.row.firstChild as HTMLElement).textContent = k ? "Else if" : "If"; });
        schedule();
      });
      rules.push(entry);
      rulesHost.append(row);
    }
    addRuleRow();
    addRule.addEventListener("click", () => { addRuleRow(); schedule(); });
    otherwiseInput.addEventListener("input", schedule);
    const ifFormula = (): string | null => ifThenFormula(rules.map((r) => r.read()), otherwiseInput.value, types);
    asFormula.addEventListener("click", () => { const f = ifFormula(); if (f) { formula.value = f; setMode("formula"); } });
    const ifPane = el("div", { class: "newcol-pane hidden" }, [
      rulesHost,
      el("div", { class: "newcol-rule" }, [addRule]),
      el("label", { class: "newcol-rule" }, [el("span", { class: "newcol-rule-word" }, ["Otherwise"]), otherwiseInput]),
      el("div", { class: "newcol-rule" }, [asFormula, el("span", { class: "newcol-note" }, ["Text compares whatever the case; numbers and dates compare as numbers and dates."])]),
    ]);

    // ---------------------------------------------------------------- quick column
    const pickSelect = el("select", { "aria-label": "Quick column" }) as HTMLSelectElement;
    for (const group of [...new Set(QUICK_PICKS.map((p) => p.group))]) {
      const g = el("optgroup", { label: group });
      for (const p of QUICK_PICKS.filter((q) => q.group === group)) g.append(el("option", { value: p.id }, [p.label]) as HTMLOptionElement);
      pickSelect.append(g);
    }
    const quickA = columnSelect("Column");
    const quickB = columnSelect("Second column");
    const sepInput = el("input", { class: "text-input newcol-small", type: "text", value: " ", "aria-label": "Separator" }) as HTMLInputElement;
    const binsInput = el("input", { class: "text-input newcol-small", type: "number", min: "1", max: "100", value: "5", "aria-label": "Number of bands" }) as HTMLInputElement;
    const quickFormula = el("code", { class: "newcol-quick-formula" });
    const quickEdit = el("button", { type: "button", class: "ghost small" }, ["Edit as formula"]);
    const fieldA = el("label", { class: "map-field" }, [el("span", {}, ["Column"]), quickA]);
    const fieldB = el("label", { class: "map-field" }, [el("span", {}, ["and"]), quickB]);
    const fieldSep = el("label", { class: "map-field" }, [el("span", {}, ["Separator"]), sepInput]);
    const fieldBins = el("label", { class: "map-field" }, [el("span", {}, ["Bands"]), binsInput]);
    const quickPick = (): QuickPick => QUICK_PICKS.find((p) => p.id === pickSelect.value) ?? QUICK_PICKS[0]!;
    const fits = (needs: QuickPick["needs"], t: ColumnType | undefined): boolean =>
      needs === "number" ? t === "integer" || t === "number" : needs === "date" ? t === "date" || t === "datetime" : true;
    function quickChanged(): void {
      const p = quickPick();
      fieldA.classList.toggle("hidden", p.needs === "none");
      fieldB.classList.toggle("hidden", p.needs !== "two");
      fieldSep.classList.toggle("hidden", p.needs !== "two");
      fieldBins.classList.toggle("hidden", p.id !== "bins");
      // Offer the columns that fit first: a number pick starts on a number column.
      if (!fits(p.needs, types.get(quickA.value))) {
        const first = options.columns.find((c) => fits(p.needs, c.type));
        if (first) quickA.value = first.name;
      }
      setAutoName(p.name(quickA.value, quickB.value));
      quickFormula.textContent = quickFormulaText() ?? "";
      schedule();
    }
    const quickFormulaText = (): string | null => {
      const p = quickPick();
      if (p.needs !== "none" && quickA.value === "") return null;
      return p.formula(quickA.value, quickB.value, Math.max(1, Math.trunc(Number(binsInput.value) || 5)), sepInput.value);
    };
    for (const input of [pickSelect, quickA, quickB]) input.addEventListener("change", quickChanged);
    for (const input of [sepInput, binsInput]) input.addEventListener("input", quickChanged);
    quickEdit.addEventListener("click", () => { const f = quickFormulaText(); if (f) { formula.value = f; setMode("formula"); } });
    const quickPane = el("div", { class: "newcol-pane hidden" }, [
      el("label", { class: "map-field" }, [el("span", {}, ["Make"]), pickSelect]),
      el("div", { class: "newcol-rule" }, [fieldA, fieldB, fieldSep, fieldBins]),
      el("div", { class: "newcol-rule" }, [el("span", { class: "newcol-note" }, ["Formula:"]), quickFormula, quickEdit]),
      el("p", { class: "newcol-note" }, ["Rank, % of total, running total, change and bands read the whole column in the table's stored order (the file's order), whatever the Table is sorted by."]),
    ]);

    // ---------------------------------------------------------------- formula
    const formula = el("textarea", {
      class: "newcol-formula",
      rows: "3",
      spellcheck: "false",
      placeholder: '[Price] * [Qty]     IF([Status] = "Closed", "Done", "Open")     YEAR([Order date])',
      "aria-label": "Formula",
    }) as HTMLTextAreaElement;
    formula.value = options.formula ?? "";
    const suggest = el("ul", { class: "newcol-suggest hidden", role: "listbox", "aria-label": "Columns" });
    const fnHelp = el("div", { class: "newcol-fnhelp", "aria-live": "polite" });
    const problem = el("div", { class: "newcol-problem", role: "alert" });
    const colList = el("div", { class: "newcol-list" });
    for (const c of options.columns) {
      const b = el("button", { type: "button", class: "newcol-chip", title: `Insert [${c.name}]` }, [el("span", {}, [c.name]), el("small", {}, [TYPE_LABEL[c.type] ?? c.type])]);
      b.addEventListener("click", () => insert(`[${c.name.replace(/]/g, "]]")}]`));
      colList.append(b);
    }
    const fnList = el("div", { class: "newcol-list" });
    for (const [group, names] of FUNCTION_GROUPS) {
      fnList.append(el("div", { class: "newcol-group" }, [group]));
      for (const name of names) {
        const b = el("button", { type: "button", class: "newcol-chip fn", title: `${FUNCTIONS[name]!.sig}: ${FUNCTIONS[name]!.help}` }, [name]);
        b.addEventListener("click", () => insert(name === "TODAY" ? "TODAY()" : `${name}(`));
        fnList.append(b);
      }
    }
    const formulaPane = el("div", { class: "newcol-pane" }, [
      el("div", { class: "newcol-editor" }, [formula, suggest]),
      problem,
      fnHelp,
      el("details", { class: "newcol-refs", open: "" }, [
        el("summary", {}, ["Columns and functions"]),
        el("div", { class: "newcol-refs-body" }, [
          el("div", {}, [el("div", { class: "newcol-group" }, ["Columns (click to insert)"]), colList]),
          el("div", {}, [fnList]),
        ]),
      ]),
    ]);

    // ---------------------------------------------------------------- same value
    const valueInput = el("input", { class: "text-input", type: "text", "aria-label": "Value for every row", placeholder: "Online" }) as HTMLInputElement;
    const typeSelect = el("select", { "aria-label": "Type of the value" }, [
      el("option", { value: "text" }, ["Text"]),
      el("option", { value: "number" }, ["Number"]),
      el("option", { value: "date" }, ["Date (YYYY-MM-DD)"]),
      el("option", { value: "bool" }, ["Yes/No"]),
    ]) as HTMLSelectElement;
    const valuePane = el("div", { class: "newcol-pane hidden" }, [
      el("div", { class: "newcol-value-row" }, [
        el("label", { class: "map-field" }, [el("span", {}, ["Value"]), valueInput]),
        el("label", { class: "map-field" }, [el("span", {}, ["Type"]), typeSelect]),
      ]),
      el("p", { class: "newcol-note" }, ["Every row gets this value; useful to mark where rows came from before merging files, or to start a column you will fill in."]),
    ]);

    // ---------------------------------------------------------------- preview
    const summary = el("div", { class: "newcol-summary", role: "status" });
    const previewTable = el("table", { class: "newcol-preview" });
    const previewSide = el("div", { class: "newcol-side" }, [summary, previewTable]);

    const addButton = el("button", { class: "primary", type: "button" }, ["Add column"]) as HTMLButtonElement;
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    modal.append(
      el("div", { class: "modal-head" }, [el("h2", {}, ["New column"]), closeButton]),
      el("div", { class: "newcol-top" }, [
        el("label", { class: "map-field" }, [el("span", {}, ["Name"]), nameInput]),
        el("label", { class: "map-field" }, [el("span", {}, ["Place"]), place]),
        modeSeg,
      ]),
      el("div", { class: "newcol-body" }, [el("div", { class: "newcol-input" }, [formulaPane, ifPane, quickPane, examplesPane, valuePane]), previewSide]),
      el("div", { class: "clean-footer" }, [el("span", { class: "newcol-keys" }, ["Ctrl+Enter adds"]), el("span", { class: "grow" }), cancel, addButton]),
    );

    // ---------------------------------------------------------------- behaviour
    const currentFormula = (): string | null =>
      mode === "formula" ? formula.value.trim()
      : mode === "ifthen" ? ifFormula()
      : mode === "quick" ? quickFormulaText()
      : mode === "examples" ? exampleFormula
      : constantFormula(valueInput.value, valueType);

    function insert(text: string): void {
      const start = formula.selectionStart, end = formula.selectionEnd;
      formula.setRangeText(text, start, end, "end");
      formula.focus();
      onFormulaInput();
    }

    let timer = 0;
    function schedule(): void {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 140);
    }

    async function refresh(): Promise<void> {
      const text = currentFormula();
      const mine = ++seq;
      if (text === null || text === "") {
        last = null;
        problem.textContent = mode === "value" && valueInput.value.trim() !== "" ? `That is not a ${valueType === "number" ? "number" : valueType === "date" ? "date as YYYY-MM-DD" : "yes or no"}.` : "";
        summary.replaceChildren(el("span", { class: "newcol-dim" }, [mode === "formula" ? "Type a formula to see the new column." : "Type the value every row gets."]));
        previewTable.replaceChildren();
        addButton.disabled = true;
        return;
      }
      const result = await options.preview(text).catch(() => null);
      if (mine !== seq || result === null) return;
      last = result;
      render(result);
    }

    function render(r: FormulaPreviewMessage): void {
      addButton.disabled = !r.ok;
      if (!r.ok) {
        problem.textContent = r.error ?? "That formula does not read.";
        problem.dataset.at = String(r.at ?? 0);
        problem.dataset.end = String(r.end ?? 0);
        summary.replaceChildren(el("span", { class: "newcol-dim" }, ["Fix the formula to see the new column."]));
        previewTable.replaceChildren();
        return;
      }
      problem.textContent = "";
      const checked = r.checked ?? 0, total = r.total ?? 0;
      const scope = checked < total ? ` of ${nf.format(checked)} rows checked` : "";
      const lines: (Node | string)[] = [el("strong", {}, [`${TYPE_LABEL[r.columnType ?? ""] ?? r.columnType} column`])];
      const errorRows = r.errorRows ?? 0, blanks = r.blanks ?? 0;
      if (errorRows === 0 && blanks === 0) lines.push(el("span", { class: "newcol-ok" }, [checked < total ? `Every checked row has a value (${nf.format(checked)} of ${nf.format(total)})` : `Every row has a value (${nf.format(total)})`]));
      if (blanks > 0) lines.push(el("span", { class: "newcol-dim" }, [`${nf.format(blanks)} empty${scope} where the inputs are empty`]));
      if (errorRows > 0) {
        lines.push(el("span", { class: "newcol-warn" }, [`${nf.format(errorRows)} left empty${scope}: ${(r.errors ?? []).slice(0, 3).map(([reason, n]) => `${reason} (${nf.format(n)})`).join("; ")}`]));
      }
      summary.replaceChildren(...lines.flatMap((line, k) => (k ? [el("br"), line] : [line])));
      const name = nameInput.value.trim() || "New column";
      const inputs = r.inputs ?? [];
      previewTable.replaceChildren(
        el("thead", {}, [el("tr", {}, [...inputs.map((h) => el("th", { class: "newcol-in" }, [h])), el("th", { class: "newcol-out" }, [name])])]),
        el("tbody", {}, (r.rows ?? []).map((row) => el("tr", {}, [
          ...row.inputs.map((v) => el("td", { class: "newcol-in" }, [v])),
          el("td", { class: `newcol-out${row.value === "" ? " empty" : ""}` }, [row.value === "" ? "empty" : row.value]),
        ]))),
      );
    }

    // Column suggestions after [ and function help at the caret.
    let hits: string[] = [];
    let active = 0;
    function onFormulaInput(): void {
      const caret = formula.selectionStart;
      const at = columnAtCaret(formula.value, caret);
      hits = at === null ? [] : fuzzyRank(options.columns.map((c) => c.name), at.query, (n) => n).slice(0, 8);
      active = 0;
      drawSuggest();
      const fn = functionAtCaret(formula.value, caret);
      const spec = fn ? FUNCTIONS[fn] : undefined;
      fnHelp.replaceChildren(...(spec ? [el("code", {}, [spec.sig]), " ", spec.help, " ", el("span", { class: "newcol-dim" }, ["e.g. "]), el("code", {}, [spec.example])] : []));
      schedule();
    }
    function drawSuggest(): void {
      suggest.classList.toggle("hidden", hits.length === 0);
      suggest.replaceChildren(...hits.map((name, k) => {
        const li = el("li", { role: "option", "aria-selected": String(k === active) }, [name]);
        li.addEventListener("mousedown", (event) => { event.preventDefault(); pick(k); });
        return li;
      }));
    }
    function pick(k: number): void {
      const name = hits[k];
      const at = columnAtCaret(formula.value, formula.selectionStart);
      if (name === undefined || at === null) return;
      const caret = formula.selectionStart;
      // Swallow a ] already typed after the caret.
      const after = formula.value[caret] === "]" ? 1 : 0;
      formula.setRangeText(`[${name.replace(/]/g, "]]")}]`, at.start, caret + after, "end");
      hits = [];
      drawSuggest();
      onFormulaInput();
    }

    formula.addEventListener("input", onFormulaInput);
    formula.addEventListener("click", onFormulaInput);
    formula.addEventListener("keyup", (event) => { if (event.key.startsWith("Arrow") && hits.length === 0) onFormulaInput(); });
    formula.addEventListener("keydown", (event) => {
      if (hits.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
        drawSuggest();
      } else if ((event.key === "Enter" && !event.ctrlKey && !event.metaKey) || event.key === "Tab") {
        event.preventDefault();
        pick(active);
      } else if (event.key === "Escape") {
        event.stopPropagation();
        hits = [];
        drawSuggest();
      }
    });
    // Close the list when focus has really left (not on a brief focus change as the window opens).
    formula.addEventListener("blur", () => window.setTimeout(() => {
      if (document.activeElement === formula) return;
      hits = [];
      drawSuggest();
    }, 100));
    problem.addEventListener("click", () => {
      const at = Number(problem.dataset.at ?? 0), end = Number(problem.dataset.end ?? 0);
      formula.focus();
      formula.setSelectionRange(at, Math.max(at, end));
    });
    nameInput.addEventListener("input", () => { autoName = false; if (last?.ok) render(last); });
    valueInput.addEventListener("input", schedule);
    typeSelect.addEventListener("change", () => { valueType = typeSelect.value as ValueType; schedule(); });

    function setMode(next: Mode): void {
      mode = next;
      for (const [key, button] of Object.entries(modeButtons) as [Mode, HTMLButtonElement][]) button.setAttribute("aria-selected", String(key === mode));
      formulaPane.classList.toggle("hidden", mode !== "formula");
      ifPane.classList.toggle("hidden", mode !== "ifthen");
      quickPane.classList.toggle("hidden", mode !== "quick");
      examplesPane.classList.toggle("hidden", mode !== "examples");
      if (mode === "examples") void loadExamples();
      valuePane.classList.toggle("hidden", mode !== "value");
      if (mode === "quick") quickChanged();
      (mode === "formula" ? formula : mode === "value" ? valueInput : mode === "quick" ? pickSelect : rulesHost.querySelector("select") ?? formula).focus();
      schedule();
    }
    modeSeg.addEventListener("click", (event) => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-mode]");
      if (b) setMode(b.dataset.mode as Mode);
    });

    let settled = false;
    const finish = (result: NewColumnResult | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const add = (): void => {
      const text = currentFormula();
      if (text === null || text === "" || !last?.ok) return;
      finish({ name: nameInput.value.trim() || "New column", at: Number(place.value), formula: text });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
      else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); add(); }
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    addButton.addEventListener("click", add);
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay) finish(null); });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "New column");
    setMode("formula");
    addButton.disabled = true;
    void refresh();
    window.setTimeout(() => { formula.focus(); formula.setSelectionRange(formula.value.length, formula.value.length); onFormulaInput(); }, 0);
  });
}
