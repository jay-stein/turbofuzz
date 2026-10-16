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

    let collect: () => Partial<ChartCardConfig> | null = () => ({ ...preset });

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
        return picked.length >= 2 ? { kind, correlationColumns: picked } : null;
      };
    } else if (kind === "scatter" || kind === "density" || kind === "bubble") {
      const axis = kind === "bubble" ? numeric : [...numeric, ...date];
      const x = select("X", axis, preset.x ?? null, "Setup X column");
      const y = select("Y", axis, preset.y ?? null, "Setup Y column");
      body.append(x.field, y.field);
      collect = () => {
        const xIndex = Number(x.select.value);
        const yIndex = Number(y.select.value);
        if (!Number.isFinite(xIndex) || !Number.isFinite(yIndex)) return null;
        const adjusted = xIndex === yIndex ? (axis.find((option) => option.index !== xIndex)?.index ?? -1) : yIndex;
        return adjusted < 0
          ? null
          : { ...preset, kind, x: xIndex, y: adjusted };
      };
    } else if (kind === "box") {
      const value = select("Values", numeric, preset.x ?? null, "Setup value column");
      const group = select("Group by", category, preset.y ?? null, "Setup group column");
      body.append(value.field, group.field);
      collect = () => ({
        ...preset,
        kind,
        x: Number(value.select.value),
        y: Number(group.select.value),
      });
    } else if (kind === "heatmap") {
      const x = select("Rows", category, preset.x ?? null, "Setup row column");
      const y = select("Columns", category, preset.y ?? null, "Setup column column");
      body.append(x.field, y.field);
      collect = () => ({
        ...preset,
        kind,
        x: Number(x.select.value),
        y: Number(y.select.value),
      });
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
      collect = () => ({ ...preset, kind, column: Number(column.select.value) });
    }

    body.append(
      el("p", { class: "confirm-body" }, [
        "The card is added at the end of the grid and briefly highlighted; Cancel adds nothing.",
      ]),
    );
    modal.append(body);

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
      const config = collect();
      if (config === null) {
        confirm.textContent = "Pick valid columns";
        window.setTimeout(() => {
          confirm.textContent = "Add chart";
        }, 1400);
        return;
      }
      finish(config);
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
