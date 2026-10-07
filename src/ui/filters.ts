import { clear, el } from "./dom.js";
import { RangeSlider } from "./range-slider.js";
import { COLUMN_TYPES, TYPE_LABELS, type ColumnType, type TextMode } from "../types.js";
import { parseDate, toDateInputValue } from "../parse/dates.js";
import { parseNumber, type NumberLocale } from "../parse/numbers.js";
import {
  describeSuggestion,
  suggestionLabel,
  type ColumnSuggestion,
} from "../data/suggestions.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { ColumnMeta } from "../worker/protocol.js";

export interface FilterPanelCallbacks {
  onFilter: (column: number, filter: ColumnFilter | null, preview?: boolean) => void;
  onTypeChange: (column: number, type: ColumnType) => void;
  onNumberLocale: (column: number, locale: NumberLocale) => void;
  onSuggestion: (column: number, suggestion: ColumnSuggestion) => void;
}

const TEXT_MODES: { value: TextMode; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "exact", label: "Exact" },
  { value: "fuzzy", label: "Fuzzy" },
  { value: "phonetic", label: "Sounds like" },
];

export class FilterPanel {
  private readonly listEl: HTMLElement;
  private cards: HTMLElement[] = [];
  private statusEls: HTMLElement[] = [];
  private countEls: HTMLElement[][] = [];
  private sliders: (RangeSlider | null)[] = [];
  private readonly expanded = new Set<number>();

  constructor(
    root: HTMLElement,
    private metas: ColumnMeta[],
    private readonly filters: Map<number, ColumnFilter>,
    private readonly callbacks: FilterPanelCallbacks,
  ) {
    this.listEl = el("div", { class: "filter-list" });
    root.append(this.listEl);
    this.rebuild();
  }

  rebuild(): void {
    clear(this.listEl);
    this.cards = [];
    this.statusEls = [];
    this.countEls = [];
    this.sliders = [];
    this.metas.forEach((meta, index) => {
      const card = this.buildCard(meta, index);
      this.listEl.append(card);
      this.cards.push(card);
    });
  }

  updateMeta(index: number, meta: ColumnMeta): void {
    this.metas[index] = meta;
    this.rebuildCard(index);
  }

  setStatus(index: number, text: string): void {
    this.statusEls[index].textContent = text;
  }

  focusColumn(index: number): void {
    if (!this.expanded.has(index)) {
      this.expanded.add(index);
      this.rebuildCard(index);
    }
    const card = this.cards[index];
    if (card === undefined) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("flash");
    window.setTimeout(() => card.classList.remove("flash"), 1200);
  }

  /** Hides cards whose column name does not match the sidebar search. */
  search(query: string): void {
    const needle = query.trim().toLowerCase();
    this.cards.forEach((card, index) => {
      const name = this.metas[index]?.name.toLowerCase() ?? "";
      card.classList.toggle("hidden", needle !== "" && !name.includes(needle));
    });
  }

  /**
   * Updates live faceted counts. Values with zero matches under the other
   * active filters are dimmed but stay visible and clickable.
   */
  applyResults(facets: Record<number, number[]>, histograms: Record<number, number[]>): void {
    for (const key of Object.keys(facets)) {
      const column = Number(key);
      const els = this.countEls[column];
      if (els === undefined) continue;
      const counts = facets[column];
      for (let i = 0; i < els.length && i < counts.length; i++) {
        els[i].textContent = counts[i].toLocaleString();
        els[i].closest(".value-row")?.classList.toggle("zero", counts[i] === 0);
      }
    }

    this.metas.forEach((meta, column) => {
      const slider = this.sliders[column];
      if (slider === null || slider === undefined || meta.histogram === null) return;
      slider.setBounds(meta.histogram.min, meta.histogram.max);
      slider.setBins(histograms[column] ?? meta.histogram.bins);
      const filter = this.filters.get(column);
      const min = filter?.kind === "range" ? filter.min : null;
      const max = filter?.kind === "range" ? filter.max : null;
      slider.setRange(min, max);
    });
  }

