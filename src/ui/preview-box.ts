import { el } from "./dom.js";
import type { PreviewSample } from "../worker/protocol.js";

/** How a column is coloured in the preview: where it comes from in the choices above. */
export type PreviewRole = "keep" | "stack" | "key" | "value" | "new";

const ROLE_TITLE: Record<PreviewRole, string> = {
  keep: "kept as it is",
  stack: "stacked into rows",
  key: "its values become the new headers",
  value: "fills the new columns",
  new: "new column",
};

const MAX_COLUMNS = 9;

function table(sample: PreviewSample, roles: ReadonlyMap<string, PreviewRole>): HTMLElement {
  const shown = sample.columns.slice(0, MAX_COLUMNS);
  const hidden = sample.columns.length - shown.length;
  const t = el("table", { class: "pv-table" });
  const head = el("tr", {}, [el("th", { class: "pv-num" }, ["#"])]);
  for (const name of shown) {
    const role = roles.get(name);
    head.append(el("th", { class: role === undefined ? "" : `pv-${role}`, title: role === undefined ? name : `${name}: ${ROLE_TITLE[role]}` }, [name]));
  }
  if (hidden > 0) head.append(el("th", { class: "pv-more" }, [`+${hidden} more`]));
  t.append(el("thead", {}, [head]));
  const body = el("tbody");
  sample.rows.forEach((row, i) => {
    const tr = el("tr", {}, [el("td", { class: "pv-num" }, [String(sample.rowNumbers[i] ?? i + 1)])]);
    for (let c = 0; c < shown.length; c++) {
      const value = row[c] ?? "";
      tr.append(el("td", { class: value === "" ? "pv-empty" : "", title: value }, [value === "" ? "empty" : value]));
    }
    if (hidden > 0) tr.append(el("td", { class: "pv-more" }, ["…"]));
    body.append(tr);
  });
  t.append(body);
  return el("div", { class: "pv-scroll" }, [t]);
}

export interface PreviewState {
  /** The table now (before the staged step) and as the step would leave it. */
  before: PreviewSample | null;
  after: PreviewSample | null;
  /** Colours for the headers of each table, by column name. */
  beforeRoles: ReadonlyMap<string, PreviewRole>;
  afterRoles: ReadonlyMap<string, PreviewRole>;
  /** One line under the heading: what the step makes. */
  summary: string;
  /** Why there is nothing to show, when the choices are not complete. */
  problem?: string;
}

/**
 * A live box that stays at the bottom of a dialog: the table as it is now, and a sample of rows as the choices above would leave
 * it, redrawn whenever a choice changes. `busy()` dims it while the next result is on its way, so it never shows stale rows as if
 * they were current.
 */
export function createPreviewBox(): { element: HTMLElement; show(state: PreviewState): void; busy(): void } {
  const heading = el("div", { class: "pv-head" }, [el("span", { class: "clean-label" }, ["Live preview"]), el("span", { class: "pv-summary", "aria-live": "polite" })]);
  const beforeHost = el("div", { class: "pv-block" });
  const afterHost = el("div", { class: "pv-block" });
  const element = el("div", { class: "pv-box", "aria-label": "Live preview of the result" }, [heading, beforeHost, afterHost]);
  const summary = heading.querySelector(".pv-summary") as HTMLElement;
  const block = (host: HTMLElement, title: string, sample: PreviewSample | null, roles: ReadonlyMap<string, PreviewRole>, note: string): void => {
    host.replaceChildren(el("div", { class: "pv-title" }, [title, el("span", { class: "pv-note" }, [note])]));
    if (sample !== null) host.append(table(sample, roles));
  };
  return {
    element,
    busy(): void {
      element.classList.add("pv-busy");
    },
    show(state: PreviewState): void {
      element.classList.remove("pv-busy");
      summary.textContent = state.problem ?? state.summary;
      summary.classList.toggle("melt-problem", state.problem !== undefined);
      const rowsNote = (s: PreviewSample | null): string => (s === null ? "" : `${s.totalRows.toLocaleString()} rows · ${s.columns.length.toLocaleString()} columns${s.totalRows > s.rows.length ? ` · ${s.rows.length} sample rows spread through it` : ""}`);
      // The table as it is now needs only a few rows; the result gets the room.
      const nowSample = state.before === null ? null : { ...state.before, rows: state.before.rows.slice(0, 3), rowNumbers: state.before.rowNumbers.slice(0, 3) };
      block(beforeHost, "Now", nowSample, state.beforeRoles, state.before === null ? "" : `${state.before.totalRows.toLocaleString()} rows · ${state.before.columns.length.toLocaleString()} columns`);
      if (state.after === null) {
        afterHost.replaceChildren(el("div", { class: "pv-title" }, ["After"]), el("div", { class: "pv-placeholder" }, [state.problem ?? "Choose columns above to see the result."]));
      } else {
        block(afterHost, "After", state.after, state.afterRoles, rowsNote(state.after));
      }
    },
  };
}
