/**
 * Map page: the map card at full width, plus the person's own markers.
 * The map itself (points, one dot per place, heat grid, boundary files, zoom, brush to filter) is the
 * Chart view's map card, fed the same data, drawn over the bundled land and water; this page adds the room and the
 * markers and cities layer. Nothing is fetched. Markers are kept per dataset in this browser only (IndexedDB).
 */

import { detectGeoPair } from "../data/geo.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ChartCard, ChartCardConfig } from "./chart-card.js";
import { el, svgIcon } from "./dom.js";
import { loadCities } from "../data/cities.js";
import { cityOverlay } from "./map-cities.js";
import { createMarkersPanel, type MarkersState } from "./map-markers-panel.js";
import { MAX_MARKER_SIZE, MIN_MARKER_SIZE } from "../data/map-markers.js";
import { drawSymbol } from "./map-symbols.js";

export interface MapPageOptions {
  /** A map card fed by the Chart panel's data (see ChartsPanel.createDetachedCard). */
  createCard(root: HTMLElement, preset: Partial<ChartCardConfig>): ChartCard;
  releaseCard(card: ChartCard): void;
  datasetName(): string;
  onAction(message: string): void;
}

export interface MapPageHandle {
  setData(metas: readonly ColumnMeta[], rowCount: number): void;
  shown(): void;
  hide(): void;
  /** Open on these coordinate columns (from a Chart map card). */
  open(preset: Partial<ChartCardConfig>): void;
}

