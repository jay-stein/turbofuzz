/**
 * The Map page's regions: a boundary file, how its regions connect to the table's rows, and how their values become colours.
 * The shapes and the matching live in the worker; this holds the choices, the settings that make them, and the drawing.
 */
import { CLASS_METHODS, classBreaks, classCounts, classOf, varianceFit, type ClassMethod } from "../data/classify.js";
import { COMMON_CRS } from "../data/geo-crs.js";
import { PALETTES, paletteStops, samplePalette } from "../data/palettes.js";
import { levelFor, pointInFeature, type RegionAgg, type RegionShape } from "../data/regions.js";
import type { ColumnMeta, JoinSuggestionsMessage, RegionsLoadedMessage, RegionValuesMessage, RegionValuesRequestInput } from "../worker/protocol.js";
import { num } from "../data/chart-extract.js";
import { colorForFraction } from "./color-scale.js";
import { formatCompact, isGroupable, isNumericType, rampColor } from "./chart-utils.js";
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

  /** Per frame and region, after any dividing. */
  private shown = new Float64Array(0);
  private breaks: number[] = [];

  private readonly input: HTMLInputElement;
  private readonly statusEl: HTMLElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly layerSelect: HTMLSelectElement;
  private readonly layerRow: HTMLElement;
  private readonly crsLine: HTMLElement;
  private readonly crsPanel: HTMLElement;
  private readonly crsSelect: HTMLSelectElement;
  private readonly crsText: HTMLInputElement;
  private readonly crsMessage: HTMLElement;
  private readonly labelSelect: HTMLSelectElement;
  private readonly modeName: HTMLInputElement;
  private readonly modeLocation: HTMLInputElement;
  private readonly modeHint: HTMLElement;
  private readonly nameRows: HTMLElement;
  private readonly propertySelect: HTMLSelectElement;
  private readonly columnSelect: HTMLSelectElement;
  private readonly reportEl: HTMLElement;
  private readonly measureSelect: HTMLSelectElement;
  private readonly aggSelect: HTMLSelectElement;
  private readonly divideSelect: HTMLSelectElement;
  private readonly methodSelect: HTMLSelectElement;
  private readonly methodHint: HTMLElement;
  private readonly classesInput: HTMLInputElement;
  private readonly classesRow: HTMLElement;
  private readonly intervalInput: HTMLInputElement;
  private readonly intervalRow: HTMLElement;
  private readonly paletteSelect: HTMLSelectElement;
  private readonly reverseInput: HTMLInputElement;
  private readonly histogramEl: HTMLElement;
  private readonly classTable: HTMLElement;
  private readonly fitEl: HTMLElement;

  constructor(private readonly options: MapRegionsOptions) {
    this.input = el("input", { type: "file", accept: ".geojson,.json,.zip,.gpkg,.shp", class: "hidden", "aria-label": "Boundary file" }) as HTMLInputElement;
    this.input.addEventListener("change", () => {
      const file = this.input.files?.[0];
      this.input.value = "";
      if (file === undefined) return;
      this.statusEl.textContent = `Reading ${file.name}…`;
      void file.arrayBuffer().then((buffer) => this.read({ buffer, fileName: file.name }));
    });
    const loadButton = el("button", { class: "ghost small", type: "button", title: "A GeoJSON file or a zipped Shapefile, from anywhere" }, ["Load boundaries…"]) as HTMLButtonElement;
    loadButton.addEventListener("click", () => this.input.click());
    this.clearButton = el("button", { class: "ghost small hidden", type: "button" }, ["Clear"]) as HTMLButtonElement;
    this.clearButton.addEventListener("click", () => this.clear());
    this.statusEl = el("span", { class: "map-region-status" });

    this.layerSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Boundary layer" }) as HTMLSelectElement;
    this.layerSelect.addEventListener("change", () => void this.read({ layer: this.layerSelect.value }));
    this.layerRow = field("Layer", this.layerSelect, "This zip holds several sets of boundaries");

    // Coordinates: what the file says, with an override always within reach.
    this.crsLine = el("span", { class: "map-region-crs" });
    const crsToggle = el("button", { class: "link small map-region-link", type: "button" }, ["Change…"]) as HTMLButtonElement;
    this.crsSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Coordinate system" }) as HTMLSelectElement;
    this.crsSelect.append(el("option", { value: "" }, ["Choose…"]) as HTMLOptionElement);
    for (const { code, name } of COMMON_CRS) this.crsSelect.append(el("option", { value: `EPSG:${code}` }, [`${name}, ${code}`]) as HTMLOptionElement);
    this.crsSelect.addEventListener("change", () => {
      if (this.crsSelect.value !== "") this.crsText.value = this.crsSelect.value;
    });
    this.crsText = el("input", { class: "chart-hex map-region-crs-text", type: "text", placeholder: "EPSG:32755, a proj4 string or WKT", spellcheck: "false", "aria-label": "Coordinate system definition" }) as HTMLInputElement;
    const crsApply = el("button", { class: "ghost small", type: "button" }, ["Use this"]) as HTMLButtonElement;
    crsApply.addEventListener("click", () => {
      if (this.crsText.value.trim() !== "") void this.read({ crs: this.crsText.value.trim() });
    });
    const crsAuto = el("button", { class: "ghost small", type: "button", title: "Go back to what the file itself says" }, ["As the file says"]) as HTMLButtonElement;
    crsAuto.addEventListener("click", () => {
      this.crsText.value = "";
      this.crsSelect.value = "";
      void this.read({});
    });
    this.crsMessage = el("span", { class: "map-region-warning hidden" });
    this.crsPanel = el("div", { class: "map-region-crs-panel hidden" }, [
      this.crsMessage,
      el("span", { class: "chart-field-hint map-region-hint" }, ["What the file's numbers are in, if it is wrong or silent:"]),
      this.crsSelect,
      this.crsText,
      el("div", { class: "map-region-buttons" }, [crsApply, crsAuto]),
    ]);
    crsToggle.addEventListener("click", () => this.crsPanel.classList.toggle("hidden"));

    this.labelSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Region name field" }) as HTMLSelectElement;
    this.labelSelect.addEventListener("change", () => {
      this.applyLabel();
      this.options.onChange();
    });

    // Match: by what the rows are called, or by where they are.
    const group = `map-region-mode-${Math.round(Math.random() * 1e9)}`;
    this.modeName = el("input", { type: "radio", name: group, "aria-label": "Match by name or code" }) as HTMLInputElement;
    this.modeLocation = el("input", { type: "radio", name: group, "aria-label": "Match by location" }) as HTMLInputElement;
    for (const [radio, mode] of [[this.modeName, "name"], [this.modeLocation, "location"]] as const) {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        this.mode = mode;
        this.sync();
        this.refresh();
      });
    }
    this.modeHint = el("span", { class: "chart-field-hint map-region-hint" });
    this.propertySelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Boundary field" }) as HTMLSelectElement;
    this.columnSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Table column to match" }) as HTMLSelectElement;
    for (const select of [this.propertySelect, this.columnSelect]) {
      select.addEventListener("change", () => {
        this.property = this.propertySelect.value;
        this.column = Number(this.columnSelect.value);
        this.refresh();
      });
    }
    this.nameRows = el("div", { class: "map-region-group" }, [field("Boundary field", this.propertySelect), field("Table column", this.columnSelect)]);
    this.reportEl = el("div", { class: "map-region-report" });

    // The value.
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

    // The colours.
    this.methodSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Classification method" }) as HTMLSelectElement;
    for (const { id, label } of CLASS_METHODS) this.methodSelect.append(el("option", { value: id }, [label]) as HTMLOptionElement);
    this.methodSelect.addEventListener("change", () => {
      this.method = this.methodSelect.value as ClassMethod;
      this.colours = [];
      this.recolour();
    });
    this.methodHint = el("span", { class: "chart-field-hint map-region-hint" });
    this.classesInput = el("input", { class: "chart-number", type: "number", min: "2", max: "12", step: "1", "aria-label": "Number of classes" }) as HTMLInputElement;
    this.classesInput.addEventListener("input", () => {
      const value = Number(this.classesInput.value);
      if (!Number.isInteger(value) || value < 2 || value > 12) return;
      this.classes = value;
      this.colours = [];
      this.recolour();
    });
    this.classesRow = field("Classes", this.classesInput);
    this.intervalInput = el("input", { class: "chart-number", type: "number", min: "0", step: "any", placeholder: "auto", "aria-label": "Class interval" }) as HTMLInputElement;
    this.intervalInput.addEventListener("input", () => {
      const value = Number(this.intervalInput.value);
      this.interval = this.intervalInput.value.trim() !== "" && value > 0 ? value : undefined;
      this.colours = [];
      this.recolour();
    });
    this.intervalRow = field("Interval", this.intervalInput, "The width of each class, such as 500");
    this.paletteSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Region colours" }) as HTMLSelectElement;
    for (const kind of ["sequential", "diverging"] as const) {
      const options = el("optgroup", { label: kind === "sequential" ? "Low to high" : "Either side of a middle" }) as HTMLOptGroupElement;
      for (const palette of PALETTES) if (palette.kind === kind) options.append(el("option", { value: palette.name }, [palette.name]) as HTMLOptionElement);
      this.paletteSelect.append(options);
    }
    this.paletteSelect.addEventListener("change", () => {
      this.palette = this.paletteSelect.value;
      this.colours = [];
      this.recolour();
    });
    this.reverseInput = el("input", { type: "checkbox", "aria-label": "Reverse the colours" }) as HTMLInputElement;
    this.reverseInput.addEventListener("change", () => {
      this.reversed = this.reverseInput.checked;
      this.colours = [];
      this.recolour();
    });
    this.histogramEl = el("div", { class: "map-region-histogram" });
    this.classTable = el("div", { class: "map-region-classes" });
    this.fitEl = el("span", { class: "chart-field-hint map-region-hint" });

    this.body = el("div", { class: "map-region-body hidden" }, [
      this.layerRow,
      el("div", { class: "map-region-crs-row" }, [this.crsLine, crsToggle]),
      this.crsPanel,
      field("Region names", this.labelSelect),
      el("span", { class: "chart-animate-title" }, ["Connect to the table"]),
      el("div", { class: "map-region-modes" }, [
        el("label", { class: "control check clean-check chart-check" }, [this.modeName, "By name or code"]),
        el("label", { class: "control check clean-check chart-check" }, [this.modeLocation, "By location"]),
      ]),
      this.modeHint,
      this.nameRows,
      this.reportEl,
      el("span", { class: "chart-animate-title" }, ["Value"]),
      field("Value", this.measureSelect),
      field("Statistic", this.aggSelect),
      field("Divide by", this.divideSelect, "Raw totals mostly show which regions are biggest: dividing by area or population shows intensity"),
      el("span", { class: "chart-animate-title" }, ["Colours"]),
      field("Method", this.methodSelect),
      this.methodHint,
      this.classesRow,
      this.intervalRow,
      field("Palette", this.paletteSelect),
      el("label", { class: "control check clean-check chart-check" }, [this.reverseInput, "Reverse"]),
      this.histogramEl,
      this.classTable,
      this.fitEl,
    ]);
    this.root = el("div", { class: "map-regions" }, [
      el("div", { class: "map-region-buttons" }, [loadButton, this.clearButton]),
      this.input,
      this.statusEl,
      this.body,
    ]);
  }

  get ready(): boolean {
    return this.loaded !== null;
  }

  /** Showing the table's coordinates only matters when they are what connects the rows. */
  get usesCoordinates(): boolean {
    return this.mode === "location";
  }

  get bounds(): RegionsLoadedMessage["bounds"] | null {
    return this.loaded?.bounds ?? null;
  }

  /** Reads, or re-reads with another coordinate system or layer: the worker keeps the file. */
  private async read(input: { buffer?: ArrayBuffer; fileName?: string; crs?: string; layer?: string }): Promise<void> {
    try {
      const message = await this.options.load(input);
      if (message.crsNeeded !== undefined) {
        this.crsMessage.textContent = message.crsNeeded;
        this.crsMessage.classList.remove("hidden");
        this.crsPanel.classList.remove("hidden");
        this.body.classList.remove("hidden");
        this.statusEl.textContent = `${message.fileName}: needs a coordinate system`;
        this.clearButton.classList.remove("hidden");
        for (const child of this.body.children) {
          if (child !== this.crsPanel) child.classList.add("map-region-waiting");
        }
        return;
      }
      for (const child of this.body.children) child.classList.remove("map-region-waiting");
      this.crsMessage.classList.add("hidden");
      this.crsPanel.classList.add("hidden");
      this.loaded = message;
      this.values = null;
      this.shown = new Float64Array(0);
      this.breaks = [];
      this.statusEl.textContent = `${message.fileName} · ${message.shapes.length.toLocaleString()} regions`;
      this.clearButton.classList.remove("hidden");
      this.body.classList.remove("hidden");
      this.fillFromFile(message);
      await this.suggest();
      this.options.onLoaded(message.bounds);
      this.sync();
      this.refresh();
    } catch (error) {
      this.statusEl.textContent = error instanceof Error ? error.message : "Could not read that file.";
    }
  }

  private fillFromFile(message: RegionsLoadedMessage): void {
    this.layerSelect.replaceChildren(...message.layers.map((layer) => el("option", { value: layer.name }, [`${layer.name} (${layer.features.toLocaleString()})`]) as HTMLOptionElement));
    this.layerSelect.value = message.layer;
    this.layerRow.classList.toggle("hidden", message.layers.length < 2);
    const how = message.crs.source === "file" ? "as the file states" : message.crs.source === "user" ? "as you chose" : "";
    this.crsLine.textContent = `${message.crs.label}${how === "" ? "" : `, ${how}`}${message.crs.converted ? ", converted to latitude and longitude" : ""}`;
    const keys = new Set<string>();
    for (const shape of message.shapes.slice(0, 50)) for (const key of Object.keys(shape.properties)) keys.add(key);
    const properties = [...keys];
    const options = (): HTMLOptionElement[] => properties.map((key) => el("option", { value: key }, [`${key}${this.sampleOf(key)}`]) as HTMLOptionElement);
    this.labelSelect.replaceChildren(...options());
    if (message.labelProperty !== null) this.labelSelect.value = message.labelProperty;
    this.propertySelect.replaceChildren(el("option", { value: "" }, ["Choose…"]) as HTMLOptionElement, ...options());
    const numeric = properties.filter((key) => message.shapes.filter((shape) => typeof shape.properties[key] === "number").length > message.shapes.length * 0.8 && !/(^|_)(id|code|objectid|fid)/i.test(key));
    this.divideSelect.replaceChildren(
      el("option", { value: "" }, ["Nothing"]) as HTMLOptionElement,
      el("option", { value: "@area" }, ["Area (per km²)"]) as HTMLOptionElement,
      ...numeric.map((key) => el("option", { value: key }, [key]) as HTMLOptionElement),
    );
    this.divide = "";
    this.applyLabel();
    this.syncColumns();
  }

  private sampleOf(key: string): string {
    const value = this.loaded?.shapes.find((shape) => shape.properties[key] !== null && shape.properties[key] !== "")?.properties[key];
    return value === undefined ? "" : ` (${String(value).slice(0, 18)})`;
  }

  private applyLabel(): void {
    const key = this.labelSelect.value;
    for (const shape of this.loaded?.shapes ?? []) {
      const value = shape.properties[key];
      if (value !== undefined && value !== null && String(value) !== "") shape.label = String(value);
    }
  }

  /** The best pairing of boundary field and table column, then location when no name matches. */
  private async suggest(): Promise<void> {
    const reply = await this.options.suggest();
    const best = reply.suggestions[0];
    const located = this.options.coordinates() !== null;
    // Where a table has coordinates, they beat a weak match, or one only of numbers.
    if (best !== undefined && !(located && (best.numeric || best.matched / best.regions < 0.2))) {
      this.mode = "name";
      this.property = best.property;
      this.column = best.column;
      this.propertySelect.value = best.property;
      this.columnSelect.value = String(best.column);
    } else if (located) {
      this.mode = "location";
    }
  }

  /** The table changed its columns. */
  syncColumns(): void {
    const columns = this.options.columns();
    const previous = this.column;
    this.columnSelect.replaceChildren(el("option", { value: "-1" }, ["Choose…"]) as HTMLOptionElement);
    columns.forEach((meta, index) => {
      if (isGroupable(meta) || meta.type === "string" || isNumericType(meta.type)) this.columnSelect.append(el("option", { value: String(index) }, [meta.name]) as HTMLOptionElement);
    });
    this.columnSelect.value = String(previous >= 0 && previous < columns.length ? previous : -1);
    const measure = this.measure;
    this.measureSelect.replaceChildren(el("option", { value: "-1" }, ["Rows (a count)"]) as HTMLOptionElement);
    columns.forEach((meta, index) => {
      if (isNumericType(meta.type) || meta.type === "duration") this.measureSelect.append(el("option", { value: String(index) }, [meta.name]) as HTMLOptionElement);
    });
    this.measureSelect.value = String(measure >= 0 && measure < columns.length ? measure : -1);
    this.sync();
  }

  private sync(): void {
    const coordinates = this.options.coordinates();
    if (this.mode === "location" && coordinates === null) this.mode = "name";
    this.modeName.checked = this.mode === "name";
    this.modeLocation.checked = this.mode === "location";
    this.modeLocation.disabled = coordinates === null;
    this.modeLocation.parentElement!.title = coordinates === null ? "The table has no latitude and longitude columns" : "Puts each row in the region its coordinates fall inside";
    const columns = this.options.columns();
    this.modeHint.textContent = this.mode === "location" && coordinates !== null
      ? `Each row goes in the region its ${columns[coordinates.y]?.name ?? "latitude"} and ${columns[coordinates.x]?.name ?? "longitude"} fall inside.`
      : coordinates === null
        ? "Rows are matched on a value the table and the file share. Location needs latitude and longitude columns."
        : "Rows are matched on a value the table and the file share.";
    this.nameRows.classList.toggle("hidden", this.mode !== "name");
    this.aggSelect.parentElement!.classList.toggle("hidden", this.measure < 0);
    this.aggSelect.value = this.agg;
    this.methodSelect.value = this.method;
    this.methodHint.textContent = CLASS_METHODS.find((item) => item.id === this.method)?.hint ?? "";
    this.classesInput.value = String(this.classes);
    this.classesRow.classList.toggle("hidden", this.method === "continuous" || this.method === "fixed" || this.method === "manual" || this.method === "stddev");
    this.intervalRow.classList.toggle("hidden", this.method !== "fixed");
    this.paletteSelect.value = this.palette;
    this.reverseInput.checked = this.reversed;
    this.divideSelect.value = this.divide;
  }

  private clear(): void {
    this.generation++;
    this.loaded = null;
    this.values = null;
    this.shown = new Float64Array(0);
    this.breaks = [];
    this.statusEl.textContent = "";
    this.clearButton.classList.add("hidden");
    this.body.classList.add("hidden");
    this.reportEl.replaceChildren();
    this.options.clear();
    this.options.onCleared();
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
        this.reportEl.textContent = error instanceof Error ? error.message : "Could not match the rows.";
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
    this.renderClasses();
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
      this.reportEl.replaceChildren();
      return;
    }
    const missing = shapes.length - message.regionsMatched;
    const summary = `${message.regionsMatched.toLocaleString()} of ${shapes.length.toLocaleString()} regions have rows · ${message.rowsMatched.toLocaleString()} rows matched${message.rowsUnmatched > 0 ? ` · ${message.rowsUnmatched.toLocaleString()} did not` : ""}`;
    const lines: HTMLElement[] = [el("div", { class: message.regionsMatched === 0 ? "map-region-warning" : "" }, [summary])];
    if (message.regionsMatched === 0 && this.mode === "name") lines.push(el("div", { class: "map-region-warning" }, ["Nothing matched: check the two fields hold the same kind of value."]));
    const empty: string[] = [];
    if (missing > 0 && this.frames === 1) {
      shapes.forEach((shape, index) => {
        if (message.rows[index] === 0 && empty.length < 25) empty.push(shape.label);
      });
    }
    if (empty.length > 0 || message.unmatchedValues.length > 0) {
      lines.push(
        el("details", { class: "map-region-details" }, [
          el("summary", {}, ["What did not match"]),
          ...(message.unmatchedValues.length === 0 ? [] : [el("p", {}, [`In the table, with no region: ${message.unmatchedValues.map((item) => `${item.value} (${item.rows.toLocaleString()})`).join(", ")}`])]),
          ...(empty.length === 0 ? [] : [el("p", {}, [`Regions with no rows: ${empty.join(", ")}${missing > empty.length ? ` and ${(missing - empty.length).toLocaleString()} more` : ""}`])]),
        ]),
      );
    }
    this.reportEl.replaceChildren(...lines);
  }

  private editBreak(index: number, text: string): void {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) return;
    const next = [...this.breaks];
    next[index] = value;
    if (next.some((item, at) => at > 0 && item < next[at - 1]!)) {
      this.fitEl.textContent = "A class cannot end below where it starts: that edit was not used.";
      return;
    }
    this.manual = next;
    this.method = "manual";
    this.recolour();
  }

  private renderClasses(): void {
    const k = this.breaks.length - 1;
    this.classTable.replaceChildren();
    this.histogramEl.replaceChildren();
    this.fitEl.textContent = "";
    if (k < 1) return;
    this.renderHistogram();
    if (this.method === "continuous") return;
    const { counts, outside, missing } = classCounts(this.shown, this.breaks);
    const colours = this.classColours();
    const rows: HTMLElement[] = [
      el("div", { class: "map-region-class head" }, [el("span", {}, [""]), el("span", {}, ["From"]), el("span", {}, ["To"]), el("span", { class: "num" }, ["Count"])]),
    ];
    for (let i = 0; i < k; i++) {
      const swatch = el("input", { type: "color", class: "map-region-swatch", value: colours[i] ?? "#888888", "aria-label": `Colour of class ${i + 1}` }) as HTMLInputElement;
      swatch.addEventListener("input", () => {
        this.colours[i] = swatch.value;
        this.options.onChange();
      });
      const edge = (at: number, label: string): HTMLInputElement => {
        const input = el("input", { class: "map-region-break", type: "text", value: tidy(this.breaks[at]!), "aria-label": `${label} of class ${i + 1}` }) as HTMLInputElement;
        input.addEventListener("change", () => this.editBreak(at, input.value));
        return input;
      };
      rows.push(el("div", { class: "map-region-class" }, [swatch, edge(i, "Start"), edge(i + 1, "End"), el("span", { class: "num" }, [counts[i]!.toLocaleString()])]));
    }
    this.classTable.replaceChildren(...rows);
    const fit = varianceFit(this.shown, this.breaks);
    const notes: string[] = [];
    if (Number.isFinite(fit)) notes.push(`These classes explain ${Math.round(fit * 100)}% of the variation between regions.`);
    if (outside > 0) notes.push(`${outside.toLocaleString()} values fall outside your breaks.`);
    if (missing > 0 && this.frames === 1) notes.push(`${missing.toLocaleString()} regions have no value.`);
    this.fitEl.textContent = notes.join(" ");
  }

  /** The values' spread with the breaks on it, to see what a method is doing. */
  private renderHistogram(): void {
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
    this.histogramEl.replaceChildren(svg);
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
    return `${label === undefined ? "" : `${label} · `}${this.valueName()} · ${method}${this.method === "continuous" ? "" : `, ${this.breaks.length - 1} classes`} · ${this.values.regionsMatched.toLocaleString()} of ${this.loaded.shapes.length.toLocaleString()} regions have rows${this.values.rowsUnmatched > 0 ? ` · ${this.values.rowsUnmatched.toLocaleString()} rows matched no region` : ""}`;
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
