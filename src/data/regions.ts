/**
 * Boundary files for the Map page: shapes kept light enough to redraw at any zoom, a fast way to ask which region a point
 * is in, and the join between regions and a table's rows, by name or code, or by location.
 */
import { timeBucket, timeLabel, type TimeGrain } from "./aggregate.js";
import type { GeoDataset, GeoFeature } from "./geo-file.js";

// ------------------------------------------------------------------ Simplifying

/** Douglas-Peucker, without recursion: the points of a ring that matter at this tolerance, in degrees. */
export function simplifyRing(ring: Float64Array, tolerance: number): Float64Array {
  const n = ring.length / 2;
  if (n <= 4) return ring;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  // A closed ring has no baseline from first to last: split it at its farthest point from the start.
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < n - 1; i++) {
    const dx = ring[i * 2]! - ring[0]!;
    const dy = ring[i * 2 + 1]! - ring[1]!;
    const distance = dx * dx + dy * dy;
    if (distance > farDistance) {
      farDistance = distance;
      far = i;
    }
  }
  keep[far] = 1;
  const stack: number[] = [0, far, far, n - 1];
  const squared = tolerance * tolerance;
  while (stack.length > 0) {
    const end = stack.pop()!;
    const start = stack.pop()!;
    if (end - start < 2) continue;
    const ax = ring[start * 2]!;
    const ay = ring[start * 2 + 1]!;
    const dx = ring[end * 2]! - ax;
    const dy = ring[end * 2 + 1]! - ay;
    const length = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = start + 1; i < end; i++) {
      const px = ring[i * 2]! - ax;
      const py = ring[i * 2 + 1]! - ay;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / length));
      const ox = px - t * dx;
      const oy = py - t * dy;
      const distance = ox * ox + oy * oy;
      if (distance > worst) {
        worst = distance;
        at = i;
      }
    }
    if (worst > squared && at > 0) {
      keep[at] = 1;
      stack.push(start, at, at, end);
    }
  }
  // A ring smaller than the tolerance still needs to be a shape: a sliver through its two farthest points and two more.
  keep[far >> 1] = 1;
  keep[(far + n - 1) >> 1] = 1;
  let kept = 0;
  for (let i = 0; i < n; i++) kept += keep[i]!;
  const out = new Float64Array(kept * 2);
  let write = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i] === 0) continue;
    out[write++] = ring[i * 2]!;
    out[write++] = ring[i * 2 + 1]!;
  }
  return out;
}

/** One zoom's worth of a region's shape. */
export type RegionLevel = Float64Array[];

export interface RegionShape {
  label: string;
  properties: GeoFeature["properties"];
  /** Coarsest first; each has the holes-and-all rings at `tolerances[i]`. */
  levels: RegionLevel[];
  /** lonMin, latMin, lonMax, latMax. */
  bbox: [number, number, number, number];
  /** In square kilometres, holes taken off. */
  areaKm2: number;
}

const EARTH_RADIUS_KM = 6371.0088;