export function createMapPage(host: HTMLElement, options: MapPageOptions): MapPageHandle {
  host.classList.add("map-page");
  const sub = el("span", { class: "map-sub" });
  // What kind of map: pictures, as the Chart page has for its chart types.
  type MapType = "markers" | "heat" | "regions";
  const typeButtons = new Map<MapType, HTMLButtonElement>();
  const typeOf = (mode: string | undefined): MapType => (mode === "heat" ? "heat" : mode === "regions" ? "regions" : "markers");
  const syncType = (mode: string | undefined): void => {
    for (const [type, button] of typeButtons) {
      const on = type === typeOf(mode);
      button.classList.toggle("active", on);
      button.setAttribute("aria-checked", String(on));
    }
  };
  const typePicker = el("div", { class: "map-types", role: "radiogroup", "aria-label": "Kind of map" });
  for (const [type, label, title, picture] of [
    ["markers", "Markers", "A dot for each place or row, sized and coloured by your data", '<circle cx="8" cy="15" r="3.2"/><circle cx="15" cy="8" r="4.6"/><circle cx="18" cy="17" r="2.2"/><circle cx="6.5" cy="7" r="1.8"/>'],
    ["heat", "Heat grid", "A grid over the map, each cell coloured by the rows in it", '<rect x="3" y="3" width="5.5" height="5.5" opacity=".3"/><rect x="9.25" y="3" width="5.5" height="5.5" opacity=".6"/><rect x="15.5" y="3" width="5.5" height="5.5" opacity=".3"/><rect x="3" y="9.25" width="5.5" height="5.5" opacity=".6"/><rect x="9.25" y="9.25" width="5.5" height="5.5"/><rect x="15.5" y="9.25" width="5.5" height="5.5" opacity=".6"/><rect x="3" y="15.5" width="5.5" height="5.5" opacity=".15"/><rect x="9.25" y="15.5" width="5.5" height="5.5" opacity=".6"/><rect x="15.5" y="15.5" width="5.5" height="5.5" opacity=".3"/>'],
    ["regions", "Choropleth", "Regions from a boundary file, each coloured by a value", '<path d="M3 4l7-1 2 6-4 4-5-2z" opacity=".35"/><path d="M12 3l9 2-1 7-7-1-1.5-2z" opacity=".95"/><path d="M3 12.5l5 2 1 6.5-5-1z" opacity=".6"/><path d="M9.5 14.5l3.5-2.3 7 1-1 7-8.5.8z" opacity=".75"/>'],
  ] as const) {
    const button = el("button", { class: "map-type", type: "button", role: "radio", title, "aria-checked": "false" }, [
      svgIcon(picture, "map-type-icon"),
      el("span", {}, [label]),
    ]) as HTMLButtonElement;
    button.addEventListener("click", () => card?.setMapMode(type === "markers" ? "places" : type));
    typeButtons.set(type, button);
    typePicker.append(button);
  }
  const exportButton = el("button", { class: "ghost map-export", type: "button", title: "Save this map as an interactive web page or a PNG" }, ["Export map ▾"]) as HTMLButtonElement;
  exportButton.addEventListener("click", () => card?.openExport(exportButton));
  const toolbar = el("div", { class: "map-toolbar" }, [
    el("h2", { class: "map-title" }, ["Map"]),
    typePicker,
    sub,
    el("span", { class: "grow" }),
    exportButton,
  ]);
  // Typed where it reads, and carried onto what is exported.
  const titleInput = el("input", { class: "map-title-input", type: "text", maxlength: "160", placeholder: "Add a title for this map…", "aria-label": "Map title", spellcheck: "true" }) as HTMLInputElement;
  titleInput.addEventListener("input", () => card?.setMapTitle(titleInput.value));

  // The dock floats on the map itself, so its layers and marker tools are in view
  // whenever the map is: cities, marker size, click-to-add and the Add window.
  const citiesToggle = el("input", { type: "checkbox", role: "switch", class: "map-switch-input", "aria-label": "Show world cities" }) as HTMLInputElement;
  const sizeSlider = el("input", {
    type: "range",
    min: String(MIN_MARKER_SIZE),
    max: String(MAX_MARKER_SIZE),
    step: "1",
    "aria-label": "Size of your markers",
  }) as HTMLInputElement;
  const sizeOut = el("output", { class: "map-size-out" });
  const sizeLabel = el("label", { class: "map-dock-item map-dock-size" }, [el("span", {}, ["Size"]), sizeSlider, sizeOut]);
  const citySize = el("input", { type: "range", min: "8", max: "20", step: "1", "aria-label": "Size of city names" }) as HTMLInputElement;
  const citySizeOut = el("output", { class: "map-size-out" });
  const cityInside = el("input", { type: "checkbox", "aria-label": "Only show city names inside the boundaries" }) as HTMLInputElement;
  const cityInsideLabel = el("label", { class: "map-dock-item hidden", title: "Hide city names that fall outside the regions you loaded" }, [cityInside, el("span", {}, ["Only inside boundaries"])]);
  const citySizeLabel = el("label", { class: "map-dock-item map-dock-size hidden", title: "How big the city names are; bigger names leave room for fewer of them" }, [
    el("span", {}, ["Text"]),
    citySize,
    citySizeOut,
  ]);
  const pickToggle = el(
    "button",
    { type: "button", class: "map-dock-btn", "aria-pressed": "false", title: "Each click on the map adds a marker there; click again to stop" },
    ["Click map to add"],
  ) as HTMLButtonElement;
  const addMarkers = el("button", { type: "button", class: "map-dock-btn primary", title: "Paste rows, load a CSV or find a city" }, ["+ Add markers…"]);
  const fitMarkers = el("button", { type: "button", class: "map-dock-btn", title: "Zoom to show everything plotted and all your markers (the Cities layer is ignored)" }, ["Fit all"]) as HTMLButtonElement;
  const dock = el("div", { class: "map-dock", role: "toolbar", "aria-label": "Map layers and markers" }, [
    el("label", { class: "map-dock-item map-switch", title: "The largest cities in view, with names (bundled, offline)" }, [
      citiesToggle,
      el("span", { class: "map-switch-track", "aria-hidden": "true" }),
      el("span", {}, ["Cities"]),
    ]),
    citySizeLabel,
    cityInsideLabel,
    el("span", { class: "map-dock-sep", "aria-hidden": "true" }),
    // Everything about markers you place yourself sits together; the dots from your data are
    // sized in the Dots row under the map's settings, and this slider does not touch them.
    el("div", { class: "map-dock-group", role: "group", "aria-label": "Your markers" }, [
      el("span", { class: "map-dock-caption" }, ["Your markers"]),
      sizeLabel,
      pickToggle,
      addMarkers,
    ]),
    el("span", { class: "map-dock-sep", "aria-hidden": "true" }),
    fitMarkers,
  ]);
  const empty = el("div", { class: "map-empty hidden" });
  const cardHost = el("section", { class: "map-card" });
  let markerState: MarkersState = { markers: [], customs: [] };
  const markersPanel = createMarkersPanel({
    onChange(state) {
      markerState = state;
      syncSize();
      applyMarkers();
      saveMarkers();
    },
    onPick(on) {
      pickToggle.setAttribute("aria-pressed", String(on));
      card?.setMapPicker(on ? (lon, lat) => markersPanel.addAt(lon, lat) : null);
      if (on) options.onAction("Click the map to add markers; click “Click map to add” again to stop");
    },
    onAction: options.onAction,
    datasetName: options.datasetName,
    cities: loadCities,
  });
  // The map comes first; the marker table for editing sits under it.
  host.append(toolbar, titleInput, empty, cardHost, markersPanel.root);
  const syncSize = (): void => {
    sizeSlider.value = String(markersPanel.size());
    sizeOut.textContent = `${markersPanel.size()}px`;
    // With no markers there is nothing for it to size.
    const none = markerState.markers.length === 0;
    sizeSlider.disabled = none;
    sizeLabel.classList.toggle("map-dock-off", none);
    sizeLabel.title = none ? "Add a marker first: this sizes the markers you add" : "Resize every marker you added; new markers get this size too. The dots from your data are sized under the map's settings (Dots).";
  };
  syncSize();
  sizeSlider.addEventListener("input", () => {
    markersPanel.setSize(Number(sizeSlider.value));
    syncSize();
  });
  pickToggle.addEventListener("click", () => markersPanel.setPicking(pickToggle.getAttribute("aria-pressed") !== "true"));
  addMarkers.addEventListener("click", () => markersPanel.openAdd());
  fitMarkers.addEventListener("click", () => card?.fitMapAll());
  // Rows pasted anywhere on the page (not into a field) open Add markers with them.
  document.addEventListener("paste", (event) => {
    if (!visible || document.querySelector(".modal-overlay") !== null) return;
    const target = event.target as HTMLElement;
    if (target.closest?.("input, textarea, select, [contenteditable=true], .map-markers") != null) return;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.trim() === "") return;
    event.preventDefault();
    markersPanel.openAdd(text);
  });

  let metas: readonly ColumnMeta[] = [];
  let rowCount = 0;
  let card: ChartCard | null = null;
  let visible = false;
  let datasetKey = "";
  let pending: Partial<ChartCardConfig> | null = null;

  function syncCityInside(): void {
    cityInsideLabel.classList.toggle("hidden", !citiesToggle.checked || card?.mapRegions?.ready !== true);
  }

  let noCoordinates = false;
  let regionsShowing = false;
  function syncEmpty(): void {
    empty.classList.toggle("hidden", !noCoordinates || regionsShowing);
  }

  function coordinateNames(config: ChartCardConfig): string {
    const lat = metas[config.y]?.name, lon = metas[config.x]?.name;
    return lat !== undefined && lon !== undefined ? `${lat} / ${lon}` : "";
  }

  function ensureCard(): void {
    const geo = detectGeoPair(metas, rowCount);
    const inRange = (i: number | undefined): boolean => i !== undefined && i >= 0 && i < metas.length;
    // No coordinate columns still gives a map: the basemap and markers.
    const valid = (config: Partial<ChartCardConfig>): boolean =>
      (inRange(config.x) && inRange(config.y)) || (config.x === -1 && config.y === -1);
    const auto: Partial<ChartCardConfig> = geo === null ? { x: -1, y: -1 } : { x: geo.lon, y: geo.lat };
    if (card !== null && !valid(card.getConfig())) {
      options.releaseCard(card);
      card = null;
      cardHost.replaceChildren();
    }
    if (card !== null && pending !== null && valid(pending)) card.applyConfig({ ...card.getConfig(), ...pending, kind: "map" });
    // A table that gained coordinate columns moves off the empty map.
    else if (card !== null && card.getConfig().x === -1 && geo !== null) card.applyConfig({ ...card.getConfig(), ...auto });
    if (card === null) {
      card = options.createCard(cardHost, { ...(pending !== null && valid(pending) ? pending : auto), kind: "map" });
      card.canvasHost.prepend(dock);
      card.onMapModeChange = syncType;
      syncType(card.mapMode);
      card.onRegionsChange = (showing) => {
        regionsShowing = showing;
        syncEmpty();
        syncCityInside();
      };
      applyMarkers();
      void applyCities();
    }
    pending = null;
    const names = coordinateNames(card.getConfig());
    noCoordinates = names === "";
    syncEmpty();
    if (names === "") {
      empty.replaceChildren(
        el("p", {}, [
          "No latitude and longitude columns found, so the map shows your markers only. To plot rows, the table needs two number columns in degrees: a latitude (-90 to 90) and a longitude (-180 to 180), found by name (lat, latitude, lon, lng, longitude) or by range. A table of named places can still be mapped: choose Choropleth above and load a boundary file.",
        ]),
      );
    }
    sub.textContent = names;
  }

  async function applyCities(): Promise<void> {
    citySizeLabel.classList.toggle("hidden", !citiesToggle.checked);
    syncCityInside();
    if (!citiesToggle.checked) {
      card?.setMapOverlay(null);
      return;
    }
    const cities = await loadCities().catch(() => null);
    if (cities !== null && citiesToggle.checked) {
      // Worked out once per boundary file: which of the thousands of cities fall inside it.
      let inside: { version: number; marks: Uint8Array } | null = null;
      const allowed = (): ((index: number) => boolean) | null => {
        const regions = card?.mapRegions;
        if (!cityInside.checked || regions === null || regions === undefined || !regions.ready) return null;
        if (inside === null || inside.version !== regions.version) {
          const marks = new Uint8Array(cities.names.length);
          for (let i = 0; i < marks.length; i++) marks[i] = regions.contains(cities.lon[i]!, cities.lat[i]!) ? 1 : 0;
          inside = { version: regions.version, marks };
        }
        const { marks } = inside;
        return (index) => marks[index] === 1;
      };
      card?.setMapOverlay(cityOverlay(cities, () => markerState.markers, () => Number(citySize.value), allowed));
    }
  }

  function applyMarkers(): void {
    const customs = markersPanel.customs();
    card?.setMapMarkers(
      markerState.markers.map((m) => ({
        lon: m.lon,
        lat: m.lat,
        label: m.label,
        size: m.size,
        draw: (ctx, x, y, r) => drawSymbol(ctx, m.symbol, x, y, r, m.color, customs),
      })),
    );
  }

  function saveMarkers(): void {
    if (datasetKey === "") return;
    const key = datasetKey;
    void store().then((db) => (markerState.markers.length || markerState.customs.length ? db?.putMarkers({ key, ...markerState }) : db?.removeMarkers(key)));
  }

  citySize.value = "11";
  try {
    citiesToggle.checked = localStorage.getItem("turbofuzz.map.cities") === "1";
    citySize.value = localStorage.getItem("turbofuzz.map.citySize") ?? "11";
  } catch {
    // Storage blocked: cities start off.
  }
  const syncCitySize = (): void => {
    citySizeOut.textContent = `${citySize.value}px`;
  };
  syncCitySize();
  try {
    cityInside.checked = localStorage.getItem("turbofuzz.map.cityInside") === "1";
  } catch {
    // Storage blocked: it starts off.
  }
  cityInside.addEventListener("change", () => {
    try {
      localStorage.setItem("turbofuzz.map.cityInside", cityInside.checked ? "1" : "0");
    } catch {
      // Not remembered; the box still works.
    }
    void applyCities();
  });
  citySize.addEventListener("input", () => {
    syncCitySize();
    try {
      localStorage.setItem("turbofuzz.map.citySize", citySize.value);
    } catch {
      // Not remembered; the slider still works.
    }
    void applyCities();
  });
  citiesToggle.addEventListener("change", () => {
    try {
      localStorage.setItem("turbofuzz.map.cities", citiesToggle.checked ? "1" : "0");
    } catch {
      // Not remembered; the toggle still works.
    }
    void applyCities();
  });

  return {
    setData(next, rows) {
      metas = next;
      rowCount = rows;
      const key = options.datasetName();
      if (key !== datasetKey) {
        datasetKey = key;
        titleInput.value = "";
        card?.setMapTitle("");
        markersPanel.set({ markers: [], customs: [] });
        markerState = { markers: [], customs: [] };
        syncSize();
        applyMarkers();
        if (key !== "") {
          void store().then(async (db) => {
            const saved = await db?.getMarkers(key).catch(() => undefined);
            if (saved === undefined || key !== datasetKey) return;
            markerState = { markers: saved.markers, customs: saved.customs };
            markersPanel.set(markerState);
            syncSize();
            applyMarkers();
          });
        }
      }
      if (visible) ensureCard();
    },
    shown() {
      visible = true;
      ensureCard();
      card?.repaint();
    },
    hide() {
      visible = false;
      markersPanel.stopPicking();
    },
    open(preset) {
      pending = preset;
      if (visible) ensureCard();
    },
  };
}

