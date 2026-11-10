/**
 * The front page's two ways in: a slider between "Analyse one table" (one
 * drop area, several files stacked into one) and "Compare two tables" (an A
 * and a B drop area side by side, where a workbook's sheets can be picked
 * for A and dragged across to B). It always opens on one table.
 */

import { el, svgIcon } from "./dom.js";
import { isWorkbookName, openWorkbook, sheetAsFile, unreadableReason, SOURCE_FILE_TYPES, type OpenedWorkbook } from "./source-resolver.js";

export type FrontMode = "single" | "compare";

const ICON_TABLE = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>';
const ICON_COMPARE = '<rect x="2" y="5" width="8" height="14" rx="1.5"/><rect x="14" y="5" width="8" height="14" rx="1.5"/><path d="M11 9h2M11 15h2"/>';
const ICON_UPLOAD = '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>';
const ICON_BOOK = '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M9 12l4 5M13 12l-4 5"/>';
const ICON_FILE = '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>';
const ICON_X = '<path d="M6 6l12 12M18 6 6 18"/>';
const ICON_GRIP = '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>';
const ICON_SWAP = '<path d="M7 7h11l-3-3"/><path d="M17 17H6l3 3"/>';
const ICON_ARROW = '<path d="M5 12h14M13 6l6 6-6 6"/>';

/** The drag payload type for a worksheet dragged from A to B. */
const SHEET_DRAG = "application/x-turbofuzz-sheet";

const nf = new Intl.NumberFormat("en");

/** The pill at the top of the front page: Analyse one table | Compare two tables, with a sliding thumb. */
export class FrontSwitch {
  readonly element: HTMLElement;
  private mode: FrontMode = "single";
  private readonly buttons = new Map<FrontMode, HTMLButtonElement>();

  constructor(private readonly onChange: (mode: FrontMode) => void) {
    this.element = el("div", { class: "front-switch", role: "radiogroup", "aria-label": "What do you want to do?" }, [
      el("span", { class: "front-switch-thumb", "aria-hidden": "true" }),
    ]);
    const options: [FrontMode, string, string, string][] = [
      ["single", ICON_TABLE, "Analyse one table", "one file, or several stacked into one"],
      ["compare", ICON_COMPARE, "Compare two tables", "two files, or two sheets of one workbook"],
    ];
    for (const [mode, icon, label, caption] of options) {
      const button = el("button", { class: "front-switch-option", type: "button", role: "radio", "data-mode": mode }, [
        el("span", { class: "front-switch-label" }, [svgIcon(icon, "front-switch-icon"), label]),
        el("span", { class: "front-switch-caption" }, [caption]),
      ]) as HTMLButtonElement;
      button.addEventListener("click", () => this.select(mode));
      this.buttons.set(mode, button);
      this.element.append(button);
    }
    this.element.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const next: FrontMode = this.mode === "single" ? "compare" : "single";
      this.select(next);
      this.buttons.get(next)?.focus();
    });
    this.sync();
  }

  get selected(): FrontMode {
    return this.mode;
  }

  /** Programmatic choice (no callback): the front page opens on one table every time. */
  set(mode: FrontMode): void {
    this.mode = mode;
    this.sync();
  }

  private select(mode: FrontMode): void {
    if (mode === this.mode) return;
    this.set(mode);
    this.onChange(mode);
  }

  private sync(): void {
    this.element.dataset.mode = this.mode;
    for (const [mode, button] of this.buttons) {
      const on = mode === this.mode;
      button.setAttribute("aria-checked", on ? "true" : "false");
      button.tabIndex = on ? 0 : -1;
    }
  }
}

/**
 * What happens when several files are dropped in one-table mode, with a tiny
 * stacked table where the month without a discount column is left empty.
 */
