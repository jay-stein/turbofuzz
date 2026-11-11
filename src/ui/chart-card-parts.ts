/**
 * Small pieces the chart card shares with nothing else: its toolbar icons, the theme colour reader,
 * and the remembered open or closed state of its settings sections.
 */
import { svgIcon } from "./dom.js";

export type SettingsGroup = "refine" | "format" | "data";


/** Whether a settings section is open: closed until the person opens it, then as they left it. */
export function readGroupOpen(group: SettingsGroup): boolean {
  try {
    return localStorage.getItem(`turbofuzz.charts.${group}Open`) === "1";
  } catch {
    return false;
  }
}

export function writeGroupOpen(group: SettingsGroup, open: boolean): void {
  try {
    localStorage.setItem(`turbofuzz.charts.${group}Open`, open ? "1" : "0");
  } catch {
    // Remembering is a convenience; the section still opens and closes.
  }
}


export function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/** Movie-camera glyph for the Animate button and the GIF export. */
export function movieIcon(): SVGElement {
  return svgIcon(
    '<rect x="2.5" y="6.5" width="12.5" height="11" rx="2.5"/><path d="m15 10.5 6.5-4v11l-6.5-4z"/>',
    "chart-movie-icon",
  );
}

/** Arrows pushing out to two side walls: the card fills the whole row. */
/** A window with an arrow leaving its corner: pop this chart out to look closer. */
export function focusIcon(): SVGElement {
  return svgIcon(
    '<path d="M10 5H7a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-3"/><path d="M14 4h6v6"/><path d="m20 4-8 8"/>',
    "chart-focus-icon",
  );
}

/** A picture with a download arrow: save the chart as an image. */
export function pngIcon(): SVGElement {
  return svgIcon(
    '<rect x="3" y="3" width="18" height="12" rx="2.5"/><circle cx="8.5" cy="7.5" r="1.3"/><path d="m3.5 13 4.5-4 4 3.5 2.5-2 6 4.5"/><path d="M12 17.5v4.5"/><path d="m9.7 20 2.3 2.3 2.3-2.3"/>',
    "chart-png-icon",
  );
}

export function missingOrTokens(missing: number, tokens: number): boolean {
  return missing > 0 || tokens > 0;
}
