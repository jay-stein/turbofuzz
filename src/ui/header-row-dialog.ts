import { detectTable, type DataEnd, type HeaderLayout } from "../parse/header-detect.js";
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

type EndMode = "auto" | "file" | "blank" | "row";

const MAX_CELLS = 10;
const MAX_CELL_CHARS = 28;
const MAX_NAMES = 14;

function clip(value: string): string {
  return value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS - 1)}…` : value;
}

function numberField(label: string, min: string): { field: HTMLElement; input: HTMLInputElement } {
  const input = el("input", {
    class: "text-input",
    type: "number",
    min,
    step: "1",
    "aria-label": label,
  }) as HTMLInputElement;
  const field = el("label", { class: "chart-setup-field" }, [
    el("span", { class: "chart-field-label" }, [label]),
    input,
  ]);
  return { field, input };
}

/**
 * Fine-tune import: lets the user say where the table sits in the file. Click a
 * row to make it the header, or type how many rows to skip above the header and
 * under it, and where the data ends (the footnotes after it are left out). The
 * preview updates live: skipped and ignored rows dimmed, header rows
 * highlighted, and the column names and row count that result.
 */
export function openHeaderRowDialog(input: HeaderRowInput): Promise<HeaderRowResult> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal header-row-modal" });

    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, [`Fine-tune import for ${input.name}`]));
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body" });
    body.append(
      el("p", { class: "confirm-body" }, [
        input.overridden
          ? "You chose this layout. Click a row to make it the header, or adjust the numbers."
          : "This is the automatic guess. Click the row that holds your column names, or adjust the numbers. Rows above the header, under it and after the data are left out.",
      ]),
    );

    if (input.note !== undefined) {
      body.append(el("p", { class: "confirm-body" }, [input.note]));
    }

    const controls = el("div", { class: "header-row-controls" });
    const skipControl = numberField("Rows to skip", "0");
    const skipInput = skipControl.input;
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
    const afterControl = numberField("Rows to skip under the header", "0");
    const afterInput = afterControl.input;
    const endSelect = el("select", {
      class: "chart-select",
      "aria-label": "Where the data ends",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["auto", "Automatic (drop footnotes)"],
      ["file", "Last row of the file"],
      ["blank", "First blank row (spreadsheets)"],
      ["row", "After row number…"],
    ] as const) {
      endSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    const endField = el("label", { class: "chart-setup-field" }, [
      el("span", { class: "chart-field-label" }, ["Data ends at"]),
      endSelect,
    ]);
    const endRowControl = numberField("Last row to keep", "1");
    const endRowInput = endRowControl.input;
    controls.append(skipControl.field, levelField, afterControl.field, endField, endRowControl.field);
    body.append(controls);

    const grid = el("div", { class: "header-row-grid", role: "grid", "aria-label": "File preview" });
    body.append(grid);
    const names = el("div", { class: "cast-summary", role: "status" });
    body.append(names);
    modal.append(body);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const auto = el("button", { class: "ghost", type: "button" }, ["Use automatic guess"]);
    auto.title = "Go back to the built-in detection.";
    const apply = el("button", { class: "primary", type: "button" }, ["Apply and reload"]);
    footer.append(cancel, auto, el("span", { class: "grow" }), apply);
    modal.append(footer);

    let skip = input.current.skipRows;
    let levels = input.current.headerRows;
    let after = input.current.skipAfter ?? 0;
    const startEnd = input.current.dataEnd ?? "auto";
    let endMode: EndMode = typeof startEnd === "number" ? "row" : startEnd;
    let endRow = typeof startEnd === "number" ? startEnd : input.preview.length;
    let settled = false;

    const dataEnd = (): DataEnd => (endMode === "row" ? endRow : endMode);
    const layout = (): HeaderLayout => ({
      skipRows: skip,
      headerRows: levels,
      ...(after > 0 ? { skipAfter: after } : {}),
      ...(endMode === "auto" ? {} : { dataEnd: dataEnd() }),
    });

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
      afterInput.value = String(after);
      endSelect.value = endMode;
      endRowInput.value = String(endRow);
      endRowControl.field.classList.toggle("hidden", endMode !== "row");
      const detected = detectTable(input.preview, layout());
      const dataStart = skip + levels + after;
      const dataStop = dataStart + detected.rows.length;
      grid.replaceChildren();
      input.preview.forEach((row, index) => {
        const role =
          index < skip
            ? "skipped"
            : index < skip + levels
              ? "header"
              : index < dataStart
                ? "skipped"
                : index < dataStop
                  ? "data"
                  : "ignored";
        const line = el("div", {
          class: `header-row-line header-row-${role}`,
          role: "row",
          tabindex: "0",
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
        const blank = row.every((cell) => cell.trim() === "");
        if (role === "skipped" || role === "header" || (role === "ignored" && !blank)) {
          line.append(el("span", { class: "header-row-tag" }, [role]));
        }
        if (role === "data") {
          const endHere = el(
            "button",
            {
              class: "ghost small header-row-end",
              type: "button",
              title: `Keep data up to row ${index + 1} and leave out the rest`,
            },
            ["End here"],
          );
          endHere.addEventListener("click", (event) => {
            event.stopPropagation();
            endMode = "row";
            endRow = index + 1;
            render();
          });
          line.append(endHere);
        }
        const pick = (): void => {
          skip = index;
          if (levels === 0) levels = 1;
          render();
        };
        line.addEventListener("click", pick);
        line.addEventListener("keydown", (event) => {
          if (event.target === line && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            pick();
          }
        });
        grid.append(line);
      });
      const shown = detected.headers
        .slice(0, MAX_NAMES)
        .map((name) => (name === "" ? "(blank)" : name));
      const more = detected.headers.length - shown.length;
      const ignored = input.preview.length - dataStop;
      names.textContent =
        detected.headers.length === 0
          ? "No columns found with this layout."
          : `${detected.headers.length} columns: ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}. ` +
            `${detected.rows.length.toLocaleString()} data rows in this preview` +
            (ignored > 0 ? `, ${ignored.toLocaleString()} after them left out.` : ".");
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
    afterInput.addEventListener("input", () => {
      const value = Math.floor(Number(afterInput.value));
      after = Number.isFinite(value) ? Math.max(0, Math.min(value, input.preview.length)) : 0;
      render();
      afterInput.focus();
    });
    endSelect.addEventListener("change", () => {
      endMode = endSelect.value as EndMode;
      render();
    });
    endRowInput.addEventListener("input", () => {
      const value = Math.floor(Number(endRowInput.value));
      endRow = Number.isFinite(value) ? Math.max(1, value) : 1;
      render();
      endRowInput.focus();
    });
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    auto.addEventListener("click", () => finish({ kind: "auto" }));
    apply.addEventListener("click", () => {
      if (apply.disabled) return;
      finish({ kind: "layout", layout: layout() });
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Fine-tune import");
    render();
  });
}
