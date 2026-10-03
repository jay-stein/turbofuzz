import { clear, el } from "./dom.js";
import { toDateInputValue } from "../parse/dates.js";
import { TYPE_LABELS } from "../types.js";
import type { ColumnMeta, LoadedMessage } from "../worker/protocol.js";

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
      card.append(buildSparkline(meta.histogram.bins));
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
    } else if (meta.categories !== null && meta.categories.labels.length > 0) {
      card.append(buildCategoryBars(meta));
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

function buildSparkline(bins: number[]): SVGElement {
  const width = 120;
  const height = 26;
  let max = 0;
  for (const bin of bins) {
    if (bin > max) max = bin;
  }

  const points: string[] = [];
  if (max > 0 && bins.length > 1) {
    for (let i = 0; i < bins.length; i++) {
      const x = (i / (bins.length - 1)) * width;
      const y = height - (bins[i] / max) * (height - 3) - 1;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", points.join(" "));
  svg.append(polyline);
  return svg;
}

function buildCategoryBars(meta: ColumnMeta): HTMLElement {
  const wrap = el("div", { class: "cat-bars" });
  const categories = meta.categories;
  if (categories === null) return wrap;

  const entries = categories.labels.map((label, index) => ({
    label,
    count: categories.counts[index],
  }));
  entries.sort((a, b) => b.count - a.count);
  const max = entries.length > 0 ? entries[0].count : 1;

  for (const entry of entries.slice(0, 3)) {
    const row = el("div", { class: "cat-row" });
    const bar = el("span", { class: "cat-bar" });
    const fill = el("i");
    fill.style.width = `${max > 0 ? Math.max(3, (entry.count / max) * 100) : 0}%`;
    bar.append(fill);
    row.append(el("span", { class: "cat-label", title: entry.label }, [entry.label]), bar);
    wrap.append(row);
  }
  return wrap;
}
