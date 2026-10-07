import { clear, el } from "./dom.js";
import {
  AGGREGATES,
  AGGREGATE_LABELS,
  describeTransformOp,
  schemaAfter,
  type Aggregate,
  type ColumnSchema,
  type DedupeKeep,
  type ImputeStrategy,
  type TransformOp,
} from "../data/transform-ops.js";

export interface TransformPreview {
  baseRowCount: number;
  rowCount: number;
  baseNullCells: number;
  nullCells: number;
  columnCount: number;
}

export interface TransformPanelCallbacks {
  onApply: (ops: TransformOp[]) => void;
  onPreview: (ops: TransformOp[]) => Promise<TransformPreview | null>;
  onClose: () => void;
}

const TRANSFORM_TYPES: readonly { value: string; label: string }[] = [
  { value: "dedupe", label: "Remove duplicate rows" },
  { value: "round", label: "Round a column" },
  { value: "groupBy", label: "Group by & aggregate" },
  { value: "impute", label: "Fill missing values" },
  { value: "knn", label: "KNN impute (numeric)" },
  { value: "melt", label: "Melt (wide → long)" },
];

const DEDUPE_KEEPS: readonly { value: DedupeKeep; label: string }[] = [
  { value: "first", label: "Keep first copy" },
  { value: "last", label: "Keep last copy" },
  { value: "none", label: "Remove all copies" },
];

const IMPUTE_STRATEGIES: readonly { value: string; label: string }[] = [
  { value: "constant", label: "Constant value" },
  { value: "mean", label: "Mean" },
  { value: "median", label: "Median" },
  { value: "mode", label: "Mode (most frequent)" },
  { value: "forward", label: "Previous value" },
  { value: "backward", label: "Next value" },
];

/**
 * Transform panel: builds an ordered pipeline of shape-changing steps. Steps
 * are staged locally (nothing is applied until Apply) and the column pickers
 * follow the schema produced by the earlier steps, so a later step can target a
 * group-by output. Only the last step can be removed here to avoid invalidating
 * later steps; use Clear all for a full reset.
 */
