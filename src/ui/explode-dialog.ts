import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import { createPreviewBox, type PreviewRole } from "./preview-box.js";
import type { PreviewSample } from "../worker/protocol.js";
import type { ColumnSchema, TransformOp } from "../data/transform-ops.js";

export type ExplodeOp = Extract<TransformOp, { kind: "explodeColumn" }>;

export interface ExplodeDialogOptions {
  /** The columns the explode will see (after any earlier steps). */
  schema: readonly ColumnSchema[];
  /** The column to start on, e.g. the one that was right-clicked. */
  column?: number;
  rowCount: number;
  /** Runs the staged explode, for the number of rows it makes and a sample of them. */
  preview(op: ExplodeOp): Promise<{ rowCount: number; columnNames: string[]; before?: PreviewSample; after?: PreviewSample } | null>;
}

const PRESETS: { label: string; value: string }[] = [
  { label: "; semicolon", value: ";" },
  { label: ", comma", value: "," },
  { label: "| pipe", value: "|" },
  { label: "/ slash", value: "/" },
  { label: "space", value: " " },
];

const n = (value: number): string => value.toLocaleString();

/** Explode (pandas explode) as a dialog: pick the column and the delimiter, see one row per value, apply. */
export function openExplodeDialog(options: ExplodeDialogOptions): Promise<ExplodeOp | null> {
  return new Promise((resolve) => {
    const { schema } = options;
    const first =
      options.column !== undefined && options.column >= 0 && options.column < schema.length
        ? options.column
        : Math.max(0, schema.findIndex((c) => !c.numeric));

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal melt-modal" });
    const head = el("div", { class: "modal-head" });
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(el("h2", {}, ["Explode · one row per value"]), closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body melt-body" });
    body.append(
      el("p", { class: "clean-hint" }, [
        "Explode is for a cell that holds several values, like “soccer;tennis;golf”. Each value gets its own row and the other columns are repeated beside it. Other tools call this pandas explode, unnest or separate_rows. To spread the values across columns instead, use Split column.",
      ]),
    );

    const field = (label: string, control: HTMLElement): HTMLElement =>
      el("label", { class: "clean-field" }, [el("span", { class: "clean-label" }, [label]), control]);
    const columnSelect = el("select", { class: "text-input", "aria-label": "Column to explode" }) as HTMLSelectElement;
    schema.forEach((c, i) => columnSelect.append(el("option", { value: String(i) }, [c.name]) as HTMLOptionElement));
    columnSelect.value = String(first);
    const delimiter = el("input", {
      class: "text-input",
      type: "text",
      value: ";",
      "aria-label": "Delimiter between the values",
      spellcheck: "false",
    }) as HTMLInputElement;
    const presets = el("div", { class: "melt-actions", role: "group", "aria-label": "Common delimiters" });
    for (const preset of PRESETS) {
      const button = el("button", { class: "ghost small", type: "button" }, [preset.label]);
      button.addEventListener("click", () => {
        delimiter.value = preset.value;
        update();
      });
      presets.append(button);
    }
    const regex = el("input", { type: "checkbox", "aria-label": "The delimiter is a regular expression" }) as HTMLInputElement;
    const trim = el("input", { type: "checkbox", "aria-label": "Trim spaces around each value" }) as HTMLInputElement;
    trim.checked = true;
    const dropEmpty = el("input", { type: "checkbox", "aria-label": "Skip empty values" }) as HTMLInputElement;
    dropEmpty.checked = true;
    const check = (box: HTMLInputElement, text: string): HTMLElement =>
      el("label", { class: "melt-row spread-row" }, [box, el("span", { class: "melt-name" }, [text])]);

    const preview = createPreviewBox();
    const notes = el("div", { class: "melt-notes", role: "status", "aria-live": "polite" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const apply = el("button", { class: "primary", type: "button" }, ["Explode"]) as HTMLButtonElement;
    const footer = el("div", { class: "clean-footer" });
    footer.append(cancel, el("span", { class: "grow" }), apply);

    body.append(
      el("span", { class: "clean-label melt-step" }, ["1 · Which column holds several values?"]),
      field("Column", columnSelect),
      el("span", { class: "clean-label melt-step" }, ["2 · What separates them?"]),
      field("Delimiter", delimiter),
      presets,
      check(regex, "The delimiter is a regular expression"),
      el("span", { class: "clean-label melt-step" }, ["3 · Tidy the pieces"]),
      check(trim, "Trim spaces around each value"),
      check(dropEmpty, "Skip empty values (a doubled or trailing delimiter)"),
      notes,
    );
    modal.append(body, preview.element, footer);

    const currentOp = (): ExplodeOp => ({
      kind: "explodeColumn",
      column: Number(columnSelect.value),
      pattern: delimiter.value,
      regex: regex.checked,
      trim: trim.checked,
      dropEmpty: dropEmpty.checked,
    });

    let timer = 0;
    let serial = 0;
    function update(): void {
      const op = currentOp();
      const name = schema[op.column]?.name ?? "";
      const roles = new Map<string, PreviewRole>([[name, "stack"]]);
      window.clearTimeout(timer);
      apply.disabled = true;
      if (op.pattern === "") {
        const problem = "Type the text that separates the values.";
        notes.replaceChildren(el("p", { class: "melt-problem" }, [problem]));
        preview.show({ before: null, after: null, beforeRoles: roles, afterRoles: new Map(), summary: "", problem });
        return;
      }
      const count = el("p", { class: "melt-count" }, [`Working out the result from ${n(options.rowCount)} rows…`]);
      notes.replaceChildren(count);
      preview.busy();
      const mine = ++serial;
      timer = window.setTimeout(() => {
        void options
          .preview(op)
          .then((result) => {
            if (mine !== serial) return;
            if (result === null) {
              count.textContent = "";
              return;
            }
            const added = result.rowCount - options.rowCount;
            apply.disabled = false;
            count.textContent = added === 0 ? "No cell holds more than one value with this delimiter, so nothing would change." : "";
            apply.textContent = added === 0 ? "Explode" : `Explode into ${n(result.rowCount)} rows`;
            preview.show({
              before: result.before ?? null,
              after: result.after ?? null,
              beforeRoles: roles,
              afterRoles: roles,
              summary: `${n(options.rowCount)} rows → ${n(result.rowCount)} rows (${added >= 0 ? "+" : ""}${n(added)})`,
            });
          })
          .catch((error: unknown) => {
            if (mine !== serial) return;
            const message = error instanceof Error ? error.message : String(error);
            count.className = "melt-problem";
            count.textContent = message;
            preview.show({ before: null, after: null, beforeRoles: roles, afterRoles: new Map(), summary: "", problem: message });
          });
      }, 250);
    }

    for (const control of [columnSelect, regex, trim, dropEmpty]) control.addEventListener("change", update);
    delimiter.addEventListener("input", update);

    let settled = false;
    const finish = (value: ExplodeOp | null): void => {
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
    setupDialog(overlay, "Explode: one row per value");
    update();
  });
}
