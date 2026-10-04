import { clear, el, svgIcon } from "./dom.js";
import { toDateInputValue } from "../parse/dates.js";
import type { TopValue } from "../parse/infer.js";
import { TYPE_LABELS } from "../types.js";
import type { DatasetStats } from "../data/stats.js";
import type { ColumnMeta, LoadedMessage, SpecialKind } from "../worker/protocol.js";

const COMPACT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const QA_BUTTONS: { kind: SpecialKind; label: string; title: string }[] = [
  {
    kind: "duplicates",
    label: "Duplicates",
    title: "Rows whose full content appears more than once",
  },
  {
    kind: "nulls",
    label: "Nulls",
    title: "Rows with at least one empty cell",
  },
  {
    kind: "valueAnomalies",
    label: "Value outliers",
    title: "Numbers far from their column's median (modified z-score)",
  },
  {
    kind: "lengthAnomalies",
    label: "Length outliers",
    title: "Text lengths outside each column's 1.5×IQR fences",
  },
];

export interface SummaryBandCallbacks {
  onToggleSpecial: (kind: SpecialKind) => void;
  onOpenStats: () => void;
  onColumnClick: (column: number) => void;
}

/**
 * Always-visible QA block: prominent duplicate/null/anomaly toggles followed
 * by one compact card per column (sparkline for numeric and date columns,
 * top-value bars for categories, length stats for text).
 */
export class SummaryBand {
  private readonly buttons = new Map<SpecialKind, HTMLButtonElement>();
  private readonly active = new Set<SpecialKind>();
  private counts: Record<SpecialKind, number> = {
    duplicates: 0,
    nulls: 0,
    valueAnomalies: 0,
    lengthAnomalies: 0,
  };
  private renderToken = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: SummaryBandCallbacks,
  ) {
    this.root.classList.add("summary-band", "hidden");
  }

  render(loaded: LoadedMessage): void {
    clear(this.root);
    this.buttons.clear();
    this.setCounts(loaded.stats);

    const token = ++this.renderToken;
    this.root.append(this.buildQaBlock(loaded), this.buildColumns(loaded, token));
    this.active.clear();
    this.syncButtons();
    this.root.classList.remove("hidden");
  }

  setSpecials(active: ReadonlySet<SpecialKind>): void {
    this.active.clear();
    for (const kind of active) this.active.add(kind);
    this.syncButtons();
  }

  /** Refreshes the counters (e.g. after a column type change). */
  setCounts(stats: DatasetStats): void {
    this.counts = {
      duplicates: stats.rowsInDuplicateGroups,
      nulls: stats.rowsWithNulls,
      valueAnomalies: stats.valueAnomalyRows,
      lengthAnomalies: stats.lengthAnomalyRows,
    };
    this.syncButtons();
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  private syncButtons(): void {
    for (const { kind, label } of QA_BUTTONS) {
      const button = this.buttons.get(kind);
      if (button === undefined) continue;
      const on = this.active.has(kind);
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.textContent = on
        ? `✓ ${label}: on`
        : `${label}: ${this.counts[kind].toLocaleString()}`;
    }
  }

  private buildQaBlock(loaded: LoadedMessage): HTMLElement {
    const block = el("div", { class: "qa-block" });

    const head = el("div", { class: "qa-head" });
    head.append(
      el("span", { class: "qa-title" }, ["Data QA"]),
      el("span", { class: "qa-sub" }, [
        `${loaded.rowCount.toLocaleString()} rows × ${loaded.columnCount.toLocaleString()} cols`,
      ]),
    );

    const actions = el("div", { class: "qa-actions" });
    for (const { kind, label, title } of QA_BUTTONS) {
      const button = el(
        "button",
        { class: "qa-button", type: "button", title },
        [label],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => this.callbacks.onToggleSpecial(kind));
      this.buttons.set(kind, button);
      actions.append(button);
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

    const emptyPct =
      loaded.stats.totalCells > 0
        ? (loaded.stats.totalNullCells / loaded.stats.totalCells) * 100
        : 0;
    const footParts = [`${emptyPct.toFixed(1)}% empty`];
    if (loaded.encoding === "windows-1252") footParts.push("windows-1252");
    footParts.push(`${Math.round(loaded.ingestMs)} ms`);

    block.append(head, actions, el("div", { class: "overview-foot" }, [footParts.join(" · ")]));
    return block;
  }

  /**
   * Cards are appended in animation-frame chunks: wide datasets (hundreds of
   * columns) paint the first screen immediately instead of building every
   * card synchronously.
   */
  private buildColumns(loaded: LoadedMessage, token: number): HTMLElement {
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

  for (const entry of topValues.slice(0, 3)) {
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
