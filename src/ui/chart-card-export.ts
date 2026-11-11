/**
 * Getting a chart out: the numbers behind it, CSV, PNG, the chart spec and code, the card menu and the stats extract.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import { tableFiltersForHitActions } from "./chart-hit-regions.js";
import type { GridCountsResult } from "../data/chart-stats.js";
import { binnedSummary, binRows, linearFit, num, seriesRows, summarise, type ChartExtract, type ExtractSection } from "../data/chart-extract.js";
import { symlog as symlogValue, symlogInverse } from "../data/symlog.js";
import { openChartStats } from "./chart-stats-dialog.js";
import { smoothSeries } from "../data/kde.js";
import { chartSpecJson, chartSpecToPandas, chartSpecToPolars, type ChartSpec } from "./chart-spec.js";
import { type ChartCardKind, formatChartNumber, plainMeasureName, VALUE_AGGREGATE_KINDS, safeFileName } from "./chart-utils.js";
import { downloadCsv } from "./chart-export.js";
import { clear, el } from "./dom.js";
import { openConfirm } from "./dialog.js";
import { openMenu } from "./menu.js";
import type { ChartCard } from "./chart-card.js";
import { KDE_SIGMA_BINS } from "./chart-card.js";

/** Hidden file picker for importing a previously downloaded ChartSpec. */
export function importChartSpecFile(card: ChartCard): void {
  const input = el("input", {
    type: "file",
    accept: ".json,application/json",
    class: "hidden",
  }) as HTMLInputElement;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    void file
      .text()
      .then((text) => {
        const issues = card.applySpecText(text);
        if (issues.length === 0) {
          card.noteEl.textContent = "Applied chart spec.";
          return;
        }
        card.noteEl.textContent = issues[0] ?? "The chart spec could not be applied.";
        void openConfirm({
          title: "Cannot apply chart spec",
          body: issues.join("\n"),
          confirmLabel: "Close",
        });
      })
      .catch((error: unknown) => {
        card.noteEl.textContent =
          error instanceof Error ? error.message : "Could not read the chart spec.";
      });
  });
  input.click();
}