export function buildStackGuide(): HTMLElement {
  const step = (lead: string, rest: string): HTMLElement => el("li", {}, [el("strong", {}, [lead]), ` ${rest}`]);
  const cell = (text: string, cls = ""): HTMLElement => el("td", cls === "" ? {} : { class: cls }, [text]);
  const row = (file: string, region: string, sales: string, discount: string | null): HTMLElement =>
    el("tr", {}, [cell(file, "stack-file"), cell(region), cell(sales, "num"), discount === null ? cell("empty", "num stack-gap") : cell(discount, "num")]);
  const table = el("table", { class: "stack-table" }, [
    el("thead", {}, [el("tr", {}, [el("th", {}, ["_input_filename"]), el("th", {}, ["region"]), el("th", { class: "num" }, ["sales"]), el("th", { class: "num" }, ["discount"])])]),
    el("tbody", {}, [row("sales_jan.csv", "North", "1,240", null), row("sales_feb.csv", "South", "980", null), row("sales_mar.csv", "North", "1,410", "5%")]),
  ]);
  return el("section", { class: "stack-guide", "aria-labelledby": "stack-guide-title" }, [
    el("div", { class: "stack-guide-text" }, [
      el("h2", { id: "stack-guide-title" }, ["Dropping several files?"]),
      el("ol", {}, [
        step("Rows are stacked,", "one file under the next, into one table."),
        step("Columns line up by name.", "Case and extra spaces don’t matter: “Region” meets “region ”."),
        step("A column only some files have is kept;", "the other files’ rows are left empty in it."),
        step("If files share few columns,", "you’re asked first: they may be two tables to compare instead."),
      ]),
      el("p", { class: "stack-guide-note" }, ["Several sheets of one Excel workbook stack the same way: tick them when the workbook opens."]),
    ]),
    el("figure", { class: "stack-guide-figure" }, [
      el("div", { class: "stack-table-wrap" }, [table]),
      el("figcaption", {}, ["A few empty cells are fine: only March has a discount column. ", el("code", {}, ["_input_filename"]), " says where each row came from."]),
    ]),
  ]);
}

/** One side of the comparison as chosen on the front page. */
type Side =
  | { kind: "file"; file: File }
  | { kind: "book"; book: OpenedWorkbook; sheet: string };

export interface FrontCompareCallbacks {
  /** Both sides chosen and Compare pressed: plain files (a worksheet arrives as its own CSV). */
  onCompare(a: File, b: File): void;
  onError(message: string): void;
}

/**
 * The A and B drop areas. A workbook dropped on either side lists its sheets
 * to pick from; a sheet of A's workbook can be dragged onto B (or sent with
 * "Use as B"), so two sheets of one file are compared without saving them apart.
 */
export class FrontCompare {
  readonly element: HTMLElement;
  private a: Side | null = null;
  private b: Side | null = null;
  private busy: "a" | "b" | null = null;
  private dragging: string | null = null;
  private readonly slots: Record<"a" | "b", HTMLElement>;
  private readonly summary: HTMLElement;
  private readonly swapButton: HTMLButtonElement;
  private readonly compareButton: HTMLButtonElement;

  constructor(private readonly callbacks: FrontCompareCallbacks) {
    this.slots = { a: el("div", { class: "fc-slot-body" }), b: el("div", { class: "fc-slot-body" }) };
    const column = (side: "a" | "b", label: string): HTMLElement =>
      el("div", { class: "fc-slot", "data-side": side }, [
        el("span", { class: "fc-slot-head" }, [el("span", { class: `cmp-badge ${side}` }, [side.toUpperCase()]), label]),
        this.slots[side],
      ]);
    this.summary = el("span", { class: "fc-summary" });
    this.swapButton = el("button", { class: "ghost small", type: "button", title: "B becomes A and A becomes B" }, [svgIcon(ICON_SWAP, "fc-icon"), "Swap A and B"]) as HTMLButtonElement;
    this.swapButton.addEventListener("click", () => {
      [this.a, this.b] = [this.b, this.a];
      this.render();
    });
    this.compareButton = el("button", { class: "primary fc-go", type: "button" }, ["Compare"]) as HTMLButtonElement;
    this.compareButton.addEventListener("click", () => void this.go());
    this.element = el("div", { class: "front-compare" }, [
      el("div", { class: "fc-slots" }, [column("a", "Original"), column("b", "New version")]),
      el("div", { class: "fc-footer" }, [this.summary, el("span", { class: "grow" }), this.swapButton, this.compareButton]),
    ]);
    this.render();
  }

  /** Back to two empty drop areas. */
  reset(): void {
    this.a = null;
    this.b = null;
    this.busy = null;
    this.dragging = null;
    this.render();
  }

