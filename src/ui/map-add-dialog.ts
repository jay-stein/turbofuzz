/**
 * "Add markers" window for the Map page. Paste rows (comma, tab or semicolon
 * separated, header optional), load a CSV, or find a city; a live preview shows what
 * will be added before anything touches the map. Each row needs a latitude and a
 * longitude; a label, symbol, colour or size column is used when present, and rows
 * without a label become "Marker N".
 */

import { findCity, searchCities, type Cities } from "../data/cities.js";
import {
  autoLabel,
  MAX_MARKER_SIZE,
  MAX_MARKERS,
  MIN_MARKER_SIZE,
  parseMarkers,
  type MapMarker,
  type MarkerParse,
  type MarkerSymbol,
} from "../data/map-markers.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import { symbolSvg, type CustomSymbol } from "./map-symbols.js";

export interface MarkerStyle {
  symbol: MarkerSymbol;
  color: string;
  size: number;
}

export interface AddMarkersOptions {
  /** Markers already on the map: numbering for "Marker N" and the room left. */
  existing: number;
  style: MarkerStyle;
  customs: ReadonlyMap<string, CustomSymbol>;
  cities(): Promise<Cities>;
  /** Opens the symbol palette next to the anchor. */
  chooseSymbol(anchor: HTMLElement, pick: (symbol: MarkerSymbol) => void): void;
  /** Text to start with (rows pasted onto the page). */
  text?: string;
}

export interface AddMarkersResult {
  markers: MapMarker[];
  /** The style picked here, kept for the next markers. */
  style: MarkerStyle;
  skipped: number;
  over: number;
}

const EXAMPLE = "label,lat,lon\nSydney Opera House,-33.8568,151.2153\n-37.8136,144.9631\nAuckland,-36.8485,174.7633";
const PREVIEW_ROWS = 8;

