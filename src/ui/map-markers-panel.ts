/**
 * Map page markers: an editable table of up to 100 points (symbol, colour, size,
 * label, latitude, longitude). Rows come from the Add markers window (pasted rows, a
 * CSV, a city), a blank row, or clicking the map. Coordinates that do not read are
 * marked and left off the map until fixed.
 */

import type { Cities } from "../data/cities.js";
import { parseLatitude, parseLongitude } from "../data/geo.js";
import {
  autoLabel,
  DEFAULT_MARKER_SIZE,
  MAX_MARKER_SIZE,
  MAX_MARKERS,
  MIN_MARKER_SIZE,
  normaliseSize,
  SHAPES,
  type MapMarker,
  type MarkerSymbol,
} from "../data/map-markers.js";
import { downloadCsv } from "./chart-export.js";
import { el } from "./dom.js";
import { openAddMarkers, type MarkerStyle } from "./map-add-dialog.js";
import { parseSvgSymbol, symbolSvg, type CustomSymbol } from "./map-symbols.js";

interface Row {
  label: string;
  lat: string;
  lon: string;
  symbol: MarkerSymbol;
  color: string;
  size: number;
}

export interface MarkersState {
  markers: MapMarker[];
  customs: CustomSymbol[];
}

export interface MarkersPanelOptions {
  /** Markers or symbols changed (valid markers only). */
  onChange(state: MarkersState): void;
  /** Click-to-add switched on or off. */
  onPick(on: boolean): void;
  onAction(message: string): void;
  datasetName(): string;
  /** The bundled world cities (loaded on first use). */
  cities(): Promise<Cities>;
}

export interface MarkersPanel {
  root: HTMLElement;
  set(state: MarkersState): void;
  /** Adds a marker at a clicked spot (click-to-add). */
  addAt(lon: number, lat: number): void;
  customs(): ReadonlyMap<string, CustomSymbol>;
  /** Opens the Add markers window, optionally with rows already pasted in. */
  openAdd(text?: string): void;
  /** Click-to-add on or off. */
  setPicking(on: boolean): void;
  /** Turn click-to-add off (the page was left). */
  stopPicking(): void;
  /** The size new markers get (the dock slider shows it). */
  size(): number;
  /** Resizes every marker and makes it the size for new ones. */
  setSize(size: number): void;
}

const SHAPE_NAMES: Record<string, string> = {
  circle: "Ring", dot: "Dot", x: "Cross", plus: "Plus", square: "Square", triangle: "Triangle", diamond: "Diamond", star: "Star", pin: "Pin",
};

