/**
 * The Map page's regions: a boundary file, how its regions connect to the table's rows, and how their values become colours.
 * The shapes and the matching live in the worker; this holds the choices, the settings that make them, and the drawing.
 */
import { CLASS_METHODS, classBreaks, classCounts, classOf, varianceFit, type ClassMethod } from "../data/classify.js";
import { searchCrs, type CrsChoice } from "../data/geo-crs.js";
import { PALETTES, paletteStops, samplePalette } from "../data/palettes.js";
import { labelPoint, levelFor, pointInFeature, type RegionAgg, type RegionShape } from "../data/regions.js";
import type { ColumnMeta, JoinSuggestionsMessage, RegionsLoadedMessage, RegionValuesMessage, RegionValuesRequestInput } from "../worker/protocol.js";
import { num } from "../data/chart-extract.js";
import { colorForFraction } from "./color-scale.js";
import { formatCompact, isGroupable, isNumericType, rampColor } from "./chart-utils.js";
import { setupDialog } from "./dialog.js";
import { roundRing, type MapHtmlLegend, type MapHtmlPayload } from "./map-html-export.js";
import { el, svgIcon } from "./dom.js";

export interface RegionHit {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  actions: { kind: "values"; column: number; code: number }[] | { kind: "text"; column: number; query: string }[];
  contains(x: number, y: number): boolean;
}

export interface MapRegionsOptions {
  load(input: { buffer?: ArrayBuffer; fileName?: string; crs?: string; layer?: string }): Promise<RegionsLoadedMessage>;
  suggest(): Promise<JoinSuggestionsMessage>;
  values(input: RegionValuesRequestInput): Promise<RegionValuesMessage>;
  clear(): void;
  /** The table's first rows, for looking through. */
  preview(): Promise<{ rows: string[][] }>;
  columns(): readonly ColumnMeta[];
  /** The table's coordinate columns, when it has them. */
  coordinates(): { x: number; y: number } | null;
  scope(): Pick<RegionValuesRequestInput, "chartFilter" | "chartExclude" | "respectFilters">;
  /** Boundaries arrived: show them. */
  onLoaded(bounds: RegionsLoadedMessage["bounds"]): void;
  onCleared(): void;
  onChange(): void;
  /** How many periods there now are to step through, while animating. */
  onFrames(frames: { labels: string[]; times: number[] } | null, rows: number): void;
}

type MatchMode = "name" | "location";

const SEP = " – ";

/** A click on a canvas label is awkward: these are the panel's plain field rows. */
const field = (label: string, control: HTMLElement, title = ""): HTMLElement =>
  el("label", { class: "chart-field map-region-field", title }, [el("span", { class: "chart-field-label" }, [label]), control]);

const GLOBE = '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 9h17M3.5 15h17" fill="none" stroke="currentColor" stroke-width="1.4"/>';
const BOUNDARY_FILE = /\.(geojson|json|zip|gpkg|shp)$/i;

export class MapRegions {
  readonly root: HTMLElement;
  private loaded: RegionsLoadedMessage | null = null;
  private values: RegionValuesMessage | null = null;
  private frames = 1;
  private generation = 0;
  private time: { column: number; grain: RegionValuesRequestInput["grain"] } | null = null;

  private mode: MatchMode = "name";
  private property = "";
  private column = -1;
  private labelProperty = "";
  private loadCount = 0;
  /** The person has looked and said yes: until then the pairing in use is only the suggestion. */
  private matchConfirmed = false;
  /** The pairing the app would make, and how well each boundary field and column did. */
  private suggested: { property: string; column: number } | null = null;
  private measure = -1;
  private agg: RegionAgg = "sum";
  private divide = "";
  private method: ClassMethod = "natural";
  private classes = 5;
  private interval: number | undefined;
  private manual: number[] = [];
  private palette = "YlOrRd";
  private reversed = false;
  private colours: (string | undefined)[] = [];
  /** What the labels on the map say: "" for none, "value", "file:<field>" or "table:<column>". */
  private labelSource = "";
  /** The person picked what labels say, "No labels" included: a new file no longer decides for them. */
  private labelChosen = false;
  private labelSize = 11;
  private labelColour = "#1c2430";
  private bufferOn = true;
  private bufferWidth = 2.5;
  private bufferColour = "#ffffff";
  /** Worked out when labels are first asked for: the roomiest spot in each region. */
  private labelSpots: [number, number][] | null = null;
  private labelsHidden = 0;
  /** A file waiting to be told what its numbers are. */
  private crsWaiting: Pick<RegionsLoadedMessage, "crsNeeded" | "crsGuesses" | "crsStated" | "rawRange" | "fileName"> | null = null;

  /** Per frame and region, after any dividing. */
  private shown = new Float64Array(0);
  private breaks: number[] = [];

  private readonly input: HTMLInputElement;
  private readonly statusEl: HTMLElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly layerSelect: HTMLSelectElement;
  private readonly layerRow: HTMLElement;
  private readonly globeButton: HTMLButtonElement;
  private readonly crsLine: HTMLElement;
  private readonly stepMatch: HTMLElement;
  private readonly matchLine: HTMLElement;
  private readonly matchCounts: HTMLElement;
  private readonly unmatchedLink: HTMLButtonElement;
  private readonly stepValue: HTMLElement;
  private readonly measureSelect: HTMLSelectElement;
  private readonly aggSelect: HTMLSelectElement;
  private readonly divideSelect: HTMLSelectElement;
  private readonly stepColours: HTMLElement;
  private readonly stepLabels: HTMLElement;
  private readonly colourStrip: HTMLElement;
  private readonly colourLine: HTMLElement;
  private readonly labelSelect: HTMLSelectElement;
  private readonly labelSwitch: HTMLInputElement;
  /** What labels said before they were switched off, so switching them on again restores it. */
  private labelBeforeOff = "";
  private readonly labelControls: HTMLElement;
  private readonly bufferControls: HTMLElement;
  private readonly labelSizeOut: HTMLElement;
  private readonly bufferOut: HTMLElement;
  private readonly bufferInput: HTMLInputElement;
  private readonly dropEl: HTMLElement;
  private dropActive = false;

  // The Classes pop-out: lives while open, and is drawn again when anything changes.
  private classesPop: HTMLElement | null = null;