export function exportPng(card: ChartCard, width: number, height: number): void {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  card.drawChart(ctx, width, height, true);
  if (typeof canvas.toBlob !== "function") return;
  const name = `${safeFileName(card.options.datasetName())}-${safeFileName(
    card.chartName(),
  )}-${width}x${height}.png`;
  canvas.toBlob((blob) => {
    if (blob === null) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

/** Download the data already behind this chart, not a re-query of the table. */
export function openStats(card: ChartCard): void {
  const extract = card.chartExtract();
  if (extract.sections.length === 0) {
    card.noteEl.textContent = "No chart numbers are ready yet: finish choosing the fields, or wait for the chart to draw.";
    return;
  }
  openChartStats(extract, `${safeFileName(card.options.datasetName())}-${safeFileName(card.chartName())}-stats.csv`);
}

/** What Extract stats shows: how the chart was drawn, then the numbers it was drawn from. */
export function chartExtract(card: ChartCard): ChartExtract {
  const kind = card.config.kind;
  const facts: [string, string][] = [];
  const scope = card.scopeEl.textContent?.trim() ?? "";
  if (scope !== "") facts.push(["Data", scope]);
  const sections: ExtractSection[] = [];
  const title = card.summaryEl.textContent?.trim() || card.chartName();
  const done = (): ChartExtract => ({ title, facts, sections });
  const table = (name: string, rows: string[][]): void => {
    if (rows.length >= 2) sections.push({ title: name, rows });
  };

  if (card.animationResult !== null && card.animationResult.places === undefined) {
    facts.push(["Animation", "These numbers cover all periods together, not the frame showing"]);
  }
  if (kind === "histogram" && card.groupResult === null) {
    card.histogramExtract(facts, table);
    return done();
  }
  if (card.regionsOn()) {
    card.regions?.extract(facts, table);
    return done();
  }
  if (kind === "map" && card.config.mapMode !== "heat") {
    card.mapExtract(facts, table);
    return done();
  }
  if (kind === "scatter" && card.seriesResult?.mode === "points") {
    const points = card.seriesResult;
    if (Number.isFinite(card.seriesCorrelation)) facts.push(["Pearson r, every row", card.seriesCorrelation.toFixed(4)]);
    const fit = linearFit(points.x, points.y, points.shown);
    if (fit !== null) {
      const where = points.sampled ? `the ${points.shown.toLocaleString()} points sampled from ${points.total.toLocaleString()}` : `all ${points.shown.toLocaleString()} points`;
      facts.push(["Straight line y = a + b·x, on " + where, `a = ${fit.intercept}, b = ${fit.slope}, R² = ${fit.r2.toFixed(4)}`]);
    }
    table("Points", card.chartCsvRows());
    return done();
  }
  if (kind === "box") {
    facts.push(["Box rule", "Tukey: the box is Q1 to Q3; whiskers reach the furthest values within 1.5 × IQR; beyond them are outliers. Every row counts; only the outliers drawn are thinned when there are many"]);
    const result = card.boxResult;
    if (result !== null) {
      const rows = card.chartCsvRows();
      const iqrAt = rows[0]!.indexOf("q3") + 1;
      rows[0]!.splice(iqrAt, 0, "iqr");
      result.groups.forEach((group, index) => rows[index + 1]?.splice(iqrAt, 0, num(group.q3 - group.q1)));
      table("Ranges by group", rows);
    }
    return done();
  }
  const aggregate = card.aggregateResult();
  if (aggregate !== null && aggregate.groupCount > 0 && new Set<ChartCardKind>(VALUE_AGGREGATE_KINDS).has(kind)) {
    const labels = aggregate.dimensions[0] ?? [];
    const summary: string[][] = [["measure", "groups", "total", "mean", "sd", "lowest", "lowest_at", "highest", "highest_at"]];
    aggregate.measures.forEach((values, index) => {
      const stats = summarise(values);
      if (stats === null) return;
      summary.push([
        plainMeasureName(aggregate.measureNames[index] ?? "value"),
        String(stats.n),
        num(stats.sum),
        num(stats.mean),
        num(stats.sd),
        num(stats.min),
        labels[stats.minAt] ?? "",
        num(stats.max),
        labels[stats.maxAt] ?? "",
      ]);
    });
    table("Summary", summary);
    card.errorBarExtract(aggregate, facts, table);
    const series = aggregate.dimensions[1];
    if (series !== undefined && aggregate.measures[0] !== undefined) {
      table(`Each ${aggregate.dimensionNames[1] ?? "series"}`, seriesRows([aggregate.dimensionNames[1] ?? "series"], series, labels, aggregate.measures[0]));
    }
    table("Values", card.chartCsvRows());
    return done();
  }
  table("Values", card.chartCsvRows());
  return done();
}

/** The bins a histogram draws, with their edges: the automatic ones (on a log-like scale when skewed) or the chosen. */
export function drawnBins(card: ChartCard): { bins: readonly number[]; edges: number[]; overflow: number; symlog: boolean; below: number; above: number } | null {
  const meta = card.meta(card.config.column);
  const automatic = meta?.histogram;
  if (meta === undefined || automatic === null || automatic === undefined) return null;
  const custom = card.binResult;
  const live = card.histograms[card.config.column] ?? automatic.bins;
  const bins: readonly number[] = custom !== null ? custom.bins : card.withoutExcludedBins(live, automatic.min, automatic.max);
  if (bins.length === 0) return null;
  const min = card.chartXZoom?.min ?? card.config.binOptions?.min ?? automatic.min;
  const max = card.chartXZoom?.max ?? card.config.binOptions?.max ?? automatic.max;
  const symlog = custom === null && automatic.symlog;
  const edges = Array.from({ length: bins.length + 1 }, (_, index) => {
    const share = index / bins.length;
    if (index === 0) return min;
    if (index === bins.length) return max;
    if (symlog) return symlogInverse(symlogValue(min) + share * (symlogValue(max) - symlogValue(min)));
    return min + share * (max - min);
  });
  return {
    bins,
    edges,
    overflow: custom?.overflow ?? 0,
    symlog,
    below: custom === null ? automatic.below : 0,
    above: custom === null ? automatic.above : 0,
  };
}

export function histogramExtract(card: ChartCard, facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
  const drawn = card.drawnBins();
  const meta = card.meta(card.config.column);
  if (drawn === null || meta === undefined) return;
  const { bins, edges, overflow, symlog, below, above } = drawn;
  const dated = meta.type === "date" || meta.type === "datetime";
  const format = dated ? (value: number): string => (Number.isFinite(value) ? new Date(value).toISOString() : "") : num;
  const fact = dated ? format : formatChartNumber;
  facts.push(["Bins", `${bins.length}, from ${fact(edges[0]!)} to ${fact(edges[bins.length]!)}`]);
  facts.push(["Bin width", symlog ? "even on a log-like scale, so the edges below are not evenly spaced" : dated ? `${num((edges[1]! - edges[0]!) / 86_400_000)} days` : num(edges[1]! - edges[0]!)]);
  if (overflow > 0) facts.push(["Above the last bin", overflow.toLocaleString()]);
  if (below + above > 0) {
    facts.push(["Left out of the bins", `${below.toLocaleString()} below the first, ${above.toLocaleString()} above the last: the automatic range is the 1st to 99th percentile, so a few extremes cannot flatten the rest. Set a range in the settings to include them`]);
  }
  const summary = binnedSummary(bins, edges);
  if (summary !== null) {
    facts.push(["Rows in the bins", summary.n.toLocaleString()]);
    if (!dated) {
      facts.push(["Mean, estimated from the bins", formatChartNumber(summary.mean)]);
      facts.push(["Standard deviation, estimated from the bins", formatChartNumber(summary.sd)]);
    }
  }
  if (card.binMedian !== null && !dated) facts.push(["Median", num(card.binMedian)]);
  const kde = card.config.kde && bins.length >= 4;
  if (kde) {
    facts.push(["KDE curve", `Gaussian kernel, width ${KDE_SIGMA_BINS} bins${symlog ? "" : ` = ${num(KDE_SIGMA_BINS * (edges[1]! - edges[0]!))} in the column's units`}. It smooths the bin counts rather than being fitted to each row, and is on the count scale`]);
  }
  table("Bins", binRows(bins, edges, kde ? smoothSeries(bins, KDE_SIGMA_BINS) : null, format, overflow));
}

export function exportCsv(card: ChartCard): void {
  const rows = card.chartCsvRows();
  if (rows.length < 2) {
    card.noteEl.textContent = "No chart data is available to export yet.";
    return;
  }
  const name = `${safeFileName(card.options.datasetName())}-${safeFileName(
    card.chartName(),
  )}.csv`;
  if (!downloadCsv(name, rows)) {
    card.noteEl.textContent = "This browser cannot download the chart data.";
    return;
  }
  card.noteEl.textContent = `Exported ${(rows.length - 1).toLocaleString()} chart data rows to ${name}`;
}

export function chartCsvRows(card: ChartCard): string[][] {
  if (card.config.kind === "pivotHeatmap") {
    const data = card.pivotHeatmapData();
    if (data === null) return [];
    const rows: string[][] = [[data.rowName, ...data.colLabels]];
    data.rowLabels.forEach((label, row) => {
      rows.push([
        label,
        ...data.colLabels.map((_, col) => {
          const value = data.values[row * data.colLabels.length + col];
          return Number.isFinite(value) ? String(value) : "";
        }),
      ]);
    });
    return rows;
  }    const number = (value: number): string =>
    Number.isFinite(value) ? String(value) : "";
  const aggregate = card.aggregateResult();
  const aggregateKinds = new Set<ChartCardKind>(VALUE_AGGREGATE_KINDS);
  if (
    aggregate !== null &&
    aggregate.groupCount > 0 &&
    aggregateKinds.has(card.config.kind) &&
    (card.config.source !== "" || (card.config.valueColumn ?? -1) >= 0)
  ) {
    const names = [
      ...aggregate.dimensionNames,
      ...aggregate.measureNames,
    ];
    const rows: string[][] = [names];
    for (let index = 0; index < aggregate.groupCount; index++) {
      rows.push([
        ...aggregate.dimensions.map((dimension) => dimension[index] ?? ""),
        ...aggregate.measures.map((measure) => number(measure[index] ?? Number.NaN)),
      ]);
    }
    return rows;
  }

  if (card.config.kind === "bar") {
    const bars = card.allCategoryBars();
    if (bars.length === 0) return [];
    return [
      ["category", "count", "percent", "is_other"],
      ...bars.map((bar) => [
        bar.label,
        String(bar.count),
        bar.pct.toFixed(4),
        bar.other === true ? "true" : "false",
      ]),
    ];
  }

  if (card.config.kind === "line" || card.config.kind === "histogram") {
    const grouped = card.groupResult;
    if (grouped !== null && grouped.groups.length > 0) {
      const range = card.binRangeFor(card.config.kind);
      const step = range === null ? 0 : (range.max - range.min) / Math.max(1, grouped.bins);
      const rows: string[][] = [["group", "bin_start", "bin_end", "count"]];
      for (let series = 0; series < grouped.groups.length; series++) {
        const counts = grouped.groups[series] ?? [];
        for (let bin = 0; bin < grouped.bins; bin++) {
          rows.push([
            grouped.labels[series] ?? "",
            number(range === null ? bin : range.min + bin * step),
            number(range === null ? bin + 1 : range.min + (bin + 1) * step),
            String(counts[bin] ?? 0),
          ]);
        }
      }
      return rows;
    }
    const bins = card.config.kind === "line" ? card.lineBinResult : card.binResult;
    const range = card.binRangeFor(card.config.kind);
    if (bins === null || range === null) {
      const drawn = card.config.kind === "histogram" ? card.drawnBins() : null;
      return drawn === null ? [] : binRows(drawn.bins, drawn.edges, null).map((row) => row.slice(0, 3));
    }
    const step = (range.max - range.min) / Math.max(1, bins.bins.length);
    const rows: string[][] = [["bin_start", "bin_end", "count"]];
    for (let bin = 0; bin < bins.bins.length; bin++) {
      rows.push([
        number(range.min + bin * step),
        number(range.min + (bin + 1) * step),
        String(bins.bins[bin] ?? 0),
      ]);
    }
    if (bins.overflow > 0) {
      rows.push([`> ${number(range.max)}`, "", String(bins.overflow)]);
    }
    return rows;
  }

  if (card.config.kind === "scatter" || card.config.kind === "density" || card.config.kind === "map") {
    const grid = card.config.kind === "map" && card.config.mapMode === "heat"
      ? card.mapGrid
      : null;
    if (grid !== null) return card.gridCsvRows(grid);
    const result = card.seriesResult;
    if (result === null) return [];
    if (result.mode === "points") {
      const rows: string[][] = [["x", "y", "color", "size"]];
      for (let index = 0; index < result.x.length; index++) {
        const color =
          result.colorValues !== null
            ? number(result.colorValues[index] ?? Number.NaN)
            : result.colorCodes !== null
              ? card.seriesLabels?.[result.colorCodes[index] ?? -1] ?? ""
              : "";
        rows.push([
          number(result.x[index] ?? Number.NaN),
          number(result.y[index] ?? Number.NaN),
          color,
          result.size === null ? "" : number(result.size[index] ?? Number.NaN),
        ]);
      }
      return rows;
    }
    const stepX = (result.xMax - result.xMin) / Math.max(1, result.cols);
    const stepY = (result.yMax - result.yMin) / Math.max(1, result.rows);
    const rows: string[][] = [["x_center", "y_center", "count"]];
    for (let y = 0; y < result.rows; y++) {
      for (let x = 0; x < result.cols; x++) {
        const count = result.counts[y * result.cols + x] ?? 0;
        if (count === 0) continue;
        rows.push([
          String(result.xMin + (x + 0.5) * stepX),
          String(result.yMin + (y + 0.5) * stepY),
          String(count),
        ]);
      }
    }
    return rows;
  }

  if (card.config.kind === "bubble") {
    return card.bubbleResult === null ? [] : card.gridCsvRows(card.bubbleResult);
  }

  if (card.config.kind === "box") {
    const result = card.boxResult;
    if (result === null) return [];
    return [
      [
        "group",
        "count",
        "min",
        "q1",
        "median",
        "q3",
        "max",
        "whisker_low",
        "whisker_high",
        "outlier_count",
      ],
      ...result.groups.map((group) => [
        group.label,
        String(group.count),
        number(group.min),
        number(group.q1),
        number(group.median),
        number(group.q3),
        number(group.max),
        number(group.whiskerLow),
        number(group.whiskerHigh),
        String(group.outlierCount),
      ]),
    ];
  }

  if (card.config.kind === "heatmap") {
    const result = card.crossResult;
    if (result === null) return [];
    const rows: string[][] = [["x", "y", "count", "percent"]];
    for (let y = 0; y < result.yLabels.length; y++) {
      for (let x = 0; x < result.xLabels.length; x++) {
        const count = result.counts[y * result.xLabels.length + x] ?? 0;
        rows.push([
          result.xLabels[x] ?? "",
          result.yLabels[y] ?? "",
          String(count),
          result.total === 0 ? "" : ((count / result.total) * 100).toFixed(4),
        ]);
      }
    }
    return rows;
  }

  if (card.config.kind === "correlation") {
    const result = card.correlationResult;
    if (result === null) return [];
    const rows: string[][] = [["column_a", "column_b", "r", "n"]];
    for (let a = 0; a < result.labels.length; a++) {
      for (let b = a + 1; b < result.labels.length; b++) {
        rows.push([
          result.labels[a] ?? "",
          result.labels[b] ?? "",
          number(result.values[a * result.labels.length + b] ?? Number.NaN),
          String(result.counts[a * result.labels.length + b] ?? 0),
        ]);
      }
    }
    return rows;
  }

  if (card.config.kind === "treemap") {
    const result = card.treemapResult;
    if (result === null) return [];
    return [
      ["label", "value", "rows"],
      ...result.labels.map((label, index) => [
        label,
        number(result.values[index] ?? Number.NaN),
        String(result.rows[index] ?? 0),
      ]),
    ];
  }

  if (card.config.kind === "terms") {
    const terms = card.textResult?.profile.topTerms ?? [];
    return terms.length === 0
      ? []
      : [["term", "count"], ...terms.map((term) => [term.term, String(term.count)])];
  }

  const bars = card.allCategoryBars();
  return bars.length === 0
    ? []
    : [
        ["category", "count", "percent"],
        ...bars.map((bar) => [bar.label, String(bar.count), bar.pct.toFixed(4)]),
      ];
}

export function gridCsvRows(card: ChartCard, grid: GridCountsResult): string[][] {
  const stepX = (grid.xMax - grid.xMin) / Math.max(1, grid.bins);
  const stepY = (grid.yMax - grid.yMin) / Math.max(1, grid.bins);
  const rows: string[][] = [["x_center", "y_center", "group", "count", "value"]];
  const append = (
    counts: Uint32Array,
    values: Float64Array | null,
    label: string,
  ): void => {
    for (let y = 0; y < grid.bins; y++) {
      for (let x = 0; x < grid.bins; x++) {
        const index = y * grid.bins + x;
        const count = counts[index] ?? 0;
        const value = values?.[index];
        if (count === 0 && (value === undefined || value === 0)) continue;
        rows.push([
          String(grid.xMin + (x + 0.5) * stepX),
          String(grid.yMin + (y + 0.5) * stepY),
          label,
          String(count),
          value === undefined || !Number.isFinite(value) ? "" : String(value),
        ]);
      }
    }
  };
  if (grid.groups !== null) {
    for (const group of grid.groups) append(group.counts, group.values, group.label);
  } else {
    append(grid.counts, grid.values, "");
  }
  return rows;
}

/** Line cards point to the Time Series page for trend, seasons and a forecast; map cards to the Map page. */
export function syncDeepDive(card: ChartCard): void {
  if (card.config.kind === "map") {
    const on = card.options.onOpenMap !== undefined && card.options.research?.() !== false;
    const key = on ? "map" : "";
    if (card.deepDiveEl.dataset.key === key) return;
    card.deepDiveEl.dataset.key = key;
    clear(card.deepDiveEl);
    card.deepDiveEl.classList.toggle("hidden", !on);
    if (!on) return;
    const button = el(
      "button",
      { class: "chart-deep-dive-link", type: "button", title: "Open this map on the Map page" },
      ["Open in Map →"],
    ) as HTMLButtonElement;
    button.addEventListener("click", () => card.options.onOpenMap?.(card.getConfig()));
    card.deepDiveEl.append(el("span", {}, ["Full width, with your own offline map picture underneath."]), button);
    return;
  }
  const target = card.seriesTarget();
  const key = target === null ? "" : JSON.stringify(target);
  if (card.deepDiveEl.dataset.key === key) return;
  card.deepDiveEl.dataset.key = key;
  clear(card.deepDiveEl);
  card.deepDiveEl.classList.toggle("hidden", target === null);
  if (target === null) return;
  const group = card.meta(target.groupColumn)?.name;
  const button = el(
    "button",
    { class: "chart-deep-dive-link", type: "button", title: "Open this series on the Time Series page" },
    ["Open in Time Series →"],
  ) as HTMLButtonElement;
  button.addEventListener("click", () => {
    const current = card.seriesTarget();
    if (current !== null) card.options.onDeepDive?.(current);
  });
  card.deepDiveEl.append(
    el("span", {}, [
      group === undefined
        ? "Deep dive on this series: trend, seasons, typical day and a forecast."
        : `Deep dive on one ${group} at a time: trend, seasons, typical day and a forecast.`,
    ]),
    button,
  );
}

/** Duplicate, PNG and remove live behind one ⋯ menu, plus the red ×. */
export function openCardMenu(card: ChartCard, anchor: HTMLElement): void {
  const pivotHeatmap = card.config.kind === "pivotHeatmap";
  const region = card.lastActionRegion;
  const filters = region === null ? [] : tableFiltersForHitActions(region.actions);
  const selectionLabel = region?.lines[0] ?? "the current selection";
  openMenu(
    anchor,
    [
      {
        label: "Put back everything left out",
        title: "Right-click a bar, box, bin or legend entry to leave it out of this chart",
        disabled: card.excludes().length === 0,
        action: () => card.setExcludes([]),
      },
      {
        label: "Edit chart",
        title: "Edit this chart in the shared setup dialog",
        disabled: card.options.onEdit === undefined,
        action: () => card.options.onEdit?.(card),
      },
      {
        label: "Reset to suggested",
        title: "Rebuild this card from the suggested fields for its chart type",
        disabled: card.options.onResetSuggested === undefined || pivotHeatmap,
        action: () => card.options.onResetSuggested?.(card),
      },
      {
        label: "Filter table to selection",
        title: `Add visible table filters for ${selectionLabel}`,
        disabled: filters.length === 0 || card.options.onFilterTable === undefined,
        action: () => card.options.onFilterTable?.(filters, selectionLabel),
      },
      {
        label: "Show underlying rows",
        title: `Switch to the table with rows filtered to ${selectionLabel}`,
        disabled: filters.length === 0 || card.options.onShowRows === undefined,
        action: () => card.options.onShowRows?.(filters, selectionLabel),
      },
      {
        label: "Drill to finer grain",
        title: "Add a finer-grained or broken-down version of this selection",
        disabled: region === null || card.options.onDrill === undefined,
        action: () => card.options.onDrill?.(card, filters, selectionLabel),
      },
      {
        label: "Break down by another field",
        title: "Open the chart builder for a new breakdown",
        disabled: card.options.onBreakDown === undefined,
        action: () => card.options.onBreakDown?.(card),
      },
      // The Time Series page is a Research view: General mode leaves the item out.
      ...(card.options.research?.() === false
        ? []
        : [
            {
              label: "Open in Time Series",
              title: "Trend, seasons, typical day and a forecast for this series",
              disabled: card.seriesTarget() === null,
              action: () => {
                const target = card.seriesTarget();
                if (target !== null) card.options.onDeepDive?.(target);
              },
            },
          ]),
      {
        label: "Duplicate",
        title: "Duplicate this chart",
        action: () => card.options.onDuplicate(card),
      },
      {
        label: "Download PNG",
        title: "Download this chart as a PNG",
        action: () => card.options.onExport(card),
      },
      {
        label: "Download data (CSV)",
        title: "Download the data behind this chart as a CSV",
        action: () => card.exportCsv(),
      },
      {
        label: "Download chart spec (JSON)",
        title: "Download a versioned, portable description of this chart",
        disabled: pivotHeatmap,
        action: () => card.downloadChartSpec(),
      },
      {
        label: "Apply chart spec (JSON)",
        title: "Validate and apply a previously downloaded chart spec",
        disabled: pivotHeatmap,
        action: () => card.importChartSpecFile(),
      },
      {
        label: "Download pandas code",
        title: "Download Python that rebuilds the supported chart aggregation",
        disabled: pivotHeatmap,
        action: () => card.downloadChartCode(true),
      },
      {
        label: "Download Polars code",
        title: "Download Polars code that rebuilds the supported chart aggregation",
        disabled: pivotHeatmap,
        action: () => card.downloadChartCode(false),
      },
      {
        label: "Remove chart",
        title: "Remove this chart…",
        action: () => card.confirmRemove(),
      },
    ],
    "context-menu chart-card-menu",
  );
}

/**
 * Expand/focus mode: the same card element moves into a full-viewport
 * overlay, so every setting, the loaded data and the scroll-independent
 * canvas size are retained. Closing (button or Escape) restores the card
 * to its grid slot.
 */
export function toggleFocus(card: ChartCard): void {
  if (card.focusOverlay !== null) {
    card.closeFocus();
    return;
  }
  const overlay = el("div", {
    class: "chart-focus-overlay",
    role: "dialog",
    "aria-label": "Expanded chart",
    tabindex: "-1",
  }) as HTMLElement;
  const close = el(
    "button",
    { class: "icon-btn chart-focus-close", type: "button", title: "Close (Esc)" },
    ["×"],
  ) as HTMLButtonElement;
  close.addEventListener("click", () => card.closeFocus());
  const stage = el("div", { class: "chart-focus-stage" });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      card.closeFocus();
    }
  });
  card.root.parentNode?.insertBefore(card.focusPlaceholder, card.root);
  stage.append(card.root);
  overlay.append(close, stage);
  document.body.append(overlay);
  card.focusOverlay = overlay;
  card.root.classList.add("focused");
  card.focusButton.classList.add("active");
  card.focusButton.title = "Back to the grid (Esc)";
  overlay.focus();
  card.render();
}

export function closeFocus(card: ChartCard): void {
  const overlay = card.focusOverlay;
  if (overlay === null) return;
  card.focusOverlay = null;
  card.focusPlaceholder.parentNode?.insertBefore(card.root, card.focusPlaceholder);
  card.focusPlaceholder.remove();
  overlay.remove();
  card.root.classList.remove("focused");
  card.focusButton.classList.remove("active");
  card.focusButton.title = "Expand this chart for a closer look (Esc to close)";
  card.render();
}

export function openExportMenu(card: ChartCard, anchor: HTMLElement): void {
  openMenu(anchor, [
    {
      label: "Animated GIF (.gif)",
      title: "Loops anywhere, but some desktop viewers (e.g. Windows Photos) show only the first frame",
      action: () => void card.exportAnimationGif(),
    },
    {
      label: "Video (.mp4)",
      title: "H.264 video that plays in every desktop player and presentation tool",
      action: () => void card.exportAnimationVideo(),
    },
  ]);
}

/** Versioned ChartSpec JSON: portable across config changes and code export. */
export function downloadChartSpec(card: ChartCard): void {
  if (typeof URL.createObjectURL !== "function") return;
  const spec = card.getSpec();
  const url = URL.createObjectURL(
    new Blob([chartSpecJson(spec)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(card.options.datasetName())}-${safeFileName(
    card.chartName(),
  )}-chart-spec.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Python code for the supported subset of the current ChartSpec. */
export function downloadChartCode(card: ChartCard, pandas: boolean): void {
  if (typeof URL.createObjectURL !== "function") return;
  const spec = card.getSpec();
  const generated = pandas ? chartSpecToPandas(spec) : chartSpecToPolars(spec);
  if (generated.code === "") {
    card.noteEl.textContent =
      generated.warnings[0] ?? "No code can be generated for this chart yet.";
    return;
  }
  if (generated.warnings.length > 0) {
    card.noteEl.textContent = `${generated.warnings.length} support note${generated.warnings.length === 1 ? "" : "s"} included in the file.`;
  }
  const header = generated.warnings
    .map((warning) => `# Note: ${warning}`)
    .join("\n");
  const content = header === "" ? generated.code : `${header}\n${generated.code}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/x-python" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(card.options.datasetName())}-${safeFileName(
    card.chartName(),
  )}-${pandas ? "pandas" : "polars"}.py`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadBlob(card: ChartCard, blob: Blob, extension: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileName(card.options.datasetName())}-${safeFileName(
    card.chartName(),
  )}-animation.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