export function createMarkersPanel(options: MarkersPanelOptions): MarkersPanel {
  let rows: Row[] = [];
  let customs = new Map<string, CustomSymbol>();
  // The style new markers get: the last one chosen in the Add window or the dock.
  let defaults: MarkerStyle = { symbol: "pin", color: "#dc2626", size: DEFAULT_MARKER_SIZE };
  let picking = false;

  const count = el("span", { class: "map-mk-count" });
  const addButton = el("button", { type: "button", class: "map-btn primary" }, ["Add markers…"]);
  const addRow = el("button", { type: "button", class: "map-btn" }, ["+ Row"]);
  const downloadButton = el("button", { type: "button", class: "map-btn" }, ["Download CSV"]);
  const clearButton = el("button", { type: "button", class: "map-btn" }, ["Clear"]);
  const svgInput = el("input", { type: "file", accept: ".svg,image/svg+xml", class: "hidden", "aria-label": "SVG symbol file" }) as HTMLInputElement;
  const body = el("tbody");
  const table = el("table", { class: "map-mk-table" }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["Symbol"]),
        el("th", {}, ["Colour"]),
        el("th", {}, ["Size"]),
        el("th", {}, ["Label"]),
        el("th", {}, ["Latitude"]),
        el("th", {}, ["Longitude"]),
        el("th", {}, [""]),
      ]),
    ]),
    body,
  ]);
  const hint = el("p", { class: "map-mk-hint" }, [
    "Edit any marker here. Paste rows anywhere in this panel to open Add markers with them. Up to 100 markers; degrees can be decimal (51.5074) or 51°30'26\"N.",
  ]);
  const root = el("details", { class: "map-markers", tabindex: "-1" }, [
    el("summary", {}, [el("span", { class: "map-mk-title" }, ["Markers"]), count]),
    el("div", { class: "map-mk-bar" }, [addButton, addRow, downloadButton, clearButton, svgInput]),
    hint,
    table,
  ]);

  // ------------------------------------------------------------------ model
  function valid(): MapMarker[] {
    const out: MapMarker[] = [];
    for (const row of rows) {
      const lat = parseLatitude(row.lat), lon = parseLongitude(row.lon);
      if (lat !== null && lon !== null) out.push({ label: row.label, lat, lon, symbol: row.symbol, color: row.color, size: row.size });
    }
    return out;
  }
  function emit(): void {
    count.textContent = `${valid().length} / ${MAX_MARKERS}`;
    options.onChange({ markers: valid(), customs: [...customs.values()] });
  }
  function fmt(v: number): string {
    return String(Math.round(v * 1e5) / 1e5);
  }
  function toRow(m: MapMarker): Row {
    return { label: m.label, lat: fmt(m.lat), lon: fmt(m.lon), symbol: m.symbol, color: m.color, size: m.size ?? DEFAULT_MARKER_SIZE };
  }
  function append(markers: readonly MapMarker[]): void {
    for (const m of autoLabel(markers, rows.length)) rows.push(toRow(m));
    root.open = true;
    render();
    emit();
  }
  function room(): number {
    return MAX_MARKERS - rows.length;
  }

  // ------------------------------------------------------------------ table
  function render(): void {
    body.replaceChildren(
      ...rows.map((row, i) => {
        const sym = el("button", { type: "button", class: "map-sym-btn", "aria-label": `Symbol for row ${i + 1}`, title: "Change the symbol" });
        sym.append(symbolSvg(row.symbol, row.color, customs));
        sym.addEventListener("click", () => openPalette(sym, (symbol) => { row.symbol = symbol; render(); emit(); }));
        const color = el("input", { type: "color", value: row.color, class: "map-color", "aria-label": `Colour for row ${i + 1}` }) as HTMLInputElement;
        color.addEventListener("input", () => { row.color = color.value; sym.replaceChildren(symbolSvg(row.symbol, row.color, customs)); emit(); });
        const text = (key: "label" | "lat" | "lon", aria: string, check: ((t: string) => number | null) | null): HTMLInputElement => {
          const input = el("input", { type: "text", value: row[key], "aria-label": `${aria}, row ${i + 1}`, class: `map-cell map-cell-${key}` }) as HTMLInputElement;
          const mark = (): void => { input.classList.toggle("invalid", check !== null && check(input.value) === null); };
          mark();
          input.addEventListener("input", () => { row[key] = input.value; mark(); emit(); });
          return input;
        };
        const size = el("input", {
          type: "number",
          min: String(MIN_MARKER_SIZE),
          max: String(MAX_MARKER_SIZE),
          step: "1",
          value: String(row.size),
          class: "map-cell map-cell-size",
          "aria-label": `Size in pixels, row ${i + 1}`,
        }) as HTMLInputElement;
        size.addEventListener("input", () => { row.size = normaliseSize(size.value, row.size); emit(); });
        size.addEventListener("change", () => { size.value = String(row.size); });
        const del = el("button", { type: "button", class: "map-del", "aria-label": `Remove row ${i + 1}`, title: "Remove" }, ["×"]);
        del.addEventListener("click", () => { rows.splice(i, 1); render(); emit(); });
        return el("tr", {}, [
          el("td", {}, [sym]),
          el("td", {}, [color]),
          el("td", {}, [size]),
          el("td", {}, [text("label", "Label", null)]),
          el("td", {}, [text("lat", "Latitude", parseLatitude)]),
          el("td", {}, [text("lon", "Longitude", parseLongitude)]),
          el("td", {}, [del]),
        ]);
      }),
    );
    table.classList.toggle("hidden", rows.length === 0);
    addRow.toggleAttribute("disabled", room() <= 0);
    addButton.toggleAttribute("disabled", room() <= 0);
  }

  // ------------------------------------------------------------------ symbol palette
  let palette: HTMLElement | null = null;
  function closePalette(): void {
    palette?.remove();
    palette = null;
  }
  function openPalette(anchor: HTMLElement, pick: (symbol: MarkerSymbol) => void): void {
    closePalette();
    const pop = el("div", { class: "map-palette", role: "dialog", "aria-label": "Choose a symbol" });
    const option = (symbol: MarkerSymbol, name: string): HTMLButtonElement => {
      const b = el("button", { type: "button", title: name, "aria-label": name });
      b.append(symbolSvg(symbol, "#374151", customs, 20));
      b.addEventListener("click", () => { pick(symbol); closePalette(); });
      return b;
    };
    for (const shape of SHAPES) pop.append(option(shape, SHAPE_NAMES[shape] ?? shape));
    for (const custom of customs.values()) pop.append(option(`svg:${custom.id}`, custom.name));
    const upload = el("button", { type: "button", class: "map-palette-upload" }, ["Upload SVG…"]);
    upload.addEventListener("click", () => {
      pendingPick = pick;
      svgInput.click();
    });
    pop.append(upload);
    anchor.after(pop);
    const away = (event: MouseEvent): void => {
      if (palette !== null && !palette.contains(event.target as Node) && event.target !== anchor) {
        closePalette();
        document.removeEventListener("mousedown", away);
      }
    };
    document.addEventListener("mousedown", away);
    palette = pop;
  }
  let pendingPick: ((symbol: MarkerSymbol) => void) | null = null;
  svgInput.addEventListener("change", async () => {
    const file = svgInput.files?.[0];
    svgInput.value = "";
    if (file === undefined) return;
    const parsed = parseSvgSymbol(await file.text(), file.name);
    if ("error" in parsed) {
      options.onAction(parsed.error);
      return;
    }
    customs.set(parsed.id, parsed);
    pendingPick?.(`svg:${parsed.id}`);
    pendingPick = null;
    closePalette();
    render();
    emit();
    options.onAction(`Added the symbol ${parsed.name}`);
  });

  // ------------------------------------------------------------------ input paths
  async function openAdd(text?: string): Promise<void> {
    if (room() <= 0) {
      options.onAction(`The map holds ${MAX_MARKERS} markers; remove one to add another.`);
      return;
    }
    const result = await openAddMarkers({
      existing: rows.length,
      style: defaults,
      customs,
      cities: options.cities,
      chooseSymbol: openPalette,
      text,
    });
    if (result === null) return;
    defaults = result.style;
    append(result.markers);
    const notes = [`Added ${result.markers.length} marker${result.markers.length === 1 ? "" : "s"}`];
    if (result.skipped) notes.push(`${result.skipped} row${result.skipped === 1 ? "" : "s"} without readable coordinates skipped`);
    if (result.over) notes.push(`${result.over} left out (the limit is ${MAX_MARKERS})`);
    options.onAction(notes.join("; "));
  }
  root.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    // One plain value pasted into a cell edits that cell; rows of cells open Add markers.
    if (!/[\t\n]/.test(text.trim()) && (event.target as HTMLElement).tagName === "INPUT") return;
    event.preventDefault();
    void openAdd(text);
  });
  addButton.addEventListener("click", () => void openAdd());
  downloadButton.addEventListener("click", () => {
    downloadCsv(`${options.datasetName() || "map"}-markers.csv`, [
      ["label", "lat", "lon", "symbol", "color", "size"],
      ...valid().map((m) => [m.label, String(m.lat), String(m.lon), m.symbol, m.color, String(m.size ?? DEFAULT_MARKER_SIZE)]),
    ]);
  });
  clearButton.addEventListener("click", () => {
    if (rows.length === 0) return;
    const before = rows;
    rows = [];
    render();
    emit();
    options.onAction(`Cleared ${before.length} markers`);
  });
  addRow.addEventListener("click", () => {
    if (room() <= 0) return;
    rows.push({ label: `Marker ${rows.length + 1}`, lat: "", lon: "", ...defaults });
    render();
    emit();
    body.querySelector<HTMLInputElement>("tr:last-child .map-cell-lat")?.focus();
  });

  function setPicking(on: boolean): void {
    picking = on;
    options.onPick(on);
  }

  render();
  count.textContent = `0 / ${MAX_MARKERS}`;
  return {
    root,
    set(state) {
      customs = new Map(state.customs.map((c) => [c.id, c]));
      rows = state.markers.slice(0, MAX_MARKERS).map(toRow);
      // Saved markers that share one size: the dock slider starts there.
      const sizes = new Set(rows.map((row) => row.size));
      if (sizes.size === 1) defaults = { ...defaults, size: rows[0]!.size };
      if (rows.length) root.open = true;
      render();
      count.textContent = `${valid().length} / ${MAX_MARKERS}`;
    },
    addAt(lon, lat) {
      if (room() <= 0) {
        options.onAction(`The map holds ${MAX_MARKERS} markers; remove one to add another.`);
        return;
      }
      rows.push({ label: `Marker ${rows.length + 1}`, lat: fmt(lat), lon: fmt(lon), ...defaults });
      root.open = true;
      render();
      emit();
    },
    customs: () => customs,
    openAdd(text) {
      void openAdd(text);
    },
    setPicking(on) {
      if (on !== picking) setPicking(on);
    },
    stopPicking() {
      if (picking) setPicking(false);
    },
    size: () => defaults.size,
    setSize(size) {
      defaults = { ...defaults, size };
      if (rows.length === 0) return;
      for (const row of rows) row.size = size;
      render();
      emit();
    },
  };
}
