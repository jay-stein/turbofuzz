import { el } from "./dom.js";
import {
  formatDurationMs,
  toDateInputValue,
  toDateTimeInputValue,
  toTimeInputValue,
} from "../parse/dates.js";
import type { TopValue } from "../parse/infer.js";
import { isNumericLikeType, isTemporalType, TYPE_LABELS } from "../types.js";
import type { ColumnMeta } from "../worker/protocol.js";

const COMPACT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * One compact column card shared by the Overview grid: sparkline for numeric
 * and date columns, top-value bars for categories, length stats for text,
 * followed by distinct/median/mean and empty-cell counts.
 */
/** Keeps the start and the last 6 characters so long suffixes stay readable. */
export function middleEllipsis(name: string, max = 22): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 7)}…${name.slice(-6)}`;
}

export function buildColumnCard(
  meta: ColumnMeta,
  index: number,
  onColumnClick: (index: number) => void,
): HTMLElement {
  const card = el(
    "button",
    {
      class: "stat-card",
      type: "button",
      "data-column": String(index),
      title: `${meta.name} — ${TYPE_LABELS[meta.type]}`,
    },
  ) as HTMLButtonElement;
  card.addEventListener("click", () => onColumnClick(index));

  const head = el("div", { class: "stat-card-head" });
  head.append(
    el("span", { class: "stat-name", title: meta.name }, [middleEllipsis(meta.name)]),
    el("span", { class: "stat-type" }, [TYPE_LABELS[meta.type]]),
  );
  card.append(head);

  const numeric = isNumericLikeType(meta.type);

  if (numeric && meta.histogram !== null && meta.histogram.max > meta.histogram.min) {
    card.append(buildMiniHistogram(meta.histogram.bins));
  }

  if (numeric) {
    const main = el("div", { class: "stat-card-main" });
    if (meta.stats.min !== null && meta.stats.max !== null) {
      const format = (value: number): string => formatTemporalOrNumber(meta, value);
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
    if (meta.valueFence !== null && !isTemporalType(meta.type)) {
      parts.push(
        `median ${meta.valueFence.center.toLocaleString(undefined, { maximumFractionDigits: 1 })}`,
      );
    }
    if (meta.stats.mean !== null && !isTemporalType(meta.type)) {
      parts.push(`mean ${meta.stats.mean.toLocaleString(undefined, { maximumFractionDigits: 1 })}`);
    }
  } else if (meta.stats.avgLength !== null) {
    parts.push(`len avg ${meta.stats.avgLength.toFixed(1)}`);
  }
  parts.push(meta.stats.nulls > 0 ? `${meta.stats.nulls.toLocaleString()} empty` : "no empties");
  card.append(el("div", { class: "stat-card-foot" }, [parts.join(" · ")]));

  return card;
}

/** Min/max text for a card: temporal types get their own format. */
function formatTemporalOrNumber(meta: ColumnMeta, value: number): string {
  switch (meta.type) {
    case "date":
      return toDateInputValue(value);
    case "datetime":
      return toDateTimeInputValue(value);
    case "time":
      return toTimeInputValue(value);
    case "duration":
      return formatDurationMs(value);
    default:
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
