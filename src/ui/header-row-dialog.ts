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
  /** `preview` holds every row of the source (a worksheet, a small file), so rows can be numbered to the end. */
  complete?: boolean;
  /** The last rows of a source too big to hold whole, as parsed; they have no row numbers. */
  tail?: string[][];
  /** Extra line under the intro, e.g. that one layout applies to several files. */
  note?: string;
}

type EndMode = "auto" | "file" | "blank" | "row";

const MAX_CELLS = 10;
const MAX_CELL_CHARS = 28;
const MAX_NAMES = 14;
/** How much of a whole source is drawn from each end; the rest is a gap you can still reach with the numbers. */
const HEAD_ROWS = 60;
const TAIL_ROWS = 30;

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
 * Import settings: lets the user say where the table sits in the file. Click a
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
    head.append(el("h2", {}, [`Import settings for ${input.name}`]));
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

    // Which columns to read: every column the layout finds is ticked, and an unticked one is left out of the table.
    const columnsBox = el("div", { class: "header-row-columns" });
    const columnsHead = el("div", { class: "header-row-columns-head" });
    const columnsTitle = el("span", { class: "chart-field-label" }, ["Columns to read"]);
    const allCols = el("button", { class: "ghost small", type: "button" }, ["All"]);
    const noCols = el("button", { class: "ghost small", type: "button" }, ["None"]);
    const colFilter = el("input", { class: "text-input", type: "search", placeholder: "Find a column", "aria-label": "Find a column", spellcheck: "false" }) as HTMLInputElement;
    columnsHead.append(columnsTitle, allCols, noCols, colFilter);
    const columnList = el("div", { class: "header-row-column-list", role: "group", "aria-label": "Columns to read" });
    columnsBox.append(columnsHead, columnList);
    body.append(columnsBox);

    const grid = el("div", { class: "header-row-grid", role: "grid", "aria-label": "File preview" });
    const jump = el("div", { class: "header-row-jump" }, [el("span", { class: "chart-field-label" }, ["Look at"])]);
    const toTop = el("button", { class: "ghost small", type: "button" }, ["Top of the file"]);
    const toBottom = el("button", { class: "ghost small", type: "button" }, ["Bottom of the file"]);
    toTop.addEventListener("click", () => { grid.scrollTop = 0; });
    toBottom.addEventListener("click", () => { grid.scrollTop = grid.scrollHeight; });
    jump.append(toTop, toBottom);
    body.append(jump, grid);
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
    const skippedCols = new Set<number>(input.current.skipColumns ?? []);
    let columnKey = "";
    let allHeaders: string[] = [];
    let settled = false;

    const dataEnd = (): DataEnd => (endMode === "row" ? endRow : endMode);
    const layout = (): HeaderLayout => ({
      skipRows: skip,
      headerRows: levels,
      ...(after > 0 ? { skipAfter: after } : {}),
      ...(endMode === "auto" ? {} : { dataEnd: dataEnd() }),
      ...(skippedCols.size > 0 ? { skipColumns: [...skippedCols].sort((a, b) => a - b) } : {}),
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
      // The columns offered are the ones this layout finds before any are left out.
      const found = detectTable(input.preview, { ...layout(), skipColumns: [] }).headers;
      const key = found.join("\u0001");
      if (key !== columnKey) {
        columnKey = key;
        allHeaders = found;
        for (const index of [...skippedCols]) if (index >= found.length) skippedCols.delete(index);
        columnList.replaceChildren();
        found.forEach((name, index) => {
          const box = el("input", { type: "checkbox", "data-column": String(index), "aria-label": name === "" ? `Column ${index + 1}` : name }) as HTMLInputElement;
          box.addEventListener("change", () => {
            if (box.checked) skippedCols.delete(index);
            else skippedCols.add(index);
            render();
          });
          const sample = input.preview.slice(skip + levels + after).map((row) => (row[index] ?? "").trim()).find((cell) => cell !== "");
          columnList.append(
            el("label", { class: "header-row-column", "data-name": (name || `Column ${index + 1}`).toLowerCase() }, [
              box,
              el("span", { class: "header-row-column-name" }, [name === "" ? `(blank ${index + 1})` : name]),
              el("span", { class: "header-row-column-sample" }, [sample === undefined ? "" : clip(sample)]),
            ]),
          );
        });
        columnsBox.classList.toggle("hidden", found.length < 2);
        colFilter.classList.toggle("hidden", found.length <= 12);
      }
      for (const box of columnList.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) box.checked = !skippedCols.has(Number(box.dataset.column));
      columnsTitle.textContent = `Columns to read (${(allHeaders.length - skippedCols.size).toLocaleString()} of ${allHeaders.length.toLocaleString()})`;
      const dataStart = skip + levels + after;
      const dataStop = dataStart + detected.rows.length;
      grid.replaceChildren();
      const total = input.preview.length;
      const whole = input.complete === true;
      const headEnd = whole ? Math.min(total, HEAD_ROWS) : total;
      const tailStart = whole && total > headEnd ? Math.max(headEnd, total - TAIL_ROWS) : total;
      const roleOf = (index: number): string =>
        index < skip
          ? "skipped"
          : index < skip + levels
            ? "header"
            : index < dataStart
              ? "skipped"
              : index < dataStop
                ? "data"
                : "ignored";
      const addRow = (row: string[], index: number | null): void => {
        const role = index === null ? "tail" : roleOf(index);
        const line = el("div", {
          class: `header-row-line header-row-${role}`,
          role: "row",
          ...(index === null ? {} : { tabindex: "0", title: `Use row ${index + 1} as the header` }),
        });
        line.append(el("span", { class: "header-row-num" }, [index === null ? "end" : String(index + 1)]));
        const cells = row.slice(0, MAX_CELLS).map((cell) => clip(cell.trim()));
        line.append(
          el("span", { class: "header-row-cells" }, [
            cells.map((cell) => (cell === "" ? "·" : cell)).join("  |  ") +
              (row.length > MAX_CELLS ? `  | +${row.length - MAX_CELLS} more` : ""),
          ]),
        );
        const blank = row.every((cell) => cell.trim() === "");
        if (index !== null && (role === "skipped" || role === "header" || (role === "ignored" && !blank))) {
          line.append(el("span", { class: "header-row-tag" }, [role]));
        }
        if (index === null) {
          // An unnumbered tail cannot be cut by row, but a row with most cells empty is probably a note.
          const filled = row.filter((cell) => cell.trim() !== "").length;
          if (!blank && filled * 2 < Math.max(2, detected.headers.length)) line.append(el("span", { class: "header-row-tag" }, ["note?"]));
        }
        if (index !== null && role === "data") {
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
        if (index !== null) {
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
        }
        grid.append(line);
      };
      const gap = (text: string): void => {
        grid.append(el("div", { class: "header-row-gap", role: "separator" }, [text]));
      };
      for (let index = 0; index < headEnd; index++) addRow(input.preview[index]!, index);
      if (whole && tailStart > headEnd) {
        gap(`${(tailStart - headEnd).toLocaleString()} rows not shown · the bottom of the file follows`);
        for (let index = tailStart; index < total; index++) addRow(input.preview[index]!, index);
      } else if (!whole && input.tail !== undefined && input.tail.length > 0) {
        gap("the file continues · the last rows follow (they cannot be numbered)");
        for (const row of input.tail) addRow(row, null);
      }
      const shown = detected.headers
        .slice(0, MAX_NAMES)
        .map((name) => (name === "" ? "(blank)" : name));
      const more = detected.headers.length - shown.length;
      const ignored = input.preview.length - dataStop;
      names.textContent =
        detected.headers.length === 0
          ? "No columns found with this layout."
          : `${detected.headers.length} columns: ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}. ` +
            `${detected.rows.length.toLocaleString()} data rows${input.complete === true ? "" : " in this preview"}` +
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
    allCols.addEventListener("click", () => {
      skippedCols.clear();
      render();
    });
    noCols.addEventListener("click", () => {
      allHeaders.forEach((_, index) => skippedCols.add(index));
      render();
    });
    colFilter.addEventListener("input", () => {
      const q = colFilter.value.trim().toLowerCase();
      for (const row of columnList.querySelectorAll<HTMLElement>(".header-row-column")) row.classList.toggle("hidden", q !== "" && !(row.dataset.name ?? "").includes(q));
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
    setupDialog(overlay, "Import settings");
    render();
  });
}
