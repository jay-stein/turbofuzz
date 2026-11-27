import type { CleanCaseStyle, CleanOp } from "../data/clean-ops.js";
import { n, plural } from "../data/dq-copy.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

/** A text column the hammer can change; ids are listed but start unticked for a case change. */
export interface HammerColumn {
  column: number;
  name: string;
  id: boolean;
}

export interface HammerChoice {
  op: CleanOp;
  columns: number[];
  cells: number;
}

const CASES: { style: CleanCaseStyle; label: string }[] = [
  { style: "upper", label: "UPPER" },
  { style: "lower", label: "lower" },
  { style: "title", label: "Title Case" },
];

/**
 * The two big hammers' confirm: Trim spaces, or Change case, across every text column at once.
 * Every column is one line with the exact number of cells that change, all ticked (ids not, for
 * a case change), and Apply sits at the top so the whole job is one more click.
 */
export function openTextHammerDialog(input: {
  mode: "trim" | "case";
  columns: readonly HammerColumn[];
  /** Exact cells each column would change with this step, by column. */
  count: (op: CleanOp) => Promise<ReadonlyMap<number, number>>;
}): Promise<HammerChoice | null> {
  return new Promise((resolve) => {
    const trim = input.mode === "trim";
    let style: CleanCaseStyle = "upper";
    const op = (): CleanOp => (trim ? { kind: "trim" } : { kind: "case", style });
    let counts: ReadonlyMap<number, number> | null = null;

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal hammer-modal" });
    const close = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    modal.append(el("div", { class: "modal-head" }, [el("h2", {}, [trim ? "Trim spaces in every text column" : "Change case in every text column"]), close]));
    const body = el("div", { class: "chart-setup-body" });
    body.append(
      el("p", { class: "confirm-body" }, [
        trim
          ? "Removes spaces at the start and end of every value in the ticked columns. Each column becomes its own step in the Recipe, and one Undo takes them all back."
          : "Writes every value in the ticked columns in one case. Then use Standardise for spellings that still differ. ID columns start unticked, since “ab12” and “AB12” may be two different ids.",
      ]),
    );

    const styleButtons = CASES.map(({ style: value, label }) => {
      const button = el("button", { type: "button", "aria-pressed": String(value === style) }, [label]);
      button.addEventListener("click", () => {
        style = value;
        for (const b of styleButtons) b.setAttribute("aria-pressed", String(b === button));
        void recount();
      });
      return button;
    });
    const summary = el("span", { class: "hammer-summary", role: "status" }, ["Counting…"]);
    const apply = el("button", { class: "primary", type: "button" }, ["Apply"]) as HTMLButtonElement;
    body.append(
      el("div", { class: "hammer-top" }, [
        ...(trim ? [] : [el("div", { class: "hammer-cases", role: "group", "aria-label": "Case" }, styleButtons)]),
        summary,
        el("span", { class: "grow" }),
        apply,
      ]),
    );

    const boxes = new Map<number, HTMLInputElement>();
    const cells = new Map<number, HTMLElement>();
    const list = el("ul", { class: "hammer-list" });
    for (const column of input.columns) {
      const box = el("input", { type: "checkbox", "aria-label": column.name }) as HTMLInputElement;
      box.checked = trim || !column.id;
      box.addEventListener("change", () => refresh());
      boxes.set(column.column, box);
      const count = el("span", { class: "hammer-count" }, ["…"]);
      cells.set(column.column, count);
      list.append(
        el("li", {}, [
          el("label", { title: column.name }, [
            box,
            el("span", { class: "hammer-name" }, [column.name]),
            column.id ? el("span", { class: "hammer-tag" }, ["ID"]) : "",
            count,
          ]),
        ]),
      );
    }
    const all = el("button", { type: "button", class: "small" }, ["All"]);
    const none = el("button", { type: "button", class: "small" }, ["None"]);
    all.addEventListener("click", () => {
      for (const box of boxes.values()) if (!box.disabled) box.checked = true;
      refresh();
    });
    none.addEventListener("click", () => {
      for (const box of boxes.values()) box.checked = false;
      refresh();
    });
    body.append(
      el("div", { class: "hammer-bulk" }, [el("span", {}, [`${n(input.columns.length)} text ${plural(input.columns.length, "column", "columns")}`]), el("span", { class: "grow" }), all, none]),
      list,
    );
    modal.append(body);
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    modal.append(el("div", { class: "clean-footer" }, [cancel, el("span", { class: "grow" })]));

    const chosen = (): number[] => input.columns.filter((c) => boxes.get(c.column)?.checked === true && (counts?.get(c.column) ?? 0) > 0).map((c) => c.column);
    const refresh = (): void => {
      if (counts === null) {
        apply.disabled = true;
        return;
      }
      const picked = chosen();
      const total = picked.reduce((sum, column) => sum + (counts?.get(column) ?? 0), 0);
      summary.textContent = picked.length === 0 ? "Nothing to change in the ticked columns." : `${n(picked.length)} ${plural(picked.length, "column", "columns")} · ${n(total)} ${plural(total, "cell", "cells")} change`;
      apply.disabled = picked.length === 0;
      apply.textContent = picked.length === 0 ? "Apply" : `${trim ? "Trim" : "Change"} ${n(picked.length)} ${plural(picked.length, "column", "columns")}`;
    };
    let generation = 0;
    const recount = async (): Promise<void> => {
      const mine = ++generation;
      counts = null;
      summary.textContent = "Counting…";
      refresh();
      const next = await input.count(op()).catch(() => new Map<number, number>());
      if (mine !== generation) return;
      counts = next;
      for (const column of input.columns) {
        const changed = next.get(column.column) ?? 0;
        const label = cells.get(column.column)!;
        label.textContent = changed === 0 ? "no change" : `${n(changed)} ${plural(changed, "cell", "cells")}`;
        label.classList.toggle("hammer-none", changed === 0);
        boxes.get(column.column)!.disabled = changed === 0;
      }
      refresh();
    };

    let settled = false;
    const finish = (value: HammerChoice | null): void => {
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
      if (apply.disabled || counts === null) return;
      const picked = chosen();
      finish({ op: op(), columns: picked, cells: picked.reduce((sum, column) => sum + (counts?.get(column) ?? 0), 0) });
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, trim ? "Trim spaces" : "Change case");
    void recount();
  });
}
