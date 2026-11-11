/**
 * Building the chart card's controls, part 3 of 3: the constructor's work, in the order it ran, one function
 * per stretch. Each takes the card it is building and returns the few elements a later stretch still needs.
 */
import { movieIcon } from "./chart-card-parts.js";
import type { TimeGrain } from "../data/aggregate.js";
import { el } from "./dom.js";
import type { ChartCard } from "./chart-card.js";
import type { Frame } from "./chart-card.js";

export function buildPart7(card: ChartCard, field: (label: string, input: HTMLElement) => HTMLElement) {
    const lookRow = el("div", { class: "chart-card-look" }, [
      card.colorGroup,
      card.paletteGroup,
      card.titleInput,
      card.xTitleInput,
      card.yTitleInput,
      card.yUnitInput,
    ]);

    // Frames over time: step and loop a bar or bubble chart, export one loop.
    card.animationTimeSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Animate over",
      title: "Step this chart through a date column (one frame per period) or a number column (in order, one frame per value or step)",
    }) as HTMLSelectElement;
    card.animationTimeSelect.addEventListener("change", () => {
      const value = Number(card.animationTimeSelect.value);
      card.setAnimationTime(Number.isFinite(value) ? value : -1);
    });
    card.animationGrainSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Frame length",
      title: "How much each frame covers",
    }) as HTMLSelectElement;
    card.syncFrameOptions();
    card.animationGrainSelect.addEventListener("change", () => {
      const value = card.animationGrainSelect.value;
      if (value === "value") card.config.animationStep = "value";
      else if (value.startsWith("step:")) card.config.animationStep = Number(value.slice(5));
      else card.config.animationGrain = value as TimeGrain;
      card.stopAnimation();
      card.generation++;
      card.refreshAnimation();
      card.render();
    });
    // Animation setup lives in its own visible row (not in Settings): the
    // Animate button in the toolbar expands it.
    card.animationSetup = el("div", { class: "chart-animate-setup hidden" }, [
      el("span", { class: "chart-animate-title" }, [movieIcon(), "Animate"]),
      el("span", { class: "chart-field-label" }, ["over"]),
      card.animationTimeSelect,
      card.animationStepLabel,
      card.animationGrainSelect,
      el("span", { class: "chart-animate-hint" }, [
        "Playback appears under the chart; export one loop as a GIF.",
      ]),
    ]);

    const settingsClose = el(
      "button",
      {
        class: "icon-btn chart-settings-close",
        type: "button",
        title: "Close settings",
        "aria-label": "Close settings",
      },
      ["×"],
    ) as HTMLButtonElement;
    settingsClose.addEventListener("click", () => {
      if (card.settingsDisclosure !== null) {
        card.settingsDisclosure.open = false;
        card.settingsDisclosure.querySelector<HTMLElement>("summary")?.focus();
      }
    });
    const settingsBody = el("div", { class: "chart-settings-body" }, [
      settingsClose,
      card.colorWrap,
      card.sizeWrap,
      card.modeWrap,
      card.densityStyleWrap,
      card.errorBarRow,
      card.chartFilterRow,
      card.histogramSettings,
      card.barSettings,
      card.correlationSettings,
      lookRow,
    ]);
    card.settingsBody = settingsBody;
    card.sidebar.append(
      el("div", { class: "chart-side-section chart-side-settings" }, [
        el("div", { class: "chart-side-title" }, ["Colour, filter and format"]),
        settingsBody,
      ]),
    );

    const canvasWrap = el("div", { class: "chart-canvas-wrap" });
    card.canvas = el("canvas", {
      class: "chart-canvas",
      role: "img",
      "aria-label": "Chart",
    }) as HTMLCanvasElement;
    canvasWrap.append(card.canvas);
    card.resetViewButton = el(
      "button",
      {
        class: "chart-reset-view hidden",
        type: "button",
        title: "Reset the zoomed view to the full range",
      },
      ["Reset view"],
    ) as HTMLButtonElement;
    card.resetViewButton.addEventListener("click", () => card.resetMapZoom());
    const mapControls = el("div", { class: "chart-map-controls hidden" });
    const mapZoomIn = el(
      "button",
      {
        class: "chart-map-control",
        type: "button",
        title: "Zoom in",
        "aria-label": "Zoom the map in",
      },
      ["+"],
    ) as HTMLButtonElement;
    mapZoomIn.addEventListener("click", () => card.zoomMap(0.8));
    const mapZoomOut = el(
      "button",
      {
        class: "chart-map-control",
        type: "button",
        title: "Zoom out",
        "aria-label": "Zoom the map out",
      },
      ["−"],
    ) as HTMLButtonElement;
    mapZoomOut.addEventListener("click", () => card.zoomMap(1.25));
    const mapFit = el(
      "button",
      {
        class: "chart-map-control chart-map-fit",
        type: "button",
        title: "Fit the map to what is plotted and your markers",
        "aria-label": "Fit the map to what is plotted and your markers",
      },
      ["Fit all"],
    ) as HTMLButtonElement;
    mapFit.addEventListener("click", () => card.resetMapZoom());
    mapControls.append(mapZoomIn, mapZoomOut, mapFit);
    card.mapControls = mapControls;
    canvasWrap.append(card.resetViewButton, mapControls);
    card.canvasWrap = canvasWrap;
    card.regions?.attachDrop(canvasWrap);
    card.summaryEl = el("div", { class: "chart-summary" });
    card.dataIssueEl = el("div", { class: "chart-data-issues hidden" });
    card.scopeEl = el("div", { class: "chart-scope" });
    card.noteEl = el("div", { class: "chart-note" });
    card.deepDiveEl = el("div", { class: "chart-deep-dive hidden" });
    card.legendEl = el("div", { class: "chart-legend hidden" });
    card.exclusionBar = el("div", { class: "chart-exclusions hidden", "aria-label": "Left out of this chart" });
    card.tooltipEl = el("div", { class: "chart-tooltip hidden", role: "tooltip" });
    card.canvas.addEventListener("pointermove", (event) =>
      card.queuePointer(event as PointerEvent),
    );
    card.canvas.addEventListener("pointerleave", () => card.hideTooltip());
    card.canvas.addEventListener("click", (event) => card.handleCanvasClick(event));
    card.canvas.addEventListener("contextmenu", (event) => card.handleCanvasContextMenu(event));
    card.canvas.addEventListener("pointerdown", (event) =>
      card.beginMapBrush(event as PointerEvent),
    );
    card.canvas.addEventListener("pointerup", (event) =>
      card.endMapBrush(event as PointerEvent),
    );
    card.canvas.addEventListener("wheel", (event) => card.onWheel(event as WheelEvent), {
      passive: false,
    });
    card.canvas.addEventListener("dblclick", () => card.resetMapZoom());
    if (typeof ResizeObserver !== "undefined") {
      card.resizeObserver = new ResizeObserver(() => card.scheduleRender());
      card.resizeObserver.observe(canvasWrap);
    }

    // Playback bar: play/pause, frame scrubber, loop and video export.
    card.animationPlayButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Play or pause the animation" },
      ["▶ Play"],
    ) as HTMLButtonElement;
    card.animationPlayButton.addEventListener("click", () => card.toggleAnimation());
    card.animationSlider = el("input", {
      class: "chart-animation-slider",
      type: "range",
      min: "0",
      max: "0",
      step: "1",
      "aria-label": "Animation frame",
    }) as HTMLInputElement;
    card.animationSlider.addEventListener("input", () => {
      const value = Number(card.animationSlider.value);
      card.stopAnimation();
      const last = card.animationResult === null ? 0 : card.animationResult.frames.length - 1;
      card.animationFrame = Math.max(0, Math.min(Number.isFinite(value) ? value : 0, last));
      card.render();
    });
  return { canvasWrap };
}

