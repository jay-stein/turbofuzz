# Map View Spike — Decision Memo

> Spike for plan §8 (Track C). Date: 2026-10-16. Status: **BUILD recommended** (candidate 2), with one measurement left before implementation.

## Scope & constraints

Fully offline world map as a chart card: no tile servers, no mapping libraries, lazy-loaded basemap, bundled with the app. Budget targets: basemap asset ≤ ~150 KB raw, first paint ≤ 50 ms at 100k rows, extra RAM ≤ ~10 MB.

## Measured facts (2026-10-16, jsdelivr CDN)

| Asset | Contents | Raw size |
|---|---|---|
| `countries-110m.json` (world-atlas 2, Natural Earth 4.1.0) | countries **and** land, quantized TopoJSON, decimal degrees | **105 KB** (one file covers both) |
| `land-110m.json` | land outlines only | 54 KB |
| `countries-50m.json` | countries + land, medium scale | 739 KB |

Gzip typically shrinks TopoJSON 3–4× (≈30–40 KB served for 110m). The Cloudflare assets pipeline already gzips/brotli-s.

## Candidates

| # | Approach | Asset | Draw cost | RAM | Notes |
|---|---|---|---|---|---|
| 1 | Build-time **raster land mask** 2048×1024 (1-bit → PNG ~30–60 KB) | small | one `drawImage` | offscreen canvas ≈ 8 MB RGBA | cheapest paint; no borders/labels; pixelates on zoom |
| 2 | Vendored TopoJSON + **~100-line decoder** → `Float32Array` lon/lat at runtime (lazy, once) | 105 KB | polygon fills, ≈ few ms | vectors ≈ 0.5–2 MB + decoded cache | borders + country hover possible; no runtime dependency; decode once per session |
| 3 | Pre-projected binary blobs at build time (`build:geo` script) | ≈ 105 KB class | same as 2 | same as 2 | removes runtime decode (~5–10 ms saved) at the cost of a build step and vendored generated files |

## Verdict against budgets

- Asset: candidates 1 and 2 both fit ≤ 150 KB at 110m. ✅
- First paint: candidate 1 is trivially < 5 ms; candidate 2 is a few ms of polygon fills after a one-time decode — both far inside 50 ms. ✅ (exact number still to be measured on the benchmark fixtures)
- RAM: both within 10 MB. ✅
- The point pipeline already exists: `getChartSeries` sampling (≤ 20k points) and 128×72 density grids cover any dataset size; rectangle brush maps 1:1 onto the existing lat/lon range filters.

## Recommendation

**Build candidate 2 at 1:110m**: vendor `countries-110m.json` (105 KB, licensed public domain via Natural Earth), add a tiny TopoJSON decoder (~100 lines, no dependency), decode lazily on first map card and cache a projected `Float32Array`. Fall back to candidate 1 only if the polygon draw benchmarks badly on low-end devices. Defer the 50m variant until someone needs country-level zoom.

## Remaining before implementation (1 day)

1. Decoder spike: 110m decode + project time measured in the bench harness (target < 15 ms once).
2. DMS/decimal parsing fixture: `51°30'26"N`, `51 30 26 N`, `N51 30 26`, `51.5074 N` → decimal degrees (reuse/extend `parseDate`-style unit tests).
3. Lat/lon detection rules: name (`lat|lon|lng|longitude`), range (lat ±90, lon ±180), pair-consistency, plus a "Looks like coordinates — map it" suggestion chip.
4. First map paint bench at 100k/500k rows with the point/density payloads (expected: threshold-capped, so largely independent of row count).

## Explicit no-go list

UTM/MGRS, geohash, state-plane and national grid formats; network tiles; satellite imagery; Leaflet/MapLibre/Mapbox (all rejected in plan §2).
