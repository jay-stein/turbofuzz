/**
 * The settings panel: filling and showing each control for the chart type, the colour map, the sections, the source and pivot pickers, and the docked layout.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import { readGroupOpen, writeGroupOpen, type SettingsGroup } from "./chart-card-parts.js";
import { CUSTOM_PALETTE, isRampPalette, PALETTES, parseCustomColors } from "../data/palettes.js";
import { TYPE_LABELS } from "../types.js";
import { fieldsFor } from "./chart-registry.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { sourceOption, formatChartNumber, describeStep, isCategoryType, isGroupable, isIdLikeColumn, isNumericType, isPairKind, SPLIT_KINDS, VALUE_AGGREGATE_KINDS } from "./chart-utils.js";
import { clear, el } from "./dom.js";
import { openPrompt } from "./dialog.js";
import type { ChartCard } from "./chart-card.js";
import type { ChartCardConfig } from "./chart-card.js";
import { MAX_VALUES, SHORT_PALETTES, MORE_PALETTES } from "./chart-card.js";

/**
 * The settings panel in three parts. What every chart needs stays in view: its type, its fields
 * and how they are added up. Refine (calculations, missing periods, top N, a chart's own filter,
 * reference lines) and Format (titles and colours) are one click away and stay as the person
 * left them, on every chart.
 */
// Only one card's Settings popover may stay open at a time.
let openSettingsDisclosure: HTMLDetailsElement | null = null;

/** A card going away lets go of the popover it had open. */
export function forgetSettingsDisclosure(disclosure: HTMLDetailsElement | null): void {
  if (openSettingsDisclosure === disclosure) openSettingsDisclosure = null;
}

export function groupSettings(card: ChartCard): void {
  const group = (key: SettingsGroup, title: string, hint: string, children: (Element | null)[]): HTMLDetailsElement => {
    const details = el("details", { class: "chart-side-group", "data-group": key }) as HTMLDetailsElement;
    details.append(
      el("summary", { class: "chart-side-group-title" }, [
        el("span", { class: "chart-side-group-name" }, [title]),
        el("span", { class: "chart-side-group-hint" }, [hint]),
      ]),
      ...children.filter((child): child is Element => child !== null),
    );
    details.open = readGroupOpen(key);
    details.addEventListener("toggle", () => writeGroupOpen(key, details.open));
    card.settingsGroups.push(details);
    return details;
  };
  const settings = card.sidebar.querySelector(".chart-side-settings");
  settings?.querySelector(".chart-side-title")?.remove();
  const refine = group("refine", "Refine", "calculations, top N, filter, reference lines", [
    el("div", { class: "chart-side-section" }, [
      card.valueCalcWrap,
      card.valueEveryWrap,
      card.valueFillWrap,
      card.weekStartWrap,
      card.fiscalWrap,
    ]),
    el("div", { class: "chart-side-section chart-side-refine" }, [
      card.barSettings,
      card.histogramSettings,
      card.chartFilterRow,
      card.errorBarRow,
      card.correlationSettings,
    ]),
    card.sidebar.querySelector(".chart-side-map"),
    card.sidebar.querySelector(".chart-side-ref"),
  ]);
  const format = group("format", "Format", "titles and colours", [settings]);
  card.sidebar.append(refine, format);
}

/**
 * The Chart page's arrangement of the same controls: one headline above the plot, and every
 * setting in one panel beside it, so the plot is never covered while it is being changed.
 */
export function dock(card: ChartCard, head: HTMLElement, quickRow: HTMLElement, sideHead: HTMLElement, canvasWrap: HTMLElement): void {
  card.root.classList.add("chart-card-docked");
  card.layoutEl.classList.add("docked");
  sideHead.remove();
  card.sourceChip.addEventListener("click", () => {
    if (card.config.source !== "") card.options.onOpenSource?.(card.config.source);
  });
  head.prepend(el("div", { class: "chart-headline" }, [card.summaryEl, card.scopeEl, card.sourceChip]));
  card.undoButton = el(
    "button",
    { class: "ghost small chart-undo-btn", type: "button", title: "Undo the last change to this chart (Ctrl+Z)", "aria-label": "Undo the last change to this chart", disabled: "disabled" },
    ["Undo"],
  ) as HTMLButtonElement;
  card.undoButton.addEventListener("click", () => card.undo());
  head.insertBefore(card.undoButton, card.focusButton);
  head.append(card.sidebarToggle);

  // The one chart-type control: a button naming the type, opening the pictures.
  card.kindSelect.hidden = true;
  card.kindButton = el("button", { class: "chart-kind-button", type: "button", "aria-haspopup": "dialog", "aria-label": "Chart type" }) as HTMLButtonElement;
  card.kindButton.addEventListener("click", () => card.openKindPicker());
  card.kindSelect.after(card.kindButton);
  card.syncKindButton();

  // Rolled-up values, map layers and dot sizing join the rest of the settings.
  const valueSection = card.valueWrap.parentElement;
  if (valueSection !== null) valueSection.after(el("div", { class: "chart-side-section" }, [quickRow]));
  const colours = card.sidebar.querySelector(".chart-side-settings");
  card.sidebar.insertBefore(el("div", { class: "chart-side-section chart-side-map" }, [card.bubbleSettings, card.dotSettings]), colours);
  card.sidebar.insertBefore(el("div", { class: "chart-side-section chart-side-ref" }, [card.refSection]), colours);
  if (card.options.sectionedSettings === true) {
    card.groupSettings();
    card.noteEl.after(card.dataDrawer.root);
  }

  card.selectionBar = el("div", { class: "chart-selection hidden", role: "group", "aria-label": "Selected in the chart" });
  canvasWrap.append(card.selectionBar);

  for (const type of ["pointerdown", "focusin"] as const) {
    card.root.addEventListener(type, () => card.noteBeforeChange(), true);
  }
  card.root.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement && (target.type === "text" || target.type === "number"))) card.noteBeforeChange();
  }, true);
  for (const type of ["change", "click"] as const) {
    card.root.addEventListener(type, () => card.noteAfterChange());
  }
  card.setSettingsOpen(card.options.settingsOpen ?? true);
}

