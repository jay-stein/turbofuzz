import { clear, el, svgIcon } from "./dom.js";
import { toDateInputValue } from "../parse/dates.js";
import type { TopValue } from "../parse/infer.js";
import { TYPE_LABELS } from "../types.js";
import type { DatasetStats } from "../data/stats.js";
import type { DedupeKeep } from "../data/transform-ops.js";
import type {
  ColumnMeta,
  LoadedMessage,
  SpecialKind,
  TransformedMessage,
} from "../worker/protocol.js";

const COMPACT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const QA_BUTTONS: { kind: SpecialKind; label: string; title: string }[] = [
  {
    kind: "duplicates",
    label: "Duplicates",
    title:
      "Rows belonging to a duplicate group — every copy is shown so they can be compared",
  },
];

const FILTER_ICON = '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>';

const SUMMARY_EXPANDED_KEY = "turbofuzz.summary.expanded";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SUMMARY_EXPANDED_KEY) === "false";
  } catch {
    return false;
  }
}

export interface SummaryBandCallbacks {
  onToggleSpecial: (kind: SpecialKind) => void;
  onOpenStats: () => void;
  onColumnClick: (column: number) => void;
  onDropDuplicates: (keep: DedupeKeep) => void;
  onDropEmptyColumns: (columns: number[]) => void;
}

/**
 * Always-visible QA block: prominent duplicate/null/anomaly toggles followed
 * by one compact card per column (sparkline for numeric and date columns,
 * top-value bars for categories, length stats for text).
 */
