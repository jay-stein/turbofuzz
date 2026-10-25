import type { ColumnMeta } from "../worker/protocol.js";
import { detectGeoPair } from "../data/geo.js";
import type { ChartCardConfig } from "./chart-card.js";
import {
  type ChartCardKind,
  CHART_KIND_LABELS,
  type ChartIdea,
  isCategoryType,
  isIdLikeColumn,
  isNumericType,
  looksLikeIdName,
  suggestCharts,
} from "./chart-utils.js";
import { el } from "./dom.js";

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

/**
 * Can this chart type answer a question with these columns, and which columns
 * should it start with? Disabled tiles explain what they would need.
 */
export function fitChartKind(
  kind: ChartCardKind,
  columns: readonly ColumnMeta[],
  rowCount: number,
): KindFit {
  const numeric = pool(
    columns,
    (meta) => isNumericType(meta.type) || meta.type === "duration",
    rowCount,
  );
  const dates = pool(
    columns,
    (meta) => meta.type === "date" || meta.type === "datetime",
    rowCount,
  );
  const categories = pool(
    columns,
    (meta) => isCategoryType(meta.type) && meta.stats.distinct >= 2,
    rowCount,
  );

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
      return { kind, ok: false, reason: "needs a category column", preset: {} };
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
            ? "needs a category column"
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
        reason: "needs a category or text column",
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
          numeric.length === 0 ? "needs a numeric column" : "needs a category column",
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
      return { kind, ok: false, reason: "needs two category columns", preset: {} };
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
  { question: "How does it change over time?", kinds: ["line"] },
  { question: "How do groups compare?", kinds: ["bar", "barplot", "treemap", "heatmap"] },
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
function previewFor(kind: ChartCardKind, preset: Partial<ChartCardConfig>, columns: readonly ColumnMeta[]): HTMLElement {
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

export interface ChartGalleryOptions {
  columns: readonly ColumnMeta[];
  rowCount: number;
  onPick: (preset: Partial<ChartCardConfig>) => void;
}

/**
 * The "+ Add chart" gallery: suggested tiles with live previews drawn from
 * already-computed bins/facets, then every chart type grouped by question.
 * Tiles that do not fit the columns are disabled and say why.
 */
export function openChartGallery(anchor: HTMLElement, options: ChartGalleryOptions): void {
  const gallery = el("div", { class: "context-menu chart-gallery", role: "dialog" });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    gallery.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", close);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!gallery.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };

  const pick = (preset: Partial<ChartCardConfig>): void => {
    close();
    options.onPick(preset);
  };

  const tile = (
    kind: ChartCardKind,
    preset: Partial<ChartCardConfig>,
    preview: HTMLElement,
    enabled = true,
  ): HTMLButtonElement => {
    const button = el(
      "button",
      {
        class: "chart-tile",
        type: "button",
        title: CHART_KIND_LABELS[kind],
        "aria-disabled": enabled ? "false" : "true",
      },
      [],
    ) as HTMLButtonElement;
    button.append(preview, el("span", { class: "chart-tile-label" }, [CHART_KIND_LABELS[kind]]));
    if (enabled) button.addEventListener("click", () => pick(preset));
    return button;
  };

  const ideas = suggestCharts([...options.columns], options.rowCount);
  if (ideas.length > 0) {
    gallery.append(el("div", { class: "context-header" }, ["Suggested for your data"]));
    const grid = el("div", { class: "chart-gallery-grid" });
    for (const idea of ideas) {
      const kind = idea.preset.kind ?? "histogram";
      const preview = previewFor(kind, idea.preset, options.columns);
      const button = tile(kind, idea.preset, preview);
      button.title = idea.label;
      button.querySelector(".chart-tile-label")!.textContent = idea.label;
      grid.append(button);
    }
    gallery.append(grid);
  }

  gallery.append(el("div", { class: "context-header" }, ["All chart types"]));
  for (const group of QUESTION_GROUPS) {
    const label = el("div", { class: "chart-gallery-question" }, [group.question]);
    const grid = el("div", { class: "chart-gallery-grid" });
    for (const kind of group.kinds) {
      const fit = fitChartKind(kind, options.columns, options.rowCount);
      const button = tile(kind, fit.preset, svgWrap(ICONS[kind]), fit.ok);
      if (!fit.ok) {
        button.title = `${CHART_KIND_LABELS[kind]} — ${fit.reason}`;
        const reason = el("span", {
          class: "chart-tile-reason",
          id: `chart-gallery-reason-${kind}`,
        }, [fit.reason]);
        button.append(reason);
        button.setAttribute("aria-describedby", reason.id);
      } else {
        button.title = `${CHART_KIND_LABELS[kind]} — add with sensible columns`;
      }
      grid.append(button);
    }
    gallery.append(label, grid);
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", close);
  document.body.append(gallery);
  const rect = anchor.getBoundingClientRect();
  gallery.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - gallery.offsetWidth - 8))}px`;
  gallery.style.top = `${Math.max(
    8,
    Math.min(rect.bottom + 6, window.innerHeight - gallery.offsetHeight - 8),
  )}px`;
}

/** Icon markup per kind, reused by the chart rail. */
export const CHART_KIND_ICONS: Record<ChartCardKind, string> = ICONS;

/** Every kind in the gallery's question order, for the chart rail. */
export const GALLERY_KINDS: readonly ChartCardKind[] = QUESTION_GROUPS.flatMap(
  (group) => group.kinds,
);

export type { ChartIdea };
