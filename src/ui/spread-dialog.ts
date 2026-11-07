import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import { MAX_SPREAD_COLUMNS, SPREAD_AGGREGATES, type ColumnSchema, type SpreadAggregate, type TransformOp } from "../data/transform-ops.js";

export type SpreadOp = Extract<TransformOp, { kind: "spread" }>;

export interface SpreadDialogOptions {
  /** The columns the spread will see (after any earlier steps). */
  schema: readonly ColumnSchema[];
  /** How many different values each column holds, when known, to guess which column holds the headers. */
  distinct?: readonly number[];
  rowCount: number;
  /** Runs the staged spread, for the number of rows and the names of the columns it makes. */
  preview(op: SpreadOp): Promise<{ rowCount: number; columnNames: string[] } | null>;
}

const AGGREGATE_LABELS: Record<SpreadAggregate, string> = {
  first: "keep the first",
  sum: "add them up",
  mean: "average them",
  min: "take the smallest",
  max: "take the largest",
  count: "count them",
};

/** A first guess: the column of repeated labels (a few distinct values) holds the headers, the last number column the values. */
export function suggestSpread(schema: readonly ColumnSchema[], distinct?: readonly number[]): { key: number; value: number } {
  const count = schema.length;
  let value = -1;
  for (let i = count - 1; i >= 0; i--) {
    if (schema[i].numeric) {
      value = i;
      break;
    }
  }
  if (value < 0) value = count - 1;
  let key = -1;
  // Long tables, and the output of a melt, keep the headers column right beside the values: take it when it repeats.
  const before = value - 1;
  if (before >= 0 && !schema[before].numeric && (distinct === undefined || (distinct[before] >= 2 && distinct[before] <= MAX_SPREAD_COLUMNS))) key = before;
  if (key < 0 && distinct !== undefined && distinct.length === count) {
    let best = Infinity;
    for (let i = 0; i < count; i++) {
      if (i === value || schema[i].numeric) continue;
      const d = distinct[i];
      if (d >= 2 && d <= MAX_SPREAD_COLUMNS && d < best) {
        best = d;
        key = i;
      }
    }
  }
  if (key < 0) key = [...schema.keys()].find((i) => i !== value && !schema[i].numeric) ?? [...schema.keys()].find((i) => i !== value) ?? 0;
  return { key, value };
}

const n = (value: number): string => value.toLocaleString();

