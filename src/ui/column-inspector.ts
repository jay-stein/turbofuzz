import { describeSuggestion } from "../data/suggestions.js";
import {
  formatDurationMs,
  toDateInputValue,
  toDateTimeInputValue,
  toTimeInputValue,
} from "../parse/dates.js";
import { TYPE_LABELS, isNumericLikeType, isTemporalType } from "../types.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { el } from "./dom.js";
import { TYPE_FAMILY, TYPE_GLYPHS } from "./type-glyphs.js";

export interface ColumnInspectorInfo {
  /** Rows in the data, so counts can be read as shares. */
  rowCount?: number;
  /** Why this column is flagged as possibly sensitive (one line per reason), or empty. */
  sensitiveWhy?: readonly string[];
  /** Fixed decimals chosen for display, or null for automatic. */
  displayFormat?: number | null;
  displayGrouping?: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function section(title: string, aside?: string): HTMLElement {
  const head = el("div", { class: "inspector-section-title" }, [title]);
  if (aside !== undefined) head.append(el("span", { class: "inspector-section-aside" }, [aside]));
  return el("div", { class: "inspector-section" }, [head]);
}

function tile(label: string, value: string, title?: string): HTMLElement {
  const node = el("div", { class: "inspector-tile" }, [
    el("span", { class: "inspector-tile-label" }, [label]),
    el("span", { class: "inspector-tile-value" }, [value]),
  ]);
  if (title !== undefined) node.title = title;
  return node;
}

function share(part: number, whole: number): string {
  if (whole <= 0) return "";
  const pct = (part / whole) * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/** A small bar chart of the column's histogram bins. */
function histogramSvg(bins: readonly number[]): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "inspector-hist");
  svg.setAttribute("viewBox", `0 0 ${bins.length * 4} 40`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const peak = Math.max(1, ...bins);
  bins.forEach((value, index) => {
    const height = value === 0 ? 0 : Math.max(1.5, (value / peak) * 40);
    const bar = document.createElementNS(SVG_NS, "rect");
    bar.setAttribute("x", String(index * 4 + 0.4));
    bar.setAttribute("y", String(40 - height));
    bar.setAttribute("width", "3.2");
    bar.setAttribute("height", String(height));
    bar.setAttribute("rx", "0.6");
    svg.append(bar);
  });
  return svg;
}

/**
 * Column inspector: click a header name to read about the column — its
 * profile, distribution, most common values and what looks wrong. It only
 * reports; every action on the column is on the header's right-click menu.
 */
export function openColumnInspector(
  anchor: HTMLElement,
  meta: ColumnMeta,
  column: number,
  info: ColumnInspectorInfo = {},
): void {
  for (const stale of document.querySelectorAll(".column-inspector")) stale.remove();
  const panel = el("div", {
    class: "column-inspector",
    role: "dialog",
    "aria-label": `About column “${meta.name}”`,
  });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    panel.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", close);
    anchor.classList.remove("inspecting");
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };

  const rows = info.rowCount ?? 0;
  const filled = Math.max(0, rows - meta.stats.nulls);
  const numeric = isNumericLikeType(meta.type);
  const formatValue = (value: number): string =>
    meta.type === "datetime"
      ? toDateTimeInputValue(value)
      : meta.type === "date"
        ? toDateInputValue(value)
        : meta.type === "time"
          ? toTimeInputValue(value)
          : meta.type === "duration"
            ? formatDurationMs(value)
            : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  // Head: type chip, name, type and position.
  const head = el("div", { class: "inspector-head" });
  head.append(
    el("span", { class: "inspector-glyph", "data-fam": TYPE_FAMILY[meta.type] }, [TYPE_GLYPHS[meta.type]]),
    el("div", { class: "inspector-titles" }, [
      el("div", { class: "inspector-name", title: meta.name }, [meta.name]),
      el("div", { class: "inspector-type" }, [`${TYPE_LABELS[meta.type]} · column ${column + 1}`]),
    ]),
  );
  panel.append(head);

