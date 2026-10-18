export interface GeoFeature {
  label: string;
  properties: Record<string, string | number | boolean | null>;
  rings: Float64Array[];
}

export interface GeoDataset {
  features: GeoFeature[];
  bounds: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  sourceName: string;
}

type Geometry = {
  type: string;
  coordinates?: unknown;
};

type FeatureLike = {
  type?: string;
  properties?: Record<string, unknown> | null;
  geometry?: Geometry | null;
  id?: string | number;
};

function ringFrom(value: unknown): Float64Array | null {
  if (!Array.isArray(value)) return null;
  const coords: number[] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    coords.push(lon, lat);
  }
  return coords.length >= 6 ? Float64Array.from(coords) : null;
}

function ringsOf(geometry: Geometry | null | undefined): Float64Array[] {
  if (geometry === null || geometry === undefined) return [];
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map(ringFrom)
      .filter((ring): ring is Float64Array => ring !== null);
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    const rings: Float64Array[] = [];
    for (const polygon of geometry.coordinates) {
      if (!Array.isArray(polygon)) continue;
      for (const ring of polygon) {
        const parsed = ringFrom(ring);
        if (parsed !== null) rings.push(parsed);
      }
    }
    return rings;
  }
  return [];
}

function labelOf(feature: FeatureLike, index: number): string {
  const props = feature.properties ?? {};
  for (const key of ["name", "NAME", "Name", "label", "LABEL", "id", "ID"]) {
    const value = props[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return feature.id !== undefined ? String(feature.id) : `Feature ${index + 1}`;
}

function fromGeoJson(parsed: unknown, sourceName: string): GeoDataset {
  let collection: unknown = parsed;
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { features?: unknown }).features) === false &&
    Array.isArray(parsed)
  ) {
    collection = { type: "FeatureCollection", features: parsed };
  }
  if (Array.isArray(collection)) {
    // Shapefile bundles can return several FeatureCollections.
    const merged: FeatureLike[] = [];
    for (const entry of collection) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        Array.isArray((entry as { features?: unknown }).features)
      ) {
        merged.push(...((entry as { features: FeatureLike[] }).features ?? []));
      }
    }
    collection = { type: "FeatureCollection", features: merged };
  }
  if (collection === null || typeof collection !== "object") {
    throw new Error("That file does not contain a GeoJSON object.");
  }
  const object = collection as { type?: string; features?: FeatureLike[]; geometry?: Geometry };
  const raw =
    object.type === "FeatureCollection" && Array.isArray(object.features)
      ? object.features
      : object.type === "Feature"
        ? [object as FeatureLike]
        : [{ type: "Feature", properties: {}, geometry: object as Geometry }];

  if (object.type === "FeatureCollection" && (object as { crs?: unknown }).crs !== undefined) {
    const crs = (object as { crs?: { properties?: { name?: string } } }).crs;
    const name = crs?.properties?.name ?? "";
    if (!/(CRS84|4326|WGS.?84)/i.test(name)) {
      throw new Error(
        `GeoJSON CRS "${name || "unknown"}" is not WGS84. Reproject the file to EPSG:4326 first.`,
      );
    }
  }

  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;
  const features: GeoFeature[] = [];
  raw.forEach((feature, index) => {
    const rings = ringsOf(feature.geometry);
    if (rings.length === 0) return;
    const properties: GeoFeature["properties"] = {};
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        properties[key] = value;
      } else {
        properties[key] = value === undefined ? null : String(value);
      }
    }
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const lon = ring[i] ?? 0;
        const lat = ring[i + 1] ?? 0;
        if (lon < lonMin) lonMin = lon;
        if (lon > lonMax) lonMax = lon;
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
      }
    }
    features.push({ label: labelOf(feature, index), properties, rings });
  });

  if (features.length === 0) {
    throw new Error("No polygon or multipolygon features were found.");
  }
  if (!(lonMax > lonMin && latMax > latMin)) {
    throw new Error("The geometry bounds are empty.");
  }
  return {
    features,
    bounds: { lonMin, lonMax, latMin, latMax },
    sourceName,
  };
}

/**
 * Parses a GeoJSON file or a zipped Shapefile bundle. Shapefile attributes and
 * projections are handled by shpjs; GeoJSON must already be WGS84.
 */
export async function parseGeoFile(buffer: ArrayBuffer, fileName: string): Promise<GeoDataset> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) {
    const module = await import("shpjs");
    const result = await module.default(buffer);
    return fromGeoJson(result, fileName);
  }
  if (lower.endsWith(".shp")) {
    throw new Error("Direct .shp files need their .dbf and .prj files - upload a zipped bundle.");
  }
  const text = new TextDecoder().decode(buffer);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid GeoJSON or a Shapefile zip.");
  }
  return fromGeoJson(parsed, fileName);
}
