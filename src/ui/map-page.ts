/**
 * Map page: the map card at full width, plus the person's own background picture.
 * The map itself (points, heat grid, boundary files, zoom, brush to filter) is the
 * Chart view's map card, fed the same data; this page adds the room and the
 * background: a local JPG/PNG/WebP placed by a world file, as the whole world, or by
 * typed edges. Nothing is fetched: the file is read on the device and drawn on the
 * canvas, and it is kept per dataset in this browser only (IndexedDB).
 */

import { detectGeoPair } from "../data/geo.js";
import {
  parseWorldFile,
  placementProblem,
  WHOLE_WORLD,
  type MapPlacement,
  type MapProjection,
} from "../data/map-background.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ChartCard, ChartCardConfig, MapBackgroundImage } from "./chart-card.js";
import { el } from "./dom.js";
import { loadCities } from "../data/cities.js";
import { cityOverlay } from "./map-cities.js";
import { createMarkersPanel, type MarkersState } from "./map-markers-panel.js";
import { drawSymbol } from "./map-symbols.js";

export interface MapPageOptions {
  /** A map card fed by the Chart panel's data (see ChartsPanel.createDetachedCard). */
  createCard(root: HTMLElement, preset: Partial<ChartCardConfig>): ChartCard;
  releaseCard(card: ChartCard): void;
  datasetName(): string;
  onAction(message: string): void;
  openGuide(): void;
}

export interface MapPageHandle {
  setData(metas: readonly ColumnMeta[], rowCount: number): void;
  shown(): void;
  hide(): void;
  /** Open on these coordinate columns (from a Chart map card). */
  open(preset: Partial<ChartCardConfig>): void;
}

type PlaceMode = "world" | "file" | "edges";

/** What is remembered per dataset: the picture itself and how it is placed. */
interface SavedBackground {
  key: string;
  file: Blob;
  name: string;
  worldFile: string | null;
  mode: PlaceMode;
  placement: MapPlacement;
  opacity: number;
  grey: boolean;
  outline: boolean;
  attribution: string;
}

/** Longest edge kept in memory; larger pictures are scaled down on load. */
const MAX_EDGE = 8192;
/** The greyscale copy is smaller: it is only ever drawn faded under the data. */
const GREY_EDGE = 4096;
const IMAGE_TYPES = /\.(jpe?g|png|webp)$/i;
const WORLD_TYPES = /\.(jgw|pgw|wld|jpgw|pngw|webpw|tfw)$/i;

