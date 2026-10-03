import { clear, el } from "./dom.js";
import { toDateInputValue } from "../parse/dates.js";
import type { TopValue } from "../parse/infer.js";
import { TYPE_LABELS } from "../types.js";
import type { ColumnMeta, LoadedMessage } from "../worker/protocol.js";

const COMPACT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export interface SummaryBandCallbacks {
  onToggleSpecial: (kind: "duplicates" | "nulls") => void;
  onOpenStats: () => void;
  onColumnClick: (column: number) => void;
}

/**
 * Always-visible stats band: a dataset overview card with duplicate/null
 * toggles, followed by one compact card per column (sparkline for numeric and
 * date columns, top-value bars for categories, length stats for text).
 */
export class SummaryBand {
  private duplicateButton!: HTMLButtonElement;
  private nullButton!: HTMLButtonElement;
  private duplicateCount = 0;
  private nullCount = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: SummaryBandCallbacks,
  ) {
    this.root.classList.add("summary-band", "hidden");
  }

  render(loaded: LoadedMessage): void {
    clear(this.root);
    const stats = loaded.stats;
    this.duplicateCount = stats.rowsInDuplicateGroups;
    this.nullCount = stats.rowsWithNulls;

    this.root.append(this.buildOverview(loaded), this.buildColumns(loaded));
    this.setSpecials(false, false);
    this.root.classList.remove("hidden");
  }

  setSpecials(duplicates: boolean, nulls: boolean): void {
    this.duplicateButton.classList.toggle("active", duplicates);
    this.nullButton.classList.toggle("active", nulls);
    this.duplicateButton.textContent = duplicates
      ? "Duplicate rows: on"
      : `Duplicate rows: ${this.duplicateCount.toLocaleString()}`;
    this.nullButton.textContent = nulls
      ? "Null rows: on"
      : `Null rows: ${this.nullCount.toLocaleString()}`;
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  private buildOverview(loaded: LoadedMessage): HTMLElement {
    const overview = el("div", { class: "summary-overview" });

    const numbers = el("div", { class: "overview-numbers" });
    numbers.append(
      el("span", { class: "overview-value" }, [loaded.rowCount.toLocaleString()]),
      el("span", { class: "overview-label" }, ["rows"]),
      el("span", { class: "overview-sep" }, ["·"]),
      el("span", { class: "overview-value" }, [loaded.columnCount.toLocaleString()]),
      el("span", { class: "overview-label" }, ["columns"]),
    );

    const actions = el("div", { class: "overview-actions" });
    this.duplicateButton = el(
      "button",
      { class: "pill action", type: "button", title: "Filter to rows that appear more than once" },
      [],
    ) as HTMLButtonElement;
    this.duplicateButton.addEventListener("click", () => this.callbacks.onToggleSpecial("duplicates"));
    this.nullButton = el(
      "button",
      {
        class: "pill action",
        type: "button",
        title: "Filter to rows with at least one empty cell",
      },
      [],
    ) as HTMLButtonElement;
    this.nullButton.addEventListener("click", () => this.callbacks.onToggleSpecial("nulls"));
    const details = el(
      "button",
      { class: "pill ghost", type: "button", title: "Full per-column statistics" },
      ["Details"],
    );
    details.addEventListener("click", () => this.callbacks.onOpenStats());
    actions.append(this.duplicateButton, this.nullButton, details);

    const emptyPct =
      loaded.stats.totalCells > 0
        ? (loaded.stats.totalNullCells / loaded.stats.totalCells) * 100
        : 0;
    const footParts = [`${emptyPct.toFixed(1)}% empty`];
    if (loaded.encoding === "windows-1252") footParts.push("windows-1252");
    footParts.push(`${Math.round(loaded.ingestMs)} ms`);

    overview.append(numbers, actions, el("div", { class: "overview-foot" }, [footParts.join(" · ")]));
    return overview;
  }

  private buildColumns(loaded: LoadedMessage): HTMLElement {
    const columns = el("div", { class: "summary-columns" });
    loaded.columns.forEach((meta, index) => columns.append(this.buildColumnCard(meta, index)));
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
