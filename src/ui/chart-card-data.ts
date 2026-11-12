/**
 * Where a chart's numbers come from: the aggregate each type asks the worker for, the refreshes, bins, the data issues note and the headline text.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import { missingOrTokens } from "./chart-card-parts.js";
import { sanitizeExclusions, type ChartExclusion } from "../data/chart-exclusions.js";
import type { ColumnSuggestion } from "../data/suggestions.js";
import type { Aggregate, MeasureSpec, TimeGrain, ViewDef } from "../data/aggregate.js";
import { chartConfigWithDefaults } from "./chart-builder.js";
import { lint, type LintNote, type RecColumn } from "./chart-recommender.js";
import type { AggregateMessage, ColumnMeta } from "../worker/protocol.js";
import { CHART_KIND_LABELS, type ChartCardKind, defaultChartTitle, autoShortStep, isGroupable, isNumericType, isPairKind, parseChartNumber, plainMeasureName, SPLIT_KINDS, GROUP_REQUIRED_KINDS, VALUE_AGGREGATE_KINDS, toRecColumn, suggestedBinRange } from "./chart-utils.js";
import { clear, el } from "./dom.js";
import { describeScope } from "./scope.js";
import type { ChartCard } from "./chart-card.js";
import type { ChartSeriesTarget, ChartCardConfig, ChartSource } from "./chart-card-types.js";
import { DEFAULT_BIN_COUNT } from "./chart-card-types.js";

/** The chart's numbers as a table: a chart split into series reads across, one column per series. */
export function dataDrawerRows(card: ChartCard): string[][] {
  const aggregate = card.usesAggregate() && card.config.kind !== "pivotHeatmap" ? card.aggregateResult() : null;
  if (aggregate === null || aggregate.dimensions.length !== 2 || aggregate.groupCount === 0) return card.chartCsvRows();
  const [axis, series] = aggregate.dimensions as [string[], string[]];
  const values = aggregate.measures[0] ?? new Float64Array(0);
  const columns = [...new Set(series)];
  const columnAt = new Map(columns.map((label, index) => [label, index]));
  const rowAt = new Map<string, string[]>();
  for (let i = 0; i < aggregate.groupCount; i++) {
    const label = axis[i] ?? "";
    let row = rowAt.get(label);
    if (row === undefined) {
      row = [label, ...columns.map(() => "")];
      rowAt.set(label, row);
    }
    const value = values[i];
    if (value !== undefined && Number.isFinite(value)) row[1 + (columnAt.get(series[i] ?? "") ?? 0)] = String(value);
  }
  return [[aggregate.dimensionNames[0] ?? "", ...columns], ...rowAt.values()];
}

/** Puts the chart back as it was before its last change. */
export function undo(card: ChartCard): void {
  const previous = card.undoStack.pop();
  if (previous === undefined) return;
  card.config = chartConfigWithDefaults(JSON.parse(previous) as Partial<ChartCardConfig>);
  card.undoBefore = previous;
  card.hiddenGroups.clear();
  card.plotView = null;
  card.mapView = null;
  card.chartXZoom = null;
  card.barWindow = null;
  card.clearSelection();
  card.pickerSignature = "";
  card.titleInput.value = card.config.title;
  card.setColumns(card.columns);
  card.refreshForConfig();
  card.syncUndo();
  card.options.onTitleChange?.(card);
}

export function setColumns(card: ChartCard, columns: ColumnMeta[]): void {
  card.columns = columns;
  const kept = sanitizeExclusions(card.config.excludes, columns.length);
  card.config.excludes = kept.length > 0 ? kept : undefined;
  card.plotView = null;
  card.mapView = null;
  card.chartXZoom = null;
  card.barWindow = null;
  card.generation++;
  card.pickerSignature = "";
  card.syncOptions();
  card.syncPlaceholder();
  card.syncSourceControls();
  card.regions?.syncColumns();
  card.regions?.refresh();
  card.renderControls();
  card.refreshBins();
  card.refreshSeries();
  card.refreshTreemap();
  card.refreshText();
  card.refreshBox();
  card.refreshCrosstab();
  card.refreshBubble();
  card.refreshMapGrid();
  card.refreshAnimation();
  card.refreshCorrelation();
  card.refreshGroupedBins();
  card.refreshValue();
  card.render();
}

/** The sources a card can bind to (the table plus each saved view). */
export function setSources(card: ChartCard, sources: ChartSource[]): void {
  card.sources = sources;
  card.renderSourceOptions();
  card.syncSourceControls();
  card.syncScope();
  if (
    card.config.source !== "" &&
    sources.some((source) => source.id === card.config.source)
  ) {
    card.generation++;
    card.refreshView();
  }
}

/** Fetches the bound aggregate or pivot result (generation-guarded). */
export function refreshView(card: ChartCard): void {
  if (card.config.source === "") {
    card.viewResult = null;
    card.pivotResult = null;
    card.render();
    return;
  }
  const source = card.config.source;
  const generation = ++card.viewGeneration;
  if (card.config.kind === "pivotHeatmap") {
    const pivotSource =
      card.sources.find((entry) => entry.id === source)?.kind === "pivot";
    if (!pivotSource || card.options.requestViewPivot === undefined) {
      card.pivotResult = null;
      card.render();
      return;
    }
    void card.options
      .requestViewPivot(source)
      .then((message) => {
        if (generation !== card.viewGeneration || card.disposed || card.config.source !== source) return;
        card.pivotResult = message;
        card.syncPivotOptions();
        card.render();
      })
      .catch(() => {
        card.pivotResult = null;
        card.render();
      });
    return;
  }
  if (card.options.requestViewAggregate === undefined) {
    card.viewResult = null;
    card.render();
    return;
  }
  void card.options
    .requestViewAggregate(source, card.viewShape() ?? undefined)
    .then((message) => {
      if (generation !== card.viewGeneration || card.disposed || card.config.source !== source) return;
      card.viewResult = message;
      card.syncSummary();
      card.render();
    })
    .catch(() => {
      // Keep the last result as the fallback.
    });
}

