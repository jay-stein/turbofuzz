/**
 * Coordinate systems for boundary files from anywhere. A file's own statement comes first (a shapefile's .prj, a GeoJSON
 * crs member); with none, coordinates inside the range of degrees are taken as longitude and latitude; anything else asks
 * the person, who can always override. The app is offline, so codes come from this table: anything else can be pasted as
 * a proj4 string or WKT, which is also what a .prj holds.
 */
import proj4 from "proj4";

const GRS80_UTM = (zone: number, south: boolean, ellps = "GRS80"): string =>
  `+proj=utm +zone=${zone} ${south ? "+south " : ""}+ellps=${ellps} +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;

const LONGLAT_GRS80 = "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs";

/** The common ones, by EPSG code, with names a person would recognise. */
const KNOWN: Readonly<Record<number, { name: string; def: string }>> = {
  4326: { name: "WGS 84 (latitude and longitude)", def: "+proj=longlat +datum=WGS84 +no_defs" },
  4283: { name: "GDA94 (Australia, latitude and longitude)", def: LONGLAT_GRS80 },
  7844: { name: "GDA2020 (Australia, latitude and longitude)", def: LONGLAT_GRS80 },
  4167: { name: "NZGD2000 (New Zealand, latitude and longitude)", def: LONGLAT_GRS80 },
  4269: { name: "NAD83 (North America, latitude and longitude)", def: "+proj=longlat +datum=NAD83 +no_defs" },
  4258: { name: "ETRS89 (Europe, latitude and longitude)", def: LONGLAT_GRS80 },
  3857: { name: "Web Mercator", def: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs" },
  3577: { name: "Australian Albers (GDA94)", def: "+proj=aea +lat_0=0 +lon_0=132 +lat_1=-18 +lat_2=-36 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  9473: { name: "Australian Albers (GDA2020)", def: "+proj=aea +lat_0=0 +lon_0=132 +lat_1=-18 +lat_2=-36 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  3111: { name: "Vicgrid (Victoria)", def: "+proj=lcc +lat_0=-37 +lon_0=145 +lat_1=-36 +lat_2=-38 +x_0=2500000 +y_0=2500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  2193: { name: "NZTM2000 (New Zealand)", def: "+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  27700: { name: "British National Grid", def: "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs" },
  2157: { name: "Irish Transverse Mercator", def: "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  3035: { name: "ETRS89 Lambert Azimuthal (Europe)", def: "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  2154: { name: "Lambert-93 (France)", def: "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  5070: { name: "Conus Albers (USA)", def: "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs" },
  2263: { name: "New York Long Island (feet)", def: "+proj=lcc +lat_0=40.1666666666667 +lon_0=-74 +lat_1=41.0333333333333 +lat_2=40.6666666666667 +x_0=300000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs" },
  3414: { name: "SVY21 (Singapore)", def: "+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs" },
};

/** The table, and the families that follow a rule. */
function knownCode(code: number): { name: string; def: string } | null {
  const known = KNOWN[code];
  if (known !== undefined) return known;
  if (code >= 32601 && code <= 32660) return { name: `WGS 84 / UTM zone ${code - 32600}N`, def: GRS80_UTM(code - 32600, false, "WGS84") };
  if (code >= 32701 && code <= 32760) return { name: `WGS 84 / UTM zone ${code - 32700}S`, def: GRS80_UTM(code - 32700, true, "WGS84") };
  if (code >= 26901 && code <= 26923) return { name: `NAD83 / UTM zone ${code - 26900}N`, def: GRS80_UTM(code - 26900, false) };
  if (code >= 28348 && code <= 28358) return { name: `GDA94 / MGA zone ${code - 28300}`, def: GRS80_UTM(code - 28300, true) };
  if (code >= 7846 && code <= 7859) return { name: `GDA2020 / MGA zone ${code - 7800}`, def: GRS80_UTM(code - 7800, true) };
  return null;
}

/** The choices to offer by name. */
export const COMMON_CRS: readonly { code: number; name: string }[] = Object.entries(KNOWN).map(([code, { name }]) => ({ code: Number(code), name }));

export interface ResolvedCrs {
  /** What to show. */
  label: string;
  /** What proj4 reads. */
  def: string;
  /** Degrees already: nothing to work out. */
  geographic: boolean;
}

/** "EPSG:7844", "urn:ogc:def:crs:EPSG::7844", or a bare 7844. */
function epsgOf(text: string): number | null {
  const match = /^\s*(?:urn:ogc:def:crs:)?EPSG:{1,2}(?:[\d.]*:)?(\d{4,6})\s*$/i.exec(text) ?? /^\s*(\d{4,6})\s*$/.exec(text);
  return match === null ? null : Number(match[1]);
}

const WKT_NAME = /^\s*(?:PROJ(?:ECTED)?CR?S|GEOG(?:RAPHIC)?CR?S|GEODCRS)\s*\[\s*"([^"]+)"/i;
const WKT_AUTHORITY = /AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]\s*\]\s*$/i;

/**
 * Reads a statement of a coordinate system: a code, a proj4 string or WKT. Null when it cannot be understood, so the
 * caller asks rather than draws something wrong.
 */
export function resolveCrs(text: string): ResolvedCrs | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (/CRS:?84/i.test(trimmed) && trimmed.length < 60) return { label: "WGS 84 (latitude and longitude)", def: KNOWN[4326]!.def, geographic: true };
  const code = epsgOf(trimmed);
  if (code !== null) {
    const known = knownCode(code);
    if (known === null) return null;
    return { label: `${known.name}, EPSG:${code}`, def: known.def, geographic: isGeographic(known.def) };
  }
  // A WKT that states its code is best read from the table, where datum shifts are known to be right.
  const authority = WKT_AUTHORITY.exec(trimmed);
  const stated = authority === null ? null : knownCode(Number(authority[1]));
  const name = WKT_NAME.exec(trimmed)?.[1]?.replace(/_/g, " ");
  if (stated !== null) return { label: `${name ?? stated.name}, EPSG:${authority![1]}`, def: stated.def, geographic: isGeographic(stated.def) };
  try {
    return { label: name ?? (trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed), def: trimmed, geographic: isGeographic(trimmed) };
  } catch {
    return null;
  }
}

function isGeographic(def: string): boolean {
  return (proj4.Proj(def) as unknown as { projName?: string }).projName === "longlat";
}

/** A function from the system's coordinates to longitude and latitude, writing back into the array of x, y pairs. */
export function toLonLat(crs: ResolvedCrs): (ring: Float64Array) => void {
  const forward = proj4(crs.def, "WGS84");
  const out: number[] = [0, 0];
  return (ring) => {
    for (let i = 0; i < ring.length; i += 2) {
      const point = forward.forward([ring[i]!, ring[i + 1]!]);
      out[0] = point[0]!;
      out[1] = point[1]!;
      ring[i] = out[0]!;
      ring[i + 1] = out[1]!;
    }
  };
}
