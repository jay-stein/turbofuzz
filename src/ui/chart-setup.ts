import type { ColumnMeta } from "../worker/protocol.js";
import type { ChartCardConfig } from "./chart-card.js";
import { CHART_KIND_LABELS, type ChartCardKind, isCategoryType, isNumericType } from "./chart-utils.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

interface FieldOption {
  index: number;
  label: string;
}

function optionsFor(
  columns: readonly ColumnMeta[],
  allow: (meta: ColumnMeta) => boolean,
): FieldOption[] {
  const out: FieldOption[] = [];
  columns.forEach((meta, index) => {
    if (allow(meta)) out.push({ index, label: meta.name });
  });
  return out;
}

function select(
  label: string,
  options: readonly FieldOption[],
  selected: number | null,
  aria: string,
): { field: HTMLElement; select: HTMLSelectElement } {
  const field = el("label", { class: "chart-setup-field" });
  field.append(el("span", { class: "chart-field-label" }, [label]));
  const picker = el("select", {
    class: "chart-picker",
    "aria-label": aria,
  }) as HTMLSelectElement;
  for (const option of options) {
    picker.append(el("option", { value: String(option.index) }, [option.label]) as HTMLOptionElement);
  }
  if (selected !== null && options.some((option) => option.index === selected)) {
    picker.value = String(selected);
  }
  field.append(picker);
  return { field, select: picker };
}

/**
 * Confirmation step for adding a chart from a tile: shows the chart type and
 * lets the columns be adjusted before the card lands in the grid, so a click
 * never adds something invisible by accident.
 */