  clearStatuses(): void {
    for (const status of this.statusEls) status.textContent = "";
  }

  private rebuildCard(index: number): void {
    const next = this.buildCard(this.metas[index], index);
    this.cards[index].replaceWith(next);
    this.cards[index] = next;
  }

  private buildCard(meta: ColumnMeta, index: number): HTMLElement {
    const card = el("div", { class: "filter-card", "data-column": String(index) });
    if (this.filters.has(index)) card.classList.add("active");
    if (!this.expanded.has(index)) card.classList.add("collapsed");

    const head = el("div", { class: "filter-head" });
    const caret = el(
      "button",
      {
        class: "icon-btn filter-caret",
        type: "button",
        title: "Expand or collapse this filter",
      },
      [this.expanded.has(index) ? "▾" : "▸"],
    );
    caret.addEventListener("click", () => {
      if (this.expanded.has(index)) this.expanded.delete(index);
      else this.expanded.add(index);
      card.classList.toggle("collapsed", !this.expanded.has(index));
      caret.textContent = this.expanded.has(index) ? "▾" : "▸";
    });
    head.append(caret, el("span", { class: "filter-name", title: meta.name }, [meta.name]));

    const typeSelect = el("select", {
      class: "type-select",
      title: "Data type — change to re-interpret this column",
      "aria-label": `Data type for ${meta.name}`,
    }) as HTMLSelectElement;
    for (const type of COLUMN_TYPES) {
      const option = el("option", { value: type }, [TYPE_LABELS[type]]) as HTMLOptionElement;
      if (type === meta.type) option.selected = true;
      typeSelect.append(option);
    }
    typeSelect.addEventListener("change", () => {
      this.callbacks.onTypeChange(index, typeSelect.value as ColumnType);
    });
    head.append(typeSelect);

    if (meta.type === "integer" || meta.type === "number") {
      const nextLocale: NumberLocale = meta.numberLocale === "comma" ? "dot" : "comma";
      const localeButton = el(
        "button",
        {
          class: "locale-btn",
          type: "button",
          title: "Number format — click to switch between 1,234.56 and 1.234,56",
        },
        [meta.numberLocale === "comma" ? "1.234,56" : "1,234.56"],
      );
      localeButton.addEventListener("click", () => {
        this.callbacks.onNumberLocale(index, nextLocale);
      });
      head.append(localeButton);
    }

    const clearButton = el(
      "button",
      { class: "icon-btn", type: "button", title: "Clear this filter" },
      ["×"],
    );
    clearButton.addEventListener("click", () => {
      this.callbacks.onFilter(index, null);
      this.rebuildCard(index);
    });
    head.append(clearButton);

    const status = el("span", { class: "filter-status" });
    this.statusEls[index] = status;

    card.append(head);
    const suggestions = this.buildSuggestions(meta, index);
    if (suggestions !== null) card.append(suggestions);
    card.append(this.buildBody(meta, index), this.buildStats(meta), status);
    return card;
  }

  private buildSuggestions(meta: ColumnMeta, index: number): HTMLElement | null {
    if (meta.suggestions.length === 0) return null;
    const row = el("div", { class: "suggestion-row" });
    for (const suggestion of meta.suggestions) {
      const chip = el(
        "button",
        {
          class: "suggestion-chip",
          type: "button",
          title: describeSuggestion(suggestion),
        },
        [suggestionLabel(suggestion)],
      );
      chip.addEventListener("click", () => this.callbacks.onSuggestion(index, suggestion));
      row.append(chip);
    }
    return row;
  }

  private buildBody(meta: ColumnMeta, index: number): HTMLElement {
    switch (meta.type) {
      case "category":
      case "boolean":
        if (meta.categories !== null) return this.buildValuesBody(meta, index);
        return this.buildTextBody(meta, index);
      case "integer":
      case "number":
      case "date":
        return this.buildRangeBody(meta, index);
      default:
        return this.buildTextBody(meta, index);
    }
  }

