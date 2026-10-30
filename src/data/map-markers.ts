/**
 * Markers the person adds on the Map page: up to 100 points with a label, a position,
 * a symbol, a colour and a size. This module reads them from pasted text or a CSV file and
 * writes them back out; drawing is in src/ui/map-symbols.ts.
 */

import { parseLatitude, parseLongitude } from "./geo.js";

export const MAX_MARKERS = 100;

/** Marker radius in CSS pixels: the default, and the range the size controls allow. */
export const DEFAULT_MARKER_SIZE = 7;
export const MIN_MARKER_SIZE = 3;
export const MAX_MARKER_SIZE = 24;

export const SHAPES = ["circle", "dot", "x", "plus", "square", "triangle", "diamond", "star", "pin"] as const;
export type Shape = (typeof SHAPES)[number];
/** A built-in shape, or "svg:<id>" for a symbol the person uploaded. */
export type MarkerSymbol = Shape | `svg:${string}`;

export interface MapMarker {
  label: string;
  lat: number;
  lon: number;
  symbol: MarkerSymbol;
  /** #rrggbb */
  color: string;
  /** Radius in CSS pixels; DEFAULT_MARKER_SIZE when absent (markers saved before sizes). */
  size?: number;
}

export interface MarkerParse {
  markers: MapMarker[];
  /** Lines that could not be read, 1-based, with why. */
  skipped: { line: number; reason: string }[];
  /** Rows left out because the list would pass MAX_MARKERS. */
  over: number;
}

const HEX = /^#?[0-9a-f]{6}$/i;
const NAMED: Record<string, string> = {
  red: "#dc2626", blue: "#2563eb", green: "#16a34a", orange: "#ea580c", purple: "#9333ea",
  black: "#111827", grey: "#6b7280", gray: "#6b7280", yellow: "#ca8a04", pink: "#db2777", teal: "#0d9488", white: "#ffffff",
};

type Field = "label" | "lat" | "lon" | "symbol" | "color" | "size";

function header(cell: string): Field | null {
  const c = cell.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["label", "name", "title", "place", "city", "site"].includes(c)) return "label";
  if (["lat", "latitude", "y"].includes(c)) return "lat";
  if (["lon", "lng", "long", "longitude", "x"].includes(c)) return "lon";
  if (["symbol", "shape", "marker", "icon"].includes(c)) return "symbol";
  if (["color", "colour"].includes(c)) return "color";
  if (["size", "radius"].includes(c)) return "size";
  return null;
}