export function aggregateResult(card: ChartCard): AggregateMessage | null {
  const result = card.config.source !== "" ? card.viewResult : card.valueResult;
  if (result === null) return null;
  const order = card.config.chartSort ?? "none";
  if (order === "none" || result.groupCount < 2) return result;
  const indexes = Array.from({ length: result.groupCount }, (_, index) => index);
  const dimension = result.dimensions[0] ?? [];
  const times = result.dimensionTimes[0];
  const measure = result.measures[0];
  const compare = (a: number, b: number): number => {
    let delta = 0;
    if (order === "valueDesc" || order === "valueAsc") {
      const av = measure?.[a] ?? Number.NaN;
      const bv = measure?.[b] ?? Number.NaN;
      const af = Number.isFinite(av);
      const bf = Number.isFinite(bv);
      delta = !af && !bf ? 0 : !af ? 1 : !bf ? -1 : order === "valueDesc" ? bv - av : av - bv;
    } else if (order === "timeAsc" || order === "timeDesc") {
      const at = times?.[a] ?? Number.NaN;
      const bt = times?.[b] ?? Number.NaN;
      const af = Number.isFinite(at);
      const bf = Number.isFinite(bt);
      delta = !af && !bf ? 0 : !af ? 1 : !bf ? -1 : order === "timeAsc" ? at - bt : bt - at;
    } else {
      delta = String(dimension[a] ?? "").localeCompare(String(dimension[b] ?? ""), undefined, {
        numeric: true,
      });
      if (order === "labelDesc") delta = -delta;
    }
    return delta === 0 ? a - b : delta;
  };
  indexes.sort(compare);
  return {
    ...result,
    labels: indexes.map((index) => result.labels[index] ?? ""),
    dimensions: result.dimensions.map((values) =>
      indexes.map((index) => values[index] ?? ""),
    ),
    dimensionTimes: result.dimensionTimes.map((values) =>
      Float64Array.from(indexes, (index) => values[index] ?? Number.NaN),
    ),
    measures: result.measures.map((values) =>
      Float64Array.from(indexes, (index) => values[index] ?? Number.NaN),
    ),
    partials:
      result.partials === null || result.partials === undefined
        ? result.partials
        : indexes.map((index) => result.partials?.[index] === true),
  };
}

/** Implicit view definition: the measure aggregated over time, categories or bins. */
export function valueViewDef(card: ChartCard): ViewDef | null {
  if (!card.usesValueAggregate() || card.options.requestAggregate === undefined) return null;
  const column = card.config.valueColumn ?? -1;
  if (column < 0) return null;
  const datedColumn = card.isDateLike(card.meta(card.config.column));
  // Lines and small multiples run over time; a slopegraph or waterfall does
  // when its column is a date, and over category values otherwise.
  const line =
    card.config.kind === "line" ||
    card.config.kind === "smallmultiples" ||
    ((card.config.kind === "slopegraph" || card.config.kind === "waterfall") && datedColumn);
  const kpi = card.config.kind === "kpi";
  const histogram = card.config.kind === "histogram";
  if ((card.config.kind === "line" || card.config.kind === "smallmultiples") && !datedColumn) return null;
  // A KPI with a date column reads the series (latest bucket + comparison);
  // without one it is the grand total over every filtered row.
  const overTime = kpi && card.isDateLike(card.meta(card.config.column));
  if (!line && !kpi && card.config.column < 0) return null;
  const grain =
    card.config.valueGrain === undefined || card.config.valueGrain === "auto"
      ? card.config.kind === "slopegraph"
        ? card.slopeGrainFor(card.config.column)
        : card.defaultGrainFor(card.config.column)
      : card.config.valueGrain;
  // Split-by: line/bar cards with a Group draw one series per group value
  // (dimension 2); the renderer pivots the returned groups into series.
  const groupMetaForSplit = card.meta(card.config.groupColumn);
  const split =
    (line || SPLIT_KINDS.includes(card.config.kind)) &&
    card.config.groupColumn >= 0 &&
    groupMetaForSplit !== undefined &&
    isGroupable(groupMetaForSplit);
  const binCount = Math.max(
    1,
    Math.min(256, Math.floor(card.config.binOptions?.binCount ?? DEFAULT_BIN_COUNT) || 32),
  );
  const calc = card.config.valueCalc;
  const post =
    calc === undefined
      ? undefined
      : calc === "rolling7"
        ? ([{ op: "rolling", window: 7 }] as const)
        : ([{ op: calc }] as const);
  const valueAgg = card.config.valueAgg ?? "mean";
  const fillPolicy = card.fillPolicy();
  const measure: MeasureSpec =
    valueAgg === "true" || valueAgg === "false" || valueAgg === "missing"
      ? {
          column: null,
          agg: "count",
          where:
            valueAgg === "missing"
              ? { column, isNull: true }
              : {
                  column,
                  values:
                    valueAgg === "true"
                      ? ["true", "yes", "y", "t", "1"]
                      : ["false", "no", "n", "f", "0"],
                },
        }
      : valueAgg === "truePct"
        ? {
            column: null,
            agg: "count",
            where: { column, values: ["true", "yes", "y", "t", "1"] },
            post: [{ op: "pctRows" }],
          }
        : {
            column,
            agg: valueAgg as Aggregate,
            ...(post === undefined ? {} : { post: [...post] }),
          };    return {
    id: "card-value",
    name: card.config.title.trim() === "" ? card.defaultTitle() : card.config.title.trim(),
    dimensions:
      line || overTime
        ? split
          ? [
              { column: card.config.column, by: card.timeBy(grain) },
              { column: card.config.groupColumn, by: "value" },
            ]
          : [{ column: card.config.column, by: card.timeBy(grain) }]
        : histogram
          ? [{ column: card.config.column, by: { bin: { n: binCount } } }]
          : kpi
            ? []
            : split
              ? [
                  { column: card.config.column, by: "value" },
                  { column: card.config.groupColumn, by: "value" },
                ]
              : [{ column: card.config.column, by: "value" }],
    measures: [
      measure,
      ...card.extraValues().map((extra): MeasureSpec => ({
        column: extra,
        agg: valueAgg as Aggregate,
        ...(post === undefined ? {} : { post: [...post] }),
      })),
    ],
    fill: line && !split ? (fillPolicy === "zero" ? "zero" : fillPolicy === "carry" ? "carry" : "none") : "none",
    ...(line && !split && fillPolicy === "gap" ? { showGaps: true } : {}),
    sort:
      line || overTime || histogram
        ? { key: "dim0", dir: "asc" }
        : { key: "m0", dir: "desc" },
    limit: 5000,
    respectFilters: card.config.respectFilters !== false,
    filterColumn: card.config.filterColumn ?? -1,
    filterCode: card.config.filterCode ?? -1,
    ...(card.excludes().length > 0 ? { exclude: card.excludes() } : {}),
  };
}

