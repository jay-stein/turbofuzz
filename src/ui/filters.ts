import { clear, el } from "./dom.js";
import { COLUMN_TYPES, TYPE_LABELS, type ColumnType, type TextMode } from "../types.js";
import { parseDate, toDateInputValue } from "../parse/dates.js";
import { parseNumber } from "../parse/numbers.js";
import type { ColumnData } from "../data/column.js";
import type { ColumnFilter } from "../search/query-engine.js";

export interface FilterPanelCallbacks {
  onChange: () => void;
  onTypeChange: () => void;
}

const TEXT_MODES: { value: TextMode; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "exact", label: "Exact" },
  { value: "fuzzy", label: "Fuzzy" },
];

export class FilterPanel {
  private readonly listEl: HTMLElement;
  private cards: HTMLElement[] = [];

  constructor(
    root: HTMLElement,
    private readonly columns: ColumnData[],
    private readonly filters: Map<number, ColumnFilter>,
    private readonly callbacks: FilterPanelCallbacks,
  ) {
    this.listEl = el("div", { class: "filter-list" });
    root.append(this.listEl);
    this.rebuild();
  }

  rebuild(): void {
    clear(this.listEl);
    this.cards = this.columns.map((column, index) => {
      const card = this.buildCard(column, index);
      this.listEl.append(card);
      return card;
    });
  }

  private rebuildCard(index: number): void {
    const next = this.buildCard(this.columns[index], index);
    this.cards[index].replaceWith(next);
    this.cards[index] = next;
  }

  private buildCard(column: ColumnData, index: number): HTMLElement {
    const card = el("div", { class: "filter-card" });
    if (this.filters.has(index)) card.classList.add("active");

    const head = el("div", { class: "filter-head" });
    head.append(el("span", { class: "filter-name", title: column.name }, [column.name]));

    const typeSelect = el("select", {
      class: "type-select",
      title: "Data type — change to re-interpret this column",
    }) as HTMLSelectElement;
    for (const type of COLUMN_TYPES) {
      const option = el("option", { value: type }, [TYPE_LABELS[type]]) as HTMLOptionElement;
      if (type === column.type) option.selected = true;
      typeSelect.append(option);
    }
    typeSelect.addEventListener("change", () => {
      column.setType(typeSelect.value as ColumnType);
      this.filters.delete(index);
      this.callbacks.onTypeChange();
      this.rebuildCard(index);
    });
    head.append(typeSelect);

    const clearButton = el(
      "button",
      { class: "icon-btn", type: "button", title: "Clear this filter" },
      ["×"],
    );
    clearButton.addEventListener("click", () => {
      this.filters.delete(index);
      this.callbacks.onChange();
      this.rebuildCard(index);
    });
    head.append(clearButton);

    card.append(head, this.buildBody(column, index), this.buildStats(column));
    return card;
  }

  private buildBody(column: ColumnData, index: number): HTMLElement {
    switch (column.type) {
      case "category":
      case "boolean":
        return this.buildValuesBody(column, index);
      case "integer":
      case "number":
      case "date":
        return this.buildRangeBody(column, index);
      default:
        return this.buildTextBody(column, index);
    }
  }

  private buildTextBody(column: ColumnData, index: number): HTMLElement {
    const body = el("div", { class: "filter-body" });
    const state = this.filters.get(index);
    const current = state?.kind === "text" ? state : null;

    const modeSelect = el("select", { class: "mode-select", title: "Match mode" }) as HTMLSelectElement;
    const defaultMode: TextMode = column.type === "identifier" ? "exact" : "contains";
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

    const status = el("span", { class: "filter-status" });

    const apply = () => {
      const query = input.value;
      if (query.trim() === "") this.filters.delete(index);
      else this.filters.set(index, { kind: "text", mode: modeSelect.value as TextMode, query });
      this.setCardActive(body, this.filters.has(index));
      this.callbacks.onChange();
    };

    input.addEventListener("input", apply);
    modeSelect.addEventListener("change", () => {
      if ((modeSelect.value as TextMode) === "fuzzy") {
        status.textContent = "Building index…";
        window.setTimeout(() => {
          apply();
          status.textContent = "";
        }, 0);
      } else {
        apply();
      }
    });

    body.append(modeSelect, input, status);
    return body;
  }

  private buildRangeBody(column: ColumnData, index: number): HTMLElement {
    const body = el("div", { class: "filter-body range-body" });
    const state = this.filters.get(index);
    const current = state?.kind === "range" ? state : null;
    const isDate = column.type === "date";
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

    const apply = () => {
      const min = this.readRangeValue(minInput.value, isDate);
      const max = this.readRangeValue(maxInput.value, isDate);
      if (min === null && max === null) this.filters.delete(index);
      else this.filters.set(index, { kind: "range", min, max });
      this.setCardActive(body, this.filters.has(index));
      this.callbacks.onChange();
    };

    minInput.addEventListener("input", apply);
    maxInput.addEventListener("input", apply);

    body.append(minInput, el("span", { class: "range-sep" }, ["–"]), maxInput);
    return body;
  }

  private buildValuesBody(column: ColumnData, index: number): HTMLElement {
    const body = el("div", { class: "filter-body values-body" });
    const categories = column.categories();
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

    const apply = () => {
      if (selected.size === categories.labels.length) this.filters.delete(index);
      else this.filters.set(index, { kind: "values", selected: [...selected] });
      this.setCardActive(body, this.filters.has(index));
      this.callbacks.onChange();
    };

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
      row.append(
        checkbox,
        el("span", { class: "value-label", title: label }, [label]),
        el("span", { class: "value-count" }, [categories.counts[id].toLocaleString()]),
      );
      list.append(row);
    });

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

  private buildStats(column: ColumnData): HTMLElement {
    if (column.type === "integer" || column.type === "number" || column.type === "date") {
      column.numbers();
    }
    const stats = el("div", { class: "filter-stats" });
    const parts = [`${column.stats.distinct.toLocaleString()} distinct`];
    if (column.stats.nulls > 0) parts.push(`${column.stats.nulls.toLocaleString()} empty`);
    if (column.stats.min !== null && column.stats.max !== null) {
      parts.push(
        `${this.formatStat(column, column.stats.min)} … ${this.formatStat(column, column.stats.max)}`,
      );
    }
    stats.textContent = parts.join(" · ");
    return stats;
  }

  private formatStat(column: ColumnData, value: number): string {
    if (column.type === "date") return toDateInputValue(value);
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  private readRangeValue(value: string, isDate: boolean): number | null {
    if (value.trim() === "") return null;
    const parsed = isDate ? parseDate(value) : parseNumber(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private setCardActive(from: HTMLElement, active: boolean): void {
    from.closest(".filter-card")?.classList.toggle("active", active);
  }
}
