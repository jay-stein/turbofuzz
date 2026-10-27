import type { ColumnMeta } from "../worker/protocol.js";
import { detectGeoPair } from "../data/geo.js";
import type { ChartCardConfig } from "./chart-card.js";
import {
  type ChartCardKind,
  CHART_KIND_LABELS,
  isCategoryType,
  isIdLikeColumn,
  looksLikeIdName,
} from "./chart-utils.js";
import { el } from "./dom.js";
import { fitSlot, type SlotKind } from "./chart-registry.js";

/** What a tile can or cannot do with the current columns. */
export interface KindFit {
  kind: ChartCardKind;
  ok: boolean;
  reason: string;
  preset: Partial<ChartCardConfig>;
}

interface Pool {
  index: number;
  meta: ColumnMeta;
}

function pool(
  columns: readonly ColumnMeta[],
  allow: (meta: ColumnMeta) => boolean,
  rowCount: number,
): Pool[] {
  const out: Pool[] = [];
  columns.forEach((meta, index) => {
    if (allow(meta) && !isIdLikeColumn(meta, rowCount) && !looksLikeIdName(meta.name)) {
      out.push({ index, meta });
    }
  });
  return out;
}

/** Columns whose registry role fits one of `kinds`, in column order. */
function byRole(columns: readonly ColumnMeta[], rowCount: number, kinds: readonly SlotKind[]): Pool[] {
  const out: Pool[] = [];
  columns.forEach((meta, index) => {
    if (meta.role !== "provenance" && fitSlot(meta, rowCount, kinds).ok) out.push({ index, meta });
  });
  return out;
}

/**
 * Can this chart type answer a question with these columns, and which columns
 * should it start with? Disabled tiles explain what they would need.
 */