/** Fetches the card's own value-over-time aggregate (generation-guarded). */
export function refreshValue(card: ChartCard): void {
  card.syncErrorBarControls();
  const def = card.valueViewDef();
  if (def === null) {
    card.valueGeneration++;
    if (card.valueResult !== null) card.valueResult = null;
    return;
  }
  // Own counter: the sibling refreshes (line bins, series, ...) bump
  // `generation` right after this call and used to discard this response,
  // leaving a freshly added chart on "no groups to draw yet".
  const generation = ++card.valueGeneration;
  void card.options
    .requestAggregate(def)
    .then((message) => {
      if (generation !== card.valueGeneration || card.disposed || !card.usesValueAggregate()) return;
      card.valueResult = message;
      card.refreshErrorBars();
      card.render();
    })
    .catch(() => {
      // Keep the last result as the fallback.
    });
}

export function syncScope(card: ChartCard): void {
  const view = card.sources.find((source) => source.id === card.config.source);
  const total = card.totalRowCount > 0 ? card.totalRowCount : card.rowCount;
  const scope = describeScope({
    total,
    visible: card.rowCount,
    viewName: view?.name ?? null,
  });
  const filterColumn = card.config.filterColumn ?? -1;
  const filterCode = card.config.filterCode ?? -1;
  const filterLabel =
    filterColumn >= 0 && filterCode >= 0
      ? card.meta(filterColumn)?.categories?.labels[filterCode]
      : undefined;
  const chartFilter =
    filterLabel === undefined
      ? ""
      : ` · chart: ${card.meta(filterColumn)?.name ?? "value"} = ${filterLabel}`;
  const calc =
    card.config.valueCalc === undefined
      ? ""
      : ` · calc: ${card.valueCalcSelect.selectedOptions[0]?.textContent ?? card.config.valueCalc}`;
  card.scopeEl.textContent =
    (view === undefined ? `Table · ${scope}` : scope) + chartFilter + calc;
  card.scopeEl.classList.toggle("hidden", total === 0 && card.rowCount === 0);
  card.syncSummary();
}

/** The most useful lint note for this chart, if any; errors before warnings. */
export function syncNote(card: ChartCard): void {
  const note = card.lintNote();
  card.lintEl.classList.toggle("hidden", note === null);
  if (note === null) {
    delete card.lintEl.dataset.msg;
    card.lintEl.replaceChildren();
    return;
  }
  if (card.lintEl.dataset.msg === note.msg) return;
  card.lintEl.dataset.msg = note.msg;
  card.lintEl.className = `chart-lint ${note.level}`;
  const dismiss = el("button", { class: "chart-lint-x", type: "button", title: "Dismiss this note", "aria-label": "Dismiss this note" }, ["×"]);
  dismiss.addEventListener("click", () => {
    card.dismissedNotes.add(note.msg);
    delete card.lintEl.dataset.msg;
    card.syncNote();
  });
  card.lintEl.replaceChildren(el("span", {}, [note.msg]), dismiss);
}

export function lintNote(card: ChartCard): LintNote | null {
  const config = card.config;
  if (config.kind === "pivotHeatmap" || config.source !== "" || card.columns.length === 0) return null;
  const type =
    config.kind === "barplot" ? "barplot" : config.kind === "bar" ? "countplot" : config.kind === "line" ? "timeseries" : null;
  if (type === null) return null;
  const rec = (index: number): RecColumn | null => {
    const meta = card.meta(index);
    return meta === undefined ? null : toRecColumn(meta, index, card.rowCount);
  };
  const fields = [rec(config.valueColumn ?? -1), rec(config.column)].filter((c): c is RecColumn => c !== null);
  const distinct = card.meta(type === "timeseries" ? config.groupColumn : config.column)?.stats.distinct ?? 0;
  const notes = lint(
    {
      type,
      cfg: { agg: config.valueAgg, topN: config.groupOther ? config.topN : null },
      fields,
      categories: type === "timeseries" ? undefined : distinct,
      series: type === "timeseries" ? Math.min(distinct, Math.max(6, config.topN)) : undefined,
    },
    card.rowCount,
  ).filter((note) => !card.dismissedNotes.has(note.msg));
  // A time series is always charted over a date, so the "needs a date" error only
  // applies when the fields really lack one.
  notes.sort((a, b) => Number(b.level === "error") - Number(a.level === "error"));
  return notes[0] ?? null;
}

