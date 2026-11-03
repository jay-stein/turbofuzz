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

type Area = [lonMin: number, latMin: number, lonMax: number, latMax: number];

/** The common ones, by EPSG code, with names a person would recognise and, for regional ones, where they apply. */
const KNOWN: Readonly<Record<number, { name: string; def: string; area?: Area }>> = {
  4326: { name: "WGS 84: latitude and longitude, worldwide", def: "+proj=longlat +datum=WGS84 +no_defs" },
  3857: { name: "Web Mercator, worldwide (web maps)", def: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs" },
  4283: { name: "GDA94: Australia, latitude and longitude", def: LONGLAT_GRS80 },
  7844: { name: "GDA2020: Australia, latitude and longitude", def: LONGLAT_GRS80 },
  4167: { name: "NZGD2000: New Zealand, latitude and longitude", def: LONGLAT_GRS80 },
  4269: { name: "NAD83: North America, latitude and longitude", def: "+proj=longlat +datum=NAD83 +no_defs" },
  4258: { name: "ETRS89: Europe, latitude and longitude", def: LONGLAT_GRS80 },
  4674: { name: "SIRGAS 2000: Latin America, latitude and longitude", def: LONGLAT_GRS80 },
  6668: { name: "JGD2011: Japan, latitude and longitude", def: LONGLAT_GRS80 },
  4490: { name: "CGCS2000: China, latitude and longitude", def: LONGLAT_GRS80 },
  3577: { name: "Australian Albers (GDA94)", def: "+proj=aea +lat_0=0 +lon_0=132 +lat_1=-18 +lat_2=-36 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [100, -50, 170, -5] },
  9473: { name: "Australian Albers (GDA2020)", def: "+proj=aea +lat_0=0 +lon_0=132 +lat_1=-18 +lat_2=-36 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [100, -50, 170, -5] },
  3111: { name: "Vicgrid: Victoria, Australia", def: "+proj=lcc +lat_0=-37 +lon_0=145 +lat_1=-36 +lat_2=-38 +x_0=2500000 +y_0=2500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [140.9, -39.2, 150, -33.9] },
  2193: { name: "NZTM2000: New Zealand", def: "+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [166, -48, 179, -34] },
  27700: { name: "British National Grid: Great Britain", def: "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs", area: [-9, 49.7, 2, 61] },
  2157: { name: "Irish Transverse Mercator: Ireland", def: "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [-10.7, 51.3, -5.3, 55.5] },
  29902: { name: "Irish Grid (TM65): Ireland", def: "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 +x_0=200000 +y_0=250000 +ellps=mod_airy +towgs84=482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15 +units=m +no_defs", area: [-10.7, 51.3, -5.3, 55.5] },
  3035: { name: "ETRS89 Lambert Azimuthal: Europe", def: "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [-25, 34, 45, 72] },
  2154: { name: "Lambert-93: France", def: "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [-5.5, 41, 10, 51.5] },
  28992: { name: "RD New (Amersfoort): Netherlands", def: "+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs", area: [3.2, 50.7, 7.3, 53.7] },
  2056: { name: "LV95: Switzerland", def: "+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs", area: [5.9, 45.8, 10.6, 47.9] },
  3006: { name: "SWEREF99 TM: Sweden", def: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [10.5, 55, 24.5, 69.1] },
  3067: { name: "ETRS-TM35FIN: Finland", def: "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [19, 59.5, 31.6, 70.1] },
  2180: { name: "ETRS89 Poland CS92: Poland", def: "+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [14, 49, 24.2, 55] },
  3763: { name: "PT-TM06: Portugal", def: "+proj=tmerc +lat_0=39.6682583333333 +lon_0=-8.13310833333333 +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [-9.6, 36.9, -6.1, 42.2] },
  5070: { name: "Conus Albers: USA", def: "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs", area: [-125, 24, -66, 50] },
  2263: { name: "New York Long Island (feet): USA", def: "+proj=lcc +lat_0=40.1666666666667 +lon_0=-74 +lat_1=41.0333333333333 +lat_2=40.6666666666667 +x_0=300000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs", area: [-74.3, 40.4, -71.8, 41.3] },
  3978: { name: "Canada Atlas Lambert: Canada", def: "+proj=lcc +lat_0=49 +lon_0=-95 +lat_1=49 +lat_2=77 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", area: [-141, 41, -52, 84] },
  3347: { name: "Statistics Canada Lambert: Canada", def: "+proj=lcc +lat_0=63.390675 +lon_0=-91.8666666666667 +lat_1=49 +lat_2=77 +x_0=6200000 +y_0=3000000 +datum=NAD83 +units=m +no_defs", area: [-141, 41, -52, 84] },
  3414: { name: "SVY21: Singapore", def: "+proj=tmerc +lat_0=1.36666666666667 +lon_0=103.833333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs", area: [103.5, 1.1, 104.2, 1.5] },
};

/** The table, and the families that follow a rule. */
function knownCode(code: number): { name: string; def: string; area?: Area } | null {
  const known = KNOWN[code];
  if (known !== undefined) return known;
  if (code >= 32601 && code <= 32660) return { name: `WGS 84 / UTM zone ${code - 32600}N`, def: GRS80_UTM(code - 32600, false, "WGS84") };
  if (code >= 32701 && code <= 32760) return { name: `WGS 84 / UTM zone ${code - 32700}S`, def: GRS80_UTM(code - 32700, true, "WGS84") };
  if (code >= 26901 && code <= 26923) return { name: `NAD83 / UTM zone ${code - 26900}N`, def: GRS80_UTM(code - 26900, false) };
  if (code >= 28348 && code <= 28358) return { name: `GDA94 / MGA zone ${code - 28300}`, def: GRS80_UTM(code - 28300, true) };
  if (code >= 7846 && code <= 7859) return { name: `GDA2020 / MGA zone ${code - 7800}`, def: GRS80_UTM(code - 7800, true) };
  if (code >= 25828 && code <= 25838) return { name: `ETRS89 / UTM zone ${code - 25800}N`, def: GRS80_UTM(code - 25800, false) };
  return null;
}

export interface CrsChoice {
  code: number;
  name: string;
}

/** Every zone of the rule-based families, for searching: they are too many to list until asked for. */
function allChoices(): CrsChoice[] {
  const out: CrsChoice[] = Object.entries(KNOWN).map(([code, { name }]) => ({ code: Number(code), name }));
  const family = (from: number, to: number): void => {
    for (let code = from; code <= to; code++) out.push({ code, name: knownCode(code)!.name });
  };
  family(32601, 32660);
  family(32701, 32760);
  family(26901, 26923);
  family(28348, 28358);
  family(7846, 7859);
  family(25828, 25838);
  return out;
}

/** The named systems, without the long lists of zones. */
export const COMMON_CRS: readonly CrsChoice[] = Object.entries(KNOWN).map(([code, { name }]) => ({ code: Number(code), name }));

/** By any word of the name, or by the code: "ireland", "utm 55", "7844". An empty search gives the named ones. */
export function searchCrs(query: string): CrsChoice[] {
  const words = query.toLowerCase().split(/[\s,:]+/).filter((word) => word !== "" && word !== "epsg");
  if (words.length === 0) return [...COMMON_CRS];
  return allChoices().filter((choice) => {
    const text = `${choice.name} ${choice.code}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * For a file that is not in degrees and does not say: the systems that would put its middle inside the area they are for.
 * A short list of good guesses is what is wanted here, so only regional systems and the zones that fit are tried.
 */
export function guessCrs(range: { xMin: number; xMax: number; yMin: number; yMax: number }): CrsChoice[] {
  const x = (range.xMin + range.xMax) / 2;
  const y = (range.yMin + range.yMax) / 2;
  const out: CrsChoice[] = [];
  const fits = (def: string, area: Area): boolean => {
    try {
      const [lon, lat] = proj4(def, "WGS84").forward([x, y]);
      return lon! >= area[0] && lon! <= area[2] && lat! >= area[1] && lat! <= area[3];
    } catch {
      return false;
    }
  };
  for (const [code, known] of Object.entries(KNOWN)) {
    if (known.area !== undefined && fits(known.def, known.area)) out.push({ code: Number(code), name: known.name });
  }
  return out;
}

/** Why a statement could not be used, in terms a person can act on. */
export function crsProblem(text: string): string {
  const trimmed = text.trim();
  if (/^\s*(VERT_CS|VERTCS|VERTCRS|VERTICALCRS)\b/i.test(trimmed)) {
    return "That describes height or depth, not a position on the map, so it cannot place these shapes. Search for the place's map grid instead, such as Irish Grid or Irish Transverse Mercator.";
  }
  const code = epsgOf(trimmed);
  if (code !== null) {
    return `EPSG:${code} is not in this offline list. Search by place or name. If it really is the one, it could also be a height or depth system, which cannot place a map; otherwise open its page on epsg.io and paste the PROJ.4 line under Advanced.`;
  }
  return "That could not be read as a coordinate system. Search by place or name, or paste a PROJ.4 line or WKT under Advanced.";
}

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
  if (/^\s*(VERT_CS|VERTCS|VERTCRS|VERTICALCRS)\b/i.test(trimmed)) return null;
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
