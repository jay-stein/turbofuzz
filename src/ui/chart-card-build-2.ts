/**
 * Building the chart card's controls, part 2 of 3: the constructor's work, in the order it ran, one function
 * per stretch. Each takes the card it is building and returns the few elements a later stretch still needs.
 */
import { INTERVAL_KINDS, type IntervalKind } from "../data/error-bars.js";
import { DOT_SCALES, type DotScale } from "../data/dot-size.js";
import { DEFAULT_PALETTE } from "../data/palettes.js";
import type { Aggregate } from "../data/aggregate.js";
import { CHART_COLORS, parseChartNumber } from "./chart-utils.js";
import { el } from "./dom.js";
import { MapRegions } from "./map-regions.js";
import type { ChartCard } from "./chart-card.js";
import type { MarkerShape } from "./chart-card.js";
import { MARKER_SHAPES, MORE_PALETTES, HEX } from "./chart-card.js";

export function buildPart4(card: ChartCard, head: HTMLElement, more: HTMLButtonElement) {
    card.sidebarToggle.addEventListener("click", () => card.toggleSidebar());
    // A visible way out: the drawer overlays the card, so it carries its own Done button at the top, always in view.
    const sideHead = el("div", { class: "chart-side-head" }, [el("b", {}, ["Chart settings"])]);
    const sideDone = el("button", { class: "ghost small", type: "button", "aria-label": "Close the settings drawer", title: "Close the settings (Escape)" }, ["Done"]);
    sideDone.addEventListener("click", () => { card.toggleSidebar(); card.sidebarToggle.focus(); });
    sideHead.append(sideDone);
    card.sidebar.prepend(sideHead);
    card.sidebar.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !card.sidebarShown || card.options.docked === true) return;
      event.stopPropagation();
      card.toggleSidebar();
      card.sidebarToggle.focus();
    });
    head.prepend(card.sidebarToggle);
    head.append(
      el("span", { class: "grow" }),
      card.focusButton,
      card.statsButton,
      card.pngButton,
      card.animateButton,
      more,
    );

    const field = (label: string, input: HTMLElement): HTMLElement => {
      const wrap = el("label", { class: "chart-field" });
      wrap.append(el("span", { class: "chart-field-label" }, [label]), input);
      return wrap;
    };
    card.minInput = el("input", {
      class: "chart-number chart-number-wide",
      type: "text",
      inputmode: "decimal",
      spellcheck: "false",
    }) as HTMLInputElement;
    card.maxInput = el("input", {
      class: "chart-number chart-number-wide",
      type: "text",
      inputmode: "decimal",
      spellcheck: "false",
    }) as HTMLInputElement;
    card.binsInput = el("input", {
      class: "chart-number",
      type: "number",
      min: "1",
      max: "256",
      step: "1",
      title: "Number of bins (1–256)",
      spellcheck: "false",
    }) as HTMLInputElement;
    card.overflowInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    const overflowField = el("label", { class: "control check clean-check chart-check" });
    overflowField.title = "Aggregate everything above the last bin into one bar";
    overflowField.append(card.overflowInput, "“> Max” bar");
    const fullRange = el(
      "button",
      { class: "ghost small", type: "button", title: "Reset Start/End to the data's full range" },
      ["Full range"],
    );
    fullRange.addEventListener("click", () => card.resetBinRange());
    card.kdeInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    card.kdeInput.checked = card.config.kde;
    const kdeField = el("label", { class: "control check clean-check chart-check" });
    kdeField.title = "Overlay a smooth kernel density curve on the histogram";
    kdeField.append(card.kdeInput, "KDE curve");
    card.kdeInput.addEventListener("change", () => {
      card.config.kde = card.kdeInput.checked;
      card.render();
    });
    card.errorBarInput = el("input", { type: "checkbox", "aria-label": "Error bars" }) as HTMLInputElement;
    card.errorBarInput.checked = card.config.errorBars === true;
    card.errorBarInput.addEventListener("change", () => {
      card.config.errorBars = card.errorBarInput.checked;
      card.syncErrorBarControls();
      card.refreshErrorBars();
      card.render();
    });
    card.errorBarSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Error bar type" }) as HTMLSelectElement;
    for (const { id, label, asks } of INTERVAL_KINDS) {
      card.errorBarSelect.append(el("option", { value: id, title: asks }, [label]) as HTMLOptionElement);
    }
    card.errorBarSelect.addEventListener("change", () => {
      card.config.errorBarKind = card.errorBarSelect.value as IntervalKind;
      card.syncErrorBarControls();
      card.refreshErrorBars();
      card.render();
    });
    card.errorBarHint = el("span", { class: "chart-field-hint chart-error-hint" });
    card.errorBarRow = el("div", { class: "chart-settings chart-error-row" }, [
      el("label", { class: "control check clean-check chart-check" }, [card.errorBarInput, "Error bars"]),
      card.errorBarSelect,
      card.errorBarHint,
    ]);
    card.histogramSettings = el("div", { class: "chart-settings" }, [
      field("Start", card.minInput),
      field("End", card.maxInput),
      field("Bins", card.binsInput),
      overflowField,
      kdeField,
      fullRange,
    ]);
    const onBinChange = (): void => card.commitBinOptions();
    card.minInput.addEventListener("change", onBinChange);
    card.maxInput.addEventListener("change", onBinChange);
    card.binsInput.addEventListener("change", onBinChange);
    card.overflowInput.addEventListener("change", onBinChange);

    card.topInput = el("input", {
      class: "chart-number",
      type: "number",
      min: "1",
      max: "50",
      step: "1",
      value: String(card.config.topN),
      title: "How many bars before the rest is grouped as Other",
      spellcheck: "false",
      "aria-label": "Number of category bars",
    }) as HTMLInputElement;
    card.topInput.addEventListener("change", () => {
      const value = Math.floor(Number(card.topInput.value));
      card.config.topN = Number.isFinite(value) ? Math.max(1, Math.min(50, value)) : 5;
      card.topInput.value = String(card.config.topN);
      card.barWindow = null;
      card.generation++;
      card.refreshBox();
      card.refreshCrosstab();
      card.refreshBubble();
      card.refreshAnimation();
      card.render();
    });
    card.otherInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    card.otherInput.checked = card.config.groupOther;
    const otherField = el("label", { class: "control check clean-check chart-check" });
    otherField.append(card.otherInput, "Group rest as Other");
    card.otherInput.addEventListener("change", () => {
      card.config.groupOther = card.otherInput.checked;
      card.generation++;
      card.refreshBox();
      card.refreshCrosstab();
      card.refreshBubble();
      card.refreshAnimation();
      card.render();
    });
    card.multiInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    card.multiInput.checked = card.config.multiColor;
    const multiField = el("label", { class: "control check clean-check chart-check" });
    multiField.title = "Give every bar its own colour from the palette";
    multiField.append(card.multiInput, "Colour each bar");
    card.multiInput.addEventListener("change", () => {
      card.config.multiColor = card.multiInput.checked;
      card.render();
    });
    const topField = el("label", { class: "chart-field" });
    card.topLabel = el("span", { class: "chart-field-label" }, ["Top bars"]);
    topField.append(card.topLabel, card.topInput);
    card.bubbleBinsInput = el("input", {
      class: "chart-number",
      type: "number",
      min: "4",
      max: "120",
      step: "1",
      title: "Bubble grid resolution per axis (4–120)",
      spellcheck: "false",
    }) as HTMLInputElement;
    card.bubbleBinsInput.value = String(card.config.bubbleBins ?? 40);
    const bubbleBinsChange = (): void => {
      const value = Math.round(Number(card.bubbleBinsInput.value));
      if (Number.isFinite(value) && value >= 4 && value <= 120) {
        card.config.bubbleBins = value;
        card.generation++;
        card.refreshBubble();
        card.refreshMapGrid();
        card.refreshAnimation();
        card.render();
      }
    };
    card.bubbleBinsInput.addEventListener("change", bubbleBinsChange);
    const bubbleField = el("label", { class: "chart-field" });
    bubbleField.title = "How many cells each axis is divided into before counting rows";
    card.gridHint = el("span", { class: "chart-field-hint" });
    bubbleField.append(
      el("span", { class: "chart-field-label" }, ["Grid"]),
      card.bubbleBinsInput,
      card.gridHint,
    );
    card.gridField = bubbleField;
    card.bubbleAggSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Bubble size measure",
      title: "What the bubble area represents: rows per cell or an aggregate of a numeric column",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["count", "Rows"],
      ["sum", "Sum"],
      ["mean", "Average (mean)"],
      ["min", "Min"],
      ["max", "Max"],
    ] as const) {
      card.bubbleAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    card.bubbleAggSelect.value = card.config.bubbleAgg ?? "count";
    card.bubbleAggSelect.addEventListener("change", () => {
      card.config.bubbleAgg = card.bubbleAggSelect.value as
        | "count"
        | "sum"
        | "mean"
        | "min"
        | "max";
      card.generation++;
      card.refreshBubble();
      card.refreshSeries();
      card.refreshMapGrid();
      card.refreshAnimation();
      card.render();
    });
    const bubbleAggField = el("label", { class: "chart-field" });
    card.bubbleAggField = bubbleAggField;
    bubbleAggField.title = "How the rows in each area combine into one value";
    card.bubbleAggHint = el("span", { class: "chart-field-hint" });
    bubbleAggField.append(
      el("span", { class: "chart-field-label" }, ["Aggregate"]),
      card.bubbleAggSelect,
      card.bubbleAggHint,
    );
    card.bubbleScaleSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Bubble size scale",
      title: "How the measure maps to bubble radius — area is the honest default",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["area", "Area ∝ value"],
      ["radius", "Radius ∝ value"],
      ["log", "Log scale"],
    ] as const) {
      card.bubbleScaleSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    card.bubbleScaleSelect.value = card.config.bubbleScale ?? "area";
    card.bubbleScaleSelect.addEventListener("change", () => {
      card.config.bubbleScale = card.bubbleScaleSelect.value as "area" | "radius" | "log";
      card.render();
    });
    const bubbleScaleField = el("label", { class: "chart-field" });
    bubbleScaleField.title = "How values become radius: area keeps sizes proportional, log compresses extremes";
    bubbleScaleField.append(
      el("span", { class: "chart-field-label" }, ["Mapping"]),
      card.bubbleScaleSelect,
    );
    card.barStackInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    card.barStackInput.checked = (card.config.barLayout ?? "group") === "stack";
    card.barStackField = el("label", { class: "control check clean-check chart-check" });
    card.barStackField.title = "Stack grouped barplot values instead of placing them side by side";
    card.barStackField.append(card.barStackInput, "Stack groups");
    card.barStackInput.addEventListener("change", () => {
      card.config.barLayout = card.barStackInput.checked ? "stack" : "group";
      card.render();
    });
    card.barSettings = el("div", { class: "chart-settings" }, [
      topField,
      otherField,
      multiField,
      card.barStackField,
    ]);
    // Bubble options sit in their own visible row, not inside Settings: the
    // size measure is the whole point of a bubble chart. Map cards reuse the
    // same row for display mode, grid resolution and the heat/size measure.
    card.bubbleTitle = el("span", { class: "chart-animate-title" }, ["Bubbles"]);
    card.mapModeSelect = card.buildSelect("chart-picker chart-picker-small", "Map display mode");
    for (const [value, label] of [
      ["places", "One dot per place"],
      ["points", "One dot per row"],
      ["cluster", "One dot per row, clustered"],
    ] as const) {
      card.mapModeSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    if (card.config.mapMode !== "heat" && card.config.mapMode !== "regions") card.mapModeSelect.value = card.mapModeChoice();
    card.mapModeSelect.addEventListener("change", () => {
      const value = card.mapModeSelect.value;
      // Clustering is a way of drawing one dot per row: it is the points mode with the groups switched on.
      card.config.mapCluster = value === "cluster";
      card.setMapMode(value === "places" ? "places" : "points");
    });
    card.mapModeWrap = card.tagged("Show", card.mapModeSelect).wrap;
    card.regions = card.options.requestRegions === undefined ? null : new MapRegions(card.regionOptions(card.options.requestRegions));
    card.bubbleScaleField = bubbleScaleField;
    card.bubbleSettings = el("div", { class: "chart-bubble-settings hidden" }, [
      card.bubbleTitle,
      card.mapModeWrap,
      ...(card.regions === null ? [] : [card.regions.root]),
      bubbleField,
      bubbleAggField,
      bubbleScaleField,
    ]);
  return { sideHead, field };
}

export function buildPart5(card: ChartCard, field: (label: string, input: HTMLElement) => HTMLElement) {
    // Dots: what a GIS calls proportional symbols. Radius of the smallest and largest dot, the value
    // range they span, how value becomes radius, and opacity. Pure drawing, so nothing is refetched.
    const dotNumber = (label: string, title: string, min: string, step: string): HTMLInputElement =>
      el("input", {
        class: "chart-number chart-dot-number",
        type: "number",
        min,
        step,
        "aria-label": label,
        title,
      }) as HTMLInputElement;
    card.dotMinInput = dotNumber("Smallest dot radius (pixels)", "Radius in pixels of the smallest dot (or of every dot when nothing sizes them)", "0.5", "0.5");
    card.dotMaxInput = dotNumber("Largest dot radius (pixels)", "Radius in pixels of the largest dot", "0.5", "0.5");
    card.dotValueMinInput = dotNumber("Value for the smallest dot", "The value that gets the smallest dot; smaller values are drawn the same size. Leave empty to use the lowest value in the data.", "", "any");
    card.dotValueMaxInput = dotNumber("Value for the largest dot", "The value that gets the largest dot; larger values are drawn the same size. Leave empty to use the highest value in the data.", "", "any");
    card.dotScaleSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "How value becomes dot radius",
      title: "How value becomes radius",
    }) as HTMLSelectElement;
    for (const scale of DOT_SCALES) {
      card.dotScaleSelect.append(el("option", { value: scale.id, title: scale.hint }, [scale.label]) as HTMLOptionElement);
    }
    card.dotOpacityInput = el("input", {
      type: "range",
      min: "10",
      max: "100",
      step: "5",
      class: "chart-dot-opacity",
      "aria-label": "Dot opacity",
      title: "How see-through the dots are: lower shows where dots pile up",
    }) as HTMLInputElement;
    card.dotOpacityOut = el("output", { class: "chart-field-hint" });
    const dotField = (label: string, children: (HTMLElement | string)[], title: string): HTMLElement =>
      el("label", { class: "chart-field", title }, [el("span", { class: "chart-field-label" }, [label]), ...children]);
    card.dotMinLabel = el("span", { class: "chart-field-label" }, ["Radius"]);
    card.dotMaxWrap = el("span", { class: "chart-dot-to" }, ["to ", card.dotMaxInput]);
    const dotRadiusField = el("label", { class: "chart-field", title: "Radius of the dots, in pixels" }, [
      card.dotMinLabel,
      card.dotMinInput,
      card.dotMaxWrap,
      el("span", { class: "chart-field-hint" }, ["px"]),
    ]);
    card.dotValuesWrap = dotField("Values", [card.dotValueMinInput, "to", card.dotValueMaxInput], "The value range the radii span: values outside it get the smallest or largest dot, so one extreme cannot shrink the rest");
    card.dotScaleWrap = dotField("Scale", [card.dotScaleSelect], "How value becomes radius");
    card.mapColorAggSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Colour of a place" }) as HTMLSelectElement;
    for (const [value, label] of [["mean", "Average (mean)"], ["sum", "Sum"], ["min", "Min"], ["max", "Max"]] as const) {
      card.mapColorAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    card.mapColorAggSelect.addEventListener("change", () => {
      card.config.mapColorAgg = card.mapColorAggSelect.value as "sum" | "mean" | "min" | "max";
      card.generation++;
      card.refreshSeries();
      card.refreshAnimation();
      card.render();
    });
    card.mapColorAggWrap = dotField("Colour is the", [card.mapColorAggSelect], "How the rows at a place combine into its colour");
    card.mapColorScaleSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Colour scale" }) as HTMLSelectElement;
    for (const [value, label] of [["linear", "Linear"], ["log", "Logarithmic"]] as const) {
      card.mapColorScaleSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    card.mapColorScaleSelect.addEventListener("change", () => {
      card.config.mapColorScale = card.mapColorScaleSelect.value as "linear" | "log";
      card.render();
    });
    card.mapColorScaleWrap = dotField("Colour scale", [card.mapColorScaleSelect], "Logarithmic spreads out values with a long tail, such as durations or prices");
    card.mapLabelSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Place label" }) as HTMLSelectElement;
    card.mapLabelSelect.addEventListener("change", () => {
      card.config.mapLabelColumn = Number(card.mapLabelSelect.value);
      card.generation++;
      card.refreshSeries();
      card.refreshAnimation();
      card.render();
    });
    card.mapLabelWrap = dotField("Label", [card.mapLabelSelect], "The column that names a place when you hover its dot");
    card.dotShapeSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Dot shape", title: "The shape of each dot" }) as HTMLSelectElement;
    for (const shape of MARKER_SHAPES) card.dotShapeSelect.append(el("option", { value: shape.id }, [shape.label]) as HTMLOptionElement);
    card.dotShapeWrap = dotField("Shape", [card.dotShapeSelect], "The shape of each dot");
    card.fitLineInput = el("input", { type: "checkbox", "aria-label": "Line of best fit" }) as HTMLInputElement;
    card.fitR2Input = el("input", { type: "checkbox", "aria-label": "Show R squared" }) as HTMLInputElement;
    card.fitWrap = el("div", { class: "chart-field chart-fit" }, [
      el("label", { class: "chart-check", title: "A dashed least-squares line through the points" }, [card.fitLineInput, " Line of best fit"]),
      el("label", { class: "chart-check", title: "How much of the spread in Y the line accounts for (0 to 1). Shown only with the line." }, [card.fitR2Input, " R²"]),
    ]);
    card.dotShapeSelect.addEventListener("change", () => {
      card.config.markerShape = card.dotShapeSelect.value as MarkerShape;
      card.render();
    });
    card.fitLineInput.addEventListener("change", () => {
      card.config.fitLine = card.fitLineInput.checked;
      card.fitR2Input.disabled = !card.fitLineInput.checked;
      card.render();
    });
    card.fitR2Input.addEventListener("change", () => {
      card.config.fitR2 = card.fitR2Input.checked;
      card.render();
    });
    card.dotSettings = el("div", { class: "chart-bubble-settings chart-dot-settings hidden" }, [
      el("span", { class: "chart-animate-title" }, ["Dots"]),
      card.dotShapeWrap,
      dotRadiusField,
      card.dotValuesWrap,
      card.dotScaleWrap,
      card.mapColorAggWrap,
      card.mapColorScaleWrap,
      card.mapLabelWrap,
      dotField("Opacity", [card.dotOpacityInput, card.dotOpacityOut], "How see-through the dots are"),
      card.fitWrap,
    ]);
    card.refRows = el("div", { class: "chart-ref-rows" });
    const addRef = el("button", { class: "ghost small", type: "button", title: "Add a line across the chart at one value" }, ["+ Add a line"]);
    addRef.addEventListener("click", () => {
      const axis = card.refAxisColumn("y") >= 0 || card.hasValueAxis() ? "y" : "x";
      card.config.refLines = [...(card.config.refLines ?? []), { axis, source: "value" }];
      card.refKey = "";
      card.syncRefLines();
      card.render();
    });
    card.refSection = el("div", { class: "chart-bubble-settings chart-ref-settings" }, [
      el("span", { class: "chart-animate-title" }, ["Reference lines"]),
      card.refRows,
      el("div", { class: "chart-field" }, [addRef]),
      el("span", { class: "chart-field-hint chart-ref-hint" }, ["Drawn on charts with a numeric axis. A line is one value: type it, or use the mean of the plotted column (all rows)."]),
    ]);
    const dotNumberValue = (input: HTMLInputElement): number | null => {
      const text = input.value.trim();
      const value = Number(text);
      return text !== "" && Number.isFinite(value) ? value : null;
    };
    card.dotMinInput.addEventListener("input", () => {
      const value = dotNumberValue(card.dotMinInput);
      if (value !== null && value > 0) card.config.dotMinRadius = value;
      card.render();
    });
    card.dotMaxInput.addEventListener("input", () => {
      const value = dotNumberValue(card.dotMaxInput);
      if (value !== null && value > 0) card.config.dotMaxRadius = value;
      card.render();
    });
    card.dotValueMinInput.addEventListener("input", () => {
      card.config.dotValueMin = dotNumberValue(card.dotValueMinInput);
      card.render();
    });
    card.dotValueMaxInput.addEventListener("input", () => {
      card.config.dotValueMax = dotNumberValue(card.dotValueMaxInput);
      card.render();
    });
    card.dotScaleSelect.addEventListener("change", () => {
      card.config.dotScale = card.dotScaleSelect.value as DotScale;
      card.render();
    });
    card.dotOpacityInput.addEventListener("input", () => {
      card.config.dotOpacity = Number(card.dotOpacityInput.value) / 100;
      card.dotOpacityOut.textContent = `${card.dotOpacityInput.value}%`;
      card.render();
    });

    card.correlationSelect = el("select", {
      class: "chart-multiselect",
      multiple: "multiple",
      size: "5",
      "aria-label": "Correlation columns",
      title: "Numeric columns included in the matrix",
    }) as HTMLSelectElement;
    card.correlationSelect.addEventListener("change", () => {
      card.config.correlationColumns = [...card.correlationSelect.options]
        .filter((option) => option.selected)
        .map((option) => Number(option.value));
      card.generation++;
      card.refreshCorrelation();
      card.render();
    });
    card.correlationSettings = el("div", { class: "chart-settings" }, [
      el("span", { class: "chart-field-label" }, ["Columns"]),
      card.correlationSelect,
    ]);

    card.colorGroup = el("div", { class: "chart-colors" });
    CHART_COLORS.forEach((color) => {
      const swatch = el("button", {
        class: "chart-swatch",
        type: "button",
        title: color,
        "aria-label": `Use colour ${color}`,
      }) as HTMLButtonElement;
      swatch.style.background = color;
      swatch.addEventListener("click", () => {
        card.config.color = color;
        card.config.colorCustom = true;
        card.hexInput.value = card.primaryColor();
        card.syncSwatches();
        card.render();
      });
      card.swatches.push(swatch);
      card.colorGroup.append(swatch);
    });
}

export function buildPart6(card: ChartCard) {
    card.hexInput = el("input", {
      class: "chart-hex",
      type: "text",
      placeholder: "#2563eb",
      spellcheck: "false",
      "aria-label": "Custom colour as a hex code",
    }) as HTMLInputElement;
    card.hexInput.value = card.primaryColor();
    const applyHex = (): void => {
      const value = card.hexInput.value.trim();
      if (!HEX.test(value)) {
        card.hexInput.value = card.primaryColor();
        return;
      }
      card.config.color = value.startsWith("#") ? value.toLowerCase() : `#${value.toLowerCase()}`;
      card.config.colorCustom = true;
      card.hexInput.value = card.primaryColor();
      card.syncSwatches();
      card.render();
    };
    card.hexInput.addEventListener("change", applyHex);
    card.hexInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyHex();
      }
    });
    card.colorGroup.append(card.hexInput);

    card.paletteSelect = el("select", {
      class: "chart-picker chart-picker-small chart-palette-select",
      "aria-label": "Colour map",
      title: "Colour map for multi-series and multi-category charts",
    }) as HTMLSelectElement;
    card.fillPaletteOptions(false);
    card.paletteSelect.value = card.config.palette ?? DEFAULT_PALETTE;
    card.paletteSelect.addEventListener("change", () => {
      if (card.paletteSelect.value === MORE_PALETTES) {
        // Seven colour maps cover most charts; the whole list opens on request.
        card.fillPaletteOptions(true);
        card.paletteSelect.value = card.rampPaletteName();
        try {
          card.paletteSelect.showPicker?.();
        } catch {
          // Opening the list for the person is a courtesy; a click does the same.
        }
        return;
      }
      void card.applyPalette(card.paletteSelect.value);
    });

    card.palettePreview = el("div", { class: "chart-palette-preview" });
    card.paletteReverseInput = el("input", {
      type: "checkbox",
      "aria-label": "Reverse the colour map",
    }) as HTMLInputElement;
    card.paletteReverseInput.checked = card.config.paletteReversed === true;
    card.paletteReverseInput.addEventListener("change", () => {
      card.config.paletteReversed = card.paletteReverseInput.checked;
      card.hexInput.value = card.primaryColor();
      card.syncSwatches();
      card.syncPalette();
      card.render();
    });
    const reverseLabel = el("label", { class: "control check clean-check chart-check" }, [
      card.paletteReverseInput,
      "Reverse",
    ]);
    reverseLabel.title = "Flip the colour map direction (works for ramps and series order)";
    card.colorMinInput = el("input", {
      class: "text-input chart-color-bound",
      type: "number",
      step: "any",
      placeholder: "Auto",
      "aria-label": "Colour scale minimum",
    }) as HTMLInputElement;
    card.colorMaxInput = el("input", {
      class: "text-input chart-color-bound",
      type: "number",
      step: "any",
      placeholder: "Auto",
      "aria-label": "Colour scale maximum",
    }) as HTMLInputElement;
    card.colorCenterInput = el("input", {
      class: "text-input chart-color-bound",
      type: "number",
      step: "any",
      placeholder: "Auto",
      "aria-label": "Colour scale centre",
    }) as HTMLInputElement;
    const applyColorDomain = (): void => {
      const min =
        card.colorMinInput.value.trim() === ""
          ? null
          : parseChartNumber(card.colorMinInput.value);
      const max =
        card.colorMaxInput.value.trim() === ""
          ? null
          : parseChartNumber(card.colorMaxInput.value);
      const center =
        card.colorCenterInput.value.trim() === ""
          ? null
          : parseChartNumber(card.colorCenterInput.value);
      if (min !== null && max !== null && !(max > min)) {
        card.paletteStatus.textContent = "Colour max must be greater than min";
        return;
      }
      card.config.colorMin = min;
      card.config.colorMax = max;
      card.config.colorCenter = center;
      card.paletteStatus.textContent = "";
      card.render();
    };
    card.colorMinInput.addEventListener("change", applyColorDomain);
    card.colorMaxInput.addEventListener("change", applyColorDomain);
    card.colorCenterInput.addEventListener("change", applyColorDomain);
    card.colorDomainRow = el("div", { class: "chart-color-domain" }, [
      el("label", { class: "chart-tag" }, [
        el("span", { class: "chart-tag-label" }, ["Min"]),
        card.colorMinInput,
      ]),
      el("label", { class: "chart-tag" }, [
        el("span", { class: "chart-tag-label" }, ["Max"]),
        card.colorMaxInput,
      ]),
      el("label", { class: "chart-tag", title: "Centre for diverging scales; ignored when outside Min/Max" }, [
        el("span", { class: "chart-tag-label" }, ["Centre"]),
        card.colorCenterInput,
      ]),
    ]);
    card.paletteStatus = el("span", { class: "chart-palette-status" });
    card.paletteGroup = el(
      "div",
      { class: "chart-palette" },
      [
        card.paletteSelect,
        card.palettePreview,
        reverseLabel,
        card.colorDomainRow,
        card.paletteStatus,
      ],
    );
    card.syncPalette();

    card.titleInput = el("input", {
      class: "text-input chart-title",
      type: "text",
      placeholder: "Chart title (optional)",
      spellcheck: "false",
      "aria-label": "Chart title",
    }) as HTMLInputElement;
    card.titleInput.value = card.config.title;
    card.titleInput.addEventListener("input", () => {
      card.config.title = card.titleInput.value;
      card.render();
      card.options.onTitleChange?.(card);
    });
    const axisTitleInput = (
      label: string,
      get: () => string | undefined,
      set: (value: string) => void,
    ): HTMLInputElement => {
      const input = el("input", {
        class: "text-input chart-axis-title",
        type: "text",
        placeholder: label,
        spellcheck: "false",
        "aria-label": label,
        title: label,
      }) as HTMLInputElement;
      input.value = get() ?? "";
      input.addEventListener("input", () => {
        set(input.value.trim());
        card.render();
      });
      return input;
    };
    card.xTitleInput = axisTitleInput(
      "X axis title (auto)",
      () => card.config.xTitle,
      (value) => {
        card.config.xTitle = value;
      },
    );
    card.yTitleInput = axisTitleInput(
      "Y axis title (auto)",
      () => card.config.yTitle,
      (value) => {
        card.config.yTitle = value;
      },
    );
    card.yUnitInput = axisTitleInput(
      "Unit, e.g. kWh",
      () => card.config.yUnit,
      (value) => {
        card.config.yUnit = value;
      },
    );
}