// ------------------------------------------------------------------ IndexedDB
interface SavedMarkers extends MarkersState {
  key: string;
}

interface MarkerStore {
  getMarkers(key: string): Promise<SavedMarkers | undefined>;
  putMarkers(entry: SavedMarkers): Promise<void>;
  removeMarkers(key: string): Promise<void>;
}

let storePromise: Promise<MarkerStore | null> | null = null;

/**
 * Markers per dataset name, in this browser only; null when IndexedDB is blocked. The database keeps the "backgrounds" store it was
 * created with (pictures were once kept there): dropping it would need a version bump for nothing.
 */
function store(): Promise<MarkerStore | null> {
  storePromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open("turbofuzz.map", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("backgrounds", { keyPath: "key" });
        request.result.createObjectStore("markers", { keyPath: "key" });
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        const run = <T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
          new Promise((done, fail) => {
            const req = work(db.transaction("markers", mode).objectStore("markers"));
            req.onsuccess = () => done(req.result);
            req.onerror = () => fail(req.error);
          });
        resolve({
          getMarkers: (key) => run("readonly", (s) => s.get(key) as IDBRequest<SavedMarkers | undefined>),
          putMarkers: async (entry) => {
            await run("readwrite", (s) => s.put(entry));
          },
          removeMarkers: async (key) => {
            await run("readwrite", (s) => s.delete(key));
          },
        });
      };
    } catch {
      resolve(null);
    }
  });
  return storePromise;
}
