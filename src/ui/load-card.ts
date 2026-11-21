/**
 * The first-load card: while a file loads onto the front page it shows the
 * stages, the rows read so far, the column names and each column's type as
 * it is worked out, and the first rows. Everything on it is a report from the
 * worker; nothing is estimated or animated ahead of the real work.
 *
 * It never slows a load down. It appears only when a load is still running
 * after SHOW_AFTER_MS, so a quick load goes straight to the table, and it goes
 * the instant the load ends. Redraws are batched to one per animation frame.
 */

import { el } from "./dom.js";
import { formatElapsed } from "./load-indicator.js";
import { TYPE_FAMILY } from "./type-glyphs.js";
import { TYPE_LABELS, type ColumnType } from "../types.js";
import type { ProgressMessage } from "../worker/protocol.js";

/** A load quicker than this never shows the card. */
export const SHOW_AFTER_MS = 400;
const MAX_COLUMNS = 24;
const PEEK_ROWS = 4;
const PEEK_COLUMNS = 6;

const STAGES = ["Read the file", "Read the rows", "Split into columns", "Type the columns", "Profile"] as const;

/** Which stage a progress report belongs to; null for reports that are not about the load's stages. */
export function stageOf(progress: Pick<ProgressMessage, "phase" | "detail" | "types">): number | null {
  switch (progress.phase) {
    case "read":
      return 0;
    case "parse":
      return 1;
    case "infer":
      return 2;
    case "build":
      return progress.types !== undefined ? 3 : 2;
    case "stats":
      return 4;
    default:
      return null;
  }
}

interface CardState {
  name: string;
  bytes: number | null;
  stage: number;
  /** Share of the current stage done, when the worker says. */
  share: number | null;
  rows: number | null;
  headers: string[] | null;
  types: ColumnType[];
  peekHeaders: string[] | null;
  peekRows: string[][];
}

const fresh = (name: string, bytes: number | null): CardState => ({
  name, bytes, stage: 0, share: null, rows: null, headers: null, types: [], peekHeaders: null, peekRows: [],
});

const nf = new Intl.NumberFormat("en");