export function syncSummaryText(card: ChartCard): void {
  const source =
    card.config.source === ""
      ? card.options.tableSourceLabel?.() ?? "Table"
      : (card.sources.find((entry) => entry.id === card.config.source)?.name ?? "View");
  if (card.config.kind === "pivotHeatmap") {
    const data = card.pivotHeatmapData();
    card.summaryEl.textContent =
      data === null
        ? `Pivot heatmap from ${source}`
        : `Pivot heatmap of ${data.measureName} by ${data.rowName} and ${data.colName} from ${source}`;
    return;
  }
  const kind = card.viewKindLabel();
  card.kindStatic.textContent = card.config.source === "" ? "" : kind;
  if (card.config.source !== "") {
    const result = card.viewResult;
    if (result === null) {
      card.summaryEl.textContent = `${kind} from view: ${source}`;
      return;
    }
    const groups = result.groupCount;
    const measureName = plainMeasureName(result.measureNames[0] ?? "measure");
    card.summaryEl.textContent =
      result.dimensionNames.length >= 2
        ? `${result.dimensionIsTime[0] === true ? "Lines" : "Bars"} from view: ${measureName} by ${result.dimensionNames[0]}, one series per ${result.dimensionNames[1]}`
        : `${kind} from view: ${measureName} by ${result.dimensionNames[0] || "group"}` +
          ` · ${groups.toLocaleString()} ${groups === 1 ? "group" : "groups"}`;
    return;
  }
  const name = (index: number): string => card.meta(index)?.name ?? "value";
  if (isPairKind(card.config.kind)) {
    card.summaryEl.textContent = `${kind}: ${name(card.config.y)} vs ${name(card.config.x)}${card.options.docked === true ? "" : ` from ${source}`}`;
    return;
  }
  const agg =
    card.config.valueColumn !== undefined && card.config.valueColumn >= 0
      ? `${card.aggPhrase()} of ${[card.config.valueColumn, ...card.extraValues()].map(name).join(", ")}`
      : "rows";
  const overTime =
    card.config.valueColumn !== undefined &&
    card.config.valueColumn >= 0 &&
    card.isDateLike(card.meta(card.config.column)) &&
    (card.config.kind === "line" || card.config.kind === "smallmultiples");
  const by =
    card.config.column < 0
      ? ""
      : overTime
        ? ` per ${card.stepNoun()} (${name(card.config.column)})`
        : ` by ${name(card.config.column)}`;
  const group =
    card.config.groupColumn >= 0 ? ` grouped by ${name(card.config.groupColumn)}` : "";
  const calc =
    card.config.valueCalc === undefined
      ? ""
      : ` with ${card.valueCalcSelect.selectedOptions[0]?.textContent ?? card.config.valueCalc}`;
  // Docked, the scope sits beside this line and already names the source.
  card.summaryEl.textContent = `${kind}: ${agg}${by}${group}${calc}${card.options.docked === true ? "" : ` from ${source}`}`;
}

/** Columns whose missing/placeholder state can affect this chart. */
export function issueColumns(card: ChartCard): number[] {
  if (card.config.source !== "" || card.config.kind === "pivotHeatmap") return [];
  const indexes = new Set<number>();
  const add = (index: number | undefined): void => {
    if (index !== undefined && index >= 0) indexes.add(index);
  };
  switch (card.config.kind) {
    case "scatter":
    case "density":
    case "bubble":
      add(card.config.x);
      add(card.config.y);
      add(card.config.colorColumn);
      add(card.config.sizeColumn);
      break;
    case "heatmap":
    case "box":
      add(card.config.x);
      add(card.config.y);
      break;
    case "map":
      add(card.config.x);
      add(card.config.y);
      add(card.config.colorColumn);
      break;
    case "kpi":
    case "barplot":
    case "dotplot":
    case "waterfall":
      add(card.config.valueColumn);
      add(card.config.column);
      break;
    case "stacked100":
    case "smallmultiples":
    case "slopegraph":
      add(card.config.valueColumn);
      add(card.config.column);
      add(card.config.groupColumn);
      break;
    case "correlation":
      for (const index of card.config.correlationColumns) add(index);
      break;
    case "line":
      add(card.config.groupColumn);
      add(card.config.valueColumn);
      add(card.config.column);
      break;
    default:
      add(card.config.column);
      break;
  }
  return [...indexes].filter((index) => card.meta(index)?.role !== "provenance");
}

