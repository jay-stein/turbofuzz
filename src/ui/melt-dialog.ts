import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import type { ColumnSchema, TransformOp } from "../data/transform-ops.js";

export type MeltOp = Extract<TransformOp, { kind: "melt" }>;

export interface MeltDialogOptions {
  /** The columns the melt will see (after any earlier steps). */
  schema: readonly ColumnSchema[];
  rowCount: number;
  /** Counts the result for a staged melt, so the dialog can say how many rows it makes. */
  preview(op: MeltOp): Promise<{ rowCount: number; columnNames: string[] } | null>;
}

type Role = "keep" | "unpivot" | "out";

const MAX_ROWS = 2_000_000;
const YEAR = /^(1[89]|20)\d\d$/;
const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const QUARTER = /^(q[1-4]|[1-4]q)\b/i;
const PERIOD_LIKE = (name: string): boolean => {
  const n = name.trim();
  return YEAR.test(n) || MONTH.test(n) || QUARTER.test(n) || /^(fy|cy)?\s?\d{2,4}[-/ ]?(q[1-4]|\d{2})?$/i.test(n) || /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$/.test(n);
};

/** A sensible first split: period-like headers (2019, Jan, Q3) become rows, everything else is kept; failing that, numbers become rows. */
export function suggestMeltRoles(schema: readonly ColumnSchema[]): Role[] {
  const period = schema.map((c) => PERIOD_LIKE(c.name));
  if (period.filter(Boolean).length >= 2) return schema.map((_, i) => (period[i] ? "unpivot" : "keep"));
  const numeric = schema.map((c) => c.numeric);
  if (numeric.some(Boolean) && numeric.some((x) => !x)) return schema.map((_, i) => (numeric[i] ? "unpivot" : "keep"));
  return schema.map((_, i) => (i === 0 ? "keep" : "unpivot"));
}

/** What the column of old headers should be called, when the headers say what they are. */
export function suggestVariableName(names: readonly string[]): string {
  if (names.length >= 2 && names.every((n) => YEAR.test(n.trim()))) return "year";
  if (names.length >= 2 && names.every((n) => MONTH.test(n.trim()))) return "month";
  if (names.length >= 2 && names.every((n) => QUARTER.test(n.trim()))) return "quarter";
  return "variable";
}

const n = (value: number): string => value.toLocaleString();