  private buildTextBody(meta: ColumnMeta, index: number): HTMLElement {
    const body = el("div", { class: "filter-body" });
    const state = this.filters.get(index);
    const current = state?.kind === "text" ? state : null;

    const modeSelect = el("select", {
      class: "mode-select",
      title: "Match mode",
      "aria-label": `Match mode for ${meta.name}`,
    }) as HTMLSelectElement;
    const defaultMode: TextMode = meta.type === "identifier" ? "exact" : "contains";
    for (const mode of TEXT_MODES) {
      const option = el("option", { value: mode.value }, [mode.label]) as HTMLOptionElement;
      if (mode.value === (current?.mode ?? defaultMode)) option.selected = true;
      modeSelect.append(option);
    }

    const input = el("input", {
      class: "text-input",
      type: "text",
      placeholder: "Filter…",
      spellcheck: "false",
      "aria-label": `Filter ${meta.name}`,
    }) as HTMLInputElement;
    input.value = current?.query ?? "";

    const apply = (): void => {
      const query = input.value;
      this.callbacks.onFilter(
        index,
        query.trim() === "" ? null : { kind: "text", mode: modeSelect.value as TextMode, query },
      );
      cardActive(body, this.filters.has(index));
    };

    input.addEventListener("input", apply);
    modeSelect.addEventListener("change", () => {
      apply();
    });

    body.append(modeSelect, input);
    return body;
  }

  private buildRangeBody(meta: ColumnMeta, index: number): HTMLElement {
    const body = el("div", { class: "filter-body range-body" });
    const state = this.filters.get(index);
    const current = state?.kind === "range" ? state : null;
    const isDate = meta.type === "date";
    const inputType = isDate ? "date" : "number";

    const step = isDate ? undefined : meta.type === "integer" ? "1" : "any";
    const minInput = el("input", {
      class: "range-input",
      type: inputType,
      placeholder: "Min",
      ...(step === undefined ? {} : { step }),
    }) as HTMLInputElement;
    const maxInput = el("input", {
      class: "range-input",
      type: inputType,
      placeholder: "Max",
      ...(step === undefined ? {} : { step }),
    }) as HTMLInputElement;

    if (current?.min !== null && current?.min !== undefined) {
      minInput.value = isDate ? toDateInputValue(current.min) : String(current.min);
    }
    if (current?.max !== null && current?.max !== undefined) {
      maxInput.value = isDate ? toDateInputValue(current.max) : String(current.max);
    }

    const emit = (preview: boolean): void => {
      const min = this.readRangeValue(minInput.value, isDate, meta.numberLocale);
      const max = this.readRangeValue(maxInput.value, isDate, meta.numberLocale);
      this.callbacks.onFilter(
        index,
        min === null && max === null ? null : { kind: "range", min, max },
        preview,
      );
      cardActive(body, this.filters.has(index));
    };

    const syncInputs = (min: number | null, max: number | null): void => {
      minInput.value = min === null ? "" : isDate ? toDateInputValue(min) : String(min);
      maxInput.value = max === null ? "" : isDate ? toDateInputValue(max) : String(max);
    };

    let slider: RangeSlider | null = null;
    if (meta.histogram !== null) {
      slider = new RangeSlider({
        binCount: meta.histogram.bins.length,
        integer: meta.type === "integer",
        isDate,
        onInput: (min, max, preview) => {
          syncInputs(min, max);
          this.callbacks.onFilter(
            index,
            min === null && max === null ? null : { kind: "range", min, max },
            preview,
          );
          cardActive(body, this.filters.has(index));
        },
      });
      slider.setBounds(meta.histogram.min, meta.histogram.max);
      slider.setBins(meta.histogram.bins);
      slider.setRange(current?.min ?? null, current?.max ?? null);
      this.sliders[index] = slider;
    } else {
      this.sliders[index] = null;
    }

    const syncSlider = (): void => {
      slider?.setRange(
        this.readRangeValue(minInput.value, isDate, meta.numberLocale),
        this.readRangeValue(maxInput.value, isDate, meta.numberLocale),
      );
    };
    minInput.addEventListener("input", () => {
      syncSlider();
      emit(true);
    });
    maxInput.addEventListener("input", () => {
      syncSlider();
      emit(true);
    });
    minInput.addEventListener("change", () => emit(false));
    maxInput.addEventListener("change", () => emit(false));

    const inputs = el("div", { class: "range-inputs" }, [
      minInput,
      el("span", { class: "range-sep" }, ["–"]),
      maxInput,
    ]);
    body.append(inputs);
    if (slider !== null) body.append(slider.el);

    return body;
  }

