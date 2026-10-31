/**
 * How to read dates when converting a column: day first, month first, a common
 * format (those that fit the column's values listed first, with how many they read),
 * or a custom format typed by the person (YYYY-MM, %d.%m.%Y %H:%M, ...).
 */

import { DATE_FORMAT_PRESETS, formatProblem, parseWithFormat, rankFormats, toStrftime } from "../parse/date-format.js";
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
/** Sample values read to suggest a format. */
const SAMPLE_LIMIT = 1000;

/** strftime codes with an example (7 March 2024, 14:05:09), as Python and pandas read them. */
const STRFTIME_CODES: readonly [string, string, string][] = [
  ["%Y", "Year, four digits", "2024"],
  ["%y", "Year, two digits", "24"],
  ["%m", "Month, two digits", "03"],
  ["%b", "Month, short name", "Mar"],
  ["%B", "Month, full name", "March"],
  ["%d", "Day of the month, two digits", "07"],
  ["%a", "Weekday, short name", "Thu"],
  ["%A", "Weekday, full name", "Thursday"],
  ["%H", "Hour, 24-hour clock", "14"],
  ["%I", "Hour, 12-hour clock", "02"],
  ["%p", "AM or PM", "PM"],
  ["%M", "Minute", "05"],
  ["%S", "Second", "09"],
  ["%f", "Fraction of a second", "000000"],
  ["%z", "Offset from UTC", "+1100"],
  ["%%", "A literal % sign", "%"],
];
const STRFTIME_EXAMPLES: readonly [string, string][] = [
  ["%Y-%m-%d", "2024-03-07"],
  ["%d/%m/%Y", "07/03/2024"],
  ["%m/%d/%Y", "03/07/2024"],
  ["%d %b %Y", "07 Mar 2024"],
  ["%Y-%m-%d %H:%M:%S", "2024-03-07 14:05:09"],
  ["%d/%m/%Y %I:%M %p", "07/03/2024 02:05 PM"],
];