/** Where this column can go on this chart. `empty`: the place has no field yet, so taking it replaces nothing. */
export function fieldSlots(card: ChartCard, column: number): { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[] {
  const value = String(column);
  const out: { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[] = [];
  for (const { label, select } of card.fieldControls()) {
    const option = [...select.options].find((candidate) => candidate.value === value);
    if (option === undefined || option.disabled) continue;
    // Offer the places a field suits: a list's "Other" group and a Value of text are there for the rare case, in the panel.
    if ((option.parentElement as HTMLOptGroupElement | null)?.label === "Other") continue;
    if (select === card.valueSelect && !isNumericType(card.meta(column)?.type ?? "string")) continue;
    const clearable = [...select.options].some((candidate) => candidate.value === "-1");
    out.push({
      label,
      active: select.value === value,
      clearable,
      empty: Number(select.value) < 0,
      toggle: () => {
        card.noteBeforeChange();
        select.value = select.value === value ? "-1" : value;
        const view = select.ownerDocument.defaultView as (Window & typeof globalThis) | null;
        select.dispatchEvent(new (view?.Event ?? Event)("change", { bubbles: true }));
      },
    });
  }
  if (card.allowsExtraValues() && column !== card.config.valueColumn && isNumericType(card.meta(column)?.type ?? "string")) {
    const active = card.extraValues().includes(column);
    if (active || card.extraValues().length < MAX_VALUES - 1) {
      out.push({ label: "Another value", active, clearable: true, empty: true, toggle: () => card.toggleExtraValue(column) });
    }
  }
  return out;
}

export function toggleSidebar(card: ChartCard): void {
  if (card.options.docked === true) {
    const open = !card.sidebarShown;
    card.setSettingsOpen(open);
    card.options.onSettingsToggle?.(open);
    requestAnimationFrame(() => card.render());
    return;
  }
  card.sidebarShown = !card.sidebarShown;
  if (card.sidebarShown) document.addEventListener("keydown", card.onDrawerEscape);
  else document.removeEventListener("keydown", card.onDrawerEscape);
  card.layoutEl.classList.toggle("sidebar-open", card.sidebarShown);
  card.layoutEl.classList.toggle("sidebar-collapsed", !card.sidebarShown);
  card.sidebarToggle.setAttribute("aria-expanded", String(card.sidebarShown));
  card.sidebarToggle.textContent = card.sidebarShown ? "Done" : "Customize";
  card.sidebarToggle.setAttribute("aria-label", card.sidebarShown ? "Close the chart settings" : "Customize this chart");
  card.sidebarToggle.title = card.sidebarShown ? "Close the settings drawer (Escape)" : "Open the settings drawer: type, fields, colours";
  // The canvas width changes, so redraw at the new size.
  requestAnimationFrame(() => card.render());
}

/** One open Settings popover at a time; outside click or Escape dismisses it. */
export function syncSettingsOpen(card: ChartCard): void {
  const settings = card.settingsDisclosure;
  if (settings === null) return;
  if (settings.open) {
    if (openSettingsDisclosure !== null && openSettingsDisclosure !== settings) {
      openSettingsDisclosure.open = false;
    }
    openSettingsDisclosure = settings;
    card.bindSettingsDismiss(settings);
  } else {
    if (openSettingsDisclosure === settings) openSettingsDisclosure = null;
    card.unbindSettingsDismiss();
  }
}

export function bindSettingsDismiss(card: ChartCard, settings: HTMLDetailsElement): void {
  card.unbindSettingsDismiss();
  const onDocumentClick = (event: Event): void => {
    if (!settings.open) return;
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    if (
      target !== null &&
      typeof target.closest === "function" &&
      target.closest(".chart-settings-disclosure") === settings
    ) {
      return;
    }
    settings.open = false;
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !settings.open) return;
    settings.open = false;
    settings.querySelector<HTMLElement>("summary")?.focus();
  };
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKeydown);
  card.settingsDismiss = () => {
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onKeydown);
  };
}

export function renderSourceOptions(card: ChartCard): void {
  const current = card.config.source;
  card.sourceSelect.replaceChildren();
  const tableGroup = el("optgroup", { label: "Table data" });
  tableGroup.append(
    el("option", { value: "" }, [sourceOption("table", card.options.tableSourceLabel?.() ?? "Table (filtered)")]) as HTMLOptionElement,
  );
  card.sourceSelect.append(tableGroup);
  const pivots = card.sources.filter((source) => source.kind === "pivot");
  const views = card.sources.filter((source) => source.kind !== "pivot");
  if (pivots.length > 0) {
    const group = el("optgroup", { label: "Pivot views" });
    for (const source of pivots) {
      group.append(el("option", { value: source.id }, [sourceOption("view", source.name)]) as HTMLOptionElement);
    }
    card.sourceSelect.append(group);
  }
  if (views.length > 0) {
    const group = el("optgroup", { label: "Saved views" });
    for (const source of views) {
      group.append(el("option", { value: source.id }, [sourceOption("view", source.name)]) as HTMLOptionElement);
    }
    card.sourceSelect.append(group);
  }
  if (
    current !== "" &&
    card.sources.length > 0 &&
    !card.sources.some((source) => source.id === current)
  ) {
    card.config.source = "";
  }
  if (current !== "" && card.sources.length === 0) {
    // Views arrive after the card on a restore; keep the select from reading blank.
    card.sourceSelect.append(
      el("option", { value: current }, [sourceOption("view", card.config.title || "View")]) as HTMLOptionElement,
    );
  }
  card.sourceSelect.value = card.config.source;
}

/** A view-bound card hides the raw-column pickers; its type comes from the view. */
export function syncSourceControls(card: ChartCard): void {
  const bound = card.config.source !== "";
  const kind = card.config.kind;
  card.kindSelect.classList.toggle("hidden", bound);
  // A pivot with a Columns field can also be a heatmap, so its chart gets a choice; a plain view says what it is.
  const choice = bound && card.isPivotSource();
  card.kindStatic.classList.toggle("hidden", !bound || choice);
  card.viewKindSelect.classList.toggle("hidden", !choice);
  card.backToSource.classList.toggle("hidden", !bound || card.options.onOpenSource === undefined);
  const origin = bound ? card.sources.find((entry) => entry.id === card.config.source) : undefined;
  card.sourceChip.classList.toggle("hidden", origin === undefined || card.options.onOpenSource === undefined);
  if (origin !== undefined) card.sourceChip.textContent = `${origin.kind === "pivot" ? "Pivot" : "View"}: ${origin.name} \u2197`;
  card.syncViewShapeOptions();
  card.syncFieldVisibility();
  card.settingsBody.classList.toggle("hidden", bound ? false : !card.canDraw());
  const pivotMode = kind === "pivotHeatmap" && card.isPivotSource();
  card.pivotRowWrap.classList.toggle("hidden", !pivotMode);
  card.pivotColWrap.classList.toggle("hidden", !pivotMode);
  card.pivotMeasureWrap.classList.toggle("hidden", !pivotMode);
}

