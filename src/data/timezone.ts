import { parseOffsetMinutes } from "../parse/date-parts.js";

export type ZoneSpec =
  | { kind: "naive" }
  | { kind: "utc" }
  | { kind: "local" }
  | { kind: "fixed"; offsetMinutes: number }
  | { kind: "iana"; zone: string };

const formatters = new Map<string, Intl.DateTimeFormat | null>();
const offsetCache = new Map<string, Map<number, number>>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  if (formatters.has(zone)) return formatters.get(zone) ?? null;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, formatter);
    return formatter;
  } catch {
    formatters.set(zone, null);
    return null;
  }
}

/**
 * Offset of an IANA zone at an instant, in minutes east of UTC. Results are
 * cached per hour because zones only change offset at transition boundaries.
 */
export function zoneOffsetMinutes(epochMs: number, zone: string): number {
  const formatter = formatterFor(zone);
  if (formatter === null) return 0;
  const bucket = Math.floor(epochMs / 3_600_000);
  let cache = offsetCache.get(zone);
  if (cache === undefined) {
    cache = new Map();
    offsetCache.set(zone, cache);
  }
  const cached = cache.get(bucket);
  if (cached !== undefined) return cached;

  const parts = formatter.formatToParts(new Date(epochMs));
  const get = (type: string): number => {
    const part = parts.find((entry) => entry.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  const base = Math.floor(epochMs / 1000) * 1000;
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offset = Math.round((asUtc - base) / 60_000);
  cache.set(bucket, offset);
  return offset;
}

let localProbe: Intl.DateTimeFormat | null = null;
function localZone(): string {
  if (localProbe === null) {
    localProbe = new Intl.DateTimeFormat();
  }
  return localProbe.resolvedOptions().timeZone || "UTC";
}

/** Parses the timezone control into a concrete spec, falling back to naive. */
export function resolveZoneSpec(spec: string): ZoneSpec {
  const value = spec.trim();
  if (value === "") return { kind: "naive" };
  const lower = value.toLowerCase();
  if (lower === "naive" || lower === "none" || lower === "as written") return { kind: "naive" };
  if (lower === "utc" || lower === "z" || lower === "gmt") return { kind: "utc" };
  if (lower === "local" || lower === "browser" || lower === "system") {
    return { kind: "local" };
  }
  const fixed = parseOffsetMinutes(value);
  if (fixed !== null) return { kind: "fixed", offsetMinutes: fixed };
  if (formatterFor(value) !== null) return { kind: "iana", zone: value };
  return { kind: "naive" };
}

export interface ResolvedInstant {
  epoch: number;
  /** null = no zone information (naive output, no suffix). */
  offsetMinutes: number | null;
}

/** Converts wall-clock components to an instant under the given spec. */
export function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  spec: ZoneSpec,
): ResolvedInstant {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  switch (spec.kind) {
    case "naive":
      return { epoch: wall, offsetMinutes: null };
    case "utc":
      return { epoch: wall, offsetMinutes: 0 };
    case "fixed":
      return {
        epoch: wall - spec.offsetMinutes * 60_000,
        offsetMinutes: spec.offsetMinutes,
      };
    case "local": {
      const local = new Date(year, month - 1, day, hour, minute, second, millisecond);
      return { epoch: local.getTime(), offsetMinutes: -local.getTimezoneOffset() };
    }
    case "iana": {
      const guess = wall;
      const first = zoneOffsetMinutes(guess, spec.zone);
      let epoch = guess - first * 60_000;
      const second2 = zoneOffsetMinutes(epoch, spec.zone);
      if (second2 !== first) epoch = guess - second2 * 60_000;
      return { epoch, offsetMinutes: zoneOffsetMinutes(epoch, spec.zone) };
    }
  }
}

export function localTimeZone(): string {
  return localZone();
}

/** Common IANA zones offered in the transform timezone picker. */
export const COMMON_TIME_ZONES: readonly string[] = [
  "UTC",
  "Pacific/Auckland",
  "Australia/Sydney",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/Moscow",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/London",
  "Africa/Johannesburg",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];