export class SummaryBand {
  private readonly buttons = new Map<
    SpecialKind,
    { button: HTMLButtonElement; label: HTMLSpanElement }
  >();
  private readonly active = new Set<SpecialKind>();
  private counts: Record<SpecialKind, number> = {
    duplicates: 0,
    nulls: 0,
    valueAnomalies: 0,
    lengthAnomalies: 0,
  };
  private stats: DatasetStats | null = null;
  private collapsed = readCollapsed();
  private collapseSummary: HTMLElement | null = null;
  private dedupeButton: HTMLButtonElement | null = null;
  private renderToken = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: SummaryBandCallbacks,
  ) {
    this.root.classList.add("summary-band", "hidden");
  }

  render(loaded: LoadedMessage | TransformedMessage): void {
    clear(this.root);
    this.buttons.clear();
    this.setCounts(loaded.stats);

    const token = ++this.renderToken;
    this.root.append(this.buildQaBlock(loaded), this.buildColumns(loaded, token));
    this.active.clear();
    this.syncButtons();
    this.updateCollapseSummary();
    this.applyCollapsed();
    this.root.classList.remove("hidden");
  }

  setSpecials(active: ReadonlySet<SpecialKind>): void {
    this.active.clear();
    for (const kind of active) this.active.add(kind);
    this.syncButtons();
  }

  /** Refreshes the counters (e.g. after a column type change). */
  setCounts(stats: DatasetStats): void {
    this.stats = stats;
    this.counts = {
      duplicates: stats.rowsInDuplicateGroups,
      nulls: stats.rowsWithNulls,
      valueAnomalies: stats.valueAnomalyRows,
      lengthAnomalies: stats.lengthAnomalyRows,
    };
    this.syncButtons();
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    try {
      localStorage.setItem(SUMMARY_EXPANDED_KEY, String(!this.collapsed));
    } catch {
      // Persisting the preference is best-effort.
    }
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    this.root.classList.toggle("qa-collapsed", this.collapsed);
    const head = this.root.querySelector<HTMLElement>(".qa-head");
    head?.setAttribute("aria-expanded", this.collapsed ? "false" : "true");
    const chevron = this.root.querySelector<HTMLElement>(".qa-chevron");
    if (chevron !== null) chevron.textContent = this.collapsed ? "▸" : "▾";
  }

  private updateCollapseSummary(): void {
    if (this.collapseSummary === null) return;
    const issues: string[] = [];
    if (this.counts.duplicates > 0) {
      issues.push(`${this.counts.duplicates.toLocaleString()} duplicate rows`);
    }
    if (this.counts.nulls > 0) issues.push(`${this.counts.nulls.toLocaleString()} empty rows`);
    if (this.counts.valueAnomalies > 0) {
      issues.push(`${this.counts.valueAnomalies.toLocaleString()} value outliers`);
    }
    if (this.counts.lengthAnomalies > 0) {
      issues.push(`${this.counts.lengthAnomalies.toLocaleString()} length outliers`);
    }
    this.collapseSummary.textContent = issues.length === 0 ? "No issues found" : issues.join(" · ");
  }

  private syncButtons(): void {
    for (const { kind, label } of QA_BUTTONS) {
      const entry = this.buttons.get(kind);
      if (entry === undefined) continue;
      const on = this.active.has(kind);
      entry.button.classList.toggle("active", on);
      entry.button.classList.toggle("warn", this.counts[kind] > 0);
      entry.button.classList.toggle("ok", this.counts[kind] === 0);
      entry.button.setAttribute("aria-pressed", on ? "true" : "false");
      entry.button.title = this.titleFor(kind);
      entry.label.textContent = on
        ? `Only ${label.toLowerCase()} (${this.counts[kind].toLocaleString()})`
        : `${label}: ${this.counts[kind].toLocaleString()}`;
    }
    if (this.dedupeButton !== null) {
      const redundant = this.stats?.duplicateRows ?? 0;
      this.dedupeButton.disabled = redundant === 0;
      this.dedupeButton.title =
        redundant === 0
          ? "No duplicate rows to remove"
          : `Remove duplicate rows — ${redundant.toLocaleString()} redundant rows. Choose keep first, keep last, or remove all copies.`;
    }
    this.updateCollapseSummary();
  }

  /** Quick menu next to the Duplicates toggle that applies a dedupe transform. */
  private openDedupeMenu(anchor: HTMLElement): void {
    const stats = this.stats;
    if (stats === null) return;

    const menu = el("div", { class: "context-menu qa-menu", role: "menu" });
    const options: { keep: DedupeKeep; label: string; removed: number; hint: string }[] = [
      {
        keep: "first",
        label: "Keep first copy",
        removed: stats.duplicateRows,
        hint: "Remove later copies, keeping the earliest row of every duplicate group",
      },
      {
        keep: "last",
        label: "Keep last copy",
        removed: stats.duplicateRows,
        hint: "Remove earlier copies, keeping the latest row of every duplicate group",
      },
      {
        keep: "none",
        label: "Remove all copies",
        removed: stats.rowsInDuplicateGroups,
        hint: "Drop every row that belongs to a duplicate group, including the original",
      },
    ];

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      menu.remove();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!menu.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };

    for (const option of options) {
      const item = el(
        "button",
        { class: "context-item", type: "button", role: "menuitem", title: option.hint },
        [`${option.label} — ${option.removed.toLocaleString()} rows`],
      ) as HTMLButtonElement;
      item.disabled = option.removed === 0;
      item.addEventListener("click", () => {
        close();
        this.callbacks.onDropDuplicates(option.keep);
      });
      menu.append(item);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  }

  /** Metric definitions with their unit, so the counts are not ambiguous. */
  private titleFor(kind: SpecialKind): string {
    const stats = this.stats;
    if (stats === null) return QA_BUTTONS.find((button) => button.kind === kind)?.title ?? "";
    switch (kind) {
      case "duplicates":
        return `Rows in a duplicate group: ${stats.rowsInDuplicateGroups.toLocaleString()} rows (${stats.duplicateGroups.toLocaleString()} groups, ${stats.duplicateRows.toLocaleString()} redundant rows beyond the first copy) — click to show them`;
      case "nulls":
        return `Rows with at least one empty cell: ${stats.rowsWithNulls.toLocaleString()} rows (${stats.totalNullCells.toLocaleString()} empty cells across ${stats.totalCells.toLocaleString()} cells) — click to show them`;
      case "valueAnomalies":
        return `Rows with a numeric value outside its column's robust fence (MAD, log-scale or p0.5–p99.5 quantile): ${stats.valueAnomalyRows.toLocaleString()} rows — click to show them`;
      case "lengthAnomalies":
        return `Rows with text longer than 3× the column's 90th-percentile length: ${stats.lengthAnomalyRows.toLocaleString()} rows — click to show them`;
    }
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  /** Refreshes a single column's card after its data or type changed. */
  updateColumn(index: number, meta: ColumnMeta): void {
    const existing = this.root.querySelector<HTMLElement>(`.stat-card[data-column="${index}"]`);
    if (existing === null) return;
    existing.replaceWith(this.buildColumnCard(meta, index));
  }

  /** Updates column names in place after a header rename (cards are in column order). */
  updateNames(names: string[]): void {
    const cards = this.root.querySelectorAll<HTMLElement>(".stat-card");
    cards.forEach((card, index) => {
      const name = names[index];
      if (name === undefined) return;
      const nameEl = card.querySelector<HTMLElement>(".stat-name");
      if (nameEl !== null) {
        nameEl.textContent = name;
        nameEl.title = name;
      }
      const typeLabel = card.querySelector<HTMLElement>(".stat-type")?.textContent ?? "";
      card.title = typeLabel === "" ? name : `${name} — ${typeLabel}`;
    });
  }

  private buildQaBlock(loaded: LoadedMessage | TransformedMessage): HTMLElement {
    const block = el("div", { class: "qa-block" });

    const head = el(
      "button",
      {
        class: "qa-head",
        type: "button",
        "aria-expanded": "true",
        title: "Collapse or expand the QA summary",
      },
    ) as HTMLButtonElement;
    head.append(
      el("span", { class: "qa-title" }, ["Data QA"]),
      el("span", { class: "qa-sub" }, [
        `${loaded.rowCount.toLocaleString()} rows × ${loaded.columnCount.toLocaleString()} cols`,
      ]),
      el("span", { class: "grow" }),
      el("span", { class: "qa-chevron" }, ["▾"]),
    );
    head.addEventListener("click", () => this.toggleCollapsed());
    this.collapseSummary = el("div", { class: "qa-collapse-summary" });

    const emptyColumnIndices = loaded.columns
      .map((column, index) =>
        loaded.rowCount > 0 && column.stats.nulls === loaded.rowCount ? index : -1,
      )
      .filter((index) => index >= 0);

    const actions = el("div", { class: "qa-actions" });
    for (const { kind, label, title } of QA_BUTTONS) {
      const button = el(
        "button",
        { class: "qa-button", type: "button", title },
        [],
      ) as HTMLButtonElement;
      const labelEl = el("span", { class: "qa-label" }, [label]);
      button.append(svgIcon(FILTER_ICON, "qa-icon"), labelEl);
      button.addEventListener("click", () => this.callbacks.onToggleSpecial(kind));
      this.buttons.set(kind, { button, label: labelEl });
      actions.append(button);
    }

    const dedupeButton = el(
      "button",
      { class: "qa-button qa-dedupe", type: "button" },
      [],
    ) as HTMLButtonElement;
    dedupeButton.append(
      svgIcon(
        '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="m6 7 1 12h10l1-12"/>' +
          '<path d="M10 11v5"/><path d="M14 11v5"/>',
        "qa-icon",
      ),
      el("span", { class: "qa-label" }, ["Remove duplicates"]),
    );
    dedupeButton.addEventListener("click", () => this.openDedupeMenu(dedupeButton));
    this.dedupeButton = dedupeButton;
    actions.append(dedupeButton);

    if (emptyColumnIndices.length > 0) {
      const dropEmpty = el(
        "button",
        { class: "qa-button", type: "button" },
        [],
      ) as HTMLButtonElement;
      const columnCount = emptyColumnIndices.length;
      dropEmpty.append(
        svgIcon(
          '<path d="M4 7h16"/><path d="m6 7 1 12h10l1-12"/><path d="M10 11v5"/><path d="M14 11v5"/>',
          "qa-icon",
        ),
        el("span", { class: "qa-label" }, [
          `Drop ${columnCount.toLocaleString()} empty column${columnCount === 1 ? "" : "s"}`,
        ]),
      );
      dropEmpty.title = `Remove ${columnCount.toLocaleString()} column${
        columnCount === 1 ? "" : "s"
      } that ${columnCount === 1 ? "is" : "are"} empty in every row — tracked as transform steps`;
      dropEmpty.addEventListener("click", () =>
        this.callbacks.onDropEmptyColumns(emptyColumnIndices),
      );
      actions.append(dropEmpty);
    }
    const details = el(
      "button",
      {
        class: "pill ghost stats-report",
        type: "button",
        title: "Full per-column statistics",
      },
      [],
    );
    details.append(
      svgIcon(
        '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>' +
          '<path d="M14 3v5h5"/>' +
          '<path d="M9 17v-4"/>' +
          '<path d="M12 17v-6"/>' +
          '<path d="M15 17v-2"/>',
        "stats-icon",
      ),
      el("span", {}, ["Stats Report"]),
    );
    details.addEventListener("click", () => this.callbacks.onOpenStats());
    actions.append(details);

    const emptyColumns = emptyColumnIndices.length;
    const columnsWithNulls = loaded.columns.filter((column) => column.stats.nulls > 0).length;
    const footParts = [
      columnsWithNulls === 0
        ? "no missing values"
        : `${columnsWithNulls} of ${loaded.columnCount} columns have missing values`,
    ];
    if (emptyColumns > 0) footParts.push(`${emptyColumns} entirely empty`);
    if (loaded.encoding === "windows-1252") footParts.push("windows-1252");
    footParts.push(`${Math.round(loaded.ingestMs)} ms`);

    block.append(
      head,
      this.collapseSummary,
      actions,
      el("div", { class: "overview-foot" }, [footParts.join(" · ")]),
    );
    return block;
  }

  /**
   * Cards are appended in animation-frame chunks: wide datasets (hundreds of
   * columns) paint the first screen immediately instead of building every
   * card synchronously.
   */
  private buildColumns(loaded: LoadedMessage | TransformedMessage, token: number): HTMLElement {
    const columns = el("div", { class: "summary-columns" });
    const firstChunk = 36;
    let index = 0;

    const appendChunk = (): void => {
      if (token !== this.renderToken) return;
      const end = Math.min(loaded.columns.length, index + firstChunk);
      const fragment = document.createDocumentFragment();
      for (; index < end; index++) {
        fragment.append(this.buildColumnCard(loaded.columns[index], index));
      }
      columns.append(fragment);
      if (index < loaded.columns.length) requestAnimationFrame(appendChunk);
    };

    appendChunk();
    return columns;
  }

  private buildColumnCard(meta: ColumnMeta, index: number): HTMLElement {
    const card = el(
      "button",
      {
        class: "stat-card",
        type: "button",
        "data-column": String(index),
        title: `${meta.name} — ${TYPE_LABELS[meta.type]}`,
      },
    ) as HTMLButtonElement;
    card.addEventListener("click", () => this.callbacks.onColumnClick(index));

    const head = el("div", { class: "stat-card-head" });
    head.append(
      el("span", { class: "stat-name", title: meta.name }, [meta.name]),
      el("span", { class: "stat-type" }, [TYPE_LABELS[meta.type]]),
    );
    card.append(head);

    const numeric =
      meta.type === "integer" || meta.type === "number" || meta.type === "date";

    if (numeric && meta.histogram !== null && meta.histogram.max > meta.histogram.min) {
      card.append(buildMiniHistogram(meta.histogram.bins));
    }

    if (numeric) {
      const main = el("div", { class: "stat-card-main" });
      if (meta.stats.min !== null && meta.stats.max !== null) {
        const format = (value: number): string =>
          meta.type === "date"
            ? toDateInputValue(value)
            : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
        main.textContent = `${format(meta.stats.min)} – ${format(meta.stats.max)}`;
      } else {
        main.textContent = "—";
      }
      card.append(main);
    } else if (meta.stats.topValues.length > 0) {
      card.append(buildTopValues(meta.stats.topValues));
    } else {
      card.append(
        el("div", { class: "stat-card-main" }, [`${meta.stats.distinct.toLocaleString()} distinct`]),
      );
    }

    const parts: string[] = [];
    if (numeric) {
      parts.push(`${meta.stats.distinct.toLocaleString()} distinct`);
      if (meta.valueFence !== null && meta.type !== "date") {
        parts.push(
          `median ${meta.valueFence.center.toLocaleString(undefined, { maximumFractionDigits: 1 })}`,
        );
      }
      if (meta.stats.mean !== null && meta.type !== "date") {
        parts.push(`mean ${meta.stats.mean.toLocaleString(undefined, { maximumFractionDigits: 1 })}`);
      }
    } else if (meta.stats.avgLength !== null) {
      parts.push(`len avg ${meta.stats.avgLength.toFixed(1)}`);
    }
    parts.push(meta.stats.nulls > 0 ? `${meta.stats.nulls.toLocaleString()} empty` : "no empties");
    card.append(el("div", { class: "stat-card-foot" }, [parts.join(" · ")]));

    return card;
  }
}