/** Splits one line on the delimiter, honouring double quotes. */
function cells(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") quoted = true;
    else if (ch === delim) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function normaliseColor(text: string, fallback: string): string {
  const t = text.trim().toLowerCase();
  if (HEX.test(t)) return (t.startsWith("#") ? t : "#" + t).toLowerCase();
  return NAMED[t] ?? fallback;
}

/** A size cell clamped to the allowed range; the fallback when it does not read. */
export function normaliseSize(text: string, fallback: number): number {
  const value = Number(text.trim().replace(/px$/i, ""));
  if (text.trim() === "" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_MARKER_SIZE, Math.max(MIN_MARKER_SIZE, Math.round(value)));
}

/**
 * Gives unlabelled markers "Marker N", numbered on from the markers already on the
 * map, so every point can be told apart in the table and on the map.
 */
export function autoLabel(markers: readonly MapMarker[], existing: number): MapMarker[] {
  return markers.map((marker, i) => (marker.label.trim() === "" ? { ...marker, label: `Marker ${existing + i + 1}` } : marker));
}

export function normaliseSymbol(text: string, fallback: MarkerSymbol, customIds: readonly string[] = []): MarkerSymbol {
  const t = text.trim().toLowerCase();
  const alias: Record<string, Shape> = { o: "circle", ring: "circle", cross: "x", "+": "plus", box: "square", "^": "triangle", "*": "star", marker: "pin" };
  if ((SHAPES as readonly string[]).includes(t)) return t as Shape;
  if (alias[t] !== undefined) return alias[t];
  if (t.startsWith("svg:") && customIds.includes(t.slice(4))) return t as MarkerSymbol;
  return fallback;
}

/**
 * Reads markers from pasted cells or a CSV: tab, semicolon or comma separated, with or
 * without a header. With a header, columns are found by name (label/name, lat/latitude,
 * lon/lng/longitude, symbol/shape, color/colour, size/radius). Without one, the two columns that read
 * as coordinates are latitude then longitude and the first other column is the label.
 * Coordinates may be decimal or degrees-minutes-seconds ("51°30'26\"N").
 */
export function parseMarkers(
  text: string,
  defaults: { symbol: MarkerSymbol; color: string; size?: number },
  room = MAX_MARKERS,
  customIds: readonly string[] = [],
  /** Coordinates for a place name (the bundled cities), for rows that only name a place. */
  lookup?: (name: string) => { lat: number; lon: number } | null,
): MarkerParse {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sample = lines.find((l) => l.trim() !== "") ?? "";
  const delim = sample.includes("\t") ? "\t" : sample.includes(";") ? ";" : ",";
  const out: MarkerParse = { markers: [], skipped: [], over: 0 };
  let map: Partial<Record<Field, number>> | null = null;
  let first = true;
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    // A line without the file's separator may use another (a hand-typed paste).
    const own = line.includes(delim) ? delim : line.includes("\t") ? "\t" : line.includes(";") ? ";" : line.includes(",") ? "," : delim;
    const row = cells(line, own);
    if (first) {
      first = false;
      const named: typeof map = {};
      row.forEach((cell, k) => { const h = header(cell); if (h !== null && named[h] === undefined) named[h] = k; });
      if (named.lat !== undefined && named.lon !== undefined) { map = named; return; }
      // A lone "city" or "name" header over a list of names.
      if (lookup !== undefined && named.label !== undefined && row.length === 1) return;
    }
    let lat: number | null, lon: number | null, label = "", symbol = defaults.symbol, color = defaults.color;
    let size = defaults.size ?? DEFAULT_MARKER_SIZE;
    lat = lon = null;
    if (map !== null) {
      lat = parseLatitude(row[map.lat!] ?? "");
      lon = parseLongitude(row[map.lon!] ?? "");
      label = map.label !== undefined ? row[map.label] ?? "" : "";
      if (map.symbol !== undefined) symbol = normaliseSymbol(row[map.symbol] ?? "", defaults.symbol, customIds);
      if (map.color !== undefined) color = normaliseColor(row[map.color] ?? "", defaults.color);
      if (map.size !== undefined) size = normaliseSize(row[map.size] ?? "", size);
    }
    // No header, or a row that does not follow it (a bare "lat,lon" under
    // "label,lat,lon"): the first two cells that read as a latitude then a longitude.
    if (map === null || ((lat === null || lon === null) && row.length !== Object.keys(map).length)) {
      let latAt = -1;
      for (let k = 0; k < row.length - 1; k++) {
        const a = parseLatitude(row[k]!), b = parseLongitude(row[k + 1]!);
        if (a !== null && b !== null && /\d/.test(row[k]!) && /\d/.test(row[k + 1]!)) { lat = a; lon = b; latAt = k; break; }
      }
      const rest = latAt < 0 && map !== null ? [] : row.filter((_, k) => k !== latAt && k !== latAt + 1);
      if (latAt >= 0 || map === null) label = rest[0] ?? "";
      for (const extra of rest.slice(1)) {
        if (HEX.test(extra.trim()) || NAMED[extra.trim().toLowerCase()] !== undefined) color = normaliseColor(extra, color);
        else symbol = normaliseSymbol(extra, symbol, customIds);
      }
    }
    if ((lat === null || lon === null) && lookup !== undefined) {
      const name = label !== "" ? label : row[0] ?? "";
      const hit = lookup(name);
      if (hit !== null) {
        lat = hit.lat;
        lon = hit.lon;
        if (label === "") label = name;
      }
    }
    if (lat === null || lon === null) {
      out.skipped.push({ line: index + 1, reason: lookup ? "no readable latitude and longitude, and no city of that name" : "no readable latitude and longitude" });
      return;
    }
    if (out.markers.length >= room) { out.over++; return; }
    out.markers.push({ label: label.slice(0, 80), lat, lon, symbol, color, size });
  });
  return out;
}

/** The markers as CSV, read back by parseMarkers. */
export function markersToCsv(markers: readonly MapMarker[]): string {
  const q = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    "label,lat,lon,symbol,color,size",
    ...markers.map((m) => [q(m.label), m.lat, m.lon, m.symbol, m.color, m.size ?? DEFAULT_MARKER_SIZE].join(",")),
  ].join("\n");
}
