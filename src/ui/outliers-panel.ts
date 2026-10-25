import type { DatasetStats } from "../data/stats.js";
import {
  anomalyFindings,
  explainColumn,
  groupAnomalyFindings,
  type Finding,
} from "../data/findings.js";
import type {
  ColumnMeta,
  CorrelationMessage,
  DependenciesMessage,
  GroupAnomaliesMessage,
  OutlierAnalysisMessage,
  OutlierMethod,
  OutlierMode,
  RelationshipsMessage,
  SimilarClustersMessage,
} from "../worker/protocol.js";
import {
  formatCount,
  isIdLikeColumn,
  isNumericType,
} from "./chart-utils.js";
import { clear, el } from "./dom.js";
import { describeScope } from "./scope.js";

export type OutliersTab = "outliers" | "relationships";
type SelectedMethod = OutlierMethod | "value" | "group";

export interface OutliersPanelOptions {
  /** Runs one multivariate analysis in the worker. */
  requestOutlier(input: {
    method: OutlierMethod;
    columns: number[];
    contamination: number;
    mode: OutlierMode;
    seed?: number;
    respectFilters?: boolean;
  }): Promise<OutlierAnalysisMessage>;
  requestCorrelation(respectFilters: boolean): Promise<CorrelationMessage | null>;
  requestRelationships(respectFilters: boolean): Promise<RelationshipsMessage | null>;
  requestDependencies(respectFilters: boolean): Promise<DependenciesMessage | null>;
  requestGroupAnomalies(): Promise<GroupAnomaliesMessage | null>;
  requestSimilarClusters(): Promise<SimilarClustersMessage | null>;
  /** Activates the stored outlier BitSet and opens the table. */
  onShowOutliers(): void;
  /** Clears the outlier special filter. */
  onClearOutliers(): void;
  /** Filters a category column to one value code. */
  onFilterValue(column: number, code: number): void;
  /** Runs a finding's existing action (filters, fixes, clean). */
  onFinding(finding: Finding): void;
}

const TABS: readonly { id: OutliersTab; label: string; title: string }[] = [
  {
    id: "outliers",
    label: "Outliers",
    title: "Anomaly landscape, method agreement and the rows that stand out",
  },
  {
    id: "relationships",
    label: "Relationships",
    title: "How columns move together: correlations, associations and dependencies",
  },
];

const METHODS: readonly {
  id: OutlierMethod;
  label: string;
  blurb: string;
  needs: string;
  route: string;
}[] = [
  {
    id: "isolationForest",
    label: "Isolation Forest",
    blurb: "Global anomalies across many numeric columns.",
    needs: "2+ numeric features, complete rows",
    route: "Quick: up to 500k rows · Deep: 200 trees",
  },
  {
    id: "pca",
    label: "PCA reconstruction",
    blurb: "Rows that break the linear correlations between metrics.",
    needs: "2+ numeric features, linear structure",
    route: "Quick: up to 1M × 20 features · Deep: 1M × 40",
  },
  {
    id: "lof",
    label: "LOF",
    blurb: "Local anomalies where a row is unlike its own neighbourhood.",
    needs: "2+ numeric features, enough rows",
    route: "Quick: 50k rows · Deep: 100k rows",
  },
];

const CONTAMINATION_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0.005, label: "Top 0.5%" },
  { value: 0.01, label: "Top 1%" },
  { value: 0.05, label: "Top 5%" },
];

const METHOD_LABELS: Record<OutlierMethod, string> = {
  isolationForest: "Isolation Forest",
  pca: "PCA reconstruction",
  lof: "LOF",
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  pearson: "Pearson r",
  spearman: "Spearman ρ",
  cramersV: "Cramér's V",
  eta2: "η²",
};

