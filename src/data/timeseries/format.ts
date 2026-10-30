/**
 * Time Series page: dates, numbers and rates in words. Shared by the engine (which
 * writes a few sentences) and the page.
 */

import type { Grain } from "./base.js";

export const dfDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const dfDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const dfMonth = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const dfMonShort = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
export const dfDM = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const dfTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
export const dfWd = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
export const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
export const WD_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date, with the clock when rows come more than once a day. */
export function fmtInstant(ms: number, withTime: boolean): string {
  const d = new Date(ms);
  return withTime ? `${dfDate.format(d)} ${dfTime.format(d)}` : dfDate.format(d);
}
export function full(v: number): string { return Number.isFinite(v) ? (Math.abs(v) >= 100 ? nf.format(v) : nf1.format(v)) : "–"; }
export function compact(v: number): string {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e4) return s + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "k";
  return s + (a >= 100 ? nf.format(a) : nf1.format(a));
}
export function signed(v: number): string {
  if (!Number.isFinite(v)) return "–";
  const c = compact(Math.abs(v));
  return (c === "0" ? "" : v > 0 ? "+" : "−") + c;
}
export function signedNum(v: number): string { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 0); }
export function pct(v: number, digits = 0): string {
  const s = Math.abs(v * 100).toFixed(digits);
  return (Number(s) === 0 ? "" : v > 0 ? "+" : "−") + s + "%";
}
export function fmtNum(v: number): string { return Math.abs(v - Math.round(v)) < 1e-9 ? nf.format(v) : v.toFixed(2); }
export function cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
export function nounFor(g: Grain, k: number): string { return k === 1 ? g.noun : g.nouns; }
/** "a day", "an hour". */
export function aNoun(g: Grain): string { return (/^(hour|8|11|18)/.test(g.noun) ? "an " : "a ") + g.noun; }

export function periodLabel(g: Grain, ms: number): string {
  const dt = new Date(ms);
  if (g.unit === "min") return `${dfDay.format(dt)}, ${dfTime.format(dt)}`;
  if (g.unit === "day") return dfDay.format(dt);
  if (g.unit === "week") return g.n === 1 ? "Week of " + dfDate.format(dt) : `${g.n} weeks from ${dfDate.format(dt)}`;
  if (g.n === 12) return String(dt.getUTCFullYear());
  if (g.n === 3) return `Q${Math.floor(dt.getUTCMonth() / 3) + 1} ${dt.getUTCFullYear()}`;
  return dfMonth.format(dt);
}
export function shortPeriod(g: Grain, ms: number): string {
  const dt = new Date(ms);
  if (g.unit === "min") return `${dfDM.format(dt)} ${dfTime.format(dt)}`;
  if (g.unit === "day" || g.unit === "week") return dfDate.format(dt);
  if (g.n === 12) return String(dt.getUTCFullYear());
  if (g.n === 3) return `Q${Math.floor(dt.getUTCMonth() / 3) + 1} ${dt.getUTCFullYear()}`;
  return dfMonShort.format(dt);
}

const RATE_UNITS: readonly (readonly [string, number])[] = [["a month", 1], ["a year", 12], ["a decade", 120], ["a century", 1200]];
const rateOver = (perMonth: number, asPct: boolean, k: number): number => (asPct ? Math.pow(1 + perMonth, k) - 1 : perMonth * k);
/** Months in the smallest unit (month, year, decade, century) where the rate does not round to zero. */
export function rateK(perMonth: number, asPct: boolean): number {
  for (const [, k] of RATE_UNITS) { const v = rateOver(perMonth, asPct, k); if (Math.abs(asPct ? v * 100 : v) >= 0.05) return k; }
  return 1200;
}
/** A per-month rate in that unit: "+0.4% a year". */
export function rateText(perMonth: number, asPct: boolean, k = rateK(perMonth, asPct)): string {
  if (!(perMonth === perMonth) || perMonth === 0) return "flat";
  const v = rateOver(perMonth, asPct, k);
  const unit = RATE_UNITS.find((u) => u[1] === k)?.[0] ?? "a month";
  return `${asPct ? pct(v, 1) : signed(v)} ${unit}`;
}