export function createMapPage(host: HTMLElement, options: MapPageOptions): MapPageHandle {
  host.classList.add("map-page");
  const fileInput = el("input", {
    type: "file",
    accept: ".jpg,.jpeg,.png,.webp,.jgw,.pgw,.wld,.jpgw,.pngw,.webpw,.tfw",
    multiple: "",
    class: "hidden",
    "aria-label": "Background image and world file",
  }) as HTMLInputElement;
  const loadButton = el("button", { type: "button", class: "map-btn primary", "data-ref": "load" }, ["Background image…"]);
  const guideButton = el("button", { type: "button", class: "map-btn link" }, ["Get an offline map"]);
  const citiesToggle = el("input", { type: "checkbox", "aria-label": "Show world cities" }) as HTMLInputElement;
  const citiesLabel = el("label", { class: "map-field", title: "The largest cities in view, with names (bundled, offline)" }, [citiesToggle, el("span", {}, ["Cities"])]);
  const sub = el("span", { class: "map-sub" });
  const toolbar = el("div", { class: "map-toolbar" }, [
    el("h2", { class: "map-title" }, ["Map"]),
    sub,
    el("span", { class: "grow" }),
    citiesLabel,
    guideButton,
    loadButton,
    fileInput,
  ]);

  // Background controls, shown once a picture is loaded.
  const bgName = el("span", { class: "map-bg-name" });
  const modeSeg = el("div", { class: "map-seg", role: "group", "aria-label": "Place the picture" });
  const modeButtons: Record<PlaceMode, HTMLButtonElement> = {
    world: el("button", { type: "button", "data-mode": "world", title: "The picture covers the whole world: -180 to 180, -90 to 90" }, ["Whole world"]),
    file: el("button", { type: "button", "data-mode": "file", title: "Edges from the world file (.jgw, .pgw, .wld) loaded with the picture" }, ["World file"]),
    edges: el("button", { type: "button", "data-mode": "edges", title: "Type the picture's west, east, south and north edges" }, ["Edges"]),
  };
  modeSeg.append(modeButtons.world, modeButtons.file, modeButtons.edges);
  const edgeInput = (label: string): HTMLInputElement =>
    el("input", { type: "number", step: "any", class: "map-edge", "aria-label": `${label} edge in degrees`, placeholder: label }) as HTMLInputElement;
  const edges = { west: edgeInput("West"), east: edgeInput("East"), south: edgeInput("South"), north: edgeInput("North") };
  const projSelect = el("select", { class: "map-select", "aria-label": "Projection of the picture" }, [
    el("option", { value: "plate" }, ["Plate carrée (latitude even)"]),
    el("option", { value: "mercator" }, ["Web Mercator (web map screenshots)"]),
  ]) as HTMLSelectElement;
  const opacity = el("input", { type: "range", min: "10", max: "100", step: "5", value: "80", "aria-label": "Picture opacity" }) as HTMLInputElement;
  const grey = el("input", { type: "checkbox", "aria-label": "Greyscale" }) as HTMLInputElement;
  const outline = el("input", { type: "checkbox", "aria-label": "Coastlines and borders on top" }) as HTMLInputElement;
  const attribution = el("input", {
    type: "text",
    class: "map-attrib",
    placeholder: "Credit, e.g. © OpenStreetMap contributors",
    "aria-label": "Credit shown on the map",
  }) as HTMLInputElement;
  const removeButton = el("button", { type: "button", class: "map-btn" }, ["Remove"]);
  const problem = el("div", { class: "map-problem", role: "status" });
  const label = (text: string, control: HTMLElement): HTMLElement => el("label", { class: "map-field" }, [el("span", {}, [text]), control]);
  const bgPanel = el("div", { class: "map-bg hidden", "aria-label": "Background picture" }, [
    el("div", { class: "map-bg-row" }, [
      bgName,
      modeSeg,
      el("span", { class: "map-edges" }, [edges.west, edges.east, edges.south, edges.north]),
      label("Projection", projSelect),
    ]),
    el("div", { class: "map-bg-row" }, [
      label("Opacity", opacity),
      label("Greyscale", grey),
      label("Outline on top", outline),
      attribution,
      el("span", { class: "grow" }),
      removeButton,
    ]),
    problem,
  ]);
  const empty = el("div", { class: "map-empty hidden" });
  const cardHost = el("section", { class: "map-card" });
  let markerState: MarkersState = { markers: [], customs: [] };
  const markersPanel = createMarkersPanel({
    onChange(state) {
      markerState = state;
      applyMarkers();
      saveMarkers();
    },
    onPick(on) {
      card?.setMapPicker(on ? (lon, lat) => markersPanel.addAt(lon, lat) : null);
      if (on) options.onAction("Click the map to add markers; click “Click map to add” again to stop");
    },
    onAction: options.onAction,
    datasetName: options.datasetName,
    cities: loadCities,
  });
  host.append(toolbar, bgPanel, markersPanel.root, empty, cardHost);

  let metas: readonly ColumnMeta[] = [];
  let rowCount = 0;
  let card: ChartCard | null = null;
  let visible = false;
  let datasetKey = "";
  let pending: Partial<ChartCardConfig> | null = null;

  // The loaded picture and its placement.
  let bitmap: ImageBitmap | null = null;
  let greyCopy: { image: CanvasImageSource; width: number; height: number } | null = null;
  let source: { file: Blob; name: string; scaled: boolean } | null = null;
  let worldFile: string | null = null;
  let mode: PlaceMode = "world";
  let placement: MapPlacement = { ...WHOLE_WORLD };

  function coordinateNames(config: ChartCardConfig): string {
    const lat = metas[config.y]?.name, lon = metas[config.x]?.name;
    return lat !== undefined && lon !== undefined ? `${lat} / ${lon}` : "";
  }

  function ensureCard(): void {
    const geo = detectGeoPair(metas, rowCount);
    const inRange = (i: number | undefined): boolean => i !== undefined && i >= 0 && i < metas.length;
    // No coordinate columns still gives a map: the basemap, a picture and markers.
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
      applyBackground();
      applyMarkers();
      void applyCities();
    }
    pending = null;
    const names = coordinateNames(card.getConfig());
    empty.classList.toggle("hidden", names !== "");
    if (names === "") {
      empty.replaceChildren(
        el("p", {}, [
          "No latitude and longitude columns found, so the map shows your markers and background picture only. To plot rows, the table needs two number columns in degrees: a latitude (-90 to 90) and a longitude (-180 to 180), found by name (lat, latitude, lon, lng, longitude) or by range.",
        ]),
      );
    }
    sub.textContent = names;
  }

  // ------------------------------------------------------------------ background
  function currentImage(): MapBackgroundImage | null {
    if (bitmap === null) return null;
    const pic = grey.checked && greyCopy !== null ? greyCopy : { image: bitmap, width: bitmap.width, height: bitmap.height };
    return {
      ...pic,
      placement,
      opacity: Number(opacity.value) / 100,
      outline: outline.checked,
      attribution: attribution.value.trim(),
    };
  }

  function applyBackground(): void {
    const bad = bitmap === null ? null : placementProblem(placement);
    problem.textContent = bad ?? "";
    card?.setMapBackground(bad === null ? currentImage() : null);
  }

  function syncPanel(): void {
    bgPanel.classList.toggle("hidden", bitmap === null);
    if (bitmap === null || source === null) return;
    bgName.textContent = `${source.name} · ${bitmap.width.toLocaleString()}×${bitmap.height.toLocaleString()} px${source.scaled ? " (scaled down to fit)" : ""}`;
    for (const [key, button] of Object.entries(modeButtons) as [PlaceMode, HTMLButtonElement][]) {
      button.setAttribute("aria-pressed", String(key === mode));
    }
    modeButtons.file.disabled = worldFile === null;
    modeButtons.file.title = worldFile === null
      ? "Load the picture together with its world file (.jgw, .pgw, .wld) to use it"
      : "Edges from the world file loaded with the picture";
    edges.west.value = String(round(placement.west));
    edges.east.value = String(round(placement.east));
    edges.south.value = String(round(placement.south));
    edges.north.value = String(round(placement.north));
    projSelect.value = placement.projection;
  }

  function setMode(next: PlaceMode): void {
    if (next === "file" && worldFile !== null && bitmap !== null) {
      const parsed = parseWorldFile(worldFile, bitmap.width / scaleOf(), bitmap.height / scaleOf());
      if ("error" in parsed) {
        problem.textContent = parsed.error;
        return;
      }
      placement = parsed;
    } else if (next === "world") placement = { ...WHOLE_WORLD, projection: placement.projection === "mercator" ? "plate" : placement.projection };
    mode = next;
    syncPanel();
    applyBackground();
    save();
  }

  /** Pixels in memory per pixel of the file (a world file counts the file's pixels). */
  let fileScale = 1;
  function scaleOf(): number {
    return fileScale;
  }

  async function readPicture(file: Blob): Promise<{ bitmap: ImageBitmap; scaled: boolean; scale: number }> {
    const full = await createImageBitmap(file);
    const long = Math.max(full.width, full.height);
    if (long <= MAX_EDGE) return { bitmap: full, scaled: false, scale: 1 };
    const scale = MAX_EDGE / long;
    const small = await createImageBitmap(full, {
      resizeWidth: Math.round(full.width * scale),
      resizeHeight: Math.round(full.height * scale),
      resizeQuality: "high",
    });
    full.close();
    return { bitmap: small, scaled: true, scale };
  }

  function makeGrey(image: ImageBitmap): { image: HTMLCanvasElement; width: number; height: number } | null {
    const scale = Math.min(1, GREY_EDGE / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * scale)), h = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.drawImage(image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!);
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return { image: canvas, width: w, height: h };
  }

  async function loadFiles(files: readonly File[], restore?: SavedBackground): Promise<void> {
    const image = files.find((file) => IMAGE_TYPES.test(file.name) || /^image\/(jpeg|png|webp)$/.test(file.type));
    const world = files.find((file) => WORLD_TYPES.test(file.name));
    if (image === undefined && world === undefined) {
      options.onAction("Pick a JPG, PNG or WebP picture, with its world file if it has one.");
      return;
    }
    if (image !== undefined) {
      let read: Awaited<ReturnType<typeof readPicture>>;
      try {
        read = await readPicture(image);
      } catch {
        options.onAction(`${image.name} could not be read as a picture.`);
        return;
      }
      bitmap?.close();
      bitmap = read.bitmap;
      fileScale = read.scale;
      greyCopy = null;
      source = { file: image, name: image.name, scaled: read.scaled };
      worldFile = null;
      if (restore === undefined) {
        mode = "world";
        placement = { ...WHOLE_WORLD };
        if (!outline.checked && card !== null) outline.checked = true;
      }
    }
    if (world !== undefined) worldFile = await world.text();
    if (restore !== undefined) {
      worldFile = restore.worldFile;
      mode = restore.mode;
      placement = restore.placement;
      opacity.value = String(Math.round(restore.opacity * 100));
      grey.checked = restore.grey;
      outline.checked = restore.outline;
      attribution.value = restore.attribution;
    }
    if (bitmap === null) {
      options.onAction("Load the picture together with its world file.");
      return;
    }
    if (grey.checked) greyCopy = makeGrey(bitmap);
    if (restore === undefined && worldFile !== null) setMode("file");
    else {
      syncPanel();
      applyBackground();
      if (restore === undefined) save();
    }
    if (restore === undefined) {
      options.onAction(
        mode === "file"
          ? `Placed ${source?.name ?? "the picture"} from its world file`
          : `Placed ${source?.name ?? "the picture"} as the whole world; use Edges if it covers less`,
      );
    }
  }

  function removeBackground(): void {
    bitmap?.close();
    bitmap = null;
    greyCopy = null;
    source = null;
    worldFile = null;
    problem.textContent = "";
    syncPanel();
    applyBackground();
    void store().then((db) => db?.remove(datasetKey));
    options.onAction("Removed the background picture");
  }

  async function applyCities(): Promise<void> {
    if (!citiesToggle.checked) {
      card?.setMapOverlay(null);
      return;
    }
    const cities = await loadCities().catch(() => null);
    if (cities !== null && citiesToggle.checked) card?.setMapOverlay(cityOverlay(cities));
  }

  function applyMarkers(): void {
    const customs = markersPanel.customs();
    card?.setMapMarkers(
      markerState.markers.map((m) => ({
        lon: m.lon,
        lat: m.lat,
        label: m.label,
        draw: (ctx, x, y, r) => drawSymbol(ctx, m.symbol, x, y, r, m.color, customs),
      })),
    );
  }

  function saveMarkers(): void {
    if (datasetKey === "") return;
    const key = datasetKey;
    void store().then((db) => (markerState.markers.length || markerState.customs.length ? db?.putMarkers({ key, ...markerState }) : db?.removeMarkers(key)));
  }

  // ------------------------------------------------------------------ remembered per dataset
  function save(): void {
    if (source === null || datasetKey === "") return;
    const entry: SavedBackground = {
      key: datasetKey,
      file: source.file,
      name: source.name,
      worldFile,
      mode,
      placement,
      opacity: Number(opacity.value) / 100,
      grey: grey.checked,
      outline: outline.checked,
      attribution: attribution.value.trim(),
    };
    void store().then((db) => db?.put(entry));
  }

  async function restoreFor(key: string): Promise<void> {
    const db = await store();
    const saved = await db?.get(key).catch(() => undefined);
    if (saved === undefined || key !== datasetKey) return;
    const file = new File([saved.file], saved.name, { type: saved.file.type });
    await loadFiles([file], saved);
  }

  // ------------------------------------------------------------------ events
  loadButton.addEventListener("click", () => fileInput.click());
  guideButton.addEventListener("click", () => options.openGuide());
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = "";
    if (files.length) void loadFiles(files);
  });
  modeSeg.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
    if (button !== null && !button.disabled) setMode(button.dataset.mode as PlaceMode);
  });
  for (const input of Object.values(edges)) {
    input.addEventListener("input", () => {
      mode = "edges";
      placement = {
        west: Number(edges.west.value),
        east: Number(edges.east.value),
        south: Number(edges.south.value),
        north: Number(edges.north.value),
        projection: placement.projection,
      };
      for (const [key, button] of Object.entries(modeButtons) as [PlaceMode, HTMLButtonElement][]) {
        button.setAttribute("aria-pressed", String(key === mode));
      }
      applyBackground();
      if (placementProblem(placement) === null) save();
    });
  }
  projSelect.addEventListener("change", () => {
    placement = { ...placement, projection: projSelect.value as MapProjection };
    // A whole-world picture in Web Mercator stops short of the poles.
    if (placement.projection === "mercator" && mode === "world") {
      placement = { ...placement, south: -85.051129, north: 85.051129 };
      syncPanel();
    }
    applyBackground();
    save();
  });
  for (const input of [opacity, outline, attribution]) {
    input.addEventListener("input", () => {
      applyBackground();
      save();
    });
  }
  grey.addEventListener("change", () => {
    if (grey.checked && greyCopy === null && bitmap !== null) greyCopy = makeGrey(bitmap);
    applyBackground();
    save();
  });
  removeButton.addEventListener("click", removeBackground);
  try {
    citiesToggle.checked = localStorage.getItem("turbofuzz.map.cities") === "1";
  } catch {
    // Storage blocked: cities start off.
  }
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
        if (bitmap !== null) {
          bitmap.close();
          bitmap = null;
          greyCopy = null;
          source = null;
          syncPanel();
        }
        markersPanel.set({ markers: [], customs: [] });
        markerState = { markers: [], customs: [] };
        applyMarkers();
        if (key !== "") {
          void restoreFor(key);
          void store().then(async (db) => {
            const saved = await db?.getMarkers(key).catch(() => undefined);
            if (saved === undefined || key !== datasetKey) return;
            markerState = { markers: saved.markers, customs: saved.customs };
            markersPanel.set(markerState);
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

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// ------------------------------------------------------------------ IndexedDB
interface SavedMarkers extends MarkersState {
  key: string;
}

interface BackgroundStore {
  get(key: string): Promise<SavedBackground | undefined>;
  put(entry: SavedBackground): Promise<void>;
  remove(key: string): Promise<void>;
  getMarkers(key: string): Promise<SavedMarkers | undefined>;
  putMarkers(entry: SavedMarkers): Promise<void>;
  removeMarkers(key: string): Promise<void>;
}

let storePromise: Promise<BackgroundStore | null> | null = null;

/** One picture per dataset name, in this browser only; null when IndexedDB is blocked. */
function store(): Promise<BackgroundStore | null> {
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
        const run = <T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>, name = "backgrounds"): Promise<T> =>
          new Promise((done, fail) => {
            const req = work(db.transaction(name, mode).objectStore(name));
            req.onsuccess = () => done(req.result);
            req.onerror = () => fail(req.error);
          });
        resolve({
          get: (key) => run("readonly", (s) => s.get(key) as IDBRequest<SavedBackground | undefined>),
          put: async (entry) => {
            await run("readwrite", (s) => s.put(entry));
          },
          remove: async (key) => {
            await run("readwrite", (s) => s.delete(key));
          },
          getMarkers: (key) => run("readonly", (s) => s.get(key) as IDBRequest<SavedMarkers | undefined>, "markers"),
          putMarkers: async (entry) => {
            await run("readwrite", (s) => s.put(entry), "markers");
          },
          removeMarkers: async (key) => {
            await run("readwrite", (s) => s.delete(key), "markers");
          },
        });
      };
    } catch {
      resolve(null);
    }
  });
  return storePromise;
}
