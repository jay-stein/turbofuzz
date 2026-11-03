import { resolveCrs, toLonLat, type ResolvedCrs } from "./geo-crs.js";

export interface GeoFeature {
  label: string;
  properties: Record<string, string | number | boolean | null>;
  rings: Float64Array[];
  /** One per ring: a hole cut from the polygon before it. */
  holes: boolean[];
}

export interface GeoCrsInfo {
  label: string;
  /** How it was known: stated by the file, assumed from the range of the numbers, or chosen by the person. */
  source: "file" | "assumed" | "user";
  /** The numbers were worked into longitude and latitude. */
  converted: boolean;
}

export interface GeoLayerInfo {
  name: string;
  features: number;
}

export interface GeoDataset {
  features: GeoFeature[];
  bounds: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  sourceName: string;
  crs: GeoCrsInfo;
  /** A zip can hold several shapefiles; `layer` is the one read. */
  layers: GeoLayerInfo[];
  layer: string;
}

export interface GeoReadOptions {
  /** The person's override: what the file's numbers are in. */
  crs?: string;
  layer?: string;
}

/** The file's coordinates are not degrees and it does not say what they are, or says in a way that cannot be read. */
export class GeoCrsNeededError extends Error {
  constructor(
    message: string,
    readonly stated: string | null,
    readonly range: { xMin: number; xMax: number; yMin: number; yMax: number } | null,
  ) {
    super(message);
    this.name = "GeoCrsNeededError";
  }
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

function ringsOf(geometry: Geometry | null | undefined): { rings: Float64Array[]; holes: boolean[] } {
  const rings: Float64Array[] = [];
  const holes: boolean[] = [];
  const polygon = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return;
    coordinates.forEach((ring, index) => {
      const parsed = ringFrom(ring);
      if (parsed === null) return;
      rings.push(parsed);
      holes.push(index > 0);
    });
  };
  if (geometry === null || geometry === undefined) return { rings, holes };
  if (geometry.type === "Polygon") polygon(geometry.coordinates);
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) geometry.coordinates.forEach(polygon);
  return { rings, holes };
}

/** A field that names things: `NAME`, `SA2_NAME21`, `BoroName`, `NAME_1`. Failing that, the feature's own id. */
function labelOf(feature: FeatureLike, index: number): string {
  const props = feature.properties ?? {};
  const keys = Object.keys(props);
  const named = keys.find((key) => /(^|_)name($|_|\d)|name$/i.test(key) && typeof props[key] === "string" && String(props[key]).trim() !== "");
  if (named !== undefined) return String(props[named]);
  for (const key of ["label", "LABEL", "id", "ID"]) {
    const value = props[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return feature.id !== undefined ? String(feature.id) : `Region ${index + 1}`;
}

function plainProperties(feature: FeatureLike): GeoFeature["properties"] {
  const properties: GeoFeature["properties"] = {};
  for (const [key, value] of Object.entries(feature.properties ?? {})) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      properties[key] = typeof value === "string" ? value.trim() : value;
    } else {
      properties[key] = value === undefined ? null : String(value);
    }
  }
  return properties;
}

/** Degrees or not, by the numbers alone. */
function rangeOf(features: readonly GeoFeature[]): { xMin: number; xMax: number; yMin: number; yMax: number } {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const feature of features) {
    for (const ring of feature.rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const x = ring[i]!, y = ring[i + 1]!;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }
  return { xMin, xMax, yMin, yMax };
}

const looksLikeDegrees = (range: ReturnType<typeof rangeOf>): boolean =>
  range.xMin >= -180.001 && range.xMax <= 360.001 && range.yMin >= -90.001 && range.yMax <= 90.001;

/**
 * Settles what the numbers are, in order of who knows best: the person, then the file, then the numbers themselves. A
 * result outside the Earth is never drawn: it asks instead.
 */