export function createDateFormatPicker(options: {
  samples: readonly string[];
  initial: DateOrder;
  withTime: boolean;
  onChange(): void;
  label?: string;
}): DateFormatPicker {
  let samples = options.samples.map((v) => v.trim()).filter((v) => v !== "").slice(0, SAMPLE_LIMIT);
  let withTime = options.withTime;
  const select = el("select", { class: "chart-select", "aria-label": "Date format" }) as HTMLSelectElement;
  const custom = el("input", {
    type: "text",
    class: "chart-select date-format-custom hidden",
    placeholder: "e.g. YYYY-MM or DD.MM.YYYY HH:mm or %Y-%m",
    "aria-label": "Custom date format",
    spellcheck: "false",
  }) as HTMLInputElement;
  custom.classList.remove("hidden");
  custom.placeholder = "%d/%m/%Y %H:%M  or  DD/MM/YYYY HH:mm";
  const help = el("div", { class: "date-format-help" }, [
    "Or YYYY year · YY · MM month · MMM Jan · MMMM January · DD day · Q quarter · HH hour 0-23 · hh 1-12 with A (AM/PM) · mm minutes · ss seconds · SSS fraction · Z offset · [text] literal. Missing parts start at 1: %Y-%m is the 1st of the month.",
  ]);
  const status = el("div", { class: "date-format-status", role: "status" });
  // The suggestion, said plainly before anything else.
  const suggestText = el("span", { class: "date-format-suggest-text" });
  const useSuggested = el("button", { type: "button", class: "ghost small" }, ["Use it"]) as HTMLButtonElement;
  const suggest = el("div", { class: "date-format-suggest" }, [suggestText, useSuggested]);
  let suggested = "dmy";
  // strftime codes: click one to put it in the custom format.
  const codesButton = el("button", { type: "button", class: "ghost small", "aria-expanded": "false" }, ["strftime codes ▾"]) as HTMLButtonElement;
  const codeRow = (code: string, meaning: string, example: string): HTMLElement => {
    const b = el("button", { type: "button", class: "date-code", title: `Insert ${code}` }, [el("code", {}, [code]), el("span", {}, [meaning]), el("small", {}, [example])]);
    b.addEventListener("click", () => {
      const at = custom.selectionStart ?? custom.value.length;
      custom.setRangeText(code, at, custom.selectionEnd ?? at, "end");
      custom.focus();
      onCustomInput();
    });
    return b;
  };
  const codes = el("div", { class: "date-codes hidden" }, [
    el("div", { class: "date-codes-grid" }, STRFTIME_CODES.map(([c, m, e]) => codeRow(c, m, e))),
    el("div", { class: "date-codes-title" }, ["Common formats (click to use)"]),
    el("div", { class: "date-codes-grid" }, STRFTIME_EXAMPLES.map(([f, e]) => {
      const b = el("button", { type: "button", class: "date-code", title: `Use ${f}` }, [el("code", {}, [f]), el("small", {}, [e])]);
      b.addEventListener("click", () => { custom.value = f; onCustomInput(); });
      return b;
    })),
    el("p", { class: "date-codes-credit" }, [
      "Examples for 7 March 2024, 14:05:09. Codes follow Python's strftime; the list is after BairesDev's strftime reference, ",
      el("a", { href: "https://www.bairesdev.com/tools/strftime/", target: "_blank", rel: "noopener noreferrer" }, ["bairesdev.com/tools/strftime"]),
      ".",
    ]),
  ]);
  codesButton.addEventListener("click", () => {
    const open = codes.classList.toggle("hidden") === false;
    codesButton.setAttribute("aria-expanded", String(open));
    codesButton.textContent = open ? "strftime codes ▴" : "strftime codes ▾";
  });
  const root = el("div", { class: "date-format-picker" }, [
    suggest,
    el("label", { class: "chart-setup-field" }, [el("span", { class: "chart-field-label" }, [options.label ?? "Date format"]), select]),
    el("label", { class: "chart-setup-field" }, [el("span", { class: "chart-field-label" }, ["Or your own format"]), custom]),
    el("div", { class: "date-format-tools" }, [codesButton]),
    codes,
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
    help.classList.toggle("hidden", !isCustom);
    status.classList.remove("error");
    renderSuggestion();
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

  /** "Suggested: %d/%m/%Y (07/03/2024) · reads 998 of 1,000 sample values", from the best fit. */
  function renderSuggestion(): void {
    if (samples.length === 0) { suggest.classList.add("hidden"); return; }
    suggest.classList.remove("hidden");
    const best = rankFormats(samples, DATE_FORMAT_PRESETS.filter((p) => withTime || !p.time))[0];
    const dmy = autoReads("dmy"), mdy = autoReads("mdy");
    const n = samples.length.toLocaleString();
    if (best !== undefined && best.hits >= Math.max(dmy, mdy)) {
      suggested = `fmt:${best.preset.format}`;
      const strf = toStrftimeLabel(best.preset.format);
      suggestText.replaceChildren("Suggested format: ", el("b", {}, [strf]), ` (e.g. ${best.preset.example}) · reads ${best.hits.toLocaleString()} of ${n} sample values`);
    } else {
      suggested = dmy >= mdy ? "dmy" : "mdy";
      suggestText.replaceChildren("Suggested: ", el("b", {}, [dmy >= mdy ? "day first (DD/MM/YYYY)" : "month first (MM/DD/YYYY)"]), ` · reads ${Math.max(dmy, mdy).toLocaleString()} of ${n} sample values`);
    }
    const current = select.value === CUSTOM ? `fmt:${custom.value.trim()}` : select.value;
    useSuggested.disabled = current === suggested;
    useSuggested.textContent = current === suggested ? "In use" : "Use it";
  }
  useSuggested.addEventListener("click", () => { build(suggested); options.onChange(); });

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
  // Typing a format switches to it.
  function onCustomInput(): void {
    if (custom.value.trim() !== "") select.value = CUSTOM;
    sync();
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => options.onChange(), 250);
  }
  custom.addEventListener("input", onCustomInput);

  return {
    root,
    value,
    set(order) {
      build(order);
    },
    setSamples(values) {
      samples = values.map((v) => v.trim()).filter((v) => v !== "").slice(0, SAMPLE_LIMIT);
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

/** A format shown the strftime way (%d/%m/%Y) when it has one, else as it is. */
function toStrftimeLabel(format: string): string {
  return toStrftime(format) ?? format;
}
