import { DEFAULT_RULES, type CompareRules } from "../../data/compare/types.js";
import type { CompareReport } from "../../data/compare/report.js";
import type { CompareSetupMessage, CompareSideInfo } from "../../worker/protocol.js";
import { el, svgIcon } from "../dom.js";
import type { SearchWorkerClient } from "../worker-client.js";
import { renderReport } from "./compare-report.js";
import { SideBySide, type GridLayout } from "./compare-grid.js";
import type { RowFilter } from "../../data/compare/view.js";
import type { ShiftReport } from "../../data/compare/shift.js";
import { ShiftView, type GroupChoice } from "./compare-shift.js";
import { changesWorkbook, download, exportBaseName, reportHtml, tableCsv } from "./compare-export.js";
import { openMenu } from "../menu.js";
import { renderSetup, type KeyChoice, type SetupState } from "./compare-setup.js";

export interface CompareModeOptions {
  client: SearchWorkerClient;
  /** The loaded data (A), or null when A is still to be chosen. */
  loaded: CompareSideInfo | null;
  /** Loads a file as the app's data (A, from the start screen); resolves null when it did not load. */
  loadA(file: File): Promise<CompareSideInfo | null>;
  /** Called after compare mode has closed (B dropped). */
  onExit(): void;
}

const nf = new Intl.NumberFormat("en");
const READABLE = /\.(csv|tsv|psv|txt|tab|json|ndjson|jsonl|parquet)$/i;
const LOCK = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';

/** Why a file cannot be compared yet, or null when it can. */
export function unreadableReason(name: string): string | null {
  if (READABLE.test(name)) return null;
  if (/\.(xlsx|xls)$/i.test(name)) return `${name} is a workbook. Compare reads CSV, TSV, JSON and Parquet for now: save the sheet as CSV and choose it again.`;
  if (/\.(zip|gz|bz2)$/i.test(name)) return `${name} is an archive. Unpack it and choose the file inside.`;
  return `${name} is not a CSV, TSV, JSON or Parquet file.`;
}

/**
 * Compare mode: a full-screen layer over the workspace with its own header.
 * Everything else is out of reach until Exit. A is the loaded data (or a file
 * loaded as the data from the start screen); B is read beside it by the
 * worker and dropped on Exit.
 */
export class CompareMode {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly files: HTMLElement;
  private stage: "setup" | "result" = "setup";
  /** The last result, with the key and rules it was run with (setup may change them afterwards). */
  private report: { report: CompareReport; ms: number; key: KeyChoice; rules: CompareRules } | null = null;
  private readonly state: SetupState;
  /** Which result tab is open, and how the side-by-side view was left. */
  private tab: "report" | "rows" | "shift" = "report";
  /** What shifted, fetched once per comparison, and the group view last chosen. */
  private shift: ShiftReport | null = null;
  private groups: GroupChoice | null = null;
  private rows: { filter: RowFilter; layout: GridLayout; changedColumnsOnly: boolean } = {
    filter: { show: "differences", pair: null },
    layout: "panes",
    changedColumnsOnly: false,
  };
  private sideBySide: SideBySide | null = null;
  /** Says when an export could not be saved. */
  private readonly exportNote = el("span", { class: "cmp-export-note", role: "status" });
  private closed = false;