/** Explain missing/unknown categories and offer filter/fix actions. */
export function syncDataIssues(card: ChartCard): void {
  const issues = card.issueColumns()
    .map((index) => {
      const meta = card.meta(index);
      if (meta === undefined) return null;
      const missing = meta.stats.nulls;
      const tokens = meta.nullTokens.filter(
        (token) => token.label !== "" && token.count > 0,
      );
      const sentinels = meta.suggestions.filter(
        (suggestion): suggestion is Extract<ColumnSuggestion, { kind: "sentinel" }> =>
          suggestion.kind === "sentinel",
      );
      if (missing === 0 && tokens.length === 0 && sentinels.length === 0) return null;
      const active =
        card.options.currentFilter?.(index)?.kind === "blank" &&
        (card.options.currentFilter?.(index) as { negate?: boolean } | null)?.negate === false;
      return { index, meta, missing, tokens, sentinels, active };
    })
    .filter((issue): issue is NonNullable<typeof issue> => issue !== null);
  const signature = issues
    .map((issue) => `${issue.meta.name}:${issue.missing}:${issue.tokens.length}:${issue.active}`)
    .join("|");
  if (signature === card.issueSignature) return;
  card.issueSignature = signature;
  clear(card.dataIssueEl);
  card.dataIssueEl.classList.toggle("hidden", issues.length === 0);
  if (issues.length === 0) return;
  card.dataIssueEl.append(
    el("span", { class: "chart-issue-heading" }, ["Data issues"]),
  );
  for (const issue of issues.slice(0, 2)) {
    const row = el("div", { class: "chart-issue-row" });
    const tokenCount = issue.tokens.reduce((sum, token) => sum + token.count, 0);
    const details = [`${issue.missing.toLocaleString()} missing`];
    if (tokenCount > 0) details.push(`${tokenCount.toLocaleString()} placeholders`);
    if (issue.sentinels.length > 0) {
      details.push(
        issue.sentinels
          .map((suggestion) => `"${suggestion.value}" in ${suggestion.count.toLocaleString()}`)
          .join(", "),
      );
    }
    row.append(
      el("span", { class: "chart-issue-label", title: details.join(" - ") }, [
        `${issue.meta.name}: ${details.join(" - ")}`,
      ]),
    );
    if (missingOrTokens(issue.missing, tokenCount) && card.options.onFilterTable !== undefined) {
      const filter = el(
        "button",
        {
          class: "chart-issue-chip warn",
          type: "button",
          "aria-pressed": issue.active ? "true" : "false",
          title: `Filter the table to rows where ${issue.meta.name} is blank`,
        },
        [`Filter: ${issue.missing.toLocaleString()} missing`],
      ) as HTMLButtonElement;
      filter.addEventListener("click", () =>
        card.options.onFilterTable?.(
          [{ column: issue.index, filter: { kind: "blank", negate: false } }],
          `${issue.meta.name} is blank`,
        ),
      );
      row.append(filter);
    }
    if (card.options.onShowRows !== undefined) {
      const show = el(
        "button",
        { class: "chart-issue-chip", type: "button", title: "Show the affected rows" },
        ["Show rows"],
      ) as HTMLButtonElement;
      show.addEventListener("click", () =>
        card.options.onShowRows?.(
          [{ column: issue.index, filter: { kind: "blank", negate: false } }],
          `${issue.meta.name} is blank`,
        ),
      );
      row.append(show);
    }
    if (tokenCount > 0 && card.options.onConvertToken !== undefined) {
      const fix = el(
        "button",
        {
          class: "chart-issue-chip fix",
          type: "button",
          title: "Preview-free null-policy change; undo is available in the status bar",
        },
        [`Fix: convert ${tokenCount.toLocaleString()} placeholders`],
      ) as HTMLButtonElement;
      fix.addEventListener("click", () =>
        card.options.onConvertToken?.(
          issue.index,
          issue.tokens.map((token) => token.label),
        ),
      );
      row.append(fix);
    }
    const sentinel = issue.sentinels[0];
    if (sentinel !== undefined && card.options.onSuggestion !== undefined) {
      const fix = el(
        "button",
        {
          class: "chart-issue-chip fix",
          type: "button",
          title: "Use the existing null-policy action; undo is available in the status bar",
        },
        [`Fix: treat "${sentinel.value}" as missing`],
      ) as HTMLButtonElement;
      fix.addEventListener("click", () =>
        card.options.onSuggestion?.(issue.index, sentinel),
      );
      row.append(fix);
    }
    card.dataIssueEl.append(row);
  }
  if (issues.length > 2) {
    card.dataIssueEl.append(
      el("span", { class: "chart-issue-more" }, [
        `+${issues.length - 2} more column${issues.length - 2 === 1 ? "" : "s"}`,
      ]),
    );
  }
}

/**
 * The fields a chart was using, so a new chart type starts from them: its measures (numeric
 * columns plotted as values), then the date and category columns it was split or laid out by.
 */
export function fieldsInUse(card: ChartCard): { measures: number[]; dimensions: number[] } {
  const c = card.config;
  const pair = isPairKind(c.kind);
  const used = pair ? [c.y, c.x] : [c.valueColumn ?? -1, c.column, c.groupColumn];
  const measures: number[] = [];
  const dimensions: number[] = [];
  for (const index of used) {
    const meta = card.meta(index);
    if (meta === undefined) continue;
    const measure = isNumericType(meta.type) && (pair || index === c.valueColumn || !isGroupable(meta));
    const list = measure ? measures : dimensions;
    if (!list.includes(index)) list.push(index);
  }
  return { measures, dimensions };
}

export function setKind(card: ChartCard, kind: ChartCardKind): void {
  if (kind === card.config.kind) return;
  const { measures, dimensions } = card.fieldsInUse();
  card.config.kind = kind;
  card.plotView = null;
  card.mapView = null;
  card.mapGrid = null;
  card.chartXZoom = null;
  card.barWindow = null;
  if (isPairKind(kind)) {
    const xAllowed = card.allowedIndexes((meta) => card.allowsX(meta));
    const yAllowed = card.allowedIndexes((meta) => card.allowsY(meta));
    // Keep what was charted: a measure goes on Y, and X takes the next field that fits.
    const fromField = [...dimensions, ...measures];
    const y = measures.find((index) => yAllowed.includes(index));
    if (y !== undefined) card.config.y = y;
    const x = fromField.find((index) => index !== card.config.y && xAllowed.includes(index));
    if (x !== undefined) card.config.x = x;
    if (!xAllowed.includes(card.config.x)) card.config.x = xAllowed[0] ?? -1;
    if (!yAllowed.includes(card.config.y) || (card.config.y === card.config.x && yAllowed.length > 1)) {
      card.config.y = yAllowed.find((index) => index !== card.config.x) ?? yAllowed[0] ?? -1;
    }
  } else if (kind === "correlation") {
    const numeric = card.defaultCorrelationColumns();
    card.config.correlationColumns = card.config.correlationColumns.filter((index) =>
      numeric.includes(index),
    );
    if (card.config.correlationColumns.length < 2) {
      card.config.correlationColumns = numeric.slice(0, 6);
    }
  } else {
    const primary = card.allowedIndexes((meta) => card.allowsPrimary(meta));
    const takesValue = VALUE_AGGREGATE_KINDS.includes(kind) || kind === "treemap";
    // A chart of one column plots the measure itself; one with a Value keeps the measure there
    // and is laid out by the date or category it had.
    const lead = kind === "histogram" ? [...measures, ...dimensions] : [...dimensions, ...measures];
    const column = lead.find((index) => primary.includes(index));
    if (column !== undefined) card.config.column = column;
    if (!primary.includes(card.config.column)) card.config.column = primary[0] ?? -1;
    // A count plot counts rows; every other chart with a Value keeps the measure.
    if (takesValue && kind !== "histogram" && kind !== "bar") {
      const value = measures.find((index) => index !== card.config.column);
      if (value !== undefined && (card.config.valueColumn ?? -1) < 0) card.config.valueColumn = value;
    } else if (kind === "histogram") card.config.valueColumn = -1;
    if (kind === "histogram") card.applyColumnDefaults();
  }
  card.dropSettingsTheNewKindCannotUse();
  card.pickerSignature = "";
  card.refreshForConfig();
}

