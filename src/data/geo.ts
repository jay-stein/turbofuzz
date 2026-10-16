import type { ColumnMeta } from "../worker/protocol.js";

/**
 * Geographic parsing and detection (map view spike, plan §8). Fully offline:
 * decimal degrees and DMS forms for latitude/longitude, name- and range-based
 * pair detection. UTM/MGRS/geohash are explicitly out of scope (memo no-go).
 */

const HEMI = /^[NSEW]$/;

/**
 * Parses one coordinate in decimal degrees or degrees/minutes/seconds, with an
 * optional hemisphere letter before or after the number ("51°30'26\"N",
 * "51 30 26 N", "N51 30 26", "51.5074 N", "-33.8688", "E151 12 30").
 * Returns null for anything malformed or out of the axis' range.
 */
function parseDegrees(text: string, axis: "lat" | "lon"): number | null {
  let trimmed = text.trim().toUpperCase().replace(",", ".");
  if (trimmed === "") return null;
  let hemisphere: string | null = null;
  const first = trimmed[0] ?? "";
  if (HEMI.test(first)) {
    hemisphere = first;
    trimmed = trimmed.slice(1).trim();
  } else {
    const last = trimmed[trimmed.length - 1] ?? "";
    if (HEMI.test(last)) {
      hemisphere = last;
      trimmed = trimmed.slice(0, -1).trim();
    }
  }
  if (trimmed === "") return null;
  const numbers = trimmed.match(/\d+(?:\.\d+)?/g);
  if (numbers === null || numbers.length === 0 || numbers.length > 3) return null;
  const negative = trimmed.startsWith("-") || hemisphere === "S" || hemisphere === "W";
  const degrees = Number(numbers[0]);
  const minutes = numbers.length >= 2 ? Number(numbers[1]) : 0;
  const seconds = numbers.length >= 3 ? Number(numbers[2]) : 0;
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  if (minutes >= 60 || seconds >= 60) return null;
  const value = degrees + minutes / 60 + seconds / 3600;
  if (!Number.isFinite(value)) return null;
  if (axis === "lat" && value > 90) return null;
  if (axis === "lon" && value > 180) return null;
  return negative ? -value : value;
}

export function parseLatitude(text: string): number | null {
  return parseDegrees(text, "lat");
}

export function parseLongitude(text: string): number | null {
  return parseDegrees(text, "lon");
}

const LAT_NAME = /(^|[^a-z])lat(itude)?($|[^a-z])/i;
const LON_NAME = /(^|[^a-z])(lon|lng|longitude)($|[^a-z])/i;

function numericRange(meta: ColumnMeta): { min: number; max: number } | null {
  const { min, max } = meta.stats;
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return { min, max };
}

/** A numeric column whose values fit latitude/longitude bounds. */
function fitsLatitude(meta: ColumnMeta): boolean {
  const range = numericRange(meta);
  return range !== null && range.min >= -90 && range.max <= 90;
}

function fitsLongitude(meta: ColumnMeta): boolean {
  const range = numericRange(meta);
  return range !== null && range.min >= -180 && range.max <= 180;
}

export interface GeoPair {
  /** Column index of the latitude. */
  lat: number;
  /** Column index of the longitude. */
  lon: number;
  /** Plain-language reason, shown as “Suggested: …”. */
  reason: string;
}

/** Values that sit beyond the latitude range prove a longitude column
 * (Sydney ≥ 90, Los Angeles ≤ −90, global data spans ±180). */
function beyondLatitudeRange(range: { min: number; max: number }): boolean {
  return range.min >= 90 || range.max <= -90;
}

/**
 * Finds a latitude/longitude pair: name matches win, then numeric ranges that
 * fit the bounds. The two columns must be distinct and numeric (integer/number).
 */
export function detectGeoPair(
  columns: readonly ColumnMeta[],
  rowCount = 0,
): GeoPair | null {
  const entries = columns
    .map((meta, index) => ({ meta, index }))
    .filter(
      (entry) =>
        (entry.meta.type === "integer" || entry.meta.type === "number") &&
        !(rowCount > 12 && entry.meta.stats.distinct === rowCount),
    );
  if (entries.length < 2) return null;

  const namedLat = entries.find((entry) => LAT_NAME.test(entry.meta.name));
  const namedLon = entries.find((entry) => LON_NAME.test(entry.meta.name));
  if (namedLat !== undefined && namedLon !== undefined && namedLat.index !== namedLon.index) {
    return {
      lat: namedLat.index,
      lon: namedLon.index,
      reason: `${namedLat.meta.name}/${namedLon.meta.name} read as latitude/longitude`,
    };
  }

  // Range evidence: a longitude must extend beyond the latitude range (±90)
  // or span a whole hemisphere to prove it is not another latitude-like column.
  const lonLike = entries.find((entry) => {
    const range = numericRange(entry.meta);
    return range !== null && range.min >= -180 && range.max <= 180 && beyondLatitudeRange(range);
  });
  const latLike = entries.find(
    (entry) => entry.index !== lonLike?.index && fitsLatitude(entry.meta),
  );
  if (latLike !== undefined && lonLike !== undefined) {
    return {
      lat: latLike.index,
      lon: lonLike.index,
      reason: `${latLike.meta.name}/${lonLike.meta.name} values sit in latitude/longitude ranges`,
    };
  }

  // Names alone: latitude named, longitude named, already handled; one name
  // plus a plausible range is enough (e.g. "lat" + unnamed coordinate column).
  if (namedLat !== undefined) {
    const partner = entries.find(
      (entry) => entry.index !== namedLat.index && fitsLongitude(entry.meta),
    );
    if (partner !== undefined) {
      return {
        lat: namedLat.index,
        lon: partner.index,
        reason: `${namedLat.meta.name} + ${partner.meta.name} read as latitude/longitude`,
      };
    }
  }
  if (namedLon !== undefined) {
    const partner = entries.find(
      (entry) => entry.index !== namedLon.index && fitsLatitude(entry.meta),
    );
    if (partner !== undefined) {
      return {
        lat: partner.index,
        lon: namedLon.index,
        reason: `${partner.meta.name} + ${namedLon.meta.name} read as latitude/longitude`,
      };
    }
  }
  return null;
}