function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export class LoadCard {
  readonly element: HTMLElement;
  private state: CardState = fresh("", null);
  private startedAt = 0;
  private active = false;
  private showTimer = 0;
  private tick = 0;
  private frame = 0;
  private readonly title = el("h2", { class: "lc-title", id: "load-card-title" });
  private readonly sub = el("span", { class: "lc-sub" });
  private readonly stages = el("ol", { class: "lc-stages" });
  private readonly rowCount = el("span", { class: "lc-rows" });
  private readonly rowNote = el("span", { class: "lc-rows-note" });
  private readonly columnsTitle = el("h3", { class: "lc-label" });
  private readonly columns = el("div", { class: "lc-columns" });
  private readonly peek = el("div", { class: "lc-peek" });
  private readonly peekBlock: HTMLElement;

  constructor(onCancel: () => void) {
    const cancel = el("button", { class: "ghost lc-cancel", type: "button" }, ["Cancel"]);
    cancel.addEventListener("click", onCancel);
    this.peekBlock = el("div", { class: "lc-peek-block" }, [el("h3", { class: "lc-label" }, ["First rows"]), this.peek]);
    const card = el("section", { class: "lc-card", role: "status", "aria-live": "polite", "aria-labelledby": "load-card-title" }, [
      el("div", { class: "lc-head" }, [el("span", { class: "lc-head-text" }, [this.title, this.sub]), cancel]),
      this.stages,
      el("div", { class: "lc-body" }, [
        el("div", { class: "lc-count" }, [this.rowCount, this.rowNote]),
        el("div", { class: "lc-columns-block" }, [this.columnsTitle, this.columns]),
      ]),
      this.peekBlock,
    ]);
    this.element = el("div", { class: "lc-backdrop hidden" }, [card]);
  }

  /** A load began: the card shows only if it is still running after SHOW_AFTER_MS. */
  start(name: string, bytes: number | null): void {
    const peek = this.state.peekHeaders === null ? null : { headers: this.state.peekHeaders, rows: this.state.peekRows };
    this.state = fresh(name, bytes);
    if (peek !== null) this.setPeek(peek.headers, peek.rows);
    this.startedAt = performance.now();
    this.active = true;
    window.clearTimeout(this.showTimer);
    this.showTimer = window.setTimeout(() => {
      if (!this.active) return;
      this.render();
      this.element.classList.remove("hidden");
      document.documentElement.classList.add("load-card-on");
      // The elapsed time is the one thing that moves without a report: once a second is plenty.
      this.tick = window.setInterval(() => this.schedule(), 1000);
    }, SHOW_AFTER_MS);
  }

  /** The automatic read of the first rows (from the header check), shown while the rest loads. */
  setPeek(headers: string[], rows: string[][]): void {
    this.state.peekHeaders = headers;
    this.state.peekRows = rows.slice(0, PEEK_ROWS);
    if (this.active) this.schedule();
  }

  update(progress: ProgressMessage): void {
    if (!this.active) return;
    const stage = stageOf(progress);
    if (stage === null) return;
    const s = this.state;
    if (stage >= s.stage) {
      s.share = progress.current !== undefined && progress.total !== undefined && progress.total > 0 ? Math.min(1, progress.current / progress.total) : null;
      s.stage = stage;
    }
    if (progress.rows !== undefined) s.rows = progress.rows;
    if (progress.phase === "build" && progress.types === undefined && progress.total !== undefined) s.rows = progress.total;
    if (progress.headers !== undefined) s.headers = progress.headers;
    if (progress.types !== undefined) s.types = progress.types;
    this.schedule();
  }

  /** The load ended (loaded, failed or cancelled): gone at once. */
  stop(): void {
    this.active = false;
    window.clearTimeout(this.showTimer);
    window.clearInterval(this.tick);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.element.classList.add("hidden");
    document.documentElement.classList.remove("load-card-on");
    this.state = fresh("", null);
  }

  private schedule(): void {
    if (this.frame !== 0 || this.element.classList.contains("hidden")) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const s = this.state;
    this.title.textContent = `Reading ${s.name}`;
    this.sub.textContent = [s.bytes === null ? null : sizeText(s.bytes), STAGES[s.stage].toLowerCase(), formatElapsed(performance.now() - this.startedAt)].filter((part) => part !== null).join(" · ");

    this.stages.replaceChildren(...STAGES.map((name, index) => {
      const fill = el("span", { class: "lc-stage-fill" });
      const share = index < s.stage ? 1 : index > s.stage ? 0 : s.share;
      if (share === null) fill.classList.add("indeterminate");
      else fill.style.width = `${Math.round(share * 100)}%`;
      const item = el("li", { class: index < s.stage ? "done" : index === s.stage ? "current" : "" }, [el("span", { class: "lc-stage-track" }, [fill]), el("span", { class: "lc-stage-name" }, [name])]);
      if (index === s.stage) item.setAttribute("aria-current", "step");
      return item;
    }));

    this.rowCount.textContent = s.rows === null ? "…" : nf.format(s.rows);
    this.rowNote.textContent = s.rows === null ? "rows, counting as they are read" : s.stage <= 1 ? "rows read so far" : "rows; now working out the columns";

    const headers = s.headers ?? [];
    this.columnsTitle.textContent = headers.length === 0 ? "Columns" : `${nf.format(headers.length)} columns · ${nf.format(Math.min(s.types.length, headers.length))} typed`;
    const shown = headers.slice(0, MAX_COLUMNS).map((name, index) => {
      const type = s.types[index];
      const chip = type === undefined
        ? el("span", { class: "lc-type pending" }, [s.stage >= 3 ? "typing…" : "waiting"])
        : el("span", { class: "lc-type" }, [TYPE_LABELS[type]]);
      return el("span", { class: `lc-col${type === undefined ? "" : ` typed fam-${TYPE_FAMILY[type]}`}` }, [el("span", { class: "lc-col-name", title: name }, [name === "" ? "(no name)" : name]), chip]);
    });
    if (headers.length > MAX_COLUMNS) shown.push(el("span", { class: "lc-col more" }, [`+${nf.format(headers.length - MAX_COLUMNS)} more`]));
    this.columns.replaceChildren(...shown);
    this.columns.classList.toggle("empty", headers.length === 0);

    this.peekBlock.classList.toggle("hidden", s.peekHeaders === null || s.peekRows.length === 0);
    if (s.peekHeaders !== null) {
      const width = Math.min(PEEK_COLUMNS, s.peekHeaders.length);
      const row = (cells: string[], head: boolean): HTMLElement => el("div", { class: head ? "lc-peek-row head" : "lc-peek-row" }, cells.slice(0, width).map((cell, index) => {
        const type = head ? undefined : s.types[index];
        return el("span", { class: type === undefined ? "lc-peek-cell" : `lc-peek-cell fam-${TYPE_FAMILY[type]}`, title: cell }, [cell]);
      }));
      this.peek.style.setProperty("--lc-peek-cols", String(width));
      this.peek.replaceChildren(row(s.peekHeaders, true), ...s.peekRows.map((cells) => row(cells, false)));
    }
  }
}