  // Completeness: how much of the column holds a value.
  if (rows > 0) {
    const complete = section("Completeness", `${share(filled, rows)} filled`);
    const bar = el("div", { class: "inspector-meter", role: "img", "aria-label": `${share(filled, rows)} of rows have a value` });
    bar.append(el("span", { class: "inspector-meter-fill", style: `width: ${(filled / rows) * 100}%` }));
    complete.append(
      bar,
      el("div", { class: "inspector-meter-legend" }, [
        el("span", {}, [`${filled.toLocaleString()} values`]),
        el("span", { class: meta.stats.nulls > 0 ? "warn" : "" }, [`${meta.stats.nulls.toLocaleString()} empty`]),
      ]),
    );
    panel.append(complete);
  }

  // Profile tiles.
  const profile = section("Profile");
  const grid = el("div", { class: "inspector-grid" });
  const unique = filled > 0 && meta.stats.distinct === filled;
  grid.append(
    tile("Distinct", meta.stats.distinct.toLocaleString(), unique ? "Every filled cell holds a different value" : undefined),
  );
  // Completeness already shows the empty count when the row count is known.
  if (rows === 0) grid.append(tile("Empty", meta.stats.nulls.toLocaleString()));
  if (numeric && meta.stats.min !== null && meta.stats.max !== null) {
    grid.append(tile("Min", formatValue(meta.stats.min)), tile("Max", formatValue(meta.stats.max)));
    if (meta.stats.mean !== null) grid.append(tile("Mean", formatValue(meta.stats.mean)));
    if (meta.valueFence !== null && !isTemporalType(meta.type)) grid.append(tile("Median", formatValue(meta.valueFence.center)));
    if (meta.stats.stddev !== null && !isTemporalType(meta.type)) {
      grid.append(tile("Std dev", meta.stats.stddev.toLocaleString(undefined, { maximumFractionDigits: 2 })));
    }
  } else if (meta.stats.avgLength !== null) {
    grid.append(tile("Avg length", meta.stats.avgLength.toFixed(1)));
    if (meta.stats.maxLength !== null) grid.append(tile("Max length", String(meta.stats.maxLength)));
  }
  profile.append(grid);
  panel.append(profile);

  // Distribution, for numbers and dates.
  const histogram = meta.histogram;
  if (numeric && histogram !== null && histogram.bins.length > 1 && histogram.bins.some((bin) => bin > 0)) {
    const dist = section("Distribution", histogram.symlog ? "log scale" : undefined);
    dist.append(
      histogramSvg(histogram.bins),
      el("div", { class: "inspector-axis" }, [
        el("span", {}, [formatValue(histogram.min)]),
        el("span", {}, [formatValue(histogram.max)]),
      ]),
    );
    panel.append(dist);
  }

  // Most common values, for text and categories.
  const top = meta.stats.topValues.slice(0, 5);
  if (!numeric && top.length > 0 && meta.stats.distinct > 1) {
    const common = section("Most common");
    const peak = Math.max(1, ...top.map((entry) => entry.count));
    const list = el("div", { class: "inspector-values" });
    for (const entry of top) {
      const row = el("div", { class: "inspector-value", title: `${entry.label} — ${entry.count.toLocaleString()}` });
      row.append(
        el("span", { class: "inspector-value-bar", style: `width: ${(entry.count / peak) * 100}%` }),
        el("span", { class: "inspector-value-label" }, [entry.label === "" ? "(blank)" : entry.label]),
        el("span", { class: "inspector-value-count" }, [rows > 0 ? share(entry.count, rows) : entry.count.toLocaleString()]),
      );
      list.append(row);
    }
    common.append(list);
    panel.append(common);
  }