function settleCrs(features: GeoFeature[], stated: string | null, override: string | undefined): GeoCrsInfo {
  const range = rangeOf(features);
  let crs: ResolvedCrs | null = null;
  let source: GeoCrsInfo["source"] = "file";
  if (override !== undefined && override.trim() !== "") {
    crs = resolveCrs(override);
    source = "user";
    if (crs === null) throw new GeoCrsNeededError(`"${override.trim().slice(0, 60)}" is not a coordinate system this offline app knows. Paste its proj4 string or WKT instead (epsg.io has them).`, stated, range);
  } else if (stated !== null) {
    crs = resolveCrs(stated);
    if (crs === null) throw new GeoCrsNeededError("The file states a coordinate system this app cannot read. Choose it below.", stated, range);
  }
  if (crs === null) {
    if (!looksLikeDegrees(range)) {
      throw new GeoCrsNeededError(
        `The file does not say what its coordinates are, and they are not degrees (x ${Math.round(range.xMin).toLocaleString("en")} to ${Math.round(range.xMax).toLocaleString("en")}). Choose the coordinate system.`,
        null,
        range,
      );
    }
    return { label: "Not stated: the numbers look like longitude and latitude", source: "assumed", converted: false };
  }
  if (!crs.geographic) {
    const convert = toLonLat(crs);
    for (const feature of features) feature.rings.forEach(convert);
  }
  const after = rangeOf(features);
  const finite = Number.isFinite(after.xMin) && Number.isFinite(after.yMin);
  if (!finite || after.xMin < -180.5 || after.xMax > 360.5 || after.yMin < -90.5 || after.yMax > 90.5) {
    throw new GeoCrsNeededError(`Read as ${crs.label}, the file lands outside the Earth. Choose another coordinate system.`, stated, range);
  }
  return { label: crs.label, source, converted: !crs.geographic };
}

function datasetFrom(raw: readonly FeatureLike[], stated: string | null, sourceName: string, options: GeoReadOptions, layers: GeoLayerInfo[], layer: string): GeoDataset {
  const features: GeoFeature[] = [];
  raw.forEach((feature, index) => {
    const { rings, holes } = ringsOf(feature.geometry);
    if (rings.length === 0) return;
    features.push({ label: labelOf(feature, index), properties: plainProperties(feature), rings, holes });
  });
  if (features.length === 0) throw new Error("No polygon or multipolygon features were found.");
  const crs = settleCrs(features, stated, options.crs);
  const range = rangeOf(features);
  if (!(range.xMax > range.xMin && range.yMax > range.yMin)) throw new Error("The geometry bounds are empty.");
  return { features, bounds: { lonMin: range.xMin, lonMax: range.xMax, latMin: range.yMin, latMax: range.yMax }, sourceName, crs, layers, layer };
}

function fromGeoJson(parsed: unknown, sourceName: string, options: GeoReadOptions, layers: GeoLayerInfo[] = [], layer = ""): GeoDataset {
  if (parsed === null || typeof parsed !== "object") throw new Error("That file does not contain a GeoJSON object.");
  const object = parsed as { type?: string; features?: FeatureLike[]; geometry?: Geometry; crs?: { properties?: { name?: string } } };
  const raw: FeatureLike[] = Array.isArray(parsed)
    ? (parsed as FeatureLike[])
    : object.type === "FeatureCollection" && Array.isArray(object.features)
      ? object.features
      : object.type === "Feature"
        ? [object as FeatureLike]
        : [{ type: "Feature", properties: {}, geometry: object as Geometry }];
  // GeoJSON is longitude and latitude unless it says otherwise; old files do say, in a crs member.
  const stated = object.crs?.properties?.name ?? null;
  return datasetFrom(raw, stated, sourceName, options, layers, layer);
}