/** Melt (wide → long) as a dialog: say which columns to keep and which to turn into rows, see what it makes, then apply. */
export function openMeltDialog(options: MeltDialogOptions): Promise<MeltOp | null> {
  return new Promise((resolve) => {
    const { schema } = options;
    const roles: Role[] = suggestMeltRoles(schema);
    let varTouched = false;

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal melt-modal" });
    const head = el("div", { class: "modal-head" });
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(el("h2", {}, ["Melt: wide to long"]), closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body melt-body" });
    body.append(
      el("p", { class: "clean-hint" }, [
        "Turns columns into rows. Keep the columns that describe each row (a region, an id) and choose the columns to stack, such as one per year. Each stacked column becomes its own set of rows, with its old header in one new column and its cells in another.",
      ]),
    );

    const diagram = el("div", { class: "melt-diagram", "aria-live": "polite" });
    const quick = el("div", { class: "melt-quick" });
    const mk = (label: string, title: string, run: () => void): HTMLButtonElement => {
      const b = el("button", { class: "ghost small", type: "button", title }, [label]) as HTMLButtonElement;
      b.addEventListener("click", run);
      return b;
    };
    const find = el("input", { class: "text-input melt-find", type: "search", placeholder: "Find a column…", "aria-label": "Find a column", spellcheck: "false" }) as HTMLInputElement;
    const list = el("div", { class: "melt-list", role: "group", "aria-label": "What to do with each column" });

    const setAll = (role: Role, only?: (i: number) => boolean): void => {
      schema.forEach((_, i) => {
        if (only === undefined || only(i)) roles[i] = role;
      });
      renderList();
      update();
    };
    quick.append(
      mk("Suggest", "Years, months and quarters become rows; the other columns are kept", () => {
        suggestMeltRoles(schema).forEach((r, i) => (roles[i] = r));
        renderList();
        update();
      }),
      mk("Keep first, stack the rest", "The first column is kept; every other column becomes rows", () => {
        schema.forEach((_, i) => (roles[i] = i === 0 ? "keep" : "unpivot"));
        renderList();
        update();
      }),
      mk("Stack every number column", "Number columns become rows, the others are kept", () => {
        schema.forEach((c, i) => (roles[i] = c.numeric ? "unpivot" : "keep"));
        renderList();
        update();
      }),
      mk("Keep all", "Start again: nothing is stacked", () => setAll("keep")),
    );

    const colHead = el("div", { class: "melt-row melt-colhead", "aria-hidden": "true" }, [
      el("span", {}, ["Column"]),
      el("span", {}, ["Keep"]),
      el("span", {}, ["Stack into rows"]),
      el("span", {}, ["Leave out"]),
    ]);

    function renderList(): void {
      const q = find.value.trim().toLowerCase();
      list.replaceChildren();
      schema.forEach((column, i) => {
        if (q !== "" && !column.name.toLowerCase().includes(q)) return;
        const row = el("div", { class: `melt-row role-${roles[i]}` });
        row.append(el("span", { class: "melt-name", title: column.name }, [column.name, column.numeric ? " #" : ""]));
        for (const role of ["keep", "unpivot", "out"] as const) {
          const input = el("input", { type: "radio", name: `melt-role-${i}`, value: role, "aria-label": `${column.name}: ${role === "keep" ? "keep" : role === "unpivot" ? "stack into rows" : "leave out"}` }) as HTMLInputElement;
          input.checked = roles[i] === role;
          input.addEventListener("change", () => {
            roles[i] = role;
            row.className = `melt-row role-${role}`;
            update();
          });
          row.append(el("label", { class: "melt-cell" }, [input]));
        }
        list.append(row);
      });
      if (list.childElementCount === 0) list.append(el("p", { class: "clean-hint" }, ["No column matches."]));
    }
    find.addEventListener("input", renderList);

    const varInput = el("input", { class: "text-input", type: "text", value: "variable", spellcheck: "false", "aria-label": "Name of the column for the old headers" }) as HTMLInputElement;
    const valueInput = el("input", { class: "text-input", type: "text", value: "value", spellcheck: "false", "aria-label": "Name of the column for the cells" }) as HTMLInputElement;
    varInput.addEventListener("input", () => {
      varTouched = true;
      update();
    });
    valueInput.addEventListener("input", update);
    const dropEmpty = el("input", { type: "checkbox", "aria-label": "Skip empty cells" }) as HTMLInputElement;
    dropEmpty.addEventListener("change", update);
    const names = el("div", { class: "melt-names" }, [
      el("label", { class: "clean-field" }, [el("span", { class: "clean-label" }, ["Column for the old headers"]), varInput]),
      el("label", { class: "clean-field" }, [el("span", { class: "clean-label" }, ["Column for the cells"]), valueInput]),
    ]);
    const dropLabel = el("label", { class: "melt-check" }, [dropEmpty, el("span", {}, ["Skip empty cells (do not make a row for them)"])]);

    const notes = el("div", { class: "melt-notes", role: "status", "aria-live": "polite" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const apply = el("button", { class: "primary", type: "button" }, ["Melt"]) as HTMLButtonElement;
    const footer = el("div", { class: "clean-footer" });
    footer.append(cancel, el("span", { class: "grow" }), apply);

    body.append(
      el("div", { class: "melt-listhead" }, [el("span", { class: "clean-label" }, ["1 · What happens to each column?"]), el("span", { class: "grow" }), quick]),
      find,
      colHead,
      list,
      el("span", { class: "clean-label melt-step" }, ["2 · Name the two new columns"]),
      names,
      dropLabel,
      el("span", { class: "clean-label melt-step" }, ["3 · What it makes"]),
      diagram,
      notes,
    );
    modal.append(body, footer);

    const pick = (role: Role): number[] => schema.map((_, i) => i).filter((i) => roles[i] === role);
    const currentOp = (): MeltOp => ({
      kind: "melt",
      idVars: pick("keep"),
      valueVars: pick("unpivot"),
      varName: varInput.value.trim() || "variable",
      valueName: valueInput.value.trim() || "value",
      ...(dropEmpty.checked ? { dropEmpty: true } : {}),
    });

    let timer = 0;
    let serial = 0;
    function update(): void {
      const keep = pick("keep"), stack = pick("unpivot");
      if (!varTouched) varInput.value = suggestVariableName(stack.map((i) => schema[i].name));
      const varName = varInput.value.trim() || "variable";
      const valueName = valueInput.value.trim() || "value";
      const problems: string[] = [];
      if (stack.length === 0) problems.push("Choose at least one column to stack into rows.");
      if (varName === valueName) problems.push("The two new columns need different names.");
      for (const i of keep) {
        if (schema[i].name === varName || schema[i].name === valueName) problems.push(`A kept column is already called “${schema[i].name}”. Rename a new column.`);
      }
      const rows = options.rowCount * stack.length;
      const warnings: string[] = [];
      if (rows > MAX_ROWS) problems.push(`That would make ${n(rows)} rows, more than the ${n(MAX_ROWS)} allowed. Stack fewer columns.`);
      const numericCount = stack.filter((i) => schema[i].numeric).length;
      if (stack.length > 0 && numericCount > 0 && numericCount < stack.length) {
        warnings.push("The stacked columns are a mix of numbers and text, so the new cells column will be read as text.");
      }
      if (keep.length === 0 && stack.length > 0) warnings.push("No column is kept, so nothing says which row each value came from.");

      // The shape, in the person's own column names.
      const sample = stack.slice(0, 3).map((i) => schema[i].name);
      const more = stack.length > 3 ? ` … +${n(stack.length - 3)}` : "";
      const keepNames = keep.slice(0, 3).map((i) => schema[i].name).join(", ") + (keep.length > 3 ? ", …" : "");
      diagram.replaceChildren(
        el("div", { class: "melt-shape" }, [
          el("div", {}, [el("b", {}, ["Now"]), `  ${[keepNames, sample.join(" | ") + more].filter((s) => s !== "").join("  |  ")}`]),
          el("div", {}, [el("b", {}, ["After"]), `  ${[keepNames, varName, valueName].filter((s) => s !== "").join("  |  ")}`]),
        ]),
      );
      notes.replaceChildren(
        ...problems.map((p) => el("p", { class: "melt-problem" }, [p])),
        ...warnings.map((w) => el("p", { class: "melt-warn" }, [w])),
        el("p", { class: "melt-count" }, [stack.length === 0 ? "" : `${n(options.rowCount)} rows × ${n(stack.length)} stacked column${stack.length === 1 ? "" : "s"} = ${n(rows)} rows${dropEmpty.checked ? " at most (empty cells skipped)" : ""}.`]),
      );
      apply.disabled = problems.length > 0;
      apply.textContent = stack.length === 0 ? "Melt" : `Melt into ${n(rows)} rows`;
      window.clearTimeout(timer);
      if (problems.length > 0) return;
      const mine = ++serial;
      timer = window.setTimeout(() => {
        void options.preview(currentOp()).then((result) => {
          if (mine !== serial || result === null) return;
          apply.textContent = `Melt into ${n(result.rowCount)} rows`;
          const count = notes.querySelector(".melt-count");
          if (count !== null) count.textContent = `Result: ${n(result.rowCount)} rows × ${n(result.columnNames.length)} columns (${result.columnNames.slice(0, 6).join(", ")}${result.columnNames.length > 6 ? ", …" : ""}).`;
        }).catch(() => undefined);
      }, 200);
    }

    let settled = false;
    const finish = (value: MeltOp | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    apply.addEventListener("click", () => {
      if (!apply.disabled) finish(currentOp());
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Melt: wide to long");
    renderList();
    update();
  });
}
