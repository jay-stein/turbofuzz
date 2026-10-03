import { clear, el } from "./dom.js";
import { COLUMN_TYPES, TYPE_LABELS, type ColumnType, type TextMode } from "../types.js";
import { parseDate, toDateInputValue } from "../parse/dates.js";
import { parseNumber } from "../parse/numbers.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { ColumnMeta } from "../worker/protocol.js";

export interface FilterPanelCallbacks {
  onFilter: (column: number, filter: ColumnFilter | null) => void;
  onTypeChange: (column: number, type: ColumnType) => void;
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
  private histograms: (HistogramView | null)[] = [];

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
    this.histograms = [];
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
      const view = this.histograms[column];
      if (view === null || view === undefined || meta.histogram === null) return;
      view.setBins(histograms[column] ?? meta.histogram.bins);
      const filter = this.filters.get(column);
      const min = filter?.kind === "range" ? filter.min : null;
      const max = filter?.kind === "range" ? filter.max : null;
      view.setRange(min, max, meta.histogram.min, meta.histogram.max);
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
    const card = el("div", { class: "filter-card" });
    if (this.filters.has(index)) card.classList.add("active");

    const head = el("div", { class: "filter-head" });
    head.append(el("span", { class: "filter-name", title: meta.name }, [meta.name]));

    const typeSelect = el("select", {
      class: "type-select",
      title: "Data type — change to re-interpret this column",
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

    card.append(head, this.buildBody(meta, index), this.buildStats(meta), status);
    return card;
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

    const modeSelect = el("select", { class: "mode-select", title: "Match mode" }) as HTMLSelectElement;
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

    const minInput = el("input", {
      class: "range-input",
      type: inputType,
      placeholder: "Min",
    }) as HTMLInputElement;
    const maxInput = el("input", {
      class: "range-input",
      type: inputType,
      placeholder: "Max",
    }) as HTMLInputElement;

    if (current?.min !== null && current?.min !== undefined) {
      minInput.value = isDate ? toDateInputValue(current.min) : String(current.min);
    }
    if (current?.max !== null && current?.max !== undefined) {
      maxInput.value = isDate ? toDateInputValue(current.max) : String(current.max);
    }

    const apply = (): void => {
      const min = this.readRangeValue(minInput.value, isDate);
      const max = this.readRangeValue(maxInput.value, isDate);
      this.callbacks.onFilter(
        index,
        min === null && max === null ? null : { kind: "range", min, max },
      );
      cardActive(body, this.filters.has(index));
      if (meta.histogram !== null) {
        this.histograms[index]?.setRange(min, max, meta.histogram.min, meta.histogram.max);
      }
    };

    minInput.addEventListener("input", apply);
    maxInput.addEventListener("input", apply);

    const inputs = el("div", { class: "range-inputs" }, [
      minInput,
      el("span", { class: "range-sep" }, ["–"]),
      maxInput,
    ]);
    body.append(inputs);

    if (meta.histogram !== null) {
      const view = new HistogramView(meta.histogram.bins.length);
      view.setBins(meta.histogram.bins);
      view.setRange(
        current?.min ?? null,
        current?.max ?? null,
        meta.histogram.min,
        meta.histogram.max,
      );
      body.append(view.el);
      this.histograms[index] = view;
    } else {
      this.histograms[index] = null;
    }

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

  private readRangeValue(value: string, isDate: boolean): number | null {
    if (value.trim() === "") return null;
    const parsed = isDate ? parseDate(value) : parseNumber(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

function cardActive(from: HTMLElement, active: boolean): void {
  from.closest(".filter-card")?.classList.toggle("active", active);
}

class HistogramView {
  readonly el: HTMLElement;
  private readonly bars: HTMLElement[] = [];

  constructor(binCount: number) {
    this.el = el("div", { class: "histogram" });
    for (let i = 0; i < binCount; i++) {
      const bar = el("div", { class: "hist-bar" });
      this.bars.push(bar);
      this.el.append(bar);
    }
  }

  setBins(bins: number[]): void {
    let max = 0;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] > max) max = bins[i];
    }
    for (let i = 0; i < this.bars.length; i++) {
      const count = bins[i] ?? 0;
      const percent = max > 0 && count > 0 ? Math.max(3, (count / max) * 100) : 0;
      this.bars[i].style.height = `${percent}%`;
      this.bars[i].title = count.toLocaleString();
    }
  }

  setRange(min: number | null, max: number | null, dataMin: number, dataMax: number): void {
    const noSelection = min === null && max === null;
    const span = dataMax - dataMin || 1;
    for (let i = 0; i < this.bars.length; i++) {
      const binStart = dataMin + (i / this.bars.length) * span;
      const binEnd = dataMin + ((i + 1) / this.bars.length) * span;
      const selected =
        !noSelection && (min === null || binEnd > min) && (max === null || binStart < max);
      this.bars[i].classList.toggle("selected", selected);
      this.bars[i].classList.toggle("dimmed", !noSelection && !selected);
    }
  }
}
