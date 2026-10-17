import type { DatasetStats } from "../data/stats.js";
import {
  anomalyFindings,
  coMissingnessFindings,
  dependencyFindings,
  distributionFindings,
  explainColumn,
  groupAnomalyFindings,
  qualityFindings,
  relationshipDataFindings,
  relationshipFindings,
  similarClusterFindings,
  textProfileFindings,
  type Finding,
} from "../data/findings.js";
import type {
  CoMissingnessMessage,
  CorrelationMessage,
  ColumnMeta,
  DependenciesMessage,
  DistributionChangesMessage,
  GroupAnomaliesMessage,
  RelationshipsMessage,
  SimilarClustersMessage,
  TextProfileMessage,
} from "../worker/protocol.js";
import { clear, el } from "./dom.js";
import { describeScope } from "./scope.js";

export type ReportTab = "quality" | "relationships" | "anomalies";

const TABS: readonly { id: ReportTab; label: string; title: string }[] = [
  { id: "quality", label: "Quality", title: "Types, formats, missingness and usefulness" },
  { id: "relationships", label: "Relationships", title: "Which columns move together" },
  { id: "anomalies", label: "Anomalies", title: "Unusual values, with the reason they were flagged" },
];

export interface ReportsPanelOptions {
  /** Correlation over the current numeric columns (cached by the app). */
  requestCorrelation(): Promise<CorrelationMessage | null>;
  /** Pairwise co-missingness over the filtered rows. */
  requestCoMissingness(): Promise<CoMissingnessMessage | null>;
  /** Group-relative anomaly detection over the current rows. */
  requestGroupAnomalies(): Promise<GroupAnomaliesMessage | null>;
  /** Candidate keys and functional dependencies. */
  requestDependencies(): Promise<DependenciesMessage | null>;
  /** Ranked associations: Pearson, Spearman, Cramér's V and η². */
  requestRelationships(): Promise<RelationshipsMessage | null>;
  /** Token profiles for text columns (up to three are read). */
  requestTextProfile(column: number): Promise<TextProfileMessage | null>;
  /** PSI / Cramér's V between the first and second half of the current rows. */
  requestDistributionChanges(): Promise<DistributionChangesMessage | null>;
  /** Near-duplicate value clusters per text column (blocked, capped). */
  requestSimilarClusters(): Promise<SimilarClustersMessage | null>;
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
  private readonly scopeEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private metas: readonly ColumnMeta[] = [];
  private stats: DatasetStats | null = null;
  private rowCount = 0;
  private visibleRowCount = 0;
  private active: ReportTab = "quality";
  private correlation: CorrelationMessage | null = null;
  private correlationLoading = false;
  private correlationRequested = false;
  private coMissingness: CoMissingnessMessage | null = null;
  private coMissingnessLoading = false;
  private coMissingnessRequested = false;
  private groupAnomalies: GroupAnomaliesMessage | null = null;
  private groupAnomaliesLoading = false;
  private groupAnomaliesRequested = false;
  private dependencies: DependenciesMessage | null = null;
  private dependenciesLoading = false;
  private dependenciesRequested = false;
  private relationships: RelationshipsMessage | null = null;
  private relationshipsLoading = false;
  private relationshipsRequested = false;
  private textProfiles: TextProfileMessage[] = [];
  private textLoading = false;
  private textRequested = false;
  private distributionChanges: DistributionChangesMessage | null = null;
  private distributionLoading = false;
  private distributionRequested = false;
  private similarClusters: SimilarClustersMessage | null = null;
  private similarLoading = false;
  private similarRequested = false;
  private explainLabel: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: ReportsPanelOptions,
  ) {
    this.root.classList.add("reports-panel");
    this.tabsEl = el("div", { class: "reports-tabs" });
    this.metaEl = el("div", { class: "reports-meta" });
    this.scopeEl = el("div", { class: "reports-scope" });
    this.listEl = el("div", { class: "reports-list" });
    this.root.append(this.tabsEl, this.metaEl, this.scopeEl, this.listEl);
  }

  setData(
    metas: readonly ColumnMeta[],
    stats: DatasetStats,
    rowCount = 0,
    visibleRowCount = rowCount,
  ): void {
    this.metas = metas;
    this.stats = stats;
    this.rowCount = rowCount;
    this.visibleRowCount = visibleRowCount;
    if (this.active === "relationships") {
      void this.loadCorrelation();
      void this.loadRelationships();
    }
    if (this.active === "quality") {
      void this.loadCoMissingness();
      void this.loadDependencies();
      void this.loadTextProfiles();
      void this.loadDistributionChanges();
      void this.loadSimilarClusters();
    }
    if (this.active === "anomalies") void this.loadGroupAnomalies();
    this.render();
  }

  show(tab: ReportTab = this.active): void {
    this.active = tab;
    if (tab === "relationships") {
      void this.loadCorrelation();
      void this.loadRelationships();
    }
    if (tab === "quality") {
      void this.loadCoMissingness();
      void this.loadDependencies();
      void this.loadTextProfiles();
      void this.loadDistributionChanges();
      void this.loadSimilarClusters();
    }
    if (tab === "anomalies") void this.loadGroupAnomalies();
    this.render();
  }

  private async loadRelationships(): Promise<void> {
    if (this.relationshipsRequested) return;
    this.relationshipsRequested = true;
    this.relationshipsLoading = true;
    this.render();
    try {
      this.relationships = await this.options.requestRelationships();
    } catch {
      this.relationships = null;
    }
    this.relationshipsLoading = false;
    this.render();
  }

  private async loadDependencies(): Promise<void> {
    if (this.dependenciesRequested) return;
    this.dependenciesRequested = true;
    this.dependenciesLoading = true;
    this.render();
    try {
      this.dependencies = await this.options.requestDependencies();
    } catch {
      this.dependencies = null;
    }
    this.dependenciesLoading = false;
    this.render();
  }

  private async loadTextProfiles(): Promise<void> {
    if (this.textRequested) return;
    this.textRequested = true;
    const columns = this.metas
      .map((meta, index) => ({ meta, index }))
      .filter((entry) => entry.meta.type === "string")
      .slice(0, 3);
    if (columns.length === 0) {
      this.render();
      return;
    }
    this.textLoading = true;
    this.render();
    try {
      const profiles = await Promise.all(
        columns.map((entry) => this.options.requestTextProfile(entry.index)),
      );
      this.textProfiles = profiles.filter(
        (profile): profile is TextProfileMessage => profile !== null,
      );
    } catch {
      this.textProfiles = [];
    }
    this.textLoading = false;
    this.render();
  }

  private async loadDistributionChanges(): Promise<void> {
    if (this.distributionRequested) return;
    this.distributionRequested = true;
    this.distributionLoading = true;
    this.render();
    try {
      this.distributionChanges = await this.options.requestDistributionChanges();
    } catch {
      this.distributionChanges = null;
    }
    this.distributionLoading = false;
    this.render();
  }

  private async loadSimilarClusters(): Promise<void> {
    if (this.similarRequested) return;
    this.similarRequested = true;
    this.similarLoading = true;
    this.render();
    try {
      this.similarClusters = await this.options.requestSimilarClusters();
    } catch {
      this.similarClusters = null;
    }
    this.similarLoading = false;
    this.render();
  }

  private async loadGroupAnomalies(): Promise<void> {
    if (this.groupAnomaliesRequested) return;
    this.groupAnomaliesRequested = true;
    this.groupAnomaliesLoading = true;
    this.render();
    try {
      this.groupAnomalies = await this.options.requestGroupAnomalies();
    } catch {
      this.groupAnomalies = null;
    }
    this.groupAnomaliesLoading = false;
    this.render();
  }

  private async loadCoMissingness(): Promise<void> {
    if (this.coMissingnessRequested) return;
    this.coMissingnessRequested = true;
    this.coMissingnessLoading = true;
    this.render();
    try {
      this.coMissingness = await this.options.requestCoMissingness();
    } catch {
      this.coMissingness = null;
    }
    this.coMissingnessLoading = false;
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

  /** Column metadata changed: cached worker payloads must be refetched. */
  invalidate(): void {
    this.correlation = null;
    this.correlationRequested = false;
    this.coMissingness = null;
    this.coMissingnessRequested = false;
    this.groupAnomalies = null;
    this.groupAnomaliesRequested = false;
    this.dependencies = null;
    this.dependenciesRequested = false;
    this.relationships = null;
    this.relationshipsRequested = false;
    this.textProfiles = [];
    this.textRequested = false;
    this.distributionChanges = null;
    this.distributionRequested = false;
    this.similarClusters = null;
    this.similarRequested = false;
    if (this.active === "relationships") {
      void this.loadCorrelation();
      void this.loadRelationships();
    }
    if (this.active === "quality") {
      void this.loadCoMissingness();
      void this.loadDependencies();
      void this.loadTextProfiles();
      void this.loadDistributionChanges();
      void this.loadSimilarClusters();
    }
    if (this.active === "anomalies") void this.loadGroupAnomalies();
  }

  setVisibleRowCount(count: number): void {
    this.visibleRowCount = count;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private findings(): Finding[] {
    if (this.stats === null) return [];
    const withScope = (
      findings: readonly Finding[],
      scope: "dataset" | "rows",
    ): Finding[] => findings.map((finding) => ({ ...finding, scope }));
    if (this.active === "quality") {
      const quality = withScope(
        qualityFindings(this.metas, this.stats, this.rowCount),
        "dataset",
      );
      if (this.textProfiles.length > 0) {
        quality.push(
          ...withScope(
            textProfileFindings(
              this.textProfiles.map((profile) => ({
                column: profile.column,
                label: profile.label,
                profile: profile.profile,
              })),
            ),
            "dataset",
          ),
        );
      }
      if (this.dependencies !== null && this.dependencies.pairs.length > 0) {
        quality.push(...withScope(dependencyFindings(this.dependencies.pairs), "dataset"));
      }
      if (this.distributionChanges !== null && this.distributionChanges.changes.length > 0) {
        quality.push(
          ...withScope(distributionFindings(this.distributionChanges.changes), "rows"),
        );
      }
      if (this.similarClusters !== null && this.similarClusters.entries.length > 0) {
        quality.push(
          ...withScope(similarClusterFindings(this.similarClusters.entries), "rows"),
        );
      }
      if (this.coMissingness !== null) {
        quality.push(
          ...withScope(
            coMissingnessFindings(
              this.coMissingness.columns,
              this.coMissingness.labels,
              this.coMissingness.nullCells,
              this.coMissingness.pairs,
            ),
            "rows",
          ),
        );
      }
      quality.sort(
        (a, b) =>
          (b.severity === "fix" ? 2 : b.severity === "review" ? 1 : 0) -
            (a.severity === "fix" ? 2 : a.severity === "review" ? 1 : 0) ||
          b.impact.rows - a.impact.rows,
      );
      return quality;
    }
    if (this.active === "anomalies") {
      const findings = withScope(anomalyFindings(this.metas), "dataset");
      if (this.groupAnomalies !== null && this.groupAnomalies.pairs.length > 0) {
        findings.push(...withScope(groupAnomalyFindings(this.groupAnomalies.pairs), "dataset"));
        findings.sort((a, b) => b.impact.rows - a.impact.rows);
      }
      return findings;
    }
    if (this.active === "relationships") {
      if (this.explainLabel !== null && this.correlation !== null) {
        return withScope(
          explainColumn(
            this.correlation.labels,
            this.correlation.columns,
            this.correlation.result.values,
            this.correlation.result.counts,
            this.explainLabel,
          ).findings,
          "rows",
        );
      }
      if (this.relationships !== null) {
        return withScope(
          relationshipDataFindings(this.relationships.relationships),
          "rows",
        );
      }
      if (this.correlation === null) return [];
      return withScope(
        relationshipFindings(
          this.correlation.labels,
          this.correlation.columns,
          this.correlation.result.values,
          this.correlation.result.counts,
        ),
        "rows",
      );
    }
    return [];
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
    const loadingNote = this.correlationLoading
      ? " · computing relationships…"
      : this.relationshipsLoading
        ? " · computing relationships…"
        : this.coMissingnessLoading
          ? " · checking missing-together…"
          : this.groupAnomaliesLoading
            ? " · checking within-group outliers…"
            : this.dependenciesLoading
              ? " · checking key relationships…"
              : this.textLoading
                ? " · reading text columns…"
                : this.distributionLoading
                  ? " · comparing row halves…"
                  : this.similarLoading
                    ? " · finding near-duplicates…"
                : "";
    this.metaEl.textContent =
      this.stats === null
        ? ""
        : `${findings.length.toLocaleString()} finding${findings.length === 1 ? "" : "s"} · ${fixes} fix · ${reviews} review${loadingNote}`;
    this.scopeEl.textContent =
      this.stats === null
        ? ""
        : `${describeScope({
            total: this.rowCount,
            visible: this.visibleRowCount,
          })} · Scope is shown on each finding`;

    clear(this.listEl);
    if (this.stats === null) {
      this.listEl.append(el("div", { class: "reports-empty" }, ["Load data to run reports."]));
      return;
    }
    if (this.active === "relationships" && this.correlation !== null) {
      this.renderRelationshipControls(this.correlation);
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

  /** "Explain [column]" selector plus the generated sentence. */
  private renderRelationshipControls(correlation: CorrelationMessage): void {
    const controls = el("div", { class: "reports-controls" });
    const label = el("span", { class: "reports-control-label" }, ["Explain"]);
    const select = el("select", {
      class: "reports-explain",
      "aria-label": "Explain a column",
    }) as HTMLSelectElement;
    select.append(el("option", { value: "" }, ["All pairs"]) as HTMLOptionElement);
    for (const name of correlation.labels) {
      select.append(el("option", { value: name }, [name]) as HTMLOptionElement);
    }
    select.value = this.explainLabel ?? "";
    select.addEventListener("change", () => {
      this.explainLabel = select.value === "" ? null : select.value;
      this.render();
    });
    controls.append(
      label,
      select,
      el("span", { class: "reports-control-hint" }, [
        "Pearson over pairwise-complete rows · associated with, not causes",
      ]),
    );
    this.listEl.append(controls);
    if (this.explainLabel !== null) {
      const { sentence } = explainColumn(
        correlation.labels,
        correlation.columns,
        correlation.result.values,
        correlation.result.counts,
        this.explainLabel,
      );
      this.listEl.append(el("div", { class: "reports-sentence" }, [sentence]));
    }
  }

  private renderFinding(finding: Finding): HTMLElement {
    const row = el("div", { class: `finding finding-${finding.severity}` });
    const body = el("div", { class: "finding-body" });
    const badge = el("span", { class: `finding-badge ${finding.severity}` }, [
      finding.severity === "fix" ? "Fix" : finding.severity === "review" ? "Review" : "Info",
    ]);
    const scope = el(
      "span",
      {
        class: `finding-scope finding-scope-${finding.scope ?? "dataset"}`,
        title: "Rows this finding describes",
      },
      [finding.scope === "rows" ? "Current rows" : "Whole dataset"],
    );
    body.append(
      el("div", { class: "finding-title-row" }, [
        badge,
        scope,
        el("span", { class: "finding-title" }, [finding.title]),
      ]),
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
    for (const extra of finding.extraActions ?? []) {
      const button = el(
        "button",
        {
          class: "ghost small",
          type: "button",
          title: "Runs the remedy as a Recipe step — undo is offered in the Recipe",
        },
        [extra.label],
      ) as HTMLButtonElement;
      button.addEventListener("click", () =>
        this.options.onAction({ ...finding, action: extra.action, fixLabel: extra.label }),
      );
      row.append(button);
    }
    return row;
  }
}