/**
 * After a change of chart type: settings that made sense on the old chart and say nothing on
 * the new one are cleared, so the title never reads "by usertype grouped by usertype" or keeps
 * a year-over-year change on bars of categories.
 */
export function dropSettingsTheNewKindCannotUse(card: ChartCard): void {
  const kind = card.config.kind;
  if (isPairKind(kind) || kind === "correlation") return;
  // Splitting a chart by the field it is already laid out by gives one series per bar.
  if (card.config.groupColumn >= 0 && card.config.groupColumn === card.config.column) {
    card.config.groupColumn = -1;
    card.hiddenGroups.clear();
  }
  // These calculations compare each period with the one before it: they need a date axis.
  const calc = card.config.valueCalc;
  const needsTime = calc === "rolling7" || calc === "diff" || calc === "pctChange" || calc === "yoy" || calc === "cumulative";
  if (needsTime && !card.isDateLike(card.meta(card.config.column))) card.config.valueCalc = undefined;
}

/** Refetches and repaints everything a whole-chart settings change can touch. */
export function refreshForConfig(card: ChartCard): void {
  card.generation++;
  card.syncOptions();
  card.syncPlaceholder();
  card.renderControls();
  card.refreshBins();
  card.refreshValue();
  card.refreshSeries();
  card.refreshTreemap();
  card.refreshText();
  card.refreshBox();
  card.refreshCrosstab();
  card.refreshBubble();
  card.refreshMapGrid();
  card.refreshAnimation();
  card.refreshCorrelation();
  card.refreshGroupedBins();
  if (card.config.source !== "") card.refreshView();
  card.render();
}

export function setPrimaryColumn(card: ChartCard, index: number): void {
  if (index === card.config.column) return;
  card.config.column = index;
  card.chartXZoom = null;
  card.barWindow = null;
  if (card.config.kind === "histogram") card.applyColumnDefaults();
  card.dropSettingsTheNewKindCannotUse();
  card.groupSelect.value = String(card.config.groupColumn);
  card.valueCalcSelect.value = card.config.valueCalc ?? "";
  card.generation++;
  card.syncPlaceholder();
  card.renderControls();
  card.refreshBins();
  card.refreshGroupedBins();
  card.refreshTreemap();
  card.refreshText();
  card.render();
}

export function applyColumnDefaults(card: ChartCard): void {
  const meta = card.meta(card.config.column);
  card.binResult = null;
  card.chartXZoom = null;
  if (meta === undefined) {
    card.config.binOptions = null;
    return;
  }
  // A KDE curve adds noise on low-cardinality columns.
  card.config.kde = meta.stats.distinct >= 30;
  const suggested = suggestedBinRange(meta);
  card.config.binOptions = {
    min: suggested.min,
    max: suggested.max,
    binCount: DEFAULT_BIN_COUNT,
    overflow: suggested.overflow,
  };
  card.config.binClipped = suggested.clipped;
}

/**
 * Automatic bucket for a date column: a short span of timestamps gets minutes
 * or half-hours (about sixty points), longer ones day, week or month.
 */
export function defaultStepFor(card: ChartCard, column: number): { grain: TimeGrain; every: number } {
  const meta = card.meta(column);
  const min = meta?.stats.min;
  const max = meta?.stats.max;
  if (typeof min !== "number" || typeof max !== "number" || !(max > min)) return { grain: "month", every: 1 };
  const days = (max - min) / 86_400_000;
  if (days <= 2) {
    return meta?.type === "date" ? { grain: "day", every: 1 } : autoShortStep(max - min);
  }
  if (days <= 120) return { grain: "day", every: 1 };
  if (days <= 840) return { grain: "week", every: 1 };
  return { grain: "month", every: 1 };
}

export function defaultTitle(card: ChartCard): string {
  if (card.config.kind === "kpi") {
    const measure = card.meta(card.config.valueColumn ?? -1)?.name ?? "Count of rows";
    return defaultChartTitle(measure);
  }
  if (card.config.kind === "pivotHeatmap") {
    const data = card.pivotHeatmapData();
    return data === null
      ? "Pivot heatmap"
      : defaultChartTitle(`${data.measureName} by ${data.rowName} x ${data.colName}`);
  }
  if (card.usesAggregate()) return card.aggregateTitle();
  if (card.config.kind === "map") return "Map";
  if (isPairKind(card.config.kind)) {
    return defaultChartTitle(card.pairLabel("vs"));
  }
  if (card.config.kind === "correlation") {
    return defaultChartTitle("Correlation");
  }
  return defaultChartTitle(card.meta(card.config.column)?.name ?? "");
}

