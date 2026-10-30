/**
 * World cities for the Map page (Natural Earth populated places, public domain,
 * bundled in src/data/reference/world-cities.ts): name, latitude and longitude, largest first.
 * The list is a separate chunk loaded the first time the city layer or city search
 * is used; nothing is fetched from the network.
 */

export interface Cities {
  names: string[];
  /** Search keys: lower case, accents removed. */
  keys: string[];
  lat: Float32Array;
  lon: Float32Array;
}

export interface CityHit {
  index: number;
  name: string;
  lat: number;
  lon: number;
}

let loading: Promise<Cities> | null = null;

/** Lower case without accents, so "sao paulo" finds "São Paulo". */
export function cityKey(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function decodeCities(names: string, coords: string): Cities {
  const list = names.split("|");
  const nums = coords.split(",").map(Number);
  const lat = new Float32Array(list.length), lon = new Float32Array(list.length);
  for (let i = 0; i < list.length; i++) {
    lat[i] = (nums[2 * i] ?? 0) / 100;
    lon[i] = (nums[2 * i + 1] ?? 0) / 100;
  }
  return { names: list, keys: list.map(cityKey), lat, lon };
}

export function loadCities(): Promise<Cities> {
  loading ??= import("./reference/world-cities.js").then(({ CITY_NAMES, CITY_COORDS }) => decodeCities(CITY_NAMES, CITY_COORDS));
  return loading;
}

/** Cities whose name starts with the query, then those containing it; larger first within each. */
export function searchCities(c: Cities, query: string, limit = 8): CityHit[] {
  const q = cityKey(query);
  if (q === "") return [];
  const starts: number[] = [], within: number[] = [];
  for (let i = 0; i < c.keys.length && starts.length < limit; i++) {
    const k = c.keys[i]!;
    if (k.startsWith(q)) starts.push(i);
    else if (within.length < limit && k.includes(q)) within.push(i);
  }
  return [...starts, ...within].slice(0, limit).map((i) => ({ index: i, name: c.names[i]!, lat: c.lat[i]!, lon: c.lon[i]! }));
}

/** The largest city with exactly this name (accents and case ignored), or null. */
export function findCity(c: Cities, name: string): CityHit | null {
  const q = cityKey(name);
  if (q === "") return null;
  const i = c.keys.indexOf(q);
  return i < 0 ? null : { index: i, name: c.names[i]!, lat: c.lat[i]!, lon: c.lon[i]! };
}
