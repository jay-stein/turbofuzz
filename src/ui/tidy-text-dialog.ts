import type { CleanOp } from "../data/clean-ops.js";
import { n, plural } from "../data/dq-copy.js";
import { tidyOps, type TidyColumn, type TidyGroup } from "../data/tidy-text.js";
import { showSpaces } from "../data/variants.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

/** One column's tidy, as chosen in the preview: its clean steps and the rows they change. */
export interface TidyChoice {
  column: number;
  name: string;
  ops: CleanOp[];
  rows: number;
}

/** Changes drawn per click of "Show more": every change is reachable, none is cut. */
const CHUNK = 200;

/**
 * The preview for Tidy text: every change in every column, all ticked, so the
 * default tidies the lot. Untick a column, or one change in it ("US" is a real word
 * here), and it is left as it is. Spaces show as ␣ so a trim can be seen. Resolves
 * with the steps for each column that still has something ticked, or null.
 */
export function openTidyTextDialog(columns: readonly TidyColumn[]): Promise<TidyChoice[] | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal tidy-modal" });
    const close = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    modal.append(el("div", { class: "modal-head" }, [el("h2", {}, ["Tidy text in every column"]), close]));

    const body = el("div", { class: "chart-setup-body" });
    body.append(
      el("p", { class: "confirm-body" }, [
        "Trims spaces at the ends of values, closes up doubled spaces, and makes capitals match the form each column uses most. Nothing else changes, and ID columns are left alone. Untick anything that should stay as it is.",
      ]),
    );

    // Unticked groups, per column.
    const off = new Map<number, Set<TidyGroup>>(columns.map((column) => [column.column, new Set()]));
    const ticked = (column: TidyColumn, group: TidyGroup): boolean => off.get(column.column)?.has(group) !== true;
    const summary = el("div", { class: "cast-summary", role: "status" });
    const apply = el("button", { class: "primary", type: "button" }, ["Apply"]) as HTMLButtonElement;
    const refresh = (): void => {
      let cols = 0;
      let rows = 0;
      for (const column of columns) {
        const on = column.groups.filter((group) => ticked(column, group));
        if (on.length === 0) continue;
        cols++;
        rows += on.reduce((sum, group) => sum + group.rows, 0);
      }
      summary.textContent = cols === 0 ? "Nothing ticked." : `${n(cols)} ${plural(cols, "column", "columns")} · ${n(rows)} ${plural(rows, "cell", "cells")} change`;
      apply.disabled = cols === 0;
      apply.textContent = cols === 0 ? "Apply" : `Tidy ${n(cols)} ${plural(cols, "column", "columns")}`;
    };

    if (columns.length === 0) {
      body.append(el("p", { class: "tidy-none" }, ["Every text column is already tidy: no stray spaces, and capitals are consistent."]));
    }
    for (const column of columns) {
      const columnBox = el("input", { type: "checkbox", "aria-label": `Tidy ${column.name}` }) as HTMLInputElement;
      columnBox.checked = true;
      const count = el("span", { class: "tidy-col-count" });
      const list = el("ul", { class: "tidy-list" });
      const boxes: HTMLInputElement[] = [];
      const syncColumn = (): void => {
        const unticked = off.get(column.column)!.size;
        columnBox.checked = unticked < column.groups.length;
        columnBox.indeterminate = unticked > 0 && unticked < column.groups.length;
        count.textContent = `${n(column.groups.length - unticked)} of ${n(column.groups.length)} ${plural(column.groups.length, "change", "changes")} · ${n(column.rows)} ${plural(column.rows, "row", "rows")}`;
        refresh();
      };
      let shown = 0;
      const more = el("button", { class: "ghost small tidy-more", type: "button" });
      const drawMore = (): void => {
        const end = Math.min(column.groups.length, shown + CHUNK);
        for (const group of column.groups.slice(shown, end)) {
          const box = el("input", { type: "checkbox", "aria-label": `Change to ${group.to}` }) as HTMLInputElement;
          box.checked = ticked(column, group);
          boxes.push(box);
          box.addEventListener("change", () => {
            if (box.checked) off.get(column.column)!.delete(group);
            else off.get(column.column)!.add(group);
            syncColumn();
          });
          list.append(
            el("li", { class: `tidy-item tidy-${group.kind}` }, [
              el("label", {}, [
                box,
                el("span", { class: "tidy-from" }, group.from.map((entry) => el("code", { title: `${n(entry.count)} ${plural(entry.count, "row", "rows")}` }, [showSpaces(entry.value)]))),
                el("span", { class: "tidy-arrow", "aria-hidden": "true" }, ["→"]),
                el("code", { class: "tidy-to" }, [group.to]),
                el("span", { class: "tidy-kind" }, [group.kind === "spaces" ? "spaces" : "capitals"]),
                el("span", { class: "tidy-rows" }, [n(group.rows)]),
              ]),
            ]),
          );
        }
        shown = end;
        const left = column.groups.length - shown;
        more.textContent = `Show ${n(Math.min(left, CHUNK))} more (${n(left)} not shown yet)`;
        more.hidden = left === 0;
      };
      more.addEventListener("click", drawMore);
      columnBox.addEventListener("change", () => {
        const set = off.get(column.column)!;
        set.clear();
        if (!columnBox.checked) for (const group of column.groups) set.add(group);
        for (const box of boxes) box.checked = columnBox.checked;
        syncColumn();
      });
      drawMore();
      syncColumn();
      body.append(
        el("section", { class: "tidy-col" }, [
          el("label", { class: "tidy-col-head" }, [columnBox, el("strong", {}, [column.name]), count]),
          list,
          more,
        ]),
      );
    }
    body.append(summary);
    modal.append(body);

    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    modal.append(el("div", { class: "clean-footer" }, [cancel, el("span", { class: "grow" }), apply]));

    let settled = false;
    const finish = (value: TidyChoice[] | null): void => {
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
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    apply.addEventListener("click", () => {
      if (apply.disabled) return;
      const choices: TidyChoice[] = [];
      for (const column of columns) {
        const ops = tidyOps(column.groups, (group) => ticked(column, group));
        if (ops.length === 0) continue;
        const rows = column.groups.filter((group) => ticked(column, group)).reduce((sum, group) => sum + group.rows, 0);
        choices.push({ column: column.column, name: column.name, ops, rows });
      }
      finish(choices);
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Tidy text");
    refresh();
  });
}
