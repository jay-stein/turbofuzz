/**
 * Time Series page, Patterns tab: facts and small SVG charts for a typical day, week
 * and year. Drawn at the panel's own pixel width, so 11px text stays 11px.
 */

import type { DayPattern, Patterns } from "../data/timeseries/patterns.js";
import { cadenceText, DAY } from "../data/timeseries/base.js";
import { compact, full, MONTHS, nf, pct, signed, WD_SHORT, WEEKDAYS } from "../data/timeseries/format.js";
import { escapeHtml } from "./timeseries-findings.js";

export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(v);
  return ticks;
}
function argExt(a: readonly number[], dir: 1 | -1): number {
  let b = -1;
  a.forEach((v, k) => { if (v === v && (b < 0 || (dir > 0 ? v > a[b] : v < a[b]))) b = k; });
  return b;
}
export function slotTime(k: number, stepMin: number): string {
  const m = k * stepMin;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** Relative to the average when the profile never goes below zero, else in its own units. */
function vsAvg(v: number, avg: number, pos: boolean): string { return pos && avg > 0 ? pct(v / avg - 1) : signed(v - avg); }
const finite = (a: readonly number[]): number[] => a.filter((v) => v === v);
const mean = (a: readonly number[]): number => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : NaN);

/** A typical day: the median with its middle half, and the weekday and weekend means. */
function daySvg(D: DayPattern, W: number): string {
  const H = 220, L = 46, R = 8, T = 10, B = 24, pw = W - L - R, ph = H - T - B, n = D.pd;
  const all = finite([...D.p25, ...D.p75, ...D.weekday, ...D.weekend]);
  const tk = niceTicks(Math.min(0, ...all), Math.max(...all), 4);
  const lo = Math.min(0, tk[0]), hi = Math.max(...all, tk[tk.length - 1]);
  const x = (k: number): number => L + (k / Math.max(1, n - 1)) * pw, y = (v: number): number => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
  const path = (a: readonly number[]): string => a.map((v, k) => (v === v ? `${k && a[k - 1] === a[k - 1] ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}` : "")).join("");
  const band = D.p75.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join("") +
    D.p25.map((_, k) => k).reverse().map((k) => `L${x(k).toFixed(1)},${y(D.p25[k]).toFixed(1)}`).join("") + "Z";
  const every = Math.max(1, Math.round(n / 8));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Typical day">`;
  for (const t of tk) svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
  for (let k = 0; k < n; k += every) svg += `<text x="${x(k)}" y="${H - 6}" text-anchor="middle">${slotTime(k, D.stepMin)}</text>`;
  svg += `<path d="${band}" class="band"/>`;
  svg += `<path d="${path(D.weekday)}" class="weekday"/>`;
  svg += `<path d="${path(D.weekend)}" class="weekend"/>`;
  svg += `<path d="${path(D.med)}" class="typical"/>`;
  const cw = pw / Math.max(1, n - 1);
  for (let k = 0; k < n; k++) svg += `<rect class="hit" x="${x(k) - cw / 2}" y="${T}" width="${cw}" height="${ph}"><title>${slotTime(k, D.stepMin)}: typical ${full(D.med[k])} (middle half ${full(D.p25[k])} to ${full(D.p75[k])}); weekdays ${full(D.weekday[k])}, weekends ${full(D.weekend[k])}</title></rect>`;
  return svg + "</svg>";
}
/** Bars with the highest in full colour and the rest muted; a dashed line at the average. */
function barsSvg(vals: readonly number[], labels: readonly string[], titles: readonly string[], W: number): string {
  const H = 190, L = 40, R = 6, T = 18, B = 22, pw = W - L - R, ph = H - T - B, n = vals.length;
  const fin = finite(vals), avg = mean(fin);
  const tk = niceTicks(Math.min(0, ...fin), Math.max(...fin), 4);
  const lo = Math.min(0, tk[0]), hi = Math.max(...fin, tk[tk.length - 1]);
  const y = (v: number): number => T + ph - ((v - lo) / (hi - lo || 1)) * ph, bw = (pw / n) * 0.7, top = argExt(vals, 1);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of tk) svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 5}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
  vals.forEach((v, k) => {
    const cx = L + (k + 0.5) * (pw / n);
    if (v === v) svg += `<rect x="${cx - bw / 2}" y="${Math.min(y(v), y(0))}" width="${bw}" height="${Math.max(1, Math.abs(y(0) - y(v)))}" rx="2" class="${k === top ? "bar top" : "bar"}"><title>${escapeHtml(titles[k])}</title></rect>`;
    if (k === top) svg += `<text x="${cx}" y="${y(v) - 5}" text-anchor="middle" class="peak">${compact(v)}</text>`;
    svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${labels[k]}</text>`;
  });
  svg += `<line x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" class="avg"/>`;
  return svg + "</svg>";
}
/** Weekday by time of day: darker is higher. */
function heatSvg(D: DayPattern, W: number): string {
  const n = D.pd, L = 36, R = 4, T = 4, ch = 20, B = 20, H = T + 7 * ch + B, cw = (W - L - R) / n;
  const fin = finite(D.cells), lo = Math.min(...fin), hi = Math.max(...fin);
  const every = Math.max(1, Math.round(n / 8));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Day of week by time of day">`;
  for (let wd = 0; wd < 7; wd++) {
    svg += `<text x="${L - 6}" y="${T + wd * ch + ch / 2 + 4}" text-anchor="end">${WD_SHORT[wd]}</text>`;
    for (let k = 0; k < n; k++) {
      const v = D.cells[wd * n + k];
      const a = v === v ? 0.06 + 0.94 * ((v - lo) / (hi - lo || 1)) : 0;
      svg += `<rect x="${L + k * cw}" y="${T + wd * ch}" width="${cw + 0.4}" height="${ch - 2}" class="cell" fill-opacity="${a.toFixed(3)}"><title>${WD_SHORT[wd]} ${slotTime(k, D.stepMin)}: ${v === v ? full(v) + " on average" : "no rows"}</title></rect>`;
    }
  }
  for (let k = 0; k < n; k += every) svg += `<text x="${L + k * cw + cw / 2}" y="${H - 5}" text-anchor="middle">${slotTime(k, D.stepMin)}</text>`;
  return svg + "</svg>";
}

/** The facts row and the figures, as HTML for the Patterns panel. */
export function patternsHtml(P: Patterns, what: string, gridWidth: number, cadence: number, spanMs: number): { facts: string; figures: string } {
  const wide = Math.max(300, gridWidth - 26), half = Math.max(260, (gridWidth > 760 ? (gridWidth - 12) / 2 : gridWidth) - 26);
  const facts: [string, string][] = [], figs: string[] = [];
  const { day: D, week: Wk, year: Yr } = P;
  if (D) {
    const hi = argExt(D.med, 1), lo = argExt(D.med, -1);
    facts.push(["Peak time of day", `${slotTime(hi, D.stepMin)} <small>typical ${compact(D.med[hi])}</small>`]);
    facts.push(["Low time of day", `${slotTime(lo, D.stepMin)} <small>typical ${compact(D.med[lo])}</small>`]);
    figs.push(`<figure class="wide"><figcaption>A typical day <small>· ${what} per ${D.noun}, over ${nf.format(D.days)} days</small></figcaption>
      <div class="ts-patkey"><span><i class="typical"></i>Typical (median)</span><span><i class="band"></i>Middle half of days</span><span><i class="weekday"></i>Weekdays (mean)</span><span><i class="weekend"></i>Weekends (mean)</span></div>
      ${daySvg(D, wide)}</figure>`);
  }
  if (Wk) {
    const avg = mean(finite(Wk.mean)), hi = argExt(Wk.mean, 1), lo = argExt(Wk.mean, -1);
    facts.push(["Peak day", `${WEEKDAYS[hi].slice(0, -1)} <small>${vsAvg(Wk.mean[hi], avg, Wk.pos)} vs average day</small>`]);
    facts.push(["Low day", `${WEEKDAYS[lo].slice(0, -1)} <small>${vsAvg(Wk.mean[lo], avg, Wk.pos)}</small>`]);
    const wd = finite(Wk.mean.slice(0, 5)), we = finite(Wk.mean.slice(5));
    if (wd.length && we.length) facts.push(["Weekends vs weekdays", vsAvg(mean(we), mean(wd), Wk.pos)]);
    const titles = Wk.mean.map((v, k) => `${WEEKDAYS[k]}: ${v === v ? `${full(v)} on average (${vsAvg(v, avg, Wk.pos)} vs the average day), over ${Wk.n[k]} days` : "no complete days"}`);
    figs.push(`<figure><figcaption>Day of week <small>· average ${what} per day; dashed line is the average day</small></figcaption>${barsSvg(Wk.mean, WD_SHORT, titles, half)}</figure>`);
  }
  if (Yr) {
    const avg = mean(finite(Yr.mean)), hi = argExt(Yr.mean, 1), per = Yr.perDay ? "day" : "month";
    facts.push(["Peak month", `${MONTHS[hi]} <small>${vsAvg(Yr.mean[hi], avg, Yr.pos)} vs average month</small>`]);
    const titles = Yr.mean.map((v, k) => `${MONTHS[k]}: ${v === v ? `${full(v)} per ${per} on average (${vsAvg(v, avg, Yr.pos)} vs the average month), over ${Yr.years[k]} ${Yr.years[k] === 1 ? "year" : "years"}` : "no complete data"}`);
    figs.push(`<figure><figcaption>Month of year <small>· average ${what} per ${per} in each month</small></figcaption>${barsSvg(Yr.mean, MONTHS.map((m) => m[0]), titles, half)}</figure>`);
  } else if (Wk) figs.push(`<figure><figcaption>Month of year</figcaption><p class="ts-patempty">Needs about a year of data to show; this table covers ${nf.format(Math.round(spanMs / DAY))} days.</p></figure>`);
  if (D) figs.push(`<figure class="wide"><figcaption>Day of week by time of day <small>· average ${what} per ${D.noun}; darker is higher</small></figcaption>${heatSvg(D, wide)}</figure>`);
  if (!D && !Wk && !Yr) figs.push(`<p class="ts-patempty">Rows come about every ${cadenceText(cadence)}, so there is no day or week to profile. Patterns need daily or finer data.</p>`);
  else if (!D) figs.unshift(`<p class="ts-patempty wide">Rows come about every ${cadenceText(cadence)}, so there is no time of day to profile.</p>`);
  return { facts: facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join(""), figures: figs.join("") };
}