export function fitChartKind(
  kind: ChartCardKind,
  columns: readonly ColumnMeta[],
  rowCount: number,
): KindFit {
  const numeric = byRole(columns, rowCount, ["measure"]);
  const dates = byRole(columns, rowCount, ["time"]);
  // Any low-cardinality column can be grouped, but true categories lead so
  // the starting preset is the most natural one.
  const categories = byRole(columns, rowCount, ["cat"])
    .filter((entry) => entry.meta.stats.distinct >= 2)
    .sort((a, b) => Number(isCategoryType(b.meta.type)) - Number(isCategoryType(a.meta.type)));

  switch (kind) {
    case "histogram":
      if (numeric.length >= 1) {
        return { kind, ok: true, reason: "", preset: { kind, column: numeric[0].index } };
      }
      return { kind, ok: false, reason: "needs a numeric column", preset: {} };
    case "line":
      if (dates.length >= 1) {
        return { kind, ok: true, reason: "", preset: { kind, column: dates[0].index } };
      }
      return { kind, ok: false, reason: "needs a date or datetime column", preset: {} };
    case "bar":
      if (categories.length >= 1) {
        return { kind, ok: true, reason: "", preset: { kind, column: categories[0].index } };
      }
      return { kind, ok: false, reason: "needs a grouping column (few distinct values)", preset: {} };
    case "barplot":
      if (categories.length >= 1 && numeric.length >= 1) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: {
            kind,
            column: categories[0].index,
            valueColumn: numeric[0].index,
            valueAgg: "mean",
          },
        };
      }
      return {
        kind,
        ok: false,
        reason:
          categories.length === 0
            ? "needs a grouping column (few distinct values)"
            : "needs a numeric measure",
        preset: {},
      };
    case "treemap": {
      const texts = pool(
        columns,
        (meta) => meta.type === "string" && meta.stats.distinct >= 2,
        rowCount,
      );
      const group = categories[0] ?? texts[0];
      if (group !== undefined) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: { kind, column: group.index, valueAgg: "count" },
        };
      }
      return {
        kind,
        ok: false,
        reason: "needs a text or category column",
        preset: {},
      };
    }
    case "terms": {
      const texts = pool(columns, (meta) => meta.type === "string", rowCount);
      if (texts.length >= 1) {
        return { kind, ok: true, reason: "", preset: { kind, column: texts[0].index } };
      }
      return { kind, ok: false, reason: "needs a text column", preset: {} };
    }
    case "scatter":
    case "density": {
      const axis = [...numeric, ...dates];
      for (const x of axis) {
        for (const y of axis) {
          if (x.index === y.index) continue;
          const xDate = x.meta.type === "date" || x.meta.type === "datetime";
          const yDate = y.meta.type === "date" || y.meta.type === "datetime";
          if (xDate && yDate) continue;
          return { kind, ok: true, reason: "", preset: { kind, x: x.index, y: y.index } };
        }
      }
      return {
        kind,
        ok: false,
        reason:
          axis.length < 2 ? "needs two numeric or date columns" : "needs a numeric and a date column",
        preset: {},
      };
    }
    case "box":
      if (numeric.length >= 1 && categories.length >= 1) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: { kind, x: numeric[0].index, y: categories[0].index },
        };
      }
      return {
        kind,
        ok: false,
        reason:
          numeric.length === 0 ? "needs a numeric column" : "needs a grouping column (few distinct values)",
        preset: {},
      };
    case "heatmap":
      if (categories.length >= 2) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: { kind, x: categories[0].index, y: categories[1].index },
        };
      }
      return { kind, ok: false, reason: "needs two grouping columns (few distinct values)", preset: {} };
    case "bubble": {
      if (numeric.length >= 2) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: { kind, x: numeric[0].index, y: numeric[1].index },
        };
      }
      return { kind, ok: false, reason: "needs two numeric columns", preset: {} };
    }
    case "kpi":
      if (numeric.length >= 1) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: {
            kind,
            column: numeric[0].index,
            valueColumn: numeric[0].index,
            valueAgg: "mean",
          },
        };
      }
      return { kind, ok: false, reason: "needs a numeric column", preset: {} };
    case "map": {
      const geo = detectGeoPair(columns, rowCount);
      if (geo !== null) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: { kind, x: geo.lon, y: geo.lat, suggested: geo.reason },
        };
      }
      return {
        kind,
        ok: false,
        reason: "needs a latitude/longitude pair (numeric columns)",
        preset: {},
      };
    }
    case "dotplot":
      if (categories.length >= 1 && numeric.length >= 1) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: {
            kind,
            column: categories[0].index,
            valueColumn: numeric[0].index,
            valueAgg: "mean",
          },
        };
      }
      return {
        kind,
        ok: false,
        reason: categories.length === 0 ? "needs a grouping column (few distinct values)" : "needs a numeric measure",
        preset: {},
      };
    case "stacked100":
      if (categories.length >= 2 && numeric.length >= 1) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: {
            kind,
            column: categories[0].index,
            groupColumn: categories[1].index,
            valueColumn: numeric[0].index,
            valueAgg: "sum",
          },
        };
      }
      return {
        kind,
        ok: false,
        reason: categories.length < 2 ? "needs two grouping columns (few distinct values)" : "needs a numeric measure",
        preset: {},
      };
    case "smallmultiples":
      if (dates.length >= 1 && categories.length >= 1 && numeric.length >= 1) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: {
            kind,
            column: dates[0].index,
            groupColumn: categories[0].index,
            valueColumn: numeric[0].index,
            valueAgg: "mean",
          },
        };
      }
      return {
        kind,
        ok: false,
        reason:
          dates.length === 0
            ? "needs a date or datetime column"
            : categories.length === 0
              ? "needs a grouping column (few distinct values)"
              : "needs a numeric measure",
        preset: {},
      };
    case "slopegraph": {
      // Two moments to compare: a date (first vs last period) or a category.
      const lines = categories.filter((entry) => entry.index !== categories[0]?.index);
      const point = dates[0] ?? categories.find((entry) => entry.meta.stats.distinct === 2) ?? categories[0];
      const group = categories.find((entry) => entry.index !== point?.index) ?? lines[0];
      if (point !== undefined && group !== undefined && numeric.length >= 1) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: {
            kind,
            column: point.index,
            groupColumn: group.index,
            valueColumn: numeric[0].index,
            valueAgg: "mean",
          },
        };
      }
      return {
        kind,
        ok: false,
        reason:
          numeric.length === 0 ? "needs a numeric measure" : "needs a date or category, plus a grouping column",
        preset: {},
      };
    }
    case "waterfall": {
      const steps = categories[0] ?? dates[0];
      if (steps !== undefined && numeric.length >= 1) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: { kind, column: steps.index, valueColumn: numeric[0].index, valueAgg: "sum" },
        };
      }
      return {
        kind,
        ok: false,
        reason: numeric.length === 0 ? "needs a numeric measure" : "needs a grouping or date column",
        preset: {},
      };
    }
    case "pivotHeatmap":
      return {
        kind,
        ok: false,
        reason: "needs a pivot view source",
        preset: {},
      };
    case "correlation":
      if (numeric.length >= 2) {
        return {
          kind,
          ok: true,
          reason: "",
          preset: { kind, correlationColumns: numeric.slice(0, 8).map((entry) => entry.index) },
        };
      }
      return { kind, ok: false, reason: "needs two numeric columns", preset: {} };
  }
}

