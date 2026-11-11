/**
 * Building the chart card's controls, part 1 of 3: the constructor's work, in the order it ran, one function
 * per stretch. Each takes the card it is building and returns the few elements a later stretch still needs.
 */
import { focusIcon, movieIcon, pngIcon } from "./chart-card-parts.js";
import type { SeriesMode } from "../data/chart-series.js";
import type { Aggregate } from "../data/aggregate.js";
import { chartConfigWithDefaults } from "./chart-builder.js";
import { CHART_KIND_LABELS, type ChartCardKind, DEFAULT_MAP_MODE, SPLIT_KINDS } from "./chart-utils.js";
import { el } from "./dom.js";
import type { ChartCard } from "./chart-card.js";
import type { DensityStyle, ChartCardConfig } from "./chart-card.js";

export function buildPart1(card: ChartCard, root: HTMLElement, preset: Partial<ChartCardConfig> | undefined) {
    card.root = root;
    card.root.classList.add("chart-card");
    card.config = chartConfigWithDefaults(preset);

    const head = el("div", { class: "chart-card-head" });
    // Source selector: the filtered table or a saved aggregate view. A card
    // bound to a view reads that view's result; there is no raw-row path.
    const sourceWrap = el("label", { class: "chart-field chart-source-field" });
    sourceWrap.append(el("span", { class: "chart-field-label" }, ["Source"]));
    card.sourceSelect = card.buildSelect("chart-picker chart-picker-small chart-source", "Data source");
    card.renderSourceOptions();
    card.sourceSelect.addEventListener("change", () => {
      card.config.source = card.sourceSelect.value;
      card.config.viewAxis = undefined;
      card.config.viewSeries = undefined;
      card.config.viewMeasure = undefined;
      card.generation++;
      card.viewResult = null;
      card.pivotResult = null;
      card.syncSourceControls();
      if (card.config.source !== "") card.refreshView();
      else card.refreshValue();
      card.render();
    });
    sourceWrap.append(card.sourceSelect);
    card.sourceWrap = sourceWrap;

    card.kindSelect = el("select", {
      class: "chart-kind",
      "aria-label": "Chart type",
    }) as HTMLSelectElement;
    (Object.keys(CHART_KIND_LABELS) as ChartCardKind[]).forEach((kind) => {
      // Maps are the Map page's; a card there or from an old spec still needs its own name here.
      if (kind === "map" && card.config.kind !== "map") return;
      card.kindSelect.append(
        el("option", { value: kind }, [CHART_KIND_LABELS[kind]]) as HTMLOptionElement,
      );
    });
    card.kindSelect.addEventListener("change", () =>
      card.setKind(card.kindSelect.value as ChartCardKind),
    );

    card.primarySelect = card.buildSelect("chart-picker", "Chart column");
    card.primarySelect.addEventListener("change", () =>
      card.setPrimaryColumn(Number(card.primarySelect.value)),
    );
    const primaryTag = card.tagged("Column", card.primarySelect);
    card.primaryWrap = primaryTag.wrap;
    card.primaryTagLabel = primaryTag.label;

    card.groupSelect = card.buildSelect(
      "chart-picker chart-picker-small",
      "Group by",
    );
    card.groupSelect.addEventListener("change", () => {
      card.config.groupColumn = Number(card.groupSelect.value);
      // Split by a field or by several values, one at a time.
      if (card.config.groupColumn >= 0) card.config.extraValueColumns = [];
      card.hiddenGroups.clear();
      card.generation++;
      card.refreshGroupedBins();
      card.refreshBubble();
      card.refreshAnimation();
      card.refreshValue();
      card.renderControls();
      card.render();
    });
    card.groupWrap = card.tagged("Group by", card.groupSelect).wrap;

    card.valueSelect = card.buildSelect("chart-picker chart-picker-small", "Value column");
    card.valueSelect.addEventListener("change", () => {
      card.config.valueColumn = Number(card.valueSelect.value);
      card.syncValueAggOptions();
      // A numeric treemap measure defaults to sum, matching pivot conventions.
      if (card.config.kind === "treemap" && (card.config.valueColumn ?? -1) >= 0) {
        card.config.valueAgg = "sum";
        card.valueAggSelect.value = "sum";
      }
      // A value and a group can only share a chart whose type splits into series
      // (lines, bars and their relatives); anywhere else the value choice clears the group.
      if ((card.config.valueColumn ?? -1) >= 0 && !SPLIT_KINDS.includes(card.config.kind)) {
        card.config.groupColumn = -1;
      }
      card.generation++;
      card.syncOptions();
      card.renderControls();
      card.refreshValue();
      card.refreshTreemap();
      card.render();
    });
    card.valueWrap = card.tagged("Value", card.valueSelect).wrap;

    card.valueAggSelect = card.buildSelect("chart-picker chart-picker-small", "Aggregation");
    (
      [
        ["mean", "Average (mean)"],
        ["sum", "Sum"],
        ["median", "Median"],
        ["min", "Min"],
        ["max", "Max"],
        ["count", "Count of values"],
        ["distinct", "Distinct values"],
      ] as const
    ).forEach(([value, label]) => {
      card.valueAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    card.valueAggSelect.addEventListener("change", () => {
      card.config.valueAgg = card.valueAggSelect.value as ChartCardConfig["valueAgg"];
      card.generation++;
      card.refreshValue();
      card.refreshTreemap();
      card.render();
    });
    card.valueAggWrap = card.tagged("Aggregate", card.valueAggSelect).wrap;

    card.valueGrainSelect = card.buildSelect("chart-picker chart-picker-small", "Bucket");
    (["auto", "second", "minute", "hour", "day", "week", "month", "quarter", "year"] as const).forEach(
      (grain) => {
        const label = grain === "auto" ? "Auto" : grain.charAt(0).toUpperCase() + grain.slice(1);
        card.valueGrainSelect.append(el("option", { value: grain }, [label]) as HTMLOptionElement);
      },
    );
    card.valueGrainSelect.addEventListener("change", () => {
      card.config.valueGrain = card.valueGrainSelect.value as ChartCardConfig["valueGrain"];
      card.generation++;
      card.renderControls();
      card.refreshValue();
      card.render();
    });
    card.valueGrainSelect.title = "How finely time is grouped. Dates are used as stored: no time-zone shift is applied.";
    card.valueGrainWrap = card.tagged("Time resolution", card.valueGrainSelect).wrap;

    card.valueEveryInput = el("input", {
      class: "chart-picker chart-picker-small chart-every-input",
      type: "number",
      min: "1",
      step: "1",
      inputmode: "numeric",
      "aria-label": "Every N time units",
      title: "Group every N units together: 15 with Minute is quarter-hourly, 2 with Week is fortnightly.",
    }) as HTMLInputElement;
    card.valueEveryInput.addEventListener("change", () => {
      const value = Math.floor(Number(card.valueEveryInput.value));
      card.config.valueEvery = Number.isFinite(value) && value >= 2 ? Math.min(value, 100_000) : undefined;
      card.valueEveryInput.value = String(card.config.valueEvery ?? 1);
      card.generation++;
      card.renderControls();
      card.refreshValue();
      card.render();
    });
    card.valueEveryWrap = el("label", { class: "chart-tag" }, [
      el("span", { class: "chart-tag-label" }, ["Every"]),
      card.valueEveryInput,
    ]);

    card.valueFillSelect = card.buildSelect("chart-picker chart-picker-small", "Missing periods");
    (
      [
        ["auto", "Automatic"],
        ["gap", "Show gaps"],
        ["zero", "Count as zero"],
        ["carry", "Carry last value"],
      ] as const
    ).forEach(([value, label]) => {
      card.valueFillSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    card.valueFillSelect.addEventListener("change", () => {
      const value = card.valueFillSelect.value;
      card.config.valueFill = value === "auto" ? undefined : (value as "gap" | "zero" | "carry");
      card.generation++;
      card.refreshValue();
      card.render();
    });
    card.valueFillWrap = card.tagged("Missing periods", card.valueFillSelect).wrap;

    card.weekStartSelect = card.buildSelect("chart-picker chart-picker-small", "Week starts on");
    [["1", "Monday"], ["0", "Sunday"]].forEach(([value, label]) => {
      card.weekStartSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    card.weekStartSelect.addEventListener("change", () => {
      card.config.valueWeekStart = card.weekStartSelect.value === "0" ? 0 : undefined;
      card.generation++;
      card.refreshValue();
      card.render();
    });
    card.weekStartWrap = card.tagged("Week starts", card.weekStartSelect).wrap;

    card.fiscalSelect = card.buildSelect("chart-picker chart-picker-small", "Financial year starts in");
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].forEach((label, index) => {
      card.fiscalSelect.append(el("option", { value: String(index + 1) }, [index === 0 ? "January (calendar year)" : label]) as HTMLOptionElement);
    });
  return { head };
}

export function buildPart2(card: ChartCard) {
    card.fiscalSelect.addEventListener("change", () => {
      const month = Number(card.fiscalSelect.value);
      card.config.valueFiscalStart = month > 1 ? month : undefined;
      card.generation++;
      card.refreshValue();
      card.render();
    });
    card.fiscalWrap = card.tagged("Year starts", card.fiscalSelect).wrap;

    card.valueCalcSelect = card.buildSelect(
      "chart-picker chart-picker-small",
      "Chart calculation",
    );
    (
      [
        ["", "None"],
        ["rolling7", "Rolling mean (7)"],
        ["cumulative", "Cumulative"],
        ["diff", "Difference"],
        ["pctChange", "% change"],
        ["pctTotal", "% of total"],
        ["pctRows", "% of rows"],
        ["rank", "Rank"],
        ["yoy", "Year-over-year %"],
      ] as const
    ).forEach(([value, label]) => {
      card.valueCalcSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    card.valueCalcSelect.addEventListener("change", () => {
      card.config.valueCalc =
        (card.valueCalcSelect.value as ChartCardConfig["valueCalc"]) || undefined;
      card.generation++;
      card.refreshValue();
      card.syncScope();
      card.render();
    });
    card.valueCalcWrap = card.tagged("Calc", card.valueCalcSelect).wrap;

    card.sortSelect = card.buildSelect(
      "chart-picker chart-picker-small",
      "Chart sort order",
    );
    for (const [value, label] of [
      ["none", "Automatic"],
      ["valueDesc", "Value high to low"],
      ["valueAsc", "Value low to high"],
      ["labelAsc", "Label A-Z"],
      ["labelDesc", "Label Z-A"],
      ["timeAsc", "Oldest first"],
      ["timeDesc", "Newest first"],
    ] as const) {
      card.sortSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    card.sortSelect.addEventListener("change", () => {
      card.config.chartSort = card.sortSelect.value as ChartCardConfig["chartSort"];
      card.render();
    });
    card.sortWrap = card.tagged("Sort", card.sortSelect).wrap;

    card.filterColumnSelect = card.buildSelect(
      "chart-picker chart-picker-small",
      "Chart filter column",
    );
    card.filterValueSelect = card.buildSelect(
      "chart-picker chart-picker-small",
      "Chart filter value",
    );
    card.filterColumnSelect.addEventListener("change", () => {
      card.config.filterColumn = Number(card.filterColumnSelect.value);
      card.config.filterCode = -1;
      card.generation++;
      card.syncChartFilterControls();
      card.syncScope();
      card.refreshValue();
      card.refreshTreemap();
      card.regions?.refresh();
      card.refreshSeries();
      card.refreshCrosstab();
      card.refreshCorrelation();
      card.render();
    });
    card.filterValueSelect.addEventListener("change", () => {
      card.config.filterCode = Number(card.filterValueSelect.value);
      card.generation++;
      card.syncScope();
      card.refreshValue();
      card.refreshTreemap();
      card.regions?.refresh();
      card.refreshSeries();
      card.refreshCrosstab();
      card.refreshCorrelation();
      card.render();
    });
    card.filterRespectInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    card.filterRespectInput.checked = true;
    const filterRespectField = el("label", { class: "control check clean-check chart-check" });
    filterRespectField.title = "Include the current table filters in this chart";
    filterRespectField.append(card.filterRespectInput, "Also respect table filters");
    card.filterRespectInput.addEventListener("change", () => {
      card.config.respectFilters = card.filterRespectInput.checked;
      card.generation++;
      card.syncScope();
      card.refreshValue();
      card.refreshTreemap();
      card.regions?.refresh();
      card.refreshSeries();
      card.refreshCrosstab();
      card.refreshCorrelation();
      card.render();
    });
    card.chartFilterRow = el("div", { class: "chart-settings" }, [
      el("span", { class: "chart-field-label" }, ["Chart filter"]),
      card.filterColumnSelect,
      card.filterValueSelect,
      filterRespectField,
    ]);

    card.xSelect = card.buildSelect("chart-picker", "X column");
    card.xSelect.addEventListener("change", () => {
      card.config.x = Number(card.xSelect.value);
      card.plotView = null;
      card.mapView = null;
      card.chartXZoom = null;
      card.barWindow = null;
      card.generation++;
      card.refreshSeries();
      card.refreshBox();
      card.refreshCrosstab();
      card.refreshBubble();
      card.refreshMapGrid();
      card.refreshAnimation();
      card.render();
    });
    const xTag = card.tagged("X", card.xSelect);
    card.xWrap = xTag.wrap;
    card.xTagLabel = xTag.label;

    card.ySelect = card.buildSelect("chart-picker", "Y column");
    card.ySelect.addEventListener("change", () => {
      card.config.y = Number(card.ySelect.value);
      card.plotView = null;
      card.mapView = null;
      card.chartXZoom = null;
      card.barWindow = null;
      card.generation++;
      card.refreshSeries();
      card.refreshBox();
      card.refreshCrosstab();
      card.refreshBubble();
      card.refreshMapGrid();
      card.refreshAnimation();
      card.render();
    });
    const yTag = card.tagged("Y", card.ySelect);
    card.yWrap = yTag.wrap;
    card.yTagLabel = yTag.label;

    card.colorSelect = card.buildSelect("chart-picker chart-picker-small", "Colour column");
    card.colorSelect.addEventListener("change", () => {
      card.config.colorColumn = Number(card.colorSelect.value);
      card.generation++;
      card.refreshSeries();
      card.refreshAnimation();
      card.renderControls();
      card.syncPalette();
      card.render();
    });
    card.colorWrap = card.tagged("Colour", card.colorSelect).wrap;

    card.sizeSelect = card.buildSelect("chart-picker chart-picker-small", "Size column");
    card.sizeSelect.addEventListener("change", () => {
      card.config.sizeColumn = Number(card.sizeSelect.value);
      // Picking a column for a bubble or heat map means "measure by this
      // column": switch the measure away from count so the choice takes
      // effect immediately, and back to count when the column is cleared.
      if (card.config.kind === "bubble" || (card.config.kind === "map" && (card.config.mapMode ?? DEFAULT_MAP_MODE) !== "points")) {
        if (card.config.sizeColumn < 0) {
          card.config.bubbleAgg = "count";
          card.bubbleAggSelect.value = "count";
        } else if ((card.config.bubbleAgg ?? "count") === "count") {
          card.config.bubbleAgg = "sum";
          card.bubbleAggSelect.value = "sum";
        }
      }
      card.generation++;
      card.refreshSeries();
      card.refreshTreemap();
      card.refreshBubble();
      card.refreshMapGrid();
      card.refreshAnimation();
      card.renderControls();
      card.render();
    });
}

export function buildPart3(card: ChartCard) {
    const sizeTag = card.tagged("Size", card.sizeSelect);
    card.sizeWrap = sizeTag.wrap;
    card.sizeTagLabel = sizeTag.label;

    card.modeSelect = card.buildSelect("chart-picker chart-picker-small", "Render mode");
    ([
      ["points", "Points"],
      ["density", "Density (heat map)"],
    ] as const).forEach(([value, label]) => {
      card.modeSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    card.modeSelect.addEventListener("change", () => {
      card.config.mode = card.modeSelect.value as SeriesMode;
      card.generation++;
      card.renderControls();
      card.refreshSeries();
      card.render();
    });
    card.modeWrap = card.tagged("Render", card.modeSelect).wrap;

    card.densityStyleSelect = card.buildSelect("chart-picker chart-picker-small", "Density style");
    (
      [
        ["heat", "Heat"],
        ["contours", "Contours"],
        ["both", "Heat + lines"],
      ] as const
    ).forEach(([value, label]) => {
      card.densityStyleSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    card.densityStyleSelect.addEventListener("change", () => {
      card.config.densityStyle = card.densityStyleSelect.value as DensityStyle;
      card.render();
    });
    card.densityStyleWrap = card.tagged("Style", card.densityStyleSelect).wrap;

    const more = el(
      "button",
      {
        class: "icon-btn chart-more",
        type: "button",
        title: "More actions",
        "aria-label": "Chart actions",
      },
      ["⋯"],
    ) as HTMLButtonElement;
    more.addEventListener("click", () => card.openCardMenu(more));

    // Axis controls live in their own bordered group so they read as "what is
    // plotted" rather than another settings row.
    card.axesPanel = el("div", { class: "chart-axes" }, [
      el("span", { class: "chart-axes-label" }, ["Axes"]),
      card.primaryWrap,
      card.xWrap,
      card.yWrap,
    ]);
    card.focusButton = el(
      "button",
      {
        class: "ghost small chart-focus-btn",
        type: "button",
        title: "Expand this chart for a closer look (Esc to close)",
        "aria-label": "Focus chart",
      },
      [],
    ) as HTMLButtonElement;
    card.focusButton.append(focusIcon(), el("span", {}, ["Focus"]));
    card.focusButton.addEventListener("click", () => card.toggleFocus());
    card.pngButton = el(
      "button",
      {
        class: "ghost small chart-png-btn",
        type: "button",
        title: "Download this chart as a PNG",
        "aria-label": "Download PNG",
      },
      [],
    ) as HTMLButtonElement;
    card.pngButton.append(pngIcon(), el("span", {}, ["PNG"]));
    card.pngButton.addEventListener("click", () => card.options.onExport(card));
    card.statsButton = el(
      "button",
      { class: "ghost small chart-stats-btn", type: "button", "aria-label": "Extract chart stats", title: "See and copy the numbers behind this chart: bin counts, box ranges, curve and line parameters" },
      [el("span", { class: "chart-stats-long" }, ["Extract stats"]), el("span", { class: "chart-stats-short" }, ["Stats"])],
    ) as HTMLButtonElement;
    card.statsButton.addEventListener("click", () => card.openStats());
    card.animateButton = el(
      "button",
      {
        class: "ghost small chart-animate-btn",
        type: "button",
        title: "Step this chart through time",
        "aria-label": "Animate chart",
      },
      [],
    ) as HTMLButtonElement;
    card.animateButton.append(movieIcon(), el("span", {}, ["Animate"]));
    card.animateButton.addEventListener("click", () => card.toggleAnimationSetup());

    card.pivotRowSelect = card.buildSelect(
      "chart-picker chart-picker-small",
      "Pivot row level",
    );
    card.pivotRowSelect.addEventListener("change", () => {
      card.config.pivotRowLevel = Number(card.pivotRowSelect.value);
      card.render();
    });
    card.pivotRowWrap = card.tagged("Rows", card.pivotRowSelect).wrap;
    card.pivotColSelect = card.buildSelect(
      "chart-picker chart-picker-small",
      "Pivot column level",
    );
    card.pivotColSelect.addEventListener("change", () => {
      card.config.pivotColLevel = Number(card.pivotColSelect.value);
      card.render();
    });
    card.pivotColWrap = card.tagged("Columns", card.pivotColSelect).wrap;
    card.pivotMeasureSelect = card.buildSelect(
      "chart-picker chart-picker-small",
      "Pivot measure",
    );
    card.pivotMeasureSelect.addEventListener("change", () => {
      card.config.pivotMeasure = Number(card.pivotMeasureSelect.value);
      card.render();
    });
    card.pivotMeasureWrap = card.tagged("Value", card.pivotMeasureSelect).wrap;

    // A chart of a Pivot View: bars and lines or a heatmap, and which pivot field goes where.
    card.viewKindSelect = card.buildSelect("chart-picker chart-picker-small hidden", "Chart type for this pivot");
    card.viewKindSelect.addEventListener("change", () => {
      card.noteBeforeChange();
      card.config.kind = card.viewKindSelect.value === "pivotHeatmap" ? "pivotHeatmap" : "bar";
      card.viewResult = null;
      card.pivotResult = null;
      card.syncSourceControls();
      card.refreshForConfig();
    });
    const shapeSelect = (label: string, key: "viewAxis" | "viewSeries" | "viewMeasure"): HTMLSelectElement => {
      const select = card.buildSelect("chart-picker chart-picker-small", label);
      select.addEventListener("change", () => card.setViewShape(key, Number(select.value)));
      return select;
    };
    card.viewAxisSelect = shapeSelect("Pivot field on the axis", "viewAxis");
    card.viewSeriesSelect = shapeSelect("Pivot field for the series", "viewSeries");
    card.viewMeasureSelect = shapeSelect("Pivot value", "viewMeasure");
    card.viewAxisWrap = card.tagged("Axis", card.viewAxisSelect).wrap;
    card.viewSeriesWrap = card.tagged("Series", card.viewSeriesSelect).wrap;
    card.viewMeasureWrap = card.tagged("Value", card.viewMeasureSelect).wrap;
    card.backToSource = el(
      "button",
      { class: "link small chart-back-to-source hidden", type: "button", title: "Open the Pivot View this chart draws, as you left it" },
      ["← Back to pivot"],
    ) as HTMLButtonElement;
    card.backToSource.addEventListener("click", () => {
      if (card.config.source !== "") card.options.onOpenSource?.(card.config.source);
    });
    // Every control below already shows or hides itself for the chart type;
    // the sidebar only decides where they live.
    const sidebarRow = (label: string, control: HTMLElement): HTMLElement =>
      el("label", { class: "chart-tag chart-side-row" }, [
        el("span", { class: "chart-tag-label" }, [label]),
        control,
      ]);
    const sideSection = (...children: HTMLElement[]): HTMLElement =>
      el("div", { class: "chart-side-section" }, children);
    card.kindSelect.classList.add("chart-picker");
    card.sidebar = el("aside", { class: "chart-sidebar", "aria-label": "Chart settings" }, [
      sideSection(
        sidebarRow(
          "Chart type",
          el("span", { class: "chart-kind-field" }, [card.kindSelect, card.kindStatic, card.viewKindSelect]),
        ),
        card.sourceWrap,
        card.backToSource,
      ),
      sideSection(card.axesPanel, card.sortWrap),
      sideSection(card.valueWrap, card.extraValuesWrap, card.groupWrap, card.valueCalcWrap),
      sideSection(card.viewAxisWrap, card.viewSeriesWrap, card.viewMeasureWrap),
      sideSection(card.pivotRowWrap, card.pivotColWrap, card.pivotMeasureWrap),
    ]);
    card.sidebarToggle = el(
      "button",
      {
        class: "ghost small chart-sidebar-toggle",
        type: "button",
        title: "Open the settings drawer: type, fields, colours",
        "aria-label": "Customize this chart",
        "aria-expanded": "false",
      },
      ["Customize"],
    ) as HTMLButtonElement;
  return { more };
}
