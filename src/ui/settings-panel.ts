import { HOLIDAY_REGIONS, suggestRegion } from "../data/timeseries/holidays.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import { browserSuggestions, readSettings, updateSettings, type AppSettings } from "./settings.js";

interface Field {
  key: keyof AppSettings;
  title: string;
  usedBy: string;
  unsetNote: string;
  options: readonly (readonly [string, string])[];
  /** What the browser's locale points to, for a suggestion (never applied without a click). */
  suggest: (s: { dateOrder: string; weekStart: string; region: string }) => string;
}

const FIELDS: readonly Field[] = [
  {
    key: "dateOrder",
    title: "Date order for ambiguous dates",
    usedBy: "Reading a date such as 01/02/2025, where the day and month could be either way round. A date such as 14/03/2025 can only be day-first, so the data decides those. Applies to files you load after changing it.",
    unsetNote: "Not set: an ambiguous column is read day-first and the Overview says so and asks.",
    options: [["dmy", "Day first (31/12/2025)"], ["mdy", "Month first (12/31/2025)"]],
    suggest: (s) => s.dateOrder,
  },
  {
    key: "weekStart",
    title: "First day of the week",
    usedBy: "Weekly periods made from daily rows on the Time Series page. Rows already stamped on one weekday keep the weeks they imply.",
    unsetNote: "Not set: weeks start on Monday unless the rows say otherwise.",
    options: [["mon", "Monday"], ["sun", "Sunday"], ["sat", "Saturday"]],
    suggest: (s) => s.weekStart,
  },
  {
    key: "holidays",
    title: "Public-holiday calendar",
    usedBy: "The Public holiday column on the Time Series page: a driver the forecast knows the future of, and the explanation for an unusual day that falls on a holiday.",
    unsetNote: "Not set: no holidays are used.",
    options: HOLIDAY_REGIONS.map((r) => [r.code, r.label] as const),
    suggest: (s) => s.region,
  },
];

export interface SettingsPanelOptions {
  /** A setting was changed (after it is saved). */
  onChange?(key: keyof AppSettings, settings: AppSettings): void;
}

/**
 * Global settings: every regional or business convention in one place. Each starts unset, shows what uses it, and offers the
 * browser's own locale as a suggestion that a click applies. The app assumes nothing it is not told, or cannot read from the data.
 */
export function openSettingsPanel(options: SettingsPanelOptions = {}): void {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal settings-modal" });
  const head = el("div", { class: "modal-head" });
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(el("h2", {}, ["Settings"]), closeButton);
  modal.append(head);

  const body = el("div", { class: "chart-setup-body settings-body" });
  body.append(el("p", { class: "confirm-body" }, ["The app assumes nothing about where you are. Each convention below starts unset and says what uses it. Where your data settles a question itself, the data wins."]));
  const language = typeof navigator === "undefined" ? "" : navigator.language ?? "";
  const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { return ""; } })();
  const hint = browserSuggestions(language, zone);
  const suggestions = { dateOrder: hint.dateOrder, weekStart: hint.weekStart, region: suggestRegion(language, zone) };

  const rows: { sync(): void }[] = [];
  for (const field of FIELDS) {
    const select = el("select", { class: "chart-select", "aria-label": field.title, id: `setting-${field.key}` }) as HTMLSelectElement;
    select.append(el("option", { value: "" }, ["Not set"]) as HTMLOptionElement);
    for (const [value, label] of field.options) select.append(el("option", { value }, [label]) as HTMLOptionElement);
    const note = el("div", { class: "settings-note" });
    const suggestion = el("div", { class: "settings-suggest" });
    const label = (value: string): string => field.options.find(([v]) => v === value)?.[1] ?? value;
    const sync = (): void => {
      const current = readSettings()[field.key];
      select.value = current;
      note.textContent = current === "" ? field.unsetNote : "";
      suggestion.replaceChildren();
      const guess = field.suggest(suggestions);
      if (current === "" && guess !== "" && field.options.some(([v]) => v === guess)) {
        const use = el("button", { class: "ghost small", type: "button" }, [`Use ${label(guess)}`]);
        use.addEventListener("click", () => apply(guess));
        suggestion.append(el("span", {}, [`Your browser suggests ${label(guess)}. `]), use);
      }
    };
    const apply = (value: string): void => {
      const next = updateSettings({ [field.key]: value } as Partial<AppSettings>);
      sync();
      options.onChange?.(field.key, next);
    };
    select.addEventListener("change", () => apply(select.value));
    rows.push({ sync });
    body.append(
      el("div", { class: "settings-row" }, [
        el("label", { class: "settings-title", for: `setting-${field.key}` }, [field.title]),
        select,
        el("p", { class: "settings-used" }, [el("b", {}, ["Used by: "]), field.usedBy]),
        note,
        suggestion,
      ]),
    );
  }
  for (const r of rows) r.sync();
  modal.append(body);

  const footer = el("div", { class: "clean-footer" });
  const done = el("button", { class: "primary", type: "button" }, ["Done"]);
  footer.append(el("span", { class: "grow" }), done);
  modal.append(footer);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  closeButton.addEventListener("click", close);
  done.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  overlay.append(modal);
  document.body.append(overlay);
  setupDialog(overlay, "Settings");
}
