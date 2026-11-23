import { el } from "./dom.js";
import { setupDialog } from "./dialog.js";

export type DedupeKeepChoice = "first" | "last";

export interface DedupePreviewOptions {
  title: string;
  /** Column headers, in file order. */
  names: readonly string[];
  /** Columns left out of the comparison (the id): shaded so the eye skips them. */
  ignore: readonly number[];
  /** Example groups: row numbers (0-based, file order) and every cell of those rows. */
  groups: readonly { rows: readonly number[]; cells: readonly (readonly string[])[] }[];
  /** Rows the step removes, and how many groups there are in all. */
  removeRows: number;
  totalGroups: number;
  keep: DedupeKeepChoice;
  /** Lists every repeated row in the Table instead. */
  showAll?: () => void;
}

/** More columns than this scroll sideways; past the cap the rest are left out of the preview. */
const MAX_COLUMNS = 40;

const count = (value: number, one: string, many: string): string => `${value.toLocaleString()} ${value === 1 ? one : many}`;

/**
 * The duplicates side by side before anything is removed: each group's rows one after the
 * other, the ignored id column shaded, and which copy stays. Resolves the copy to keep, or
 * null when cancelled (or when the user went to the Table instead).
 */
export function openDedupePreview(options: DedupePreviewOptions): Promise<DedupeKeepChoice | null> {
  return new Promise((resolve) => {
    const ignored = new Set(options.ignore);
    const columns = options.names.map((_, index) => index).slice(0, MAX_COLUMNS);
    // The id first: it is the one column that differs, so the reader sees it before the matching ones.
    columns.sort((a, b) => Number(ignored.has(b)) - Number(ignored.has(a)));
    const idNames = options.ignore.map((column) => `“${options.names[column] ?? "?"}”`).join(", ");

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal dd-modal", "data-qp": "dedupe-preview" });
    const close = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    modal.append(el("div", { class: "modal-head" }, [el("h2", {}, [options.title]), close]));

    const intro =
      options.ignore.length === 0
        ? `Each group below is the same row repeated: every column matches.`
        : `Each group below is one record entered more than once. Every column matches except ${idNames}, shaded below, which is left out of the comparison.`;
    modal.append(el("p", { class: "dd-intro" }, [intro]));

    const keep = el("select", { class: "issue-keep-select", "data-qp": "dedupe-preview-keep", "aria-label": "Which copy to keep" }, [
      el("option", { value: "first" }, ["Keep the first copy"]),
      el("option", { value: "last" }, ["Keep the last copy"]),
    ]) as HTMLSelectElement;
    keep.value = options.keep;
    modal.append(el("div", { class: "dd-keep" }, [keep, el("span", { class: "dd-keep-note" }, ["of each group. The others are removed."])]));

    const table = el("table", { class: "dd-table" });
    const head = el("tr", {}, [el("th", { class: "dd-status-col" }, [""]), el("th", { class: "dd-row-col" }, ["Row"])]);
    for (const column of columns) {
      head.append(el("th", { class: ignored.has(column) ? "dd-ignored" : "", title: ignored.has(column) ? "Ignored: not compared" : "" }, [options.names[column] ?? ""]));
    }
    table.append(el("thead", {}, [head]));
    const body = el("tbody");
    const statuses: { cell: HTMLElement; row: HTMLElement; index: number; size: number }[] = [];
    options.groups.forEach((group, g) => {
      body.append(
        el("tr", { class: "dd-group-head" }, [
          el("td", { colspan: String(columns.length + 2) }, [`Group ${g + 1} · ${count(group.rows.length, "copy", "copies")}`]),
        ]),
      );
      group.rows.forEach((rowNumber, index) => {
        const status = el("td", { class: "dd-status" });
        const tr = el("tr", { class: "dd-row", "data-dd-row": String(rowNumber) }, [status, el("td", { class: "dd-row-col" }, [(rowNumber + 1).toLocaleString()])]);
        const cells = group.cells[index] ?? [];
        for (const column of columns) {
          const value = cells[column] ?? "";
          tr.append(el("td", { class: ignored.has(column) ? "dd-ignored" : "" }, [value === "" ? el("span", { class: "dd-blank" }, ["(empty)"]) : value]));
        }
        statuses.push({ cell: status, row: tr, index, size: group.rows.length });
        body.append(tr);
      });
    });
    table.append(body);
    modal.append(el("div", { class: "dd-scroll" }, [table]));

    const shown = options.groups.length;
    const note = el("p", { class: "dd-note" }, [
      shown < options.totalGroups ? `Showing ${shown.toLocaleString()} of ${count(options.totalGroups, "group", "groups")}. ` : "",
      options.names.length > MAX_COLUMNS ? `First ${MAX_COLUMNS} columns shown. ` : "",
      "Removing is one Recipe step you can undo.",
    ]);
    modal.append(note);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    footer.append(cancel);
    if (options.showAll !== undefined) {
      const all = el("button", { class: "link", type: "button", "data-qp": "dedupe-show-all" }, ["Show them all in the Table"]);
      all.addEventListener("click", () => {
        finish(null);
        options.showAll?.();
      });
      footer.append(all);
    }
    const confirm = el("button", { class: "primary fix-btn", type: "button", "data-qp": "dedupe-confirm" }, [
      `Remove ${count(options.removeRows, "repeat", "repeats")}`,
    ]);
    footer.append(el("span", { class: "grow" }), confirm);
    modal.append(footer);

    const sync = (): void => {
      const last = keep.value === "last";
      for (const entry of statuses) {
        const kept = last ? entry.index === entry.size - 1 : entry.index === 0;
        entry.cell.textContent = kept ? "Keep" : "Remove";
        entry.cell.className = `dd-status ${kept ? "dd-kept" : "dd-removed"}`;
        entry.row.classList.toggle("dd-gone", !kept);
      }
    };
    keep.addEventListener("change", sync);
    sync();

    let settled = false;
    const finish = (value: DedupeKeepChoice | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    close.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    confirm.addEventListener("click", () => finish(keep.value === "last" ? "last" : "first"));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, options.title);
  });
}
