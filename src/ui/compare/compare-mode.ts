import { DEFAULT_RULES } from "../../data/compare/types.js";
import type { CompareReport } from "../../data/compare/report.js";
import type { CompareSetupMessage, CompareSideInfo } from "../../worker/protocol.js";
import { el, svgIcon } from "../dom.js";
import type { SearchWorkerClient } from "../worker-client.js";
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
  private report: { report: CompareReport; ms: number } | null = null;
  private readonly state: SetupState;
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
    if (this.stage === "result" && this.report !== null && setup !== null) this.renderResult(setup, this.report.report, this.report.ms);
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
      this.report = { report: result.report, ms: result.ms };
      this.stage = "result";
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
    await this.options.client.compareClear().catch(() => undefined);
    this.element.remove();
    this.options.onExit();
  }

  /** The headline numbers; the full report and the side-by-side table build on this. */
  private renderResult(setup: CompareSetupMessage, report: CompareReport, ms: number): void {
    const keyChoice: KeyChoice = this.state.key;
    const rows = report.rows;
    const tile = (label: string, value: string, sub: string, tone: string): HTMLElement =>
      el("div", { class: `cmp-tile ${tone}` }, [
        el("span", { class: "cmp-tile-label" }, [el("span", { class: "cmp-dot", "aria-hidden": "true" }), label]),
        el("span", { class: "cmp-tile-value" }, [value]),
        el("span", { class: "cmp-tile-sub" }, [sub]),
      ]);
    const share = (n: number): string => (rows.matched === 0 ? "" : `${((n / rows.matched) * 100).toFixed(1)}% of matched rows`);
    const page = el("div", { class: "cmp-page" });
    const back = el("button", { class: "ghost small", type: "button" }, ["← Setup"]);
    back.addEventListener("click", () => this.showSetup());
    const how = keyChoice.kind === "content" ? "whole rows" : `key ${keyChoice.pairs.map((i) => setup.a.columns[setup.pairing.pairs[i]?.a ?? -1]?.name).join(" + ")}`;
    page.append(
      el("div", { class: "cmp-intro cmp-intro-row" }, [
        el("div", {}, [
          el("h1", { tabindex: "-1" }, ["What changed"]),
          el("p", {}, [`Matched on ${how} · compared in ${ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`}`]),
        ]),
        back,
      ]),
      el("div", { class: "cmp-tiles" }, [
        tile("Identical", nf.format(rows.identical), share(rows.identical), "same"),
        tile("Changed", nf.format(rows.changed), share(rows.changed), "changed"),
        tile("Only in A (removed)", nf.format(rows.onlyA), "not in B", "only-a"),
        tile("Only in B (added)", nf.format(rows.onlyB), "new in B", "only-b"),
        tile("Rows", `${nf.format(rows.a)} → ${nf.format(rows.b)}`, `${rows.b - rows.a >= 0 ? "+" : "−"}${nf.format(Math.abs(rows.b - rows.a))} · ${nf.format(rows.matched)} matched`, "rows"),
      ]),
    );
    const warnings: string[] = [];
    const dup = report.duplicateKeys;
    const empty = report.emptyKeys;
    for (const [side, d, e] of [["A", dup.a, empty.a], ["B", dup.b, empty.b]] as const) {
      if (d > 0) warnings.push(`${nf.format(d)} row${d === 1 ? "" : "s"} in ${side} repeat a key; repeats pair in file order.`);
      if (e > 0) warnings.push(`${nf.format(e)} row${e === 1 ? "" : "s"} in ${side} have no key, so they can't be matched.`);
    }
    if (warnings.length > 0) {
      page.append(
        el("section", { class: "cmp-warn", "aria-label": "Key problems" }, [
          el("h2", {}, ["Check the key before trusting the numbers"]),
          el("ul", {}, warnings.map((text) => el("li", {}, [text]))),
        ]),
      );
    }
    if (report.changes.length > 0) {
      const list = el("section", { class: "cmp-card" }, [
        el("div", { class: "cmp-section-head" }, [el("h2", { class: "cmp-section-title" }, ["Changes by column"])]),
      ]);
      for (const change of report.changes) {
        list.append(
          el("div", { class: "cmp-change" }, [
            el("span", { class: "cmp-change-name" }, [change.name]),
            el("span", { class: "cmp-change-count" }, [`${nf.format(change.changed)} · ${(change.share * 100).toFixed(1)}%`]),
            el("span", { class: "cmp-change-top" }, [
              change.top
                .slice(0, 2)
                .map((pair) => `${pair.from === "" ? "(empty)" : pair.from} → ${pair.to === "" ? "(empty)" : pair.to} ×${nf.format(pair.count)}`)
                .join("   "),
            ]),
          ]),
        );
      }
      page.append(list);
    } else if (rows.matched > 0) {
      page.append(el("p", { class: "cmp-note" }, ["No cell changed in the matched rows."]));
    }
    this.body.replaceChildren(page);
  }
}