/** The series a line card plots, when the Time Series page can read it. */
export function seriesTarget(card: ChartCard): ChartSeriesTarget | null {
  if (card.config.kind !== "line" || card.config.source !== "" || card.options.onDeepDive === undefined) return null;
  if (!card.isDateLike(card.meta(card.config.column))) return null;
  const value = card.config.valueColumn ?? -1;
  return {
    dateColumn: card.config.column,
    groupColumn: card.config.groupColumn,
    valueColumn: value >= 0 && card.meta(value) !== undefined ? value : -1,
    valueAgg: card.config.valueAgg,
    // The bucket the value line draws (count lines bin by span, so the page picks).
    grain: value >= 0 ? card.resolvedGrain() : "auto",
    every: value >= 0 ? card.everyFor(card.resolvedGrain()) : 1,
  };
}

export function resetBinRange(card: ChartCard): void {
  const meta = card.meta(card.config.column);
  if (meta === undefined) return;
  const histogram = meta.histogram;
  let min = meta.stats.min ?? histogram?.min ?? 0;
  let max = meta.stats.max ?? histogram?.max ?? 1;
  if (!(max > min)) {
    min -= 1;
    max += 1;
  }
  card.config.binOptions = { min, max, binCount: DEFAULT_BIN_COUNT, overflow: false };
  card.config.binClipped = false;
  card.renderControls();
  card.refreshBins();
  card.render();
}

export function commitBinOptions(card: ChartCard): void {
  const min = parseChartNumber(card.minInput.value);
  const max = parseChartNumber(card.maxInput.value);
  const bins = Number(card.binsInput.value);
  if (min === null || max === null || !Number.isFinite(bins)) {
    card.renderControls();
    return;
  }
  card.config.binOptions = {
    min,
    max,
    binCount: Math.max(1, Math.min(256, Math.floor(bins))),
    overflow: card.overflowInput.checked,
  };
  card.config.binClipped = false;
  // A manual range is the new full view; any drag-zoom no longer applies.
  card.chartXZoom = null;
  card.renderControls();
  card.refreshBins();
  card.render();
}

export function refreshBins(card: ChartCard): void {
  if (card.config.kind === "line") {
    const meta = card.meta(card.config.column);
    const fullMin = meta?.stats.min;
    const fullMax = meta?.stats.max;
    if (
      meta === undefined ||
      (meta.type !== "date" && meta.type !== "datetime") ||
      typeof fullMin !== "number" ||
      typeof fullMax !== "number" ||
      !(fullMax > fullMin)
    ) {
      card.lineBinResult = null;
      return;
    }
    const min = card.chartXZoom?.min ?? fullMin;
    const max = card.chartXZoom?.max ?? fullMax;
    if (!(max > min)) {
      card.lineBinResult = null;
      return;
    }
    const binCount = card.preferredLineBins(max - min);
    // The same column and span produce the same buckets: don't re-request on
    // every filter push (each response used to trigger another repaint).
    const signature = `${card.config.column}|${binCount}|${min}|${max}|${JSON.stringify(card.excludes())}`;
    if (card.lineBinSignature === signature && card.lineBinResult !== null) return;
    card.lineBinSignature = signature;
    const generation = ++card.generation;
    card.lineBinRange = { min, max };
    void card.options
      .requestBins(
        card.config.column,
        { min, max, binCount, overflow: false },
        card.excludes().length > 0 ? card.excludes() : undefined,
      )
      .then((bins) => {
        if (generation !== card.generation || card.disposed) return;
        card.lineBinResult = bins;
        card.render();
      })
      .catch(() => {
        // Keep the automatic histogram as the fallback.
      });
    card.binResult = null;
    return;
  }
  card.lineBinResult = null;
  card.lineBinRange = null;
  if (card.config.kind !== "histogram") {
    card.binResult = null;
    return;
  }
  const meta = card.meta(card.config.column);
  if (meta === undefined || !isNumericType(meta.type) || card.config.binOptions === null) {
    card.binResult = null;
    return;
  }
  const generation = ++card.generation;
  const column = card.config.column;
  const zoom = card.chartXZoom;
  const binOptions =
    zoom === null
      ? card.config.binOptions
      : {
          ...card.config.binOptions,
          min: zoom.min,
          max: zoom.max,
        };
  void card.options
    .requestBins(column, binOptions, card.excludes().length > 0 ? card.excludes() : undefined)
    .then((bins) => {
      if (generation !== card.generation || card.disposed) return;
      card.binResult = bins;
      card.binMedian = bins.median;
      card.render();
    })
    .catch(() => {
      // Keep the automatic histogram as the fallback.
    });
}

/** The full data range a line/histogram x axis can zoom within. */
export function xZoomBase(card: ChartCard): { min: number; max: number } | null {
  if (card.config.kind === "line") {
    const meta = card.meta(card.config.column);
    const min = meta?.stats.min;
    const max = meta?.stats.max;
    return typeof min === "number" && typeof max === "number" && max > min
      ? { min, max }
      : null;
  }
  if (card.config.kind === "histogram") {
    const options = card.config.binOptions;
    return options !== null && options.max > options.min
      ? { min: options.min, max: options.max }
      : null;
  }
  return null;
}

/** Worker scope for the card's own category filter and table-filter toggle. */
export function chartScope(card: ChartCard): {
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters: boolean;
  } {
  const column = card.config.filterColumn ?? -1;
  const code = card.config.filterCode ?? -1;
  return {
    ...(column >= 0 && code >= 0 ? { chartFilter: { column, code } } : {}),
    ...card.excludeScope(),
    respectFilters: card.config.respectFilters !== false,
  };
}

