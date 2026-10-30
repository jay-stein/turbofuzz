/**
 * How to read dates when converting a column: day first, month first, a common
 * format (those that fit the column's values listed first, with how many they read),
 * or a custom format typed by the person (YYYY-MM, %d.%m.%Y %H:%M, ...).
 */

import { DATE_FORMAT_PRESETS, formatProblem, parseWithFormat, rankFormats } from "../parse/date-format.js";
import { classifyDateValue, orderFormat, type DateOrder } from "../parse/dates.js";
import { el } from "./dom.js";

export interface DateFormatPicker {
  root: HTMLElement;
  /** The order to convert with; null while a custom format is unusable. */
  value(): DateOrder | null;
  set(order: DateOrder): void;
  /** Show only date formats, or date and date & time formats. */
  setWithTime(withTime: boolean): void;
  /** New sample values (another column): re-rank the formats, keep the choice. */
  setSamples(values: readonly string[]): void;
}

const CUSTOM = "custom";

export function createDateFormatPicker(options: {
  samples: readonly string[];
  initial: DateOrder;
  withTime: boolean;
  onChange(): void;
  label?: string;
}): DateFormatPicker {
  let samples = options.samples.map((v) => v.trim()).filter((v) => v !== "").slice(0, 200);
  let withTime = options.withTime;
  const select = el("select", { class: "chart-select", "aria-label": "Date format" }) as HTMLSelectElement;
  const custom = el("input", {
    type: "text",
    class: "chart-select date-format-custom hidden",
    placeholder: "e.g. YYYY-MM or DD.MM.YYYY HH:mm or %Y-%m",
    "aria-label": "Custom date format",
    spellcheck: "false",
  }) as HTMLInputElement;
  const help = el("div", { class: "date-format-help hidden" }, [
    "YYYY year · YY 2-digit year · MM month · MMM Jan · MMMM January · DD day · Q quarter · HH hour 0-23 · hh hour 1-12 with A (AM/PM) · mm minutes · ss seconds · SSS fraction · Z offset · [text] literal. strftime (%Y-%m-%d %H:%M) also works. Missing parts start at 1: YYYY-MM is the 1st of the month.",
  ]);
  const status = el("div", { class: "date-format-status", role: "status" });
  const root = el("div", { class: "date-format-picker" }, [
    el("label", { class: "chart-setup-field" }, [el("span", { class: "chart-field-label" }, [options.label ?? "Date format"]), select]),
    custom,
    help,
    status,
  ]);

  const autoReads = (order: "dmy" | "mdy"): number => samples.filter((v) => classifyDateValue(v, order) !== null).length;
  const share = (hits: number): string => (samples.length ? ` · reads ${hits} of ${samples.length} sample values` : "");

  function build(current: string): void {
    select.replaceChildren();
    const presets = DATE_FORMAT_PRESETS.filter((p) => withTime || !p.time);
    const ranked = rankFormats(samples, presets);
    const fitting = new Set(ranked.map((r) => r.preset.format));
    const auto = el("optgroup", { label: "Automatic" });
    auto.append(
      el("option", { value: "dmy" }, [`Day first when ambiguous (DD/MM/YYYY)${share(autoReads("dmy"))}`]),
      el("option", { value: "mdy" }, [`Month first when ambiguous (MM/DD/YYYY)${share(autoReads("mdy"))}`]),
    );
    select.append(auto);
    if (ranked.length) {
      const group = el("optgroup", { label: "Formats that fit this column" });
      for (const r of ranked) group.append(el("option", { value: `fmt:${r.preset.format}` }, [`${r.preset.format}   (${r.preset.example})${share(r.hits)}`]));
      select.append(group);
    }
    const other = el("optgroup", { label: ranked.length ? "Other formats" : "Formats" });
    for (const p of presets) if (!fitting.has(p.format)) other.append(el("option", { value: `fmt:${p.format}` }, [`${p.format}   (${p.example})`]));
    select.append(other, el("option", { value: CUSTOM }, ["Custom format…"]));
    if (Array.from(select.options).some((o) => o.value === current)) select.value = current;
    else if (current.startsWith("fmt:")) {
      select.value = CUSTOM;
      custom.value = current.slice(4);
    } else select.value = "dmy";
    sync();
  }

  function sync(): void {
    const isCustom = select.value === CUSTOM;
    custom.classList.toggle("hidden", !isCustom);
    help.classList.toggle("hidden", !isCustom);
    status.classList.remove("error");
    if (isCustom) {
      const problem = formatProblem(custom.value);
      if (problem !== null) {
        status.textContent = problem;
        status.classList.add("error");
        return;
      }
    }
    const order = value();
    const fmt = order === null ? null : orderFormat(order);
    if (fmt === null || samples.length === 0) {
      status.textContent = "";
      return;
    }
    const hits = samples.filter((v) => parseWithFormat(v, fmt) !== null);
    const first = hits[0];
    const misses = samples.filter((v) => parseWithFormat(v, fmt) === null).slice(0, 3);
    status.textContent =
      (first !== undefined ? `“${first}” reads as ${new Date(parseWithFormat(first, fmt)!.ms).toISOString().replace(/T00:00:00\.000Z$/, "").replace(/\.000Z$/, "Z")}. ` : "") +
      // The menu already says how many a listed format reads; repeat it for a typed one or when some miss.
      (select.value === CUSTOM || misses.length
        ? `Reads ${hits.length} of ${samples.length} sample values` + (misses.length ? `; not: ${misses.map((m) => `“${m}”`).join(", ")}` : "") + "."
        : "");
  }

  function value(): DateOrder | null {
    if (select.value !== CUSTOM) return select.value as DateOrder;
    return formatProblem(custom.value) === null ? (`fmt:${custom.value.trim()}` as DateOrder) : null;
  }

  // Start on the best fit when automatic reading misses values a common format reads.
  function bestStart(current: string): string {
    if ((current !== "dmy" && current !== "mdy") || samples.length === 0) return current;
    const best = rankFormats(samples, DATE_FORMAT_PRESETS.filter((p) => withTime || !p.time))[0];
    return best !== undefined && best.hits > autoReads(current) ? `fmt:${best.preset.format}` : current;
  }
  build(bestStart(options.initial));

  select.addEventListener("change", () => {
    sync();
    if (select.value === CUSTOM) custom.focus();
    options.onChange();
  });
  let timer: number | undefined;
  custom.addEventListener("input", () => {
    sync();
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => options.onChange(), 250);
  });

  return {
    root,
    value,
    set(order) {
      build(order);
    },
    setSamples(values) {
      samples = values.map((v) => v.trim()).filter((v) => v !== "").slice(0, 200);
      const current = select.value === CUSTOM ? `fmt:${custom.value}` : select.value;
      const next = bestStart(current);
      build(next);
      if (next !== current) options.onChange();
    },
    setWithTime(next) {
      if (next === withTime) return;
      withTime = next;
      const current = select.value === CUSTOM ? `fmt:${custom.value}` : select.value;
      build(current);
    },
  };
}
