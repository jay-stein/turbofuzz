/**
 * The Map page's city layer: the largest cities in view first, each with a dot and a
 * label, skipping any whose label would overlap one already placed. Zoomed out it
 * shows the world's big cities; zoomed in, smaller towns fill the space. The person's
 * own markers and their labels are kept clear: a city that would cover one is skipped.
 */

import type { Cities } from "../data/cities.js";
import type { MapOverlay } from "./chart-card.js";

/** Labels are kept to about one per this many square pixels of map. */
const AREA_PER_LABEL = 7000;

/** A marker the city layer keeps clear of (drawn after it, at this radius in CSS pixels). */
export interface ReservedMarker {
  lon: number;
  lat: number;
  label: string;
  size?: number;
}

export function cityOverlay(cities: Cities, markers: () => readonly ReservedMarker[] = () => []): MapOverlay {
  return (ctx, view, plot) => {
    const { x: x0, y: y0, w, h, ui } = plot;
    const sx = w / (view.lonMax - view.lonMin), sy = h / (view.latMax - view.latMin);
    const size = 10.5 * ui, pad = 2 * ui, dot = 2.2 * ui;
    ctx.font = `${size}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    // Ink and halo follow the theme, so names read on a light or a dark map.
    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue("--text").trim() || "#1c2430";
    const halo = style.getPropertyValue("--panel").trim() || "#ffffff";
    const budget = Math.max(12, Math.round((w * h) / AREA_PER_LABEL));
    const placed: [number, number, number, number][] = [];
    const overlaps = (a: number, b: number, c: number, d: number): boolean => {
      for (const [p, q, r, s] of placed) if (a < r && c > p && b < s && d > q) return true;
      return false;
    };
    // Markers and their labels (11px semibold, a little wider than city names) go in first.
    const reserved: [number, number, number, number][] = [];
    for (const m of markers()) {
      const x = x0 + (m.lon - view.lonMin) * sx, y = y0 + (view.latMax - m.lat) * sy;
      const r = (m.size ?? 7) * ui;
      const tw = m.label === "" ? 0 : ctx.measureText(m.label).width * 1.12 + 3 * ui;
      reserved.push([x - r - pad, y - Math.max(r, size / 2) - pad, x + r + tw + pad, y + Math.max(r, size / 2) + pad]);
    }
    placed.push(...reserved);
    for (let i = 0; i < cities.names.length && placed.length - reserved.length < budget; i++) {
      const lon = cities.lon[i]!, lat = cities.lat[i]!;
      if (lon < view.lonMin || lon > view.lonMax || lat < view.latMin || lat > view.latMax) continue;
      const x = x0 + (lon - view.lonMin) * sx, y = y0 + (view.latMax - lat) * sy;
      const name = cities.names[i]!;
      const tw = ctx.measureText(name).width;
      // Right of the dot, or left of it when the right side is taken or off the map.
      let lx = x + dot + pad;
      if (lx + tw > x0 + w || overlaps(lx - pad, y - size / 2 - pad, lx + tw + pad, y + size / 2 + pad)) lx = x - dot - pad - tw;
      const box: [number, number, number, number] = [Math.min(lx, x - dot) - pad, y - size / 2 - pad, Math.max(lx + tw, x + dot) + pad, y + size / 2 + pad];
      if (box[0] < x0 || overlaps(...box)) continue;
      placed.push(box);
      ctx.beginPath();
      ctx.arc(x, y, dot, 0, Math.PI * 2);
      ctx.fillStyle = ink;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = halo;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(name, lx, y);
      ctx.fillStyle = ink;
      ctx.fillText(name, lx, y);
    }
  };
}
