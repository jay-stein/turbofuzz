/**
 * The world basemap a map card draws under its dots: land and country outlines, decoded once per
 * session and shared by every card. The world modules are code-split and load on first use.
 */
import { decodeArcs, decodeCountries, decodeLand, type GeoCountry, type TopoWorld } from "../data/topo.js";

export interface Basemap {
  land: Float64Array[];
  countries: GeoCountry[];
}

export type BasemapDetail = "110m" | "50m";

/** A regional viewport (<= 60° of longitude) earns the 50m detail basemap. */
export const DETAIL_LON_SPAN = 60;

// Both basemaps are decoded once per session and shared by every map card;
// the world modules are code-split and import lazily.
export const basemapCaches = new Map<BasemapDetail, Basemap>();
const basemapLoads = new Map<BasemapDetail, Promise<Basemap>>();

function decodeWorld(world: TopoWorld): Basemap {
  const arcs = decodeArcs(world);
  return {
    land: decodeLand(world, arcs),
    countries: decodeCountries(world, arcs),
  };
}

export function loadBasemap(detail: BasemapDetail = "110m"): Promise<Basemap> {
  const cached = basemapCaches.get(detail);
  if (cached !== undefined) return Promise.resolve(cached);
  let loading = basemapLoads.get(detail);
  if (loading === undefined) {
    loading =
      detail === "50m"
        ? import("../data/world-50m.js").then(({ WORLD_50M }) => decodeWorld(WORLD_50M))
        : import("../data/world-110m.js").then(({ WORLD_110M }) => decodeWorld(WORLD_110M));
    basemapLoads.set(
      detail,
      loading.then((map) => {
        basemapCaches.set(detail, map);
        return map;
      }),
    );
  }
  return basemapLoads.get(detail) ?? loading;
}