/** A ring's area on the sphere, signless. */
function ringAreaKm2(ring: Float64Array): number {
  let sum = 0;
  const n = ring.length / 2;
  const radians = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += (ring[j * 2]! - ring[i * 2]!) * radians * (2 + Math.sin(ring[i * 2 + 1]! * radians) + Math.sin(ring[j * 2 + 1]! * radians));
  }
  return Math.abs((sum * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

export function featureAreaKm2(feature: GeoFeature): number {
  let area = 0;
  feature.rings.forEach((ring, index) => {
    area += (feature.holes[index] === true ? -1 : 1) * ringAreaKm2(ring);
  });
  return Math.max(0, area);
}

/** Up to here a file's own detail goes to the page as is, so zooming right in shows it all. */
const FULL_DETAIL_POINTS = 1_500_000;

/**
 * Levels for drawing: each four times as fine as the last, from about a thousandth of the file's width. A ring too small
 * to see at a level is left out of it, except a region's largest, so no region vanishes.
 */
export function buildShapes(geo: GeoDataset): { shapes: RegionShape[]; tolerances: number[]; points: number } {
  const span = Math.max(geo.bounds.lonMax - geo.bounds.lonMin, geo.bounds.latMax - geo.bounds.latMin);
  const tolerances = [span / 1000, span / 4000, span / 16000, span / 64000];
  let points = 0;
  for (const feature of geo.features) for (const ring of feature.rings) points += ring.length / 2;
  const withFull = points <= FULL_DETAIL_POINTS;
  const shapes = geo.features.map((feature) => {
    let lonMin = Infinity, latMin = Infinity, lonMax = -Infinity, latMax = -Infinity;
    const boxes = feature.rings.map((ring) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        if (ring[i]! < x0) x0 = ring[i]!;
        if (ring[i]! > x1) x1 = ring[i]!;
        if (ring[i + 1]! < y0) y0 = ring[i + 1]!;
        if (ring[i + 1]! > y1) y1 = ring[i + 1]!;
      }
      lonMin = Math.min(lonMin, x0);
      latMin = Math.min(latMin, y0);
      lonMax = Math.max(lonMax, x1);
      latMax = Math.max(latMax, y1);
      return Math.max(x1 - x0, y1 - y0);
    });
    const largest = boxes.indexOf(Math.max(...boxes));
    const levels: RegionLevel[] = tolerances.map((tolerance) => {
      const level: Float64Array[] = [];
      feature.rings.forEach((ring, index) => {
        if (index !== largest && boxes[index]! < tolerance * 2) return;
        level.push(simplifyRing(ring, tolerance));
      });
      return level;
    });
    if (withFull) levels.push(feature.rings.map((ring) => Float64Array.from(ring)));
    return { label: feature.label, properties: feature.properties, levels, bbox: [lonMin, latMin, lonMax, latMax] as [number, number, number, number], areaKm2: featureAreaKm2(feature) };
  });
  return { shapes, tolerances: withFull ? [...tolerances, 0] : tolerances, points };
}

/** The level fine enough that an error stays under a pixel, for a view this many degrees to the pixel. */
export function levelFor(tolerances: readonly number[], degreesPerPixel: number): number {
  for (let i = 0; i < tolerances.length; i++) if (tolerances[i]! <= degreesPerPixel) return i;
  return tolerances.length - 1;
}

// ------------------------------------------------------------------ Which region is a point in?

/** Even-odd across every ring, so holes and separate parts both come out right. */
export function pointInFeature(feature: Pick<GeoFeature, "rings">, lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of feature.rings) {
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = ring[i * 2 + 1]!;
      const yj = ring[j * 2 + 1]!;
      if (yi > lat !== yj > lat) {
        const xi = ring[i * 2]!;
        const xj = ring[j * 2]!;
        if (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

/** A grid over the file's area, each cell listing the regions whose box touches it, so a lookup tests only a few. */
export class RegionIndex {
  private readonly cells: number[][];
  private readonly size: number;
  private readonly lonSpan: number;
  private readonly latSpan: number;
  private readonly boxes: [number, number, number, number][];

  constructor(
    private readonly features: readonly GeoFeature[],
    private readonly bounds: GeoDataset["bounds"],
  ) {
    this.size = Math.max(8, Math.min(512, Math.ceil(Math.sqrt(features.length) * 4)));
    this.cells = Array.from({ length: this.size * this.size }, () => []);
    this.lonSpan = Math.max(1e-12, bounds.lonMax - bounds.lonMin);
    this.latSpan = Math.max(1e-12, bounds.latMax - bounds.latMin);
    this.boxes = features.map((feature, index) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const ring of feature.rings) {
        for (let i = 0; i < ring.length; i += 2) {
          if (ring[i]! < x0) x0 = ring[i]!;
          if (ring[i]! > x1) x1 = ring[i]!;
          if (ring[i + 1]! < y0) y0 = ring[i + 1]!;
          if (ring[i + 1]! > y1) y1 = ring[i + 1]!;
        }
      }
      const cx0 = this.cellX(x0);
      const cx1 = this.cellX(x1);
      const cy0 = this.cellY(y0);
      const cy1 = this.cellY(y1);
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) this.cells[y * this.size + x]!.push(index);
      return [x0, y0, x1, y1];
    });
  }

  private cellX(lon: number): number {
    return Math.max(0, Math.min(this.size - 1, Math.floor(((lon - this.bounds.lonMin) / this.lonSpan) * this.size)));
  }

  private cellY(lat: number): number {
    return Math.max(0, Math.min(this.size - 1, Math.floor(((lat - this.bounds.latMin) / this.latSpan) * this.size)));
  }

  /** The region this point falls in, or -1. Where shapes overlap, the first in the file. */
  locate(lon: number, lat: number): number {
    if (!(lon >= this.bounds.lonMin && lon <= this.bounds.lonMax && lat >= this.bounds.latMin && lat <= this.bounds.latMax)) return -1;
    for (const index of this.cells[this.cellY(lat) * this.size + this.cellX(lon)]!) {
      const box = this.boxes[index]!;
      if (lon < box[0] || lat < box[1] || lon > box[2] || lat > box[3]) continue;
      if (pointInFeature(this.features[index]!, lon, lat)) return index;
    }
    return -1;
  }
}

