import { clear, el } from "./dom.js";
import { RangeSlider } from "./range-slider.js";
import { isNumericLikeType, isTemporalType, type TextMode } from "../types.js";
import {
  formatDurationMs,
  fromDateTimeInputValue,
  parseDate,
  parseDuration,
  parseTimeOfDay,
  toDateInputValue,
  toDateTimeInputValue,
  toTimeInputValue,
} from "../parse/dates.js";
import { parseNumber, type NumberLocale } from "../parse/numbers.js";
import {
  describeSuggestion,
  suggestionLabel,
  type ColumnSuggestion,
} from "../data/suggestions.js";
import type { ColumnFilter } from "../search/query-engine.js";
import { chipText } from "./chips.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { fuzzyScore } from "../search/fuzzy-match.js";

export interface FilterPanelCallbacks {
  onFilter: (column: number, filter: ColumnFilter | null, preview?: boolean) => void;
  /** Text filters opened from a header default to Contains. */
  defaultTextMode?: TextMode;
  onSuggestion: (column: number, suggestion: ColumnSuggestion) => void;
  /** The column's values that best fit what was typed (a few letters or a small typo is enough). */
  requestSuggestions?: (column: number, query: string) => Promise<{ label: string; count: number }[]>;
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

  /**
   * Narrows the cards to columns that fit what was typed (see fuzzy-match.ts: a few
   * letters, initials or a small typo are enough) with the best match first; an empty
   * search puts every card back in column order.
   */
  search(query: string): void {
    const scores = this.cards.map((_, index) => fuzzyScore(query, this.metas[index]?.name ?? ""));
    const order = this.cards.map((_, index) => index);
    order.sort((a, b) => (scores[b] ?? -1) - (scores[a] ?? -1) || a - b);
    for (const index of order) {
      const card = this.cards[index];
      if (card === undefined) continue;
      card.classList.toggle("hidden", scores[index] === null);
      this.listEl.append(card);
    }
    // One column left: open it, so typing a column name goes straight to its filter.
    const fits = order.filter((index) => scores[index] !== null);
    const only = fits[0];
    if (fits.length === 1 && only !== undefined && query.trim() !== "" && !this.expanded.has(only)) {
      this.expanded.add(only);
      const card = this.cards[only];
      card?.classList.remove("collapsed");
      const caret = card?.querySelector(".filter-caret");
      if (caret) caret.textContent = "▾";
    }
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

    const clearButton = el(
      "button",
      { class: "icon-btn", type: "button", title: "Clear this filter" },
      ["×"],
    );
    // The × is a filter action, not a column action: only show it while the
    // column actually has a filter, so the list is search + names by default.
    clearButton.classList.toggle("hidden", !this.filters.has(index));
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
        [chipText("fix", suggestionLabel(suggestion))],
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
      case "datetime":
      case "time":
      case "duration":
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
    const defaultMode: TextMode =
      this.callbacks.defaultTextMode ?? (meta.type === "identifier" ? "exact" : "contains");
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

    // Suggestions as you type: the column's own values that best fit, so a few letters or a
    // small typo finds the one meant. Picking one filters to exactly that value.
    const suggest = el("div", { class: "filter-suggest hidden", role: "listbox", "aria-label": `Suggested values for ${meta.name}` });
    let seq = 0;
    let active = -1;
    const options = (): HTMLElement[] => Array.from(suggest.children) as HTMLElement[];
    const highlight = (next: number): void => {
      const all = options();
      active = all.length === 0 ? -1 : (next + all.length) % all.length;
      all.forEach((option, i) => {
        option.classList.toggle("active", i === active);
        option.setAttribute("aria-selected", String(i === active));
      });
    };
    const hideSuggestions = (): void => {
      seq++;
      suggest.classList.add("hidden");
      active = -1;
    };
    const pick = (label: string): void => {
      input.value = label;
      modeSelect.value = "exact";
      hideSuggestions();
      apply();
    };
    const showSuggestions = (): void => {
      const query = input.value.trim();
      const request = this.callbacks.requestSuggestions;
      if (request === undefined || query === "") {
        hideSuggestions();
        return;
      }
      const mine = ++seq;
      void request(index, query)
        .then((values) => {
          if (mine !== seq) return;
          const same = values.length === 1 && values[0]!.label.toLowerCase() === query.toLowerCase();
          suggest.replaceChildren(
            ...values.map((value) => {
              const option = el("button", { class: "filter-suggest-item", type: "button", role: "option", tabindex: "-1" }, [
                el("span", { class: "filter-suggest-label", title: value.label }, [value.label]),
                el("span", { class: "filter-suggest-count" }, [value.count.toLocaleString()]),
              ]);
              // mousedown, so the pick lands before the input loses focus.
              option.addEventListener("mousedown", (event) => {
                event.preventDefault();
                pick(value.label);
              });
              return option;
            }),
          );
          suggest.classList.toggle("hidden", values.length === 0 || same);
          active = -1;
        })
        .catch(() => undefined);
    };

    input.addEventListener("input", () => {
      apply();
      showSuggestions();
    });
    input.addEventListener("focus", () => {
      if (input.value.trim() !== "") showSuggestions();
    });
    input.addEventListener("blur", () => window.setTimeout(hideSuggestions, 120));
    input.addEventListener("keydown", (event) => {
      if (suggest.classList.contains("hidden")) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        highlight(active + (event.key === "ArrowDown" ? 1 : active < 0 ? -1 : -1));
      } else if (event.key === "Enter" && active >= 0) {
        event.preventDefault();
        pick(options()[active]?.querySelector(".filter-suggest-label")?.textContent ?? input.value);
      } else if (event.key === "Escape") {
        hideSuggestions();
      }
    });
    modeSelect.addEventListener("change", () => {
      apply();
    });

