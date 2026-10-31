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
}

export interface NewColumnResult {
  name: string;
  at: number;
  formula: string;
}

type Mode = "formula" | "value";
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
      value: el("button", { type: "button", role: "tab", "data-mode": "value" }, ["Same value for every row"]) as HTMLButtonElement,
    };
    modeSeg.append(modeButtons.formula, modeButtons.value);

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
      el("div", { class: "newcol-body" }, [el("div", { class: "newcol-input" }, [formulaPane, valuePane]), previewSide]),
      el("div", { class: "clean-footer" }, [el("span", { class: "newcol-keys" }, ["Ctrl+Enter adds"]), el("span", { class: "grow" }), cancel, addButton]),
    );

    // ---------------------------------------------------------------- behaviour
    const currentFormula = (): string | null => (mode === "formula" ? formula.value.trim() : constantFormula(valueInput.value, valueType));

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
    nameInput.addEventListener("input", () => { if (last?.ok) render(last); });
    valueInput.addEventListener("input", schedule);
    typeSelect.addEventListener("change", () => { valueType = typeSelect.value as ValueType; schedule(); });

    function setMode(next: Mode): void {
      mode = next;
      for (const [key, button] of Object.entries(modeButtons) as [Mode, HTMLButtonElement][]) button.setAttribute("aria-selected", String(key === mode));
      formulaPane.classList.toggle("hidden", mode !== "formula");
      valuePane.classList.toggle("hidden", mode !== "value");
      (mode === "formula" ? formula : valueInput).focus();
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
