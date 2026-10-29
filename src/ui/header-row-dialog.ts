import { detectTable, type HeaderLayout } from "../parse/header-detect.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export type HeaderRowResult = { kind: "layout"; layout: HeaderLayout } | { kind: "auto" } | null;

export interface HeaderRowInput {
  name: string;
  /** The first rows of the source exactly as parsed, before any header handling. */
  preview: string[][];
  /** The layout in use now (the automatic guess or an earlier override). */
  current: HeaderLayout;
  /** True when `current` is a user override rather than the automatic guess. */
  overridden: boolean;
  /** Extra line under the intro, e.g. that one layout applies to several files. */
  note?: string;
}

const MAX_CELLS = 10;
const MAX_CELL_CHARS = 28;
const MAX_NAMES = 14;

function clip(value: string): string {
  return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS - 1)}…` : value;
}

/**
 * Lets the user say where the header is: click a row, or type how many rows to
 * skip and how many header rows there are. The preview updates live, showing
 * skipped rows dimmed, header rows highlighted and the column names that result.
 */
export function openHeaderRowDialog(input: HeaderRowInput): Promise<HeaderRowResult> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal header-row-modal" });

    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, [`Header row for ${input.name}`]));
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body" });
    body.append(
      el("p", { class: "confirm-body" }, [
        input.overridden
          ? "You chose this layout. Click a row to make it the header, or adjust the numbers."
          : "This is the automatic guess. Click the row that holds your column names, or adjust the numbers.",
      ]),
    );

    if (input.note !== undefined) {
      body.append(el("p", { class: "confirm-body" }, [input.note]));
    }

    const controls = el("div", { class: "header-row-controls" });
    const skipInput = el("input", {
      class: "text-input",
      type: "number",
      min: "0",
      step: "1",
      "aria-label": "Rows to skip",
    }) as HTMLInputElement;
    const skipField = el("label", { class: "chart-setup-field" }, [
      el("span", { class: "chart-field-label" }, ["Rows to skip"]),
      skipInput,
    ]);
    const levelSelect = el("select", {
      class: "chart-select",
      "aria-label": "Header rows",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["0", "None (no header row)"],
      ["1", "1 row"],
      ["2", "2 rows"],
      ["3", "3 rows"],
    ] as const) {
      levelSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    const levelField = el("label", { class: "chart-setup-field" }, [
      el("span", { class: "chart-field-label" }, ["Header rows"]),
      levelSelect,
    ]);
    controls.append(skipField, levelField);
    body.append(controls);

    const grid = el("div", { class: "header-row-grid", role: "grid", "aria-label": "File preview" });
    body.append(grid);
    const names = el("div", { class: "cast-summary", role: "status" });
    body.append(names);
    modal.append(body);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const auto = el("button", { class: "ghost", type: "button" }, ["Use automatic guess"]);
    auto.title = "Go back to the built-in header detection.";
    const apply = el("button", { class: "primary", type: "button" }, ["Apply and reload"]);
    footer.append(cancel, auto, el("span", { class: "grow" }), apply);
    modal.append(footer);

    let skip = input.current.skipRows;
    let levels = input.current.headerRows;
    let settled = false;

    const finish = (value: HeaderRowResult): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };

    const render = (): void => {
      skipInput.value = String(skip);
      levelSelect.value = String(levels);
      grid.replaceChildren();
      input.preview.forEach((row, index) => {
        const role = index < skip ? "skipped" : index < skip + levels ? "header" : "data";
        const line = el("button", {
          class: `header-row-line header-row-${role}`,
          type: "button",
          role: "row",
          title: `Use row ${index + 1} as the header`,
        });
        line.append(el("span", { class: "header-row-num" }, [String(index + 1)]));
        const cells = row.slice(0, MAX_CELLS).map((cell) => clip(cell.trim()));
        line.append(
          el("span", { class: "header-row-cells" }, [
            cells.map((cell) => (cell === "" ? "·" : cell)).join("  |  ") +
              (row.length > MAX_CELLS ? `  | +${row.length - MAX_CELLS} more` : ""),
          ]),
        );
        if (role !== "data") {
          line.append(
            el("span", { class: "header-row-tag" }, [role === "header" ? "header" : "skipped"]),
          );
        }
        line.addEventListener("click", () => {
          skip = index;
          if (levels === 0) levels = 1;
          render();
        });
        grid.append(line);
      });
      const detected = detectTable(input.preview, { skipRows: skip, headerRows: levels });
      const shown = detected.headers
        .slice(0, MAX_NAMES)
        .map((name) => (name === "" ? "(blank)" : name));
      const more = detected.headers.length - shown.length;
      names.textContent =
        detected.headers.length === 0
          ? "No columns found with this layout."
          : `${detected.headers.length} columns: ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`;
      apply.disabled = detected.headers.length === 0;
    };

    skipInput.addEventListener("input", () => {
      const value = Math.floor(Number(skipInput.value));
      skip = Number.isFinite(value) ? Math.max(0, Math.min(value, input.preview.length - 1)) : 0;
      render();
      skipInput.focus();
    });
    levelSelect.addEventListener("change", () => {
      levels = Number(levelSelect.value);
      render();
    });
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    auto.addEventListener("click", () => finish({ kind: "auto" }));
    apply.addEventListener("click", () => {
      if (apply.disabled) return;
      finish({ kind: "layout", layout: { skipRows: skip, headerRows: levels } });
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Choose the header row");
    render();
  });
}