    body.append(modeSelect, input, suggest);
    return body;
  }

  private buildRangeBody(meta: ColumnMeta, index: number): HTMLElement {
    const body = el("div", { class: "filter-body range-body" });
    const state = this.filters.get(index);
    const dateLike = meta.type === "date" || meta.type === "datetime";
    const modes = dateLike
      ? [
          ["between", "Between"],
          ["on", "On"],
          ["before", "Before"],
          ["onOrBefore", "On or before"],
          ["after", "After"],
          ["onOrAfter", "On or after"],
          ["blank", "Is blank"],
          ["notBlank", "Is not blank"],
        ]
      : [
          ["between", "Between"],
          ["eq", "Equals"],
          ["ne", "Does not equal"],
          ["gt", "Greater than"],
          ["gte", "Greater than or equal"],
          ["lt", "Less than"],
          ["lte", "Less than or equal"],
          ["aboveAvg", "Above average"],
          ["belowAvg", "Below average"],
          ["blank", "Is blank"],
          ["notBlank", "Is not blank"],
        ];
    const dateToCompare: Record<string, "eq" | "lt" | "lte" | "gt" | "gte"> = {
      on: "eq",
      before: "lt",
      onOrBefore: "lte",
      after: "gt",
      onOrAfter: "gte",
    };
    const compareToDate: Record<string, string> = {
      eq: "on",
      lt: "before",
      lte: "onOrBefore",
      gt: "after",
      gte: "onOrAfter",
    };
    let currentMode = "between";
    if (state?.kind === "compare") {
      currentMode = dateLike ? (compareToDate[state.op] ?? state.op) : state.op;
    } else if (state?.kind === "blank") {
      currentMode = state.negate ? "notBlank" : "blank";
    }
    const modeSelect = el("select", {
      class: "mode-select range-mode",
      title: "Filter operator",
      "aria-label": `Filter operator for ${meta.name}`,
    }) as HTMLSelectElement;
    for (const [value, label] of modes) {
      const option = el("option", { value }, [label]) as HTMLOptionElement;
      if (value === currentMode) option.selected = true;
      modeSelect.append(option);
    }
    const inputType =
      meta.type === "date"
        ? "date"
        : meta.type === "datetime"
          ? "datetime-local"
          : meta.type === "time"
            ? "time"
            : meta.type === "duration"
              ? "text"
              : "number";
    const step =
      meta.type === "integer"
        ? "1"
        : meta.type === "number"
          ? "any"
          : meta.type === "duration"
            ? undefined
            : "any";
    const minInput = el("input", {
      class: "range-input",
      type: inputType,
      placeholder:
        meta.type === "duration" ? "H:MM:SS" : dateLike ? "Earliest" : "Min",
      ...(step === undefined ? {} : { step }),
    }) as HTMLInputElement;
    const maxInput = el("input", {
      class: "range-input",
      type: inputType,
      placeholder:
        meta.type === "duration" ? "H:MM:SS" : dateLike ? "Latest" : "Max",
      ...(step === undefined ? {} : { step }),
    }) as HTMLInputElement;
    if (state?.kind === "range") {
      if (state.min !== null) minInput.value = this.formatRangeValue(state.min, meta);
      if (state.max !== null) maxInput.value = this.formatRangeValue(state.max, meta);
    } else if (state?.kind === "compare" && state.value !== undefined) {
      minInput.value = this.formatRangeValue(state.value, meta);
    }
    const dateMin =
      dateLike && meta.stats.min !== null ? this.formatRangeValue(meta.stats.min, meta) : "";
    const dateMax =
      dateLike && meta.stats.max !== null ? this.formatRangeValue(meta.stats.max, meta) : "";
    if (dateLike) {
      if (dateMin !== "") {
        minInput.min = dateMin;
        maxInput.min = dateMin;
      }
      if (dateMax !== "") {
        minInput.max = dateMax;
        maxInput.max = dateMax;
      }
      const anchorDate = (forMax: boolean): void => {
        if (minInput.value !== "" || maxInput.value !== "") return;
        const mode = modeSelect.value;
        if (mode === "between") {
          minInput.value = dateMin;
          maxInput.value = dateMax;
        } else if (["on", "before", "onOrBefore"].includes(mode)) {
          minInput.value = dateMax;
        } else if (mode !== "blank" && mode !== "notBlank") {
          minInput.value = forMax ? dateMax : dateMin;
        }
      };
      minInput.addEventListener("focus", () => anchorDate(false));
      maxInput.addEventListener("focus", () => {
        if (maxInput.value === "" && modeSelect.value === "between") maxInput.value = dateMax;
      });
    }
    const emit = (preview: boolean): void => {
      const mode = modeSelect.value;
      let filter: ColumnFilter | null = null;
      if (mode === "blank" || mode === "notBlank") {
        filter = { kind: "blank", negate: mode === "notBlank" };
      } else if (mode === "aboveAvg" || mode === "belowAvg") {
        filter = { kind: "compare", op: mode };
      } else if (mode === "between") {
        const min = this.readRangeValue(minInput.value, meta);
        const max = this.readRangeValue(maxInput.value, meta);
        filter = min === null && max === null ? null : { kind: "range", min, max };
      } else {
        const value = this.readRangeValue(minInput.value, meta);
        if (value !== null) {
          filter = {
            kind: "compare",
            op: (dateLike ? dateToCompare[mode] : mode) as
              | "eq"
              | "ne"
              | "gt"
              | "gte"
              | "lt"
              | "lte",
            value,
          };
        }
      }
      this.callbacks.onFilter(index, filter, preview);
      cardActive(body, this.filters.has(index));
    };
    const syncInputs = (min: number | null, max: number | null): void => {
      minInput.value = min === null ? "" : this.formatRangeValue(min, meta);
      maxInput.value = max === null ? "" : this.formatRangeValue(max, meta);
    };

    let slider: RangeSlider | null = null;
    if (meta.histogram !== null) {
      slider = new RangeSlider({
        binCount: meta.histogram.bins.length,
        integer: meta.type === "integer",
        isDate: meta.type === "date",
        snapMs:
          meta.type === "datetime" ? 3_600_000 : meta.type === "time" ? 60_000 : undefined,
        symlog: meta.histogram.symlog,
        onInput: (min, max, preview) => {
          if (modeSelect.value !== "between") return;
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
      slider.setRange(
        state?.kind === "range" ? state.min : null,
        state?.kind === "range" ? state.max : null,
      );
      this.sliders[index] = slider;
    } else {
      this.sliders[index] = null;
    }

    const syncSlider = (): void => {
      slider?.setRange(
        this.readRangeValue(minInput.value, meta),
        this.readRangeValue(maxInput.value, meta),
      );
    };
    const updateMode = (): void => {
      const mode = modeSelect.value;
      const between = mode === "between";
      const needsValue = !between && mode !== "aboveAvg" && mode !== "belowAvg" && mode !== "blank" && mode !== "notBlank";
      minInput.hidden = !between && !needsValue;
      minInput.placeholder = between ? (meta.type === "duration" ? "H:MM:SS" : "Min") : "Value";
      maxInput.hidden = !between;
      separator.hidden = !between;
      if (slider !== null) slider.el.classList.toggle("hidden", !between);
      if (!needsValue) emit(false);
      else if (minInput.value.trim() !== "") emit(false);
      else this.callbacks.onFilter(index, null);
    };
    const separator = el("span", { class: "range-sep" }, ["-"]);
    minInput.addEventListener("input", () => {
      if (modeSelect.value === "between") syncSlider();
      emit(true);
    });
    maxInput.addEventListener("input", () => {
      if (modeSelect.value === "between") syncSlider();
      emit(true);
    });
    minInput.addEventListener("change", () => emit(false));
    maxInput.addEventListener("change", () => emit(false));
    modeSelect.addEventListener("change", updateMode);

    const inputs = el("div", { class: "range-inputs" }, [minInput, separator, maxInput]);
    body.append(modeSelect, inputs);
    if (slider !== null) body.append(slider.el);
    if (meta.histogram !== null) {
      const outside = meta.histogram.below + meta.histogram.above;
      if (outside > 0) {
        body.append(
          el(
            "div",
            {
              class: "hist-note",
              title:
                "The chart covers p1-p99 so the shape stays readable; the excluded values are still filterable by typing bounds.",
            },
            [`${outside.toLocaleString()} values beyond the p1-p99 chart range`],
          ),
        );
      }
    }
    updateMode();
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
      // Fuzzy: a few letters or a small typo finds the value; best matches come first and
      // clearing the box restores the original order.
      search.addEventListener("input", () => {
        const rows = (Array.from(list.children) as HTMLElement[]).map((row) => ({
          row,
          id: Number(row.dataset.i),
          score: fuzzyScore(search.value, row.dataset.label ?? ""),
        }));
        rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id - b.id);
        for (const { row, score } of rows) {
          row.hidden = score === null;
          list.append(row);
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
      row.dataset.i = String(id);
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

    const numeric = isNumericLikeType(meta.type);
    if (numeric && meta.stats.min !== null && meta.stats.max !== null) {
      const format = (value: number): string => this.formatRangeValue(value, meta);
      parts.push(`${format(meta.stats.min)} … ${format(meta.stats.max)}`);
      // The fence centre is the column median: show it beside mean on the
      // profile card so skewed columns are not read from the mean alone.
      if (meta.valueFence !== null && !isTemporalType(meta.type)) {
        parts.push(`median ${format(meta.valueFence.center)}`);
      }
    } else if (meta.stats.avgLength !== null) {
      parts.push(`len avg ${meta.stats.avgLength.toFixed(1)}`);
    }

    stats.textContent = parts.join(" · ");
    return stats;
  }

  /** Input-friendly text for a bound value of the column's type. */
  private formatRangeValue(value: number, meta: ColumnMeta): string {
    switch (meta.type) {
      case "date":
        return toDateInputValue(value);
      case "datetime":
        return toDateTimeInputValue(value);
      case "time":
        return toTimeInputValue(value);
      case "duration":
        return formatDurationMs(value);
      default:
        return String(value);
    }
  }

  private readRangeValue(value: string, meta: ColumnMeta): number | null {
    const raw = value.trim();
    if (raw === "") return null;
    const parsed =
      meta.type === "date"
        ? parseDate(raw)
        : meta.type === "datetime"
          ? fromDateTimeInputValue(raw)
          : meta.type === "time"
            ? parseTimeOfDay(raw)
            : meta.type === "duration"
              ? parseDuration(raw)
              : parseNumber(raw, meta.numberLocale);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

function cardActive(from: HTMLElement, active: boolean): void {
  from.closest(".filter-card")?.classList.toggle("active", active);
}
