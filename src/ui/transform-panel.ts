import { setupDialog } from "./dialog.js";
import { clear, el } from "./dom.js";
import { COMMON_TIME_ZONES } from "../data/timezone.js";
import type { DatePartRole } from "../parse/date-parts.js";
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
  columnNames: string[];
}

export interface TransformPanelCallbacks {
  onApply: (ops: TransformOp[]) => void;
  onPreview: (ops: TransformOp[]) => Promise<TransformPreview | null>;
  onClose: () => void;
}

const TRANSFORM_TYPES: readonly { value: string; label: string }[] = [
  { value: "dedupe", label: "Remove duplicate rows" },
  { value: "drop", label: "Drop a column" },
  { value: "round", label: "Round a column" },
  { value: "groupBy", label: "Group by & aggregate" },
  { value: "impute", label: "Fill missing values" },
  { value: "knn", label: "KNN impute (numeric)" },
  { value: "melt", label: "Melt (wide → long)" },
  { value: "combineDate", label: "Combine date/time columns" },
  { value: "splitColumn", label: "Split a column into new columns" },
];

const DATE_PART_ROLES: readonly { value: DatePartRole; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "date", label: "Full date" },
  { value: "datetime", label: "Date + time" },
  { value: "time", label: "Time only" },
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "day", label: "Day" },
  { value: "hour", label: "Hour" },
  { value: "minute", label: "Minute" },
  { value: "second", label: "Second" },
  { value: "millisecond", label: "Millisecond" },
  { value: "meridiem", label: "AM/PM" },
  { value: "offset", label: "UTC offset" },
  { value: "epoch", label: "Epoch (unix)" },
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
  preset?: { type: string; column?: number },
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
  const clearAll = el("button", { class: "ghost", type: "button" }, ["Reset steps"]);
  clearAll.title = "Remove every staged and applied step";
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
    if (previewNames !== null && pending.some((op) => op.kind === "splitColumn")) {
      return previewNames.map((name) => ({ name, numeric: false }));
    }
    let schema = base.slice();
    for (const op of pending) schema = schemaAfter(schema, op);
    return schema;
  }

  let previewGeneration = 0;
  let previewNames: string[] | null = null;
  let previewNamesKey = "";
  const appliedSignature = JSON.stringify(applied);

  function render(): void {
    renderOps();
    renderBuilder();
    apply.disabled = JSON.stringify(pending) === appliedSignature;
    const baseText =
      pending.length === 0
        ? "No transforms — the data is unchanged."
        : `${pending.length} step${pending.length === 1 ? "" : "s"} ready to apply`;
    summary.textContent = baseText;
    if (pending.length === 0) {
      previewNames = null;
      previewNamesKey = "";
      return;
    }

    const generation = ++previewGeneration;
    void callbacks
      .onPreview(pending.slice())
      .then((preview) => {
        if (generation !== previewGeneration || preview === null) return;
        const names = preview.columnNames;
        const key = names.join("\u0000");
        if (key !== previewNamesKey) {
          previewNamesKey = key;
          previewNames = names;
          renderBuilder();
        }
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
    if (preset?.type !== undefined && TRANSFORM_TYPES.some((entry) => entry.value === preset.type)) {
      typeSelect.value = preset.type;
    }
    typeField.append(typeSelect);

    const preselect = (select: HTMLSelectElement): void => {
      if (preset?.column !== undefined && preset.column >= 0 && preset.column < schema.length) {
        select.value = String(preset.column);
      }
    };

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
        case "drop": {
          const columnSelect = selectOf(indexed(schema));
          preselect(columnSelect);
          inputHost.append(field("Column", columnSelect));
          readOp = () => ({ kind: "drop", column: Number(columnSelect.value) });
          break;
        }
        case "round": {
          const columnSelect = selectOf(indexed(schema));
          preselect(columnSelect);
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
          preselect(dimensionSelect);
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
          preselect(columnSelect);
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
          if (preset?.column !== undefined && preset.column >= 0 && preset.column < schema.length) {
            fill.checks.forEach((check) => {
              check.input.checked = check.index === preset.column;
            });
          }
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
        case "combineDate": {
          const rows: { index: number; check: HTMLInputElement; role: HTMLSelectElement }[] = [];
          const partsList = el("div", { class: "date-parts-list" });
          schema.forEach((entry, index) => {
            const row = el("div", { class: "date-part-row" });
            const check = el("input", { type: "checkbox" }) as HTMLInputElement;
            const role = selectOf(DATE_PART_ROLES);
            role.disabled = true;
            role.title = "How this column contributes to the combined value";
            check.addEventListener("change", () => {
              role.disabled = !check.checked;
            });
            row.append(check, el("span", { class: "date-part-name" }, [entry.name]), role);
            partsList.append(row);
            rows.push({ index, check, role });
          });
          if (preset?.column !== undefined && rows[preset.column] !== undefined) {
            const row = rows[preset.column];
            row.check.checked = true;
            row.role.disabled = false;
          }

          const outputSelect = selectOf([
            { value: "datetime", label: "Datetime (ISO with time)" },
            { value: "date", label: "Date (YYYY-MM-DD)" },
          ]);
          const orderSelect = selectOf([
            { value: "auto", label: "Auto-detect (US vs day-first)" },
            { value: "mdy", label: "Month first (MM/DD/YYYY)" },
            { value: "dmy", label: "Day first (DD/MM/YYYY)" },
          ]);
          const nameInput = el("input", {
            class: "text-input",
            type: "text",
            value: "datetime",
            spellcheck: "false",
          }) as HTMLInputElement;
          outputSelect.addEventListener("change", () => {
            if (nameInput.value === "datetime" || nameInput.value === "date") {
              nameInput.value = outputSelect.value;
            }
          });

          const tzInput = el("input", {
            class: "text-input",
            type: "text",
            value: "UTC",
            list: "tz-zones",
            spellcheck: "false",
          }) as HTMLInputElement;
          const tzList = el("datalist", { id: "tz-zones" });
          for (const zone of ["naive", "local", ...COMMON_TIME_ZONES]) {
            tzList.append(el("option", { value: zone }));
          }
          const tzNote = el("div", { class: "clean-hint" }, [
            "UTC, local, naive (as written), any IANA zone, or ±HH:MM. Offsets found in the data win.",
          ]);

          const dropCheck = el("input", { type: "checkbox" }) as HTMLInputElement;
          const dropField = el("label", { class: "control check clean-check" });
          dropField.append(dropCheck, "Remove the source columns after combining");

          const partsGroup = group(
            "Columns to combine",
            partsList,
            "Tick each column and pick its role — Auto detects it from the column name and values (year/month/day, date + time, 12-hour clocks, offsets, epochs).",
          );
          partsGroup.classList.add("date-parts-group");
          inputHost.append(
            partsGroup,
            field("Output", outputSelect),
            field("Date order", orderSelect),
            field("Timezone", tzInput),
            tzNote,
            tzList,
            field("Column name", nameInput),
            dropField,
          );

          readOp = () => {
            const parts = rows
              .filter((row) => row.check.checked)
              .map((row) => ({ column: row.index, role: row.role.value as DatePartRole }));
            if (parts.length === 0) return null;
            return {
              kind: "combineDate",
              parts,
              output: outputSelect.value === "date" ? "date" : "datetime",
              outputName: nameInput.value,
              order: orderSelect.value === "auto" ? "auto" : orderSelect.value === "mdy" ? "mdy" : "dmy",
              timeZone: tzInput.value,
              dropParts: dropCheck.checked,
            };
          };
          break;
        }
        case "splitColumn": {
          const columnSelect = selectOf(indexed(schema));
          preselect(columnSelect);
          const patternInput = el("input", {
            class: "text-input",
            type: "text",
            placeholder: ",",
            spellcheck: "false",
            "aria-label": "Delimiter or regular expression",
          }) as HTMLInputElement;
          const regexCheck = el("input", { type: "checkbox" }) as HTMLInputElement;
          const regexField = el("label", { class: "control check clean-check" });
          regexField.title =
            "Treat the pattern as a regular expression; capture groups become the new columns";
          regexField.append(regexCheck, "Regular expression");
          const dropEmptyCheck = el("input", { type: "checkbox" }) as HTMLInputElement;
          dropEmptyCheck.checked = true;
          const dropEmptyField = el("label", { class: "control check clean-check" });
          dropEmptyField.append(dropEmptyCheck, "Drop empty parts");
          const dropOriginalCheck = el("input", { type: "checkbox" }) as HTMLInputElement;
          const dropOriginalField = el("label", { class: "control check clean-check" });
          dropOriginalField.append(dropOriginalCheck, "Remove the original column");
          const prefixInput = el("input", {
            class: "text-input",
            type: "text",
            placeholder: "column name",
            spellcheck: "false",
            "aria-label": "Prefix for the new columns",
          }) as HTMLInputElement;

          inputHost.append(
            field("Column", columnSelect),
            field("Split on", patternInput),
            regexField,
            dropEmptyField,
            dropOriginalField,
            field("New column prefix", prefixInput),
            el("div", { class: "clean-hint" }, [
              "Works like pandas str.split(expand=True): new columns are prefix_1, prefix_2 … up to the largest part count (limit 50). Regex mode uses the pattern's capture groups; without groups it splits on every match.",
            ]),
          );

          readOp = () => {
            const pattern = patternInput.value;
            if (pattern === "") return null;
            return {
              kind: "splitColumn",
              column: Number(columnSelect.value),
              pattern,
              regex: regexCheck.checked,
              dropEmpty: dropEmptyCheck.checked,
              dropOriginal: dropOriginalCheck.checked,
              prefix: prefixInput.value,
            };
          };
          break;
        }
      }
    }
    typeSelect.addEventListener("change", buildInputs);

    const addButton = el("button", { class: "primary small", type: "button" }, ["Add step"]);
    addButton.addEventListener("click", () => {
      const op = readOp();
      if (op === null) return;
      pending.push(op);
      render();
    });

    builderHost.append(
      typeField,
      inputHost,
      addButton,
      el("div", { class: "clean-hint" }, [
        "Add each step to the list below, then click Apply transforms when it is ready.",
      ]),
    );
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
  setupDialog(overlay, "Transform pipeline");
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
