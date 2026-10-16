/**
 * A tiny TopoJSON decoder for the vendored world basemap (map view spike,
 * plan §8 candidate 2). No dependency: quantized arcs are delta-decoded once
 * and projected equirectangular at draw time.
 */

export interface TopoTransform {
  scale: [number, number];
  translate: [number, number];
}

export interface TopoGeometry {
  type: string;
  /** Polygon: ring[] of arc indexes; MultiPolygon: ring[][]. */
  arcs?: unknown;
  properties?: { name?: string };
  id?: string | number;
}

export interface TopoObject {
  type: string;
  geometries?: TopoGeometry[];
}

export interface TopoWorld {
  type: string;
  transform?: TopoTransform;
  arcs: number[][][];
  objects: Record<string, TopoObject>;
}

/** One ring as flat lon/lat pairs. */
export type GeoRing = Float64Array;

export interface GeoCountry {
  name: string;
  rings: GeoRing[];
}

/**
 * Decodes every arc to absolute lon/lat. Quantized TopoJSON stores deltas in
 * transformed units; unquantized files store absolute positions.
 */
export function decodeArcs(world: TopoWorld): GeoRing[] {
  const transform = world.transform;
  const scaleX = transform?.scale[0] ?? 1;
  const scaleY = transform?.scale[1] ?? 1;
  const translateX = transform?.translate[0] ?? 0;
  const translateY = transform?.translate[1] ?? 0;
  return world.arcs.map((arc) => {
    const points = new Float64Array(arc.length * 2);
    let x = 0;
    let y = 0;
    for (let i = 0; i < arc.length; i++) {
      const point = arc[i];
      x += point[0] ?? 0;
      y += point[1] ?? 0;
      points[i * 2] = x * scaleX + translateX;
      points[i * 2 + 1] = y * scaleY + translateY;
    }
    return points;
  });
}

/** One ring of arc indexes, resolving negatives and stitching endpoints. */
function ringPoints(arcs: readonly GeoRing[], indexes: readonly number[]): GeoRing {
  const out: number[] = [];
  for (const entry of indexes) {
    const arc = arcs[entry < 0 ? ~entry : entry];
    if (arc === undefined) continue;
    const reversed = entry < 0;
    const count = arc.length / 2;
    for (let i = 0; i < count; i++) {
      const index = reversed ? count - 1 - i : i;
      const x = arc[index * 2] ?? 0;
      const y = arc[index * 2 + 1] ?? 0;
      // The previous arc's last point equals this arc's first: skip the seam.
      if (out.length >= 2 && out[out.length - 2] === x && out[out.length - 1] === y) {
        continue;
      }
      out.push(x, y);
    }
  }
  return Float64Array.from(out);
}

/** Rings (arc-index lists) of a geometry, normalizing Polygon/MultiPolygon. */
function polygonRings(geometry: TopoGeometry): number[][] {
  const rings: number[][] = [];
  for (const entry of (geometry.arcs ?? []) as unknown[]) {
    if (!Array.isArray(entry) || entry.length === 0) continue;
    if (Array.isArray(entry[0])) {
      for (const ring of entry) {
        if (Array.isArray(ring) && ring.length > 0) rings.push(ring as number[]);
      }
    } else {
      rings.push(entry as number[]);
    }
  }
  return rings;
}

/** Country outlines with names, ready to fill and stroke. */
export function decodeCountries(world: TopoWorld, arcs?: GeoRing[]): GeoCountry[] {
  const decoded = arcs ?? decodeArcs(world);
  const object = world.objects.countries;
  if (object?.geometries === undefined) return [];
  const countries: GeoCountry[] = [];
  for (const geometry of object.geometries) {
    const rings: GeoRing[] = [];
    for (const indexes of polygonRings(geometry)) {
      const ring = ringPoints(decoded, indexes);
      if (ring.length >= 6) rings.push(ring);
    }
    if (rings.length > 0) {
      countries.push({ name: geometry.properties?.name ?? "", rings });
    }
  }
  return countries;
}

/** Land rings only (one outline set, cheaper to draw than every border). */
export function decodeLand(world: TopoWorld, arcs?: GeoRing[]): GeoRing[] {
  const decoded = arcs ?? decodeArcs(world);
  const object = world.objects.land;
  if (object?.geometries === undefined) return [];
  const rings: GeoRing[] = [];
  for (const geometry of object.geometries) {
    for (const indexes of polygonRings(geometry)) {
      const ring = ringPoints(decoded, indexes);
      if (ring.length >= 6) rings.push(ring);
    }
  }
  return rings;
}

/** Equirectangular projection: lon/lat degrees to [0,1] unit coordinates. */
export function projectLon(lon: number): number {
  return (lon + 180) / 360;
}

export function projectLat(lat: number): number {
  return (90 - lat) / 180;
}