/**
 * Which field and aggregate pickers this chart shows: the one place that decides, for every
 * chart type and for charts of a Pivot View (which hide the raw-column pickers). Everything
 * that changes the type, the source, the value or the columns calls this.
 */
export function syncFieldVisibility(card: ChartCard): void {
  const bound = card.config.source !== "";
  const kind = card.config.kind;
  const pair = isPairKind(kind);
  const groupable = card.columns.some((meta) => isGroupable(meta));
  const measureKinds = VALUE_AGGREGATE_KINDS.includes(kind) || kind === "treemap";
  const grainKinds =
    kind === "line" ||
    kind === "smallmultiples" ||
    ((kind === "kpi" || kind === "slopegraph" || kind === "waterfall") &&
      card.isDateLike(card.meta(card.config.column)));
  const valueOn =
    measureKinds && card.config.source === "" && (card.config.valueColumn ?? -1) >= 0;
  const kpiPrimaryHidden =
    kind === "kpi" && !card.columns.some((meta) => card.isDateLike(meta));
  const groupedValue =
    valueOn && SPLIT_KINDS.includes(kind);
  card.primaryWrap.classList.toggle(
    "hidden",
    bound || pair || kind === "correlation" || kpiPrimaryHidden,
  );
  card.groupWrap.classList.toggle(
    "hidden",
    bound ||
    (!SPLIT_KINDS.includes(kind) && kind !== "histogram" && kind !== "bubble") ||
      !groupable ||
      (valueOn && !groupedValue),
  );
  card.valueWrap.classList.toggle("hidden", bound || !measureKinds);
  card.valueAggWrap.classList.toggle("hidden", bound || !measureKinds || !valueOn);
  card.valueGrainWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn);
  card.valueEveryWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn || !card.hasExplicitGrain());
  card.valueFillWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn);
  card.weekStartWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn || card.resolvedGrain() !== "week");
  card.fiscalWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn || (card.resolvedGrain() !== "quarter" && card.resolvedGrain() !== "year"));
  card.valueCalcWrap.classList.toggle("hidden", bound || !valueOn || kind === "treemap");
  card.syncExtraValues();
  // Regions matched by name need no coordinates, so a map of them hides X and Y too.
  const noAxes = bound || !pair || (card.regionsOn() && card.regions?.usesCoordinates !== true);
  card.xWrap.classList.toggle("hidden", noAxes);
  card.yWrap.classList.toggle("hidden", noAxes);
  card.axesPanel.classList.toggle("hidden", bound || kind === "correlation");
}

/** Adds or removes a column as another value; a chart with several values is not also split by a field. */
export function toggleExtraValue(card: ChartCard, column: number): void {
  const current = card.config.extraValueColumns ?? [];
  card.noteBeforeChange();
  card.config.extraValueColumns = current.includes(column)
    ? current.filter((other) => other !== column)
    : [...current, column].slice(0, MAX_VALUES - 1);
  card.hiddenSplit.clear();
  card.generation++;
  card.renderControls();
  card.refreshValue();
  card.render();
  card.noteAfterChange();
}

/** The values drawn beside Value, each with a remove button, and a list to add another. */
export function syncExtraValues(card: ChartCard): void {
  const allowed = card.allowsExtraValues();
  const extras = card.extraValues();
  const numeric = card.columns
    .map((meta, index) => ({ meta, index }))
    .filter(({ meta, index }) => isNumericType(meta.type) && meta.role !== "provenance" && index !== card.config.valueColumn && !extras.includes(index));
  const key = `${allowed}|${extras.join(",")}|${numeric.map(({ index }) => index).join(",")}`;
  card.extraValuesWrap.classList.toggle("hidden", !allowed || (extras.length === 0 && numeric.length === 0));
  if (key === card.extraValuesKey) return;
  card.extraValuesKey = key;
  const rows = extras.map((column) => {
    const name = card.meta(column)?.name ?? "value";
    const remove = el("button", { class: "icon-btn chart-extra-remove", type: "button", title: `Stop drawing ${name}`, "aria-label": `Remove ${name}` }, ["\u00d7"]);
    remove.addEventListener("click", () => card.toggleExtraValue(column));
    return el("div", { class: "chart-extra-value" }, [el("span", { class: "chart-extra-name" }, [name]), remove]);
  });
  const add = el("select", { class: "chart-picker chart-picker-small chart-extra-add", "aria-label": "Add another value" }) as HTMLSelectElement;
  add.append(el("option", { value: "" }, ["+ Add another value\u2026"]) as HTMLOptionElement);
  for (const { meta, index } of numeric) add.append(el("option", { value: String(index) }, [meta.name]) as HTMLOptionElement);
  add.disabled = extras.length >= MAX_VALUES - 1 || numeric.length === 0;
  add.addEventListener("change", () => {
    if (add.value !== "") card.toggleExtraValue(Number(add.value));
  });
  card.extraValuesWrap.replaceChildren(...rows, add);
}

/** Puts a pivot field on the axis, as the series, or as the value. */
export function setViewShape(card: ChartCard, key: "viewAxis" | "viewSeries" | "viewMeasure", value: number): void {
  card.noteBeforeChange();
  // Fields the chart had not fixed yet stay as the pivot lays them out.
  const shape = card.viewShape();
  if (shape !== null) {
    card.config.viewAxis ??= shape.axis;
    card.config.viewSeries ??= shape.series;
    card.config.viewMeasure ??= shape.measure;
  }
  card.config[key] = value;
  // The axis cannot also be the series: taking a field for one frees the other.
  if (key === "viewAxis" && card.config.viewSeries === card.config.viewAxis) card.config.viewSeries = -1;
  card.hiddenSplit.clear();
  card.syncViewShapeOptions();
  card.renderControls();
  card.refreshView();
}