  // Format: the dominant shape of the values.
  const pattern = meta.pattern ?? null;
  if (pattern !== null) {
    const format = section("Format");
    format.append(
      el("div", { class: "inspector-pattern" }, [
        el("code", {}, [pattern.mask]),
        el("span", {}, [`${Math.round(pattern.share * 100)}% of values`]),
      ]),
    );
    panel.append(format);
  }

  // What looks wrong: a read-only list.
  const findings: { text: string; level: "warn" | "info"; title?: string }[] = [];
  const tokens = meta.nullTokens.filter((token) => token.label !== "" && token.count > 0);
  if (tokens.length > 0) {
    findings.push({
      level: "warn",
      text: `${tokens.reduce((sum, token) => sum + token.count, 0).toLocaleString()} cells hold placeholder text (${tokens
        .slice(0, 3)
        .map((token) => `“${token.label}”`)
        .join(", ")})`,
    });
  }
  if (meta.anomalyCounts.values > 0) {
    findings.push({ level: "warn", text: `${meta.anomalyCounts.values.toLocaleString()} value outlier${meta.anomalyCounts.values === 1 ? "" : "s"}, outside the robust fence` });
  }
  if (meta.anomalyCounts.lengths > 0) {
    findings.push({ level: "warn", text: `${meta.anomalyCounts.lengths.toLocaleString()} unusually long value${meta.anomalyCounts.lengths === 1 ? "" : "s"}` });
  }
  if (pattern !== null && pattern.offCount > 0) {
    findings.push({ level: "warn", text: `${pattern.offCount.toLocaleString()} value${pattern.offCount === 1 ? " doesn't" : "s don't"} match ${pattern.mask}` });
  }
  if (meta.similarGroups > 0) {
    findings.push({ level: "info", text: `${meta.similarGroups.toLocaleString()} pair${meta.similarGroups === 1 ? "" : "s"} of near-identical values` });
  }
  if (meta.stats.distinct === 1) findings.push({ level: "info", text: "Every filled cell has the same value" });
  for (const suggestion of meta.suggestions) {
    const text = describeSuggestion(suggestion)
      .replace(/\.\s*Exports can.*$/, ".")
      .replace(/[;:.]?\s*click to[^.]*\.?\s*$/i, ".");
    findings.push({ level: "info", text, title: describeSuggestion(suggestion) });
  }
  const issues = section("Findings", findings.length > 0 ? String(findings.length) : undefined);
  if (findings.length === 0) {
    issues.append(el("div", { class: "inspector-none" }, ["No issues found in this column."]));
  } else {
    const list = el("ul", { class: "inspector-findings" });
    for (const finding of findings) {
      const item = el("li", { class: `inspector-finding ${finding.level}` }, [finding.text]);
      if (finding.title !== undefined) item.title = finding.title;
      list.append(item);
    }
    issues.append(list);
  }
  panel.append(issues);

  if (info.sensitiveWhy !== undefined && info.sensitiveWhy.length > 0) {
    const sensitive = section("Possibly sensitive");
    sensitive.append(
      el("div", { class: "inspector-note" }, [`${info.sensitiveWhy.join("; ")}. Advisory only; not counted in the score.`]),
    );
    panel.append(sensitive);
  }

  if (info.displayFormat != null || info.displayGrouping === true) {
    const parts: string[] = [];
    if (info.displayFormat != null) parts.push(`${info.displayFormat} decimal${info.displayFormat === 1 ? "" : "s"}`);
    if (info.displayGrouping === true) parts.push("thousands separators");
    const display = section("Display");
    display.append(el("div", { class: "inspector-note" }, [`Shown with ${parts.join(" and ")} — the stored values are unchanged.`]));
    panel.append(display);
  }

  panel.append(
    el("div", { class: "inspector-foot" }, [
      "Right-click the header for every action",
      el("kbd", {}, ["Shift F10"]),
    ]),
  );

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", close);
  document.body.append(panel);
  anchor.classList.add("inspecting");
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - panel.offsetHeight - 8))}px`;
}