  private async take(side: "a" | "b", file: File): Promise<void> {
    const reason = unreadableReason(file.name);
    if (reason !== null) {
      this.callbacks.onError(reason);
      return;
    }
    if (!isWorkbookName(file.name)) {
      this[side] = { kind: "file", file };
      this.render();
      return;
    }
    this.busy = side;
    this.render();
    try {
      const book = await openWorkbook(file.name, await file.arrayBuffer());
      // B's workbook starts on a sheet A is not using, so the same file compares two of its own sheets.
      const other = side === "a" ? this.b : this.a;
      const taken = other?.kind === "book" && other.book.name === book.name ? other.sheet : null;
      const sheet = book.sheets.find((s) => s.name !== taken)?.name ?? book.sheets[0]!.name;
      this[side] = { kind: "book", book, sheet };
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error.message : `Could not read ${file.name}.`);
    } finally {
      this.busy = null;
      this.render();
    }
  }

  /** A sheet of A's workbook used as B. */
  private sendToB(sheet: string): void {
    if (this.a?.kind !== "book") return;
    this.b = { kind: "book", book: this.a.book, sheet };
    this.dragging = null;
    this.render();
  }

  private label(side: Side | null): string {
    if (side === null) return "not chosen yet";
    return side.kind === "file" ? side.file.name : `${side.book.name} › ${side.sheet}`;
  }

  private sameSheet(): boolean {
    return this.a?.kind === "book" && this.b?.kind === "book" && this.a.book === this.b.book && this.a.sheet === this.b.sheet;
  }

  private async go(): Promise<void> {
    const { a, b } = this;
    if (a === null || b === null || this.sameSheet()) return;
    this.compareButton.disabled = true;
    try {
      const fileOf = (side: Side): Promise<File> => (side.kind === "file" ? Promise.resolve(side.file) : sheetAsFile(side.book, side.sheet));
      this.callbacks.onCompare(await fileOf(a), await fileOf(b));
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error.message : "Could not read the worksheets.");
    } finally {
      this.render();
    }
  }

  private render(): void {
    for (const side of ["a", "b"] as const) this.slots[side].replaceChildren(this.slotContent(side));
    const ready = this.a !== null && this.b !== null && !this.sameSheet();
    this.summary.replaceChildren(
      el("span", { class: "cmp-badge a" }, ["A"]),
      el("span", { class: this.a === null ? "fc-summary-name empty" : "fc-summary-name" }, [this.label(this.a)]),
      el("span", { class: "fc-vs" }, ["vs"]),
      el("span", { class: "cmp-badge b" }, ["B"]),
      el("span", { class: this.b === null ? "fc-summary-name empty" : "fc-summary-name" }, [this.label(this.b)]),
    );
    this.swapButton.disabled = this.a === null || this.b === null;
    this.compareButton.disabled = !ready;
    this.compareButton.title = ready ? "Compare them and open Spot the difference" : this.sameSheet() ? "A and B are the same worksheet: pick another for one of them" : "Choose A and B first";
  }

  private slotContent(side: "a" | "b"): HTMLElement {
    if (this.busy === side) return el("div", { class: "fc-busy", role: "status" }, [el("span", { class: "load-spinner", "aria-hidden": "true" }), "Reading the workbook…"]);
    const chosen = this[side];
    if (chosen === null) return this.dropArea(side);
    const clear = el("button", { class: "icon-btn fc-clear", type: "button", "aria-label": `Remove ${side.toUpperCase()}`, title: `Remove ${side.toUpperCase()}` }, [svgIcon(ICON_X, "fc-icon")]);
    clear.addEventListener("click", () => {
      this[side] = null;
      this.render();
    });
    if (chosen.kind === "file") {
      return el("div", { class: "fc-card" }, [
        el("div", { class: "fc-card-head" }, [
          svgIcon(ICON_FILE, "fc-file-icon"),
          el("span", { class: "fc-card-title" }, [el("span", { class: "fc-name", title: chosen.file.name }, [chosen.file.name]), el("span", { class: "fc-sub" }, [fileSize(chosen.file.size)])]),
          clear,
        ]),
      ]);
    }
    const other = side === "a" ? this.b : this.a;
    const sameBook = other?.kind === "book" && other.book === chosen.book;
    const head = el("div", { class: "fc-card-head" }, [
      svgIcon(ICON_BOOK, "fc-file-icon book"),
      el("span", { class: "fc-card-title" }, [
        el("span", { class: "fc-name", title: chosen.book.name }, [chosen.book.name]),
        el("span", { class: sameBook && side === "b" ? "fc-sub same" : "fc-sub" }, [
          sameBook && side === "b" ? "same workbook as A" : `${chosen.book.sheets.length} sheet${chosen.book.sheets.length === 1 ? "" : "s"}`,
        ]),
      ]),
      clear,
    ]);
    const list = el("div", { class: "fc-sheets", role: "radiogroup", "aria-label": `Sheet for ${side.toUpperCase()}` });
    for (const sheet of chosen.book.sheets) {
      const selected = sheet.name === chosen.sheet;
      const usedByOther = sameBook && other?.kind === "book" && other.sheet === sheet.name;
      const pick = el("button", { class: "fc-sheet-pick", type: "button", role: "radio", "aria-checked": selected ? "true" : "false" }, [
        el("span", { class: "fc-radio", "aria-hidden": "true" }),
        el("span", { class: "fc-sheet-name", title: sheet.name }, [sheet.name]),
        el("span", { class: "fc-sheet-size" }, [rowsLabel(Math.max(0, sheet.rows - 1))]),
      ]) as HTMLButtonElement;
      pick.disabled = usedByOther;
      pick.addEventListener("click", () => {
        if (chosen.sheet === sheet.name) return;
        chosen.sheet = sheet.name;
        this.render();
      });
      const row = el("div", { class: "fc-sheet", "data-selected": selected ? "true" : "false", "data-other": usedByOther ? "true" : "false" }, []);
      // Only A's spare sheets travel to B, by drag or by the button.
      const canSend = side === "a" && !selected && !usedByOther;
      if (canSend) {
        row.draggable = true;
        row.title = "Drag onto B to compare it with A’s sheet";
        row.append(el("span", { class: "fc-grip", "aria-hidden": "true" }, [svgIcon(ICON_GRIP, "fc-icon")]));
        row.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData(SHEET_DRAG, sheet.name);
          event.dataTransfer?.setData("text/plain", sheet.name);
          if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "copy";
          this.dragging = sheet.name;
          this.element.classList.add("fc-dragging");
        });
        row.addEventListener("dragend", () => {
          this.dragging = null;
          this.element.classList.remove("fc-dragging");
        });
      } else {
        row.append(el("span", { class: "fc-grip", "aria-hidden": "true" }));
      }
      row.append(pick);
      if (canSend) {
        const send = el("button", { class: "ghost small fc-send", type: "button", "aria-label": `Use ${sheet.name} as B` }, ["Use as B", svgIcon(ICON_ARROW, "fc-icon")]);
        send.addEventListener("click", () => this.sendToB(sheet.name));
        row.append(send);
      }
      if (usedByOther) row.append(el("span", { class: `fc-in cmp-badge ${side === "a" ? "b" : "a"}`, title: `${side === "a" ? "B" : "A"} uses this sheet` }, [`in ${side === "a" ? "B" : "A"}`]));
      list.append(row);
    }
    const card = el("div", { class: "fc-card" }, [head, el("span", { class: "fc-sheets-label" }, [`Sheet for ${side.toUpperCase()}`]), list]);
    if (side === "a" && chosen.book.sheets.length > 1) {
      card.append(el("p", { class: "fc-hint" }, [svgIcon(ICON_ARROW, "fc-icon"), "Comparing two sheets of this workbook? Drag one onto B."]));
    }
    return card;
  }

  private dropArea(side: "a" | "b"): HTMLElement {
    // The picker's input is made on click and never joins the page, so the front page keeps a single file input.
    const browse = (): void => {
      const input = el("input", { type: "file", accept: SOURCE_FILE_TYPES }) as HTMLInputElement;
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file !== undefined) void this.take(side, file);
      });
      input.click();
    };
    const fromA = side === "b" && this.a?.kind === "book" && this.a.book.sheets.length > 1;
    const zone = el("button", { class: "dropzone fc-drop", type: "button", "data-side": side }, [
      svgIcon(ICON_UPLOAD, "dropzone-icon"),
      el("span", { class: "dropzone-main fc-drop-main" }, [side === "a" ? "Drop the first table" : "Drop the second table"]),
      el("span", { class: "dropzone-sub fc-drop-sub" }, [fromA ? "or drag a sheet across from A" : "or click to browse"]),
      el("span", { class: "fc-drop-note" }, [side === "a" ? "An Excel workbook? You pick the sheet next." : "CSV, Excel, JSON, Parquet or zipped"]),
    ]);
    zone.addEventListener("click", browse);
    zone.addEventListener("dragover", (event) => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      const sheet = types.includes(SHEET_DRAG);
      if (!sheet && !types.includes("Files")) return;
      if (sheet && side !== "b") return;
      event.preventDefault();
      event.stopPropagation();
      zone.classList.add("dragging");
      if (sheet && this.dragging !== null) zone.querySelector(".fc-drop-main")!.textContent = `Drop to use sheet “${this.dragging}” as B`;
    });
    zone.addEventListener("dragleave", (event) => {
      if (event.relatedTarget !== null && zone.contains(event.relatedTarget as Node)) return;
      zone.classList.remove("dragging");
      zone.querySelector(".fc-drop-main")!.textContent = side === "a" ? "Drop the first table" : "Drop the second table";
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove("dragging");
      const sheet = event.dataTransfer?.getData(SHEET_DRAG) ?? "";
      if (sheet !== "" && side === "b") {
        this.sendToB(sheet);
        return;
      }
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length >= 2) {
        // Two files at once fill both sides: the earlier name (an older date, say) is A.
        const [first, second] = files.sort((x, y) => x.name.localeCompare(y.name));
        void this.take("a", first!).then(() => this.take("b", second!));
        return;
      }
      if (files[0] !== undefined) void this.take(side, files[0]);
    });
    return el("div", { class: "fc-drop-wrap" }, [zone]);
  }
}

function rowsLabel(rows: number): string {
  return `${nf.format(rows)} row${rows === 1 ? "" : "s"}`;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
