import { DEFAULT_RULES, type CompareRules } from "../../data/compare/types.js";
import type { CompareReport } from "../../data/compare/report.js";
import type { CompareSetupMessage, CompareSideInfo } from "../../worker/protocol.js";
import { el, svgIcon } from "../dom.js";
import type { SearchWorkerClient } from "../worker-client.js";
import { describeRun, pairingCaution, renderReport, type CautionActions, type ReportInput } from "./compare-report.js";
import { SideBySide, type GridLayout } from "./compare-grid.js";
import type { RowFilter } from "../../data/compare/view.js";
import type { ShiftReport } from "../../data/compare/shift.js";
import { ShiftView, type GroupChoice } from "./compare-shift.js";
import { download, exportBaseName, fileStem, reportHtml, tableCsv } from "./compare-export.js";
import { openMenu } from "../menu.js";
import { memoryGauge, type MemoryMonitor } from "../memory-gauge.js";
import { resolveSource, unreadableReason, type ResolvedSource } from "../source-resolver.js";
import { ValueDiffs, type ValueDiffsState } from "./compare-values.js";
import { FUZZY_OFF, renderSetup, type KeyChoice, type SetupState } from "./compare-setup.js";
import { thresholdForSlider } from "../../search/fuzzy-index.js";
import type { PairSuggestion } from "../../data/compare/pair-suggest.js";

export interface CompareModeOptions {
  client: SearchWorkerClient;
  /** Memory figures for the gauge in the compare header. */
  memory: MemoryMonitor;
  /** Before B is read: false when the person would rather not risk running out of memory. */
  roomFor(file: { name: string }, buffer: ArrayBuffer): Promise<boolean>;
  /** The loaded data (A), or null when A is still to be chosen. */
  loaded: CompareSideInfo | null;
  /** Loads a file as the app's data (A, from the start screen); resolves null when it did not load. */
  loadA(file: File): Promise<CompareSideInfo | null>;
  /** Asked before leaving: false keeps compare mode open (Exit clears both datasets). */
  confirmExit(): Promise<boolean>;
  /** Called after compare mode has closed: both datasets are cleared. */
  onExit(): void;
  /** Asked before a deep dive: false keeps compare mode open (opening B replaces A, so work on A is asked about). */
  confirmDeepDive(side: DeepDiveSide): Promise<boolean>;
  /** Called after compare mode has closed for a deep dive on one dataset; for B, the file it was read from. */
  onDeepDive(side: DeepDiveSide, b: DeepDiveSource | null): void;
}

/** What a deep dive opens: A, B, or the rows that differ as one table (read from `resolved` like B). */
export type DeepDiveSide = "a" | "b" | "differences";

/** Where B can be read again for a deep dive: the file as chosen, or (for a workbook or archive) the table taken from it. */
export interface DeepDiveSource {
  file: File;
  resolved: ResolvedSource | null;
}

