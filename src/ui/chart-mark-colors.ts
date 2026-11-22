/**
 * Colours for single marks: one bar, one bar of a group or stack, or a whole series, chosen by
 * the person the way Excel lets one bar be recoloured. Display only, never a Recipe step.
 *
 * An override is keyed by what the mark stands for (its category, and its series in a grouped
 * or stacked chart), never by position, so it follows the bar through sorting, filters, Top N
 * and a data refresh; a key whose category is gone stays in the config and applies again when
 * it comes back. Draw code asks markColor(base, category, series) per mark: with no overrides
 * that is one property check, so a chart nobody recoloured draws exactly as before.
 */

import { cssVar } from "./chart-card-parts.js";
import { hexToRgb, rampColor } from "./chart-utils.js";
import { DEFAULT_PALETTE, isRampPalette, samplePalette } from "../data/palettes.js";
import { colorForFraction } from "./color-scale.js";
import { el } from "./dom.js";
import type { ChartCard } from "./chart-card.js";
import type { ChartCardConfig } from "./chart-card-types.js";
import { HEX } from "./chart-card-types.js";

/** The stored stand-in for the theme's de-emphasis grey, so a greyed bar suits light and dark alike. */
export const MUTED = "muted";

/** The key of one mark: its category, its series, or both (a bar inside a group or stack). */
export function markKey(category: string | null, series: string | null = null): string {
  return series === null ? JSON.stringify([category]) : JSON.stringify([category, series]);
}

/** What a key stands for, in words for the selection bar. */
export function markKeyName(key: string): string {
  try {
    const [category, series] = JSON.parse(key) as [string | null, string | undefined];
    if (category === null) return series ?? "";
    return series === undefined ? category : `${category} · ${series}`;
  } catch {
    return key;
  }
}

const mutedByFrame = new WeakMap<object, string>();

/** The de-emphasis grey: the theme's dim text mixed into the panel, so it recedes on either theme. Worked out once per draw. */
function mutedColor(card?: ChartCard): string {
  const frame = card?.lastFrame ?? null;
  const known = frame === null ? undefined : mutedByFrame.get(frame);
  if (known !== undefined) return known;
  const color = mixMuted();
  if (frame !== null) mutedByFrame.set(frame, color);
  return color;
}

function mixMuted(): string {
  const [r1, g1, b1] = hexToRgb(cssVar("--text-dim", "#59636e"));
  const [r2, g2, b2] = hexToRgb(cssVar("--panel", "#ffffff"));
  const mix = (a: number, b: number): string => Math.round(a * 0.45 + b * 0.55).toString(16).padStart(2, "0");
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`;
}

/** Whether this card has any mark colour, highlight or single label set. */
export function hasMarkStyles(config: ChartCardConfig): boolean {
  return (config.markColors !== undefined && Object.keys(config.markColors).length > 0) || config.markHighlight !== undefined || (config.markLabels?.length ?? 0) > 0;
}

/**
 * The colour to fill one mark with. `base` is what the chart would use on its own. Highlight
 * mode keeps the highlighted mark (or every mark of the highlighted series) and greys the rest.
 */
export function markColor(card: ChartCard, base: string, category: string | null, series: string | null = null): string {
  const colors = card.config.markColors;
  const highlight = card.config.markHighlight;
  if (colors === undefined && highlight === undefined) return base;
  const own = markKey(category, series);
  const seriesKey = series === null ? null : markKey(null, series);
  const chosen = colors?.[own] ?? (seriesKey === null ? undefined : colors?.[seriesKey]);
  if (highlight !== undefined && highlight !== own && highlight !== seriesKey) return mutedColor(card);
  if (chosen === undefined) return base;
  return chosen === MUTED ? mutedColor(card) : chosen;
}

/** Whether one mark shows its value label although the chart labels none of them. */
export function markLabelled(card: ChartCard, category: string | null, series: string | null = null): boolean {
  const labels = card.config.markLabels;
  return labels !== undefined && labels.length > 0 && labels.includes(markKey(category, series));
}

function setMarkColor(card: ChartCard, key: string, color: string | null): void {
  const next = { ...(card.config.markColors ?? {}) };
  if (color === null) delete next[key];
  else next[key] = color;
  card.config.markColors = Object.keys(next).length > 0 ? next : undefined;
}

/** Clears every mark colour, highlight and single label on the card. */
export function resetMarkStyles(card: ChartCard): void {
  card.config.markColors = undefined;
  card.config.markHighlight = undefined;
  card.config.markLabels = undefined;
  syncMarkReset(card);
  card.render();
}

/** The card's "Reset colours" button shows only when there is something to reset. */
export function syncMarkReset(card: ChartCard): void {
  card.markResetButton?.classList.toggle("hidden", !hasMarkStyles(card.config));
}

/**
 * The colour choices for one mark or series: the chart's palette, the de-emphasis grey, a hex
 * code, and Reset. Built from the card's own swatch and hex classes. Escape closes the row and
 * hands focus back to the button that opened it.
 */
export function markColorRow(card: ChartCard, key: string, opener: HTMLElement, close: () => void): HTMLElement {
  const row = el("div", { class: "chart-colors chart-mark-colors", role: "group", "aria-label": `Colour of ${markKeyName(key)}` });
  const choose = (color: string | null): void => {
    setMarkColor(card, key, color);
    syncMarkReset(card);
    card.render();
  };
  const current = card.config.markColors?.[key];
  const colors = [...new Set(Array.from({ length: 8 }, (_, index) => card.paletteColor(index, 8).toLowerCase()))];
  for (const color of [...colors, MUTED]) {
    const name = color === MUTED ? "grey (de-emphasise)" : color;
    const swatch = el("button", { class: "chart-swatch", type: "button", title: name, "aria-label": `Colour ${markKeyName(key)} ${name}` }) as HTMLButtonElement;
    swatch.style.background = color === MUTED ? mutedColor() : color;
    swatch.classList.toggle("active", current === color);
    swatch.addEventListener("click", () => choose(color));
    row.append(swatch);
  }
  const hex = el("input", { class: "chart-hex", type: "text", placeholder: "#2563eb", spellcheck: "false", "aria-label": "Custom colour as a hex code" }) as HTMLInputElement;
  if (current !== undefined && current !== MUTED) hex.value = current;
  const applyHex = (): void => {
    const value = hex.value.trim();
    if (!HEX.test(value)) return;
    choose(value.startsWith("#") ? value.toLowerCase() : `#${value.toLowerCase()}`);
  };
  hex.addEventListener("change", applyHex);
  hex.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyHex();
    }
  });
  const reset = el("button", { class: "ghost small", type: "button", title: "Back to the chart's own colour" }, ["Reset"]) as HTMLButtonElement;
  reset.addEventListener("click", () => choose(null));
  row.append(hex, reset);
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
    opener.focus();
  });
  return row;
}