export function buildPart8(card: ChartCard, head: HTMLElement, sideHead: HTMLElement, canvasWrap: HTMLElement) {
    card.animationFrameLabel = el("span", { class: "chart-animation-label" });
    card.animationSpeedSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Play speed",
      title: "Playback speed; also sets the exported frame rate",
    }) as HTMLSelectElement;
    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      card.animationSpeedSelect.append(
        el("option", { value: String(speed) }, [`${speed}×`]) as HTMLOptionElement,
      );
    }
    card.animationSpeedSelect.append(
      el("option", { value: "custom" }, ["Custom…"]) as HTMLOptionElement,
    );
    card.animationSpeedSelect.value = String(card.config.animationSpeed ?? 1);
    card.animationSpeedSelect.addEventListener("change", () => {
      if (card.animationSpeedSelect.value === "custom") {
        void card.promptAnimationSpeed();
        return;
      }
      const speed = Number(card.animationSpeedSelect.value);
      card.setAnimationSpeed(Number.isFinite(speed) && speed > 0 ? speed : 1);
    });
    card.animationLoopInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    card.animationLoopInput.checked = true;
    const loopField = el("label", { class: "control check clean-check chart-check" });
    loopField.title = "Restart from the first frame after the last";
    loopField.append(card.animationLoopInput, "Loop");
    card.animationExportButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Export one loop as an animated GIF or a video" },
      [],
    ) as HTMLButtonElement;
    card.animationExportButton.append(movieIcon(), el("span", {}, ["Export"]));
    card.animationExportButton.addEventListener("click", () =>
      card.openExportMenu(card.animationExportButton),
    );
    card.animationBar = el(
      "div",
      { class: "chart-animation hidden" },
      [
        card.animationPlayButton,
        card.animationSlider,
        card.animationFrameLabel,
        card.animationSpeedSelect,
        loopField,
        card.animationExportButton,
      ],
    );

    card.root.append(head);
    // How the numbers are rolled up (Sum, Max, ...) and over which period stay on
    // the card, not in the Customize drawer; each wrap hides itself when unused.
    const quickRow = el("div", { class: "chart-quick", role: "group", "aria-label": "Aggregation" }, [
      card.valueAggWrap,
      card.valueGrainWrap,
      card.valueEveryWrap,
      card.valueFillWrap,
      card.weekStartWrap,
      card.fiscalWrap,
    ]);
    const main = el("div", { class: "chart-card-main" }, [
      quickRow,
      card.summaryEl,
      card.lintEl,
      card.dataIssueEl,
      card.scopeEl,
      card.animationSetup,
      card.bubbleSettings,
      card.dotSettings,
      card.exclusionBar,
      // Above the plot: naming the lines must never take a scroll.
      card.legendEl,
      canvasWrap,
      card.animationBar,
      card.deepDiveEl,
      card.noteEl,
    ]);
    card.layoutEl = el("div", { class: "chart-card-layout" }, card.options.docked === true ? [main, card.sidebar] : [card.sidebar, main]);

    card.root.append(card.layoutEl, card.tooltipEl);
    if (card.options.docked === true) card.dock(head, quickRow, sideHead, canvasWrap);

    card.syncSwatches();
    card.syncOptions();
    card.renderControls();
    // Skip the first paint while the lens is hidden: a 1x1 canvas would flash
    // before the ResizeObserver paints the real size.
    if ((card.canvas.parentElement?.clientWidth ?? 0) > 1) card.render();
    window.addEventListener("resize", card.onResize);
    window.addEventListener("themechange", card.onThemeChange);
}
