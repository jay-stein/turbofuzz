import { SHEET_COLUMN } from "../parse/combine-sheets.js";
import { el } from "./dom.js";

export interface SheetChoice {
  name: string;
  /** Rows as the workbook listing counts them (a header row included), and columns. */
  rows: number;
  columns: number;
}

export type SheetPlan =
  | { action: "none"; note: string }
  | { action: "one"; sheet: string; button: string }
  | { action: "combine"; sheets: string[]; button: string; note: string }
  | { action: "blocked"; note: string };

const nf = new Intl.NumberFormat("en");

/**
 * What the button does for the ticked sheets: nothing yet, load the one, or
 * stack them. Sheets can only be stacked when they have the same number of
 * columns; when one stands out (a contents page, say) the note names it so
 * it can be unticked. Column names are checked when combining.
 */
export function planSheets(sheets: readonly SheetChoice[], ticked: ReadonlySet<string>, hasHeaders: boolean): SheetPlan {
  const chosen = sheets.filter((sheet) => ticked.has(sheet.name));
  if (chosen.length === 0) return { action: "none", note: "Tick the worksheets to load." };
  if (chosen.length === 1) return { action: "one", sheet: chosen[0]!.name, button: `Load “${chosen[0]!.name}”` };
  // The most common width among the ticked sheets (ties: the one with more rows) is the table's; the rest stand out.
  const byWidth = new Map<number, { count: number; rows: number }>();
  for (const sheet of chosen) {
    const entry = byWidth.get(sheet.columns) ?? { count: 0, rows: 0 };
    entry.count++;
    entry.rows += sheet.rows;
    byWidth.set(sheet.columns, entry);
  }
  const [width] = [...byWidth.entries()].sort((x, y) => y[1].count - x[1].count || y[1].rows - x[1].rows)[0]!;
  const odd = chosen.filter((sheet) => sheet.columns !== width);
  if (odd.length > 0) {
    const names = odd.slice(0, 3).map((sheet) => `“${sheet.name}”`).join(", ") + (odd.length > 3 ? ` and ${odd.length - 3} more` : "");
    const columns = (n: number): string => `${n} column${n === 1 ? "" : "s"}`;
    return {
      action: "blocked",
      note: odd.length === 1
        ? `${names} has ${columns(odd[0]!.columns)} and the others have ${width}: untick it to combine the rest.`
        : `${names} have different columns from the others (${width}): untick them to combine the rest.`,
    };
  }
  const rows = chosen.reduce((sum, sheet) => sum + sheet.rows, 0) - (hasHeaders ? chosen.length : 0);
  return {
    action: "combine",
    sheets: chosen.map((sheet) => sheet.name),
    button: `Combine ${chosen.length} worksheets`,
    note: `About ${nf.format(rows)} rows × ${width} columns, stacked in the order listed.`,
  };
}

export interface SheetPickerActions {
  loadOne(sheet: string): void;
  combine(sheets: string[], sheetColumn: boolean): void;
}

/**
 * The workbook's worksheets as a ticked list: All and None to start over,
 * one button that says what it will do, and the sheet-name column offered
 * when more than one sheet is ticked.
 */
export function renderSheetPicker(host: HTMLElement, sheets: readonly SheetChoice[], hasHeaders: boolean, actions: SheetPickerActions): void {
  const ticked = new Set(sheets.map((sheet) => sheet.name));
  let sheetColumn = true;
  const boxes = new Map<string, HTMLInputElement>();
  const list = el("div", { class: "sheet-list", role: "group", "aria-label": "Worksheets" });
  for (const sheet of sheets) {
    const box = el("input", { type: "checkbox", "aria-label": sheet.name }) as HTMLInputElement;
    box.checked = true;
    box.addEventListener("change", () => {
      if (box.checked) ticked.add(sheet.name);
      else ticked.delete(sheet.name);
      update();
    });
    boxes.set(sheet.name, box);
    list.append(
      el("label", { class: "sheet-row" }, [
        box,
        el("span", { class: "sheet-name", title: sheet.name }, [sheet.name]),
        el("span", { class: "sheet-size" }, [`${nf.format(sheet.rows)} rows × ${sheet.columns} column${sheet.columns === 1 ? "" : "s"}`]),
      ]),
    );
  }
  const setAll = (on: boolean): void => {
    for (const [name, box] of boxes) {
      box.checked = on;
      if (on) ticked.add(name);
      else ticked.delete(name);
    }
    update();
  };
  const all = el("button", { type: "button", class: "link" }, ["All"]);
  const none = el("button", { type: "button", class: "link" }, ["None"]);
  all.addEventListener("click", () => setAll(true));
  none.addEventListener("click", () => setAll(false));

  const columnBox = el("input", { type: "checkbox" }) as HTMLInputElement;
  columnBox.checked = true;
  columnBox.addEventListener("change", () => {
    sheetColumn = columnBox.checked;
  });
  const columnOption = el("label", { class: "sheet-column-option", title: "So you can tell, filter and group the rows by the worksheet they came from" }, [
    columnBox,
    `Add a column ${SHEET_COLUMN} with each row's sheet name`,
  ]);
  const note = el("p", { class: "sheet-note", role: "status" });
  const go = el("button", { type: "button", class: "primary sheet-go" }) as HTMLButtonElement;
  go.addEventListener("click", () => {
    const plan = planSheets(sheets, ticked, hasHeaders);
    if (plan.action === "one") actions.loadOne(plan.sheet);
    else if (plan.action === "combine") actions.combine(plan.sheets, sheetColumn);
  });

  const update = (): void => {
    const plan = planSheets(sheets, ticked, hasHeaders);
    go.disabled = plan.action === "none" || plan.action === "blocked";
    go.textContent = plan.action === "one" || plan.action === "combine" ? plan.button : ticked.size > 1 ? `Combine ${ticked.size} worksheets` : "Load";
    note.textContent = plan.action === "one" ? "" : plan.note;
    note.classList.toggle("warn", plan.action === "blocked");
    columnOption.classList.toggle("hidden", ticked.size < 2);
  };

  // The worksheet list scrolls on its own, so the picker's usual height cap is lifted.
  host.classList.add("sheet-mode");
  host.replaceChildren(
    el("div", { class: "sheet-tools" }, [el("span", { class: "sheet-tools-label" }, ["Select:"]), all, none]),
    list,
    el("div", { class: "sheet-footer" }, [columnOption, note, go]),
  );
  update();
}