/**
 * The mark buttons of the selection bar: Colour… (opens the colour row), Highlight (this one in
 * colour, the rest grey; again to undo) and, where the chart does not label every mark, Label.
 */
export function markButtons(card: ChartCard, key: string, bar: HTMLElement, labels: boolean): HTMLElement[] {
  const colour = el("button", { class: "ghost small", type: "button", "aria-expanded": "false", title: `Choose a colour for ${markKeyName(key)}` }, ["Colour…"]) as HTMLButtonElement;
  let row: HTMLElement | null = null;
  const closeRow = (): void => {
    row?.remove();
    row = null;
    bar.classList.remove("picking");
    colour.setAttribute("aria-expanded", "false");
  };
  colour.addEventListener("click", () => {
    if (row !== null) {
      closeRow();
      return;
    }
    row = markColorRow(card, key, colour, closeRow);
    bar.append(row);
    bar.classList.add("picking");
    colour.setAttribute("aria-expanded", "true");
    row.querySelector<HTMLElement>(".chart-swatch.active, .chart-swatch")?.focus();
  });
  const on = card.config.markHighlight === key;
  const highlight = el("button", { class: "ghost small", type: "button", "aria-pressed": String(on), title: on ? "Give every mark its colour back" : `Keep ${markKeyName(key)} in colour and grey the rest` }, [on ? "Show all colours" : "Highlight"]) as HTMLButtonElement;
  highlight.addEventListener("click", () => {
    card.config.markHighlight = card.config.markHighlight === key ? undefined : key;
    const now = card.config.markHighlight === key;
    highlight.textContent = now ? "Show all colours" : "Highlight";
    highlight.setAttribute("aria-pressed", String(now));
    syncMarkReset(card);
    card.render();
  });
  const out: HTMLElement[] = [colour, highlight];
  if (labels) {
    const shown = card.config.markLabels?.includes(key) === true;
    const label = el("button", { class: "ghost small", type: "button", "aria-pressed": String(shown), title: "Show or hide the value on this one mark" }, ["Label"]) as HTMLButtonElement;
    label.addEventListener("click", () => {
      const list = card.config.markLabels ?? [];
      const next = list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
      card.config.markLabels = next.length > 0 ? next : undefined;
      label.setAttribute("aria-pressed", String(next.includes(key)));
      syncMarkReset(card);
      card.render();
    });
    out.push(label);
  }
  return out;
}

