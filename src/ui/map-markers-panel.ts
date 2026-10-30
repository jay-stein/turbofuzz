/**
 * Map page markers: an editable table of up to 100 points (symbol, colour, label,
 * latitude, longitude). Rows come from typing, pasting cells from a spreadsheet,
 * a CSV file, or clicking the map. Coordinates that do not read are marked and left
 * off the map until fixed.
 */

import { findCity, searchCities, type Cities } from "../data/cities.js";
import { parseLatitude, parseLongitude } from "../data/geo.js";
import {
  MAX_MARKERS,
  parseMarkers,
  SHAPES,
  type MapMarker,
  type MarkerSymbol,
} from "../data/map-markers.js";
import { downloadCsv } from "./chart-export.js";
import { el } from "./dom.js";
import { parseSvgSymbol, symbolSvg, type CustomSymbol } from "./map-symbols.js";

interface Row {
  label: string;
  lat: string;
  lon: string;
  symbol: MarkerSymbol;
  color: string;
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
  /** Turn click-to-add off (the page was left). */
  stopPicking(): void;
}

const SHAPE_NAMES: Record<string, string> = {
  circle: "Ring", dot: "Dot", x: "Cross", plus: "Plus", square: "Square", triangle: "Triangle", diamond: "Diamond", star: "Star", pin: "Pin",
};

