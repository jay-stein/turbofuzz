/**
 * Global settings: the conventions that differ by country or business, kept in one place and assumed nowhere else. Each starts
 * unset. Where the data settles a question (14/03/2025 can only be day-first) the data wins; everywhere else the app uses the
 * setting, and says so when it had to guess because there was none. Kept in the browser, one JSON value.
 */

import { NUMBER_FORMATS, setNumberLocale } from "../data/display-locale.js";

export type DateOrderSetting = "" | "dmy" | "mdy";
export type WeekStartSetting = "" | "mon" | "sun" | "sat";

export interface AppSettings {
  /** Which way round to read a date whose day and month could be either (01/02/2025). */
  dateOrder: DateOrderSetting;
  /** The day a week starts on, for weekly grains made from daily rows. */
  weekStart: WeekStartSetting;
  /** Public-holiday region ("AU-WA", "US"...) or "" for none. */
  holidays: string;
  /** The locale numbers are written in ("en-US", "de-DE"...), or "" for the browser's own. */
  numberFormat: string;
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = { dateOrder: "", weekStart: "", holidays: "", numberFormat: "" };

const KEY = "turbofuzz.settings";
/** Where the holiday region was kept before there was a settings panel. */
const OLD_HOLIDAY_KEY = "turbofuzz.timeseries.holidays";

const listeners = new Set<(settings: AppSettings) => void>();

function clean(raw: unknown): AppSettings {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);
  return {
    dateOrder: pick(o.dateOrder, ["", "dmy", "mdy"] as const, ""),
    weekStart: pick(o.weekStart, ["", "mon", "sun", "sat"] as const, ""),
    holidays: typeof o.holidays === "string" ? o.holidays : "",
    numberFormat: pick(o.numberFormat, ["", ...NUMBER_FORMATS.map(([l]) => l)], ""),
  };
}

/** Kept when the browser will not store anything, so a setting still holds until the page is closed. */
let memory: AppSettings | null = null;

export function readSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) return clean(JSON.parse(stored));
    const old = localStorage.getItem(OLD_HOLIDAY_KEY);
    return memory ?? { ...DEFAULT_SETTINGS, holidays: old ?? "" };
  } catch {
    return memory ?? { ...DEFAULT_SETTINGS };
  }
}

/** Saves a change and tells whoever is listening. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = clean({ ...readSettings(), ...patch });
  memory = next;
  setNumberLocale(next.numberFormat);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not remembered beyond this visit; it still applies until the page is closed.
  }
  for (const listener of listeners) listener(next);
  return next;
}
export function onSettingsChange(listener: (settings: AppSettings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Numbers follow the saved choice from the first draw.
setNumberLocale(readSettings().numberFormat);

/** Region and date order the browser's own locale points to, offered as a suggestion and never applied without a click. */
export function browserSuggestions(language: string, timeZone: string): { dateOrder: DateOrderSetting; weekStart: WeekStartSetting } {
  const lang = language.toLowerCase();
  const monthFirst = /^en-(us|ph)\b|^en$/.test(lang) && !/^en-(au|gb|nz|ie|in|za|ca)/.test(lang);
  const sundayStart = /^en-(us|ca|ph)\b|^ja|^he/.test(lang);
  void timeZone;
  return { dateOrder: monthFirst ? "mdy" : lang === "" ? "" : "dmy", weekStart: sundayStart ? "sun" : "mon" };
}
