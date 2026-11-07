/**
 * The seasonal part of a decomposition, drawn as what it is: one typical cycle (a typical week, a typical year), not three years of
 * the same wave laid end to end, which fills a chart with a solid block. Beside it, for a weekly season in daily data, a cycle plot
 * of how each weekday moves from year to year.
 */

import { phaseCount } from "../data/timeseries/decompose.js";
import type { TsSnapshot } from "../data/timeseries/engine.js";
import { compact, MONTHS, WD_SHORT } from "../data/timeseries/format.js";
import { niceTicks } from "./timeseries-patterns.js";

const DAY = 86_400_000;
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Labels for the phases of a season of m periods, when the calendar names them (weekdays, months); else 1…m. */
function phaseLabels(s: TsSnapshot, m: number): string[] {
  const g = s.A.g, M = phaseCount(m), t0 = new Date(s.A.t[0]!);
  if (g.unit === "day" && g.n === 1 && M === 7) { const wd0 = (t0.getUTCDay() + 6) % 7; return Array.from({ length: 7 }, (_, k) => WD_SHORT[(wd0 + k) % 7]!); }
  if (g.id === "month" && M === 12) return Array.from({ length: 12 }, (_, k) => MONTHS[(t0.getUTCMonth() + k) % 12]![0]!);
  if (g.id === "week" && M >= 52) return Array.from({ length: M }, (_, k) => (k % 4 === 0 ? String(k + 1) : ""));
  const every = Math.max(1, Math.round(M / 10));
  return Array.from({ length: M }, (_, k) => (k % every === 0 ? String(k + 1) : ""));
}

