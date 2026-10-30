/**
 * Map page background images: the person's own map picture, placed by its edges in
 * longitude/latitude. Fully offline (the file is read locally and drawn on the canvas;
 * nothing is fetched). This module is the geometry only: world files, projections and
 * the source/destination rectangles that put an image under the map's lon/lat plot.
 */

/** Plate carree (equirectangular): rows are even in latitude. Mercator: in Web Mercator y. */
export type MapProjection = "plate" | "mercator";

export interface MapPlacement {
  west: number;
  east: number;
  south: number;
  north: number;
  projection: MapProjection;
}

/** The lon/lat window the map plot shows; y is linear in latitude (plate carree). */
export interface MapWindow {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

export const WHOLE_WORLD: MapPlacement = { west: -180, east: 180, south: -90, north: 90, projection: "plate" };

/** Web Mercator stops at about 85.05 degrees; a mercator image cannot reach further. */
export const MERCATOR_LAT = 85.051129;
const R = 6378137;

/** Web Mercator y (radians-scaled) of a latitude, clamped to the mercator limit. */
export function mercY(lat: number): number {
  const c = Math.max(-MERCATOR_LAT, Math.min(MERCATOR_LAT, lat));
  return Math.log(Math.tan(Math.PI / 4 + (c * Math.PI) / 360));
}

export function latOfMercY(y: number): number {
  return (Math.atan(Math.sinh(y)) * 180) / Math.PI;
}

/** Plain-language problem with a placement, or null when it can be drawn. */
export function placementProblem(p: MapPlacement): string | null {
  const values = [p.west, p.east, p.south, p.north];
  if (!values.every(Number.isFinite)) return "Type all four edges as numbers in degrees.";
  if (p.west < -180 || p.east > 180 || p.west >= p.east) return "West must be less than east, both between -180 and 180.";
  if (p.south < -90 || p.north > 90 || p.south >= p.north) return "South must be less than north, both between -90 and 90.";
  if (p.projection === "mercator" && (p.north > MERCATOR_LAT + 1e-6 || p.south < -MERCATOR_LAT - 1e-6)) {
    return `A Web Mercator image stops at ${MERCATOR_LAT.toFixed(2)} degrees north and south.`;
  }
  return null;
}

/**
 * Reads a world file (.jgw, .pgw, .wld: six numbers, one per line) for an image of
 * width x height pixels. Degrees give a plate carree placement; metres (values beyond
 * any degree range) are Web Mercator (EPSG:3857) and are converted to lon/lat.
 * Rotated images are refused: they cannot be placed by four edges.
 */
export function parseWorldFile(text: string, width: number, height: number): MapPlacement | { error: string } {
  const nums = text.split(/\s+/).filter((s) => s !== "").map(Number);
  if (nums.length < 6 || !nums.slice(0, 6).every(Number.isFinite)) {
    return { error: "A world file has six numbers, one per line; this one does not." };
  }
  const [a, d, b, e, c, f] = nums as [number, number, number, number, number, number];
  if (Math.abs(d) > 1e-12 || Math.abs(b) > 1e-12) return { error: "This world file rotates the image; only north-up images can be placed." };
  if (!(a > 0) || !(e < 0)) return { error: "This world file does not describe a north-up image (pixel size must be positive across, negative down)." };
  // c, f are the centre of the top-left pixel.
  const x0 = c - a / 2, y0 = f - e / 2, x1 = x0 + a * width, y1 = y0 + e * height;
  const metres = Math.max(Math.abs(x0), Math.abs(x1)) > 180.5 || Math.max(Math.abs(y0), Math.abs(y1)) > 90.5;
  const placement: MapPlacement = metres
    ? {
        west: (x0 / R) * (180 / Math.PI),
        east: (x1 / R) * (180 / Math.PI),
        north: latOfMercY(y0 / R),
        south: latOfMercY(y1 / R),
        projection: "mercator",
      }
    : { west: x0, east: x1, north: y0, south: y1, projection: "plate" };
  placement.west = Math.max(-180, placement.west);
  placement.east = Math.min(180, placement.east);
  const problem = placementProblem(placement);
  return problem === null ? placement : { error: problem };
}

/** One drawImage call: a source rectangle of the image onto a destination rectangle. */
export interface DrawOp {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * How to draw an image placed at `p` into a plot of w x h pixels at (x0, y0) that
 * shows `view`. Plate carree is one rectangle (cropped to what is visible). Mercator
 * rows are uneven in latitude, so it is drawn in horizontal strips, each a band of
 * latitude whose image rows are found through the mercator y.
 */
export function backgroundOps(
  p: MapPlacement,
  imgW: number,
  imgH: number,
  view: MapWindow,
  x0: number,
  y0: number,
  w: number,
  h: number,
  strips = 96,
): DrawOp[] {
  const lonA = Math.max(p.west, view.lonMin), lonB = Math.min(p.east, view.lonMax);
  const latA = Math.max(p.south, view.latMin), latB = Math.min(p.north, view.latMax);
  if (!(lonB > lonA) || !(latB > latA) || imgW <= 0 || imgH <= 0) return [];
  const px = (lon: number): number => x0 + ((lon - view.lonMin) / (view.lonMax - view.lonMin)) * w;
  const py = (lat: number): number => y0 + ((view.latMax - lat) / (view.latMax - view.latMin)) * h;
  const sx = ((lonA - p.west) / (p.east - p.west)) * imgW;
  const sw = ((lonB - lonA) / (p.east - p.west)) * imgW;
  const dx = px(lonA), dw = px(lonB) - dx;
  if (p.projection === "plate") {
    const sy = ((p.north - latB) / (p.north - p.south)) * imgH;
    const sh = ((latB - latA) / (p.north - p.south)) * imgH;
    return [{ sx, sy, sw, sh, dx, dy: py(latB), dw, dh: py(latA) - py(latB) }];
  }
  const top = mercY(p.north), span = top - mercY(p.south);
  const row = (lat: number): number => ((top - mercY(lat)) / span) * imgH;
  // Strips even in screen pixels, at least one per two pixels of height on small plots.
  const n = Math.max(1, Math.min(strips, Math.ceil((py(latA) - py(latB)) / 2)));
  const ops: DrawOp[] = [];
  for (let k = 0; k < n; k++) {
    const hiLat = latB - ((latB - latA) * k) / n, loLat = latB - ((latB - latA) * (k + 1)) / n;
    const s0 = row(hiLat), s1 = row(loLat);
    const d0 = py(hiLat), d1 = py(loLat);
    // Overlap destination strips by half a pixel so no hairline gaps show.
    ops.push({ sx, sy: s0, sw, sh: Math.max(1e-3, s1 - s0), dx, dy: d0, dw, dh: d1 - d0 + 0.5 });
  }
  return ops;
}