/** The gallery groups tiles by the question they answer. */
export const QUESTION_GROUPS: readonly { question: string; kinds: readonly ChartCardKind[] }[] = [
  { question: "What is the headline number?", kinds: ["kpi"] },
  { question: "Where is it?", kinds: ["map"] },
  { question: "How is it distributed?", kinds: ["histogram", "box", "density"] },
  { question: "How does it change over time?", kinds: ["line", "smallmultiples", "slopegraph"] },
  { question: "How do groups compare?", kinds: ["bar", "barplot", "dotplot", "treemap", "heatmap"] },
  { question: "What makes up the whole?", kinds: ["stacked100", "waterfall"] },
  { question: "How are two things related?", kinds: ["scatter", "bubble", "correlation"] },
  { question: "What is the text about?", kinds: ["terms"] },
];

/** Compact inline illustrations — no library, one path each. */
const ICONS: Record<ChartCardKind, string> = {
  kpi: '<rect x="8" y="10" width="56" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.5"/><path d="M16 30l8-7 6 4 10-11 10 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="14" y="15" width="18" height="6" rx="3" fill="currentColor" opacity="0.85"/>',
  map: '<path d="M6 12 24 8l14 6 22-6v30l-22 6-14-6-18 4z" fill="currentColor" opacity="0.35"/><path d="M6 12 24 8l14 6 22-6v30l-22 6-14-6-18 4z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M24 8v30M38 14v30" stroke="currentColor" stroke-width="1" opacity="0.5"/><circle cx="30" cy="24" r="3" fill="currentColor"/><circle cx="48" cy="18" r="2.4" fill="currentColor"/><circle cx="52" cy="32" r="2.4" fill="currentColor"/>',
  histogram:
    '<path d="M6 34V20M14 34V12M22 34V24M30 34V8M38 34V18M46 34V26M54 34V14M62 34V22" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  box: '<path d="M8 18h10M30 18h10M40 18h10M62 18h10" stroke="currentColor" stroke-width="2"/><path d="M18 14h12v8H18zM40 10h12v16H40zM62 15h8v6h-8z" fill="currentColor" opacity="0.55"/><path d="M24 6v24M46 6v24M66 10v16" stroke="currentColor" stroke-width="2"/>',
  density:
    '<circle cx="24" cy="20" r="12" fill="currentColor" opacity="0.25"/><circle cx="44" cy="20" r="14" fill="currentColor" opacity="0.45"/><circle cx="56" cy="18" r="9" fill="currentColor" opacity="0.3"/>',
  line: '<path d="M6 30l12-8 10 5 12-14 10 6 12-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 34h64" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>',
  bar: '<path d="M10 34V22h8v12zM26 34V12h8v22zM42 34V26h8v8zM58 34V16h8v18z" fill="currentColor" opacity="0.8"/>',
  barplot:
    '<path d="M10 34V18h10v16zM28 34V10h10v24zM46 34V22h10v12zM10 38h48" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 34V18h10v16zM28 34V10h10v24zM46 34V22h10v12z" fill="currentColor" opacity="0.7"/>',
  treemap:
    '<rect x="8" y="8" width="34" height="32" fill="currentColor" opacity="0.8"/><rect x="44" y="8" width="20" height="14" fill="currentColor" opacity="0.55"/><rect x="44" y="24" width="20" height="16" fill="currentColor" opacity="0.35"/><rect x="10" y="10" width="16" height="12" fill="currentColor" opacity="0.35"/>',
  terms:
    '<rect x="8" y="12" width="48" height="5" rx="2.5" fill="currentColor" opacity="0.85"/><rect x="8" y="21" width="34" height="5" rx="2.5" fill="currentColor" opacity="0.6"/><rect x="8" y="30" width="24" height="5" rx="2.5" fill="currentColor" opacity="0.4"/><rect x="8" y="39" width="14" height="5" rx="2.5" fill="currentColor" opacity="0.25"/>',
  heatmap:
    '<rect x="8" y="8" width="14" height="14" fill="currentColor" opacity="0.8"/><rect x="24" y="8" width="14" height="14" fill="currentColor" opacity="0.3"/><rect x="40" y="8" width="14" height="14" fill="currentColor" opacity="0.5"/><rect x="8" y="24" width="14" height="14" fill="currentColor" opacity="0.35"/><rect x="24" y="24" width="14" height="14" fill="currentColor" opacity="0.75"/><rect x="40" y="24" width="14" height="14" fill="currentColor" opacity="0.2"/><rect x="56" y="8" width="14" height="14" fill="currentColor" opacity="0.6"/><rect x="56" y="24" width="14" height="14" fill="currentColor" opacity="0.45"/>',
  scatter:
    '<circle cx="14" cy="28" r="3" fill="currentColor"/><circle cx="24" cy="20" r="3" fill="currentColor"/><circle cx="34" cy="24" r="3" fill="currentColor"/><circle cx="44" cy="14" r="3" fill="currentColor"/><circle cx="54" cy="18" r="3" fill="currentColor"/><circle cx="62" cy="10" r="3" fill="currentColor"/>',
  bubble:
    '<circle cx="20" cy="26" r="10" fill="currentColor" opacity="0.35"/><circle cx="40" cy="18" r="7" fill="currentColor" opacity="0.55"/><circle cx="52" cy="30" r="5" fill="currentColor" opacity="0.7"/><circle cx="30" cy="34" r="3" fill="currentColor" opacity="0.8"/>',
  correlation:
    '<rect x="10" y="8" width="16" height="16" fill="currentColor" opacity="0.8"/><rect x="28" y="8" width="16" height="16" fill="currentColor" opacity="0.25"/><rect x="46" y="8" width="16" height="16" fill="currentColor" opacity="0.55"/><rect x="10" y="28" width="16" height="16" fill="currentColor" opacity="0.25"/><rect x="28" y="28" width="16" height="16" fill="currentColor" opacity="0.8"/><rect x="46" y="28" width="16" height="16" fill="currentColor" opacity="0.2"/>',
  dotplot:
    '<path d="M10 12h52M10 24h52M10 36h52" stroke="currentColor" stroke-width="1" opacity="0.25"/><circle cx="46" cy="12" r="4" fill="currentColor"/><circle cx="34" cy="24" r="4" fill="currentColor"/><circle cx="20" cy="36" r="4" fill="currentColor"/>',
  stacked100:
    '<rect x="8" y="10" width="56" height="9" fill="currentColor" opacity="0.85"/><rect x="8" y="10" width="20" height="9" fill="currentColor"/><rect x="8" y="26" width="56" height="9" fill="currentColor" opacity="0.35"/><rect x="8" y="26" width="38" height="9" fill="currentColor" opacity="0.8"/>',
  smallmultiples:
    '<path d="M6 20l7-5 6 3 7-8M40 20l6-2 6 5 8-9M6 42l7-3 6 2 7-6M40 42l7-6 6 3 8-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 24h24M40 24h26M6 44h24M40 44h26" stroke="currentColor" stroke-width="1" opacity="0.4"/>',
  slopegraph:
    '<path d="M16 10v30M56 10v30" stroke="currentColor" stroke-width="1.5" opacity="0.4"/><path d="M16 14L56 32M16 24L56 14M16 34L56 38" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="14" r="2.6" fill="currentColor"/><circle cx="56" cy="32" r="2.6" fill="currentColor"/><circle cx="16" cy="24" r="2.6" fill="currentColor"/><circle cx="56" cy="14" r="2.6" fill="currentColor"/>',
  waterfall:
    '<rect x="8" y="22" width="9" height="16" fill="currentColor" opacity="0.8"/><rect x="21" y="12" width="9" height="10" fill="currentColor" opacity="0.5"/><rect x="34" y="12" width="9" height="14" fill="currentColor" opacity="0.3"/><rect x="47" y="16" width="9" height="10" fill="currentColor" opacity="0.5"/><rect x="60" y="16" width="6" height="22" fill="currentColor" opacity="0.8"/>',
  pivotHeatmap:
    '<rect x="8" y="8" width="18" height="10" fill="currentColor" opacity="0.75"/><rect x="28" y="8" width="18" height="10" fill="currentColor" opacity="0.35"/><rect x="48" y="8" width="16" height="10" fill="currentColor" opacity="0.55"/><rect x="8" y="20" width="18" height="10" fill="currentColor" opacity="0.35"/><rect x="28" y="20" width="18" height="10" fill="currentColor" opacity="0.85"/><rect x="48" y="20" width="16" height="10" fill="currentColor" opacity="0.25"/><rect x="8" y="32" width="18" height="8" fill="currentColor" opacity="0.55"/><rect x="28" y="32" width="18" height="8" fill="currentColor" opacity="0.25"/><rect x="48" y="32" width="16" height="8" fill="currentColor" opacity="0.7"/>',
};