// ------------------------------------------------------------------ Matching names

/**
 * The form in which a table's value and a boundary's value are compared: case and spacing do not count, and a code
 * written as a number matches itself written with leading zeros or a trailing ".0" ("0800", "800", "800.0").
 */
export function joinKey(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  if (/^-?\d+(\.0+)?$/.test(text)) return text.replace(/\.0+$/, "").replace(/^(-?)0+(?=\d)/, "$1");
  return text;
}

export interface JoinSuggestion {
  property: string;
  column: number;
  /** Regions with a match in the column, of all regions. */
  matched: number;
  regions: number;
  /** Both sides are plain numbers, which overlap by chance: a row number and a region id are both 1, 2, 3. */
  numeric: boolean;
}

/** A field that names regions best: mostly different values, in words rather than codes, and called something like a name. */
export function chooseLabelProperty(features: readonly GeoFeature[]): string | null {
  const keys = new Set<string>();
  for (const feature of features.slice(0, 50)) for (const key of Object.keys(feature.properties)) keys.add(key);
  let best: string | null = null;
  let bestScore = 0;
  for (const key of keys) {
    const values = features.map((feature) => feature.properties[key]).filter((value): value is string => typeof value === "string" && value !== "");
    if (values.length === 0) continue;
    const distinct = new Set(values).size / features.length;
    const wordy = values.filter((value) => /^[^\d]+$/.test(value) && !/^https?:/i.test(value)).length / values.length;
    const length = values.reduce((sum, value) => sum + value.length, 0) / values.length;
    if (/^(.*_)?(uri|url|link|type|engtype|varname|nl_name|iso|hasc|cca|ccn|fips)(_?\d*)$/i.test(key)) continue;
    const score = distinct * 2 + wordy * 2 + (length >= 3 ? 1 : 0) + (/name/i.test(key) ? 0.5 : 0);
    if (distinct > 0.5 && score > bestScore) {
      best = key;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Which boundary field goes with which table column: by how many regions find their value there, best first. `columns`
 * gives each candidate column's distinct values; numeric-looking fields are compared too, since codes often are.
 */
export function suggestJoins(features: readonly GeoFeature[], columns: readonly { index: number; values: ReadonlySet<string> }[]): JoinSuggestion[] {
  const keys = new Set<string>();
  for (const feature of features.slice(0, 50)) for (const key of Object.keys(feature.properties)) keys.add(key);
  const out: JoinSuggestion[] = [];
  for (const property of keys) {
    const regionKeys = features.map((feature) => joinKey(feature.properties[property]));
    const numeric = regionKeys.every((key) => key === "" || /^-?\d+$/.test(key));
    const distinct = new Set(regionKeys).size;
    // A field all regions share (a country name) says nothing about which is which.
    if (features.length > 1 && distinct < Math.max(2, features.length * 0.3)) continue;
    for (const column of columns) {
      let matched = 0;
      for (const key of regionKeys) if (key !== "" && column.values.has(key)) matched++;
      if (matched === 0) continue;
      // A number needs most regions to find their match before it means anything.
      if (numeric && matched < features.length * 0.8) continue;
      out.push({ property, column: column.index, matched, regions: features.length, numeric });
    }
  }
  return out.sort((a, b) => Number(a.numeric) - Number(b.numeric) || b.matched - a.matched);
}

// ------------------------------------------------------------------ Values per region

export type RegionAgg = "count" | "sum" | "mean" | "median" | "min" | "max";

export interface RegionFrames {
  labels: string[];
  times: number[];
}

export interface RegionValues {
  /** frames × regions, row-major (one frame when not stepping through time). NaN where a region has no rows. */
  values: Float64Array;
  rows: Uint32Array;
  frames: RegionFrames | null;
  /** Rows that landed in a region, and those that did not. */
  rowsMatched: number;
  rowsUnmatched: number;
  regionsMatched: number;
  /** By-name matches only: the commonest table values with no region, for the report. */
  unmatchedValues: { value: string; rows: number }[];
}

/** Everything but where a row belongs is the same for both ways of matching. */
export function aggregateRegions(input: {
  regions: number;
  ids: Uint32Array;
  /** The regions a row belongs to; more than one when several shapes share a name. */
  regionsOf: (row: number) => readonly number[];
  /** What a row with no region is called, for the report; null when it has no name to report. */
  unmatchedName?: (row: number) => string | null;
  measure: Float64Array | null;
  agg: RegionAgg;
  times?: Float64Array;
  grain?: TimeGrain;
}): RegionValues {
  const { regions, ids, regionsOf, measure, agg, times, grain } = input;
  let frameIndex: Map<number, number> | null = null;
  let frames: RegionFrames | null = null;
  if (times !== undefined && grain !== undefined) {
    const seen = new Set<number>();
    for (let position = 0; position < ids.length; position++) {
      const time = times[ids[position]!]!;
      if (Number.isFinite(time)) seen.add(timeBucket(time, grain));
    }
    const sorted = [...seen].sort((a, b) => a - b);
    frameIndex = new Map(sorted.map((time, index) => [time, index]));
    frames = { labels: sorted.map((time) => timeLabel(time, grain)), times: sorted };
  }
  const frameCount = frames === null ? 1 : Math.max(1, frames.times.length);
  const cells = frameCount * regions;
  const rows = new Uint32Array(cells);
  const seen = new Uint32Array(cells);
  const sum = new Float64Array(cells);
  const low = new Float64Array(cells).fill(Number.POSITIVE_INFINITY);
  const high = new Float64Array(cells).fill(Number.NEGATIVE_INFINITY);
  const lists: number[][] | null = agg === "median" ? Array.from({ length: cells }, () => []) : null;
  let rowsMatched = 0;
  let rowsUnmatched = 0;
  const unmatched = new Map<string, number>();
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position]!;
    let frame = 0;
    if (frameIndex !== null) {
      const time = times![row]!;
      if (!Number.isFinite(time)) continue;
      frame = frameIndex.get(timeBucket(time, grain!))!;
    }
    const targets = regionsOf(row);
    if (targets.length === 0) {
      rowsUnmatched++;
      const name = input.unmatchedName?.(row);
      if (name !== undefined && name !== null && name !== "") unmatched.set(name, (unmatched.get(name) ?? 0) + 1);
      continue;
    }
    rowsMatched++;
    const value = measure === null ? Number.NaN : measure[row]!;
    for (const region of targets) {
      const cell = frame * regions + region;
      rows[cell]!++;
      if (!Number.isFinite(value)) continue;
      seen[cell]!++;
      sum[cell]! += value;
      if (value < low[cell]!) low[cell] = value;
      if (value > high[cell]!) high[cell] = value;
      lists?.[cell]!.push(value);
    }
  }
  const values = new Float64Array(cells);
  let regionsMatched = 0;
  const touched = new Uint8Array(regions);
  for (let cell = 0; cell < cells; cell++) {
    if (rows[cell]! > 0) touched[cell % regions] = 1;
    if (rows[cell] === 0) {
      values[cell] = Number.NaN;
    } else if (measure === null || agg === "count") {
      values[cell] = rows[cell]!;
    } else if (seen[cell] === 0) {
      values[cell] = Number.NaN;
    } else if (agg === "sum") {
      values[cell] = sum[cell]!;
    } else if (agg === "mean") {
      values[cell] = sum[cell]! / seen[cell]!;
    } else if (agg === "min") {
      values[cell] = low[cell]!;
    } else if (agg === "max") {
      values[cell] = high[cell]!;
    } else {
      const list = lists![cell]!.sort((a, b) => a - b);
      const middle = (list.length - 1) / 2;
      values[cell] = (list[Math.floor(middle)]! + list[Math.ceil(middle)]!) / 2;
    }
  }
  for (let region = 0; region < regions; region++) regionsMatched += touched[region]!;
  const unmatchedValues = [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([value, count]) => ({ value, rows: count }));
  return { values, rows, frames, rowsMatched, rowsUnmatched, regionsMatched, unmatchedValues };
}
