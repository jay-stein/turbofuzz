/**
 * Map page: the Layers list that opens the map's side panel. Each layer is one row (icon, name, a short
 * status) that opens its own settings under it; a layer that can be hidden has a switch at the end.
 */

import { el, svgIcon } from "./dom.js";

export interface MapLayer {
  root: HTMLElement;
  body: HTMLElement;
  setMeta(text: string): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
}

let nextId = 0;

/** The red pin: the one symbol for the markers a person places themselves. */
export function pinIcon(className = "map-layer-icon"): SVGElement {
  return svgIcon(
    '<path d="M12 2.2c-4 0-7 3-7 7 0 5.3 7 12.6 7 12.6s7-7.3 7-12.6c0-4-3-7-7-7z" fill="var(--map-pin)" stroke="none"/>' +
      '<circle cx="12" cy="9.2" r="2.7" fill="#fff" stroke="none"/>',
    className,
  );
}

export const LAYER_ICONS = {
  data: '<circle cx="8" cy="15" r="3.2" fill="currentColor" stroke="none" opacity=".75"/><circle cx="15" cy="8" r="4.4" fill="currentColor" stroke="none" opacity=".75"/><circle cx="18" cy="17" r="2.3" fill="currentColor" stroke="none" opacity=".75"/>',
  cities: '<path d="M4 20V10h6v10M10 20V5h9v15M3 20h18"/><path d="M13 9h3M13 12h3M13 15h3"/>',
  boundaries: '<path d="M4 6.5 9.5 4l5 3 5.5-2.5v13L14.5 20l-5-3L4 19.5z"/><path d="M9.5 4v13M14.5 7v13"/>',
};

/** A switch for a layer: the checkbox stays for keyboards and screen readers. */
export function layerSwitch(input: HTMLInputElement, title: string): HTMLElement {
  input.classList.add("map-switch-input");
  input.setAttribute("role", "switch");
  return el("label", { class: "map-switch map-layer-switch", title }, [input, el("span", { class: "map-switch-track", "aria-hidden": "true" })]);
}

export function mapLayer(options: {
  key: string;
  icon: Element;
  name: string;
  /** A switch shown at the end of the row (see layerSwitch). */
  toggle?: HTMLElement;
  body: (Node | null)[];
  open: boolean;
}): MapLayer {
  const id = `map-layer-${options.key}-${++nextId}`;
  const meta = el("span", { class: "map-layer-meta" });
  const button = el("button", { type: "button", class: "map-layer-toggle", "aria-controls": id }, [
    options.icon,
    el("span", { class: "map-layer-name" }, [options.name]),
    meta,
    el("span", { class: "map-layer-chevron", "aria-hidden": "true" }),
  ]) as HTMLButtonElement;
  const body = el("div", { class: "map-layer-body", id }, options.body.filter((node): node is Node => node !== null));
  const root = el("section", { class: "map-layer", "data-layer": options.key }, [
    el("div", { class: "map-layer-head" }, options.toggle === undefined ? [button] : [button, options.toggle]),
    body,
  ]);
  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    button.setAttribute("aria-expanded", String(open));
    root.classList.toggle("open", open);
    body.hidden = !open;
  };
  // What the person opened or folded is remembered; the page's own opening (new markers) is not.
  const storeKey = `turbofuzz.map.layer.${options.key}`;
  button.addEventListener("click", () => {
    setOpen(!open);
    try {
      localStorage.setItem(storeKey, open ? "1" : "0");
    } catch {
      // Not remembered; the layer still opens.
    }
  });
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(storeKey);
  } catch {
    // Storage blocked: the default stands.
  }
  setOpen(saved === null ? options.open : saved === "1");
  return {
    root,
    body,
    setMeta: (text) => {
      meta.textContent = text;
    },
    setOpen,
    isOpen: () => open,
  };
}