/** Generated text alternative for the canvas, updated on every redraw. */
export function canvasLabel(card: ChartCard): string {
  const rows = card.rowCount.toLocaleString();
  const name = (index: number): string => card.meta(index)?.name ?? "";
  switch (card.config.kind) {
    case "line": {
      const group = card.meta(card.config.groupColumn);
      return group === undefined
        ? `Line chart of ${name(card.config.column)}, ${rows} rows shown`
        : `Line chart of ${name(card.config.column)} by ${group.name}, ${rows} rows shown`;
    }
    case "bar":
      return `Bar chart of ${name(card.config.column)} (a count of rows), ${rows} rows shown`;
    case "dotplot":
    case "stacked100":
    case "smallmultiples":
    case "slopegraph":
    case "waterfall": {
      const group = card.meta(card.config.groupColumn);
      return `${CHART_KIND_LABELS[card.config.kind]} of ${card.config.valueAgg ?? "mean"}(${name(
        card.config.valueColumn ?? -1,
      )}) by ${name(card.config.column)}${group === undefined ? "" : ` and ${group.name}`}, ${rows} rows shown`;
    }
    case "barplot":
      return `Bar chart of ${card.config.valueAgg ?? "mean"}(${name(
        card.config.valueColumn ?? -1,
      )}) by ${name(card.config.column)}, ${rows} rows shown`;
    case "scatter":
      return `Scatter of ${name(card.config.x)} vs ${name(card.config.y)}, ${rows} rows shown`;
    case "density":
      return `Density plot of ${name(card.config.x)} vs ${name(card.config.y)}, ${rows} rows shown`;
    case "box":
      return `Box plot of ${name(card.config.x)} by ${name(card.config.y)}, ${rows} rows shown`;
    case "treemap":
      return `Treemap of ${name(card.config.column)}, ${rows} rows shown`;
    case "terms":
      return `Top terms in ${name(card.config.column)}, ${rows} rows shown`;
    case "heatmap":
      return `Heatmap of ${name(card.config.x)} × ${name(card.config.y)}, ${rows} rows shown`;
    case "correlation":
      return `Correlation matrix of ${card.config.correlationColumns.length} columns, ${rows} rows shown`;
    default: {
      const column = name(card.config.column);
      return column === ""
        ? `Histogram, ${rows} rows shown`
        : `Histogram of ${column}, ${rows} rows shown`;
    }
  }
}

/** Readable range bounds for a column: dates as dates, numbers trimmed. */
export function boundFormatter(card: ChartCard, column: number): (value: number) => string {
  const type = card.meta(column)?.type;
  if (type === "date" || type === "datetime") {
    return (value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      const iso = date.toISOString();
      return type === "date" || iso.endsWith("T00:00:00.000Z")
        ? iso.slice(0, 10)
        : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
    };
  }
  return (value) =>
    Number(value.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** False while the card has nothing its kind can plot. */
export function canDraw(card: ChartCard): boolean {
  if (card.columns.length === 0) return false;
  const count = (allow: (meta: ColumnMeta) => boolean): number =>
    card.columns.filter(allow).length;
  switch (card.config.kind) {
    case "histogram": {
      const meta = card.meta(card.config.column);
      return (
        meta !== undefined &&
        (isNumericType(meta.type) || meta.type === "time" || meta.type === "duration")
      );
    }
    case "line":
      return count((meta) => card.isDateLike(meta)) > 0;
    case "barplot": {
      const category = card.meta(card.config.column);
      const measure = card.meta(card.config.valueColumn ?? -1);
      return (
        category !== undefined &&
        measure !== undefined &&
        isGroupable(category) &&
        (isNumericType(measure.type) || measure.type === "duration")
      );
    }
    case "bar":
    case "treemap": {
      const meta = card.meta(card.config.column);
      return meta !== undefined && isGroupable(meta);
    }
    case "terms": {
      const meta = card.meta(card.config.column);
      return meta !== undefined && meta.type === "string";
    }
    case "scatter":
    case "density": {
      const x = card.meta(card.config.x);
      const y = card.meta(card.config.y);
      return (
        x !== undefined &&
        y !== undefined &&
        card.allowsAxis(x) &&
        card.allowsAxis(y)
      );
    }
    case "box":
      return count((meta) => isNumericType(meta.type)) > 0 &&
        count((meta) => isGroupable(meta)) > 0;
    case "treemap": {
      const meta = card.meta(card.config.column);
      return meta !== undefined && isGroupable(meta);
    }
    case "heatmap":
      return count((meta) => isGroupable(meta)) >= 2;
    case "bubble": {
      const x = card.meta(card.config.x);
      const y = card.meta(card.config.y);
      return (
        x !== undefined && y !== undefined && isNumericType(x.type) && isNumericType(y.type)
      );
    }
    case "correlation":
      return count((meta) => isNumericType(meta.type)) >= 2;
    case "kpi": {
      const meta = card.meta(card.config.valueColumn ?? -1);
      return meta !== undefined && (isNumericType(meta.type) || meta.type === "duration");
    }
    case "map": {
      const x = card.meta(card.config.x);
      const y = card.meta(card.config.y);
      return (
        x !== undefined &&
        y !== undefined &&
        isNumericType(x.type) &&
        isNumericType(y.type)
      );
    }
    case "dotplot":
    case "stacked100":
    case "smallmultiples":
    case "slopegraph":
    case "waterfall": {
      const column = card.meta(card.config.column);
      const measure = card.meta(card.config.valueColumn ?? -1);
      const kind = card.config.kind;
      const columnOk =
        column !== undefined &&
        (kind === "smallmultiples"
          ? card.isDateLike(column)
          : kind === "waterfall" || kind === "slopegraph"
            ? isGroupable(column) || card.isDateLike(column)
            : isGroupable(column));
      const groupOk = !GROUP_REQUIRED_KINDS.includes(kind) || card.meta(card.config.groupColumn) !== undefined;
      return (
        columnOk &&
        groupOk &&
        measure !== undefined &&
        (isNumericType(measure.type) || measure.type === "duration")
      );
    }
    case "pivotHeatmap":
      return card.config.source !== "";
  }
}