  private buildValuesBody(meta: ColumnMeta, index: number): HTMLElement {
    const body = el("div", { class: "filter-body values-body" });
    const categories = meta.categories;
    if (categories === null) return body;

    const state = this.filters.get(index);
    const selected = new Set<number>(
      state?.kind === "values" ? state.selected : categories.labels.map((_, i) => i),
    );

    const list = el("div", { class: "value-list" });

    if (categories.labels.length > 15) {
      const search = el("input", {
        class: "text-input value-search",
        type: "text",
        placeholder: "Find value…",
        spellcheck: "false",
        "aria-label": `Find a value in ${meta.name}`,
      }) as HTMLInputElement;
      search.addEventListener("input", () => {
        const needle = search.value.toLowerCase();
        for (const child of list.children) {
          const row = child as HTMLElement;
          row.hidden = needle !== "" && !(row.dataset.label ?? "").toLowerCase().includes(needle);
        }
      });
      body.append(search);
    }

    const apply = (): void => {
      this.callbacks.onFilter(
        index,
        selected.size === categories.labels.length
          ? null
          : { kind: "values", selected: [...selected] },
      );
      cardActive(body, this.filters.has(index));
    };

    const countEls: HTMLElement[] = [];
    categories.labels.forEach((label, id) => {
      const row = el("label", { class: "value-row" }) as HTMLLabelElement;
      row.dataset.label = label;
      const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
      checkbox.checked = selected.has(id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(id);
        else selected.delete(id);
        apply();
      });
      const countEl = el("span", { class: "value-count" }, [categories.counts[id].toLocaleString()]);
      countEls.push(countEl);
      row.append(
        checkbox,
        el("span", { class: "value-label", title: label }, [label]),
        countEl,
      );
      list.append(row);
    });
    this.countEls[index] = countEls;

    const actions = el("div", { class: "value-actions" });
    const allButton = el("button", { class: "link", type: "button" }, ["All"]);
    allButton.addEventListener("click", () => {
      selected.clear();
      for (let i = 0; i < categories.labels.length; i++) selected.add(i);
      apply();
      this.rebuildCard(index);
    });
    const noneButton = el("button", { class: "link", type: "button" }, ["None"]);
    noneButton.addEventListener("click", () => {
      selected.clear();
      apply();
      this.rebuildCard(index);
    });
    actions.append(allButton, noneButton);

    body.append(list, actions);
    return body;
  }

  private buildStats(meta: ColumnMeta): HTMLElement {
    const stats = el("div", { class: "filter-stats" });
    const parts = [`${meta.stats.distinct.toLocaleString()} distinct`];
    if (meta.stats.nulls > 0) parts.push(`${meta.stats.nulls.toLocaleString()} empty`);

    const numeric =
      meta.type === "integer" || meta.type === "number" || meta.type === "date";
    if (numeric && meta.stats.min !== null && meta.stats.max !== null) {
      const format = (value: number): string =>
        meta.type === "date" ? toDateInputValue(value) : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
      parts.push(`${format(meta.stats.min)} … ${format(meta.stats.max)}`);
    } else if (meta.stats.avgLength !== null) {
      parts.push(`len avg ${meta.stats.avgLength.toFixed(1)}`);
    }

    stats.textContent = parts.join(" · ");
    return stats;
  }

  private readRangeValue(
    value: string,
    isDate: boolean,
    locale: NumberLocale = "dot",
  ): number | null {
    if (value.trim() === "") return null;
    const parsed = isDate ? parseDate(value) : parseNumber(value, locale);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

function cardActive(from: HTMLElement, active: boolean): void {
  from.closest(".filter-card")?.classList.toggle("active", active);
}