/** Spread (long to wide) as a dialog: say which column holds the new headers and which the values, see what it makes, apply. */
export function openSpreadDialog(options: SpreadDialogOptions): Promise<SpreadOp | null> {
  return new Promise((resolve) => {
    const { schema } = options;
    const guess = suggestSpread(schema, options.distinct);
    let keyIndex = guess.key;
    let valueIndex = guess.value;
    const idSet = new Set<number>(schema.map((_, i) => i).filter((i) => i !== keyIndex && i !== valueIndex));
    let resolvedKeys: string[] | null = null;

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal melt-modal" });
    const head = el("div", { class: "modal-head" });
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(el("h2", {}, ["Spread: long to wide"]), closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body melt-body" });
    body.append(
      el("p", { class: "clean-hint" }, [
        "The opposite of Melt. The values of one column become the headers of new columns, filled from another column, so rows that describe the same thing (one id, several measures) come together on a single row.",
      ]),
    );

    const select = (label: string, which: "key" | "value"): HTMLSelectElement => {
      const s = el("select", { class: "text-input", "aria-label": label }) as HTMLSelectElement;
      schema.forEach((c, i) => s.append(el("option", { value: String(i) }, [c.name]) as HTMLOptionElement));
      s.value = String(which === "key" ? keyIndex : valueIndex);
      return s;
    };
    const keySelect = select("Column whose values become the new headers", "key");
    const valueSelect = select("Column that fills the new columns", "value");
    const aggSelect = el("select", { class: "text-input", "aria-label": "When several rows share an id and a header" }) as HTMLSelectElement;
    for (const agg of SPREAD_AGGREGATES) aggSelect.append(el("option", { value: agg }, [AGGREGATE_LABELS[agg]]) as HTMLOptionElement);

    const idList = el("div", { class: "melt-list", role: "group", "aria-label": "Columns that say which row a value belongs to" });
    const renderIds = (): void => {
      idList.replaceChildren();
      schema.forEach((column, i) => {
        const locked = i === keyIndex || i === valueIndex;
        const input = el("input", { type: "checkbox", "aria-label": `${column.name}: part of the row id` }) as HTMLInputElement;
        input.checked = !locked && idSet.has(i);
        input.disabled = locked;
        input.addEventListener("change", () => {
          if (input.checked) idSet.add(i);
          else idSet.delete(i);
          update();
        });
        const role = i === keyIndex ? "becomes the new headers" : i === valueIndex ? "fills the new columns" : "";
        idList.append(el("label", { class: "melt-row spread-row" }, [input, el("span", { class: "melt-name", title: column.name }, [column.name, column.numeric ? " #" : ""]), el("span", { class: "melt-matchnote" }, [role])]));
      });
    };

    const field = (label: string, control: HTMLElement): HTMLElement => el("label", { class: "clean-field" }, [el("span", { class: "clean-label" }, [label]), control]);
    const pickers = el("div", { class: "melt-names" }, [
      field("Values of this column become the new headers", keySelect),
      field("This column fills them", valueSelect),
    ]);
    const aggField = field("If several rows share an id and a header,", aggSelect);

    const diagram = el("div", { class: "melt-diagram", "aria-live": "polite" });
    const notes = el("div", { class: "melt-notes", role: "status", "aria-live": "polite" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const apply = el("button", { class: "primary", type: "button" }, ["Spread"]) as HTMLButtonElement;
    const footer = el("div", { class: "clean-footer" });
    footer.append(cancel, el("span", { class: "grow" }), apply);

    body.append(
      el("span", { class: "clean-label melt-step" }, ["1 · Which column holds the new headers, and which the values?"]),
      pickers,
      el("span", { class: "clean-label melt-step" }, ["2 · Which columns say which row a value belongs to?"]),
      idList,
      el("span", { class: "clean-label melt-step" }, ["3 · If the same id and header turn up more than once"]),
      aggField,
      el("span", { class: "clean-label melt-step" }, ["4 · What it makes"]),
      diagram,
      notes,
    );
    modal.append(body, footer);

    const currentOp = (): SpreadOp => ({
      kind: "spread",
      index: [...idSet].filter((i) => i !== keyIndex && i !== valueIndex).sort((a, b) => a - b),
      key: keyIndex,
      value: valueIndex,
      aggregate: aggSelect.value as SpreadAggregate,
      ...(resolvedKeys !== null ? { keys: resolvedKeys } : {}),
    });

    let timer = 0;
    let serial = 0;
    function update(): void {
      const problems: string[] = [];
      if (keyIndex === valueIndex) problems.push("The headers and the values need two different columns.");
      const ids = [...idSet].filter((i) => i !== keyIndex && i !== valueIndex);
      if (ids.length === 0 && keyIndex !== valueIndex) problems.push("Tick at least one column that says which row a value belongs to.");
      const idNames = ids.map((i) => schema[i].name);
      const valueNumeric = schema[valueIndex]?.numeric === true;
      if (!valueNumeric && ["sum", "mean", "min", "max"].includes(aggSelect.value)) {
        problems.push(`“${schema[valueIndex]?.name}” is not numbers, so it cannot be added, averaged or ranked. Keep the first, or count them.`);
      }
      diagram.replaceChildren(
        el("div", { class: "melt-shape" }, [
          el("div", {}, [el("b", {}, ["Now"]), `  ${[...idNames.slice(0, 3), schema[keyIndex]?.name ?? "", schema[valueIndex]?.name ?? ""].join("  |  ")}`]),
          el("div", {}, [el("b", {}, ["After"]), `  ${[...idNames.slice(0, 3), `one column for each value of ${schema[keyIndex]?.name ?? ""}`].join("  |  ")}`]),
        ]),
      );
      const count = el("p", { class: "melt-count" }, [problems.length === 0 ? `Working out the result from ${n(options.rowCount)} rows…` : ""]);
      notes.replaceChildren(...problems.map((p) => el("p", { class: "melt-problem" }, [p])), count);
      apply.disabled = true;
      window.clearTimeout(timer);
      if (problems.length > 0) return;
      const mine = ++serial;
      timer = window.setTimeout(() => {
        // The preview reads the headers from the data; they are then fixed in the step, so it gives the same result on every replay.
        void options.preview({ ...currentOp(), keys: undefined }).then((result) => {
          if (mine !== serial) return;
          if (result === null) {
            count.textContent = "";
            return;
          }
          const headers = result.columnNames.slice(ids.length);
          resolvedKeys = headers.length > 0 ? recoverKeys(headers, idNames) : null;
          apply.disabled = headers.length === 0;
          apply.textContent = `Spread into ${n(headers.length)} column${headers.length === 1 ? "" : "s"}`;
          const shown = headers.slice(0, 8).join(", ") + (headers.length > 8 ? ", …" : "");
          count.textContent = `Result: ${n(result.rowCount)} rows × ${n(result.columnNames.length)} columns. New columns: ${shown}.`;
          if (headers.length === 0) count.textContent = "The column holds no values to use as headers.";
        }).catch((error: unknown) => {
          if (mine !== serial) return;
          count.className = "melt-problem";
          count.textContent = error instanceof Error ? error.message : String(error);
        });
      }, 250);
    }

    /**
     * The headers as the data gave them, so the step can name its columns without reading the data again. The preview shows them
     * after a clash with an id column or an earlier header was made distinct ("name (2)"); then they are left to be read from the
     * data each time, which gives the same result.
     */
    function recoverKeys(headers: string[], idNames: string[]): string[] | null {
      const names = new Set([...headers, ...idNames]);
      for (const h of headers) {
        const m = /^(.*) \((\d+)\)$/.exec(h);
        if (m !== null && names.has(m[1])) return null;
      }
      return headers.map((h) => (h === "(empty)" ? "" : h));
    }

    keySelect.addEventListener("change", () => {
      keyIndex = Number(keySelect.value);
      idSet.delete(keyIndex);
      renderIds();
      resolvedKeys = null;
      update();
    });
    valueSelect.addEventListener("change", () => {
      valueIndex = Number(valueSelect.value);
      idSet.delete(valueIndex);
      renderIds();
      resolvedKeys = null;
      update();
    });
    aggSelect.addEventListener("change", () => {
      resolvedKeys = null;
      update();
    });

    let settled = false;
    const finish = (value: SpreadOp | null): void => {
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
    setupDialog(overlay, "Spread: long to wide");
    renderIds();
    update();
  });
}
