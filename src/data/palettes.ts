export type PaletteKind = "qualitative" | "sequential" | "diverging";

export interface PaletteDef {
  name: string;
  kind: PaletteKind;
  /** Stops in the palette's native order (light → dark / negative → positive). */
  colors: readonly string[];
}

/**
 * Named colour maps from ColorBrewer (the same definitions matplotlib ships):
 * qualitative cyclers, single- and multi-hue sequential ramps, and diverging
 * ramps. Charts sample these to any number of series or buckets.
 */
export const PALETTES: readonly PaletteDef[] = [
  { name: "Set1", kind: "qualitative", colors: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33", "#a65628", "#f781bf", "#999999"] },
  { name: "Pastel1", kind: "qualitative", colors: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6", "#ffffcc", "#e5d8bd", "#fddaec", "#f2f2f2"] },
  { name: "Pastel2", kind: "qualitative", colors: ["#b3e2cd", "#fdcdac", "#cbd5e8", "#f4cae4", "#e6f5c9", "#fff2ae", "#f1e2cc", "#cccccc"] },
  { name: "Set2", kind: "qualitative", colors: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3"] },
  { name: "Set3", kind: "qualitative", colors: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5", "#ffed6f"] },
  { name: "Paired", kind: "qualitative", colors: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a", "#ffff99", "#b15928"] },
  { name: "Dark2", kind: "qualitative", colors: ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#666666"] },
  { name: "Accent", kind: "qualitative", colors: ["#7fc97f", "#beaed4", "#fdc086", "#ffff99", "#386cb0", "#f0027f", "#bf5b17", "#666666"] },
  { name: "tab10", kind: "qualitative", colors: ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"] },
  { name: "tab20", kind: "qualitative", colors: ["#1f77b4", "#aec7e8", "#ff7f0e", "#ffbb78", "#2ca02c", "#98df8a", "#d62728", "#ff9896", "#9467bd", "#c5b0d5", "#8c564b", "#c49c94", "#e377c2", "#f7b6d2", "#7f7f7f", "#c7c7c7", "#bcbd22", "#dbdb8d", "#17becf", "#9edae5"] },

  // Seaborn's six categorical palettes (documented hex cycles).
  { name: "deep", kind: "qualitative", colors: ["#4c72b0", "#dd8452", "#55a868", "#c44e52", "#8172b3", "#937860", "#da8bc3", "#8c8c8c", "#ccb974", "#64b5cd"] },
  { name: "muted", kind: "qualitative", colors: ["#4878d0", "#ee854a", "#6acc64", "#d65f5f", "#956cb4", "#8c613c", "#dc7ec0", "#797979", "#d5bb67", "#82c6e2"] },
  { name: "pastel", kind: "qualitative", colors: ["#a1c9f4", "#ffb482", "#8de5a1", "#ff9f9b", "#d0bbff", "#debb9b", "#fab0e4", "#cfcfcf", "#fffea3", "#b9f2f0"] },
  { name: "bright", kind: "qualitative", colors: ["#023eff", "#ff7c00", "#1ac938", "#e8000b", "#8b2be2", "#9f4800", "#f14cc1", "#a3a3a3", "#ffc400", "#00d7ff"] },
  { name: "dark", kind: "qualitative", colors: ["#001c7f", "#b1400d", "#12711c", "#8c0800", "#591e71", "#592f0d", "#a23582", "#3c3c3c", "#b8850a", "#006374"] },
  { name: "colorblind", kind: "qualitative", colors: ["#0173b2", "#de8f05", "#029e73", "#d55e00", "#cc78bc", "#ca9161", "#fbafe4", "#949494", "#ece133", "#56b4e9"] },

  { name: "Blues", kind: "sequential", colors: ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"] },
  { name: "Greens", kind: "sequential", colors: ["#f7fcf5", "#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#006d2c", "#00441b"] },
  { name: "Greys", kind: "sequential", colors: ["#ffffff", "#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696", "#737373", "#525252", "#252525", "#000000"] },
  { name: "Oranges", kind: "sequential", colors: ["#fff5eb", "#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801", "#a63603", "#7f2704"] },
  { name: "Purples", kind: "sequential", colors: ["#fcfbfd", "#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#54278f", "#3f007d"] },
  { name: "Reds", kind: "sequential", colors: ["#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#a50f15", "#67000d"] },
  { name: "BuGn", kind: "sequential", colors: ["#f7fcfd", "#e5f5f9", "#ccece6", "#99d8c9", "#66c2a4", "#41ae76", "#238b45", "#006d2c", "#00441b"] },
  { name: "BuPu", kind: "sequential", colors: ["#f7fcfd", "#e0ecf4", "#bfd3e6", "#9ebcda", "#8c96c6", "#8c6bb1", "#88419d", "#810f7c", "#4d004b"] },
  { name: "GnBu", kind: "sequential", colors: ["#f7fcf0", "#e0f3db", "#ccebc5", "#a8ddb5", "#7bccc4", "#4eb3d3", "#2b8cbe", "#0868ac", "#084081"] },
  { name: "OrRd", kind: "sequential", colors: ["#fff7ec", "#fee8c8", "#fdd49e", "#fdbb84", "#fc8d59", "#ef6548", "#d7301f", "#b30000", "#7f0000"] },
  { name: "PuBu", kind: "sequential", colors: ["#fff7fb", "#ece7f2", "#d0d1e6", "#a6bddb", "#74a9cf", "#3690c0", "#0570b0", "#045a8d", "#023858"] },
  { name: "PuBuGn", kind: "sequential", colors: ["#fff7fb", "#ece2f0", "#d0d1e6", "#a6bddb", "#67a9cf", "#3690c0", "#02818a", "#016c59", "#014636"] },
  { name: "PuRd", kind: "sequential", colors: ["#f7f4f9", "#e7e1ef", "#d4b9da", "#c994c7", "#df65b0", "#e7298a", "#ce1256", "#980043", "#67001f"] },
  { name: "RdPu", kind: "sequential", colors: ["#fff7f3", "#fde0dd", "#fcc5c0", "#fa9fb5", "#f768a1", "#dd3497", "#ae017e", "#7a0177", "#49006a"] },
  { name: "YlGn", kind: "sequential", colors: ["#ffffe5", "#f7fcb9", "#d9f0a3", "#addd8e", "#78c679", "#41ab5d", "#238443", "#006837", "#004529"] },
  { name: "YlGnBu", kind: "sequential", colors: ["#ffffd9", "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#253494", "#081d58"] },
  { name: "YlOrBr", kind: "sequential", colors: ["#ffffe5", "#fff7bc", "#fee391", "#fec44f", "#fe9929", "#ec7014", "#cc4c02", "#993404", "#662506"] },
  { name: "YlOrRd", kind: "sequential", colors: ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"] },

  // Seaborn's perceptually-uniform sequential maps (sampled stops, light → dark).
  { name: "rocket", kind: "sequential", colors: ["#faebdd", "#f6c1a0", "#e98a6f", "#d1505e", "#a22a5e", "#6a1e5c", "#3a1652", "#1a0f3d", "#03051a"] },
  { name: "mako", kind: "sequential", colors: ["#e5f5f1", "#b9ddd6", "#8ec3bd", "#62a5a4", "#43878c", "#2f6b74", "#22505d", "#1b3a49", "#0f1f2d"] },
  { name: "flare", kind: "sequential", colors: ["#f7e6c4", "#f3b987", "#ea8a6a", "#e05a59", "#c93a60", "#a52b66", "#7a2064", "#4f1856", "#2c113f"] },
  { name: "crest", kind: "sequential", colors: ["#e6f0d9", "#c8e0b5", "#a5cd96", "#7bb77f", "#559d72", "#3a7f68", "#2b6158", "#234447", "#1c2e36"] },

  { name: "BrBG", kind: "diverging", colors: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"] },
  { name: "PiYG", kind: "diverging", colors: ["#8e0152", "#c51b7d", "#de77ae", "#f1b6da", "#fde0ef", "#f7f7f7", "#e6f5d0", "#b8e186", "#7fbc41", "#4d9221", "#276419"] },
  { name: "PRGn", kind: "diverging", colors: ["#40004b", "#762a83", "#9970ab", "#c2a5cf", "#e7d4e8", "#f7f7f7", "#d9f0d3", "#a6dba0", "#5aae61", "#1b7837", "#00441b"] },
  { name: "PuOr", kind: "diverging", colors: ["#7f3b08", "#b35806", "#e08214", "#fdb863", "#fee0b6", "#f7f7f7", "#d8daeb", "#b2abd2", "#8073ac", "#542788", "#2d004b"] },
  { name: "RdBu", kind: "diverging", colors: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"] },
  { name: "RdGy", kind: "diverging", colors: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#ffffff", "#e0e0e0", "#bababa", "#878787", "#4d4d4d", "#1a1a1a"] },
  { name: "RdYlBu", kind: "diverging", colors: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee090", "#ffffbf", "#e0f3f8", "#abd9e9", "#74add1", "#4575b4", "#313695"] },
  { name: "RdYlGn", kind: "diverging", colors: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850", "#006837"] },
  { name: "Spectral", kind: "diverging", colors: ["#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2"] },

  // Seaborn's diverging maps (sampled stops).
  { name: "vlag", kind: "diverging", colors: ["#a63f45", "#c96e6c", "#dfa4a0", "#f0d9d5", "#eceff4", "#c1d5e5", "#93b8d7", "#5a93c4", "#2369a7"] },
  { name: "icefire", kind: "diverging", colors: ["#3f5a91", "#6d87b9", "#a3b3d5", "#d5dbe8", "#efe7da", "#f4cba4", "#f2a06a", "#e06a45", "#c03a2b"] },
];

export const DEFAULT_PALETTE = "Set1";
export const CUSTOM_PALETTE = "custom";

const HEX = /^#?([0-9a-f]{6})$/i;

export function parseCustomColors(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const match = HEX.exec(part);
      return match === null ? null : `#${match[1].toLowerCase()}`;
    })
    .filter((value): value is string => value !== null);
}

/**
 * Reads a hex palette from JSON text: a plain array of colours, or an object
 * with `colors` / `palette` / `stops`. Accepts #rgb and #rrggbb; returns null
 * when the file has no usable palette (fewer than two valid colours).
 */
export function parsePaletteJson(text: string): string[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  let list: unknown = data;
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    list = record.colors ?? record.palette ?? record.stops;
  }
  if (!Array.isArray(list)) return null;
  const colors: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
    const full = /^#?([0-9a-f]{6})$/i.exec(value);
    if (short !== null) {
      colors.push(
        `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase(),
      );
    } else if (full !== null) {
      colors.push(`#${full[1].toLowerCase()}`);
    }
  }
  return colors.length >= 2 ? colors : null;
}

export function paletteByName(name: string): PaletteDef | undefined {
  return PALETTES.find((palette) => palette.name === name);
}

/** Stops for a palette name; custom takes the parsed list, defaulting to Set1. */
export function paletteStops(name: string, custom: readonly string[] = []): string[] {
  if (name === CUSTOM_PALETTE) {
    return custom.length >= 2 ? [...custom] : [...(paletteByName(DEFAULT_PALETTE)?.colors ?? [])];
  }
  const found = paletteByName(name);
  return [...(found ?? paletteByName(DEFAULT_PALETTE) ?? PALETTES[0] ?? []).colors];
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex(red: number, green: number, blue: number): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(red)}${part(green)}${part(blue)}`;
}

/** Interpolates a stop list at `t` in [0, 1] (linear RGB). */
export function rampAt(stops: readonly string[], t: number): string {
  if (stops.length === 0) return "#888888";
  if (stops.length === 1) return stops[0] ?? "#888888";
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const position = clamped * (stops.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(stops.length - 1, lower + 1);
  const weight = position - lower;
  const [r1, g1, b1] = hexToRgb(stops[lower] ?? "#888888");
  const [r2, g2, b2] = hexToRgb(stops[upper] ?? "#888888");
  return rgbToHex(
    r1 + (r2 - r1) * weight,
    g1 + (g2 - g1) * weight,
    b1 + (b2 - b1) * weight,
  );
}

/**
 * `count` colours from a palette: qualitative palettes cycle their exact
 * colours, sequential and diverging ramps are sampled evenly. A single series
 * from a ramp takes a well-saturated part of it rather than near-white.
 */
export function samplePalette(
  name: string,
  count: number,
  custom: readonly string[] = [],
): string[] {
  const customValid = name === CUSTOM_PALETTE && custom.length >= 2;
  const effectiveName =
    name === CUSTOM_PALETTE && !customValid ? DEFAULT_PALETTE : name;
  const stops = paletteStops(effectiveName, custom);
  const wanted = Math.max(1, Math.floor(count));
  const def = effectiveName === CUSTOM_PALETTE ? undefined : paletteByName(effectiveName);
  // Named qualitative palettes cycle their exact colours; custom lists and
  // sequential/diverging ramps interpolate.
  const qualitative = def !== undefined && def.kind === "qualitative";
  if (qualitative) {
    if (wanted <= stops.length) return stops.slice(0, wanted);
    return Array.from({ length: wanted }, (_, index) => stops[index % stops.length] ?? "#888888");
  }
  if (stops.length === 1) return Array.from({ length: wanted }, () => stops[0] ?? "#888888");
  return Array.from({ length: wanted }, (_, index) =>
    rampAt(stops, wanted === 1 ? 0.75 : index / (wanted - 1)),
  );
}

/** True when the palette is (or custom colours are) safe to show as a ramp. */
export function isRampPalette(name: string): boolean {
  const def = name === CUSTOM_PALETTE ? undefined : paletteByName(name);
  return def === undefined || def.kind !== "qualitative";
}