const MINI_BARS = 32;

function buildMiniHistogram(bins: number[]): HTMLElement {
  const wrap = el("div", { class: "mini-hist" });

  // Downsample to at most MINI_BARS bars by summing groups, so the bars stay
  // wide enough to read at card width.
  let bars: number[];
  if (bins.length <= MINI_BARS) {
    bars = bins.slice();
  } else {
    bars = [];
    const groupSize = bins.length / MINI_BARS;
    for (let i = 0; i < MINI_BARS; i++) {
      const start = Math.floor(i * groupSize);
      const end = Math.min(bins.length, Math.floor((i + 1) * groupSize));
      let sum = 0;
      for (let j = start; j < end; j++) sum += bins[j];
      bars.push(sum);
    }
  }

  let max = 0;
  for (const count of bars) {
    if (count > max) max = count;
  }

  const total = bars.reduce((sum, count) => sum + count, 0);
  for (const count of bars) {
    const bar = el("span", { class: "mini-bar" });
    bar.style.height = max > 0 && count > 0 ? `${Math.max(8, (count / max) * 100)}%` : "0%";
    bar.title = `${count.toLocaleString()} (${total > 0 ? ((count / total) * 100).toFixed(1) : "0.0"}%)`;
    wrap.append(bar);
  }
  return wrap;
}

function buildTopValues(topValues: TopValue[]): HTMLElement {
  const wrap = el("div", { class: "top-values" });
  const max = topValues[0]?.count ?? 1;

  for (const entry of topValues.slice(0, 5)) {
    const row = el("div", { class: "top-row" });
    const bar = el("span", { class: "top-bar" });
    const fill = el("i");
    fill.style.width = `${max > 0 ? Math.max(3, (entry.count / max) * 100) : 0}%`;
    bar.append(fill);
    row.append(
      el("span", { class: "top-label", title: entry.label }, [entry.label]),
      bar,
      el("span", { class: "top-count", title: entry.count.toLocaleString() }, [
        COMPACT.format(entry.count),
      ]),
    );
    wrap.append(row);
  }
  return wrap;
}