function svgWrap(inner: string): HTMLElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 72 48");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = inner;
  const wrap = el("span", { class: "chart-tile-preview" });
  wrap.append(svg as unknown as HTMLElement);
  return wrap;
}

function miniBars(counts: readonly number[]): string {
  const max = Math.max(1, ...counts);
  const n = Math.max(1, counts.length);
  const width = 72 / n;
  let inner = "";
  counts.forEach((count, index) => {
    const height = Math.max(1, (count / max) * 36);
    inner += `<rect x="${(index * width + 1).toFixed(2)}" y="${(44 - height).toFixed(
      2,
    )}" width="${Math.max(1, width - 2).toFixed(2)}" height="${height.toFixed(
      2,
    )}" fill="currentColor" opacity="0.75"/>`;
  });
  return inner;
}

function miniLine(counts: readonly number[]): string {
  const max = Math.max(1, ...counts);
  const n = Math.max(1, counts.length);
  const step = n === 1 ? 0 : 66 / (n - 1);
  const points = counts
    .map((count, index) => `${(3 + index * step).toFixed(2)},${(42 - (count / max) * 32).toFixed(2)}`)
    .join(" ");
  return `<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** A live preview from the bins/facets already on the client. */
export function previewFor(kind: ChartCardKind, preset: Partial<ChartCardConfig>, columns: readonly ColumnMeta[]): HTMLElement {
  if (preset.column !== undefined && preset.column >= 0) {
    const meta = columns[preset.column];
    if (kind === "histogram" && meta?.histogram !== null && meta?.histogram !== undefined) {
      return svgWrap(miniBars(meta.histogram.bins));
    }
    if (kind === "line" && meta?.histogram !== null && meta?.histogram !== undefined) {
      return svgWrap(miniLine(meta.histogram.bins));
    }
    if (kind === "bar" && meta?.categories !== null && meta?.categories !== undefined) {
      return svgWrap(miniBars(meta.categories.counts.slice(0, 12)));
    }
  }
  return svgWrap(ICONS[kind]);
}

export const CHART_KIND_ICONS: Record<ChartCardKind, string> = ICONS;

/** Every kind in the gallery's question order, for the chart rail. */
export const GALLERY_KINDS: readonly ChartCardKind[] = QUESTION_GROUPS.flatMap(
  (group) => group.kinds,
);