/** The mark styles of a spec that read as such; anything else in a hand-edited file is left out. */
export function markStylesFromSpec(raw: { markColors?: unknown; markHighlight?: unknown; markLabels?: unknown }): Pick<ChartCardConfig, "markColors" | "markHighlight" | "markLabels"> {
  const out: Pick<ChartCardConfig, "markColors" | "markHighlight" | "markLabels"> = {};
  if (raw.markColors !== null && typeof raw.markColors === "object" && !Array.isArray(raw.markColors)) {
    const colors: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.markColors as Record<string, unknown>)) {
      if (typeof value === "string" && (value === MUTED || HEX.test(value))) colors[key] = value;
    }
    if (Object.keys(colors).length > 0) out.markColors = colors;
  }
  if (typeof raw.markHighlight === "string") out.markHighlight = raw.markHighlight;
  if (Array.isArray(raw.markLabels)) {
    const labels = (raw.markLabels as unknown[]).filter((entry): entry is string => typeof entry === "string");
    if (labels.length > 0) out.markLabels = labels;
  }
  return out;
}

/** A legend swatch: opens the selection bar on that whole series, with its colour row open. */
export function openSeriesColours(card: ChartCard, series: string): void {
  const bar = card.selectionBar;
  if (bar === null) return;
  card.clearSelection();
  const key = markKey(null, series);
  const dismiss = el("button", { class: "icon-btn", type: "button", title: "Close", "aria-label": "Close" }, ["×"]) as HTMLButtonElement;
  dismiss.addEventListener("click", () => card.clearSelection());
  const buttons = markButtons(card, key, bar, false);
  bar.replaceChildren(el("span", { class: "chart-selection-name", title: series }, [series]), ...buttons, dismiss);
  bar.classList.remove("hidden");
  buttons[0]?.click();
}

/**
 * "All bars" colour maps, shown when a bar is clicked: one plain colour, or every bar its own colour from a
 * map, each drawn as a small strip of its colours so the choice is visual. Applies what Format → Colour map
 * and "Colour each bar" would, and keeps them in step.
 */
export function colourMapRow(card: ChartCard, maps: readonly string[]): HTMLElement {
  const row = el("div", { class: "chart-map-row", role: "group", "aria-label": "Colours for all bars" }, [el("span", { class: "chart-map-row-label" }, ["All bars"])]);
  const measure = card.config.kind === "barplot";
  const current = (measure ? card.config.colourBars === true : card.config.multiColor) ? (card.config.palette ?? "") : null;
  const strip = (colors: readonly string[]): HTMLElement => {
    const swatch = el("span", { class: "chart-map-strip", "aria-hidden": "true" });
    swatch.style.background = colors.length === 1 ? colors[0]! : `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(", ")})`;
    return swatch;
  };
  const choice = (label: string, title: string, colors: readonly string[], on: boolean, apply: () => Promise<void> | void): void => {
    const button = el("button", { class: "chart-map-choice", type: "button", title, "aria-pressed": String(on) }, [strip(colors), el("span", {}, [label])]) as HTMLButtonElement;
    button.classList.toggle("active", on);
    button.addEventListener("click", () => {
      void Promise.resolve(apply()).then(() => {
        for (const other of row.querySelectorAll(".chart-map-choice")) {
          other.classList.toggle("active", other === button);
          other.setAttribute("aria-pressed", String(other === button));
        }
      });
    });
    row.append(button);
  };
  choice("One colour", "Every bar in the chart's own colour", [card.primaryColor()], current === null, () => {
    card.config.multiColor = false;
    card.config.colourBars = false;
    if (card.multiInput !== undefined) card.multiInput.checked = false;
    card.render();
  });
  for (const name of maps) {
    choice(name, `Give every bar its own colour from ${name}`, samplePalette(name, 6, []), current === name, async () => {
      await card.applyPalette(name);
      card.config.multiColor = true;
      card.config.colourBars = true;
      if (card.multiInput !== undefined) card.multiInput.checked = true;
      card.render();
    });
  }
  return row;
}

/**
 * A measure bar's own colour before any single-bar override: the chart's colour until a colour map is chosen
 * for the chart (from a clicked bar or Format). Then a set of distinct colours gives each bar the next one, and a ramp shades each bar by its value (bigger is
 * further along the ramp), so the colour says something.
 */
export function barFill(card: ChartCard, position: number, value: number, top: number): string {
  if (card.config.colourBars !== true) return card.primaryColor();
  const name = card.config.palette ?? DEFAULT_PALETTE;
  if (!isRampPalette(name)) return card.paletteColor(position);
  const share = top > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, Math.abs(value) / top)) : 0;
  // The ramp's palest end vanishes into the background, so the smallest bar starts a fifth of the way in.
  return colorForFraction(0.2 + 0.8 * share, card.rampStopsFor(name), rampColor);
}