export function openTransformPanel(
  applied: readonly TransformOp[],
  baseSchema: readonly ColumnSchema[],
  callbacks: TransformPanelCallbacks,
): void {
  const overlay = el("div", { class: "modal-overlay drawer-overlay" });
  const modal = el("div", { class: "modal clean-modal drawer" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, ["Transform"]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const base = baseSchema.slice();
  let pending: TransformOp[] = applied.slice();

  const summary = el("div", { class: "clean-summary" });
  const opList = el("div", { class: "clean-op-list" });
  const builderHost = el("div", { class: "transform-builder" });

  const footer = el("div", { class: "clean-footer" });
  const clearAll = el("button", { class: "ghost", type: "button" }, ["Clear all"]);
  clearAll.addEventListener("click", () => {
    pending = [];
    render();
  });
  const apply = el("button", { class: "primary", type: "button" }, ["Apply transforms"]);
  apply.addEventListener("click", () => {
    callbacks.onApply(pending.slice());
    close();
  });
  footer.append(clearAll, el("span", { class: "grow" }), apply);

  modal.append(summary, opList, builderHost, footer);

  function runningSchema(): ColumnSchema[] {
    let schema = base.slice();
    for (const op of pending) schema = schemaAfter(schema, op);
    return schema;
  }

  let previewGeneration = 0;

  function render(): void {
    renderOps();
    renderBuilder();
    const baseText =
      pending.length === 0
        ? "No transforms — the data is unchanged."
        : `${pending.length} step${pending.length === 1 ? "" : "s"} ready to apply`;
    summary.textContent = baseText;
    if (pending.length === 0) return;

    const generation = ++previewGeneration;
    void callbacks
      .onPreview(pending.slice())
      .then((preview) => {
        if (generation !== previewGeneration || preview === null) return;
        const parts: string[] = [];
        const rowDelta = preview.baseRowCount - preview.rowCount;
        if (rowDelta > 0) {
          parts.push(`${preview.rowCount.toLocaleString()} rows (removes ${rowDelta.toLocaleString()})`);
        } else if (rowDelta < 0) {
          parts.push(`${preview.rowCount.toLocaleString()} rows (adds ${(-rowDelta).toLocaleString()})`);
        } else {
          parts.push(`${preview.rowCount.toLocaleString()} rows`);
        }
        if (preview.nullCells < preview.baseNullCells) {
          parts.push(
            `${preview.baseNullCells.toLocaleString()} → ${preview.nullCells.toLocaleString()} empty`,
          );
        } else if (preview.nullCells > preview.baseNullCells) {
          parts.push(`${preview.nullCells.toLocaleString()} empty`);
        }
        parts.push(`${preview.columnCount} columns`);
        summary.textContent = `${baseText} · ${parts.join(" · ")}`;
      })
      .catch(() => {});
  }

  function renderOps(): void {
    clear(opList);
    if (pending.length === 0) {
      opList.append(el("div", { class: "clean-empty" }, ["No steps yet."]));
      return;
    }
    let schema = base.slice();
    pending.forEach((op, index) => {
      const row = el("div", { class: "clean-op" });
      const remove = el("button", { class: "icon-btn", type: "button" }, ["×"]);
      if (index === pending.length - 1) {
        remove.title = "Remove this step";
        remove.addEventListener("click", () => {
          pending.pop();
          render();
        });
      } else {
        remove.title = "Only the last step can be removed";
        remove.disabled = true;
      }
      row.append(
        el("span", { class: "clean-op-index" }, [String(index + 1)]),
        el("span", { class: "clean-op-desc" }, [
          describeTransformOp(
            op,
            schema.map((entry) => entry.name),
          ),
        ]),
        remove,
      );
      opList.append(row);
      schema = schemaAfter(schema, op);
    });
  }

  function renderBuilder(): void {
    clear(builderHost);
    const schema = runningSchema();

    const typeField = el("label", { class: "clean-field" });
    typeField.append(el("span", { class: "clean-label" }, ["Step"]));
    const typeSelect = el("select") as HTMLSelectElement;
    for (const { value, label } of TRANSFORM_TYPES) {
      typeSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    typeField.append(typeSelect);

    const inputHost = el("div", { class: "transform-inputs" });
    let readOp: () => TransformOp | null = () => null;

    function buildInputs(): void {
      clear(inputHost);
      switch (typeSelect.value) {
        case "dedupe": {
          const keepSelect = selectOf(DEDUPE_KEEPS);
          inputHost.append(field("Keep", keepSelect));
          readOp = () => ({ kind: "dedupe", keep: keepSelect.value as DedupeKeep });
          break;
        }
        case "round": {
          const columnSelect = selectOf(indexed(schema));
          const decimalsInput = numberInput("0", "Decimal places — negative rounds left (-1 = nearest 10)");
          inputHost.append(field("Column", columnSelect), field("Decimals", decimalsInput));
          readOp = () => ({
            kind: "round",
            column: Number(columnSelect.value),
            decimals: Number(decimalsInput.value),
          });
          break;
        }
        case "groupBy": {
          const dimensionSelect = selectOf(indexed(schema));
          const measureSelect = selectOf(indexed(schema));
          const aggregateSelect = selectOf(
            AGGREGATES.map((value) => ({ value, label: AGGREGATE_LABELS[value] })),
          );
          const syncMeasure = (): void => {
            measureSelect.disabled = aggregateSelect.value === "count";
          };
          aggregateSelect.addEventListener("change", syncMeasure);
          syncMeasure();
          inputHost.append(
            field("Group by", dimensionSelect),
            field("Aggregate", aggregateSelect),
            field("Of", measureSelect),
          );
          readOp = () => ({
            kind: "groupBy",
            dimension: Number(dimensionSelect.value),
            measure: aggregateSelect.value === "count" ? null : Number(measureSelect.value),
            aggregate: aggregateSelect.value as Aggregate,
          });
          break;
        }
        case "impute": {
          const columnSelect = selectOf(indexed(schema));
          const strategySelect = selectOf(IMPUTE_STRATEGIES);
          const constantInput = el("input", {
            class: "text-input",
            type: "text",
            placeholder: "Value",
            spellcheck: "false",
          }) as HTMLInputElement;
          const constantField = field("Value", constantInput);
          const groupSelect = selectOf([
            { value: "", label: "No grouping" },
            ...indexed(schema),
          ]);
          const groupField = field("Within", groupSelect);
          const sync = (): void => {
            const kind = strategySelect.value;
            constantField.classList.toggle("hidden", kind !== "constant");
            groupField.classList.toggle("hidden", kind === "forward" || kind === "backward");
          };
          strategySelect.addEventListener("change", sync);
          sync();
          inputHost.append(
            field("Column", columnSelect),
            field("Fill with", strategySelect),
            constantField,
            groupField,
          );
          readOp = () => {
            const kind = strategySelect.value;
            const strategy: ImputeStrategy =
              kind === "constant"
                ? { kind: "constant", value: constantInput.value }
                : kind === "mean"
                  ? { kind: "mean" }
                  : kind === "median"
                    ? { kind: "median" }
                    : kind === "mode"
                      ? { kind: "mode" }
                      : kind === "forward"
                        ? { kind: "forward" }
                        : { kind: "backward" };
            const grouped =
              groupSelect.value !== "" && kind !== "forward" && kind !== "backward";
            return {
              kind: "impute",
              column: Number(columnSelect.value),
              strategy,
              groupColumn: grouped ? Number(groupSelect.value) : null,
            };
          };
          break;
        }
        case "knn": {
          const numeric = schema
            .map((entry, index) => ({ name: entry.name, index }))
            .filter(({ index }) => schema[index].numeric);
          if (numeric.length === 0) {
            inputHost.append(
              el("div", { class: "clean-empty" }, ["No numeric columns available."]),
            );
            readOp = () => null;
            break;
          }
          const fill = checkboxList(numeric);
          const predictors = checkboxList(numeric);
          const kInput = numberInput("5", "Number of neighbours");
          inputHost.append(
            group("Fill columns", fill.list, "Missing cells in these columns are imputed"),
            group("Predictors", predictors.list, "Used to measure similarity; not modified"),
            field("Neighbours (k)", kInput),
          );
          readOp = () => {
            const fillColumns = fill.checks
              .filter((check) => check.input.checked)
              .map((check) => check.index);
            if (fillColumns.length === 0) return null;
            return {
              kind: "knn",
              fill: fillColumns,
              predictors: predictors.checks
                .filter((check) => check.input.checked)
                .map((check) => check.index),
              k: Math.max(1, Math.round(Number(kInput.value) || 5)),
            };
          };
          break;
        }
        case "melt": {
          const idSet = new Set<number>();
          const valueSet = new Set<number>();
          const idList = el("div", { class: "check-list" });
          const valueList = el("div", { class: "check-list" });
          schema.forEach((entry, index) => {
            idList.append(
              checkOption(entry.name, (checked) => {
                if (checked) idSet.add(index);
                else idSet.delete(index);
              }),
            );
            valueList.append(
              checkOption(entry.name, (checked) => {
                if (checked) valueSet.add(index);
                else valueSet.delete(index);
              }),
            );
          });
          const varNameInput = el("input", {
            class: "text-input",
            type: "text",
            value: "variable",
            placeholder: "variable",
            spellcheck: "false",
          }) as HTMLInputElement;
          const valueNameInput = el("input", {
            class: "text-input",
            type: "text",
            value: "value",
            placeholder: "value",
            spellcheck: "false",
          }) as HTMLInputElement;
          inputHost.append(
            group("ID columns", idList),
            group("Value columns", valueList, "Leave empty to melt every non-ID column"),
            field("Variable name", varNameInput),
            field("Value name", valueNameInput),
          );
          readOp = () => ({
            kind: "melt",
            idVars: [...idSet].sort((a, b) => a - b),
            valueVars: [...valueSet].sort((a, b) => a - b),
            varName: varNameInput.value,
            valueName: valueNameInput.value,
          });
          break;
        }
      }
    }
    typeSelect.addEventListener("change", buildInputs);

    const addButton = el("button", { class: "ghost small", type: "button" }, ["Add step"]);
    addButton.addEventListener("click", () => {
      const op = readOp();
      if (op === null) return;
      pending.push(op);
      render();
    });

    builderHost.append(typeField, inputHost, addButton);
    buildInputs();
  }

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    callbacks.onClose();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  overlay.append(modal);
  document.body.append(overlay);
  render();
}

function indexed(schema: readonly ColumnSchema[]): { value: string; label: string }[] {
  return schema.map((entry, index) => ({ value: String(index), label: entry.name }));
}

function numberInput(value: string, title: string): HTMLInputElement {
  return el("input", {
    class: "text-input decimals-input",
    type: "number",
    step: "1",
    value,
    title,
    spellcheck: "false",
  }) as HTMLInputElement;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", { class: "clean-field" });
  wrap.append(el("span", { class: "clean-label" }, [label]), control);
  return wrap;
}

function group(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = el("div", { class: "transform-group" });
  wrap.append(el("div", { class: "clean-label" }, [label]), control);
  if (hint !== undefined) wrap.append(el("div", { class: "clean-hint" }, [hint]));
  return wrap;
}

function checkOption(label: string, onChange: (checked: boolean) => void): HTMLElement {
  const wrap = el("label", { class: "control check clean-check" });
  const input = el("input", { type: "checkbox" }) as HTMLInputElement;
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, label);
  return wrap;
}

function checkboxList(entries: readonly { name: string; index: number }[]): {
  list: HTMLElement;
  checks: { index: number; input: HTMLInputElement }[];
} {
  const list = el("div", { class: "check-list" });
  const checks: { index: number; input: HTMLInputElement }[] = [];
  for (const { name, index } of entries) {
    const label = el("label", { class: "control check clean-check" });
    const input = el("input", { type: "checkbox" }) as HTMLInputElement;
    input.checked = true;
    label.append(input, name);
    list.append(label);
    checks.push({ index, input });
  }
  return { list, checks };
}

function selectOf(options: readonly { value: string; label: string }[]): HTMLSelectElement {
  const select = el("select") as HTMLSelectElement;
  for (const { value, label } of options) {
    select.append(el("option", { value }, [label]) as HTMLOptionElement);
  }
  return select;
}