function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value >= 100 ? formatCount(value) : value.toFixed(value >= 10 ? 1 : 3);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value > 0.1 ? 0 : 1)}%`;
}

function colorForCorrelation(value: number): string {
  const strength = Math.min(1, Math.abs(value));
  return value >= 0
    ? `rgba(220, 38, 38, ${0.12 + strength * 0.78})`
    : `rgba(37, 99, 235, ${0.12 + strength * 0.78})`;
}

function textColorForCorrelation(value: number): string {
  return Math.abs(value) > 0.55 ? "#fff" : "var(--text)";
}

interface Point {
  x: number;
  y: number;
  row: number;
  flagged: boolean;
}

const NETWORK_WIDTH = 620;
const NETWORK_HEIGHT = 300;

/**
 * The Outliers lens: a visual anomaly dashboard plus a Relationships tab. The
 * multivariate work happens in the worker; this panel owns selection, cached
 * results, comparison and the story around the numbers.
 */
export class OutliersPanel {
  private readonly tabsEl: HTMLElement;
  private readonly contentEl: HTMLElement;
  private metas: readonly ColumnMeta[] = [];
  private stats: DatasetStats | null = null;
  private rowCount = 0;
  private visibleRowCount = 0;
  private active: OutliersTab = "outliers";
  private method: SelectedMethod = "isolationForest";
  private respectFilters = true;
  private contamination = 0.01;
  private selectedFeatures = new Set<number>();
  private featureSignature = "";
  private results = new Map<string, OutlierAnalysisMessage>();
  private preferredMode: OutlierMode = "quick";
  private running: { method: OutlierMethod; mode: OutlierMode; token: number } | null = null;
  private runToken = 0;
  private scopeVersion = 0;
  private status = "";
  private error = "";
  private selectedDetail: { method: OutlierMethod; row: number; mode: OutlierMode } | null = null;
  private groupResult: GroupAnomaliesMessage | null = null;
  private groupLoading = false;
  private similarClusters: SimilarClustersMessage | null = null;
  private similarRequested = false;
  private similarLoading = false;
  private correlation: CorrelationMessage | null = null;
  private correlationRequested = false;
  private correlationLoading = false;
  private relationships: RelationshipsMessage | null = null;
  private relationshipsRequested = false;
  private relationshipsLoading = false;
  private dependencies: DependenciesMessage | null = null;
  private dependenciesRequested = false;
  private dependenciesLoading = false;
  private explainLabel: string | null = null;
  private selectedRelationship: number | null = null;
  private selectedDependency: number | null = null;
  private relationshipToken = 0;
  private visualPoints: Point[] = [];
  private visualTooltip: HTMLElement | null = null;
  private networkEdges: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    index: number;
  }[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly options: OutliersPanelOptions,
  ) {
    this.root.classList.add("outliers-panel");
    this.tabsEl = el("div", { class: "outliers-tabs" });
    this.contentEl = el("div", { class: "outliers-content" });
    this.root.append(this.tabsEl, this.contentEl);
  }

  setData(
    metas: readonly ColumnMeta[],
    stats: DatasetStats,
    rowCount = 0,
    visibleRowCount = rowCount,
  ): void {
    const schemaChanged =
      this.metas.length !== metas.length ||
      this.metas.some((meta, index) => meta.name !== metas[index]?.name);
    this.metas = metas;
    this.stats = stats;
    this.rowCount = rowCount;
    this.visibleRowCount = visibleRowCount;
    this.scopeVersion++;
    if (schemaChanged || this.selectedFeatures.size === 0) {
      this.selectedFeatures = new Set(this.defaultFeatures());
      this.clearResults();
    }
    this.featureSignature = [...this.selectedFeatures].sort((a, b) => a - b).join(",");
    this.render();
  }

  setVisibleRowCount(count: number): void {
    if (count === this.visibleRowCount) return;
    this.visibleRowCount = count;
    this.scopeVersion++;
    this.clearResults();
    this.resetRelationshipCache();
    if (this.active === "relationships") void this.ensureRelationships();
    this.render();
  }

  show(tab: OutliersTab = this.active): void {
    this.active = tab;
    if (tab === "relationships") this.ensureRelationships();
    this.render();
  }

  refresh(): void {
    this.render();
  }

  invalidate(): void {
    this.clearResults();
    this.groupResult = null;
    this.similarClusters = null;
    this.similarRequested = false;
    this.resetRelationshipCache();
    if (this.active === "relationships") void this.ensureRelationships();
    this.render();
  }

  private defaultFeatures(): number[] {
    const out: number[] = [];
    this.metas.forEach((meta, index) => {
      if (out.length >= 8) return;
      if (meta.role === "provenance") return;
      if (!isNumericType(meta.type)) return;
      if (isIdLikeColumn(meta, this.rowCount)) return;
      out.push(index);
    });
    return out;
  }

  private numericFeatures(): { index: number; meta: ColumnMeta }[] {
    const out: { index: number; meta: ColumnMeta }[] = [];
    this.metas.forEach((meta, index) => {
      if (meta.role === "provenance") return;
      if (!isNumericType(meta.type)) return;
      if (isIdLikeColumn(meta, this.rowCount)) return;
      out.push({ index, meta });
    });
    return out;
  }

  private key(method: OutlierMethod, mode: OutlierMode): string {
    return `${method}|${mode}|${this.respectFilters ? "current" : "all"}|${this.contamination}|${this.featureSignature}`;
  }

  private resultFor(method: OutlierMethod, mode: OutlierMode = "quick"): OutlierAnalysisMessage | null {
    return this.results.get(this.key(method, mode)) ?? null;
  }

  private clearResults(): void {
    this.results.clear();
    this.selectedDetail = null;
    this.scopeVersion++;
  }

  private resetRelationshipCache(): void {
    this.relationshipToken++;
    this.correlation = null;
    this.correlationRequested = false;
    this.correlationLoading = false;
    this.relationships = null;
    this.relationshipsRequested = false;
    this.relationshipsLoading = false;
    this.dependencies = null;
    this.dependenciesRequested = false;
    this.dependenciesLoading = false;
    this.selectedRelationship = null;
    this.selectedDependency = null;
  }

  private async ensureRelationships(): Promise<void> {
    const token = this.relationshipToken;
    if (!this.correlationRequested) {
      this.correlationRequested = true;
      this.correlationLoading = true;
      this.render();
      try {
        const message = await this.options.requestCorrelation(this.respectFilters);
        if (token === this.relationshipToken) this.correlation = message;
      } catch {
        if (token === this.relationshipToken) this.correlation = null;
      }
      if (token === this.relationshipToken) this.correlationLoading = false;
    }
    if (!this.relationshipsRequested) {
      this.relationshipsRequested = true;
      this.relationshipsLoading = true;
      this.render();
      try {
        const message = await this.options.requestRelationships(this.respectFilters);
        if (token === this.relationshipToken) this.relationships = message;
      } catch {
        if (token === this.relationshipToken) this.relationships = null;
      }
      if (token === this.relationshipToken) this.relationshipsLoading = false;
    }
    if (!this.dependenciesRequested) {
      this.dependenciesRequested = true;
      this.dependenciesLoading = true;
      this.render();
      try {
        const message = await this.options.requestDependencies(this.respectFilters);
        if (token === this.relationshipToken) this.dependencies = message;
      } catch {
        if (token === this.relationshipToken) this.dependencies = null;
      }
      if (token === this.relationshipToken) this.dependenciesLoading = false;
    }
    if (token === this.relationshipToken) this.render();
  }

  private async analyze(method: OutlierMethod, mode: OutlierMode): Promise<void> {
    if (this.running !== null) return;
    const columns = [...this.selectedFeatures].sort((a, b) => a - b);
    if (columns.length < 2) {
      this.error = "Select at least two numeric features.";
      this.render();
      return;
    }
    const token = ++this.runToken;
    const scopeVersion = this.scopeVersion;
    this.running = { method, mode, token };
    this.selectedDetail = null;
    this.error = "";
    this.status =
      mode === "deep"
        ? "Deep compute running — quick results stay available."
        : "Running the quick scan…";
    this.render();
    try {
      const result = await this.options.requestOutlier({
        method,
        columns,
        contamination: this.contamination,
        mode,
        seed: 42,
        respectFilters: this.respectFilters,
      });
      if (token !== this.runToken || scopeVersion !== this.scopeVersion) return;
      this.results.set(this.key(method, mode), result);
      this.method = method;
      this.preferredMode = mode;
      this.status = `${METHOD_LABELS[method]} ${mode} scan finished in ${Math.round(result.ms)} ms.`;
    } catch (caught) {
      if (token !== this.runToken || scopeVersion !== this.scopeVersion) return;
      this.error = caught instanceof Error ? caught.message : "The analysis could not run.";
      this.status = "";
    } finally {
      if (token === this.runToken) {
        this.running = null;
        this.render();
      }
    }
  }

  private async compareMethods(): Promise<void> {
    if (this.running !== null) return;
    const original = this.method;
    for (const entry of METHODS) {
      if (this.resultFor(entry.id) !== null) continue;
      await this.analyze(entry.id, "quick");
      if (this.running !== null) continue;
    }
    this.method = original;
    this.status = "Compared the available methods on the same rows and threshold.";
    this.render();
  }

  private cancelRun(): void {
    if (this.running === null) return;
    this.runToken++;
    this.running = null;
    this.status = "Analysis cancelled; the previous result is unchanged.";
    this.render();
  }

  private async loadSimilarClusters(): Promise<void> {
    if (this.similarRequested || this.similarLoading) return;
    this.similarRequested = true;
    this.similarLoading = true;
    try {
      this.similarClusters = await this.options.requestSimilarClusters();
    } catch {
      this.similarClusters = null;
    }
    this.similarLoading = false;
    if (this.active === "outliers") this.render();
  }

  private async loadGroupAnomalies(): Promise<void> {
    if (this.groupLoading) return;
    this.groupLoading = true;
    this.render();
    try {
      this.groupResult = await this.options.requestGroupAnomalies();
    } catch {
      this.groupResult = null;
    }
    this.groupLoading = false;
    this.render();
  }

  private render(): void {
    clear(this.tabsEl);
    for (const tab of TABS) {
      const button = el(
        "button",
        {
          class: `outliers-tab${tab.id === this.active ? " active" : ""}`,
          type: "button",
          title: tab.title,
        },
        [tab.label],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => this.show(tab.id));
      this.tabsEl.append(button);
    }
    clear(this.contentEl);
    if (this.stats === null) {
      this.contentEl.append(
        el("div", { class: "outliers-empty" }, ["Load data to explore outliers."]),
      );
      return;
    }
    if (this.active === "outliers") this.renderOutliers();
    else this.renderRelationships();
  }

  // ---------- shared controls ----------

  private buildScopeBar(): HTMLElement {
    const bar = el("div", { class: "outliers-scope" });
    const scope = el("div", { class: "outliers-scope-group" });
    scope.append(el("span", { class: "outliers-scope-label" }, ["Scope"]));
    const current = el(
      "button",
      {
        class: `outliers-chip${this.respectFilters ? " active" : ""}`,
        type: "button",
        title: "Analyse only the rows currently visible in the table",
      },
      [`Current rows (${this.visibleRowCount.toLocaleString()})`],
    ) as HTMLButtonElement;
    current.addEventListener("click", () => {
      if (this.respectFilters) return;
      this.respectFilters = true;
      this.clearResults();
      this.resetRelationshipCache();
      this.render();
    });
    const whole = el(
      "button",
      {
        class: `outliers-chip${this.respectFilters ? "" : " active"}`,
        type: "button",
        title: "Ignore the table filters and analyse every row",
      },
      [`Whole dataset (${this.rowCount.toLocaleString()})`],
    ) as HTMLButtonElement;
    whole.addEventListener("click", () => {
      if (!this.respectFilters) return;
      this.respectFilters = false;
      this.clearResults();
      this.resetRelationshipCache();
      this.render();
    });
    scope.append(current, whole);

    const threshold = el("label", { class: "outliers-scope-group" });
    threshold.append(el("span", { class: "outliers-scope-label" }, ["Flag"]));
    const select = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Contamination threshold",
    }) as HTMLSelectElement;
    for (const option of CONTAMINATION_OPTIONS) {
      select.append(el("option", { value: String(option.value) }, [option.label]) as HTMLOptionElement);
    }
    select.value = String(this.contamination);
    select.addEventListener("change", () => {
      this.contamination = Number(select.value);
      this.clearResults();
      this.render();
    });
    threshold.append(select);

    const scopeText = el("span", { class: "outliers-scope-note" }, [
      describeScope({ total: this.rowCount, visible: this.visibleRowCount }),
    ]);
    bar.append(scope, threshold, scopeText);
    return bar;
  }

  private buildFeaturePicker(): HTMLElement {
    const wrap = el("div", { class: "outliers-features" });
    const features = this.numericFeatures();
    wrap.append(
      el("span", { class: "outliers-scope-label" }, [
        `Features (${this.selectedFeatures.size} of ${features.length})`,
      ]),
    );
    if (features.length === 0) {
      wrap.append(
        el("span", { class: "outliers-hint" }, [
          "No numeric features found — use the value outlier checks below.",
        ]),
      );
      return wrap;
    }
    const chips = el("div", { class: "outliers-feature-chips" });
    for (const entry of features.slice(0, 20)) {
      const selected = this.selectedFeatures.has(entry.index);
      const chip = el(
        "button",
        {
          class: `outliers-chip${selected ? " active" : ""}`,
          type: "button",
          title: `${entry.meta.name} (${entry.meta.type})`,
        },
        [entry.meta.name],
      ) as HTMLButtonElement;
      chip.addEventListener("click", () => {
        if (this.selectedFeatures.has(entry.index)) {
          if (this.selectedFeatures.size <= 2) {
            this.status = "Keep at least two features selected.";
            this.render();
            return;
          }
          this.selectedFeatures.delete(entry.index);
        } else {
          this.selectedFeatures.add(entry.index);
        }
        this.featureSignature = [...this.selectedFeatures].sort((a, b) => a - b).join(",");
        this.clearResults();
        this.render();
      });
      chips.append(chip);
    }
    wrap.append(chips);
    if (features.length > 20) {
      wrap.append(
        el("span", { class: "outliers-hint" }, [
          `${(features.length - 20).toLocaleString()} more numeric features are not shown; the worker also caps the matrix for latency.`,
        ]),
      );
    }
    return wrap;
  }

  private buildActions(): HTMLElement {
    const row = el("div", { class: "outliers-actions" });
    const multivariate = this.method !== "value" && this.method !== "group";
    const quick = el(
      "button",
      { class: "primary small", type: "button" },
      [
        this.running?.mode === "quick"
          ? "Running…"
          : this.method === "value"
            ? "Refresh value checks"
            : this.method === "group"
              ? "Scan groups"
              : "Run quick scan",
      ],
    ) as HTMLButtonElement;
    quick.disabled =
      this.running !== null || (multivariate && this.selectedFeatures.size < 2);
    quick.addEventListener("click", () => {
      if (this.method === "group") {
        void this.loadGroupAnomalies();
        return;
      }
      if (this.method === "value") {
        this.render();
        return;
      }
      void this.analyze(this.method, "quick");
    });
    const deep = el(
      "button",
      {
        class: "ghost small outliers-deep",
        type: "button",
        title: "Thorough analysis; typically 10–30 seconds. Quick results stay visible.",
      },
      [this.running?.mode === "deep" ? "Deep compute running…" : "🧠 Deep compute"],
    ) as HTMLButtonElement;
    deep.disabled =
      this.running !== null || !multivariate || this.selectedFeatures.size < 2;
    deep.addEventListener("click", () => {
      if (multivariate) void this.analyze(this.method as OutlierMethod, "deep");
    });
    const compare = el(
      "button",
      {
        class: "ghost small",
        type: "button",
        title: "Run the missing methods on the same rows and threshold",
      },
      ["Compare methods"],
    ) as HTMLButtonElement;
    compare.disabled = this.running !== null;
    compare.addEventListener("click", () => void this.compareMethods());
    row.append(quick, deep, compare);
    if (this.running !== null) {
      row.append(
        el("span", { class: "outliers-progress" }, [
          el("span", { class: "outliers-progress-bar" }),
        ]),
      );
      const cancel = el("button", { class: "ghost small", type: "button" }, ["Cancel"]);
      cancel.addEventListener("click", () => this.cancelRun());
      row.append(cancel);
    }
    const estimate =
      this.running !== null
        ? this.running.mode === "deep"
          ? "~10–30s"
          : "a few seconds"
        : this.method === "lof"
          ? "quick ~2–4s · deep ~10–30s"
          : this.method === "pca"
            ? "quick ~1s · deep ~5–15s"
            : "quick ~1–3s · deep ~10–30s";
    row.append(el("span", { class: "outliers-hint" }, [estimate]));
    return row;
  }

  // ---------- Outliers tab ----------

  private renderOutliers(): void {
    void this.loadSimilarClusters();
    const wrap = el("div", { class: "outliers-outliers" });
    wrap.append(this.buildScopeBar(), this.buildFeaturePicker(), this.buildActions());
    wrap.append(this.buildMethodCards());

    const result =
      this.method === "value" || this.method === "group"
        ? null
        : this.resultFor(this.method, this.preferredMode) ??
          this.resultFor(this.method, "quick") ??
          this.resultFor(this.method, "deep");
    if (this.status !== "" || this.error !== "") {
      wrap.append(
        el("div", { class: `outliers-status${this.error !== "" ? " error" : ""}`, role: "status" }, [
          this.error !== "" ? this.error : this.status,
        ]),
      );
    }

    if (this.method === "value") {
      wrap.append(this.buildValueOutliers());
    } else if (this.method === "group") {
      wrap.append(this.buildGroupOutliers());
    } else if (result !== null) {
      wrap.append(
        this.buildRecipe(result),
        this.buildInsightStrip(result),
        this.buildLandscape(result),
        this.buildScoreDistribution(result),
        this.buildAgreement(),
        this.buildTopOutliers(result),
      );
      if (this.selectedDetail !== null) wrap.append(this.buildDetailPanel());
    } else {
      wrap.append(
        el("div", { class: "outliers-empty" }, [
          "Pick a method and run a quick scan. The page only computes the heavy multivariate pass when you ask.",
        ]),
      );
    }

    wrap.append(this.buildCategoricalSignals());
    this.contentEl.append(wrap);
    if (result !== null) {
      const canvas = this.contentEl.querySelector<HTMLCanvasElement>(".outliers-landscape-canvas");
      if (canvas !== null) this.drawLandscape(canvas, result);
      const histogram = this.contentEl.querySelector<HTMLElement>(".outliers-histogram");
      if (histogram !== null) this.connectHistogram(histogram, result);
    }
  }

  private buildMethodCards(): HTMLElement {
    const grid = el("div", { class: "outliers-methods" });
    for (const entry of METHODS) {
      const result = this.resultFor(entry.id);
      const card = el(
        "button",
        {
          class: `outliers-method${this.method === entry.id ? " active" : ""}`,
          type: "button",
          title: entry.blurb,
        },
      ) as HTMLButtonElement;
      card.append(
        el("span", { class: "outliers-method-title" }, [entry.label]),
        el("span", { class: "outliers-method-blurb" }, [entry.blurb]),
        el("span", { class: "outliers-method-needs" }, [entry.needs]),
        el("span", { class: "outliers-method-route" }, [entry.route]),
      );
      if (result !== null) {
        card.append(
          el("span", { class: "outliers-method-run" }, [
            `${result.flagged.toLocaleString()} flagged · ${Math.round(result.ms)} ms`,
          ]),
        );
      }
      card.addEventListener("click", () => {
        this.method = entry.id;
        this.render();
      });
      grid.append(card);
    }
    for (const entry of [
      {
        id: "value" as const,
        label: "Value outliers",
        blurb: "Single-column robust fences and text-length anomalies.",
        needs: "Any column type",
        route: "Instant · existing checks",
      },
      {
        id: "group" as const,
        label: "Group-relative",
        blurb: "Values unusual next to their own category peers.",
        needs: "A numeric value and a category group",
        route: "Fast robust z within groups",
      },
    ]) {
      const card = el(
        "button",
        {
          class: `outliers-method${this.method === entry.id ? " active" : ""}`,
          type: "button",
        },
      ) as HTMLButtonElement;
      card.append(
        el("span", { class: "outliers-method-title" }, [entry.label]),
        el("span", { class: "outliers-method-blurb" }, [entry.blurb]),
        el("span", { class: "outliers-method-needs" }, [entry.needs]),
        el("span", { class: "outliers-method-route" }, [entry.route]),
      );
      card.addEventListener("click", () => {
        this.method = entry.id;
        if (entry.id === "group" && !this.groupLoading && this.groupResult === null) {
          void this.loadGroupAnomalies();
        }
        this.render();
      });
      grid.append(card);
    }
    return grid;
  }

  private buildRecipe(result: OutlierAnalysisMessage): HTMLElement {
    const line = el("div", { class: "outliers-recipe" });
    const parts = [
      METHOD_LABELS[result.method],
      result.mode === "deep" ? "Deep compute" : "Quick scan",
      this.respectFilters ? "current rows" : "whole dataset",
      `flagged top ${formatPercent(this.contamination)}`,
      `${result.analyzed.toLocaleString()} analysed`,
      `${result.excluded.toLocaleString()} excluded (missing)`,
      `${result.labels.length} features`,
    ];
    if (result.sampled) {
      const eligible = Math.max(result.analyzed, result.totalRows - result.excluded);
      parts.push(`deterministic sample of ${eligible.toLocaleString()} eligible rows`);
    }
    if (result.omittedFeatures > 0) parts.push(`${result.omittedFeatures} low-spread features omitted`);
    if (result.projected) parts.push(`LOF on ${result.projectionComponents}-component PCA projection`);
    parts.push(`${Math.round(result.ms)} ms`);
    line.textContent = parts.join(" · ");
    return line;
  }

  private buildInsightStrip(result: OutlierAnalysisMessage): HTMLElement {
    const strip = el("div", { class: "outliers-insights" });
    const share = result.analyzed > 0 ? result.flagged / result.analyzed : 0;
    const strongest = [...result.featureImportance].sort((a, b) => b.weight - a.weight)[0];
    const cards: { text: string; action?: () => void; title: string }[] = [
      {
        title: "Flagged rows",
        text: `${result.flagged.toLocaleString()} of ${result.analyzed.toLocaleString()} analysed rows are unusual (${formatPercent(share)}).`,
        action: () => this.options.onShowOutliers(),
      },
      {
        title: "Strongest signal",
        text: strongest === undefined
          ? "No single feature dominates this model."
          : `${strongest.label} carries the strongest ${METHOD_LABELS[result.method]} signal.`,
      },
    ];
    if (this.selectedDetail === null) {
      cards.push({
        title: "What next",
        text: "Click a landscape point or a ranked row to inspect the values behind the score.",
      });
    }
    const agreement = this.agreementSummary();
    if (agreement !== null) {
      cards.push({
        title: "Method agreement",
        text: `${agreement.twoPlus.toLocaleString()} rows are flagged by 2+ methods; ${agreement.single.toLocaleString()} only by one.`,
      });
    }
    for (const card of cards) {
      const className = `outliers-insight${card.action === undefined ? "" : " clickable"}`;
      const content = [
        el("span", { class: "outliers-insight-label" }, [card.title]),
        el("span", { class: "outliers-insight-text" }, [card.text]),
      ];
      if (card.action === undefined) {
        strip.append(el("div", { class: className, title: card.title }, content));
      } else {
        const node = el(
          "button",
          { class: className, type: "button", title: card.title },
          content,
        ) as HTMLButtonElement;
        node.addEventListener("click", card.action);
        strip.append(node);
      }
    }
    return strip;
  }

  private buildLandscape(result: OutlierAnalysisMessage): HTMLElement {
    const section = el("section", { class: "outliers-section" });
    const head = el("div", { class: "outliers-section-head" });
    head.append(
      el("h3", {}, ["Anomaly landscape"]),
      el("span", { class: "outliers-hint" }, [
        "Sampled 2-D projection · orange points are flagged · hover to inspect",
      ]),
    );
    const wrap = el("div", { class: "outliers-landscape" });
    const canvas = el("canvas", {
      class: "outliers-landscape-canvas",
      role: "img",
      "aria-label": `Anomaly landscape for ${METHOD_LABELS[result.method]}`,
    }) as HTMLCanvasElement;
    canvas.width = 640;
    canvas.height = 240;
    const tooltip = el("div", { class: "outliers-canvas-tooltip hidden", role: "tooltip" });
    this.visualTooltip = tooltip;
    canvas.addEventListener("pointermove", (event) => this.hoverLandscape(event as PointerEvent));
    canvas.addEventListener("pointerleave", () => tooltip.classList.add("hidden"));
    canvas.addEventListener("click", (event) => this.clickLandscape(event as MouseEvent));
    wrap.append(canvas, tooltip);
    section.append(head, wrap);
    return section;
  }

  private drawLandscape(canvas: HTMLCanvasElement, result: OutlierAnalysisMessage): void {
    const wrap = canvas.parentElement;
    const width = Math.max(320, Math.round(wrap?.clientWidth ?? 640));
    const height = 240;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearCanvas(ctx, width, height);
    const xs = Array.from(result.visualX);
    const ys = Array.from(result.visualY);
    if (xs.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const value of xs) {
      if (value < minX) minX = value;
      if (value > maxX) maxX = value;
    }
    for (const value of ys) {
      if (value < minY) minY = value;
      if (value > maxY) maxY = value;
    }
    if (!(maxX > minX)) {
      minX -= 1;
      maxX += 1;
    }
    if (!(maxY > minY)) {
      minY -= 1;
      maxY += 1;
    }
    const pad = 14;
    const px = (value: number): number =>
      pad + ((value - minX) / (maxX - minX)) * (width - pad * 2);
    const py = (value: number): number =>
      height - pad - ((value - minY) / (maxY - minY)) * (height - pad * 2);
    this.visualPoints = [];
    for (let i = 0; i < xs.length; i++) {
      const flagged = (result.visualFlagged[i] ?? 0) === 1;
      this.visualPoints.push({
        x: px(xs[i] ?? 0),
        y: py(ys[i] ?? 0),
        row: result.visualRows[i] ?? 0,
        flagged,
      });
    }
    // Soft density backdrop: translucent cells behind the points make the
    // normal clusters legible before the eye finds the orange outliers.
    const binsX = 40;
    const binsY = 20;
    const density = new Uint32Array(binsX * binsY);
    let peak = 1;
    for (const point of this.visualPoints) {
      if (point.flagged) continue;
      const bx = Math.min(
        binsX - 1,
        Math.max(0, Math.floor(((point.x - pad) / Math.max(1, width - pad * 2)) * binsX)),
      );
      const by = Math.min(
        binsY - 1,
        Math.max(0, Math.floor(((point.y - pad) / Math.max(1, height - pad * 2)) * binsY)),
      );
      const index = by * binsX + bx;
      density[index] = (density[index] ?? 0) + 1;
      if ((density[index] ?? 0) > peak) peak = density[index] ?? 1;
    }
    ctx.fillStyle = cssVar("--accent", "#2563eb");
    for (let by = 0; by < binsY; by++) {
      for (let bx = 0; bx < binsX; bx++) {
        const count = density[by * binsX + bx] ?? 0;
        if (count === 0) continue;
        ctx.globalAlpha = 0.03 + 0.1 * (count / peak);
        ctx.fillRect(
          pad + (bx / binsX) * (width - pad * 2),
          pad + (by / binsY) * (height - pad * 2),
          (width - pad * 2) / binsX + 0.5,
          (height - pad * 2) / binsY + 0.5,
        );
      }
    }
    ctx.globalAlpha = 1;
    for (const point of this.visualPoints) {
      if (point.flagged) continue;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = cssVar("--accent", "#2563eb");
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const point of this.visualPoints) {
      if (!point.flagged) continue;
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = cssVar("--text-dim", "#62707f");
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText("projection component 2", 8, 14);
  }

  private clickLandscape(event: MouseEvent): void {
    const canvas = event.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let nearest: Point | null = null;
    let distance = 12;
    for (const point of this.visualPoints) {
      const current = Math.hypot(point.x - x, point.y - y);
      if (current < distance) {
        distance = current;
        nearest = point;
      }
    }
    if (nearest === null) return;
    for (const method of ["isolationForest", "pca", "lof"] as const) {
      const result =
        this.resultFor(method, this.preferredMode) ?? this.resultFor(method, "quick");
      if (result?.details.some((detail) => detail.row === nearest.row) === true) {
        this.selectedDetail = { method, row: nearest.row, mode: result.mode };
        this.render();
        return;
      }
    }
    this.status = `Row ${(nearest.row + 1).toLocaleString()} · ${
      nearest.flagged ? "flagged" : "inside the normal cloud"
    } · open Top outliers for detail`;
    this.render();
  }

  private hoverLandscape(event: PointerEvent): void {
    const tooltip = this.visualTooltip;
    if (tooltip === null) return;
    const canvas = event.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let nearest: Point | null = null;
    let distance = 10;
    for (const point of this.visualPoints) {
      const current = Math.hypot(point.x - x, point.y - y);
      if (current < distance) {
        distance = current;
        nearest = point;
      }
    }
    if (nearest === null) {
      tooltip.classList.add("hidden");
      return;
    }
    tooltip.classList.remove("hidden");
    tooltip.textContent = `Row ${(nearest.row + 1).toLocaleString()} · ${
      nearest.flagged ? "flagged" : "normal"
    }${this.detailForRow(nearest.row) !== null ? " · click to inspect" : ""}`;
    tooltip.style.left = `${Math.min(x + 12, Math.max(4, (canvas.clientWidth || 640) - 200))}px`;
    tooltip.style.top = `${Math.max(4, y - 28)}px`;
  }

  private detailForRow(row: number): OutlierAnalysisMessage["details"][number] | null {
    for (const method of ["isolationForest", "pca", "lof"] as const) {
      const result =
        this.resultFor(method, this.preferredMode) ??
        this.resultFor(method, "quick") ??
        this.resultFor(method, "deep");
      if (result === null) continue;
      const found = result.details.find((detail) => detail.row === row);
      if (found !== undefined) return found;
    }
    return null;
  }

  private buildScoreDistribution(result: OutlierAnalysisMessage): HTMLElement {
    const section = el("section", { class: "outliers-section" });
    section.append(
      el("div", { class: "outliers-section-head" }, [
        el("h3", {}, ["Score distribution"]),
        el("span", { class: "outliers-hint" }, [
          `Threshold ${formatScore(result.threshold)} · ${formatPercent(
            result.analyzed > 0 ? result.flagged / result.analyzed : 0,
          )} flagged`,
        ]),
      ]),
    );
    const histogram = el("div", { class: "outliers-histogram", "data-threshold": String(result.threshold) });
    section.append(histogram);
    return section;
  }

  private connectHistogram(host: HTMLElement, result: OutlierAnalysisMessage): void {
    const bins = 24;
    let min = Infinity;
    let max = -Infinity;
    for (const score of result.scores) {
      if (score < min) min = score;
      if (score > max) max = score;
    }
    if (!(max > min)) {
      min -= 1;
      max += 1;
    }
    const counts = new Uint32Array(bins);
    for (const score of result.scores) {
      const index = Math.min(bins - 1, Math.max(0, Math.floor(((score - min) / (max - min)) * bins)));
      counts[index] = (counts[index] ?? 0) + 1;
    }
    let peak = 1;
    for (const count of counts) if (count > peak) peak = count;
    const chart = el("div", { class: "outliers-bars" });
    for (let i = 0; i < bins; i++) {
      const bar = el("span", {
        class: "outliers-bar",
        title: `${formatScore(min + (i / bins) * (max - min))} – ${formatScore(
          min + ((i + 1) / bins) * (max - min),
        )}: ${(counts[i] ?? 0).toLocaleString()} rows`,
      });
      bar.style.height = `${Math.max(2, ((counts[i] ?? 0) / peak) * 100)}%`;
      const flagged = min + ((i + 0.5) / bins) * (max - min) >= result.threshold;
      if (flagged) bar.classList.add("flagged");
      chart.append(bar);
    }
    const thresholdPosition = Math.min(
      100,
      Math.max(0, ((result.threshold - min) / (max - min)) * 100),
    );
    const marker = el("span", { class: "outliers-threshold-marker", title: "Threshold" });
    marker.style.left = `${thresholdPosition}%`;
    const wrap = el("div", { class: "outliers-histogram-wrap" });
    wrap.append(chart, marker);
    wrap.append(
      el("div", { class: "outliers-histogram-axis" }, [
        el("span", {}, [formatScore(min)]),
        el("span", {}, [formatScore(max)]),
      ]),
    );
    host.append(wrap);
  }

  private buildAgreement(): HTMLElement {
    const summary = this.agreementSummary();
    const section = el("section", { class: "outliers-section" });
    section.append(
      el("div", { class: "outliers-section-head" }, [
        el("h3", {}, ["Method agreement"]),
        el("span", { class: "outliers-hint" }, [
          "Run Compare methods to fill this in · same scope and threshold",
        ]),
      ]),
    );
    if (summary === null) {
      section.append(
        el("div", { class: "outliers-hint" }, [
          "Only one method has results so far. Compare methods to see how many rows each one finds.",
        ]),
      );
      return section;
    }
    const rows = el("div", { class: "outliers-agreement" });
    for (const entry of summary.rows) {
      const row = el("div", { class: "outliers-agreement-row" });
      row.append(
        el("span", { class: "outliers-agreement-label" }, [entry.label]),
        el("span", { class: "outliers-agreement-track" }, [
          (() => {
            const fill = el("span", { class: "outliers-agreement-fill" });
            fill.style.width = `${Math.min(100, (entry.value / Math.max(1, summary.max)) * 100)}%`;
            return fill;
          })(),
        ]),
        el("span", { class: "outliers-agreement-count" }, [entry.value.toLocaleString()]),
      );
      rows.append(row);
    }
    section.append(rows);
    return section;
  }

  private agreementSummary(): {
    rows: { label: string; value: number }[];
    max: number;
    twoPlus: number;
    single: number;
  } | null {
    const results = METHODS.map((entry) => this.resultFor(entry.id, "quick"))
      .filter((entry): entry is OutlierAnalysisMessage => entry !== null);
    if (results.length < 2) return null;
    const sets = results.map((result) => {
      const set = new Set<number>();
      for (let i = 0; i < result.rowIndices.length; i++) {
        if ((result.scores[i] ?? Number.NEGATIVE_INFINITY) >= result.threshold) {
          set.add(result.rowIndices[i] ?? 0);
        }
      }
      return set;
    });
    const counts = new Map<number, number>();
    for (const set of sets) {
      for (const row of set) counts.set(row, (counts.get(row) ?? 0) + 1);
    }
    let twoPlus = 0;
    let single = 0;
    for (const count of counts.values()) {
      if (count >= 2) twoPlus++;
      else single++;
    }
    const rows = results.map((result) => ({
      label: METHOD_LABELS[result.method],
      value: result.flagged,
    }));
    rows.push({ label: "Flagged by 2+ methods", value: twoPlus });
    rows.push({ label: "Flagged by only one", value: single });
    const max = Math.max(1, ...rows.map((row) => row.value));
    return { rows, max, twoPlus, single };
  }

  private buildTopOutliers(result: OutlierAnalysisMessage): HTMLElement {
    const section = el("section", { class: "outliers-section" });
    const head = el("div", { class: "outliers-section-head" });
    head.append(
      el("h3", {}, ["Top outliers"]),
      el("span", { class: "outliers-hint" }, [
        `${result.details.length} ranked rows · click one for all values and reasons`,
      ]),
    );
    const list = el("div", { class: "outliers-rows" });
    result.details.forEach((detail, index) => {
      const card = el("button", {
        class: "outliers-row",
        type: "button",
      }) as HTMLButtonElement;
      const values = detail.values
        .slice(0, 4)
        .map((value, feature) => `${result.labels[feature] ?? "?"}=${value === "" ? "—" : value}`)
        .join(" · ");
      card.append(
        el("span", { class: "outliers-row-rank" }, [`#${index + 1}`]),
        el("span", { class: "outliers-row-main" }, [
          el("span", { class: "outliers-row-title" }, [
            `Row ${(detail.row + 1).toLocaleString()} · score ${formatScore(detail.score)}`,
          ]),
          el("span", { class: "outliers-row-values" }, [values]),
          this.buildFingerprint(detail.contributions),
        ]),
      );
      card.addEventListener("click", () => {
        this.selectedDetail = { method: result.method, row: detail.row, mode: result.mode };
        this.render();
      });
      list.append(card);
    });
    if (result.details.length === 0) {
      list.append(el("div", { class: "outliers-hint" }, ["No rows cleared the threshold."]));
    }
    section.append(head, list);
    return section;
  }

  private buildFingerprint(
    contributions: OutlierAnalysisMessage["details"][number]["contributions"],
  ): HTMLElement {
    const bar = el("span", { class: "outliers-fingerprint" });
    for (const entry of contributions.slice(0, 4)) {
      const part = el("span", {
        class: "outliers-fingerprint-part",
        title: `${entry.label}: ${formatPercent(entry.contribution)}`,
      });
      part.style.width = `${Math.max(2, entry.contribution * 100)}%`;
      bar.append(part);
    }
    return bar;
  }

  private buildDetailPanel(): HTMLElement {
    const detail = this.selectedDetail;
    if (detail === null) return el("div", { class: "hidden" });
    const result = this.resultFor(detail.method, detail.mode);
    const row =
      result?.details.find((entry) => entry.row === detail.row) ??
      this.detailForRow(detail.row);
    const aside = el("aside", { class: "outliers-detail" });
    if (row === null || result === null) {
      aside.append(el("p", {}, ["That row is no longer in the analysed sample."]));
      return aside;
    }
    const head = el("div", { class: "outliers-detail-head" }, [
      el("h3", {}, [`Row ${(row.row + 1).toLocaleString()}`]),
      el("span", { class: "outliers-hint" }, [
        `${METHOD_LABELS[result.method]} · score ${formatScore(row.score)} · threshold ${formatScore(
          result.threshold,
        )}`,
      ]),
    ]);
    const close = el("button", { class: "icon-btn", type: "button", title: "Close details" }, ["×"]);
    close.addEventListener("click", () => {
      this.selectedDetail = null;
      this.render();
    });
    head.append(close);
    const values = el("div", { class: "outliers-detail-values" });
    result.labels.forEach((label, index) => {
      values.append(
        el("div", { class: "outliers-detail-value" }, [
          el("span", { class: "outliers-detail-label" }, [label]),
          el("span", { class: "outliers-detail-number" }, [row.values[index] ?? "—"]),
        ]),
      );
    });
    const reasons = el("div", { class: "outliers-detail-reasons" });
    for (const entry of row.contributions) {
      const reason = el("div", { class: "outliers-reason" });
      reason.append(
        el("span", { class: "outliers-reason-label" }, [entry.label]),
        (() => {
          const track = el("span", { class: "outliers-reason-track" });
          const fill = el("span", { class: "outliers-reason-fill" });
          fill.style.width = `${Math.max(2, entry.contribution * 100)}%`;
          track.append(fill);
          return track;
        })(),
        el("span", { class: "outliers-reason-share" }, [formatPercent(entry.contribution)]),
      );
      reasons.append(reason);
    }
    const actions = el("div", { class: "outliers-detail-actions" });
    const show = el("button", { class: "primary small", type: "button" }, ["Show flagged rows"]);
    show.addEventListener("click", () => this.options.onShowOutliers());
    const clearFilter = el("button", { class: "ghost small", type: "button" }, ["Clear outlier filter"]);
    clearFilter.addEventListener("click", () => this.options.onClearOutliers());
    actions.append(show, clearFilter);
    aside.append(head, values, el("h4", {}, ["Why this row"]), reasons, actions);
    return aside;
  }

  private buildValueOutliers(): HTMLElement {
    const wrap = el("div", { class: "outliers-list" });
    const findings = anomalyFindings(this.metas);
    if (findings.length === 0) {
      wrap.append(
        el("div", { class: "outliers-empty" }, [
          "✓ No single-column value or text-length anomalies were flagged.",
        ]),
      );
      return wrap;
    }
    for (const finding of findings) wrap.append(this.renderFinding(finding));
    return wrap;
  }

  private buildGroupOutliers(): HTMLElement {
    const wrap = el("div", { class: "outliers-list" });
    if (this.groupLoading) {
      wrap.append(el("div", { class: "outliers-empty" }, ["Checking within-group outliers…"]));
      return wrap;
    }
    if (this.groupResult === null || this.groupResult.pairs.length === 0) {
      const run = el("button", { class: "primary small", type: "button" }, ["Scan groups"]);
      run.addEventListener("click", () => void this.loadGroupAnomalies());
      wrap.append(
        el("div", { class: "outliers-empty" }, [
          "Group-relative outliers need a numeric value and a category group. ",
          run,
        ]),
      );
      return wrap;
    }
    for (const finding of groupAnomalyFindings(this.groupResult.pairs)) {
      wrap.append(this.renderFinding(finding));
    }
    return wrap;
  }

  private buildCategoricalSignals(): HTMLElement {
    const section = el("section", { class: "outliers-section" });
    section.append(
      el("div", { class: "outliers-section-head" }, [
        el("h3", {}, ["Categorical & text signals"]),
        el("span", { class: "outliers-hint" }, [
          "Rare categories, unexpected formats and overlong values still get coverage in text-heavy tables",
        ]),
      ]),
    );
    const grid = el("div", { class: "outliers-signal-grid" });
    this.metas.forEach((meta, index) => {
      if (meta.role === "provenance") return;
      if (meta.pattern !== null && meta.pattern !== undefined && meta.pattern.offCount > 0) {
        const card = el("div", { class: "outliers-signal" });
        card.append(
          el("span", { class: "outliers-signal-title" }, [`${meta.name} · format`]),
          el("span", { class: "outliers-signal-text" }, [
            `${meta.pattern.offCount.toLocaleString()} values (${formatPercent(
              1 - meta.pattern.share,
            )}) do not match ${meta.pattern.mask || "the dominant mask"}.`,
          ]),
        );
        const examples = meta.pattern.examples.slice(0, 3).join(", ");
        if (examples !== "") {
          card.append(el("span", { class: "outliers-signal-examples" }, [examples]));
        }
        grid.append(card);
      }
      if (meta.anomalyCounts.lengths > 0) {
        const card = el("div", { class: "outliers-signal" });
        card.append(
          el("span", { class: "outliers-signal-title" }, [`${meta.name} · long values`]),
          el("span", { class: "outliers-signal-text" }, [
            `${meta.anomalyCounts.lengths.toLocaleString()} values are much longer than the column's usual text.`,
          ]),
        );
        grid.append(card);
      }
      if (
        meta.categories !== null &&
        (meta.type === "category" || meta.type === "boolean") &&
        meta.categories.labels.length > 1
      ) {
        const total = meta.categories.counts.reduce((sum, count) => sum + count, 0);
        const rare = meta.categories.labels
          .map((label, code) => ({
            label,
            code,
            count: meta.categories?.counts[code] ?? 0,
          }))
          .filter((entry) => entry.count > 0 && total > 0 && entry.count / total <= 0.005)
          .sort((a, b) => a.count - b.count)
          .slice(0, 4);
        if (rare.length > 0) {
          const card = el("div", { class: "outliers-signal" });
          card.append(
            el("span", { class: "outliers-signal-title" }, [`${meta.name} · rare categories`]),
          );
          for (const entry of rare) {
            const button = el(
              "button",
              { class: "outliers-link", type: "button", title: "Filter to this category" },
              [`${entry.label === "" ? "(blank)" : entry.label} · ${entry.count.toLocaleString()}`],
            ) as HTMLButtonElement;
            button.addEventListener("click", () => this.options.onFilterValue(index, entry.code));
            card.append(button);
          }
          grid.append(card);
        }
      }
    });
    for (const entry of this.similarClusters?.entries.slice(0, 4) ?? []) {
      if (entry.clusters.length === 0) continue;
      const card = el("div", { class: "outliers-signal" });
      const example = entry.clusters[0];
      card.append(
        el("span", { class: "outliers-signal-title" }, [
          `${entry.label} · near-duplicate values`,
        ]),
        el("span", { class: "outliers-signal-text" }, [
          `${entry.clusters.length.toLocaleString()} clusters across ${entry.analysedRows.toLocaleString()} rows${
            entry.truncated ? " (most frequent values only)" : ""
          }.`,
        ]),
      );
      if (example !== undefined) {
        card.append(
          el("span", { class: "outliers-signal-examples" }, [
            example.values.map((member) => `“${member.value}”`).join(" vs "),
          ]),
        );
      }
      grid.append(card);
    }
    if (this.similarLoading && grid.childElementCount === 0) {
      grid.append(
        el("div", { class: "outliers-hint" }, ["Checking near-duplicate values…"]),
      );
    }
    if (grid.childElementCount === 0) {
      grid.append(
        el("div", { class: "outliers-hint" }, [
          "No rare categories, unexpected formats or near-duplicate values were found in this dataset.",
        ]),
      );
    }
    section.append(grid);
    return section;
  }

  private renderFinding(finding: Finding): HTMLElement {
    const row = el("div", { class: `outliers-finding severity-${finding.severity}` });
    const body = el("div", { class: "outliers-finding-body" });
    body.append(
      el("span", { class: "outliers-finding-title" }, [finding.title]),
      el(
        "span",
        { class: "outliers-finding-evidence" },
        [finding.evidence.map((entry) => `${entry.metric}: ${entry.value}`).join(" · ")],
      ),
    );
    row.append(body);
    if (finding.action !== undefined) {
      const action = el(
        "button",
        { class: "ghost small", type: "button" },
        [finding.fixLabel ?? "Show rows"],
      ) as HTMLButtonElement;
      action.addEventListener("click", () => this.options.onFinding(finding));
      row.append(action);
    }
    for (const extra of finding.extraActions ?? []) {
      const action = el("button", { class: "ghost small", type: "button" }, [extra.label]);
      action.addEventListener("click", () =>
        this.options.onFinding({ ...finding, action: extra.action, fixLabel: extra.label }),
      );
      row.append(action);
    }
    return row;
  }

  // ---------- Relationships tab ----------

  private buildRelationshipScopeBar(): HTMLElement {
    const bar = el("div", { class: "outliers-scope" });
    const scope = el("div", { class: "outliers-scope-group" });
    scope.append(el("span", { class: "outliers-scope-label" }, ["Scope"]));
    const current = el(
      "button",
      {
        class: `outliers-chip${this.respectFilters ? " active" : ""}`,
        type: "button",
      },
      [`Current rows (${this.visibleRowCount.toLocaleString()})`],
    ) as HTMLButtonElement;
    current.addEventListener("click", () => this.setRelationshipScope(true));
    const whole = el(
      "button",
      {
        class: `outliers-chip${this.respectFilters ? "" : " active"}`,
        type: "button",
      },
      [`Whole dataset (${this.rowCount.toLocaleString()})`],
    ) as HTMLButtonElement;
    whole.addEventListener("click", () => this.setRelationshipScope(false));
    scope.append(current, whole);
    bar.append(
      scope,
      el("span", { class: "outliers-scope-note" }, [
        describeScope({ total: this.rowCount, visible: this.visibleRowCount }),
      ]),
    );
    return bar;
  }

  private setRelationshipScope(respectFilters: boolean): void {
    if (this.respectFilters === respectFilters) return;
    this.respectFilters = respectFilters;
    this.resetRelationshipCache();
    this.clearResults();
    void this.ensureRelationships();
    this.render();
  }

  private renderRelationships(): void {
    const wrap = el("div", { class: "outliers-relationships" });
    wrap.append(this.buildRelationshipScopeBar());
    const loading =
      this.correlationLoading || this.relationshipsLoading || this.dependenciesLoading;
    if (loading) {
      wrap.append(
        el("div", { class: "outliers-empty" }, [
          `Computing relationships${this.correlationLoading ? " · correlations" : ""}${
            this.relationshipsLoading ? " · associations" : ""
          }${this.dependenciesLoading ? " · dependencies" : ""}…`,
        ]),
      );
    }
    if (this.correlation === null && this.relationships === null && !loading) {
      wrap.append(
        el("div", { class: "outliers-empty" }, [
          "Relationships need at least two columns with data. Load a table with numeric or category columns.",
        ]),
      );
    }
    if (this.relationships !== null && this.relationships.relationships.length > 0) {
      wrap.append(
        this.buildRelationshipInsights(this.relationships.relationships),
        this.buildAssociationList(this.relationships.relationships),
      );
    }
    if (this.correlation !== null) {
      wrap.append(this.buildCorrelationHeatmap(this.correlation), this.buildExplain(this.correlation));
    }
    if (this.dependencies !== null && this.dependencies.pairs.length > 0) {
      wrap.append(this.buildDependencyNetwork(this.dependencies));
    }
    if (this.selectedRelationship !== null && this.relationships !== null) {
      const entry = this.relationships.relationships[this.selectedRelationship];
      if (entry !== undefined) wrap.append(this.buildAssociationDetail(entry));
    }
    this.contentEl.append(wrap);
    const canvas = this.contentEl.querySelector<HTMLCanvasElement>(".outliers-network-canvas");
    if (canvas !== null) this.drawNetwork(canvas);
  }

  private buildRelationshipInsights(
    relationships: RelationshipsMessage["relationships"],
  ): HTMLElement {
    const strip = el("div", { class: "outliers-insights" });
    const ranked = [...relationships].sort(
      (a, b) => Math.abs(b.effect) - Math.abs(a.effect) || a.aColumn - b.aColumn,
    );
    const strongest = ranked[0];
    if (strongest !== undefined) {
      strip.append(
        el("div", { class: "outliers-insight" }, [
          el("span", { class: "outliers-insight-label" }, ["Strongest association"]),
          el("span", { class: "outliers-insight-text" }, [
            `${strongest.aLabel} ↔ ${strongest.bLabel} · ${
              RELATIONSHIP_LABELS[strongest.kind] ?? strongest.kind
            } ${strongest.effect.toFixed(2)} over ${strongest.n.toLocaleString()} rows`,
          ]),
        ]),
      );
    }
    const eta = ranked.find((entry) => entry.kind === "eta2");
    if (eta !== undefined) {
      strip.append(
        el("div", { class: "outliers-insight" }, [
          el("span", { class: "outliers-insight-label" }, ["Grouping power"]),
          el("span", { class: "outliers-insight-text" }, [
            `${eta.aLabel} explains ${formatPercent(eta.effect)} of the variation in ${eta.bLabel} (η²).`,
          ]),
        ]),
      );
    }
    if (this.dependencies !== null && this.dependencies.pairs.length > 0) {
      const top = [...this.dependencies.pairs].sort(
        (a, b) => a.violations - b.violations || b.rows - a.rows,
      )[0];
      if (top !== undefined) {
        strip.append(
          el("div", { class: "outliers-insight" }, [
            el("span", { class: "outliers-insight-label" }, ["Key relationship"]),
            el("span", { class: "outliers-insight-text" }, [
              `${top.determinantLabel} → ${top.dependentLabel} · ${
                top.violations === 0
                  ? "fully consistent"
                  : `${top.violations.toLocaleString()} conflicting rows`
              }`,
            ]),
          ]),
        );
      }
    }
    return strip;
  }

  private buildAssociationList(
    relationships: RelationshipsMessage["relationships"],
  ): HTMLElement {
    const section = el("section", { class: "outliers-section" });
    section.append(
      el("div", { class: "outliers-section-head" }, [
        el("h3", {}, ["Ranked associations"]),
        el("span", { class: "outliers-hint" }, [
          "Pearson · Spearman · Cramér's V · η² — click a bar for detail",
        ]),
      ]),
    );
    const list = el("div", { class: "outliers-associations" });
    const ranked = [...relationships]
      .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
      .slice(0, 14);
    ranked.forEach((entry) => {
      const index = relationships.indexOf(entry);
      const button = el("button", {
        class: `outliers-association${this.selectedRelationship === index ? " active" : ""}`,
        type: "button",
      }) as HTMLButtonElement;
      const track = el("span", { class: "outliers-association-track" });
      const fill = el("span", { class: "outliers-association-fill" });
      fill.style.width = `${Math.min(100, Math.abs(entry.effect) * 100)}%`;
      if (entry.effect < 0) fill.classList.add("negative");
      track.append(fill);
      button.append(
        el("span", { class: "outliers-association-label" }, [
          `${entry.aLabel} ↔ ${entry.bLabel}`,
        ]),
        track,
        el("span", { class: "outliers-association-value" }, [
          `${RELATIONSHIP_LABELS[entry.kind] ?? entry.kind} ${entry.effect.toFixed(2)}`,
        ]),
      );
      button.addEventListener("click", () => {
        this.selectedRelationship = index;
        this.render();
      });
      list.append(button);
    });
    if (ranked.length === 0) {
      list.append(el("div", { class: "outliers-hint" }, ["No strong associations at this scope."]));
    }
    section.append(list);
    return section;
  }

  private buildAssociationDetail(
    entry: RelationshipsMessage["relationships"][number],
  ): HTMLElement {
    const aside = el("aside", { class: "outliers-detail" });
    aside.append(
      el("h3", {}, [`${entry.aLabel} ↔ ${entry.bLabel}`]),
      el("p", {}, [
        `${RELATIONSHIP_LABELS[entry.kind] ?? entry.kind} = ${entry.effect.toFixed(
          3,
        )} over ${entry.n.toLocaleString()} pairwise-complete rows. Association is not evidence of causation.`,
      ]),
    );
    const close = el("button", { class: "ghost small", type: "button" }, ["Close"]);
    close.addEventListener("click", () => {
      this.selectedRelationship = null;
      this.render();
    });
    aside.append(close);
    return aside;
  }

  private buildCorrelationHeatmap(correlation: CorrelationMessage): HTMLElement {
    const section = el("section", { class: "outliers-section" });
    section.append(
      el("div", { class: "outliers-section-head" }, [
        el("h3", {}, ["Correlation heatmap"]),
        el("span", { class: "outliers-hint" }, [
          "Pearson over pairwise-complete rows · blue negative · red positive",
        ]),
      ]),
    );
    const n = correlation.labels.length;
    const grid = el("div", { class: "outliers-heatmap" });
    grid.style.gridTemplateColumns = `minmax(110px, 150px) repeat(${n}, minmax(34px, 1fr))`;
    grid.append(el("span", { class: "outliers-heatmap-corner" }, [""]));
    for (const label of correlation.labels) {
      grid.append(
        el("span", { class: "outliers-heatmap-label", title: label }, [label]),
      );
    }
    for (let row = 0; row < n; row++) {
      grid.append(
        el("span", { class: "outliers-heatmap-label", title: correlation.labels[row] }, [
          correlation.labels[row] ?? "",
        ]),
      );
      for (let column = 0; column < n; column++) {
        const value = correlation.result.values[row * n + column] ?? Number.NaN;
        const count = correlation.result.counts[row * n + column] ?? 0;
        const cell = el("span", {
          class: "outliers-heatmap-cell",
          title:
            row === column
              ? `${correlation.labels[row]} · diagonal`
              : `${correlation.labels[row]} × ${correlation.labels[column]} · r = ${value.toFixed(
                  2,
                )} · n = ${count.toLocaleString()}`,
        });
        if (row !== column && Number.isFinite(value)) {
          cell.style.background = colorForCorrelation(value);
          cell.style.color = textColorForCorrelation(value);
          cell.textContent = value.toFixed(2);
        } else {
          cell.textContent = "—";
        }
        grid.append(cell);
      }
    }
    section.append(grid);
    return section;
  }

  private buildExplain(correlation: CorrelationMessage): HTMLElement {
    const section = el("section", { class: "outliers-section" });
    section.append(el("h3", {}, ["Explain a column"]));
    const controls = el("div", { class: "outliers-explain-controls" });
    const select = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Explain a column",
    }) as HTMLSelectElement;
    select.append(el("option", { value: "" }, ["All pairs"]) as HTMLOptionElement);
    for (const label of correlation.labels) {
      select.append(el("option", { value: label }, [label]) as HTMLOptionElement);
    }
    select.value = this.explainLabel ?? "";
    select.addEventListener("change", () => {
      this.explainLabel = select.value === "" ? null : select.value;
      this.render();
    });
    controls.append(select);
    section.append(controls);
    if (this.explainLabel !== null) {
      const { sentence } = explainColumn(
        correlation.labels,
        correlation.columns,
        correlation.result.values,
        correlation.result.counts,
        this.explainLabel,
      );
      section.append(el("p", { class: "outliers-sentence" }, [sentence]));
    }
    return section;
  }

  private buildDependencyNetwork(dependencies: DependenciesMessage): HTMLElement {
    const section = el("section", { class: "outliers-section" });
    section.append(
      el("div", { class: "outliers-section-head" }, [
        el("h3", {}, ["Dependency network"]),
        el("span", { class: "outliers-hint" }, [
          "Determinant → dependent · click an edge for the violation detail",
        ]),
      ]),
    );
    const wrap = el("div", { class: "outliers-network" });
    const canvas = el("canvas", {
      class: "outliers-network-canvas",
      role: "img",
      "aria-label": `Dependency network with ${dependencies.pairs.length} links`,
    }) as HTMLCanvasElement;
    canvas.width = NETWORK_WIDTH;
    canvas.height = NETWORK_HEIGHT;
    canvas.addEventListener("click", (event) => this.clickNetwork(event as MouseEvent));
    wrap.append(canvas);
    section.append(wrap);
    section.append(this.buildDependencyList(dependencies));
    if (this.selectedDependency !== null) {
      const pair = dependencies.pairs[this.selectedDependency];
      if (pair !== undefined) {
        const aside = el("aside", { class: "outliers-detail" });
        aside.append(
          el("h3", {}, [`${pair.determinantLabel} → ${pair.dependentLabel}`]),
          el("p", {}, [
            pair.violations === 0
              ? `Every one of ${pair.rows.toLocaleString()} rows is consistent.`
              : `${pair.violations.toLocaleString()} of ${pair.rows.toLocaleString()} rows conflict.`,
          ]),
        );
        for (const example of pair.examples.slice(0, 3)) {
          aside.append(
            el("p", { class: "outliers-hint" }, [
              `${example.determinant} maps to ${example.values.slice(0, 3).join(", ")}`,
            ]),
          );
        }
        section.append(aside);
      }
    }
    return section;
  }

  private buildDependencyList(dependencies: DependenciesMessage): HTMLElement {
    const list = el("div", { class: "outliers-dependencies" });
    dependencies.pairs.slice(0, 20).forEach((pair, index) => {
      const button = el(
        "button",
        {
          class: `outliers-dependency${this.selectedDependency === index ? " active" : ""}`,
          type: "button",
        },
        [
          `${pair.determinantLabel} → ${pair.dependentLabel}`,
          el("span", { class: "outliers-hint" }, [
            pair.violations === 0
              ? "fully consistent"
              : `${pair.violations.toLocaleString()} conflicts`,
          ]),
        ],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => {
        this.selectedDependency = index;
        this.render();
      });
      list.append(button);
    });
    return list;
  }

  private drawNetwork(canvas: HTMLCanvasElement): void {
    const dependencies = this.dependencies;
    if (dependencies === null) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(NETWORK_WIDTH * dpr);
    canvas.height = Math.round(NETWORK_HEIGHT * dpr);
    canvas.style.width = `${NETWORK_WIDTH}px`;
    canvas.style.height = `${NETWORK_HEIGHT}px`;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearCanvas(ctx, NETWORK_WIDTH, NETWORK_HEIGHT);
    const nodes = new Map<number, { x: number; y: number; label: string }>();
    for (const pair of dependencies.pairs) {
      for (const [column, label] of [
        [pair.determinantColumn, pair.determinantLabel],
        [pair.dependentColumn, pair.dependentLabel],
      ] as const) {
        if (!nodes.has(column)) nodes.set(column, { x: 0, y: 0, label });
      }
    }
    const entries = [...nodes.entries()].sort((a, b) => a[0] - b[0]);
    const centerX = NETWORK_WIDTH / 2;
    const centerY = NETWORK_HEIGHT / 2;
    const radius = Math.min(centerX, centerY) - 44;
    entries.forEach(([, node], index) => {
      const angle = (index / Math.max(1, entries.length)) * Math.PI * 2 - Math.PI / 2;
      node.x = centerX + Math.cos(angle) * radius;
      node.y = centerY + Math.sin(angle) * radius;
    });
    this.networkEdges = [];
    dependencies.pairs.forEach((pair, index) => {
      const a = nodes.get(pair.determinantColumn);
      const b = nodes.get(pair.dependentColumn);
      if (a === undefined || b === undefined) return;
      this.networkEdges.push({ a, b, index });
      ctx.strokeStyle =
        this.selectedDependency === index
          ? cssVar("--accent", "#2563eb")
          : pair.violations === 0
            ? cssVar("--qa-good", "#16a34a")
            : cssVar("--qa-warn", "#d97706");
      ctx.globalAlpha = this.selectedDependency === index ? 1 : 0.55;
      ctx.lineWidth = this.selectedDependency === index ? 2.4 : 1.4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const arrowX = b.x - Math.cos(angle) * 12;
      const arrowY = b.y - Math.sin(angle) * 12;
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - Math.cos(angle - 0.4) * 8,
        arrowY - Math.sin(angle - 0.4) * 8,
      );
      ctx.lineTo(
        arrowX - Math.cos(angle + 0.4) * 8,
        arrowY - Math.sin(angle + 0.4) * 8,
      );
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    for (const [, node] of entries) {
      ctx.fillStyle = cssVar("--panel", "#fff");
      ctx.strokeStyle = cssVar("--border", "#d0d7de");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = cssVar("--text", "#1f2933");
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(node.label, node.x, node.y - 10);
    }
    ctx.textAlign = "left";
  }

  private clickNetwork(event: MouseEvent): void {
    const canvas = event.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * NETWORK_WIDTH;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * NETWORK_HEIGHT;
    let best: { index: number; distance: number } | null = null;
    for (const edge of this.networkEdges) {
      const distance = distanceToSegment(x, y, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
      if (best === null || distance < best.distance) best = { index: edge.index, distance };
    }
    if (best !== null && best.distance <= 9) {
      this.selectedDependency = best.index;
      this.render();
    }
  }
}

function clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
}

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

function distanceToSegment(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