/** Every shapefile in a zip: a boundary download often holds several, such as a country and its counties. */
async function fromZip(buffer: ArrayBuffer, fileName: string, options: GeoReadOptions): Promise<GeoDataset> {
  const [{ iter }, shp] = await Promise.all([import("but-unzip"), import("shpjs")]);
  const { parseShp, parseDbf } = shp as unknown as {
    parseShp(shape: DataView, prj?: string): unknown[];
    parseDbf(table: DataView, encoding?: string): Record<string, unknown>[];
  };
  const files = new Map<string, Uint8Array>();
  for (const entry of iter(new Uint8Array(buffer))) {
    if (entry.filename.includes("__MACOSX") || !/\.(shp|dbf|prj|cpg|geojson|json|gpkg)$/i.test(entry.filename)) continue;
    files.set(entry.filename, await entry.read());
  }
  const text = (bytes: Uint8Array | undefined): string | null => (bytes === undefined ? null : new TextDecoder().decode(bytes));
  const lower = new Map([...files.keys()].map((name) => [name.toLowerCase(), name]));
  const sibling = (base: string, extension: string): Uint8Array | undefined => {
    const name = lower.get(`${base}.${extension}`.toLowerCase());
    return name === undefined ? undefined : files.get(name);
  };
  const shps = [...files.keys()].filter((name) => /\.shp$/i.test(name));
  if (shps.length === 0) {
    const geojson = [...files.keys()].find((name) => /\.(geo)?json$/i.test(name));
    if (geojson !== undefined) return fromGeoJson(JSON.parse(text(files.get(geojson))!), fileName, options);
    if ([...files.keys()].some((name) => /\.gpkg$/i.test(name))) {
      throw new Error("That zip holds a GeoPackage, which this app does not read yet. Download the Shapefile version, or export the layer as GeoJSON.");
    }
    throw new Error("That zip has no shapefile (.shp) or GeoJSON in it.");
  }
  const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // How many shapes each holds, from the header of its index-free record list: the .dbf says, cheaply.
  const shapes = (base: string, shp: Uint8Array): number => {
    const dbf = sibling(base, "dbf");
    return dbf !== undefined && dbf.byteLength >= 8 ? view(dbf).getUint32(4, true) : shp.byteLength > 100 ? 1 : 0;
  };
  const layers: GeoLayerInfo[] = shps.map((name) => {
    const base = name.slice(0, -4);
    return { name: base.split("/").pop() ?? base, features: shapes(base, files.get(name)!) };
  });
  // The most detailed unless told otherwise: of a country and its counties, it is the counties that can be coloured.
  const wanted = options.layer ?? [...layers].sort((a, b) => b.features - a.features)[0]!.name;
  const at = Math.max(0, layers.findIndex((layer) => layer.name === wanted));
  const base = shps[at]!.slice(0, -4);
  const geometries = parseShp(view(files.get(shps[at]!)!)) as (Geometry | null)[];
  const dbf = sibling(base, "dbf");
  const records = dbf === undefined ? [] : parseDbf(view(dbf), text(sibling(base, "cpg")) ?? undefined);
  const raw: FeatureLike[] = geometries.map((geometry, index) => ({ type: "Feature", geometry, properties: records[index] ?? {} }));
  return datasetFrom(raw, text(sibling(base, "prj")), fileName, options, layers, layers[at]!.name);
}

/**
 * Reads a GeoJSON file or a zipped Shapefile, from anywhere: the coordinates end up as longitude and latitude, by what the
 * file states, what its numbers show, or what the person says. See settleCrs.
 */
export async function parseGeoFile(buffer: ArrayBuffer, fileName: string, options: GeoReadOptions = {}): Promise<GeoDataset> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) return fromZip(buffer, fileName, options);
  if (lower.endsWith(".shp")) throw new Error("A .shp file needs its .dbf and .prj beside it: put them in a zip and load that.");
  if (lower.endsWith(".gpkg")) throw new Error("This app does not read GeoPackage yet. Download the Shapefile version, or export the layer as GeoJSON.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new Error("That file is not valid GeoJSON or a Shapefile zip.");
  }
  return fromGeoJson(parsed, fileName, options);
}