const nf = new Intl.NumberFormat("en");
const LOCK = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';

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
  private report: { report: CompareReport; ms: number; key: KeyChoice; rules: CompareRules; autoPaired: PairSuggestion | null } | null = null;
  /** Once the automatic pairing of a renamed column is undone, columns that look renamed are only suggested. */
  private noAutoPair = false;
  private readonly state: SetupState;
  /** Which result tab is open, and how the side-by-side view was left. */
  private tab: "report" | "rows" | "values" | "shift" = "rows";
  /** How the Value differences sheet was left: the operation, the colour map and its scale. */
  private valueState: ValueDiffsState = { op: "sub", colour: "coolwarm", scope: "column", changedOnly: true, sort: { pair: null, dir: "desc" } };
  private valueDiffs: ValueDiffs | null = null;
  /** Big Picture, fetched once per comparison, and the group view last chosen. */
  private shift: ShiftReport | null = null;
  private groups: GroupChoice | null = null;
  private rows: { filter: RowFilter; layout: GridLayout; changedColumnsOnly: boolean } = {
    filter: { show: "differences", pairs: [] },
    layout: "panes",
    changedColumnsOnly: false,
  };
  private sideBySide: SideBySide | null = null;
  /** Says when an export could not be saved. */
  private readonly exportNote = el("span", { class: "cmp-export-note", role: "status" });
  private closed = false;
  /** B's source, kept so a deep dive can load it as the app's data. */
  private bSource: DeepDiveSource | null = null;
  /** The setup changed after the last comparison, so the result steps wait for another Compare. */
  private stale = false;

  constructor(private readonly options: CompareModeOptions) {
    this.state = {
      aLoaded: options.loaded !== null,
      a: options.loaded,
      b: null,
      setup: null,
      manual: [],
      ignore: { a: [], b: [] },
      key: { kind: "content" },
      rules: DEFAULT_RULES,
      fuzzy: FUZZY_OFF,
      autoPaired: null,
      busy: null,
      error: null,
    };
    this.files = el("span", { class: "cmp-files" });
    const exit = el("button", { class: "ghost small", type: "button", title: "Leave compare mode: both datasets are cleared, and you start again from the start screen" }, ["Exit compare"]);
    exit.addEventListener("click", () => void this.exit());
    const header = el("div", { class: "cmp-header" }, [
      el("span", { class: "cmp-brand" }, ["TurboFuzz"]),
      el("span", { class: "cmp-mode-pill" }, [svgIcon(LOCK, "cmp-lock"), "Compare mode"]),
      el("span", { class: "cmp-locked-note" }, ["Other tools are locked until you exit"]),
      this.files,
      el("span", { class: "grow" }),
      memoryGauge(options.memory),
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

  /**
   * Opens with B already chosen (Load more → Compare with a file), or with both
   * chosen on the front page: then it compares at once, on the suggested key,
   * and opens on Spot the difference. Setup is a step back.
   */
  async start(b?: File, a?: File): Promise<void> {
    if (a !== undefined && b !== undefined && !this.state.aLoaded) {
      await this.pickA(a);
      if (this.state.a === null || this.state.error !== null) return;
      await this.pickB(b);
      if (this.state.setup === null || this.state.error !== null) return;
      await this.run();
      return;
    }
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
    this.valueDiffs?.dispose();
    this.valueDiffs = null;
    this.body.classList.toggle("cmp-body-rows", this.stage === "result" && (this.tab === "rows" || this.tab === "values"));
    if (this.stage === "result" && this.report !== null && setup !== null) {
      const result = this.report;
      const host = el("div", { class: "cmp-tab-host" });
      this.body.replaceChildren(this.steps(), host);
      if (this.tab === "shift") {
        void this.showShift(host);
      } else if (this.tab === "values") {
        this.valueDiffs = new ValueDiffs({
          client: this.options.client,
          state: this.valueState,
          onState: (state) => {
            this.valueState = state;
          },
          caution: pairingCaution(setup, result.key, this.cautionActions()),
        });
        host.append(this.valueDiffs.element);
      } else if (this.tab === "report") {
        renderReport(
          host,
          { setup, report: result.report, ms: result.ms, key: result.key, rules: result.rules, autoPaired: this.autoPairedNames(result.autoPaired) },
          { rows: (filter) => this.openRows(filter), undoAutoPair: () => this.undoAutoPair(), rejectPair: (aRow, bRow) => void this.rejectPair(aRow, bRow),
            showPair: (index) => this.showPair(index), caution: () => pairingCaution(setup, result.key, this.cautionActions()) },
        );
      } else {
        this.sideBySide = new SideBySide({
          client: this.options.client,
          setup,
          report: result.report,
          key: result.key,
          ...this.rows,
          focus: this.takeFocus(),
          onState: (state) => {
            this.rows = state;
          },
          onChangeMatch: () => this.showSetup("match"),
          caution: pairingCaution(setup, result.key, this.cautionActions()),
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
        undoAutoPair: () => this.undoAutoPair(),
        setIgnore: (ignore) => void this.setIgnore(ignore),
        setFuzzy: (fuzzy) => {
          this.state.fuzzy = fuzzy;
          this.stale = true;
          this.render();
        },
        setKey: (key) => {
          this.state.key = key;
          this.state.fuzzy = { ...this.state.fuzzy, rejected: [] };
          this.stale = true;
          this.render();
        },
        setRules: (rules) => {
          this.state.rules = rules;
          this.stale = true;
          this.render();
        },
        run: () => void this.run(),
      });
    if (!(this.stage === "result" && this.report !== null && setup !== null)) this.body.prepend(this.steps());
  }

  /**
   * The way through a comparison, always on top: Comparison setup, Report,
   * Spot the difference, Value differences, Report, Big Picture. The last three wait for a Compare that matches
   * the setup as it stands; Export joins them once there is a result.
   */
  private steps(): HTMLElement {
    const ready = this.report !== null && !this.stale && this.state.setup !== null;
    const current = this.stage === "setup" ? "setup" : this.tab;
    const nav = el("nav", { class: "cmp-steps", "aria-label": "Comparison steps" });
    const list = [["setup", "Comparison setup"], ["rows", "Spot the difference"], ["values", "Value differences"], ["report", "Report"], ["shift", "Big Picture"]] as const;
    list.forEach(([step, label], index) => {
      const waiting = step !== "setup" && !ready;
      const button = el("button", { type: "button", class: "cmp-step", title: waiting ? "Press Compare in the setup first" : "" }, [
        el("span", { class: "cmp-step-num", "aria-hidden": "true" }, [String(index + 1)]),
        label,
      ]);
      if (current === step) button.setAttribute("aria-current", "page");
      if (waiting) button.setAttribute("aria-disabled", "true");
      button.addEventListener("click", () => {
        if (waiting || current === step) return;
        if (step === "setup") return this.showSetup();
        this.stage = "result";
        this.tab = step;
        this.render();
      });
      nav.append(button);
      if (index < list.length - 1) nav.append(el("span", { class: "cmp-step-sep", "aria-hidden": "true" }, ["›"]));
    });
    const dive = el("button", { type: "button", class: "ghost small", "aria-haspopup": "menu", title: "Close the comparison and analyse one dataset on its own, with all the tools" }, ["Deep dive ▾"]);
    dive.addEventListener("click", () => {
      const setup = this.state.setup;
      if (setup === null) return;
      openMenu(dive, [
        { label: `Analyse A: ${setup.a.name}`, title: "Closes the comparison and keeps A as the loaded data, ready for the table, quality, pivot and charts", action: () => void this.deepDive("a") },
        { label: `Analyse B: ${setup.b.name}`, title: "Closes the comparison and loads B as the data, replacing A", action: () => void this.deepDive("b") },
        { label: "Analyse the differences", title: "Closes the comparison and opens the rows that differ as one table: what changed, the key, and each changed column in A, in B and (numbers) B − A", action: () => void this.deepDive("differences") },
      ]);
    });
    const exportButton = el("button", { type: "button", class: "ghost small", "aria-haspopup": "menu" }, ["Export ▾"]);
    exportButton.addEventListener("click", () =>
      openMenu(exportButton, [
        { label: "Report (HTML page)", title: "The report and what shifted, as one page to share or print: counts and summaries, not the rows", action: () => void this.exportAs("html") },
        { label: "Changes (CSV)", title: "One line per changed cell (key, rows, column, value in A and in B), and one per row only one side has", action: () => void this.exportAs("csv") },
        { label: "Report (Excel)", title: "A formatted workbook: Summary, Differences (every column side by side, only the rows that differ, changed cells coloured), Changed cells, Only in A, Only in B, Columns and Big Picture", action: () => void this.exportAs("xlsx") },
      ]),
    );
    nav.append(el("span", { class: "grow" }), this.exportNote);
    if (this.state.setup !== null) nav.append(dive);
    if (ready) nav.append(exportButton);
    return nav;
  }

  /** Big Picture: computed by the worker the first time the tab opens. */
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
      if (kind === "html") {
        if (this.shift === null) this.shift = (await this.options.client.compareShift()).shift;
        download(reportHtml(input, this.shift), "text/html", `${base}_report.html`);
        return;
      }
      if (kind === "csv") {
        const { tables } = await this.options.client.compareExport();
        download(tableCsv(tables.changes), "text/csv", `${base}_changes.csv`);
      } else {
        this.exportNote.textContent = "Building the workbook…";
        const meta = { description: describeRun(input), rules: result.rules, autoPaired: this.autoPairedNames(result.autoPaired), created: `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC` };
        const built = await this.options.client.compareReportXlsx(meta);
        download(built.bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${base}.xlsx`);
        const cut = built.differences.total - built.differences.written;
        this.exportNote.textContent = cut > 0 ? `The Differences sheet holds the first ${built.differences.written.toLocaleString("en")} of ${built.differences.total.toLocaleString("en")} rows that differ.` : "";
        return;
      }
      this.exportNote.textContent = "";
    } catch (error) {
      this.exportNote.textContent = error instanceof Error ? `Export failed: ${error.message}` : "Export failed.";
    }
  }

  /** From a count or a column in the report: those rows, side by side. */
  /** The similar-key row chosen on the Report, used once when Spot the difference next opens. */
  private focusRow = -1;

  private takeFocus(): number | undefined {
    const row = this.focusRow;
    this.focusRow = -1;
    return row < 0 ? undefined : row;
  }

  /** Opens one similar-key pairing side by side, among the other similar-key rows. */
  private showPair(index: number): void {
    this.focusRow = index;
    this.openRows({ show: "similar", pairs: [] });
  }

  private openRows(filter: RowFilter): void {
    this.rows = { ...this.rows, filter };
    this.tab = "rows";
    this.render();
  }

  private cautionActions(): CautionActions {
    return {
      pair: (a, b) => void this.pairAndRun(a, b),
      changeMatch: () => this.showSetup("match"),
    };
  }

  private autoPairedNames(auto: PairSuggestion | null): { a: string; b: string; overlap: number } | null {
    const setup = this.state.setup;
    if (auto === null || setup === null) return null;
    return { a: setup.a.columns[auto.a]?.name ?? "?", b: setup.b.columns[auto.b]?.name ?? "?", overlap: auto.overlap };
  }

  /** Says two rows are not the same record: they are kept apart and the comparison runs again, staying on the Report. */
  private async rejectPair(aRow: number, bRow: number): Promise<void> {
    this.state.fuzzy = { ...this.state.fuzzy, rejected: [...this.state.fuzzy.rejected, `${aRow}:${bRow}`] };
    await this.run(true);
  }

  /** Takes back the automatic pairing: the setup is worked out again with the columns only suggested. */
  private undoAutoPair(): void {
    const auto = this.state.autoPaired;
    if (auto === null) return;
    this.noAutoPair = true;
    // From the report too: the setup is where the pair is now only suggested.
    void this.setManual(this.state.manual.filter((m) => m.a !== auto.a || m.b !== auto.b)).then(() => this.showSetup());
  }

  /** From the caution: pair two columns, then compare again on the key that gives. */
  private async pairAndRun(a: number, b: number): Promise<void> {
    await this.setManual([...this.state.manual, { a, b }]);
    if (this.state.error === null) await this.run();
  }

  private applySetup(setup: CompareSetupMessage): void {
    this.state.setup = setup;
    if (setup.autoPaired) {
      // The worker paired a renamed column: keep the pair with the hand-made ones so every later request carries it.
      this.state.autoPaired = setup.autoPaired;
      this.state.manual = [...this.state.manual, { a: setup.autoPaired.a, b: setup.autoPaired.b }];
    }
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
    let source: ResolvedSource | null;
    try {
      source = await resolveSource(file);
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : `Could not read ${file.name}.`);
    }
    if (source === null) {
      this.state.busy = null;
      return this.render();
    }
    const info = await this.options.loadA(new File([source.buffer], source.name));
    if (info === null) return this.fail(`Could not read ${file.name}.`);
    // Loading new data drops B in the worker, so B is chosen again against this A.
    this.state.busy = null;
    this.state.a = info;
    this.state.b = null;
    this.state.setup = null;
    this.state.manual = [];
    this.state.ignore = { a: [], b: [] };
    this.state.autoPaired = null;
    this.noAutoPair = false;
    this.bSource = null;
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
      const source = await resolveSource(file);
      if (source === null || !(await this.options.roomFor(source, source.buffer))) {
        this.state.busy = null;
        this.render();
        return;
      }
      // The bytes go to the worker; a table taken from a workbook or archive is kept (a plain file is simply read again).
      this.bSource = { file, resolved: source.name === file.name ? null : { name: source.name, buffer: source.buffer.slice(0) } };
      const setup = await this.options.client.compareLoad({ name: source.name, buffer: source.buffer, delimiter: "auto", hasHeaders: true });
      void this.options.memory.refresh();
      this.state.manual = [];
      this.state.ignore = { a: [], b: [] };
      this.state.autoPaired = null;
      this.noAutoPair = false;
      this.applySetup(setup);
      this.state.busy = null;
      this.render();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : `Could not read ${file.name}.`);
    }
  }

  private async setManual(manual: { a: number; b: number }[]): Promise<void> {
    this.state.manual = manual;
    this.stale = true;
    const auto = this.state.autoPaired;
    if (auto !== null && !manual.some((m) => m.a === auto.a && m.b === auto.b)) {
      this.state.autoPaired = null;
      this.noAutoPair = true;
    }
    try {
      this.applySetup(await this.options.client.compareSetup(manual, this.state.rules, this.state.ignore, !this.noAutoPair));
      this.render();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not pair the columns.");
    }
  }

  /** Leave columns out of the comparison (or put them back); pairs and key suggestions are worked out again without them. */
  private async setIgnore(ignore: { a: number[]; b: number[] }): Promise<void> {
    this.state.ignore = ignore;
    this.stale = true;
    try {
      this.applySetup(await this.options.client.compareSetup(this.state.manual, this.state.rules, ignore, !this.noAutoPair));
      this.render();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not update the columns.");
    }
  }

  private async run(stay = false): Promise<void> {
    this.state.busy = "Comparing…";
    this.state.error = null;
    this.render();
    try {
      const keyPairs = this.state.key.kind === "pairs" ? this.state.key.pairs : null;
      const result = await this.options.client.compareRun(
        this.state.manual,
        keyPairs,
        this.state.rules,
        this.state.ignore,
        this.state.key.kind === "position",
        this.state.fuzzy.on && keyPairs !== null ? { threshold: thresholdForSlider(this.state.fuzzy.position), rejected: this.state.fuzzy.rejected } : null,
      );
      this.state.busy = null;
      this.report = { report: result.report, ms: result.ms, key: this.state.key, rules: this.state.rules, autoPaired: this.state.autoPaired };
      this.stale = false;
      this.stage = "result";
      if (!stay) {
        this.tab = "rows";
        this.rows = { ...this.rows, filter: { show: "differences", pairs: [] } };
      }
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

  /** Back to the setup; "match" scrolls to Match rows on and puts focus on the chosen option. */
  private showSetup(focus?: "match"): void {
    this.stage = "setup";
    this.render();
    if (focus !== "match") return;
    const box = this.body.querySelector<HTMLElement>("#cmp-match-rows");
    if (box === null) return;
    box.scrollIntoView({ block: "start" });
    box.classList.add("cmp-flash");
    window.setTimeout(() => box.classList.remove("cmp-flash"), 1600);
    box.querySelector<HTMLInputElement>('input[name="cmp-key"]:checked')?.focus({ preventScroll: true });
  }

  private exportInput(): ReportInput {
    const result = this.report!;
    return { setup: this.state.setup!, report: result.report, ms: result.ms, key: result.key, rules: result.rules };
  }

  /** Leaves comparing for the normal analysis tools on one dataset (A stays loaded; B is loaded in its place). */
  private async deepDive(side: DeepDiveSide): Promise<void> {
    if (this.closed || this.state.setup === null) return;
    if (side === "b" && this.bSource === null) return;
    let source: DeepDiveSource | null = side === "b" ? this.bSource : null;
    if (side === "differences") {
      const result = this.report;
      if (result === null) return;
      const rows = result.report.rows;
      if (rows.changed + rows.onlyA + rows.onlyB === 0) {
        this.exportNote.textContent = "No rows differ, so there is nothing to analyse.";
        return;
      }
    }
    if (!(await this.options.confirmDeepDive(side))) return;
    if (this.closed) return;
    if (side === "differences") {
      // Read before the comparison is cleared: the same rows and statuses as the Changes exports, one line per row.
      try {
        const { table } = await this.options.client.compareDifferences();
        const input = this.exportInput();
        const buffer = new TextEncoder().encode(tableCsv(table)).buffer;
        const name = `differences_${fileStem(input.setup.a.name)}_vs_${fileStem(input.setup.b.name)}.csv`;
        source = { file: new File([buffer], name, { type: "text/csv" }), resolved: { name, buffer: buffer.slice(0) } };
      } catch (error) {
        this.exportNote.textContent = error instanceof Error ? `Could not open the differences: ${error.message}` : "Could not open the differences.";
        return;
      }
    }
    this.closed = true;
    this.sideBySide?.dispose();
    this.valueDiffs?.dispose();
    await this.options.client.compareClear().catch(() => undefined);
    void this.options.memory.refresh();
    this.element.remove();
    this.options.onDeepDive(side, source);
  }

  private async exit(): Promise<void> {
    if (this.closed) return;
    if (!(await this.options.confirmExit())) return;
    if (this.closed) return;
    this.closed = true;
    this.sideBySide?.dispose();
    await this.options.client.compareClear().catch(() => undefined);
    void this.options.memory.refresh();
    this.element.remove();
    this.options.onExit();
  }
}