/** One cycle as bars (a few phases) or a line (many), zero in the middle of the scale. */
function cycleSvg(vals: ArrayLike<number>, labels: readonly string[], titles: readonly string[], W: number): string {
  const H = 170, L = 44, R = 8, T = 14, B = 22, pw = W - L - R, ph = H - T - B, n = vals.length;
  let lo = 0, hi = 0;
  for (let k = 0; k < n; k++) { lo = Math.min(lo, vals[k]!); hi = Math.max(hi, vals[k]!); }
  const tk = niceTicks(lo, hi, 4);
  lo = Math.min(lo, tk[0]!); hi = Math.max(hi, tk[tk.length - 1]!);
  const y = (v: number): number => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Typical cycle">`;
  for (const t of tk) svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 5}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
  svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="avg"/>`;
  if (n <= 16) {
    const bw = (pw / n) * 0.7;
    for (let k = 0; k < n; k++) {
      const cx = L + (k + 0.5) * (pw / n);
      svg += `<rect x="${cx - bw / 2}" y="${Math.min(y(vals[k]!), y(0))}" width="${bw}" height="${Math.max(1, Math.abs(y(0) - y(vals[k]!)))}" rx="2" class="bar"><title>${esc(titles[k] ?? "")}</title></rect><text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(labels[k] ?? "")}</text>`;
    }
  } else {
    let d = "";
    for (let k = 0; k < n; k++) d += `${k ? "L" : "M"}${(L + (k / Math.max(1, n - 1)) * pw).toFixed(1)},${y(vals[k]!).toFixed(1)}`;
    svg += `<path d="${d}" class="typical"/>`;
    for (let k = 0; k < n; k++) if (labels[k]) svg += `<text x="${L + (k / Math.max(1, n - 1)) * pw}" y="${H - 6}" text-anchor="middle">${esc(labels[k]!)}</text>`;
  }
  return svg + "</svg>";
}

/** Each weekday's level across the years: seven lines, one per weekday, so a weekday that is changing shows as a line that leans. */
function cyclePlotSvg(s: TsSnapshot, W: number): string | null {
  const A = s.A, d = s.dec.dec;
  if (!d || A.g.unit !== "day" || A.g.n !== 1 || phaseCount(d.m) !== 7) return null;
  const N = A.modelN, wd0 = (new Date(A.t[0]!).getUTCDay() + 6) % 7;
  const sum = new Map<number, Float64Array>(), cnt = new Map<number, Float64Array>();
  for (let i = 0; i < N; i++) {
    if (!(A.y[i] === A.y[i]) || A.made[i]) continue;
    const yr = new Date(A.t[i]!).getUTCFullYear();
    if (!sum.has(yr)) { sum.set(yr, new Float64Array(7)); cnt.set(yr, new Float64Array(7)); }
    const wd = (wd0 + i) % 7;
    sum.get(yr)![wd]! += A.y[i]! - d.trend[i]!; cnt.get(yr)![wd]! += 1;
  }
  const years = [...sum.keys()].filter((yr) => (cnt.get(yr)!.every((c) => c >= 8))).sort((a, b) => a - b);
  if (years.length < 2) return null;
  const H = 170, L = 44, R = 8, T = 14, B = 22, pw = W - L - R, ph = H - T - B;
  const val = (yr: number, wd: number): number => sum.get(yr)![wd]! / cnt.get(yr)![wd]!;
  let lo = Infinity, hi = -Infinity;
  for (const yr of years) for (let wd = 0; wd < 7; wd++) { const v = val(yr, wd); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const tk = niceTicks(lo, hi, 4);
  lo = Math.min(lo, tk[0]!); hi = Math.max(hi, tk[tk.length - 1]!);
  const x = (k: number): number => L + (k / Math.max(1, years.length - 1)) * pw, y = (v: number): number => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Each weekday across the years">`;
  for (const t of tk) svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 5}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
  years.forEach((yr, k) => { svg += `<text x="${x(k)}" y="${H - 6}" text-anchor="middle">${yr}</text>`; });
  for (let wd = 0; wd < 7; wd++) {
    const path = years.map((yr, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(val(yr, wd)).toFixed(1)}`).join("");
    const weekend = wd >= 5;
    svg += `<path d="${path}" class="${weekend ? "weekend" : "weekday"}" fill="none"><title>${WD_SHORT[wd]}: ${years.map((yr) => `${yr} ${compact(val(yr, wd))}`).join(", ")}</title></path>`;
    svg += `<text x="${x(years.length - 1) + 3}" y="${y(val(years[years.length - 1]!, wd)) + 3}" class="peak">${WD_SHORT[wd]}</text>`;
  }
  return svg + "</svg>";
}

/** The figures for the Decompose tab, as HTML (empty when there is no season to show). */
export function seasonFigures(s: TsSnapshot, width: number): string {
  const d = s.dec.dec, g = s.A.g;
  if (!d || d.m <= 1) return "";
  const W = Math.max(260, Math.round(width));
  const figs: string[] = [];
  const M = phaseCount(d.m), labels = phaseLabels(s, d.m);
  const cycleName = d.m === 7 && g.unit === "day" ? "week" : M === 12 && g.id === "month" ? "year" : `${M} ${g.nouns}`;
  // A week starts on Monday here, whichever weekday the data begins on.
  const monday = d.m === 7 && g.unit === "day" && g.n === 1;
  const order = monday ? Array.from({ length: 7 }, (_, k) => (k - ((new Date(s.A.t[0]!).getUTCDay() + 6) % 7) + 7) % 7) : Array.from({ length: M }, (_, k) => k);
  const prof = order.map((p) => d.prof[p]!), labs = order.map((p) => labels[p] ?? "");
  const titles = prof.map((v, k) => `${labs[k] || k + 1}: ${v >= 0 ? "+" : "−"}${compact(Math.abs(v))} against the average ${g.noun}`);
  figs.push(`<figure><figcaption>A typical ${esc(cycleName)} <small>· how far each ${esc(g.noun)} sits above or below the average, once the trend is out</small></figcaption>${cycleSvg(prof, labs, titles, W)}</figure>`);
  if (d.also) {
    const Ma = phaseCount(d.also.m), la = phaseLabels(s, d.also.m);
    const yearly = Ma >= 300 || (g.id === "week" && Ma >= 52) || (g.id === "month" && Ma === 12);
    // A year of days is a line of months, not 365 labels: the long profile is drawn as a line with a label every month.
    const labelsLong = yearly && g.unit === "day" ? Array.from({ length: Ma }, (_, k) => { const dt = new Date(Date.UTC(2001, 0, 1) + k * DAY); return dt.getUTCDate() === 1 ? MONTHS[dt.getUTCMonth()]![0]! : ""; }) : la;
    const tl = Array.from(d.also.prof, (v) => `${v >= 0 ? "+" : "−"}${compact(Math.abs(v))} against the average ${g.noun}`);
    figs.push(`<figure><figcaption>A typical ${yearly ? "year" : esc(`${Ma} ${g.nouns}`)} <small>· the longer season, with the weekly one taken out</small></figcaption>${cycleSvg(d.also.prof, labelsLong, tl, W)}</figure>`);
  }
  const plot = cyclePlotSvg(s, W);
  if (plot) figs.push(`<figure><figcaption>Each weekday across the years <small>· the level of each weekday above or below the trend, by year; a line that leans is a weekday that is changing</small></figcaption>${plot}</figure>`);
  return figs.join("");
}