  constructor(private readonly options: CompareModeOptions) {
    this.state = {
      aLoaded: options.loaded !== null,
      a: options.loaded,
      b: null,
      setup: null,
      manual: [],
      key: { kind: "content" },
      rules: DEFAULT_RULES,
      busy: null,
      error: null,
    };
    this.files = el("span", { class: "cmp-files" });
    const exit = el("button", { class: "ghost small", type: "button" }, ["Exit compare"]);
    exit.addEventListener("click", () => void this.exit());
    const header = el("div", { class: "cmp-header" }, [
      el("span", { class: "cmp-brand" }, ["TurboFuzz"]),
      el("span", { class: "cmp-mode-pill" }, [svgIcon(LOCK, "cmp-lock"), "Compare mode"]),
      el("span", { class: "cmp-locked-note" }, ["Other tools are locked until you exit"]),
      this.files,
      el("span", { class: "grow" }),
      exit,
    ]);
    this.body = el("div", { class: "cmp-body" });
    this.element = el("div", { class: "compare-mode", role: "region", "aria-label": "Compare two datasets" }, [header, this.body]);
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.stage === "result" && document.activeElement?.closest(".modal-overlay") == null) {
        event.preventDefault();
        this.showSetup();
      }
    });
    this.render();
  }

  /** Opens with B already chosen (Load more → Compare with a file). */
  async start(b?: File): Promise<void> {
    if (this.state.aLoaded && b !== undefined) await this.pickB(b);
  }

  private render(): void {
    if (this.closed) return;
    const { setup } = this.state;
    this.files.replaceChildren();
    if (setup !== null) {
      this.files.append(
        el("span", { class: "cmp-badge a" }, ["A"]),
        el("span", { class: "cmp-file", title: setup.a.name }, [setup.a.name]),
        el("span", { "aria-hidden": "true" }, ["→"]),
        el("span", { class: "cmp-badge b" }, ["B"]),
        el("span", { class: "cmp-file", title: setup.b.name }, [setup.b.name]),
      );
    }
    this.sideBySide?.dispose();
    this.sideBySide = null;
    this.body.classList.toggle("cmp-body-rows", this.stage === "result" && this.tab === "rows");
    if (this.stage === "result" && this.report !== null && setup !== null) {
      const result = this.report;
      const host = el("div", { class: "cmp-tab-host" });
      this.body.replaceChildren(this.tabs(), host);
      if (this.tab === "shift") {
        void this.showShift(host);
      } else if (this.tab === "report") {
        renderReport(host, { setup, report: result.report, ms: result.ms, key: result.key, rules: result.rules }, { rows: (filter) => this.openRows(filter) });
      } else {
        this.sideBySide = new SideBySide({
          client: this.options.client,
          setup,
          report: result.report,
          key: result.key,
          ...this.rows,
          onState: (state) => {
            this.rows = state;
          },
        });
        host.append(this.sideBySide.element);
        this.sideBySide.focus();
      }
    }
    else
      renderSetup(this.body, this.state, {
        pickA: (file) => void this.pickA(file),
        pickB: (file) => void this.pickB(file),
        pickBoth: (a, b) => void this.pickA(a).then(() => (this.state.a !== null && this.state.error === null ? this.pickB(b) : undefined)),
        setManual: (manual) => void this.setManual(manual),
        setKey: (key) => {
          this.state.key = key;
          this.render();
        },
        setRules: (rules) => {
          this.state.rules = rules;
          this.render();
        },
        run: () => void this.run(),
      });
  }

  /** Report | Side by side, and the way back to setup. */
  private tabs(): HTMLElement {
    const nav = el("nav", { class: "cmp-tabs", "aria-label": "Compare views" });
    for (const [tab, label] of [["report", "Report"], ["rows", "Side by side"], ["shift", "What shifted"]] as const) {
      const button = el("button", { type: "button", class: "cmp-tab" }, [label]);
      if (this.tab === tab) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => {
        this.tab = tab;
        this.render();
      });
      nav.append(button);
    }
    const back = el("button", { type: "button", class: "ghost small" }, ["← Setup"]);
    back.addEventListener("click", () => this.showSetup());
    const exportButton = el("button", { type: "button", class: "ghost small", "aria-haspopup": "menu" }, ["Export ▾"]);
    exportButton.addEventListener("click", () =>
      openMenu(exportButton, [
        { label: "Report (HTML page)", title: "The report and what shifted, as one page to share or print: counts and summaries, not the rows", action: () => void this.exportAs("html") },
        { label: "Changes (CSV)", title: "One line per changed cell (key, rows, column, value in A and in B), and one per row only one side has", action: () => void this.exportAs("csv") },
        { label: "Changes and rows (Excel)", title: "Summary, Changes, Only in A, Only in B and What shifted as sheets of one workbook", action: () => void this.exportAs("xlsx") },
      ]),
    );
    nav.append(el("span", { class: "grow" }), this.exportNote, exportButton, back);
    return nav;
  }

  /** What shifted: computed by the worker the first time the tab opens. */
  private async showShift(host: HTMLElement): Promise<void> {
    const setup = this.state.setup;
    if (setup === null) return;
    if (this.shift === null) {
      host.replaceChildren(el("div", { class: "cmp-page" }, [el("div", { class: "cmp-busy", role: "status" }, [el("span", { class: "load-spinner", "aria-hidden": "true" }), "Comparing the distributions…"])]));
      try {
        this.shift = (await this.options.client.compareShift()).shift;
      } catch (error) {
        host.replaceChildren(el("p", { class: "cmp-error", role: "alert" }, [error instanceof Error ? error.message : "Could not compare the distributions."]));
        return;
      }
      if (this.tab !== "shift" || !host.isConnected) return;
    }
    const view = new ShiftView({
      client: this.options.client,
      setup,
      shift: this.shift,
      groups: this.groups,
      onGroups: (choice) => {
        this.groups = choice;
      },
    });
    host.replaceChildren(view.element);
  }

  /** Saves the comparison: the HTML report, the changes as CSV, or a workbook with the rows. */
  private async exportAs(kind: "html" | "csv" | "xlsx"): Promise<void> {
    const setup = this.state.setup;
    const result = this.report;
    if (setup === null || result === null) return;
    const input = { setup, report: result.report, ms: result.ms, key: result.key, rules: result.rules };
    const base = exportBaseName(input);
    try {
      if (kind !== "csv" && this.shift === null) this.shift = (await this.options.client.compareShift()).shift;
      if (kind === "html") {
        download(reportHtml(input, this.shift), "text/html", `${base}_report.html`);
        return;
      }
      const { tables } = await this.options.client.compareExport();
      if (kind === "csv") download(tableCsv(tables.changes), "text/csv", `${base}_changes.csv`);
      else download((await changesWorkbook(input, tables, this.shift)) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${base}.xlsx`);
      this.exportNote.textContent = "";
    } catch (error) {
      this.exportNote.textContent = error instanceof Error ? `Export failed: ${error.message}` : "Export failed.";
    }
  }

  /** From a count or a column in the report: those rows, side by side. */
  private openRows(filter: RowFilter): void {
    this.rows = { ...this.rows, filter };
    this.tab = "rows";
    this.render();
  }

  private applySetup(setup: CompareSetupMessage): void {
    this.state.setup = setup;
    this.state.a = setup.a;
    this.state.b = setup.b;
    const first = setup.keys[0];
    this.state.key = first === undefined ? { kind: "content" } : { kind: "pairs", pairs: first.pairs };
  }

  private async pickA(file: File): Promise<void> {
    const reason = unreadableReason(file.name);
    if (reason !== null) return this.fail(reason);
    this.state.busy = `Reading ${file.name}…`;
    this.state.error = null;
    this.render();
    const info = await this.options.loadA(file);
    if (info === null) return this.fail(`Could not read ${file.name}.`);
    // Loading new data drops B in the worker, so B is chosen again against this A.
    this.state.busy = null;
    this.state.a = info;
    this.state.b = null;
    this.state.setup = null;
    this.state.manual = [];
    this.render();
  }

  private async pickB(file: File): Promise<void> {
    const reason = unreadableReason(file.name);
    if (reason !== null) return this.fail(reason);
    if (this.state.a === null) return this.fail("Choose A first: the data to compare against.");
    this.state.busy = `Reading ${file.name}…`;
    this.state.error = null;
    this.render();
    try {
      const buffer = await file.arrayBuffer();
      const setup = await this.options.client.compareLoad({ name: file.name, buffer, delimiter: "auto", hasHeaders: true });
      this.state.manual = [];
      this.applySetup(setup);
      this.state.busy = null;
      this.render();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : `Could not read ${file.name}.`);
    }
  }

  private async setManual(manual: { a: number; b: number }[]): Promise<void> {
    this.state.manual = manual;
    try {
      this.applySetup(await this.options.client.compareSetup(manual, this.state.rules));
      this.render();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not pair the columns.");
    }
  }

  private async run(): Promise<void> {
    this.state.busy = "Comparing…";
    this.state.error = null;
    this.render();
    try {
      const keyPairs = this.state.key.kind === "content" ? null : this.state.key.pairs;
      const result = await this.options.client.compareRun(this.state.manual, keyPairs, this.state.rules);
      this.state.busy = null;
      this.report = { report: result.report, ms: result.ms, key: this.state.key, rules: this.state.rules };
      this.stage = "result";
      this.tab = "report";
      this.rows = { ...this.rows, filter: { show: "differences", pair: null } };
      this.shift = null;
      this.groups = null;
      this.render();
      this.body.querySelector<HTMLElement>("h1")?.focus();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "The comparison failed.");
    }
  }

  private fail(message: string): void {
    this.state.busy = null;
    this.state.error = message;
    this.render();
  }

  private showSetup(): void {
    this.stage = "setup";
    this.render();
  }

  private async exit(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.sideBySide?.dispose();
    await this.options.client.compareClear().catch(() => undefined);
    this.element.remove();
    this.options.onExit();
  }
}