export function openChartSetupDialog(
  kind: ChartCardKind,
  columns: readonly ColumnMeta[],
  preset: Partial<ChartCardConfig>,
): Promise<Partial<ChartCardConfig> | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal chart-setup-modal" });

    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, [`Add a ${CHART_KIND_LABELS[kind].toLowerCase()} chart`]));
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body" });
    const numeric = optionsFor(
      columns,
      (meta) => isNumericType(meta.type) || meta.type === "duration",
    );
    const date = optionsFor(
      columns,
      (meta) => meta.type === "date" || meta.type === "datetime",
    );
    const category = optionsFor(columns, (meta) => isCategoryType(meta.type));
    const text = optionsFor(columns, (meta) => meta.type === "string");

    let collect: () => { config: Partial<ChartCardConfig> | null; error: string | null } = () => ({
      config: { ...preset },
      error: null,
    });

    if (kind === "correlation") {
      const field = el("label", { class: "chart-setup-field" });
      field.append(el("span", { class: "chart-field-label" }, ["Columns"]));
      const picker = el("select", {
        class: "chart-multiselect",
        multiple: "multiple",
        size: "6",
        "aria-label": "Setup correlation columns",
      }) as HTMLSelectElement;
      const chosen = new Set(preset.correlationColumns ?? []);
      for (const option of numeric) {
        const entry = el("option", { value: String(option.index) }, [option.label]) as HTMLOptionElement;
        entry.selected = chosen.has(option.index);
        picker.append(entry);
      }
      field.append(picker);
      body.append(field);
      collect = () => {
        const picked = [...picker.options]
          .filter((option) => option.selected)
          .map((option) => Number(option.value));
        return picked.length >= 2
          ? { config: { kind, correlationColumns: picked }, error: null }
          : {
              config: null,
              error: "Columns: pick at least two numeric columns for correlation.",
            };
      };
    } else if (
      kind === "scatter" ||
      kind === "density" ||
      kind === "bubble" ||
      kind === "map"
    ) {
      const axis = kind === "bubble" || kind === "map" ? numeric : [...numeric, ...date];
      const x = select(kind === "map" ? "Longitude" : "X", axis, preset.x ?? null, "Setup X column");
      const y = select(kind === "map" ? "Latitude" : "Y", axis, preset.y ?? null, "Setup Y column");
      body.append(x.field, y.field);
      collect = () => {
        if (axis.length < 2) {
          return {
            config: null,
            error: `${kind === "map" ? "Longitude/Latitude" : "X/Y"}: pick two different numeric columns.`,
          };
        }
        const xIndex = Number(x.select.value);
        const yIndex = Number(y.select.value);
        if (!Number.isFinite(xIndex) || !Number.isFinite(yIndex)) {
          return { config: null, error: "X/Y: pick both columns." };
        }
        const adjusted = xIndex === yIndex ? (axis.find((option) => option.index !== xIndex)?.index ?? -1) : yIndex;
        return adjusted < 0
          ? { config: null, error: "X/Y: pick two different columns." }
          : { config: { ...preset, kind, x: xIndex, y: adjusted }, error: null };
      };
    } else if (kind === "kpi") {
      const measure = select("Measure", numeric, preset.valueColumn ?? null, "Setup KPI measure");
      const dateOptions: FieldOption[] = [
        { index: -1, label: "All filtered rows" },
        ...date,
      ];
      const timeline = select(
        "Over time (optional)",
        dateOptions,
        preset.column !== undefined && preset.column >= 0 ? preset.column : -1,
        "Setup KPI date column",
      );
      body.append(measure.field, timeline.field);
      collect = () => {
        if (numeric.length === 0) {
          return { config: null, error: "Measure: pick a numeric column." };
        }
        const valueColumn = Number(measure.select.value);
        if (!Number.isFinite(valueColumn)) {
          return { config: null, error: "Measure: pick a numeric column." };
        }
        return {
          config: {
            ...preset,
            kind,
            column: Number(timeline.select.value),
            valueColumn,
            valueAgg: preset.valueAgg ?? "mean",
          },
          error: null,
        };
      };
    } else if (kind === "box") {
      const value = select("Values", numeric, preset.x ?? null, "Setup value column");
      const group = select("Group by", category, preset.y ?? null, "Setup group column");
      body.append(value.field, group.field);
      collect = () => {
        if (numeric.length === 0 || category.length === 0) {
          return {
            config: null,
            error: "Values/Group: pick a numeric value column and a category group.",
          };
        }
        return {
          config: {
            ...preset,
            kind,
            x: Number(value.select.value),
            y: Number(group.select.value),
          },
          error: null,
        };
      };
    } else if (kind === "heatmap") {
      const x = select("Rows", category, preset.x ?? null, "Setup row column");
      const y = select("Columns", category, preset.y ?? null, "Setup column column");
      body.append(x.field, y.field);
      collect = () => {
        if (category.length < 2) {
          return {
            config: null,
            error: "Rows/Columns: pick two category columns.",
          };
        }
        const xIndex = Number(x.select.value);
        const yIndex = Number(y.select.value);
        return xIndex === yIndex
          ? { config: null, error: "Rows/Columns: pick two different columns." }
          : {
              config: { ...preset, kind, x: xIndex, y: yIndex },
              error: null,
            };
      };
    } else {
      const allowed =
        kind === "histogram"
          ? [...numeric, ...date]
          : kind === "line"
            ? date
            : kind === "terms"
              ? text
              : category;
      const label = kind === "histogram" ? "Values" : kind === "line" ? "Date" : "Category";
      const column = select(label, allowed, preset.column ?? null, "Setup chart column");
      body.append(column.field);
      collect = () => {
        if (allowed.length === 0) {
          return {
            config: null,
            error: `${label}: pick a ${label.toLowerCase()} column; none are available.`,
          };
        }
        const value = Number(column.select.value);
        return Number.isFinite(value)
          ? { config: { ...preset, kind, column: value }, error: null }
          : { config: null, error: `${label}: pick a column.` };
      };
    }

    body.append(
      el("p", { class: "confirm-body" }, [
        "The card is added at the end of the grid and briefly highlighted; Cancel adds nothing.",
      ]),
    );
    const errorEl = el("div", { class: "chart-setup-error", role: "alert" });
    body.addEventListener("change", () => {
      errorEl.textContent = "";
    });
    modal.append(body, errorEl);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const confirm = el("button", { class: "primary", type: "button" }, ["Add chart"]);
    footer.append(cancel, el("span", { class: "grow" }), confirm);
    modal.append(footer);

    let settled = false;
    const finish = (value: Partial<ChartCardConfig> | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    confirm.addEventListener("click", () => {
      const result = collect();
      if (result.config === null) {
        errorEl.textContent = result.error ?? "Check the chart fields and try again.";
        return;
      }
      finish(result.config);
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, `Add a ${CHART_KIND_LABELS[kind]} chart`);
  });
}