export function createMarkersPanel(options: MarkersPanelOptions): MarkersPanel {
  let rows: Row[] = [];
  let customs = new Map<string, CustomSymbol>();
  let defaults: { symbol: MarkerSymbol; color: string } = { symbol: "pin", color: "#dc2626" };
  let picking = false;

  const count = el("span", { class: "map-mk-count" });
  const addRow = el("button", { type: "button", class: "map-btn" }, ["+ Row"]);
  const pickButton = el("button", { type: "button", class: "map-btn", "aria-pressed": "false", title: "Each click on the map adds a marker there; click again to stop" }, ["Click map to add"]);
  const pasteButton = el("button", { type: "button", class: "map-btn", title: "Add rows from the clipboard (cells copied from a spreadsheet, or CSV text)" }, ["Paste rows"]);
  const csvInput = el("input", { type: "file", accept: ".csv,.tsv,.txt,text/csv", class: "hidden", "aria-label": "Markers CSV file" }) as HTMLInputElement;
  const uploadButton = el("button", { type: "button", class: "map-btn" }, ["Upload CSV…"]);
  const downloadButton = el("button", { type: "button", class: "map-btn" }, ["Download CSV"]);
  const clearButton = el("button", { type: "button", class: "map-btn" }, ["Clear"]);
  const defSymbol = el("button", { type: "button", class: "map-sym-btn", "aria-label": "Symbol for new markers", title: "Symbol for new markers" });
  const defColor = el("input", { type: "color", value: defaults.color, class: "map-color", "aria-label": "Colour for new markers" }) as HTMLInputElement;
  const svgInput = el("input", { type: "file", accept: ".svg,image/svg+xml", class: "hidden", "aria-label": "SVG symbol file" }) as HTMLInputElement;
  const cityInput = el("input", {
    type: "search",
    class: "map-cell map-city-search",
    placeholder: "Find a city to add…",
    "aria-label": "Find a city to add as a marker",
    autocomplete: "off",
  }) as HTMLInputElement;
  const cityList = el("ul", { class: "map-city-list hidden", role: "listbox", "aria-label": "Matching cities" });
  const cityBox = el("span", { class: "map-city" }, [cityInput, cityList]);
  const body = el("tbody");
  const table = el("table", { class: "map-mk-table" }, [
    el("thead", {}, [el("tr", {}, [el("th", {}, ["Symbol"]), el("th", {}, ["Colour"]), el("th", {}, ["Label"]), el("th", {}, ["Latitude"]), el("th", {}, ["Longitude"]), el("th", {}, [""])])]),
    body,
  ]);
  const hint = el("p", { class: "map-mk-hint" }, [
    "Paste cells from a spreadsheet anywhere in this panel (label, latitude, longitude; symbol and colour optional), upload a CSV, find a city, or click the map. A list of city names alone also works. Up to 100 markers. Degrees can be decimal (51.5074) or 51°30'26\"N.",
  ]);
  const root = el("details", { class: "map-markers", tabindex: "-1" }, [
    el("summary", {}, [el("span", { class: "map-mk-title" }, ["Markers"]), count]),
    el("div", { class: "map-mk-bar" }, [
      cityBox, addRow, pickButton, pasteButton, uploadButton, downloadButton, clearButton,
      el("span", { class: "grow" }),
      el("span", { class: "map-mk-new" }, ["New markers:"]), defSymbol, defColor,
      csvInput, svgInput,
    ]),
    hint,
    table,
  ]);

  // ------------------------------------------------------------------ model
  function valid(): MapMarker[] {
    const out: MapMarker[] = [];
    for (const row of rows) {
      const lat = parseLatitude(row.lat), lon = parseLongitude(row.lon);
      if (lat !== null && lon !== null) out.push({ label: row.label, lat, lon, symbol: row.symbol, color: row.color });
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
  function append(markers: readonly MapMarker[]): void {
    for (const m of markers) rows.push({ label: m.label, lat: fmt(m.lat), lon: fmt(m.lon), symbol: m.symbol, color: m.color });
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
        const del = el("button", { type: "button", class: "map-del", "aria-label": `Remove row ${i + 1}`, title: "Remove" }, ["×"]);
        del.addEventListener("click", () => { rows.splice(i, 1); render(); emit(); });
        return el("tr", {}, [
          el("td", {}, [sym]),
          el("td", {}, [color]),
          el("td", {}, [text("label", "Label", null)]),
          el("td", {}, [text("lat", "Latitude", parseLatitude)]),
          el("td", {}, [text("lon", "Longitude", parseLongitude)]),
          el("td", {}, [del]),
        ]);
      }),
    );
    table.classList.toggle("hidden", rows.length === 0);
    addRow.toggleAttribute("disabled", room() <= 0);
    defSymbol.replaceChildren(symbolSvg(defaults.symbol, defaults.color, customs));
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
  async function addText(text: string, from: string): Promise<void> {
    const cities = await options.cities().catch(() => null);
    const lookup = cities === null ? undefined : (name: string) => findCity(cities, name);
    const parsed = parseMarkers(text, defaults, room(), [...customs.keys()], lookup);
    if (parsed.markers.length === 0) {
      options.onAction(`No markers in ${from}: each row needs a latitude and a longitude.`);
      return;
    }
    append(parsed.markers);
    const notes = [`Added ${parsed.markers.length} marker${parsed.markers.length === 1 ? "" : "s"} from ${from}`];
    if (parsed.skipped.length) notes.push(`${parsed.skipped.length} row${parsed.skipped.length === 1 ? "" : "s"} without readable coordinates skipped`);
    if (parsed.over) notes.push(`${parsed.over} left out (the limit is ${MAX_MARKERS})`);
    options.onAction(notes.join("; "));
  }
  root.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    // One plain value pasted into a cell edits that cell; rows of cells add markers.
    if (!/[\t\n]/.test(text.trim()) && (event.target as HTMLElement).tagName === "INPUT") return;
    event.preventDefault();
    void addText(text, "the clipboard");
  });
  pasteButton.addEventListener("click", async () => {
    try {
      await addText(await navigator.clipboard.readText(), "the clipboard");
    } catch {
      options.onAction("The browser did not allow reading the clipboard; click in the Markers panel and press Ctrl+V instead.");
    }
  });
  uploadButton.addEventListener("click", () => csvInput.click());
  csvInput.addEventListener("change", async () => {
    const file = csvInput.files?.[0];
    csvInput.value = "";
    if (file !== undefined) await addText(await file.text(), file.name);
  });
  downloadButton.addEventListener("click", () => {
    downloadCsv(`${options.datasetName() || "map"}-markers.csv`, [
      ["label", "lat", "lon", "symbol", "color"],
      ...valid().map((m) => [m.label, String(m.lat), String(m.lon), m.symbol, m.color]),
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
    rows.push({ label: "", lat: "", lon: "", symbol: defaults.symbol, color: defaults.color });
    render();
    emit();
    body.querySelector<HTMLInputElement>("tr:last-child .map-cell-label")?.focus();
  });
  // City search: suggestions as you type; Enter or a click adds the city as a marker.
  let cityHits: { name: string; lat: number; lon: number }[] = [];
  async function suggest(): Promise<void> {
    const query = cityInput.value;
    const cities = await options.cities().catch(() => null);
    if (cities === null || query !== cityInput.value) return;
    cityHits = searchCities(cities, query, 8);
    cityList.replaceChildren(
      ...cityHits.map((hit, i) => {
        const item = el("li", { role: "option" }, [
          el("span", {}, [hit.name]),
          el("small", {}, [`${hit.lat.toFixed(2)}, ${hit.lon.toFixed(2)}`]),
        ]);
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          addCity(i);
        });
        return item;
      }),
    );
    cityList.classList.toggle("hidden", cityHits.length === 0);
  }
  function addCity(i: number): void {
    const hit = cityHits[i];
    if (hit === undefined) return;
    if (room() <= 0) {
      options.onAction(`The map holds ${MAX_MARKERS} markers; remove one to add another.`);
      return;
    }
    rows.push({ label: hit.name, lat: fmt(hit.lat), lon: fmt(hit.lon), symbol: defaults.symbol, color: defaults.color });
    cityInput.value = "";
    cityHits = [];
    cityList.classList.add("hidden");
    render();
    emit();
    options.onAction(`Added ${hit.name}`);
  }
  cityInput.addEventListener("input", () => void suggest());
  cityInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCity(0);
    } else if (event.key === "Escape") cityList.classList.add("hidden");
  });
  cityInput.addEventListener("blur", () => cityList.classList.add("hidden"));

  function setPicking(on: boolean): void {
    picking = on;
    pickButton.setAttribute("aria-pressed", String(on));
    options.onPick(on);
  }
  pickButton.addEventListener("click", () => setPicking(!picking));
  defSymbol.addEventListener("click", () => openPalette(defSymbol, (symbol) => { defaults = { ...defaults, symbol }; render(); }));
  defColor.addEventListener("input", () => { defaults = { ...defaults, color: defColor.value }; render(); });

  render();
  count.textContent = `0 / ${MAX_MARKERS}`;
  return {
    root,
    set(state) {
      customs = new Map(state.customs.map((c) => [c.id, c]));
      rows = state.markers.slice(0, MAX_MARKERS).map((m) => ({ label: m.label, lat: fmt(m.lat), lon: fmt(m.lon), symbol: m.symbol, color: m.color }));
      if (rows.length) root.open = true;
      render();
      count.textContent = `${valid().length} / ${MAX_MARKERS}`;
    },
    addAt(lon, lat) {
      if (room() <= 0) {
        options.onAction(`The map holds ${MAX_MARKERS} markers; remove one to add another.`);
        return;
      }
      rows.push({ label: `Marker ${rows.length + 1}`, lat: fmt(lat), lon: fmt(lon), symbol: defaults.symbol, color: defaults.color });
      root.open = true;
      render();
      emit();
    },
    customs: () => customs,
    stopPicking() {
      if (picking) setPicking(false);
    },
  };
}
