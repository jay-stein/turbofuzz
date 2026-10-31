/**
 * "Are you sure?" for a cell edited in place: a small box next to the cell (not a page
 * modal) with the old and new value, a warning when the value does not fit the column's
 * type, and "Don't ask again for this session" for people editing many cells.
 */

import { el } from "./dom.js";

export interface CellEditQuestion {
  column: string;
  /** 1-based position in the current order, and the file row. */
  row: number;
  fileRow: number | null;
  from: string;
  to: string;
  /** Set when the new value does not read as the column's type. */
  warning: string | null;
  anchor: DOMRect;
}

const nf = new Intl.NumberFormat("en");
const shown = (v: string): string => (v === "" ? "(empty)" : v.length > 60 ? `${v.slice(0, 60)}…` : v);

export function confirmCellEdit(q: CellEditQuestion): Promise<{ ok: boolean; dontAsk: boolean }> {
  return new Promise((resolve) => {
    const dontAsk = el("input", { type: "checkbox" }) as HTMLInputElement;
    const change = el("button", { class: "primary small", type: "button" }, ["Change"]) as HTMLButtonElement;
    const cancel = el("button", { class: "ghost small", type: "button" }, ["Cancel"]);
    const where = q.fileRow === null ? `row ${nf.format(q.row)}` : `row ${nf.format(q.row)} (file row ${nf.format(q.fileRow)})`;
    const box = el("div", { class: "cell-confirm", role: "alertdialog", "aria-label": "Confirm the change" }, [
      el("p", { class: "cell-confirm-q" }, [
        `Change ${q.column} in ${where} from `,
        el("b", {}, [shown(q.from)]),
        " to ",
        el("b", {}, [shown(q.to)]),
        "?",
      ]),
      ...(q.warning ? [el("p", { class: "cell-confirm-warn" }, [q.warning])] : []),
      el("div", { class: "cell-confirm-acts" }, [
        el("label", { class: "cell-confirm-skip" }, [dontAsk, " Don't ask again for this session"]),
        el("span", { class: "grow" }),
        cancel,
        change,
      ]),
      el("p", { class: "cell-confirm-note" }, ["Recorded in the Recipe; undo it there or with the toast."]),
    ]);
    // Below the cell, or above it when there is no room; kept on screen sideways.
    const top = q.anchor.bottom + 6 + 150 > window.innerHeight ? Math.max(8, q.anchor.top - 156) : q.anchor.bottom + 6;
    box.style.top = `${top}px`;
    box.style.left = `${Math.max(8, Math.min(q.anchor.left, window.innerWidth - 400))}px`;
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      box.remove();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onAway, true);
      resolve({ ok, dontAsk: ok && dontAsk.checked });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.stopPropagation(); finish(false); }
      else if (event.key === "Enter" && document.activeElement !== cancel) { event.preventDefault(); event.stopPropagation(); finish(true); }
    };
    const onAway = (event: MouseEvent): void => { if (!box.contains(event.target as Node)) finish(false); };
    change.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onAway, true);
    document.body.append(box);
    change.focus();
  });
}