/**
 * The fields of the pivot this chart draws, for the field list to show in place of the table's
 * columns: what each is on the chart, and the places it could go. Null for a chart of the table.
 */
export function pivotRailItems(card: ChartCard): {
    name: string;
    glyph: string;
    role: string;
    slots: { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[];
  }[] | null {
  const fields = card.viewFields();
  const shape = card.viewShape();
  if (fields === null || shape === null) return null;
  const live = card.config.kind !== "pivotHeatmap";
  const dimensions = fields.dimensions.map((field, index) => {
    const slots: { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[] = [];
    if (live) {
      slots.push({ label: "Axis", active: shape.axis === index, clearable: false, empty: false, toggle: () => card.setViewShape("viewAxis", index) });
      // The axis field cannot also split the series, so it offers the axis only.
      if (shape.axis !== index) {
        slots.push({
          label: "Series",
          active: shape.series === index,
          clearable: true,
          empty: shape.series < 0,
          toggle: () => card.setViewShape("viewSeries", shape.series === index ? -1 : index),
        });
      }
    }
    const role = shape.axis === index ? "Axis" : shape.series === index ? "Series" : "";
    return { name: field.name, glyph: field.time ? "T" : "C", role: live ? role : "", slots };
  });
  const measures = fields.measures.map((name, index) => ({
    name,
    glyph: "#",
    role: live && shape.measure === index ? "Value" : "",
    slots: live ? [{ label: "Value", active: shape.measure === index, clearable: false, empty: false, toggle: () => card.setViewShape("viewMeasure", index) }] : [],
  }));
  return [...dimensions, ...measures];
}

/** Fills the Axis, Series and Value pickers from the pivot's fields and shows the ones with a choice to make. */
export function syncViewShapeOptions(card: ChartCard): void {
  const fields = card.viewFields();
  const shape = card.viewShape();
  const on = fields !== null && shape !== null && card.config.kind !== "pivotHeatmap";
  card.viewAxisWrap.classList.toggle("hidden", !on || fields.dimensions.length < 2);
  card.viewSeriesWrap.classList.toggle("hidden", !on || fields.dimensions.length < 2);
  card.viewMeasureWrap.classList.toggle("hidden", !on || fields.measures.length < 2);
  if (card.isPivotSource()) {
    const lines = shape !== null && fields?.dimensions[shape.axis]?.time === true;
    card.viewKindSelect.replaceChildren(
      el("option", { value: "bar" }, [lines ? "Lines" : "Bars"]) as HTMLOptionElement,
      el("option", { value: "pivotHeatmap" }, ["Heatmap"]) as HTMLOptionElement,
    );
    card.viewKindSelect.value = card.config.kind === "pivotHeatmap" ? "pivotHeatmap" : "bar";
  }
  if (!on) return;
  const zone = (index: number): string => (fields.dimensions[index]?.zone === "columns" ? "Columns" : "Rows");
  const option = (index: number): HTMLOptionElement =>
    el("option", { value: String(index) }, [`${fields.dimensions[index]?.name ?? ""} (${zone(index)})`]) as HTMLOptionElement;
  card.viewAxisSelect.replaceChildren(...fields.dimensions.map((_, index) => option(index)));
  card.viewAxisSelect.value = String(shape.axis);
  card.viewSeriesSelect.replaceChildren(
    el("option", { value: "-1" }, ["None"]) as HTMLOptionElement,
    ...fields.dimensions.map((_, index) => index).filter((index) => index !== shape.axis).map(option),
  );
  card.viewSeriesSelect.value = String(shape.series);
  card.viewMeasureSelect.replaceChildren(
    ...fields.measures.map((name, index) => el("option", { value: String(index) }, [name]) as HTMLOptionElement),
  );
  card.viewMeasureSelect.value = String(shape.measure);
}

/** Levels and measures exposed by the bound pivot result. */
export function syncPivotOptions(card: ChartCard): void {
  const pivot = card.pivotResult;
  if (pivot === null) return;
  const fill = (
    select: HTMLSelectElement,
    labels: string[],
    selected: number | undefined,
  ): void => {
    select.replaceChildren();
    labels.forEach((label, index) => {
      select.append(
        el("option", { value: String(index) }, [
          label || `Level ${index + 1}`,
        ]) as HTMLOptionElement,
      );
    });
    const value = Math.max(
      0,
      Math.min(labels.length - 1, selected ?? labels.length - 1),
    );
    select.value = String(value);
  };
  fill(card.pivotRowSelect, pivot.rowNames, card.config.pivotRowLevel);
  fill(card.pivotColSelect, pivot.colNames, card.config.pivotColLevel);
  fill(
    card.pivotMeasureSelect,
    pivot.measures.map((measure) => measure.name),
    card.config.pivotMeasure,
  );
  card.config.pivotRowLevel = Number(card.pivotRowSelect.value);
  card.config.pivotColLevel = Number(card.pivotColSelect.value);
  card.config.pivotMeasure = Number(card.pivotMeasureSelect.value);
}

export function allowsPrimary(card: ChartCard, meta: ColumnMeta): boolean {
  switch (card.config.kind) {
    case "histogram":
      return isNumericType(meta.type) || meta.type === "time" || meta.type === "duration";
    case "line":
      return meta.type === "date" || meta.type === "datetime";
    case "kpi":
      // The primary column is the KPI's optional date axis.
      return meta.type === "date" || meta.type === "datetime";
    case "bar":
    case "barplot":
    case "dotplot":
    case "stacked100":
      return isGroupable(meta);
    case "smallmultiples":
      return meta.type === "date" || meta.type === "datetime";
    case "slopegraph":
    case "waterfall":
      return isGroupable(meta) || meta.type === "date" || meta.type === "datetime";
    case "treemap":
      if (meta.role === "provenance") return false;
      return (
        isGroupable(meta) ||
        (meta.type === "string" && !isIdLikeColumn(meta, card.rowCount))
      );
    case "terms":
      return meta.type === "string";
    default:
      return false;
  }
}

export function syncValueAggOptions(card: ChartCard): void {
  const meta = card.meta(card.config.valueColumn ?? -1);
  const options: [NonNullable<ChartCardConfig["valueAgg"]>, string][] =
    meta === undefined
      ? [["mean", "Average (mean)"], ["sum", "Sum"]]
      : meta.type === "boolean"
        ? [
            ["true", "True count"],
            ["false", "False count"],
            ["truePct", "True % of rows"],
            ["missing", "Missing count"],
            ["count", "Count of values"],
            ["distinct", "Distinct values"],
            ["mode", "Mode"],
          ]
        : meta.type === "date" || meta.type === "datetime"
          ? [
              ["min", "Earliest"],
              ["max", "Latest"],
              ["count", "Count of values"],
              ["distinct", "Distinct values"],
              ["mode", "Mode"],
              ["first", "First (by row order)"],
              ["last", "Last (by row order)"],
            ]
          : meta.type === "category" || meta.type === "string" || meta.type === "identifier"
            ? [
                ["count", "Count of values"],
                ["distinct", "Distinct values"],
                ["mode", "Mode"],
              ]
            : [
                ["mean", "Average (mean)"],
                ["sum", "Sum"],
                ["median", "Median"],
                ["min", "Min"],
                ["max", "Max"],
                ["stddev", "Std deviation"],
                ["variance", "Variance"],
                ["p25", "25th percentile"],
                ["p75", "75th percentile"],
                ["p90", "90th percentile"],
                ["p95", "95th percentile"],
                ["count", "Count of values"],
                ["distinct", "Distinct values"],
                ["first", "First (by row order)"],
                ["last", "Last (by row order)"],
                ["mode", "Mode"],
              ];
  const current = card.config.valueAgg ?? options[0]?.[0];
  card.valueAggSelect.replaceChildren();
  for (const [value, label] of options) {
    card.valueAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
  }
  const selected = options.some(([value]) => value === current) ? current : options[0]?.[0];
  if (selected !== undefined) {
    card.valueAggSelect.value = selected;
    card.config.valueAgg = selected;
  }
}

export function syncOptions(card: ChartCard): void {
  if (card.columns.length === 0) return;
  const signature = `${card.config.kind}|${card.columns
    .map((meta, index) => `${index}:${meta.type}:${meta.name}`)
    .join("|")}`;
  if (signature === card.pickerSignature) return;
  card.pickerSignature = signature;
  card.kindSelect.value = card.config.kind;

  const primary = card.allowedIndexes((meta) => card.allowsPrimary(meta));
  if (!primary.includes(card.config.column)) card.config.column = primary[0] ?? -1;
  card.fillColumnSelect(card.primarySelect, primary, card.config.kind === "kpi" ? 1 : 0);
  if (primary.length === 0) {
    const placeholder = card.option("-1", "No matching column");
    placeholder.disabled = true;
    card.primarySelect.append(placeholder);
  }
  if (card.config.column >= 0) card.primarySelect.value = String(card.config.column);

  const groupable = card.allowedIndexes((meta) => isGroupable(meta));
  if (!groupable.includes(card.config.groupColumn)) card.config.groupColumn = -1;
  card.fillColumnSelect(card.groupSelect, groupable, 2, [card.option("-1", "None")]);
  card.groupSelect.value = String(card.config.groupColumn);

  const valueAllowed = card.allowedIndexes(
    (meta) =>
      meta.role !== "provenance" &&
      (card.config.kind !== "treemap" ||
        isNumericType(meta.type) ||
        meta.type === "duration"),
  );
  if (
    card.config.valueColumn !== undefined &&
    card.config.valueColumn >= 0 &&
    !valueAllowed.includes(card.config.valueColumn)
  ) {
    card.config.valueColumn = -1;
  }
  card.valueSelect.replaceChildren(card.option("-1", "Count of rows"));
  valueAllowed.forEach((index) => {
    const meta = card.columns[index];
    card.valueSelect.append(
      card.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`),
    );
  });
  if ((card.config.valueColumn ?? -1) >= 0) {
    card.valueSelect.value = String(card.config.valueColumn);
  }
  card.syncValueAggOptions();
  card.valueGrainSelect.value = card.config.valueGrain ?? "auto";
  card.valueEveryInput.value = String(card.config.valueEvery ?? 1);
  card.valueFillSelect.value = card.config.valueFill ?? "auto";
  card.weekStartSelect.value = String(card.config.valueWeekStart ?? 1);
  card.fiscalSelect.value = String(card.config.valueFiscalStart ?? 1);
  // Say what "Auto" currently means, and offer only grains the column can support.
  const dateOnly = card.meta(card.config.column)?.type === "date";
  const autoOption = card.valueGrainSelect.options[0];
  if (autoOption !== undefined) {
    const auto = card.defaultStepFor(card.config.column);
    autoOption.textContent = `Auto (${describeStep(auto.grain, auto.every)})`;
  }
  for (const option of Array.from(card.valueGrainSelect.options)) {
    option.hidden = dateOnly && (option.value === "minute" || option.value === "hour" || option.value === "second");
  }
  card.valueCalcSelect.value = card.config.valueCalc ?? "";
  card.barStackInput.checked = (card.config.barLayout ?? "group") === "stack";

  const xAllowed = card.allowedIndexes((meta) => card.allowsX(meta));
  const yAllowed = card.allowedIndexes((meta) => card.allowsY(meta));
  // The Map page's map with no coordinate columns stays empty (basemap and markers only).
  const keepEmpty = card.options.keepEmptyMap === true && card.config.kind === "map" && card.config.x === -1 && card.config.y === -1;
  if (!keepEmpty && !xAllowed.includes(card.config.x)) card.config.x = xAllowed[0] ?? -1;
  if (!keepEmpty && (!yAllowed.includes(card.config.y) || (card.config.y === card.config.x && yAllowed.length > 1))) {
    card.config.y = yAllowed.find((index) => index !== card.config.x) ?? yAllowed[0] ?? -1;
  }
  for (const [select, allowed, selected] of [
    [card.xSelect, xAllowed, card.config.x],
    [card.ySelect, yAllowed, card.config.y],
  ] as const) {
    card.fillColumnSelect(select, allowed, select === card.xSelect ? 0 : 1);
    if (allowed.length === 0) {
      const placeholder = card.option("-1", "No numeric column");
      placeholder.disabled = true;
      select.append(placeholder);
    } else if (selected >= 0) {
      select.value = String(selected);
    }
  }

  card.colorSelect.replaceChildren(card.option("-1", "None"));
  card.sizeSelect.replaceChildren(card.option("-1", "None"));
  card.columns.forEach((meta, index) => {
    card.colorSelect.append(card.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`));
    if (isNumericType(meta.type)) {
      card.sizeSelect.append(card.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`));
    }
  });
  if (card.config.colorColumn < 0 || card.config.colorColumn >= card.columns.length) {
    card.config.colorColumn = -1;
  }
  if (card.config.sizeColumn < 0 || card.config.sizeColumn >= card.columns.length) {
    card.config.sizeColumn = -1;
  }
  card.colorSelect.value = String(card.config.colorColumn);
  card.sizeSelect.value = String(card.config.sizeColumn);
  const sizeNone = card.sizeSelect.options[0];
  if (sizeNone !== undefined) {
    sizeNone.textContent =
      card.config.kind === "treemap" || card.config.kind === "bubble"
        ? "Count (rows)"
        : "None";
  }
  // "Auto" is retired: older charts that had it draw points, the plain default.
  card.modeSelect.value = card.config.mode === "auto" ? "points" : card.config.mode;
  card.densityStyleSelect.value = card.config.densityStyle;

  const numeric = card.allowedIndexes((meta) => isNumericType(meta.type));
  card.config.correlationColumns = card.config.correlationColumns.filter((index) =>
    numeric.includes(index),
  );
  if (card.config.kind === "correlation" && card.config.correlationColumns.length < 2) {
    card.config.correlationColumns = numeric.slice(0, 6);
  }
  card.correlationSelect.replaceChildren();
  numeric.forEach((index) => {
    const meta = card.columns[index];
    const option = card.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`);
    option.selected = card.config.correlationColumns.includes(index);
    card.correlationSelect.append(option);
  });
  card.syncAnimationOptions();
  card.syncChartFilterControls();
  card.sortSelect.value = card.config.chartSort ?? "none";
  card.sortWrap.classList.toggle(
    "hidden",
    !card.usesAggregate() || card.config.kind === "pivotHeatmap" || card.config.kind === "kpi",
  );
  card.syncSummary();
}

/** Category filter choices for this chart, plus its table-filter scope. */
export function syncChartFilterControls(card: ChartCard): void {
  const categoryIndexes = card.allowedIndexes((meta) => isGroupable(meta));
  let column = card.config.filterColumn ?? -1;
  if (!categoryIndexes.includes(column)) column = -1;
  card.config.filterColumn = column;
  card.filterColumnSelect.replaceChildren(card.option("-1", "No chart filter"));
  for (const index of categoryIndexes) {
    card.filterColumnSelect.append(card.option(String(index), card.columns[index].name));
  }
  card.filterColumnSelect.value = String(column);

  card.filterValueSelect.replaceChildren();
  const labels = column >= 0 ? (card.meta(column)?.categories?.labels ?? []) : [];
  labels.forEach((label, code) => {
    card.filterValueSelect.append(card.option(String(code), label || "(empty)"));
  });
  let code = card.config.filterCode ?? -1;
  if (column < 0 || code < 0 || code >= labels.length) code = labels.length > 0 ? 0 : -1;
  card.config.filterCode = code;
  if (code >= 0) card.filterValueSelect.value = String(code);
  card.filterValueSelect.disabled = column < 0;
  card.filterRespectInput.checked = card.config.respectFilters !== false;
  const aggregateBacked =
    card.usesValueAggregate() ||
    card.config.kind === "treemap" ||
    card.regionsOn();
  card.chartFilterRow.classList.toggle("hidden", !aggregateBacked);
}

/**
 * Fills a column select from the registry: columns that suit the slot first,
 * the rest under "Other" with the reason as a tooltip. Nothing is hidden.
 */
export function fillColumnSelect(card: ChartCard, select: HTMLSelectElement, allowed: readonly number[], slotIndex: number, leading: HTMLOptionElement[] = []): void {
  const fields = fieldsFor(card.config.kind, slotIndex, card.columns, card.rowCount);
  const reasons = new Map(fields.other.map((entry) => [entry.index, entry.reason]));
  const suggested = allowed.filter((index) => !reasons.has(index));
  const other = allowed.filter((index) => reasons.has(index));
  const make = (index: number): HTMLOptionElement => {
    const meta = card.columns[index];
    const option = card.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`);
    const reason = reasons.get(index);
    if (reason !== undefined) option.title = reason;
    return option;
  };
  select.replaceChildren(...leading);
  if (suggested.length > 0 && other.length > 0) {
    const good = el("optgroup", { label: "Suggested" }) as HTMLOptGroupElement;
    good.append(...suggested.map(make));
    const rest = el("optgroup", { label: "Other" }) as HTMLOptGroupElement;
    rest.append(...other.map(make));
    select.append(good, rest);
  } else {
    select.append(...allowed.map(make));
  }
}

export function renderControls(card: ChartCard): void {
  const kind = card.config.kind;
  const pair = isPairKind(kind);
  card.syncFieldVisibility();
  card.primaryTagLabel.textContent =
    kind === "histogram"
      ? "Values"
      : kind === "line"
        ? "Date"
        : kind === "kpi"
          ? "Date (optional)"
          : kind === "treemap"
            ? "Group by"
            : kind === "bar" || kind === "barplot" || kind === "dotplot" || kind === "stacked100"
              ? "Category"
              : kind === "terms"
                ? "Text"
                : "Column";
  const valueLabel = card.valueWrap.querySelector<HTMLElement>(".chart-tag-label");
  if (valueLabel !== null) valueLabel.textContent = kind === "treemap" ? "Size by" : "Value";
  const groupable = card.columns.some((meta) => isGroupable(meta));
  const measureKinds = VALUE_AGGREGATE_KINDS.includes(kind) || kind === "treemap";
  const grainKinds =
    kind === "line" ||
    kind === "smallmultiples" ||
    ((kind === "kpi" || kind === "slopegraph" || kind === "waterfall") &&
      card.isDateLike(card.meta(card.config.column)));
  const valueOn =
    measureKinds && card.config.source === "" && (card.config.valueColumn ?? -1) >= 0;
  const groupedValue =
    valueOn && SPLIT_KINDS.includes(kind);
  const seriesKind = kind === "scatter" || kind === "density";
  const mapKind = kind === "map";
  card.mapModeWrap.classList.toggle("hidden", !mapKind || card.config.mapMode === "heat" || card.config.mapMode === "regions");
  card.regions?.root.classList.toggle("hidden", !card.regionsOn());
  card.regions?.setDropActive(mapKind);
  card.regions?.setLanding(card.regionsOn());
  card.syncRegionAxes();
  card.colorWrap.classList.toggle("hidden", (!seriesKind && !mapKind) || card.regionsOn());
  card.sizeTagLabel.textContent =
    mapKind && card.config.mapMode === "heat" ? "Measure" : "Size";
  card.sizeWrap.classList.toggle(
    "hidden",
    !seriesKind && kind !== "treemap" && kind !== "bubble" && (!mapKind || card.regionsOn()),
  );
  // The size column belongs to the visible Bubbles/Map row, not the Settings
  // drawer, so switching what drives the area is one obvious control.
  if (kind === "bubble" || mapKind) {
    card.bubbleSettings.insertBefore(card.sizeWrap, card.bubbleAggField);
  } else if (card.sizeWrap.parentElement !== card.settingsBody) {
    card.settingsBody.append(card.sizeWrap);
  }
  // Colour belongs next to Show/Measure on the map row; elsewhere it stays
  // in the Settings disclosure.
  if (mapKind) card.bubbleSettings.insertBefore(card.colorWrap, card.sizeWrap);
  else if (card.colorWrap.parentElement === card.bubbleSettings) {
    card.settingsBody.append(card.colorWrap);
  }
  const chartFilterable =
    (measureKinds && valueOn) ||
    kind === "treemap" ||
    kind === "heatmap" ||
    kind === "correlation" ||
    kind === "box" ||
    kind === "bubble" ||
    seriesKind ||
    mapKind;
  card.chartFilterRow.classList.toggle("hidden", !chartFilterable);
  card.modeWrap.classList.toggle("hidden", kind !== "scatter");
  card.densityStyleWrap.classList.toggle("hidden", !seriesKind);
  // Heat and contour lines belong to the density (heat map) render: with plain points they do nothing, so the control says so.
  const heatRender = kind === "density" || (kind === "scatter" && card.config.mode === "density");
  card.densityStyleSelect.disabled = !heatRender;
  card.densityStyleWrap.classList.toggle("disabled", !heatRender);
  card.densityStyleWrap.title = heatRender ? "" : "Only used when Render is set to Density (heat map)";
  card.colorGroup.classList.toggle("hidden", kind === "correlation");
  card.paletteGroup.classList.toggle("hidden", kind === "correlation");
  card.histogramSettings.classList.toggle("hidden", kind !== "histogram");
  card.syncErrorBarControls();
  card.barStackField.classList.toggle(
    "hidden",
    card.config.source !== ""
      ? kind === "pivotHeatmap" || (card.viewShape()?.series ?? -1) < 0
      : kind !== "barplot" || card.config.groupColumn < 0,
  );
  card.barSettings.classList.toggle(
    "hidden",
    kind !== "bar" &&
      kind !== "barplot" &&
      kind !== "box" &&
      kind !== "heatmap" &&
      kind !== "treemap" &&
      kind !== "bubble",
  );
  // Always there, so it can be found: grey says why it cannot run yet. Not truly disabled, or hover and focus could miss the reason.
  const animateBlock = card.animationBlock();
  card.animateButton.setAttribute("aria-disabled", String(animateBlock !== null));
  card.animateButton.title = animateBlock ?? "Step this chart through time";
  card.animateButton.classList.toggle("active", card.animationSetupOpen && animateBlock === null);
  card.animationSetup.classList.toggle("hidden", !(animateBlock === null && card.animationSetupOpen));
  const bubbleOnly = kind === "bubble";
  card.bubbleSettings.classList.toggle("hidden", !bubbleOnly && !mapKind);
  card.bubbleTitle.textContent = mapKind ? "Map" : "Bubbles";
  card.bubbleScaleField.classList.toggle("hidden", mapKind);
  if (card.config.mapMode !== "heat" && card.config.mapMode !== "regions") card.mapModeSelect.value = card.mapModeChoice();
  card.syncDotControls(mapKind, kind === "scatter");
  card.syncRefLines();
  card.syncKindButton();
  // On a map the grid only matters for the heat view: the plain dots need no cells.
  card.gridField.classList.toggle("hidden", mapKind && card.config.mapMode !== "heat");
  (card.gridField.firstElementChild as HTMLElement).textContent = mapKind ? "Heat cells" : "Grid";
  card.gridField.title = mapKind
    ? "Heat view only. The map is cut into this many cells across and down, and the rows in each cell are counted. Fewer cells (10 to 20): broad, smooth regions. More cells (80 to 120): fine detail, but each cell holds few rows so it looks patchy. 30 to 60 suits most data."
    : "Bubble view. The chart is cut into this many cells along each axis and the rows in each cell become one bubble. Fewer: bigger, smoother bubbles. More: finer, patchier.";
  card.bubbleBinsInput.title = mapKind
    ? "Heat cells across and down (4–120): fewer = coarse and smooth, more = fine and patchy"
    : "Bubble grid resolution per axis (4–120)";
  // Reduce stays visible so the option is discoverable; it only becomes
  // usable once a Size column is chosen.
  const reduceEnabled = card.config.sizeColumn >= 0;
  card.bubbleAggSelect.disabled = !reduceEnabled;
  card.bubbleAggField.title = reduceEnabled
    ? mapKind
      ? "How the rows in each grid cell or place combine into one value"
      : "How the rows in each area combine into one value"
    : "Pick a numeric column under Size first - then choose how rows combine";
  // Said on the page, not only in a tooltip: a greyed-out control with no reason reads as broken.
  card.bubbleAggHint.textContent = reduceEnabled ? "" : "(pick a Size column first)";
  if (!reduceEnabled) card.bubbleAggSelect.value = "count";
  card.topLabel.parentElement?.classList.toggle("hidden", bubbleOnly);
  card.multiInput.parentElement?.classList.toggle("hidden", bubbleOnly || kind === "barplot");
  card.correlationSettings.classList.toggle("hidden", kind !== "correlation");
  card.topLabel.textContent =
    kind === "bar" || kind === "barplot"
      ? "Top bars"
      : kind === "box"
        ? "Top groups"
        : kind === "treemap"
          ? "Top tiles"
          : "Top per axis";
  if (seriesKind) {
    card.xTagLabel.textContent = "X";
    card.yTagLabel.textContent = "Y";
  } else if (kind === "map") {
    card.xTagLabel.textContent = "Longitude";
    card.yTagLabel.textContent = "Latitude";
  } else if (kind === "box") {
    card.xTagLabel.textContent = "Value";
    card.yTagLabel.textContent = "Groups";
  } else if (kind === "heatmap") {
    card.xTagLabel.textContent = "Columns";
    card.yTagLabel.textContent = "Rows";
  }

  if (kind === "histogram") {
    const meta = card.meta(card.config.column);
    const histogram = meta?.histogram;
    const dataMin = meta?.stats.min ?? histogram?.min ?? 0;
    const dataMax = meta?.stats.max ?? histogram?.max ?? 1;
    if (card.config.binOptions !== null) {
      card.minInput.value = formatChartNumber(card.config.binOptions.min);
      card.maxInput.value = formatChartNumber(card.config.binOptions.max);
      card.binsInput.value = String(card.config.binOptions.binCount);
      card.overflowInput.checked = card.config.binOptions.overflow;
    }
    card.kdeInput.checked = card.config.kde;
    const p95Text =
      histogram !== undefined &&
      histogram !== null &&
      histogram.p95 > dataMin &&
      histogram.p95 < dataMax
        ? `; p95 ${formatChartNumber(histogram.p95)}`
        : "";
    card.minInput.title = `First bin starts here — data range ${formatChartNumber(dataMin)} – ${formatChartNumber(dataMax)}`;
    card.maxInput.title = card.config.binClipped
      ? `Last bin ends here — data range ${formatChartNumber(dataMin)} – ${formatChartNumber(dataMax)}${p95Text}; clipped to p95 because of extreme outliers — Full range restores the maximum`
      : `Last bin ends here — data range ${formatChartNumber(dataMin)} – ${formatChartNumber(dataMax)}${p95Text}`;
    card.maxInput.classList.toggle("clipped", card.config.binClipped);
  }

  // Settings that cannot apply while nothing can be drawn are hidden.
  card.settingsBody.classList.toggle("hidden", !card.canDraw() && !card.regionsOn());
}

/** The colour maps on offer: a short list, always with the one in use; every map once asked for. */
export function fillPaletteOptions(card: ChartCard, all: boolean): void {
  const current = card.rampPaletteName();
  const shown = (name: string): boolean => all || SHORT_PALETTES.includes(name) || name === current;
  card.paletteSelect.replaceChildren();
  const groups: [string, "qualitative" | "sequential" | "diverging"][] = [
    ["Qualitative", "qualitative"],
    ["Sequential", "sequential"],
    ["Diverging", "diverging"],
  ];
  for (const [label, kind] of groups) {
    const entries = PALETTES.filter((palette) => palette.kind === kind && shown(palette.name));
    if (entries.length === 0) continue;
    const group = el("optgroup", { label }) as HTMLOptGroupElement;
    for (const palette of entries) group.append(el("option", { value: palette.name }, [palette.name]) as HTMLOptionElement);
    card.paletteSelect.append(group);
  }
  if (!all) card.paletteSelect.append(el("option", { value: MORE_PALETTES }, ["More colour maps…"]) as HTMLOptionElement);
  card.paletteSelect.append(el("option", { value: CUSTOM_PALETTE }, ["Custom…"]) as HTMLOptionElement);
}

export function syncPalette(card: ChartCard): void {
  // A map chosen elsewhere (a spec, undo) that the short list leaves out joins it.
  if (![...card.paletteSelect.options].some((option) => option.value === card.rampPaletteName())) {
    card.fillPaletteOptions(false);
  }
  card.paletteSelect.value = card.rampPaletteName();
  card.paletteReverseInput.checked = card.config.paletteReversed === true;
  clear(card.palettePreview);
  for (const color of card.paletteColors(10)) {
    const dot = el("span", { class: "chart-palette-dot" });
    dot.style.background = color;
    card.palettePreview.append(dot);
  }
  const colorMeta = card.meta(card.config.colorColumn);
  const numericColor =
    colorMeta !== undefined &&
    card.config.colorColumn >= 0 &&
    !isCategoryType(colorMeta.type) &&
    colorMeta.type !== "boolean";
  const ramp =
    isRampPalette(card.rampPaletteName()) ||
    card.config.kind === "pivotHeatmap" ||
    numericColor;
  card.colorDomainRow.classList.toggle("hidden", !ramp);
  card.colorMinInput.value =
    card.config.colorMin === null || card.config.colorMin === undefined
      ? ""
      : String(card.config.colorMin);
  card.colorMaxInput.value =
    card.config.colorMax === null || card.config.colorMax === undefined
      ? ""
      : String(card.config.colorMax);
  card.colorCenterInput.value =
    card.config.colorCenter === null || card.config.colorCenter === undefined
      ? ""
      : String(card.config.colorCenter);
}

/** Loads a palette from JSON text: array of hex colours or {colors: [...]}. */
/** Picking Custom… asks for hex stops; invalid input keeps the old palette. */
export async function applyPalette(card: ChartCard, value: string): Promise<void> {
  if (value === CUSTOM_PALETTE) {
    const entered = await openPrompt({
      title: "Custom colour map",
      label: "Hex colours separated by commas (2 or more), e.g. #2563eb, #10b981, #f97316",
      value: card.config.paletteCustom ?? "",
      placeholder: "#2563eb, #f97316",
      confirmLabel: "Use colours",
    });
    if (entered === null) {
      card.syncPalette();
      return;
    }
    const parsed = parseCustomColors(entered);
    if (parsed.length < 2) {
      card.syncPalette();
      return;
    }
    card.config.palette = CUSTOM_PALETTE;
    card.config.paletteCustom = parsed.join(", ");
  } else {
    card.config.palette = value;
  }
  card.hexInput.value = card.primaryColor();
  card.syncSwatches();
  card.syncPalette();
  card.render();
}