export function openAddMarkers(options: AddMarkersOptions): Promise<AddMarkersResult | null> {
  return new Promise((resolve) => {
    let style = { ...options.style };
    let cities: Cities | null = null;
    // Cities picked from the search box, added after the pasted rows.
    const picked: MapMarker[] = [];
    let parsed: MarkerParse = { markers: [], skipped: [], over: 0 };
    let ready: MapMarker[] = [];

    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal map-add-modal" });
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close", "aria-label": "Close" }, ["×"]);
    modal.append(
      el("div", { class: "modal-head" }, [el("h2", {}, ["Add markers"]), closeButton]),
      el("p", { class: "map-add-lead" }, [
        "Paste rows with a latitude and a longitude, separated by commas, tabs or semicolons. A header row is optional; label, symbol, colour and size columns are used when present. Rows without a label are numbered Marker 1, Marker 2…",
      ]),
    );

    // ------------------------------------------------------------------ input side
    const textarea = el("textarea", {
      class: "map-add-text",
      spellcheck: "false",
      rows: "11",
      placeholder: EXAMPLE,
      "aria-label": "Marker rows: latitude and longitude, with an optional label",
    }) as HTMLTextAreaElement;
    textarea.value = options.text ?? "";
    const fileInput = el("input", { type: "file", accept: ".csv,.tsv,.txt,text/csv", class: "hidden", "aria-label": "Markers CSV file" }) as HTMLInputElement;
    const uploadButton = el("button", { type: "button", class: "map-btn" }, ["Load a CSV…"]);
    const exampleButton = el("button", { type: "button", class: "map-btn link" }, ["Use the example"]);
    const cityInput = el("input", {
      type: "search",
      class: "map-cell map-add-city",
      placeholder: "Find a city…",
      "aria-label": "Find a city to add",
      autocomplete: "off",
    }) as HTMLInputElement;
    const cityList = el("ul", { class: "map-city-list hidden", role: "listbox", "aria-label": "Matching cities" });
    const inputSide = el("div", { class: "map-add-input" }, [
      textarea,
      el("div", { class: "map-add-tools" }, [
        uploadButton,
        el("span", { class: "map-city" }, [cityInput, cityList]),
        el("span", { class: "grow" }),
        exampleButton,
        fileInput,
      ]),
    ]);

    // ------------------------------------------------------------------ style
    const symbolButton = el("button", { type: "button", class: "map-sym-btn", "aria-label": "Symbol for these markers", title: "Symbol for these markers" });
    const colorInput = el("input", { type: "color", value: style.color, class: "map-color", "aria-label": "Colour for these markers" }) as HTMLInputElement;
    const sizeInput = el("input", {
      type: "range",
      min: String(MIN_MARKER_SIZE),
      max: String(MAX_MARKER_SIZE),
      step: "1",
      value: String(style.size),
      "aria-label": "Size for these markers",
    }) as HTMLInputElement;
    const sizeOut = el("output", { class: "map-size-out" });
    const styleRow = el("div", { class: "map-add-style" }, [
      el("span", { class: "map-add-style-title" }, ["Style"]),
      el("label", { class: "map-field" }, [el("span", {}, ["Symbol"]), symbolButton]),
      el("label", { class: "map-field" }, [el("span", {}, ["Colour"]), colorInput]),
      el("label", { class: "map-field" }, [el("span", {}, ["Size"]), sizeInput, sizeOut]),
      el("span", { class: "map-add-style-note" }, ["Used unless a row names its own"]),
    ]);

    // ------------------------------------------------------------------ preview side
    const summary = el("div", { class: "map-add-summary", role: "status" });
    const previewBody = el("tbody");
    const previewTable = el("table", { class: "map-add-preview" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, [""]), el("th", {}, ["Label"]), el("th", {}, ["Latitude"]), el("th", {}, ["Longitude"])])]),
      previewBody,
    ]);
    const more = el("p", { class: "map-add-more" });
    const skippedList = el("ul", { class: "map-add-skipped" });
    const previewSide = el("div", { class: "map-add-side" }, [summary, previewTable, more, skippedList]);

    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const confirm = el("button", { class: "primary", type: "button" }, ["Add markers"]) as HTMLButtonElement;
    modal.append(
      el("div", { class: "map-add-body" }, [inputSide, previewSide]),
      styleRow,
      el("div", { class: "clean-footer" }, [
        el("span", { class: "map-add-keys" }, ["Ctrl+Enter adds"]),
        el("span", { class: "grow" }),
        cancel,
        confirm,
      ]),
    );

    // ------------------------------------------------------------------ preview
    const room = (): number => MAX_MARKERS - options.existing;
    const fmt = (v: number): string => (Math.round(v * 1e4) / 1e4).toFixed(4);

    function refresh(): void {
      const lookup = cities === null ? undefined : (name: string) => findCity(cities!, name);
      const text = textarea.value.trim() === "" ? "" : textarea.value;
      parsed = parseMarkers(text, style, Math.max(0, room() - picked.length), [...options.customs.keys()], lookup);
      const restyled = picked.map((m) => ({ ...m, symbol: style.symbol, color: style.color, size: style.size }));
      ready = autoLabel([...parsed.markers, ...restyled], options.existing);

      const n = ready.length;
      summary.replaceChildren(
        n === 0
          ? el("span", { class: "map-add-none" }, [text === "" && picked.length === 0 ? "Nothing to add yet" : "No rows with a readable latitude and longitude yet"])
          : el("strong", {}, [`${n} marker${n === 1 ? "" : "s"} ready`]),
        el("span", { class: "map-add-room" }, [`${options.existing} on the map · room for ${room()}`]),
      );
      previewBody.replaceChildren(
        ...ready.slice(0, PREVIEW_ROWS).map((m) => {
          const swatch = el("span", { class: "map-add-swatch" });
          swatch.append(symbolSvg(m.symbol, m.color, options.customs, Math.max(12, Math.min(22, (m.size ?? style.size) * 2))));
          return el("tr", {}, [
            el("td", {}, [swatch]),
            el("td", { class: "map-add-label" }, [m.label]),
            el("td", { class: "num" }, [fmt(m.lat)]),
            el("td", { class: "num" }, [fmt(m.lon)]),
          ]);
        }),
      );
      previewTable.classList.toggle("hidden", n === 0);
      const notes: string[] = [];
      if (n > PREVIEW_ROWS) notes.push(`and ${n - PREVIEW_ROWS} more`);
      if (parsed.over > 0) notes.push(`${parsed.over} left out: the map holds ${MAX_MARKERS} markers`);
      more.textContent = notes.join(" · ");
      skippedList.replaceChildren(
        ...parsed.skipped.slice(0, 3).map((s) => el("li", {}, [`Line ${s.line}: ${s.reason}`])),
        ...(parsed.skipped.length > 3 ? [el("li", {}, [`and ${parsed.skipped.length - 3} more lines skipped`])] : []),
      );
      confirm.disabled = n === 0;
      confirm.textContent = n === 0 ? "Add markers" : `Add ${n} marker${n === 1 ? "" : "s"}`;
      symbolButton.replaceChildren(symbolSvg(style.symbol, style.color, options.customs));
      sizeOut.textContent = `${style.size}px`;
    }

    let timer = 0;
    textarea.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 120);
    });
    void options
      .cities()
      .then((loaded) => {
        cities = loaded;
        refresh();
      })
      .catch(() => undefined);

    // ------------------------------------------------------------------ actions
    uploadButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file === undefined) return;
      textarea.value = await file.text();
      refresh();
    });
    exampleButton.addEventListener("click", () => {
      textarea.value = EXAMPLE;
      refresh();
      textarea.focus();
    });
    symbolButton.addEventListener("click", (event) => {
      event.preventDefault();
      options.chooseSymbol(symbolButton, (symbol) => {
        style = { ...style, symbol };
        refresh();
      });
    });
    colorInput.addEventListener("input", () => {
      style = { ...style, color: colorInput.value };
      refresh();
    });
    sizeInput.addEventListener("input", () => {
      style = { ...style, size: Number(sizeInput.value) };
      refresh();
    });

    let hits: { name: string; lat: number; lon: number }[] = [];
    cityInput.addEventListener("input", () => {
      hits = cities === null ? [] : searchCities(cities, cityInput.value, 8);
      cityList.replaceChildren(
        ...hits.map((hit, i) => {
          const item = el("li", { role: "option" }, [el("span", {}, [hit.name]), el("small", {}, [`${hit.lat.toFixed(2)}, ${hit.lon.toFixed(2)}`])]);
          item.addEventListener("mousedown", (event) => {
            event.preventDefault();
            addCity(i);
          });
          return item;
        }),
      );
      cityList.classList.toggle("hidden", hits.length === 0);
    });
    cityInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        addCity(0);
      }
    });
    cityInput.addEventListener("blur", () => cityList.classList.add("hidden"));
    function addCity(i: number): void {
      const hit = hits[i];
      if (hit === undefined) return;
      picked.push({ label: hit.name, lat: hit.lat, lon: hit.lon, symbol: style.symbol, color: style.color, size: style.size });
      cityInput.value = "";
      hits = [];
      cityList.classList.add("hidden");
      refresh();
    }

    let settled = false;
    const finish = (result: AddMarkersResult | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const add = (): void => {
      refresh();
      if (ready.length === 0) return;
      finish({ markers: ready, style, skipped: parsed.skipped.length, over: parsed.over });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && document.querySelector(".map-palette") === null) finish(null);
      else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        add();
      }
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    confirm.addEventListener("click", add);
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Add markers");
    refresh();
    window.setTimeout(() => textarea.focus(), 0);
  });
}
