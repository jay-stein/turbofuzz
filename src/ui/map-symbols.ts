/**
 * Marker symbols for the Map page: the built-in shapes and the person's own SVG
 * symbols. An uploaded SVG is never inserted or loaded as a picture: only its shape
 * geometry (path, circle, rect, ellipse, polygon, polyline, line) is read and kept as
 * path data, scaled to the marker size and filled with the marker colour. Scripts,
 * links, styles and images in the file are ignored.
 */

import type { MarkerSymbol, Shape } from "../data/map-markers.js";

export interface CustomSymbol {
  id: string;
  name: string;
  /** Path data in the SVG's own units. */
  paths: string[];
  /** viewBox: x, y, width, height. */
  box: [number, number, number, number];
}

/** Built-in shapes as path data in a -1..1 box (y down). */
const SHAPE_PATHS: Record<Exclude<Shape, "x" | "plus" | "circle">, string> = {
  dot: "M0 -0.55A0.55 0.55 0 1 1 0 0.55A0.55 0.55 0 1 1 0 -0.55Z",
  square: "M-0.8 -0.8H0.8V0.8H-0.8Z",
  triangle: "M0 -0.95L0.9 0.75H-0.9Z",
  diamond: "M0 -1L0.85 0L0 1L-0.85 0Z",
  star: "M0 -1L0.24 -0.33L0.95 -0.31L0.38 0.12L0.59 0.81L0 0.4L-0.59 0.81L-0.38 0.12L-0.95 -0.31L-0.24 -0.33Z",
  pin: "M0 1C-0.15 0.55 -0.7 0.1 -0.7 -0.35A0.7 0.7 0 1 1 0.7 -0.35C0.7 0.1 0.15 0.55 0 1ZM0 -0.62A0.27 0.27 0 1 0 0 -0.08A0.27 0.27 0 1 0 0 -0.62Z",
};
const STROKED: Record<"x" | "plus" | "circle", string> = {
  x: "M-0.75 -0.75L0.75 0.75M0.75 -0.75L-0.75 0.75",
  plus: "M0 -0.9V0.9M-0.9 0H0.9",
  circle: "M0 -0.75A0.75 0.75 0 1 1 0 0.75A0.75 0.75 0 1 1 0 -0.75Z",
};

const pathCache = new Map<string, Path2D>();
function path(d: string): Path2D {
  let p = pathCache.get(d);
  if (p === undefined) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

/** Paints a marker symbol centred on (x, y), r pixels from centre to edge. */
export function drawSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: MarkerSymbol,
  x: number,
  y: number,
  r: number,
  color: string,
  customs: ReadonlyMap<string, CustomSymbol>,
): void {
  ctx.save();
  ctx.translate(x, y);
  if (symbol.startsWith("svg:")) {
    const custom = customs.get(symbol.slice(4));
    if (custom !== undefined) {
      const [bx, by, bw, bh] = custom.box;
      const k = (2 * r) / Math.max(bw, bh);
      ctx.scale(k, k);
      ctx.translate(-bx - bw / 2, -by - bh / 2);
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.5 / k;
      for (const d of custom.paths) {
        ctx.stroke(path(d));
        ctx.fill(path(d), "evenodd");
      }
      ctx.restore();
      return;
    }
    symbol = "circle";
  }
  ctx.scale(r, r);
  if (symbol === "x" || symbol === "plus" || symbol === "circle") {
    const p = path(STROKED[symbol]);
    ctx.lineCap = "round";
    // A white casing under the colour keeps thin symbols visible on any picture.
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 5 / r;
    ctx.stroke(p);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 / r;
    ctx.stroke(p);
  } else {
    const p = path(SHAPE_PATHS[symbol as keyof typeof SHAPE_PATHS]);
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5 / r;
    ctx.fill(p, "evenodd");
    ctx.stroke(p);
  }
  ctx.restore();
}

/** A small SVG of the symbol for buttons and the table (our own markup, never the upload's). */
export function symbolSvg(symbol: MarkerSymbol, color: string, customs: ReadonlyMap<string, CustomSymbol>, size = 18): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const add = (d: string, stroked: boolean): void => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    if (stroked) {
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", color);
      p.setAttribute("stroke-width", "0.28");
      p.setAttribute("stroke-linecap", "round");
    } else {
      p.setAttribute("fill", color);
      p.setAttribute("fill-rule", "evenodd");
    }
    svg.append(p);
  };
  const custom = symbol.startsWith("svg:") ? customs.get(symbol.slice(4)) : undefined;
  if (custom !== undefined) {
    svg.setAttribute("viewBox", custom.box.join(" "));
    for (const d of custom.paths) add(d, false);
    return svg;
  }
  const shape = (symbol.startsWith("svg:") ? "circle" : symbol) as Shape;
  svg.setAttribute("viewBox", "-1.1 -1.1 2.2 2.2");
  if (shape === "x" || shape === "plus" || shape === "circle") add(STROKED[shape], true);
  else add(SHAPE_PATHS[shape], false);
  return svg;
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?`;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;

/**
 * Reads the shape geometry of an SVG file. Only path data is kept; anything else in the
 * file (scripts, styles, images, links) is dropped. Transforms on elements are not
 * applied, so a symbol is best drawn flat (as icon sets usually are).
 */
export function parseSvgSymbol(text: string, name: string): CustomSymbol | { error: string } {
  if (text.length > 512_000) return { error: "That SVG is over 500 KB; a symbol should be a few shapes." };
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) {
    return { error: `${name} is not a readable SVG file.` };
  }
  const n = (el: Element, a: string): number => Number.parseFloat(el.getAttribute(a) ?? "0") || 0;
  const paths: string[] = [];
  for (const el of Array.from(root.querySelectorAll("path, circle, ellipse, rect, polygon, polyline, line"))) {
    if (el.closest("defs, clipPath, mask, symbol, pattern") !== null) continue;
    if ((el.getAttribute("fill") ?? "") === "none" && el.tagName.toLowerCase() !== "line") continue;
    const tag = el.tagName.toLowerCase();
    let d = "";
    if (tag === "path") d = el.getAttribute("d") ?? "";
    else if (tag === "circle" || tag === "ellipse") {
      const cx = n(el, "cx"), cy = n(el, "cy"), rx = tag === "circle" ? n(el, "r") : n(el, "rx"), ry = tag === "circle" ? n(el, "r") : n(el, "ry");
      if (rx > 0 && ry > 0) d = `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    } else if (tag === "rect") {
      const x = n(el, "x"), y = n(el, "y"), w = n(el, "width"), h = n(el, "height");
      if (w > 0 && h > 0) d = `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    } else if (tag === "polygon" || tag === "polyline") {
      const pts = (el.getAttribute("points") ?? "").match(new RegExp(NUM, "gi")) ?? [];
      if (pts.length >= 4) d = "M" + pts.join(" ") + (tag === "polygon" ? "Z" : "");
    } else if (tag === "line") {
      d = `M${n(el, "x1")} ${n(el, "y1")}L${n(el, "x2")} ${n(el, "y2")}`;
    }
    if (d !== "" && PATH_DATA.test(d)) paths.push(d);
  }
  if (paths.length === 0) return { error: `${name} has no shapes to draw (paths, circles, rectangles or polygons).` };
  let box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || !(box[2]! > 0) || !(box[3]! > 0)) {
    const w = n(root, "width") || 24, h = n(root, "height") || 24;
    box = [0, 0, w, h];
  }
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: name.replace(/\.svg$/i, "").slice(0, 40),
    paths: paths.slice(0, 64),
    box: box as [number, number, number, number],
  };
}
