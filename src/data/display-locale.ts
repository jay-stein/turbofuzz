/**
 * How numbers are written on screen (thousands and decimal marks), decided once. Call sites across the app ask for "en", "en-GB" or
 * the browser's locale, which showed 1,234 in one panel and 1 234 in another. This module is the single source: importing it makes
 * every number format, and every Number.toLocaleString, follow the chosen locale. Only English or unspecified requests are
 * redirected; a call that names another language on purpose keeps it. With nothing chosen, the browser's own locale is used
 * everywhere, so the display is at least consistent. Dates are not touched.
 */

let chosen = "";
let version = 0;

/** Sets the locale numbers are written in ("" for the browser's own). */
export function setNumberLocale(locale: string): void {
  if (locale === chosen) return;
  chosen = locale;
  version++;
}
export function numberLocale(): string {
  return chosen;
}

function browserLocale(): string | undefined {
  try {
    return typeof navigator !== "undefined" && navigator.language ? navigator.language : undefined;
  } catch {
    return undefined;
  }
}

/** The locale a call should use: the chosen one for an English or unspecified request, else what it asked for. */
function effective(requested: unknown): string | string[] | undefined {
  const first = Array.isArray(requested) ? requested[0] : requested;
  const redirect = first === undefined || (typeof first === "string" && /^en(-[A-Za-z]{2})?$/.test(first));
  if (!redirect) return requested as string | string[];
  return chosen !== "" ? chosen : browserLocale() ?? (first as string | undefined);
}

const RealNumberFormat = Intl.NumberFormat;
const realToLocaleString = Number.prototype.toLocaleString;

/** A number format that follows the chosen locale even if it was built before the choice was made. */
class LiveNumberFormat {
  private inner: Intl.NumberFormat;
  private seen = version;
  constructor(private readonly locales?: string | string[], private readonly options?: Intl.NumberFormatOptions) {
    this.inner = new RealNumberFormat(effective(locales), options);
  }
  private current(): Intl.NumberFormat {
    if (this.seen !== version) {
      this.inner = new RealNumberFormat(effective(this.locales), this.options);
      this.seen = version;
    }
    return this.inner;
  }
  format = (value: number | bigint): string => this.current().format(value);
  formatToParts(value: number | bigint): Intl.NumberFormatPart[] {
    return this.current().formatToParts(value);
  }
  resolvedOptions(): Intl.ResolvedNumberFormatOptions {
    return this.current().resolvedOptions();
  }
  static supportedLocalesOf(locales: string | string[]): string[] {
    return RealNumberFormat.supportedLocalesOf(locales);
  }
}

if (!(Intl.NumberFormat as unknown as { live?: boolean }).live) {
  (LiveNumberFormat as unknown as { live: boolean }).live = true;
  (Intl as unknown as { NumberFormat: unknown }).NumberFormat = LiveNumberFormat;
  Number.prototype.toLocaleString = function (this: number, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions): string {
    return realToLocaleString.call(this, effective(locales) as string | undefined, options);
  };
}

/** The ways of writing a number offered in Settings: a locale, and what it looks like. */
export const NUMBER_FORMATS: readonly (readonly [string, string])[] = [
  ["en-US", "1,234,567.89 (comma thousands, point decimal)"],
  ["de-DE", "1.234.567,89 (point thousands, comma decimal)"],
  ["fr-FR", "1 234 567,89 (space thousands, comma decimal)"],
  ["de-CH", "1’234’567.89 (apostrophe thousands, point decimal)"],
  ["en-IN", "12,34,567.89 (lakh and crore grouping)"],
];

/** The option the browser's language points to, for a suggestion; "" when none fits. */
export function suggestNumberFormat(language: string): string {
  const lang = language.toLowerCase();
  if (lang === "") return "";
  const exact = NUMBER_FORMATS.find(([l]) => l.toLowerCase() === lang);
  if (exact) return exact[0];
  const base = lang.split("-")[0];
  if (base === "en") return "en-US";
  return NUMBER_FORMATS.find(([l]) => l.toLowerCase().startsWith(`${base}-`))?.[0] ?? "";
}
