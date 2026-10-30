import { decodeCities, findCity, searchCities } from "../src/data/cities.js";
import { CITY_COORDS, CITY_NAMES } from "../src/data/reference/world-cities.js";
import { backgroundOps } from "../src/data/map-background.js";
import { parseMarkers } from "../src/data/map-markers.js";
import { measure, ms } from "./bench-utils.js";

// Latency budgets for the Map page's own work (the map card has its own benches):
//   decode:  first use of the city layer or search, once per session
//   search:  one keystroke in "Find a city"
//   paste:   100 pasted rows of city names, looked up and read as markers
//   strips:  placing a Web Mercator background for one frame
const BUDGETS = { decode: 40, search: 4, paste: 15, strips: 0.5 };

let failed = false;
const check = (label: string, p95: number, budget: number): void => {
  const over = p95 > budget;
  if (over) failed = true;
  console.log(`${over ? "OVER" : "ok  "} ${label.padEnd(44)} p95 ${ms(p95).padStart(7)} ms  budget ${budget} ms`);
};

check("cities: decode 7k names", measure(() => decodeCities(CITY_NAMES, CITY_COORDS), { iterations: 8, warmup: 1 }).p95, BUDGETS.decode);
const cities = decodeCities(CITY_NAMES, CITY_COORDS);
const queries = ["l", "lo", "lon", "lond", "sa", "san", "port", "zzz"];
let q = 0;
check("cities: search one keystroke", measure(() => searchCities(cities, queries[q++ % queries.length]!, 8), { iterations: 40, warmup: 4 }).p95, BUDGETS.search);
const names = ["city", ...cities.names.slice(500, 600)].join("\n");
check("markers: paste 100 city names", measure(() => parseMarkers(names, { symbol: "pin", color: "#dc2626" }, 100, [], (n) => findCity(cities, n)), { iterations: 10, warmup: 1 }).p95, BUDGETS.paste);
const merc = { west: -180, east: 180, south: -85, north: 85, projection: "mercator" as const };
check("background: mercator strips per frame", measure(() => backgroundOps(merc, 8192, 8192, { lonMin: -30, lonMax: 40, latMin: 30, latMax: 70 }, 0, 0, 1300, 730), { iterations: 50, warmup: 5 }).p95, BUDGETS.strips);
if (failed) {
  console.error("Map latency gate failed.");
  process.exitCode = 1;
}
