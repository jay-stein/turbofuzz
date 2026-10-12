import type { DatasetStats } from "../data/stats.js";
import {
  anomalyFindings,
  qualityFindings,
  relationshipFindings,
  type Finding,
} from "../data/findings.js";
import type { CorrelationMessage, ColumnMeta } from "../worker/protocol.js";
import { clear, el } from "./dom.js";

export type ReportTab = "quality" | "relationships" | "anomalies";

const TABS: readonly { id: ReportTab; label: string; title: string }[] = [
  { id: "quality", label: "Quality", title: "Types, formats, missingness and usefulness" },
  { id: "relationships", label: "Relationships", title: "Which columns move together" },
  { id: "anomalies", label: "Anomalies", title: "Unusual values, with the reason they were flagged" },
];

export interface ReportsPanelOptions {
  /** Correlation over the current numeric columns (cached by the app). */
  requestCorrelation(): Promise<CorrelationMessage | null>;
  /** Runs a finding's action (filters, suggestion chips, merge, clean). */
  onAction(finding: Finding): void;
}

/**
 * The Reports lens: three tabs over one shared finding shape. Quality and
 * Anomalies are derived from the metadata already on the client; Relationships
 * asks the worker for a Pearson matrix the first time it is opened.
 */
export class ReportsPanel {
  private readonly tabsEl: HTMLElement;
  private readonly metaEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private metas: readonly ColumnMeta[] = [];
  private stats: DatasetStats | null = null;
  private active: ReportTab = "quality";
  private correlation: CorrelationMessage | null = null;
  private correlationLoading = false;
  private correlationRequested = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: ReportsPanelOptions,
  ) {
    this.root.classList.add("reports-panel");
    this.tabsEl = el("div", { class: "reports-tabs" });
    this.metaEl = el("div", { class: "reports-meta" });
    this.listEl = el("div", { class: "reports-list" });
    this.root.append(this.tabsEl, this.metaEl, this.listEl);
  }

  setData(metas: readonly ColumnMeta[], stats: DatasetStats): void {
    this.metas = metas;
    this.stats = stats;
    this.render();
  }

  show(tab: ReportTab = this.active): void {
    this.active = tab;
    if (tab === "relationships") void this.loadCorrelation();
    this.render();
  }

  private async loadCorrelation(): Promise<void> {
    if (this.correlationRequested) return;
    this.correlationRequested = true;
    this.correlationLoading = true;
    this.render();
    try {
      this.correlation = await this.options.requestCorrelation();
    } catch {
      this.correlation = null;
    }
    this.correlationLoading = false;
    this.render();
  }

  /** Column metadata changed: correlation must be refetched. */
  invalidate(): void {
    this.correlation = null;
    this.correlationRequested = false;
    if (this.active === "relationships") void this.loadCorrelation();
  }

  refresh(): void {
    this.render();
  }

  private findings(): Finding[] {
    if (this.stats === null) return [];
    if (this.active === "quality") return qualityFindings(this.metas, this.stats);
    if (this.active === "anomalies") return anomalyFindings(this.metas);
    if (this.correlation === null) return [];
    return relationshipFindings(
      this.correlation.labels,
      this.correlation.columns,
      this.correlation.result.values,
      this.correlation.result.counts,
    );
  }

  private render(): void {
    clear(this.tabsEl);
    for (const tab of TABS) {
      const button = el(
        "button",
        {
          class: `reports-tab${tab.id === this.active ? " active" : ""}`,
          type: "button",
          title: tab.title,
        },
        [tab.label],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => this.show(tab.id));
      this.tabsEl.append(button);
    }

    const findings = this.findings();
    const fixes = findings.filter((finding) => finding.severity === "fix").length;
    const reviews = findings.filter((finding) => finding.severity === "review").length;
    this.metaEl.textContent =
      this.stats === null
        ? ""
        : `${findings.length.toLocaleString()} finding${findings.length === 1 ? "" : "s"} · ${fixes} fix · ${reviews} review${this.correlationLoading ? " · computing relationships…" : ""}`;

    clear(this.listEl);
    if (this.stats === null) {
      this.listEl.append(el("div", { class: "reports-empty" }, ["Load data to run reports."]));
      return;
    }
    if (this.active === "relationships" && this.correlationLoading) {
      this.listEl.append(el("div", { class: "reports-empty" }, ["Computing correlations…"]));
      return;
    }
    if (findings.length === 0) {
      this.listEl.append(
        el("div", { class: "reports-empty" }, [
          this.active === "quality"
            ? "✓ No quality issues found."
            : this.active === "relationships"
              ? "No strong associations at r ≥ 0.5 over the numeric columns."
              : "✓ No anomalies flagged.",
        ]),
      );
      return;
    }
    for (const finding of findings) {
      this.listEl.append(this.renderFinding(finding));
    }
  }

  private renderFinding(finding: Finding): HTMLElement {
    const row = el("div", { class: `finding finding-${finding.severity}` });
    const body = el("div", { class: "finding-body" });
    const badge = el("span", { class: `finding-badge ${finding.severity}` }, [
      finding.severity === "fix" ? "Fix" : finding.severity === "review" ? "Review" : "Info",
    ]);
    body.append(
      el("div", { class: "finding-title-row" }, [badge, el("span", { class: "finding-title" }, [finding.title])]),
      el(
        "div",
        { class: "finding-evidence" },
        [finding.evidence.map((entry) => `${entry.metric}: ${entry.value}`).join(" · ")],
      ),
    );
    row.append(body);
    if (finding.action !== undefined) {
      const action = el(
        "button",
        { class: "ghost small", type: "button", title: "Runs the fix — undo is offered in the Recipe" },
        [finding.fixLabel ?? "Show rows"],
      ) as HTMLButtonElement;
      action.addEventListener("click", () => this.options.onAction(finding));
      row.append(action);
    }
    return row;
  }
}