  constructor(private readonly options: MapRegionsOptions) {
    this.input = el("input", { type: "file", accept: ".geojson,.json,.zip,.gpkg,.shp", class: "hidden", "aria-label": "Boundary file" }) as HTMLInputElement;
    this.input.addEventListener("change", () => {
      const file = this.input.files?.[0];
      this.input.value = "";
      if (file !== undefined) this.loadFile(file);
    });
    const loadButton = el("button", { class: "ghost small", type: "button", title: "A GeoJSON file or a zipped Shapefile, from anywhere. You can also drop one on the map." }, ["Load boundaries…"]) as HTMLButtonElement;
    loadButton.addEventListener("click", () => this.input.click());
    this.clearButton = el("button", { class: "ghost small hidden", type: "button" }, ["Clear"]) as HTMLButtonElement;
    this.clearButton.addEventListener("click", () => this.clear());
    this.statusEl = el("span", { class: "map-region-status" }, ["or drop a file on the map"]);

    this.layerSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Boundary layer" }) as HTMLSelectElement;
    this.layerSelect.addEventListener("change", () => void this.read({ layer: this.layerSelect.value }));
    this.layerRow = field("Layer", this.layerSelect, "This zip holds several sets of boundaries");

    this.crsLine = el("span", {}, [""]);
    this.globeButton = el("button", { class: "map-globe hidden", type: "button", title: "What this file's coordinates are in, and where they land" }, [svgIcon(GLOBE, "map-globe-icon"), this.crsLine]) as HTMLButtonElement;
    this.globeButton.addEventListener("click", () => this.openCrs());

    const matchButton = el("button", { class: "ghost small", type: "button" }, ["Match up…"]) as HTMLButtonElement;
    matchButton.addEventListener("click", () => this.openMatch("match"));
    this.matchLine = el("span", { class: "map-region-status" });
    this.matchCounts = el("span", { class: "map-region-status" });
    this.unmatchedLink = el("button", { class: "link small map-region-link hidden", type: "button" }, ["What did not match"]) as HTMLButtonElement;
    this.unmatchedLink.addEventListener("click", () => this.openMatch("unmatched"));

    this.measureSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Region value" }) as HTMLSelectElement;
    this.measureSelect.addEventListener("change", () => {
      this.measure = Number(this.measureSelect.value);
      this.sync();
      this.refresh();
    });
    this.aggSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Region statistic" }) as HTMLSelectElement;
    for (const [value, label] of [["sum", "Total"], ["mean", "Average"], ["median", "Median"], ["min", "Lowest"], ["max", "Highest"]] as const) {
      this.aggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    this.aggSelect.addEventListener("change", () => {
      this.agg = this.aggSelect.value as RegionAgg;
      this.refresh();
    });
    this.divideSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Divide by" }) as HTMLSelectElement;
    this.divideSelect.addEventListener("change", () => {
      this.divide = this.divideSelect.value;
      this.recolour();
    });

    this.colourStrip = el("div", { class: "map-swatches" });
    this.colourLine = el("span", { class: "map-region-status" });
    const coloursButton = el("button", { class: "ghost small", type: "button" }, ["Classes and colours…"]) as HTMLButtonElement;
    coloursButton.addEventListener("click", () => this.openClasses());

    this.labelSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Label regions with" }) as HTMLSelectElement;
    this.labelSelect.addEventListener("change", () => {
      this.labelSource = this.labelSelect.value;
      this.labelChosen = true;
      this.syncLabels();
      // Only a table column needs anything from the worker.
      if (this.labelSource.startsWith("table:")) this.refresh();
      else this.options.onChange();
    });
    this.labelSwitch = el("input", { type: "checkbox", role: "switch", "aria-label": "Show labels on the regions", class: "map-switch-input" }) as HTMLInputElement;
    this.labelSwitch.addEventListener("change", () => {
      this.labelChosen = true;
      if (this.labelSwitch.checked) this.labelSource = this.labelBeforeOff !== "" ? this.labelBeforeOff : this.labelProperty === "" ? "value" : `file:${this.labelProperty}`;
      else {
        this.labelBeforeOff = this.labelSource;
        this.labelSource = "";
      }
      this.labelSelect.value = this.labelSource;
      this.syncLabels();
      if (this.labelSource.startsWith("table:")) this.refresh();
      else this.options.onChange();
    });
    const slider = (label: string, min: string, max: string, step: string, value: string, onInput: (value: number) => void): { input: HTMLInputElement; out: HTMLElement } => {
      const input = el("input", { type: "range", min, max, step, value, "aria-label": label, class: "map-label-slider" }) as HTMLInputElement;
      const out = el("output", { class: "map-size-out" }, [`${value}px`]);
      input.addEventListener("input", () => {
        out.textContent = `${input.value}px`;
        onInput(Number(input.value));
        this.options.onChange();
      });
      return { input, out };
    };
    const colourInput = (label: string, value: string, onInput: (value: string) => void): HTMLInputElement => {
      const input = el("input", { type: "color", class: "map-region-swatch", value, "aria-label": label, title: label }) as HTMLInputElement;
      input.addEventListener("input", () => {
        onInput(input.value);
        this.options.onChange();
      });
      return input;
    };
    const size = slider("Label size", "7", "28", "1", String(this.labelSize), (value) => {
      this.labelSize = value;
    });
    this.labelSizeOut = size.out;
    const buffer = slider("Buffer size", "0.5", "8", "0.5", String(this.bufferWidth), (value) => {
      this.bufferWidth = value;
    });
    this.bufferOut = buffer.out;
    this.bufferInput = el("input", { type: "checkbox", "aria-label": "Buffer around labels", checked: "checked" }) as HTMLInputElement;
    this.bufferInput.addEventListener("change", () => {
      this.bufferOn = this.bufferInput.checked;
      this.syncLabels();
      this.options.onChange();
    });
    this.bufferControls = el("div", { class: "map-label-row" }, [buffer.input, buffer.out, colourInput("Buffer colour", this.bufferColour, (value) => {
      this.bufferColour = value;
    })]);
    this.labelControls = el("div", { class: "map-label-controls" }, [
      el("span", { class: "map-label-caption" }, ["Size"]),
      el("div", { class: "map-label-row" }, [size.input, size.out, colourInput("Label colour", this.labelColour, (value) => {
        this.labelColour = value;
      })]),
      el("label", { class: "control check clean-check chart-check", title: "A halo around the text, so it stays readable over any colour" }, [this.bufferInput, "Buffer"]),
      this.bufferControls,
    ]);

    const step = (number: number, title: string, children: HTMLElement[]): HTMLElement =>
      el("div", { class: "map-step" }, [el("div", { class: "map-step-title" }, [el("span", { class: "map-step-number" }, [String(number)]), title]), ...children]);
    const stepLoad = step(1, "Boundaries", [
      el("div", { class: "map-region-buttons" }, [loadButton, this.clearButton]),
      this.input,
      this.statusEl,
      this.layerRow,
      this.globeButton,
    ]);
    this.stepMatch = step(2, "Match to your table", [this.matchLine, this.matchCounts, el("div", { class: "map-region-buttons" }, [matchButton, this.unmatchedLink])]);
    this.stepValue = step(3, "Value", [field("Value", this.measureSelect), field("Statistic", this.aggSelect), field("Divide by", this.divideSelect, "Raw totals mostly show which regions are biggest: dividing by area or population shows intensity")]);
    this.stepColours = step(4, "Colours", [this.colourStrip, this.colourLine, el("div", { class: "map-region-buttons" }, [coloursButton])]);
    this.stepLabels = step(5, "Labels", [
      el("label", { class: "map-dock-item map-switch map-label-switch", title: "Names or values written on the regions; off leaves the colours alone" }, [
        this.labelSwitch,
        el("span", { class: "map-switch-track", "aria-hidden": "true" }),
        el("span", {}, ["Show labels"]),
      ]),
      field("Label with", this.labelSelect),
      this.labelControls,
    ]);
    this.root = el("div", { class: "map-regions" }, [stepLoad, this.stepMatch, this.stepValue, this.stepColours, this.stepLabels]);
    this.syncLabels();

    const browse = el("button", { class: "primary small", type: "button" }, ["Choose a file…"]) as HTMLButtonElement;
    browse.addEventListener("click", () => this.input.click());
    this.dropEl = el("div", { class: "map-drop hidden" }, [
      el("div", { class: "map-drop-box" }, [
        svgIcon(GLOBE, "map-drop-icon"),
        el("strong", { class: "map-drop-title" }, ["Drop a boundary file here"]),
        el("span", {}, ["A GeoJSON file or a zipped Shapefile, from anywhere in the world. The regions it holds are what gets coloured."]),
        browse,
      ]),
    ]);
    this.layerRow.classList.add("hidden");
  }

  /** The plot takes a dropped file at any time, in any kind of map. */
  attachDrop(host: HTMLElement): void {
    host.append(this.dropEl);
    let depth = 0;
    const hasFile = (event: DragEvent): boolean => event.dataTransfer?.types.includes("Files") === true;
    host.addEventListener("dragenter", (event) => {
      if (!hasFile(event) || !this.dropActive) return;
      event.preventDefault();
      depth++;
      this.dropEl.classList.remove("hidden");
      this.dropEl.classList.add("dragging");
    });
    host.addEventListener("dragover", (event) => {
      if (!hasFile(event) || !this.dropActive) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    });
    host.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.syncDrop();
    });
    host.addEventListener("drop", (event) => {
      if (!this.dropActive) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      this.syncDrop();
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) this.loadFile(file);
    });
  }

  /** Whether this is a map at all, so the plot should take drops. */
  setDropActive(active: boolean): void {
    this.dropActive = active;
    this.syncDrop();
  }

  private syncDrop(): void {
    this.dropEl.classList.remove("dragging");
    this.dropEl.classList.toggle("hidden", !(this.dropActive && this.landing && !this.ready && this.crsWaiting === null));
  }

  /** Choropleth is showing and has nothing to show yet. */
  private landing = false;

  setLanding(on: boolean): void {
    this.landing = on;
    this.syncDrop();
  }

  private loadFile(file: File): void {
    if (!BOUNDARY_FILE.test(file.name)) {
      this.statusEl.textContent = `${file.name} is not a boundary file. Use a GeoJSON file or a zipped Shapefile.`;
      return;
    }
    this.statusEl.textContent = `Reading ${file.name}…`;
    void file.arrayBuffer().then((buffer) => this.read({ buffer, fileName: file.name }));
  }

  /** Opens the file chooser for a boundary file (the map page's Boundaries button uses it). */
  chooseFile(): void {
    this.input.click();
  }

  /** Removes the loaded boundaries and goes back to the plain map. */
  clearBoundaries(): void {
    this.clear();
  }

  get ready(): boolean {
    return this.loaded !== null;
  }

  /** Changes whenever the boundaries do, so anything worked out from them knows when to start again. */
  get version(): number {
    return this.loadCount;
  }

  /** Whether a place falls inside any region, at a detail far finer than a city's position needs. */
  contains(lon: number, lat: number): boolean {
    const loaded = this.loaded;
    if (loaded === null) return false;
    const level = Math.min(2, loaded.tolerances.length - 1);
    for (const shape of loaded.shapes) {
      if (lon < shape.bbox[0] || lat < shape.bbox[1] || lon > shape.bbox[2] || lat > shape.bbox[3]) continue;
      if (pointInFeature({ rings: shape.levels[Math.min(level, shape.levels.length - 1)]! }, lon, lat)) return true;
    }
    return false;
  }

  /** Showing the table's coordinates only matters when they are what connects the rows. */
  get usesCoordinates(): boolean {
    return this.mode === "location";
  }

  get bounds(): RegionsLoadedMessage["bounds"] | null {
    return this.loaded?.bounds ?? null;
  }

  /** Reads, or re-reads with another coordinate system or layer: the file's own thread keeps the file. */
  private async read(input: { buffer?: ArrayBuffer; fileName?: string; crs?: string; layer?: string }): Promise<boolean> {
    try {
      const message = await this.options.load(input);
      if (message.crsNeeded !== undefined) {
        const first = input.crs === undefined;
        this.crsWaiting = message;
        this.statusEl.textContent = `${message.fileName}: needs a coordinate system`;
        this.clearButton.classList.remove("hidden");
        this.syncDrop();
        if (first) this.openCrs();
        return false;
      }
      this.crsWaiting = null;
      this.loaded = message;
      this.loadCount++;
      this.values = null;
      this.shown = new Float64Array(0);
      this.breaks = [];
      this.statusEl.textContent = `${message.fileName} · ${message.shapes.length.toLocaleString()} regions`;
      this.clearButton.classList.remove("hidden");
      this.fillFromFile(message);
      const confident = await this.suggest();
      this.options.onLoaded(message.bounds);
      this.root.dispatchEvent(new CustomEvent("regionschange"));
      this.syncDrop();
      this.sync();
      this.refresh();
      // A clear match needs no asking. Otherwise this is the moment to look.
      if (!confident && input.buffer !== undefined) this.openMatch("match");
      return true;
    } catch (error) {
      this.statusEl.textContent = error instanceof Error ? error.message : "Could not read that file.";
      return false;
    }
  }

  private fillFromFile(message: RegionsLoadedMessage): void {
    this.layerSelect.replaceChildren(...message.layers.map((layer) => el("option", { value: layer.name }, [`${layer.name} (${layer.features.toLocaleString()})`]) as HTMLOptionElement));
    this.layerSelect.value = message.layer;
    this.layerRow.classList.toggle("hidden", message.layers.length < 2);
    this.crsLine.textContent = message.crs.label;
    this.globeButton.classList.remove("hidden");
    const properties = this.propertyNames();
    const numeric = properties.filter((key) => message.shapes.filter((shape) => typeof shape.properties[key] === "number").length > message.shapes.length * 0.8 && !/(^|_)(id|code|objectid|fid)/i.test(key));
    this.divideSelect.replaceChildren(
      el("option", { value: "" }, ["Nothing"]) as HTMLOptionElement,
      el("option", { value: "@area" }, ["Area (per km²)"]) as HTMLOptionElement,
      ...numeric.map((key) => el("option", { value: key }, [key]) as HTMLOptionElement),
    );
    this.divide = "";
    this.labelSpots = null;
    this.labelProperty = message.labelProperty ?? "";
    // Regions read better named, so they start that way; where there is no room the small ones give way by themselves.
    const stale = this.labelSource.startsWith("file:") && !properties.includes(this.labelSource.slice(5));
    if (!this.labelChosen || stale) this.labelSource = this.labelProperty === "" ? "" : `file:${this.labelProperty}`;
    this.syncLabels();
    this.applyLabel();
    this.syncColumns();
  }

  private propertyNames(): string[] {
    const keys = new Set<string>();
    for (const shape of this.loaded?.shapes.slice(0, 50) ?? []) for (const key of Object.keys(shape.properties)) keys.add(key);
    return [...keys];
  }

  private applyLabel(): void {
    for (const shape of this.loaded?.shapes ?? []) {
      const value = shape.properties[this.labelProperty];
      if (value !== undefined && value !== null && String(value) !== "") shape.label = String(value);
    }
  }

  /** The best pairing of boundary field and table column, then location when no name matches. True when it is a clear one. */
  private async suggest(): Promise<boolean> {
    const reply = await this.options.suggest();
    this.matchConfirmed = false;
    const best = reply.suggestions[0];
    const located = this.options.coordinates() !== null;
    this.suggested = best === undefined ? null : { property: best.property, column: best.column };
    // Where a table has coordinates, they beat a weak match, or one only of numbers.
    if (best !== undefined && !(located && (best.numeric || best.matched / best.regions < 0.2))) {
      this.mode = "name";
      this.property = best.property;
      this.column = best.column;
      return best.matched / best.regions >= 0.5 && !best.numeric;
    }
    this.property = "";
    this.column = -1;
    if (located) {
      this.mode = "location";
      return true;
    }
    return false;
  }

  /** The table changed its columns. */
  syncColumns(): void {
    const columns = this.options.columns();
    if (this.column >= columns.length) this.column = -1;
    const measure = this.measure;
    this.measureSelect.replaceChildren(el("option", { value: "-1" }, ["Rows (a count)"]) as HTMLOptionElement);
    columns.forEach((meta, index) => {
      if (isNumericType(meta.type) || meta.type === "duration") this.measureSelect.append(el("option", { value: String(index) }, [meta.name]) as HTMLOptionElement);
    });
    this.measureSelect.value = String(measure >= 0 && measure < columns.length ? measure : -1);
    this.sync();
  }

  private sync(): void {
    const columns = this.options.columns();
    const coordinates = this.options.coordinates();
    if (this.mode === "location" && coordinates === null) this.mode = "name";
    const ready = this.loaded !== null;
    for (const step of [this.stepMatch, this.stepValue, this.stepColours, this.stepLabels]) step.classList.toggle("waiting", !ready);
    this.fillLabelChoices();
    this.matchLine.textContent = !ready
      ? "Load boundaries first."
      : this.mode === "location" && coordinates !== null
        ? `By location: ${columns[coordinates.y]?.name ?? "latitude"} and ${columns[coordinates.x]?.name ?? "longitude"}`
        : this.property !== "" && this.column >= 0
          ? `${this.property} = ${columns[this.column]?.name ?? ""}`
          : "Not matched yet.";
    this.aggSelect.parentElement!.classList.toggle("hidden", this.measure < 0);
    this.aggSelect.value = this.agg;
    this.divideSelect.value = this.divide;
    this.syncColourStep();
  }

  /** The choices: nothing, the value, then the file's fields and the table's columns, each under its own heading. */
  private fillLabelChoices(): void {
    const properties = this.propertyNames();
    const columns = this.options.columns();
    const signature = `${properties.join("\u0000")}\u0001${columns.map((meta) => meta.name).join("\u0000")}`;
    if (signature !== this.labelSelect.dataset.signature) {
      this.labelSelect.dataset.signature = signature;
      const sample = (key: string): string => {
        const value = this.loaded?.shapes.find((shape) => shape.properties[key] !== null && shape.properties[key] !== "")?.properties[key];
        return value === undefined ? key : `${key} (${String(value).slice(0, 16)})`;
      };
      const fromFile = el("optgroup", { label: "From the boundary file" }) as HTMLOptGroupElement;
      for (const key of properties) fromFile.append(el("option", { value: `file:${key}` }, [sample(key)]) as HTMLOptionElement);
      const fromTable = el("optgroup", { label: "From your table" }) as HTMLOptGroupElement;
      columns.forEach((meta, index) => fromTable.append(el("option", { value: `table:${index}` }, [meta.name]) as HTMLOptionElement));
      this.labelSelect.replaceChildren(
        el("option", { value: "" }, ["No labels"]) as HTMLOptionElement,
        el("option", { value: "value" }, ["The value on the map"]) as HTMLOptionElement,
        fromFile,
        fromTable,
      );
    }
    this.labelSelect.value = this.labelSource;
  }

  private syncLabels(): void {
    this.labelSwitch.checked = this.labelSource !== "";
    this.labelControls.classList.toggle("hidden", this.labelSource === "");
    this.bufferControls.classList.toggle("hidden", !this.bufferOn);
  }

  /** The label's column in the table, when that is where labels come from. */
  private labelColumn(): number | null {
    if (!this.labelSource.startsWith("table:")) return null;
    const column = Number(this.labelSource.slice(6));
    return column >= 0 && column < this.options.columns().length ? column : null;
  }

  /** What one region's label says in this period; "" for nothing. */
  private labelText(index: number, frame: number): string {
    const shape = this.loaded?.shapes[index];
    if (shape === undefined || this.labelSource === "") return "";
    if (this.labelSource === "value") {
      const value = this.shown[frame * (this.loaded?.shapes.length ?? 0) + index] ?? Number.NaN;
      return Number.isFinite(value) ? formatCompact(value) : "";
    }
    if (this.labelSource.startsWith("file:")) {
      const value = shape.properties[this.labelSource.slice(5)];
      return value === undefined || value === null ? "" : String(value);
    }
    return this.values?.labels?.[index] ?? "";
  }

  /** Largest regions first, so where there is not room for everything it is the small ones that give way. */
  private labelOrder(): { spots: [number, number][]; order: number[] } {
    const shapes = this.loaded?.shapes ?? [];
    this.labelSpots ??= shapes.map((shape) => labelPoint(shape.levels[Math.min(1, shape.levels.length - 1)]!));
    const order = shapes.map((_, index) => index).sort((a, b) => shapes[b]!.areaKm2 - shapes[a]!.areaKm2);
    return { spots: this.labelSpots, order };
  }

  private syncColourStep(): void {
    const colours = this.classColours();
    this.colourStrip.replaceChildren(...colours.map((colour) => {
      const swatch = el("span");
      swatch.style.background = colour;
      return swatch;
    }));
    const method = CLASS_METHODS.find((item) => item.id === this.method)?.label ?? "";
    this.colourLine.textContent = this.loaded === null ? "" : this.method === "continuous" ? method : `${method}, ${Math.max(0, this.breaks.length - 1)} classes`;
  }

  private clear(): void {
    this.generation++;
    this.loaded = null;
    this.loadCount++;
    this.values = null;
    this.shown = new Float64Array(0);
    this.breaks = [];
    this.crsWaiting = null;
    this.statusEl.textContent = "or drop a file on the map";
    this.clearButton.classList.add("hidden");
    this.globeButton.classList.add("hidden");
    this.layerRow.classList.add("hidden");
    this.unmatchedLink.classList.add("hidden");
    this.matchCounts.textContent = "";
    this.classesPop?.remove();
    this.classesPop = null;
    this.sync();
    this.syncDrop();
    this.options.clear();
    this.options.onCleared();
    this.root.dispatchEvent(new CustomEvent("regionschange"));
  }

  setTime(time: { column: number; grain: RegionValuesRequestInput["grain"] } | null): void {
    this.time = time;
    this.refresh();
  }

  /** Works the values out again: new choices, new filters. */
  refresh(): void {
    const generation = ++this.generation;
    const shapes = this.loaded?.shapes;
    if (shapes === undefined) return;
    const coordinates = this.options.coordinates();
    const byName = this.mode === "name" && this.property !== "" && this.column >= 0;
    const byLocation = this.mode === "location" && coordinates !== null;
    if (!byName && !byLocation) {
      this.values = null;
      this.recolour();
      return;
    }
    void this.options
      .values({
        mode: this.mode,
        property: this.property,
        column: this.column,
        xColumn: coordinates?.x ?? -1,
        yColumn: coordinates?.y ?? -1,
        measure: this.measure,
        agg: this.measure < 0 ? "count" : this.agg,
        ...(this.time === null ? {} : { timeColumn: this.time.column, grain: this.time.grain }),
        ...(this.labelColumn() === null ? {} : { labelColumn: this.labelColumn()! }),
        ...this.options.scope(),
      })
      .then((message) => {
        if (generation !== this.generation) return;
        this.values = message;
        this.frames = message.frames === null ? 1 : Math.max(1, message.frames.labels.length);
        this.options.onFrames(message.frames, message.rowsMatched);
        this.renderReport();
        this.recolour();
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        this.matchCounts.textContent = error instanceof Error ? error.message : "Could not match the rows.";
      });
  }

  private unitName(): string {
    if (this.divide === "@area") return " per km²";
    return this.divide === "" ? "" : ` per ${this.divide}`;
  }

  private valueName(): string {
    const columns = this.options.columns();
    const base = this.measure < 0 ? "Rows" : `${this.aggSelect.selectedOptions[0]?.textContent ?? ""} ${columns[this.measure]?.name ?? ""}`.trim();
    return `${base}${this.unitName()}`;
  }

  /** Applies any dividing, the classes and the colours; nothing is asked of the worker. */
  private recolour(): void {
    const shapes = this.loaded?.shapes ?? [];
    const raw = this.values?.values ?? new Float64Array(0);
    const shown = new Float64Array(raw.length);
    const n = Math.max(1, shapes.length);
    const divisor = shapes.map((shape) => {
      if (this.divide === "") return 1;
      if (this.divide === "@area") return shape.areaKm2;
      const value = shape.properties[this.divide];
      return typeof value === "number" ? value : Number.NaN;
    });
    for (let cell = 0; cell < raw.length; cell++) {
      const by = divisor[cell % n]!;
      shown[cell] = by > 0 || by < 0 ? raw[cell]! / by : Number.NaN;
    }
    this.shown = shown;
    this.breaks = classBreaks(shown, this.method, { classes: this.classes, interval: this.interval, manual: this.manual });
    this.sync();
    if (this.classesPop !== null) this.renderClassesPop();
    this.options.onChange();
  }

  private classColours(): string[] {
    const k = Math.max(0, this.breaks.length - 1);
    if (k === 0) return [];
    const sampled = samplePalette(this.palette, k);
    const ordered = this.reversed ? [...sampled].reverse() : sampled;
    return ordered.map((color, index) => this.colours[index] ?? color);
  }

  private colourOf(value: number, colours: readonly string[], stops: readonly string[]): string | null {
    if (!Number.isFinite(value)) return null;
    if (this.method === "continuous") {
      const low = this.breaks[0] ?? 0;
      const high = this.breaks[this.breaks.length - 1] ?? 1;
      const t = high > low ? (value - low) / (high - low) : 0.5;
      return colorForFraction(Math.max(0, Math.min(1, t)), stops as string[], rampColor);
    }
    const at = classOf(value, this.breaks);
    return at < 0 ? null : (colours[at] ?? null);
  }

  private renderReport(): void {
    const message = this.values;
    const shapes = this.loaded?.shapes ?? [];
    if (message === null) {
      this.matchCounts.textContent = "";
      this.unmatchedLink.classList.add("hidden");
      return;
    }
    this.matchCounts.textContent = `${message.regionsMatched.toLocaleString()} of ${shapes.length.toLocaleString()} regions have rows · ${message.rowsMatched.toLocaleString()} rows matched${message.rowsUnmatched > 0 ? `, ${message.rowsUnmatched.toLocaleString()} did not` : ""}`;
    this.unmatchedLink.classList.toggle("hidden", message.regionsMatched === shapes.length && message.rowsUnmatched === 0);
  }

  private editBreak(index: number, text: string, note: HTMLElement): void {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) return;
    const next = [...this.breaks];
    next[index] = value;
    if (next.some((item, at) => at > 0 && item < next[at - 1]!)) {
      note.textContent = "A class cannot end below where it starts: that edit was not used.";
      return;
    }
    this.manual = next;
    this.method = "manual";
    this.recolour();
  }

  /** Beside the map rather than over it, so what a change does stays in view. */
  private openClasses(): void {
    if (this.classesPop !== null) {
      this.classesPop.remove();
      this.classesPop = null;
      return;
    }
    this.classesPop = el("div", { class: "map-classes-pop", role: "dialog", "aria-label": "Classes and colours" });
    this.classesPop.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      this.classesPop?.remove();
      this.classesPop = null;
    });
    document.body.append(this.classesPop);
    this.renderClassesPop();
  }

  private renderClassesPop(): void {
    const pop = this.classesPop;
    if (pop === null) return;
    const close = el("button", { class: "icon-btn", type: "button", title: "Close", "aria-label": "Close" }, ["×"]) as HTMLButtonElement;
    close.addEventListener("click", () => {
      pop.remove();
      this.classesPop = null;
    });
    const method = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Classification method" }) as HTMLSelectElement;
    for (const { id, label } of CLASS_METHODS) method.append(el("option", { value: id }, [label]) as HTMLOptionElement);
    method.value = this.method;
    method.addEventListener("change", () => {
      this.method = method.value as ClassMethod;
      this.colours = [];
      this.recolour();
    });
    const hint = el("span", { class: "chart-field-hint map-region-hint" }, [CLASS_METHODS.find((item) => item.id === this.method)?.hint ?? ""]);
    const rows: HTMLElement[] = [field("Method", method), hint];
    if (this.method !== "continuous" && this.method !== "fixed" && this.method !== "manual" && this.method !== "stddev") {
      const classes = el("input", { class: "chart-number", type: "number", min: "2", max: "12", step: "1", value: String(this.classes), "aria-label": "Number of classes" }) as HTMLInputElement;
      classes.addEventListener("change", () => {
        const value = Number(classes.value);
        if (!Number.isInteger(value) || value < 2 || value > 12) return;
        this.classes = value;
        this.colours = [];
        this.recolour();
      });
      rows.push(field("Classes", classes));
    }
    if (this.method === "fixed") {
      const interval = el("input", { class: "chart-number", type: "number", min: "0", step: "any", placeholder: "auto", value: this.interval === undefined ? "" : String(this.interval), "aria-label": "Class interval" }) as HTMLInputElement;
      interval.addEventListener("change", () => {
        const value = Number(interval.value);
        this.interval = interval.value.trim() !== "" && value > 0 ? value : undefined;
        this.colours = [];
        this.recolour();
      });
      rows.push(field("Interval", interval, "The width of each class, such as 500"));
    }
    const palette = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Region colours" }) as HTMLSelectElement;
    for (const kind of ["sequential", "diverging"] as const) {
      const options = el("optgroup", { label: kind === "sequential" ? "Low to high" : "Either side of a middle" }) as HTMLOptGroupElement;
      for (const item of PALETTES) if (item.kind === kind) options.append(el("option", { value: item.name }, [item.name]) as HTMLOptionElement);
      palette.append(options);
    }
    palette.value = this.palette;
    palette.addEventListener("change", () => {
      this.palette = palette.value;
      this.colours = [];
      this.recolour();
    });
    const reverse = el("input", { type: "checkbox", "aria-label": "Reverse the colours" }) as HTMLInputElement;
    reverse.checked = this.reversed;
    reverse.addEventListener("change", () => {
      this.reversed = reverse.checked;
      this.colours = [];
      this.recolour();
    });
    rows.push(field("Palette", palette), el("label", { class: "control check clean-check chart-check" }, [reverse, "Reverse"]));
    const histogram = el("div", { class: "map-region-histogram" });
    const table = el("div", { class: "map-region-classes" });
    const note = el("span", { class: "chart-field-hint map-region-hint" });
    this.renderHistogram(histogram);
    const k = this.breaks.length - 1;
    if (k >= 1 && this.method !== "continuous") {
      const { counts, outside, missing } = classCounts(this.shown, this.breaks);
      const colours = this.classColours();
      const lines: HTMLElement[] = [el("div", { class: "map-region-class head" }, [el("span", {}, [""]), el("span", {}, ["From"]), el("span", {}, ["To"]), el("span", { class: "num" }, ["Regions"])])];
      for (let i = 0; i < k; i++) {
        const swatch = el("input", { type: "color", class: "map-region-swatch", value: colours[i] ?? "#888888", "aria-label": `Colour of class ${i + 1}` }) as HTMLInputElement;
        swatch.addEventListener("input", () => {
          this.colours[i] = swatch.value;
          this.syncColourStep();
          this.options.onChange();
        });
        const edge = (at: number, label: string): HTMLInputElement => {
          const input = el("input", { class: "map-region-break", type: "text", value: tidy(this.breaks[at]!), "aria-label": `${label} of class ${i + 1}` }) as HTMLInputElement;
          input.addEventListener("change", () => this.editBreak(at, input.value, note));
          return input;
        };
        lines.push(el("div", { class: "map-region-class" }, [swatch, edge(i, "Start"), edge(i + 1, "End"), el("span", { class: "num" }, [counts[i]!.toLocaleString()])]));
      }
      table.replaceChildren(...lines);
      const fit = varianceFit(this.shown, this.breaks);
      const notes: string[] = [];
      if (Number.isFinite(fit)) notes.push(`These classes explain ${Math.round(fit * 100)}% of the variation between regions.`);
      if (outside > 0) notes.push(`${outside.toLocaleString()} values fall outside your breaks.`);
      if (missing > 0 && this.frames === 1) notes.push(`${missing.toLocaleString()} regions have no value.`);
      note.textContent = notes.join(" ");
    }
    pop.replaceChildren(
      el("div", { class: "map-classes-head" }, [el("span", {}, ["Classes and colours"]), close]),
      el("div", { class: "map-classes-body" }, [...rows, histogram, table, note]),
    );
  }

  /** The values' spread with the breaks on it, to see what a method is doing. */
  private renderHistogram(host: HTMLElement): void {
    if (this.breaks.length < 2) return;
    const low = this.breaks[0]!;
    const high = this.breaks[this.breaks.length - 1]!;
    if (!(high > low)) return;
    const bins = new Array<number>(40).fill(0);
    for (const value of this.shown) {
      if (!Number.isFinite(value) || value < low || value > high) continue;
      bins[Math.min(39, Math.floor(((value - low) / (high - low)) * 40))]!++;
    }
    const top = Math.max(1, ...bins);
    const bars = bins.map((count, index) => `<rect x="${index * 5}" y="${40 - (count / top) * 38}" width="4.4" height="${(count / top) * 38}" fill="currentColor" opacity="0.45"/>`).join("");
    const lines = this.method === "continuous" ? "" : this.breaks.slice(1, -1).map((edge) => {
      const x = ((edge - low) / (high - low)) * 200;
      return `<line x1="${x}" x2="${x}" y1="0" y2="40" stroke="var(--accent)" stroke-width="1"/>`;
    }).join("");
    const svg = svgIcon(`${bars}${lines}`, "map-region-histogram-svg");
    svg.setAttribute("viewBox", "0 0 200 40");
    svg.setAttribute("preserveAspectRatio", "none");
    host.replaceChildren(svg);
  }

  /** A window over the page, closed by its ×, Esc or a click outside. */
  private popOut(title: string, modalClass: string): { body: HTMLElement; footer: HTMLElement; close: () => void } {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: `modal ${modalClass}` });
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close (Esc)" }, ["×"]);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    const close = (): void => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    closeButton.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    const body = el("div", { class: "map-pop-body" });
    const footer = el("div", { class: "clean-footer" });
    modal.append(el("div", { class: "modal-head" }, [el("h2", {}, [title]), closeButton]), body, footer);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, title);
    return { body, footer, close };
  }

  /** A table to look through, where clicking anywhere in a column chooses it. */
  private peekTable(input: { headers: readonly string[]; rows: readonly (readonly string[])[]; suggested: number; chosen: number; onChoose(column: number): void; label: string }): HTMLElement {
    const table = el("table", { class: "map-peek", "aria-label": input.label });
    const paint = (chosen: number): void => {
      for (const cell of table.querySelectorAll<HTMLElement>("[data-col]")) cell.classList.toggle("chosen", Number(cell.dataset.col) === chosen);
      for (const badge of table.querySelectorAll<HTMLElement>(".map-peek-badge")) {
        const column = Number(badge.dataset.for);
        badge.textContent = column === chosen ? "✓ Selected" : column === input.suggested ? (chosen < 0 ? "★ Suggested: click to confirm" : "★ Suggested") : "";
      }
    };
    const pick = (column: number): void => {
      paint(column);
      input.onChoose(column);
    };
    const head = el("tr");
    input.headers.forEach((name, column) => {
      const th = el("th", { "data-col": String(column), class: column === input.suggested ? "suggested" : "", title: `Use ${name}` }, [name, el("span", { class: "map-peek-badge", "data-for": String(column) })]);
      th.addEventListener("click", () => pick(column));
      head.append(th);
    });
    table.append(el("thead", {}, [head]));
    const body = el("tbody");
    for (const row of input.rows) {
      const tr = el("tr");
      row.forEach((cell, column) => {
        const td = el("td", { "data-col": String(column), class: column === input.suggested ? "suggested" : "", title: cell }, [cell]);
        td.addEventListener("click", () => pick(column));
        tr.append(td);
      });
      body.append(tr);
    }
    table.append(body);
    paint(input.chosen);
    return el("div", { class: "map-peek-scroll" }, [table]);
  }

  /** Step 2 in full: look through both tables, choose the column in each, see what that gives and what is left over. */
  private openMatch(tab: "match" | "unmatched"): void {
    const loaded = this.loaded;
    if (loaded === null) return;
    const columns = this.options.columns();
    const coordinates = this.options.coordinates();
    const { body, footer, close } = this.popOut("Match the boundaries to your table", "map-pop-modal");
    let mode = this.mode;
    let property = this.property || this.suggested?.property || "";
    let column = this.column >= 0 ? this.column : (this.suggested?.column ?? -1);
    let label = this.labelProperty;
    let trial = 0;
    let current: RegionValuesMessage | null = this.values;

    const properties = this.propertyNames();
    const result = el("div", { class: "map-pop-result" });
    const unmatchedTab = el("div", { class: "map-unmatched" });
    const matchPane = el("div", { class: "map-pop-body" });
    const useButton = el("button", { class: "primary", type: "button" }, ["Use this match"]) as HTMLButtonElement;

    const tabMatch = el("button", { type: "button" }, ["Match up"]) as HTMLButtonElement;
    const tabLeft = el("button", { type: "button" }, ["What did not match"]) as HTMLButtonElement;
    const showTab = (which: "match" | "unmatched"): void => {
      tabMatch.classList.toggle("active", which === "match");
      tabLeft.classList.toggle("active", which === "unmatched");
      matchPane.classList.toggle("hidden", which !== "match");
      unmatchedTab.classList.toggle("hidden", which !== "unmatched");
    };
    tabMatch.addEventListener("click", () => showTab("match"));
    tabLeft.addEventListener("click", () => showTab("unmatched"));

    const renderResult = (): void => {
      const message = current;
      const ready = mode === "location" ? coordinates !== null : property !== "" && column >= 0;
      useButton.disabled = !ready;
      if (!ready) {
        result.textContent = "Choose a column in each table.";
        result.classList.remove("bad");
      } else if (message === null) {
        result.textContent = "Checking…";
      } else {
        const none = message.regionsMatched === 0;
        result.classList.toggle("bad", none);
        result.textContent = none
          ? "Nothing matches: these two columns do not hold the same kind of value. Try another pairing."
          : `${message.regionsMatched.toLocaleString()} of ${loaded.shapes.length.toLocaleString()} regions have rows · ${message.rowsMatched.toLocaleString()} rows matched${message.rowsUnmatched > 0 ? ` · ${message.rowsUnmatched.toLocaleString()} rows did not` : ""}`;
      }
      const left = message?.unmatchedValues ?? [];
      const empty: string[] = [];
      if (message !== null) {
        loaded.shapes.forEach((shape, index) => {
          let rows = 0;
          for (let frame = 0; frame < (message.frames === null ? 1 : Math.max(1, message.frames.labels.length)); frame++) rows += message.rows[frame * loaded.shapes.length + index] ?? 0;
          if (rows === 0) empty.push(shape.label);
        });
      }
      const count = (n: number, one: string): string => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
      tabLeft.textContent = `What did not match (${count(empty.length, "region")}, ${count(message?.rowsUnmatched ?? 0, "row")})`;
      unmatchedTab.replaceChildren(
        el("div", {}, [
          el("p", { class: "map-peek-title" }, [`Regions with no rows (${empty.length.toLocaleString()})`]),
          el("ul", {}, empty.length === 0 ? [el("li", {}, ["None: every region has rows."])] : empty.map((name) => el("li", {}, [name]))),
        ]),
        el("div", {}, [
          el("p", { class: "map-peek-title" }, [`In your table, with no region (${(message?.rowsUnmatched ?? 0).toLocaleString()} rows)`]),
          el("ul", {}, left.length === 0
            ? [el("li", {}, [(message?.rowsUnmatched ?? 0) > 0 ? "These rows have coordinates outside every region, or none." : "None: every row found a region."])]
            : left.map((item) => el("li", {}, [`${item.value} (${item.rows.toLocaleString()} ${item.rows === 1 ? "row" : "rows"})`]))),
        ]),
      );
    };

    /** How this pairing would do, before anything is committed. */
    const check = (): void => {
      const run = ++trial;
      current = null;
      renderResult();
      if (mode === "name" && (property === "" || column < 0)) return;
      if (mode === "location" && coordinates === null) return;
      void this.options
        .values({ mode, property, column, xColumn: coordinates?.x ?? -1, yColumn: coordinates?.y ?? -1, measure: -1, agg: "count", ...this.options.scope() })
        .then((message) => {
          if (run !== trial) return;
          current = message;
          renderResult();
        });
    };

    // By name or by location
    const group = `map-match-${Math.round(Math.random() * 1e9)}`;
    const byName = el("input", { type: "radio", name: group, "aria-label": "Match by name or code" }) as HTMLInputElement;
    const byPlace = el("input", { type: "radio", name: group, "aria-label": "Match by location" }) as HTMLInputElement;
    byName.checked = mode === "name";
    byPlace.checked = mode === "location";
    byPlace.disabled = coordinates === null;
    const locationNote = el("p", { class: "map-pop-lead" });
    const namePane = el("div", { class: "map-pop-body" });
    const syncMode = (): void => {
      namePane.classList.toggle("hidden", mode !== "name");
      locationNote.classList.toggle("hidden", mode !== "location");
    };
    for (const [radio, value] of [[byName, "name"], [byPlace, "location"]] as const) {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        mode = value;
        syncMode();
        check();
      });
    }
    locationNote.textContent = coordinates === null
      ? ""
      : `Each row goes in the region that ${columns[coordinates.y]?.name ?? "latitude"} and ${columns[coordinates.x]?.name ?? "longitude"} fall inside. No shared column is needed.`;

    // The boundary file, as a table
    const fileRows = loaded.shapes.slice(0, 500).map((shape) => properties.map((key) => {
      const value = shape.properties[key];
      return value === null || value === undefined ? "" : String(value);
    }));
    const fileSuggested = this.suggested === null ? -1 : properties.indexOf(this.suggested.property);
    namePane.append(
      el("div", {}, [
        el("p", { class: "map-peek-title" }, [`${loaded.fileName}: click the column that identifies each region`]),
        this.peekTable({
          headers: properties,
          rows: fileRows,
          suggested: fileSuggested,
          chosen: this.matchConfirmed ? properties.indexOf(property) : -1,
          label: "Boundary file",
          onChoose: (at) => {
            property = properties[at] ?? "";
            check();
          },
        }),
      ]),
    );
    // The table, once its rows arrive
    const tableHost = el("div", {}, [el("p", { class: "map-peek-title" }, ["Your table: click the column holding the same thing"])]);
    namePane.append(tableHost);
    void this.options.preview().then((reply) => {
      tableHost.append(
        this.peekTable({
          headers: columns.map((meta) => meta.name),
          rows: reply.rows,
          suggested: this.suggested?.column ?? -1,
          chosen: this.matchConfirmed ? column : -1,
          label: "Your table",
          onChoose: (at) => {
            column = at;
            check();
          },
        }),
      );
    });

    const names = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Region name field" }) as HTMLSelectElement;
    for (const key of properties) names.append(el("option", { value: key }, [key]) as HTMLOptionElement);
    names.value = label;
    names.addEventListener("change", () => {
      label = names.value;
    });

    matchPane.append(
      el("div", { class: "map-region-modes" }, [
        el("label", { class: "control check clean-check chart-check" }, [byName, "By name or code"]),
        el("label", { class: "control check clean-check chart-check", title: coordinates === null ? "The table has no latitude and longitude columns" : "" }, [byPlace, "By location"]),
      ]),
      locationNote,
      namePane,
      field("Regions are called", names, "The name shown when you hover a region"),
    );
    body.append(el("div", { class: "map-tabs" }, [tabMatch, tabLeft]), matchPane, unmatchedTab, result);

    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    cancel.addEventListener("click", close);
    useButton.addEventListener("click", () => {
      this.mode = mode;
      this.property = property;
      this.column = column;
      this.matchConfirmed = true;
      this.labelProperty = label;
      this.applyLabel();
      this.sync();
      this.refresh();
      this.options.onChange();
      close();
    });
    footer.append(cancel, el("span", { class: "grow" }), useButton);
    syncMode();
    showTab(tab);
    check();
  }

  /** The globe: what the file is in, where it lands, and how to say otherwise. */
  private openCrs(): void {
    const { body, footer, close } = this.popOut("Coordinate system", "map-pop-modal");
    const waiting = this.crsWaiting;
    const loaded = this.loaded;
    const message = el("div", { class: "map-region-warning hidden" });
    if (waiting !== null && waiting.crsNeeded !== undefined) {
      body.append(el("p", { class: "map-pop-result bad" }, [waiting.crsNeeded]));
      if (waiting.crsStated) body.append(el("p", { class: "map-pop-lead" }, [`The file says: ${waiting.crsStated.slice(0, 160)}`]));
    } else if (loaded !== null) {
      const where = loaded.bounds;
      const round = (value: number): string => value.toFixed(2);
      const source = loaded.crs.source === "file" ? "This is what the file itself states." : loaded.crs.source === "user" ? "You chose this." : "The file does not say, and its numbers look like degrees.";
      body.append(
        el("div", { class: "map-pop-result" }, [
          el("strong", {}, [loaded.crs.label]),
          el("div", {}, [`${source}${loaded.crs.converted ? " Its numbers were converted to latitude and longitude." : ""}`]),
          el("div", {}, [`It lands at longitude ${round(where.lonMin)} to ${round(where.lonMax)}, latitude ${round(where.latMin)} to ${round(where.latMax)}.`]),
        ]),
        el("p", { class: "map-pop-lead" }, ["If the shapes are in the right place, this is right and there is nothing to do. It only needs changing if they land in the wrong part of the world."]),
      );
    }
    const choose = (text: string): void => {
      message.classList.add("hidden");
      void this.read({ crs: text }).then((ok) => {
        if (ok) {
          close();
        } else if (this.crsWaiting?.crsNeeded !== undefined) {
          message.textContent = this.crsWaiting.crsNeeded;
          message.classList.remove("hidden");
        } else {
          message.textContent = this.statusEl.textContent ?? "";
          message.classList.remove("hidden");
        }
      });
    };
    const choiceList = (choices: readonly CrsChoice[]): HTMLElement[] =>
      choices.map((choice) => {
        const button = el("button", { type: "button" }, [el("span", {}, [choice.name]), el("code", {}, [`EPSG:${choice.code}`])]) as HTMLButtonElement;
        button.addEventListener("click", () => choose(`EPSG:${choice.code}`));
        return button;
      });
    const guesses = waiting?.crsGuesses ?? [];
    if (guesses.length > 0) {
      body.append(el("div", {}, [el("p", { class: "map-peek-title" }, ["Good guesses for this file"]), el("div", { class: "map-crs-list" }, choiceList(guesses))]));
    }
    const search = el("input", { class: "chart-hex map-region-crs-text", type: "search", placeholder: "Search by place, name or code: ireland, utm 55, 7844", "aria-label": "Search coordinate systems" }) as HTMLInputElement;
    const list = el("div", { class: "map-crs-list" });
    const fill = (): void => {
      const found = searchCrs(search.value);
      const code = /(\d{4,6})/.exec(search.value)?.[1];
      list.replaceChildren(...choiceList(found.slice(0, 100)));
      if (found.length === 0) {
        const use = el("button", { type: "button" }, [`Try ${code === undefined ? "this" : `EPSG:${code}`}`]) as HTMLButtonElement;
        use.addEventListener("click", () => choose(code === undefined ? search.value : `EPSG:${code}`));
        list.append(el("div", { class: "map-pop-lead", style: "padding:8px 10px" }, ["Nothing by that name in the offline list."]), use);
      }
    };
    search.addEventListener("input", fill);
    fill();
    const paste = el("textarea", { class: "map-region-crs-text", rows: "3", spellcheck: "false", "aria-label": "Coordinate system definition", placeholder: "+proj=tmerc +lat_0=… or PROJCS[…" }) as HTMLTextAreaElement;
    const usePaste = el("button", { class: "ghost small", type: "button" }, ["Use this definition"]) as HTMLButtonElement;
    usePaste.addEventListener("click", () => {
      if (paste.value.trim() !== "") choose(paste.value.trim());
    });
    body.append(
      el("div", {}, [el("p", { class: "map-peek-title" }, ["All the systems this app knows offline"]), search]),
      list,
      message,
      el("details", {}, [
        el("summary", {}, ["Advanced: a system not on the list"]),
        el("p", { class: "map-pop-lead" }, ["Find it on epsg.io, copy its PROJ.4 line, and paste it here. It must be a map system: ones for height or depth cannot place shapes."]),
        paste,
        usePaste,
      ]),
    );
    const done = el("button", { class: "ghost", type: "button" }, ["Close"]);
    done.addEventListener("click", close);
    if (loaded !== null && loaded.crs.source === "user") {
      const asFile = el("button", { class: "ghost", type: "button" }, ["Back to what the file says"]) as HTMLButtonElement;
      asFile.addEventListener("click", () => {
        void this.read({}).then(() => close());
      });
      footer.append(asFile);
    }
    footer.append(el("span", { class: "grow" }), done);
    search.focus();
  }

  /** The regions over the map. Outlines only when something else is being shown on top of them. */
  draw(
    ctx: CanvasRenderingContext2D,
    frame: { left: number; top: number; plotW: number; plotH: number; ui: number; dim: string },
    view: { lonMin: number; lonMax: number; latMin: number; latMax: number },
    options: { outline: boolean; frame: number },
  ): RegionHit[] {
    const loaded = this.loaded;
    if (loaded === null) return [];
    const lonSpan = view.lonMax - view.lonMin;
    const latSpan = view.latMax - view.latMin;
    const px = (lon: number): number => frame.left + ((lon - view.lonMin) / lonSpan) * frame.plotW;
    const py = (lat: number): number => frame.top + ((view.latMax - lat) / latSpan) * frame.plotH;
    const level = levelFor(loaded.tolerances, Math.min(lonSpan / frame.plotW, latSpan / frame.plotH));
    const colours = this.classColours();
    const stops = this.reversed ? [...paletteStops(this.palette)].reverse() : paletteStops(this.palette);
    const offset = options.frame * loaded.shapes.length;
    const hits: RegionHit[] = [];
    // With thousands of small regions, full-strength borders would be all you could see.
    const lineWidth = loaded.shapes.length > 500 ? 0.35 : 0.8;
    ctx.lineJoin = "round";
    const trace = (rings: readonly Float64Array[]): void => {
      ctx.beginPath();
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i += 2) {
          const x = px(ring[i]!);
          const y = py(ring[i + 1]!);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
    };
    // Each region fills on its own, since one huge path per colour measured slower; the borders go in one stroke at the end.
    const borders: Float64Array[] = [];
    loaded.shapes.forEach((shape, index) => {
      if (shape.bbox[2] < view.lonMin || shape.bbox[0] > view.lonMax || shape.bbox[3] < view.latMin || shape.bbox[1] > view.latMax) return;
      const rings = shape.levels[Math.min(level, shape.levels.length - 1)]!;
      for (const ring of rings) borders.push(ring);
      const value = this.shown[offset + index] ?? Number.NaN;
      if (!options.outline) {
        const colour = this.colourOf(value, colours, stops);
        trace(rings);
        ctx.fillStyle = colour ?? frame.dim;
        ctx.globalAlpha = colour === null ? 0.16 : 0.88;
        ctx.fill("evenodd");
      }
      if (options.outline) return;
      const x0 = px(shape.bbox[0]);
      const x1 = px(shape.bbox[2]);
      const y0 = py(shape.bbox[3]);
      const y1 = py(shape.bbox[1]);
      const rows = this.values?.rows[offset + index];
      const lines = [shape.label, Number.isFinite(value) ? `${this.valueName()}: ${formatTip(value)}` : "No value"];
      if (rows !== undefined && rows > 0 && (this.measure >= 0 || this.divide !== "")) lines.push(`Rows: ${rows.toLocaleString()}`);
      if (this.method !== "continuous") {
        const at = classOf(value, this.breaks);
        if (at >= 0) lines.push(`Class ${at + 1} of ${this.breaks.length - 1}: ${tidy(this.breaks[at]!)}${SEP}${tidy(this.breaks[at + 1]!)}`);
      }
      hits.push({
        x: x0,
        y: y0,
        w: Math.max(1, x1 - x0),
        h: Math.max(1, y1 - y0),
        lines,
        actions: this.actionsFor(shape),
        contains: (x, y) => pointInFeature({ rings }, view.lonMin + ((x - frame.left) / frame.plotW) * lonSpan, view.latMax - ((y - frame.top) / frame.plotH) * latSpan),
      });
    });
    trace(borders);
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = options.outline ? frame.dim : "#3a3f47";
    ctx.lineWidth = lineWidth * frame.ui;
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.labelsHidden = 0;
    if (!options.outline && this.labelSource !== "") {
      const { spots, order } = this.labelOrder();
      const size = this.labelSize * frame.ui;
      const halo = this.bufferOn ? this.bufferWidth * frame.ui : 0;
      ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = halo * 2;
      ctx.strokeStyle = this.bufferColour;
      ctx.fillStyle = this.labelColour;
      const placed: [number, number, number, number][] = [];
      for (const index of order) {
        const text = this.labelText(index, options.frame);
        const spot = spots[index];
        if (text === "" || spot === undefined || !Number.isFinite(spot[0])) continue;
        const x = px(spot[0]);
        const y = py(spot[1]);
        if (x < frame.left || x > frame.left + frame.plotW || y < frame.top || y > frame.top + frame.plotH) continue;
        const half = ctx.measureText(text).width / 2 + halo;
        const box: [number, number, number, number] = [x - half, y - size / 2 - halo, x + half, y + size / 2 + halo];
        if (placed.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) {
          this.labelsHidden++;
          continue;
        }
        placed.push(box);
        if (halo > 0) ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    return hits;
  }

  private actionsFor(shape: RegionShape): RegionHit["actions"] {
    if (this.mode !== "name" || this.column < 0) return [];
    const meta = this.options.columns()[this.column];
    const raw = shape.properties[this.property];
    if (meta === undefined || raw === undefined || raw === null) return [];
    const text = String(raw);
    if (isGroupable(meta)) {
      const labels = meta.categories?.labels ?? [];
      const key = text.trim().toLowerCase();
      const code = labels.findIndex((label) => label.trim().toLowerCase() === key);
      return code >= 0 ? [{ kind: "values", column: this.column, code }] : [];
    }
    return meta.type === "string" ? [{ kind: "text", column: this.column, query: text }] : [];
  }

  /** The key on the map: one swatch a class, and what grey means. Returns how much height it took. */
  drawLegend(ctx: CanvasRenderingContext2D, frame: { left: number; top: number; plotW: number; plotH: number; ui: number; dim: string; text: string }, plate: string, font: (size: number, weight?: string) => void): void {
    if (this.breaks.length < 2 || this.values === null) return;
    const ui = frame.ui;
    const title = this.valueName();
    const continuous = this.method === "continuous";
    const k = continuous ? 0 : this.breaks.length - 1;
    const colours = this.classColours();
    const anyMissing = this.shown.some((value) => !Number.isFinite(value));
    const labels = continuous ? [] : colours.map((_, index) => `${formatCompact(this.breaks[index]!)}${SEP}${formatCompact(this.breaks[index + 1]!)}`);
    if (anyMissing) labels.push("No value");
    font(10);
    const textW = Math.max(ctx.measureText(title).width, ...labels.map((label) => ctx.measureText(label).width + 20 * ui), continuous ? 140 * ui : 0);
    const rowH = 15 * ui;
    const boxW = Math.min(frame.plotW * 0.5, textW + 14 * ui);
    const boxH = 20 * ui + (continuous ? 22 * ui + (anyMissing ? rowH : 0) : labels.length * rowH) + 3 * ui;
    const x = frame.left + frame.plotW - boxW - 6 * ui;
    const y = frame.top + frame.plotH - boxH - 6 * ui;
    ctx.fillStyle = plate;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(x, y, boxW, boxH);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.fillStyle = frame.text;
    font(10, "600");
    ctx.fillText(title.length > 44 ? `${title.slice(0, 42)}…` : title, x + 7 * ui, y + 14 * ui);
    font(10);
    let rowY = y + 20 * ui;
    if (continuous) {
      const barW = boxW - 14 * ui;
      const gradient = ctx.createLinearGradient(x + 7 * ui, 0, x + 7 * ui + barW, 0);
      const stops = this.reversed ? [...paletteStops(this.palette)].reverse() : paletteStops(this.palette);
      stops.forEach((stop, index) => gradient.addColorStop(index / Math.max(1, stops.length - 1), stop));
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 7 * ui, rowY, barW, 7 * ui);
      ctx.fillStyle = frame.dim;
      ctx.fillText(formatCompact(this.breaks[0]!), x + 7 * ui, rowY + 18 * ui);
      const high = formatCompact(this.breaks[this.breaks.length - 1]!);
      ctx.fillText(high, x + boxW - 7 * ui - ctx.measureText(high).width, rowY + 18 * ui);
      rowY += 22 * ui;
    }
    for (let i = 0; i < k; i++) {
      ctx.fillStyle = colours[i] ?? frame.dim;
      ctx.fillRect(x + 7 * ui, rowY + 2 * ui, 13 * ui, 10 * ui);
      ctx.fillStyle = frame.text;
      ctx.fillText(labels[i]!, x + 25 * ui, rowY + 11 * ui);
      rowY += rowH;
    }
    if (anyMissing) {
      ctx.fillStyle = frame.dim;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(x + 7 * ui, rowY + 2 * ui, 13 * ui, 10 * ui);
      ctx.globalAlpha = 1;
      ctx.fillStyle = frame.text;
      ctx.fillText("No value", x + 25 * ui, rowY + 11 * ui);
    }
  }

  note(frame: number): string {
    if (this.loaded === null) return "Load a boundary file: a GeoJSON or a zipped Shapefile.";
    if (this.values === null) return `${this.loaded.shapes.length.toLocaleString()} regions: choose how they connect to the table.`;
    const label = this.values.frames?.labels[frame];
    const method = CLASS_METHODS.find((item) => item.id === this.method)?.label ?? "";
    return `${label === undefined ? "" : `${label} · `}${this.valueName()} · ${method}${this.method === "continuous" ? "" : `, ${this.breaks.length - 1} classes`} · ${this.values.regionsMatched.toLocaleString()} of ${this.loaded.shapes.length.toLocaleString()} regions have rows${this.values.rowsUnmatched > 0 ? ` · ${this.values.rowsUnmatched.toLocaleString()} rows matched no region` : ""}${this.labelsHidden > 0 ? ` · ${this.labelsHidden.toLocaleString()} labels left out for room: zoom in or make them smaller` : ""}`;
  }

  /** For the interactive page: the shapes at a size a file can carry, each period's colours, and the hover text. */
  exportData(): { regions: NonNullable<MapHtmlPayload["regions"]>; frames: string[]; legend: MapHtmlLegend } | null {
    const loaded = this.loaded;
    if (loaded === null) return null;
    // The finest level that keeps the file a sensible size.
    let level = 0;
    for (let i = 0; i < loaded.tolerances.length; i++) {
      let points = 0;
      for (const shape of loaded.shapes) for (const ring of shape.levels[Math.min(i, shape.levels.length - 1)]!) points += ring.length / 2;
      if (points <= 300_000) level = i;
    }
    const digits = Math.max(3, Math.min(6, Math.ceil(-Math.log10(Math.max(1e-6, loaded.tolerances[level]! || 1e-6))) + 1));
    const shapes = loaded.shapes.map((shape) => shape.levels[Math.min(level, shape.levels.length - 1)]!.map((ring) => roundRing(ring, digits)));
    const count = loaded.shapes.length;
    const frames = this.values?.frames?.labels ?? [""];
    const classColours = this.classColours();
    const stops = this.reversed ? [...paletteStops(this.palette)].reverse() : paletteStops(this.palette);
    const colours: string[] = [];
    const indexOf = new Map<string, number>();
    const fill: number[][] = [];
    const tips: string[][][] = [];
    let missing = false;
    frames.forEach((_, frame) => {
      const row: number[] = [];
      const lines: string[][] = [];
      loaded.shapes.forEach((shape, index) => {
        const cell = frame * count + index;
        const value = this.shown[cell] ?? Number.NaN;
        const colour = this.colourOf(value, classColours, stops);
        if (colour === null) missing = true;
        let at = -1;
        if (colour !== null) {
          at = indexOf.get(colour) ?? colours.length;
          if (at === colours.length) {
            colours.push(colour);
            indexOf.set(colour, at);
          }
        }
        row.push(at);
        const text = [shape.label, Number.isFinite(value) ? `${this.valueName()}: ${formatTip(value)}` : "No value"];
        const rows = this.values?.rows[cell];
        if (rows !== undefined && rows > 0 && (this.measure >= 0 || this.divide !== "")) text.push(`Rows: ${rows.toLocaleString()}`);
        lines.push(text);
      });
      fill.push(row);
      tips.push(lines);
    });
    const continuous = this.method === "continuous";
    const legend: MapHtmlLegend = {
      title: this.valueName(),
      ...(continuous
        ? { ramp: { stops, low: formatCompact(this.breaks[0] ?? 0), high: formatCompact(this.breaks[this.breaks.length - 1] ?? 0) } }
        : { classes: classColours.map((colour, index) => ({ colour, label: `${formatCompact(this.breaks[index]!)}${SEP}${formatCompact(this.breaks[index + 1]!)}` })) }),
    };
    let labels: NonNullable<MapHtmlPayload["regions"]>["labels"];
    if (this.labelSource !== "") {
      const { spots, order } = this.labelOrder();
      labels = {
        spots: spots.map(([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]),
        order,
        // The text only changes through time when it is the value.
        texts: (this.labelSource === "value" ? frames : [""]).map((_, frame) => loaded.shapes.map((__, index) => this.labelText(index, frame))),
        size: this.labelSize,
        colour: this.labelColour,
        buffer: this.bufferOn ? this.bufferWidth : 0,
        bufferColour: this.bufferColour,
      };
    }
    return { regions: { shapes, fill, colours, tips, missing, ...(labels === undefined ? {} : { labels }) }, frames, legend };
  }

  /** The numbers for Extract stats. */
  extract(facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
    const loaded = this.loaded;
    if (loaded === null) return;
    const columns = this.options.columns();
    facts.push(["Boundaries", `${loaded.fileName}${loaded.layers.length > 1 ? `, layer ${loaded.layer}` : ""}: ${loaded.shapes.length.toLocaleString()} regions`]);
    facts.push(["Coordinates", `${loaded.crs.label} (${loaded.crs.source === "file" ? "stated by the file" : loaded.crs.source === "user" ? "chosen by you" : "assumed from the numbers"})`]);
    const values = this.values;
    if (values === null) return;
    facts.push(["Matched", this.mode === "location" ? "By location: the region each row's coordinates fall inside" : `By name: ${this.property} = ${columns[this.column]?.name ?? ""}, ignoring case, spacing and leading zeros`]);
    facts.push(["Rows", `${values.rowsMatched.toLocaleString()} matched, ${values.rowsUnmatched.toLocaleString()} not`]);
    facts.push(["Value", this.valueName()]);
    if (this.divide === "@area") facts.push(["Area", "Worked out from each region's shape, on a sphere"]);
    const method = CLASS_METHODS.find((item) => item.id === this.method)?.label ?? this.method;
    facts.push(["Classes", `${method}${this.method === "continuous" ? "" : `: ${this.breaks.length - 1} classes`}`]);
    const fit = varianceFit(this.shown, this.breaks);
    if (Number.isFinite(fit) && this.method !== "continuous") facts.push(["Goodness of variance fit", fit.toFixed(4)]);
    if (this.method !== "continuous") {
      const { counts } = classCounts(this.shown, this.breaks);
      table("Classes", [["class", "from", "to", "values", "colour"], ...counts.map((count, index) => [String(index + 1), num(this.breaks[index]), num(this.breaks[index + 1]), String(count), this.classColours()[index] ?? ""])]);
    }
    const periods = values.frames?.labels;
    const name = loaded.labelProperty ?? "region";
    const rows: string[][] = [[...(periods === undefined ? [] : ["period"]), name, "value", "rows", "class", ...(this.divide === "" ? [] : ["before_dividing"])]];
    const count = loaded.shapes.length;
    for (let frame = 0; frame < this.frames; frame++) {
      loaded.shapes.forEach((shape, index) => {
        const cell = frame * count + index;
        const at = classOf(this.shown[cell]!, this.breaks);
        rows.push([...(periods === undefined ? [] : [periods[frame] ?? ""]), shape.label, num(this.shown[cell]), String(values.rows[cell] ?? 0), at < 0 ? "" : String(at + 1), ...(this.divide === "" ? [] : [num(values.values[cell])])]);
      });
    }
    table(periods === undefined ? "Regions" : "Every region in every period", rows);
    if (values.unmatchedValues.length > 0) table("In the table, with no region", [["value", "rows"], ...values.unmatchedValues.map((item) => [item.value, String(item.rows)])]);
  }
}

const tidy = (value: number): string => (Number.isInteger(value) ? String(value) : Number(value.toPrecision(5)).toString());

const formatTip = (value: number): string => value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) >= 100 ? 1 : 3 });
